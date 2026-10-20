import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createGameAndJoin, startTestServer } from '../helpers.js';
import { globalStore } from '../../src/state/store.js';

describe('state projection and ETag', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    for (const id of globalStore.list()) globalStore.delete(id);
    if (app) await app.close();
  });

  it('keeps the legacy full response by default', async () => {
    app = await startTestServer();
    const { gameId, playerAToken } = await createGameAndJoin(app);
    const res = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}`,
      headers: { 'x-player-token': playerAToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.config).toBeTruthy();
    expect(body.adjudication).toBeTruthy();
    expect(body.lastEventSeq).toBeGreaterThan(0);
  });

  it('omits history/config/adjudication for include=state and supports 304', async () => {
    app = await startTestServer();
    const { gameId, playerAToken } = await createGameAndJoin(app);
    const first = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}?include=state`,
      headers: { 'x-player-token': playerAToken },
    });
    expect(first.statusCode).toBe(200);
    const body = first.json();
    expect(body.events).toBeUndefined();
    expect(body.config).toBeUndefined();
    expect(body.adjudication).toBeUndefined();
    expect(body.turn).toBeTruthy();
    expect(typeof first.headers.etag).toBe('string');

    const cached = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}?include=state`,
      headers: {
        'x-player-token': playerAToken,
        'if-none-match': first.headers.etag as string,
      },
    });
    expect(cached.statusCode).toBe(304);
    expect(cached.body).toBe('');
  });

  it('strips idempotency records from state responses', async () => {
    app = await startTestServer();
    const { gameId, playerAToken, playerBToken } = await createGameAndJoin(app);
    const key = 'leaky-key';
    const action = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/end-turn`,
      headers: { 'x-player-token': playerAToken, 'idempotency-key': key },
      payload: {},
    });
    expect(action.statusCode).toBe(200);
    expect(globalStore.get(gameId)!.idempotency?.[`player_a:${key}`]).toBeTruthy();

    const res = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}`,
      headers: { 'x-player-token': playerBToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.idempotency).toBeUndefined();
    expect(res.body).not.toContain(key);
  });
});
