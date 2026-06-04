// src/api/events.ts
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { globalStore } from '../state/store.js';
import { globalEventBus } from '../events/bus.js';
import type { GameEvent } from '../types.js';

function writeSseEvent(reply: FastifyReply, event: GameEvent): void {
  const payload = JSON.stringify(event);
  reply.raw.write(`data: ${payload}\n\n`);
}

export async function eventsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string }; Querystring: { after?: string; close?: string } }>(
    '/api/games/:id/events',
    async (req, reply) => {
      const game = globalStore.get(req.params.id);
      if (!game) {
        return reply.code(404).send({ error: 'game not found', code: 'game_not_found' });
      }
      const after = req.query.after ? Number(req.query.after) : 0;
      const filtered = game.events.filter(e => e.seq > after);

      const wantsSse = (req.headers.accept ?? '').includes('text/event-stream');
      const closeAfterFlush = req.query.close === 'true';
      if (!wantsSse) {
        return { events: filtered };
      }

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
      });

      // For test clients: close after flushing historical events
      if (closeAfterFlush) {
        unsubscribe();
        reply.raw.end();
      }
    },
  );
}
