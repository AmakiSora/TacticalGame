// tests/algorithms/horizon.test.ts
// horizon（视界算法）单元测试：
// - 接口契约与前置短路（座位只从 ctx.owner 取、已提交/队列满/非同时模式返回 null）；
// - 每轮缓存与 myQueue 对账、被引擎拒绝后改选、同快照确定性；
// - 形状镜像与 planning.ts coveredCellsFor 逐格一致，计划期合法性镜像与引擎入队校验一致；
// - 分步结算镜像与真实 resolveRoundSteps 逐点对拍（伤害/治疗方差归零）；
// - 3.8 分步语义：同单位跨行动点多动作、wait 对齐、attacksPerUnit、失败连锁；
// - 通用性自查：源码不读地图 id/名称、不 import 任何其他算法。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadMaps } from '../../src/config/loader.js';
import { addLobbyPlayer, createLobby } from '../../src/state/store.js';
import { buildAdjudicationSnapshot, captureControlPoints, startGame } from '../../src/engine/engine.js';
import { commitAndMaybeResolve } from '../../src/engine/simultaneous.js';
import { resolveRoundSteps } from '../../src/engine/simultaneousResolve.js';
import {
  coveredCellsFor, queueAttackAction, queueDemolishAction, queueDeployAction, queueHealAction,
  queueMoveAction, queueWaitAction,
} from '../../src/engine/planning.js';
import { globalEventBus } from '../../src/events/bus.js';
// @ts-expect-error 算法模块为 ESM .mjs，无类型声明
import horizon, { __internals as H } from '../../algorithms/builtin/horizon.mjs';
// @ts-expect-error 工具库为 ESM .mjs，无类型声明
import * as utils from '../../algorithms/lib/game-utils.mjs';

loadMaps();

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

function newGame(mapId: string, players: number, seed: number, id = `horizon-unit-${mapId}-${players}-${seed}`) {
  const game: any = createLobby(id, mapId, { maxPlayers: players, participate: true, playerName: 'P0' });
  for (let i = 1; i < players; i++) addLobbyPlayer(game, `P${i}`);
  expect(startGame(game, globalEventBus, mulberry32(seed)).ok).toBe(true);
  return game;
}

/** 与 REST 快照同口径的玩家视角（剥 rngState、只暴露己方队列）。 */
function view(game: any, owner: string) {
  const { rngState: _rng, tokens: _tokens, hostToken: _host, events: _events, ...rest } = game;
  return {
    ...structuredClone(rest),
    events: [],
    adjudication: buildAdjudicationSnapshot(game),
    plan: {
      queues: {},
      committed: [...(game.plan?.committed ?? [])],
      myQueue: [...(game.plan?.queues?.[owner] ?? [])],
    },
  };
}

function enqueue(game: any, owner: string, action: any) {
  const p = action.payload || {};
  switch (action.type) {
    case 'attack': return queueAttackAction(game, owner as never, p.attackerId, p.q, p.r);
    case 'heal': return queueHealAction(game, owner as never, p.supportId, p.q, p.r);
    case 'move': return queueMoveAction(game, owner as never, p.unitId, p.q, p.r);
    case 'deploy': return queueDeployAction(game, owner as never, p.unitType, p.fromId, p.q, p.r);
    case 'demolish': return queueDemolishAction(game, owner as never, p.unitId, p.q, p.r);
    case 'wait': return queueWaitAction(game, owner as never);
    default: return { ok: false as const, code: 'unknown_action' };
  }
}

function seatsOf(game: any): string[] {
  return game.turn.turnOrder.filter((id: string) => game.players[id]?.status === 'active');
}

/** 用 horizon 自己的规划把对局推进若干轮（制造多样局面）。 */
async function advance(game: any, rounds: number) {
  for (let r = 0; r < rounds && game.phase === 'active'; r++) {
    for (const seat of seatsOf(game)) {
      for (let i = 0; i < 12; i++) {
        const action = await horizon.decide(view(game, seat), utils, { owner: seat });
        if (!action) break;
        expect(enqueue(game, seat, action).ok).toBe(true);
      }
    }
    for (const seat of seatsOf(game)) if (game.phase === 'active') commitAndMaybeResolve(game, globalEventBus, seat);
  }
}

