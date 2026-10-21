import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestServer } from '../helpers.js';
import { globalStore } from '../../src/state/store.js';

interface CreatedLobby {
  gameId: string;
  hostToken: string;
  lobby: { maxPlayers: number };
}

describe('lobby max players', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    for (const id of globalStore.list()) globalStore.delete(id);
    if (app) await app.close();
  });

  async function createLobby(maxPlayers = 6): Promise<CreatedLobby> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mapId: 'multiplayer-ring', maxPlayers, participate: false },
    });
    expect(res.statusCode).toBe(200);
    return res.json() as CreatedLobby;
  }

  async function setMaxPlayers(gameId: string, hostToken: string, maxPlayers: unknown) {
    return app.inject({
      method: 'PATCH',
      url: `/api/games/${gameId}/host/max-players`,
      headers: { 'X-Host-Token': hostToken },
      payload: { maxPlayers },
    });
  }

  async function join(gameId: string, name: string) {
    const res = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/join`,
      payload: { name },
    });
    expect(res.statusCode).toBe(200);
    return res.json() as { player: { id: string; token: string } };
  }

  it('lets the host change the lobby max players within the map supported counts', async () => {
    app = await startTestServer();
    const created = await createLobby(6);

    const lowered = await setMaxPlayers(created.gameId, created.hostToken, 3);
    expect(lowered.statusCode).toBe(200);
    expect(lowered.json().lobby.maxPlayers).toBe(3);
    expect(globalStore.get(created.gameId)!.maxPlayers).toBe(3);

    await join(created.gameId, 'A');
    await join(created.gameId, 'B');
    const atCapacity = await setMaxPlayers(created.gameId, created.hostToken, 2);
    expect(atCapacity.statusCode).toBe(200);
    expect(atCapacity.json().lobby.maxPlayers).toBe(2);
    expect(atCapacity.json().lobby.players).toHaveLength(2);
  });

  it('invalidates the state ETag when max players changes', async () => {
    app = await startTestServer();
    const created = await createLobby(6);
    const joined = await join(created.gameId, 'A');
    const first = await app.inject({
      method: 'GET',
      url: `/api/games/${created.gameId}`,
      headers: { 'x-player-token': joined.player.token },
    });
    expect(first.statusCode).toBe(200);
    expect(first.headers.etag).toBeTruthy();

    expect((await setMaxPlayers(created.gameId, created.hostToken, 3)).statusCode).toBe(200);
    const second = await app.inject({
      method: 'GET',
      url: `/api/games/${created.gameId}`,
      headers: {
        'x-player-token': joined.player.token,
        'if-none-match': String(first.headers.etag),
      },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().maxPlayers).toBe(3);
  });

  it('rejects unsupported counts, counts below joined players and missing host auth', async () => {
    app = await startTestServer();
    const created = await createLobby(6);

    for (const count of [4, 5, 7, 8, 1, 9, 2.5, 'x', null]) {
      const res = await setMaxPlayers(created.gameId, created.hostToken, count);
      expect(res.statusCode, `count=${String(count)}`).toBe(400);
    }

    await join(created.gameId, 'A');
    await join(created.gameId, 'B');
    await join(created.gameId, 'C');
    const tooSmall = await setMaxPlayers(created.gameId, created.hostToken, 2);
    expect(tooSmall.statusCode).toBe(400);
    expect(tooSmall.json().code).toBe('invalid_move');
    expect(tooSmall.json().error).toContain('3');

    const noToken = await app.inject({
      method: 'PATCH',
      url: `/api/games/${created.gameId}/host/max-players`,
      payload: { maxPlayers: 6 },
    });
    expect(noToken.statusCode).toBe(401);
    expect(noToken.json().code).toBe('invalid_host_token');
  });

  it('locks the max players once the game starts', async () => {
    app = await startTestServer();
    const created = await createLobby(3);
    await join(created.gameId, 'A');
    await join(created.gameId, 'B');

    const started = await app.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/start`,
      headers: { 'X-Host-Token': created.hostToken },
    });
    expect(started.statusCode).toBe(200);

    const res = await setMaxPlayers(created.gameId, created.hostToken, 6);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('game_already_started');
  });
});
