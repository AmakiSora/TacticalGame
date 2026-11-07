// src/api/events.ts
import type { FastifyInstance } from 'fastify';
import { globalStore } from '../state/store.js';
import { globalEventBus } from '../events/bus.js';
import type { GameEvent } from '../types.js';
import { verifyToken } from '../state/tokens.js';
import { inc, setGauge } from '../utils/metrics.js';

const MAX_SSE_PER_GAME = 20;
const MAX_SSE_PER_IP = 10;
const MAX_SSE_PER_PLAYER = 5;
const HEARTBEAT_MS = 25_000;
const MAX_BUFFER_BYTES = 1024 * 1024;
const DRAIN_TIMEOUT_MS = 15_000;
const sseCounts = new Map<string, number>();
const sseIpCounts = new Map<string, number>();
const ssePlayerCounts = new Map<string, number>();
const activeConnections = new Set<() => void>();
const activeByGame = new Map<string, Set<() => void>>();
let activeSseTotal = 0;

function encodeSseEvent(event: GameEvent): string {
  return `id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`;
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

      // 配额：每局 + 每 IP + 每玩家；匿名连接没有玩家身份，只受每局/每 IP
      // 约束，避免同一局所有匿名客户端共用「3 条」桶而把正常观战者挡在门外。
      const ipKey = `${game.id}:${req.ip}`;
      const playerKey = viewer ? `${game.id}:${viewer}` : null;
      if ((sseCounts.get(game.id) ?? 0) >= MAX_SSE_PER_GAME
        || (sseIpCounts.get(ipKey) ?? 0) >= MAX_SSE_PER_IP
        || (playerKey !== null && (ssePlayerCounts.get(playerKey) ?? 0) >= MAX_SSE_PER_PLAYER)) {
        reply.header('Retry-After', '30');
        return reply.code(429).send({ error: '该对局的观战连接过多，请稍后再试', code: 'rate_limit' });
      }
      bump(sseCounts, game.id, 1);
      bump(sseIpCounts, ipKey, 1);
      if (playerKey !== null) bump(ssePlayerCounts, playerKey, 1);
      activeSseTotal += 1;
      setGauge('tactical_sse_connections', activeSseTotal);

      reply.raw.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      reply.hijack();
      let cleanedUp = false;
      let waitingForDrain = false;
      let drainTimer: NodeJS.Timeout | null = null;
      let historyIndex = 0;
      let retryPending = true;
      const pendingFrames: string[] = [];
      let pendingBytes = 0;

      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        clearInterval(heartbeat);
        if (drainTimer) clearTimeout(drainTimer);
        reply.raw.off('drain', onDrain);
        reply.raw.off('close', cleanup);
        reply.raw.off('error', close);
        unsubscribe();
        pendingFrames.length = 0;
        filtered.length = 0;
        activeConnections.delete(close);
        activeSseTotal = Math.max(0, activeSseTotal - 1);
        setGauge('tactical_sse_connections', activeSseTotal);
        bump(sseCounts, game.id, -1);
        bump(sseIpCounts, ipKey, -1);
        if (playerKey !== null) bump(ssePlayerCounts, playerKey, -1);
        const perGame = activeByGame.get(game.id);
        perGame?.delete(close);
        if (perGame && perGame.size === 0) activeByGame.delete(game.id);
      };
      const close = () => {
        cleanup();
        reply.raw.destroy();
      };
      const writeFrame = (frame: string): boolean => {
        if (cleanedUp || reply.raw.destroyed || reply.raw.writableEnded) return false;
        if (reply.raw.writableLength + pendingBytes + Buffer.byteLength(frame) > MAX_BUFFER_BYTES) {
          inc('tactical_sse_disconnect_total', { reason: 'buffer_limit' });
          close();
          return false;
        }
        try {
          // write(false) 已接收当前帧；drain 后只能发送下一帧，不能重发。
          if (reply.raw.write(frame)) return true;
        } catch {
          close();
          return false;
        }
        inc('tactical_sse_backpressure_total');
        waitingForDrain = true;
        drainTimer = setTimeout(() => {
          inc('tactical_sse_disconnect_total', { reason: 'drain_timeout' });
          close();
        }, DRAIN_TIMEOUT_MS);
        drainTimer.unref();
        return false;
      };
      const pump = () => {
        if (cleanedUp || waitingForDrain) return;
        if (retryPending) {
          retryPending = false;
          if (!writeFrame('retry: 3000\n\n')) return;
        }
        while (historyIndex < filtered.length) {
          const frame = encodeSseEvent(filtered[historyIndex++]!);
          if (!writeFrame(frame)) return;
        }
        while (pendingFrames.length > 0) {
          const frame = pendingFrames.shift()!;
          pendingBytes -= Buffer.byteLength(frame);
          if (!writeFrame(frame)) return;
        }
        if (closeAfterFlush) {
          cleanup();
          reply.raw.end();
        }
      };
      const onDrain = () => {
        waitingForDrain = false;
        if (drainTimer) clearTimeout(drainTimer);
        drainTimer = null;
        pump();
      };
      const unsubscribe = closeAfterFlush ? () => {} : globalEventBus.subscribe(game.id, ev => {
        if (cleanedUp) return;
        const frame = encodeSseEvent(ev);
        const bytes = Buffer.byteLength(frame);
        if (reply.raw.writableLength + pendingBytes + bytes > MAX_BUFFER_BYTES) {
          inc('tactical_sse_disconnect_total', { reason: 'buffer_limit' });
          close();
          return;
        }
        pendingFrames.push(frame);
        pendingBytes += bytes;
        pump();
      });
      const heartbeat = setInterval(() => {
        if (!waitingForDrain) writeFrame(': heartbeat\n\n');
      }, HEARTBEAT_MS);
      heartbeat.unref();
      activeConnections.add(close);
      if (!activeByGame.has(game.id)) activeByGame.set(game.id, new Set());
      activeByGame.get(game.id)!.add(close);
      reply.raw.on('drain', onDrain);
      reply.raw.once('close', cleanup);
      reply.raw.once('error', close);
      pump();
    },
  );
}
