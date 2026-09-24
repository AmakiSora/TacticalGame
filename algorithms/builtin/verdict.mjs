// algorithms/builtin/verdict.mjs
//
// 裁决线算法（Backward Induction over Verdict Lines）
//
// 与已有四个内置算法的范式区别：
//   greedy  固定优先级阶梯；random 无策略；mcts 前向采样搜索；
//   threat  单步效用（各项手工量纲，常数权重）；field  连续势场（斥力井+引力井）。
//   verdict 不评估"这一步好不好"，而是先回答"**这局我用哪条线赢**"，
//   再从那个终局**倒推**回本回合每个单位该干什么 —— 前向打分 → 反向规划。
//
// ─── 第一步：账本（所有动作统一以"裁决分"计价）───
// 引擎的终局裁决分是可解析的（src/engine/engine.ts scorePlayer）：
//   total = 对敌总部累计伤害 × w.enemyHqDamage
//         + 己方总部剩余血 × w.ownHqHp
//         + 持有据点数 × w.controlPoint
//         + 军队价值（造价×血量比）× w.armyValue
//         + 补给 × w.supplies + 行动功绩
// 权重随地图变化（default 是 5/2/90/2/1，danger-close 是 20/1/30/1/0）。
// 本算法把**每一个动作都折算成它能改变多少裁决分**，于是攻击、占点、治疗、
// 移动、部署第一次在同一个"货币"里可比 —— 不是手工配的效用常数，是引擎的记分规则本身。
// 几条直接掉出来的结论（default 图）：
//   · 游侠打总部 38 血 × 5 = 190 分，打步兵 24 血 × 0.9 = 21.6 分 → 差 9 倍
//   · 拿下一个中立据点 = 90 分 ≈ 击杀一个满血步兵（2×45 = 90 分）
//   · 部署一个步兵：花 45 补给（−45 分）换 45 造价军队（+90 分）= 净 +45 分
//
// ─── 第二步：三条裁决线 ───
//    斩首线  decap  敌方总部归零 = 立即获胜（不参与打分，价值拉满）
//    磨平线  wear   打不光也要磨：总部伤害是裁决里权重最高的可累积项
//    裁定线  hold   守到期末靠现有分差取胜（宁可不打，不可亏分）
//
// ─── 第三步：逆向排程（本算法的核心）───
// 斩首线不是"往总部走"，而是一条**带期限的排程**：从"总部归零"这个终局倒推，
// 每个单位有一个"最晚必须到位"的期限。逐回合推演：每回合的行动点先供赶路
// （每单位 1 个移动动作），余下的给已到位单位开火（单发伤害高的先吃行动点），
// 直到累计伤害 ≥ 总部剩余血 —— 得到**攻城回合数 killRound**。
//    slack = 剩余回合 − killRound
// slack 就是 tempo 预算，它直接决定全军的风险姿态：
//    slack ≥ 3  储备：杀得完，不急着换命，路上顺手拿据点、保住兵
//    0 ≤ slack  压上：刚好够，直线推进，容忍中等损失
//    killRound = null  磨平：打不完了，改成"每点总部伤害值多少分"的交换账
// 同一条排程反过来跑一遍敌方 → **敌人的斩首线**：如果对面比我更早拿下总部，
// 立刻放弃进攻、全线回防。四个已有算法都只看"我这步赚不赚"，没有这一步。
//
// ─── 第四步：tempo 量纲（ALGORITHMS_NOTES 里点名的共同短板）───
// 笔记的结论是：threat 输 danger-close（1 行动点/回合，避险换不来 tempo）、
// field 输 multiplayer-ring（7 行动点，井外不存在）—— 两者都缺"什么时候该接受亏损交换"。
// verdict 用交换裁决回答它：磨平线上，一次打击的得分 ≥ 本单位价值的 TRADE_RATIO 时，
// 明知道打完会被打死也照打（步兵换 24 点总部伤害 = 120 分 vs 阵亡代价 90 分 = 净赚）。
// 这个判据是算出来的，不是配出来的；行动点预算（1 AP 图上的赶路/开火争抢）
// 也已经包含在排程里，不需要额外的地图特判。
//
// ─── 约束（与 threat/field 同源）───
//   · decide 返回 null = 结束整个回合，故结束门槛必须极小
//   · 所有耗行动点的动作必须过 canAct 门控，否则 runner 遇错 break 丢整回合
//   · 部署判定必须排在"无事可做就结束回合"之前（否则兵力只减不增）
// utils.enemyTargets 目标结构为 { kind: 'unit' | 'headquarters', entity }

// ═══ 通用常数 ═══

/** 击杀的额外分：目标不只是一坨血量，还持续输出。按"折算出的输出威胁"计价。 */
const KILL_TEMPO = 0.5;
/** 斩首（把敌方总部打到 0）不是分数，是胜利本身。 */
const HQ_KILL_POINTS = 1e6;
/** 结束回合的分数门槛。必须远小于"走一步"的分（PACE_POINTS），否则会白掐回合。 */
const MIN_POINTS = 0.001;
/** 每走一步（离任务目标更近一格）值多少分的下限。 */
const PACE_POINTS = 5;

// ═══ 排程与姿态 ═══
/** slack ≥ 该值 → 储备姿态（杀得完，不急着换命）。 */
const RESERVE_SLACK = 3;
/** 敌方排程在这么多回合内能拿下我方总部 → 全线回防。 */
const EMERGENCY_ROUNDS = 3;
/** 攻城排程的回合计步上限，防止大图长尾。 */
const MAX_SIEGE_ROUNDS = 40;

