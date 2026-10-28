// 本地 royale benchmark：不启动服务器、不访问网络、不保存 GameStore / arena 战绩。
// node --import tsx scripts/apex-arena.mts --maps snowflake,narrow-road --games 4 \
//   --players 2 --opponent random-royale --seed 20261028 --max-rounds 80
// games 为每图局数；每 players 局共用开局种子并轮换 apex 席位；trace 为 stderr JSONL。
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { getMapConfig, loadMaps } from '../src/config/loader.js';
import { generateRandomMapConfig } from '../src/config/randomMap.js';
import { addLobbyPlayer, createLobbyWithConfig } from '../src/state/store.js';
import { buildAdjudicationSnapshot, startGame } from '../src/engine/engine.js';
import { commitAndMaybeResolve } from '../src/engine/simultaneous.js';
import type { PlanOutcome } from '../src/engine/simultaneous.js';
import {
  coveredCellsFor, queueAttackAction, queueDemolishAction, queueDeployAction,
  queueHealAction, queueMoveAction, queueWaitAction,
} from '../src/engine/planning.js';
import { EventBus } from '../src/events/bus.js';
import type { GameState, PendingAction, PlayerId, Position, Unit } from '../src/types.js';
// @ts-expect-error ESM 工具库无类型声明
import * as utils from '../algorithms/lib/game-utils.mjs';
// @ts-expect-error ESM 算法无类型声明
import randomRoyale from '../algorithms/builtin/random-royale.mjs';

type Action = { type: string; payload?: Record<string, any> };
type View = Omit<GameState, 'tokens' | 'hostToken' | 'rngState' | 'plan'> & {
  adjudication: ReturnType<typeof buildAdjudicationSnapshot>;
  plan: { queues: {}; committed: PlayerId[]; myQueue: PendingAction[] };
};
type Decider = { name: string; decide: (game: View, u: typeof utils, ctx: { owner: PlayerId }) => Action | null | Promise<Action | null> };
interface Options {
  maps: string[]; games: number; players: number; opponent: 'random-royale' | 'self' | 'sentinel';
  seed: number; maxRounds: number; trace: boolean;
}
const defaults: Options = {
  maps: ['snowflake', 'narrow-road'], games: 4, players: 2, opponent: 'random-royale',
  seed: 20261028, maxRounds: 80, trace: false,
};

export function parseArgs(argv: string[]): Options {
  const args = { ...defaults, maps: [...defaults.maps] };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--trace') { args.trace = true; continue; }
    if (!['--maps', '--games', '--players', '--opponent', '--seed', '--max-rounds'].includes(key!)) {
      throw new Error(`未知参数: ${key}`);
    }
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`${key} 缺少值`);
    if (key === '--maps') args.maps = value.split(',').map(s => s.trim());
    else if (key === '--opponent') args.opponent = value as Options['opponent'];
    else if (key === '--games') args.games = Number(value);
    else if (key === '--players') args.players = Number(value);
    else if (key === '--seed') args.seed = Number(value);
    else args.maxRounds = Number(value);
  }
  for (const key of ['games', 'maxRounds'] as const) {
    if (!Number.isSafeInteger(args[key]) || args[key] < 1) throw new Error(`${key} 必须为正整数`);
  }
  if (![2, 3, 6].includes(args.players)) throw new Error('players 仅支持 2/3/6');
  if (!Number.isInteger(args.seed) || args.seed < 0 || args.seed > 0xffffffff) throw new Error('seed 必须为 uint32');
  if (!['random-royale', 'self', 'sentinel'].includes(args.opponent)) throw new Error('opponent 仅支持 random-royale/self/sentinel');
  if (args.maps.some(m => !m) || new Set(args.maps).size !== args.maps.length) {
    throw new Error('maps 必须是非空且不重复的地图 ID');
  }
  return args;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 原始 UUID 不受开局 RNG 控制：仅在视图中稳定别名化，避免算法按 ID 破平局时漂移。 */
