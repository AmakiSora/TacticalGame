// src/engine/planning.ts
// simultaneous 模式的计划阶段：玩家把动作"入队不执行"，全部玩家确认后由
// simultaneous.ts 按行动点逐步结算。
//
// 入队只做"结构性合理"校验：单位归属、行动点预算、目标格是否在地图内、形状/射程
// 是否匹配、部署补给是否足够。占用、地形是否仍可用、目的格冲突等动态条件一律
// 留到结算时按每一步的棋盘判定——这样才允许"第 1 步腾格、第 2 步进入"这类计划。
//
// 队列数组顺序就是行动点顺序： `queues[owner][i]` 在第 i+1 个行动点结算。
import { randomUUID } from 'node:crypto';
import type { GameState, PendingAction, PlayerId, Position, TerrainType, UnitType } from '../types.js';
import { isSimultaneousMode } from '../types.js';
import type { EventBus } from '../events/bus.js';
import type { Result, Failure } from './result.js';
import { appendEvent } from './events.js';
import { hexDistance, hexKey, hexNeighbors, HEX_DIRECTIONS } from './hex.js';
import { isInBounds, getTerrain, deployOriginFor } from './validation.js';
import { getGameIndex } from './gameIndex.js';
import { deployDiscountForOrigin } from './controlPoints.js';
import { isArtilleryDanger } from './artillery.js';
import type { UnitSpec } from '../config/loader.js';

export function isSimultaneous(game: GameState): boolean {
  return isSimultaneousMode(game.config.mode);
}

type Plan = NonNullable<GameState['plan']>;

function plan(game: GameState): Result<Plan> {
  if (!isSimultaneous(game)) {
    return { ok: false, code: 'not_simultaneous_game', message: '该对局不是同时回合模式' };
  }
  if (!game.plan) game.plan = { queues: {}, committed: [] };
  return { ok: true, data: game.plan };
}

/** 计划期通用门槛：模式正确、对局进行中、玩家存活；默认还要求尚未确认。 */
function requirePlanning(game: GameState, owner: PlayerId, options: { allowCommitted?: boolean } = {}): Result<Plan> {
  const resolved = plan(game);
  if (!resolved.ok) return resolved;
  if (game.phase === 'game_over') return { ok: false, code: 'game_over', message: '对局已结束' };
  if (game.phase !== 'active') return { ok: false, code: 'game_not_started', message: '对局不在进行中' };
  if (game.players[owner]?.status !== 'active') {
    return { ok: false, code: 'player_eliminated', message: '该玩家已被淘汰' };
  }
  if (!options.allowCommitted && game.plan!.committed.includes(owner)) {
    return { ok: false, code: 'not_your_turn', message: '本轮计划已提交' };
  }
  return { ok: true, data: game.plan! };
}

function queueOf(game: GameState, owner: PlayerId): PendingAction[] {
  if (!game.plan) game.plan = { queues: {}, committed: [] };
  if (!game.plan.queues[owner]) game.plan.queues[owner] = [];
  return game.plan.queues[owner]!;
}

/** 动作绑定的单位 ID；deploy / wait 没有单位主体。 */
function actionUnitId(action: PendingAction): string | undefined {
  return action.unitId ?? action.attackerId ?? action.supportId;
}

function checkBudget(game: GameState, owner: PlayerId): Failure | null {
  // 每个排队动作（含 wait）恰好消耗 1 点行动点，队列长度即用量。
  const limit = game.config.balance.actionsPerTurn;
  if (queueOf(game, owner).length >= limit) {
    return { ok: false, code: 'action_limit_reached', message: `每轮最多行动 ${limit} 次` };
  }
  return null;
}

function findOwnUnit(game: GameState, owner: PlayerId, unitId: string) {
  const unit = getGameIndex(game).unitById.get(unitId);
  return unit && unit.owner === owner && unit.alive ? unit : null;
}

function healRangeFor(game: GameState, support: { type: UnitType; attackRange: number }): number {
  return game.config.units[support.type]?.healRange ?? support.attackRange;
}

function enqueue(game: GameState, owner: PlayerId, action: PendingAction): Result<PendingAction> {
  queueOf(game, owner).push(action);
  return { ok: true, data: action };
}

// ---------------------------------------------------------------- 计划投影
// 同一单位可以在多个行动点连续行动，因此"攻击/治疗/爆破/移动的起点"要按队列里
// 之前的移动投影计算；自己先前排的爆破也会把目标格视为 plain。投影只假设自己的
// 动作成功——若结算时前面的动作失败，后续动作会被失败连锁作废。

