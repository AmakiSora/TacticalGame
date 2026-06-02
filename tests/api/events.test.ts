// tests/api/events.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { startTestServer, createGameAndJoin } from '../helpers.js';
import type { FastifyInstance } from 'fastify';
import { globalStore } from '../../src/state/store.js';

describe('Events API', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    for (const id of globalStore.list()) globalStore.delete(id);
    app = await startTestServer();
  });

  it('GET /events returns all events as JSON by default', async () => {
    const { gameId } = await createGameAndJoin(app);
    const res = await app.inject({
      method: 'GET', url: `/api/games/${gameId}/events`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events.some((e: any) => e.type === 'game_start')).toBe(true);
  });

  it('GET /events?after=N returns only events after seq N', async () => {
    const { gameId, tokenA } = await createGameAndJoin(app);
    const game = globalStore.get(gameId)!;
    const lastSeq = game.events.at(-1)!.seq;
    await app.inject({
      method: 'POST', url: `/api/games/${gameId}/end-turn`,
      headers: { 'x-player-token': tokenA },
    });
    const res = await app.inject({
      method: 'GET', url: `/api/games/${gameId}/events?after=${lastSeq}`,
    });
    const body = res.json();
    for (const e of body.events) {
      expect(e.seq).toBeGreaterThan(lastSeq);
    }
    expect(body.events.length).toBeGreaterThan(0);
  });

  it('GET /events returns 404 for missing game', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/games/nope/events' });
    expect(res.statusCode).toBe(404);
  });

  it('GET /events returns SSE stream when Accept is text/event-stream', async () => {
    const { gameId } = await createGameAndJoin(app);
    const res = await app.inject({
      method: 'GET', url: `/api/games/${gameId}/events`,
      headers: { accept: 'text/event-stream' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.body).toContain('data:');
  });
});
