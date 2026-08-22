// src/engine/simultaneous.ts
// simultaneous 模式的统一结算器：所有玩家在计划阶段秘密排队动作，全员确认（或房主
// 强制）后严格同时结算。结算顺序恒按 turn.turnOrder（开局随机洗牌），确定性可回放。
//
// 结算分五个阶段：
//   1. 部署与移动共享同一"目的格声明池"：同一格被 ≥2 个动作声明 → 全部失败；
//   2. 移动按计划时刻路径同时落位；
//   3. 拆除（移动后地形才生效）+ 格子攻击（按移动/部署后的棋盘判定，友军免伤、
//      落空即浪费）+ 治疗（按目标最终位置复核射程）；净血量 = 先治疗、再按顺序
//      施加伤害（等价同时，且击杀归属确定）；
//   4. 占点（每个存活玩家，一格一单位无冲突）；
//   5. 回合边界：round_end → 回合上限裁定 → 翻盘补给 → 回合数+1 → 重置全员行动
//      标志与计划状态 → 全员发收入与维修 → round_start。
import type { GameState, Headquarters, PendingAction, PlayerId, PlayerRecord, Unit } from '../types.js';
import type { EventBus } from '../events/bus.js';
import { appendEvent } from './events.js';
import { hexDistance } from './hex.js';
import { computeDamage } from './combat.js';
import { getCellOccupant, getTerrain } from './validation.js';
import { createUnitFromConfig } from '../state/store.js';
import { deployDiscountForOrigin } from './controlPoints.js';
import { ACTION_MERIT, addActionMerit, effectActionMerit } from './actionScore.js';
import {
  activePlayerIds, adjudicateAtTurnLimit, captureControlPoints, collectIncome,
  endGame, grantComebackSupplies, markPlayerEliminated, repairFromControlPoints, resetActions,
} from './engine.js';
import { dropFromPlan, isSimultaneous, markCommitted, resetPlanForRound } from './planning.js';
import type { Result, Failure } from './result.js';

export interface PlanOutcome {
  actionId: string;
  type: PendingAction['type'];
  owner: PlayerId;
  status: 'executed' | 'failed' | 'missed' | 'fizzled';
  reason?: string;
  detail?: Record<string, unknown>;
}

