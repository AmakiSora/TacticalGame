// src/api/wait.ts
// AI 等待端点：有事件/轮次变化立即返回，超时返回 changed:false。
// 目的不是替代 SSE，而是让 agent 不再每 0.5–3 秒轮询完整状态。
import type { FastifyInstance } from 'fastify';
import { authenticate } from './auth.js';
import { globalEventBus } from '../events/bus.js';
import { inc } from '../utils/metrics.js';

const MAX_WAIT_MS = 25_000;
const MAX_CONCURRENT_WAITS_PER_PLAYER = 2;
const waits = new Map<string, number>();

function bump(key: string, delta: number): void {
  const next = (waits.get(key) ?? 0) + delta;
  if (next <= 0) waits.delete(key);
  else waits.set(key, next);
}

export async function waitRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string }; Querystring: { afterSeq?: string; timeout?: string } }>(
    '/api/games/:id/wait',
    async (req, reply) => {
      const ctx = authenticate(req, reply);
      if (!ctx) return;
      const game = ctx.game;
      const afterSeq = Number(req.query.afterSeq ?? 0);
      const after = Number.isFinite(afterSeq) ? Math.max(0, afterSeq) : 0;
      const timeoutSeconds = Number(req.query.timeout ?? 25);
      const timeoutMs = Math.min(
        MAX_WAIT_MS,
        Math.max(0, (Number.isFinite(timeoutSeconds) ? timeoutSeconds : 25) * 1000),
      );
      const latest = game.events.at(-1)?.seq ?? 0;
      if (latest > after) return { changed: true, seq: latest };

      const key = `${game.id}:${ctx.player}`;
      if ((waits.get(key) ?? 0) >= MAX_CONCURRENT_WAITS_PER_PLAYER) {
        reply.header('Retry-After', '1');
        return reply.code(429).send({ error: '该玩家等待中的请求过多', code: 'rate_limit' });
      }
      bump(key, 1);
      inc('tactical_ai_wait_total');

      return await new Promise((resolve) => {
        let done = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        let unsubscribe = (): void => {};
        let onClose = (): void => {};
        const finish = (payload: { changed: boolean; seq: number }): void => {
          if (done) return;
          done = true;
          if (timer) clearTimeout(timer);
          unsubscribe();
          req.raw.removeListener('close', onClose);
          bump(key, -1);
          resolve(payload);
        };
        onClose = (): void => finish({ changed: false, seq: latest });
        unsubscribe = globalEventBus.subscribe(game.id, event => {
          if (event.seq > after) finish({ changed: true, seq: event.seq });
        });
        timer = setTimeout(() => finish({ changed: false, seq: latest }), timeoutMs);
        timer.unref?.();
        req.raw.once('close', onClose);
      });
    },
  );
}
