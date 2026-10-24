// tests/algorithms/tempo.test.ts
// 时序掌控算法（algorithms/builtin/tempo.mjs）单元测试：
// 计划约束短路（无座位/已提交/AP 用尽）、锁定射击与斩杀抢早拍、占点压末拍、
// 治疗瞄准、被拒动作记忆重排，以及真实 standoff 对局上
// 「整轮计划逐条被引擎入队校验接受」的回归。
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
import tempo from '../../algorithms/builtin/tempo.mjs';
// @ts-expect-error 工具库为 ESM .mjs，无类型声明
import * as utils from '../../algorithms/lib/game-utils.mjs';

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
}

function makeGame(overrides: GameOverrides = {}) {
  const cells = (overrides.cells ?? []).map(c => ({ q: c.q, r: c.r, terrain: 'plain' }));
  // 战术价值需要一块可走的棋盘：给定格之外补一圈平原，避免候选因无格可走消失。
  const extra = [];
  for (let dq = -6; dq <= 6; dq++) {
    for (let dr = -6; dr <= 6; dr++) {
      if (Math.abs(dq + dr) > 6) continue;
      if (cells.some(c => c.q === dq && c.r === dr)) continue;
      extra.push({ q: dq, r: dr, terrain: 'plain' });
    }
  }
  return {
    phase: 'active',
    config: {
      mode: 'simultaneous',
      units: UNIT_SPECS,
      balance: {
        actionsPerTurn: overrides.actionsPerTurn ?? 5,
        minimumDamage: 1,
        controlPointTypes: {
          supply: { income: 8, deployDiscount: 0 },
          forward_base: { income: 0, deployDiscount: 7 },
          repair: { income: 6, deployDiscount: 0 },
        },
      },
    },
    cells: [...cells, ...extra],
    map: { terrainCells: [] },
    units: overrides.units ?? [],
    headquarters: overrides.headquarters ?? {},
    controlPoints: overrides.controlPoints ?? [],
    resources: { player_a: { supplies: overrides.supplies ?? 0 }, player_b: { supplies: 0 } },
    players: { player_a: { status: 'active' }, player_b: { status: 'active' } },
    plan: { queues: {}, myQueue: overrides.myQueue ?? [], committed: overrides.committed ?? [] },
    artillery: null,
  };
}

const farHq = { player_b: { id: 'hq_b', q: 30, r: 30, alive: true, hp: 200, maxHp: 200 } };

describe('tempo plan constraints', () => {
  it('returns null without an owner in ctx', async () => {
    const scout = makeUnit('player_a', 'scout', 0, 0);
    const game = makeGame({ units: [scout], headquarters: farHq, cells: [{ q: 0, r: 0 }] });
    expect(await tempo.decide(game, utils)).toBeNull();
  });

  it('returns null after the player has committed', async () => {
    const scout = makeUnit('player_a', 'scout', 0, 0);
    const game = makeGame({
      units: [scout], headquarters: farHq, cells: [{ q: 0, r: 0 }],
      committed: ['player_a'],
    });
    expect(await tempo.decide(game, utils, { owner: 'player_a' })).toBeNull();
  });

  it('returns null when the round action budget is spent', async () => {
    const scout = makeUnit('player_a', 'scout', 0, 0);
    const filler = { type: 'wait' };
    const game = makeGame({
      units: [scout], headquarters: farHq, cells: [{ q: 0, r: 0 }],
      myQueue: [filler, filler, filler, filler, filler],
      actionsPerTurn: 5,
    });
    expect(await tempo.decide(game, utils, { owner: 'player_a' })).toBeNull();
  });
});

