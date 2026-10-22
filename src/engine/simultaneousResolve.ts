// src/engine/simultaneousResolve.ts
// 同时回合模式的分步结算器。
//
// 队列数组顺序就是行动点顺序：第 k 步只结算每名玩家队列的第 k 条，所有玩家的
// 第 k 条同时结算完之后才进入第 k+1 步。每一步内部按固定子阶段执行：
//   1. 级联预检（单位前一步硬失败 → 后续动作作废）；
//   2. 部署 / 移动的"到达"判定（同一步先算移出、再算移入，允许交换与链式腾格）；
//   3. 爆破（地形从下一步起生效）；
//   4. 攻击 / 治疗（按本步移动后的实际位置；先治疗后扣伤，净 HP 等价同时）；
//   5. 死亡 / 淘汰（含歼灭模式的兵力打光淘汰）。
//
// 目的格/地形/占用等动态条件全部在这一层判定；计划期只做结构性校验。
import type {
  GameState, GameOverReason, Headquarters, PendingAction, PlayerId, PlayerRecord, Position, Unit,
} from '../types.js';
import { isAnnihilationMode } from '../types.js';
import type { EventBus } from '../events/bus.js';
import { appendEvent } from './events.js';
import { hexDistance, hexKey } from './hex.js';
import { computeDamage } from './combat.js';
import { getCellOccupant, getTerrain, isInBounds } from './validation.js';
import { getGameIndex } from './gameIndex.js';
import { createUnitFromConfig } from '../state/store.js';
import { deployDiscountForOrigin } from './controlPoints.js';
import { activePlayerIds, creditKill, markPlayerEliminated } from './engine.js';
import { coveredCellsFor } from './planning.js';
import type { ShapeAim } from './planning.js';
import { isArtilleryDanger } from './artillery.js';
import { nextGameRandom } from './random.js';

export interface PlanOutcome {
  actionId: string;
  type: PendingAction['type'];
  owner: PlayerId;
  /** 该动作所在的行动点序号（1 起），与事件 payload.step / actionsUsed 一致。 */
  step: number;
  status: 'executed' | 'failed' | 'missed' | 'fizzled';
  /** 动作绑定的单位；deploy / wait 在失败时尚无单位，因此可能缺省。 */
  unitId?: string;
  reason?: string;
  detail?: Record<string, unknown>;
}

export interface StepResolution {
  outcomes: PlayerRecord<PlanOutcome[]>;
  /** 实际结算到的最后一步（队列全空时为 0）。 */
  steps: number;
  /** 本步结算导致终局时的结果；调用方负责先补 round_end / round_resolved 再 game_over。 */
  ending: { winner: PlayerId | null; reason: GameOverReason } | null;
}

export interface QueuedAction {
  owner: PlayerId;
  action: PendingAction;
  /** 1 起的行动点序号。 */
  step: number;
}

type Occupant =
  | { kind: 'unit'; entity: Unit }
  | { kind: 'headquarters'; entity: Headquarters };

interface ResolveContext {
  game: GameState;
  bus: EventBus;
  roundNumber: number;
  order: PlayerId[];
  queues: Map<PlayerId, PendingAction[]>;
  outcomes: PlayerRecord<PlanOutcome[]>;
  limit: number;
  /** 本轮已经硬失败的单位：后续行动点直接作废。 */
  failedUnits: Set<string>;
  /** 每单位每轮最多攻击次数（地图 balance.attacksPerUnit，缺省 1）。 */
  attackLimit: number;
  /** 本轮各单位已结算的攻击次数（含失败/落空）。 */
  attackCounts: Map<string, number>;
  /** 计划时刻（回合开始）各单位站位：锁定射击据此判定"计划时点击格上的敌人"。 */
  planTimePositions: { unit: Unit; q: number; r: number }[];
}

