// src/api/auth.ts
import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { GameState, PlayerId } from '../types.js';
import { globalStore } from '../state/store.js';

const errorStatus: Record<string, number> = {
  game_not_found: 404,
  invalid_token: 401,
  not_your_turn: 403,
  game_already_full: 409,
  game_over: 409,
  game_not_started: 409,
};

export function statusForCode(code: string): number {
  return errorStatus[code] ?? 400;
}

export interface AuthContext {
  game: GameState;
  player: PlayerId;
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function authenticate(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): AuthContext | null {
  const game = globalStore.get(req.params.id);
  if (!game) {
    reply.code(404).send({ error: 'game not found', code: 'game_not_found' });
    return null;
  }
  const token = req.headers['x-player-token'];
  if (typeof token !== 'string' || token.length === 0) {
    reply.code(401).send({ error: 'missing token', code: 'invalid_token' });
    return null;
  }
  let player: PlayerId | null = null;
  if (safeEqual(game.tokens.player_a, token)) player = 'player_a';
  else if (safeEqual(game.tokens.player_b, token)) player = 'player_b';
  if (player === null) {
    reply.code(401).send({ error: 'invalid token', code: 'invalid_token' });
    return null;
  }
  return { game, player };
}

export function sanitizeGameForResponse(game: GameState): unknown {
  const { tokens, ...rest } = game;
  return rest;
}