/** 姿态 → 风险系数：>1 更怕死，<1 更敢换。这是"交换裁决"的实现方式——
 *  进攻（磨平线）把风险折小，于是"打一炮换一次挨打"划得来；
 *  储备（斩首线宽裕）把风险折大，于是宁可绕路也不换命。 */
const POSTURE_RISK = {
  reserve: 1.35,
  press: 0.9,
  trade: 0.65,
  fortress: 1.6,
  rally: 0.8,
};
/** 姿态 → 占点的额外估值系数：进攻线上顺手才拿，守成线上必须拿。 */
const POSTURE_CAPTURE = {
  reserve: 0.5,
  press: 0.15,
  trade: 0.1,
  fortress: 1.0,
  rally: 0.2,
};
/** 姿态 → 任务推进的急迫度（期限越紧，滞后的代价越高）。 */
const POSTURE_URGENCY = {
  reserve: 0.7,
  press: 1.6,
  trade: 1.0,
  fortress: 1.2,
  rally: 1.5,
};
/** 姿态 → 占身位的接战倾向。守成/回防时，"这里是个好火力位"不该盖过任务
 *  （实测：紧急回防时步兵为了挪到敌方总部隔壁（机会火力 90 分）而放弃了回家）；
 *  进攻时反而要把身位价值算足，因为身位就是下一回合的伤害。 */
const POSTURE_OFFENSE = {
  reserve: 1.0,
  press: 1.25,
  trade: 1.1,
  fortress: 0.5,
  rally: 0.25,
};

// ═══ 交换裁决 ═══
/** 走位后能兑现的打击按此折扣计入（下一次 decide 未必真能打成）。 */
const OPPORTUNITY_DISCOUNT = 0.75;
/** 敌方火力确定性折扣：原地即打的格子确定性高，需要先移动的确定性低。 */
const IMMEDIATE_WEIGHT = 1.0;
const MOVE_ATTACK_WEIGHT = 0.45;
/** 潜在承伤折算成"预期被打掉多少"，再按军队分计价。 */
const DAMAGE_EXPECTATION = 1.0;

/** 单步穿越敌方打击区的存活率：抵达概率 = 该值^危险步数。
 *  标定：0.72/0.62/0.55 三档在 7 图 ×30 局上实测 89.0% / 92.4% / **93.0%**；
 *  再往下（0.45/0.35）反而回落（multiplayer-ring 100%→60%/70%，排程过度悲观），
 *  故取 0.55。 */
const STEP_SURVIVAL = 0.55;
/** 抵达概率下限：再糟的路线也留一点念想，免得排程永远判"打不了"。 */
const MIN_ARRIVAL = 0.1;
/** 陆路不通（只能直线摸过去）时的抵达概率。 */
const FALLBACK_ARRIVAL = 0.3;

// ═══ 占点与守成 ═══
/** 守成姿态下，己方据点遭威胁的摆动系数（被夺 = 我 −90 + 敌 +90）。 */
const EXPOSED_CP_RISK = 0.6;
/** 回防到位收益按"挡住敌方几个回合的炮火"计价。 */
const DEFEND_HORIZON = 3;
/** 守成姿态下，驻守己方据点的奖励分。 */
const GARRISON_POINTS = 40;
/** 扎堆：每多一个贴脸友军扣的分。 */
const CROWD_POINTS = 6;
/** 部署门槛：最优动作得分低于"部署净收益 × 该系数"时就补员。 */
const DEPLOY_PRIORITY = 1.5;
/** 爆破墙的得分（等于换来若干步的推进）。 */
const DEMOLISH_POINTS = 60;

// ─── 六边形几何 ───

/** 格子的字符串键。 */
function key(p) {
  return `${p.q},${p.r}`;
}

/** 以 c 为中心、半径 range 内的全部格子键。 */
function ringKeys(range, c) {
  const out = [];
  for (let dq = -range; dq <= range; dq++) {
    const drLo = Math.max(-range, -dq - range);
    const drHi = Math.min(range, -dq + range);
    for (let dr = drLo; dr <= drHi; dr++) out.push(`${c.q + dq},${c.r + dr}`);
  }
  return out;
}

/** 只走平地（与 utils.isEmptyPlain 的可通行口径一致：水与墙都不可通行）。 */
function isPlain(game, utils, pos) {
  return utils.isPlayable(game, pos) && utils.terrainAt(game, pos) === 'plain';
}

// ─── 裁决账本 ───

/** 裁决权重：以地图配置为准，缺项回落到 default 图的档位。 */
function adjudicationWeights(game) {
  const w = game.config?.balance?.adjudicationWeights ?? {};
  return {
    hqDamage: w.enemyHqDamage ?? 5,
    ownHqHp: w.ownHqHp ?? 2,
    cp: w.controlPoint ?? 90,
    army: w.armyValue ?? 2,
    supplies: w.supplies ?? 1,
  };
}

/** 我方还剩几个回合可打（含本回合）。 */
function remainingRounds(game) {
  // maxTurns 为 null 是「无回合上限」：取 Infinity，由 MAX_SIEGE_ROUNDS 截断。
  const maxTurns = game.config?.balance?.maxTurns === null ? Infinity : game.config?.balance?.maxTurns ?? 15;
  const round = game.turn?.roundNumber ?? game.turn?.turnNumber ?? 1;
  return Math.max(1, Math.min(MAX_SIEGE_ROUNDS, maxTurns - round + 1));
}

