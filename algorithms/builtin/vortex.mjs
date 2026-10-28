/**
 * vortex —— 歼灭模式专用算法（收缩圈旋涡）。
 *
 * 设计目标：在 annihilation（含收缩圈）规则下最大化裁定分。
 * 裁定口径（artillery-zone / trench-run 同）：armyValue 权重 2（按 hp/maxHp 折算）、
 * killValue 权重 0.5（仅手动最后一击计分）、总部伤害/占领/补给权重 0。
 * 由此推出的三条铁律：
 *   1) 保存己方血量比拿击杀更值钱（2 : 0.5），除非是零代价或决定性击杀；
 *   2) 补给/占领本身不计分 → 囤补给是纯浪费，应尽快折算成 armyValue（激进补员）；
 *   3) 炮火在轮界对危险格内的单位结算满额伤害（engine.advanceTurn：先 roundNumber++，
 *      后 updateArtilleryForRound）→ 本回合结束时的站位必须按 round+1 的安全半径校验，
 *      hp ≤ 炮伤且无法撤出的"注定单位"应转为免费输出，不再浪费动作保护。
 *
 * 核心机制：
 *   - 收缩圈预判：按引擎公式 shrinkCount/safeRadius 计算 round+1 危险集；
 *     圈内单位获得硬性疏散收益，走进圈内受重罚，注定单位豁免并加"白打不亏"奖励。
 *   - 集火斩杀：最坏情况伤害线（atk − def − variance）≥ 目标 hp 判定为稳杀，
 *     稳杀 > 可能杀 > 磨血；总部 hp1/def0，射程内必杀，且收益压倒一切（直接终局）。
 *   - 走位后免费跟攻：移动与攻击共享一次激活（移动后 actionSpent 置位，攻击免费），
 *     走位收益中计入落点的后续攻击期望（折扣权重），天然形成 ranger 三格风筝。
 *   - 治疗双安全：治疗要求支援与目标双方都不在炮火区（combat.healTarget 同口径），
 *     额外跳过"下轮圈内且 hp ≤ 炮伤"的目标（治了也白治）。
 *   - 激进补员：只要 AP 有剩、原点/落点当前与下轮都安全、威胁可接受就补员；
 *     优先 ranger（射程 3，圈中生存与输出双优），重伤多时优先 support。
 *
 * 合法性镜像（轮次制任何一次拒绝都会中止整回合，interfaces.mjs 同步机制）：
 *   attack  : !hasActed && (actionSpent || budget>0)，距离 ≤ attackRange
 *   heal    : support 同上 + 双方 !inArtilleryDanger + 距离 ≤ healRange + 目标未满血
 *   move    : !hasMoved && (actionSpent || budget>0)，落点为无占用平地
 *   deploy  : actionsRemaining>0 + 原点/落点均不在当前炮火区 + 落点无占用平地 + 补给足够
 *   demolish: heavy、!hasActed、相邻 blocker 且无占用
 */

// ===== 权重常数（口径与 threat 的实测校准区间保持同尺度）=====
const DAMAGE_SCALE = 6;             // 每点期望伤害的效用
const HEAL_SCALE = 8;               // 每点治疗量的效用
const THREAT_SCALE = 0.8;           // 每点预期承伤的效用
const FUTURE_THREAT_RATIO = 0.7;    // 需移动才够得着的敌人威胁折扣
const LETHAL_PENALTY = 0.8;         // 遭致命反击时按 worth 扣减的比例
const COUNTER_RETREAT_DISCOUNT = 0.6; // 攻击后还有一次免费移动可撤离，反击风险打折
const MOVE_ATTACK_WEIGHT = 0.6;     // 走位落点后续攻击期望的折扣权重
const EVACUATE_BASE = 60;           // 疏散出下轮危险圈的基础收益
const SUICIDE_PENALTY = 2.2;        // 走进下轮危险圈的惩罚倍率
const SACRIFICE_BONUS = 60;         // 注定被炮火炸死的单位：任何正收益动作都白赚
const CP_CAPTURE = { supply: 70, forward_base: 130, repair: 50 }; // 抢点收益（kind → 分）
const CP_CAPTURE_DEFAULT = 50;
const PROGRESS_SCALE = 4;           // 每接近目标一格的推进收益
const SUPPORT_TETHER = 6;           // 支援兵离开最重伤队友的每格惩罚
const SUPPORT_TETHER_BONUS = 12;    // 支援兵保持在治疗范围内的贴身奖励
const ESCAPE_SCALE = 1.5;           // 落点每个空邻格（撤退路线）收益
const CROWD_PENALTY = 2;            // 落点每个己方邻居的拥挤惩罚
const DEMOLISH_UTILITY = 90;
const DEPLOY_UTILITY = 250;
const HQ_KILL_UTILITY = 20000;      // 总部击杀 = 直接终局，压倒一切
const HQ_DAMAGE_BONUS = 1.5;
const KILL_BONUS = 30;              // 稳杀收益 = KILL_BONUS × worth(目标)
const PROBABLE_KILL_RATIO = 0.6;    // 平均伤害够杀（方差可能不够）时的折扣
const MIN_ACTION_UTILITY = 0.001;   // 低于此值直接结束回合（远小于 PROGRESS_SCALE）
const MOVE_EPS = 0.5;
const DEPLOY_THREAT_LIMIT = 20;     // 新兵落点的预期承伤上限

