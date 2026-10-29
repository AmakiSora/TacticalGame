// scripts/horizon-arena.mts
//
// 同时回合真实引擎 headless 对战 harness（horizon 标定用，可独立复现）。
//
// 与 rl/evaluation/evaluate_cross.py 的口径差异：
// - 直接驱动 src/engine/（startGame 按种子洗牌出生位与 turnOrder、播种掷骰 RNG），
//   evaluate_cross 的 createInitialGame 固定座位与固定 RNG，确定性算法互打时每个座位
//   只有一局独立样本；本 harness 每局一个种子，样本真正独立。
// - 算法看到的是与 REST `GET /api/games/:id` 同口径的快照（剥 token/rngState，带完整
//   events、config、adjudication，计划只暴露 myQueue）。
// - 回合循环复刻 algorithms/lib/interfaces.mjs 的 runAlgorithm：被拒动作记非法、
//   记住指纹后继续 decide（上限 20），null 即提交。
//
// 用法：
//   npx tsx scripts/horizon-arena.mts --a horizon --b kriegspiel --map standoff --games 30
//   npx tsx scripts/horizon-arena.mts --a horizon --b dest-prob --map standoff --players 3 --games 6
//   npx tsx scripts/horizon-arena.mts --a-file temp/dev.mjs --b matrix-eq --map molten-throne --games 10 --start 10
//
// 参数：
//   --a / --b         注册表算法名；--a-file / --b-file 直接加载 .mjs 文件（开发版本）
//   --map ID          同时回合地图 id（默认 standoff）
//   --players N       席位数（默认 2；3/6 人时 A 坐一席，其余席位全部是 B）
//   --games N         局数（默认 10）；--start K 从第 K 局开始（并行分片用，种子按全局局号算）
//   --seed-base S     种子基（默认 1000；第 i 局种子 = S + floor(i/2)×7919，成对换座共用种子）
//   --max-rounds N    回合上限兜底（默认 60）
//   --out FILE        每局一行 JSONL 追加写入
//   --quiet           不打印逐局行
//   --trace           逐轮打印双方计划、失败、据点与总部
//   --dump-round N --dump-file F   把 A 方第 N 轮计划前的快照写到 F（调试用）
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadMaps } from '../src/config/loader.js';
import { addLobbyPlayer, createLobby } from '../src/state/store.js';
import { buildAdjudicationScores, buildAdjudicationSnapshot, startGame } from '../src/engine/engine.js';
import { commitAndMaybeResolve } from '../src/engine/simultaneous.js';
import {
  queueAttackAction, queueDemolishAction, queueDeployAction, queueHealAction, queueMoveAction, queueWaitAction,
} from '../src/engine/planning.js';
import { globalEventBus } from '../src/events/bus.js';
import type { GameState, PlayerId } from '../src/types.js';
// @ts-expect-error 注册表为 ESM .mjs，无类型声明
import { loadAlgorithm, ALGORITHM_META } from '../algorithms/registry.mjs';
// @ts-expect-error 工具库为 ESM .mjs，无类型声明
import * as utils from '../algorithms/lib/game-utils.mjs';

loadMaps();

interface Args {
  a: string; b: string; aFile?: string; bFile?: string;
  map: string; players: number; games: number; start: number;
  seedBase: number; maxRounds: number; out?: string; quiet: boolean; trace: boolean;
  dumpRound?: number; dumpFile?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { a: 'horizon', b: 'kriegspiel', map: 'standoff', players: 2, games: 10, start: 0, seedBase: 1000, maxRounds: 60, quiet: false, trace: false };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const val = () => argv[++i]!;
    if (key === '--a') args.a = val();
    else if (key === '--b') args.b = val();
    else if (key === '--a-file') args.aFile = val();
    else if (key === '--b-file') args.bFile = val();
    else if (key === '--map') args.map = val();
    else if (key === '--players') args.players = Number(val());
    else if (key === '--games') args.games = Number(val());
    else if (key === '--start') args.start = Number(val());
    else if (key === '--seed-base') args.seedBase = Number(val());
    else if (key === '--max-rounds') args.maxRounds = Number(val());
    else if (key === '--out') args.out = val();
    else if (key === '--quiet') args.quiet = true;
    else if (key === '--trace') args.trace = true;
    else if (key === '--dump-round') args.dumpRound = Number(val());
    else if (key === '--dump-file') args.dumpFile = val();
    else throw new Error(`未知参数: ${key}`);
  }
  return args;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Decider = { name: string; decide: (game: unknown, u: unknown, ctx: { owner: string }) => Promise<unknown> };

