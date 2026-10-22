// tests/algorithms/kriegspiel-selfplay.test.ts
// 整局合法性回归：kriegspiel 在真实 standoff / molten-throne 上互相对弈，
// 每个 decide 返回值都喂给引擎入队校验；任何非法动作都算失败。
// 兵棋推演算法内部用 JS 分步结算器做 rollout，与引擎语义若有偏差会体现在
// 计划里的非法目的格/越界部署/超攻击上限上，所以"整局零非法"是硬指标。
import { describe, expect, it } from 'vitest';
import { loadMaps } from '../../src/config/loader.js';
import { addLobbyPlayer, createLobby } from '../../src/state/store.js';
import { startGame } from '../../src/engine/engine.js';
import { commitAndMaybeResolve } from '../../src/engine/simultaneous.js';
import {
  queueAttackAction, queueDemolishAction, queueDeployAction, queueHealAction, queueMoveAction,
  queueWaitAction,
} from '../../src/engine/planning.js';
import { globalEventBus } from '../../src/events/bus.js';
// @ts-expect-error 算法模块为 ESM .mjs，无类型声明
import kriegspiel from '../../algorithms/builtin/kriegspiel.mjs';
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
  return {
    id: game.id, phase: game.phase, winner: game.winner,
    cells: game.cells, map: { terrainCells: game.map.terrainCells },
    units: game.units.map((unit: any) => ({ ...unit })),
    headquarters: Object.fromEntries(Object.entries(game.headquarters).map(([id, hq]: [string, any]) => [id, { ...hq }])),
    controlPoints: (game.controlPoints || []).map((point: any) => ({ ...point })),
    players: Object.fromEntries(Object.entries(game.players).map(([id, player]: [string, any]) => [id, { status: player.status }])),
    playerNames: game.playerNames,
    resources: structuredClone(game.resources),
    turn: { ...game.turn },
    config: game.config,
    plan: {
      queues: {},
      committed: [...(game.plan?.committed ?? [])],
      myQueue: [...(game.plan?.queues?.[owner] ?? [])],
    },
    artillery: game.artillery ? structuredClone(game.artillery) : null,
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
    default: return { ok: false as const, code: 'unknown_action', message: action.type };
  }
}

async function playGame(mapId: string, seed: number) {
  const game = createLobby(`kriegspiel-self-${mapId}-${seed}`, mapId, {
    maxPlayers: 2,
    participate: true,
    playerName: 'A',
  });
  expect(addLobbyPlayer(game, 'B')).not.toBeNull();
  expect(startGame(game, globalEventBus, mulberry32(seed)).ok).toBe(true);

  const illegal: string[] = [];
  let actions = 0;
  let guard = 0;

  while (game.phase === 'active' && guard++ < 40) {
    for (const seat of game.turn.turnOrder) {
      if (game.phase !== 'active') break;
      if (game.players[seat]?.status !== 'active') continue;
      if ((game.plan?.committed ?? []).includes(seat)) continue;

      for (let step = 0; step < 12; step++) {
        const action = await kriegspiel.decide(view(game, seat), utils, { owner: seat });
        if (!action) break;
        const result = enqueue(game, seat, action);
        if (!result.ok) {
          illegal.push(`${seat}:${action.type}:${(result as any).code}`);
          break;
        }
        actions++;
      }
    }

    if (game.phase !== 'active') break;
    for (const seat of game.turn.turnOrder) {
      if (game.players[seat]?.status !== 'active') continue;
      if ((game.plan?.committed ?? []).includes(seat)) continue;
      commitAndMaybeResolve(game, globalEventBus, seat);
      if (game.phase !== 'active') break;
    }
  }

  return { illegal, actions, finished: game.phase === 'game_over', rounds: game.turn.roundNumber };
}

describe('kriegspiel 整局自博弈合法性', () => {
  it.each(['standoff', 'molten-throne'] as const)('%s 整局零非法动作并正常完赛', async (mapId) => {
    const result = await playGame(mapId, 4242);
    expect(result.illegal).toEqual([]);
    expect(result.finished).toBe(true);
    expect(result.rounds).toBeGreaterThan(3);
    expect(result.actions).toBeGreaterThan(20);
  }, 120000);
});
