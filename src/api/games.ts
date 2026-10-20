// src/api/games.ts
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import {
  globalStore, createLobby, createLobbyWithConfig, addLobbyPlayer, removeLobbyPlayer,
  getRawHostToken, getRawPlayerToken,
} from '../state/store.js';
import { verifyToken } from '../state/tokens.js';
import { globalEventBus } from '../events/bus.js';
import { appendEvent } from '../engine/events.js';
import { eliminatePlayer, forceAdjudication, joinedPlayerIds, skipTurn, startGame } from '../engine/engine.js';
import { eliminateFromPlanAndMaybeResolve, forceResolveRound } from '../engine/simultaneous.js';
import {
  authenticate, authenticateHost, sanitizeGameForResponse, statusForCode,
} from './auth.js';
import { authorizeControlRequest } from './controlAuth.js';
import { listMaps } from '../config/loader.js';
import { generateRandomMapConfig, sanitizeRandomOptions } from '../config/randomMap.js';
import type { RandomParamValues } from '../config/randomMap.js';
import { getCachedRandomMap, setCachedRandomMap } from '../config/randomMapCache.js';
import { isPlayerId, MAX_PLAYER_NAME_LEN } from '../types.js';
import type { GameState, PlayerId } from '../types.js';
import { launchBotsForGame, removeBotRecord, clearBotsForGame } from './bots.js';

export function lobbySummary(game: GameState) {
  const players = joinedPlayerIds(game).map(id => ({
    id, name: game.players[id]!.name, status: game.players[id]!.status,
  }));
  return {
    gameId: game.id, mapId: game.mapId, phase: game.phase,
    mode: game.config.mode,
    maxPlayers: game.maxPlayers, playerCount: players.length, players,
    supportedPlayerCounts: game.config.supportedPlayerCounts,
  };
}