/** 地图 JSON 的 mode 字段（缺省 standard）——算法注册模式必须覆盖它。 */
function mapModeOf(mapId: string): string {
  const config = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'maps', `${mapId}.json`), 'utf8'));
  return typeof config?.mode === 'string' && config.mode ? config.mode : 'standard';
}

async function loadDecider(name: string, file?: string, mode = 'simultaneous'): Promise<Decider> {
  if (file) {
    const mod = await import(pathToFileURL(resolve(file)).href);
    return { name: `${name}`, decide: mod.default.decide.bind(mod.default) };
  }
  const modes = ALGORITHM_META[name]?.modes ?? ['standard'];
  if (!modes.includes(mode)) throw new Error(`${name} 未注册 ${mode} 模式`);
  const mod = await loadAlgorithm(name);
  return { name, decide: mod.decide.bind(mod) };
}

/** 与 src/api/auth.ts sanitizeGameForResponse 同口径的玩家视角快照。 */
function restView(game: GameState, viewer: PlayerId): unknown {
  const { tokens: _t, hostToken: _h, rngState: _r, idempotency: _i, events, config, ...rest } = game as GameState & Record<string, unknown>;
  const body = structuredClone(rest) as Record<string, unknown>;
  body.lastEventSeq = events.at(-1)?.seq ?? 0;
  body.events = structuredClone(events);
  body.config = structuredClone(config);
  body.adjudication = buildAdjudicationSnapshot(game);
  const myQueue = game.plan?.queues[viewer] ?? [];
  body.plan = {
    ...(game.plan ?? { committed: [] }),
    queues: myQueue.length ? { [viewer]: structuredClone(myQueue) } : {},
    myQueue: structuredClone(myQueue),
  };
  return body;
}

function enqueue(game: GameState, owner: PlayerId, action: { type: string; payload?: Record<string, unknown> }) {
  const p = (action.payload ?? {}) as Record<string, any>;
  switch (action.type) {
    case 'attack': return queueAttackAction(game, owner, p.attackerId, p.q, p.r);
    case 'heal': return queueHealAction(game, owner, p.supportId, p.q, p.r);
    case 'move': return queueMoveAction(game, owner, p.unitId, p.q, p.r);
    case 'deploy': return queueDeployAction(game, owner, p.unitType, p.fromId, p.q, p.r);
    case 'demolish': return queueDemolishAction(game, owner, p.unitId, p.q, p.r);
    case 'wait': return queueWaitAction(game, owner);
    default: return { ok: false as const, code: 'unknown_action', message: action.type };
  }
}

/** --trace：逐轮打印双方计划、失败、据点与总部。 */
function traceRound(game: GameState, seats: PlayerId[], aSeat: PlayerId, queues: Record<string, any[]>, eventMark: number) {
  const unitName = new Map(game.units.map(u => [u.id, `${u.type[0]}${u.id.slice(0, 3)}`]));
  const fmt = (a: any) => {
    const who = unitName.get(a.unitId ?? a.attackerId ?? a.supportId) ?? '';
    if (a.type === 'deploy') return `D:${a.unitType}@${a.q},${a.r}`;
    if (a.type === 'wait') return 'W';
    return `${a.type[0].toUpperCase()}:${who}>${a.q},${a.r}`;
  };
  const events = game.events.slice(eventMark);
  const round = (events.find(e => e.type === 'round_resolved')?.payload as any)?.roundNumber ?? '?';
  console.log(`--- round ${round}`);
  for (const seat of seats) {
    const fails = events.filter(e => e.type === 'action_failed' && (e.payload as any).owner === seat).map(e => (e.payload as any).reason);
    const hits = events.filter(e => e.type === 'attack' && (e.payload as any).owner === seat);
    const dmg = hits.reduce((s, e) => s + ((e.payload as any).actualDamage ?? 0), 0);
    const cps = game.controlPoints.filter(p => p.owner === seat).length;
    const hq = game.headquarters[seat];
    const units = game.units.filter(u => u.alive && u.owner === seat).map(u => `${u.type[0]}${u.q},${u.r}:${u.hp}`).join(' ');
    console.log(`  ${seat === aSeat ? 'A' : 'B'}(${seat}) hq=${hq?.hp} cp=${cps} sup=${game.resources[seat]?.supplies} dmg=${dmg} plan=[${queues[seat]!.map(fmt).join(' ')}] fail=${fails.join(',')}`);
    console.log(`      units ${units}`);
  }
}

