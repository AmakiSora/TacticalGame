// algorithms/lib/game-utils.mjs
//
// 游戏工具函数：六边形几何、寻路、目标评分等
// 提取自 scripts/auto-standard-game.mjs 并重构

const HEX_DIRS = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

const UNIT_VALUE = {
  support: 500,
  ranger: 420,
  scout: 350,
  infantry: 320,
  heavy: 180,
};

/**
 * 计算六边形距离
 * @param {{q: number, r: number}} a - 起点
 * @param {{q: number, r: number}} b - 终点
 * @returns {number} 距离
 */
export function hexDistance(a, b) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(-a.q - a.r - (-b.q - b.r)));
}

/**
 * 获取相邻的六个格子
 * @param {{q: number, r: number}} pos - 中心位置
 * @returns {Array<{q: number, r: number}>} 相邻格子数组
 */
export function neighbors(pos) {
  return HEX_DIRS.map(d => ({ q: pos.q + d.q, r: pos.r + d.r }));
}

/**
 * 格子坐标转字符串键
 * @private
 */
function key(p) {
  return `${p.q},${p.r}`;
}

/**
 * 检查格子是否在可玩区域内
 * @param {object} game - 游戏状态
 * @param {{q: number, r: number}} pos - 位置
 * @returns {boolean}
 */
export function isPlayable(game, pos) {
  return game.cells.some(c => c.q === pos.q && c.r === pos.r);
}

/**
 * 获取格子的地形类型
 * @param {object} game - 游戏状态
 * @param {{q: number, r: number}} pos - 位置
 * @returns {string} 地形类型 (plain, water, blocker)
 */
export function terrainAt(game, pos) {
  const override = game.map.terrainCells.find(c => c.q === pos.q && c.r === pos.r);
  if (override) return override.terrain;
  return game.cells.find(c => c.q === pos.q && c.r === pos.r)?.terrain || 'blocker';
}

/**
 * 获取格子上的占据物（单位或总部）
 * @param {object} game - 游戏状态
 * @param {{q: number, r: number}} pos - 位置
 * @returns {{kind: string, entity: object} | null}
 */
export function occupantAt(game, pos) {
  const unit = game.units.find(u => u.alive && u.q === pos.q && u.r === pos.r);
  if (unit) return { kind: 'unit', entity: unit };

  const hq = Object.values(game.headquarters || {}).find(
    h => h.alive && h.q === pos.q && h.r === pos.r
  );
  if (hq) return { kind: 'headquarters', entity: hq };

  return null;
}

/**
 * 检查格子是否为空的平地
 * @param {object} game - 游戏状态
 * @param {{q: number, r: number}} pos - 位置
 * @returns {boolean}
 */
export function isEmptyPlain(game, pos) {
  return isPlayable(game, pos) &&
         terrainAt(game, pos) === 'plain' &&
         occupantAt(game, pos) === null;
}

/**
 * 计算单位可到达的格子（BFS 寻路）
 * @param {object} game - 游戏状态
 * @param {object} unit - 单位对象
 * @returns {Array<{q: number, r: number}>} 可到达的格子数组
 */
export function reachableCells(game, unit) {
  const visited = new Set([key(unit)]);
  const reachable = [];
  const queue = [{ p: { q: unit.q, r: unit.r }, d: 0 }];

  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    if (cur.d >= unit.moveRange) continue;

    for (const n of neighbors(cur.p)) {
      const k = key(n);
      if (visited.has(k)) continue;
      visited.add(k);

      if (!isEmptyPlain(game, n)) continue;

      reachable.push(n);
      queue.push({ p: n, d: cur.d + 1 });
    }
  }

  return reachable;
}

/**
 * 获取存活的单位
 * @param {object} game - 游戏状态
 * @param {string} owner - 玩家 ID
 * @returns {Array<object>} 单位数组
 */
export function livingUnits(game, owner) {
  return game.units.filter(u => u.alive && u.owner === owner);
}

/**
 * 获取活跃的玩家席位
 * @param {object} game - 游戏状态
 * @returns {Array<string>} 玩家 ID 数组
 */
export function activeSeats(game) {
  if (game.players) {
    return Object.keys(game.players).filter(id => game.players[id]?.status === 'active');
  }
  return Object.keys(game.headquarters || {}).filter(
    id => game.headquarters[id]?.alive !== false
  );
}

