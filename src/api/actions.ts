// src/api/actions.ts
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { globalEventBus } from '../events/bus.js';
import { authenticate, statusForCode } from './auth.js';
import { moveUnit } from '../engine/units.js';
import { attackTarget, healTarget } from '../engine/combat.js';
import { deployUnit } from '../engine/deployment.js';
import { demolishTerrain } from '../engine/demolition.js';
import { endTurn } from '../engine/engine.js';
import type { Result } from '../engine/result.js';
import type { AuthContext } from './auth.js';
import type { UnitType } from '../types.js';

async function actionHandler(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
  action: (ctx: AuthContext) => Result<unknown>,
): Promise<unknown> {
  const ctx = authenticate(req, reply);
  if (!ctx) return;
  if (ctx.game.phase === 'game_over') {
    return reply.code(statusForCode('game_over')).send({ error: 'game over', code: 'game_over' });
  }
  if (ctx.game.phase !== 'waiting_command') {
    return reply.code(statusForCode('game_not_started')).send({ error: 'game not started', code: 'game_not_started' });
  }
  if (ctx.game.turn.currentOwner !== ctx.player) {
    return reply.code(statusForCode('not_your_turn')).send({ error: 'not your turn', code: 'not_your_turn' });
  }
  const result = action(ctx);
  if (!result.ok) {
    return reply.code(statusForCode(result.code)).send({ error: result.message, code: result.code });
  }
  return { ok: true };
}

function badRequest(reply: FastifyReply, msg: string) {
  return reply.code(400).send({ error: msg, code: 'invalid_move' });
}

function isUnitType(value: unknown): value is UnitType {
  return value === 'infantry' || value === 'scout' || value === 'heavy' || value === 'ranger' || value === 'support';
}

interface DeployBody { unitType: UnitType; fromId: string; q: number; r: number }
interface MoveBody { unitId: string; q: number; r: number }
interface AttackBody { attackerId: string; targetId: string }
interface HealBody { supportId: string; targetId: string }
interface DemolishBody { unitId: string; q: number; r: number }

export async function actionsRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string }; Body: DeployBody }>('/api/games/:id/deploy', async (req, reply) => {
    const { unitType, fromId, q, r } = req.body || {};
    if (!isUnitType(unitType) || !fromId || typeof q !== 'number' || typeof r !== 'number') {
      return badRequest(reply, 'unitType, fromId, q, r required');
    }
    return actionHandler(req, reply, ({ game, player }) =>
      deployUnit(game, globalEventBus, player, unitType, fromId, q, r));
  });

  app.post<{ Params: { id: string }; Body: MoveBody }>('/api/games/:id/move', async (req, reply) => {
    const { unitId, q, r } = req.body || {};
    if (!unitId || typeof q !== 'number' || typeof r !== 'number') {
      return badRequest(reply, 'unitId, q, r required');
    }
    return actionHandler(req, reply, ({ game, player }) =>
      moveUnit(game, globalEventBus, player, unitId, q, r));
  });

  app.post<{ Params: { id: string }; Body: AttackBody }>('/api/games/:id/attack', async (req, reply) => {
    const { attackerId, targetId } = req.body || {};
    if (!attackerId || !targetId) return badRequest(reply, 'attackerId and targetId required');
    return actionHandler(req, reply, ({ game, player }) =>
      attackTarget(game, globalEventBus, player, attackerId, targetId));
  });

  app.post<{ Params: { id: string }; Body: HealBody }>('/api/games/:id/heal', async (req, reply) => {
    const { supportId, targetId } = req.body || {};
    if (!supportId || !targetId) return badRequest(reply, 'supportId and targetId required');
    return actionHandler(req, reply, ({ game, player }) =>
      healTarget(game, globalEventBus, player, supportId, targetId));
  });

  app.post<{ Params: { id: string }; Body: DemolishBody }>('/api/games/:id/demolish', async (req, reply) => {
    const { unitId, q, r } = req.body || {};
    if (!unitId || typeof q !== 'number' || typeof r !== 'number') {
      return badRequest(reply, 'unitId, q, r required');
    }
    return actionHandler(req, reply, ({ game, player }) =>
      demolishTerrain(game, globalEventBus, player, unitId, q, r));
  });

  app.post<{ Params: { id: string } }>('/api/games/:id/end-turn', async (req, reply) =>
    actionHandler(req, reply, ({ game, player }) => endTurn(game, globalEventBus, player)));
}
