// src/api/auth.ts
import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AdjudicationSnapshot, GameState, PlayerId } from '../types.js';
import { isFogMode, isSimultaneousMode, PLAYER_IDS } from '../types.js';
import { globalStore } from '../state/store.js';
import { hashToken, verifySpectatorToken, verifyToken } from '../state/tokens.js';
import { buildAdjudicationSnapshot } from '../engine/engine.js';
import {
  allUnitsForFullView, fogLastVisibleSeq, fogProjectionFor, projectFogHistoryForViewer,
  unitsForViewer,
} from '../engine/fog.js';
import type { GameEvent } from '../types.js';

const errorStatus: Record<string, number> = {
  game_not_found: 404,
  invalid_token: 401,
  invalid_spectator_token: 401,
  invalid_host_token: 401,
  not_your_turn: 403,
  player_eliminated: 403,
  game_already_full: 409,
  game_already_started: 409,
  game_over: 409,
  game_not_started: 409,
  lobby_not_ready: 409,
  already_committed: 409,
  idempotency_conflict: 409,
  invalid_idempotency_key: 400,
  persistence_degraded: 503,
  not_simultaneous_game: 400,
  unsupported_player_count: 400,
  bot_not_supported: 400,
  model_not_found: 400,
  insufficient_supplies: 400,
  action_limit_reached: 429,
  invalid_seat_layout: 400,
  seat_conflict: 409,
  round_already_resolved: 409,
  lobby_capacity: 503,
};

export function statusForCode(code: string): number { return errorStatus[code] ?? 400; }

export interface AuthContext { game: GameState; player: PlayerId }

/**
 * 观者三态：玩家（完整本人视角）/ 观战（全量只读）/ 匿名公开（fog 局安全视角）。
 * 观战令牌只读，永远不会生成 AuthContext（写接口走 authenticate）。
 */
export type Viewer =
  | { kind: 'player'; player: PlayerId }
  | { kind: 'spectator' }
  | { kind: 'public' };

/** ETag 观者标签：player:<id> | spectator | anon（契约 4.3 固定取值）。 */
export function viewerTagOf(viewer: Viewer): string {
  if (viewer.kind === 'player') return `player:${viewer.player}`;
  return viewer.kind === 'spectator' ? 'spectator' : 'anon';
}

/** 迷雾模式判定；本文件只做路由/投影分支，不参与引擎规则。 */
export function isFogGame(game: GameState): boolean {
  return isFogMode(game.config.mode);
}