export interface PlanProjection {
  /** unitId -> 执行完当前队列后的虚拟站位。 */
  positions: Map<string, Position>;
  /** 自己先前 demolish 造成的虚拟地形覆盖。 */
  terrain: Map<string, TerrainType>;
  /** actionId -> 执行该动作前的虚拟站位。 */
  actionPositions: Map<string, Position>;
}

export function projectPlanQueue(game: GameState, owner: PlayerId): PlanProjection {
  const queue = queueOf(game, owner);
  const positions = new Map<string, Position>();
  const terrain = new Map<string, TerrainType>();
  const actionPositions = new Map<string, Position>();
  const positionOf = (unitId: string): Position | null => {
    const projected = positions.get(unitId);
    if (projected) return projected;
    const unit = getGameIndex(game).unitById.get(unitId);
    return unit ? { q: unit.q, r: unit.r } : null;
  };
  for (const action of queue) {
    const unitId = actionUnitId(action);
    if (unitId) {
      const position = positionOf(unitId);
      if (position) actionPositions.set(action.id, position);
    }
    if (action.type === 'move' && unitId && typeof action.q === 'number' && typeof action.r === 'number') {
      positions.set(unitId, { q: action.q, r: action.r });
    } else if (action.type === 'demolish' && typeof action.q === 'number' && typeof action.r === 'number') {
      terrain.set(hexKey({ q: action.q, r: action.r }), 'plain');
    }
  }
  return { positions, terrain, actionPositions };
}

function projectedTerrain(game: GameState, projection: PlanProjection, q: number, r: number): TerrainType {
  return projection.terrain.get(hexKey({ q, r })) ?? getTerrain(game, q, r);
}

function projectedPosition(game: GameState, projection: PlanProjection, unitId: string): Position | null {
  const projected = projection.positions.get(unitId);
  if (projected) return projected;
  const unit = getGameIndex(game).unitById.get(unitId);
  return unit ? { q: unit.q, r: unit.r } : null;
}

/**
 * 计划期可达格：只按地形寻路（水/障碍挡路），忽略单位与总部占位。
 * 单位可能在本轮移动，所以计划阶段不能把它们当成永久墙；目的地是否仍被占用
 * 由结算时的到达判定负责。
 */
function planningReachableCells(
  game: GameState,
  from: Position,
  range: number,
  projection: PlanProjection,
): Position[] {
  const visited = new Set<string>([hexKey(from)]);
  const result: Position[] = [];
  const queue: { position: Position; distance: number }[] = [{ position: from, distance: 0 }];
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index]!;
    if (current.distance >= range) continue;
    for (const next of hexNeighbors(current.position)) {
      const key = hexKey(next);
      if (visited.has(key)) continue;
      visited.add(key);
      if (!isInBounds(game, next.q, next.r)) continue;
      if (projectedTerrain(game, projection, next.q, next.r) !== 'plain') continue;
      result.push(next);
      queue.push({ position: next, distance: current.distance + 1 });
    }
  }
  return result;
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

const coveredCellsCache = new Map<string, ShapeAim | null>();
const COVERED_CELLS_CACHE_LIMIT = 1024;

export function shapeSpecFor(spec: UnitSpec | undefined, kind: 'attackShape' | 'healShape'): { type: ShapeType; length: number } {
  const shape = spec?.[kind];
  if (!shape) return { type: 'single', length: 1 };
  if (shape.type === 'line') return { type: 'line', length: shape.length ?? 2 };
  if (shape.type === 'arc') return { type: 'arc', length: 3 };
  return { type: 'single', length: 1 };
}

/**
 * 由施放者位置与点击格推导形状方向与覆盖格。瞄准不合法（超出射程、不在正六方向
 * 射线上、非相邻格等）返回 null。
 */
