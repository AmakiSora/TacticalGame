import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCompress from '@fastify/compress';
import fastifyCors from '@fastify/cors';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { loadMaps, mapCount } from './config/loader.js';
import { gamesRoutes } from './api/games.js';
import { botsRoutes } from './api/bots.js';
import { arenaEvalRoutes } from './api/arenaEval.js';
import { actionsRoutes } from './api/actions.js';
import { closeSseConnections, eventsRoutes } from './api/events.js';
import { waitRoutes } from './api/wait.js';
import { clearBotsForGame } from './api/bots.js';
import { globalEventBus } from './events/bus.js';
import { mapsRoutes } from './api/maps.js';
import { skillRoutes } from './api/skill.js';
import { recordsRoutes } from './api/records.js';
import { globalStore } from './state/store.js';
import { logger } from './utils/logger.js';
import { inc, observe, renderMetrics } from './utils/metrics.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// dev（tsx 跑 src/）托管源目录 public/；生产（node dist/server.js）托管 Vite 产物 dist-public/。
const PUBLIC_DIR = join(__dirname, '..', __dirname.replace(/\\/g, '/').endsWith('/dist') ? 'dist-public' : 'public');
const DEFAULT_PROTECTED_RATE_LIMIT = 120;
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

function readProtectedRateLimit(value = process.env.TACTICAL_GAME_RATE_LIMIT): number {
  if (value === undefined || value === '') return DEFAULT_PROTECTED_RATE_LIMIT;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('TACTICAL_GAME_RATE_LIMIT must be a positive integer');
  }
  return limit;
}

export function readRuntimeConfig(): RuntimeConfig {
  return {
    host: process.env.HOST || '0.0.0.0',
    port: readPort(),
    trustProxy: parseBoolean(process.env.TRUST_PROXY, 'TRUST_PROXY'),
  };
}

function isRateLimitedPath(method: string, url: string): boolean {
  if (method === 'GET' && /\/api\/games\/[^/]+\/events$/.test(url)) return true;
  // 随机地图预览是 CPU 生成入口；没有理由绕过限流。
  if (method === 'POST' && url === '/api/maps/random/preview') return true;
  // 所有对局写接口（动作、计划、房主管理、删除、加入/离开）统一覆盖。
  return ['POST', 'PATCH', 'DELETE'].includes(method) && /^\/api\/games(\/|$)/.test(url);
}

