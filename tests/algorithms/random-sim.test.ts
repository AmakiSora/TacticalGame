// tests/algorithms/random-sim.test.ts
// 同时随机算法（algorithms/builtin/random-sim.mjs）核心行为单元测试：
// 形状瞄准（line/arc/single）、治疗瞄格、AP 预算门控、一单位一动作、
// 己方目的格认领、部署补给扣减、炮火危险区过滤（歼灭轴镜像，simultaneous 恒通过）、
// 提交后/无座位短路，以及真实 standoff 对局上「枚举出的每个动作都被引擎入队校验
// 接受」的整轮回归。
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/events/bus.js';
import { startGame } from '../../src/engine/engine.js';
import {
  queueAttackAction, queueDeployAction, queueHealAction, queueMoveAction,
} from '../../src/engine/planning.js';
import { commitAndMaybeResolve } from '../../src/engine/simultaneous.js';
import { addLobbyPlayer, createLobby } from '../../src/state/store.js';
import type { GameState } from '../../src/types.js';
// @ts-expect-error 算法模块为 ESM .mjs，无类型声明
import randomSim from '../../algorithms/builtin/random-sim.mjs';
// @ts-expect-error 工具库为 ESM .mjs，无类型声明
import * as utils from '../../algorithms/lib/game-utils.mjs';

// 与 standoff 相同的形状化兵种表（line 步兵 / arc 重装 / arc 治疗支援）。
const UNIT_SPECS: Record<string, Record<string, unknown>> = {
  infantry: { hp: 90, attack: 31, defense: 7, moveRange: 2, attackRange: 2, cost: 55, canCapture: true, attackShape: { type: 'line', length: 2 } },
  scout: { hp: 60, attack: 16, defense: 4, moveRange: 3, attackRange: 1, cost: 42, canCapture: true },
  heavy: { hp: 140, attack: 40, defense: 9, moveRange: 2, attackRange: 1, cost: 100, canCapture: false, attackShape: { type: 'arc' } },
  ranger: { hp: 68, attack: 38, defense: 3, moveRange: 2, attackRange: 3, cost: 80, canCapture: false, attackLock: true },
  support: { hp: 76, attack: 10, defense: 5, moveRange: 2, attackRange: 2, cost: 68, canCapture: false, healPower: 20, healShape: { type: 'arc' } },
};

let unitSeq = 0;

function makeUnit(owner: string, type: string, q: number, r: number, overrides: Record<string, unknown> = {}) {
  const spec = UNIT_SPECS[type]!;
  unitSeq += 1;
  return {
    id: `u${unitSeq}_${owner}_${type}`,
    owner,
    type,
    q,
    r,
    hp: spec.hp,
    maxHp: spec.hp,
    moveRange: spec.moveRange,
    attackRange: spec.attackRange,
    alive: true,
    ...overrides,
  };
}

interface GameOverrides {
  units?: Array<Record<string, unknown>>;
  headquarters?: Record<string, unknown>;
  controlPoints?: Array<Record<string, unknown>>;
  cells?: Array<{ q: number; r: number }>;
  myQueue?: Array<Record<string, unknown>>;
  committed?: string[];
  supplies?: number;
  actionsPerTurn?: number;
  artillery?: { dangerCells: Array<{ q: number; r: number }> };
}

function makeGame(overrides: GameOverrides = {}) {
  return {
    phase: 'active',
    config: {
      mode: 'simultaneous',
      units: UNIT_SPECS,
      balance: {
        actionsPerTurn: overrides.actionsPerTurn ?? 5,
        controlPointTypes: {
          supply: { income: 8, deployDiscount: 0 },
          forward_base: { income: 0, deployDiscount: 7 },
          repair: { income: 6, deployDiscount: 0 },
        },
      },
    },
    cells: (overrides.cells ?? []).map(c => ({ q: c.q, r: c.r, terrain: 'plain' })),
    map: { terrainCells: [] },
    units: overrides.units ?? [],
    headquarters: overrides.headquarters ?? {},
    controlPoints: overrides.controlPoints ?? [],
    resources: { player_a: { supplies: overrides.supplies ?? 0 }, player_b: { supplies: 0 } },
    players: { player_a: { status: 'active' }, player_b: { status: 'active' } },
    plan: { queues: {}, myQueue: overrides.myQueue ?? [], committed: overrides.committed ?? [] },
    artillery: overrides.artillery ?? null,
  };
}

