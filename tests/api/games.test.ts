// tests/api/games.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { startTestServer, createGameAndJoin } from '../helpers.js';
import type { FastifyInstance } from 'fastify';
import { globalStore } from '../../src/state/store.js';

describe('Games API', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    for (const id of globalStore.list()) globalStore.delete(id);
    app = await startTestServer();
  });

  it('POST /api/games returns gameId and player A token', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/games' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.gameId).toBe('string');
    expect(body.playerAToken).toMatch(/^[a-f0-9]{32}$/);
  });

  it('POST /api/games/:id/join returns player B token', async () => {
    const create = await app.inject({ method: 'POST', url: '/api/games' });
    const { gameId } = create.json();
    const res = await app.inject({ method: 'POST', url: `/api/games/${gameId}/join` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.playerBToken).toMatch(/^[a-f0-9]{32}$/);
  });

  it('POST /api/games/:id/join fails when already full', async () => {
    const { gameId } = await createGameAndJoin(app);
    const res = await app.inject({ method: 'POST', url: `/api/games/${gameId}/join` });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('game_already_full');
  });

  it('POST /api/games/:id/join fails for missing game', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/games/nope/join' });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('game_not_found');
  });

  it('GET /api/games/:id returns state with valid token', async () => {
    const { gameId, tokenA } = await createGameAndJoin(app);
    const res = await app.inject({
      method: 'GET', url: `/api/games/${gameId}`,
      headers: { 'x-player-token': tokenA },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(gameId);
    expect(body.buildings).toHaveLength(2);
    expect(body.resources.player_a.gold).toBe(100);
  });

  it('GET /api/games/:id excludes tokens from response', async () => {
    const { gameId, tokenA } = await createGameAndJoin(app);
    const res = await app.inject({
      method: 'GET', url: `/api/games/${gameId}`,
      headers: { 'x-player-token': tokenA },
    });
    expect(res.json().tokens).toBeUndefined();
  });

  it('GET /api/games/:id fails with invalid token', async () => {
    const { gameId } = await createGameAndJoin(app);
    const res = await app.inject({
      method: 'GET', url: `/api/games/${gameId}`,
      headers: { 'x-player-token': 'wrong' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('invalid_token');
  });

  it('GET /api/games/:id fails with missing token', async () => {
    const { gameId } = await createGameAndJoin(app);
    const res = await app.inject({ method: 'GET', url: `/api/games/${gameId}` });
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/games/:id fails for missing game', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/games/nope',
      headers: { 'x-player-token': 'whatever' },
    });
    expect(res.statusCode).toBe(404);
  });
});
