// tests/algorithms/crucible.test.ts
//
// 熔炉算法（crucible）回归：接口/模式隔离、整局合法性（零拒绝）、
// 空场随机图部署回归、集火斩杀、危险区疏散、部署补刀 id 解析、确定性。
import { describe, expect, it } from 'vitest';
// @ts-expect-error 算法模块为 ESM .mjs，无类型声明
import crucible from '../../algorithms/builtin/crucible.mjs';
// @ts-expect-error 工具库为 ESM .mjs，无类型声明
import * as utils from '../../algorithms/lib/game-utils.mjs';
// @ts-expect-error 随机基线为 ESM .mjs，无类型声明
import randomAnnihilation from '../../algorithms/builtin/random-annihilation.mjs';
import { createLobby, createLobbyWithConfig, addLobbyPlayer } from '../../src/state/store.js';
import { startGame, endTurn, updateArtilleryForRound } from '../../src/engine/engine.js';
import { moveUnit } from '../../src/engine/units.js';
import { attackTarget, healTarget } from '../../src/engine/combat.js';
import { deployUnit } from '../../src/engine/deployment.js';
import { demolishTerrain } from '../../src/engine/demolition.js';
import { globalEventBus } from '../../src/events/bus.js';
import { loadMaps } from '../../src/config/loader.js';
import { generateRandomMapConfig } from '../../src/config/randomMap.js';
import type { GameState, PlayerId } from '../../src/types.js';

loadMaps();

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function newGame(id: string, mapId: string, seed: number): GameState {
  const game = createLobby(id, mapId, { maxPlayers: 2, participate: false });
  addLobbyPlayer(game, 'A');
  addLobbyPlayer(game, 'B');
  startGame(game, globalEventBus, mulberry32(seed));
  // 场景测试固定 player_a 先手，避免随机先手干扰断言
  game.turn.turnOrder = ['player_a', 'player_b'];
  game.turn.currentPlayerId = 'player_a';
  game.turn.currentOwner = 'player_a';
  return game;
}

function applyAction(game: GameState, owner: PlayerId, action: { type: string; payload?: Record<string, unknown> }) {
  const p = (action.payload ?? {}) as Record<string, any>;
  switch (action.type) {
    case 'move': return moveUnit(game, globalEventBus, owner, p.unitId, p.q, p.r);
    case 'attack': return attackTarget(game, globalEventBus, owner, p.attackerId, p.targetId);
    case 'heal': return healTarget(game, globalEventBus, owner, p.supportId, p.targetId);
    case 'deploy': return deployUnit(game, globalEventBus, owner, p.unitType, p.fromId, p.q, p.r);
    case 'demolish': return demolishTerrain(game, globalEventBus, owner, p.unitId, p.q, p.r);
    default: return { ok: false, code: 'unknown_type', message: 'unknown' };
  }
}

async function playTurn(game: GameState, owner: PlayerId, algo: any): Promise<number> {
  let rejects = 0;
  for (let n = 0; n < 80; n++) {
    const action = await algo.decide(game, utils, { owner });
    if (!action) break;
    const r = applyAction(game, owner, action);
    if (!r.ok) { rejects++; break; }
    if (game.phase !== 'active') return rejects;
  }
  if (game.phase === 'active') endTurn(game, globalEventBus, owner);
  return rejects;
}

async function playGame(game: GameState, algoA: any, algoB: any, maxRounds = 120) {
  const seatAlgo: Record<string, any> = { player_a: algoA, player_b: algoB };
  let rejects = 0;
  while (game.phase === 'active' && game.turn.roundNumber <= maxRounds) {
    const who = game.turn.currentPlayerId!;
    rejects += await playTurn(game, who, seatAlgo[who]);
  }
  return rejects;
}

describe('crucible 接口与模式隔离', () => {
  it('注册元数据：仅歼灭模式', async () => {
    const { getAlgorithmMeta, algorithmSupportsMode } = await import('../../algorithms/registry.mjs');
    const meta = getAlgorithmMeta('crucible');
    expect(meta?.modes).toEqual(['annihilation']);
    expect(algorithmSupportsMode('crucible', 'annihilation')).toBe(true);
    expect(algorithmSupportsMode('crucible', 'standard')).toBe(false);
    expect(algorithmSupportsMode('crucible', 'royale')).toBe(false);
  });

  it('非歼灭模式 / 非己方回合 / 非 active 一律返回 null', async () => {
    const standard = createLobby('cr_std', 'default', { maxPlayers: 2, participate: false });
    addLobbyPlayer(standard, 'A');
    addLobbyPlayer(standard, 'B');
    startGame(standard, globalEventBus, mulberry32(1));
    expect(await crucible.decide(standard, utils, { owner: 'player_a' })).toBeNull();

    const game = newGame('cr_turn', 'artillery-zone', 2);
    expect(await crucible.decide(game, utils, { owner: 'player_b' })).toBeNull();
    game.phase = 'game_over';
    expect(await crucible.decide(game, utils, { owner: 'player_a' })).toBeNull();
  });
});

describe('crucible 整局合法性（真实引擎，零拒绝）', () => {
  it('artillery-zone 双座位 vs 随机基线整局零拒绝且获胜', async () => {
    for (const swap of [false, true]) {
      const game = newGame(`cr_full_az_${swap}`, 'artillery-zone', 100 + (swap ? 1 : 0));
      const rejects = await playGame(game, swap ? randomAnnihilation : crucible, swap ? crucible : randomAnnihilation);
      expect(rejects).toBe(0);
      expect(game.phase).toBe('game_over');
      expect(game.winner).toBe(swap ? 'player_b' : 'player_a');
    }
  }, 60000);

  it('trench-run 双座位 vs 随机基线整局零拒绝且获胜', async () => {
    for (const swap of [false, true]) {
      const game = newGame(`cr_full_tr_${swap}`, 'trench-run', 200 + (swap ? 1 : 0));
      const rejects = await playGame(game, swap ? randomAnnihilation : crucible, swap ? crucible : randomAnnihilation);
      expect(rejects).toBe(0);
      expect(game.phase).toBe('game_over');
      expect(game.winner).toBe(swap ? 'player_b' : 'player_a');
    }
  }, 60000);
});

