// src/api/auth.ts
import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { GameState, PlayerId } from '../types.js';
import { PLAYER_IDS } from '../types.js';
import { globalStore } from '../state/store.js';
import { buildAdjudicationSnapshot } from '../engine/engine.js';

const errorStatus: Record<string, number> = {
  game_not_found: 404,
  invalid_token: 401,
  invalid_host_token: 401,
  not_your_turn: 403,
  player_eliminated: 403,
  game_already_full: 409,
  game_already_started: 409,
  game_over: 409,
  game_not_started: 409,
  lobby_not_ready: 409,
  already_committed: 409,
  not_simultaneous_game: 400,
  unsupported_player_count: 400,
  insufficient_supplies: 400,
  action_limit_reached: 429,
};

export function statusForCode(code: string): number { return errorStatus[code] ?? 400; }

export interface AuthContext { game: GameState; player: PlayerId }

function safeEqual(a: string | undefined, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function findGame(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply): GameState | null {
  const game = globalStore.get(req.params.id);
  if (!game) {
    reply.code(404).send({ error: 'game not found', code: 'game_not_found' });
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
    reply.code(401).send({ error: 'missing token', code: 'invalid_token' });
    return null;
  }
  const player = PLAYER_IDS.find(id => safeEqual(game.tokens[id], token));
  if (!player) {
    reply.code(401).send({ error: 'invalid token', code: 'invalid_token' });
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
  if (typeof token !== 'string' || !safeEqual(game.hostToken, token)) {
    reply.code(401).send({ error: 'invalid host token', code: 'invalid_host_token' });
    return null;
  }
  return game;
}

export function sanitizeGameForResponse(game: GameState, viewer?: PlayerId): unknown {
  const { tokens: _tokens, hostToken: _hostToken, ...rest } = game;
  const body = structuredClone(rest) as Record<string, unknown>;
  body.adjudication = buildAdjudicationSnapshot(game);
  // simultaneous 模式下，其他玩家的计划队列属于秘密：只保留请求者自己的队列，
  // committed 名单公开（"谁已确认"不是秘密）。
  if (game.config.mode === 'simultaneous' && body.plan && typeof body.plan === 'object') {
    const plan = body.plan as { queues: Record<string, unknown>; committed: unknown };
    const sanitizedQueues: Record<string, unknown> = {};
    const myQueue = viewer && game.plan?.queues[viewer] ? game.plan.queues[viewer] : [];
    if (viewer && myQueue.length > 0) sanitizedQueues[viewer] = structuredClone(myQueue);
    body.plan = { ...plan, queues: sanitizedQueues, myQueue: structuredClone(myQueue) };
  }
  return body;
}