/**
 * 获取敌方席位
 * @param {object} game - 游戏状态
 * @param {string} owner - 己方玩家 ID
 * @returns {Array<string>} 敌方玩家 ID 数组
 */
export function enemySeats(game, owner) {
  return activeSeats(game).filter(id => id !== owner);
}

/**
 * 评分目标（用于攻击优先级）
 * @param {{kind: string, entity: object}} target - 目标对象
 * @returns {number} 分数（越高越优先）
 */
export function scoreTarget(target) {
  if (target.kind === 'headquarters') {
    return 10000 - target.entity.hp;
  }

  const u = target.entity;
  const heavyPenalty = u.type === 'heavy' && u.hp > 80 ? 180 : 0;
  return (UNIT_VALUE[u.type] || 0) + (u.maxHp - u.hp) * 4 - u.hp - heavyPenalty;
}

/**
 * 获取所有敌方目标（单位 + 总部）
 * @param {object} game - 游戏状态
 * @param {string} owner - 己方玩家 ID
 * @returns {Array<{kind: string, entity: object}>}
 */
export function enemyTargets(game, owner) {
  const enemies = enemySeats(game, owner);
  return [
    ...game.units
      .filter(u => u.alive && enemies.includes(u.owner))
      .map(u => ({ kind: 'unit', entity: u })),
    ...enemies
      .map(id => ({ kind: 'headquarters', entity: game.headquarters[id] }))
      .filter(t => t.entity?.alive),
  ];
}

/**
 * 找到单位射程内最佳攻击目标
 * @param {object} game - 游戏状态
 * @param {string} owner - 己方玩家 ID
 * @param {object} unit - 己方单位
 * @returns {{kind: string, entity: object} | null}
 */
export function bestAttackTarget(game, owner, unit) {
  const targets = enemyTargets(game, owner)
    .filter(t => hexDistance(unit, t.entity) <= unit.attackRange)
    .sort((a, b) => scoreTarget(b) - scoreTarget(a));

  return targets[0] || null;
}

/**
 * 找到最近的敌方总部
 * @param {object} game - 游戏状态
 * @param {string} owner - 己方玩家 ID
 * @param {{q: number, r: number}} from - 起点位置
 * @returns {object | null} 总部对象
 */
export function nearestEnemyHeadquarters(game, owner, from) {
  const enemies = enemySeats(game, owner)
    .map(id => game.headquarters[id])
    .filter(hq => hq && hq.alive);

  if (enemies.length === 0) return null;

  return enemies.sort((a, b) => hexDistance(from, a) - hexDistance(from, b))[0];
}

/**
 * 计算据点优先级
 * @param {object} game - 游戏状态
 * @param {object} cp - 据点对象
 * @returns {number} 优先级分数
 */
export function controlPriority(game, cp) {
  const effect = cpKindEffect(game, cp);
  if (!effect) return 8;
  if (cp.kind === 'supply') return 16;
  if (cp.kind === 'forward_base') return 13;
  if (cp.kind === 'repair') return 11;
  return effect.income || 8;
}

/**
 * 获取据点类型效果
 * @param {object} game - 游戏状态
 * @param {object} point - 据点对象
 * @returns {object | null}
 */
export function cpKindEffect(game, point) {
  if (!point?.kind) return null;
  return game.config?.balance?.controlPointTypes?.[point.kind] || null;
}

/**
 * 计算单位的移动目标
 * @param {object} game - 游戏状态
 * @param {string} owner - 己方玩家 ID
 * @param {object} unit - 单位对象
 * @returns {{q: number, r: number}} 目标位置
 */
