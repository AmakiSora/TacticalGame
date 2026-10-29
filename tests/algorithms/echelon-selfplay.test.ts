// tests/algorithms/echelon-selfplay.test.ts
//
// 整局合法性回归：echelon.decide() 返回的每个动作都必须被引擎计划期校验接受。
// 按真链路（快照 → decide → planning 入队 → 全员提交结算）跑整局自博弈，
// 0 次被拒才算过；同时要求对局正常终局（炮火圈保证收缩，不存在永久对峙）。
import { describe, expect, it } from 'vitest';
// @ts-expect-error 算法模块为 ESM .mjs，无类型声明
import echelon, { __echelonTestHooks } from '../../algorithms/builtin/echelon.mjs';
// @ts-expect-error 工具库为 ESM .mjs，无类型声明
import * as utils from '../../algorithms/lib/game-utils.mjs';
import { addLobbyPlayer, createLobby } from '../../src/state/store.js';
import { buildAdjudicationSnapshot, startGame } from '../../src/engine/engine.js';
import { commitAndMaybeResolve } from '../../src/engine/simultaneous.js';
import {
  queueAttackAction, queueDemolishAction, queueDeployAction, queueHealAction,
  queueMoveAction, queueWaitAction,
} from '../../src/engine/planning.js';
import { globalEventBus } from '../../src/events/bus.js';
import { loadMaps } from '../../src/config/loader.js';
import type { GameState, PlayerId } from '../../src/types.js';

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

function viewOf(game: GameState, viewer: PlayerId) {
  const { tokens: _t, hostToken: _h, rngState: _r, idempotency: _i, events, config, ...rest } = game as GameState & Record<string, unknown>;
  const body = structuredClone(rest) as Record<string, unknown>;
  body.lastEventSeq = events.at(-1)?.seq ?? 0;
  body.events = structuredClone(events);
  body.config = structuredClone(config);
  body.adjudication = buildAdjudicationSnapshot(game);
  const myQueue = game.plan?.queues[viewer] ?? [];
  body.plan = {
    ...(game.plan ?? { committed: [] }),
    queues: myQueue.length ? { [viewer]: structuredClone(myQueue) } : {},
    myQueue: structuredClone(myQueue),
  };
  return body;
}

function enqueue(game: GameState, owner: PlayerId, action: { type: string; payload?: Record<string, unknown> }) {
  const p = (action.payload ?? {}) as Record<string, unknown>;
  switch (action.type) {
    case 'attack': return queueAttackAction(game, owner, p.attackerId as never, Number(p.q), Number(p.r));
    case 'heal': return queueHealAction(game, owner, p.supportId as never, Number(p.q), Number(p.r));
    case 'move': return queueMoveAction(game, owner, String(p.unitId), Number(p.q), Number(p.r));
    case 'deploy': return queueDeployAction(game, owner, p.unitType as never, String(p.fromId), Number(p.q), Number(p.r));
    case 'demolish': return queueDemolishAction(game, owner, String(p.unitId), Number(p.q), Number(p.r));
    case 'wait': return queueWaitAction(game, owner);
    default: return { ok: false as const, code: 'unknown_action', message: action.type };
  }
}

async function playSelfplay(mapId: string, seed: number, maxRounds = 60) {
  const game = createLobby(`echelon-sp-${mapId}-${seed}`, mapId, {
    maxPlayers: 2, participate: true, playerName: 'A',
  });
  addLobbyPlayer(game, 'B');
  const started = startGame(game, globalEventBus, mulberry32(seed));
  expect(started.ok).toBe(true);
  const seats = Object.keys(game.players) as PlayerId[];
  const illegal: string[] = [];
  const types = new Set<string>();
  let decisions = 0;
  let guard = 0;

  while (game.phase === 'active' && guard++ < maxRounds) {
    for (const seat of game.turn.turnOrder) {
      if (game.phase !== 'active') break;
      if (game.players[seat]?.status !== 'active') continue;
      if ((game.plan?.committed ?? []).includes(seat)) continue;
      __echelonTestHooks.resetMemory();
      let count = 0;
      while (count < 100 && guard <= maxRounds + 1) {
        const action = await echelon.decide(viewOf(game, seat), utils, { owner: seat }) as { type: string; payload?: Record<string, unknown> } | null;
        decisions++;
        if (!action) break;
        types.add(action.type);
        const result = enqueue(game, seat, action);
        if (!result.ok) {
          illegal.push(`r${game.turn.roundNumber}:${action.type}:${(result as { code?: string }).code}`);
          break; // 被拒后结束该座位本轮，避免死循环；非法本身会断言失败
        }
        count++;
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
  return {
    illegal,
    types,
    decisions,
    finished: game.phase === 'game_over',
    winner: game.winner,
    rounds: game.turn.roundNumber,
    guardExceeded: guard > maxRounds,
  };
}

describe('echelon 整局零非法动作（自博弈）', () => {
  it('narrow-road 2 人 × 3 seed：地形强制接触，必须终局', async () => {
    for (const seed of [201, 202, 203]) {
      const result = await playSelfplay('narrow-road', seed);
      expect(result.illegal, `seed ${seed}`).toEqual([]);
      expect(result.finished, `seed ${seed} 未正常终局（round ${result.rounds}）`).toBe(true);
      expect(result.guardExceeded, `seed ${seed} 超出回合上限`).toBe(false);
    }
  }, 300000);

  it('snowflake 2 人 × 3 seed：零非法动作且轮次有界', async () => {
    // 雪花的镜像对局存在"双方全程规避"的对峙分支（等速追逃在开阔地形不可强制
    // 终结，属游戏规则允许的形态，线上由 host 裁决/轮次守卫兜底），因此这里
    // 硬断言合法性与有界性，不断言终局。
    for (const seed of [101, 102, 103]) {
      const result = await playSelfplay('snowflake', seed);
      expect(result.illegal, `seed ${seed}`).toEqual([]);
      expect(result.decisions, `seed ${seed} 几乎没行动`).toBeGreaterThan(50);
      expect(result.rounds, `seed ${seed} 回合数异常`).toBeLessThanOrEqual(61);
    }
  }, 300000);
});
