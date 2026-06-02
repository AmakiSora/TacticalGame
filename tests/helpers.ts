// tests/helpers.ts
import { buildServer } from '../src/server.js';
import type { FastifyInstance } from 'fastify';

export async function startTestServer(): Promise<FastifyInstance> {
  const app = await buildServer();
  await app.ready();
  return app;
}

export async function createGameAndJoin(app: FastifyInstance) {
  const createRes = await app.inject({ method: 'POST', url: '/api/games' });
  const created = createRes.json() as { gameId: string; playerAToken: string };

  const joinRes = await app.inject({
    method: 'POST', url: `/api/games/${created.gameId}/join`,
  });
  const joined = joinRes.json() as { playerBToken: string };

  return {
    gameId: created.gameId,
    tokenA: created.playerAToken,
    tokenB: joined.playerBToken,
  };
}
