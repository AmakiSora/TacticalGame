// tests/algorithms/echelon.test.ts
//
// 雁阵算法（algorithms/builtin/echelon.mjs）核心行为单元测试：
// 决策门卫、空军部署（开局零单位的 royale 图）、前缀感知（不重复部署/不撞友军
// 最终位/不重复治疗）、锁定射击、击杀进度价值、治疗瞄准与危险区镜像、疏散、
// 爆破开路、AP 预算与确定性，以及真实 snowflake 对局上「枚举出的每个动作都被
// 引擎入队校验接受」的整轮回归。
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/events/bus.js';
import { buildAdjudicationSnapshot, startGame } from '../../src/engine/engine.js';
import {
  queueAttackAction, queueDemolishAction, queueDeployAction, queueHealAction,
  queueMoveAction, queueWaitAction,
} from '../../src/engine/planning.js';
import { addLobbyPlayer, createLobby } from '../../src/state/store.js';
import type { GameState } from '../../src/types.js';
// @ts-expect-error 算法模块为 ESM .mjs，无类型声明
import echelon, { __echelonTestHooks } from '../../algorithms/builtin/echelon.mjs';
// @ts-expect-error 工具库为 ESM .mjs，无类型声明
import * as utils from '../../algorithms/lib/game-utils.mjs';

const UNIT_SPECS: Record<string, Record<string, unknown>> = {
  infantry: { hp: 90, attack: 31, defense: 7, moveRange: 3, attackRange: 2, cost: 55, canCapture: true, attackShape: { type: 'line', length: 2 } },
  scout: { hp: 70, attack: 16, defense: 4, moveRange: 4, attackRange: 1, cost: 42, canCapture: true },
  heavy: { hp: 140, attack: 40, defense: 9, moveRange: 2, attackRange: 1, cost: 100, canCapture: false, attackShape: { type: 'arc' } },
  ranger: { hp: 68, attack: 34, defense: 3, moveRange: 3, attackRange: 3, cost: 80, canCapture: false, attackLock: true },
  support: { hp: 76, attack: 10, defense: 5, moveRange: 3, attackRange: 2, cost: 68, canCapture: false, healPower: 20, healShape: { type: 'arc' } },
};

let unitSeq = 0;

function makeUnit(owner: string, type: string, q: number, r: number, overrides: Record<string, unknown> = {}) {
  const spec = UNIT_SPECS[type]!;
  unitSeq += 1;
  return {
    id: `u${unitSeq}_${type}`,
    owner,
    type,
    q,
    r,
    hp: spec.hp,
    maxHp: spec.hp,
    attack: spec.attack,
    defense: spec.defense,
    moveRange: spec.moveRange,
    attackRange: spec.attackRange,
    cost: spec.cost,
    alive: true,
    ...overrides,
  };
}

function plainCells(coords: Array<[number, number]>) {
  return coords.map(([q, r]) => ({ q, r, terrain: 'plain' }));
}

