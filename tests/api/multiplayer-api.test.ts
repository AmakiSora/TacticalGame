import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createGameAndJoin, startTestServer } from '../helpers.js';
import { globalStore } from '../../src/state/store.js';
import type { PlayerId } from '../../src/types.js';

async function createThreePlayerLobby(app: FastifyInstance, mapId = 'multiplayer-ring') {
  const createRes = await app.inject({
    method: 'POST',
    url: '/api/games',
    payload: { mapId, maxPlayers: 3, participate: true, playerName: 'A' },
  });
  expect(createRes.statusCode).toBe(200);
  const created = createRes.json() as {
    gameId: string;
    hostToken: string;
    player: { id: PlayerId; token: string };
  };

  const joinB = await app.inject({
    method: 'POST',
    url: `/api/games/${created.gameId}/join`,
    payload: { name: 'B' },
  });
  expect(joinB.statusCode).toBe(200);
  const playerB = joinB.json().player as { id: PlayerId; token: string };

  const joinC = await app.inject({
    method: 'POST',
    url: `/api/games/${created.gameId}/join`,
    payload: { name: 'C' },
  });
  expect(joinC.statusCode).toBe(200);
  const playerC = joinC.json().player as { id: PlayerId; token: string };

  const startRes = await app.inject({
    method: 'POST',
    url: `/api/games/${created.gameId}/start`,
    headers: { 'X-Host-Token': created.hostToken },
  });
  expect(startRes.statusCode).toBe(200);

  return {
    gameId: created.gameId,
    hostToken: created.hostToken,
    players: {
      [created.player.id]: created.player.token,
      [playerB.id]: playerB.token,
      [playerC.id]: playerC.token,
    } as Record<PlayerId, string>,
  };
}