/** 单位价值：与成本挂钩的粗略换算（infantry≈103 / support≈124 / heavy≈169）。 */
function unitWorth(u) {
  return 40 + 1.4 * (u.cost ?? 0);
}

/** 把以 center 为中心、range 半径的六角环写进集合（key: "q,r"）。 */
function stampRing(set, center, range) {
  for (let dq = -range; dq <= range; dq++) {
    const lo = Math.max(-range, -dq - range);
    const hi = Math.min(range, -dq + range);
    for (let dr = lo; dr <= hi; dr++) {
      set.add(`${center.q + dq},${center.r + dr}`);
    }
  }
}

/**
 * 单位是否"注定阵亡"：本轮结束时仍站在 round+1 危险圈内，且 hp ≤ 炮伤
 * （轮界先结算满额炮伤再轮到它行动 → 下轮开始前就会倒下）。
 */
function isDoomed(unit, ctx) {
  return Boolean(
    ctx.artillery
    && ctx.artillery.damage > 0
    && unit.hp <= ctx.artillery.damage
    && ctx.dangerNext(unit)
  );
}

/**
 * 决策上下文：整回合共用；decide 每次成功操作后都会拿到最新状态重建，
 * 因此集火/占点信息天然是新鲜的。
 */
function buildContext(game, owner, utils) {
  const balance = game.config?.balance ?? {};
  const minDamage = balance.minimumDamage ?? 1;
  const variance = balance.damageVarianceRange ?? 3;
  const healVariance = balance.healVarianceRange ?? 6;
  const budget = utils.actionsRemaining(game);
  const targets = utils.enemyTargets(game, owner);
  const myUnits = utils.livingUnits(game, owner);

  // 炮火收缩圈计划（非歼灭系模式为 null，全部危险逻辑自动旁路）
  const acfg = game.config?.annihilation?.artillery;
  let artillery = null;
  let dangerNext = () => false;
  if (acfg && game.artillery) {
    const round = game.turn?.roundNumber ?? 1;
    const radius = game.map?.radius ?? 6;
    const shrink = r => (r < acfg.startRound ? 0 : Math.floor((r - acfg.startRound) / acfg.intervalRounds) + 1);
    const safe = r => Math.max(acfg.minimumSafeRadius ?? 0, radius - shrink(r));
    const nextSafe = safe(round + 1); // 与 engine/artillery.ts 公式一致
    artillery = { damage: acfg.damage ?? 0, nextSafe };
    dangerNext = pos => utils.hexDistance(pos, { q: 0, r: 0 }) > nextSafe;
  }

  // 敌方威胁覆盖：每个敌人每轮最多攻击一次（hasActed 门闩），
  // 同格预期承伤取所有敌人中的最大值；需移动才够得着的敌人按比例打折。
  const threats = [];
  for (const seat of utils.enemySeats(game, owner)) {
    for (const e of utils.livingUnits(game, seat)) {
      const range = e.attackRange ?? 1;
      const dmg = Math.max(minDamage, e.attack ?? 0);
      const immediate = new Set();
      stampRing(immediate, e, range);
      const future = new Set(immediate);
      for (const c of utils.reachableCells(game, e)) stampRing(future, c, range);
      threats.push({ immediate, future, dmg });
    }
  }
  const incoming = pos => {
    let v = 0;
    for (const t of threats) {
      const key = `${pos.q},${pos.r}`;
      if (t.immediate.has(key)) v = Math.max(v, t.dmg);
      else if (t.future.has(key)) v = Math.max(v, t.dmg * FUTURE_THREAT_RATIO);
    }
    return v;
  };

  const cpByCell = new Map();
  for (const cp of game.controlPoints ?? []) cpByCell.set(`${cp.q},${cp.r}`, cp);

  return {
    owner, budget, targets, myUnits,
    minDamage, variance, healVariance,
    artillery, dangerNext, incoming, cpByCell,
  };
}

