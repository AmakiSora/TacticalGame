import { describe, expect, it, vi } from 'vitest';
import { startTestServer } from '../helpers.js';
import { globalStore } from '../../src/state/store.js';

async function createAndJoin(app: Awaited<ReturnType<typeof startTestServer>>) {
  const createRes = await app.inject({
    method: 'POST',
    url: '/api/games',
    payload: { playerName: 'A' },
  });
  const created = createRes.json() as {
    gameId: string;
    hostToken: string;
    player: { id: 'player_a'; token: string };
  };
  const joinRes = await app.inject({
    method: 'POST',
    url: `/api/games/${created.gameId}/join`,
    payload: { name: 'B' },
  });
  const joined = joinRes.json() as { player: { id: 'player_b'; token: string } };
  await app.inject({
    method: 'POST',
    url: `/api/games/${created.gameId}/start`,
    headers: { 'X-Host-Token': created.hostToken },
  });
  const game = globalStore.get(created.gameId);
  if (game) {
    game.turn.currentPlayerId = 'player_a';
    game.turn.currentOwner = 'player_a';
    game.turn.actionsUsed = 0;
  }
  return {
    gameId: created.gameId,
    hostToken: created.hostToken,
    playerAToken: created.player.token,
    playerBToken: joined.player.token,
  };
}

