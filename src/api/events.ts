// src/api/events.ts
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { globalStore } from '../state/store.js';
import { globalEventBus } from '../events/bus.js';
import type { GameEvent } from '../types.js';
import { verifyToken } from '../state/tokens.js';
import { inc, setGauge } from '../utils/metrics.js';

const MAX_SSE_PER_GAME = 20;
const MAX_SSE_PER_IP = 10;
const MAX_SSE_PER_PLAYER = 5;
const HEARTBEAT_MS = 25_000;
const sseCounts = new Map<string, number>();
const sseIpCounts = new Map<string, number>();
const ssePlayerCounts = new Map<string, number>();
const activeConnections = new Set<() => void>();
const activeByGame = new Map<string, Set<() => void>>();
let activeSseTotal = 0;

function writeSseEvent(reply: FastifyReply, event: GameEvent): boolean {
  const payload = JSON.stringify(event);
  const ok = reply.raw.write(`id: ${event.seq}\ndata: ${payload}\n\n`);
  if (!ok) inc('tactical_sse_backpressure_total');
  return ok;
}

function writeHeartbeat(reply: FastifyReply): void {
  reply.raw.write(': heartbeat\n\n');
}

export function closeSseConnections(gameId?: string): void {
  const targets = gameId
    ? [...(activeByGame.get(gameId) ?? [])]
    : [...activeConnections];
  for (const close of targets) close();
}

function bump(map: Map<string, number>, key: string, delta: number): void {
  const next = (map.get(key) ?? 0) + delta;
  if (next <= 0) map.delete(key);
  else map.set(key, next);
}

export async function eventsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string }; Querystring: { after?: string; close?: string; token?: string } }>(
    '/api/games/:id/events',
    async (req, reply) => {
      const game = globalStore.get(req.params.id);
      if (!game) {
        return reply.code(404).send({ error: '找不到该对局', code: 'game_not_found' });
      }

      const wantsSse = (req.headers.accept ?? '').includes('text/event-stream');
      const closeAfterFlush = req.query.close === 'true';

      // For SSE: token is optional (spectators can connect without one).
      let viewer: string | null = null;
      if (wantsSse && !closeAfterFlush) {
        const token = req.headers['x-player-token'] ?? req.query.token;
        if (typeof token === 'string' && token.length > 0) {
          const matched = Object.entries(game.tokens).find(([, stored]) => verifyToken(token, stored));
          if (!matched) {
            return reply.code(401).send({ error: '玩家凭证无效', code: 'invalid_token' });
          }
          viewer = matched[0];
        }
      }

      // Last-Event-ID 是浏览器自动重连时带的游标；与 after 取较大值。
      const queryAfter = req.query.after ? Number(req.query.after) : 0;
      const headerAfter = Number(req.headers['last-event-id']);
      const after = Math.max(
        Number.isFinite(queryAfter) ? queryAfter : 0,
        Number.isFinite(headerAfter) ? headerAfter : 0,
      );
      const filtered = game.events.filter(e => e.seq > after);

      if (!wantsSse) {
        return { events: filtered };
      }

      // 配额：每局 + 每 IP + 每玩家；匿名观战额度更低。
      const ipKey = `${game.id}:${req.ip}`;
      const playerKey = `${game.id}:${viewer ?? 'anonymous'}`;
      const perPlayerLimit = viewer ? MAX_SSE_PER_PLAYER : 3;
      if ((sseCounts.get(game.id) ?? 0) >= MAX_SSE_PER_GAME
        || (sseIpCounts.get(ipKey) ?? 0) >= MAX_SSE_PER_IP
        || (ssePlayerCounts.get(playerKey) ?? 0) >= perPlayerLimit) {
        reply.header('Retry-After', '30');
        return reply.code(429).send({ error: '该对局的观战连接过多，请稍后再试', code: 'rate_limit' });
      }
      bump(sseCounts, game.id, 1);
      bump(sseIpCounts, ipKey, 1);
      bump(ssePlayerCounts, playerKey, 1);
      activeSseTotal += 1;
      setGauge('tactical_sse_connections', activeSseTotal);

      reply.raw.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      reply.hijack();
      reply.raw.write('retry: 3000\n\n');

      // Send all existing events.
      for (const ev of filtered) {
        writeSseEvent(reply, ev);
      }

      let slowWrites = 0;
      // Subscribe to future events and push them as they arrive.
      const unsubscribe = globalEventBus.subscribe(game.id, ev => {
        if (reply.raw.writableEnded) return;
        if (!writeSseEvent(reply, ev)) {
          slowWrites += 1;
          // 连续写不进去说明客户端读得太慢：断开，让客户端用 Last-Event-ID 重连补尾部。
          if (slowWrites >= 5) close();
        } else {
          slowWrites = 0;
        }
      });
      const heartbeat = setInterval(() => {
        if (!reply.raw.writableEnded) writeHeartbeat(reply);
      }, HEARTBEAT_MS);
      heartbeat.unref();
      let cleanedUp = false;
      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        clearInterval(heartbeat);
        unsubscribe();
        activeConnections.delete(close);
        activeSseTotal = Math.max(0, activeSseTotal - 1);
        setGauge('tactical_sse_connections', activeSseTotal);
        bump(sseCounts, game.id, -1);
        bump(sseIpCounts, ipKey, -1);
        bump(ssePlayerCounts, playerKey, -1);
        const perGame = activeByGame.get(game.id);
        perGame?.delete(close);
        if (perGame && perGame.size === 0) activeByGame.delete(game.id);
      };
      const close = () => {
        cleanup();
        if (!reply.raw.writableEnded) reply.raw.end();
      };
      activeConnections.add(close);
      if (!activeByGame.has(game.id)) activeByGame.set(game.id, new Set());
      activeByGame.get(game.id)!.add(close);

      // Clean up when the client disconnects.
      req.raw.once('close', cleanup);

      // For test clients: close after flushing historical events.
      if (closeAfterFlush) close();
    },
  );
}
