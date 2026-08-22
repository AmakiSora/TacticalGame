// src/engine/planning.ts
// simultaneous 模式的计划阶段：玩家把动作"入队不执行"，全部玩家确认后由
// simultaneous.ts 统一同时结算。所有校验针对计划时刻的棋盘（结算前棋盘不会变化）。
import { randomUUID } from 'node:crypto';
import type { GameState, PendingAction, PlayerId, Position, UnitType } from '../types.js';
import type { EventBus } from '../events/bus.js';
import type { Result, Failure } from './result.js';
import { appendEvent } from './events.js';
import { hexDistance, HEX_DIRECTIONS } from './hex.js';
import { findReachableCells, isDeployable, isInBounds, getCellOccupant, getTerrain } from './validation.js';
import { deployDiscountForOrigin } from './controlPoints.js';
import { isArtilleryDanger } from './artillery.js';
import type { UnitSpec } from '../config/loader.js';

export function isSimultaneous(game: GameState): boolean {
  return game.config.mode === 'simultaneous';
}

type Plan = NonNullable<GameState['plan']>;

function plan(game: GameState): Result<Plan> {
  if (!isSimultaneous(game)) {
    return { ok: false, code: 'not_simultaneous_game', message: 'game is not in simultaneous mode' };
  }
  if (!game.plan) game.plan = { queues: {}, committed: [] };
  return { ok: true, data: game.plan };
}

/** 计划期通用门槛：模式正确、对局进行中、玩家存活；默认还要求尚未确认。 */
function requirePlanning(game: GameState, owner: PlayerId, options: { allowCommitted?: boolean } = {}): Result<Plan> {
  const resolved = plan(game);
  if (!resolved.ok) return resolved;
  if (game.phase === 'game_over') return { ok: false, code: 'game_over', message: 'game has ended' };
  if (game.phase !== 'active') return { ok: false, code: 'game_not_started', message: 'game not in play' };
  if (game.players[owner]?.status !== 'active') {
    return { ok: false, code: 'player_eliminated', message: 'player eliminated' };
  }
  if (!options.allowCommitted && game.plan!.committed.includes(owner)) {
    return { ok: false, code: 'not_your_turn', message: 'plan already committed this round' };
  }
  return { ok: true, data: game.plan! };
}

function queueOf(game: GameState, owner: PlayerId): PendingAction[] {
  if (!game.plan) game.plan = { queues: {}, committed: [] };
  if (!game.plan.queues[owner]) game.plan.queues[owner] = [];
  return game.plan.queues[owner]!;
}

/** 该单位是否已有排队的动作（每单位每回合仅一个动作）。 */
function unitAlreadyPlanned(queue: PendingAction[], unitId: string): boolean {
  return queue.some(action =>
    action.unitId === unitId || action.attackerId === unitId || action.supportId === unitId);
}

/** 自己队列里已被 deploy/move 声明的目标格——自己与自己冲突必然失败，入队时直接拒绝。 */
function claimedCells(queue: PendingAction[]): Set<string> {
  const claimed = new Set<string>();
  for (const action of queue) {
    if ((action.type === 'deploy' || action.type === 'move') && typeof action.q === 'number') {
      claimed.add(`${action.q},${action.r}`);
    }
  }
  return claimed;
}

function checkBudget(game: GameState, owner: PlayerId): Failure | null {
  // simultaneous 模式下每个排队动作恰好消耗 1 点行动点，队列长度即用量。
  const limit = game.config.balance.actionsPerTurn;
  if (queueOf(game, owner).length >= limit) {
    return { ok: false, code: 'action_limit_reached', message: `only ${limit} actions allowed per round` };
  }
  return null;
}

function findOwnUnit(game: GameState, owner: PlayerId, unitId: string) {
  return game.units.find(u => u.id === unitId && u.owner === owner && u.alive) ?? null;
}

function enqueue(game: GameState, owner: PlayerId, action: PendingAction): Result<PendingAction> {
  queueOf(game, owner).push(action);
  return { ok: true, data: action };
}

// ---------------------------------------------------------------- 形状系统
// 同时模式的兵种改造：攻击/治疗可配置覆盖形状（地图 JSON units.<type>.attackShape
// / healShape）。single = 射程内任选一格；line = 沿一个正六方向覆盖前 length 格；
// arc = 点击相邻格定向，覆盖该格及其左右相邻共 3 格。未配置默认 single。

export type ShapeType = 'single' | 'line' | 'arc';

export interface ShapeAim {
  type: ShapeType;
  /** 0-5 正六方向；single 恒 0。 */
  direction: number;
  cells: Position[];
}