/** 军队价值：与引擎 scorePlayer 同式（造价 × 血量比，四舍五入）。 */
function armyValue(game, utils, owner) {
  return utils.livingUnits(game, owner)
    .reduce((sum, u) => sum + Math.round((u.cost || 50) * (u.hp / Math.max(1, u.maxHp))), 0);
}

/**
 * 对敌总部已造成的累计伤害。
 * 客户端视角看不到 players[].stats.headquartersDamage，用"敌方总部掉了多少血"替代：
 * 2 人局两者完全相等；3-4 人局是"我方贡献"的上界（别人打的也算在我头上），
 * 会让多人局高估自己的分——但方向一致，不影响选线（多人局另见已知限制）。
 */
function hqDamageDealt(game, utils, owner) {
  let dmg = 0;
  for (const seat of utils.enemySeats(game, owner)) {
    const hq = game.headquarters?.[seat];
    if (!hq || hq.alive === false) continue;
    dmg += Math.max(0, (hq.maxHp ?? hq.hp) - hq.hp);
  }
  return dmg;
}

/** 席位当前分项（不含行动功绩：客户端视角看不到，且双方近似对称）。 */
function scoreOf(game, utils, owner, w) {
  const hq = game.headquarters?.[owner];
  const parts = {
    hqDamage: hqDamageDealt(game, utils, owner),
    ownHqHp: hq && hq.alive !== false ? hq.hp : 0,
    cps: (game.controlPoints || []).filter(cp => cp.owner === owner).length,
    army: armyValue(game, utils, owner),
    supplies: game.resources?.[owner]?.supplies ?? 0,
  };
  parts.total = parts.hqDamage * w.hqDamage
    + parts.ownHqHp * w.ownHqHp
    + parts.cps * w.cp
    + parts.army * w.army
    + parts.supplies * w.supplies;
  return parts;
}

// ─── 攻城排程（逆向归纳的核心）───

/**
 * 从总部格出发的波前距离场（BFS 步数）。只走平地、忽略单位阻挡 ——
 * 单位会移动，把友军当墙会让排程把整支军队算成"过不去"；
 * 用波前而不是直线距离，是因为 breach 这类有隔墙的图上直线会严重低估到达时间。
 * @returns {Map<string, number>} 格子键 → 步数
 */
function travelField(game, utils, origin) {
  const dist = new Map([[key(origin), 0]]);
  const queue = [{ q: origin.q, r: origin.r }];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    const d = dist.get(key(cur));
    for (const n of utils.neighbors(cur)) {
      const k = key(n);
      if (dist.has(k)) continue;
      if (!isPlain(game, utils, n)) continue;
      dist.set(k, d + 1);
      queue.push(n);
    }
  }
  return dist;
}

/**
 * 攻城排程：把"总部还差多少血"折算成"还要几个回合能打完"。
 *
 * 逐回合推演一个微缩的攻城战：每回合的行动点先供赶路单位移动（每单位 1 个移动动作，
 * 走 moveRange 格），剩下的行动点给已到位的单位开火（单发伤害从高到低吃行动点）。
 * 这就是"行动点预算"第一次被显式建模进算法：danger-close 那种 1 AP/回合的图上，
 * 排程会直接算出"赶路都不够，斩首不可达"，不需要给短图单独写特判。
 *
 * 排程是**上界**，但绝不能是**无条件**上界——两个必须扣掉的现实：
 *   1）路上会死人。一条被敌方火力全覆盖的走廊里抵达概率趋近于零，
 *      不折损就会对着永远打不到的终点无限乐观（dual-lanes 实测：排程恒报"3 回合可破"，
 *      整局往绞肉机里填人，胜率从 70% 掉到 53%）；
 *   2）打不光就是打不光。折损后的期望伤害才是"磨平线"能拿到多少分的依据。
 *
 * @param {Array<string>} seats - 进攻方席位（敌方排程时传多个席位 = 反我方联盟上界）
 * @param {object|null} zones - 敌方打击区（用于折损）；不传则不折损
 * @returns {{killRound: number|null, dealt: number, need: number, apPerRound: number,
 *            travelActions: number, curve: number[]}}
 */
