// tests/algorithms/fog-scout-selfplay.test.ts
// fog-scout 整局自对局回归：真实引擎 + 玩家视角投影，两张首批迷雾图各跑 1 局。
// 与 scripts/fog-selfplay.mjs 同口径（脚本可重复跑任意局数；这里只钉最小回归）。
// 任何被 planning.ts 拒绝的动作都算失败——线上 runner 遇拒会空耗重问配额。
import { describe, expect, it } from 'vitest';
import { loadMaps } from '../../src/config/loader.js';
import { addLobbyPlayer, createLobby } from '../../src/state/store.js';
import { startGame } from '../../src/engine/engine.js';
import { commitAndMaybeResolve } from '../../src/engine/simultaneous.js';
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
    default: return { ok: false as const, code: 'unknown_action', message: action.type };
  }
}

async function selfplay(mapId: string, players: number, seed: number) {
  const game = createLobby(`fog-scout-selfplay-${mapId}-${seed}`, mapId, {
    maxPlayers: players, participate: true, playerName: 'A',
  });
  for (let index = 1; index < players; index++) {
    expect(addLobbyPlayer(game, `P${index}`)).not.toBeNull();
  }
  const bus = new EventBus();
  expect(startGame(game, bus, mulberry32(seed)).ok).toBe(true);

  const illegal: string[] = [];
  const perSeat: Record<string, number> = {};
  let actions = 0;
  let passes = 0;
  const ap = game.config.balance.actionsPerTurn;

  while (game.phase === 'active' && passes++ < 500) {
    for (const seat of game.turn.turnOrder) {
      if (game.phase !== 'active') break;
      if (game.players[seat]?.status !== 'active') continue;
      if ((game.plan?.committed ?? []).includes(seat)) continue;
      for (let step = 0; step < ap + 2; step++) {
        if (game.phase !== 'active') break;
        if ((game.plan?.committed ?? []).includes(seat)) break;
        const action = await fogScout.decide(view(game, seat), utils, { owner: seat });
        if (!action) break;
        const result = enqueue(game, seat, action);
        if (!result.ok) {
          illegal.push(`${seat}:${action.type}:${result.code ?? 'unknown'}`);
          break;
        }
        actions++;
        perSeat[seat] = (perSeat[seat] ?? 0) + 1;
      }
    }

    if (game.phase !== 'active') break;
    const roundBefore = game.turn.roundNumber;
    for (const seat of game.turn.turnOrder) {
      if (game.phase !== 'active') break;
      if (game.players[seat]?.status !== 'active') continue;
      if ((game.plan?.committed ?? []).includes(seat)) continue;
      const committed = commitAndMaybeResolve(game, bus, seat);
      if (!committed.ok) {
        illegal.push(`${seat}:commit:${committed.code ?? 'unknown'}`);
        break;
      }
      if (game.turn.roundNumber !== roundBefore) break;
    }
  }

  return {
    illegal, actions, finished: game.phase === 'game_over',
    reason: game.result?.reason ?? null,
    rounds: game.turn.roundNumber,
    perSeat,
  };
}

describe('fog-scout 自对局整局回归', () => {
  it('fog-harbor 2 人整局完赛且零非法', async () => {
    const result = await selfplay('fog-harbor', 2, 20261120);
    expect(result.illegal).toEqual([]);
    expect(result.finished).toBe(true);
    expect(result.reason).not.toBeNull();
    expect(result.rounds).toBeGreaterThan(3);
    expect(result.actions).toBeGreaterThan(20);
    expect(Object.keys(result.perSeat).sort()).toEqual(['player_a', 'player_b']);
  }, 120000);

  it('fog-crossing 3 人整局完赛且零非法', async () => {
    const result = await selfplay('fog-crossing', 3, 20261121);
    expect(result.illegal).toEqual([]);
    expect(result.finished).toBe(true);
    expect(result.reason).not.toBeNull();
    expect(result.rounds).toBeGreaterThan(3);
    expect(Object.keys(result.perSeat).sort()).toEqual(['player_a', 'player_b', 'player_c']);
  }, 120000);
});
