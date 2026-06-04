// src/server.ts
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
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

const isMain = import.meta.url === `file:///${resolve(process.argv[1]).replace(/\\/g, '/')}`;
if (isMain) {
  const port = Number(process.env.PORT) || 3000;
  buildServer()
    .then(app => app.listen({ port, host: '0.0.0.0' }))
    .then(addr => {
      const base = `http://localhost:${port}`;
      console.log('');
      console.log('='.repeat(60));
      console.log('  战棋多人对战游戏 - Tactical Game Server');
      console.log('='.repeat(60));
      console.log('');
      console.log('  页面:');
      console.log(`    观战页面      ${base}/`);
      console.log(`    游戏页面      ${base}/play.html`);
      console.log('');
      console.log('  API 端点:');
      console.log(`    列出对局      GET   ${base}/api/games`);
      console.log(`    创建对局      POST  ${base}/api/games`);
      console.log(`    加入对局      POST  ${base}/api/games/:id/join`);
      console.log(`    查看对局      GET   ${base}/api/games/:id`);
      console.log(`    建造          POST  ${base}/api/games/:id/build`);
      console.log(`    生产          POST  ${base}/api/games/:id/produce`);
      console.log(`    移动          POST  ${base}/api/games/:id/move`);
      console.log(`    攻击          POST  ${base}/api/games/:id/attack`);
      console.log(`    治疗          POST  ${base}/api/games/:id/heal`);
      console.log(`    结束回合      POST  ${base}/api/games/:id/end-turn`);
      console.log('');
      console.log('='.repeat(60));
      console.log(`  Server listening on ${addr}`);
      console.log('='.repeat(60));
      console.log('');
    })
    .catch(err => { console.error(err); process.exit(1); });
}
