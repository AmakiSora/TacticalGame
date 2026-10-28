import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { getMapConfig, loadMaps } from '../../src/config/loader.js';
import { artilleryStateForRound } from '../../src/engine/artillery.js';
import { globalStore } from '../../src/state/store.js';
import type { PlayerId } from '../../src/types.js';
import { startTestServer } from '../helpers.js';

const hexDist = (aq: number, ar: number, bq: number, br: number) => {
  const q = aq - bq, r = ar - br;
  return Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
};
const ringOf = (q: number, r: number) => Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));

async function createStartedLobby(app: FastifyInstance, maxPlayers: number) {
  const createRes = await app.inject({
    method: 'POST',
    url: '/api/games',
    payload: { mapId: 'trench-run', maxPlayers, participate: true, playerName: 'P1' },
  });
  expect(createRes.statusCode).toBe(200);
  const created = createRes.json() as { gameId: string; hostToken: string; player: { id: PlayerId; token: string } };
  const tokens: Record<PlayerId, string> = { [created.player.id]: created.player.token };
  let seat = 2;
  while (Object.keys(tokens).length < maxPlayers) {
    const joinRes = await app.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/join`,
      payload: { name: `P${seat}` },
    });
    expect(joinRes.statusCode).toBe(200);
    const joined = joinRes.json() as { player: { id: PlayerId; token: string } };
    tokens[joined.player.id] = joined.player.token;
    seat += 1;
  }
  const startRes = await app.inject({
    method: 'POST',
    url: `/api/games/${created.gameId}/start`,
    headers: { 'X-Host-Token': created.hostToken },
  });
  expect(startRes.statusCode).toBe(200);
  return { gameId: created.gameId, hostToken: created.hostToken, tokens };
}

async function getState(app: FastifyInstance, gameId: string, token: string) {
  const res = await app.inject({ method: 'GET', url: `/api/games/${gameId}`, headers: { 'X-Player-Token': token } });
  expect(res.statusCode).toBe(200);
  return res.json();
}

async function endTurn(app: FastifyInstance, gameId: string, token: string) {
  return app.inject({ method: 'POST', url: `/api/games/${gameId}/end-turn`, headers: { 'X-Player-Token': token } });
}

describe('歼灭地图「战壕」trench-run', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    for (const id of globalStore.list()) globalStore.delete(id);
    if (app) await app.close();
    app = undefined;
  });

  it('地形与配置：83 格长廊（含两条对角侧路）、8 段障碍、8 据点、2 出生槽，仅支持双人', () => {
    loadMaps();
    const cfg = getMapConfig('trench-run')!;
    expect(cfg.mode).toBe('annihilation');
    expect(cfg.radius).toBe(8);
    expect(cfg.playableCells).toHaveLength(83);
    expect(cfg.terrainCells).toHaveLength(8);
    expect(cfg.controlPoints).toHaveLength(8);
    expect(cfg.controlPoints.filter(p => p.kind === 'forward_base')).toHaveLength(2);
    expect(cfg.spawnSlots).toHaveLength(2);
    expect(cfg.supportedPlayerCounts).toEqual([2]);
    expect(cfg.balance.maxTurns).toBe(22);
    // 长廊必须横穿圆心，且每一环都有立足地（两端先没、中段最后）
    expect(cfg.playableCells.filter(c => c.q === 0 && c.r === 0)).toHaveLength(1);
    for (let d = 0; d <= 8; d++) {
      const standable = cfg.playableCells.filter(c => ringOf(c.q, c.r) === d)
        .filter(c => !cfg.terrainCells.some(t => t.q === c.q && t.r === c.r));
      expect(standable.length, `第 ${d} 环可站格`).toBeGreaterThan(0);
    }
  });

  it('出生槽：两槽 180° 对称、HQ 与绑定基地相邻、开局兵力落在空地上', () => {
    loadMaps();
    const cfg = getMapConfig('trench-run')!;
    const impassable = new Set(cfg.terrainCells.filter(t => t.terrain !== 'plain').map(t => `${t.q},${t.r}`));
    const cpCells = new Set(cfg.controlPoints.map(p => `${p.q},${p.r}`));
    const occupied = new Set<string>();
    for (const slot of cfg.spawnSlots) {
      const point = cfg.controlPoints.find(p => p.id === slot.controlPointId)!;
      expect(hexDist(slot.headquarters.q, slot.headquarters.r, point.q, point.r), slot.id).toBe(1);
      expect(impassable.has(`${slot.headquarters.q},${slot.headquarters.r}`)).toBe(false);
      expect(slot.startingUnits).toHaveLength(3);
      for (const unit of slot.startingUnits) {
        const key = `${unit.q},${unit.r}`;
        expect(impassable.has(key), `${slot.id} 开局单位压地形`).toBe(false);
        expect(cpCells.has(key), `${slot.id} 开局单位压据点`).toBe(false);
        expect(occupied.has(key), `开局单位位置重复 ${key}`).toBe(false);
        occupied.add(key);
      }
    }
    // 两槽互为 180° 旋转镜像（无先后手差异）
    const [a, b] = cfg.spawnSlots;
    expect({ q: -a.headquarters.q, r: -a.headquarters.r }).toEqual(b.headquarters);
  });

  it('炮火时间线：第 3 轮起每 2 轮推进一圈，第 17 轮只剩圆心一格', () => {
    loadMaps();
    const cfg = getMapConfig('trench-run')!;
    const game = { config: cfg, map: { radius: cfg.radius }, cells: cfg.playableCells } as never;
    const standable = cfg.playableCells.filter(c => !cfg.terrainCells.some(t => t.terrain !== 'plain' && t.q === c.q && t.r === c.r));
    const safeAt = (round: number) => {
      const a = artilleryStateForRound(game, round)!;
      return { radius: a.safeRadius, cells: standable.filter(c => ringOf(c.q, c.r) <= a.safeRadius).length };
    };
    expect(cfg.annihilation?.artillery).toEqual({ startRound: 3, intervalRounds: 2, damage: 20, minimumSafeRadius: 0 });
    expect(safeAt(1)).toEqual({ radius: 8, cells: 75 });
    expect(safeAt(3)).toEqual({ radius: 7, cells: 65 });
    expect(safeAt(11)).toEqual({ radius: 3, cells: 27 });
    expect(safeAt(15)).toEqual({ radius: 1, cells: 7 });
    expect(safeAt(17)).toEqual({ radius: 0, cells: 1 });
    expect(safeAt(22)).toEqual({ radius: 0, cells: 1 });
    expect(artilleryStateForRound(game, 17)!.nextShrinkRound).toBeNull();

    const danger = new Set(artilleryStateForRound(game, 17)!.dangerCells.map(c => `${c.q},${c.r}`));
    expect(danger.has('8,-4')).toBe(true);
    expect(danger.has('1,0')).toBe(true);
    expect(danger.has('0,0')).toBe(false);
  });

  it('只支持双人：3/4/5 人创建被拒', async () => {
    app = await startTestServer();
    for (const maxPlayers of [3, 4, 5]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/games',
        payload: { mapId: 'trench-run', maxPlayers, participate: true, playerName: 'X' },
      });
      expect(res.statusCode, `${maxPlayers} 人应被拒`).toBe(400);
      expect(res.json().code).toBe('unsupported_player_count');
    }
  });

  it('双人局：可开局、各占自己的前沿基地，首轮无危险区', async () => {
    app = await startTestServer();
    const { gameId, tokens } = await createStartedLobby(app, 2);
    const state = await getState(app, gameId, Object.values(tokens)[0]);
    expect(state.config.mode).toBe('annihilation');
    expect(state.units.filter((u: { alive: boolean }) => u.alive)).toHaveLength(6);
    const owned = state.controlPoints.filter((p: { owner: string | null }) => p.owner);
    expect(owned.map((p: { id: string }) => p.id).sort()).toEqual(['fb_e', 'fb_w']);
    expect(state.artillery.safeRadius).toBe(8);
    expect(state.artillery.dangerCells).toHaveLength(0);
    expect(state.headquarters).toEqual({});
  });

  it('双人局推进：进入收缩后，驻守两端开局的单位开始被炮火削血', async () => {
    app = await startTestServer();
    const { gameId, tokens } = await createStartedLobby(app, 2);
    let state = await getState(app, gameId, Object.values(tokens)[0]);
    const startHp = new Map(state.units.map((u: { id: string; hp: number }) => [u.id, u.hp]));

    for (let i = 0; i < 20 && state.turn.roundNumber < 3; i++) {
      const actor = state.turn.currentPlayerId as PlayerId;
      const res = await endTurn(app, gameId, tokens[actor]);
      expect(res.statusCode, `第 ${state.turn.roundNumber} 轮由 ${actor} 结束回合`).toBe(200);
      state = await getState(app, gameId, tokens[actor]);
    }
    expect(state.turn.roundNumber).toBeGreaterThanOrEqual(3);
    expect(state.artillery.safeRadius).toBe(7);
    const wounded = state.units.filter((u: { alive: boolean; hp: number; id: string }) =>
      u.alive && u.hp < (startHp.get(u.id) as number));
    expect(wounded.length, '驻守第 8 环的开局单位应已被炮火削血').toBeGreaterThan(0);
    const danger = new Set(state.artillery.dangerCells.map((c: { q: number; r: number }) => `${c.q},${c.r}`));
    expect(danger.has('0,0')).toBe(false);
  });
});