function siegeTimeline(game, utils, seats, hq, rounds, zones = null) {
  const balance = game.config?.balance ?? {};
  const minDamage = balance.minimumDamage ?? 1;
  const perTurn = balance.actionsPerTurn ?? 5;
  const units = seats.flatMap(seat => utils.livingUnits(game, seat));
  // 每回合能投入攻城的行动点：受该方行动点预算与攻城部队规模双重限制
  const apPerRound = Math.max(1, Math.min(perTurn * seats.length, units.length));
  const field = travelField(game, utils, hq);
  const risk = zones ? riskyShares(game, utils, zones, hq) : null;

  const shooters = units
    .filter(u => (u.attack ?? 0) > 0)
    .map(u => {
      const steps = field.get(key(u));
      const standoff = Math.max(0, (u.attackRange ?? 1) - 1);
      const gap = steps === undefined
        ? Math.max(0, utils.hexDistance(u, hq) - standoff)   // 陆地不通：退回直线
        : Math.max(0, steps - standoff);
      // 抵达概率：只在赶路段折算，到位开火之后的风险交给走位层（cta 的 risk）处理
      const arrival = steps === undefined
        ? Math.pow(FALLBACK_ARRIVAL, 1)
        : Math.max(MIN_ARRIVAL, Math.pow(STEP_SURVIVAL, riskySteps(risk, gap)));
      return {
        id: u.id,
        travelLeft: Math.max(0, Math.ceil(gap / Math.max(1, u.moveRange ?? 1))),
        dmg: Math.max(minDamage, (u.attack ?? 0) - (hq.defense || 0)) * arrival,
      };
    });

  const need = Math.max(0, hq.hp);
  let dealt = 0;
  let travelActions = 0;
  let round = 0;
  let killRound = need <= 0 ? 0 : null;
  const curve = [0];

  while (round < rounds && killRound === null) {
    let ap = apPerRound;
    // 赶路优先：不到位的单位开不了火
    for (const s of shooters) {
      if (ap <= 0) break;
      if (s.travelLeft > 0) { s.travelLeft -= 1; ap -= 1; travelActions += 1; }
    }
    // 到位的开火，单发伤害高的先吃行动点（每次攻击固定 1 行动点）
    for (const s of shooters.slice().sort((a, b) => b.dmg - a.dmg)) {
      if (ap <= 0 || dealt >= need) break;
      if (s.travelLeft > 0) continue;
      dealt += s.dmg;
      ap -= 1;
    }
    round += 1;
    curve.push(Math.min(dealt, need));
    if (dealt >= need) killRound = round;
  }

  return { killRound, dealt: Math.min(dealt, need), need, apPerRound, travelActions, curve };
}

/**
 * 从总部出发的波前距离场，按环距统计"有多少比例的格子落在敌方打击区内"。
 * 这是抵达概率的原料：一条被火力全覆盖的走廊，其所在环距的 dangerous 比例接近 1。
 * @returns {{total: number[], risky: number[]}|null}
 */
function riskyShares(game, utils, zones, hq) {
  const dist = new Map([[key(hq), 0]]);
  const queue = [{ q: hq.q, r: hq.r }];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    const d = dist.get(key(cur));
    for (const n of utils.neighbors(cur)) {
      const k = key(n);
      if (dist.has(k)) continue;
      if (!isPlain(game, utils, n)) continue;
      dist.set(k, d + 1);
      queue.push(n);
    }
  }
  const total = [];
  const risky = [];
  for (const [k, d] of dist) {
    if (d === 0) continue;
    total[d] = (total[d] ?? 0) + 1;
    if (zones.reach.has(k)) risky[d] = (risky[d] ?? 0) + 1;
  }
  if (total.length === 0) return null;
  return { total, risky };
}

/** 走 gap 步、预计要穿过几个"敌方打击区内的格子"（按环距比例累加）。 */
function riskySteps(risk, gap) {
  if (!risk || gap <= 0) return 0;
  let sum = 0;
  for (let d = 1; d <= gap; d++) {
    const total = risk.total[d];
    if (!total) continue;
    sum += (risk.risky[d] ?? 0) / total;
  }
  return sum;
}

// ─── 敌情区（威胁 + 机动）───

/**
 * 敌方下一回合的打击区与机动区。
 * reach：落点 → 该点可期的承伤（{atk, weight} 列表，按攻方行动预算截断后求和）；
 * mobility：敌方下一回合能站上去的格子（判据点会不会被踩走）。
 */
function buildEnemyZones(game, utils, owner) {
  const balance = game.config?.balance ?? {};
  const volleys = balance.actionsPerTurn ?? 5;
  const reach = new Map();
  const mobility = new Set();

  for (const seat of utils.enemySeats(game, owner)) {
    for (const e of utils.livingUnits(game, seat)) {
      const range = e.attackRange ?? 1;
      const spots = [{ q: e.q, r: e.r }, ...utils.reachableCells(game, e)];
      for (const s of spots) mobility.add(key(s));
      for (const s of spots) {
        // 原地即打的格子确定性高（重罚），需要先移动才能够到的确定性低（轻罚）
        const weight = s.q === e.q && s.r === e.r ? IMMEDIATE_WEIGHT : MOVE_ATTACK_WEIGHT;
        for (const k of ringKeys(range, s)) {
          const list = reach.get(k) ?? [];
          const hit = list.find(x => x.id === e.id);
          if (hit) hit.weight = Math.max(hit.weight, weight);
          else list.push({ id: e.id, atk: e.attack ?? 0, weight });
          reach.set(k, list);
        }
      }
    }
  }
  return { reach, mobility, volleys, minDamage: balance.minimumDamage ?? 1 };
}

/** 某落点的期望承伤（按敌方每回合出手上限截断，避免多单位线性相加造出假火力）。 */
function incomingAt(zones, pos, defender, exclude = null) {
  const list = zones.reach.get(key(pos));
  if (!list || list.length === 0) return 0;
  const volleys = list
    .filter(x => !exclude || !exclude.has(x.id))
    .map(x => Math.max(zones.minDamage, x.atk - (defender.defense || 0)) * x.weight)
    .sort((a, b) => b - a);
  let total = 0;
  for (let i = 0; i < Math.min(volleys.length, zones.volleys); i++) total += volleys[i];
  return total * DAMAGE_EXPECTATION;
}

// ─── 选线 ───

/** 单位满血时的裁决分价值（军队价值项）。 */
function unitWorth(u, w) {
  return w.army * (u.cost || 50);
}

