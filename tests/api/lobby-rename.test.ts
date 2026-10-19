import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestServer } from '../helpers.js';
import { globalStore } from '../../src/state/store.js';
import type { PlayerId } from '../../src/types.js';

interface CreatedLobby {
  gameId: string;
  hostToken: string;
  player: { id: PlayerId; token: string } | null;
}

describe('lobby self rename', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    for (const id of globalStore.list()) globalStore.delete(id);
    if (app) await app.close();
  });

  async function createLobby(participate = true): Promise<CreatedLobby> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mapId: 'multiplayer-ring', maxPlayers: 3, participate, playerName: 'Host' },
    });
    expect(res.statusCode).toBe(200);
    return res.json() as CreatedLobby;
  }

  async function join(gameId: string, name: string) {
    const res = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/join`,
      payload: { name },
    });
    expect(res.statusCode).toBe(200);
    return res.json() as { player: { id: PlayerId; token: string }; lobby: { players: Array<{ id: PlayerId; name: string }> } };
  }

  it('lets a player rename themselves in the lobby and returns the updated lobby', async () => {
    app = await startTestServer();
    const created = await createLobby();
    const hostSeat = created.player!;

    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/games/${created.gameId}/player`,
      headers: { 'X-Player-Token': hostSeat.token },
      payload: { name: 'Renamed Host' },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().lobby.players).toEqual([
      { id: 'player_a', name: 'Renamed Host', status: 'lobby' },
    ]);

    const game = globalStore.get(created.gameId)!;
    expect(game.players.player_a?.name).toBe('Renamed Host');
    expect(game.playerNames.player_a).toBe('Renamed Host');
    expect(game.events.at(-1)).toMatchObject({
      type: 'name_rename',
      payload: { playerId: 'player_a', name: 'Renamed Host' },
    });
  });

  it('keeps rename scoped to the player token and offers no host rename route', async () => {
    app = await startTestServer();
    const created = await createLobby(false);
    const first = await join(created.gameId, 'First');
    const second = await join(created.gameId, 'Second');

    // 房主凭证不是玩家凭证：不能借它改别人（或自己的）名字。
    const viaHost = await app.inject({
      method: 'PATCH',
      url: `/api/games/${created.gameId}/player`,
      headers: { 'X-Host-Token': created.hostToken },
      payload: { name: 'Host Renamed Second' },
    });
    expect(viaHost.statusCode).toBe(401);
    expect(viaHost.json().code).toBe('invalid_token');

    // 房主代改名接口不存在，大厅内也没有供房主使用的改名通道。
    const hostRoute = await app.inject({
      method: 'PATCH',
      url: `/api/games/${created.gameId}/host/rename`,
      headers: { 'X-Host-Token': created.hostToken },
      payload: { playerId: second.player.id, name: 'Host Renamed Second' },
    });
    expect(hostRoute.statusCode).toBe(404);

    const game = globalStore.get(created.gameId)!;
    expect(game.players[first.player.id]?.name).toBe('First');
    expect(game.players[second.player.id]?.name).toBe('Second');
  });

  it('rejects blank names and trims overlong names to the limit', async () => {
    app = await startTestServer();
    const created = await createLobby();
    const token = created.player!.token;
    const url = `/api/games/${created.gameId}/player`;

    const blank = await app.inject({
      method: 'PATCH', url, headers: { 'X-Player-Token': token }, payload: { name: '   ' },
    });
    expect(blank.statusCode).toBe(400);
    expect(blank.json().code).toBe('invalid_move');

    const longName = 'x'.repeat(80);
    const long = await app.inject({
      method: 'PATCH', url, headers: { 'X-Player-Token': token }, payload: { name: longName },
    });
    expect(long.statusCode).toBe(200);
    expect(long.json().lobby.players[0].name).toHaveLength(50);
  });
});
