// tests/algorithms/dest-prob.test.ts
// 落点概率算法（algorithms/builtin/dest-prob.mjs）核心行为：
// - 敌军落点分布把"可能去抢的据点"排在原地之前（预测射击的基础）
// - 目的格冲突规避：不往敌军高概率认领的格子送移动
// - 预测射击：打敌军下一步可能站上的空格
// - 治疗、部署、原地占点、AP/提交短路的计划语义
// - 真实 standoff / molten-throne 对局上整轮动作被引擎入队校验全部接受
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
import destProb, { destProbInternals } from '../../algorithms/builtin/dest-prob.mjs';
// @ts-expect-error 工具库为 ESM .mjs，无类型声明
import * as utils from '../../algorithms/lib/game-utils.mjs';

const UNIT_SPECS: Record<string, Record<string, unknown>> = {
  infantry: {
    hp: 90, attack: 31, defense: 7, moveRange: 2, attackRange: 2, cost: 55,
    canCapture: true, attackShape: { type: 'line', length: 2 },
  },
  scout: { hp: 60, attack: 16, defense: 4, moveRange: 3, attackRange: 1, cost: 42, canCapture: true },
  heavy: {
    hp: 140, attack: 40, defense: 9, moveRange: 2, attackRange: 1, cost: 100,
    canCapture: false, attackShape: { type: 'arc' },
  },
  ranger: {
    hp: 68, attack: 38, defense: 3, moveRange: 2, attackRange: 3, cost: 80,
    canCapture: false, attackLock: true,
  },
  support: {
    hp: 76, attack: 10, defense: 5, moveRange: 2, attackRange: 2, cost: 68,
    canCapture: false, healPower: 20, healShape: { type: 'arc' },
  },
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
    attack: spec.attack,
    defense: spec.defense,
    cost: spec.cost,
    moveRange: spec.moveRange,
    attackRange: spec.attackRange,
    canCapture: spec.canCapture,
    healPower: spec.healPower,
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
  enemySupplies?: number;
  actionsPerTurn?: number;
}

function makeGame(overrides: GameOverrides = {}) {
  return {
    phase: 'active',
    config: {
      mode: 'simultaneous',
      units: UNIT_SPECS,
      balance: {
        actionsPerTurn: overrides.actionsPerTurn ?? 5,
        damageVarianceRange: 3,
        healVarianceRange: 6,
        minimumDamage: 1,
        maxTurns: 15,
        adjudicationWeights: { controlPoint: 60, controlPointFlowRatio: 0.7 },
        controlPointTypes: {
          supply: { income: 8, deployDiscount: 0 },
          forward_base: { income: 6, deployDiscount: 8 },
          repair: { income: 6, deployDiscount: 0 },
        },
      },
    },
    cells: (overrides.cells ?? []).map(cell => ({ q: cell.q, r: cell.r, terrain: 'plain' })),
    map: { terrainCells: [] },
    units: overrides.units ?? [],
    headquarters: overrides.headquarters ?? {},
    controlPoints: overrides.controlPoints ?? [],
    resources: {
      player_a: { supplies: overrides.supplies ?? 0 },
      player_b: { supplies: overrides.enemySupplies ?? 0 },
    },
    players: { player_a: { status: 'active' }, player_b: { status: 'active' } },
    turn: {
      roundNumber: 1, turnNumber: 1, turnOrder: ['player_a', 'player_b'],
      currentPlayerId: null, currentOwner: null, actionsUsed: 0,
    },
    plan: { queues: {}, myQueue: overrides.myQueue ?? [], committed: overrides.committed ?? [] },
    artillery: null,
  };
}

const farHq = { player_b: { id: 'hq_b', q: 9, r: 9, alive: true, hp: 200, maxHp: 200, defense: 6 } };

describe('dest-prob enemy destination model', () => {
  it('puts the highest probability on the control point an enemy can capture', () => {
    const enemy = makeUnit('player_b', 'scout', 2, 0);
    const cp = { id: 'cp_a', kind: 'supply', q: 1, r: 1, owner: null };
    const game = makeGame({
      units: [enemy],
      headquarters: farHq,
      controlPoints: [cp],
      cells: [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 1, r: 1 }, { q: 2, r: 0 }, { q: 2, r: 1 }],
    });

    const ctx = destProbInternals.buildContext(game, 'player_a', utils);
    const dist = ctx.distByUnit.get(enemy.id) as Map<string, number>;
    const atPoint = dist.get('1,1') ?? 0;
    const atStay = dist.get('2,0') ?? 0;
    expect(atPoint).toBeGreaterThan(0.5);
    expect(atPoint).toBeGreaterThan(atStay);
    expect((ctx.claimRisk.get('1,1') ?? 0)).toBeGreaterThan(0.5);
  });
});

