// algorithms/builtin/random-sim.mjs
//
// 同时随机算法：同时回合（simultaneous）模式的随机基线。
// 每轮从所有合法计划动作中随机选一个入队；返回 null 即提交计划（end-turn）。
// 仅支持 simultaneous 模式——注册表 ALGORITHM_META 声明 modes: ['simultaneous']，
// 各入口（大厅 bot 接口 / runner / 评估 decide 通道）按此拒绝跨模式混用。
//
// 与 standard 的 random 算法的差别：
// - 动作入队而非立即执行：攻/治瞄准格子（{ q, r }）而非目标 id；
// - 队列位置即行动点：同一单位可以跨行动点多次行动；
// - 攻击次数受地图 balance.attacksPerUnit 限制（默认 1）；
// - 座位不能从 turn.currentPlayerId 读（同时模式恒为 null），由调用方经 ctx.owner 传入。

const HEX_DIRS = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

const cellKey = pos => `${pos.q},${pos.r}`;
const attackLimit = game => game.config?.balance?.attacksPerUnit ?? 1;

// ---------------------------------------------------------------- 队列投影
// 队列前面的 move 会改变后续动作的起点：攻击/治疗/爆破/移动都要按投影站位
// 校验。这里只处理本算法会枚举的 move；不枚举 demolish，因此没有地形覆盖。
function projectedPositions(game, owner, queue) {
  const positions = new Map();
  for (const action of queue) {
    if (action.type !== 'move' || !action.unitId) continue;
    if (!Number.isFinite(action.q) || !Number.isFinite(action.r)) continue;
    positions.set(action.unitId, { q: action.q, r: action.r });
  }
  return positions;
}

function positionOf(positions, unit) {
  return positions.get(unit.id) ?? { q: unit.q, r: unit.r };
}

/** 计划期地形寻路：水/障碍挡路，单位/总部不挡路（与引擎 planning.ts 对齐）。 */
function reachableFrom(game, from, moveRange, utils) {
  const visited = new Set([cellKey(from)]);
  const reachable = [];
  const queue = [{ p: from, d: 0 }];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    if (cur.d >= moveRange) continue;
    for (const next of utils.neighbors(cur.p)) {
      const key = cellKey(next);
      if (visited.has(key)) continue;
      visited.add(key);
      if (!utils.isPlayable(game, next) || utils.terrainAt(game, next) !== 'plain') continue;
      reachable.push(next);
      queue.push({ p: next, d: cur.d + 1 });
    }
  }
  return reachable;
}

/** 投影后该格是否仍为空（己方按队列投影，敌方按当前站位保守判断）。 */
function isProjectedEmpty(game, owner, positions, pos, utils) {
  for (const unit of utils.livingUnits(game, owner)) {
    const at = positionOf(positions, unit);
    if (at.q === pos.q && at.r === pos.r) return false;
  }
  for (const unit of game.units || []) {
    if (!unit.alive || unit.owner === owner) continue;
    if (unit.q === pos.q && unit.r === pos.r) return false;
  }
  for (const hq of Object.values(game.headquarters || {})) {
    if (hq.alive && hq.q === pos.q && hq.r === pos.r) return false;
  }
  return true;
}

/** 己方队列里被 deploy/move 声明的目的格——重复声明会浪费一个行动点。 */
function claimedCells(queue) {
  const claimed = new Set();
  for (const action of queue) {
    if ((action.type === 'deploy' || action.type === 'move') && typeof action.q === 'number') {
      claimed.add(cellKey(action));
    }
  }
  return claimed;
}

/** 队列中已计划部署的花费（部署扣补给在结算期，入队校验按 剩余=当前-已计划 判定）。 */
function plannedDeploySpend(game, owner, queue, utils) {
  const origins = new Map(utils.deployOrigins(game, owner).map(o => [o.id, o]));
  let spend = 0;
  for (const action of queue) {
    if (action.type !== 'deploy') continue;
    const spec = game.config?.units?.[action.unitType];
    if (!spec) continue;
    const origin = origins.get(action.fromId);
    spend += origin ? utils.effectiveDeployCost(game, action.unitType, origin) : spec.cost;
  }
  return spend;
}

