// src/api/games.ts
import type { FastifyInstance } from 'fastify';
import { createHash, randomUUID } from 'node:crypto';
import {
  globalStore, createLobby, createLobbyWithConfig, addLobbyPlayer, removeLobbyPlayer,
  clearSeatPlan, isSeatOrderValid, setSeatPlan, maxLobbyGames,
  getRawHostToken, getRawPlayerToken,
} from '../state/store.js';
import { verifyToken } from '../state/tokens.js';
import { globalEventBus } from '../events/bus.js';
import { closeSseConnections } from './events.js';
import { appendEvent } from '../engine/events.js';
import { eliminatePlayer, forceAdjudication, joinedPlayerIds, skipTurn, startGame } from '../engine/engine.js';
import { eliminateFromPlanAndMaybeResolve, forceResolveRound } from '../engine/simultaneous.js';
import {
  authenticate, authenticateHost, sanitizeGameForResponse, statusForCode,
} from './auth.js';
import { authorizeControlRequest, controlSocketAddressOf } from './controlAuth.js';
import { actionBodyHash, findReplay, rememberAction, scopedIdempotencyKey } from './actions.js';
import { logger } from '../utils/logger.js';
import { inc } from '../utils/metrics.js';
import { listMaps } from '../config/loader.js';
import { generateRandomMapConfig, randomMapModeForId, sanitizeRandomOptions } from '../config/randomMap.js';
import type { RandomParamValues } from '../config/randomMap.js';
import { getCachedRandomMap, setCachedRandomMap } from '../config/randomMapCache.js';
import { isPlayerId, isSimultaneousMode, normalizePlayerName } from '../types.js';
import type { GameState, PlayerId } from '../types.js';
import { launchBotsForGame, removeBotRecord, clearBotsForGame } from './bots.js';

type HostIdempotency =
  | { kind: 'none' }
  | { kind: 'too_long' }
  | { kind: 'conflict' }
  | { kind: 'replay'; response: unknown }
  | { kind: 'store'; key: string; hash: string };

/**
 * 房主结算类接口的幂等键：与动作接口同款语义——
 * 相同 key + 相同请求 → 回放首次成功响应；相同 key + 不同请求 → 409 idempotency_conflict。
 * 房主身份用 `host:` 前缀进同一张记录表，和玩家动作的 key 互不干扰。
 */
function hostIdempotency(
  req: { headers: Record<string, unknown> },
  game: GameState,
  action: string,
  body: unknown,
): HostIdempotency {
  const raw = req.headers['idempotency-key'];
  const key = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
  if (!key) return { kind: 'none' };
  if (key.length > 200) return { kind: 'too_long' };
  const hash = actionBodyHash(action, body ?? null);
  const scoped = scopedIdempotencyKey('host', key);
  const found = findReplay(game, scoped, hash);
  if (!found) return { kind: 'store', key: scoped, hash };
  if ('conflict' in found) return { kind: 'conflict' };
  return { kind: 'replay', response: found.response };
}

function hostIdempotencyError(reply: { code: (n: number) => { send: (b: unknown) => unknown } }, idem: HostIdempotency): unknown {
  if (idem.kind === 'too_long') {
    return reply.code(400).send({ error: 'Idempotency-Key 不能超过 200 个字符', code: 'invalid_idempotency_key' });
  }
  if (idem.kind === 'conflict') {
    return reply.code(409).send({ error: '同一个 Idempotency-Key 被用于不同的请求', code: 'idempotency_conflict' });
  }
  return null;
}