function resolveWaits(ctx: ResolveContext, stepActions: QueuedAction[]): void {
  for (const item of stepActions) {
    if (item.action.type !== 'wait') continue;
    chargeActionPoint(ctx.game, item.owner);
    appendEvent(ctx.game, ctx.bus, 'wait', {
      owner: item.owner,
      actionId: item.action.id,
      roundNumber: ctx.roundNumber,
      step: item.step,
      actionsUsed: item.step,
      actionsRemaining: remaining(ctx.limit, item.step),
    });
    recordExecuted(ctx, item);
  }
}

function actionUnitId(action: PendingAction): string | undefined {
  return action.unitId ?? action.attackerId ?? action.supportId;
}

function remaining(limit: number, used: number): number {
  return Math.max(0, limit - used);
}

function chargeActionPoint(game: GameState, owner: PlayerId): void {
  const stats = game.players[owner]?.stats;
  if (stats) stats.actionPointsUsed = (stats.actionPointsUsed ?? 0) + 1;
}

/** 失败/落空动作的归属信息：单位、兵种、起点/目标格。 */
function actionDetail(game: GameState, action: PendingAction): Record<string, unknown> {
  const unitId = actionUnitId(action);
  const unit = unitId ? getGameIndex(game).unitById.get(unitId) : undefined;
  const detail: Record<string, unknown> = {};
  if (unitId) detail.unitId = unitId;
  if (action.type === 'deploy') {
    if (action.unitType) detail.unitType = action.unitType;
    if (action.fromId) detail.fromId = action.fromId;
  } else if (unit) {
    detail.unitType = unit.type;
  }
  if (unit) {
    detail.fromQ = unit.q;
    detail.fromR = unit.r;
  }
  if (typeof action.q === 'number') detail.q = action.q;
  if (typeof action.r === 'number') detail.r = action.r;
  if (typeof action.direction === 'number') detail.direction = action.direction;
  return detail;
}

function recordFailure(
  ctx: ResolveContext,
  item: QueuedAction,
  reason: string,
  extra: Record<string, unknown> = {},
): void {
  const { game, bus, roundNumber } = ctx;
  const { owner, action, step } = item;
  const unitId = actionUnitId(action);
  const unit = unitId ? getGameIndex(game).unitById.get(unitId) : undefined;
  const unitType = action.type === 'deploy' ? action.unitType : unit?.type;
  const detail = { ...actionDetail(game, action), ...extra };
  ctx.outcomes[owner]!.push({
    actionId: action.id,
    type: action.type,
    owner,
    step,
    status: 'failed',
    reason,
    ...(unitId ? { unitId } : {}),
    detail,
  });
  appendEvent(game, bus, 'action_failed', {
    owner,
    actionId: action.id,
    type: action.type,
    reason,
    roundNumber,
    step,
    ...(unitId ? { unitId } : {}),
    ...(unitType ? { unitType } : {}),
    ...(action.type === 'deploy' && action.fromId ? { fromId: action.fromId } : {}),
    detail,
    ...extra,
    actionsUsed: step,
  });
}

function recordExecuted(
  ctx: ResolveContext,
  item: QueuedAction,
  detail?: Record<string, unknown>,
  unitId?: string,
): void {
  const boundUnitId = unitId ?? actionUnitId(item.action);
  ctx.outcomes[item.owner]!.push({
    actionId: item.action.id,
    type: item.action.type,
    owner: item.owner,
    step: item.step,
    status: 'executed',
    ...(boundUnitId ? { unitId: boundUnitId } : {}),
    ...(detail ? { detail } : {}),
  });
}

/** 建立一步开始时的单位/总部占位快照（后续移动不会影响判定）。 */
function captureOccupants(game: GameState): Map<string, Occupant> {
  const occupants = new Map<string, Occupant>();
  for (const unit of game.units) {
    if (!unit.alive) continue;
    const key = hexKey(unit);
    if (!occupants.has(key)) occupants.set(key, { kind: 'unit', entity: unit });
  }
  for (const hq of Object.values(game.headquarters)) {
    if (!hq.alive) continue;
    const key = hexKey(hq);
    if (!occupants.has(key)) occupants.set(key, { kind: 'headquarters', entity: hq });
  }
  return occupants;
}

