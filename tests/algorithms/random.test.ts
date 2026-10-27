// tests/algorithms/random.test.ts
//
// 三个随机基线算法条目的模式回归（名字/版本各自独立）：
// - random（随机算法，standard）：逐人轮流枚举，攻击按目标 id；
// - random-annihilation（歼灭随机算法，annihilation）：同一轮流枚举 + 炮火合法镜像，
//   过滤危险区内的部署（起点/落点）与治疗（支援兵/目标），但不滤掉「走进危险区」；
// - random-royale（大逃杀随机算法，royale）：同时回合计划队列（与 random-sim 同源的
//   lib/random-plan.mjs），攻/治瞄准格子，null = 提交计划；
// - 真实对局：artillery-zone（歼灭）整局零非法并正常完赛；
//   snowflake（大逃杀）多轮计划零入队拒绝、轮次推进且炮火圈确实收缩。
import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../src/events/bus.js';
import { endTurn, startGame } from '../../src/engine/engine.js';
import { attackTarget, healTarget } from '../../src/engine/combat.js';
import { moveUnit } from '../../src/engine/units.js';
import { deployUnit } from '../../src/engine/deployment.js';
import {
  queueAttackAction, queueDeployAction, queueHealAction, queueMoveAction,
} from '../../src/engine/planning.js';
import { commitAndMaybeResolve } from '../../src/engine/simultaneous.js';
import { addLobbyPlayer, createLobby } from '../../src/state/store.js';
import { loadMaps } from '../../src/config/loader.js';
// @ts-expect-error 算法模块为 ESM .mjs，无类型声明
import random from '../../algorithms/builtin/random.mjs';
// @ts-expect-error 算法模块为 ESM .mjs，无类型声明
import randomAnnihilation from '../../algorithms/builtin/random-annihilation.mjs';
// @ts-expect-error 算法模块为 ESM .mjs，无类型声明
import randomRoyale from '../../algorithms/builtin/random-royale.mjs';
// @ts-expect-error 工具库为 ESM .mjs，无类型声明
import * as utils from '../../algorithms/lib/game-utils.mjs';

loadMaps();

/** 可复现随机源：固定 seed → 固定决策与开局掷骰，避免随机基线测试抖动。 */
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

function withSeededRandom<T>(seed: number, fn: () => Promise<T>): Promise<T> {
  const spy = vi.spyOn(Math, 'random').mockImplementation(mulberry32(seed));
  return fn().finally(() => spy.mockRestore());
}

const UNIT_SPECS: Record<string, Record<string, unknown>> = {
  infantry: { hp: 100, attack: 30, defense: 8, moveRange: 3, attackRange: 1, cost: 45, canCapture: true },
  scout: { hp: 65, attack: 16, defense: 4, moveRange: 5, attackRange: 1, cost: 38, canCapture: true },
  heavy: { hp: 150, attack: 38, defense: 13, moveRange: 2, attackRange: 1, cost: 92, canCapture: false },
  ranger: { hp: 72, attack: 44, defense: 3, moveRange: 3, attackRange: 3, cost: 72, canCapture: false },
  support: { hp: 82, attack: 10, defense: 5, moveRange: 3, attackRange: 1, cost: 60, canCapture: false, healPower: 22 },
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
    hasMoved: false,
    hasActed: false,
    actionSpent: false,
    ...overrides,
  };
}

interface FakeGameOverrides {
  mode?: string;
  units?: Array<Record<string, unknown>>;
  cells?: Array<{ q: number; r: number }>;
  headquarters?: Record<string, unknown>;
  controlPoints?: Array<Record<string, unknown>>;
  supplies?: number;
  artillery?: { dangerCells: Array<{ q: number; r: number }> } | null;
  plan?: Record<string, unknown>;
  actionsPerTurn?: number;
}