export async function buildServer(): Promise<FastifyInstance> {
  let ready = false;
  const production = process.env.NODE_ENV === 'production';
  const logLevel = process.env.LOG_LEVEL || (production ? 'info' : 'warn');
  // The default protects a public server from accidental request floods.
  // Local RL experiments can explicitly raise it because one environment
  // step may issue several authenticated action requests per minute.
  const protectedRateLimit = readProtectedRateLimit();
  const requestCounts = new Map<string, { count: number; resetAt: number }>();

  loadMaps();
  globalStore.loadFromDisk();
  const app = Fastify({
    logger: {
      level: logLevel,
      redact: {
        paths: [
          'req.headers.x-player-token', 'req.headers.x-host-token', 'req.headers.x-control-token',
          'req.headers.x-metrics-token', 'req.headers.authorization', 'req.query.token',
        ],
        censor: '[REDACTED]',
      },
      serializers: {
        // pino 默认 req serializer 会输出完整 req.url；控制 token/SSE token 允许走
        // 查询串，因此必须在这里按参数名脱敏，而不是只依赖上面的 redact 路径。
        req(request: { method?: string; url?: string; host?: string; ip?: string; socket?: { remotePort?: number } }) {
          const rawUrl = typeof request.url === 'string' ? request.url : '';
          return {
            method: request.method,
            url: rawUrl.replace(/([?&](?:token|access_token)=)[^&]*/gi, '$1[REDACTED]'),
            host: request.host,
            remoteAddress: request.ip,
            remotePort: request.socket?.remotePort,
          };
        },
      },
    },
    trustProxy: readRuntimeConfig().trustProxy,
    bodyLimit: 64 * 1024,
  });

  // Enable gzip/brotli compression for all responses (especially large JSON files)
  await app.register(fastifyCompress, {
    global: true,
    threshold: 1024, // Only compress responses > 1KB
    encodings: ['gzip', 'deflate', 'br'],
  });

  // Enable CORS for cross-origin requests (configurable via env)
  // 逐项 trim 并丢弃空段，避免 "a.com, b.com" 里带空格的源匹配失败。
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
  await app.register(fastifyCors, {
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    credentials: true,
  });

  app.addHook('onRequest', async (req, reply) => {
    const url = req.url.split('?')[0]!;
    if (!isRateLimitedPath(req.method, url)) return;
    const key = `${req.ip}:${req.method}:${url
      .replace(/\/api\/games\/[^/]+/, '/api/games/:id')
      .replace(/\/players\/[^/]+/, '/players/:playerId')}`;
    const now = Date.now();
    const entry = requestCounts.get(key);
    if (!entry || entry.resetAt <= now) {
      requestCounts.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
      // 固定窗口计数表必须有界：超过上限先清过期桶，再从最旧条目开始丢弃。
      if (requestCounts.size > 10_000) {
        for (const [bucketKey, bucket] of requestCounts) {
          if (bucket.resetAt <= now) requestCounts.delete(bucketKey);
          if (requestCounts.size <= 9_000) break;
        }
        while (requestCounts.size > 10_000) {
          const oldest = requestCounts.keys().next().value;
          if (oldest === undefined) break;
          requestCounts.delete(oldest);
        }
      }
      return;
    }
    entry.count += 1;
    if (entry.count > protectedRateLimit) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      reply.header('Retry-After', String(retryAfter));
      inc('tactical_rate_limited_total');
      reply.code(429).send({ error: '请求过于频繁，请稍后再试', code: 'rate_limit' });
    }
  });

  app.addHook('onResponse', async (req, reply) => {
    // 路由模板而非原始 URL：避免把 gameId 等动态段带进指标标签。
    const route = req.routeOptions?.url ?? 'unknown';
    const labels = { method: req.method, route, status: String(reply.statusCode) };
    observe('tactical_http_duration_ms', reply.elapsedTime, labels);
    inc('tactical_http_requests_total', labels);
  });

  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/readyz', async (_req, reply) => {
    if (!ready) return reply.code(503).send({ status: 'starting' });
    // 成功响应必须保持 CI smoke 精确断言的 {"status":"ready"}；降级时才附带 checks。
    const checks = {
      maps: mapCount() > 0 ? 'ok' : 'missing',
      persistence: globalStore.isPersistenceWritable() ? 'ok' : 'unwritable',
    };
    if (checks.maps !== 'ok' || checks.persistence !== 'ok') {
      return reply.code(503).send({ status: 'degraded', checks });
    }
    return { status: 'ready' };
  });
  app.get('/metrics', async (req, reply) => {
    const expected = process.env.METRICS_TOKEN;
    if (expected) {
      const provided = req.headers['x-metrics-token']
        ?? (typeof req.headers.authorization === 'string'
          ? req.headers.authorization.replace(/^Bearer\s+/i, '')
          : undefined);
      if (provided !== expected) {
        return reply.code(401).send({ error: '指标凭证无效', code: 'invalid_metrics_token' });
      }
    }
    return reply.type('text/plain; version=0.0.4; charset=utf-8').send(renderMetrics());
  });
  await app.register(mapsRoutes);
  await app.register(gamesRoutes);
  await app.register(botsRoutes);
  await app.register(arenaEvalRoutes);
  await app.register(actionsRoutes);
  await app.register(eventsRoutes);
  await app.register(waitRoutes);
  await app.register(skillRoutes);
  await app.register(recordsRoutes);
  // 静态资源缓存策略（cacheControl: false 关闭默认的 public, max-age=0，
  // 否则它会在 setHeaders 之后再次写入并覆盖自定义值）：
  //  - /assets/*：Vite 产物，文件名含内容 hash，可永久缓存；
  //  - /icons/*：极少变化的图标，按天缓存；
  //  - HTML 与 /data/*.json（stats 脚本可重新生成）：no-cache，走协商缓存保证新鲜。
  await app.register(fastifyStatic, {
    root: PUBLIC_DIR,
    prefix: '/',
    cacheControl: false,
    setHeaders(res, filePath) {
      // filePath 为磁盘绝对路径；windows 下是反斜杠，统一成斜杠再判断。
      const normalized = filePath.replace(/\\/g, '/');
      if (normalized.includes('/assets/')) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else if (normalized.includes('/icons/')) {
        res.setHeader('Cache-Control', 'public, max-age=86400');
      } else {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  });

  // 生命周期 GC：lobby / 终局对局按最后活动时间归档并移除；active 不自动删除。
  if (!process.env.VITEST) {
    const hours = (value: string | undefined, fallback: number): number => {
      if (value === undefined || value === '') return fallback;
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
    };
    const lobbyTtlMs = hours(process.env.TACTICAL_GAME_LOBBY_TTL_HOURS, 24) * 3_600_000;
    const gameOverTtlMs = hours(process.env.TACTICAL_GAME_OVER_TTL_HOURS, 7 * 24) * 3_600_000;
    if (lobbyTtlMs > 0 || gameOverTtlMs > 0) {
      const retentionTimer = setInterval(() => {
        try {
          const removed = globalStore.pruneInactive({ lobbyTtlMs, gameOverTtlMs });
          for (const gameId of removed) {
            globalEventBus.clear(gameId);
            clearBotsForGame(gameId);
            closeSseConnections(gameId);
            app.log.info({ gameId }, 'archived and removed inactive game');
          }
        } catch (err) {
          // 持久化/归档失败不能把定时器异常抛成未捕获异常导致进程退出；
          // 下一轮会重试，快照仍在磁盘上。
          app.log.error(err, 'failed to prune inactive games');
        }
      }, 10 * 60_000);
      retentionTimer.unref();
      app.addHook('onClose', async () => clearInterval(retentionTimer));
    }
  }

  ready = true;
  return app;
}

const isMain = process.argv[1] !== undefined && (import.meta.url === pathToFileURL(resolve(process.argv[1])).href || import.meta.url.endsWith('/dist/server.js'));
if (isMain) {
  const config = readRuntimeConfig();
  buildServer()
    .then(async app => {
      let closing = false;
      const shutdown = (signal: string) => {
        if (closing) return;
        closing = true;
        app.log.info({ signal }, 'shutting down server');
        // 退出前导出一份旧格式 games.json，便于回滚到 3.6.x；失败不阻止关闭。
        try {
          globalStore.flush();
        } catch (err) {
          app.log.error(err, 'failed to export legacy games.json on shutdown');
        }
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
    .catch(err => { logger.error('Server startup failed', err); process.exit(1); });
}
