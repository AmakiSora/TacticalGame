// algorithms/builtin/field.mjs
//
// 势场算法（Artificial Potential Field）
// 把棋盘建成一张连续的势场：敌方火力 = 斥力井（以"敌方下回合可站的位置 ∪
// 射程环"为核心，再向外按环衰减，半径外势为 0），阵地 = 引力井（中立/敌方
// 据点按"剩余回合期望收入"计深，多单位挤向同一点时按认领数指数摊薄），
// 推进 = 从目标点出发的波前距离场（真实绕行步距）。每个单位的候选落点
// （原地 + BFS 可达格）都查一次"势能 − 机会火力"，取全局最优；
// 攻击/治疗/部署/爆破折算成同尺度的收益，与移动同台竞标。
//
// 与 greedy 的区别：不是固定优先级阶梯，全动作统一比较；
// 与 threat 的区别：threat 是单步效用（逐项手工量纲），field 是连续场塑形——
//   斥力按环距衰减，天然给出"越远越安全"的梯度而不是二值的进/退；
//   据点井的认领衰减让多个单位分头抢点（而不是全员挤向同一个最优点）；
//   推进用波前距离场，单位沿真实绕行路线流动、不会顶在墙根（APF 的
//   经典局部极小值，纯直线距离在 breach 图上实测只有 37% 胜率）；
// 与 mcts 的区别：无搜索无模拟，全部查表，p50 0.1ms 量级。
//
// 涌现行为（不是写死的规则）：
//   - 风筝走位：远程单位把"机会火力 × 折扣"计入落点评估，而贴脸格势高，
//     两者平衡的结果是停在射程边缘（实测游侠对重装：距 5 格时落到距 3 格，
//     打完则回撤到敌方打击范围外）
//   - 分头抢点：友军认领使井深 × 0.6^认领数，第二个单位自然转向无人认领的点
//   - 残血后撤：斥力惩罚随失血放大（2 − hp/maxHp），无需专门写撤退规则
//   - 绕障流动：波前距离场让单位沿缺口绕行，而不是贴着墙推
//
// 尺度自适应：小图（六边形半径 ≤ 6）没有纵深，斥力外圈收 1 环、据点井收 4 格；
// 大图用 2 环 / 5 格。理由与实测见 mapProfile 注释。
//
// 约束（与 threat 同源，见 algorithms/lib/interfaces.mjs）：
//   - decide 返回 null = 结束整个回合，故 STOP_POTENTIAL 门槛极小
//   - 所有耗行动点的动作必须过 canAct 门控，否则 runner 遇错 break 丢整回合
//
// utils.enemyTargets 目标结构为 { kind: 'unit' | 'headquarters', entity }

// ─── 常数：伤害换算基准（与 threat 的 DAMAGE_SCALE=6 同量纲） ───
/** 1 点期望伤害的势能削减。 */
const DAMAGE_SCALE = 6;
/** 1 点治疗量的势能削减。 */
const HEAL_SCALE = 8;
/** 稳杀的额外势能削减：等于目标价值 × 该系数。 */
const KILL_REWARD = 0.85;
/** 大概率击杀（期望≥血量但掷骰下限不稳）的击杀折扣。 */
const LIKELY_KILL_DISCOUNT = 0.6;
/** 敌方总部被磨平 = 胜利，势能按"无穷好"处理。 */
const HQ_KILL_POTENTIAL = 5000;
/** 对总部伤害的压制系数（裁定分按敌方 HQ 受伤 ×5 计权）。 */
const HQ_DAMAGE_BONUS = 1.3;

// ─── 斥力场（敌方火力井） ───
/** 斥力井基准深度：1 点潜在承伤 × 该系数 × 疲劳 = 落点势。
 *  与 threat 的标定平台一致（0.8；初版 1.15 过度避险，单位贴脸也不还手）。 */
