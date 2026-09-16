// tests/algorithms/field-selfplay.test.ts
//
// 合法性回归：field.decide() 返回的每个动作都必须被引擎接受。
// 线上 runner 遇到动作失败会 break 掉整个回合（algorithms/lib/interfaces.mjs），
// "返回非法动作"等于白丢行动点（threat 初版 20 局里 15 局出现过）。
import { describe, expect, it } from 'vitest';
// @ts-expect-error 算法模块为 ESM .mjs，无类型声明
import field from '../../algorithms/builtin/field.mjs';
// @ts-expect-error 工具库为 ESM .mjs，无类型声明
import * as utils from '../../algorithms/lib/game-utils.mjs';
import { createLobby, createLobbyWithConfig, addLobbyPlayer } from '../../src/state/store.js';
import { startGame, endTurn } from '../../src/engine/engine.js';
import { moveUnit } from '../../src/engine/units.js';
import { attackTarget, healTarget } from '../../src/engine/combat.js';
import { deployUnit } from '../../src/engine/deployment.js';
import { demolishTerrain } from '../../src/engine/demolition.js';
import { globalEventBus } from '../../src/events/bus.js';
import { loadMaps } from '../../src/config/loader.js';
import { generateRandomMapConfig } from '../../src/config/randomMap.js';

loadMaps();

/** 可复现随机源：同 seed → 同随机地图、同掷骰序列。 */
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

function newGame(id: string, mapId: string, seed: number) {
  const seats = { maxPlayers: 2, participate: false };
  const game = mapId === 'random'
    ? createLobbyWithConfig(id, 'random', generateRandomMapConfig({ seed }, 2), seats)
    : createLobby(id, mapId, seats);
  addLobbyPlayer(game, 'field');
  addLobbyPlayer(game, 'opponent');
  startGame(game, globalEventBus, mulberry32(seed));
  return game as unknown as Record<string, any>;
}

/** 客户端视角的状态快照：算法只应看到 API 会给它的字段。 */
function view(game: Record<string, any>) {
  return {
    id: game.id, phase: game.phase, winner: game.winner,
    cells: game.cells, map: { terrainCells: game.map.terrainCells },
    units: game.units.map((u: any) => ({ ...u })),
    headquarters: Object.fromEntries(Object.entries(game.headquarters).map(([k, h]: any) => [k, { ...h }])),
    controlPoints: (game.controlPoints || []).map((p: any) => ({ ...p })),
    players: Object.fromEntries(Object.entries(game.players).map(([k, p]: any) => [k, { status: p.status }])),
    playerNames: game.playerNames,
    resources: structuredClone(game.resources),
    turn: { ...game.turn },
    config: game.config,
  };
}

/** 对手席位的最简合法驱动：有行动点且射程内有敌就打，否则结束回合。 */
function opponentAction(game: Record<string, any>, owner: string) {
  if (utils.actionsRemaining(game) <= 0) return null;
  for (const u of utils.livingUnits(game, owner)) {
    if (u.hasActed) continue;
    const target = utils.bestAttackTarget(game, owner, u);
    return target
      ? { type: 'attack', payload: { attackerId: u.id, targetId: target.entity.id } }
      : null;
  }
  return null;
}

/** 跑一整局，收集 field 席位被引擎拒绝的动作。 */
async function playGame(mapId: string, seed: number, fieldSeat: string) {
  const game = newGame(`legal_field_${mapId}_${seed}`, mapId, seed);
  const illegal: string[] = [];
  const types = new Set<string>();
  let guard = 0;

  while (game.phase === 'active' && guard++ < 4000) {
    const owner = game.turn.currentPlayerId;
    if (!owner) break;
    const action = owner === fieldSeat
      ? await field.decide(view(game), utils)
      : opponentAction(view(game), owner);
    if (!action) {
      endTurn(game, globalEventBus, owner);
      continue;
    }
    types.add(action.type);
    const p = action.payload || {};
    const result = action.type === 'move'
      ? moveUnit(game, globalEventBus, owner, p.unitId, p.q, p.r)
      : action.type === 'attack'
        ? attackTarget(game, globalEventBus, owner, p.attackerId, p.targetId)
        : action.type === 'heal'
          ? healTarget(game, globalEventBus, owner, p.supportId, p.targetId)
          : action.type === 'deploy'
            ? deployUnit(game, globalEventBus, owner, p.unitType, p.fromId, p.q, p.r)
            : action.type === 'demolish'
              ? demolishTerrain(game, globalEventBus, owner, p.unitId, p.q, p.r)
              : { ok: false as const, code: 'unknown_action', message: action.type };
    if (!result.ok) {
      illegal.push(`${action.type}:${(result as any).code}`);
      endTurn(game, globalEventBus, owner);
    }
  }
  return { finished: game.phase === 'game_over', rounds: game.turn.roundNumber, illegal, types };
}

describe('field 自博弈合法性（decide 不得返回引擎拒绝的动作）', () => {
  it.each([
    ['default', 'player_a'],
    ['breach', 'player_b'],
    ['desert', 'player_a'],
    ['dual-lanes', 'player_b'],
  ] as const)('%s 地图整局零非法动作', async (mapId, seat) => {
    const r = await playGame(mapId, 4242, seat);
    expect(r.illegal).toEqual([]);
    expect(r.finished).toBe(true);
    expect(r.rounds).toBeGreaterThan(3);
    // 确实打出了动作，而不是全程空转"侥幸合法"
    expect(r.types.size).toBeGreaterThanOrEqual(2);
  }, 120000);

  it('随机地图（回合数与裁定权重都被随机化）同样合法', async () => {
    const r = await playGame('random', 77, 'player_a');
    expect(r.illegal).toEqual([]);
    expect(r.finished).toBe(true);
  }, 120000);

  it('兵力清零时仍会补员，而不是交空回合', async () => {
    const game = newGame('wipe_field', 'default', 999);
    game.units.length = 0;
    game.turn.currentPlayerId = 'player_a';
    game.turn.currentOwner = 'player_a';
    game.turn.actionsUsed = 0;
    game.resources.player_a.supplies = 200;

    const action = await field.decide(view(game), utils);

    expect(action).not.toBeNull();
    expect(action!.type).toBe('deploy');
  });
});