function identities() {
  const forward = new Map<string, string>();
  const backward = new Map<string, string>();
  return {
    register(id: string, alias: string) { forward.set(id, alias); backward.set(alias, id); },
    public<T>(value: T): T {
      return JSON.parse(JSON.stringify(value, (_key, v) => typeof v === 'string' ? forward.get(v) ?? v : v));
    },
    actual(action: Action): Action {
      const payload = { ...action.payload };
      for (const field of ['unitId', 'attackerId', 'supportId', 'fromId']) {
        if (typeof payload[field] === 'string') payload[field] = backward.get(payload[field]) ?? payload[field];
      }
      return { type: action.type, payload };
    },
  };
}

function view(game: GameState, owner: PlayerId): View {
  const { tokens: _tokens, hostToken: _host, rngState: _rng, plan, events, idempotency: _idem, ...rest } = game;
  return structuredClone({
    ...rest, events: events.slice(-120), adjudication: buildAdjudicationSnapshot(game),
    plan: { queues: {}, committed: [...(plan?.committed ?? [])], myQueue: plan?.queues[owner] ?? [] },
  });
}

function enqueue(game: GameState, owner: PlayerId, action: Action) {
  const p = action.payload ?? {};
  switch (action.type) {
    case 'attack': return queueAttackAction(game, owner, p.attackerId, p.q, p.r);
    case 'heal': return queueHealAction(game, owner, p.supportId, p.q, p.r);
    case 'move': return queueMoveAction(game, owner, p.unitId, p.q, p.r);
    case 'deploy': return queueDeployAction(game, owner, p.unitType, p.fromId, p.q, p.r);
    case 'demolish': return queueDemolishAction(game, owner, p.unitId, p.q, p.r);
    case 'wait': return queueWaitAction(game, owner);
    default: return { ok: false as const, code: 'unknown_action', message: String(action.type) };
  }
}

const cellKey = (p: Position) => `${p.q},${p.r}`;
const center = { q: 0, r: 0 };

/** 仅地形 BFS，与计划期语义一致；占位在候选终点过滤，不把暂时占位视为墙。 */
function distances(plain: Map<string, Position>, starts: Position[], limit = Infinity) {
  const result = new Map<string, number>();
  const queue: Position[] = [];
  for (const p of starts) if (!result.has(cellKey(p))) { result.set(cellKey(p), 0); queue.push(p); }
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i]!;
    const d = result.get(cellKey(p))!;
    if (d >= limit) continue;
    for (const next of utils.neighbors(p) as Position[]) {
      const key = cellKey(next);
      if (!plain.has(key) || result.has(key)) continue;
      result.set(key, d + 1);
      queue.push(next);
    }
  }
  return result;
}