const THREAT_SCALE = 0.8;
/** 敌方机动打击半径（外圈斥力环数）：大图 2 环、小图 1 环。
 *  半径 6 的 forge 上取 2 环会把中场盖满平坦威胁税、单位不进场
 *  （实测双种子 14/60，取 1 环后 43/60）；半径 ≥7 的大图取 2 环更稳
 *  （取 1 环后 default/dual-lanes/breach/desert 全线回落）。
 *  场的作用半径随场地尺度缩放，是势场类方法的常规做法。 */
const DANGER_RINGS_LARGE = 2;
const DANGER_RINGS_SMALL = 1;
/** 小图阈值：六边形半径 ≤ 该值按"近战档案"处理。 */
const SMALL_MAP_RADIUS = 6;
/** 敌方射程 ≥2 时远界打折：kiting 时最外圈的威胁确定性低。 */
const RANGED_EDGE_DISCOUNT = 0.6;
/** 无限逼近致命势时的封顶：≈ 0.85 × 单位价值。 */
const LETHAL_PENALTY = 0.85;

// ─── 引力场 ───
/** 据点井基准深度：占领后按收入与剩余回合计价。 */
const CP_BASE = 70;
/** 据点收入计价的回合封顶。 */
const CP_INCOME_CAP = 8;
/** 敌方据点（净收益 +我 −敌）井深放大。 */
const CP_ENEMY_BONUS = 1.5;
/** 认领衰减：据点周围 2 格内每多一个友军，井深 × 该系数。 */
const CLAIM_DECAY = 0.6;
/** 驻军井：站上己方据点的单位被轻微锚住——敌人回收前必须先吃掉守军。 */
const GARRISON_BONUS = 30;
/** 据点井作用半径（格）：大图 5（给远处目标感）、小图 4（见尺度档案说明）。 */
const CP_WELL_REACH_LARGE = 5;
const CP_WELL_REACH_SMALL = 4;
/** 接近回合上限时占领直接决定裁定分。 */
const LATE_GAME_BONUS = 80;
/** 向引力目标每推进 1 格的势能下降（缓坡引导流动方向）。 */
const PROGRESS_SCALE = 4;
/** 敌方总部井深（磨总部是唯一淘汰路径）。 */
const HQ_GOAL_DEPTH = 26;
/** 早期敌井收缩：前 3 回合总部防御完整，别白白送兵压上去。 */
const HQ_EARLY_DECAY = 0.55;

// ─── 队形与支援 ───
/** 贴脸友军每多一个的拥挤势。 */
const CROWD_PENALTY = 6;
/** cohesion 拉扯：距最近友军 2-3 格时每格轻拉。 */
const COHESION_SCALE = 1.5;
/** 残血贴治疗者的势能削减。 */
const HEAL_GUARD_BONUS = 25;
/** 残血判定阈值。 */
const WOUNDED_RATIO = 0.5;

// ─── 动作竞标 ───
/** 移动后再攻击的折扣（下一 decide 才兑现）。 */
const OPPORTUNITY_DISCOUNT = 0.75;
/** 爆破势能削减：墙即障碍斥力，拆了就消。 */
const DEMOLISH_POTENTIAL = 90;
/** 部署基准势能削减：最优动作不超过它才补员（能补就补，稳杀/磨总部除外）。 */
const DEPLOY_POTENTIAL = 250;
/** 结束回合门槛：必须远小于 PROGRESS_SCALE，否则掐掉单格推进的整回合。 */
const STOP_POTENTIAL = 0.001;

/** 单位价值：底盘 + 3×补给成本（与 threat 同尺度）。 */
function unitValue(u) {
  return 120 + (u.cost || 50) * 3;
}

/**
 * 战场尺度（六边形半径）：势场的作用范围按它自适应。
 * 快照里没有 map.radius 字段，从可玩格反推。
 */
function mapRadius(game) {
  let radius = 0;
  for (const c of game.cells) {
    radius = Math.max(radius, Math.abs(c.q), Math.abs(c.r), Math.abs(c.q + c.r));
  }
  return radius;
}