function notSimultaneous(): Failure {
  return { ok: false, code: 'not_simultaneous_game', message: 'game is not in simultaneous mode' };
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

/** 房主强制结算：未确认的玩家按其当前队列（可能为空）参与结算。 */
export function forceResolveRound(game: GameState, bus: EventBus): Result<{ roundNumber: number }> {
  if (!isSimultaneous(game)) return notSimultaneous();
  if (game.phase === 'game_over') return { ok: false, code: 'game_over', message: 'game has ended' };
  if (game.phase !== 'active') return { ok: false, code: 'game_not_started', message: 'game not in play' };
  const roundNumber = game.turn.roundNumber;
  resolveRound(game, bus);
  return { ok: true, data: { roundNumber } };
}

/** 计划期玩家被淘汰后调用：清出计划状态；若其余玩家均已确认则立即结算。 */
export function eliminateFromPlanAndMaybeResolve(game: GameState, bus: EventBus, playerId: PlayerId): void {
  if (!isSimultaneous(game) || game.phase !== 'active') return;
  dropFromPlan(game, playerId);
  if (shouldAutoResolve(game)) resolveRound(game, bus);
}

function chargeActionPoint(game: GameState, owner: PlayerId): void {
  const stats = game.players[owner]?.stats;
  if (stats) stats.actionPointsUsed = (stats.actionPointsUsed ?? 0) + 1;
}

function setTerrainPlain(game: GameState, q: number, r: number): void {
  const cell = game.cells.find(c => c.q === q && c.r === r);
  if (cell) cell.terrain = 'plain';
  const override = game.map.terrainCells.find(c => c.q === q && c.r === r);
  if (override) {
    override.terrain = 'plain';
  } else {
    game.map.terrainCells.push({ q, r, terrain: 'plain' });
  }
}

function rollHeal(game: GameState, support: Unit): number {
  const base = support.healPower ?? 0;
  return base + Math.floor(Math.random() * (game.config.balance.healVarianceRange + 1));
}

export function resolveRound(game: GameState, bus: EventBus): void {
  const roundNumber = game.turn.roundNumber;
  const order = game.turn.turnOrder.filter(id => game.players[id]?.status === 'active');
  const queues = new Map<PlayerId, PendingAction[]>(
    order.map(id => [id, [...(game.plan?.queues[id] ?? [])]]));
  const outcomes: PlayerRecord<PlanOutcome[]> = {};
  for (const id of order) outcomes[id] = [];
  const limit = game.config.balance.actionsPerTurn;
  // 事件里的 actionsUsed 为该动作在玩家队列中的位置（1 起），供统计重建使用。
  const actionsUsedOf = (owner: PlayerId, action: PendingAction): number =>
    queues.get(owner)!.indexOf(action) + 1;
  const remaining = (used: number): number => Math.max(0, limit - used);

  // ---------------------------------------------------------------- 阶段一+二：目的格声明池
  const claims = new Map<string, { owner: PlayerId; action: PendingAction }[]>();
  for (const id of order) {
    for (const action of queues.get(id)!) {
      if (action.type !== 'deploy' && action.type !== 'move') continue;
      const key = `${action.q},${action.r}`;
      if (!claims.has(key)) claims.set(key, []);
      claims.get(key)!.push({ owner: id, action });
    }
  }
  const hasDestinationConflict = (action: PendingAction): boolean =>
    (action.type === 'deploy' || action.type === 'move') &&
    (claims.get(`${action.q},${action.r}`) ?? []).length > 1;

  const recordFailure = (owner: PlayerId, action: PendingAction, reason: string, extra: Record<string, unknown> = {}): void => {
    outcomes[owner]!.push({ actionId: action.id, type: action.type, owner, status: 'failed', reason });
    appendEvent(game, bus, 'action_failed', {
      owner,
      actionId: action.id,
      type: action.type,
      reason,
      roundNumber,
      ...extra,
      actionsUsed: actionsUsedOf(owner, action),
    });
  };

  // ---------------------------------------------------------------- 阶段一：部署
  for (const id of order) {
    for (const action of queues.get(id)!) {
      if (action.type !== 'deploy') continue;
      const used = actionsUsedOf(id, action);
      chargeActionPoint(game, id);
      if (hasDestinationConflict(action)) {
        // 冲突失败：不扣补给，不生成单位。
        recordFailure(id, action, 'destination_conflict', { q: action.q, r: action.r });
        continue;
      }
      const spec = game.config.units[action.unitType!];
      const discount = Math.min(spec.cost, deployDiscountForOrigin(game, id, action.fromId!));
      const cost = spec.cost - discount;
      const resources = game.resources[id];
      if (!resources || resources.supplies < cost) {
        recordFailure(id, action, 'insufficient_supplies', { q: action.q, r: action.r });
        continue;
      }
      resources.supplies -= cost;
      const unit = createUnitFromConfig(game.config, id, action.unitType!, action.q!, action.r!);
      unit.hasMoved = true;
      unit.hasActed = false;
      unit.actionSpent = true;
      game.units.push(unit);
      addActionMerit(game, id, ACTION_MERIT.deploy);
      appendEvent(game, bus, 'deploy', {
        unitId: unit.id, owner: id, unitType: action.unitType, fromId: action.fromId,
        q: action.q, r: action.r, cost, unitCost: spec.cost, discount,
        hp: unit.hp, attack: unit.attack, defense: unit.defense,
        moveRange: unit.moveRange, attackRange: unit.attackRange,
        canCapture: unit.canCapture, healPower: unit.healPower,
        actionsUsed: used, actionsRemaining: remaining(used), roundNumber,
      });
      outcomes[id]!.push({ actionId: action.id, type: 'deploy', owner: id, status: 'executed', detail: { unitId: unit.id, cost } });
    }
  }

  // ---------------------------------------------------------------- 阶段二：移动
  for (const id of order) {
    for (const action of queues.get(id)!) {
      if (action.type !== 'move') continue;
      const used = actionsUsedOf(id, action);
      chargeActionPoint(game, id);
      const unit = game.units.find(u => u.id === action.unitId && u.owner === id && u.alive);
      if (!unit) {
        recordFailure(id, action, 'unit_gone');
        continue;
      }
      if (hasDestinationConflict(action)) {
        recordFailure(id, action, 'destination_conflict', { q: action.q, r: action.r });
        continue;
      }
      const fromQ = unit.q;
      const fromR = unit.r;
      unit.q = action.q!;
      unit.r = action.r!;
      unit.hasMoved = true;
      appendEvent(game, bus, 'move', {
        unitId: unit.id, owner: id, fromQ, fromR, toQ: unit.q, toR: unit.r,
        actionsUsed: used, actionsRemaining: remaining(used), roundNumber,
      });
      outcomes[id]!.push({ actionId: action.id, type: 'move', owner: id, status: 'executed', detail: { fromQ, fromR, toQ: unit.q, toR: unit.r } });
    }
  }

  // ---------------------------------------------------------------- 阶段三：同时攻击 / 治疗 / 拆除
  // 3a. 拆除：地形在移动结算之后才变化，本回合新开的缺口不影响本回合移动。
  for (const id of order) {
    for (const action of queues.get(id)!) {
      if (action.type !== 'demolish') continue;
      const used = actionsUsedOf(id, action);
      chargeActionPoint(game, id);
      const unit = game.units.find(u => u.id === action.unitId && u.owner === id && u.alive);
      if (!unit || unit.type !== 'heavy'
        || hexDistance(unit, { q: action.q!, r: action.r! }) > 1
        || getTerrain(game, action.q!, action.r!) !== 'blocker') {
        recordFailure(id, action, 'invalid_target', { q: action.q, r: action.r });
        continue;
      }
      setTerrainPlain(game, action.q!, action.r!);
      unit.hasActed = true;
      addActionMerit(game, id, ACTION_MERIT.demolish);
      appendEvent(game, bus, 'demolish', {
        unitId: unit.id, owner: id, q: action.q, r: action.r,
        fromTerrain: 'blocker', toTerrain: 'plain',
        actionsUsed: used, actionsRemaining: remaining(used), roundNumber,
      });
      outcomes[id]!.push({ actionId: action.id, type: 'demolish', owner: id, status: 'executed' });
    }
  }

  // 3b. 收集攻击：按移动/部署后的棋盘判定目标格。友军免伤；空格或友军格 → 落空。
  interface Strike {
    owner: PlayerId;
    action: PendingAction;
    attacker: Unit;
    q: number;
    r: number;
    hit: boolean;
    targetKind: 'unit' | 'headquarters' | null;
    targetId: string | null;
    defense: number;
  }
  const strikes: Strike[] = [];
  for (const id of order) {
    for (const action of queues.get(id)!) {
      if (action.type !== 'attack') continue;
      const used = actionsUsedOf(id, action);
      chargeActionPoint(game, id);
      const attacker = game.units.find(u => u.id === action.attackerId && u.owner === id && u.alive);
      if (!attacker) {
        recordFailure(id, action, 'unit_gone');
        continue;
      }
      attacker.hasActed = true;
      const occupant = getCellOccupant(game, action.q!, action.r!);
      const hit = occupant !== null && occupant.entity.owner !== id;
      strikes.push({
        owner: id, action, attacker, q: action.q!, r: action.r!, hit,
        targetKind: hit ? occupant!.kind : null,
        targetId: hit ? occupant!.entity.id : null,
        defense: hit ? occupant!.entity.defense : 0,
      });
      void used;
    }
  }

  // 3c. 收集治疗：按目标移动后的最终位置复核射程。
  const heals: { owner: PlayerId; action: PendingAction; support: Unit; target: Unit; amount: number }[] = [];
  for (const id of order) {
    for (const action of queues.get(id)!) {
      if (action.type !== 'heal') continue;
      chargeActionPoint(game, id);
      const support = game.units.find(u => u.id === action.supportId && u.owner === id && u.alive);
      const target = game.units.find(u => u.id === action.targetId && u.owner === id && u.alive);
      if (!support || !target || support.type !== 'support'
        || hexDistance(support, target) > support.attackRange) {
        outcomes[id]!.push({ actionId: action.id, type: 'heal', owner: id, status: 'fizzled', reason: 'out_of_range' });
        appendEvent(game, bus, 'action_failed', {
          owner: id, actionId: action.id, type: 'heal', reason: 'out_of_range',
          supportId: action.supportId, targetId: action.targetId, roundNumber,
          actionsUsed: actionsUsedOf(id, action),
        });
        continue;
      }
      support.hasActed = true;
      heals.push({ owner: id, action, support, target, amount: rollHeal(game, support) });
    }
  }

  // 3d. 净血量结算：先施放全部治疗（上限截断），再按 turnOrder 顺序施加伤害——
  //     数学上等价于同时结算（hp + 治疗 - 伤害），且击杀归属确定。
  for (const heal of heals) {
    const applied = Math.min(heal.target.maxHp - heal.target.hp, heal.amount);
    if (applied <= 0) {
      outcomes[heal.owner]!.push({ actionId: heal.action.id, type: 'heal', owner: heal.owner, status: 'fizzled', reason: 'already_healthy' });
      appendEvent(game, bus, 'action_failed', {
        owner: heal.owner, actionId: heal.action.id, type: 'heal', reason: 'already_healthy',
        supportId: heal.action.supportId, targetId: heal.action.targetId, roundNumber,
        actionsUsed: actionsUsedOf(heal.owner, heal.action),
      });
      continue;
    }
    heal.target.hp += applied;
    addActionMerit(game, heal.owner, effectActionMerit(applied));
    appendEvent(game, bus, 'heal', {
      owner: heal.owner, supportId: heal.support.id, targetId: heal.target.id,
      amount: applied, targetHp: heal.target.hp,
      actionsUsed: actionsUsedOf(heal.owner, heal.action), actionsRemaining: remaining(actionsUsedOf(heal.owner, heal.action)), roundNumber,
    });
    outcomes[heal.owner]!.push({ actionId: heal.action.id, type: 'heal', owner: heal.owner, status: 'executed', detail: { amount: applied, targetId: heal.target.id } });
  }

  const deaths: { kind: 'unit' | 'headquarters'; entity: Unit | Headquarters; killer: PlayerId }[] = [];
  const recordedDeaths = new Set<string>();
  for (const strike of strikes) {
    const action = strike.action;
    const used = actionsUsedOf(strike.owner, action);
    if (!strike.hit) {
      appendEvent(game, bus, 'attack', {
        owner: strike.owner, attackerId: strike.attacker.id,
        q: strike.q, r: strike.r, hit: false,
        targetId: null, targetKind: null, damage: 0, actualDamage: 0,
        actionsUsed: used, actionsRemaining: remaining(used), roundNumber,
      });
      outcomes[strike.owner]!.push({ actionId: action.id, type: 'attack', owner: strike.owner, status: 'missed', detail: { q: strike.q, r: strike.r } });
      continue;
    }
    const entity = strike.targetKind === 'unit'
      ? game.units.find(u => u.id === strike.targetId)
      : Object.values(game.headquarters).find(h => h.id === strike.targetId);
    if (!entity) {
      recordFailure(strike.owner, action, 'target_gone', { q: strike.q, r: strike.r });
      continue;
    }
    const damage = computeDamage(game, strike.attacker.attack, strike.defense);
    const actualDamage = Math.min(entity.hp, damage);
    entity.hp = Math.max(0, entity.hp - damage);
    if (strike.targetKind === 'headquarters') {
      const stats = game.players[strike.owner]?.stats;
      if (stats) stats.headquartersDamage += actualDamage;
    }
    addActionMerit(game, strike.owner, effectActionMerit(actualDamage));
    appendEvent(game, bus, 'attack', {
      owner: strike.owner, attackerId: strike.attacker.id,
      q: strike.q, r: strike.r, hit: true,
      targetId: entity.id, targetKind: strike.targetKind,
      damage, actualDamage, targetHp: entity.hp,
      actionsUsed: used, actionsRemaining: remaining(used), roundNumber,
    });
    outcomes[strike.owner]!.push({
      actionId: action.id, type: 'attack', owner: strike.owner, status: 'executed',
      detail: { q: strike.q, r: strike.r, targetId: entity.id, damage, actualDamage, killed: entity.hp === 0 },
    });
    if (entity.hp === 0 && !recordedDeaths.has(entity.id)) {
      recordedDeaths.add(entity.id);
      deaths.push({ kind: strike.targetKind!, entity, killer: strike.owner });
    }
  }

  // 3e. 死亡与淘汰：所有伤害已施加完毕，同回合互杀成立；攻击者阵亡不影响其炮弹。
  for (const death of deaths) {
    if (death.kind === 'unit') {
      const unit = death.entity as Unit;
      unit.alive = false;
      const stats = game.players[death.killer]?.stats;
      if (stats) stats.unitsDestroyed += 1;
      appendEvent(game, bus, 'unit_death', {
        unitId: unit.id, owner: unit.owner, type: unit.type, q: unit.q, r: unit.r, cause: 'attack',
      });
    } else {
      const hq = death.entity as Headquarters;
      hq.alive = false;
      appendEvent(game, bus, 'headquarters_destroyed', {
        headquartersId: hq.id, owner: hq.owner, q: hq.q, r: hq.r,
      });
      markPlayerEliminated(game, bus, hq.owner, 'headquarters_destroyed', death.killer);
    }
  }

  const finish = (gameOver: boolean): void => {
    appendEvent(game, bus, 'round_end', { roundNumber, gameOver });
    appendEvent(game, bus, 'round_resolved', { roundNumber, gameOver, results: outcomes });
  };

  // 多家总部同回合被摧毁 → 可能直接终局或同归于尽。
  if (game.phase === 'game_over') {
    finish(true);
    return;
  }
  const activeAfterDeaths = activePlayerIds(game);
  if (activeAfterDeaths.length === 0) {
    endGame(game, bus, null, 'mutual_annihilation');
    finish(true);
    return;
  }
  if (activeAfterDeaths.length === 1) {
    endGame(game, bus, activeAfterDeaths[0]!, 'last_player_standing');
    finish(true);
    return;
  }

  // ---------------------------------------------------------------- 阶段四：占点
  for (const id of activePlayerIds(game)) {
    captureControlPoints(game, bus, id);
  }

  // ---------------------------------------------------------------- 阶段五回合边界
  appendEvent(game, bus, 'round_end', { roundNumber, gameOver: false });
  const adjudicated = adjudicateAtTurnLimit(game, bus);
  appendEvent(game, bus, 'round_resolved', { roundNumber, gameOver: adjudicated, results: outcomes });
  if (adjudicated) return;

  grantComebackSupplies(game, bus);
  game.turn.roundNumber += 1;
  game.turn.turnNumber = game.turn.roundNumber;
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