/** 单点血量的裁决分价值（失血 = 军队价值等比缩水）。 */
function hpWorth(u, w) {
  return w.army * (u.cost || 50) / Math.max(1, u.maxHp);
}

/**
 * 敌方还可能从"我现在的分"上刮走多少 —— 裁定线守成是否安全的悲观下界。
 */
function accessibleSwing(game, utils, w, zones, owner) {
  let swing = 0;
  for (const u of utils.livingUnits(game, owner)) {
    if (!zones.reach.has(key(u))) continue;
    swing += unitWorth(u, w) * EXPOSED_CP_RISK;
  }
  for (const cp of (game.controlPoints || [])) {
    if (cp.owner !== owner) continue;
    if (zones.mobility.has(key(cp))) swing += 2 * w.cp * EXPOSED_CP_RISK;
  }
  const myHq = game.headquarters?.[owner];
  if (myHq && myHq.alive !== false && zones.reach.has(key(myHq))) {
    swing += incomingAt(zones, myHq, myHq) * w.ownHqHp;
  }
  return swing;
}

/**
 * 选线：三条裁决线逐条判定可达性，取"最近的那条能赢的线"。
 */
function chooseVerdict(game, utils, owner, w, zones) {
  const rounds = remainingRounds(game);
  const mine = scoreOf(game, utils, owner, w);
  const enemyScores = utils.enemySeats(game, owner).map(s => scoreOf(game, utils, s, w));
  const enemyBest = enemyScores.reduce((a, b) => (b.total > a.total ? b : a), { total: -Infinity });
  const margin = mine.total - (Number.isFinite(enemyBest.total) ? enemyBest.total : 0);

  const enemyHqs = utils.enemyTargets(game, owner)
    .filter(t => t.kind === 'headquarters')
    .map(t => t.entity)
    .sort((a, b) => a.hp - b.hp);
  const primaryHq = enemyHqs[0] ?? null;

  const siege = primaryHq ? siegeTimeline(game, utils, [owner], primaryHq, rounds, zones) : null;
  const killRound = siege?.killRound ?? null;
  const slack = killRound === null ? null : rounds - killRound;
  // 磨平线：到期末还能打出的总部伤害值多少分（比"现在停手"多拿的）
  const wearGain = siege ? Math.max(0, siege.dealt) * w.hqDamage : 0;
  const holdMargin = margin - accessibleSwing(game, utils, w, zones, owner);

  // 敌方斩首线：对面比我更快拿下总部 → 什么都别管，回防
  const myHq = game.headquarters?.[owner];
  let enemyKillRound = null;
  if (myHq && myHq.alive !== false) {
    const enemySeats = utils.enemySeats(game, owner);
    if (enemySeats.length > 0) {
      const t = siegeTimeline(game, utils, enemySeats, myHq, rounds, zones);
      enemyKillRound = t.killRound;
    }
  }
  const enemyDeadline = killRound === null ? Number.POSITIVE_INFINITY : killRound;
  const emergency = enemyKillRound !== null
    && enemyKillRound <= EMERGENCY_ROUNDS
    && enemyKillRound <= enemyDeadline;

  let line;
  let posture;
  if (emergency) {
    line = 'hold';
    posture = 'rally';
  } else if (killRound !== null) {
    line = 'decap';
    posture = slack >= RESERVE_SLACK ? 'reserve' : 'press';
  } else if (wearGain > Math.max(0, -holdMargin)) {
    // 打不光但磨得到分：比"什么都不做等着输"更能翻盘
    line = 'wear';
    posture = 'trade';
  } else if (holdMargin > 0) {
    line = 'hold';
    posture = 'fortress';
  } else {
    // 三条线都不占优：选改善空间大的那条继续挣扎
    line = wearGain >= w.cp ? 'wear' : 'hold';
    posture = line === 'wear' ? 'trade' : 'press';
  }

  return {
    rounds, line, posture, primaryHq, siege, killRound, slack,
    wearGain, margin, holdMargin, enemyKillRound, emergency,
    risk: POSTURE_RISK[posture],
    capture: POSTURE_CAPTURE[posture],
    urgency: POSTURE_URGENCY[posture],
    offense: POSTURE_OFFENSE[posture],
    // 部署的净收益：花补给（−w.supplies×造价）换军队价值（+w.army×造价）
    deployGain: (w.army - w.supplies) * 50,
  };
}

// ─── 任务分派 ───

/**
 * 每个单位一个任务目标。这是"计划"落到"人"的那一步：
 * 攻城线上全军向总部收束（远程/近战同目标，因为总部的防御对所有人都一样）；
 * 守成线上可占领单位去守/抢据点，不可占领的守家；
 * 治疗兵永远跟着最需要治的队友走 —— 它不参与攻城。
 */
function assignMissions(game, utils, owner, ctx) {
  const goals = new Map();
  const myHq = game.headquarters?.[owner];
  const myUnits = utils.livingUnits(game, owner);

  for (const u of myUnits) {
    if (u.type === 'support') {
      const wounded = myUnits
        .filter(a => a.id !== u.id && a.hp < a.maxHp)
        .sort((a, b) => (b.maxHp - b.hp) - (a.maxHp - a.hp))[0];
      goals.set(u.id, wounded || myHq || ctx.primaryHq);
      continue;
    }
    if (ctx.line === 'hold') {
      // 紧急回防（rally）：据点先放一边，全军压回总部 —— 老家没了，据点分一文不值
      if (ctx.posture === 'rally') {
        goals.set(u.id, myHq || ctx.primaryHq);
        continue;
      }
      if (u.canCapture) {
        const contested = (game.controlPoints || [])
          .filter(cp => cp.owner !== owner || cp.owner === owner)
          .sort((a, b) => {
            const va = (a.owner === owner ? 0 : 1) * 100 - utils.hexDistance(u, a);
            const vb = (b.owner === owner ? 0 : 1) * 100 - utils.hexDistance(u, b);
            return vb - va;
          });
        goals.set(u.id, contested[0] || myHq);
      } else {
        goals.set(u.id, myHq || ctx.primaryHq);
      }
      continue;
    }
    goals.set(u.id, ctx.primaryHq || myHq);
  }
  return goals;
}