// ---------------------------------------------------------------- 形状瞄准
// 镜像 planning.ts 的 shapeSpecFor / coveredCellsFor：瞄准不合法的格子枚举
// 出来会被服务器拒绝——runner 会记住被拒动作让 decide 重选（不再作废整轮
// 计划），但仍空耗重问配额，故按镜像直接过滤。

function shapeSpec(game, unitType, kind) {
  const shape = game.config?.units?.[unitType]?.[kind];
  if (!shape) return { type: 'single', length: 1 };
  if (shape.type === 'line') return { type: 'line', length: shape.length ?? 2 };
  if (shape.type === 'arc') return { type: 'arc', length: 3 };
  return { type: 'single', length: 1 };
}

/** line：目标格必须落在某个正六方向射线上，距离 1..length。 */
function onRayWithin(from, target, length) {
  const dq = target.q - from.q;
  const dr = target.r - from.r;
  for (const d of HEX_DIRS) {
    const k = d.q !== 0 ? dq / d.q : dr / d.r;
    if (!Number.isInteger(k) || k < 1 || k > length) continue;
    if (d.q * k === dq && d.r * k === dr) return true;
  }
  return false;
}

/** 攻击可瞄准：single 射程内非本格；arc 仅相邻格；line 射线上。 */
function canAimAttack(game, unit, target, utils) {
  const shape = shapeSpec(game, unit.type, 'attackShape');
  if (shape.type === 'arc') return utils.hexDistance(unit, target) === 1;
  if (shape.type === 'line') return onRayWithin(unit, target, Math.min(shape.length, unit.attackRange));
  const dist = utils.hexDistance(unit, target);
  return dist > 0 && dist <= unit.attackRange;
}

/** 治疗可瞄准：single 允许本格（自治）；arc 仅相邻格。 */
function canAimHeal(game, support, target, utils) {
  const shape = shapeSpec(game, support.type, 'healShape');
  if (shape.type === 'arc') return utils.hexDistance(support, target) === 1;
  const range = game.config?.units?.[support.type]?.healRange ?? support.attackRange;
  return utils.hexDistance(support, target) <= range;
}

/** heal 覆盖格（镜像 coveredCellsFor 的 heal 分支）：arc = 瞄准方向扇形三格，single = 瞄准本格。 */
function healCoveredCells(game, support, target) {
  if (shapeSpec(game, support.type, 'healShape').type === 'arc') {
    const direction = HEX_DIRS.findIndex(d => d.q === target.q - support.q && d.r === target.r - support.r);
    return [(direction + 5) % 6, direction, (direction + 1) % 6].map(index => ({
      q: support.q + HEX_DIRS[index].q,
      r: support.r + HEX_DIRS[index].r,
    }));
  }
  return [target];
}

// ---------------------------------------------------------------- 炮火危险区
// 算法主动跳过炮火区内的部署/治疗（引擎已把治疗检查延到结算，部署仍在计划期拒绝）；
// simultaneous 无炮火机制（game.artillery 恒为 null），此过滤恒通过。

function isArtilleryDanger(game, pos) {
  return Boolean(game.artillery?.dangerCells.some(cell => cell.q === pos.q && cell.r === pos.r));
}

// ---------------------------------------------------------------- 动作枚举

function collectAttackActions(game, owner, queue, utils) {
  const actions = [];
  const targets = utils.enemyTargets(game, owner);
  const positions = projectedPositions(game, owner, queue);
  const limit = attackLimit(game);
  for (const unit of utils.livingUnits(game, owner)) {
    if (!unit.attackRange) continue;
    const used = queue.filter(action => action.type === 'attack' && action.attackerId === unit.id).length;
    if (used >= limit) continue;
    const from = positionOf(positions, unit);
    const origin = { ...unit, q: from.q, r: from.r };
    for (const target of targets) {
      const entity = target.entity;
      if (typeof entity?.q !== 'number') continue;
      if (!canAimAttack(game, origin, entity, utils)) continue;
      actions.push({
        type: 'attack',
        payload: { attackerId: unit.id, q: entity.q, r: entity.r },
      });
    }
  }
  return actions;
}