interface Arrival {
  item: QueuedAction;
  to: Position;
  unit?: Unit;
}

/**
 * 同一步的到达判定：所有 move/deploy 同时到达，目的地冲突全员失败；目的格按
 * "本步所有成功移出的单位都离开后"的占用情况判定。若依赖的移出失败，依赖者
 * 也失败（迭代到稳定），因此链式腾格与交换可以成功，失败会沿依赖链传播。
 */
function solveArrivals(
  ctx: ResolveContext,
  stepActions: QueuedAction[],
  occupants: Map<string, Occupant>,
): Map<string, string> {
  const arrivals: Arrival[] = [];
  for (const item of stepActions) {
    const { action } = item;
    if (action.type !== 'move' && action.type !== 'deploy') continue;
    if (typeof action.q !== 'number' || typeof action.r !== 'number') continue;
    const unit = action.type === 'move' && action.unitId
      ? getGameIndex(ctx.game).unitById.get(action.unitId)
      : undefined;
    arrivals.push({ item, to: { q: action.q, r: action.r }, ...(unit ? { unit } : {}) });
  }

  const byCell = new Map<string, Arrival[]>();
  for (const arrival of arrivals) {
    const key = hexKey(arrival.to);
    const list = byCell.get(key);
    if (list) list.push(arrival);
    else byCell.set(key, [arrival]);
  }

  const moverByUnit = new Map<string, string>();
  for (const arrival of arrivals) {
    if (arrival.item.action.type === 'move' && arrival.item.action.unitId) {
      moverByUnit.set(arrival.item.action.unitId, arrival.item.action.id);
    }
  }

  const failed = new Map<string, string>();
  for (const [key, list] of byCell) {
    if (list.length > 1) {
      for (const arrival of list) failed.set(arrival.item.action.id, 'destination_conflict');
      continue;
    }
    const arrival = list[0]!;
    const { q, r } = arrival.to;
    if (!isInBounds(ctx.game, q, r) || getTerrain(ctx.game, q, r) !== 'plain') {
      failed.set(arrival.item.action.id, 'destination_blocked');
      continue;
    }
    const occupant = occupants.get(key);
    if (!occupant) continue;
    if (occupant.kind === 'headquarters') {
      failed.set(arrival.item.action.id, 'destination_occupied');
      continue;
    }
    // 目标格上的单位本步不移动 → 仍占用；本步移动的依赖关系在下一轮迭代处理。
    if (!moverByUnit.has(occupant.entity.id)) {
      failed.set(arrival.item.action.id, 'destination_occupied');
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const arrival of arrivals) {
      if (failed.has(arrival.item.action.id)) continue;
      const occupant = occupants.get(hexKey(arrival.to));
      if (!occupant || occupant.kind !== 'unit') continue;
      const dependency = moverByUnit.get(occupant.entity.id);
      if (dependency && failed.has(dependency)) {
        failed.set(arrival.item.action.id, 'destination_occupied');
        changed = true;
      }
    }
  }
  return failed;
}

/** 计划期玩家被淘汰后，剩余队列不再产生结果。 */
function activeAtStep(ctx: ResolveContext, step: number): QueuedAction[] {
  const actions: QueuedAction[] = [];
  for (const owner of ctx.order) {
    if (ctx.game.players[owner]?.status !== 'active') continue;
    const action = ctx.queues.get(owner)?.[step - 1];
    if (action) actions.push({ owner, action, step });
  }
  return actions;
}