function modelFor(game: any, seat: string) {
  const M = H.buildModel(view(game, seat), seat);
  M.deadline = Number.POSITIVE_INFINITY;
  return M;
}

describe('horizon 接口契约', () => {
  it('只实现策略接口 decide，注册名为 horizon', () => {
    expect(horizon.name).toBe('horizon');
    expect(typeof horizon.description).toBe('string');
    expect(horizon.description.length).toBeGreaterThan(0);
    expect(typeof horizon.decide).toBe('function');
    expect((horizon as any).playTurn).toBeUndefined();
  });

  it('前置短路：无座位 / 已提交 / 队列满 / 非进行中 / 非同时模式都返回 null', async () => {
    const game = newGame('standoff', 2, 11);
    const seat = seatsOf(game)[0]!;
    expect(await horizon.decide(view(game, seat), utils, {})).toBeNull();
    expect(await horizon.decide(view(game, seat), utils, undefined)).toBeNull();
    const committed = view(game, seat);
    committed.plan.committed = [seat];
    expect(await horizon.decide(committed, utils, { owner: seat })).toBeNull();
    const full = view(game, seat);
    full.plan.myQueue = Array.from({ length: game.config.balance.actionsPerTurn }, (_, i) => ({ id: `w${i}`, type: 'wait' }));
    expect(await horizon.decide(full, utils, { owner: seat })).toBeNull();
    const over = view(game, seat);
    over.phase = 'game_over';
    expect(await horizon.decide(over, utils, { owner: seat })).toBeNull();
    for (const mode of ['standard', 'royale', 'annihilation']) {
      const other = view(game, seat);
      other.config = { ...other.config, mode };
      expect(await horizon.decide(other, utils, { owner: seat })).toBeNull();
    }
  });
});

describe('horizon 每轮缓存与对账', () => {
  it('每轮只规划一次，之后按缓存逐条吐出并与 myQueue 对账', async () => {
    const game = newGame('standoff', 2, 21, 'horizon-cache');
    const seat = seatsOf(game)[0]!;
    const key = `${game.id}|${seat}|${game.turn.roundNumber}`;
    const first = await horizon.decide(view(game, seat), utils, { owner: seat });
    expect(first).not.toBeNull();
    const entry = H.roundCache.get(key);
    expect(entry).toBeTruthy();
    const planRef = entry.plan;
    expect(enqueue(game, seat, first).ok).toBe(true);
    const second = await horizon.decide(view(game, seat), utils, { owner: seat });
    // 同一份缓存计划（没有重新规划），第二条就是计划里的第二步。
    expect(H.roundCache.get(key).plan).toBe(planRef);
    if (planRef.length > 1) {
      const M = modelFor(game, seat);
      expect(second).toEqual(H.toAction(M, planRef[1]));
    } else {
      expect(second).toBeNull();
    }
  });

  it('上次吐出的动作没有入队（被拒）时改选，不重复同一动作', async () => {
    const game = newGame('molten-throne', 2, 31, 'horizon-reject');
    const seat = seatsOf(game)[0]!;
    const snapshot = view(game, seat);
    const first = await horizon.decide(snapshot, utils, { owner: seat });
    expect(first).not.toBeNull();
    // 同一快照再问一次 = runner 视角下上次动作被拒、局面未变。
    const retry = await horizon.decide(view(game, seat), utils, { owner: seat });
    expect(retry).not.toEqual(first);
    if (retry) expect(enqueue(game, seat, retry).ok).toBe(true);
  });

  it('同一快照规划结果确定（不依赖 Math.random）', () => {
    const game = newGame('standoff', 2, 41, 'horizon-determinism');
    const seat = seatsOf(game)[1]!;
    const a = H.planRound(modelFor(game, seat), [], new Set());
    const b = H.planRound(modelFor(game, seat), [], new Set());
    expect(b).toEqual(a);
  });
});

