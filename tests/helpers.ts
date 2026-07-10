// tests/helpers.ts
import { buildServer } from '../src/server.js';
import type { FastifyInstance } from 'fastify';
import { globalStore } from '../src/state/store.js';

export async function startTestServer(): Promise<FastifyInstance> {
  const app = await buildServer();
  await app.ready();
  return app;
}

export async function createGameAndJoin(app: FastifyInstance) {
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
    method: 'POST', url: `/api/games/${created.gameId}/join`,
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
    tokenA: created.player.token,
    tokenB: joined.player.token,
    playerAToken: created.player.token,
    playerBToken: joined.player.token,
  };
}
