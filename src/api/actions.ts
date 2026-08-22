// src/api/actions.ts
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { globalEventBus } from '../events/bus.js';
import { authenticate, statusForCode } from './auth.js';
import { moveUnit } from '../engine/units.js';
import { attackTarget, healTarget } from '../engine/combat.js';
import { deployUnit } from '../engine/deployment.js';
import { demolishTerrain } from '../engine/demolition.js';
import { endTurn } from '../engine/engine.js';
import { commitAndMaybeResolve } from '../engine/simultaneous.js';
import {
  clearPlanActions, queueAttackAction, queueDeployAction, queueDemolishAction,
  queueHealAction, queueMoveAction, revokePlanAction,
} from '../engine/planning.js';
import type { Result } from '../engine/result.js';
import type { AuthContext } from './auth.js';
import type { UnitType } from '../types.js';
import { globalStore } from '../state/store.js';

function badRequest(reply: FastifyReply, msg: string) {
  return reply.code(400).send({ error: msg, code: 'invalid_move' });
}

function isUnitType(value: unknown): value is UnitType {
  return value === 'infantry' || value === 'scout' || value === 'heavy' || value === 'ranger' || value === 'support';
}

/** 返回 false 表示已写出错误响应。 */
function basicGate(ctx: AuthContext, reply: FastifyReply): boolean {
  if (ctx.game.phase === 'game_over') {
    reply.code(statusForCode('game_over')).send({ error: 'game over', code: 'game_over' });
    return false;
  }
  if (ctx.game.phase !== 'active') {
    reply.code(statusForCode('game_not_started')).send({ error: 'game not started', code: 'game_not_started' });
    return false;
  }
  if (ctx.game.players[ctx.player]?.status !== 'active') {
    reply.code(statusForCode('player_eliminated')).send({ error: 'player eliminated', code: 'player_eliminated' });
    return false;
  }
  return true;
}

/**
 * 动作端点统一入口。顺序模式走 sequentialAction（行为与历史版本完全一致）；
 * simultaneous 模式改走 planAction：动作入队而不执行，响应回显自己的计划队列。
 */
async function dispatchAction(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
  sequentialAction: (ctx: AuthContext) => Result<unknown>,
  planAction: (ctx: AuthContext) => Result<unknown>,
): Promise<unknown> {
  const ctx = authenticate(req, reply);
  if (!ctx) return;
  if (!basicGate(ctx, reply)) return;
  if (ctx.game.config.mode === 'simultaneous') {
    if (ctx.game.plan?.committed.includes(ctx.player)) {
      return reply.code(statusForCode('not_your_turn')).send({ error: 'plan already committed', code: 'not_your_turn' });
    }
    const result = planAction(ctx);
    if (!result.ok) {
      return reply.code(statusForCode(result.code)).send({ error: result.message, code: result.code });
    }
    globalStore.persist(ctx.game);
    return {
      ok: true,
      queued: result.data ?? null,
      queue: [...(ctx.game.plan?.queues[ctx.player] ?? [])],
    };
  }
  if (ctx.game.turn.currentPlayerId !== ctx.player) {
    return reply.code(statusForCode('not_your_turn')).send({ error: 'not your turn', code: 'not_your_turn' });
  }
  const result = sequentialAction(ctx);
  if (!result.ok) {
    return reply.code(statusForCode(result.code)).send({ error: result.message, code: result.code });
  }
  globalStore.persist(ctx.game);
  return { ok: true };
}

interface DeployBody { unitType: UnitType; fromId: string; q: number; r: number }
interface MoveBody { unitId: string; q: number; r: number }
interface AttackBody { attackerId: string; targetId: string; q: number; r: number }
interface HealBody { supportId: string; targetId: string; q: number; r: number }
interface DemolishBody { unitId: string; q: number; r: number }
interface RevokeBody { actionId: string }