/**
 * 尺度档案：小图走"近战档案"，大图走"机动档案"，差别在斥力环数与据点井半径。
 *
 * 小图（半径 ≤ 6）没有纵深：一次走位换不来 tempo（threat 在 danger-close 上
 * 记录过同款现象），而且 6 个据点井按半径 5 展开会织满整张图、把走位项盖住，
 * 于是"推进/绕行"不再是决策变量。故小图：据点井收到 4 格、斥力外圈只留 1 环。
 * 大图有纵深：斥力外圈 2 环、据点井半径 5，保留远距离目标感。
 *
 * 实测（vs greedy，各 30 局、逐局交替先手）：
 *   forge（半径 6，两套种子）：取 1 环 43/60；取 2 环 14/60（外圈盖满中场）
 *   default / dual-lanes / breach / desert（半径 8）：取 2 环 70%/83%/57%/87%，
 *   取 1 环则 breach 掉 20 个百分点
 */
function mapProfile(game) {
  return mapRadius(game) <= SMALL_MAP_RADIUS
    ? { rings: DANGER_RINGS_SMALL, cpReach: CP_WELL_REACH_SMALL }
    : { rings: DANGER_RINGS_LARGE, cpReach: CP_WELL_REACH_LARGE };
}

/**
 * 敌方威胁井集合。每个敌军贡献一个以"自身 BFS 可达格 ∪ 原地"为核心、
 * 向外 N 环衰减的斥力井（N 按战场尺度取 1 或 2）。落在敌打击半径内的格子按
 * 期望承伤计价，半径外势为 0 —— 距离产生安全，不需要二值的进/退判定。
 * 每格势值按敌方火力上限（volleys）截断：每个敌军每格只记一档（一次开火）。
 * 每条井记录贡献敌军 id：计算"稳杀后的残留威胁"时要剔除将死的目标。
 */
function buildEnemyWells(game, owner, utils, rings) {
  const balance = game.config?.balance ?? {};
  const actionsPerTurn = balance.actionsPerTurn ?? 5;
  const minDamage = balance.minimumDamage ?? 1;
  /**
   * cellKey → Map(enemyId → { dmg, weight, edge })。
   * 必须按敌军去重、每格只留最强档：大射程敌军（ranger 射程 3）的射程环
   * 会从多个核心格重复覆盖同一格，逐条累积等于把同一个敌人算成 5 次齐射
   * （实测把 41 点承伤放大到 205，越过"≥ 血量"触发致命惩罚，攻击全被压成负分）。
   * 每格每敌一档，正好对应"每个单位每回合只能开火一次"。
   */
  const wells = new Map();
  const key = (q, r) => `${q},${r}`;
  const put = (q, r, id, dmg, weight, edge) => {
    const k = key(q, r);
    let entries = wells.get(k);
    if (!entries) wells.set(k, entries = new Map());
    const prev = entries.get(id);
    if (!prev) entries.set(id, { dmg, weight, edge });
    else if (weight > prev.weight) entries.set(id, { dmg, weight, edge: edge || prev.edge });
    else if (edge) prev.edge = true;
  };

  for (const seat of utils.enemySeats(game, owner)) {
    for (const e of utils.livingUnits(game, seat)) {
      const range = e.attackRange ?? 1;
      const core = new Set([key(e.q, e.r)]);
      for (const c of utils.reachableCells(game, e)) core.add(key(c.q, c.r));

      // 核心区（敌方下回合可站的位置）+ 射程环 = 强斥力
      for (const k of core) {
        const [q, r] = k.split(',').map(Number);
        for (let dq = -range; dq <= range; dq++) {
          const drLo = Math.max(-range, -dq - range);
          const drHi = Math.min(range, -dq + range);
          for (let dr = drLo; dr <= drHi; dr++) {
            put(q + dq, r + dr, e.id, Math.max(minDamage, (e.attack ?? 0)), 1.0, false);
          }
        }
      }
      // 外圈：从核心区再外扩 rings 格，指数衰减
      const outer = new Set();
      for (const k of core) {
        const [q, r] = k.split(',').map(Number);
        for (let dq = -rings; dq <= rings; dq++) {
          const drLo = Math.max(-rings, -dq - rings);
          const drHi = Math.min(rings, -dq + rings);
          for (let dr = drLo; dr <= drHi; dr++) {
            const nk = key(q + dq, r + dr);
            if (core.has(nk)) continue;
            outer.add(nk);
          }
        }
      }
      const outerWeight = Math.pow(0.5, rings);
      for (const k of outer) {
        const [q, r] = k.split(',').map(Number);
        put(q, r, e.id, Math.max(minDamage, e.attack ?? 0), outerWeight, range >= 2);
      }
    }
  }
  return { wells, volleys: actionsPerTurn, minDamage };
}

