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
    const { gameId, tokenA, tokenB } = await createGameAndJoin(app);
    const res = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/build`,
      headers: { 'x-player-token': tokenA },
      payload: { type: 'barracks', x: 4, y: 10 },
    });
    expect(res.statusCode).toBe(200);
    const game = globalStore.get(gameId)!;
    expect(game.buildings.some(b => b.x === 4 && b.y === 10)).toBe(true);
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
    const { gameId, tokenA, tokenB } = await createGameAndJoin(app);
    const game = globalStore.get(gameId)!;
    game.resources.player_a.gold = 5;
    const res = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/build`,
      headers: { 'x-player-token': tokenA },
      payload: { type: 'barracks', x: 4, y: 10 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('insufficient_gold');
  });

  it('POST /produce queues a unit', async () => {
    const { gameId, tokenA, tokenB } = await createGameAndJoin(app);
    const game = globalStore.get(gameId)!;
    
    // Build a barracks first
    const buildRes = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/build`,
      headers: { 'x-player-token': tokenA },
      payload: { type: 'barracks', x: 4, y: 10 },
    });
    expect(buildRes.statusCode).toBe(200);
    const barracks = game.buildings.find(b => b.type === 'barracks')!;
    
    
    // Wait for construction to complete (2 turns each = 4 end-turns total)
    await app.inject({ method: 'POST', url: `/api/games/${gameId}/end-turn`, headers: { 'x-player-token': tokenA } });
    await app.inject({ method: 'POST', url: `/api/games/${gameId}/end-turn`, headers: { 'x-player-token': tokenB } });
    await app.inject({ method: 'POST', url: `/api/games/${gameId}/end-turn`, headers: { 'x-player-token': tokenA } });
    await app.inject({ method: 'POST', url: `/api/games/${gameId}/end-turn`, headers: { 'x-player-token': tokenB } });
    
    const res = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/produce`,
      headers: { 'x-player-token': tokenA },
      payload: { buildingId: barracks.id, unitType: 'infantry' },
    });
    expect(res.statusCode).toBe(200);
    expect(barracks.production?.type).toBe('infantry');
  });
});
