import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createGameAndJoin, startTestServer } from '../helpers.js';
import { globalStore } from '../../src/state/store.js';

describe('game_over is the terminal event', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    for (const id of globalStore.list()) globalStore.delete(id);
    if (app) await app.close();
  });

  it('rejects post-game host controls and renames without appending events', async () => {
    app = await startTestServer();
    const game = await createGameAndJoin(app);
    const adjudicated = await app.inject({
      method: 'POST',
      url: `/api/games/${game.gameId}/force-adjudicate`,
    });
    expect(adjudicated.statusCode).toBe(200);

    const state = globalStore.get(game.gameId)!;
    expect(state.phase).toBe('game_over');
    const eventCount = state.events.length;
    expect(state.events.at(-1)!.type).toBe('game_over');

    // 大厅摘要必须带上终局信息：前端据此把房间卡显示成「已结束 + 胜者」而不是等待开局。
    const lobbyRes = await app.inject({ method: 'GET', url: `/api/games/${game.gameId}/lobby` });
    expect(lobbyRes.statusCode).toBe(200);
    const lobby = lobbyRes.json();
    expect(lobby.phase).toBe('game_over');
    expect(lobby.winner).toBe(state.winner);
    expect(lobby.roundNumber).toBe(state.turn.roundNumber);

    // 已结束的房间不能再次开始；错误码应是 game_over，而不是含糊的「已经开始」。
    const restart = await app.inject({
      method: 'POST',
      url: `/api/games/${game.gameId}/start`,
      headers: { 'x-host-token': game.hostToken },
    });
    expect(restart.statusCode).toBe(409);
    expect(restart.json().code).toBe('game_over');

    const eliminate = await app.inject({
      method: 'POST',
      url: `/api/games/${game.gameId}/host/eliminate`,
      headers: { 'x-host-token': game.hostToken },
      payload: { playerId: 'player_a' },
    });
    expect(eliminate.statusCode).toBe(409);
    expect(eliminate.json().code).toBe('game_over');

    const skip = await app.inject({
      method: 'POST',
      url: `/api/games/${game.gameId}/host/skip-turn`,
      headers: { 'x-host-token': game.hostToken },
      payload: {},
    });
    expect(skip.statusCode).toBe(409);
    expect(skip.json().code).toBe('game_over');

    const selfRename = await app.inject({
      method: 'PATCH',
      url: `/api/games/${game.gameId}/player`,
      headers: { 'x-player-token': game.playerAToken },
      payload: { name: 'renamed' },
    });
    expect(selfRename.statusCode).toBe(409);
    expect(selfRename.json().code).toBe('game_over');

    const controlRename = await app.inject({
      method: 'PATCH',
      url: `/api/games/${game.gameId}/rename`,
      payload: { playerId: 'player_a', name: 'renamed-by-host' },
    });
    expect(controlRename.statusCode).toBe(409);
    expect(controlRename.json().code).toBe('game_over');

    const after = globalStore.get(game.gameId)!;
    expect(after.events).toHaveLength(eventCount);
    expect(after.events.at(-1)!.type).toBe('game_over');
    expect(after.players.player_a!.name).toBe('A');
  });
});