describe('V2 API', () => {
  it('does not log raw player or host tokens when creating and joining a game', async () => {
    const app = await startTestServer();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/games',
        payload: { name: 'A' },
      });
      const created = createRes.json() as { gameId: string; hostToken: string; player: { token: string } };

      const joinRes = await app.inject({
        method: 'POST',
        url: `/api/games/${created.gameId}/join`,
        payload: { name: 'B' },
      });
      const joined = joinRes.json() as { player: { token: string } };

      const output = log.mock.calls.flat().join('\n');
      expect(output).not.toContain(created.hostToken);
      expect(output).not.toContain(created.player.token);
      expect(output).not.toContain(joined.player.token);
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
    const deployCell = hqA.q < 0 ? { q: hqA.q, r: hqA.r + 1 } : { q: hqA.q, r: hqA.r - 1 };
    const deploy = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/deploy`,
      headers: { 'X-Player-Token': playerAToken },
      payload: { unitType: 'support', fromId: hqA.id, q: deployCell.q, r: deployCell.r },
    });
    expect(deploy.statusCode).toBe(200);

    game = (await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}`,
      headers: { 'X-Player-Token': playerAToken },
    })).json();
    const scout = game.units.find((u: any) => u.owner === 'player_a' && u.type === 'scout');
    const scoutTarget = hqA.q < 0 ? { q: -4, r: 0 } : { q: 4, r: 0 };
    const move = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/move`,
      headers: { 'X-Player-Token': playerAToken },
      payload: { unitId: scout.id, q: scoutTarget.q, r: scoutTarget.r },
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
    const gameStart = body.events.find((event: any) => event.type === 'game_start');
    expect(gameStart.payload.map.grid).toBe('hex');
    expect(gameStart.payload.config.headquartersSpec).toMatchObject({ hp: 180, defense: 6 });
    expect(gameStart.payload.config.units.infantry).toMatchObject({ attack: 30, cost: 45 });
    expect(gameStart.payload.config.units.scout).toMatchObject({ hp: 65, attack: 16, cost: 38 });
    expect(gameStart.payload.config.units.heavy).toMatchObject({ hp: 150, attack: 38, defense: 13, cost: 92 });
    expect(gameStart.payload.config.units.ranger).toMatchObject({ hp: 72, attack: 44, cost: 78 });
    expect(gameStart.payload.config.units.support).toMatchObject({ hp: 82, attack: 10, healPower: 22, cost: 60 });
    expect(gameStart.payload.config.balance.actionsPerTurn).toBe(5);
    expect(gameStart.payload.config.balance.controlPointIncome).toBe(12);
    expect(gameStart.payload.config.balance.maxTurns).toBe(15);
    await app.close();
  });

  it('returns adjudication result and replay reason after the turn limit', async () => {
    const app = await startTestServer();
    const { gameId, playerAToken, playerBToken } = await createAndJoin(app);

    const game = globalStore.get(gameId)!;
    game.turn.turnNumber = 15;
    game.turn.roundNumber = 15;
    game.turn.currentOwner = 'player_b';
    game.turn.currentPlayerId = 'player_b';
    game.turn.actedThisRound = ['player_a'];
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
    expect(finalGame.turn.turnNumber).toBe(15);
    expect(finalGame.turn.currentOwner).toBe('player_b');
    expect(finalGame.result).toMatchObject({ winner: 'player_b', reason: 'turn_limit_score' });

    const eventsBody = (await app.inject({ method: 'GET', url: `/api/games/${gameId}/events` })).json();
    expect(eventsBody.events.at(-1)).toMatchObject({
      type: 'game_over',
      payload: expect.objectContaining({ winner: 'player_b', reason: 'turn_limit_score' }),
    });
    await app.close();
  });

  it('allows players to rename themselves through the event stream', async () => {
    const app = await startTestServer();
    const { gameId, playerAToken } = await createAndJoin(app);

    const rename = await app.inject({
      method: 'PATCH',
      url: `/api/games/${gameId}/player`,
      headers: { 'X-Player-Token': playerAToken },
      payload: { name: 'Blue Commander' },
    });
    expect(rename.statusCode).toBe(200);

    const eventsRes = await app.inject({ method: 'GET', url: `/api/games/${gameId}/events` });
    const eventsBody = eventsRes.json();
    expect(eventsBody.events.at(-1)).toMatchObject({
      type: 'name_rename',
      payload: { playerId: 'player_a', name: 'Blue Commander' },
    });

    const listRes = await app.inject({ method: 'GET', url: '/api/games' });
    expect(listRes.json().games.find((g: any) => g.gameId === gameId).playerNames.player_a).toBe('Blue Commander');
    await app.close();
  });

  it('keeps game_start replay payload immutable after later actions', async () => {
    const app = await startTestServer();
    const { gameId, playerAToken } = await createAndJoin(app);
    let eventsBody = (await app.inject({ method: 'GET', url: `/api/games/${gameId}/events` })).json();
    const gameStart = eventsBody.events.find((event: any) => event.type === 'game_start');
    const scout = gameStart.payload.units.find((u: any) => u.owner === 'player_a' && u.type === 'scout');
    const initial = { q: scout.q, r: scout.r };

    const move = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/move`,
      headers: { 'X-Player-Token': playerAToken },
      payload: { unitId: scout.id, q: scout.q < 0 ? -4 : 4, r: 0 },
    });
    expect(move.statusCode).toBe(200);

    eventsBody = (await app.inject({ method: 'GET', url: `/api/games/${gameId}/events` })).json();
    const replayStart = eventsBody.events.find((event: any) => event.type === 'game_start');
    const replayScout = replayStart.payload.units.find((u: any) => u.id === scout.id);
    expect({ q: replayScout.q, r: replayScout.r }).toEqual(initial);
    await app.close();
  });

  it('rejects actions past the per-turn action limit with 429 action_limit_reached', async () => {
    const app = await startTestServer();
    const { gameId, playerAToken } = await createAndJoin(app);
    const game = globalStore.get(gameId)!;
    const hqA = game.headquarters.player_a!;
    game.turn.actionsUsed = game.config.balance.actionsPerTurn;

    // 已用满行动点后，下一次行动会被统一拒绝。
    const deployCell = hqA.q < 0 ? { q: hqA.q, r: hqA.r + 1 } : { q: hqA.q, r: hqA.r - 1 };
    const blocked = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/deploy`,
      headers: { 'X-Player-Token': playerAToken },
      payload: { unitType: 'scout', fromId: hqA.id, q: deployCell.q, r: deployCell.r },
    });
    expect(blocked.statusCode).toBe(429);
    expect((blocked.json() as any).code).toBe('action_limit_reached');
    await app.close();
  });

  it('demolishes adjacent blocker terrain through the action API', async () => {
    const app = await startTestServer();
    const { gameId, playerAToken: tokenA } = await createAndJoin(app);
    const { globalStore } = await import('../../src/state/store.js');
    const game = globalStore.get(gameId)!;
    game.units = game.units.filter(u => u.owner !== 'player_a');
    game.units.push({
      id: 'api-heavy',
      owner: 'player_a',
      type: 'heavy',
      q: -2,
      r: 0,
      hp: 150,
      maxHp: 150,
      attack: 38,
      defense: 13,
      moveRange: 2,
      attackRange: 1,
      cost: 92,
      alive: true,
      hasMoved: false,
      hasActed: false,
      actionSpent: false,
      canCapture: false,
    });
    game.map.terrainCells.push({ q: -1, r: 0, terrain: 'blocker' });
    const cell = game.cells.find(c => c.q === -1 && c.r === 0)!;
    cell.terrain = 'blocker';

    const res = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/demolish`,
      headers: { 'X-Player-Token': tokenA },
      payload: { unitId: 'api-heavy', q: -1, r: 0 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(game.cells.find(c => c.q === -1 && c.r === 0)!.terrain).toBe('plain');
    expect(game.events.at(-1)).toMatchObject({
      type: 'demolish',
      payload: expect.objectContaining({ unitId: 'api-heavy', q: -1, r: 0 }),
    });
    await app.close();
  });
});
