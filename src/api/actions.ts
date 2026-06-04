// src/api/actions.ts
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { globalEventBus } from '../events/bus.js';
import { authenticate, statusForCode } from './auth.js';
import { startBuild } from '../engine/building.js';
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

interface BuildBody { type: 'barracks' | 'miner'; x: number; y: number }
interface ProduceBody { buildingId: string; unitType: 'infantry' | 'sniper' | 'tank' | 'medic' }
interface MoveBody { unitId: string; x: number; y: number }
interface AttackBody { attackerId: string; targetId: string }
interface HealBody { medicId: string; targetId: string }

export async function actionsRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string }; Body: BuildBody }>(
    '/api/games/:id/build', async (req, reply) =>
      actionHandler(req, reply, ({ game, player }) =>
        startBuild(game, globalEventBus, player, req.body.type, req.body.x, req.body.y)),
  );

  app.post<{ Params: { id: string }; Body: ProduceBody }>(
    '/api/games/:id/produce', async (req, reply) =>
      actionHandler(req, reply, ({ game, player }) =>
        startProduction(game, globalEventBus, player, req.body.buildingId, req.body.unitType)),
  );

  app.post<{ Params: { id: string }; Body: MoveBody }>(
    '/api/games/:id/move', async (req, reply) =>
      actionHandler(req, reply, ({ game, player }) =>
        moveUnit(game, globalEventBus, player, req.body.unitId, req.body.x, req.body.y)),
  );

  app.post<{ Params: { id: string }; Body: AttackBody }>(
    '/api/games/:id/attack', async (req, reply) =>
      actionHandler(req, reply, ({ game, player }) =>
        attackTarget(game, globalEventBus, player, req.body.attackerId, req.body.targetId)),
  );

  app.post<{ Params: { id: string }; Body: HealBody }>(
    '/api/games/:id/heal', async (req, reply) =>
      actionHandler(req, reply, ({ game, player }) =>
        healTarget(game, globalEventBus, player, req.body.medicId, req.body.targetId)),
  );

  app.post<{ Params: { id: string } }>(
    '/api/games/:id/end-turn', async (req, reply) =>
      actionHandler(req, reply, ({ game, player }) =>
        endTurn(game, globalEventBus, player)),
  );
}
