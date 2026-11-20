// tests/algorithms/fog-scout-equivariance.test.ts
// fog-scout 的旋转等变回归：三座/两座的**首轮计划必须互为旋转像**。
//
// 背景：`fog-crossing` 修好地图对称后，西北座胜率仍只有 3%（east 45% / south 52%），
// 且换布局顺序后偏置仍跟着「西北坐标」走。根因在启发式的两处非等变：
//   1) 候选 tie-break 用 `${q},${r}` 字典序 → 三个座位都偏向同一个绝对方向；
//   2) 侦察收益直接用服务端逐格 visibleCells 计数 → hex 线段光栅在旋转下差 1~2 格，
//      这点噪声被放大成固定方向的走位差。
// 本用例用真实引擎开局 + 首轮决策做快照断言：只要上述任一问题回归，三个座位的
// 计划就不再互为旋转像，用例立即失败（不需要跑 60 局）。
//
// 同时用一对完全镜像的合成视角做纯函数级断言：`decide(镜像视角)` 必须等于
// `decide(视角)` 的镜像，与引擎的光栅化无关。
import { describe, expect, it } from 'vitest';
import { loadMaps } from '../../src/config/loader.js';
import { addLobbyPlayer, createLobby } from '../../src/state/store.js';
import { startGame } from '../../src/engine/engine.js';
import {
  queueAttackAction, queueDeployAction, queueHealAction, queueMoveAction,
} from '../../src/engine/planning.js';
import { fogProjectionFor, unitsForViewer } from '../../src/engine/fog.js';
import { EventBus } from '../../src/events/bus.js';
// @ts-expect-error 算法模块为 ESM .mjs，无类型声明
import fogScout from '../../algorithms/builtin/fog-scout.mjs';
// @ts-expect-error 工具库为 ESM .mjs，无类型声明
import * as utils from '../../algorithms/lib/game-utils.mjs';

loadMaps();

interface Pos { q: number; r: number }
interface PlanStep { type: string; unit: string; q: number; r: number }

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

/** 60° 格点旋转 k 次：(q,r) → (-r,q+r)。k=2 是 120°，k=3 是 180°。 */
function rotate(pos: Pos, k: number): Pos {
  let { q, r } = pos;
  // 0 - r 而不是 -r：避免出现 -0（toBe 用 Object.is 判等，-0 !== 0）。
  for (let i = 0; i < ((k % 6) + 6) % 6; i++) [q, r] = [0 - r, q + r];
  return { q, r };
}

function view(game: any, owner: string) {
  const turn = { ...game.turn };
  delete turn.resolvedRound;
  delete turn.skipGuard;
  const myQueue = (game.plan?.queues?.[owner] ?? []).map((action: any) => ({ ...action }));
  return {
    id: game.id, mapId: game.mapId, phase: game.phase, winner: game.winner,
    map: {
      grid: game.map.grid, orientation: game.map.orientation, radius: game.map.radius,
      terrainCells: game.map.terrainCells.map((cell: any) => ({ ...cell })),
      cells: game.cells.map((cell: any) => ({ ...cell })),
      id: game.mapId,
    },
    cells: game.cells.map((cell: any) => ({ ...cell })),
    units: unitsForViewer(game, owner).map((unit: any) => ({ ...unit })),
    headquarters: Object.fromEntries(
      Object.entries(game.headquarters).map(([id, hq]: [string, any]) => [id, { ...hq }]),
    ),
    controlPoints: (game.controlPoints ?? []).map((point: any) => ({ ...point })),
    players: Object.fromEntries(
      Object.entries(game.players).map(([id, player]: [string, any]) => [id, {
        status: player.status, name: player.name, turnOrder: player.turnOrder,
      }]),
    ),
    playerNames: { ...game.playerNames },
    resources: structuredClone(game.resources),
    turn,
    config: game.config,
    plan: {
      queues: myQueue.length > 0 ? { [owner]: myQueue } : {},
      myQueue,
      committed: [...(game.plan?.committed ?? [])],
    },
    fog: fogProjectionFor(game, owner),
    artillery: null,
  };
}

