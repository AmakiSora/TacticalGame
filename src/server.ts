import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { loadMaps } from './config/loader.js';
import { gamesRoutes } from './api/games.js';
import { actionsRoutes } from './api/actions.js';
import { closeSseConnections, eventsRoutes } from './api/events.js';
import { mapsRoutes } from './api/maps.js';
import { controlRoutes } from './api/control.js';
import { globalStore } from './state/store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');
const PROTECTED_RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60_000;

interface RuntimeConfig {
  host: string;
  port: number;
  trustProxy: boolean;
}

function readPort(value = process.env.PORT): number {
  if (!value) return 3100;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  return port;
}

function parseBoolean(value: string | undefined, name: string): boolean {
  if (value === undefined || value === 'false') return false;
  if (value === 'true') return true;
  throw new Error(`${name} must be "true" or "false"`);
}

export function readRuntimeConfig(): RuntimeConfig {
  return {
    host: process.env.HOST || '0.0.0.0',
    port: readPort(),
    trustProxy: parseBoolean(process.env.TRUST_PROXY, 'TRUST_PROXY'),
  };
}

function isRateLimitedPath(method: string, url: string): boolean {
  if (method === 'POST' && (url === '/api/games' || /\/api\/games\/[^/]+\/(join|deploy|move|attack|heal|demolish|end-turn)$/.test(url))) return true;
  return method === 'GET' && /\/api\/games\/[^/]+\/events$/.test(url);
}

export async function buildServer(): Promise<FastifyInstance> {
  let ready = false;
  const production = process.env.NODE_ENV === 'production';
  const logLevel = process.env.LOG_LEVEL || (production ? 'info' : 'warn');
  const requestCounts = new Map<string, { count: number; resetAt: number }>();

  loadMaps();
  globalStore.loadFromDisk();
  const app = Fastify({
    logger: {
      level: logLevel,
      redact: {
        paths: ['req.headers.x-player-token', 'req.headers.x-host-token', 'req.headers.x-control-token', 'req.query.token'],
        censor: '[REDACTED]',
      },
    },
    trustProxy: readRuntimeConfig().trustProxy,
    bodyLimit: 64 * 1024,
  });

  app.addHook('onRequest', async (req, reply) => {
    const url = req.url.split('?')[0]!;
    if (!isRateLimitedPath(req.method, url)) return;
    const key = `${req.ip}:${req.method}:${url.replace(/\/api\/games\/[^/]+/, '/api/games/:id')}`;
    const now = Date.now();
    const entry = requestCounts.get(key);
    if (!entry || entry.resetAt <= now) {
      requestCounts.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
      return;
    }
    entry.count += 1;
    if (entry.count > PROTECTED_RATE_LIMIT) {
      reply.code(429).send({ error: 'too many requests', code: 'rate_limit' });
    }
  });

  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/readyz', async (_req, reply) => {
    if (!ready) return reply.code(503).send({ status: 'starting' });
    return { status: 'ready' };
  });
  await app.register(mapsRoutes);
  await app.register(gamesRoutes);
  await app.register(actionsRoutes);
  await app.register(eventsRoutes);
  await app.register(controlRoutes);
  await app.register(fastifyStatic, { root: PUBLIC_DIR, prefix: '/' });
  ready = true;
  return app;
}

const isMain = process.argv[1] !== undefined && ( import.meta.url === 'file://' + resolve(process.argv[1]) || import.meta.url.endsWith('/dist/server.js'));
if (isMain) {
  const config = readRuntimeConfig();
  buildServer()
    .then(async app => {
      let closing = false;
      const shutdown = (signal: string) => {
        if (closing) return;
        closing = true;
        app.log.info({ signal }, 'shutting down server');
        closeSseConnections();
        app.close()
          .then(() => process.exit(0))
          .catch(err => { app.log.error(err, 'failed to shut down cleanly'); process.exit(1); });
      };
      process.once('SIGTERM', () => shutdown('SIGTERM'));
      process.once('SIGINT', () => shutdown('SIGINT'));
      const addr = await app.listen({ port: config.port, host: config.host });
      app.log.info({ addr, host: config.host, port: config.port }, 'Tactical Game server listening');
    })
    .catch(err => { console.error(err); process.exit(1); });
}