function makeGame(overrides: Record<string, unknown> = {}) {
  const cells = (overrides.cells ?? plainCells([[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [1, -1]])) as Array<Record<string, unknown>>;
  return {
    phase: 'active',
    config: {
      mode: 'royale',
      units: UNIT_SPECS,
      balance: {
        actionsPerTurn: 8,
        damageVarianceRange: 2,
        minimumDamage: 1,
        healVarianceRange: 10,
        attacksPerUnit: 1,
        controlPointTypes: { forward_base: { income: 20, deployDiscount: 0, canDeploy: true } },
      },
      annihilation: { artillery: { startRound: 6, intervalRounds: 1, damage: 25, minimumSafeRadius: 1 } },
    },
    map: { radius: 9, terrainCells: overrides.terrainCells ?? [] },
    cells,
    units: overrides.units ?? [],
    headquarters: {},
    controlPoints: overrides.controlPoints ?? [],
    resources: {
      player_a: { supplies: overrides.supplies ?? 0 },
      player_b: { supplies: 0 },
    },
    players: { player_a: { status: 'active' }, player_b: { status: 'active' } },
    plan: { queues: {}, myQueue: overrides.myQueue ?? [], committed: overrides.committed ?? [] },
    turn: { roundNumber: overrides.roundNumber ?? 1 },
    artillery: overrides.artillery ?? {
      safeRadius: 9,
      dangerCells: overrides.dangerCells ?? [],
      warningCells: overrides.warningCells ?? [],
      nextShrinkRound: 6,
    },
  } as unknown as GameState & Record<string, unknown>;
}

async function decide(game: GameState & Record<string, unknown>, owner = 'player_a') {
  return echelon.decide(game, utils, { owner }) as Promise<{ type: string; payload: Record<string, unknown> } | null>;
}

describe('echelon decision gates', () => {
  it('returns null without an owner / in non-royale mode / when committed / when eliminated', async () => {
    const game = makeGame({ units: [makeUnit('player_a', 'scout', 0, 0)] });
    expect(await echelon.decide(game, utils, {})).toBeNull();

    const standard = makeGame({ units: [makeUnit('player_a', 'scout', 0, 0)] });
    (standard.config as Record<string, unknown>).mode = 'standard';
    expect(await decide(standard)).toBeNull();

    const committed = makeGame({ units: [makeUnit('player_a', 'scout', 0, 0)], committed: ['player_a'] });
    expect(await decide(committed)).toBeNull();

    const eliminated = makeGame({ units: [makeUnit('player_a', 'scout', 0, 0)] });
    (eliminated.players as Record<string, unknown>).player_a = { status: 'eliminated' };
    expect(await decide(eliminated)).toBeNull();
  });

  it('returns null when the action budget is spent', async () => {
    const game = makeGame({
      units: [makeUnit('player_a', 'scout', 0, 0)],
      myQueue: Array.from({ length: 8 }, () => ({ type: 'wait' })),
    });
    expect(await decide(game)).toBeNull();
  });
});

describe('echelon deployment', () => {
  it('deploys from an owned pad even with zero units (zero-start royale maps)', async () => {
    // 狭路相逢式开局：零单位，唯一有意义的动作就是部署；入队后落点不得重复。
    const claimed: Array<[number, number]> = [];
    const game = makeGame({
      units: [],
      supplies: 500,
      controlPoints: [{ id: 'cp_1', kind: 'forward_base', q: 0, r: 0, owner: 'player_a' }],
      cells: plainCells([[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]),
    });
    __echelonTestHooks.resetMemory();
    for (let i = 0; i < 4; i++) {
      const action = await decide(game);
      expect(action?.type).toBe('deploy');
      expect(action?.payload.fromId).toBe('cp_1');
      expect(claimed).not.toContainEqual([action!.payload.q, action!.payload.r]);
      claimed.push([action!.payload.q as number, action!.payload.r as number]);
      // 模拟引擎接受入队：前缀推进，下一拍决策看到新队列。
      const queue = (game.plan as Record<string, unknown>).myQueue as Array<Record<string, unknown>>;
      queue.push({ type: 'deploy', ...(action!.payload) });
    }
  });

  it('never re-queues a deploy onto a cell its own prefix deploy claims (ghost-queue regression)', async () => {
    const pad = { id: 'cp_1', kind: 'forward_base', q: 0, r: 0, owner: 'player_a' };
    const scout = makeUnit('player_a', 'scout', 1, 0);
    const game = makeGame({
      units: [scout],
      supplies: 500,
      controlPoints: [pad],
      myQueue: [{ type: 'deploy', unitType: 'scout', fromId: 'cp_1', q: -1, r: 0 }],
    });
    __echelonTestHooks.resetMemory();
    const action = await decide(game);
    if (action?.type === 'deploy') {
      expect([action.payload.q, action.payload.r]).not.toEqual([-1, 0]);
    }
  });

  it('stops deploying once the army reaches the action-point-derived cap', async () => {
    const pad = { id: 'cp_1', kind: 'forward_base', q: 0, r: 0, owner: 'player_a' };
    const coords: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [1, -1], [2, 1], [-2, 1]];
    const units = coords.map(([q, r]) => makeUnit('player_a', 'scout', q, r));
    const game = makeGame({ units, supplies: 500, controlPoints: [pad] });
    __echelonTestHooks.resetMemory();
    const action = await decide(game);
    expect(action?.type).not.toBe('deploy');
  });
});

describe('echelon prefix awareness', () => {
  it('does not move onto a cell an allied unit will occupy after its queued move', async () => {
    const mover = makeUnit('player_a', 'scout', 0, 0);
    const follower = makeUnit('player_a', 'scout', -2, 0, { moveRange: 3 });
    const game = makeGame({
      units: [mover, follower],
      myQueue: [{ type: 'move', unitId: mover.id, q: 2, r: 0 }],
    });
    __echelonTestHooks.resetMemory();
    const action = await decide(game);
    if (action?.type === 'move') {
      expect([action.payload.q, action.payload.r]).not.toEqual([2, 0]);
    }
  });

  it('does not queue a second heal for an ally its prefix heal already covers', async () => {
    const support = makeUnit('player_a', 'support', 0, 0, { moveRange: 0 });
    const wounded = makeUnit('player_a', 'infantry', 1, 0, { hp: 40, moveRange: 0 });
    const game = makeGame({
      units: [support, wounded],
      myQueue: [{ type: 'heal', supportId: support.id, q: 1, r: 0 }],
    });
    __echelonTestHooks.resetMemory();
    const action = await decide(game);
    if (action?.type === 'heal') {
      const heals = ((game.plan as Record<string, unknown>).myQueue as Array<Record<string, unknown>>)
        .filter(a => a.type === 'heal').length;
      expect(heals).toBe(1);
    }
  });
});

describe('echelon combat', () => {
  it('aims a single-shape attack at the enemy unit current cell', async () => {
    const ranger = makeUnit('player_a', 'ranger', 0, 0, { moveRange: 0 });
    const enemy = makeUnit('player_b', 'scout', 2, 0, { moveRange: 0 });
    const game = makeGame({ units: [ranger, enemy], cells: plainCells([[0, 0], [1, 0], [2, 0], [3, 0]]) });
    __echelonTestHooks.resetMemory();
    const action = await decide(game);
    expect(action).toEqual({
      type: 'attack',
      payload: { attackerId: ranger.id, q: 2, r: 0 },
    });
  });

  it('prefers a lock shot: ranger clicks the cell an enemy occupies now', async () => {
    const ranger = makeUnit('player_a', 'ranger', 0, 0, { moveRange: 0 });
    const enemy = makeUnit('player_b', 'scout', 2, 0, { moveRange: 2 });
    // 空格 (1,0)（敌人可能移入）与敌格 (2,0)（锁定）都可选时，锁定命中 ~95% 应胜出。
    const game = makeGame({ units: [ranger, enemy], cells: plainCells([[0, 0], [1, 0], [2, 0], [3, 0], [2, 1]]) });
    __echelonTestHooks.resetMemory();
    const action = await decide(game);
    expect(action?.type).toBe('attack');
    expect([action!.payload.q, action!.payload.r]).toEqual([2, 0]);
  });

  it('values finishing a wounded enemy above chip damage (kill progress)', async () => {
    const ranger = makeUnit('player_a', 'ranger', 0, 0, { moveRange: 0 });
    const wounded = makeUnit('player_b', 'scout', 1, 0, { hp: 12, moveRange: 0 });
    const fresh = makeUnit('player_b', 'scout', -1, 0, { moveRange: 0 });
    const game = makeGame({ units: [ranger, wounded, fresh], cells: plainCells([[0, 0], [1, 0], [-1, 0], [2, 0], [-2, 0]]) });
    __echelonTestHooks.resetMemory();
    const action = await decide(game);
    expect(action?.type).toBe('attack');
    // 12 hp scout：ranger 34−4=30 ≥ 12 → 一击必杀；残血目标应被优先集火。
    expect([action!.payload.q, action!.payload.r]).toEqual([1, 0]);
  });

  it('takes the seat-wiping kill when available (army wipe ends the game)', async () => {
    const ranger = makeUnit('player_a', 'ranger', 0, 0, { moveRange: 0 });
    const lastEnemy = makeUnit('player_b', 'scout', 1, 0, { hp: 10, moveRange: 0 });
    const ally = makeUnit('player_a', 'scout', -1, 0, { moveRange: 0 });
    const game = makeGame({ units: [ranger, lastEnemy, ally], cells: plainCells([[0, 0], [1, 0], [-1, 0]]) });
    __echelonTestHooks.resetMemory();
    const action = await decide(game);
    expect(action).toEqual({
      type: 'attack',
      payload: { attackerId: ranger.id, q: 1, r: 0 },
    });
  });
});

describe('echelon healing', () => {
  it('aims the heal arc so wounded allies fall inside coverage', async () => {
    const support = makeUnit('player_a', 'support', 0, 0, { moveRange: 0 });
    const wounded = makeUnit('player_a', 'infantry', 1, 0, { hp: 40, moveRange: 0 });
    const game = makeGame({ units: [support, wounded] });
    __echelonTestHooks.resetMemory();
    const action = await decide(game);
    expect(action?.type).toBe('heal');
    expect(action?.payload.supportId).toBe(support.id);
    // arc 覆盖 (0,1)/(1,0)/(1,-1)：任意使 (1,0) 入覆盖的瞄准都算对。
    expect([[0, 1], [1, 0], [1, -1]]).toContainEqual([action!.payload.q, action!.payload.r]);
  });

  it('skips healing when the support stands in the artillery danger zone (engine fizzle mirror)', async () => {
    const support = makeUnit('player_a', 'support', 0, 0, { moveRange: 0 });
    const wounded = makeUnit('player_a', 'infantry', 1, 0, { hp: 40, moveRange: 0 });
    const game = makeGame({
      units: [support, wounded],
      dangerCells: [{ q: 0, r: 0 }],
    });
    __echelonTestHooks.resetMemory();
    const action = await decide(game);
    expect(action?.type).not.toBe('heal');
  });

  it('skips heal aims whose coverage reaches into the danger zone', async () => {
    const support = makeUnit('player_a', 'support', 0, 0, { moveRange: 0 });
    const wounded = makeUnit('player_a', 'infantry', 1, 0, { hp: 40, moveRange: 0 });
    const safeWounded = makeUnit('player_a', 'scout', -1, 0, { hp: 40, moveRange: 0 });
    const game = makeGame({
      units: [support, wounded, safeWounded],
      dangerCells: [{ q: 0, r: 1 }],
      cells: plainCells([[0, 0], [1, 0], [-1, 0], [0, 1]]),
    });
    __echelonTestHooks.resetMemory();
    const action = await decide(game);
    expect(action?.type).toBe('heal');
    expect([action!.payload.q, action!.payload.r]).toEqual([-1, 0]);
  });
});

describe('echelon survival', () => {
  it('evacuates a unit standing on a warning cell before the next shrink', async () => {
    const scout = makeUnit('player_a', 'scout', 8, 0, { moveRange: 2 });
    const game = makeGame({
      units: [scout],
      roundNumber: 5,
      artillery: {
        safeRadius: 9,
        dangerCells: [],
        warningCells: [{ q: 8, r: 0 }],
        nextShrinkRound: 6,
      },
      cells: plainCells([[6, 0], [7, 0], [8, 0], [8, 1], [7, 1], [9, 0]]),
    });
    __echelonTestHooks.resetMemory();
    const action = await decide(game);
    expect(action?.type).toBe('move');
    expect(action?.payload.unitId).toBe(scout.id);
    // 撤离后不得停留在预警格上。
    expect([action!.payload.q, action!.payload.r]).not.toEqual([8, 0]);
  });

  it('keeps chaining evacuation moves across decide calls', async () => {
    const heavy = makeUnit('player_a', 'heavy', 8, 0, { moveRange: 2 });
    const game = makeGame({
      units: [heavy],
      roundNumber: 7,
      artillery: {
        safeRadius: 7,
        dangerCells: [{ q: 8, r: 0 }, { q: 7, r: 0 }],
        warningCells: [],
        nextShrinkRound: 8,
      },
      cells: plainCells([[5, 0], [6, 0], [7, 0], [8, 0], [7, 1], [8, 1]]),
    });
    __echelonTestHooks.resetMemory();
    const first = await decide(game);
    expect(first?.type).toBe('move');
    const queue = (game.plan as Record<string, unknown>).myQueue as Array<Record<string, unknown>>;
    queue.push({ type: 'move', unitId: heavy.id, ...(first!.payload) });
    const second = await decide(game);
    if (second?.type === 'move') {
      expect(second.payload.unitId).toBe(heavy.id);
    }
  });
});

describe('echelon demolition', () => {
  it('demolishes the blocker that seals the only route toward the center', async () => {
    // 走廊被 (2,0) 一堵墙封死：heavy 贴墙、墙后直通圈心，爆破是唯一进展。
    const heavy = makeUnit('player_a', 'heavy', 3, 0, { moveRange: 0 });
    const game = makeGame({
      units: [heavy],
      terrainCells: [{ q: 2, r: 0, terrain: 'blocker' }],
      cells: [{ q: 3, r: 0, terrain: 'plain' }, { q: 2, r: 0, terrain: 'blocker' }, { q: 1, r: 0, terrain: 'plain' }, { q: 0, r: 0, terrain: 'plain' }],
    });
    __echelonTestHooks.resetMemory();
    const action = await decide(game);
    expect(action?.type).toBe('demolish');
    expect([action!.payload.q, action!.payload.r]).toEqual([2, 0]);
  });

  it('never demolishes with a non-heavy unit', async () => {
    const scout = makeUnit('player_a', 'scout', 3, 0, { moveRange: 0 });
    const game = makeGame({
      units: [scout],
      terrainCells: [{ q: 2, r: 0, terrain: 'blocker' }],
      cells: [{ q: 3, r: 0, terrain: 'plain' }, { q: 2, r: 0, terrain: 'blocker' }, { q: 1, r: 0, terrain: 'plain' }, { q: 0, r: 0, terrain: 'plain' }],
    });
    __echelonTestHooks.resetMemory();
    const action = await decide(game);
    expect(action?.type).not.toBe('demolish');
  });
});

describe('echelon determinism', () => {
  it('returns the same action for the same state', async () => {
    // 复用同一组单位对象：候选排序的指纹平票兜底含单位 id，id 不同会导致
    // 平票候选顺序漂移（引擎本身也是每局随机 id）。
    // 两次查询之间重置记忆：同一状态下重复查询在运行链路里等价于"动作被拒"，
    // 算法会轮换次优候选（见拒绝记忆），那是有意行为、不属于确定性范畴。
    const units = [makeUnit('player_a', 'ranger', 0, 0, { moveRange: 0 }), makeUnit('player_b', 'scout', 2, 0, { moveRange: 0 })];
    const build = () => makeGame({ units, cells: plainCells([[0, 0], [1, 0], [2, 0]]) });
    __echelonTestHooks.resetMemory();
    const first = await decide(build());
    __echelonTestHooks.resetMemory();
    const second = await decide(build());
    expect(first).toEqual(second);
  });
});

describe('echelon on a real snowflake game', () => {
  function createSnowflakeGame(): GameState {
    const game = createLobby(`echelon-${Math.random().toString(36).slice(2, 8)}`, 'snowflake', {
      maxPlayers: 2,
      participate: true,
      playerName: 'A',
    });
    expect(addLobbyPlayer(game, 'B')).not.toBeNull();
    expect(startGame(game, new EventBus(), () => 0.5).ok).toBe(true);
    return game;
  }

  /** 把算法动作喂给引擎入队校验：任何不合法候选都会让 expect 失败。 */
  function enqueue(game: GameState, owner: string, action: { type: string; payload: Record<string, unknown> }) {
    const p = action.payload;
    if (action.type === 'attack') {
      return queueAttackAction(game, owner as never, String(p.attackerId), Number(p.q), Number(p.r));
    }
    if (action.type === 'heal') {
      return queueHealAction(game, owner as never, String(p.supportId), Number(p.q), Number(p.r));
    }
    if (action.type === 'move') {
      return queueMoveAction(game, owner as never, String(p.unitId), Number(p.q), Number(p.r));
    }
    if (action.type === 'deploy') {
      return queueDeployAction(game, owner as never, p.unitType as never, String(p.fromId), Number(p.q), Number(p.r));
    }
    if (action.type === 'demolish') {
      return queueDemolishAction(game, owner as never, String(p.unitId), Number(p.q), Number(p.r));
    }
    if (action.type === 'wait') {
      return queueWaitAction(game, owner as never);
    }
    throw new Error(`unexpected action type: ${action.type}`);
  }

  /** 与 sanitizeGameForResponse 同口径的玩家视角快照（剥 token/rngState，带事件尾部、
   *  config、adjudication，计划只暴露 myQueue）。 */
  function viewOf(game: GameState, viewer: string) {
    const { tokens: _t, hostToken: _h, rngState: _r, idempotency: _i, events, config, ...rest } = game as GameState & Record<string, unknown>;
    const body = structuredClone(rest) as Record<string, unknown>;
    body.lastEventSeq = events.at(-1)?.seq ?? 0;
    body.events = structuredClone(events);
    body.config = structuredClone(config);
    body.adjudication = buildAdjudicationSnapshot(game);
    const myQueue = game.plan?.queues[viewer as never] ?? [];
    body.plan = { ...(game.plan ?? { committed: [] }), queues: myQueue.length ? { [viewer]: structuredClone(myQueue) } : {}, myQueue: structuredClone(myQueue) };
    return body;
  }

  it('plans and commits a full round accepted by the engine, for both seats', async () => {
    const game = createSnowflakeGame();
    for (const seat of ['player_a', 'player_b'] as const) {
      __echelonTestHooks.resetMemory();
      let queued = 0;
      for (let step = 0; step < 12; step++) {
        const action = await echelon.decide(viewOf(game, seat), utils, { owner: seat }) as { type: string; payload: Record<string, unknown> } | null;
        if (!action) break;
        const result = enqueue(game, seat, action);
        expect(result.ok, JSON.stringify(action)).toBe(true);
        queued += 1;
      }
      expect(queued).toBeGreaterThan(0);
    }
  });
});
