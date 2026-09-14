// algorithms/builtin/threat.mjs
//
// 威胁感知算法（Threat-aware Utility AI）
// 把本回合所有候选动作（攻击/治疗/移动/部署/爆破）放到同一效用尺度上打分，
// 每步选全局效用最高的动作。评估核心是敌方威胁图：对每个敌军预计算
// "下个敌方回合可从哪些格子发起攻击"（BFS 可达格 ∪ 原地，再按射程环形展开），
// 任何落点/停留点的潜在承伤都能 O(敌军数) 查表。
//
// 与 greedy 的区别：greedy 是固定优先级阶梯（攻击>治疗>…），本算法全动作统一比较；
// 与 MCTS 的区别：不做采样模拟，直接用威胁图解析评估，单步决策 p50 0.25ms / p99 3.6ms，
// 且走位天然规避危险格（MCTS 的移动采样只看 movementGoal 距离，不看威胁）。
//
// 行为特征：
//   - 集火斩杀：伤害期望 ≥ 目标血量时附加击杀奖励，稳杀（期望−掷骰下限仍够）全额奖励
//   - 反击感知：攻击者停留原地下回合的潜在承伤计入攻击效用
//   - 残血避险：威胁惩罚随血量降低放大，并按敌方行动预算截断（见 threatAt）
//   - 支援保排：support 的走位目标改为最受伤的友军/己方总部，不主动冲锋
//   - 终局裁定：接近回合上限时占领据点附加裁定分
// 注意：utils.enemyTargets 等目标结构为 { kind: 'unit' | 'headquarters', entity }
//
// 权重校准依据（headless 引擎自博弈、逐局交替先手、vs greedy 各图 40 局）：
//   · THREAT_SCALE 扫描 0.3/0.6/1.0/1.6/2.2/3.2 → 胜率 75%/90%/80%/80%/60%/35%，
//     峰值在 0.6~1.6，故取 0.8（初版 2.2 过度保守）；
//   · 行动点预算门控、结束回合门槛、威胁按敌方火力上限截断、据点收入按 kind 计价、
//     部署与战斗同尺度比较——逐条实测不亏才并入：合计 vs greedy 从 41.1% 提到 70.6%。
//   完整地图口径、以及被数据否掉的方向，见 algorithms/docs/algorithms/threat.md。

// ─── 效用权重：1 点期望伤害/血量 ≈ DAMAGE_SCALE 效用，其余项按此校准 ───
const DAMAGE_SCALE = 6;
const HEAL_SCALE = 8;
/** 潜在承伤 → 效用损失。过大会让 AI 只会后撤（实测 2.2 时胜率掉到 60%）。 */
const THREAT_SCALE = 0.8;
const IMMEDIATE_WEIGHT = 0.85;
const MOVE_ATTACK_WEIGHT = 0.45;
const LETHAL_PENALTY = 0.8;
const OPPORTUNITY_DISCOUNT = 0.75;
const PROGRESS_SCALE = 4;
/** 扎堆惩罚：每多一个贴脸友军扣的分。 */
const CROWD_PENALTY = 6;
/**
 * 结束回合的效用门槛。必须显著小于 PROGRESS_SCALE：decide 返回 null 的语义是
 * "结束整个回合"，门槛一旦 ≥ 推进一格的效用，单位就只能再走一格时会被直接掐掉回合。
 */
const MIN_ACTION_UTILITY = 0.001;
const CP_BASE_UTILITY = 60;
const CP_INCOME_TURNS_CAP = 8;
const LATE_GAME_UTILITY = 80;
const DEMOLISH_UTILITY = 90;
/**
 * 部署基准效用：只有当本回合最优动作不超过它时才补员。
 * 实测：阈值取 130（让部署与战斗正面竞标）会错过大量补员时机，dual-lanes 从 27/32 掉到 15/32；
 * 取 ≥250 接近"能补就补"且更强。保留上限是为了让稳杀 / 磨总部（效用 >250）仍然优先于部署。
 */
const DEPLOY_UTILITY = 250;
const HEAL_GUARD_BONUS = 25;
const HQ_KILL_UTILITY = 5000;
const HQ_DAMAGE_BONUS = 1.3;

/** 单位价值：底盘 + 3×补给成本，击杀/阵亡效用共用此尺度。 */
function unitValue(u) {
  return 120 + (u.cost || 50) * 3;
}

/**
 * 玩家在 pos 处的潜在承伤（均值，不含掷骰）。
 * 威胁分级加权：敌人原地即可打击的格子确定性高（重罚），需要先移动才能够到的确定性低（轻罚）。
 * 求和按 zones.volleys 截断：敌方每回合最多只有 actionsPerTurn 次出手，
 * 把所有敌军的理论输出线性相加会在大军后期凭空造出几倍火力，把落点惩罚推成常数、丢掉梯度。
 * excludeId 用于扣除将被击杀的目标（死人不会开枪）。
 */