/** 独立、非注册的压力对手；只接受与 apex 完全相同的公开快照，不调用 apex。 */
export const sentinel: Decider = {
  name: 'sentinel',
  decide(game, _utils, { owner }) {
    const queue = game.plan.myQueue;
    const budget = game.config.balance.actionsPerTurn;
    if (queue.length >= budget || game.plan.committed.includes(owner)) return null;
    const own = game.units.filter(u => u.alive && u.owner === owner).map(u => ({ ...u }));
    const enemies = game.units.filter(u => u.alive && u.owner !== owner && game.players[u.owner]?.status === 'active').map(u => ({ ...u }));
    const origins = utils.deployOrigins(game, owner) as (Position & { id: string })[];
    const reserved = new Set<string>();
    const visited = new Map(own.map(u => [u.id, new Set([cellKey(u)])]));
    let supplies = game.resources[owner]?.supplies ?? 0;
    const counts = new Map<string, number>();
    for (const u of own) counts.set(u.type, (counts.get(u.type) ?? 0) + 1);
    const aim = (u: Unit, p: Position, heal = false) => coveredCellsFor(
      u, game.config.units[u.type], heal ? 'healShape' : 'attackShape', p,
      heal ? game.config.units[u.type].healRange ?? u.attackRange : u.attackRange,
    )?.cells ?? [];
    const damage = (u: Unit, e: Unit) => Math.max(game.config.balance.minimumDamage, u.attack - e.defense);
    // 重放自己的前缀：站位、补给、伤害与治疗上界；不猜测任何敌方计划。
    for (const a of queue) {
      const u = own.find(u => u.id === (a.unitId ?? a.attackerId ?? a.supportId));
      if (a.type === 'deploy') {
        reserved.add(cellKey(a as Position));
        const origin = origins.find(o => o.id === a.fromId);
        supplies -= origin ? utils.effectiveDeployCost(game, a.unitType, origin) : game.config.units[a.unitType!].cost;
        counts.set(a.unitType!, (counts.get(a.unitType!) ?? 0) + 1);
      } else if (u && a.type === 'move') {
        u.q = a.q!; u.r = a.r!;
        visited.get(u.id)!.add(cellKey(u));
      } else if (u && (a.type === 'heal' || a.type === 'attack')) {
        const cells = new Set(aim(u, a as Position, a.type === 'heal').map(cellKey));
        for (const target of a.type === 'heal' ? own : enemies) {
          if (!cells.has(cellKey(target))) continue;
          if (a.type === 'heal') target.hp = Math.min(target.maxHp, target.hp + (u.healPower ?? 0) + game.config.balance.healVarianceRange);
          else target.hp = Math.max(0, target.hp - damage(u, target));
        }
      }
    }
    const occupied = new Set([...own, ...enemies, ...Object.values(game.headquarters).filter(h => h.alive)].map(cellKey));
    const empty = (p: Position) => !occupied.has(cellKey(p)) && !reserved.has(cellKey(p));
    const cleared = new Set(queue.filter(a => a.type === 'demolish').map(a => cellKey(a as Position)));
    const terrain = (p: Position) => cleared.has(cellKey(p)) ? 'plain' : utils.terrainAt(game, p);
    const plain = new Map<string, Position>(game.cells.filter(p => terrain(p) === 'plain').map(p => [cellKey(p), p]));
    const danger = new Set((game.artillery?.dangerCells ?? []).map(cellKey));
    const warning = new Set((game.artillery?.warningCells ?? []).map(cellKey));
    const radius = (game.artillery?.safeRadius ?? game.map.radius) - (warning.size ? 1 : 0);
    const safe = [...plain.values()].filter(p => utils.hexDistance(p, center) <= radius);
    const safeDistance = distances(plain, safe.filter(empty));
    const innerRadius = game.config.annihilation!.artillery.minimumSafeRadius;
    const inner = [...plain.values()].filter(p => utils.hexDistance(p, center) <= innerRadius);
    const centerDistance = distances(plain, inner);
    // 雪花的出生区与花心被障碍隔断；后备 BFS 仅指引重装开路，绝不让 move 穿障碍。
    const breakable = new Map<string, Position>(game.cells.filter(p => terrain(p) !== 'water').map(p => [cellKey(p), p]));
    const breachDistance = distances(breakable, inner);
    let best: { action: Action; priority: number; score: number } | null = null;
    const offer = (action: Action, priority: number, score: number) => {
      // 同一目标的重复治疗、重复部署等不再消费行动点；移动另有访问历史防往返。
      if (queue.some(a => a.type === action.type && Object.entries(action.payload ?? {}).every(([k, v]) => (a as any)[k] === v))) return;
      if (!best || priority > best.priority || (priority === best.priority && score > best.score)) best = { action, priority, score };
    };
    for (const u of own) {
      const attacks = queue.filter(a => a.type === 'attack' && a.attackerId === u.id).length;
      if (attacks < (game.config.balance.attacksPerUnit ?? 1)) {
        for (const e of enemies.filter(e => e.hp > 0)) {
          const cells = new Set(aim(u, e).map(cellKey));
          if (!cells.size) continue;
          const score = enemies.filter(e => e.hp > 0 && cells.has(cellKey(e))).reduce((n, e) =>
            n + Math.min(e.hp, damage(u, e)) + (damage(u, e) >= e.hp ? e.cost : 0), 0);
          if (score > 0) offer({ type: 'attack', payload: { attackerId: u.id, q: e.q, r: e.r } }, 4, score);
        }
      }
      if (u.type === 'support' && !danger.has(cellKey(u))) {
        for (const target of own.filter(t => t.hp < t.maxHp)) {
          const cells = aim(u, target, true);
          if (!cells.length || cells.some(p => danger.has(cellKey(p)))) continue;
          const keys = new Set(cells.map(cellKey));
          const score = own.filter(t => keys.has(cellKey(t))).reduce((n, t) => n + Math.min(t.maxHp - t.hp, u.healPower ?? 0), 0);
          if (score > 0) offer({ type: 'heal', payload: { supportId: u.id, q: target.q, r: target.r } }, 3, score);
        }
      }
      const urgent = danger.has(cellKey(u)) || warning.has(cellKey(u));
      // 安全时向可攻击位置推进；无敌军/无可用火力阵位则向内圈推进。
      const firingCells = safe.filter(p => (empty(p) || cellKey(p) === cellKey(u)) && enemies.some(e => e.hp > 0 && aim({ ...u, ...p }, e).length));
      const preferred = urgent ? safeDistance : distances(plain, firingCells);
      const goalDistance = preferred.has(cellKey(u)) ? preferred
        : centerDistance.has(cellKey(u)) ? centerDistance : breachDistance;
      const before = goalDistance.get(cellKey(u)) ?? Infinity;
      if (u.type === 'heavy' && goalDistance === breachDistance) {
        for (const p of utils.neighbors(u) as Position[]) {
          const after = breachDistance.get(cellKey(p)) ?? Infinity;
          if (terrain(p) !== 'blocker' || !breakable.has(cellKey(p)) || !empty(p) || after >= before) continue;
          offer({ type: 'demolish', payload: { unitId: u.id, q: p.q, r: p.r } }, urgent ? 5 : 1, (before - after) * 10 - after);
        }
      }
      for (const [key, steps] of distances(plain, [u], u.moveRange)) {
        const p = plain.get(key)!;
        if (!steps || !empty(p) || visited.get(u.id)!.has(key)) continue;
        if (!urgent && (danger.has(key) || warning.has(key))) continue;
        const after = goalDistance.get(key) ?? Infinity;
        if (after >= before) continue;
        const gain = Number.isFinite(before) ? before - after : 1;
        offer({ type: 'move', payload: { unitId: u.id, q: p.q, r: p.r } }, urgent ? 5 : 1,
          gain * 10 - after - steps * 0.01 + (urgent ? u.cost * (1 - u.hp / u.maxHp) : 0));
      }
    }
    // 兵种优先级完全由本图数值推导，并对已有/已排队的同类兵种递减；不硬编码兵种顺序。
    if ([...counts.values()].reduce((n, count) => n + count, 0) < budget) {
      for (const origin of origins) {
        if (danger.has(cellKey(origin))) continue;
        for (const type of Object.keys(game.config.units) as Unit['type'][]) {
          const spec = game.config.units[type];
          const cost = utils.effectiveDeployCost(game, type, origin);
          if (cost > supplies) continue;
          const power = spec.hp + spec.defense * 3 + spec.attack * (1 + spec.attackRange) * (spec.attackLock ? 1.3 : 1)
            + (spec.healPower ?? 0) * 3;
          const value = power * Math.sqrt(Math.max(1, spec.moveRange)) / Math.max(1, cost) / (1 + (counts.get(type) ?? 0) * 0.5);
          for (const p of utils.neighbors(origin) as Position[]) {
            if (!plain.has(cellKey(p)) || !empty(p) || danger.has(cellKey(p)) || warning.has(cellKey(p))) continue;
            const distance = centerDistance.get(cellKey(p)) ?? breachDistance.get(cellKey(p));
            if (distance === undefined) continue;
            offer({ type: 'deploy', payload: { unitType: type, fromId: origin.id, q: p.q, r: p.r } }, 2, value - distance * 0.05);
          }
        }
      }
    }
    return best ? (best as { action: Action }).action : null;
  },
};