/**
 * 原始期望承伤（伤害量纲，未经 THREAT_SCALE/疲劳放大）：
 * u 站在 (q, r) 下一敌方回合可能吃到的弹量合计，按敌方火力上限截断。
 * 攻击选项的致命判定用它跟血量比（量纲一致）；落点势用 threatPotential。
 */
function wellDamage(q, r, u, zones, excludeId = null) {
  const entries = zones.wells.get(`${q},${r}`);
  if (!entries) return 0;
  const volleys = [];
  for (const [id, w] of entries) {
    if (id === excludeId) continue;
    const dmg = Math.max(zones.minDamage, w.dmg - (u.defense || 0));
    volleys.push(dmg * w.weight * (w.edge ? RANGED_EDGE_DISCOUNT : 1));
  }
  volleys.sort((a, b) => b - a);
  let total = 0;
  for (let i = 0; i < Math.min(volleys.length, zones.volleys); i++) total += volleys[i];
  return total;
}

/**
 * 落点的斥力势（效用/势能单位）：原始承伤 × THREAT_SCALE × 疲劳，按单位价值封顶。
 * fatigue：血量越低势越重（2 − hp/maxHp）。
 */
function threatPotential(q, r, u, zones, excludeId = null) {
  const raw = wellDamage(q, r, u, zones, excludeId);
  if (raw <= 0) return 0;
  const fatigue = 2 - u.hp / u.maxHp;
  return Math.min(unitValue(u) * LETHAL_PENALTY, raw * THREAT_SCALE * fatigue);
}

/**
 * 据点井基准深度（不含认领衰减）：占领收益按剩余回合的期望收入计价。
 * 认领衰减在 potential() 里按"评估单位之外的友军"逐次计算——
 * 放在这里会把评估单位自己也算成认领者，等于自己靠近目标反而削弱它。
 */
function cpBaseDepth(game, utils, cp, owner) {
  const balance = game.config?.balance ?? {};
  const income = utils.cpKindEffect(game, cp)?.income ?? balance.controlPointIncome ?? 12;
  const turnNo = game.turn?.turnNumber ?? 0;
  // maxTurns 为 null 是「无回合上限」：取 Infinity，收入由 CP_INCOME_CAP 截断、终局加成不触发。
  const maxTurns = balance.maxTurns === null ? Infinity : balance.maxTurns ?? 15;
  const turnsLeft = Math.max(1, maxTurns - turnNo);
  let depth = CP_BASE + income * Math.min(turnsLeft, CP_INCOME_CAP);
  if (cp.owner && cp.owner !== owner) depth *= CP_ENEMY_BONUS;
  // 接近回合上限时据点直接决定裁定分（裁定分里据点权重最重）：
  // 最后两回合把井加深，逼单位去抢点而不是继续遛弯。
  if (turnNo >= maxTurns - 2) depth += LATE_GAME_BONUS;
  return depth;
}

/**
 * 势场塑形核心：单位 u 若站在 pos 的势能。低 = 好。
 */
