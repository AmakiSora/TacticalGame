// src/server.ts
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { gamesRoutes } from './api/games.js';
import { actionsRoutes } from './api/actions.js';
import { eventsRoutes } from './api/events.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(gamesRoutes);
  await app.register(actionsRoutes);
  await app.register(eventsRoutes);
  await app.register(fastifyStatic, { root: PUBLIC_DIR, prefix: '/' });
  return app;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const port = Number(process.env.PORT) || 3000;
  buildServer()
    .then(app => app.listen({ port, host: '0.0.0.0' }))
    .then(addr => console.log(`Server listening on ${addr}`))
    .catch(err => { console.error(err); process.exit(1); });
}