export function movementGoal(game, owner, unit) {
  const ownedCps = (game.controlPoints || []).filter(cp => cp.owner === owner).length;
  const turnNo = game.turn?.turnNumber ?? 1;
  const enemyHq = nearestEnemyHeadquarters(game, owner, unit);

  // 晚期：直接压最近敌方 HQ（scout/ranger/infantry）
  if (enemyHq && (turnNo >= 8 || ownedCps >= 3) &&
      ['scout', 'ranger', 'infantry'].includes(unit.type)) {
    return enemyHq;
  }

  // 中期：先补据点
  if (unit.canCapture) {
    const neutralOrEnemyCps = (game.controlPoints || [])
      .filter(cp => cp.owner !== owner)
      .sort((a, b) =>
        (controlPriority(game, b) - hexDistance(unit, b)) -
        (controlPriority(game, a) - hexDistance(unit, a))
      );
    if (neutralOrEnemyCps.length > 0) return neutralOrEnemyCps[0];
  }

  // 游侠：优先威胁高价值敌军
  if (unit.type === 'ranger' && (unit.attackRange ?? 0) > 1) {
    const enemies = enemySeats(game, owner);
    const highValueTarget = game.units
      .filter(u => u.alive && enemies.includes(u.owner))
      .sort((a, b) =>
        scoreTarget({ kind: 'unit', entity: b }) -
        scoreTarget({ kind: 'unit', entity: a })
      )[0];
    if (highValueTarget) return highValueTarget;
  }

  return enemyHq || { q: 0, r: 0 };
}

/**
 * 获取部署源（总部和己方据点）
 * 地图 `balance.deployFromHq === false` 时总部不可作为部署起点，只返回据点。
 * @param {object} game - 游戏状态
 * @param {string} owner - 玩家 ID
 * @returns {Array<object>} 部署源数组
 */
export function deployOrigins(game, owner) {
  const origins = [];
  if (game.config?.balance?.deployFromHq !== false) {
    const ownHq = game.headquarters?.[owner];
    if (ownHq && ownHq.alive !== false) origins.push(ownHq);
  }
  origins.push(...(game.controlPoints || []).filter(cp => cp.owner === owner));
  return origins;
}

/**
 * 计算实际部署费用（考虑据点折扣）
 * @param {object} game - 游戏状态
 * @param {string} type - 单位类型
 * @param {object} origin - 部署源对象
 * @returns {number} 实际费用
 */
export function effectiveDeployCost(game, type, origin) {
  const base = game.config.units[type].cost;
  return Math.max(0, base - (cpKindEffect(game, origin)?.deployDiscount || 0));
}

/**
 * 获取剩余行动点
 * @param {object} game - 游戏状态
 * @returns {number}
 */
export function actionsRemaining(game) {
  const perTurn = game.config?.balance?.actionsPerTurn ?? 5;
  return Math.max(0, perTurn - (game.turn?.actionsUsed ?? 0));
}

export function deployDecision(game, owner) {
  if (actionsRemaining(game) <= 0) return null;

  const ownedCps = (game.controlPoints || []).filter(cp => cp.owner === owner).length;
  const myUnits = livingUnits(game, owner);
  const enemyArmy = enemySeats(game, owner)
    .reduce((sum, id) => sum + livingUnits(game, id).length, 0);
  const supplies = game.resources?.[owner]?.supplies ?? 0;
  const turnNo = game.turn?.turnNumber ?? 0;

  if (!(supplies >= 90 || myUnits.length <= enemyArmy || ownedCps >= 2 || turnNo >= 8)) {
    return null;
  }

  const origins = deployOrigins(game, owner);
  if (origins.length === 0) return null;
  const enemyHq = nearestEnemyHeadquarters(game, owner, origins[0]);
  const sortedOrigins = enemyHq
    ? [...origins].sort((a, b) => hexDistance(a, enemyHq) - hexDistance(b, enemyHq))
    : origins;

  // 优先补齐队伍里稀缺的兵种
  const counts = {};
  for (const u of myUnits) counts[u.type] = (counts[u.type] || 0) + 1;
  const damaged = myUnits.filter(u => u.hp < u.maxHp * 0.65).length;
  const order = [];
  if (damaged >= 2 && (counts.support || 0) < 2) order.push('support');
  if (turnNo <= 3) order.push('scout', 'infantry');
  order.push('ranger', 'heavy', 'infantry', 'scout', 'support');

  for (const type of order) {
    if (!game.config.units[type]) continue;
    for (const origin of sortedOrigins) {
      const cost = effectiveDeployCost(game, type, origin);
      if (supplies < cost) continue;
      for (const pos of neighbors(origin)) {
        if (!isEmptyPlain(game, pos)) continue;
        return {
          type: 'deploy',
          payload: { unitType: type, fromId: origin.id, q: pos.q, r: pos.r },
        };
      }
    }
  }

  return null;
}