function threatAt(pos, defender, zones, excludeId = null) {
  const k = `${pos.q},${pos.r}`;
  const volleys = [];
  for (const z of zones.attackers) {
    if (z.unit.id === excludeId) continue;
    if (!z.immediate.has(k) && !z.future.has(k)) continue;
    const dmg = Math.max(zones.minDamage, (z.unit.attack ?? 0) - (defender.defense || 0));
    volleys.push(dmg * (z.immediate.has(k) ? IMMEDIATE_WEIGHT : MOVE_ATTACK_WEIGHT));
  }
  volleys.sort((a, b) => b - a);
  let total = 0;
  for (let i = 0; i < Math.min(volleys.length, zones.volleys); i++) total += volleys[i];
  return total;
}

/** 落点威胁效用惩罚：随残血程度放大，按单位价值封顶（致命格 ≈ 0.8×价值）。 */
function threatPenalty(u, pos, zones, excludeId = null) {
  const t = threatAt(pos, u, zones, excludeId);
  if (t <= 0) return 0;
  const fatigue = 2 - u.hp / u.maxHp;
  return Math.min(unitValue(u) * LETHAL_PENALTY, t * THREAT_SCALE * fatigue);
}

/** 威胁图：每个敌军"原地射程环"（immediate）与"机动后可打击格"（future）。 */
function buildThreatZones(game, owner, utils) {
  const attackers = [];
  for (const seat of utils.enemySeats(game, owner)) {
    for (const e of utils.livingUnits(game, seat)) {
      const range = e.attackRange ?? 1;
      const ring = (c, set) => {
        for (let dq = -range; dq <= range; dq++) {
          const drLo = Math.max(-range, -dq - range);
          const drHi = Math.min(range, -dq + range);
          for (let dr = drLo; dr <= drHi; dr++) {
            set.add(`${c.q + dq},${c.r + dr}`);
          }
        }
      };
      const immediate = new Set();
      ring(e, immediate);
      const future = new Set(immediate);
      for (const c of utils.reachableCells(game, e)) ring(c, future);
      attackers.push({ unit: e, immediate, future });
    }
  }
  return {
    attackers,
    volleys: game.config?.balance?.actionsPerTurn ?? 5,
    minDamage: game.config?.balance?.minimumDamage ?? 1,
  };
}

/** 该单位本回合还能不能再接一个动作：已激活的单位不再耗行动点。 */
function canAct(unit, ctx) {
  return unit.actionSpent || ctx.budget > 0;
}

/** 攻击效用：期望伤害 + 击杀奖励 − 反击风险。 */
function attackOptions(game, owner, utils, ctx) {
  const options = [];
  for (const a of utils.livingUnits(game, owner)) {
    if (a.hasActed || !canAct(a, ctx)) continue;
    for (const target of ctx.targets) {
      const e = target.entity;
      if (utils.hexDistance(a, e) > a.attackRange) continue;
      const raw = (a.attack ?? 0) - (e.defense || 0);
      const avg = Math.max(ctx.minDamage, raw);
      const worst = Math.max(ctx.minDamage, raw - ctx.variance);
      const isHq = target.kind === 'headquarters';
      const killValue = isHq ? HQ_KILL_UTILITY : unitValue(e);
      // 总部是唯一可磨的胜利资源，且裁定按敌方总部受伤计分：伤害项加压制系数
      let utility = Math.min(avg, e.hp) * DAMAGE_SCALE * (isHq ? HQ_DAMAGE_BONUS : 1);
      if (worst >= e.hp) utility += killValue;
      else if (avg >= e.hp) utility += killValue * 0.6;
      // 反击风险按"停留在原地"计：引擎允许打完再走一步，但实测把撤离后的承伤
      // 计入效用胜率不升反降（80 局对拍 38:42，且下一次 decide 未必真会撤），故保留保守估计。
      const counter = threatAt(a, a, ctx.zones, worst >= e.hp ? e.id : null);
      if (counter >= a.hp) utility -= unitValue(a) * LETHAL_PENALTY;
      else utility -= counter * THREAT_SCALE * (2 - a.hp / a.maxHp);
      options.push({
        type: 'attack',
        payload: { attackerId: a.id, targetId: e.id },
        utility,
      });
    }
  }
  return options;
}