describe('dest-prob planning behavior', () => {
  it('does not move onto the cell an enemy is predicted to claim', async () => {
    const myScout = makeUnit('player_a', 'scout', 0, 0);
    const enemyScout = makeUnit('player_b', 'scout', 2, 0);
    const game = makeGame({
      units: [myScout, enemyScout],
      headquarters: farHq,
      controlPoints: [
        { id: 'cp_contested', kind: 'supply', q: 1, r: 1, owner: null },
        { id: 'cp_safe', kind: 'supply', q: -2, r: 0, owner: null },
      ],
      cells: [
        { q: 0, r: 0 }, { q: 1, r: 0 }, { q: 1, r: 1 }, { q: 2, r: 0 },
        { q: -1, r: 0 }, { q: -2, r: 0 },
      ],
    });

    const action = await destProb.decide(game, utils, { owner: 'player_a' });
    expect(action).toEqual({
      type: 'move',
      payload: { unitId: myScout.id, q: -2, r: 0 },
    });
  });

  it('fires at the empty cell an enemy is predicted to move onto', async () => {
    const attacker = makeUnit('player_a', 'infantry', 0, 0, { moveRange: 0 });
    const enemy = makeUnit('player_b', 'scout', 2, 2);
    const game = makeGame({
      units: [attacker, enemy],
      headquarters: farHq,
      controlPoints: [{ id: 'cp_target', kind: 'supply', q: 2, r: 0, owner: null }],
      cells: [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }, { q: 2, r: 1 }, { q: 2, r: 2 }],
    });

    const action = await destProb.decide(game, utils, { owner: 'player_a' });
    expect(action?.type).toBe('attack');
    expect(action?.payload.attackerId).toBe(attacker.id);
    // line 形状点击射线上任意一格都覆盖前两格；关键是覆盖到预测落点 (2,0)。
    const aim = destProbInternals.computeAim(
      game,
      attacker,
      'attackShape',
      { q: Number(action?.payload.q), r: Number(action?.payload.r) },
    );
    expect(aim?.cells).toContainEqual({ q: 2, r: 0 });
  });

  it('heals a wounded ally with an arc coverage aim', async () => {
    const support = makeUnit('player_a', 'support', 0, 0, { moveRange: 0 });
    const wounded = makeUnit('player_a', 'infantry', 1, 0, { hp: 40, moveRange: 0 });
    const game = makeGame({
      units: [support, wounded],
      headquarters: farHq,
      cells: [{ q: 0, r: 0 }, { q: 1, r: 0 }],
    });

    const action = await destProb.decide(game, utils, { owner: 'player_a' });
    expect(action).toEqual({
      type: 'heal',
      payload: { supportId: support.id, q: 1, r: 0 },
    });
  });

  it('deploys the only affordable unit when the board has no units', async () => {
    const game = makeGame({
      headquarters: {
        player_a: { id: 'hq_a', q: 0, r: 0, alive: true, hp: 200, maxHp: 200, defense: 6 },
        ...farHq,
      },
      cells: [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: -1, r: 0 }, { q: 0, r: 1 }],
      supplies: 50,
    });

    const action = await destProb.decide(game, utils, { owner: 'player_a' });
    expect(action).toEqual({
      type: 'deploy',
      payload: { unitType: 'scout', fromId: 'hq_a', q: expect.any(Number), r: expect.any(Number) },
    });
  });

  it('stays put when already standing on an unowned control point', async () => {
    const scout = makeUnit('player_a', 'scout', 0, 0);
    const game = makeGame({
      units: [scout],
      controlPoints: [{ id: 'cp_here', kind: 'supply', q: 0, r: 0, owner: null }],
      cells: [{ q: 0, r: 0 }, { q: 1, r: 0 }],
    });

    expect(await destProb.decide(game, utils, { owner: 'player_a' })).toBeNull();
  });

  it('returns null after commit, with no owner, or when the action budget is spent', async () => {
    const scout = makeUnit('player_a', 'scout', 0, 0);
    const base = {
      units: [scout],
      headquarters: farHq,
      cells: [{ q: 0, r: 0 }, { q: 1, r: 0 }],
    };
    expect(await destProb.decide(makeGame({ ...base, committed: ['player_a'] }), utils, { owner: 'player_a' })).toBeNull();
    expect(await destProb.decide(makeGame(base), utils)).toBeNull();
    expect(await destProb.decide(makeGame({
      ...base,
      myQueue: Array.from({ length: 5 }, () => ({ type: 'move', unitId: 'other', q: 5, r: 5 })),
    }), utils, { owner: 'player_a' })).toBeNull();
  });
});

describe('dest-prob on real simultaneous maps', () => {
  function createGame(mapId: string): GameState {
    const game = createLobby(`dest-prob-${mapId}-${Math.random().toString(36).slice(2, 8)}`, mapId, {
      maxPlayers: 2,
      participate: true,
      playerName: 'A',
    });
    expect(addLobbyPlayer(game, 'B')).not.toBeNull();
    expect(startGame(game, new EventBus(), () => 0).ok).toBe(true);
    return game;
  }

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

  it.each(['standoff', 'molten-throne'])('%s: plans and commits a full round accepted by the engine', async (mapId) => {
    const bus = new EventBus();
    const game = createGame(mapId);

    for (const seat of ['player_a', 'player_b'] as const) {
      let queued = 0;
      for (let step = 0; step < 10; step++) {
        const action = await destProb.decide(game, utils, { owner: seat });
        if (!action) break;
        const result = enqueue(game, seat, action as { type: string; payload: Record<string, unknown> });
        expect(result.ok).toBe(true);
        queued += 1;
      }
      expect(queued).toBeGreaterThan(0);
    }

    const before = game.turn.roundNumber;
    for (const seat of ['player_a', 'player_b'] as const) {
      commitAndMaybeResolve(game, bus, seat);
    }
    expect(game.turn.roundNumber).toBe(before + 1);
    expect(game.plan?.committed).toEqual([]);
  });
});
