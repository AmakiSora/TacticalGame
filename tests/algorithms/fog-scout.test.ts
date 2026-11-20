// tests/algorithms/fog-scout.test.ts
// 迷雾基线 fog-scout 的接口边界、决策合法性与只读投影约束。
//
// 重点不是「算法强不强」，而是：
// 1) 只消费服务端玩家投影（unitsForViewer / fogProjectionFor）而不偷看隐藏单位；
// 2) 每个 decide 返回的动作都能被引擎 planning.ts 入队校验接受（线上零非法）；
// 3) 2 人 fog-harbor 与 3 人 fog-crossing 都能推进，队列长度不超过 actionsPerTurn；
// 4) 残影盲射只在 lastSeen 格上发生，揭雾后不再盲射。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadMaps } from '../../src/config/loader.js';
import { addLobbyPlayer, createLobby } from '../../src/state/store.js';
import { startGame } from '../../src/engine/engine.js';
import { commitAndMaybeResolve } from '../../src/engine/simultaneous.js';
import {
  queueAttackAction, queueDeployAction, queueHealAction, queueMoveAction, queueWaitAction,
} from '../../src/engine/planning.js';
import { fogProjectionFor, unitsForViewer } from '../../src/engine/fog.js';
import { EventBus } from '../../src/events/bus.js';
// @ts-expect-error 算法模块为 ESM .mjs，无类型声明
import fogScout from '../../algorithms/builtin/fog-scout.mjs';
// @ts-expect-error 工具库为 ESM .mjs，无类型声明
import * as utils from '../../algorithms/lib/game-utils.mjs';

loadMaps();

const key = (pos: { q: number; r: number }) => `${pos.q},${pos.r}`;

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

/** 与线上 sanitizeGameForResponse 的 fog 玩家分支同口径的视角快照。 */
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
    controlPoints: (game.controlPoints || []).map((point: any) => ({ ...point })),
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
  const p = action.payload || {};
  switch (action.type) {
    case 'attack': return queueAttackAction(game, owner as never, p.attackerId, p.q, p.r);
    case 'heal': return queueHealAction(game, owner as never, p.supportId, p.q, p.r);
    case 'move': return queueMoveAction(game, owner as never, p.unitId, p.q, p.r);
    case 'deploy': return queueDeployAction(game, owner as never, p.unitType, p.fromId, p.q, p.r);
    case 'wait': return queueWaitAction(game, owner as never);
    default: return { ok: false as const, code: 'unknown_action', message: action.type };
  }
}

function makeGame(mapId: string, players: number, seed: number) {
  const game = createLobby(`fog-scout-${mapId}-${seed}`, mapId, {
    maxPlayers: players, participate: true, playerName: 'A',
  });
  for (let index = 1; index < players; index++) {
    expect(addLobbyPlayer(game, `P${index}`)).not.toBeNull();
  }
  const started = startGame(game, new EventBus(), mulberry32(seed));
  expect(started.ok).toBe(true);
  return game;
}

interface PlayResult {
  illegal: string[];
  actions: number;
  attacks: { owner: string; q: number; r: number; allowed: Set<string> }[];
  rounds: number;
  finished: boolean;
  perSeat: Record<string, number>;
  maxQueue: number;
  actionLimit: number;
}

