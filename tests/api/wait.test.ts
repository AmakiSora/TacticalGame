import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createGameAndJoin, startTestServer } from '../helpers.js';
import { globalStore } from '../../src/state/store.js';

describe('AI wait endpoint', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    for (const id of globalStore.list()) globalStore.delete(id);
    if (app) await app.close();
  });

  it('returns changed:false on timeout', async () => {
    app = await startTestServer();
    const { gameId, playerAToken } = await createGameAndJoin(app);
    const latest = globalStore.get(gameId)!.events.at(-1)!.seq;
    const res = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}/wait?afterSeq=${latest}&timeout=0.02`,
      headers: { 'x-player-token': playerAToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ changed: false, seq: latest });
  });

  it('wakes on a new event', async () => {
    app = await startTestServer();
    const { gameId, playerAToken } = await createGameAndJoin(app);
    const latest = globalStore.get(gameId)!.events.at(-1)!.seq;

    const waiting = app.inject({
      method: 'GET',
      url: `/api/games/${gameId}/wait?afterSeq=${latest}&timeout=5`,
      headers: { 'x-player-token': playerAToken },
    });
    // Give the wait request a tick to subscribe before producing the event.
    await new Promise(resolve => setTimeout(resolve, 20));
    const turn = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/end-turn`,
      headers: { 'x-player-token': playerAToken },
    });
    expect(turn.statusCode).toBe(200);

    const res = await waiting;
    expect(res.statusCode).toBe(200);
    expect(res.json().changed).toBe(true);
    expect(res.json().seq).toBeGreaterThan(latest);
  });

  it('requires a player token', async () => {
    app = await startTestServer();
    const { gameId } = await createGameAndJoin(app);
    const res = await app.inject({ method: 'GET', url: `/api/games/${gameId}/wait?timeout=0.01` });
    expect(res.statusCode).toBe(401);
  });
});
