// tests/api/actions.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { startTestServer, createGameAndJoin } from '../helpers.js';
import type { FastifyInstance } from 'fastify';
import { globalStore } from '../../src/state/store.js';

describe('Actions API', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    for (const id of globalStore.list()) globalStore.delete(id);
    app = await startTestServer();
  });

  it('POST /build succeeds adjacent to HQ', async () => {
    const { gameId, tokenA } = await createGameAndJoin(app);
    const res = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/build`,
      headers: { 'x-player-token': tokenA },
      payload: { type: 'barracks', x: 5, y: 15 },
    });
    expect(res.statusCode).toBe(200);
    const game = globalStore.get(gameId)!;
    expect(game.buildings.some(b => b.x === 5 && b.y === 15)).toBe(true);
  });

  it('POST /build rejects when not your turn', async () => {
    const { gameId, tokenB } = await createGameAndJoin(app);
    const res = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/build`,
      headers: { 'x-player-token': tokenB },
      payload: { type: 'barracks', x: 26, y: 15 },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('not_your_turn');
  });

  it('POST /build returns 400 on insufficient gold', async () => {
    const { gameId, tokenA } = await createGameAndJoin(app);
    const game = globalStore.get(gameId)!;
    game.resources.player_a.gold = 5;
    const res = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/build`,
      headers: { 'x-player-token': tokenA },
      payload: { type: 'barracks', x: 5, y: 15 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('insufficient_gold');
  });

  it('POST /produce queues a unit', async () => {
    const { gameId, tokenA } = await createGameAndJoin(app);
    const game = globalStore.get(gameId)!;
    const hq = game.buildings.find(b => b.owner === 'player_a')!;
    const res = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/produce`,
      headers: { 'x-player-token': tokenA },
      payload: { buildingId: hq.id, unitType: 'infantry' },
    });
    expect(res.statusCode).toBe(200);
    expect(hq.production?.type).toBe('infantry');
  });

  it('POST /move moves a unit', async () => {
    const { gameId, tokenA } = await createGameAndJoin(app);
    const game = globalStore.get(gameId)!;
    game.units.push({
      id: 'u1', owner: 'player_a', type: 'infantry',
      x: 5, y: 15, hp: 100, maxHp: 100, attack: 20, defense: 8,
      moveRange: 3, attackRange: 1, alive: true, hasMoved: false, hasAttacked: false,
    });
    const res = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/move`,
      headers: { 'x-player-token': tokenA },
      payload: { unitId: 'u1', x: 7, y: 15 },
    });
    expect(res.statusCode).toBe(200);
    const u = game.units.find(x => x.id === 'u1')!;
    expect(u.x).toBe(7);
  });

  it('POST /attack damages an enemy', async () => {
    const { gameId, tokenA } = await createGameAndJoin(app);
    const game = globalStore.get(gameId)!;
    game.units.push({
      id: 'ua', owner: 'player_a', type: 'infantry',
      x: 10, y: 10, hp: 100, maxHp: 100, attack: 20, defense: 8,
      moveRange: 3, attackRange: 1, alive: true, hasMoved: false, hasAttacked: false,
    });
    game.units.push({
      id: 'ub', owner: 'player_b', type: 'infantry',
      x: 11, y: 10, hp: 100, maxHp: 100, attack: 20, defense: 8,
      moveRange: 3, attackRange: 1, alive: true, hasMoved: false, hasAttacked: false,
    });
    const res = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/attack`,
      headers: { 'x-player-token': tokenA },
      payload: { attackerId: 'ua', targetId: 'ub' },
    });
    expect(res.statusCode).toBe(200);
    const ub = game.units.find(x => x.id === 'ub')!;
    expect(ub.hp).toBeLessThan(100);
  });

  it('POST /heal heals friendly unit', async () => {
    const { gameId, tokenA } = await createGameAndJoin(app);
    const game = globalStore.get(gameId)!;
    game.units.push({
      id: 'm', owner: 'player_a', type: 'medic',
      x: 10, y: 10, hp: 70, maxHp: 70, attack: 5, defense: 5,
      moveRange: 3, attackRange: 1, alive: true, hasMoved: false, hasAttacked: false,
    });
    game.units.push({
      id: 'w', owner: 'player_a', type: 'infantry',
      x: 11, y: 10, hp: 30, maxHp: 100, attack: 20, defense: 8,
      moveRange: 3, attackRange: 1, alive: true, hasMoved: false, hasAttacked: false,
    });
    const res = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/heal`,
      headers: { 'x-player-token': tokenA },
      payload: { medicId: 'm', targetId: 'w' },
    });
    expect(res.statusCode).toBe(200);
    const w = game.units.find(x => x.id === 'w')!;
    expect(w.hp).toBeGreaterThan(30);
  });

  it('POST /end-turn switches current player', async () => {
    const { gameId, tokenA } = await createGameAndJoin(app);
    const res = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/end-turn`,
      headers: { 'x-player-token': tokenA },
    });
    expect(res.statusCode).toBe(200);
    const game = globalStore.get(gameId)!;
    expect(game.turn.currentOwner).toBe('player_b');
  });

  it('POST /end-turn rejects from wrong player', async () => {
    const { gameId, tokenB } = await createGameAndJoin(app);
    const res = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/end-turn`,
      headers: { 'x-player-token': tokenB },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects actions before player B joins', async () => {
    const createRes = await app.inject({ method: 'POST', url: '/api/games' });
    const { gameId, playerAToken } = createRes.json();
    const res = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/build`,
      headers: { 'x-player-token': playerAToken },
      payload: { type: 'barracks', x: 5, y: 15 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('game_not_started');
  });
});