function potential(game, owner, utils, ctx, u, pos) {
  let phi = 0;

  // ── 斥力：敌方火力井 ──
  phi += threatPotential(pos.q, pos.r, u, ctx.zones);

  // ── 引力：据点井（canCapture 单位才被吸引）──
  if (u.canCapture) {
    for (const cp of game.controlPoints || []) {
      const d = utils.hexDistance(pos, cp);
      if (cp.owner === owner) {
        // 驻军：己方据点轻锚（贴点全额，1 格外消失）。占领后目标虽切走，
        // 井让单位留在点上——敌人回收前必须先击杀守军。
        if (d <= 1) phi -= GARRISON_BONUS / (1 + d);
        continue;
      }
      if (d > ctx.profile.cpReach) continue; // 井只影响近邻，远处交给 progress
      // 认领衰减：把"评估单位之外的贴点友军"算作认领者（自己不算，
      // 否则单位越靠近目标越削弱对它的引力），每多一个 × CLAIM_DECAY。
      // 分头抢点由此涌现：第一个到点的单位拿全值，后续单位转向别的点。
      let claims = 0;
      for (const f of ctx.friends) {
        if (f.id !== u.id && f.canCapture && utils.hexDistance(f, cp) <= 2) claims++;
      }
      const depth = (ctx.cpDepths.get(cp.id) ?? 0) * Math.pow(CLAIM_DECAY, claims);
      if (depth < 10) continue; // 认领过多已不值
      // 井形：格上全额深度，向外按距离衰减
      phi -= depth / (1 + d);
    }
  }

  // ── 引力：推进缓坡（movementGoal 同源：晚期压 HQ，中期抢点）──
  // 距离用波前距离场（真实绕行步距，目标不可达时退回直线距离）：
  // 纯直线梯度会把单位顶在墙根（APF 经典局部极小值，breach 实测 37% vs 57%）。
  // 也试过"带视线捷径的混合场"（直线畅通就按直线压上去）：default 高 10 个
  // 百分点，但 breach 低 20、desert 低 10，四图合计不如纯波前，故不保留。
  const goal = u.type === 'support' ? ctx.supportGoals.get(u.id) : ctx.goals.get(u.id);
  if (goal) {
    let scale = PROGRESS_SCALE;
    if (goal.hq === true) {
      // 敌方总部井：晚期全力、早期收缩（总部防御完整时别白送）。
      // 初版写成 `HQ_GOAL_DEPTH * turnNo <= 3`，被优先级解析成
      // (26×turnNo)≤3，只有第 0 回合才生效——必须先乘比较再选分支。
      scale = (game.turn?.turnNumber ?? 0) <= 3
        ? HQ_GOAL_DEPTH * HQ_EARLY_DECAY
        : HQ_GOAL_DEPTH;
    }
    const wave = ctx.goalFields.get(`${goal.pos.q},${goal.pos.r}`);
    const dPath = wave?.get(`${pos.q},${pos.r}`);
    phi += (dPath ?? utils.hexDistance(pos, goal.pos)) * scale;
  }

  // ── 队形：拥挤重罚 + 2-3 格 cohesion 轻拉 ──
  let adjacentFriends = 0;
  let nearestFriend = Infinity;
  for (const f of ctx.friends) {
    if (f.id === u.id) continue;
    const d = utils.hexDistance(pos, f);
    if (d === 1) adjacentFriends++;
    if (d < nearestFriend) nearestFriend = d;
  }
  phi += Math.max(0, adjacentFriends - 1) * CROWD_PENALTY;
  // 孤军无 cohesion：没有友军时 nearestFriend 保持 Infinity，
  // 初版直接代入会让所有落点势变成 Infinity、增量 NaN，
  // 于是场上只剩一个单位时它一个移动动作都不会生成（实测整回合空转）。
  if (Number.isFinite(nearestFriend) && nearestFriend > 2) {
    phi += (nearestFriend - 2) * COHESION_SCALE;
  }

  // ── 支援：残血贴未行动的治疗者 ──
  if (u.hp < u.maxHp * WOUNDED_RATIO) {
    for (const s of utils.livingUnits(game, owner)) {
      if (s.type !== 'support' || s.hasActed || s.id === u.id) continue;
      const healRange = game.config?.units?.[s.type]?.healRange ?? s.attackRange;
      if (utils.hexDistance(pos, s) <= healRange) {
        phi -= HEAL_GUARD_BONUS;
        break;
      }
    }
  }

  // ── 支援单位保排：support 不进敌井，锚定最伤友军/己方总部 ──
  if (u.type === 'support') {
    phi += threatPotential(pos.q, pos.r, u, ctx.zones) * 0.5; // 双倍避炮（斥力再放大）
  }

  return phi;
}