type Histogram = Record<string, number>;
const increment = (h: Histogram, key: string) => { h[key] = (h[key] ?? 0) + 1; };
const latency = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p: number) => Math.round((sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? 0) * 1000) / 1000;
  return { calls: sorted.length, p50: percentile(0.5), p95: percentile(0.95), max: percentile(1) };
};
interface SeatStats {
  algorithm: string; role: 'apex' | 'opponent'; actionMs: number[]; queued: Histogram;
  illegal: number; resolutionStatuses: Histogram; fizzleCodes: Histogram;
}
class BenchmarkError extends Error {
  constructor(public detail: Record<string, unknown>) { super(JSON.stringify(detail)); }
}

// 导出便于用替身验证 harness/sentinel；CLI 始终加载真正的 apex，不提供伪装算法参数。
export async function playGame(args: Options, mapId: string, index: number, apex: Decider, opponent: Decider) {
  const seed = (args.seed + Math.floor(index / args.players) * 7919) >>> 0;
  const config = mapId === 'random' ? generateRandomMapConfig({ seed, mode: 'royale', noTurnLimit: true }, args.players) : getMapConfig(mapId);
  if (config.mode !== 'royale' || !config.supportedPlayerCounts.includes(args.players)) throw new Error(`不支持 ${mapId}/${args.players} 人`);
  const game = createLobbyWithConfig(`apex-${mapId}-${args.players}-${index}-${seed}`, mapId, config, { maxPlayers: args.players, participate: true, playerName: 'P0' });
  for (let i = 1; i < args.players; i++) if (!addLobbyPlayer(game, `P${i}`)) throw new Error(`加入 P${i} 失败`);
  const bus = new EventBus(); // 无持久化/服务器订阅者。
  const started = startGame(game, bus, mulberry32(seed));
  if (!started.ok) throw new Error(`开局失败: ${started.code}`);
  const seats = Object.keys(game.players) as PlayerId[];
  const apexSeat = seats[index % seats.length]!;
  const ids = identities();
  const stats = Object.fromEntries(seats.map(seat => [seat, {
    algorithm: seat === apexSeat ? apex.name : opponent.name, role: seat === apexSeat ? 'apex' : 'opponent',
    actionMs: [], queued: {}, illegal: 0, resolutionStatuses: {}, fizzleCodes: {},
  } as SeatStats])) as Record<PlayerId, SeatStats>;
  // 每席位独立决策随机流，与开局/战斗 RNG 隔离；某算法多采样不会扰动对手。
  const random = Object.fromEntries(seats.map((seat, i) => [seat, mulberry32((seed ^ Math.imul(i + 1, 0x9e3779b9)) >>> 0)]));
  let unitNumber = 0;
  for (const unit of game.units) ids.register(unit.id, `unit-${unitNumber++}`);
  // 淘汰会从 units 删除整支部队；按部署事件编号也能覆盖同轮部署后阵亡的单位。
  bus.subscribe(game.id, event => {
    if (event.type === 'deploy' && typeof event.payload.unitId === 'string') {
      ids.register(event.payload.unitId, `unit-${unitNumber++}`);
    }
  });
  const army = () => ids.public(Object.fromEntries(seats.map(seat => {
    const units = game.units.filter(u => u.alive && u.owner === seat);
    return [seat, { status: game.players[seat]!.status, supplies: game.resources[seat]?.supplies ?? 0,
      count: units.length, hp: units.reduce((n, u) => n + u.hp, 0),
      value: units.reduce((n, u) => n + u.cost * u.hp / u.maxHp, 0),
      units: units.map(({ id, type, q, r, hp }) => ({ id, type, q, r, hp })),
    }];
  })));
  let rounds = 0;
  while (game.phase === 'active' && rounds < args.maxRounds) {
    const round = game.turn.roundNumber;
    const before = args.trace ? army() : undefined;
    const order = [...game.turn.turnOrder].filter(seat => game.players[seat]?.status === 'active');
    for (const seat of order) {
      if (game.plan!.committed.includes(seat)) continue;
      const decider = seat === apexSeat ? apex : opponent;
      const st = stats[seat];
      // 满队列后仍问一次 null；若算法继续排队，由引擎拒绝并立即报错，绝不静默截断。
      for (let step = 0; step <= game.config.balance.actionsPerTurn; step++) {
        const snapshot = ids.public(view(game, seat));
        const previousRandom = Math.random;
        let action: Action | null;
        const t0 = performance.now();
        try {
          Math.random = random[seat]!;
          action = await decider.decide(snapshot, utils, { owner: seat });
        } finally {
          Math.random = previousRandom;
          st.actionMs.push(performance.now() - t0);
        }
        if (action == null) break;
        const result = enqueue(game, seat, ids.actual(action));
        if (!result.ok) {
          st.illegal++;
          throw new BenchmarkError({ map: mapId, index, seed, apexSeat, round, seat, role: st.role,
            algorithm: decider.name, illegal: 1, action, code: result.code, message: result.message });
        }
        increment(st.queued, action.type);
        ids.register(result.data!.id, `action-${round}-${seat}-${step}`);
      }
    }
    const actions = args.trace ? ids.public(game.plan!.queues) : undefined;
    const eventMark = game.events.length;
    let resolved = false;
    for (const seat of order) {
      if (game.phase !== 'active') break;
      if (game.players[seat]?.status !== 'active' || game.plan!.committed.includes(seat)) continue;
      const result = commitAndMaybeResolve(game, bus, seat);
      if (!result.ok) throw new BenchmarkError({ map: mapId, index, seed, round, seat, code: result.code, message: result.message });
      if (result.data?.resolved) { resolved = true; break; }
    }
    if (!resolved) throw new Error(`${game.id} r${round}: 全员提交后未结算`);
    rounds++;
    const results = game.events.slice(eventMark).filter(e => e.type === 'round_resolved')
      .flatMap(e => Object.values(e.payload.results as Record<string, PlanOutcome[]>).flat());
    for (const outcome of results) {
      const st = stats[outcome.owner];
      increment(st.resolutionStatuses, outcome.status);
      if (outcome.status !== 'executed') increment(st.fizzleCodes, outcome.reason ?? outcome.status);
    }
    if (args.trace) process.stderr.write(JSON.stringify({ map: mapId, index, seed, apexSeat, round, before,
      actions, results: ids.public(results), after: army(), safeRadius: game.artillery?.safeRadius }) + '\n');
  }
  const finished = game.phase === 'game_over';
  const outcome: 'W' | 'L' | 'draw' | 'unresolved' = !finished ? 'unresolved'
    : game.winner === null ? 'draw' : game.winner === apexSeat ? 'W' : 'L';
  return {
    map: mapId, index, seed, apexSeat, outcome, phase: game.phase, winner: finished ? game.winner : null,
    reason: finished ? game.result?.reason : 'max_rounds', rounds, roundNumber: game.turn.roundNumber,
    spawnSlots: Object.fromEntries(seats.map(seat => [seat, game.players[seat]!.spawnSlotId])),
    seats: stats,
  };
}