export function safeEqual(a: string | undefined, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function firstHeaderValue(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return null;
}

function findGame(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply): GameState | null {
  const game = globalStore.get(req.params.id);
  if (!game) {
    reply.code(404).send({ error: '找不到该对局', code: 'game_not_found' });
    return null;
  }
  return game;
}

export function authenticate(
  req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply,
): AuthContext | null {
  const game = findGame(req, reply);
  if (!game) return null;
  const token = req.headers['x-player-token'];
  if (typeof token !== 'string' || token.length === 0) {
    reply.code(401).send({ error: '缺少玩家凭证', code: 'invalid_token' });
    return null;
  }
  const player = PLAYER_IDS.find(id => safeEqual(game.tokens[id], hashToken(token)));
  if (!player) {
    reply.code(401).send({ error: '玩家凭证无效', code: 'invalid_token' });
    return null;
  }
  return { game, player };
}

export function authenticateHost(
  req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply,
): GameState | null {
  const game = findGame(req, reply);
  if (!game) return null;
  const token = req.headers['x-host-token'];
  if (typeof token !== 'string' || !verifyToken(token, game.hostToken)) {
    reply.code(401).send({ error: '房主凭证无效', code: 'invalid_host_token' });
    return null;
  }
  return game;
}

export interface ViewerOptions {
  /**
   * true：提供了玩家令牌但无效时返回 401（原有 GET 状态 / SSE 行为）。
   * false：非迷雾模式的事件补拉沿用旧行为（忽略无效令牌），避免改变既有接口语义。
   */
  strictPlayerToken?: boolean;
}

/**
 * 观者解析优先级：合法玩家令牌（头或 ?token=）> 合法观战令牌（头或 ?spectatorToken=）> 匿名。
 * 同时提供时以玩家为准；迷雾局无令牌不是错误（安全公开视角）。
 * 非迷雾局没有观战令牌（hash 不存在），因此忽略 X-Spectator-Token，保持旧行为。
 */
export function resolveViewer(
  req: FastifyRequest<{ Params: { id: string } }>,
  game: GameState,
  reply: FastifyReply,
  options: ViewerOptions = {},
): Viewer | null {
  const query = (req.query ?? {}) as Record<string, unknown>;
  const playerToken = firstHeaderValue(req.headers['x-player-token']) ?? firstHeaderValue(query.token);
  if (playerToken) {
    const player = PLAYER_IDS.find(id => safeEqual(game.tokens[id], hashToken(playerToken)));
    if (player) return { kind: 'player', player };
    if (isFogGame(game) || options.strictPlayerToken) {
      reply.code(401).send({ error: '玩家凭证无效', code: 'invalid_token' });
      return null;
    }
  }
  const spectatorToken = firstHeaderValue(req.headers['x-spectator-token'])
    ?? firstHeaderValue(query.spectatorToken);
  if (spectatorToken && isFogGame(game)) {
    if (!verifySpectatorToken(spectatorToken, game.spectatorTokenHash)) {
      reply.code(401).send({ error: '观战凭证无效', code: 'invalid_spectator_token' });
      return null;
    }
    return { kind: 'spectator' };
  }
  return { kind: 'public' };
}

export interface ResponseProjection {
  events?: boolean;
  config?: boolean;
  adjudication?: boolean;
}

function normalizeViewer(viewer: PlayerId | Viewer | undefined): Viewer {
  if (typeof viewer === 'string') return { kind: 'player', player: viewer };
  return viewer ?? { kind: 'public' };
}

/**
 * 观战/回放使用的全量事件：保留全局 seq，但剥离引擎内部固化表。
 * 必须 clone 后再删，不能原地改 game.events（会破坏后续投影与落盘）。
 */
export function stripFogEventInternals(event: GameEvent): GameEvent {
  const { fogViews: _fogViews, fogSeqs: _fogSeqs, ...rest } = structuredClone(event);
  return rest as GameEvent;
}

/** 观战全量视野：所有可用格（迷雾只隐藏单位，地形公开）。 */
function fullViewFogProjection(game: GameState) {
  return {
    enabled: true as const,
    revealed: true,
    visibleCells: game.cells
      .map(cell => ({ q: cell.q, r: cell.r }))
      .sort((a, b) => a.q - b.q || a.r - b.r)
      .map(cell => `${cell.q},${cell.r}`),
    lastSeen: [],
  };
}

function emptyFogProjection() {
  return { enabled: true as const, revealed: false, visibleCells: [], lastSeen: [] };
}

/**
 * 裁决分项脱敏：总分与排名公开，对手的分项（armyValue/killValue/supplies…）只对本人可见。
 * 用一个明确标记 hidden 的摘要对象替换原记录，避免「删字段」后前端误判为 0 分。
 */
/** 终局 result 的单条分数投影：他人/公开只保留总分（他人多一个 hidden 标记）。 */
function resultScoreForViewer(score: unknown, hidden: boolean): unknown {
  const total = score && typeof score === 'object'
    ? (score as Record<string, unknown>).total ?? 0
    : 0;
  return hidden ? { total, hidden: true } : { total };
}

/**
 * 终局 result 投影（契约 §4.3/§4.4）：
 * - player：本人 scores/rankings 完整，其他人只留 total（rankings 另保留 playerId/rank/status）；
 * - public：所有人只有 total，无任何分项；
 * - spectator：不调用本函数（全量）。
 * 只改 body.result（structuredClone 出来的副本），不动 game.result。
 */
function projectResultForViewer(result: unknown, viewer: Viewer): unknown {
  if (!result || typeof result !== 'object') return result;
  const record = result as Record<string, unknown>;
  const hidden = viewer.kind === 'player';
  const player = viewer.kind === 'player' ? viewer.player : null;
  const projected: Record<string, unknown> = { ...record };

  const scores = record.scores;
  if (scores && typeof scores === 'object' && !Array.isArray(scores)) {
    const next: Record<string, unknown> = {};
    for (const [id, score] of Object.entries(scores as Record<string, unknown>)) {
      next[id] = player && id === player ? score : resultScoreForViewer(score, hidden);
    }
    projected.scores = next;
  }

  const rankings = record.rankings;
  if (Array.isArray(rankings)) {
    projected.rankings = rankings.map(entry => {
      if (!entry || typeof entry !== 'object') return entry;
      const item = entry as Record<string, unknown>;
      if (player && item.playerId === player) return item;
      return { ...item, score: resultScoreForViewer(item.score, hidden) };
    });
  }
  return projected;
}

function projectAdjudicationForPlayer(snapshot: AdjudicationSnapshot, player: PlayerId): unknown {
  const scores: Record<string, unknown> = {};
  for (const id of PLAYER_IDS) {
    const score = snapshot.scores[id];
    if (!score) continue;
    if (id === player) {
      scores[id] = score;
      continue;
    }
    const rank = snapshot.rankings.find(item => item.playerId === id)?.rank ?? null;
    scores[id] = { playerId: id, total: score.total, rank, hidden: true };
  }
  const rankings = snapshot.rankings.map(item => item.playerId === player ? item : ({
    playerId: item.playerId,
    rank: item.rank,
    total: item.score.total,
    hidden: true,
  }));
  return { ...snapshot, scores, rankings };
}

export function sanitizeGameForResponse(
  game: GameState,
  viewerParam?: PlayerId | Viewer,
  projection: ResponseProjection = {},
): unknown {
  const viewer = normalizeViewer(viewerParam);
  const fog = isFogGame(game);
  // rngState 一并剥离：泄露会让客户端预测后续伤害/治疗掷骰。
  // spectatorTokenHash 与玩家 token 同等对待：只落盘，绝不回给客户端。
  const {
    tokens: _tokens, hostToken: _hostToken, rngState: _rngState,
    idempotency: _idempotency, events, config, spectatorTokenHash: _spectatorTokenHash,
    ...rest
  } = game;
  const body = structuredClone(rest) as Record<string, unknown>;
  // 轮次守卫是服务端内部状态（resolvedRound / lastSkippedTurn）：不对外暴露，
  // 免得客户端拿它当「本轮能否结算」的契约。
  if (body.turn && typeof body.turn === 'object') {
    const turn = body.turn as Record<string, unknown>;
    delete turn.resolvedRound;
    delete turn.skipGuard;
  }
  // fog 玩家/匿名的事件流有自己的连续序号（隐藏事件不占号）；观战与旧模式用全局 seq。
  const fogViewerId = viewer.kind === 'player' ? viewer.player : null;
  body.lastEventSeq = !fog
    ? events.at(-1)?.seq ?? 0
    : viewer.kind === 'spectator'
      ? events.at(-1)?.seq ?? 0
      : fogLastVisibleSeq(game, fogViewerId);
  if (fog) {
    // 非迷雾模式不进入此分支：输出保持逐字节不变。
    const player = viewer.kind === 'player' ? viewer.player : null;
    body.units = player
      ? structuredClone(unitsForViewer(game, player))
      : viewer.kind === 'spectator'
        ? structuredClone(allUnitsForFullView(game))
        : [];
    body.fog = player
      ? fogProjectionFor(game, player)
      : viewer.kind === 'spectator'
        ? fullViewFogProjection(game)
        : emptyFogProjection();
    // 大厅期 stateVersion 仍用全局版本：host/max-players、host/seats 等不发事件却改状态，
    // 若提前切到观者序号会让条件 GET 错误命中 304。开局后才与观者事件流对齐。
    if (game.phase !== 'lobby' && viewer.kind !== 'spectator') {
      body.stateVersion = fogLastVisibleSeq(game, fogViewerId);
    }
    if (viewer.kind !== 'spectator') delete body.lastActivityAt;
  }
  if (projection.events !== false) {
    if (!fog) {
      body.events = structuredClone(events);
    } else if (viewer.kind === 'spectator') {
      body.events = events.map(stripFogEventInternals);
    } else {
      // 历史也按观者序号（seq 已改写），匿名观者同样走 public 投影。
      body.events = projectFogHistoryForViewer(game, fogViewerId, 0);
    }
  }
  if (projection.config !== false) body.config = structuredClone(config);
  if (projection.adjudication !== false) {
    const snapshot = buildAdjudicationSnapshot(game);
    if (!fog) {
      body.adjudication = snapshot;
    } else if (viewer.kind === 'player') {
      body.adjudication = projectAdjudicationForPlayer(snapshot, viewer.player);
    } else if (viewer.kind === 'spectator') {
      body.adjudication = snapshot;
    } else {
      body.adjudication = { hidden: true };
    }
  }
  if (fog && viewer.kind !== 'spectator') {
    // 终局 result 与 players[].adjudicationScore 是 adjudication 之外的第二、第三条
    // 全量裁决旁路：只改投影副本，绝不原地改 game.result / game.players。
    body.result = projectResultForViewer(body.result, viewer);
    const players = body.players as Record<string, Record<string, unknown>> | undefined;
    if (players && typeof players === 'object') {
      const self = viewer.kind === 'player' ? viewer.player : null;
      for (const [id, playerState] of Object.entries(players)) {
        if (!playerState || typeof playerState !== 'object') continue;
        const isSelf = self !== null && id === self;
        const isKiller = self !== null && playerState.eliminatedBy === self;
        if (!isSelf) {
          // 对手的 stats 与裁决分项都会旁路隐藏行动，整块删除；
          // 淘汰者身份（eliminatedBy）只给自己与击杀者。
          delete playerState.stats;
          delete playerState.adjudicationScore;
        }
        if (!isSelf && !isKiller) delete playerState.eliminatedBy;
      }
    }
  }
  // simultaneous 模式下，其他玩家的计划队列属于秘密：只保留请求者自己的队列，
  // committed 名单公开（"谁已确认"不是秘密）。观战/匿名只看空队列 + committed。
  if (isSimultaneousMode(game.config.mode) && body.plan && typeof body.plan === 'object') {
    const plan = body.plan as { queues: Record<string, unknown>; committed: unknown };
    const sanitizedQueues: Record<string, unknown> = {};
    const myQueue = (viewer.kind === 'player' && game.plan?.queues[viewer.player]) || [];
    if (viewer.kind === 'player' && myQueue.length > 0) sanitizedQueues[viewer.player] = structuredClone(myQueue);
    body.plan = { ...plan, queues: sanitizedQueues, myQueue: structuredClone(myQueue) };
  }
  return body;
}
