// algorithms/builtin/greedy.mjs
//
// 贪心算法：基于 scripts/auto-standard-game.mjs 的决策逻辑
// 优先级：攻击 > 治疗 > 爆破 > 部署 > 移动

/**
 * 尝试攻击：优先击杀低血量敌人和敌方总部
 * 行动点已用尽时只考虑本回合已激活的单位（否则引擎会回 action_limit_reached）。
 */
function tryAttack(game, owner, utils) {
  const budget = utils.actionsRemaining(game);
  const myUnits = utils.livingUnits(game, owner);

  for (const unit of myUnits) {
    if (unit.hasActed) continue;
    if (!unit.actionSpent && budget <= 0) continue;

    const target = utils.bestAttackTarget(game, owner, unit);
    if (!target) continue;

    return {
      type: 'attack',
      payload: {
        attackerId: unit.id,
        targetId: target.entity.id,
      },
    };
  }

  return null;
}

/**
 * 尝试治疗：支援单位治疗最受伤的友军
 */
function tryHeal(game, owner, utils) {
  const budget = utils.actionsRemaining(game);
  const supports = utils.livingUnits(game, owner)
    .filter(u => u.type === 'support' && !u.hasActed && (u.actionSpent || budget > 0));

  for (const support of supports) {
    const wounded = utils.livingUnits(game, owner)
      .filter(u =>
        u.id !== support.id &&
        u.hp < u.maxHp &&
        utils.hexDistance(support, u) <= support.attackRange
      )
      .sort((a, b) => (b.maxHp - b.hp) - (a.maxHp - a.hp));

    if (wounded.length > 0) {
      return {
        type: 'heal',
        payload: {
          supportId: support.id,
          targetId: wounded[0].id,
        },
      };
    }
  }

  return null;
}

/**
 * 尝试爆破：重装单位清除阻挡
 */
function tryDemolish(game, owner, utils) {
  const turnNo = game.turn?.turnNumber ?? 1;
  if (turnNo < 6) return null; // 早期不爆破
  const budget = utils.actionsRemaining(game);

  const heavies = utils.livingUnits(game, owner)
    .filter(u => u.type === 'heavy' && !u.hasActed && (u.actionSpent || budget > 0));

  for (const heavy of heavies) {
    const neighbors = utils.neighbors(heavy);

    for (const pos of neighbors) {
      if (!utils.isPlayable(game, pos)) continue;
      if (utils.terrainAt(game, pos) !== 'blocker') continue;
      if (utils.occupantAt(game, pos) !== null) continue;

      return {
        type: 'demolish',
        payload: {
          unitId: heavy.id,
          q: pos.q,
          r: pos.r,
        },
      };
    }
  }

  return null;
}

/**
 * 判断是否应该部署
 */
function shouldDeploy(game, owner, utils) {
  const actionsLeft = utils.actionsRemaining(game);
  if (actionsLeft <= 0) return false;

  const ownedCps = (game.controlPoints || []).filter(cp => cp.owner === owner).length;
  const myArmy = utils.livingUnits(game, owner).length;
  const enemySeats = utils.enemySeats(game, owner);
  const enemyArmy = enemySeats.reduce((sum, id) =>
    sum + utils.livingUnits(game, id).length, 0
  );
  const supplies = game.resources?.[owner]?.supplies ?? 0;
  const turnNo = game.turn?.turnNumber ?? 0;

  return supplies >= 90 || myArmy <= enemyArmy || ownedCps >= 2 || turnNo >= 8;
}

/**
 * 选择部署的单位类型
 */
function pickDeployType(game, owner, origins, utils) {
  const supplies = game.resources?.[owner]?.supplies ?? 0;
  const friendly = utils.livingUnits(game, owner);
  const counts = {};
  for (const u of friendly) {
    counts[u.type] = (counts[u.type] || 0) + 1;
  }

  const damaged = friendly.filter(u => u.hp < u.maxHp * 0.65).length;
  const order = [];

  // 如果有多个受伤单位且支援不足，优先部署支援
  if (damaged >= 2 && (counts.support || 0) < 2) {
    order.push('support');
  }

  // 早期优先侦察和步兵
  if ((game.turn?.turnNumber ?? 1) <= 3) {
    order.push('scout', 'infantry');
  }

  // 常规顺序
  order.push('ranger', 'heavy', 'infantry', 'scout', 'support');

  for (const type of order) {
    if (!game.config.units[type]) continue;

    for (const origin of origins) {
      const cost = utils.effectiveDeployCost(game, type, origin);
      if (supplies >= cost) return { type, origin, cost };
    }
  }

  return null;
}