/** 按真实引擎计划/提交循环跑一局（或 maxRounds 轮），每个动作都过入队校验。 */
async function play(
  mapId: string,
  players: number,
  seed: number,
  maxRounds = Infinity,
): Promise<PlayResult> {
  const game = makeGame(mapId, players, seed);
  const illegal: string[] = [];
  const attacks: PlayResult['attacks'] = [];
  const perSeat: Record<string, number> = {};
  let actions = 0;
  let passes = 0;
  let maxQueue = 0;
  const ap = game.config.balance.actionsPerTurn;

  while (game.phase === 'active' && passes++ < 500) {
    for (const seat of game.turn.turnOrder) {
      if (game.phase !== 'active') break;
      if (game.players[seat]?.status !== 'active') continue;
      if ((game.plan?.committed ?? []).includes(seat)) continue;

      for (let step = 0; step < ap + 2; step++) {
        if (game.phase !== 'active') break;
        if ((game.plan?.committed ?? []).includes(seat)) break;
        const snapshot = view(game, seat);
        const allowed = new Set<string>();
        for (const unit of snapshot.units) {
          if (unit.alive && unit.owner !== seat) allowed.add(key(unit));
        }
        for (const hq of Object.values(snapshot.headquarters) as any[]) {
          if (hq.alive && hq.owner !== seat) allowed.add(key(hq));
        }
        for (const sighting of snapshot.fog.lastSeen) allowed.add(key(sighting));

        const action = await fogScout.decide(snapshot, utils, { owner: seat });
        if (!action) break;
        if (action.type === 'wait') {
          illegal.push(`${seat}:unexpected_wait`);
          break;
        }
        if (action.type === 'attack') {
          // 攻击只允许瞄准：可见敌军 / 公开总部 / 残影格。
          if (!allowed.has(key(action.payload))) {
            illegal.push(`${seat}:attack_unpriced:${key(action.payload)}`);
            break;
          }
          attacks.push({ owner: seat, ...action.payload, allowed });
        }
        const result = enqueue(game, seat, action);
        if (!result.ok) {
          illegal.push(`${seat}:${action.type}:${result.code ?? 'unknown'}`);
          break;
        }
        actions++;
        perSeat[seat] = (perSeat[seat] ?? 0) + 1;
        maxQueue = Math.max(maxQueue, game.plan?.queues?.[seat]?.length ?? 0);
      }
    }

    if (game.phase !== 'active') break;
    if (game.turn.roundNumber > maxRounds) break;

    const roundBefore = game.turn.roundNumber;
    for (const seat of game.turn.turnOrder) {
      if (game.phase !== 'active') break;
      if (game.players[seat]?.status !== 'active') continue;
      if ((game.plan?.committed ?? []).includes(seat)) continue;
      const committed = commitAndMaybeResolve(game, new EventBus(), seat);
      if (!committed.ok) {
        illegal.push(`${seat}:commit:${committed.code ?? 'unknown'}`);
        break;
      }
      if (game.turn.roundNumber !== roundBefore) break;
    }
  }

  return {
    illegal, actions, attacks,
    rounds: game.turn.roundNumber,
    finished: game.phase === 'game_over',
    perSeat, maxQueue, actionLimit: ap,
  };
}

describe('fog-scout 接口边界', () => {
  it('只在 fog 模式、进行中、未提交且有行动点时决策', async () => {
    const game = makeGame('fog-harbor', 2, 11);
    const seat = game.turn.turnOrder[0];

    // 非 fog 模式：直接拒绝，避免被别的模式误用。
    const nonFog = view(game, seat);
    nonFog.config = { ...nonFog.config, mode: 'standard' };
    expect(await fogScout.decide(nonFog, utils, { owner: seat })).toBeNull();

    // 缺 owner：同时回合没有 currentPlayerId，必须由 ctx 提供。
    expect(await fogScout.decide(view(game, seat), utils, {})).toBeNull();

    // 已提交：无事可做。
    game.plan.committed.push(seat);
    expect(await fogScout.decide(view(game, seat), utils, { owner: seat })).toBeNull();
    game.plan.committed.pop();

    // 行动点用尽：返回 null 让 runner 提交。
    const ap = game.config.balance.actionsPerTurn;
    game.plan!.queues[seat] = [];
    for (let i = 0; i < ap; i++) game.plan!.queues[seat]!.push({ id: `q${i}`, type: 'wait' });
    expect(await fogScout.decide(view(game, seat), utils, { owner: seat })).toBeNull();
  });

  it('同一视角两次决策完全一致（无随机源）', async () => {
    const game = makeGame('fog-harbor', 2, 12);
    const seat = game.turn.turnOrder[0];
    const first = await fogScout.decide(view(game, seat), utils, { owner: seat });
    const second = await fogScout.decide(view(game, seat), utils, { owner: seat });
    expect(first).toEqual(second);
    expect(first).toBeTruthy();
  });

  it('只读投影：源码不触碰全量/旁路接口', () => {
    const source = readFileSync('algorithms/builtin/fog-scout.mjs', 'utf8');
    for (const forbidden of [
      'unitsForViewer', 'allUnitsForFullView', 'fogProjectionFor', 'getGameIndex',
      'rngState', 'spectatorToken', 'tokens', 'idempotency',
    ]) {
      expect(source, `must not reference ${forbidden}`).not.toContain(forbidden);
    }
    // 可见敌军只来自 game.units（服务端已投影）。
    expect(source).toContain('game.units');
  });
});