function precheckCascade(ctx: ResolveContext, stepActions: QueuedAction[]): QueuedAction[] {
  const kept: QueuedAction[] = [];
  for (const item of stepActions) {
    const unitId = actionUnitId(item.action);
    if (!unitId) {
      kept.push(item);
      continue;
    }
    const unit = getGameIndex(ctx.game).unitById.get(unitId);
    if (!unit || !unit.alive) {
      chargeActionPoint(ctx.game, item.owner);
      recordFailure(ctx, item, 'unit_gone');
      ctx.failedUnits.add(unitId);
      continue;
    }
    if (ctx.failedUnits.has(unitId)) {
      chargeActionPoint(ctx.game, item.owner);
      recordFailure(ctx, item, 'previous_action_failed');
      continue;
    }
    kept.push(item);
  }
  return kept;
}

function resolveDeploys(
  ctx: ResolveContext,
  stepActions: QueuedAction[],
  failedArrivals: Map<string, string>,
): void {
  const { game, bus, roundNumber } = ctx;
  for (const item of stepActions) {
    if (item.action.type !== 'deploy') continue;
    chargeActionPoint(game, item.owner);
    const failure = failedArrivals.get(item.action.id);
    if (failure) {
      recordFailure(ctx, item, failure, {
        q: item.action.q,
        r: item.action.r,
      });
      continue;
    }
    const spec = game.config.units[item.action.unitType!];
    const discount = Math.min(spec.cost, deployDiscountForOrigin(game, item.owner, item.action.fromId!));
    const cost = spec.cost - discount;
    const resources = game.resources[item.owner];
    if (!resources || resources.supplies < cost) {
      recordFailure(ctx, item, 'insufficient_supplies', { q: item.action.q, r: item.action.r });
      continue;
    }
    resources.supplies -= cost;
    const unit = createUnitFromConfig(
      game.config,
      item.owner,
      item.action.unitType!,
      item.action.q!,
      item.action.r!,
    );
    unit.hasMoved = true;
    unit.hasActed = false;
    unit.actionSpent = true;
    game.units.push(unit);
    appendEvent(game, bus, 'deploy', {
      actionId: item.action.id,
      unitId: unit.id, owner: item.owner, unitType: item.action.unitType, fromId: item.action.fromId,
      q: item.action.q, r: item.action.r, cost, unitCost: spec.cost, discount,
      hp: unit.hp, attack: unit.attack, defense: unit.defense,
      moveRange: unit.moveRange, attackRange: unit.attackRange,
      canCapture: unit.canCapture, healPower: unit.healPower,
      actionsUsed: item.step, actionsRemaining: remaining(ctx.limit, item.step),
      roundNumber, step: item.step,
    });
    recordExecuted(ctx, item, { unitId: unit.id, cost }, unit.id);
  }
}

