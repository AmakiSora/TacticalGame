// src/api/actions.ts
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { globalEventBus } from '../events/bus.js';
import { authenticate, statusForCode } from './auth.js';
import { startBuild, sellBuilding } from '../engine/building.js';
import { startProduction } from '../engine/production.js';
import { moveUnit } from '../engine/units.js';
import { attackTarget, healTarget } from '../engine/combat.js';
import { endTurn } from '../engine/engine.js';
import type { Result } from '../engine/building.js';
import type { AuthContext } from './auth.js';

async function actionHandler(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
  action: (ctx: AuthContext) => Result<unknown>,
): Promise<unknown> {
  const ctx = authenticate(req, reply);
  if (!ctx) return;
  if (ctx.game.phase === 'game_over') {
    return reply.code(statusForCode('game_over'))
      .send({ error: 'game over', code: 'game_over' });
  }
  if (ctx.game.phase !== 'waiting_command') {
    return reply.code(statusForCode('game_not_started'))
      .send({ error: 'game not started', code: 'game_not_started' });
  }
  if (ctx.game.turn.currentOwner !== ctx.player) {
    return reply.code(statusForCode('not_your_turn'))
      .send({ error: 'not your turn', code: 'not_your_turn' });
  }
  const result = action(ctx);
  if (!result.ok) {
    return reply.code(statusForCode(result.code))
      .send({ error: result.message, code: result.code });
  }
  return { ok: true };
}

function badRequest(reply: FastifyReply, msg: string) {
  return reply.code(400).send({ error: msg, code: 'invalid_move' });
}

interface BuildBody { type: 'barracks' | 'miner'; x: number; y: number }
interface ProduceBody { buildingId: string; unitType: 'infantry' | 'sniper' | 'tank' | 'medic' }
interface MoveBody { unitId: string; x: number; y: number }
interface AttackBody { attackerId: string; targetId: string }
interface HealBody { medicId: string; targetId: string }
interface SellBody { buildingId: string }

export async function actionsRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string }; Body: BuildBody }>(
    '/api/games/:id/build', async (req, reply) => {
      const { type, x, y } = req.body || {};
      if (!type || typeof x !== 'number' || typeof y !== 'number') {
        return badRequest(reply, 'type, x, y required');
      }
      return actionHandler(req, reply, ({ game, player }) =>
        startBuild(game, globalEventBus, player, type, x, y));
    },
  );

  app.post<{ Params: { id: string }; Body: ProduceBody }>(
    '/api/games/:id/produce', async (req, reply) => {
      const { buildingId, unitType } = req.body || {};
      if (!buildingId || !unitType) {
        return badRequest(reply, 'buildingId and unitType required');
      }
      return actionHandler(req, reply, ({ game, player }) =>
        startProduction(game, globalEventBus, player, buildingId, unitType));
    },
  );

  app.post<{ Params: { id: string }; Body: MoveBody }>(
    '/api/games/:id/move', async (req, reply) => {
      const { unitId, x, y } = req.body || {};
      if (!unitId || typeof x !== 'number' || typeof y !== 'number') {
        return badRequest(reply, 'unitId, x, y required');
      }
      return actionHandler(req, reply, ({ game, player }) =>
        moveUnit(game, globalEventBus, player, unitId, x, y));
    },
  );

  app.post<{ Params: { id: string }; Body: AttackBody }>(
    '/api/games/:id/attack', async (req, reply) => {
      const { attackerId, targetId } = req.body || {};
      if (!attackerId || !targetId) {
        return badRequest(reply, 'attackerId and targetId required');
      }
      return actionHandler(req, reply, ({ game, player }) =>
        attackTarget(game, globalEventBus, player, attackerId, targetId));
    },
  );

  app.post<{ Params: { id: string }; Body: HealBody }>(
    '/api/games/:id/heal', async (req, reply) => {
      const { medicId, targetId } = req.body || {};
      if (!medicId || !targetId) {
        return badRequest(reply, 'medicId and targetId required');
      }
      return actionHandler(req, reply, ({ game, player }) =>
        healTarget(game, globalEventBus, player, medicId, targetId));
    },
  );

  app.post<{ Params: { id: string }; Body: SellBody }>(
    '/api/games/:id/sell', async (req, reply) => {
      const { buildingId } = req.body || {};
      if (!buildingId) {
        return badRequest(reply, 'buildingId required');
      }
      return actionHandler(req, reply, ({ game, player }) =>
        sellBuilding(game, globalEventBus, player, buildingId));
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/games/:id/end-turn', async (req, reply) =>
      actionHandler(req, reply, ({ game, player }) =>
        endTurn(game, globalEventBus, player)),
  );
}