/** 一次攻击的毛收益（伤害 + 击杀线），供直接攻击与走位跟攻共用。 */
function attackGain(attacker, e, isHq, ctx) {
  const hp = e.hp ?? 1;
  const raw = (attacker.attack ?? 0) - (e.defense ?? 0);
  const avg = Math.max(ctx.minDamage, raw);
  const worst = Math.max(ctx.minDamage, raw - ctx.variance);
  let utility = Math.min(avg, hp) * DAMAGE_SCALE * (isHq ? HQ_DAMAGE_BONUS : 1);
  const killUtil = isHq ? HQ_KILL_UTILITY : KILL_BONUS * unitWorth(e);
  if (worst >= hp) utility += killUtil;                       // 最坏情况也够杀 → 稳杀
  else if (avg >= hp) utility += killUtil * PROBABLE_KILL_RATIO; // 期望够杀 → 可能杀
  return utility;
}

/** 攻击候选。反击风险按"原地承伤"保守估计：击杀目标后风险大幅消退。 */
function attackOptions(game, owner, utils, ctx) {
  const options = [];
  for (const a of ctx.myUnits) {
    if (a.hasActed || !(a.actionSpent || ctx.budget > 0)) continue;
    const doomed = isDoomed(a, ctx);
    for (const t of ctx.targets) {
      const e = t.entity;
      if (utils.hexDistance(a, e) > (a.attackRange ?? 1)) continue;
      const isHq = t.kind === 'headquarters';
      let utility = attackGain(a, e, isHq, ctx);
      if (doomed) {
        utility += SACRIFICE_BONUS; // 下轮开始前就没了 → 反击与承伤都不再有意义
      } else {
        const willKill = Math.max(ctx.minDamage, (a.attack ?? 0) - (e.defense ?? 0) - ctx.variance) >= (e.hp ?? 1);
        const risk = ctx.incoming(a) * (willKill ? 0.15 : 1);
        if (risk >= a.hp) utility -= unitWorth(a) * LETHAL_PENALTY * (willKill ? 0.2 : 1);
        else utility -= risk * THREAT_SCALE * COUNTER_RETREAT_DISCOUNT * (2 - a.hp / Math.max(1, a.maxHp));
      }
      options.push({ type: 'attack', payload: { attackerId: a.id, targetId: e.id }, utility });
    }
  }
  return options;
}

/** 治疗候选：支援与目标双方都必须在炮火区外（combat.healTarget 同口径）。 */
function healOptions(game, owner, utils, ctx) {
  const options = [];
  for (const s of ctx.myUnits) {
    if (s.type !== 'support' || s.hasActed || !(s.actionSpent || ctx.budget > 0)) continue;
    if (utils.inArtilleryDanger(game, s)) continue;
    const healRange = game.config?.units?.[s.type]?.healRange ?? (s.attackRange ?? 1);
    for (const ally of ctx.myUnits) {
      if (ally.hp >= ally.maxHp) continue;
      if (utils.inArtilleryDanger(game, ally)) continue;
      if (utils.hexDistance(s, ally) > healRange) continue;
      // 下轮圈内且扛不住炮伤的目标：治了也会在轮界被打掉，不浪费
      if (isDoomed(ally, ctx)) continue;
      const missing = ally.maxHp - ally.hp;
      const amount = Math.min(missing, (s.healPower ?? 0) + ctx.healVariance / 2);
      let utility = amount * HEAL_SCALE;
      const risk = ctx.incoming(ally);
      if (risk > 0) utility += Math.min(risk, missing) * THREAT_SCALE; // 治疗等于预支其承伤
      options.push({ type: 'heal', payload: { supportId: s.id, targetId: ally.id }, utility });
    }
  }
  return options;
}