// ─── 打击估值 ───

/**
 * 一次打击的裁决分收益。
 * 打单位 = 打掉的血按"军队价值/最大血"折算（击杀时整只蒸发，公式天然自洽）；
 * 打总部 = 每点血 w.hqDamage（default 图是单位的 5.6 倍/DPS，这就是磨平线的由来）；
 * 另加击杀节奏分：死掉的敌人不再输出。
 */
function strikePoints(game, w, minDamage, ctx, attacker, target) {
  const e = target.entity;
  const isHq = target.kind === 'headquarters';
  const raw = (attacker.attack ?? 0) - (e.defense || 0);
  const avg = Math.max(minDamage, raw);
  const worst = Math.max(minDamage, raw - ctx.variance);

  if (isHq) {
    const dealt = Math.min(avg, e.hp);
    if (worst >= e.hp) return HQ_KILL_POINTS;
    return dealt * w.hqDamage;
  }

  const perHp = hpWorth(e, w);
  const dealt = Math.min(avg, e.hp);
  let pts = dealt * perHp;
  if (worst >= e.hp) {
    // 击杀：目标剩下的输出威胁也一并消失（tempo 分，不是分数）
    pts += KILL_TEMPO * unitWorth(e, w) * Math.max(0.3, (e.hp + dealt) / e.maxHp);
  }
  return pts;
}

/**
 * 任务推进的"每步价值"：把到位后能兑现的收益，摊到"还差几步"上。
 *
 * 这是排程与走位之间的汇率。缺了它，离目标远的单位只看得到风险看不到收益，
 * 会在危险区边缘停住永不进场 —— danger-close（1 行动点/回合、总部相隔 4 格）
 * 上实测就是"整局零总部伤害、走到一半的部队全在原地"。
 *
 * 唯一的坑是"已经到位"（剩余步数 0）那一档：把整个到位收益当成一步的价值，
 * 会让远程兵继续往脸上贴，甚至放下已经够到的打击去走一格挣这份假梯度
 * （default 图上实测：游侠放着 111 分的总部打击不打，去走一格挣 133 分）。
 * 到位之后再靠近一步的边际收益就是 0 —— 但**不能**顺手把它改成调和衰减
 * V(s)=payoff·k/(k+s) 的差分：那样远处的梯度会衰减到几乎与 PACE_POINTS 同量级，
 * 长图上部队走不动（breach 从 100% 掉到 57%、dual-lanes 从 93% 掉到 57%）。
 */
/** 回防的到位收益：敌方每回合压在我方总部上的伤害值多少分。
 *  没有这一项，"回家"只是一个 5 分/步 的平坡，任何一点路过的风险都能把单位
 *  推离自家总部——守成线会变成"绕着老家兜圈子"（实测：紧急回防时单位反而退了
 *  3 格）。 */
function defensePayoff(game, utils, w, ctx) {
  const myHq = game.headquarters?.[ctx.owner];
  if (!myHq || myHq.alive === false) return PACE_POINTS;
  const perRound = incomingAt(ctx.zones, myHq, myHq) * w.ownHqHp;
  return Math.max(PACE_POINTS, Math.min(perRound * DEFEND_HORIZON, myHq.hp * w.ownHqHp));
}

function missionPayoff(game, utils, w, ctx, unit) {
  const goal = ctx.goals.get(unit.id);
  if (!goal) return PACE_POINTS;
  const myHq = game.headquarters?.[ctx.owner];
  if (myHq && goal.id === myHq.id) return defensePayoff(game, utils, w, ctx);
  if (ctx.primaryHq && goal.id === ctx.primaryHq.id && unit.type !== 'support') {
    return strikePoints(game, w, ctx.minDamage, ctx, unit, { kind: 'headquarters', entity: ctx.primaryHq });
  }
  const cp = (game.controlPoints || []).find(p => p.q === goal.q && p.r === goal.r);
  if (cp) return (cp.owner !== ctx.owner ? 2 : 1) * w.cp * Math.max(ctx.capture, 0.3);
  return PACE_POINTS;
}

/** 该单位到任务目标的剩余步数（远程兵停在射程边缘，不贴脸）。 */
function stepsToGoal(utils, unit, goal) {
  const standoff = unit.canCapture ? 0 : Math.max(0, (unit.attackRange ?? 1) - 1);
  return Math.max(0, utils.hexDistance(unit, goal) - standoff);
}

/** 每步梯度：到位收益的边际增量，下限 PACE_POINTS。 */
function paceGradient(game, utils, w, ctx, unit) {
  const goal = ctx.goals.get(unit.id);
  if (!goal) return PACE_POINTS;
  const payoff = missionPayoff(game, utils, w, ctx, unit);
  const steps = stepsToGoal(utils, unit, goal);
  if (steps <= 0) return 0;
  return Math.max(PACE_POINTS, payoff / steps);
}

