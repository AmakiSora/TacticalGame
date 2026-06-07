// src/api/maps.ts
import type { FastifyInstance } from 'fastify';
import { listMaps } from '../config/loader.js';

export async function mapsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/maps', async () => {
    return { maps: listMaps() };
  });
}