const farHq = { player_b: { id: 'hq_b', q: 9, r: 9, alive: true, hp: 200, maxHp: 200 } };

describe('random-sim attack aiming', () => {
  it('line-shape infantry aims only at cells on its rays', async () => {
    const attacker = makeUnit('player_a', 'infantry', 0, 0);
    const onRay = makeUnit('player_b', 'scout', 2, 0);   // 射线上、距离 2 = line length
    const offRay = makeUnit('player_b', 'scout', 1, 1);  // 距离 2 但不在射线上
    const game = makeGame({
      units: [attacker, onRay, offRay],
      headquarters: farHq,
      cells: [{ q: 0, r: 0 }, { q: 2, r: 0 }, { q: 1, r: 1 }],
    });

    // 全场无可走空格、无部署源：唯一候选就是打 (2,0)。
    for (let i = 0; i < 10; i++) {
      const action = await randomSim.decide(game, utils, { owner: 'player_a' });
      expect(action).toEqual({
        type: 'attack',
        payload: { attackerId: attacker.id, q: 2, r: 0 },
      });
    }
  });

  it('arc-shape heavy aims only at adjacent cells', async () => {
    const heavy = makeUnit('player_a', 'heavy', 0, 0);
    const adjacent = makeUnit('player_b', 'scout', 1, 0);
    const distant = makeUnit('player_b', 'scout', 2, 0);
    const game = makeGame({
      units: [heavy, adjacent, distant],
      headquarters: farHq,
      cells: [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }],
    });

    for (let i = 0; i < 10; i++) {
      const action = await randomSim.decide(game, utils, { owner: 'player_a' });
      expect(action).toEqual({
        type: 'attack',
        payload: { attackerId: heavy.id, q: 1, r: 0 },
      });
    }
  });

  it('single-shape scout aims at any enemy cell within range, including headquarters', async () => {
    const scout = makeUnit('player_a', 'scout', 0, 0);
    const enemyHq = { id: 'hq_b', q: 1, r: 0, alive: true, hp: 200, maxHp: 200 };
    const game = makeGame({
      units: [scout],
      headquarters: { player_b: enemyHq },
      cells: [{ q: 0, r: 0 }, { q: 1, r: 0 }],
    });

    const action = await randomSim.decide(game, utils, { owner: 'player_a' });
    expect(action).toEqual({
      type: 'attack',
      payload: { attackerId: scout.id, q: 1, r: 0 },
    });
  });
});

describe('random-sim healing', () => {
  it('arc-shape support aims heals at adjacent wounded friendly cells', async () => {
    const support = makeUnit('player_a', 'support', 0, 0);
    const wounded = makeUnit('player_a', 'infantry', 1, 0, { hp: 40 });
    const healthy = makeUnit('player_a', 'scout', -1, 0);
    const game = makeGame({
      units: [support, wounded, healthy],
      headquarters: farHq,
      cells: [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: -1, r: 0 }],
    });

    for (let i = 0; i < 10; i++) {
      const action = await randomSim.decide(game, utils, { owner: 'player_a' });
      expect(action).toEqual({
        type: 'heal',
        payload: { supportId: support.id, q: 1, r: 0 },
      });
    }
  });
});

