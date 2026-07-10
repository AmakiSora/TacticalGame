// src/api/games.ts
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { globalStore, createLobby, addLobbyPlayer, removeLobbyPlayer } from '../state/store.js';
import { globalEventBus } from '../events/bus.js';
import { appendEvent } from '../engine/events.js';
import { eliminatePlayer, joinedPlayerIds, skipTurn, startGame } from '../engine/engine.js';
import {
  authenticate, authenticateHost, sanitizeGameForResponse, statusForCode,
} from './auth.js';
import { authorizeControlRequest } from './controlAuth.js';
import { listMaps } from '../config/loader.js';
import { isPlayerId } from '../types.js';
import type { GameState } from '../types.js';

function lobbySummary(game: GameState) {
  const players = joinedPlayerIds(game).map(id => ({
    id, name: game.players[id]!.name, status: game.players[id]!.status,
  }));
  return {
    gameId: game.id, mapId: game.mapId, phase: game.phase,
    maxPlayers: game.maxPlayers, playerCount: players.length, players,
    supportedPlayerCounts: game.config.supportedPlayerCounts,
  };
}

export async function gamesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/games', async () => ({
    games: globalStore.list().map(id => {
      const game = globalStore.get(id)!;
      return {
        ...lobbySummary(game),
        roundNumber: game.turn.roundNumber,
        currentPlayerId: game.turn.currentPlayerId,
        winner: game.winner,
        playerNames: game.playerNames,
      };
    }),
  }));

  app.post<{ Body: { mapId?: string; maxPlayers?: number; participate?: boolean; playerName?: string } }>(
    '/api/games', async (req, reply) => {
      const mapId = req.body?.mapId || 'default';
      const map = listMaps().find(item => item.id === mapId);
      if (!map) return reply.code(400).send({ error: `Map "${mapId}" not found`, code: 'invalid_move' });
      const maxPlayers = Number(req.body?.maxPlayers ?? 2);
      if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 8 || !map.preview.supportedPlayerCounts.includes(maxPlayers)) {
        return reply.code(400).send({ error: 'unsupported player count', code: 'unsupported_player_count' });
      }
      const game = createLobby(randomUUID(), mapId, {
        maxPlayers,
        participate: req.body?.participate !== false,
        playerName: req.body?.playerName,
      });
      globalStore.save(game);
      const creatorId = joinedPlayerIds(game)[0];
      return {
        gameId: game.id,
        hostToken: game.hostToken,
        player: creatorId ? { id: creatorId, token: game.tokens[creatorId] } : null,
        lobby: lobbySummary(game),
      };
    },
  );

  app.get<{ Params: { id: string } }>('/api/games/:id/lobby', async (req, reply) => {
    const game = globalStore.get(req.params.id);
    if (!game) return reply.code(404).send({ error: 'game not found', code: 'game_not_found' });
    return lobbySummary(game);
  });

  app.post<{ Params: { id: string }; Body: { name?: string } }>('/api/games/:id/join', async (req, reply) => {
    const game = globalStore.get(req.params.id);
    if (!game) return reply.code(404).send({ error: 'game not found', code: 'game_not_found' });
    if (game.phase !== 'lobby') return reply.code(409).send({ error: 'game already started', code: 'game_already_started' });
    const joined = addLobbyPlayer(game, req.body?.name);
    if (!joined) return reply.code(409).send({ error: 'game already full', code: 'game_already_full' });
    appendEvent(game, globalEventBus, 'player_joined', { playerId: joined.id, name: game.players[joined.id]!.name });
    globalStore.persist(game);
    return { player: joined, lobby: lobbySummary(game) };
  });

  app.post<{ Params: { id: string } }>('/api/games/:id/start', async (req, reply) => {
    const game = authenticateHost(req, reply);
    if (!game) return;
    const result = startGame(game, globalEventBus);
    if (!result.ok) return reply.code(statusForCode(result.code)).send({ error: result.message, code: result.code });
    globalStore.persist(game);
    return { ok: true, game: sanitizeGameForResponse(game) };
  });

  app.post<{ Params: { id: string } }>('/api/games/:id/leave', async (req, reply) => {
    const ctx = authenticate(req, reply);
    if (!ctx) return;
    if (ctx.game.phase !== 'lobby') return reply.code(409).send({ error: 'game already started', code: 'game_already_started' });
    removeLobbyPlayer(ctx.game, ctx.player);
    appendEvent(ctx.game, globalEventBus, 'player_left', { playerId: ctx.player, reason: 'self' });
    globalStore.persist(ctx.game);
    return { ok: true };
  });

  app.delete<{ Params: { id: string; playerId: string } }>('/api/games/:id/players/:playerId', async (req, reply) => {
    const game = authenticateHost(req, reply);
    if (!game) return;
    if (!isPlayerId(req.params.playerId) || !removeLobbyPlayer(game, req.params.playerId)) {
      return reply.code(400).send({ error: 'invalid lobby player', code: 'invalid_move' });
    }
    appendEvent(game, globalEventBus, 'player_left', { playerId: req.params.playerId, reason: 'host' });
    globalStore.persist(game);
    return { ok: true, lobby: lobbySummary(game) };
  });

  app.post<{ Params: { id: string } }>('/api/games/:id/host/skip-turn', async (req, reply) => {
    const game = authenticateHost(req, reply);
    if (!game) return;
    const result = skipTurn(game, globalEventBus);
    if (!result.ok) return reply.code(statusForCode(result.code)).send({ error: result.message, code: result.code });
    globalStore.persist(game);
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: { playerId?: string } }>('/api/games/:id/host/eliminate', async (req, reply) => {
    const game = authenticateHost(req, reply);
    if (!game) return;
    if (!isPlayerId(req.body?.playerId)) return reply.code(400).send({ error: 'valid playerId required', code: 'invalid_move' });
    const result = eliminatePlayer(game, globalEventBus, req.body.playerId, 'host_eliminated', null);
    if (!result.ok) return reply.code(statusForCode(result.code)).send({ error: result.message, code: result.code });
    globalStore.persist(game);
    return { ok: true };
  });

  app.patch<{ Params: { id: string }; Body: { name?: string } }>('/api/games/:id/player', async (req, reply) => {
    const ctx = authenticate(req, reply);
    if (!ctx) return;
    const name = req.body?.name?.trim().slice(0, 20);
    if (!name) return reply.code(400).send({ error: 'name is required', code: 'invalid_move' });
    ctx.game.players[ctx.player]!.name = name;
    ctx.game.playerNames[ctx.player] = name;
    appendEvent(ctx.game, globalEventBus, 'name_rename', { playerId: ctx.player, name });
    globalStore.persist(ctx.game);
    return { ok: true };
  });

  app.delete<{ Params: { id: string }; Querystring: { token?: string } }>('/api/games/:id', async (req, reply) => {
    if (!authorizeControlRequest(req, reply)) return;
    if (!globalStore.get(req.params.id)) return reply.code(404).send({ error: 'game not found', code: 'game_not_found' });
    globalStore.delete(req.params.id);
    globalEventBus.clear(req.params.id);
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/games/:id', async (req, reply) => {
    const ctx = authenticate(req, reply);
    if (!ctx) return;
    return sanitizeGameForResponse(ctx.game);
  });
}