export function lobbySummary(game: GameState) {
  const joined = joinedPlayerIds(game);
  const players = joined.map(id => ({
    id, name: game.players[id]!.name, status: game.players[id]!.status,
  }));
  // 「座位」只在大厅有意义：编排过（manual）时 order 决定出生点槽位；未编排（random）时
  // 出生点与先手（仅顺序模式）都还没定，seats 只按加入顺序给出座位号，spawnSlotId 一律 null，
  // 避免把「开局才随机出来的结果」当成既成事实展示。
  const plan = game.seatPlan ?? null;
  // 当前人数在本图上的候选出生位 id 顺序（`config.layouts[n]`）；0 人或该人数不被地图支持时为空。
  // 前端大厅的「草稿预览」要把座位下标映射到地图标记，只有这个顺序能对上——必须按 id 匹配，
  // 因为 layouts['3'] 可能是 [slot_1, slot_3, slot_5] 这种跳位子集，按下标必错位。
  // 拷贝一份再返回：这个数组会随 lobby 摘要发到客户端，不能和 config.layouts 共享引用。
  const layoutSlots = [...(game.config.layouts[String(joined.length)] ?? [])];
  const seats = joined.map((id, index) => {
    const playerId = plan?.order[index] ?? id;
    return {
      seat: index + 1,
      playerId,
      name: game.players[playerId]?.name ?? '',
      spawnSlotId: plan ? (layoutSlots[index] ?? null) : null,
    };
  });
  return {
    gameId: game.id, mapId: game.mapId, phase: game.phase,
    mode: game.config.mode,
    maxPlayers: game.maxPlayers, playerCount: players.length, players,
    supportedPlayerCounts: game.config.supportedPlayerCounts,
    // 座位编排：seatMode='manual' 才有意义；firstSeat 为 0 起的座位下标（先手，仅顺序模式）。
    // 同时回合 / 大逃杀没有先手，这里恒回 0，配合 mode 让前端直接隐藏「先手」控件。
    seatMode: plan ? 'manual' : 'random',
    seatVersion: game.seatVersion ?? 0,
    firstSeat: plan && !isSimultaneousMode(game.config.mode) ? plan.firstSeat : 0,
    seats,
    layoutSlots,
    // 已结束的房间在大厅卡里要显示「已结束 · 胜者 · 回合数」，这两项只有结束时才有意义。
    winner: game.winner,
    roundNumber: game.turn.roundNumber,
  };
}

/**
 * ETag 里的「本方计划队列」标签。计划动作只改自己的队列、不产生事件，
 * 因此 stateVersion 不会变化；若 ETag 只看 stateVersion，客户端条件请求会
 * 拿到 304 + 旧响应，计划面板与棋盘预览就会停在入队前的空队列。
 * 只把请求者自己的队列算进 ETag：其他玩家入队不改变本方响应，也避免通过
 * ETag 变化泄露对手的计划活动。
 */
