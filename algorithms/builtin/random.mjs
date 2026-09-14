// algorithms/builtin/random.mjs
//
// 随机算法：从所有合法动作中随机选择一个
// 用于测试和作为基准对照

/**
 * 收集所有可能的攻击动作
 */
function collectAttackActions(game, owner, utils) {
  const actions = [];
  const myUnits = utils.livingUnits(game, owner);
  const targets = utils.enemyTargets(game, owner);
  // 行动点预算：未激活且无预算的单位不能产出需耗点的动作（否则引擎回 action_limit_reached）
  const budget = utils.actionsRemaining(game);

  for (const unit of myUnits) {
    if (unit.hasActed || (!unit.actionSpent && budget <= 0)) continue;

    for (const target of targets) {
      const dist = utils.hexDistance(unit, target.entity);
      if (dist <= unit.attackRange) {
        actions.push({
          type: 'attack',
          payload: {
            attackerId: unit.id,
            targetId: target.entity.id,
          },
        });
      }
    }
  }

  return actions;
}

/**
 * 收集所有可能的治疗动作
 */
function collectHealActions(game, owner, utils) {
  const actions = [];
  const healBudget = utils.actionsRemaining(game);
  const supports = utils.livingUnits(game, owner)
    .filter(u => u.type === 'support' && !u.hasActed && (u.actionSpent || healBudget > 0));
  const wounded = utils.livingUnits(game, owner)
    .filter(u => u.hp < u.maxHp);

  for (const support of supports) {
    for (const target of wounded) {
      if (support.id === target.id) continue;
      const dist = utils.hexDistance(support, target);
      if (dist <= support.attackRange) {
        actions.push({
          type: 'heal',
          payload: {
            supportId: support.id,
            targetId: target.id,
          },
        });
      }
    }
  }

  return actions;
}

/**
 * 收集所有可能的移动动作
 */
function collectMoveActions(game, owner, utils) {
  const actions = [];
  const myUnits = utils.livingUnits(game, owner).filter(u => !u.hasMoved);
  const budget = utils.actionsRemaining(game);

  for (const unit of myUnits) {
    // 检查是否有足够的 AP（已激活的单位免费移动）
    if (!unit.actionSpent && budget <= 0) continue;

    const reachable = utils.reachableCells(game, unit);
    for (const pos of reachable) {
      actions.push({
        type: 'move',
        payload: {
          unitId: unit.id,
          q: pos.q,
          r: pos.r,
        },
      });
    }
  }

  return actions;
}

/**
 * 收集所有可能的部署动作
 */
function collectDeployActions(game, owner, utils) {
  const actions = [];
  const actionsLeft = utils.actionsRemaining(game);
  if (actionsLeft <= 0) return actions;

  const origins = utils.deployOrigins(game, owner);
  const supplies = game.resources?.[owner]?.supplies ?? 0;
  const unitTypes = ['infantry', 'scout', 'heavy', 'ranger', 'support'];

  for (const origin of origins) {
    for (const type of unitTypes) {
      if (!game.config.units[type]) continue;

      const cost = utils.effectiveDeployCost(game, type, origin);
      if (supplies < cost) continue;

      for (const pos of utils.neighbors(origin)) {
        if (!utils.isEmptyPlain(game, pos)) continue;

        actions.push({
          type: 'deploy',
          payload: {
            unitType: type,
            fromId: origin.id,
            q: pos.q,
            r: pos.r,
          },
        });
      }
    }
  }

  return actions;
}

/**
 * 随机算法主模块
 */
export default {
  name: 'random',
  description: '随机算法：从所有合法动作中随机选择',

  /**
   * 决策函数：随机选择一个合法动作
   */
  async decide(game, utils) {
    const owner = game.turn?.currentPlayerId || game.turn?.currentOwner;
    if (!owner) return null;

    // 收集所有可能的动作
    const allActions = [
      ...collectAttackActions(game, owner, utils),
      ...collectHealActions(game, owner, utils),
      ...collectMoveActions(game, owner, utils),
      ...collectDeployActions(game, owner, utils),
    ];

    // 如果没有可用动作，结束回合
    if (allActions.length === 0) {
      return null;
    }

    // 随机选择一个动作
    const randomIndex = Math.floor(Math.random() * allActions.length);
    return allActions[randomIndex];
  },
};