describe('random-sim plan constraints', () => {
  it('returns null when the round action budget is spent', async () => {
    const scout = makeUnit('player_a', 'scout', 0, 0);
    const filler = { type: 'move', unitId: 'other', q: 5, r: 5 };
    const game = makeGame({
      units: [scout],
      headquarters: farHq,
      cells: [{ q: 0, r: 0 }, { q: 1, r: 0 }],
      myQueue: [filler, filler, filler, filler, filler],
      actionsPerTurn: 5,
    });
    expect(await randomSim.decide(game, utils, { owner: 'player_a' })).toBeNull();
  });

  it('returns null after the player has committed', async () => {
    const scout = makeUnit('player_a', 'scout', 0, 0);
    const game = makeGame({
      units: [scout],
      headquarters: farHq,
      cells: [{ q: 0, r: 0 }, { q: 1, r: 0 }],
      committed: ['player_a'],
    });
    expect(await randomSim.decide(game, utils, { owner: 'player_a' })).toBeNull();
  });

  it('returns null without an owner in ctx (simultaneous has no currentPlayerId)', async () => {
    const scout = makeUnit('player_a', 'scout', 0, 0);
    const game = makeGame({
      units: [scout],
      headquarters: farHq,
      cells: [{ q: 0, r: 0 }, { q: 1, r: 0 }],
    });
    expect(await randomSim.decide(game, utils)).toBeNull();
  });

  it('never plans a second action for a unit already in the queue', async () => {
    const attacker = makeUnit('player_a', 'infantry', 0, 0);
    const enemy = makeUnit('player_b', 'scout', 2, 0);
    const game = makeGame({
      units: [attacker, enemy],
      headquarters: farHq,
      cells: [{ q: 0, r: 0 }, { q: 2, r: 0 }],
      myQueue: [{ type: 'attack', attackerId: attacker.id, q: 2, r: 0 }],
    });
    expect(await randomSim.decide(game, utils, { owner: 'player_a' })).toBeNull();
  });

  it('never claims a move destination already claimed by its own queue', async () => {
    const scout = makeUnit('player_a', 'scout', 0, 0);
    const game = makeGame({
      units: [scout],
      headquarters: farHq,
      cells: [{ q: 0, r: 0 }, { q: 1, r: 0 }],
      myQueue: [{ type: 'move', unitId: 'u_other', q: 1, r: 0 }],
    });
    expect(await randomSim.decide(game, utils, { owner: 'player_a' })).toBeNull();
  });
});

describe('random-sim deployment', () => {
  function deployGame(supplies: number, myQueue: Array<Record<string, unknown>> = []) {
    return makeGame({
      headquarters: {
        player_a: { id: 'hq_a', q: 0, r: 0, alive: true, hp: 200, maxHp: 200 },
        ...farHq,
      },
      cells: [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: -1, r: 0 }, { q: 0, r: 1 }],
      supplies,
      myQueue,
    });
  }

  it('proposes deploys only to empty cells adjacent to the HQ within remaining supplies', async () => {
    const game = deployGame(50); // 只有 scout(42) 买得起
    for (let i = 0; i < 20; i++) {
      const action = await randomSim.decide(game, utils, { owner: 'player_a' });
      expect(action.type).toBe('deploy');
      expect(action.payload.fromId).toBe('hq_a');
      expect(action.payload.unitType).toBe('scout');
      expect([[1, 0], [-1, 0], [0, 1]]).toContainEqual([action.payload.q, action.payload.r]);
    }
  });

  it('deducts already-queued deploys from the supply budget', async () => {
    // 120 - 已计划 scout(42) = 78：heavy(100) 与 ranger(80) 不应再被枚举。
    const game = deployGame(120, [{ type: 'deploy', unitType: 'scout', fromId: 'hq_a', q: 0, r: 1 }]);
    for (let i = 0; i < 20; i++) {
      const action = await randomSim.decide(game, utils, { owner: 'player_a' });
      expect(action.type).toBe('deploy');
      expect(['infantry', 'scout', 'support']).toContain(action.payload.unitType);
      // 已认领的 (0,1) 不再作为目的格。
      expect([action.payload.q, action.payload.r]).not.toEqual([0, 1]);
    }
  });
});