function collectHealActions(game, owner, queue, utils) {
  const actions = [];
  const positions = projectedPositions(game, owner, queue);
  const supports = utils.livingUnits(game, owner).filter(u => u.type === 'support');
  if (!supports.length) return actions;
  const wounded = utils.livingUnits(game, owner).filter(u => u.hp < u.maxHp);
  for (const support of supports) {
    if (isArtilleryDanger(game, support)) continue;
    const from = positionOf(positions, support);
    const origin = { ...support, q: from.q, r: from.r };
    for (const target of wounded) {
      const targetPos = positionOf(positions, target);
      if (!canAimHeal(game, origin, targetPos, utils)) continue;
      if (healCoveredCells(game, origin, targetPos).some(pos => isArtilleryDanger(game, pos))) continue;
      actions.push({
        type: 'heal',
        payload: { supportId: support.id, q: targetPos.q, r: targetPos.r },
      });
    }
  }
  return actions;
}

function collectMoveActions(game, owner, queue, claimed, utils) {
  const actions = [];
  const positions = projectedPositions(game, owner, queue);
  for (const unit of utils.livingUnits(game, owner)) {
    const from = positionOf(positions, unit);
    for (const pos of reachableFrom(game, from, unit.moveRange, utils)) {
      if (claimed.has(cellKey(pos))) continue;
      if (!isProjectedEmpty(game, owner, positions, pos, utils)) continue;
      actions.push({
        type: 'move',
        payload: { unitId: unit.id, q: pos.q, r: pos.r },
      });
    }
  }
  return actions;
}

function collectDeployActions(game, owner, queue, claimed, utils) {
  const actions = [];
  const positions = projectedPositions(game, owner, queue);
  const supplies = game.resources?.[owner]?.supplies ?? 0;
  const remaining = supplies - plannedDeploySpend(game, owner, queue, utils);
  const unitTypes = Object.keys(game.config?.units ?? {});

  for (const origin of utils.deployOrigins(game, owner)) {
    if (isArtilleryDanger(game, origin)) continue;
    for (const type of unitTypes) {
      if (utils.effectiveDeployCost(game, type, origin) > remaining) continue;
      for (const pos of utils.neighbors(origin)) {
        if (!utils.isPlayable(game, pos) || utils.terrainAt(game, pos) !== 'plain') continue;
        if (claimed.has(cellKey(pos))) continue;
        if (!isProjectedEmpty(game, owner, positions, pos, utils)) continue;
        if (isArtilleryDanger(game, pos)) continue;
        actions.push({
          type: 'deploy',
          payload: { unitType: type, fromId: origin.id, q: pos.q, r: pos.r },
        });
      }
    }
  }
  return actions;
}

/**
 * 同时随机算法主模块
 */
export default {
  name: 'random-sim',
  description: '同时回合：从所有合法计划动作中随机选择入队，随后提交',

  /**
   * 决策函数：随机选择一个合法计划动作入队；null 表示提交计划。
   * ctx.owner 由运行器/评估通道提供（同时模式没有 currentPlayerId）。
   */
  async decide(game, utils, ctx) {
    const owner = ctx?.owner;
    if (!owner || !game.plan) return null;

    // 已提交：本轮无事可做（等结算）。
    if ((game.plan.committed ?? []).includes(owner)) return null;

    const queue = game.plan.myQueue ?? game.plan.queues?.[owner] ?? [];
    const limit = game.config?.balance?.actionsPerTurn ?? 5;
    if (queue.length >= limit) return null;

    const claimed = claimedCells(queue);
    const allActions = [
      ...collectAttackActions(game, owner, queue, utils),
      ...collectHealActions(game, owner, queue, utils),
      ...collectMoveActions(game, owner, queue, claimed, utils),
      ...collectDeployActions(game, owner, queue, claimed, utils),
    ];

    if (allActions.length === 0) return null;
    return allActions[Math.floor(Math.random() * allActions.length)];
  },
};