function makeGame(overrides: FakeGameOverrides = {}) {
  const mode = overrides.mode ?? 'standard';
  return {
    id: 'fake-game',
    phase: 'active',
    config: {
      mode,
      units: UNIT_SPECS,
      balance: {
        actionsPerTurn: overrides.actionsPerTurn ?? 4,
        attacksPerUnit: 1,
        controlPointTypes: {
          supply: { income: 8, deployDiscount: 0 },
          forward_base: { income: 4, deployDiscount: 0 },
          repair: { income: 0, deployDiscount: 0 },
        },
      },
    },
    cells: (overrides.cells ?? []).map(c => ({ q: c.q, r: c.r, terrain: 'plain' })),
    map: { terrainCells: [] },
    units: overrides.units ?? [],
    headquarters: overrides.headquarters ?? {},
    controlPoints: overrides.controlPoints ?? [],
    resources: {
      player_a: { supplies: overrides.supplies ?? 0 },
      player_b: { supplies: 0 },
    },
    players: {
      player_a: { status: 'active', stats: {} },
      player_b: { status: 'active', stats: {} },
    },
    turn: {
      currentPlayerId: mode === 'royale' || mode === 'simultaneous' ? null : 'player_a',
      currentOwner: mode === 'royale' || mode === 'simultaneous' ? null : 'player_a',
      turnNumber: 1,
      roundNumber: 1,
      actionsUsed: 0,
    },
    plan: overrides.plan ?? undefined,
    artillery: overrides.artillery === undefined ? null : overrides.artillery,
  };
}

const farHq = { player_b: { id: 'hq_b', q: 9, r: 9, alive: true, hp: 1, maxHp: 1 } };

describe('random (standard)', () => {
  it('attacks by target id (not by aiming a cell)', async () => {
    const scout = makeUnit('player_a', 'scout', 0, 0);
    const enemy = makeUnit('player_b', 'scout', 1, 0);
    const game = makeGame({
      units: [scout, enemy],
      headquarters: farHq,
      cells: [{ q: 0, r: 0 }, { q: 1, r: 0 }],
    });

    for (let i = 0; i < 10; i++) {
      const action = await random.decide(game, utils);
      expect(action).toEqual({
        type: 'attack',
        payload: { attackerId: scout.id, targetId: enemy.id },
      });
    }
  });

  it('returns null when the seat has no legal action', async () => {
    const scout = makeUnit('player_a', 'scout', 0, 0);
    const game = makeGame({
      units: [scout],
      headquarters: farHq,
      cells: [{ q: 0, r: 0 }],
    });
    expect(await random.decide(game, utils)).toBeNull();
  });
});

describe('random-annihilation: artillery legality mirrors', () => {
  const deployPad = { player_a: { id: 'cp_a', kind: 'forward_base', q: 0, r: 0, owner: 'player_a' } };

  it('skips every deploy when the origin pad is inside the danger zone', async () => {
    const game = makeGame({
      mode: 'annihilation',
      controlPoints: Object.values(deployPad),
      cells: [{ q: 0, r: 0 }, { q: 1, r: 0 }],
      supplies: 50,
      artillery: { dangerCells: [{ q: 0, r: 0 }] },
    });
    expect(await randomAnnihilation.decide(game, utils)).toBeNull();
  });

  it('keeps the safe deploy cells when only some neighbors are shelled', async () => {
    const game = makeGame({
      mode: 'annihilation',
      controlPoints: Object.values(deployPad),
      cells: [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: -1, r: 0 }],
      supplies: 50,
      artillery: { dangerCells: [{ q: 1, r: 0 }] },
    });
    for (let i = 0; i < 20; i++) {
      const action = await randomAnnihilation.decide(game, utils);
      expect(action?.type).toBe('deploy');
      expect([action.payload.q, action.payload.r]).not.toEqual([1, 0]);
    }
  });

  it('skips healing when the support itself stands in the danger zone', async () => {
    const support = makeUnit('player_a', 'support', 0, 0);
    const wounded = makeUnit('player_a', 'infantry', 1, 0, { hp: 40 });
    const game = makeGame({
      mode: 'annihilation',
      units: [support, wounded],
      cells: [{ q: 0, r: 0 }, { q: 1, r: 0 }],
      artillery: { dangerCells: [{ q: 0, r: 0 }] },
    });
    expect(await randomAnnihilation.decide(game, utils)).toBeNull();
  });

  it('skips healing a wounded ally who stands in the danger zone', async () => {
    const support = makeUnit('player_a', 'support', 0, 0);
    const wounded = makeUnit('player_a', 'infantry', 1, 0, { hp: 40, moveRange: 0 });
    const game = makeGame({
      mode: 'annihilation',
      units: [support, wounded],
      cells: [{ q: 0, r: 0 }, { q: 1, r: 0 }],
      artillery: { dangerCells: [{ q: 1, r: 0 }] },
    });
    expect(await randomAnnihilation.decide(game, utils)).toBeNull();
  });

  it('still allows moving into the danger zone (engine bills it at the round boundary)', async () => {
    const scout = makeUnit('player_a', 'scout', 0, 0, { moveRange: 1 });
    const game = makeGame({
      mode: 'annihilation',
      units: [scout],
      cells: [{ q: 0, r: 0 }, { q: 1, r: 0 }],
      artillery: { dangerCells: [{ q: 1, r: 0 }] },
    });
    for (let i = 0; i < 10; i++) {
      const action = await randomAnnihilation.decide(game, utils);
      expect(action).toEqual({
        type: 'move',
        payload: { unitId: scout.id, q: 1, r: 0 },
      });
    }
  });
});