/**
 * 位置效用（走位 = 新落点与原地的差值）：
 * 炮火圈安全 + 预期承伤 + 抢点 + 推进 + 支援贴身 + 撤退路线/拥挤。
 */
function positionUtility(game, owner, utils, ctx, unit, pos, opt = {}) {
  const from = { q: unit.q, r: unit.r };
  let u = 0;

  // 1) 炮火收缩圈：按 round+1 安全校验；注定单位豁免（省下动作做输出）
  if (ctx.artillery && !isDoomed(unit, ctx)) {
    const wasIn = ctx.dangerNext(from);
    const willIn = ctx.dangerNext(pos);
    if (wasIn && !willIn) u += EVACUATE_BASE + unitWorth(unit);
    else if (willIn) u -= (EVACUATE_BASE + unitWorth(unit)) * SUICIDE_PENALTY;
  }

  // 2) 预期承伤：残血单位更怕被打
  u -= ctx.incoming(pos) * THREAT_SCALE * (2 - unit.hp / Math.max(1, unit.maxHp));

  // 3) 抢点：只有 infantry/scout 能占领（endTurn 自动结算）
  const cp = ctx.cpByCell.get(`${pos.q},${pos.r}`);
  if (cp && unit.canCapture && cp.owner !== owner) {
    u += CP_CAPTURE[cp.kind] ?? CP_CAPTURE_DEFAULT;
  }

  // 4) 推进：向该单位的运动目标（最近敌总部等）靠近
  if (opt.goal) {
    u += PROGRESS_SCALE * (utils.hexDistance(from, opt.goal) - utils.hexDistance(pos, opt.goal));
  }

  // 5) 支援兵贴身：保持在最重伤队友的治疗范围内
  if (unit.type === 'support' && opt.wounded) {
    const healRange = game.config?.units?.support?.healRange ?? (unit.attackRange ?? 1);
    const d = utils.hexDistance(pos, opt.wounded);
    if (d <= healRange) u += SUPPORT_TETHER_BONUS;
    else u -= (d - healRange) * SUPPORT_TETHER;
  }

  // 6) 撤退路线与拥挤：空邻格多 = 圈收缩时更容易活
  let exits = 0;
  let crowd = 0;
  for (const n of utils.neighbors(pos)) {
    if (!utils.isPlayable(game, n)) continue;
    if (utils.isEmptyPlain(game, n)) exits += 1;
    const occ = utils.occupantAt(game, n);
    if (occ?.kind === 'unit' && occ.entity.owner === owner) crowd += 1;
  }
  u += exits * ESCAPE_SCALE - crowd * CROWD_PENALTY;

  return u;
}

/** 走位候选：落点效用差 + 落点后续免费攻击的期望（移动+攻击共享一次激活）。 */
function moveOptions(game, owner, utils, ctx) {
  const options = [];
  for (const u of ctx.myUnits) {
    if (u.hasMoved || !(u.actionSpent || ctx.budget > 0)) continue;
    const goal = utils.movementGoal(game, owner, u);
    const wounded = ctx.myUnits
      .filter(w => w.id !== u.id && w.hp < w.maxHp)
      .sort((a, b) => (b.maxHp - b.hp) - (a.maxHp - a.hp))[0];
    const stay = positionUtility(game, owner, utils, ctx, u, u, { goal, wounded });
    for (const pos of utils.reachableCells(game, u)) {
      if (!utils.isPlayable(game, pos) || !utils.isEmptyPlain(game, pos)) continue;
      let utility = positionUtility(game, owner, utils, ctx, u, pos, { goal, wounded }) - stay + MOVE_EPS;
      // 走位后的跟攻机会：移动置 actionSpent 后攻击免费（!hasActed 仍需成立）
      let followup = 0;
      for (const t of ctx.targets) {
        if (utils.hexDistance(pos, t.entity) > (u.attackRange ?? 1)) continue;
        followup = Math.max(followup, attackGain(u, t.entity, t.kind === 'headquarters', ctx));
      }
      utility += followup * MOVE_ATTACK_WEIGHT;
      if (utility > 0) {
        options.push({ type: 'move', payload: { unitId: u.id, q: pos.q, r: pos.r }, utility });
      }
    }
  }
  return options;
}