export async function actionsRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string }; Body: DeployBody }>('/api/games/:id/deploy', async (req, reply) => {
    const { unitType, fromId, q, r } = req.body || {};
    if (!isUnitType(unitType) || !fromId || typeof q !== 'number' || typeof r !== 'number') {
      return badRequest(reply, 'unitType, fromId, q, r required');
    }
    return dispatchAction(req, reply,
      ({ game, player }) => deployUnit(game, globalEventBus, player, unitType, fromId, q, r),
      ({ game, player }) => queueDeployAction(game, player, unitType, fromId, q, r));
  });

  app.post<{ Params: { id: string }; Body: MoveBody }>('/api/games/:id/move', async (req, reply) => {
    const { unitId, q, r } = req.body || {};
    if (!unitId || typeof q !== 'number' || typeof r !== 'number') {
      return badRequest(reply, 'unitId, q, r required');
    }
    return dispatchAction(req, reply,
      ({ game, player }) => moveUnit(game, globalEventBus, player, unitId, q, r),
      ({ game, player }) => queueMoveAction(game, player, unitId, q, r));
  });

  app.post<{ Params: { id: string }; Body: AttackBody }>('/api/games/:id/attack', async (req, reply) => {
    const { attackerId, targetId, q, r } = req.body || {};
    if (!attackerId) return badRequest(reply, 'attackerId required');
    // 两种模式的请求体不同：顺序模式指定目标实体 targetId，
    // 同时模式改为指定目标格子 q/r（预测性开火，不要求格内有敌）。
    return dispatchAction(req, reply,
      ({ game, player }) => {
        if (!targetId) return { ok: false, code: 'invalid_move', message: 'attackerId and targetId required' };
        return attackTarget(game, globalEventBus, player, attackerId, targetId);
      },
      ({ game, player }) => {
        if (typeof q !== 'number' || typeof r !== 'number') {
          return { ok: false, code: 'invalid_attack', message: 'attackerId, q, r required' };
        }
        return queueAttackAction(game, player, attackerId, q, r);
      });
  });

  app.post<{ Params: { id: string }; Body: HealBody }>('/api/games/:id/heal', async (req, reply) => {
    const { supportId, targetId, q, r } = req.body || {};
    if (!supportId) return badRequest(reply, 'supportId required');
    // 顺序模式指定友方单位 targetId；同时模式改为指定格子/方向 q/r（区域治疗）。
    return dispatchAction(req, reply,
      ({ game, player }) => {
        if (!targetId) return { ok: false, code: 'invalid_move', message: 'supportId and targetId required' };
        return healTarget(game, globalEventBus, player, supportId, targetId);
      },
      ({ game, player }) => {
        if (typeof q !== 'number' || typeof r !== 'number') {
          return { ok: false, code: 'invalid_heal', message: 'supportId, q, r required' };
        }
        return queueHealAction(game, player, supportId, q, r);
      });
  });

  app.post<{ Params: { id: string }; Body: DemolishBody }>('/api/games/:id/demolish', async (req, reply) => {
    const { unitId, q, r } = req.body || {};
    if (!unitId || typeof q !== 'number' || typeof r !== 'number') {
      return badRequest(reply, 'unitId, q, r required');
    }
    return dispatchAction(req, reply,
      ({ game, player }) => demolishTerrain(game, globalEventBus, player, unitId, q, r),
      ({ game, player }) => queueDemolishAction(game, player, unitId, q, r));
  });

  // 顺序模式 = 结束当前回合；simultaneous 模式 = 确认锁定本回合计划队列，
  // 当所有存活玩家都已确认时立即触发统一结算。
  app.post<{ Params: { id: string } }>('/api/games/:id/end-turn', async (req, reply) => {
    const ctx = authenticate(req, reply);
    if (!ctx) return;
    if (!basicGate(ctx, reply)) return;
    if (ctx.game.config.mode === 'simultaneous') {
      const result = commitAndMaybeResolve(ctx.game, globalEventBus, ctx.player);
      if (!result.ok) {
        return reply.code(statusForCode(result.code)).send({ error: result.message, code: result.code });
      }
      globalStore.persist(ctx.game);
      return {
        ok: true,
        committed: true,
        resolved: result.data ? result.data.resolved : false,
        roundNumber: ctx.game.turn.roundNumber,
        phase: ctx.game.phase,
      };
    }
    if (ctx.game.turn.currentPlayerId !== ctx.player) {
      return reply.code(statusForCode('not_your_turn')).send({ error: 'not your turn', code: 'not_your_turn' });
    }
    const result = endTurn(ctx.game, globalEventBus, ctx.player);
    if (!result.ok) {
      return reply.code(statusForCode(result.code)).send({ error: result.message, code: result.code });
    }
    globalStore.persist(ctx.game);
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: RevokeBody }>('/api/games/:id/plan/revoke', async (req, reply) => {
    const ctx = authenticate(req, reply);
    if (!ctx) return;
    if (ctx.game.config.mode !== 'simultaneous') {
      return reply.code(statusForCode('not_simultaneous_game')).send({ error: 'game is not in simultaneous mode', code: 'not_simultaneous_game' });
    }
    if (!basicGate(ctx, reply)) return;
    const actionId = req.body?.actionId;
    if (typeof actionId !== 'string' || actionId.length === 0) {
      return badRequest(reply, 'actionId required');
    }
    const result = revokePlanAction(ctx.game, ctx.player, actionId);
    if (!result.ok) {
      return reply.code(statusForCode(result.code)).send({ error: result.message, code: result.code });
    }
    globalStore.persist(ctx.game);
    return { ok: true, queue: result.data };
  });

  app.post<{ Params: { id: string } }>('/api/games/:id/plan/clear', async (req, reply) => {
    const ctx = authenticate(req, reply);
    if (!ctx) return;
    if (ctx.game.config.mode !== 'simultaneous') {
      return reply.code(statusForCode('not_simultaneous_game')).send({ error: 'game is not in simultaneous mode', code: 'not_simultaneous_game' });
    }
    if (!basicGate(ctx, reply)) return;
    const result = clearPlanActions(ctx.game, ctx.player);
    if (!result.ok) {
      return reply.code(statusForCode(result.code)).send({ error: result.message, code: result.code });
    }
    globalStore.persist(ctx.game);
    return { ok: true, queue: result.data };
  });
}
