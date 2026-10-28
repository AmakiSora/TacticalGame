// src/engine/simultaneous.ts
// simultaneous 模式的对外入口与回合边界。
//
// 所有玩家在计划阶段秘密排队动作，全员确认（或房主强制）后严格同时结算。结算按
// 行动点分步进行（见 simultaneousResolve.ts）：队列第 k 条在所有玩家之间同时结算，
// 完成后才进入第 k+1 条。结算顺序恒按 turn.turnOrder（开局随机洗牌），确定性可回放。
//
// 每轮末尾：占点 → 据点流量累计 → round_end → round_resolved →（终局时 game_over）→
// 翻盘补给 → 回合数+1 → 炮火收缩（annihilation/royale）→ 重置全员行动标志与计划状态
// → 全员发收入与维修 → round_start。终局摘要始终先于 game_over，保证后者是事件流里
// 最后一条。
import type { GameState, PendingAction, PlayerId } from '../types.js';
import type { EventBus } from '../events/bus.js';
import { appendEvent } from './events.js';
import {
  accumulateControlHold, activePlayerIds, adjudicateAtTurnLimit, captureControlPoints, collectIncome,
  endGame, grantComebackSupplies, isTurnLimitReached, repairFromControlPoints, resetActions,
  updateArtilleryForRound,
} from './engine.js';
import { dropFromPlan, isSimultaneous, markCommitted, resetPlanForRound } from './planning.js';
import { resolveRoundSteps } from './simultaneousResolve.js';
import type { Result, Failure } from './result.js';

export type { PlanOutcome } from './simultaneousResolve.js';

function notSimultaneous(): Failure {
  return { ok: false, code: 'not_simultaneous_game', message: '该对局不是同时回合模式' };
}

export function shouldAutoResolve(game: GameState): boolean {
  if (!isSimultaneous(game) || game.phase !== 'active' || !game.plan) return false;
  const active = activePlayerIds(game);
  if (active.length < 2) return false;
  return active.every(id => game.plan!.committed.includes(id));
}

/** 玩家确认本回合计划；若所有存活玩家均已确认则立即同步结算。 */
export function commitAndMaybeResolve(game: GameState, bus: EventBus, owner: PlayerId): Result<{ resolved: boolean }> {
  const committed = markCommitted(game, bus, owner);
  if (!committed.ok) return committed;
  const resolved = shouldAutoResolve(game);
  if (resolved) resolveRound(game, bus);
  return { ok: true, data: { resolved } };
}

/**
 * 房主强制结算：未确认的玩家按其当前队列（可能为空）参与结算。
 * options.repeat=true 时跳过轮次守卫（房主明确要再推一次，用于旧存档卡住的存量对局）；
 * 每次调用只放行一次，调用方负责打 warning + metrics。
 */
export function forceResolveRound(
  game: GameState,
  bus: EventBus,
  options: { repeat?: boolean } = {},
): Result<{ roundNumber: number; repeated: boolean }> {
  if (!isSimultaneous(game)) return notSimultaneous();
  if (game.phase === 'game_over') return { ok: false, code: 'game_over', message: '对局已结束' };
  if (game.phase !== 'active') return { ok: false, code: 'game_not_started', message: '对局不在进行中' };
  // 轮次守卫：本轮已经结算过、且之后没有任何新输入（入队/提交会清空 resolvedRound）
  // 时拒绝重复结算，避免一次误重试把同一轮推两次（补给/收入会多发一份）。
  // 房主带 repeat=true 时显式放行（默认防误触，不是防房主）。
  const guarded = alreadyResolvedThisRound(game);
  if (guarded && !options.repeat) {
    return { ok: false, code: 'round_already_resolved', message: '本轮已经结算，等待下一次行动提交后再结算' };
  }
  const roundNumber = game.turn.roundNumber;
  resolveRound(game, bus, { force: Boolean(options.repeat) });
  return { ok: true, data: { roundNumber, repeated: guarded } };
}

function alreadyResolvedThisRound(game: GameState): boolean {
  return game.turn.resolvedRound === game.turn.roundNumber;
}