export function shapeSpecFor(spec: UnitSpec | undefined, kind: 'attackShape' | 'healShape'): { type: ShapeType; length: number } {
  const shape = spec?.[kind];
  if (!shape) return { type: 'single', length: 1 };
  if (shape.type === 'line') return { type: 'line', length: shape.length ?? 2 };
  if (shape.type === 'arc') return { type: 'arc', length: 3 };
  return { type: 'single', length: 1 };
}

/**
 * 由施放者位置与点击格推导形状方向与覆盖格。瞄准不合法（超出射程、不在正六方向
 * 射线上、非相邻格等）返回 null。攻击者/支援本回合不会移动，计划与结算结果一致。
 */
export function coveredCellsFor(
  from: Position,
  spec: UnitSpec | undefined,
  kind: 'attackShape' | 'healShape',
  target: Position,
  range: number,
): ShapeAim | null {
  const shape = shapeSpecFor(spec, kind);
  const dq = target.q - from.q;
  const dr = target.r - from.r;
  if (shape.type === 'single') {
    const distance = hexDistance(from, target);
    if (distance > range) return null;
    if (kind === 'attackShape' && distance === 0) return null;
    return { type: 'single', direction: 0, cells: [{ q: target.q, r: target.r }] };
  }
  if (shape.type === 'arc') {
    if (hexDistance(from, target) !== 1) return null;
    const direction = HEX_DIRECTIONS.findIndex(d => d.q === dq && d.r === dr);
    if (direction < 0) return null;
    return {
      type: 'arc',
      direction,
      cells: [(direction + 5) % 6, direction, (direction + 1) % 6].map(index => ({
        q: from.q + HEX_DIRECTIONS[index]!.q,
        r: from.r + HEX_DIRECTIONS[index]!.r,
      })),
    };
  }
  // line：点击格必须落在某个正六方向射线上，距离 1..length。
  for (let direction = 0; direction < 6; direction++) {
    const d = HEX_DIRECTIONS[direction]!;
    const k = d.q !== 0 ? dq / d.q : dr / d.r;
    if (!Number.isInteger(k) || k < 1 || k > shape.length) continue;
    if (d.q * k !== dq || d.r * k !== dr) continue;
    const cells: Position[] = [];
    for (let step = 1; step <= shape.length; step++) {
      cells.push({ q: from.q + d.q * step, r: from.r + d.r * step });
    }
    return { type: 'line', direction, cells };
  }
  return null;
}

// ---------------------------------------------------------------- deploy

function deployOrigin(game: GameState, owner: PlayerId, fromId: string) {
  const hq = game.headquarters[owner];
  if (hq?.id === fromId && hq.alive) return hq;
  const point = game.controlPoints.find(p => p.id === fromId && p.owner === owner);
  return point ?? null;
}

function plannedDeploySpend(game: GameState, owner: PlayerId): number {
  const spec = (action: PendingAction) => game.config.units[action.unitType as UnitType];
  return queueOf(game, owner)
    .filter(action => action.type === 'deploy')
    .reduce((sum, action) => {
      const unitSpec = spec(action);
      if (!unitSpec || !action.fromId) return sum;
      const discount = Math.min(unitSpec.cost, deployDiscountForOrigin(game, owner, action.fromId));
      return sum + unitSpec.cost - discount;
    }, 0);
}

export function queueDeployAction(
  game: GameState,
  owner: PlayerId,
  unitType: UnitType,
  fromId: string,
  q: number,
  r: number,
): Result<PendingAction> {
  const ready = requirePlanning(game, owner);
  if (!ready.ok) return ready;
  const unitSpec: UnitSpec | undefined = game.config.units[unitType];
  if (!unitSpec) return { ok: false, code: 'invalid_deploy', message: 'unknown unit type' };
  const origin = deployOrigin(game, owner, fromId);
  if (!origin) return { ok: false, code: 'invalid_deploy', message: 'invalid deploy origin' };
  if (isArtilleryDanger(game, origin) || isArtilleryDanger(game, { q, r })) {
    return { ok: false, code: 'invalid_deploy', message: 'cannot deploy inside the artillery zone' };
  }
  const budget = checkBudget(game, owner);
  if (budget) return budget;
  if (hexDistance(origin, { q, r }) !== 1) {
    return { ok: false, code: 'out_of_deploy_range', message: 'deploy target must be adjacent' };
  }
  if (!isDeployable(game, q, r)) {
    return { ok: false, code: 'invalid_terrain', message: 'deploy target is not empty plain terrain' };
  }
  if (claimedCells(queueOf(game, owner)).has(`${q},${r}`)) {
    return { ok: false, code: 'cell_occupied', message: 'target already claimed by your own planned action' };
  }
  const discount = Math.min(unitSpec.cost, deployDiscountForOrigin(game, owner, fromId));
  const actualCost = unitSpec.cost - discount;
  const resources = game.resources[owner];
  if (!resources) return { ok: false, code: 'player_eliminated', message: 'player has no resources' };
  if (resources.supplies - plannedDeploySpend(game, owner) < actualCost) {
    return { ok: false, code: 'insufficient_supplies', message: `need ${actualCost} supplies` };
  }
  return enqueue(game, owner, { id: randomUUID(), type: 'deploy', unitType, fromId, q, r });
}