describe('random-royale: simultaneous plan queue', () => {
  function royaleGame(overrides: FakeGameOverrides = {}) {
    return makeGame({
      mode: 'royale',
      plan: { committed: [], queues: {}, myQueue: [] },
      ...overrides,
    });
  }

  it('aims attacks at cells with the plan payload shape', async () => {
    const scout = makeUnit('player_a', 'scout', 0, 0);
    const enemy = makeUnit('player_b', 'scout', 1, 0);
    const game = royaleGame({
      units: [scout, enemy],
      cells: [{ q: 0, r: 0 }, { q: 1, r: 0 }],
    });
    for (let i = 0; i < 10; i++) {
      const action = await randomRoyale.decide(game, utils, { owner: 'player_a' });
      expect(action).toEqual({
        type: 'attack',
        payload: { attackerId: scout.id, q: 1, r: 0 },
      });
    }
  });

  it('returns null when the seat already committed or the queue is full', async () => {
    const scout = makeUnit('player_a', 'scout', 0, 0);
    const committed = royaleGame({
      units: [scout],
      cells: [{ q: 0, r: 0 }, { q: 1, r: 0 }],
      plan: { committed: ['player_a'], queues: {}, myQueue: [] },
    });
    expect(await randomRoyale.decide(committed, utils, { owner: 'player_a' })).toBeNull();

    const filler = { type: 'move', unitId: 'u_other', q: 5, r: 5 };
    const fullQueue = royaleGame({
      units: [scout],
      cells: [{ q: 0, r: 0 }, { q: 1, r: 0 }],
      actionsPerTurn: 4,
      plan: { committed: [], queues: {}, myQueue: [filler, filler, filler, filler] },
    });
    expect(await randomRoyale.decide(fullQueue, utils, { owner: 'player_a' })).toBeNull();
  });

  it('returns null without ctx.owner (plan modes have no currentPlayerId)', async () => {
    const scout = makeUnit('player_a', 'scout', 0, 0);
    const game = royaleGame({
      units: [scout],
      cells: [{ q: 0, r: 0 }, { q: 1, r: 0 }],
    });
    expect(await randomRoyale.decide(game, utils)).toBeNull();
  });
});

// ------------------------------------------------------------------ 真实对局回归

/** 客户端视角快照：算法只看到 API 会给的字段（大逃杀额外带己方计划队列）。 */
function snapshot(game: Record<string, any>, seat?: string) {
  const base: Record<string, any> = {
    id: game.id,
    phase: game.phase,
    winner: game.winner,
    cells: game.cells,
    map: { terrainCells: game.map.terrainCells },
    units: game.units.map((u: any) => ({ ...u })),
    headquarters: Object.fromEntries(Object.entries(game.headquarters).map(([k, h]: any) => [k, { ...h }])),
    controlPoints: (game.controlPoints || []).map((p: any) => ({ ...p })),
    players: Object.fromEntries(Object.entries(game.players).map(([k, p]: any) => [k, { status: p.status }])),
    resources: structuredClone(game.resources),
    turn: { ...game.turn },
    config: game.config,
    artillery: game.artillery ? structuredClone(game.artillery) : null,
  };
  if (seat) {
    base.plan = {
      committed: [...(game.plan?.committed ?? [])],
      myQueue: structuredClone(game.plan?.queues?.[seat] ?? []),
    };
  }
  return base;
}

const globalBus = new EventBus();