/** 治疗效用：恢复量 + 危险队友加成（治疗等于预支其下回合的承伤）。 */
function healOptions(game, owner, utils, ctx) {
  const options = [];
  const healVariance = game.config?.balance?.healVarianceRange ?? 6;
  for (const s of utils.livingUnits(game, owner)) {
    if (s.type !== 'support' || s.hasActed || !canAct(s, ctx)) continue;
    const healRange = game.config?.units?.[s.type]?.healRange ?? s.attackRange;
    for (const ally of utils.livingUnits(game, owner)) {
      if (ally.hp >= ally.maxHp) continue;
      if (utils.hexDistance(s, ally) > healRange) continue;
      const missing = ally.maxHp - ally.hp;
      const amount = Math.min(missing, (s.healPower ?? 0) + healVariance / 2);
      let utility = amount * HEAL_SCALE;
      const danger = threatAt(ally, ally, ctx.zones);
      if (danger > 0) utility += Math.min(danger, missing) * THREAT_SCALE;
      options.push({
        type: 'heal',
        payload: { supportId: s.id, targetId: ally.id },
        utility,
      });
    }
  }
  return options;
}

/**
 * 位置效用：抢点 + 走位火力投射 − 落点威胁 + 推进 + 疏散 + 治疗贴身。
 * 移动与原地共用同一函数，最终比较的是增量。
 * ownCells 显式传入：评估某个落点时不含该单位自己占的格。
 */
function positionUtility(game, owner, utils, ctx, unit, pos, ownCells) {
  const balance = game.config?.balance ?? {};
  const turnNo = game.turn?.turnNumber ?? 0;
  const maxTurns = balance.maxTurns ?? 15;
  let utility = 0;

  // 抢占据点：中立/敌方都算，敌方的净收益（+我 −敌）放大 1.5 倍；
  // 收入按据点种类取实际值（supply/repair/forward_base 差别很大），
  // 接近回合上限时占领直接影响裁定分，附加固定加分
  if (unit.canCapture) {
    const cp = (game.controlPoints || []).find(p => p.q === pos.q && p.r === pos.r && p.owner !== owner);
    if (cp) {
      const income = utils.cpKindEffect(game, cp)?.income ?? balance.controlPointIncome ?? 12;
      const turnsLeft = Math.max(1, maxTurns - turnNo);
      utility += CP_BASE_UTILITY + income * Math.min(turnsLeft, CP_INCOME_TURNS_CAP) * (cp.owner ? 1.5 : 1);
      if (turnNo >= maxTurns - 2) utility += LATE_GAME_UTILITY;
    }
  }

  // 走位后本回合还能打出的伤害（下一次 decide 会直接兑现）
  if (!unit.hasActed && canAct(unit, ctx)) {
    let best = 0;
    for (const target of ctx.targets) {
      const e = target.entity;
      if (utils.hexDistance(pos, e) > unit.attackRange) continue;
      const raw = (unit.attack ?? 0) - (e.defense || 0);
      const avg = Math.max(ctx.minDamage, raw);
      let value = Math.min(avg, e.hp) * DAMAGE_SCALE;
      if (Math.max(ctx.minDamage, raw - ctx.variance) >= e.hp) {
        value += (target.kind === 'headquarters' ? HQ_KILL_UTILITY : unitValue(e)) * 0.6;
      }
      if (value > best) best = value;
    }
    utility += best * OPPORTUNITY_DISCOUNT;
  }

  // 落点威胁：残血加倍，致命格近乎禁止
  utility -= threatPenalty(unit, pos, ctx.zones);

  // 向目标推进；支援单位改为贴身最受伤友军/留守总部
  const goal = unit.type === 'support' ? ctx.supportGoals.get(unit.id) : ctx.movementGoals.get(unit.id);
  if (goal) utility -= utils.hexDistance(pos, goal) * PROGRESS_SCALE;

  // 轻微疏散：与过多友军贴脸略降分
  let adjacentFriends = 0;
  for (const n of utils.neighbors(pos)) {
    if (ownCells.has(`${n.q},${n.r}`)) adjacentFriends++;
  }
  utility -= Math.max(0, adjacentFriends - 1) * CROWD_PENALTY;

  // 残血时贴近未行动的治疗者
  if (unit.hp < unit.maxHp * 0.5) {
    const guarded = utils.livingUnits(game, owner).some(s =>
      s.type === 'support' && !s.hasActed && s.id !== unit.id &&
      utils.hexDistance(pos, s) <= (game.config?.units?.[s.type]?.healRange ?? s.attackRange));
    if (guarded) utility += HEAL_GUARD_BONUS;
  }

  // 已站在可占格上的单位回合结束同样会完成占领，故抢点项对原地同样生效。
  return utility;
}

/** 移动效用：逐格评估取最优，与原地比较取增量。 */
function moveOptions(game, owner, utils, ctx) {
  const options = [];
  const allCells = new Set(utils.livingUnits(game, owner).map(u => `${u.q},${u.r}`));

  for (const u of utils.livingUnits(game, owner)) {
    if (u.hasMoved || !canAct(u, ctx)) continue;
    const reachable = utils.reachableCells(game, u);
    if (reachable.length === 0) continue;

    const ownCells = new Set([...allCells].filter(k => k !== `${u.q},${u.r}`));
    const stayUtil = positionUtility(game, owner, utils, ctx, u, u, ownCells);
    let best = null;
    for (const cell of reachable) {
      const util = positionUtility(game, owner, utils, ctx, u, cell, ownCells);
      if (!best || util > best.util) best = { cell, util };
    }
    const delta = best.util - stayUtil;
    if (delta > 0) {
      options.push({
        type: 'move',
        payload: { unitId: u.id, q: best.cell.q, r: best.cell.r },
        utility: delta,
      });
    }
  }
  return options;
}