describe('random-sim artillery zone (annihilation-axis mirror)', () => {
  const deployHeadquarters = {
    player_a: { id: 'hq_a', q: 0, r: 0, alive: true, hp: 200, maxHp: 200 },
    ...farHq,
  };

  it('skips deploys whose origin sits in the danger zone', async () => {
    const game = makeGame({
      artillery: { dangerCells: [{ q: 0, r: 0 }] },
      headquarters: deployHeadquarters,
      cells: [{ q: 0, r: 0 }, { q: 1, r: 0 }],
      supplies: 50,
    });
    // 引擎侧确实拒绝该部署（镜像对象真实存在）。
    expect(queueDeployAction(game as never, 'player_a' as never, 'scout' as never, 'hq_a', 1, 0).ok).toBe(false);
    // 唯一出生点在危险区 → 没有任何可枚举动作。
    expect(await randomSim.decide(game, utils, { owner: 'player_a' })).toBeNull();
  });

  it('skips deploys into danger cells but keeps the safe ones', async () => {
    const game = makeGame({
      artillery: { dangerCells: [{ q: 1, r: 0 }] },
      headquarters: deployHeadquarters,
      cells: [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: -1, r: 0 }],
      supplies: 50,
    });
    for (let i = 0; i < 20; i++) {
      const action = await randomSim.decide(game, utils, { owner: 'player_a' });
      expect(action.type).toBe('deploy');
      expect([action.payload.q, action.payload.r]).not.toEqual([1, 0]);
    }
  });

  it('skips healing when the support itself stands in the danger zone', async () => {
    const support = makeUnit('player_a', 'support', 0, 0);
    const wounded = makeUnit('player_a', 'infantry', 1, 0, { hp: 40 });
    const game = makeGame({
      artillery: { dangerCells: [{ q: 0, r: 0 }] },
      units: [support, wounded],
      headquarters: farHq,
      cells: [{ q: 0, r: 0 }, { q: 1, r: 0 }],
    });
    expect(queueHealAction(game as never, 'player_a' as never, support.id, 1, 0).ok).toBe(false);
    expect(await randomSim.decide(game, utils, { owner: 'player_a' })).toBeNull();
  });

  it('skips heal aims whose arc coverage reaches into the danger zone', async () => {
    // arc 治疗朝 (1,0) 的覆盖扇形是 (0,1)/(1,0)/(1,-1)：危险格 (0,1) 令该瞄准被拒；
    // 朝 (-1,0) 的扇形不受影响，仍可治疗。单位 moveRange 置 0 以排除移动候选。
    const support = makeUnit('player_a', 'support', 0, 0, { moveRange: 0 });
    const blocked = makeUnit('player_a', 'infantry', 1, 0, { hp: 40, moveRange: 0 });
    const reachable = makeUnit('player_a', 'scout', -1, 0, { hp: 40, moveRange: 0 });
    const game = makeGame({
      artillery: { dangerCells: [{ q: 0, r: 1 }] },
      units: [support, blocked, reachable],
      headquarters: farHq,
      cells: [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: -1, r: 0 }, { q: 0, r: 1 }],
    });
    expect(queueHealAction(game as never, 'player_a' as never, support.id, 1, 0).ok).toBe(false);
    for (let i = 0; i < 20; i++) {
      const action = await randomSim.decide(game, utils, { owner: 'player_a' });
      expect(action.type).toBe('heal');
      expect([action.payload.q, action.payload.r]).toEqual([reachable.q, reachable.r]);
    }
  });
});

describe('random-sim on a real standoff game', () => {
  function createStandoffGame(): GameState {
    const game = createLobby(`rsim-${Math.random().toString(36).slice(2, 8)}`, 'standoff', {
      maxPlayers: 2,
      participate: true,
      playerName: 'A',
    });
    expect(addLobbyPlayer(game, 'B')).not.toBeNull();
    expect(startGame(game, new EventBus(), () => 0).ok).toBe(true);
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
    throw new Error(`unexpected action type: ${action.type}`);
  }

  it('plans and commits a full round accepted by the engine, for both seats', async () => {
    const bus = new EventBus();
    const game = createStandoffGame();

    for (const seat of ['player_a', 'player_b'] as const) {
      let queued = 0;
      for (let step = 0; step < 10; step++) {
        const action = await randomSim.decide(game, utils, { owner: seat });
        if (!action) break;
        const result = enqueue(game, seat, action as { type: string; payload: Record<string, unknown> });
        expect(result.ok).toBe(true);
        queued += 1;
      }
      // 开局有兵有钱，随机算法至少能排一个动作（攻击/移动/部署）。
      expect(queued).toBeGreaterThan(0);
    }

    // 双方提交后立即结算并进入下一轮。
    const before = game.turn.roundNumber;
    for (const seat of ['player_a', 'player_b'] as const) {
      commitAndMaybeResolve(game, bus, seat);
    }
    expect(game.turn.roundNumber).toBe(before + 1);
    expect(game.plan?.committed).toEqual([]);
  });
});