function computeCoveredCells(
  from: Position,
  shape: ReturnType<typeof shapeSpecFor>,
  kind: 'attackShape' | 'healShape',
  target: Position,
  range: number,
): ShapeAim | null {
  const dq = target.q - from.q;
  const dr = target.r - from.r;
  // 所有形状都受本局 attackRange/healRange 约束；line 的 shape.length 只是
  // 覆盖上限，不能反过来突破射程。
  if (hexDistance(from, target) > range) return null;
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
  // line：点击格必须落在某个正六方向射线上，距离 1..min(length, range)。
  const length = Math.min(shape.length, range);
  for (let direction = 0; direction < 6; direction++) {
    const d = HEX_DIRECTIONS[direction]!;
    const k = d.q !== 0 ? dq / d.q : dr / d.r;
    if (!Number.isInteger(k) || k < 1 || k > length) continue;
    if (d.q * k !== dq || d.r * k !== dr) continue;
    const cells: Position[] = [];
    for (let step = 1; step <= length; step++) {
      cells.push({ q: from.q + d.q * step, r: from.r + d.r * step });
    }
    return { type: 'line', direction, cells };
  }
  return null;
}

/**
 * 形状覆盖的纯函数缓存：同一 (施放者位置, 形状, 目标, 射程) 的重复计算在 MCTS 里
 * 非常频繁；结果只依赖参数，与对局状态无关，因此可以跨局面安全复用。
 */
export function coveredCellsFor(
  from: Position,
  spec: UnitSpec | undefined,
  kind: 'attackShape' | 'healShape',
  target: Position,
  range: number,
): ShapeAim | null {
  const shape = shapeSpecFor(spec, kind);
  const key = `${from.q},${from.r}|${kind}|${target.q},${target.r}|${range}|${shape.type}:${shape.length}`;
  if (coveredCellsCache.has(key)) return coveredCellsCache.get(key) ?? null;
  const aim = computeCoveredCells(from, shape, kind, target, range);
  if (coveredCellsCache.size >= COVERED_CELLS_CACHE_LIMIT) {
    const oldest = coveredCellsCache.keys().next().value;
    if (oldest !== undefined) coveredCellsCache.delete(oldest);
  }
  coveredCellsCache.set(key, aim);
  return aim;
}

