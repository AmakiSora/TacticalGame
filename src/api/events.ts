// src/api/events.ts
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { globalStore } from '../state/store.js';
import { globalEventBus } from '../events/bus.js';
import type { GameEvent } from '../types.js';

const MAX_SSE_PER_GAME = 20;
const sseCounts = new Map<string, number>();

function writeSseEvent(reply: FastifyReply, event: GameEvent): void {
  const payload = JSON.stringify(event);
  reply.raw.write(`data: ${payload}\n\n`);
}

export async function eventsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string }; Querystring: { after?: string; close?: string; token?: string } }>(
    '/api/games/:id/events',
    async (req, reply) => {
      const game = globalStore.get(req.params.id);
      if (!game) {
        return reply.code(404).send({ error: 'game not found', code: 'game_not_found' });
      }

      const wantsSse = (req.headers.accept ?? '').includes('text/event-stream');
      const closeAfterFlush = req.query.close === 'true';

      // For SSE: token is optional (spectators can connect without one)
      if (wantsSse && !closeAfterFlush) {
        const token = req.headers['x-player-token'] ?? req.query.token;
        if (typeof token === 'string' && token.length > 0) {
          const isValid = game.tokens.player_a === token || game.tokens.player_b === token;
          if (!isValid) {
            return reply.code(401).send({ error: 'invalid token', code: 'invalid_token' });
          }
        }
      }

      const after = req.query.after ? Number(req.query.after) : 0;
      const filtered = game.events.filter(e => e.seq > after);

      if (!wantsSse) {
        return { events: filtered };
      }

      // Rate limit SSE connections per game
      const currentCount = sseCounts.get(game.id) ?? 0;
      if (currentCount >= MAX_SSE_PER_GAME) {
        return reply.code(429).send({ error: 'too many SSE connections for this game', code: 'rate_limit' });
      }
      sseCounts.set(game.id, currentCount + 1);

      reply.raw.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });

      // Send all existing events
      for (const ev of filtered) {
        writeSseEvent(reply, ev);
      }

      // Subscribe to future events and push them as they arrive
      const unsubscribe = globalEventBus.subscribe(game.id, ev => {
        if (!reply.raw.writableEnded) {
          writeSseEvent(reply, ev);
        }
      });

      // Clean up when the client disconnects
      req.raw.on('close', () => {
        unsubscribe();
        const count = sseCounts.get(game.id) ?? 1;
        if (count <= 1) sseCounts.delete(game.id);
        else sseCounts.set(game.id, count - 1);
      });

      // For test clients: close after flushing historical events
      if (closeAfterFlush) {
        unsubscribe();
        const count = sseCounts.get(game.id) ?? 1;
        if (count <= 1) sseCounts.delete(game.id);
        else sseCounts.set(game.id, count - 1);
        reply.raw.end();
      }
    },
  );
}