// ---------------------------------------------------------------- move

export function queueMoveAction(
  game: GameState,
  owner: PlayerId,
  unitId: string,
  q: number,
  r: number,
): Result<PendingAction> {
  const ready = requirePlanning(game, owner);
  if (!ready.ok) return ready;
  const unit = findOwnUnit(game, owner, unitId);
  if (!unit) return { ok: false, code: 'unit_not_found', message: 'unit not found' };
  const queue = queueOf(game, owner);
  if (unitAlreadyPlanned(queue, unitId)) {
    return { ok: false, code: 'invalid_move', message: 'unit already has a planned action this round' };
  }
  if (unit.q === q && unit.r === r) return { ok: false, code: 'invalid_move', message: 'same cell' };
  const budget = checkBudget(game, owner);
  if (budget) return budget;
  // 路径按计划时刻棋盘计算：所有单位（含敌方）都视为障碍，BFS 天然排除被占用格。
  const reachable = findReachableCells(game, unit);
  if (!reachable.some(pos => pos.q === q && pos.r === r)) {
    return { ok: false, code: 'invalid_move', message: 'target is not reachable' };
  }
  if (claimedCells(queue).has(`${q},${r}`)) {
    return { ok: false, code: 'cell_occupied', message: 'target already claimed by your own planned action' };
  }
  return enqueue(game, owner, { id: randomUUID(), type: 'move', unitId, q, r });
}

// ---------------------------------------------------------------- attack

export function queueAttackAction(
  game: GameState,
  owner: PlayerId,
  attackerId: string,
  q: number,
  r: number,
): Result<PendingAction> {
  const ready = requirePlanning(game, owner);
  if (!ready.ok) return ready;
  const attacker = findOwnUnit(game, owner, attackerId);
  if (!attacker) return { ok: false, code: 'unit_not_found', message: 'attacker not found' };
  const queue = queueOf(game, owner);
  if (unitAlreadyPlanned(queue, attackerId)) {
    return { ok: false, code: 'invalid_attack', message: 'unit already has a planned action this round' };
  }
  const budget = checkBudget(game, owner);
  if (budget) return budget;
  // 攻击瞄准一个格子/方向：射程内任选一格；未配置形状 = 单格预测射击。
  if (!isInBounds(game, q, r)) {
    return { ok: false, code: 'invalid_attack', message: 'target cell is outside the board' };
  }
  const aim = coveredCellsFor(attacker, game.config.units[attacker.type], 'attackShape', { q, r }, attacker.attackRange);
  if (!aim) {
    return { ok: false, code: 'invalid_attack', message: `cannot aim at (${q},${r}) with this unit's attack shape` };
  }
  return enqueue(game, owner, { id: randomUUID(), type: 'attack', attackerId, q, r, direction: aim.direction });
}

// ---------------------------------------------------------------- heal

/**
 * 治疗瞄准格子/方向（覆盖形状由 healShape 配置，默认单格）。计划时要求覆盖格内
 * 至少站着一个存活友方单位；结算时对覆盖格内所有受伤友方单位各自掷治疗量。
 */