/** 攻击动作的势能削减（统一转成"收益"参与竞标）。 */
function attackOptions(game, owner, utils, ctx) {
  const options = [];
  const balance = game.config?.balance ?? {};
  const variance = balance.damageVarianceRange ?? 3;
  const minDamage = balance.minimumDamage ?? 1;

  for (const a of utils.livingUnits(game, owner)) {
    if (a.hasActed || !canAct(a, ctx)) continue;
    for (const target of ctx.targets) {
      const e = target.entity;
      if (utils.hexDistance(a, e) > a.attackRange) continue;
      const raw = (a.attack ?? 0) - (e.defense || 0);
      const avg = Math.max(minDamage, raw);
      const worst = Math.max(minDamage, raw - variance);
      const isHq = target.kind === 'headquarters';
      const killValue = isHq ? HQ_KILL_POTENTIAL : unitValue(e);
      let gain = Math.min(avg, e.hp) * DAMAGE_SCALE * (isHq ? HQ_DAMAGE_BONUS : 1);
      if (worst >= e.hp) gain += killValue * KILL_REWARD;
      else if (avg >= e.hp) gain += killValue * LIKELY_KILL_DISCOUNT;
      // 反击风险（伤害量纲，与血量同尺度）：下回合可能吃到的弹量。
      // 稳杀目标从井中剔除（死人不会开枪）。致命 → 按阵亡计；
      // 否则按原始承伤 × THREAT_SCALE × 疲劳折减（与 threat 同口径，
      // 初版误用"势能值 vs 血量"比较，斥力势普遍压过血量阈值，
      // 导致贴脸也从不还手，30 局 0 胜）。
      const counter = wellDamage(a.q, a.r, a, ctx.zones, worst >= e.hp ? e.id : null);
      if (counter >= a.hp) gain -= unitValue(a) * LETHAL_PENALTY;
      else gain -= counter * THREAT_SCALE * (2 - a.hp / a.maxHp);
      options.push({
        type: 'attack',
        payload: { attackerId: a.id, targetId: e.id },
        gain,
      });
    }
  }
  return options;
}

/** 治疗动作：恢复量 × HEAL_SCALE + 危险队友加成。 */
function healOptions(game, owner, utils, ctx) {
  const options = [];
  const balance = game.config?.balance ?? {};
  const healVariance = balance.healVarianceRange ?? 6;
  for (const s of utils.livingUnits(game, owner)) {
    if (s.type !== 'support' || s.hasActed || !canAct(s, ctx)) continue;
    const healRange = game.config?.units?.[s.type]?.healRange ?? s.attackRange;
    for (const ally of utils.livingUnits(game, owner)) {
      if (ally.hp >= ally.maxHp) continue;
      if (utils.hexDistance(s, ally) > healRange) continue;
      const missing = ally.maxHp - ally.hp;
      const amount = Math.min(missing, (s.healPower ?? 0) + healVariance / 2);
      let gain = amount * HEAL_SCALE;
      const danger = wellDamage(ally.q, ally.r, ally, ctx.zones);
      if (danger > 0) gain += Math.min(danger, missing) * THREAT_SCALE;
      options.push({
        type: 'heal',
        payload: { supportId: s.id, targetId: ally.id },
        gain,
      });
    }
  }
  return options;
}