function enqueue(game: any, owner: string, action: any) {
  const p = action.payload ?? {};
  switch (action.type) {
    case 'attack': return queueAttackAction(game, owner as never, p.attackerId, p.q, p.r);
    case 'heal': return queueHealAction(game, owner as never, p.supportId, p.q, p.r);
    case 'move': return queueMoveAction(game, owner as never, p.unitId, p.q, p.r);
    case 'deploy': return queueDeployAction(game, owner as never, p.unitType, p.fromId, p.q, p.r);
    default: return { ok: false as const, code: 'unknown_action', message: action.type };
  }
}

function makeGame(mapId: string, players: number, seed: number) {
  const game = createLobby(`fog-equiv-${mapId}-${seed}`, mapId, {
    maxPlayers: players, participate: true, playerName: 'A',
  });
  for (let index = 1; index < players; index++) {
    expect(addLobbyPlayer(game, `P${index}`)).not.toBeNull();
  }
  const started = startGame(game, new EventBus(), mulberry32(seed));
  expect(started.ok).toBe(true);
  return game;
}

/** 单位相对标签：同座位同兵种的创建序号（跨座位可比，id 本身不可比）。 */
function unitLabels(game: any): Map<string, string> {
  const labels = new Map<string, string>();
  const counts = new Map<string, number>();
  for (const unit of game.units ?? []) {
    const key = `${unit.owner}|${unit.type}`;
    const index = counts.get(key) ?? 0;
    counts.set(key, index + 1);
    labels.set(unit.id, `${unit.type}#${index}`);
  }
  return labels;
}

/** 第一轮的完整计划（按队列顺序，最多 actionsPerTurn 个）。 */
async function firstRoundPlan(game: any, seat: string) {
  const labels = unitLabels(game);
  const limit = game.config.balance?.actionsPerTurn ?? 5;
  const steps: PlanStep[] = [];
  for (let i = 0; i < limit; i++) {
    const action = await fogScout.decide(view(game, seat), utils, { owner: seat });
    if (!action) break;
    const result = enqueue(game, seat, action);
    expect(result.ok, `${seat} ${action.type} ${JSON.stringify(action.payload)}`).toBe(true);
    const p = action.payload;
    const unit = action.type === 'deploy'
      ? `${p.unitType}#deploy`
      : labels.get(p.unitId ?? p.attackerId ?? p.supportId) ?? '?';
    steps.push({ type: action.type, unit, q: p.q, r: p.r });
  }
  return steps;
}

/** 找到把座位 A 的总部转到座位 B 总部的最小 60° 旋转步数。 */
function rotationBetween(game: any, fromSeat: string, toSeat: string): number | null {
  const a = game.headquarters[fromSeat];
  const b = game.headquarters[toSeat];
  for (let k = 1; k < 6; k++) {
    const r = rotate(a, k);
    if (r.q === b.q && r.r === b.r) return k;
  }
  return null;
}

function rotatedSteps(steps: PlanStep[], k: number): PlanStep[] {
  return steps.map(step => ({ ...step, ...rotate(step, k) }));
}