/** 某单位站在 pos 时，本回合能兑现的最高打击分。 */
function bestStrikeFrom(game, utils, w, ctx, unit, pos) {
  let best = 0;
  for (const target of ctx.targets) {
    const e = target.entity;
    if (utils.hexDistance(pos, e) > (unit.attackRange ?? 1)) continue;
    const pts = strikePoints(game, w, ctx.minDamage, ctx, unit, target);
    if (pts > best) best = pts;
  }
  return best;
}

// ─── 候选动作 ───

/** 该单位本回合还能不能再接一个动作：已激活的单位不再耗行动点。 */
function canAct(unit, ctx) {
  return unit.actionSpent || ctx.budget > 0;
}

/**
 * 打击候选：打击分 − 原地承伤的姿态化代价 + 打死目标带来的暴露下降。
 *
 * 两项都要，少一个都会坏：
 *   · `− before × risk`：开火意味着**这个回合就停在原地**，承担敌方下一轮的全部火力。
 *     不扣这一项，算法会在隘口把整支军队换光 —— 打一炮的成本被当成 0，
 *     而撤退的收益仍在，于是"反正躲不掉，不如打"变成"主动走进躲不掉的位置"。
 *     dual-lanes（双路夹墙、中路是绞肉机）实测从 93% 掉到 60%。
 *   · `+ 暴露下降`：打死的人下回合不会再开枪，这一炮确实让自己更安全了。
 *     没有它，"集火斩杀"就只是多打掉几十点血，永远打不过"撤到安全格"。
 *     这是差分项（after − before），不是再扣一次完整风险。
 */
function strikeOptions(game, utils, w, ctx) {
  const options = [];
  for (const a of utils.livingUnits(game, ctx.owner)) {
    if (a.hasActed || !canAct(a, ctx)) continue;
    for (const target of ctx.targets) {
      const e = target.entity;
      if (utils.hexDistance(a, e) > (a.attackRange ?? 1)) continue;
      const pts = strikePoints(game, w, ctx.minDamage, ctx, a, target);
      const before = riskPoints(a, incomingAt(ctx.zones, a, a), w);
      const raw = (a.attack ?? 0) - (e.defense || 0);
      const willDie = Math.max(ctx.minDamage, raw - ctx.variance) >= e.hp;
      const after = willDie
        ? riskPoints(a, incomingAt(ctx.zones, a, a, new Set([e.id])), w)
        : before;
      options.push({
        type: 'attack',
        payload: { attackerId: a.id, targetId: e.id },
        pts: pts + (before - after) - before * ctx.risk,
      });
    }
  }
  return options;
}

/** 潜在承伤折算成裁决分损失（含阵亡丢掉的剩余价值）。 */
function riskPoints(unit, incoming, w) {
  if (incoming <= 0) return 0;
  const perHp = hpWorth(unit, w);
  const lost = Math.min(incoming, unit.hp);
  let pts = lost * perHp;
  if (incoming >= unit.hp) pts += Math.max(0, unit.hp - lost) * perHp;
  return pts;
}

/** 治疗候选：回复的血按军队价值计价，濒危队友额外加成。 */
function healOptions(game, utils, w, ctx) {
  const options = [];
  const healVariance = game.config?.balance?.healVarianceRange ?? 6;
  for (const s of utils.livingUnits(game, ctx.owner)) {
    if (s.type !== 'support' || s.hasActed || !canAct(s, ctx)) continue;
    const healRange = game.config?.units?.[s.type]?.healRange ?? s.attackRange;
    for (const ally of utils.livingUnits(game, ctx.owner)) {
      if (ally.hp >= ally.maxHp) continue;
      if (utils.hexDistance(s, ally) > healRange) continue;
      const missing = ally.maxHp - ally.hp;
      const amount = Math.min(missing, (s.healPower ?? 0) + healVariance / 2);
      let pts = amount * hpWorth(ally, w);
      const danger = incomingAt(ctx.zones, ally, ally);
      if (danger > 0) pts += Math.min(danger, amount) * hpWorth(ally, w) * 0.5;
      options.push({ type: 'heal', payload: { supportId: s.id, targetId: ally.id }, pts });
    }
  }
  return options;
}

/**
 * 落点评分：占点 + 走位后可兑现的打击 − 落点风险 − 任务推进（含期限急迫度）− 扎堆。
 * 移动与原地共用本函数，最终比较的是增量。
 */
function positionPoints(game, utils, w, ctx, unit, pos, ownCells) {
  let pts = 0;

  // 1) 占点：站在中立/敌方据点上，回合结束即完成占领（引擎在 endTurn 里结算）
  if (unit.canCapture) {
    const cp = (game.controlPoints || []).find(p => p.q === pos.q && p.r === pos.r);
    if (cp && cp.owner !== ctx.owner) {
      pts += (cp.owner ? 2 : 1) * w.cp * ctx.capture;
    } else if (cp && cp.owner === ctx.owner && ctx.line === 'hold') {
      pts += GARRISON_POINTS;   // 守成：站住自己的据点
    }
  }

  // 2) 走位后本回合还能打出的伤害（下一次 decide 会直接兑现）
  if (!unit.hasActed && canAct(unit, ctx)) {
    pts += bestStrikeFrom(game, utils, w, ctx, unit, pos) * OPPORTUNITY_DISCOUNT * ctx.offense;
  }

  // 3) 落点风险：按裁决分计价，随姿态缩放
  pts -= riskPoints(unit, incomingAt(ctx.zones, pos, unit), w) * ctx.risk;

  // 4) 任务推进：离任务目标越远越扣分，每步的价值 = 到位收益摊到剩余步数上；
  //    期限越紧（urgency 越高）扣得越狠 —— 这是"排程"落到"走位"的那一环，不是单纯的引力。
  const goal = ctx.goals.get(unit.id);
  if (goal) {
    pts -= utils.hexDistance(pos, goal) * ctx.pace.get(unit.id) * ctx.urgency;
  }

  // 5) 轻微疏散
  let friends = 0;
  for (const n of utils.neighbors(pos)) if (ownCells.has(key(n))) friends += 1;
  pts -= Math.max(0, friends - 1) * CROWD_POINTS;

  return pts;
}

