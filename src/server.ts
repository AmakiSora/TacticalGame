// src/server.ts
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { loadMaps } from './config/loader.js';
import { gamesRoutes } from './api/games.js';
import { actionsRoutes } from './api/actions.js';
import { eventsRoutes } from './api/events.js';
import { mapsRoutes } from './api/maps.js';
import { controlRoutes } from './api/control.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');

export async function buildServer(): Promise<FastifyInstance> {
  loadMaps();
  const app = Fastify({ logger: false });
  await app.register(mapsRoutes);
  await app.register(gamesRoutes);
  await app.register(actionsRoutes);
  await app.register(eventsRoutes);
  await app.register(controlRoutes);
  await app.register(fastifyStatic, { root: PUBLIC_DIR, prefix: '/' });
  return app;
}

const isMain = import.meta.url === `file:///${resolve(process.argv[1]).replace(/\\/g, '/')}`;
if (isMain) {
  const port = Number(process.env.PORT) || 3100;
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
      console.log(`    观战页面      ${base}/spectator.html`);
      console.log(`    游戏页面      ${base}/play.html`);
      console.log(`    地图编辑器    ${base}/map-editor.html`);
      console.log('');
      console.log('  API 端点:');
      console.log(`    地图列表      GET   ${base}/api/maps`);
      console.log(`    列出对局      GET   ${base}/api/games`);
      console.log(`    创建对局      POST  ${base}/api/games`);
      console.log(`    加入对局      POST  ${base}/api/games/:id/join`);
      console.log(`    查看对局      GET   ${base}/api/games/:id`);
      console.log(`    部署          POST  ${base}/api/games/:id/deploy`);
      console.log(`    移动          POST  ${base}/api/games/:id/move`);
      console.log(`    攻击          POST  ${base}/api/games/:id/attack`);
      console.log(`    治疗          POST  ${base}/api/games/:id/heal`);
      console.log(`    结束回合      POST  ${base}/api/games/:id/end-turn`);
      console.log(`    控制台        GET   ${base}/control.html`);
      if (!process.env.AUTO_CONTROL_TOKEN) {
        console.log('    控制台警告    AUTO_CONTROL_TOKEN 未设置，仅允许本机访问控制 API');
      }
      console.log('');
      console.log('='.repeat(60));
      console.log(`  Server listening on ${addr}`);
      console.log('='.repeat(60));
      console.log('');
    })
    .catch(err => { console.error(err); process.exit(1); });
}