export function queueHealAction(
  game: GameState,
  owner: PlayerId,
  supportId: string,
  q: number,
  r: number,
): Result<PendingAction> {
  const ready = requirePlanning(game, owner);
  if (!ready.ok) return ready;
  const support = findOwnUnit(game, owner, supportId);
  if (!support) return { ok: false, code: 'unit_not_found', message: 'support not found' };
  if (support.type !== 'support') return { ok: false, code: 'invalid_heal', message: 'unit is not support' };
  const queue = queueOf(game, owner);
  if (unitAlreadyPlanned(queue, supportId)) {
    return { ok: false, code: 'invalid_heal', message: 'unit already has a planned action this round' };
  }
  if (!isInBounds(game, q, r)) {
    return { ok: false, code: 'invalid_heal', message: 'target cell is outside the board' };
  }
  const aim = coveredCellsFor(support, game.config.units[support.type], 'healShape', { q, r }, support.attackRange);
  if (!aim) {
    return { ok: false, code: 'invalid_heal', message: `cannot aim at (${q},${r}) with this unit's heal shape` };
  }
  const spec = game.config.units[support.type];
  if (spec && (isArtilleryDanger(game, support)
    || aim.cells.some(cell => isInBounds(game, cell.q, cell.r) && isArtilleryDanger(game, cell)))) {
    return { ok: false, code: 'invalid_heal', message: 'cannot heal inside the artillery zone' };
  }
  const coveredFriend = aim.cells.some(cell =>
    game.units.some(unit => unit.alive && unit.owner === owner && unit.q === cell.q && unit.r === cell.r));
  if (!coveredFriend) {
    return { ok: false, code: 'invalid_heal', message: 'no friendly unit in the covered cells' };
  }
  const budget = checkBudget(game, owner);
  if (budget) return budget;
  return enqueue(game, owner, { id: randomUUID(), type: 'heal', supportId, q, r, direction: aim.direction });
}

// ---------------------------------------------------------------- demolish

export function queueDemolishAction(
  game: GameState,
  owner: PlayerId,
  unitId: string,
  q: number,
  r: number,
): Result<PendingAction> {
  const ready = requirePlanning(game, owner);
  if (!ready.ok) return ready;
  const unit = findOwnUnit(game, owner, unitId);
  if (!unit) return { ok: false, code: 'unit_not_found', message: 'unit not found' };
  if (unit.type !== 'heavy') {
    return { ok: false, code: 'invalid_demolish', message: 'only heavy units can demolish terrain' };
  }
  const queue = queueOf(game, owner);
  if (unitAlreadyPlanned(queue, unitId)) {
    return { ok: false, code: 'invalid_demolish', message: 'unit already has a planned action this round' };
  }
  const budget = checkBudget(game, owner);
  if (budget) return budget;
  if (hexDistance(unit, { q, r }) > 1) {
    return { ok: false, code: 'invalid_demolish', message: 'target must be adjacent' };
  }
  if (!isInBounds(game, q, r)) {
    return { ok: false, code: 'invalid_demolish', message: 'target must be in bounds' };
  }
  if (getTerrain(game, q, r) !== 'blocker') {
    return { ok: false, code: 'invalid_demolish', message: 'target terrain is not blocker' };
  }
  if (getCellOccupant(game, q, r) !== null) {
    return { ok: false, code: 'invalid_demolish', message: 'target cell is occupied' };
  }
  return enqueue(game, owner, { id: randomUUID(), type: 'demolish', unitId, q, r });
}

// ---------------------------------------------------------------- 撤回 / 清空 / 确认

export function revokePlanAction(game: GameState, owner: PlayerId, actionId: string): Result<PendingAction[]> {
  const ready = requirePlanning(game, owner);
  if (!ready.ok) return ready;
  const queue = queueOf(game, owner);
  const index = queue.findIndex(action => action.id === actionId);
  if (index < 0) return { ok: false, code: 'invalid_move', message: 'planned action not found' };
  queue.splice(index, 1);
  return { ok: true, data: [...queue] };
}

export function clearPlanActions(game: GameState, owner: PlayerId): Result<PendingAction[]> {
  const ready = requirePlanning(game, owner);
  if (!ready.ok) return ready;
  game.plan!.queues[owner] = [];
  return { ok: true, data: [] };
}

export function markCommitted(game: GameState, bus: EventBus, owner: PlayerId): Result {
  const ready = requirePlanning(game, owner, { allowCommitted: true });
  if (!ready.ok) return ready;
  if (game.plan!.committed.includes(owner)) {
    return { ok: false, code: 'already_committed', message: 'plan already committed this round' };
  }
  game.plan!.committed.push(owner);
  appendEvent(game, bus, 'plan_committed', {
    playerId: owner,
    roundNumber: game.turn.roundNumber,
    committed: [...game.plan!.committed],
  });
  return { ok: true };
}

/** 计划期玩家被淘汰时清出其计划状态。 */
export function dropFromPlan(game: GameState, playerId: PlayerId): void {
  if (!game.plan) return;
  delete game.plan.queues[playerId];
  game.plan.committed = game.plan.committed.filter(id => id !== playerId);
}

/** 结算后开启新回合的计划阶段。 */
export function resetPlanForRound(game: GameState): void {
  if (!game.plan) game.plan = { queues: {}, committed: [] };
  game.plan.queues = {};
  game.plan.committed = [];
}