function planQueueTag(game: GameState, viewer?: PlayerId): string {
  if (!viewer || !isSimultaneousMode(game.config.mode)) return 'none';
  const queue = game.plan?.queues[viewer] ?? [];
  if (queue.length === 0) return 'empty';
  return createHash('sha256').update(JSON.stringify(queue)).digest('hex').slice(0, 16);
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
      // 活跃大厅上限：每个大厅都要占一份全量快照与内存，必须有个硬闸（默认 200）。
      const lobbyLimit = maxLobbyGames();
      const lobbyCount = globalStore.lobbyCount();
      if (lobbyCount >= lobbyLimit) {
        inc('tactical_lobby_capacity_rejected_total');
        return reply.code(503).send({
          error: `大厅数量已达上限（${lobbyLimit}），请等空闲大厅过期后再建房`,
          code: 'lobby_capacity',
        });
      }
      if (lobbyCount >= Math.ceil(lobbyLimit * 0.8)) {
        // 接近上限先提醒：真撞线了只会 503，运维需要提前看到。
        logger.warn(`活跃大厅 ${lobbyCount}/${lobbyLimit}，接近上限`, { tag: 'game:capacity' });
      }
      const lobbyOptions = {
        maxPlayers,
        participate: req.body?.participate !== false,
        playerName: req.body?.playerName,
      };
      let game;
      if (mapId === 'random') {
        // 随机地图：服务端按参数现生成完整配置，不写入静态地图表。玩法模式走
        // `random.mode`（大厅随机图面板也是这么发的），地图 id 恒为 `random`；
        // 评估批次的 `random-annihilation` 等虚拟 id 不属于建房入口，见下面 else 分支。
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
        if (!map) {
          // 评估跑批的地图 id（random-annihilation / random-simultaneous / random-royale）
          // 不是可建房地图：批次要靠地图 id 推模式，而建房把模式放在 random.mode 里。
          // 这里给出可执行的替代写法，免得只回一句「找不到地图」。
          const evalMode = randomMapModeForId(mapId);
          if (evalMode) {
            return reply.code(400).send({
              error: `${mapId} 是评估跑批的随机图 id（${evalMode} 模式），不能用于建房；`
                + '请改用 mapId=random 并在 random.mode 指定玩法模式',
              code: 'invalid_move',
            });
          }
          return reply.code(400).send({ error: `找不到地图「${mapId}」`, code: 'invalid_move' });
        }
        if (!map.preview.supportedPlayerCounts.includes(maxPlayers)) {
          return reply.code(400).send({ error: '不支持该玩家人数', code: 'unsupported_player_count' });
        }
        game = createLobby(randomUUID(), mapId, lobbyOptions);
      }
      globalStore.save(game);
      // 总对局数（大厅 + 进行中 + 终局）超阈值时也要提醒：磁盘与内存都是按局数线性增长的，
      // 只盯大厅数会漏掉「进行中/终局堆积」这一类膨胀。
      const totalGames = globalStore.size();
      if (totalGames >= lobbyLimit * 2) {
        inc('tactical_games_over_threshold_total');
        logger.warn(`对局总数 ${totalGames} 已超过 ${lobbyLimit * 2}（大厅上限 ${lobbyLimit} 的 2 倍），请检查归档 TTL 与磁盘占用`, { tag: 'game:capacity' });
      }
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
    const idem = hostIdempotency(req, game, 'host_skip_turn', null);
    const idemError = hostIdempotencyError(reply, idem);
    if (idemError) return idemError;
    if (idem.kind === 'replay') return idem.response;
    const result = skipTurn(game, globalEventBus);
    if (!result.ok) return reply.code(statusForCode(result.code)).send({ error: result.message, code: result.code });
    globalStore.persist(game);
    const response = { ok: true };
    if (idem.kind === 'store') rememberAction(game, idem.key, idem.hash, response);
    return response;
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
      // 该接口不发事件但改变状态响应内容；显式推进版本，避免条件 GET 命中旧 ETag。
      game.stateVersion = (game.stateVersion ?? 0) + 1;
      globalStore.persist(game);
      return { ok: true, lobby: lobbySummary(game) };
    });

  // 大厅内编排座位：仅房主、仅 lobby 期；body 为全量座位表（天然幂等），ifVersion 失配返回 409。
  app.put<{
    Params: { id: string };
    Body: { order?: unknown; firstSeat?: unknown; ifVersion?: unknown };
  }>('/api/games/:id/host/seats', async (req, reply) => {
    const game = authenticateHost(req, reply);
    if (!game) return;
    if (game.phase !== 'lobby') {
      return reply.code(409).send({ error: '对局已经开始', code: 'game_already_started' });
    }
    const joined = joinedPlayerIds(game);
    const body = req.body ?? {};
    // 空房没有可排的对象：不做预留、不占位，等有人加入再排（必须先于 firstSeat 校验，
    // 否则 0 人房会落到「先手座位号越界」，把真正原因掩盖成参数问题）。
    if (joined.length === 0) {
      return reply.code(400).send({ error: '当前没有已加入玩家，无法编排座位', code: 'invalid_seat_layout' });
    }
    // 版本校验必须先于载荷校验：陈旧标签页手里的 order 长度必然与当前成员数不符，
    // 若先查排列就会一律 400，把「有人进出导致座位变了」这个真正原因掩盖成「载荷非法」。
    const ifVersion = body.ifVersion;
    if (ifVersion !== undefined && (typeof ifVersion !== 'number' || !Number.isInteger(ifVersion))) {
      return reply.code(400).send({ error: 'ifVersion 必须是整数', code: 'invalid_seat_layout' });
    }
    const currentVersion = game.seatVersion ?? 0;
    if (ifVersion !== undefined && ifVersion !== currentVersion) {
      // 两个标签页同改：后来者拿到最新座位表与版本，前端直接重绘，不需要重放请求。
      return reply.code(409).send({
        error: '座位已被修改，请刷新后重试',
        code: 'seat_conflict',
        seatVersion: currentVersion,
        lobby: lobbySummary(game),
      });
    }
    // 座位表只能是「当前已加入玩家的一个排列」：陌生人 / 重复 / 缺人 / 长度不符一律 400。
    if (!isSeatOrderValid(body.order, joined)) {
      return reply.code(400).send({
        error: '座位表必须恰好是当前已加入玩家的一次排列',
        code: 'invalid_seat_layout',
      });
    }
    // 先手（仅 standard / annihilation）：firstSeat 决定 turnOrder 从哪个座位循环展开。
    // 同时回合 / 大逃杀没有先手 —— 座位序只是「出生点 + 同一步内的结算处理顺序」，
    // 所以这里忽略传入值、一律归一化为 0（不报 400：firstSeat 对顺序模式合法，
    // 只是在同时模式不适用；若留着非 0，开局会把结算处理顺序从中间起算）。响应同样回 0。
    const simultaneousSeats = isSimultaneousMode(game.config.mode);
    const requestedFirstSeat = body.firstSeat === undefined ? 0 : body.firstSeat;
    let firstSeat = 0;
    if (!simultaneousSeats) {
      if (typeof requestedFirstSeat !== 'number' || !Number.isInteger(requestedFirstSeat)
        || requestedFirstSeat < 0 || requestedFirstSeat >= joined.length) {
        return reply.code(400).send({ error: '先手座位号越界', code: 'invalid_seat_layout' });
      }
      firstSeat = requestedFirstSeat;
    }
    setSeatPlan(game, body.order, firstSeat);
    // 该接口不发事件但改变状态响应内容；显式推进版本，避免条件 GET 命中旧 ETag。
    game.stateVersion = (game.stateVersion ?? 0) + 1;
    globalStore.persist(game);
    return {
      ok: true, seatVersion: game.seatVersion ?? 0, firstSeat, lobby: lobbySummary(game),
    };
  });

  // 取消编排：回到服务端随机配对 + 随机先手（与从未编排完全一致）。
  app.delete<{ Params: { id: string } }>('/api/games/:id/host/seats', async (req, reply) => {
    const game = authenticateHost(req, reply);
    if (!game) return;
    if (game.phase !== 'lobby') {
      return reply.code(409).send({ error: '对局已经开始', code: 'game_already_started' });
    }
    clearSeatPlan(game);
    game.stateVersion = (game.stateVersion ?? 0) + 1;
    globalStore.persist(game);
    return { ok: true, seatVersion: game.seatVersion ?? 0, lobby: lobbySummary(game) };
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
  // body 可选 { "repeat": true }：显式跳过轮次守卫（旧存档里 resolvedRound 保守设在当前轮，
  // 这类存量对局在有人做新输入前推不动，房主用它可以手动解锁一次）。
  app.post<{ Params: { id: string }; Body: { repeat?: unknown } }>(
    '/api/games/:id/host/force-resolve', async (req, reply) => {
    const game = authenticateHost(req, reply);
    if (!game) return;
    const repeat = req.body?.repeat === true;
    // 幂等键要覆盖 repeat：带与不带是两个不同请求，同键异体应报 idempotency_conflict。
    const idem = hostIdempotency(req, game, 'host_force_resolve', { repeat });
    const idemError = hostIdempotencyError(reply, idem);
    if (idemError) return idemError;
    if (idem.kind === 'replay') return idem.response;
    const result = forceResolveRound(game, globalEventBus, { repeat });
    if (!result.ok) return reply.code(statusForCode(result.code)).send({ error: result.message, code: result.code });
    if (result.data?.repeated) {
      // 守卫真被跳过才计数 + 告警：这是「房主手动推掉一次已结算轮」的审计线索。
      inc('tactical_round_force_repeat_total');
      logger.warn('房主用 repeat 强制结算了已结算的回合', {
        tag: 'game:force-resolve',
        gameId: game.id,
        roundNumber: result.data.roundNumber,
        peer: controlSocketAddressOf(req),
      });
    }
    globalStore.persist(game);
    const response = {
      ok: true, resolved: true,
      roundNumber: result.data ? result.data.roundNumber : null,
      repeated: Boolean(result.data?.repeated),
      phase: game.phase,
    };
    if (idem.kind === 'store') rememberAction(game, idem.key, idem.hash, response);
    return response;
  });

  app.patch<{ Params: { id: string }; Body: { name?: string } }>('/api/games/:id/player', async (req, reply) => {
    const ctx = authenticate(req, reply);
    if (!ctx) return;
    if (ctx.game.phase === 'game_over') {
      return reply.code(409).send({ error: '对局已结束', code: 'game_over' });
    }
    const name = normalizePlayerName(req.body?.name);
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
    if (game.phase === 'game_over') {
      return reply.code(409).send({ error: '对局已结束', code: 'game_over' });
    }
    const playerId = req.body?.playerId;
    if (!isPlayerId(playerId) || !game.players[playerId]) {
      return reply.code(400).send({ error: '需要有效的玩家 ID', code: 'invalid_move' });
    }
    const name = normalizePlayerName(req.body?.name);
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
    closeSseConnections(req.params.id);
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
    const etag = `"${ctx.game.id}-${ctx.game.stateVersion ?? 0}-${planQueueTag(ctx.game, ctx.player)}-${includeKey}"`;
    reply.header('ETag', etag);
    // 响应包含请求者自己的计划队列，必须标记按玩家凭证变化，禁止共享缓存复用。
    reply.header('Vary', 'X-Player-Token');
    // 个性化对局状态必须每次向服务器确认；未变化时仍走 304，省流量但不吃旧缓存。
    reply.header('Cache-Control', 'no-cache');
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();
    return sanitizeGameForResponse(ctx.game, ctx.player, projection);
  });
}