/** 落点本回合还能打出的最高伤害（下一 decide 兑现）。 */
function fireGainAt(utils, ctx, u, pos) {
  let fire = 0;
  for (const target of ctx.targets) {
    const e = target.entity;
    if (utils.hexDistance(pos, e) > u.attackRange) continue;
    const raw = (u.attack ?? 0) - (e.defense || 0);
    const avg = Math.max(ctx.minDamage, raw);
    let value = Math.min(avg, e.hp) * DAMAGE_SCALE;
    if (Math.max(ctx.minDamage, raw - ctx.variance) >= e.hp) {
      value += (target.kind === 'headquarters' ? HQ_KILL_POTENTIAL : unitValue(e)) * LIKELY_KILL_DISCOUNT;
    }
    if (value > fire) fire = value;
  }
  return fire;
}

/**
 * 移动动作：逐格评估"势能 − 机会火力"，与原地同口径比较取降幅。
 * 火力项必须参与逐格比较：初版只在选定最优格后补减火力，结果安全的
 * 外围格总赢过"贴脸可开火"格，单位永远停在射程外（攻击 12.8 次/局 vs greedy 31.8）。
 * 不做距离折减——本引擎伤害与距离无关，"保持射程差"的走位偏好
 * 由斥力井几何天然给出（贴脸格势高，远程单位自动停在射程边缘）。
 */
function moveOptions(game, owner, utils, ctx) {
  const options = [];
  for (const u of utils.livingUnits(game, owner)) {
    if (u.hasMoved || !canAct(u, ctx)) continue;
    const reachable = utils.reachableCells(game, u);
    if (reachable.length === 0) continue;

    const canFire = !u.hasActed;
    const fireDiscount = canFire ? OPPORTUNITY_DISCOUNT : 0;
    const stayPhi = potential(game, owner, utils, ctx, u, u) -
      fireGainAt(utils, ctx, u, u) * fireDiscount;
    let best = null;
    for (const cell of reachable) {
      const phi = potential(game, owner, utils, ctx, u, cell) -
        fireGainAt(utils, ctx, u, cell) * fireDiscount;
      if (!best || phi < best.phi) best = { cell, phi };
    }
    const gain = stayPhi - best.phi;
    if (gain > 0) {
      options.push({
        type: 'move',
        payload: { unitId: u.id, q: best.cell.q, r: best.cell.r },
        gain,
      });
    }
  }
  return options;
}

/** 爆破：只拆"比脚下更接近目标"的墙（墙即障碍势，拆了就消）。 */
function demolishOptions(game, owner, utils, ctx) {
  const options = [];
  if ((game.turn?.turnNumber ?? 0) < 4) return options;
  for (const h of utils.livingUnits(game, owner)) {
    if (h.type !== 'heavy' || h.hasActed || !canAct(h, ctx)) continue;
    const goal = ctx.goals.get(h.id)?.pos;
    if (!goal) continue;
    const distToGoal = utils.hexDistance(h, goal);
    for (const pos of utils.neighbors(h)) {
      if (!utils.isPlayable(game, pos)) continue;
      if (utils.terrainAt(game, pos) !== 'blocker') continue;
      if (utils.occupantAt(game, pos)) continue;
      if (utils.hexDistance(pos, goal) >= distToGoal) continue;
      options.push({
        type: 'demolish',
        payload: { unitId: h.id, q: pos.q, r: pos.r },
        gain: DEMOLISH_POTENTIAL,
      });
    }
  }
  return options;
}

/**
 * 波前距离场：从 goal 出发对可走格（plain、忽略单位占位）做 BFS，
 * 得到"绕开障碍的真实步距"。直线距离会把单位顶在墙根（APF 经典局部极小值，
 * 初版 breach 图 37%），波前场让梯度沿缺口流动——这正是势场范式
 * 处理障碍的正统解法（navigation function）。
 */