describe('fog-scout 旋转等变', () => {
  it('fog-crossing 三座位首轮计划互为 120° 旋转像', async () => {
    const game = makeGame('fog-crossing', 3, 20261120);
    const [a, b, c] = game.turn.turnOrder;
    const planA = await firstRoundPlan(game, a);
    const planB = await firstRoundPlan(game, b);
    const planC = await firstRoundPlan(game, c);
    expect(planA.length).toBeGreaterThan(0);
    expect(planB.length).toBe(planA.length);
    expect(planC.length).toBe(planA.length);

    const kAB = rotationBetween(game, a, b)!;
    const kBC = rotationBetween(game, b, c)!;
    const kCA = rotationBetween(game, c, a)!;
    expect(rotatedSteps(planA, kAB)).toEqual(planB);
    expect(rotatedSteps(planB, kBC)).toEqual(planC);
    expect(rotatedSteps(planC, kCA)).toEqual(planA);
  }, 30000);

  it('fog-harbor 两座位首轮计划互为 180° 旋转像', async () => {
    const game = makeGame('fog-harbor', 2, 20261120);
    const [a, b] = game.turn.turnOrder;
    const planA = await firstRoundPlan(game, a);
    const planB = await firstRoundPlan(game, b);
    expect(planA.length).toBeGreaterThan(0);
    expect(planB.length).toBe(planA.length);

    const k = rotationBetween(game, a, b)!;
    expect(k).toBe(3);
    expect(rotatedSteps(planA, k)).toEqual(planB);
    expect(rotatedSteps(planB, k)).toEqual(planA);
  }, 30000);

  it('同分候选的 tie-break 在镜像夹具上等变', async () => {
    // 半径 2 的空地 + 每边一个侦察兵，没有总部/据点/敌军：所有可达格同分，
    // 只有 tie-break 决定去哪。旧版按 `${q},${r}` 字典序，两座都会选同一个
    // 绝对格（-1,-1），镜像后对不上；座位坐标系下两座选的是彼此的镜像。
    const radius = 2;
    const cells: Pos[] = [];
    for (let q = -radius; q <= radius; q++) {
      for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) {
        cells.push({ q, r });
      }
    }
    const config = {
      mode: 'fog',
      units: {
        scout: {
          hp: 60, attack: 16, defense: 4, moveRange: 3, attackRange: 1,
          cost: 42, canCapture: true,
        },
      },
      balance: { actionsPerTurn: 3, attacksPerUnit: 1, minimumDamage: 1, controlPointTypes: {} },
      fog: { vision: { scout: 2 }, revealFromRound: null },
    };
    const build = (owner: string, mirror: boolean) => {
      const flip = (pos: Pos) => (mirror ? rotate(pos, 3) : pos);
      return {
        id: 'synthetic-tie', mapId: 'synthetic-tie', phase: 'active', winner: null,
        map: { grid: 'hex', orientation: 'pointy', radius, terrainCells: [], cells: cells.map(c => ({ ...c, terrain: 'plain' })) },
        cells: cells.map(c => ({ ...c, terrain: 'plain' })),
        units: [{
          id: `${owner}-scout`, owner, type: 'scout', ...flip({ q: 1, r: 0 }),
          hp: 60, maxHp: 60, alive: true, moveRange: 3, attackRange: 1,
          attack: 16, defense: 4, canCapture: true,
        }],
        headquarters: {},
        controlPoints: [],
        players: { [owner]: { status: 'active', name: owner, turnOrder: 0 } },
        playerNames: { [owner]: owner },
        resources: { [owner]: { supplies: 100 } },
        turn: { roundNumber: 1, turnNumber: 1, turnOrder: [owner] },
        config,
        plan: { queues: {}, myQueue: [], committed: [] },
        fog: { visibleCells: cells.map(c => `${c.q},${c.r}`), lastSeen: [], revealed: false },
        artillery: null,
      };
    };

    const first = await fogScout.decide(build('player_a', false), utils, { owner: 'player_a' });
    const second = await fogScout.decide(build('player_b', true), utils, { owner: 'player_b' });
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    const mirror = rotate({ q: first.payload.q, r: first.payload.r }, 3);
    expect({ q: second.payload.q, r: second.payload.r }).toEqual(mirror);
  }, 15000);

  it('镜像合成视角下 decide 等变（与引擎光栅化无关）', async () => {
    // 半径 3 的完整棋盘；两座总部与单位互为 180°、据点在中轴与两侧对称。
    const cells: any[] = [];
    const radius = 3;
    for (let q = -radius; q <= radius; q++) {
      for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) {
        cells.push({ q, r, terrain: 'plain' });
      }
    }
    const config = {
      mode: 'fog',
      units: {
        scout: {
          hp: 60, attack: 16, defense: 4, moveRange: 3, attackRange: 1,
          cost: 42, canCapture: true,
        },
        infantry: {
          hp: 90, attack: 31, defense: 7, moveRange: 2, attackRange: 2,
          cost: 55, canCapture: true, attackShape: { type: 'line', length: 2 },
        },
      },
      balance: {
        actionsPerTurn: 4,
        attacksPerUnit: 1,
        minimumDamage: 1,
        deployFromHq: true,
        controlPointTypes: { repair: { income: 6, repairAmount: 10 } },
      },
      fog: { vision: { scout: 3, infantry: 2 }, revealFromRound: null },
    };
    const cp = { id: 'cp_center', kind: 'repair', q: 0, r: 0 };
    const visible = cells.map(cell => `${cell.q},${cell.r}`);
    const mirrorPos = (pos: Pos) => rotate(pos, 3);
    const hqOf = (owner: string) => ({
      ...(owner === 'player_a' ? { q: 2, r: 0 } : mirrorPos({ q: 2, r: 0 })),
      hp: 150, defense: 5, alive: true, owner,
    });
    const unitsOf = (owner: string) => {
      const flip = owner === 'player_a' ? (pos: Pos) => pos : mirrorPos;
      return [
        { id: `${owner}-scout`, owner, type: 'scout', ...flip({ q: 1, r: 0 }), hp: 60, maxHp: 60, alive: true, moveRange: 3, attackRange: 1, attack: 16, defense: 4, canCapture: true },
        { id: `${owner}-infantry`, owner, type: 'infantry', ...flip({ q: 1, r: 1 }), hp: 90, maxHp: 90, alive: true, moveRange: 2, attackRange: 2, attack: 31, defense: 7, canCapture: true },
      ];
    };
    const build = (owner: string) => {
      const other = owner === 'player_a' ? 'player_b' : 'player_a';
      return {
        id: 'synthetic-equiv', mapId: 'synthetic-equiv', phase: 'active', winner: null,
        map: { grid: 'hex', orientation: 'pointy', radius, terrainCells: [], cells: cells.map(c => ({ ...c })) },
        cells: cells.map(c => ({ ...c })),
        units: [...unitsOf(owner), ...unitsOf(other)],
        headquarters: { [owner]: hqOf(owner), [other]: hqOf(other) },
        controlPoints: [
          { ...cp, owner: null },
          { id: 'cp_a', kind: 'forward_base', q: 1, r: -1, owner: 'player_a' },
          { id: 'cp_b', kind: 'forward_base', q: -1, r: 1, owner: 'player_b' },
        ],
        players: {
          player_a: { status: 'active', name: 'A', turnOrder: 0 },
          player_b: { status: 'active', name: 'B', turnOrder: 1 },
        },
        playerNames: { player_a: 'A', player_b: 'B' },
        resources: { player_a: { supplies: 100 }, player_b: { supplies: 100 } },
        turn: { roundNumber: 1, turnNumber: 1, turnOrder: ['player_a', 'player_b'] },
        config,
        plan: { queues: {}, myQueue: [], committed: [] },
        fog: { visibleCells: visible, lastSeen: [], revealed: false },
        artillery: null,
      };
    };

    const a = build('player_a');
    const b = build('player_b');
    const first = await fogScout.decide(a, utils, { owner: 'player_a' });
    const second = await fogScout.decide(b, utils, { owner: 'player_b' });
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    // 同一决策再次调用必须一致（无随机源）。
    expect(await fogScout.decide(a, utils, { owner: 'player_a' })).toEqual(first);

    const mirror = rotate({ q: first.payload.q, r: first.payload.r }, 3);
    expect(second.type).toBe(first.type);
    expect(second.payload.q).toBe(mirror.q);
    expect(second.payload.r).toBe(mirror.r);
  }, 15000);
});