/**
 * 尝试部署
 */
function tryDeploy(game, owner, utils) {
  if (!shouldDeploy(game, owner, utils)) return null;

  const origins = utils.deployOrigins(game, owner);
  if (origins.length === 0) return null;

  const choice = pickDeployType(game, owner, origins, utils);
  if (!choice) return null;

  const enemyHq = utils.nearestEnemyHeadquarters(game, owner, origins[0]) || { q: 0, r: 0 };

  // 找到最近敌方总部的空位
  const candidates = [];
  for (const origin of origins) {
    const cost = utils.effectiveDeployCost(game, choice.type, origin);
    const supplies = game.resources?.[owner]?.supplies ?? 0;
    if (supplies < cost) continue;

    for (const pos of utils.neighbors(origin)) {
      if (!utils.isEmptyPlain(game, pos)) continue;
      const dist = utils.hexDistance(pos, enemyHq);
      candidates.push({ origin, pos, dist, cost });
    }
  }

  if (candidates.length === 0) return null;

  // 按距离和费用排序
  candidates.sort((a, b) => a.dist - b.dist || a.cost - b.cost);
  const pick = candidates[0];

  return {
    type: 'deploy',
    payload: {
      unitType: choice.type,
      fromId: pick.origin.id,
      q: pick.pos.q,
      r: pick.pos.r,
    },
  };
}

/**
 * 尝试移动：向目标推进
 */
function tryMove(game, owner, utils) {
  const budget = utils.actionsRemaining(game);
  const myUnits = utils.livingUnits(game, owner).filter(u => !u.hasMoved);

  // 已激活的单位优先移动（不消耗额外 AP）
  const movable = myUnits.filter(u => u.actionSpent || budget > 0);
  movable.sort((a, b) => Number(b.actionSpent) - Number(a.actionSpent));

  // 记录已占用的格子（避免移动冲突）
  const occupied = new Set();
  for (const u of myUnits) {
    occupied.add(`${u.q},${u.r}`);
  }

  for (const unit of movable) {
    const reachable = utils.reachableCells(game, unit)
      .filter(p => !occupied.has(`${p.q},${p.r}`));

    if (reachable.length === 0) continue;

    const goal = utils.movementGoal(game, owner, unit);
    const currentDist = utils.hexDistance(unit, goal);

    // 优先站上中立/敌方据点
    if (unit.canCapture) {
      const cpPos = reachable.find(p =>
        (game.controlPoints || []).some(cp =>
          cp.q === p.q && cp.r === p.r && cp.owner !== owner
        )
      );
      if (cpPos) {
        return {
          type: 'move',
          payload: {
            unitId: unit.id,
            q: cpPos.q,
            r: cpPos.r,
          },
        };
      }
    }

    // 否则选择最靠近目标的格子
    const best = reachable
      .map(p => ({ p, dist: utils.hexDistance(p, goal) }))
      .sort((a, b) => a.dist - b.dist)[0];

    if (!best || best.dist >= currentDist) continue;

    return {
      type: 'move',
      payload: {
        unitId: unit.id,
        q: best.p.q,
        r: best.p.r,
      },
    };
  }

  return null;
}

/**
 * 贪心算法主模块
 */
export default {
  name: 'greedy',
  description: '贪心算法：攻击 > 治疗 > 爆破 > 部署 > 移动',

  /**
   * 决策函数：返回下一个动作或 null（结束回合）
   */
  async decide(game, utils) {
    const owner = game.turn?.currentPlayerId || game.turn?.currentOwner;
    if (!owner) return null;

    // 按优先级尝试各种动作
    const action = tryAttack(game, owner, utils) ||
                   tryHeal(game, owner, utils) ||
                   tryDemolish(game, owner, utils) ||
                   tryDeploy(game, owner, utils) ||
                   tryMove(game, owner, utils);

    return action;
  },
};
