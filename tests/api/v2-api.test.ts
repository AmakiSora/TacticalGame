import { describe, expect, it, vi } from 'vitest';
import { startTestServer } from '../helpers.js';
import { globalStore } from '../../src/state/store.js';

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
  it('logs game id and player tokens when creating and joining a game', async () => {
    const app = await startTestServer();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
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
      const joined = joinRes.json() as { playerBToken: string };

      expect(log).toHaveBeenCalledWith(`[game:create] gameId=${created.gameId} playerAToken=${created.playerAToken}`);
      expect(log).toHaveBeenCalledWith(`[game:join] gameId=${created.gameId} playerBToken=${joined.playerBToken}`);
    } finally {
      log.mockRestore();
      await app.close();
    }
  });

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
    expect(body.events[0].payload.config.balance.actionsPerTurn).toBe(5);
    expect(body.events[0].payload.config.balance.maxTurns).toBe(20);
    await app.close();
  });

  it('returns adjudication result and replay reason after the turn limit', async () => {
    const app = await startTestServer();
    const { gameId, playerAToken, playerBToken } = await createAndJoin(app);

    const game = globalStore.get(gameId)!;
    game.turn.turnNumber = 20;
    game.turn.currentOwner = 'player_b';
    game.resources.player_a.supplies = 0;
    game.resources.player_b.supplies = 10;
    game.units = [];
    game.controlPoints.forEach((p: any) => { p.owner = null; });
    game.headquarters.player_a.hp = 200;
    game.headquarters.player_b.hp = 200;

    const end = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/end-turn`,
      headers: { 'X-Player-Token': playerBToken },
      payload: {},
    });
    expect(end.statusCode).toBe(200);

    const finalRes = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}`,
      headers: { 'X-Player-Token': playerAToken },
    });
    const finalGame = finalRes.json() as any;
    expect(finalGame.tokens).toBeUndefined();
    expect(finalGame.phase).toBe('game_over');
    expect(finalGame.turn.turnNumber).toBe(20);
    expect(finalGame.turn.currentOwner).toBe('player_b');
    expect(finalGame.result).toMatchObject({ winner: 'player_b', reason: 'turn_limit_score' });

    const eventsBody = (await app.inject({ method: 'GET', url: `/api/games/${gameId}/events` })).json();
    expect(eventsBody.events.at(-1)).toMatchObject({
      type: 'game_over',
      payload: expect.objectContaining({ winner: 'player_b', reason: 'turn_limit_score' }),
    });
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

  it('rejects actions past the per-turn action limit with 429 action_limit_reached', async () => {
    const app = await startTestServer();
    const { gameId, playerAToken } = await createAndJoin(app);
    const fetchGame = () => app.inject({
      method: 'GET', url: `/api/games/${gameId}`, headers: { 'X-Player-Token': playerAToken },
    });

    // Move all 3 starting units out of the HQ ring (3 action points), freeing
    // (-7,0) and (-7,-1) as deploy cells, then deploy 2 scouts there (2 more = 5 total).
    let game = (await fetchGame()).json() as any;
    const hqA = game.headquarters.player_a;
    const starters = game.units.filter((u: any) => u.owner === 'player_a');
    for (const u of starters) {
      const res = await app.inject({
        method: 'POST', url: `/api/games/${gameId}/move`,
        headers: { 'X-Player-Token': playerAToken },
        payload: { unitId: u.id, q: u.q + 1, r: u.r },
      });
      expect(res.statusCode).toBe(200);
    }
    for (const cell of [{ q: -7, r: 0 }, { q: -7, r: -1 }]) {
      const res = await app.inject({
        method: 'POST', url: `/api/games/${gameId}/deploy`,
        headers: { 'X-Player-Token': playerAToken },
        payload: { unitType: 'scout', fromId: hqA.id, q: cell.q, r: cell.r },
      });
      expect(res.statusCode).toBe(200);
    }

    // 6th action (any deploy) is rejected with the action-limit code.
    const blocked = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/deploy`,
      headers: { 'X-Player-Token': playerAToken },
      payload: { unitType: 'scout', fromId: hqA.id, q: -8, r: 1 },
    });
    expect(blocked.statusCode).toBe(429);
    expect((blocked.json() as any).code).toBe('action_limit_reached');
    await app.close();
  });
});
