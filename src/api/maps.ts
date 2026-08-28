// src/api/maps.ts
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { listMaps, previewForConfig } from '../config/loader.js';
import { generateRandomMapConfig, sanitizeRandomOptions } from '../config/randomMap.js';

export async function mapsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/maps', async () => {
    return { maps: listMaps() };
  });

  // 随机地图预览：按当前参数现场生成一张地图并返回与静态地图同构的预览数据。
  // 未传种子时服务端代抽一个并随响应返回，前端回填后保证预览与实际创建一致。
  app.post<{ Body: { maxPlayers?: number; random?: unknown } }>(
    '/api/maps/random/preview', async (req, reply) => {
      const maxPlayers = Number(req.body?.maxPlayers ?? 2);
      if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 8) {
        return reply.code(400).send({ error: 'unsupported player count', code: 'unsupported_player_count' });
      }
      try {
        const options = sanitizeRandomOptions(req.body?.random);
        const seed = options.seed ?? randomBytes(6).toString('hex');
        const config = generateRandomMapConfig({ ...options, seed }, maxPlayers);
        return { seed, preview: previewForConfig(config) };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'invalid random options';
        return reply.code(400).send({ error: `random map: ${message}`, code: 'invalid_move' });
      }
    },
  );
}