/** 拆障候选：仅重装、仅当障碍确实挡在去目标的路上（trench-run 类地图用）。 */
function demolishOptions(game, owner, utils, ctx) {
  const options = [];
  for (const h of ctx.myUnits) {
    if (h.type !== 'heavy' || h.hasActed || !(h.actionSpent || ctx.budget > 0)) continue;
    const goal = utils.movementGoal(game, owner, h);
    if (!goal) continue;
    const distToGoal = utils.hexDistance(h, goal);
    for (const pos of utils.neighbors(h)) {
      if (!utils.isPlayable(game, pos)) continue;
      if (utils.terrainAt(game, pos) !== 'blocker') continue;
      if (utils.occupantAt(game, pos)) continue;
      if (utils.hexDistance(pos, goal) >= distToGoal) continue;
      options.push({ type: 'demolish', payload: { unitId: h.id, q: pos.q, r: pos.r }, utility: DEMOLISH_UTILITY });
    }
  }
  return options;
}

/**
 * 补员候选：把囤积的补给折算成 armyValue（补给在裁定中权重为 0）。
 * 合法性：AP 有剩 + 原点/落点均不在当前炮火区 + 落点为无占用平地；
 * vortex 附加约束：落点还必须在 round+1 安全圈内、预期承伤可接受。
 * 兵种顺序：重伤多先补 support，否则 ranger（射程 3）> scout > infantry > heavy > support。
 */
function deployOption(game, owner, utils, ctx) {
  if (ctx.budget <= 0) return null;
  const supplies = game.resources?.[owner]?.supplies ?? 0;
  const origins = utils.deployOrigins(game, owner)
    .filter(o => o.alive !== false && !utils.inArtilleryDanger(game, o));
  if (origins.length === 0) return null;

  const myUnits = ctx.myUnits;
  const damaged = myUnits.filter(u => u.hp < u.maxHp * 0.65).length;
  const supportCount = myUnits.filter(u => u.type === 'support').length;
  const order = [];
  if (damaged >= 2 && supportCount < 2) order.push('support');
  order.push('ranger', 'scout', 'infantry', 'heavy', 'support');

  const ref = utils.nearestEnemyHeadquarters(game, owner, origins[0]);
  const sorted = ref ? [...origins].sort((a, b) => utils.hexDistance(a, ref) - utils.hexDistance(b, ref)) : origins;

  for (const type of order) {
    if (!game.config?.units?.[type]) continue;
    for (const origin of sorted) {
      const cost = utils.effectiveDeployCost(game, type, origin);
      if (supplies < cost) continue;
      for (const pos of utils.neighbors(origin)) {
        if (!utils.isEmptyPlain(game, pos)) continue;
        if (utils.inArtilleryDanger(game, pos)) continue;   // 引擎硬校验
        if (ctx.dangerNext(pos)) continue;                  // 下轮圈内 = 白给
        if (ctx.incoming(pos) >= DEPLOY_THREAT_LIMIT) continue; // 别把新兵喂到枪口上
        return {
          type: 'deploy',
          payload: { unitType: type, fromId: origin.id, q: pos.q, r: pos.r },
          utility: DEPLOY_UTILITY,
        };
      }
    }
  }
  return null;
}

/**
 * vortex 决策入口。流程与 threat 的实测可靠结构一致：
 * 选项按效用排序 → 部署检查必须放在"无事可做"判定之前（部队打光时 options 为空，
 * 但剩 AP 仍应补员）→ 效用低于门槛直接结束回合。
 */
export default {
  name: 'vortex',
  description: '旋涡：炮火收缩圈预判疏散、稳杀集火、走位风筝、激进补员',

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

    // 部署与战斗动作同一尺度比较：没有值得打的仗时才补员。
    // 必须先于"无事可做"判定：全员行动完时 options 为空，但剩 AP 仍应补员。
    if (!best || best.utility < DEPLOY_UTILITY) {
      const deploy = deployOption(game, owner, utils, ctx);
      if (deploy) return { type: deploy.type, payload: deploy.payload };
    }

    // 只剩零碎收益时结束回合（返回 null 会直接 endTurn，门槛必须远小于 PROGRESS_SCALE）
    if (!best || best.utility <= MIN_ACTION_UTILITY) return null;
    return { type: best.type, payload: best.payload };
  },
};
