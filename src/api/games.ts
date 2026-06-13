// src/api/games.ts
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { globalStore, createInitialGame } from '../state/store.js';
import { globalEventBus } from '../events/bus.js';
import { appendEvent } from '../engine/events.js';
import { joinGame } from '../engine/engine.js';
import { authenticate, sanitizeGameForResponse, statusForCode } from './auth.js';
import { listMaps } from '../config/loader.js';

export async function gamesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/games', async () => {
    const ids = globalStore.list();
    return {
      games: ids.map(id => {
        const g = globalStore.get(id)!;
        return {
          id, phase: g.phase, turnNumber: g.turn.turnNumber,
          currentOwner: g.turn.currentOwner, winner: g.winner,
          playerNames: g.playerNames,
          mapId: g.mapId,
        };
      }),
    };
  });

  app.post<{ Body: { mapId?: string; name?: string } }>('/api/games', async (req, reply) => {
    const mapId = req.body?.mapId || 'default';
    const name = req.body?.name || '玩家 A';
    const available = listMaps();
    if (!available.some(m => m.id === mapId)) {
      return reply.code(400).send({
        error: `Map "${mapId}" not found. Available: ${available.map(m => m.id).join(', ')}`,
        code: 'invalid_move',
      });
    }
    const id = randomUUID();
    const game = createInitialGame(id, mapId);
    game.playerNames.player_a = name;
    globalStore.save(game);
    return { gameId: id, playerAToken: game.tokens.player_a };
  });

  app.post<{ Params: { id: string }; Body: { name?: string } }>('/api/games/:id/join', async (req, reply) => {
    const game = globalStore.get(req.params.id);
    if (!game) {
      return reply.code(404).send({ error: 'game not found', code: 'game_not_found' });
    }
    const name = req.body?.name || '玩家 B';
    const result = joinGame(game, globalEventBus, name);
    if (!result.ok) {
      return reply.code(statusForCode(result.code)).send({ error: result.message, code: result.code });
    }
    return { playerBToken: game.tokens.player_b };
  });

  app.patch<{ Params: { id: string }; Body: { playerId: string; name: string } }>('/api/games/:id/rename', async (req, reply) => {
    const game = globalStore.get(req.params.id);
    if (!game) {
      return reply.code(404).send({ error: 'game not found', code: 'game_not_found' });
    }
    const { playerId, name } = req.body || {};
    if (playerId !== 'player_a' && playerId !== 'player_b') {
      return reply.code(400).send({ error: 'playerId must be player_a or player_b', code: 'invalid_move' });
    }
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return reply.code(400).send({ error: 'name is required', code: 'invalid_move' });
    }
    const trimmed = name.trim().slice(0, 20);
    game.playerNames[playerId] = trimmed;
    appendEvent(game, globalEventBus, 'name_rename', { playerId, name: trimmed });
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/games/:id', async (req, reply) => {
    const ctx = authenticate(req, reply);
    if (!ctx) return;
    return sanitizeGameForResponse(ctx.game);
  });
}