describe('tempo combat planning', () => {
  it('locks a ranger shot onto the enemy standing on the aim cell', async () => {
    const ranger = makeUnit('player_a', 'ranger', 0, 0);
    const enemy = makeUnit('player_b', 'infantry', 3, 0);
    const game = makeGame({
      units: [ranger, enemy],
      headquarters: farHq,
      cells: [{ q: 0, r: 0 }, { q: 3, r: 0 }],
    });
    const action = await tempo.decide(game, utils, { owner: 'player_a' });
    expect(action?.type).toBe('attack');
    expect(action?.payload.attackerId).toBe(ranger.id);
    expect([action?.payload.q, action?.payload.r]).toEqual([3, 0]);
  });

  it('aims a move-then-attack from the projected position', async () => {
    const infantry = makeUnit('player_a', 'infantry', 0, 0);
    const enemy = makeUnit('player_b', 'scout', 6, 0); // 原地与敌方推进落点都打不到，必须先移动
    const board = () => makeGame({
      units: [infantry, enemy],
      headquarters: farHq,
      cells: [{ q: 0, r: 0 }, { q: 6, r: 0 }],
    });
    const first = await tempo.decide(board(), utils, { owner: 'player_a' });
    expect(first?.type).toBe('move');
    expect(first?.payload.unitId).toBe(infantry.id);
    const second = await tempo.decide(
      makeGame({
        units: [infantry, enemy],
        headquarters: farHq,
        cells: [{ q: 0, r: 0 }, { q: 6, r: 0 }],
        myQueue: [{ type: 'move', unitId: infantry.id, q: first.payload.q, r: first.payload.r }],
      }),
      utils,
      { owner: 'player_a' },
    );
    expect(second?.type).toBe('attack');
    expect(second?.payload.attackerId).toBe(infantry.id);
  });

  it('heals a wounded ally with the support', async () => {
    const support = makeUnit('player_a', 'support', 0, 0);
    const wounded = makeUnit('player_a', 'infantry', 1, 0, { hp: 30, moveRange: 0 });
    const game = makeGame({
      units: [support, wounded],
      headquarters: farHq,
      cells: [{ q: 0, r: 0 }, { q: 1, r: 0 }],
    });
    const action = await tempo.decide(game, utils, { owner: 'player_a' });
    expect(action?.type).toBe('heal');
    expect(action?.payload.supportId).toBe(support.id);
  });

  it('sends a capturer onto a reachable neutral control point', async () => {
    const scout = makeUnit('player_a', 'scout', 0, 0, { attackRange: 0 });
    const game = makeGame({
      units: [scout],
      headquarters: farHq,
      controlPoints: [{ id: 'cp_1', name: '补给点', kind: 'supply', q: 2, r: 0, owner: null }],
      cells: [{ q: 0, r: 0 }, { q: 2, r: 0 }],
    });
    const action = await tempo.decide(game, utils, { owner: 'player_a' });
    expect(action?.type).toBe('move');
    expect([action?.payload.q, action?.payload.r]).toEqual([2, 0]);
  });

  it('re-plans a different action when the previous offer was rejected', async () => {
    const scoutA = makeUnit('player_a', 'scout', 0, 0, { attackRange: 0 });
    const scoutB = makeUnit('player_a', 'scout', 0, 1, { attackRange: 0 });
    const base = () => makeGame({
      units: [scoutA, scoutB],
      headquarters: farHq,
      controlPoints: [{ id: 'cp_1', name: '补给点', kind: 'supply', q: 2, r: 0, owner: null }],
      cells: [{ q: 0, r: 0 }, { q: 2, r: 0 }],
    });
    const first = await tempo.decide(base(), utils, { owner: 'player_a' });
    expect(first).not.toBeNull();
    // 同一轮、队列未变 → 视为被拒，必须给出不同动作。
    const second = await tempo.decide(base(), utils, { owner: 'player_a' });
    expect(JSON.stringify(second)).not.toBe(JSON.stringify(first));
  });
});

describe('tempo on a real standoff game', () => {
  function createStandoffGame(): GameState {
    const game = createLobby(`tempo-${Math.random().toString(36).slice(2, 8)}`, 'standoff', {
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

  it('plans and commits a full round accepted by the engine, for both seats', async () => {
    const bus = new EventBus();
    const game = createStandoffGame();

    for (const seat of ['player_a', 'player_b'] as const) {
      let queued = 0;
      for (let step = 0; step < 10; step++) {
        const action = await tempo.decide(game, utils, { owner: seat });
        if (!action) break;
        const result = enqueue(game, seat, action as { type: string; payload: Record<string, unknown> });
        expect(result.ok).toBe(true);
        queued += 1;
      }
      // 开局有兵有点可抢，时序算法至少能排一个动作。
      expect(queued).toBeGreaterThan(0);
    }

    const before = game.turn.roundNumber;
    for (const seat of ['player_a', 'player_b'] as const) {
      commitAndMaybeResolve(game, bus, seat);
    }
    expect(game.turn.roundNumber).toBe(before + 1);
    expect(game.plan?.committed).toEqual([]);
  });

  it('keeps planning legal across five consecutive rounds', async () => {
    const bus = new EventBus();
    const game = createStandoffGame();
    for (let round = 0; round < 5; round++) {
      if (game.phase !== 'active') break;
      for (const seat of ['player_a', 'player_b'] as const) {
        for (let step = 0; step < 10; step++) {
          const action = await tempo.decide(game, utils, { owner: seat });
          if (!action) break;
          const result = enqueue(game, seat, action as { type: string; payload: Record<string, unknown> });
          expect(result.ok).toBe(true);
        }
        commitAndMaybeResolve(game, bus, seat);
      }
    }
    expect(game.turn.roundNumber).toBeGreaterThan(1);
  });
});
