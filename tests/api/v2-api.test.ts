import { describe, expect, it } from 'vitest';
import { startTestServer } from '../helpers.js';

async function createAndJoin(app: Awaited<ReturnType<typeof startTestServer>>) {
  const createRes = await app.inject({
    method: 'POST',
    url: '/api/games',
    payload: { name: 'A' },
  });
  const created = createRes.json() as { gameId: string; playerAToken: string };
  const joinRes = await app.inject({
    method: 'POST',
    url: `/api/games/${created.gameId}/join`,
    payload: { name: 'B' },
  });
  return { ...created, playerBToken: (joinRes.json() as { playerBToken: string }).playerBToken };
}

describe('V2 API', () => {
  it('creates hex games and returns sanitized q/r state', async () => {
    const app = await startTestServer();
    const { gameId, playerAToken } = await createAndJoin(app);

    const res = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}`,
      headers: { 'X-Player-Token': playerAToken },
    });

    expect(res.statusCode).toBe(200);
    const game = res.json();
    expect(game.tokens).toBeUndefined();
    expect(game.map.radius).toBe(8);
    expect(game.units[0]).toHaveProperty('q');
    expect(game.units[0]).not.toHaveProperty('x');
    await app.close();
  });

  it('supports deploy, move, attack, heal and end-turn endpoints', async () => {
    const app = await startTestServer();
    const { gameId, playerAToken } = await createAndJoin(app);
    let game = (await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}`,
      headers: { 'X-Player-Token': playerAToken },
    })).json();

    const hqA = game.headquarters.player_a;
    const deploy = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/deploy`,
      headers: { 'X-Player-Token': playerAToken },
      payload: { unitType: 'support', fromId: hqA.id, q: -8, r: 1 },
    });
    expect(deploy.statusCode).toBe(200);

    game = (await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}`,
      headers: { 'X-Player-Token': playerAToken },
    })).json();
    const scout = game.units.find((u: any) => u.owner === 'player_a' && u.type === 'scout');
    const move = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/move`,
      headers: { 'X-Player-Token': playerAToken },
      payload: { unitId: scout.id, q: -4, r: 0 },
    });
    expect(move.statusCode).toBe(200);

    const end = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/end-turn`,
      headers: { 'X-Player-Token': playerAToken },
      payload: {},
    });
    expect(end.statusCode).toBe(200);
    await app.close();
  });

  it('does not expose old build, produce or sell actions', async () => {
    const app = await startTestServer();
    const { gameId, playerAToken } = await createAndJoin(app);
    for (const path of ['build', 'produce', 'sell']) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/games/${gameId}/${path}`,
        headers: { 'X-Player-Token': playerAToken },
        payload: {},
      });
      expect(res.statusCode).toBe(404);
    }
    await app.close();
  });

  it('serves V2 events for replay', async () => {
    const app = await startTestServer();
    const { gameId } = await createAndJoin(app);
    const res = await app.inject({ method: 'GET', url: `/api/games/${gameId}/events` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.events[0].type).toBe('game_start');
    expect(body.events[0].payload.map.grid).toBe('hex');
    await app.close();
  });

  it('allows spectators to rename players through the event stream', async () => {
    const app = await startTestServer();
    const { gameId } = await createAndJoin(app);

    const rename = await app.inject({
      method: 'PATCH',
      url: `/api/games/${gameId}/rename`,
      payload: { playerId: 'player_a', name: 'Blue Commander' },
    });
    expect(rename.statusCode).toBe(200);

    const eventsRes = await app.inject({ method: 'GET', url: `/api/games/${gameId}/events` });
    const eventsBody = eventsRes.json();
    expect(eventsBody.events.at(-1)).toMatchObject({
      type: 'name_rename',
      payload: { playerId: 'player_a', name: 'Blue Commander' },
    });

    const listRes = await app.inject({ method: 'GET', url: '/api/games' });
    expect(listRes.json().games.find((g: any) => g.id === gameId).playerNames.player_a).toBe('Blue Commander');
    await app.close();
  });

  it('keeps game_start replay payload immutable after later actions', async () => {
    const app = await startTestServer();
    const { gameId, playerAToken } = await createAndJoin(app);
    let eventsBody = (await app.inject({ method: 'GET', url: `/api/games/${gameId}/events` })).json();
    const scout = eventsBody.events[0].payload.units.find((u: any) => u.owner === 'player_a' && u.type === 'scout');
    const initial = { q: scout.q, r: scout.r };

    const move = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/move`,
      headers: { 'X-Player-Token': playerAToken },
      payload: { unitId: scout.id, q: -4, r: 0 },
    });
    expect(move.statusCode).toBe(200);

    eventsBody = (await app.inject({ method: 'GET', url: `/api/games/${gameId}/events` })).json();
    const replayScout = eventsBody.events[0].payload.units.find((u: any) => u.id === scout.id);
    expect({ q: replayScout.q, r: replayScout.r }).toEqual(initial);
    await app.close();
  });
});