function applySequentialAction(game: any, owner: string, action: any) {
  const p = action.payload || {};
  if (action.type === 'move') return moveUnit(game, globalBus, owner, p.unitId, p.q, p.r);
  if (action.type === 'attack') return attackTarget(game, globalBus, owner, p.attackerId, p.targetId);
  if (action.type === 'heal') return healTarget(game, globalBus, owner, p.supportId, p.targetId);
  if (action.type === 'deploy') return deployUnit(game, globalBus, owner, p.unitType, p.fromId, p.q, p.r);
  throw new Error(`unexpected action type: ${action.type}`);
}

describe('random-annihilation on a real annihilation game (artillery-zone)', () => {
  function createAnnihilationGame() {
    const game = createLobby(`random_ann_${Math.random().toString(36).slice(2, 8)}`, 'artillery-zone', {
      maxPlayers: 2,
      participate: true,
      playerName: 'A',
    });
    expect(addLobbyPlayer(game, 'B')).not.toBeNull();
    expect(startGame(game, globalBus, () => 0).ok).toBe(true);
    return game;
  }

  it('never emits an action the engine rejects, and finishes the match', async () => {
    await withSeededRandom(20261028, async () => {
      const game = createAnnihilationGame();
      const illegal: string[] = [];
      const types = new Set<string>();
      let guard = 0;

      while (game.phase === 'active' && guard++ < 4000) {
        const owner = game.turn.currentPlayerId;
        if (!owner) break;
        const action = await randomAnnihilation.decide(snapshot(game), utils);
        if (!action) {
          endTurn(game, globalBus, owner);
          continue;
        }
        types.add(action.type);
        const result = applySequentialAction(game, owner, action);
        if (!result.ok) {
          illegal.push(`${action.type}:${result.code}`);
          endTurn(game, globalBus, owner);
        }
      }

      expect(illegal).toEqual([]);
      expect(game.phase).toBe('game_over');
      expect(game.turn.roundNumber).toBeGreaterThan(3);
      // 确实打出了动作，而不是全程空转结束回合。
      expect(types.size).toBeGreaterThanOrEqual(2);
    });
  }, 120000);
});

describe('random-royale on a real royale game (snowflake)', () => {
  function createRoyaleGame() {
    const game = createLobby(`random_roy_${Math.random().toString(36).slice(2, 8)}`, 'snowflake', {
      maxPlayers: 2,
      participate: true,
      playerName: 'A',
    });
    expect(addLobbyPlayer(game, 'B')).not.toBeNull();
    expect(startGame(game, globalBus, () => 0).ok).toBe(true);
    return game;
  }

  function enqueue(game: any, seat: string, action: any) {
    const p = action.payload || {};
    if (action.type === 'attack') return queueAttackAction(game, seat, p.attackerId, p.q, p.r);
    if (action.type === 'heal') return queueHealAction(game, seat, p.supportId, p.q, p.r);
    if (action.type === 'move') return queueMoveAction(game, seat, p.unitId, p.q, p.r);
    if (action.type === 'deploy') return queueDeployAction(game, seat, p.unitType, p.fromId, p.q, p.r);
    throw new Error(`unexpected action type: ${action.type}`);
  }

  it('plans six rounds without a single queue rejection, and the ring shrinks', async () => {
    await withSeededRandom(20261028, async () => {
      const game = createRoyaleGame();
      const round0 = game.turn.roundNumber;
      const radius0 = game.artillery?.safeRadius ?? null;
      const illegal: string[] = [];
      let queued = 0;
      let guard = 0;

      while (game.phase === 'active' && game.turn.roundNumber - round0 < 6 && guard++ < 200) {
        for (const seat of ['player_a', 'player_b'] as const) {
          if (game.players[seat]?.status !== 'active') continue;
          if ((game.plan?.committed ?? []).includes(seat)) continue;
          for (let step = 0; step < 12; step++) {
            const action = await randomRoyale.decide(snapshot(game, seat), utils, { owner: seat });
            if (!action) break;
            const result = enqueue(game, seat, action);
            if (!result.ok) illegal.push(`${action.type}:${result.code}`);
            else queued += 1;
          }
          commitAndMaybeResolve(game, globalBus, seat);
        }
      }

      expect(illegal).toEqual([]);
      expect(queued).toBeGreaterThan(0);
      expect(game.turn.roundNumber - round0).toBeGreaterThanOrEqual(6);
      // 第 6 轮起每轮收缩一圈：跑满 6 轮后安全半径必然小于开局。
      expect(game.artillery?.safeRadius ?? 99).toBeLessThan(radius0 ?? 99);
    });
  }, 180000);
});