describe('horizon 形状与计划期合法性镜像', () => {
  it.each(['standoff', 'molten-throne'] as const)('%s：coverCells 与 planning.ts coveredCellsFor 逐格一致', (mapId) => {
    const game = newGame(mapId, 2, 51);
    const M = modelFor(game, seatsOf(game)[0]!);
    const { CQ, CR, N } = M.board;
    const inBounds = new Set(game.cells.map((c: any) => `${c.q},${c.r}`));
    let compared = 0;
    for (const type of Object.keys(game.config.units)) {
      const spec = game.config.units[type];
      for (const kind of ['attackShape', 'healShape'] as const) {
        const range = kind === 'healShape' ? (spec.healRange ?? spec.attackRange) : spec.attackRange;
        for (let from = 0; from < N; from += 3) {
          for (let to = 0; to < N; to++) {
            const engine = coveredCellsFor({ q: CQ[from], r: CR[from] }, spec, kind, { q: CQ[to], r: CR[to] }, range);
            const mirror = H.coverCells(M, from, type, kind, to, range);
            const engineCells = engine
              ? engine.cells.filter((c: any) => inBounds.has(`${c.q},${c.r}`)).map((c: any) => `${c.q},${c.r}`).sort()
              : null;
            const mirrorCells = mirror ? mirror.map((c: number) => `${CQ[c]},${CR[c]}`).sort() : null;
            expect(mirrorCells).toEqual(engineCells);
            compared++;
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(1000);
  });

  it.each([['standoff', 2], ['molten-throne', 2], ['standoff', 3]] as const)(
    '%s %i 人：isLegalNext 与引擎入队校验逐条一致（含刻意非法动作）',
    async (mapId, players) => {
      const game = newGame(mapId, players, 61 + players);
      await advance(game, 3);
      if (game.phase !== 'active') return;
      let checked = 0;
      for (const seat of seatsOf(game)) {
        const M = modelFor(game, seat);
        const prefixAction = H.generateCandidates(M, M.me, [], { movesPerUnit: 3, presence: null }).find((a: any) => a.k === 'move');
        const prefix = prefixAction ? [prefixAction] : [];
        const probes: any[] = [...H.generateCandidates(M, M.me, prefix, { movesPerUnit: 50, presence: null })];
        const st = M.st0;
        for (const ui of M.unitsOfSeat[M.me]) {
          for (let c = 0; c < M.board.N; c += 7) {
            probes.push({ k: 'move', u: ui, c }, { k: 'attack', u: ui, c }, { k: 'heal', u: ui, c }, { k: 'demolish', u: ui, c });
          }
        }
        for (const type of Object.keys(game.config.units)) {
          for (const origin of [M.hqId[M.me], ...M.cps.map((p: any) => p.id)]) {
            for (let c = 0; c < M.board.N; c += 5) probes.push({ k: 'deploy', ut: type, from: origin, c, cost: game.config.units[type].cost });
          }
        }
        for (const a of probes) {
          if (a.k !== 'deploy' && (a.u === undefined || !st.units[a.u])) continue;
          const sandbox = structuredClone(game);
          sandbox.plan.queues[seat] = [];
          for (const p of prefix) expect(enqueue(sandbox, seat, H.toAction(M, p)).ok).toBe(true);
          const result = enqueue(sandbox, seat, H.toAction(M, a));
          expect(H.isLegalNext(M, M.me, prefix, a), `${seat} ${JSON.stringify(a)} -> ${(result as any).code}`).toBe(result.ok);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(200);
    },
    120000,
  );
});

describe('horizon 分步结算镜像对拍', () => {
  function snapshotEngine(game: any) {
    return {
      units: game.units.filter((u: any) => u.alive).map((u: any) => `${u.owner}:${u.type}:${u.q},${u.r}:${u.hp}`).sort(),
      hq: Object.values(game.headquarters).map((h: any) => `${h.owner}:${h.hp}:${h.alive}`).sort(),
      cps: game.controlPoints.map((p: any) => `${p.id}:${p.owner}`),
      sup: Object.entries(game.resources).map(([k, v]: any) => `${k}:${v.supplies}`).sort(),
      status: Object.entries(game.players).map(([k, v]: any) => `${k}:${v.status}`).sort(),
    };
  }

  function snapshotMirror(M: any, st: any) {
    const seats = M.seats;
    return {
      units: st.units.filter((u: any) => u.alive).map((u: any) => `${seats[u.seat]}:${u.type}:${M.board.CQ[u.cell]},${M.board.CR[u.cell]}:${u.hp}`).sort(),
      hq: seats.map((id: string, s: number) => `${id}:${st.hqHp[s]}:${Boolean(st.hqAlive[s])}`).sort(),
      cps: M.cps.map((p: any, i: number) => `${p.id}:${st.cpOwner[i] >= 0 ? seats[st.cpOwner[i]] : null}`),
      sup: seats.map((id: string, s: number) => `${id}:${st.sup[s]}`).sort(),
      status: seats.map((id: string, s: number) => `${id}:${st.active[s] ? 'active' : 'eliminated'}`).sort(),
    };
  }

  /** 随机合法计划：偏向攻击/治疗，并混入"撞车"移动以覆盖失败与级联分支。 */
  function randomPlan(game: any, seat: string, rng: () => number) {
    const M = modelFor(game, seat);
    const plan: any[] = [];
    const len = 1 + Math.floor(rng() * M.A);
    for (let k = 0; k < len; k++) {
      const candidates = H.generateCandidates(M, M.me, plan, { movesPerUnit: 40, presence: null });
      for (const ui of M.unitsOfSeat[M.me]) {
        for (let i = 0; i < M.st0.units.length; i++) {
          const a = { k: 'move', u: ui, c: M.st0.units[i].cell };
          if (i !== ui && H.isLegalNext(M, M.me, plan, a)) candidates.push(a);
        }
      }
      const strikes = candidates.filter((a: any) => a.k === 'attack' || a.k === 'heal' || a.k === 'demolish');
      const pool = strikes.length && rng() < 0.6 ? strikes : candidates;
      if (!pool.length) break;
      plan.push(pool[Math.floor(rng() * pool.length)]);
    }
    return { M, plan };
  }

  it.each([['standoff', 2, 6, 7], ['molten-throne', 2, 6, 7], ['standoff', 3, 5, 5], ['standoff', 6, 3, 3]] as const)(
    '%s %i 人：随机合法计划下与真实引擎零偏差',
    async (mapId, players, games, warmSpan) => {
      const reasons: Record<string, number> = {};
      let checked = 0;
      for (let g = 0; g < games; g++) {
        const seed = 7000 + g * 97 + players;
        const rng = mulberry32(seed);
        const game = newGame(mapId, players, seed, `horizon-fidelity-${mapId}-${players}-${g}`);
        game.config = structuredClone(game.config);
        game.config.balance.damageVarianceRange = 0;
        game.config.balance.healVarianceRange = 0;
        await advance(game, 2 + Math.floor(rng() * warmSpan));
        if (game.phase !== 'active') continue;
        const seats = seatsOf(game);
        const plans = seats.map(seat => {
          const { M, plan } = randomPlan(game, seat, rng);
          for (const a of plan) expect(enqueue(game, seat, H.toAction(M, a)).ok).toBe(true);
          return plan;
        });
        const M0 = modelFor(game, seats[0]!);
        const predicted = H.simulate(M0, M0.seats.map((id: string) => plans[seats.indexOf(id)]));
        const order = seatsOf(game);
        const mark = game.events.length;
        const result = resolveRoundSteps(game, globalEventBus, order as never, new Map(order.map(id => [id, [...game.plan.queues[id]]])) as never);
        if (!result.ending && game.phase !== 'game_over') {
          for (const id of seatsOf(game)) captureControlPoints(game, globalEventBus, id as never);
        }
        for (const event of game.events.slice(mark)) {
          const reason = event.type === 'action_failed' ? (event.payload as any).reason : event.type;
          reasons[reason] = (reasons[reason] ?? 0) + 1;
        }
        expect(snapshotMirror(M0, predicted)).toEqual(snapshotEngine(game));
        checked++;
      }
      expect(checked).toBeGreaterThanOrEqual(Math.min(3, games));
      // 对拍必须真的走到命中与失败分支，否则零偏差没有意义。
      expect(reasons.attack ?? 0).toBeGreaterThan(0);
    },
    120000,
  );
});

describe('horizon 3.8 分步语义', () => {
  it('同单位可跨行动点先移动再攻击：前缀投影后的瞄准从新站位出发', () => {
    const game = newGame('standoff', 2, 81);
    const seat = seatsOf(game)[0]!;
    const M = modelFor(game, seat);
    const ui = M.unitsOfSeat[M.me].find((i: number) => M.st0.units[i].type === 'infantry');
    const unit = M.st0.units[ui];
    const move = H.generateCandidates(M, M.me, [], { movesPerUnit: 50, presence: null })
      .find((a: any) => a.k === 'move' && a.u === ui);
    expect(move).toBeTruthy();
    // 只有从新站位才合法的瞄准格：离原站位超出射程、离新站位在射程内。
    const after = H.aimsFrom(M, move.c, unit.type, 'attackShape', unit.rng)
      .map((aim: any) => aim.click)
      .find((c: number) => !H.coverCells(M, unit.cell, unit.type, 'attackShape', c, unit.rng));
    expect(after).toBeDefined();
    const attack = { k: 'attack', u: ui, c: after };
    expect(H.isLegalNext(M, M.me, [], attack)).toBe(false);
    expect(H.isLegalNext(M, M.me, [move], attack)).toBe(true);
    const sandbox = structuredClone(game);
    expect(enqueue(sandbox, seat, H.toAction(M, move)).ok).toBe(true);
    expect(enqueue(sandbox, seat, H.toAction(M, attack)).ok).toBe(true);
  });

  it('attacksPerUnit：按地图配置放宽到 2 次时第 2 次合法、第 3 次被拒（与引擎一致）', () => {
    const game = newGame('standoff', 2, 91);
    game.config = structuredClone(game.config);
    game.config.balance.attacksPerUnit = 2;
    const seat = seatsOf(game)[0]!;
    const M = modelFor(game, seat);
    const ui = M.unitsOfSeat[M.me][0];
    const unit = M.st0.units[ui];
    const aim = H.aimsFrom(M, unit.cell, unit.type, 'attackShape', unit.rng)[0];
    const attack = { k: 'attack', u: ui, c: aim.click };
    expect(H.isLegalNext(M, M.me, [attack], attack)).toBe(true);
    expect(H.isLegalNext(M, M.me, [attack, attack], attack)).toBe(false);
    const sandbox = structuredClone(game);
    expect(enqueue(sandbox, seat, H.toAction(M, attack)).ok).toBe(true);
    expect(enqueue(sandbox, seat, H.toAction(M, attack)).ok).toBe(true);
    const third = enqueue(sandbox, seat, H.toAction(M, attack));
    expect(third.ok).toBe(false);
    expect((third as any).code).toBe('attack_limit_reached');
  });

  it('失败连锁：移动撞上原地不动的单位而失败，同单位后续攻击作废（镜像与引擎一致）', () => {
    const game = newGame('standoff', 2, 101);
    game.config = structuredClone(game.config);
    game.config.balance.damageVarianceRange = 0;
    const [seatA] = seatsOf(game);
    const M = modelFor(game, seatA!);
    const mine = M.unitsOfSeat[M.me];
    // 己方 u0 移到己方 u1 当前格（u1 本轮不动 → destination_occupied），随后 u0 攻击。
    const u0 = mine[0];
    const u1 = mine.find((i: number) => i !== u0 && H.isLegalNext(M, M.me, [], { k: 'move', u: u0, c: M.st0.units[i].cell }));
    expect(u1).toBeDefined();
    const move = { k: 'move', u: u0, c: M.st0.units[u1].cell };
    const unit = M.st0.units[u0];
    const aim = H.aimsFrom(M, move.c, unit.type, 'attackShape', unit.rng)[0];
    const attack = { k: 'attack', u: u0, c: aim.click };
    expect(H.isLegalNext(M, M.me, [move], attack)).toBe(true);
    const queues = M.seats.map(() => []);
    queues[M.me] = [move, attack];
    const st = H.simulate(M, queues);
    expect(st.units[u0].cell).toBe(unit.cell);
    for (const a of [move, attack]) expect(enqueue(game, seatA!, H.toAction(M, a)).ok).toBe(true);
    const order = seatsOf(game);
    const mark = game.events.length;
    resolveRoundSteps(game, globalEventBus, order as never, new Map(order.map(id => [id, [...(game.plan.queues[id] ?? [])]])) as never);
    const failures = game.events.slice(mark).filter((e: any) => e.type === 'action_failed').map((e: any) => e.payload.reason);
    expect(failures).toEqual(['destination_occupied', 'previous_action_failed']);
  });

  it('wait 占 1 个行动点：wait 后的攻击在第 2 步结算，镜像与引擎落点一致', () => {
    const game = newGame('standoff', 2, 111);
    game.config = structuredClone(game.config);
    game.config.balance.damageVarianceRange = 0;
    const seats = seatsOf(game);
    const M = modelFor(game, seats[0]!);
    const ui = M.unitsOfSeat[M.me][0];
    const unit = M.st0.units[ui];
    const aim = H.aimsFrom(M, unit.cell, unit.type, 'attackShape', unit.rng)[0];
    const plan = [{ k: 'wait' }, { k: 'attack', u: ui, c: aim.click }];
    expect(H.isLegalNext(M, M.me, [], plan[0])).toBe(true);
    expect(H.isLegalNext(M, M.me, [plan[0]], plan[1])).toBe(true);
    expect(H.toAction(M, plan[0])).toEqual({ type: 'wait', payload: {} });
    for (const a of plan) expect(enqueue(game, seats[0]!, H.toAction(M, a)).ok).toBe(true);
    // 对账：myQueue 里的 wait 解析回内部 wait，前缀签名一致。
    const parsed = H.parseQueue(modelFor(game, seats[0]!), game.plan.queues[seats[0]!]);
    expect(parsed.map((a: any) => a.k)).toEqual(['wait', 'attack']);
    const mark = game.events.length;
    const order = seatsOf(game);
    resolveRoundSteps(game, globalEventBus, order as never, new Map(order.map(id => [id, [...(game.plan.queues[id] ?? [])]])) as never);
    const attackEvents = game.events.slice(mark).filter((e: any) => e.type === 'attack');
    expect(attackEvents.length).toBeGreaterThan(0);
    expect(attackEvents.every((e: any) => e.payload.step === 2)).toBe(true);
  });
});

describe('horizon 治疗镜像', () => {
  it('molten-throne 单格治疗：受伤友军回血与引擎一致（方差归零）', () => {
    const game = newGame('molten-throne', 2, 131);
    game.config = structuredClone(game.config);
    game.config.balance.healVarianceRange = 0;
    const seat = seatsOf(game)[0]!;
    const support = game.units.find((u: any) => u.owner === seat && u.type === 'support');
    const ally = game.units.find((u: any) => u.owner === seat && u.type !== 'support'
      && Math.max(Math.abs(u.q - support.q), Math.abs(u.r - support.r), Math.abs(u.q + u.r - support.q - support.r)) === 1);
    expect(support && ally).toBeTruthy();
    ally.hp = 20;
    const M = modelFor(game, seat);
    const heal = { k: 'heal', u: M.unitIndexById.get(support.id), c: M.board.index.get(`${ally.q},${ally.r}`) };
    expect(H.isLegalNext(M, M.me, [], heal)).toBe(true);
    const queues = M.seats.map(() => []);
    queues[M.me] = [heal];
    const predicted = H.simulate(M, queues).units[M.unitIndexById.get(ally.id)].hp;
    expect(enqueue(game, seat, H.toAction(M, heal)).ok).toBe(true);
    const order = seatsOf(game);
    resolveRoundSteps(game, globalEventBus, order as never, new Map(order.map(id => [id, [...(game.plan.queues[id] ?? [])]])) as never);
    expect(predicted).toBeGreaterThan(20);
    expect(predicted).toBe(ally.hp);
  });

  it('standoff 扇形治疗：覆盖格内多名受伤友军各自回血，与引擎一致（方差归零）', () => {
    const game = newGame('standoff', 2, 141);
    game.config = structuredClone(game.config);
    game.config.balance.healVarianceRange = 0;
    const seat = seatsOf(game)[0]!;
    const own = game.units.filter((u: any) => u.owner === seat);
    // standoff 支援兵只能部署：直接把一名步兵改成支援兵放在两名友军之间（只用于对拍治疗结算）。
    const spec = game.config.units.support;
    const host = own[0];
    Object.assign(host, { type: 'support', healPower: spec.healPower, attack: spec.attack, attackRange: spec.attackRange, maxHp: spec.hp, hp: spec.hp });
    for (const u of own.slice(1)) u.hp = Math.max(1, u.maxHp - 40);
    const M = modelFor(game, seat);
    const ui = M.unitIndexById.get(host.id);
    const aims = H.aimsFrom(M, M.st0.units[ui].cell, 'support', 'healShape', spec.healRange ?? spec.attackRange);
    const wounded = new Set(own.slice(1).map((u: any) => M.board.index.get(`${u.q},${u.r}`)));
    const aim = aims.slice().sort((a: any, b: any) => b.cover.filter((c: number) => wounded.has(c)).length - a.cover.filter((c: number) => wounded.has(c)).length)[0];
    expect(aim.cover.filter((c: number) => wounded.has(c)).length).toBeGreaterThan(0);
    const heal = { k: 'heal', u: ui, c: aim.click };
    const queues = M.seats.map(() => []);
    queues[M.me] = [heal];
    const st = H.simulate(M, queues);
    expect(enqueue(game, seat, H.toAction(M, heal)).ok).toBe(true);
    const order = seatsOf(game);
    resolveRoundSteps(game, globalEventBus, order as never, new Map(order.map(id => [id, [...(game.plan.queues[id] ?? [])]])) as never);
    for (const u of own) expect(st.units[M.unitIndexById.get(u.id)].hp).toBe(u.hp);
  });
});

describe('horizon 多席位', () => {
  it.each([3, 6])('standoff %i 人：每个座位的 decide 输出都被引擎接受', async (players) => {
    const game = newGame('standoff', players, 121 + players);
    for (const seat of seatsOf(game)) {
      let count = 0;
      for (let i = 0; i < 12; i++) {
        const action = await horizon.decide(view(game, seat), utils, { owner: seat });
        if (!action) break;
        const result = enqueue(game, seat, action);
        expect(result.ok, `${seat} ${JSON.stringify(action)} ${(result as any).code}`).toBe(true);
        count++;
      }
      expect(count).toBeGreaterThan(0);
    }
  }, 60000);
});

describe('horizon 通用性自查', () => {
  const source = readFileSync(new URL('../../algorithms/builtin/horizon.mjs', import.meta.url), 'utf8');

  it('不读取地图 id / 名称，不含地图名分支', () => {
    expect(source).not.toMatch(/standoff|molten|mapId|map\.name/i);
  });

  it('零依赖：不 import 任何模块（含其他内置算法）', () => {
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/builtin\//);
    expect(source).not.toMatch(/require\(/);
  });
});
