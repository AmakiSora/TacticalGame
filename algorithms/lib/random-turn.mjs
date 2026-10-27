// algorithms/lib/random-turn.mjs
//
// 逐人轮流（standard / annihilation）的随机动作枚举器：random 与
// random-annihilation 共用。每步从所有合法动作中均匀随机取一个立即执行的动作，
// 返回 null 表示结束回合。
//
// 歼灭模式独有的炮火约束在这里按引擎口径镜像（危险区内的部署起点/落点与治疗
// 支援兵/目标一律跳过）；标准模式 game.artillery 恒为 null，这些过滤恒不命中。
// 移动进入危险区是合法的（引擎只在轮界结算炮火伤害），因此不过滤。

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
 *
 * 射程按引擎口径取 `config.units.<type>.healRange ?? attackRange`；歼灭系模式
 * 下支援兵或目标任一处于炮火危险区都会被引擎拒绝，直接跳过。
 */
function collectHealActions(game, owner, utils) {
  const actions = [];
  const healBudget = utils.actionsRemaining(game);
  const supports = utils.livingUnits(game, owner)
    .filter(u => u.type === 'support' && !u.hasActed && (u.actionSpent || healBudget > 0));
  const wounded = utils.livingUnits(game, owner)
    .filter(u => u.hp < u.maxHp);

  for (const support of supports) {
    if (utils.inArtilleryDanger(game, support)) continue;
    const healRange = game.config?.units?.[support.type]?.healRange ?? support.attackRange;

    for (const target of wounded) {
      if (support.id === target.id) continue;
      if (utils.inArtilleryDanger(game, target)) continue;
      const dist = utils.hexDistance(support, target);
      if (dist <= healRange) {
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
 *
 * 走进炮火区是合法的（引擎只在轮界结算炮火伤害），随机基线不做避险优化。
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
 *
 * 歼灭系模式下部署起点与落点都不能在炮火危险区（引擎 `invalid_deploy`），
 * 这里与引擎同口径过滤。
 */
function collectDeployActions(game, owner, utils) {
  const actions = [];
  const actionsLeft = utils.actionsRemaining(game);
  if (actionsLeft <= 0) return actions;

  const origins = utils.deployOrigins(game, owner);
  const supplies = game.resources?.[owner]?.supplies ?? 0;
  const unitTypes = ['infantry', 'scout', 'heavy', 'ranger', 'support'];

  for (const origin of origins) {
    if (utils.inArtilleryDanger(game, origin)) continue;

    for (const type of unitTypes) {
      if (!game.config.units[type]) continue;

      const cost = utils.effectiveDeployCost(game, type, origin);
      if (supplies < cost) continue;

      for (const pos of utils.neighbors(origin)) {
        if (utils.inArtilleryDanger(game, pos)) continue;
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
 * 随机选一个立即执行的动作；null 表示结束回合。
 * 座位从 `game.turn.currentPlayerId` / `currentOwner` 取（轮流模式恒有值）。
 */
export function decideImmediateAction(game, utils) {
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
}
