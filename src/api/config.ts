// src/api/config.ts
import type { FastifyInstance } from 'fastify';
import { getConfig } from '../config/loader.js';

export async function configRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/config', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=3600');
    return getConfig();
  });
}