/** 移动候选：逐格评估取最优，与原地比较取增量。 */
function moveOptions(game, utils, w, ctx) {
  const options = [];
  const allCells = new Set(utils.livingUnits(game, ctx.owner).map(u => key(u)));

  for (const u of utils.livingUnits(game, ctx.owner)) {
    if (u.hasMoved || !canAct(u, ctx)) continue;
    const reachable = utils.reachableCells(game, u);
    if (reachable.length === 0) continue;

    const ownCells = new Set([...allCells].filter(k => k !== key(u)));
    const stay = positionPoints(game, utils, w, ctx, u, u, ownCells);
    let best = null;
    for (const cell of reachable) {
      const pts = positionPoints(game, utils, w, ctx, u, cell, ownCells);
      if (!best || pts > best.pts) best = { cell, pts };
    }
    if (best && best.pts - stay > 0) {
      options.push({
        type: 'move',
        payload: { unitId: u.id, q: best.cell.q, r: best.cell.r },
        pts: best.pts - stay,
      });
    }
  }
  return options;
}

/** 爆破候选：只炸"拆了确实更接近任务目标"的墙（否则是白丢行动点）。 */
function demolishOptions(game, utils, ctx) {
  const options = [];
  if ((game.turn?.turnNumber ?? 0) < 4) return options;
  for (const h of utils.livingUnits(game, ctx.owner)) {
    if (h.type !== 'heavy' || h.hasActed || !canAct(h, ctx)) continue;
    const goal = ctx.goals.get(h.id);
    if (!goal) continue;
    const distToGoal = utils.hexDistance(h, goal);
    for (const pos of utils.neighbors(h)) {
      if (!utils.isPlayable(game, pos)) continue;
      if (utils.terrainAt(game, pos) !== 'blocker') continue;
      if (utils.occupantAt(game, pos)) continue;
      // 只要求墙比脚下更接近目标：连续障碍带里墙后往往还是墙，
      // 要求"墙后必是空地"会让重装在有城墙的图上永不拆墙。
      if (utils.hexDistance(pos, goal) >= distToGoal) continue;
      options.push({
        type: 'demolish',
        payload: { unitId: h.id, q: pos.q, r: pos.r },
        pts: DEMOLISH_POINTS,
      });
    }
  }
  return options;
}

// ─── 决策上下文 ───

function buildContext(game, utils, owner) {
  const w = adjudicationWeights(game);
  const zones = buildEnemyZones(game, utils, owner);
  const ctx = {
    owner,
    w,
    zones,
    targets: utils.enemyTargets(game, owner),
    variance: game.config?.balance?.damageVarianceRange ?? 3,
    minDamage: game.config?.balance?.minimumDamage ?? 1,
    budget: utils.actionsRemaining(game),
  };
  Object.assign(ctx, chooseVerdict(game, utils, owner, w, zones));
  ctx.goals = assignMissions(game, utils, owner, ctx);
  ctx.pace = new Map(utils.livingUnits(game, owner).map(u => [u.id, paceGradient(game, utils, w, ctx, u)]));
  ctx.deployFloor = Math.max(1, ctx.deployGain * DEPLOY_PRIORITY);
  return ctx;
}

/**
 * 裁决线算法导出接口
 */
export default {
  name: 'verdict',
  description: '裁决线：从终局倒推攻城排程与期限，全动作按裁决分计价',

  async decide(game, utils) {
    const owner = game.turn?.currentPlayerId || game.turn?.currentOwner;
    if (!owner) return null;

    const ctx = buildContext(game, utils, owner);
    const w = ctx.w;
    const options = [
      ...strikeOptions(game, utils, w, ctx),
      ...healOptions(game, utils, w, ctx),
      ...moveOptions(game, utils, w, ctx),
      ...demolishOptions(game, utils, ctx),
    ];
    options.sort((a, b) => b.pts - a.pts);
    const best = options[0];

    // 补员与战斗动作同一尺度比较：没有比"多一支部队"更值的事时才补员。
    // 必须排在"无事可做"判定之前：部队被全歼/全员已行动完时 options 为空，
    // 剩下的行动点仍然应当用来补员（先判空会退化成"兵力只减不增"）。
    if (!best || best.pts < ctx.deployFloor) {
      const deploy = utils.deployDecision(game, owner);
      if (deploy) return deploy;
    }

    // 只剩零碎收益时结束回合（注意：返回 null 会直接 endTurn，门槛必须远小于 PACE_POINTS）
    if (!best || best.pts <= MIN_POINTS) return null;
    return { type: best.type, payload: best.payload };
  },
};
