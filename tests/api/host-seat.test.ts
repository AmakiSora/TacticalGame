import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestServer } from '../helpers.js';
import { globalStore } from '../../src/state/store.js';
import type { PlayerId } from '../../src/types.js';

interface CreatedLobby {
  gameId: string;
  hostToken: string;
  player: { id: PlayerId; token: string } | null;
  lobby: { players: Array<{ id: PlayerId; name: string }>; maxPlayers: number };
}

describe('host lobby seat', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    for (const id of globalStore.list()) globalStore.delete(id);
    if (app) await app.close();
  });

  async function createLobby(participate: boolean, maxPlayers = 3): Promise<CreatedLobby> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mapId: 'multiplayer-ring', maxPlayers, participate, playerName: 'Host' },
    });
    expect(res.statusCode).toBe(200);
    return res.json() as CreatedLobby;
  }

  it('creates a lobby without a host seat when the host does not participate', async () => {
    app = await startTestServer();
    const created = await createLobby(false);
    expect(created.player).toBeNull();
    expect(created.lobby.players).toHaveLength(0);
  });

  it('lets the host join, leave and rejoin a seat before the game starts', async () => {
    app = await startTestServer();
    const created = await createLobby(false);

    const joined = await app.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/join`,
      payload: { name: 'Host' },
    });
    expect(joined.statusCode).toBe(200);
    const firstSeat = joined.json().player as { id: PlayerId; token: string };
    expect(firstSeat.id).toBe('player_a');
    expect(joined.json().lobby.players).toEqual([{ id: 'player_a', name: 'Host', status: 'lobby' }]);

    const left = await app.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/leave`,
      headers: { 'X-Player-Token': firstSeat.token },
    });
    expect(left.statusCode).toBe(200);
    const emptied = await app.inject({ method: 'GET', url: `/api/games/${created.gameId}/lobby` });
    expect(emptied.json().players).toHaveLength(0);

    // 旧席位凭证随退出失效，重新加入拿到的是新席位 / 新凭证。
    const stale = await app.inject({
      method: 'GET',
      url: `/api/games/${created.gameId}`,
      headers: { 'X-Player-Token': firstSeat.token },
    });
    expect(stale.statusCode).toBe(401);

    const rejoined = await app.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/join`,
      payload: { name: 'Host' },
    });
    expect(rejoined.statusCode).toBe(200);
    const secondSeat = rejoined.json().player as { id: PlayerId; token: string };
    expect(secondSeat.id).toBe('player_a');
    expect(secondSeat.token).not.toBe(firstSeat.token);
  });

  it('keeps the host able to manage and start the room after leaving the seat', async () => {
    app = await startTestServer();
    const created = await createLobby(false);

    const hostSeat = (
      await app.inject({
        method: 'POST',
        url: `/api/games/${created.gameId}/join`,
        payload: { name: 'Host' },
      })
    ).json().player as { id: PlayerId; token: string };

    const other = await app.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/join`,
      payload: { name: 'Other' },
    });
    expect(other.statusCode).toBe(200);

    const left = await app.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/leave`,
      headers: { 'X-Player-Token': hostSeat.token },
    });
    expect(left.statusCode).toBe(200);

    const third = await app.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/join`,
      payload: { name: 'Third' },
    });
    expect(third.statusCode).toBe(200);

    const started = await app.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/start`,
      headers: { 'X-Host-Token': created.hostToken },
    });
    expect(started.statusCode).toBe(200);

    const game = globalStore.get(created.gameId)!;
    expect(game.phase).toBe('active');
    expect(game.turn.turnOrder).toHaveLength(2);
    // 房主退出后的空位由后加入的 Third 占用，旧房主席位凭证不再有效。
    expect(game.players.player_a?.name).toBe('Third');
    expect(game.tokens.player_a).not.toBe(hostSeat.token);
  });

  it('refuses seat changes after the game starts', async () => {
    app = await startTestServer();
    const created = await createLobby(true, 2);
    const hostSeat = created.player!;

    const second = await app.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/join`,
      payload: { name: 'Other' },
    });
    expect(second.statusCode).toBe(200);

    const started = await app.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/start`,
      headers: { 'X-Host-Token': created.hostToken },
    });
    expect(started.statusCode).toBe(200);

    const leave = await app.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/leave`,
      headers: { 'X-Player-Token': hostSeat.token },
    });
    expect(leave.statusCode).toBe(409);
    expect(leave.json().code).toBe('game_already_started');

    const join = await app.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/join`,
      payload: { name: 'Late' },
    });
    expect(join.statusCode).toBe(409);
    expect(join.json().code).toBe('game_already_started');
  });
});