describe('fog-scout 决策合法性', () => {
  it.each([
    ['fog-harbor', 2, 21],
    ['fog-crossing', 3, 22],
  ] as const)('%s %ip 整轮零非法、队列不超行动点', async (mapId, players, seed) => {
    const result = await play(mapId, players, seed, 2);
    expect(result.illegal).toEqual([]);
    expect(result.actions).toBeGreaterThan(0);
    // 每轮队列长度不超过地图 balance.actionsPerTurn。
    expect(result.maxQueue).toBeLessThanOrEqual(result.actionLimit);
    // 每个座位都实际入过队（至少移动/部署/攻击）。
    for (const seat of Object.keys(result.perSeat)) {
      expect(result.perSeat[seat], seat).toBeGreaterThan(0);
    }
    expect(result.rounds).toBeGreaterThanOrEqual(2);
  }, 60000);

  it('2 人 fog-harbor 打完整局：零非法并正常收口', async () => {
    const result = await play('fog-harbor', 2, 31);
    expect(result.illegal).toEqual([]);
    expect(result.finished).toBe(true);
    expect(result.rounds).toBeGreaterThan(3);
    expect(result.actions).toBeGreaterThan(20);
  }, 120000);

  it('3 人 fog-crossing 打完整局：三座位均出手、零非法', async () => {
    const result = await play('fog-crossing', 3, 32);
    expect(result.illegal).toEqual([]);
    expect(result.finished).toBe(true);
    expect(result.rounds).toBeGreaterThan(3);
    expect(Object.keys(result.perSeat).sort()).toEqual(['player_a', 'player_b', 'player_c']);
  }, 120000);

  it('所有攻击都瞄准可见敌军、公开总部或残影格', async () => {
    const result = await play('fog-crossing', 3, 33, 6);
    expect(result.illegal).toEqual([]);
    expect(result.attacks.length).toBeGreaterThan(0);
    for (const attack of result.attacks) {
      expect(attack.allowed.has(key(attack)), `${attack.owner} aimed at ${key(attack)}`).toBe(true);
    }
  }, 120000);
});

describe('fog-scout 残影与揭雾', () => {
  /** 构造最小投影视角：一张 2 格平地、1 个侦察兵、无总部/据点，便于精确断言。 */
  function syntheticView(options: { revealed: boolean }) {
    const config = {
      mode: 'fog',
      units: {
        scout: {
          hp: 60, attack: 16, defense: 4, moveRange: 3, attackRange: 1,
          cost: 42, canCapture: true,
        },
      },
      balance: {
        actionsPerTurn: 6,
        attacksPerUnit: 1,
        minimumDamage: 1,
        controlPointTypes: {},
      },
      fog: { vision: { scout: 4, ranger: 3, infantry: 2, support: 2, heavy: 1 }, revealFromRound: null },
    };
    return {
      id: 'synthetic', mapId: 'synthetic', phase: 'active', winner: null,
      map: {
        grid: 'hex', orientation: 'pointy', radius: 2, terrainCells: [],
        cells: [
          { q: 0, r: 0, terrain: 'plain' },
          { q: 1, r: 0, terrain: 'plain' },
        ],
      },
      cells: [
        { q: 0, r: 0, terrain: 'plain' },
        { q: 1, r: 0, terrain: 'plain' },
      ],
      units: [{
        id: 's1', owner: 'player_a', type: 'scout', q: 0, r: 0,
        hp: 60, maxHp: 60, defense: 4, attack: 16, moveRange: 3, attackRange: 1,
        canCapture: true, alive: true,
      }],
      headquarters: {},
      controlPoints: [],
      players: {
        player_a: { status: 'active' },
        player_b: { status: 'active' },
      },
      playerNames: { player_a: 'A', player_b: 'B' },
      resources: { player_a: { supplies: 0 }, player_b: { supplies: 0 } },
      turn: {
        roundNumber: 1, phase: 'active', actionsUsed: 0, turnOrder: ['player_a', 'player_b'],
        currentPlayerId: null, currentOwner: null, actedThisRound: [],
      },
      config,
      plan: { queues: {}, myQueue: [], committed: [] },
      fog: {
        enabled: true,
        revealed: options.revealed,
        visibleCells: ['0,0'],
        lastSeen: [{
          unitId: 'ghost', owner: 'player_b', type: 'ranger',
          q: 1, r: 0, hp: 40, maxHp: 68, seenRound: 1,
        }],
      },
      artillery: null,
    };
  }

  it('残影格上盲射：没有可见敌军时仍会瞄准 lastSeen 格', async () => {
    const action = await fogScout.decide(syntheticView({ revealed: false }), utils, { owner: 'player_a' });
    expect(action).toEqual({ type: 'attack', payload: { attackerId: 's1', q: 1, r: 0 } });
  });

  it('揭雾后不再对残影格盲射', async () => {
    const action = await fogScout.decide(syntheticView({ revealed: true }), utils, { owner: 'player_a' });
    // 揭雾视角下 lastSeen 应视为空；唯一可行的是移动，但残影格仍被排除 → 无动作。
    expect(action).toBeNull();
  });
});