function wavefrontField(game, utils, goal) {
  const dist = new Map();
  const key = (p) => `${p.q},${p.r}`;
  if (!utils.isPlayable(game, goal)) return dist;
  dist.set(key(goal), 0);
  const queue = [goal];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    const d = dist.get(key(cur));
    for (const n of utils.neighbors(cur)) {
      const k = key(n);
      if (dist.has(k)) continue;
      if (!utils.isPlayable(game, n)) continue;
      if (utils.terrainAt(game, n) !== 'plain') continue;
      dist.set(k, d + 1);
      queue.push(n);
    }
  }
  return dist;
}

/** 该单位本回合还能不能再接一个动作：已激活的单位不再耗行动点。 */
function canAct(unit, ctx) {
  return unit.actionSpent || ctx.budget > 0;
}

/**
 * 决策上下文：整回合共用一份威胁井、目标表、据点井深、推进目标。
 * goals 为 { pos, hq } —— hq 标记目标是否为敌方总部（早期收缩敌井）。
 */
function buildContext(game, owner, utils) {
  const profile = mapProfile(game);
  const myUnits = utils.livingUnits(game, owner);
  const goals = new Map();
  const supportGoals = new Map();
  for (const u of myUnits) {
    const g = utils.movementGoal(game, owner, u);
    const isEnemyHq = g && game.headquarters && Object.entries(game.headquarters).some(
      ([seat, h]) => seat !== owner && h && h.q === g.q && h.r === g.r
    );
    goals.set(u.id, g ? { pos: g, hq: isEnemyHq } : null);

    // 支援单位不冲敌方总部：锚定最受伤的友军（无伤员时留守己方总部）
    if (u.type === 'support') {
      const wounded = myUnits
        .filter(w => w.id !== u.id && w.hp < w.maxHp)
        .sort((a, b) => (b.maxHp - b.hp) - (a.maxHp - a.hp))[0];
      const anchor = wounded || game.headquarters?.[owner];
      supportGoals.set(u.id, anchor ? { pos: anchor, hq: false } : null);
    }
  }

  // 波前距离场缓存：同一目标坐标整回合复用一份 BFS
  const goalFields = new Map();
  for (const g of [...goals.values(), ...supportGoals.values()]) {
    if (!g) continue;
    const k = `${g.pos.q},${g.pos.r}`;
    if (!goalFields.has(k)) goalFields.set(k, wavefrontField(game, utils, g.pos));
  }
  const cpDepths = new Map();
  for (const cp of game.controlPoints || []) {
    cpDepths.set(cp.id, cpBaseDepth(game, utils, cp, owner));
  }
  return {
    zones: buildEnemyWells(game, owner, utils, profile.rings),
    targets: utils.enemyTargets(game, owner),
    variance: game.config?.balance?.damageVarianceRange ?? 3,
    minDamage: game.config?.balance?.minimumDamage ?? 1,
    budget: utils.actionsRemaining(game),
    goals,
    supportGoals,
    goalFields,
    cpDepths,
    friends: myUnits,
    profile,
  };
}

/**
 * 势场算法导出接口
 */
export default {
  name: 'field',
  description: '势场算法：连续势场塑形，风筝走位、分头抢点、雁行队形',

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
    options.sort((a, b) => b.gain - a.gain);
    const best = options[0];

    // 部署与战斗动作同一尺度竞标：必须排在"无事可做"判定之前，
    // 否则全军覆没时 options 为空 → 直接 endTurn → 永不补员（threat 同款坑）。
    if (!best || best.gain < DEPLOY_POTENTIAL) {
      const deploy = utils.deployDecision(game, owner);
      if (deploy) return deploy;
    }

    if (!best || best.gain <= STOP_POTENTIAL) return null;
    return { type: best.type, payload: best.payload };
  },
};