/** 计划期玩家被淘汰后调用：清出计划状态；若其余玩家均已确认则立即结算。 */
export function eliminateFromPlanAndMaybeResolve(game: GameState, bus: EventBus, playerId: PlayerId): void {
  if (!isSimultaneous(game) || game.phase !== 'active') return;
  dropFromPlan(game, playerId);
  if (shouldAutoResolve(game)) resolveRound(game, bus);
}

export function resolveRound(game: GameState, bus: EventBus, options: { force?: boolean } = {}): void {
  // 双保险：自动结算路径（全员确认）与房主强制结算共用这里，已经结算过的轮次直接跳过。
  // options.force 只由「房主显式 repeat」传入——那是他明确要推，守卫不该拦。
  if (!options.force && alreadyResolvedThisRound(game)) return;
  const roundNumber = game.turn.roundNumber;
  const order = game.turn.turnOrder.filter(id => game.players[id]?.status === 'active');
  const queues = new Map<PlayerId, PendingAction[]>(
    order.map(id => [id, [...(game.plan?.queues[id] ?? [])]]),
  );

  const { outcomes, steps, ending } = resolveRoundSteps(game, bus, order, queues);

  const finish = (gameOver: boolean): void => {
    appendEvent(game, bus, 'round_end', { roundNumber, gameOver, steps });
    appendEvent(game, bus, 'round_resolved', { roundNumber, gameOver, results: outcomes, steps });
  };

  // 多家总部同一步被摧毁 → 可能直接终局或同归于尽。
  // 终局回合的摘要必须先于 game_over 落库/广播：game_over 是客户端约定的终止事件，
  // 先发会把最后一轮 round_resolved 留在终止事件之后。
  if (ending) {
    finish(true);
    endGame(game, bus, ending.winner, ending.reason);
    return;
  }
  if (game.phase === 'game_over') {
    finish(true);
    return;
  }

  // ---------------------------------------------------------------- 占点
  for (const id of activePlayerIds(game)) {
    captureControlPoints(game, bus, id);
  }

  // ---------------------------------------------------------------- 回合边界
  accumulateControlHold(game);
  // 先把终局摘要写完整，再让 game_over 收尾；adjudicateAtTurnLimit 内部会再校验一次。
  const adjudicated = isTurnLimitReached(game);
  // 这里已经调用过 accumulateControlHold；标记供重启/回放重建区分
  // 「回合上限终局」与「死亡终局」，避免后者也被错误补算最后一轮流量。
  appendEvent(game, bus, 'round_end', {
    roundNumber, gameOver: adjudicated, controlHoldCounted: true, steps,
  });
  appendEvent(game, bus, 'round_resolved', { roundNumber, gameOver: adjudicated, results: outcomes, steps });
  if (adjudicated) {
    adjudicateAtTurnLimit(game, bus);
    return;
  }

  grantComebackSupplies(game, bus);
  game.turn.roundNumber += 1;
  game.turn.turnNumber = game.turn.roundNumber;
  // 轮次守卫写成**新**轮号（先自增再记）：下一轮等玩家有新的输入（会清成 null）才允许结算。
  game.turn.resolvedRound = game.turn.roundNumber;
  // 轮界炮火收缩（annihilation/royale）：与顺序版 advanceTurn 同序——轮号自增后
  // 立即缩圈、对圈外单位造成伤害并清场淘汰；若就此终局则不再进入新一轮。
  if (updateArtilleryForRound(game, bus)) return;
  resetPlanForRound(game);
  for (const id of activePlayerIds(game)) {
    resetActions(game, id);
  }
  // 自第 2 回合起，回合边界给所有存活玩家统一发收入与维修（全员对称，首回合无收入）。
  for (const id of activePlayerIds(game)) {
    collectIncome(game, bus, id);
    repairFromControlPoints(game, bus, id);
  }
  appendEvent(game, bus, 'round_start', {
    roundNumber: game.turn.roundNumber,
    players: activePlayerIds(game),
    committed: [],
  });
}