export async function gamesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/games', async () => ({
    // Keep the newest lobbies/games at the top.  New lobbies carry createdAt;
    // older persisted games fall back to the first event (the authoritative
    // server timestamp) and then to the earliest player's join time.
    games: globalStore.list().map(id => {
      const game = globalStore.get(id)!;
      // 房主不参战的空房间既没有事件也没有玩家：用建房时间兜底，否则列表既没有
      // 「创建于」文案，排序里 null 又会当成 0，新房间反而沉到列表底部。
      const createdAt = game.createdAt
        ?? game.events[0]?.timestamp
        ?? (Object.keys(game.players).length
          ? Math.min(...Object.values(game.players).map(player => player.joinedAt))
          : null);
      return {
        ...lobbySummary(game),
        // 大厅列表按「中文名为主、mapId 为辅」展示地图，随机地图的配置名由服务端现给。
        mapName: game.config.name,
        // 列表卡片只显示房主名（不列全部玩家），未参战 / 旧房间也可能没有名字。
        hostName: game.hostName || '',
        roundNumber: game.turn.roundNumber,
        currentPlayerId: game.turn.currentPlayerId,
        winner: game.winner,
        playerNames: game.playerNames,
        createdAt,
      };
    }).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)),
  }));

  app.post<{ Body: { mapId?: string; maxPlayers?: number; participate?: boolean; playerName?: string; random?: unknown } }>(
    '/api/games', async (req, reply) => {
      const mapId = req.body?.mapId || 'default';
      const maxPlayers = Number(req.body?.maxPlayers ?? 2);
      if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 8) {
        return reply.code(400).send({ error: '不支持该玩家人数', code: 'unsupported_player_count' });
      }
      const lobbyOptions = {
        maxPlayers,
        participate: req.body?.participate !== false,
        playerName: req.body?.playerName,
      };
      let game;
      if (mapId === 'random') {
        // 随机地图：服务端按参数现生成完整配置，不写入静态地图表。
        try {
          const options = sanitizeRandomOptions(req.body?.random);
          const cached = options.seed === undefined ? null : getCachedRandomMap(options, maxPlayers);
          if (cached) {
            game = createLobbyWithConfig(randomUUID(), 'random', cached.config, lobbyOptions);
          } else {
            const values: RandomParamValues = {};
            const config = generateRandomMapConfig(options, maxPlayers, values);
            if (options.seed !== undefined) setCachedRandomMap(options, maxPlayers, config, values);
            game = createLobbyWithConfig(randomUUID(), 'random', config, lobbyOptions);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : '随机地图参数无效';
          return reply.code(400).send({ error: `随机地图：${message}`, code: 'invalid_move' });
        }
      } else {
        const map = listMaps().find(item => item.id === mapId);
        if (!map) return reply.code(400).send({ error: `找不到地图「${mapId}」`, code: 'invalid_move' });
        if (!map.preview.supportedPlayerCounts.includes(maxPlayers)) {
          return reply.code(400).send({ error: '不支持该玩家人数', code: 'unsupported_player_count' });
        }
        game = createLobby(randomUUID(), mapId, lobbyOptions);
      }
      globalStore.save(game);
      const creatorId = joinedPlayerIds(game)[0];
      return {
        gameId: game.id,
        hostToken: getRawHostToken(game) ?? '',
        player: creatorId ? { id: creatorId, token: getRawPlayerToken(game, creatorId) ?? '' } : null,
        lobby: lobbySummary(game),
      };
    },
  );

  app.get<{ Params: { id: string } }>('/api/games/:id/lobby', async (req, reply) => {
    const game = globalStore.get(req.params.id);
    if (!game) return reply.code(404).send({ error: '找不到该对局', code: 'game_not_found' });
    return lobbySummary(game);
  });

  app.post<{ Params: { id: string }; Body: { name?: string } }>('/api/games/:id/join', async (req, reply) => {
    const game = globalStore.get(req.params.id);
    if (!game) return reply.code(404).send({ error: '找不到该对局', code: 'game_not_found' });
    if (game.phase !== 'lobby') return reply.code(409).send({ error: '对局已经开始', code: 'game_already_started' });
    // 房主带房主凭证参战时，顺带把列表里的房主名同步成这个席位名。
    const hostHeader = req.headers['x-host-token'];
    const hostJoining = typeof hostHeader === 'string' && verifyToken(hostHeader, game.hostToken);
    const joined = addLobbyPlayer(game, req.body?.name);
    if (!joined) return reply.code(409).send({ error: '房间已满', code: 'game_already_full' });
    if (hostJoining) game.hostName = game.players[joined.id]!.name;
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
    // 对局开始后拉起已登记的强化学习 AI（fire-and-forget，失败不影响开局）。
    const address = req.server.server.address();
    const port = address && typeof address === 'object' ? address.port : Number(process.env.PORT) || 3100;
    launchBotsForGame(`http://127.0.0.1:${port}`, req.server.log, game);
    return { ok: true, game: sanitizeGameForResponse(game) };
  });

  app.post<{ Params: { id: string } }>('/api/games/:id/leave', async (req, reply) => {
    const ctx = authenticate(req, reply);
    if (!ctx) return;
    if (ctx.game.phase !== 'lobby') return reply.code(409).send({ error: '对局已经开始', code: 'game_already_started' });
    removeLobbyPlayer(ctx.game, ctx.player);
    appendEvent(ctx.game, globalEventBus, 'player_left', { playerId: ctx.player, reason: 'self' });
    globalStore.persist(ctx.game);
    return { ok: true };
  });

  app.delete<{ Params: { id: string; playerId: string } }>('/api/games/:id/players/:playerId', async (req, reply) => {
    const game = authenticateHost(req, reply);
    if (!game) return;
    if (game.phase !== 'lobby') {
      return reply.code(409).send({ error: '对局已经开始', code: 'game_already_started' });
    }
    if (!isPlayerId(req.params.playerId) || !game.players[req.params.playerId] || !removeLobbyPlayer(game, req.params.playerId)) {
      return reply.code(400).send({ error: '该成员不在大厅中', code: 'invalid_move' });
    }
    removeBotRecord(game.id, req.params.playerId as PlayerId);
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

  // 大厅内修改最大玩家数：须为地图支持的人数，且不少于当前已加入人数。
  app.patch<{ Params: { id: string }; Body: { maxPlayers?: number } }>(
    '/api/games/:id/host/max-players', async (req, reply) => {
      const game = authenticateHost(req, reply);
      if (!game) return;
      if (game.phase !== 'lobby') {
        return reply.code(409).send({ error: '对局已经开始', code: 'game_already_started' });
      }
      const maxPlayers = Number(req.body?.maxPlayers);
      if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 8) {
        return reply.code(400).send({ error: '不支持该玩家人数', code: 'unsupported_player_count' });
      }
      if (!game.config.supportedPlayerCounts.includes(maxPlayers)) {
        return reply.code(400).send({
          error: `该地图不支持 ${maxPlayers} 名玩家`,
          code: 'unsupported_player_count',
        });
      }
      const joined = joinedPlayerIds(game).length;
      if (maxPlayers < joined) {
        return reply.code(400).send({
          error: `不能少于当前已加入的 ${joined} 名玩家`,
          code: 'invalid_move',
        });
      }
      game.maxPlayers = maxPlayers;
      globalStore.persist(game);
      return { ok: true, lobby: lobbySummary(game) };
    });

  app.post<{ Params: { id: string }; Body: { playerId?: string } }>('/api/games/:id/host/eliminate', async (req, reply) => {
    const game = authenticateHost(req, reply);
    if (!game) return;
    if (!isPlayerId(req.body?.playerId)) return reply.code(400).send({ error: '需要有效的玩家 ID', code: 'invalid_move' });
    const result = eliminatePlayer(game, globalEventBus, req.body.playerId, 'host_eliminated', null);
    if (!result.ok) return reply.code(statusForCode(result.code)).send({ error: result.message, code: result.code });
    // simultaneous 模式下计划期淘汰：清出其计划状态；若其余玩家均已确认则立即结算。
    eliminateFromPlanAndMaybeResolve(game, globalEventBus, req.body.playerId);
    globalStore.persist(game);
    return { ok: true };
  });

  // simultaneous 模式专用：房主强制以当前队列立即结算（未确认玩家按现有队列参与）。
  app.post<{ Params: { id: string } }>('/api/games/:id/host/force-resolve', async (req, reply) => {
    const game = authenticateHost(req, reply);
    if (!game) return;
    const result = forceResolveRound(game, globalEventBus);
    if (!result.ok) return reply.code(statusForCode(result.code)).send({ error: result.message, code: result.code });
    globalStore.persist(game);
    return { ok: true, resolved: true, roundNumber: result.data ? result.data.roundNumber : null, phase: game.phase };
  });

  app.patch<{ Params: { id: string }; Body: { name?: string } }>('/api/games/:id/player', async (req, reply) => {
    const ctx = authenticate(req, reply);
    if (!ctx) return;
    const name = req.body?.name?.trim().slice(0, MAX_PLAYER_NAME_LEN);
    if (!name) return reply.code(400).send({ error: '名字不能为空', code: 'invalid_move' });
    ctx.game.players[ctx.player]!.name = name;
    ctx.game.playerNames[ctx.player] = name;
    // 房主自己改名：带房主凭证时同步列表里的房主名，免得大厅列表还显示旧名字。
    const hostHeader = req.headers['x-host-token'];
    if (typeof hostHeader === 'string' && verifyToken(hostHeader, ctx.game.hostToken)) {
      ctx.game.hostName = name;
    }
    appendEvent(ctx.game, globalEventBus, 'name_rename', { playerId: ctx.player, name });
    globalStore.persist(ctx.game);
    return { ok: true, lobby: lobbySummary(ctx.game) };
  });

  app.patch<{ Params: { id: string }; Body: { playerId?: string; name?: string } }>('/api/games/:id/rename', async (req, reply) => {
    if (!authorizeControlRequest(req, reply)) return;
    const game = globalStore.get(req.params.id);
    if (!game) return reply.code(404).send({ error: '找不到该对局', code: 'game_not_found' });
    const playerId = req.body?.playerId;
    if (!isPlayerId(playerId) || !game.players[playerId]) {
      return reply.code(400).send({ error: '需要有效的玩家 ID', code: 'invalid_move' });
    }
    const name = req.body?.name?.trim().slice(0, MAX_PLAYER_NAME_LEN);
    if (!name) return reply.code(400).send({ error: '名字不能为空', code: 'invalid_move' });
    game.players[playerId]!.name = name;
    game.playerNames[playerId] = name;
    appendEvent(game, globalEventBus, 'name_rename', { playerId, name });
    globalStore.persist(game);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/games/:id/force-adjudicate', async (req, reply) => {
    if (!authorizeControlRequest(req, reply)) return;
    const game = globalStore.get(req.params.id);
    if (!game) return reply.code(404).send({ error: '找不到该对局', code: 'game_not_found' });
    const result = forceAdjudication(game, globalEventBus);
    if (!result.ok) return reply.code(statusForCode(result.code)).send({ error: result.message, code: result.code });
    globalStore.persist(game);
    return { ok: true, result: game.result };
  });

  app.delete<{ Params: { id: string }; Querystring: { token?: string } }>('/api/games/:id', async (req, reply) => {
    if (!authorizeControlRequest(req, reply)) return;
    if (!globalStore.get(req.params.id)) return reply.code(404).send({ error: '找不到该对局', code: 'game_not_found' });
    globalStore.delete(req.params.id);
    globalEventBus.clear(req.params.id);
    clearBotsForGame(req.params.id);
    return { ok: true };
  });

  app.get<{ Params: { id: string }; Querystring: { include?: string } }>('/api/games/:id', async (req, reply) => {
    const ctx = authenticate(req, reply);
    if (!ctx) return;
    const includeRaw = typeof req.query.include === 'string' ? req.query.include : null;
    const include = includeRaw === null
      ? null
      : new Set(includeRaw.split(',').map(item => item.trim()).filter(Boolean));
    const projection = include === null
      ? {}
      : {
        events: include.has('events'),
        config: include.has('config'),
        adjudication: include.has('adjudication'),
      };
    const includeKey = include === null ? 'all' : [...include].sort().join(',');
    const etag = `"${ctx.game.id}-${ctx.game.stateVersion ?? 0}-${includeKey}"`;
    reply.header('ETag', etag);
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();
    return sanitizeGameForResponse(ctx.game, ctx.player, projection);
  });
}