// ---------------------------------------------------------------- deploy

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
  if (!unitSpec) return { ok: false, code: 'invalid_deploy', message: '未知兵种' };
  const origin = deployOriginFor(game, owner, fromId);
  if (!origin) return { ok: false, code: 'invalid_deploy', message: '部署起点无效' };
  if (isArtilleryDanger(game, origin) || isArtilleryDanger(game, { q, r })) {
    return { ok: false, code: 'invalid_deploy', message: '炮火区内无法部署' };
  }
  const budget = checkBudget(game, owner);
  if (budget) return budget;
  if (!isInBounds(game, q, r)) {
    return { ok: false, code: 'invalid_deploy', message: '部署目标在地图之外' };
  }
  if (hexDistance(origin, { q, r }) !== 1) {
    return { ok: false, code: 'out_of_deploy_range', message: '部署目标必须相邻' };
  }
  // 目标是否为 plain 按投影地形判定（自己先前的爆破可能已经清出该格）；是否被
  // 占用留到结算——同一步腾格后仍然可以部署成功。
  const projection = projectPlanQueue(game, owner);
  if (projectedTerrain(game, projection, q, r) !== 'plain') {
    return { ok: false, code: 'invalid_terrain', message: '部署目标必须是平原地形' };
  }
  const discount = Math.min(unitSpec.cost, deployDiscountForOrigin(game, owner, fromId));
  const actualCost = unitSpec.cost - discount;
  const resources = game.resources[owner];
  if (!resources) return { ok: false, code: 'player_eliminated', message: '资源不足' };
  if (resources.supplies - plannedDeploySpend(game, owner) < actualCost) {
    return { ok: false, code: 'insufficient_supplies', message: `需要 ${actualCost} 补给` };
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
  if (!unit) return { ok: false, code: 'unit_not_found', message: '找不到该单位' };
  const budget = checkBudget(game, owner);
  if (budget) return budget;
  const projection = projectPlanQueue(game, owner);
  const from = projectedPosition(game, projection, unitId);
  if (!from) return { ok: false, code: 'unit_not_found', message: '找不到该单位' };
  if (from.q === q && from.r === r) return { ok: false, code: 'invalid_move', message: '目标格就是当前所在格' };
  if (!isInBounds(game, q, r)) return { ok: false, code: 'invalid_move', message: '目标格在地图之外' };
  // 路径只受地形限制：其他单位可能在本轮移动，不能把它们当成墙。目的地是否
  // 仍被占用（或是否被同一步腾空）由结算时的到达判定负责。
  const reachable = planningReachableCells(game, from, unit.moveRange, projection);
  if (!reachable.some(pos => pos.q === q && pos.r === r)) {
    return { ok: false, code: 'invalid_move', message: '目标格无法到达' };
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
  if (!attacker) return { ok: false, code: 'unit_not_found', message: '找不到攻击方单位' };
  const budget = checkBudget(game, owner);
  if (budget) return budget;
  if (!isInBounds(game, q, r)) {
    return { ok: false, code: 'invalid_attack', message: '目标格在地图之外' };
  }
  // 攻击起点按投影站位计算：同一单位可以先移动、后攻击；若移动最终失败，
  // 攻击会被失败连锁作废。
  const projection = projectPlanQueue(game, owner);
  const from = projectedPosition(game, projection, attackerId);
  if (!from) return { ok: false, code: 'unit_not_found', message: '找不到攻击方单位' };
  const aim = coveredCellsFor(from, game.config.units[attacker.type], 'attackShape', { q, r }, attacker.attackRange);
  if (!aim) {
    return { ok: false, code: 'invalid_attack', message: `该单位的攻击范围打不到 (${q},${r})` };
  }
  return enqueue(game, owner, { id: randomUUID(), type: 'attack', attackerId, q, r, direction: aim.direction });
}

// ---------------------------------------------------------------- heal

/**
 * 治疗瞄准格子/方向（覆盖形状由 healShape 配置，默认单格）。计划期只校验形状与
 * 射程；覆盖格内是否有友军、是否有人受伤、是否在炮火区都留到结算判定。
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
  if (!support) return { ok: false, code: 'unit_not_found', message: '找不到支援单位' };
  if (support.type !== 'support') return { ok: false, code: 'invalid_heal', message: '该单位不是支援兵' };
  if (!isInBounds(game, q, r)) {
    return { ok: false, code: 'invalid_heal', message: '目标格在地图之外' };
  }
  const projection = projectPlanQueue(game, owner);
  const from = projectedPosition(game, projection, supportId);
  if (!from) return { ok: false, code: 'unit_not_found', message: '找不到支援单位' };
  const aim = coveredCellsFor(from, game.config.units[support.type], 'healShape', { q, r }, healRangeFor(game, support));
  if (!aim) {
    return { ok: false, code: 'invalid_heal', message: `该单位的治疗范围覆盖不到 (${q},${r})` };
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
  if (!unit) return { ok: false, code: 'unit_not_found', message: '找不到该单位' };
  if (unit.type !== 'heavy') {
    return { ok: false, code: 'invalid_demolish', message: '只有重装单位可以拆除地形' };
  }
  const budget = checkBudget(game, owner);
  if (budget) return budget;
  if (!isInBounds(game, q, r)) {
    return { ok: false, code: 'invalid_demolish', message: '目标必须在地图范围内' };
  }
  const projection = projectPlanQueue(game, owner);
  const from = projectedPosition(game, projection, unitId);
  if (!from) return { ok: false, code: 'unit_not_found', message: '找不到该单位' };
  if (hexDistance(from, { q, r }) > 1) {
    return { ok: false, code: 'invalid_demolish', message: '目标必须相邻' };
  }
  // 计划期只确认目标当前（按投影）是障碍；是否已被同一步的其他爆破清掉，
  // 以及格上是否有单位，留到结算判定。
  if (projectedTerrain(game, projection, q, r) !== 'blocker') {
    return { ok: false, code: 'invalid_demolish', message: '目标地形不是障碍' };
  }
  return enqueue(game, owner, { id: randomUUID(), type: 'demolish', unitId, q, r });
}

// ---------------------------------------------------------------- wait

/** 待命：占 1 个行动点，不做任何事，用于把后续动作对齐到更晚的行动点。 */
export function queueWaitAction(game: GameState, owner: PlayerId): Result<PendingAction> {
  const ready = requirePlanning(game, owner);
  if (!ready.ok) return ready;
  const budget = checkBudget(game, owner);
  if (budget) return budget;
  return enqueue(game, owner, { id: randomUUID(), type: 'wait' });
}

// ---------------------------------------------------------------- 撤回 / 清空 / 确认

export function revokePlanAction(game: GameState, owner: PlayerId, actionId: string): Result<PendingAction[]> {
  const ready = requirePlanning(game, owner);
  if (!ready.ok) return ready;
  const queue = queueOf(game, owner);
  const index = queue.findIndex(action => action.id === actionId);
  if (index < 0) return { ok: false, code: 'invalid_move', message: '找不到这条计划' };
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
    return { ok: false, code: 'already_committed', message: '本轮计划已提交' };
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
