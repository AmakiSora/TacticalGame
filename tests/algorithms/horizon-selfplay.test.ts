// tests/algorithms/horizon-selfplay.test.ts
// 整局合法性回归：horizon 在真实 standoff / molten-throne 上自博弈，每个 decide 返回值都喂给
// 引擎入队校验，任何被拒动作都算失败；3 人 / 6 人 standoff 至少跑若干轮。
// 视界算法内部用 JS 分步结算镜像做规划，与引擎计划期语义若有偏差，会体现在越界移动、
// 形状不合法的瞄准、超 attacksPerUnit 的攻击或非法部署上，所以"整局零非法"是硬指标。
// 同时统计 3.8 分步语义的实际使用：同一单位一轮内跨行动点多次行动。
import { describe, expect, it } from 'vitest';
import { loadMaps } from '../../src/config/loader.js';
import { addLobbyPlayer, createLobby } from '../../src/state/store.js';
import { buildAdjudicationSnapshot, startGame } from '../../src/engine/engine.js';
import { commitAndMaybeResolve } from '../../src/engine/simultaneous.js';
import {
  queueAttackAction, queueDemolishAction, queueDeployAction, queueHealAction, queueMoveAction,
  queueWaitAction,
} from '../../src/engine/planning.js';
import { globalEventBus } from '../../src/events/bus.js';
// @ts-expect-error 算法模块为 ESM .mjs，无类型声明
import horizon from '../../algorithms/builtin/horizon.mjs';
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

/** 与 REST GET /api/games/:id 同口径的玩家视角：剥 rngState/token，计划只暴露 myQueue。 */
function view(game: any, owner: string) {
  const { rngState: _rng, tokens: _tokens, hostToken: _host, events, ...rest } = game;
  return {
    ...structuredClone(rest),
    events: structuredClone(events.slice(-120)),
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
    default: return { ok: false as const, code: 'unknown_action', message: action.type };
  }
}

async function playGame(mapId: string, players: number, seed: number, maxRounds: number) {
  const game: any = createLobby(`horizon-self-${mapId}-${players}-${seed}`, mapId, {
    maxPlayers: players,
    participate: true,
    playerName: 'P0',
  });
  for (let i = 1; i < players; i++) expect(addLobbyPlayer(game, `P${i}`)).not.toBeNull();
  expect(startGame(game, globalEventBus, mulberry32(seed)).ok).toBe(true);

  const illegal: string[] = [];
  let actions = 0;
  let multiStepUnits = 0;
  let rounds = 0;

  while (game.phase === 'active' && rounds < maxRounds) {
    rounds++;
    for (const seat of game.turn.turnOrder) {
      if (game.phase !== 'active') break;
      if (game.players[seat]?.status !== 'active') continue;
      if ((game.plan?.committed ?? []).includes(seat)) continue;
      for (let step = 0; step < 12; step++) {
        const action = await horizon.decide(view(game, seat), utils, { owner: seat });
        if (!action) break;
        const result = enqueue(game, seat, action);
        if (!result.ok) {
          illegal.push(`${seat}:r${game.turn.roundNumber}:${action.type}:${(result as any).code}`);
          break;
        }
        actions++;
      }
      const queue: any[] = game.plan?.queues?.[seat] ?? [];
      const perUnit = new Map<string, number>();
      for (const entry of queue) {
        const unitId = entry.unitId ?? entry.attackerId ?? entry.supportId;
        if (unitId) perUnit.set(unitId, (perUnit.get(unitId) ?? 0) + 1);
      }
      multiStepUnits += [...perUnit.values()].filter(n => n > 1).length;
    }
    if (game.phase !== 'active') break;
    for (const seat of game.turn.turnOrder) {
      if (game.players[seat]?.status !== 'active') continue;
      if ((game.plan?.committed ?? []).includes(seat)) continue;
      commitAndMaybeResolve(game, globalEventBus, seat);
      if (game.phase !== 'active') break;
    }
  }

  return { illegal, actions, multiStepUnits, finished: game.phase === 'game_over', rounds: game.turn.roundNumber };
}

describe('horizon 整局自博弈合法性', () => {
  it.each(['standoff', 'molten-throne'] as const)('%s 双人整局零非法动作并正常完赛', async (mapId) => {
    const result = await playGame(mapId, 2, 4242, 60);
    expect(result.illegal).toEqual([]);
    expect(result.finished).toBe(true);
    expect(result.rounds).toBeGreaterThan(3);
    expect(result.actions).toBeGreaterThan(20);
    // 3.8 分步语义：同一单位一轮内跨行动点多次行动（移动→攻击等）确实被用到。
    expect(result.multiStepUnits).toBeGreaterThan(0);
  }, 180000);

  it('standoff 3 人局连续多轮零非法动作', async () => {
    const result = await playGame('standoff', 3, 777, 5);
    expect(result.illegal).toEqual([]);
    expect(result.actions).toBeGreaterThan(20);
  }, 180000);

  it('standoff 6 人局连续多轮零非法动作', async () => {
    const result = await playGame('standoff', 6, 999, 3);
    expect(result.illegal).toEqual([]);
    expect(result.actions).toBeGreaterThan(20);
  }, 180000);
});