describe('multiplayer lobby API', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    for (const id of globalStore.list()) globalStore.delete(id);
    if (app) await app.close();
  });

  it('publishes authoritative irregular preview cells and only allows four-corners at four players', async () => {
    app = await startTestServer();
    const mapsRes = await app.inject({ method: 'GET', url: '/api/maps' });
    const map = mapsRes.json().maps.find((item: any) => item.id === 'four-corners');
    expect(map.preview.cells).toHaveLength(163);
    expect(map.preview.supportedPlayerCounts).toEqual([4]);

    const invalid = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mapId: 'four-corners', maxPlayers: 3, participate: true },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().code).toBe('unsupported_player_count');
  });

  it.each([2, 3, 6])('creates and starts a %i-player artillery-zone game', async playerCount => {
    app = await startTestServer();
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mapId: 'artillery-zone', maxPlayers: playerCount, participate: true, playerName: 'A' },
    });
    expect(createRes.statusCode).toBe(200);
    const created = createRes.json() as { gameId: string; hostToken: string };

    for (let index = 1; index < playerCount; index++) {
      const joined = await app.inject({
        method: 'POST',
        url: `/api/games/${created.gameId}/join`,
        payload: { name: String.fromCharCode(65 + index) },
      });
      expect(joined.statusCode).toBe(200);
    }

    const startRes = await app.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/start`,
      headers: { 'X-Host-Token': created.hostToken },
    });
    expect(startRes.statusCode).toBe(200);
    const game = globalStore.get(created.gameId)!;
    expect(game.turn.turnOrder).toHaveLength(playerCount);
    expect(game.units).toHaveLength(playerCount * 3);
    expect(game.controlPoints.filter(point => point.owner !== null)).toHaveLength(playerCount);
  });

  it('rejects unsupported player counts for artillery-zone', async () => {
    app = await startTestServer();
    const mapsRes = await app.inject({ method: 'GET', url: '/api/maps' });
    const map = mapsRes.json().maps.find((item: any) => item.id === 'artillery-zone');
    expect(map.preview.supportedPlayerCounts).toEqual([2, 3, 6]);

    for (const playerCount of [4, 5]) {
      const invalid = await app.inject({
        method: 'POST',
        url: '/api/games',
        payload: { mapId: 'artillery-zone', maxPlayers: playerCount, participate: true },
      });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json().code).toBe('unsupported_player_count');
    }
  });

  it('creates and starts a four-player game on four-corners', async () => {
    app = await startTestServer();
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mapId: 'four-corners', maxPlayers: 4, participate: true, playerName: 'A' },
    });
    expect(createRes.statusCode).toBe(200);
    const created = createRes.json() as { gameId: string; hostToken: string };
    for (const name of ['B', 'C', 'D']) {
      const joined = await app.inject({
        method: 'POST',
        url: `/api/games/${created.gameId}/join`,
        payload: { name },
      });
      expect(joined.statusCode).toBe(200);
    }
    const startRes = await app.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/start`,
      headers: { 'X-Host-Token': created.hostToken },
    });
    expect(startRes.statusCode).toBe(200);
    const game = globalStore.get(created.gameId)!;
    expect(game.cells).toHaveLength(163);
    expect(Object.keys(game.headquarters)).toHaveLength(4);
    expect(game.units).toHaveLength(8);
  });

  it('creates, fills and starts a 3-player lobby', async () => {
    app = await startTestServer();
    const lobby = await createThreePlayerLobby(app);
    const game = globalStore.get(lobby.gameId)!;
    expect(game.phase).toBe('active');
    expect(game.turn.turnOrder).toHaveLength(3);
    expect(Object.keys(game.players)).toHaveLength(3);
  });

  it('rejects unsupported maxPlayers for dual-player maps', async () => {
    app = await startTestServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mapId: 'default', maxPlayers: 4, participate: true },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('unsupported_player_count');
  });

  it('lets the host kick a lobby player before the game starts', async () => {
    app = await startTestServer();
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mapId: 'multiplayer-ring', maxPlayers: 3, participate: true, playerName: 'A' },
    });
    const created = createRes.json() as { gameId: string; hostToken: string };
    const joinRes = await app.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/join`,
      payload: { name: 'B' },
    });
    const playerB = joinRes.json().player as { id: PlayerId; token: string };

    const kickRes = await app.inject({
      method: 'DELETE',
      url: `/api/games/${created.gameId}/players/${playerB.id}`,
      headers: { 'X-Host-Token': created.hostToken },
    });
    expect(kickRes.statusCode).toBe(200);
    expect(kickRes.json().lobby.players.map((player: { id: PlayerId }) => player.id)).toEqual(['player_a']);

    const game = globalStore.get(created.gameId)!;
    expect(game.events.at(-1)).toMatchObject({
      type: 'player_left',
      payload: { playerId: playerB.id, reason: 'host' },
    });

    const kickedState = await app.inject({
      method: 'GET',
      url: `/api/games/${created.gameId}`,
      headers: { 'X-Player-Token': playerB.token },
    });
    expect(kickedState.statusCode).toBe(401);
  });

  it('rejects host kicks after the game starts', async () => {
    app = await startTestServer();
    const lobby = await createThreePlayerLobby(app);
    const game = globalStore.get(lobby.gameId)!;
    const victim = game.turn.turnOrder[1];

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/games/${lobby.gameId}/players/${victim}`,
      headers: { 'X-Host-Token': lobby.hostToken },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('game_already_started');
  });

  it('lets the host eliminate a player mid-match without ending a 3-player game', async () => {
    app = await startTestServer();
    const lobby = await createThreePlayerLobby(app);
    const game = globalStore.get(lobby.gameId)!;
    const victim = game.turn.turnOrder.find(id => id !== game.turn.currentPlayerId)!;

    const res = await app.inject({
      method: 'POST',
      url: `/api/games/${lobby.gameId}/host/eliminate`,
      headers: { 'X-Host-Token': lobby.hostToken },
      payload: { playerId: victim },
    });
    expect(res.statusCode).toBe(200);

    const updated = globalStore.get(lobby.gameId)!;
    expect(updated.phase).toBe('active');
    expect(updated.players[victim]?.status).toBe('eliminated');
    expect(updated.events.some(e => e.type === 'player_eliminated')).toBe(true);
    expect(updated.events.some(e => e.type === 'control_point_neutralized' || e.type === 'player_eliminated')).toBe(true);
  });

  it('exposes multiplayer elimination events on the public event feed for spectators', async () => {
    app = await startTestServer();
    const lobby = await createThreePlayerLobby(app);
    const game = globalStore.get(lobby.gameId)!;
    const victim = game.turn.turnOrder[1];

    await app.inject({
      method: 'POST',
      url: `/api/games/${lobby.gameId}/host/eliminate`,
      headers: { 'X-Host-Token': lobby.hostToken },
      payload: { playerId: victim },
    });

    const eventsRes = await app.inject({
      method: 'GET',
      url: `/api/games/${lobby.gameId}/events`,
    });
    expect(eventsRes.statusCode).toBe(200);
    const events = eventsRes.json().events as Array<{ type: string; payload: Record<string, unknown> }>;
    const start = events.find(e => e.type === 'game_start');
    expect(start?.payload.players).toBeTruthy();
    expect(start?.payload.turnOrder).toBeTruthy();
    expect(events.some(e => e.type === 'player_eliminated')).toBe(true);
  });

  it('still supports the classic two-player helper path', async () => {
    app = await startTestServer();
    const { gameId, tokenA } = await createGameAndJoin(app);
    const stateRes = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}`,
      headers: { 'X-Player-Token': tokenA },
    });
    expect(stateRes.statusCode).toBe(200);
    expect(stateRes.json().tokens).toBeUndefined();
    expect(stateRes.json().hostToken).toBeUndefined();
  });
});
