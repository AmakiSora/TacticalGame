// tests/algorithms/shrinkroll-selfplay.test.ts
//
// 整局合法性回归：shrinkroll.decide() 返回的每个动作都必须被引擎接受。
// runner 在轮流模式收到拒绝会结束整个回合（algorithms/lib/interfaces.mjs），
// 所以这里按 bench 的真链路（快照 → decide → 引擎函数执行）跑整局，0 次被拒才算过。
import { describe, expect, it } from 'vitest';
// @ts-expect-error 算法模块为 ESM .mjs，无类型声明
import ace from '../../algorithms/builtin/shrinkroll.mjs';
// @ts-expect-error 工具库为 ESM .mjs，无类型声明
import * as utils from '../../algorithms/lib/game-utils.mjs';
import { createLobby, createLobbyWithConfig, addLobbyPlayer } from '../../src/state/store.js';
import { startGame, endTurn } from '../../src/engine/engine.js';
import { moveUnit } from '../../src/engine/units.js';
import { attackTarget, healTarget } from '../../src/engine/combat.js';
import { deployUnit } from '../../src/engine/deployment.js';
import { demolishTerrain } from '../../src/engine/demolition.js';
import { buildAdjudicationSnapshot } from '../../src/engine/engine.js';
import { globalEventBus } from '../../src/events/bus.js';
import { loadMaps } from '../../src/config/loader.js';
import { generateRandomMapConfig } from '../../src/config/randomMap.js';
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
  const { tokens: _t, hostToken: _h, rngState: _r, events: _e, ...rest } = game as unknown as Record<string, unknown>;
  return structuredClone({ ...rest, events: [], adjudication: buildAdjudicationSnapshot(game), viewer });
}

function newGame(id: string, mapId: string, seats: number, seed: number): GameState {
  const game = mapId === 'random'
    ? createLobbyWithConfig(id, 'random', generateRandomMapConfig({ seed, mode: 'annihilation' }, seats), { maxPlayers: seats, participate: false })
    : createLobby(id, mapId, { maxPlayers: seats, participate: false });
  for (let index = 0; index < seats; index++) addLobbyPlayer(game, `S${index}`);
  startGame(game, globalEventBus, mulberry32(seed));
  return game;
}

function applyAction(game: GameState, owner: PlayerId, action: { type: string; payload?: Record<string, unknown> }) {
  const payload = action.payload ?? {};
  switch (action.type) {
    case 'move': return moveUnit(game, globalEventBus, owner, String(payload.unitId), Number(payload.q), Number(payload.r));
    case 'attack': return attackTarget(game, globalEventBus, owner, String(payload.attackerId), String(payload.targetId));
    case 'heal': return healTarget(game, globalEventBus, owner, String(payload.supportId), String(payload.targetId));
    case 'deploy': return deployUnit(game, globalEventBus, owner, String(payload.unitType) as never, String(payload.fromId), Number(payload.q), Number(payload.r));
    case 'demolish': return demolishTerrain(game, globalEventBus, owner, String(payload.unitId), Number(payload.q), Number(payload.r));
    default: return { ok: false as const, code: 'unknown_action', message: action.type };
  }
}

async function playGame(mapId: string, seats: number, seed: number) {
  const game = newGame(`ace_${mapId}_${seats}_${seed}`, mapId, seats, seed);
  const illegal: string[] = [];
  const types = new Set<string>();
  let decisions = 0;
  let guard = 0;

  while (game.phase === 'active' && guard++ < 8000) {
    const owner = game.turn.currentPlayerId;
    if (!owner) break;
    const action = await ace.decide(viewOf(game, owner), utils, { owner }) as { type: string; payload?: Record<string, unknown> } | null;
    decisions++;
    if (!action) {
      endTurn(game, globalEventBus, owner);
      continue;
    }
    types.add(action.type);
    const result = applyAction(game, owner, action);
    if (!result.ok) {
      illegal.push(`${action.type}:${(result as { code?: string }).code}`);
      endTurn(game, globalEventBus, owner);
    }
  }
  return {
    illegal,
    types,
    decisions,
    finished: game.phase === 'game_over',
    rounds: game.turn.roundNumber,
    guardExceeded: guard >= 8000,
  };
}

describe('shrinkroll 整局零非法动作', () => {
  it('artillery-zone 2 人 × 8 seed', async () => {
    for (let seed = 1; seed <= 8; seed++) {
      const result = await playGame('artillery-zone', 2, seed);
      expect(result.illegal, `seed ${seed}`).toEqual([]);
      expect(result.finished, `seed ${seed} 未正常终局（round ${result.rounds}）`).toBe(true);
      expect(result.guardExceeded, `seed ${seed} 超出动作上限`).toBe(false);
      expect(result.types.size, `seed ${seed} 几乎没行动`).toBeGreaterThanOrEqual(2);
    }
  }, 240000);

  it('artillery-zone 3 人 × 4 seed', async () => {
    for (let seed = 11; seed <= 14; seed++) {
      const result = await playGame('artillery-zone', 3, seed);
      expect(result.illegal, `seed ${seed}`).toEqual([]);
      expect(result.finished, `seed ${seed} 未正常终局（round ${result.rounds}）`).toBe(true);
      expect(result.guardExceeded, `seed ${seed} 超出动作上限`).toBe(false);
    }
  }, 240000);

  it('artillery-zone 6 人 × 2 seed', async () => {
    for (let seed = 21; seed <= 22; seed++) {
      const result = await playGame('artillery-zone', 6, seed);
      expect(result.illegal, `seed ${seed}`).toEqual([]);
      expect(result.finished, `seed ${seed} 未正常终局（round ${result.rounds}）`).toBe(true);
      expect(result.guardExceeded, `seed ${seed} 超出动作上限`).toBe(false);
    }
  }, 240000);

  it('trench-run 2 人 × 8 seed', async () => {
    for (let seed = 31; seed <= 38; seed++) {
      const result = await playGame('trench-run', 2, seed);
      expect(result.illegal, `seed ${seed}`).toEqual([]);
      expect(result.finished, `seed ${seed} 未正常终局（round ${result.rounds}）`).toBe(true);
      expect(result.guardExceeded, `seed ${seed} 超出动作上限`).toBe(false);
    }
  }, 240000);

  it('随机歼灭图（2 人 / 3 人）各 4 seed', async () => {
    for (const [seats, seeds] of [[2, [41, 42, 43, 44]], [3, [51, 52, 53, 54]]] as const) {
      for (const seed of seeds) {
        const result = await playGame('random', seats, seed);
        expect(result.illegal, `${seats}p seed ${seed}`).toEqual([]);
        expect(result.finished, `${seats}p seed ${seed} 未正常终局（round ${result.rounds}）`).toBe(true);
        expect(result.guardExceeded, `${seats}p seed ${seed} 超出动作上限`).toBe(false);
      }
    }
  }, 300000);
});