interface SeatStats {
  algo: string; decideCalls: number; decideMs: number[]; roundMs: number[];
  illegal: string[]; queued: Record<string, number>; failed: Record<string, number>;
}

async function playGame(args: Args, deciders: { A: Decider; B: Decider }, index: number) {
  const seed = args.seedBase + Math.floor(index / 2) * 7919;
  const swap = index % 2 === 1;
  const game = createLobby(`arena-${args.map}-${args.players}p-${index}-${seed}`, args.map, {
    maxPlayers: args.players, participate: true, playerName: 'P0',
  });
  for (let i = 1; i < args.players; i++) addLobbyPlayer(game, `P${i}`);
  const started = startGame(game, globalEventBus, mulberry32(seed));
  if (!started.ok) throw new Error(`开局失败: ${started.code}`);
  const seats = Object.keys(game.players) as PlayerId[];
  // 2 人：偶数局 A 坐 player_a，奇数局换座；多人：A 的席位按局号轮转，其余全是 B。
  const aSeat = args.players === 2 ? (swap ? seats[1]! : seats[0]!) : seats[index % seats.length]!;
  const algoOf = (seat: PlayerId) => (seat === aSeat ? deciders.A : deciders.B);
  const stats: Record<string, SeatStats> = {};
  for (const seat of seats) {
    stats[seat] = { algo: algoOf(seat).name, decideCalls: 0, decideMs: [], roundMs: [], illegal: [], queued: {}, failed: {} };
  }

  let guard = 0;
  while (game.phase === 'active' && guard++ < args.maxRounds) {
    for (const seat of game.turn.turnOrder) {
      if (game.phase !== 'active') break;
      if (game.players[seat]?.status !== 'active') continue;
      if ((game.plan?.committed ?? []).includes(seat)) continue;
      const algo = algoOf(seat);
      const st = stats[seat]!;
      if (args.dumpFile && seat === aSeat && game.turn.roundNumber === args.dumpRound) {
        writeFileSync(args.dumpFile, JSON.stringify({ owner: seat, view: restView(game, seat) }));
      }
      const rejected = new Set<string>();
      let rejectedCount = 0;
      let count = 0;
      let roundMs = 0;
      while (count < 100 && rejectedCount < 20) {
        const snapshot = restView(game, seat);
        const t0 = performance.now();
        const action = await algo.decide(snapshot, utils, { owner: seat }) as { type: string; payload?: Record<string, unknown> } | null;
        const dt = performance.now() - t0;
        st.decideCalls++;
        st.decideMs.push(dt);
        roundMs += dt;
        if (!action) break;
        const key = JSON.stringify({ type: action.type, payload: action.payload ?? {} });
        if (rejected.has(key)) { rejectedCount++; continue; }
        const result = enqueue(game, seat, action);
        if (!result.ok) {
          st.illegal.push(`r${game.turn.roundNumber}:${action.type}:${(result as { code: string }).code}`);
          rejected.add(key);
          rejectedCount++;
          continue;
        }
        st.queued[action.type] = (st.queued[action.type] ?? 0) + 1;
        count++;
      }
      st.roundMs.push(roundMs);
    }
    if (game.phase !== 'active') break;
    const traceQueues = args.trace ? Object.fromEntries(seats.map(seat => [seat, [...(game.plan?.queues?.[seat] ?? [])]])) : null;
    const eventMark = game.events.length;
    for (const seat of game.turn.turnOrder) {
      if (game.players[seat]?.status !== 'active') continue;
      if ((game.plan?.committed ?? []).includes(seat)) continue;
      commitAndMaybeResolve(game, globalEventBus, seat);
      if (game.phase !== 'active') break;
    }
    if (traceQueues) traceRound(game, seats, aSeat, traceQueues, eventMark);
  }

  for (const event of game.events) {
    if (event.type !== 'action_failed') continue;
    const payload = event.payload as { owner?: string; reason?: string };
    const st = payload.owner ? stats[payload.owner] : undefined;
    if (st && payload.reason) st.failed[payload.reason] = (st.failed[payload.reason] ?? 0) + 1;
  }

  const scores = buildAdjudicationScores(game);
  const winnerSeat = game.winner ?? null;
  const winnerAlgo = winnerSeat ? (winnerSeat === aSeat ? 'A' : 'B') : 'draw';
  const result = (game as unknown as { result?: { reason?: string } }).result;
  return {
    index, seed, map: args.map, players: args.players, aSeat, winnerSeat, winner: winnerAlgo,
    reason: result?.reason ?? (game.phase === 'game_over' ? 'unknown' : 'round_guard'),
    rounds: game.turn.roundNumber,
    scores: Object.fromEntries(seats.map(seat => [seat, Math.round((scores[seat]?.total ?? 0) * 10) / 10])),
    detail: Object.fromEntries(seats.map(seat => [seat, scores[seat]])),
    status: Object.fromEntries(seats.map(seat => [seat, game.players[seat]!.status])),
    seats: Object.fromEntries(seats.map(seat => {
      const st = stats[seat]!;
      const sorted = [...st.decideMs].sort((x, y) => x - y);
      const rsorted = [...st.roundMs].sort((x, y) => x - y);
      return [seat, {
        algo: st.algo, side: seat === aSeat ? 'A' : 'B',
        illegal: st.illegal, queued: st.queued, failed: st.failed,
        decideCalls: st.decideCalls,
        decideMeanMs: Math.round((sorted.reduce((s, x) => s + x, 0) / Math.max(1, sorted.length)) * 10) / 10,
        decideMaxMs: Math.round((sorted.at(-1) ?? 0) * 10) / 10,
        roundP50Ms: Math.round((rsorted[Math.floor(rsorted.length / 2)] ?? 0) * 10) / 10,
        roundMaxMs: Math.round((rsorted.at(-1) ?? 0) * 10) / 10,
        roundMs: st.roundMs.map(x => Math.round(x * 10) / 10),
      }];
    })),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mapMode = mapModeOf(args.map);
  const deciders = {
    A: await loadDecider(args.aFile ? `${args.a}(file)` : args.a, args.aFile, mapMode),
    B: await loadDecider(args.bFile ? `${args.b}(file)` : args.b, args.bFile, mapMode),
  };
  let aWins = 0; let bWins = 0; let draws = 0; let illegalA = 0; let illegalB = 0;
  for (let i = args.start; i < args.start + args.games; i++) {
    const t0 = performance.now();
    const record = await playGame(args, deciders, i);
    const sec = Math.round((performance.now() - t0) / 100) / 10;
    if (record.winner === 'A') aWins++; else if (record.winner === 'B') bWins++; else draws++;
    for (const seat of Object.values(record.seats)) {
      if (seat.side === 'A') illegalA += seat.illegal.length; else illegalB += seat.illegal.length;
    }
    if (args.out) appendFileSync(args.out, `${JSON.stringify({ ...record, a: deciders.A.name, b: deciders.B.name, sec })}\n`);
    if (!args.quiet) {
      const a = Object.values(record.seats).find(s => s.side === 'A')!;
      const b = Object.values(record.seats).find(s => s.side === 'B')!;
      const sa = record.scores[record.aSeat];
      const sb = Math.max(...Object.entries(record.scores).filter(([s]) => s !== record.aSeat).map(([, v]) => v as number));
      console.log(`#${i} seed=${record.seed} A@${record.aSeat} winner=${record.winner} ${record.reason} r${record.rounds} score A=${sa} B=${sb} ` +
        `fail A=${JSON.stringify(a.failed)} B=${JSON.stringify(b.failed)} illegal ${a.illegal.length}/${b.illegal.length} ` +
        `roundMs A=${a.roundP50Ms}/${a.roundMaxMs} B=${b.roundP50Ms}/${b.roundMaxMs} ${sec}s`);
    }
  }
  console.log(`SUMMARY ${deciders.A.name} vs ${deciders.B.name} map=${args.map} players=${args.players} games=${args.games}: ` +
    `A ${aWins} / B ${bWins} / draw ${draws}; illegal A=${illegalA} B=${illegalB}`);
}

main().catch(error => { console.error(error); process.exit(1); });
