import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { GameState } from '../../src/types.js';
import { createGameAndJoin, startTestServer } from '../helpers.js';
import { globalStore } from '../../src/state/store.js';

describe('action idempotency', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    for (const id of globalStore.list()) globalStore.delete(id);
    if (app) await app.close();
  });

  it('replays the first response for the same key and body', async () => {
    app = await startTestServer();
    const game = await createGameAndJoin(app);
    const key = 'idem-end-turn-1';

    const first = await app.inject({
      method: 'POST',
      url: `/api/games/${game.gameId}/end-turn`,
      headers: { 'x-player-token': game.playerAToken, 'idempotency-key': key },
      payload: {},
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: `/api/games/${game.gameId}/end-turn`,
      headers: { 'x-player-token': game.playerAToken, 'idempotency-key': key },
      payload: {},
    });
    expect(second.statusCode).toBe(200);
    expect(second.headers['idempotent-replay']).toBe('true');
    // 回合只推进一次：第二次是回放，不是第二次 end-turn。
    expect(globalStore.get(game.gameId)!.turn.currentPlayerId).toBe('player_b');
  });

  it('replays the first response after the game has ended', async () => {
    app = await startTestServer();
    const game = await createGameAndJoin(app);
    const key = 'idem-after-game-over';

    const first = await app.inject({
      method: 'POST',
      url: `/api/games/${game.gameId}/end-turn`,
      headers: { 'x-player-token': game.playerAToken, 'idempotency-key': key },
      payload: {},
    });
    expect(first.statusCode).toBe(200);

    // 动作之后对局结束：客户端丢响应重试时仍应拿到首次响应，而不是 409 game_over。
    const adjudicated = await app.inject({
      method: 'POST',
      url: `/api/games/${game.gameId}/force-adjudicate`,
    });
    expect(adjudicated.statusCode).toBe(200);
    const eventCount = globalStore.get(game.gameId)!.events.length;

    const retry = await app.inject({
      method: 'POST',
      url: `/api/games/${game.gameId}/end-turn`,
      headers: { 'x-player-token': game.playerAToken, 'idempotency-key': key },
      payload: {},
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.headers['idempotent-replay']).toBe('true');
    expect(globalStore.get(game.gameId)!.events).toHaveLength(eventCount);
  });

  it('keeps the same raw key independent per player', async () => {
    app = await startTestServer();
    const game = await createGameAndJoin(app);
    const key = 'shared-raw-key';

    const first = await app.inject({
      method: 'POST',
      url: `/api/games/${game.gameId}/end-turn`,
      headers: { 'x-player-token': game.playerAToken, 'idempotency-key': key },
      payload: {},
    });
    expect(first.statusCode).toBe(200);
    expect(globalStore.get(game.gameId)!.turn.currentPlayerId).toBe('player_b');

    const second = await app.inject({
      method: 'POST',
      url: `/api/games/${game.gameId}/end-turn`,
      headers: { 'x-player-token': game.playerBToken, 'idempotency-key': key },
      payload: {},
    });
    expect(second.statusCode).toBe(200);
    expect(second.headers['idempotent-replay']).toBeUndefined();
    // B 的结束回合真正执行，而不是回放 A 的响应。
    expect(globalStore.get(game.gameId)!.turn.currentPlayerId).toBe('player_a');
  });

  it('rejects the same key with a different body', async () => {
    app = await startTestServer();
    const game = await createGameAndJoin(app);
    const key = 'idem-end-turn-conflict';

    const first = await app.inject({
      method: 'POST',
      url: `/api/games/${game.gameId}/end-turn`,
      headers: { 'x-player-token': game.playerAToken, 'idempotency-key': key },
      payload: {},
    });
    expect(first.statusCode).toBe(200);

    const conflict = await app.inject({
      method: 'POST',
      url: `/api/games/${game.gameId}/end-turn`,
      headers: { 'x-player-token': game.playerAToken, 'idempotency-key': key },
      payload: { unexpected: true },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().code).toBe('idempotency_conflict');
  });

  it('returns persistence_degraded when the state was applied but could not be flushed', async () => {
    app = await startTestServer();
    const game = await createGameAndJoin(app);
    const flush = vi.spyOn(globalStore as unknown as { writeSnapshot: () => void }, 'writeSnapshot')
      .mockImplementation(() => {
        throw new Error('disk full');
      });
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/api/games/${game.gameId}/end-turn`,
        headers: { 'x-player-token': game.playerAToken },
        payload: {},
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe('persistence_degraded');
      expect(res.json().applied).toBe(true);
      expect(typeof res.json().requestId).toBe('string');
      // 内存状态已经生效；客户端可据此对账而不是盲目重试。
      expect(globalStore.get(game.gameId)!.turn.currentPlayerId).toBe('player_b');
    } finally {
      flush.mockRestore();
    }
  });

  it('re-persists when replaying a record whose write previously failed', async () => {
    app = await startTestServer();
    const game = await createGameAndJoin(app);
    const key = 'idem-degraded-replay';
    const store = globalStore as unknown as { writeSnapshot: (game: GameState) => void };
    const original = store.writeSnapshot.bind(globalStore);
    let calls = 0;
    let failing = true;
    const spy = vi.spyOn(store, 'writeSnapshot').mockImplementation((game: GameState) => {
      calls += 1;
      if (failing) throw new Error('disk full');
      original(game);
    });
    try {
      const first = await app.inject({
        method: 'POST',
        url: `/api/games/${game.gameId}/end-turn`,
        headers: { 'x-player-token': game.playerAToken, 'idempotency-key': key },
        payload: {},
      });
      expect(first.statusCode).toBe(503);
      expect(calls).toBe(1);
      expect(globalStore.get(game.gameId)!.turn.currentPlayerId).toBe('player_b');

      failing = false;
      const retry = await app.inject({
        method: 'POST',
        url: `/api/games/${game.gameId}/end-turn`,
        headers: { 'x-player-token': game.playerAToken, 'idempotency-key': key },
        payload: {},
      });
      expect(retry.statusCode).toBe(200);
      expect(retry.headers['idempotent-replay']).toBe('true');
      // 回放补写快照，而不是二次执行 end-turn。
      expect(calls).toBe(2);
      expect(globalStore.get(game.gameId)!.turn.currentPlayerId).toBe('player_b');
    } finally {
      spy.mockRestore();
    }
  });
});