describe('crucible 策略回归', () => {
  it('零初始单位的随机图：首回合必须部署（不被轮界炮火白 wipe）', async () => {
    const seed = 20261029;
    const config = generateRandomMapConfig({ seed, mode: 'annihilation' }, 2);
    const game = createLobbyWithConfig('cr_empty', `random#${seed}`, config, { maxPlayers: 2, participate: false });
    addLobbyPlayer(game, 'A');
    addLobbyPlayer(game, 'B');
    startGame(game, globalEventBus, mulberry32(seed));
    expect(game.units.length).toBe(0);
    endTurn(game, globalEventBus, 'player_a');
    const action = await crucible.decide(game, utils, { owner: 'player_b' });
    expect(action?.type).toBe('deploy');
    const r = applyAction(game, 'player_b', action);
    expect(r.ok).toBe(true);
  });

  it('集火斩杀：两个步兵围住残血敌军，整回合内完成击杀并记击杀分', async () => {
    const game = newGame('cr_kill', 'artillery-zone', 7);
    const mine = game.units.filter((u) => u.owner === 'player_a' && u.type === 'infantry');
    const enemy = game.units.find((u) => u.owner === 'player_b' && u.type === 'infantry')!;
    // 摆成近战可及：敌步兵放到 (3,0)，两个己方步兵贴到 (4,0)、(3,1)
    enemy.q = 3; enemy.r = 0; enemy.hp = 20;
    mine[0].q = 4; mine[0].r = 0;
    mine[1].q = 3; mine[1].r = 1;
    const heavy = game.units.find((u) => u.owner === 'player_a' && u.type === 'heavy')!;
    heavy.q = 5; heavy.r = -2;
    game.stateVersion = (game.stateVersion ?? 0) + 1;
    await playTurn(game, 'player_a', crucible);
    expect(enemy.alive).toBe(false);
    expect(game.players.player_a!.stats.killValue).toBeGreaterThanOrEqual(enemy.cost);
  });

  it('危险区疏散：圈外部队向安全圈内移动', async () => {
    const game = newGame('cr_evac', 'artillery-zone', 9);
    game.turn.roundNumber = 11; // safeRadius = 2
    game.turn.turnNumber = 11;
    updateArtilleryForRound(game, globalEventBus);
    const mine = game.units.filter((u) => u.owner === 'player_a');
    // 把一个步兵放到圈外 (4,0)，其余挪远避免干扰
    const inf = mine.find((u) => u.type === 'infantry')!;
    inf.q = 4; inf.r = 0; inf.hp = 100;
    for (const u of mine) {
      if (u.id !== inf.id) { u.q = 0; u.r = 1; }
    }
    game.stateVersion = (game.stateVersion ?? 0) + 1;
    expect(game.artillery!.dangerCells.some((c) => c.q === 4 && c.r === 0)).toBe(true);
    const action = await crucible.decide(game, utils, { owner: 'player_a' });
    expect(action?.type).toBe('move');
    const dist = (q: number, r: number) => Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
    expect(dist(action.payload.q, action.payload.r)).toBeLessThan(4);
  });

  it('部署补刀：部署落点旁的残血敌军被新单位立即攻击（真实 id 解析）', async () => {
    const game = newGame('cr_deploy_finish', 'artillery-zone', 13);
    // 清空双方初始单位，只留一个残血敌步兵在 cp_east 旁
    for (const u of game.units) u.alive = false;
    game.units = game.units.filter((u) => u.alive);
    const cp = game.controlPoints.find((p) => p.id === 'cp_east')!;
    cp.owner = 'player_a';
    game.resources.player_a!.supplies = 200;
    const enemy = {
      id: 'u_target', owner: 'player_b' as PlayerId, type: 'infantry' as const,
      q: 5, r: 0, hp: 10, maxHp: 100, attack: 30, defense: 8,
      moveRange: 3, attackRange: 1, cost: 45, alive: true,
      hasMoved: false, hasActed: false, actionSpent: false, canCapture: true,
    };
    game.units.push(enemy);
    game.stateVersion = (game.stateVersion ?? 0) + 1;
    let sawAttack = false;
    for (let n = 0; n < 20; n++) {
      const action = await crucible.decide(game, utils, { owner: 'player_a' });
      if (!action) break;
      if (action.type === 'attack') {
        expect(typeof action.payload.attackerId).toBe('string');
        expect(action.payload.attackerId).not.toMatch(/^sim_new_/);
        sawAttack = true;
      }
      const r = applyAction(game, 'player_a', action);
      expect(r.ok).toBe(true);
      if (game.phase !== 'active') break;
    }
    expect(sawAttack).toBe(true);
    expect(enemy.alive).toBe(false);
  });

  it('确定性：同一状态两个独立模块实例返回相同首动作', async () => {
    const { vi } = await import('vitest');
    const game = newGame('cr_det', 'artillery-zone', 21);
    vi.resetModules();
    const m1 = (await import('../../algorithms/builtin/crucible.mjs')).default;
    const a = await m1.decide(structuredClone(game), utils, { owner: 'player_a' });
    vi.resetModules();
    const m2 = (await import('../../algorithms/builtin/crucible.mjs')).default;
    const b = await m2.decide(structuredClone(game), utils, { owner: 'player_a' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});