type Match = Awaited<ReturnType<typeof playGame>>;
function summary(matches: Match[], failure?: Record<string, unknown>) {
  const outcomes = { W: 0, L: 0, draw: 0, unresolved: 0 };
  for (const m of matches) outcomes[m.outcome]++;
  const byRole = Object.fromEntries((['apex', 'opponent'] as const).map(role => {
    const rows = matches.flatMap(m => Object.values(m.seats)).filter(s => s.role === role);
    const fizzleCodes: Histogram = {};
    for (const row of rows) for (const [code, count] of Object.entries(row.fizzleCodes)) fizzleCodes[code] = (fizzleCodes[code] ?? 0) + count;
    return [role, { actionLatencyMs: latency(rows.flatMap(s => s.actionMs)),
      illegal: rows.reduce((n, s) => n + s.illegal, 0) + (failure?.role === role ? Number(failure.illegal ?? 0) : 0), fizzleCodes }];
  }));
  const rounds = matches.map(m => m.rounds);
  return { games: matches.length, ...outcomes,
    rounds: { total: rounds.reduce((n, r) => n + r, 0), mean: rounds.length ? rounds.reduce((n, r) => n + r, 0) / rounds.length : 0,
      min: rounds.length ? Math.min(...rounds) : 0, max: rounds.length ? Math.max(...rounds) : 0 }, ...byRole };
}