/** 爆破效用：只炸"拆了确实更接近目标"的墙。 */
function demolishOptions(game, owner, utils, ctx) {
  const options = [];
  if ((game.turn?.turnNumber ?? 0) < 4) return options;
  for (const h of utils.livingUnits(game, owner)) {
    if (h.type !== 'heavy' || h.hasActed || !canAct(h, ctx)) continue;
    const goal = ctx.movementGoals.get(h.id);
    if (!goal) continue;
    const distToGoal = utils.hexDistance(h, goal);
    for (const pos of utils.neighbors(h)) {
      if (!utils.isPlayable(game, pos)) continue;
      if (utils.terrainAt(game, pos) !== 'blocker') continue;
      if (utils.occupantAt(game, pos)) continue;
      // 只要求墙比脚下更接近目标：连续障碍带里墙后往往还是墙，
      // 要求"墙后必是空地"会让重装在有城墙的图上永不拆墙（实测 breach 图 0 胜）。
      if (utils.hexDistance(pos, goal) >= distToGoal) continue;
      options.push({
        type: 'demolish',
        payload: { unitId: h.id, q: pos.q, r: pos.r },
        utility: DEMOLISH_UTILITY,
      });
    }
  }
  return options;
}

/**
 * 部署候选：走 game-utils 的公共实现（与 mcts 共用一份，避免拷贝各自漂移）。
 * 两条必须守住的约束：
 *   1）调用点必须排在"无事可做就结束回合"的判定之前 —— 否则部队被全歼或全员已行动完时
 *      options 为空会直接 endTurn，造成"兵力只减不增"（实测整局零动作、补给一分不花）；
 *   2）是否执行由 decide 按 DEPLOY_UTILITY 与战斗动作同尺度比较，保证稳杀/磨总部优先于补员。
 */
/** 决策上下文：整回合共用，逐动作复用同一份威胁图与目标表。 */
function buildContext(game, owner, utils) {
  const myUnits = utils.livingUnits(game, owner);
  const movementGoals = new Map();
  const supportGoals = new Map();
  for (const u of myUnits) {
    movementGoals.set(u.id, utils.movementGoal(game, owner, u));
    const wounded = myUnits
      .filter(w => w.id !== u.id && w.hp < w.maxHp)
      .sort((a, b) => (b.maxHp - b.hp) - (a.maxHp - a.hp));
    supportGoals.set(u.id, wounded[0] || game.headquarters?.[owner] || movementGoals.get(u.id));
  }
  return {
    zones: buildThreatZones(game, owner, utils),
    targets: utils.enemyTargets(game, owner),
    variance: game.config?.balance?.damageVarianceRange ?? 3,
    minDamage: game.config?.balance?.minimumDamage ?? 1,
    budget: utils.actionsRemaining(game),
    movementGoals,
    supportGoals,
  };
}

/**
 * 威胁感知算法导出接口
 */
export default {
  name: 'threat',
  description: '威胁感知：威胁图统一效用评估，集火斩杀、避险走位、残血后撤',

  async decide(game, utils) {
    const owner = game.turn?.currentPlayerId || game.turn?.currentOwner;
    if (!owner) return null;

    const ctx = buildContext(game, owner, utils);
    const options = [
      ...attackOptions(game, owner, utils, ctx),
      ...healOptions(game, owner, utils, ctx),
      ...moveOptions(game, owner, utils, ctx),
      ...demolishOptions(game, owner, utils, ctx),
    ];
    options.sort((a, b) => b.utility - a.utility);
    const best = options[0];

    // 部署与战斗动作同一尺度比较：没有值得打的仗/抢的点时才补员。
    // 它必须排在"无事可做"判定之前：部队被全歼、或全员已行动完时 options 为空，
    // 但剩下白给的运动点仍然应当用来补员（先判空会退化成“兵力只减不增”，实测会整局零动作）。
    if (!best || best.utility < DEPLOY_UTILITY) {
      const deploy = utils.deployDecision(game, owner);
      if (deploy) return deploy;
    }

    // 只剩零碎收益时结束回合（注意：返回 null 会直接 endTurn，门槛必须远小于 PROGRESS_SCALE）
    if (!best || best.utility <= MIN_ACTION_UTILITY) return null;
    return { type: best.type, payload: best.payload };
  },
};