function resolveMoves(
  ctx: ResolveContext,
  stepActions: QueuedAction[],
  failedArrivals: Map<string, string>,
): void {
  const { game, bus, roundNumber } = ctx;
  for (const item of stepActions) {
    if (item.action.type !== 'move') continue;
    chargeActionPoint(game, item.owner);
    const unitId = item.action.unitId!;
    const unit = getGameIndex(game).unitById.get(unitId);
    if (!unit || unit.owner !== item.owner || !unit.alive) {
      recordFailure(ctx, item, 'unit_gone');
      ctx.failedUnits.add(unitId);
      continue;
    }
    const failure = failedArrivals.get(item.action.id);
    if (failure) {
      recordFailure(ctx, item, failure, { q: item.action.q, r: item.action.r });
      ctx.failedUnits.add(unitId);
      continue;
    }
    const fromQ = unit.q;
    const fromR = unit.r;
    unit.q = item.action.q!;
    unit.r = item.action.r!;
    unit.hasMoved = true;
    appendEvent(game, bus, 'move', {
      actionId: item.action.id,
      unitId: unit.id, owner: item.owner, fromQ, fromR, toQ: unit.q, toR: unit.r,
      actionsUsed: item.step, actionsRemaining: remaining(ctx.limit, item.step),
      roundNumber, step: item.step,
    });
    recordExecuted(ctx, item, { fromQ, fromR, toQ: unit.q, toR: unit.r });
  }
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

function resolveDemolishes(ctx: ResolveContext, stepActions: QueuedAction[]): void {
  const { game, bus, roundNumber } = ctx;
  const clearedThisStep = new Set<string>();
  for (const item of stepActions) {
    if (item.action.type !== 'demolish') continue;
    chargeActionPoint(game, item.owner);
    const unitId = item.action.unitId!;
    const unit = getGameIndex(game).unitById.get(unitId);
    if (!unit || unit.owner !== item.owner || !unit.alive) {
      recordFailure(ctx, item, 'unit_gone');
      ctx.failedUnits.add(unitId);
      continue;
    }
    const targetKey = hexKey({ q: item.action.q!, r: item.action.r! });
    if (unit.type !== 'heavy'
      || hexDistance(unit, { q: item.action.q!, r: item.action.r! }) > 1
      || !isInBounds(game, item.action.q!, item.action.r!)
      || getTerrain(game, item.action.q!, item.action.r!) !== 'blocker'
      || clearedThisStep.has(targetKey)
      || getCellOccupant(game, item.action.q!, item.action.r!) !== null) {
      recordFailure(ctx, item, 'invalid_target', { q: item.action.q, r: item.action.r });
      ctx.failedUnits.add(unitId);
      continue;
    }
    setTerrainPlain(game, item.action.q!, item.action.r!);
    clearedThisStep.add(targetKey);
    unit.hasActed = true;
    appendEvent(game, bus, 'demolish', {
      actionId: item.action.id,
      unitId: unit.id, owner: item.owner, q: item.action.q, r: item.action.r,
      fromTerrain: 'blocker', toTerrain: 'plain',
      actionsUsed: item.step, actionsRemaining: remaining(ctx.limit, item.step),
      roundNumber, step: item.step,
    });
    recordExecuted(ctx, item, { q: item.action.q, r: item.action.r });
  }
}

interface Strike {
  item: QueuedAction;
  attacker: Unit;
  aim: ShapeAim;
  lockedEntity?: Unit;
}

function rollHeal(game: GameState, support: Unit): number {
  const base = support.healPower ?? 0;
  return base + Math.floor(nextGameRandom(game) * (game.config.balance.healVarianceRange + 1));
}

function resolveAttacksAndHeals(ctx: ResolveContext, stepActions: QueuedAction[], step: number): void {
  const { game, bus, roundNumber } = ctx;

  // 攻击：形状由地图配置推导（single 单格 / line 定向直线 / arc 定向三格扇形）；
  // 锁定兵种（attackLock）在计划时点击格上站着敌人则锁定该单位。
  const strikes: Strike[] = [];
  for (const item of stepActions) {
    if (item.action.type !== 'attack') continue;
    chargeActionPoint(game, item.owner);
    const attacker = getGameIndex(game).unitById.get(item.action.attackerId!);
    if (!attacker || attacker.owner !== item.owner || !attacker.alive) {
      recordFailure(ctx, item, 'unit_gone');
      ctx.failedUnits.add(item.action.attackerId!);
      continue;
    }
    const attacksUsed = ctx.attackCounts.get(attacker.id) ?? 0;
    if (attacksUsed >= ctx.attackLimit) {
      // 兜底旧存档/旧计划：新计划在入队与重排校验时已经拦截超限攻击。
      recordFailure(ctx, item, 'attack_limit_reached');
      ctx.failedUnits.add(attacker.id);
      continue;
    }
    ctx.attackCounts.set(attacker.id, attacksUsed + 1);
    const spec = game.config.units[attacker.type];
    const aim = coveredCellsFor(
      attacker,
      spec,
      'attackShape',
      { q: item.action.q!, r: item.action.r! },
      attacker.attackRange,
    );
    if (!aim) {
      recordFailure(ctx, item, 'out_of_range', { q: item.action.q, r: item.action.r });
      ctx.failedUnits.add(item.action.attackerId!);
      continue;
    }
    attacker.hasActed = true;
    const strike: Strike = { item, attacker, aim };
    if (spec?.attackLock) {
      const locked = ctx.planTimePositions.find(entry =>
        entry.unit.owner !== item.owner && entry.q === item.action.q && entry.r === item.action.r);
      if (locked) strike.lockedEntity = locked.unit;
    }
    strikes.push(strike);
  }

  // 治疗：覆盖形状与攻击同构；目标按本步移动后的最终站位判定。
  interface Heal { item: QueuedAction; support: Unit; aim: ShapeAim; }
  const heals: Heal[] = [];
  const recordHealFizzle = (item: QueuedAction, reason: string): void => {
    const { owner, action, step } = item;
    const unitId = action.supportId;
    const detail = actionDetail(game, action);
    const unitType = detail.unitType;
    ctx.outcomes[owner]!.push({
      actionId: action.id, type: 'heal', owner, step, status: 'fizzled', reason,
      ...(unitId ? { unitId } : {}),
      detail,
    });
    appendEvent(game, bus, 'action_failed', {
      owner, actionId: action.id, type: 'heal', reason, roundNumber, step,
      ...(unitId ? { unitId } : {}),
      ...(typeof unitType === 'string' ? { unitType } : {}),
      supportId: action.supportId, detail,
      q: action.q, r: action.r,
      actionsUsed: step,
    });
  };
  for (const item of stepActions) {
    if (item.action.type !== 'heal') continue;
    chargeActionPoint(game, item.owner);
    const support = getGameIndex(game).unitById.get(item.action.supportId!);
    if (!support || support.owner !== item.owner || !support.alive || support.type !== 'support') {
      recordHealFizzle(item, 'out_of_range');
      continue;
    }
    const aim = coveredCellsFor(
      support,
      game.config.units[support.type],
      'healShape',
      { q: item.action.q!, r: item.action.r! },
      game.config.units[support.type]?.healRange ?? support.attackRange,
    );
    if (!aim) {
      recordHealFizzle(item, 'out_of_range');
      continue;
    }
    if (isArtilleryDanger(game, support)
      || aim.cells.some(cell => isInBounds(game, cell.q, cell.r) && isArtilleryDanger(game, cell))) {
      recordHealFizzle(item, 'artillery_zone');
      continue;
    }
    support.hasActed = true;
    heals.push({ item, support, aim });
  }

  // 先施放全部治疗（按最终站位、覆盖格内所有受伤友军各自掷量，上限截断），
  // 再按行动顺序施加伤害——数学上等价于同时结算，且击杀归属确定。
  for (const heal of heals) {
    const targets = heal.aim.cells
      .map(cell => game.units.find(u => u.alive && u.owner === heal.item.owner && u.q === cell.q && u.r === cell.r))
      .filter((u): u is Unit => Boolean(u));
    const appliedList: { target: Unit; amount: number }[] = [];
    for (const target of targets) {
      if (target.hp >= target.maxHp) continue;
      const applied = Math.min(target.maxHp - target.hp, rollHeal(game, heal.support));
      if (applied > 0) appliedList.push({ target, amount: applied });
    }
    if (appliedList.length === 0) {
      recordHealFizzle(heal.item, targets.length > 0 ? 'already_healthy' : 'out_of_range');
      continue;
    }
    for (const { target, amount: applied } of appliedList) {
      target.hp += applied;
      appendEvent(game, bus, 'heal', {
        actionId: heal.item.action.id,
        owner: heal.item.owner, supportId: heal.support.id, targetId: target.id,
        amount: applied, targetHp: target.hp,
        actionsUsed: heal.item.step, actionsRemaining: remaining(ctx.limit, heal.item.step),
        roundNumber, step: heal.item.step,
      });
    }
    recordExecuted(ctx, heal.item, {
      supportId: heal.support.id,
      targets: appliedList.map(({ target, amount }) => ({ targetId: target.id, amount })),
    });
  }

  const deaths: { kind: 'unit' | 'headquarters'; entity: Unit | Headquarters; killer: PlayerId }[] = [];
  const recordedDeaths = new Set<string>();
  for (const strike of strikes) {
    const { item } = strike;
    const action = item.action;
    const spec = game.config.units[strike.attacker.type];
    const targets: { kind: 'unit' | 'headquarters'; entity: Unit | Headquarters; defense: number }[] = [];
    let escapedLock = false;
    if (strike.lockedEntity) {
      // 锁定射击：目标只要没逃出攻击者的射程，跑到哪里都命中。
      const entity = strike.lockedEntity;
      if (entity.alive && hexDistance(strike.attacker, entity) <= strike.attacker.attackRange) {
        targets.push({ kind: 'unit', entity, defense: entity.defense });
      } else {
        escapedLock = true;
      }
    } else {
      for (const cell of strike.aim.cells) {
        const occupant = getCellOccupant(game, cell.q, cell.r);
        if (occupant !== null && occupant.entity.owner !== item.owner) {
          targets.push({ kind: occupant.kind, entity: occupant.entity, defense: occupant.entity.defense });
        }
      }
    }
    if (targets.length === 0) {
      appendEvent(game, bus, 'attack', {
        actionId: action.id,
        owner: item.owner, attackerId: strike.attacker.id,
        q: action.q, r: action.r, hit: false,
        aimQ: action.q, aimR: action.r,
        shape: strike.aim.type,
        locked: Boolean(strike.lockedEntity),
        targetId: strike.lockedEntity ? strike.lockedEntity.id : null,
        targetKind: null, damage: 0, actualDamage: 0,
        actionsUsed: item.step, actionsRemaining: remaining(ctx.limit, item.step),
        roundNumber, step: item.step,
      });
      ctx.outcomes[item.owner]!.push({
        actionId: action.id, type: 'attack', owner: item.owner, step: item.step, status: 'missed',
        unitId: strike.attacker.id,
        reason: escapedLock ? 'target_escaped' : undefined,
        detail: {
          attackerId: strike.attacker.id,
          q: action.q, r: action.r, shape: strike.aim.type, locked: Boolean(strike.lockedEntity),
        },
      });
      continue;
    }
    const hitDetails: Record<string, unknown>[] = [];
    for (const target of targets) {
      const entity = target.entity;
      const damage = computeDamage(game, strike.attacker.attack, target.defense);
      const actualDamage = Math.min(entity.hp, damage);
      entity.hp = Math.max(0, entity.hp - damage);
      if (target.kind === 'headquarters') {
        const stats = game.players[item.owner]?.stats;
        if (stats) stats.headquartersDamage += actualDamage;
      }
      appendEvent(game, bus, 'attack', {
        actionId: action.id,
        owner: item.owner, attackerId: strike.attacker.id,
        q: entity.q, r: entity.r, hit: true,
        aimQ: action.q, aimR: action.r,
        shape: strike.aim.type,
        locked: Boolean(strike.lockedEntity),
        targetId: entity.id, targetKind: target.kind,
        damage, actualDamage, targetHp: entity.hp,
        actionsUsed: item.step, actionsRemaining: remaining(ctx.limit, item.step),
        roundNumber, step: item.step,
      });
      hitDetails.push({ targetId: entity.id, kind: target.kind, damage, actualDamage, killed: entity.hp === 0 });
      if (entity.hp === 0 && !recordedDeaths.has(entity.id)) {
        recordedDeaths.add(entity.id);
        deaths.push({ kind: target.kind, entity, killer: item.owner });
        // 击杀入账必须在死亡阶段之前完成：死亡阶段里 HQ 被摧毁会立刻冻结该玩家
        // 的分数并移出单位，如果之后才处理它同轮打出的击杀，creditKill 会因
        // 玩家已非 active 而漏记，且结果随 turnOrder（先处理哪条 death）漂移。
        if (target.kind === 'unit') {
          const killerStats = game.players[item.owner]?.stats;
          if (killerStats) killerStats.unitsDestroyed += 1;
          creditKill(game, item.owner, entity as Unit);
        }
      }
    }
    ctx.outcomes[item.owner]!.push({
      actionId: action.id, type: 'attack', owner: item.owner, step: item.step, status: 'executed',
      unitId: strike.attacker.id,
      detail: {
        attackerId: strike.attacker.id,
        q: action.q, r: action.r, shape: strike.aim.type, locked: Boolean(strike.lockedEntity), hits: hitDetails,
      },
    });
  }

  // 死亡与淘汰：所有伤害已施加完毕，同一步互杀成立；攻击者阵亡不影响其炮弹。
  for (const death of deaths) {
    if (death.kind === 'unit') {
      const unit = death.entity as Unit;
      unit.alive = false;
      appendEvent(game, bus, 'unit_death', {
        unitId: unit.id, owner: unit.owner, type: unit.type, q: unit.q, r: unit.r, cause: 'attack',
        step,
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

  // 歼灭规则（annihilation/royale）没有总部兜底：兵力打光的玩家立即淘汰，
  // 击杀归属取其本步阵亡单位的凶手；终局交给调用方的 active 检查。
  if (isAnnihilationMode(game.config.mode)) {
    const killedBy = new Map<PlayerId, PlayerId>();
    for (const death of deaths) {
      if (death.kind === 'unit') killedBy.set((death.entity as Unit).owner, death.killer);
    }
    for (const owner of activePlayerIds(game)) {
      if (game.units.some(unit => unit.owner === owner && unit.alive)) continue;
      markPlayerEliminated(game, bus, owner, 'army_destroyed', killedBy.get(owner) ?? null);
    }
  }
}

function endingFor(game: GameState): { winner: PlayerId | null; reason: GameOverReason } | null {
  const active = activePlayerIds(game);
  if (active.length === 0) return { winner: null, reason: 'mutual_annihilation' };
  if (active.length === 1) return { winner: active[0]!, reason: 'last_player_standing' };
  return null;
}

export function resolveRoundSteps(
  game: GameState,
  bus: EventBus,
  order: PlayerId[],
  queues: Map<PlayerId, PendingAction[]>,
): StepResolution {
  const outcomes: PlayerRecord<PlanOutcome[]> = {};
  for (const id of order) outcomes[id] = [];
  let maxSteps = 0;
  for (const id of order) maxSteps = Math.max(maxSteps, queues.get(id)?.length ?? 0);

  const ctx: ResolveContext = {
    game,
    bus,
    roundNumber: game.turn.roundNumber,
    order,
    queues,
    outcomes,
    limit: game.config.balance.actionsPerTurn,
    failedUnits: new Set<string>(),
    attackLimit: game.config.balance.attacksPerUnit ?? 1,
    attackCounts: new Map<string, number>(),
    planTimePositions: game.units
      .filter(unit => unit.alive)
      .map(unit => ({ unit, q: unit.q, r: unit.r })),
  };

  let steps = 0;
  let ending: StepResolution['ending'] = null;
  for (let step = 1; step <= maxSteps; step++) {
    if (game.phase === 'game_over') break;
    const stepActions = activeAtStep(ctx, step);
    if (stepActions.length === 0) continue;
    steps = step;

    const kept = precheckCascade(ctx, stepActions);
    const occupants = captureOccupants(game);
    const failedArrivals = solveArrivals(ctx, kept, occupants);
    resolveDeploys(ctx, kept, failedArrivals);
    resolveMoves(ctx, kept, failedArrivals);
    resolveDemolishes(ctx, kept);
    resolveWaits(ctx, kept);
    resolveAttacksAndHeals(ctx, kept, step);

    ending = endingFor(game);
    if (ending) break;
  }

  return { outcomes, steps, ending };
}