async function main() {
  const matches: Match[] = [];
  const evaluatedAt = new Date().toISOString();
  let options: Options | undefined;
  let failure: Record<string, unknown> | undefined;
  // 保留 stdout 的单一 JSON 契约，算法自身的 console 日志也转向 stderr。
  const log = console.log;
  const info = console.info;
  const debug = console.debug;
  console.log = console.info = console.debug = (...args: unknown[]) => console.error(...args);
  try {
    if (process.argv.slice(2).includes('--help')) {
      process.stdout.write(JSON.stringify({ usage: 'node --import tsx scripts/apex-arena.mts [--maps snowflake,narrow-road|random] [--games 4] [--players 2|3|6] [--opponent random-royale|self|sentinel] [--seed 20261028] [--max-rounds 80] [--trace]',
        notes: ['maps 接受已注册的 royale 地图 ID；random 按种子生成新图，人数须与地图匹配', 'games 为每图局数；每 players 局共用地图与开局种子并轮换 apex 席位', 'W/L 为轮换的 apex 席位视角（self 亦然）', 'trace 写 stderr；延迟包含返回 null 的 decide 调用，不含构造视图', 'fizzleCodes 汇总 failed/fizzled/missed；无 reason 的落空记为 missed'] }) + '\n');
      return;
    }
    options = parseArgs(process.argv.slice(2));
    loadMaps();
    const apex = (await import(new URL('../algorithms/builtin/apex.mjs', import.meta.url).href)).default as Decider;
    if (apex?.name !== 'apex' || typeof apex.decide !== 'function') throw new Error('apex 模块须 default 导出 { name: "apex", decide }');
    const opponent = options.opponent === 'self' ? apex : options.opponent === 'sentinel' ? sentinel : randomRoyale;
    for (const map of options.maps) for (let i = 0; i < options.games; i++) matches.push(await playGame(options, map, i, apex, opponent));
  } catch (error) {
    failure = error instanceof BenchmarkError ? error.detail : { message: error instanceof Error ? error.message : String(error) };
    process.exitCode = 1;
  } finally {
    console.log = log; console.info = info; console.debug = debug;
  }
  const engineVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  const budgetEnvironment = Object.fromEntries(['APEX_TIME_MS', 'APEX_BEAM', 'APEX_NODES'].map(key => [key, process.env[key] ?? null]));
  process.stdout.write(JSON.stringify({ engineVersion, evaluatedAt, nodeVersion: process.version, budgetEnvironment, options, summary: summary(matches, failure),
    byMap: Object.fromEntries((options?.maps ?? []).map(map => [map, summary(matches.filter(m => m.map === map), failure?.map === map ? failure : undefined)])),
    games: matches.map(m => ({ ...m, seats: Object.fromEntries(Object.entries(m.seats).map(([seat, { actionMs, ...st }]) =>
      [seat, { ...st, actionLatencyMs: latency(actionMs) }])) })), ...(failure ? { error: failure } : {}) }, null, 2) + '\n');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
