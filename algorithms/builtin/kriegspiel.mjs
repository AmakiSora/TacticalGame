// algorithms/builtin/kriegspiel.mjs
//
// 兵棋推演算法（Kriegspiel / rollout）——同时回合模式的
// 「真实结算模拟 + 整份计划联合搜索」算法。
//
// 与 random-sim / dest-prob 的根本差别：
//   - random-sim：不思考，均匀随机入队；
//   - dest-prob：用**解析公式**给每个动作单独估期望收益，再逐个**边际贪心**挑选，
//     从不真正模拟结算（dest-prob.md「已知限制 #2：不做联合计划搜索」）；
//   - 本算法：把**整份计划**塞进一个 JS 版的单轮结算器里跑一遍——目的格声明池冲突、
//     移动落位、single/line/arc 形状覆盖、attackLock 锁定跟随、伤害掷骰、占点、总部
//     摧毁淘汰，全部按 src/engine/simultaneous.ts 的口径真实结算——用**模拟出来的棋盘**
//     给整份计划打分，并在计划空间里做**联合搜索**（静态候选生成 + 蒙特卡洛 rollout 选择
//     + 爬山精修）。于是它能找到 dest-prob 结构上找不到的组合拳：两单位同轮集火斩杀、
//     先治疗后承伤、占点与预瞄封锁协同、故意让一格冲突失败换别处 tempo。
//
// 对抗「可被反预测」：每份计划对**对手组合（objective / aggressive / random 三种性格）**
// 采样多份敌方计划做 rollout，最终分取「均值 − λ·标准差」的风险调整值，而不是单点最优，
// 因此对刻意反预测或随机对手都更稳（补 dest-prob.md「已知限制 #1」）。
//
// 约束：动作枚举复用 dest-prob 已逐字镜像 planning.ts 的 computeAim / enumerateAims；
// 结算器镜像 simultaneous.ts 的 resolveRound（仅单轮、不含炮火/收入/维修，用棋盘估值收口）。
// 决策确定性：rollout 的随机源由 (rngState, roundNumber, owner) 播种，同棋盘可复现。

import { destProbInternals } from './dest-prob.mjs';

const { computeAim, enumerateAims } = destProbInternals;

const HEX_DIRS = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

// ─── 可调参数（环境变量覆盖，便于标定/限时）───
const CFG = {
  /** 每份计划的蒙特卡洛 rollout 次数。 */
  rollouts: Number(process.env.KRIEG_ROLLOUTS ?? 32),
  /** 静态生成的多样化完整候选计划数。 */
  candidates: Number(process.env.KRIEG_CANDIDATES ?? 14),
  /** 选定最优计划后的爬山精修轮数。 */
  refinePasses: Number(process.env.KRIEG_REFINE ?? 2),
  /** 单次搜索的墙钟上限（毫秒）；到点即返回当前最优，保护线上 runner 与跑批。 */
  timeBudgetMs: Number(process.env.KRIEG_TIME_MS ?? 2000),
  /** 风险规避系数：score = mean − λ·std。 */
  riskLambda: Number(process.env.KRIEG_LAMBDA ?? 0.5),
  /** 静态候选采样温度（越大越多样）。 */
  sampleTemp: Number(process.env.KRIEG_TEMP ?? 40),
};

// ─── 效用尺度（仅用于**静态候选排序**；真实价值由 rollout 结算给出）───
const DAMAGE_SCALE = 6;
const KILL_WEIGHT = 0.9;
const HQ_DAMAGE_BONUS = 1.3;
const HQ_KILL = 6000;
const HEAL_SCALE = 7;
const THREAT_SCALE = 0.9;
const PROGRESS_SCALE = 14;
const DEPLOY_BASE = 160;
const GARRISON_BONUS = 30;
const CROWD_PENALTY = 6;
const ACTION_COST = 70;
const CP_HOLD_CAP = 4;
const MIN_SCORE = 0.5;
/** 终局（己方总部被摧毁 / 敌方全灭）的压倒性估值。 */
const TERMINAL = 1e6;

// ─── 敌军落点模型参数 ───
const ENEMY_TOP_K = 8;
const ENEMY_SCORE_WINDOW = 70;
const ENEMY_TEMP = 24;
const ENEMY_STAY_BONUS = 12;

const cellKey = pos => `${pos.q},${pos.r}`;
const sameCell = (a, b) => a.q === b.q && a.r === b.r;
const parseKey = key => { const [q, r] = key.split(',').map(Number); return { q, r }; };

function hexDistance(a, b) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  const ds = -a.q - a.r - (-b.q - b.r);
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds));
}

function unitValue(unit) {
  return 120 + (unit.cost || 50) * 3;
}

/** mulberry32：与引擎 nextGameRandom 同款，用于 rollout 的可复现随机。 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 从棋盘状态派生一个稳定种子（决策可复现，不依赖 Math.random）。 */
function stateSeed(game, owner, roundNumber) {
  let h = (game.rngState >>> 0) ^ Math.imul(roundNumber + 1, 0x9e3779b9);
  for (let i = 0; i < owner.length; i++) h = (Math.imul(h, 31) + owner.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

function shapeSpec(game, unitType, kind) {
  const shape = game.config?.units?.[unitType]?.[kind];
  if (!shape) return { type: 'single', length: 1 };
  if (shape.type === 'line') return { type: 'line', length: shape.length ?? 2 };
  if (shape.type === 'arc') return { type: 'arc', length: 3 };
  return { type: 'single', length: 1 };
}

function healRangeFor(game, unit) {
  return game.config?.units?.[unit.type]?.healRange ?? unit.attackRange ?? 1;
}

/** 从 pos 出发按攻击形状最多能覆盖到的格并集（不区分朝向，用于敌军火力机会近似）。 */
function coverageUnion(game, unit, pos, kind) {
  const shape = shapeSpec(game, unit.type, kind);
  const range = kind === 'attackShape' ? (unit.attackRange ?? 1) : healRangeFor(game, unit);
  const cells = new Map();
  const add = (q, r) => cells.set(`${q},${r}`, { q, r });
  if (shape.type === 'single') {
    for (let dq = -range; dq <= range; dq++) {
      const lo = Math.max(-range, -dq - range);
      const hi = Math.min(range, -dq + range);
      for (let dr = lo; dr <= hi; dr++) {
        if (dq === 0 && dr === 0 && kind === 'attackShape') continue;
        add(pos.q + dq, pos.r + dr);
      }
    }
    return cells;
  }
  if (shape.type === 'arc') {
    for (const d of HEX_DIRS) add(pos.q + d.q, pos.r + d.r);
    return cells;
  }
  const length = Math.min(shape.length, range);
  for (const d of HEX_DIRS) {
    for (let step = 1; step <= length; step++) add(pos.q + d.q * step, pos.r + d.r * step);
  }
  return cells;
}

function isArtilleryDanger(game, pos) {
  return Boolean(game.artillery?.dangerCells?.some(cell => cell.q === pos.q && cell.r === pos.r));
}

// ---------------------------------------------------------------- 计划队列镜像

function plannedUnitIds(queue) {
  const ids = new Set();
  for (const action of queue) {
    const id = action.unitId ?? action.attackerId ?? action.supportId;
    if (id) ids.add(id);
  }
  return ids;
}

function claimedCells(queue) {
  const claimed = new Set();
  for (const action of queue) {
    if ((action.type === 'deploy' || action.type === 'move') && typeof action.q === 'number') {
      claimed.add(cellKey(action));
    }
  }
  return claimed;
}

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

const actionUnitId = action => action.unitId ?? action.attackerId ?? action.supportId;
const actionSignature = action => JSON.stringify({ type: action.type, payload: action.payload ?? {} });

// ---------------------------------------------------------------- 据点计价

function cpValue(ctx, cp, owner) {
  if (cp.owner === owner) return 0;
  const remaining = ctx.maxTurns === null ? 12 : Math.max(1, ctx.maxTurns - ctx.roundNumber + 1);
  const hold = Math.min(remaining, CP_HOLD_CAP);
  const weights = ctx.game.config?.balance?.adjudicationWeights ?? {};
  const weight = weights.controlPoint ?? 60;
  const flow = weights.controlPointFlowRatio ?? 0.7;
  const income = ctx.utils.cpKindEffect(ctx.game, cp)?.income ?? ctx.game.config?.balance?.controlPointIncome ?? 8;
  let value = weight * (flow * hold + (1 - flow)) + income * hold * 2;
  if (cp.owner) value *= 1.5;
  return value;
}

// ---------------------------------------------------------------- 敌军落点模型

function damageStats(ctx, attack, defense) {
  return {
    avg: Math.max(ctx.minDamage, (attack ?? 0) - (defense || 0)),
    worst: Math.max(ctx.minDamage, (attack ?? 0) - (defense || 0) - ctx.variance),
  };
}

function enemyBestAttackAt(ctx, enemy, pos) {
  const covered = coverageUnion(ctx.game, enemy, pos, 'attackShape');
  let best = 0;
  const targets = [
    ...ctx.myUnits.map(unit => ({ kind: 'unit', entity: unit })),
    ...(ctx.myHq ? [{ kind: 'headquarters', entity: ctx.myHq }] : []),
  ];
  for (const target of targets) {
    if (!covered.has(cellKey(target.entity))) continue;
    const damage = damageStats(ctx, enemy.attack, target.entity.defense);
    let value = Math.min(damage.avg, target.entity.hp) * DAMAGE_SCALE * 0.6;
    if (damage.avg >= target.entity.hp) {
      value += (target.kind === 'headquarters' ? HQ_KILL : unitValue(target.entity)) * 0.5;
    }
    if (value > best) best = value;
  }
  return best;
}

function enemySafetyAt(ctx, enemy, pos) {
  let threat = 0;
  for (const unit of ctx.myUnits) {
    if (hexDistance(pos, unit) <= (unit.attackRange ?? 1)) {
      threat += damageStats(ctx, unit.attack, enemy.defense).avg * 0.45;
    }
  }
  return threat;
}

function enemyDestinationScore(ctx, enemy, pos) {
  let score = 0;
  if (enemy.canCapture) {
    for (const cp of ctx.cps) {
      if (cp.owner === enemy.owner) continue;
      const distance = hexDistance(pos, cp);
      const currentDistance = hexDistance(enemy, cp);
      const value = cpValue(ctx, cp, enemy.owner);
      if (distance === 0) score += value * 1.35;
      else score += value * 0.16 / (1 + distance);
      if (distance < currentDistance) score += (currentDistance - distance) * value * 0.05;
    }
  } else if (enemy.type === 'support') {
    for (const ally of ctx.enemies) {
      if (ally.owner !== enemy.owner || ally.id === enemy.id || ally.hp >= ally.maxHp) continue;
      const missing = ally.maxHp - ally.hp;
      score += (missing / ally.maxHp) * 90 / (1 + hexDistance(pos, ally));
    }
    if (ctx.enemyHqs.has(enemy.owner)) score += 20 / (1 + hexDistance(pos, ctx.enemyHqs.get(enemy.owner)));
  } else {
    let nearest = Infinity;
    for (const unit of ctx.myUnits) nearest = Math.min(nearest, hexDistance(pos, unit));
    if (ctx.myHq) nearest = Math.min(nearest, hexDistance(pos, ctx.myHq));
    if (Number.isFinite(nearest)) score += 36 / (1 + nearest);
  }
  score += enemyBestAttackAt(ctx, enemy, pos);
  score -= enemySafetyAt(ctx, enemy, pos);
  if (sameCell(pos, enemy)) score += ENEMY_STAY_BONUS;
  return score;
}

/**
 * 构建敌军落点分布与派生表：
 * - distByUnit：每个敌军 unitId → Map(cellKey, probability)
 * - reachByUnit：每个敌军 unitId → 可达格数组（供计划采样复用，避免重复 BFS）
 * - presence：每格 → Map(unitId, probability)
 * - claimRisk：每格被至少一个敌军移动/部署认领的概率
 * - attackEntries：每格可能吃到的敌方火力（含概率权重）
 */
function buildEnemyModel(ctx) {
  const distByUnit = new Map();
  const reachByUnit = new Map();
  const presence = new Map();
  const claimRisk = new Map();
  const attackEntries = new Map();
  const enemyCount = Math.max(1, ctx.enemies.length);
  const actionRate = Math.min(1, ctx.actionsPerTurn / enemyCount);

  for (const enemy of ctx.enemies) {
    const reach = ctx.utils.reachableCells(ctx.game, enemy);
    reachByUnit.set(enemy.id, reach);
    const candidates = [{ q: enemy.q, r: enemy.r }, ...reach];
    const scored = candidates.map(pos => ({ pos, score: enemyDestinationScore(ctx, enemy, pos) }));
    scored.sort((a, b) => b.score - a.score || cellKey(a.pos).localeCompare(cellKey(b.pos)));

    const top = [];
    const seen = new Set();
    for (const entry of scored) {
      const key = cellKey(entry.pos);
      if (seen.has(key)) continue;
      if (top.length >= ENEMY_TOP_K) break;
      if (top.length > 0 && entry.score < scored[0].score - ENEMY_SCORE_WINDOW) break;
      seen.add(key);
      top.push(entry);
    }
    if (!top.some(entry => sameCell(entry.pos, enemy))) {
      top.push({ pos: { q: enemy.q, r: enemy.r }, score: enemyDestinationScore(ctx, enemy, enemy) });
    }
    const maxScore = Math.max(...top.map(entry => entry.score));
    const weights = top.map(entry => Math.exp((entry.score - maxScore) / ENEMY_TEMP));
    const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
    const dist = new Map();
    for (let i = 0; i < top.length; i++) {
      const key = cellKey(top[i].pos);
      dist.set(key, (dist.get(key) ?? 0) + (weights[i] / weightSum) * actionRate);
    }
    const stayKey = cellKey(enemy);
    const moved = [...dist.values()].reduce((sum, probability) => sum + probability, 0);
    dist.set(stayKey, (dist.get(stayKey) ?? 0) + Math.max(0, 1 - moved));
    distByUnit.set(enemy.id, dist);

    for (const [key, probability] of dist) {
      if (probability <= 0) continue;
      let cellPresence = presence.get(key);
      if (!cellPresence) presence.set(key, cellPresence = new Map());
      cellPresence.set(enemy.id, (cellPresence.get(enemy.id) ?? 0) + probability);
      const existingRisk = claimRisk.get(key) ?? 0;
      claimRisk.set(key, 1 - (1 - existingRisk) * (1 - probability));
      const covered = coverageUnion(ctx.game, enemy, parseKey(key), 'attackShape');
      for (const coveredKey of covered.keys()) {
        const weight = targetWeight(ctx, coveredKey);
        if (weight <= 0) continue;
        let entries = attackEntries.get(coveredKey);
        if (!entries) attackEntries.set(coveredKey, entries = []);
        entries.push({ attack: enemy.attack ?? 0, probability, weight });
      }
    }
  }
  return { distByUnit, reachByUnit, presence, claimRisk, attackEntries };
}

function targetWeight(ctx, key) {
  if (ctx.myUnitCells.has(key) || ctx.myHqCell === key) return 1;
  if (ctx.contestedCpCells.has(key)) return 0.5;
  if (ctx.nearMyUnitCells.has(key)) return 0.25;
  return 0.08;
}

function buildEnemyDeployRisk(ctx) {
  const risk = new Map();
  const unitSpecs = Object.values(ctx.game.config?.units ?? {});
  if (!unitSpecs.length) return risk;
  const cheapest = Math.min(...unitSpecs.map(spec => spec.cost ?? Infinity));
  if (!Number.isFinite(cheapest)) return risk;
  for (const seat of ctx.enemySeats) {
    if ((ctx.game.resources?.[seat]?.supplies ?? 0) < cheapest) continue;
    for (const origin of ctx.utils.deployOrigins(ctx.game, seat)) {
      for (const cell of ctx.utils.neighbors(origin)) {
        if (!ctx.utils.isEmptyPlain(ctx.game, cell)) continue;
        const key = cellKey(cell);
        risk.set(key, Math.min(0.5, (risk.get(key) ?? 0) + 0.12));
      }
    }
  }
  return risk;
}

function combinedClaimRisk(ctx, key) {
  const moveRisk = ctx.claimRisk.get(key) ?? 0;
  const deployRisk = ctx.enemyDeployRisk.get(key) ?? 0;
  return 1 - (1 - moveRisk) * (1 - deployRisk);
}

function incomingDamageAt(ctx, pos, defense) {
  const entries = ctx.attackEntries.get(cellKey(pos));
  if (!entries?.length) return 0;
  let total = 0;
  for (const entry of entries) {
    total += Math.max(ctx.minDamage, entry.attack - (defense || 0)) * entry.probability * entry.weight;
  }
  return total * ctx.volleyFactor;
}

// ---------------------------------------------------------------- 静态候选评分
// 只用于**排序/生成多样化候选计划**；真实价值由 rollout 结算给出，故这里可以比
// dest-prob 更粗。

function fireOpportunity(ctx, unit, pos) {
  const range = unit.attackRange ?? 0;
  if (!range) return 0;
  let best = 0;
  for (const enemy of ctx.enemies) {
    const dist = ctx.distByUnit.get(enemy.id);
    if (!dist) continue;
    let probability = 0;
    for (const [key, p] of dist) {
      if (hexDistance(pos, parseKey(key)) <= range) probability += p;
    }
    if (probability <= 0) continue;
    const damage = damageStats(ctx, unit.attack, enemy.defense);
    let value = Math.min(damage.avg, enemy.hp) * DAMAGE_SCALE * probability;
    if (damage.worst >= enemy.hp) value += unitValue(enemy) * KILL_WEIGHT * probability;
    else if (damage.avg >= enemy.hp) value += unitValue(enemy) * 0.55 * probability;
    if (value > best) best = value;
  }
  for (const hq of ctx.enemyHqs.values()) {
    if (hexDistance(pos, hq) > range) continue;
    const damage = damageStats(ctx, unit.attack, hq.defense);
    let value = damage.avg * DAMAGE_SCALE * HQ_DAMAGE_BONUS;
    if (damage.avg >= hq.hp) value += HQ_KILL;
    if (value > best) best = value;
  }
  return best;
}

function exposurePenalty(ctx, attacker) {
  const incoming = incomingDamageAt(ctx, attacker, attacker.defense);
  let penalty = incoming * THREAT_SCALE * 0.5;
  if (incoming >= attacker.hp) penalty += unitValue(attacker) * 0.25;
  return penalty;
}

function attackStaticScore(ctx, attacker, aim, click) {
  let value = 0;
  const spec = ctx.game.config?.units?.[attacker.type];
  if (spec?.attackLock) {
    const locked = ctx.enemies.find(enemy => sameCell(enemy, click));
    if (locked) {
      const dist = ctx.distByUnit.get(locked.id);
      let inRange = 0;
      for (const [key, probability] of dist) {
        if (hexDistance(attacker, parseKey(key)) <= (attacker.attackRange ?? 1)) inRange += probability;
      }
      const damage = damageStats(ctx, attacker.attack, locked.defense);
      value += Math.min(damage.avg, locked.hp) * inRange * DAMAGE_SCALE;
      if (damage.worst >= locked.hp) value += unitValue(locked) * KILL_WEIGHT * inRange;
      else if (damage.avg >= locked.hp) value += unitValue(locked) * 0.55 * inRange;
      return value - exposurePenalty(ctx, attacker);
    }
  }
  for (const cell of aim.cells) {
    const key = cellKey(cell);
    const entries = ctx.presence.get(key);
    if (entries) {
      for (const [enemyId, probability] of entries) {
        const enemy = ctx.enemyById.get(enemyId);
        if (!enemy) continue;
        const damage = damageStats(ctx, attacker.attack, enemy.defense);
        value += Math.min(damage.avg, enemy.hp) * probability * DAMAGE_SCALE;
        if (damage.worst >= enemy.hp) value += unitValue(enemy) * KILL_WEIGHT * probability;
        else if (damage.avg >= enemy.hp) value += unitValue(enemy) * 0.55 * probability;
      }
    }
    const hq = ctx.enemyHqByKey.get(key);
    if (hq) {
      const damage = damageStats(ctx, attacker.attack, hq.defense);
      value += damage.avg * DAMAGE_SCALE * HQ_DAMAGE_BONUS;
      if (damage.avg >= hq.hp) value += HQ_KILL;
    }
    const cp = ctx.cpByKey.get(key);
    if (cp && cp.owner !== ctx.owner) {
      let probability = 0;
      if (entries) for (const p of entries.values()) probability += p;
      value += Math.min(1, probability) * cpValue(ctx, cp, ctx.owner) * 0.05;
    }
  }
  return value - exposurePenalty(ctx, attacker);
}

function stayValue(ctx, unit) {
  let value = 0;
  const cp = ctx.cpByKey.get(cellKey(unit));
  if (cp && cp.owner !== ctx.owner && unit.canCapture) value += cpValue(ctx, cp, ctx.owner);
  else if (cp && cp.owner === ctx.owner) value += GARRISON_BONUS;
  value += fireOpportunity(ctx, unit, unit) * 0.45;
  value -= incomingDamageAt(ctx, unit, unit.defense) * THREAT_SCALE;
  return value;
}

function destinationValue(ctx, unit, pos) {
  let value = 0;
  const cp = ctx.cpByKey.get(cellKey(pos));
  if (cp && cp.owner !== ctx.owner && unit.canCapture) value += cpValue(ctx, cp, ctx.owner);
  else if (cp && cp.owner === ctx.owner) value += GARRISON_BONUS;
  const objective = ctx.objectives.get(unit.id);
  if (objective) {
    const before = hexDistance(unit, objective.pos);
    const after = hexDistance(pos, objective.pos);
    const progress = before - after;
    if (progress > 0) value += progress * PROGRESS_SCALE;
  }
  value += fireOpportunity(ctx, unit, pos) * 0.35;
  value -= incomingDamageAt(ctx, pos, unit.defense) * THREAT_SCALE;
  let friends = 0;
  for (const friend of ctx.myUnits) {
    if (friend.id !== unit.id && hexDistance(pos, friend) === 1) friends++;
  }
  value -= Math.max(0, friends - 1) * CROWD_PENALTY;
  return value;
}

function moveStaticScore(ctx, unit, pos) {
  const success = Math.max(0.05, 1 - combinedClaimRisk(ctx, cellKey(pos)));
  return success * (destinationValue(ctx, unit, pos) - stayValue(ctx, unit)) - (1 - success) * ACTION_COST;
}

function healStaticScore(ctx, support, aim) {
  let value = 0;
  let anyWounded = false;
  for (const ally of ctx.myUnits) {
    if (ally.hp >= ally.maxHp) continue;
    if (!aim.cells.some(cell => sameCell(cell, ally))) continue;
    anyWounded = true;
    const missing = ally.maxHp - ally.hp;
    const amount = Math.min(missing, (support.healPower ?? 0) + ctx.healVariance / 2);
    let gain = amount * HEAL_SCALE;
    const danger = incomingDamageAt(ctx, ally, ally.defense);
    if (danger >= ally.hp) gain += unitValue(ally) * 0.35;
    value += gain;
  }
  return anyWounded ? value : -Infinity;
}

function deployTypeBonus(ctx, type) {
  const base = { scout: 1.0, infantry: 1.05, ranger: 1.25, heavy: 1.15, support: 1.1 }[type] ?? 1;
  let bonus = 0;
  const counts = ctx.myTypeCounts;
  if (type === 'support' && !counts.support && ctx.myUnits.some(unit => unit.hp < unit.maxHp * 0.7)) bonus += 0.25;
  if (type === 'ranger' && !counts.ranger) bonus += 0.15;
  if (type === 'scout' && (counts.scout ?? 0) < 2) bonus += 0.12;
  return base + bonus;
}

function deployStaticScore(ctx, type, spec, origin, pos) {
  let value = DEPLOY_BASE * deployTypeBonus(ctx, type);
  const cp = ctx.cpByKey.get(cellKey(pos));
  if (cp && cp.owner !== ctx.owner && spec.canCapture) value += cpValue(ctx, cp, ctx.owner);
  let nearest = Infinity;
  for (const point of ctx.cps) {
    if (point.owner !== ctx.owner) nearest = Math.min(nearest, hexDistance(pos, point));
  }
  for (const hq of ctx.enemyHqs.values()) nearest = Math.min(nearest, hexDistance(pos, hq));
  if (Number.isFinite(nearest)) value += Math.max(0, 4 - nearest) * 12;
  const success = Math.max(0.05, 1 - combinedClaimRisk(ctx, cellKey(pos)));
  value = success * value - (1 - success) * ACTION_COST;
  value -= incomingDamageAt(ctx, pos, spec.defense ?? 0) * THREAT_SCALE * 0.7;
  return value;
}

// ---------------------------------------------------------------- 候选动作生成

function generateCandidates(ctx) {
  const candidates = [];

  for (const attacker of ctx.availableUnits) {
    if (!attacker.attackRange) continue;
    const seen = new Set();
    for (const { aim, click } of enumerateAims(ctx.game, attacker, 'attackShape')) {
      const signature = aim.cells.map(cellKey).join('|');
      if (seen.has(signature)) continue;
      seen.add(signature);
      const score = attackStaticScore(ctx, attacker, aim, click);
      if (score <= MIN_SCORE) continue;
      candidates.push({
        type: 'attack', unitId: attacker.id, score,
        action: { type: 'attack', payload: { attackerId: attacker.id, q: click.q, r: click.r } },
      });
    }
  }

  for (const support of ctx.availableUnits) {
    if (support.type !== 'support') continue;
    if (isArtilleryDanger(ctx.game, support)) continue;
    const seen = new Set();
    for (const { aim, click } of enumerateAims(ctx.game, support, 'healShape')) {
      if (aim.cells.some(cell => isArtilleryDanger(ctx.game, cell))) continue;
      const signature = aim.cells.map(cellKey).join('|');
      if (seen.has(signature)) continue;
      seen.add(signature);
      const score = healStaticScore(ctx, support, aim);
      if (!Number.isFinite(score) || score <= MIN_SCORE) continue;
      candidates.push({
        type: 'heal', unitId: support.id, score,
        action: { type: 'heal', payload: { supportId: support.id, q: click.q, r: click.r } },
      });
    }
  }

  for (const unit of ctx.availableUnits) {
    if (ctx.healLockedUnits.has(unit.id)) continue;
    for (const pos of ctx.utils.reachableCells(ctx.game, unit)) {
      if (isArtilleryDanger(ctx.game, pos)) continue;
      const score = moveStaticScore(ctx, unit, pos);
      if (score <= MIN_SCORE) continue;
      candidates.push({
        type: 'move', unitId: unit.id, cell: cellKey(pos), score,
        action: { type: 'move', payload: { unitId: unit.id, q: pos.q, r: pos.r } },
      });
    }
  }

  const supplies = ctx.game.resources?.[ctx.owner]?.supplies ?? 0;
  const unitTypes = Object.keys(ctx.game.config?.units ?? {});
  for (const origin of ctx.utils.deployOrigins(ctx.game, ctx.owner)) {
    if (isArtilleryDanger(ctx.game, origin)) continue;
    for (const type of unitTypes) {
      const spec = ctx.game.config.units[type];
      if (!spec) continue;
      const cost = ctx.utils.effectiveDeployCost(ctx.game, type, origin);
      if (cost > supplies) continue;
      for (const pos of ctx.utils.neighbors(origin)) {
        if (!ctx.utils.isEmptyPlain(ctx.game, pos)) continue;
        if (isArtilleryDanger(ctx.game, pos)) continue;
        const score = deployStaticScore(ctx, type, spec, origin, pos);
        if (score <= MIN_SCORE) continue;
        candidates.push({
          type: 'deploy', unitId: null, cell: cellKey(pos), cost, score,
          action: { type: 'deploy', payload: { unitType: type, fromId: origin.id, q: pos.q, r: pos.r } },
        });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

// ---------------------------------------------------------------- 计划构造（兼容性约束）

function makePlanBuilder(ctx) {
  const used = new Set();
  const claimed = new Set();
  let deploySpend = 0;
  const actions = [];
  return {
    actions,
    canAdd(candidate) {
      if (actions.length >= ctx.actionsPerTurn) return false;
      if (candidate.unitId && used.has(candidate.unitId)) return false;
      if (candidate.cell && claimed.has(candidate.cell)) return false;
      if (candidate.type === 'deploy' && deploySpend + candidate.cost > ctx.supplies) return false;
      return true;
    },
    add(candidate) {
      actions.push(candidate.action);
      if (candidate.unitId) used.add(candidate.unitId);
      if (candidate.cell) claimed.add(candidate.cell);
      if (candidate.type === 'deploy') deploySpend += candidate.cost;
    },
  };
}

/** 静态贪心：按分数降序填充兼容动作，直到预算耗尽或无正分动作。 */
function greedyPlan(ctx, candidates) {
  const builder = makePlanBuilder(ctx);
  for (const candidate of candidates) {
    if (builder.actions.length >= ctx.actionsPerTurn) break;
    if (builder.canAdd(candidate)) builder.add(candidate);
  }
  return builder.actions;
}

/** softmax 采样贪心：在近似同分的候选里按温度采样，产出多样化完整计划。 */
function sampledPlan(ctx, candidates, rng) {
  const builder = makePlanBuilder(ctx);
  const pool = [...candidates];
  while (builder.actions.length < ctx.actionsPerTurn && pool.length) {
    const eligible = [];
    for (let i = 0; i < pool.length; i++) {
      if (builder.canAdd(pool[i])) eligible.push(i);
      if (eligible.length >= 24) break;
    }
    if (!eligible.length) break;
    const maxScore = pool[eligible[0]].score;
    const weights = eligible.map(i => Math.exp((pool[i].score - maxScore) / CFG.sampleTemp));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let pick = rng() * total;
    let chosen = eligible[0];
    for (let k = 0; k < eligible.length; k++) {
      pick -= weights[k];
      if (pick <= 0) { chosen = eligible[k]; break; }
    }
    builder.add(pool[chosen]);
    pool.splice(chosen, 1);
  }
  return builder.actions;
}

function generateSeedPlans(ctx, candidates) {
  const plans = [];
  const seen = new Set();
  const push = plan => {
    const key = plan.map(actionSignature).sort().join(';');
    if (seen.has(key)) return;
    seen.add(key);
    plans.push(plan);
  };
  push(greedyPlan(ctx, candidates));
  const rng = mulberry32(ctx.seed ^ 0x5bf03635);
  let guard = 0;
  while (plans.length < CFG.candidates && guard++ < CFG.candidates * 6) {
    push(sampledPlan(ctx, candidates, rng));
  }
  return plans;
}

// ---------------------------------------------------------------- JS 单轮结算器
// 镜像 src/engine/simultaneous.ts 的 resolveRound（单轮、含目的格冲突池、部署、移动、
// 攻击形状/锁定、伤害掷骰、治疗、死亡淘汰、占点）。不含炮火/收入/维修/翻盘补给——
// 单轮 rollout 只需结算后的棋盘，用 evalBoard 收口。

function simulateRound(ctx, myPlan, enemyPlans, rng) {
  const game = ctx.game;
  const minDamage = ctx.minDamage;
  const variance = ctx.variance;
  const healVariance = ctx.healVariance;
  const order = ctx.turnOrder;

  // 轻量克隆（单轮内 cells/terrain 不变，无需克隆地图）。
  const units = game.units
    .filter(u => u.alive)
    .map(u => ({ id: u.id, owner: u.owner, type: u.type, q: u.q, r: u.r, hp: u.hp, maxHp: u.maxHp, attack: u.attack, defense: u.defense, attackRange: u.attackRange, canCapture: u.canCapture, healPower: u.healPower, cost: u.cost, alive: true }));
  const unitById = new Map(units.map(u => [u.id, u]));
  const hq = new Map();
  for (const [seat, h] of Object.entries(game.headquarters ?? {})) {
    if (h) hq.set(seat, { owner: seat, q: h.q, r: h.r, hp: h.hp, maxHp: h.maxHp, defense: h.defense, alive: h.alive !== false });
  }
  const cps = (game.controlPoints ?? []).map(cp => ({ id: cp.id, q: cp.q, r: cp.r, kind: cp.kind, owner: cp.owner }));
  const supplies = new Map();
  for (const [seat, res] of Object.entries(game.resources ?? {})) supplies.set(seat, res?.supplies ?? 0);
  // 计划时刻站位（锁定射击据此判定：点击格上原本站着的敌方单位）。
  const planTimePos = new Map();
  for (const u of game.units) if (u.alive) planTimePos.set(u.id, { q: u.q, r: u.r });

  const queues = new Map();
  queues.set(ctx.owner, myPlan);
  for (const [seat, plan] of Object.entries(enemyPlans)) queues.set(seat, plan);

  const nextRandom = () => rng();
  const rollDamage = (attack, defense) =>
    Math.max(minDamage, attack - defense + (Math.floor(nextRandom() * (2 * variance + 1)) - variance));
  const rollHeal = support => (support.healPower ?? 0) + Math.floor(nextRandom() * (healVariance + 1));

  // 阶段一+二：目的格声明池（所有席位的 deploy/move 共享，≥2 声明则全部失败）。
  const claims = new Map();
  for (const seat of order) {
    for (const action of queues.get(seat) ?? []) {
      if (action.type !== 'deploy' && action.type !== 'move') continue;
      const key = `${action.payload.q},${action.payload.r}`;
      claims.set(key, (claims.get(key) ?? 0) + 1);
    }
  }
  const conflict = action =>
    (action.type === 'deploy' || action.type === 'move') &&
    (claims.get(`${action.payload.q},${action.payload.r}`) ?? 0) > 1;

  // 阶段一：部署。
  for (const seat of order) {
    for (const action of queues.get(seat) ?? []) {
      if (action.type !== 'deploy') continue;
      const { unitType, fromId, q, r } = action.payload;
      if (conflict(action)) continue;
      const spec = game.config.units[unitType];
      if (!spec) continue;
      const origin = ctx.utils.deployOrigins(game, seat).find(o => o.id === fromId);
      const discount = origin ? Math.min(spec.cost, ctx.utils.cpKindEffect(game, origin)?.deployDiscount || 0) : 0;
      const cost = spec.cost - discount;
      const budget = supplies.get(seat) ?? 0;
      if (budget < cost) continue;
      supplies.set(seat, budget - cost);
      const unit = {
        id: `sim_${seat}_${unitType}_${q}_${r}_${units.length}`, owner: seat, type: unitType,
        q, r, hp: spec.hp, maxHp: spec.hp, attack: spec.attack, defense: spec.defense,
        attackRange: spec.attackRange, canCapture: spec.canCapture, healPower: spec.healPower,
        cost: spec.cost, alive: true,
      };
      units.push(unit);
      unitById.set(unit.id, unit);
    }
  }

  // 阶段二：移动。
  for (const seat of order) {
    for (const action of queues.get(seat) ?? []) {
      if (action.type !== 'move') continue;
      if (conflict(action)) continue;
      const unit = unitById.get(action.payload.unitId);
      if (!unit || unit.owner !== seat) continue;
      unit.q = action.payload.q;
      unit.r = action.payload.r;
    }
  }

  // 结算后占据表（攻击/治疗按移动后的棋盘判定）。
  const occupant = new Map();
  for (const unit of units) if (unit.alive) occupant.set(cellKey(unit), { kind: 'unit', entity: unit });
  for (const h of hq.values()) if (h.alive) occupant.set(`${h.q},${h.r}`, { kind: 'headquarters', entity: h });

  // 阶段三：收集攻击与治疗（按 turnOrder）。
  const strikes = [];
  const heals = [];
  for (const seat of order) {
    for (const action of queues.get(seat) ?? []) {
      if (action.type === 'attack') {
        const attacker = unitById.get(action.payload.attackerId);
        if (!attacker || attacker.owner !== seat || !attacker.alive) continue;
        const aim = computeAim(game, attacker, 'attackShape', { q: action.payload.q, r: action.payload.r });
        if (!aim) continue;
        let lockedId = null;
        if (game.config.units[attacker.type]?.attackLock) {
          // 锁定：计划时刻点击格上的**敌方**单位（移动后仍在射程内才命中）。
          for (const u of units) {
            if (u.owner === seat || !u.alive) continue;
            const pt = planTimePos.get(u.id);
            if (pt && pt.q === action.payload.q && pt.r === action.payload.r) { lockedId = u.id; break; }
          }
        }
        strikes.push({ seat, attacker, aim, lockedId });
      } else if (action.type === 'heal') {
        const support = unitById.get(action.payload.supportId);
        if (!support || support.owner !== seat || !support.alive) continue;
        if (support.type !== 'support') continue;
        const aim = computeAim(game, support, 'healShape', { q: action.payload.q, r: action.payload.r });
        if (!aim) continue;
        heals.push({ seat, support, aim });
      }
    }
  }

  // 3d：先治疗（按最终站位、覆盖格内所有受伤友军各自掷量），再按 turnOrder 施加伤害。
  for (const heal of heals) {
    for (const cell of heal.aim.cells) {
      const target = units.find(u => u.alive && u.owner === heal.seat && u.q === cell.q && u.r === cell.r);
      if (!target || target.hp >= target.maxHp) continue;
      const applied = Math.min(target.maxHp - target.hp, rollHeal(heal.support));
      if (applied > 0) target.hp += applied;
    }
  }

  const hqDamageBy = new Map();
  const killValueBy = new Map();
  for (const strike of strikes) {
    const targets = [];
    if (strike.lockedId) {
      const entity = unitById.get(strike.lockedId);
      if (entity && entity.alive && hexDistance(strike.attacker, entity) <= strike.attacker.attackRange) {
        targets.push({ kind: 'unit', entity });
      }
    } else {
      for (const cell of strike.aim.cells) {
        const occ = occupant.get(cellKey(cell));
        if (occ && occ.entity.owner !== strike.seat) targets.push(occ);
      }
    }
    for (const target of targets) {
      const entity = target.entity;
      const damage = rollDamage(strike.attacker.attack, entity.defense);
      const actual = Math.min(entity.hp, damage);
      entity.hp = Math.max(0, entity.hp - damage);
      if (target.kind === 'headquarters') {
        hqDamageBy.set(strike.seat, (hqDamageBy.get(strike.seat) ?? 0) + actual);
      }
      if (entity.hp === 0) {
        if (target.kind === 'unit') {
          entity.alive = false;
          killValueBy.set(strike.seat, (killValueBy.get(strike.seat) ?? 0) + (entity.cost ?? 0));
        } else {
          entity.alive = false;
        }
      }
    }
  }

  // 阶段四：占点（每个存活席位，一格一 canCapture 单位即占领）。
  const activeSeats = order.filter(seat => hq.get(seat)?.alive !== false);
  for (const seat of activeSeats) {
    for (const point of cps) {
      if (point.owner === seat) continue;
      const capturer = units.find(u => u.alive && u.owner === seat && u.canCapture && u.q === point.q && u.r === point.r);
      if (capturer) point.owner = seat;
    }
  }

  return { units, hq, cps, supplies, hqDamageBy, killValueBy, activeSeats };
}

// ---------------------------------------------------------------- 棋盘估值

function armyValueOf(sim, seat) {
  let sum = 0;
  for (const unit of sim.units) {
    if (unit.owner === seat && unit.alive) sum += Math.round(unit.cost * (unit.hp / unit.maxHp));
  }
  return sum;
}

function seatValue(sim, seat, weights) {
  const hq = sim.hq.get(seat);
  const ownHqHp = hq?.alive ? hq.hp : 0;
  let cps = 0;
  for (const point of sim.cps) if (point.owner === seat) cps++;
  return (sim.hqDamageBy.get(seat) ?? 0) * (weights.enemyHqDamage ?? 0)
    + ownHqHp * (weights.ownHqHp ?? 0)
    + cps * (weights.controlPoint ?? 0)
    + armyValueOf(sim, seat) * (weights.armyValue ?? 0)
    + (sim.killValueBy.get(seat) ?? 0) * (weights.killValue ?? 0);
}

function evalBoard(ctx, sim) {
  const weights = ctx.game.config?.balance?.adjudicationWeights ?? {};
  const ownerAlive = sim.hq.get(ctx.owner)?.alive !== false;
  const enemyAlive = ctx.enemySeats.some(seat => sim.hq.get(seat)?.alive !== false);
  if (!ownerAlive) return -TERMINAL;
  if (!enemyAlive) return TERMINAL;
  const mine = seatValue(sim, ctx.owner, weights);
  let best = -Infinity;
  for (const seat of ctx.enemySeats) {
    if (sim.hq.get(seat)?.alive === false) continue;
    best = Math.max(best, seatValue(sim, seat, weights));
  }
  if (!Number.isFinite(best)) best = 0;
  return mine - best;
}

// ---------------------------------------------------------------- 对手组合采样

const PERSONALITIES = ['objective', 'aggressive', 'random'];

function sampleFromDist(dist, rng) {
  let pick = rng();
  for (const [key, probability] of dist) {
    pick -= probability;
    if (pick <= 0) return parseKey(key);
  }
  return parseKey(dist.keys().next().value);
}

/** 为一个敌方席位采样一份合法计划（性格决定 move/attack 倾向与落点分布）。 */
function sampleEnemyPlan(ctx, seat, rng) {
  const personality = PERSONALITIES[Math.floor(rng() * PERSONALITIES.length)];
  const budget = ctx.actionsPerTurn;
  const units = ctx.enemiesBySeat.get(seat) ?? [];
  const claimed = new Set();
  const plan = [];
  const pAttack = personality === 'aggressive' ? 0.75 : personality === 'objective' ? 0.4 : 0.5;

  const shuffled = [...units];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  for (const unit of shuffled) {
    if (plan.length >= budget) break;
    // 攻击：从当前位置瞄准我方当前格 / 可达格（预测）/ 总部。
    if ((unit.attackRange ?? 0) > 0 && rng() < pAttack) {
      const aim = sampleEnemyAttackAim(ctx, unit, rng);
      if (aim) { plan.push(aim); continue; }
    }
    // 移动：按性格采样落点。
    const reach = ctx.reachByUnit.get(unit.id) ?? [];
    if (reach.length && rng() < 0.85) {
      let dest;
      if (personality === 'random') dest = reach[Math.floor(rng() * reach.length)];
      else {
        const dist = ctx.distByUnit.get(unit.id);
        dest = dist ? sampleFromDist(dist, rng) : reach[Math.floor(rng() * reach.length)];
      }
      const key = cellKey(dest);
      if (dest && !sameCell(dest, unit) && !claimed.has(key)) {
        claimed.add(key);
        plan.push({ type: 'move', payload: { unitId: unit.id, q: dest.q, r: dest.r } });
      }
    }
  }

  // 偶发部署（有粮、有部署源、有空邻格）。
  const supplies = ctx.enemySupplies.get(seat) ?? 0;
  const unitTypes = Object.keys(ctx.game.config?.units ?? {});
  if (plan.length < budget && unitTypes.length && rng() < 0.4) {
    const origins = ctx.utils.deployOrigins(ctx.game, seat);
    for (const origin of origins) {
      const affordable = unitTypes.filter(type => ctx.utils.effectiveDeployCost(ctx.game, type, origin) <= supplies);
      if (!affordable.length) continue;
      const spots = ctx.utils.neighbors(origin).filter(pos => ctx.utils.isEmptyPlain(ctx.game, pos) && !claimed.has(cellKey(pos)));
      if (!spots.length) continue;
      const type = affordable[Math.floor(rng() * affordable.length)];
      const pos = spots[Math.floor(rng() * spots.length)];
      claimed.add(cellKey(pos));
      plan.push({ type: 'deploy', payload: { unitType: type, fromId: origin.id, q: pos.q, r: pos.r } });
      break;
    }
  }
  return plan;
}

/** 敌攻击瞄准：在我方当前格/可达格/总部里挑一个位于其射程内的目标格。 */
function sampleEnemyAttackAim(ctx, unit, rng) {
  const range = unit.attackRange ?? 0;
  const targets = [];
  for (const mine of ctx.myUnits) {
    if (hexDistance(unit, mine) <= range) targets.push({ q: mine.q, r: mine.r, w: 3 });
    const reach = ctx.myReach.get(mine.id) ?? [];
    for (const cell of reach) {
      if (hexDistance(unit, cell) <= range) targets.push({ q: cell.q, r: cell.r, w: 1 });
    }
  }
  if (ctx.myHq && hexDistance(unit, ctx.myHq) <= range) targets.push({ q: ctx.myHq.q, r: ctx.myHq.r, w: 2 });
  if (!targets.length) return null;
  const total = targets.reduce((sum, target) => sum + target.w, 0);
  let pick = rng() * total;
  let chosen = targets[0];
  for (const target of targets) {
    pick -= target.w;
    if (pick <= 0) { chosen = target; break; }
  }
  const aim = computeAim(ctx.game, unit, 'attackShape', { q: chosen.q, r: chosen.r });
  if (!aim) return null;
  return { type: 'attack', payload: { attackerId: unit.id, q: chosen.q, r: chosen.r } };
}

function sampleAllEnemyPlans(ctx, rng) {
  const plans = {};
  for (const seat of ctx.enemySeats) plans[seat] = sampleEnemyPlan(ctx, seat, rng);
  return plans;
}

// ---------------------------------------------------------------- 计划打分（rollout）

function scorePlan(ctx, plan, baseSeed) {
  const n = CFG.rollouts;
  let sum = 0;
  let sumSq = 0;
  const samples = [];
  for (let i = 0; i < n; i++) {
    const rng = mulberry32((baseSeed + Math.imul(i + 1, 0x9e3779b9)) >>> 0);
    const enemyPlans = sampleAllEnemyPlans(ctx, rng);
    const sim = simulateRound(ctx, plan, enemyPlans, rng);
    const value = evalBoard(ctx, sim);
    samples.push(value);
    sum += value;
    sumSq += value * value;
  }
  const mean = sum / n;
  const variance = Math.max(0, sumSq / n - mean * mean);
  const std = Math.sqrt(variance);
  // 终局样本（±TERMINAL）会把 std 拉爆：命中终局时直接按均值主导，避免风险项掩盖必胜/必败。
  const hasTerminal = samples.some(value => Math.abs(value) >= TERMINAL / 2);
  const risk = hasTerminal ? mean : mean - CFG.riskLambda * std;
  return { mean, std, risk };
}

// ---------------------------------------------------------------- 联合搜索

function searchBestPlan(ctx) {
  const deadline = Date.now() + CFG.timeBudgetMs;
  const candidates = generateCandidates(ctx);
  if (!candidates.length) return [];

  const seeds = generateSeedPlans(ctx, candidates);
  let best = { plan: [], score: -Infinity };
  for (const plan of seeds) {
    const score = scorePlan(ctx, plan, ctx.seed).risk;
    if (score > best.score) best = { plan, score };
    if (Date.now() > deadline) return best.plan;
  }

  // 爬山精修：逐槽位尝试用同单位的其他候选替换（或删槽），rollout 打分保留改进。
  const byUnit = new Map();
  for (const candidate of candidates) {
    if (!candidate.unitId) continue;
    if (!byUnit.has(candidate.unitId)) byUnit.set(candidate.unitId, []);
    byUnit.get(candidate.unitId).push(candidate);
  }

  for (let pass = 0; pass < CFG.refinePasses; pass++) {
    let improved = false;
    for (let slot = 0; slot < best.plan.length; slot++) {
      if (Date.now() > deadline) return best.plan;
      const current = best.plan[slot];
      const unitId = actionUnitId(current);
      const alternatives = (byUnit.get(unitId) ?? [])
        .filter(candidate => actionSignature(candidate.action) !== actionSignature(current));
      for (const alt of alternatives.slice(0, 6)) {
        const trial = [...best.plan];
        trial[slot] = alt.action;
        if (!isPlanLegal(ctx, trial)) continue;
        const score = scorePlan(ctx, trial, ctx.seed).risk;
        if (score > best.score + 1e-6) {
          best = { plan: trial, score };
          improved = true;
          break;
        }
        if (Date.now() > deadline) return best.plan;
      }
    }
    // 预算未满时，尝试追加一个兼容动作。
    if (best.plan.length < ctx.actionsPerTurn && Date.now() <= deadline) {
      for (const candidate of candidates) {
        const trial = [...best.plan, candidate.action];
        if (!isPlanLegal(ctx, trial)) continue;
        const score = scorePlan(ctx, trial, ctx.seed).risk;
        if (score > best.score + 1e-6) { best = { plan: trial, score }; improved = true; break; }
        if (Date.now() > deadline) break;
      }
    }
    if (!improved || Date.now() > deadline) break;
  }
  return best.plan;
}

/** 计划自洽校验：一单位一动作、目的格互不冲突、预算与部署花费不超。 */
function isPlanLegal(ctx, plan) {
  if (plan.length > ctx.actionsPerTurn) return false;
  const used = new Set();
  const claimed = new Set();
  let spend = 0;
  for (const action of plan) {
    const unitId = actionUnitId(action);
    if (unitId) {
      if (used.has(unitId)) return false;
      used.add(unitId);
    }
    if ((action.type === 'deploy' || action.type === 'move') && typeof action.payload.q === 'number') {
      const key = `${action.payload.q},${action.payload.r}`;
      if (claimed.has(key)) return false;
      claimed.add(key);
    }
    if (action.type === 'deploy') {
      const spec = ctx.game.config?.units?.[action.payload.unitType];
      spend += spec?.cost ?? 0;
    }
  }
  return spend <= ctx.supplies;
}

// ---------------------------------------------------------------- 目标与上下文

function objectiveFor(ctx, unit) {
  if (unit.canCapture) {
    let best = null;
    for (const cp of ctx.cps) {
      if (cp.owner === ctx.owner) continue;
      const score = cpValue(ctx, cp, ctx.owner) / (1 + hexDistance(unit, cp) * 1.5);
      if (!best || score > best.score) best = { pos: cp, kind: 'cp', score };
    }
    if (best) return best;
  }
  if (unit.type === 'support') {
    const wounded = ctx.myUnits
      .filter(ally => ally.id !== unit.id && ally.hp < ally.maxHp)
      .sort((a, b) => (b.maxHp - b.hp) - (a.maxHp - a.hp));
    if (wounded[0]) return { pos: wounded[0], kind: 'ally' };
    if (ctx.myHq) return { pos: ctx.myHq, kind: 'hq' };
  }
  let best = null;
  for (const enemy of ctx.enemies) {
    const score = 100 / (1 + hexDistance(unit, enemy));
    if (!best || score > best.score) best = { pos: enemy, kind: 'unit', score };
  }
  for (const hq of ctx.enemyHqs.values()) {
    const score = (unit.canCapture ? 120 : 90) / (1 + hexDistance(unit, hq));
    if (!best || score > best.score) best = { pos: hq, kind: 'hq', score };
  }
  return best;
}

function buildContext(game, owner, utils) {
  const cps = game.controlPoints ?? [];
  const queue = game.plan?.myQueue ?? game.plan?.queues?.[owner] ?? [];
  const myUnits = utils.livingUnits(game, owner);
  const enemySeats = utils.enemySeats(game, owner);
  const enemies = enemySeats.flatMap(seat => utils.livingUnits(game, seat));
  const enemiesBySeat = new Map(enemySeats.map(seat => [seat, utils.livingUnits(game, seat)]));

  const myTypeCounts = {};
  for (const unit of myUnits) myTypeCounts[unit.type] = (myTypeCounts[unit.type] ?? 0) + 1;

  const roundNumber = game.turn?.roundNumber ?? game.turn?.turnNumber ?? 1;
  const ctx = {
    game, utils, owner, queue, cps, myUnits, enemies, enemySeats, enemiesBySeat, myTypeCounts,
    myHq: game.headquarters?.[owner] ?? null,
    enemyHqs: new Map(enemySeats.map(seat => [seat, game.headquarters?.[seat]]).filter(([, h]) => h?.alive)),
    enemyById: new Map(enemies.map(enemy => [enemy.id, enemy])),
    enemyHqByKey: new Map(),
    cpByKey: new Map(cps.map(cp => [cellKey(cp), cp])),
    myUnitCells: new Set(myUnits.map(cellKey)),
    nearMyUnitCells: new Set(),
    contestedCpCells: new Set(cps.filter(cp => cp.owner !== owner).map(cellKey)),
    myHqCell: game.headquarters?.[owner] ? cellKey(game.headquarters[owner]) : null,
    used: plannedUnitIds(queue),
    claimed: claimedCells(queue),
    healLockedUnits: new Set(),
    objectives: new Map(),
    myReach: new Map(),
    enemySupplies: new Map(enemySeats.map(seat => [seat, game.resources?.[seat]?.supplies ?? 0])),
    supplies: game.resources?.[owner]?.supplies ?? 0,
    turnOrder: (game.turn?.turnOrder ?? []).filter(seat => game.players?.[seat]?.status === 'active'),
    maxTurns: game.config?.balance?.maxTurns === null ? null : (game.config?.balance?.maxTurns ?? 15),
    roundNumber,
    actionsPerTurn: game.config?.balance?.actionsPerTurn ?? 5,
    variance: game.config?.balance?.damageVarianceRange ?? 3,
    healVariance: game.config?.balance?.healVarianceRange ?? 6,
    minDamage: game.config?.balance?.minimumDamage ?? 1,
    volleyFactor: 1,
    seed: stateSeed(game, owner, roundNumber),
    enemyDeployRisk: new Map(),
    distByUnit: new Map(),
    reachByUnit: new Map(),
    presence: new Map(),
    claimRisk: new Map(),
    attackEntries: new Map(),
  };
  if (!ctx.turnOrder.length) ctx.turnOrder = [owner, ...enemySeats];
  // 结算顺序里己方席位必须存在，否则 simulateRound 会漏掉我方队列。
  if (!ctx.turnOrder.includes(owner)) ctx.turnOrder = [owner, ...ctx.turnOrder];

  for (const hq of ctx.enemyHqs.values()) ctx.enemyHqByKey.set(cellKey(hq), hq);
  for (const unit of myUnits) {
    ctx.myReach.set(unit.id, utils.reachableCells(game, unit));
    for (const neighbor of utils.neighbors(unit)) ctx.nearMyUnitCells.add(cellKey(neighbor));
  }
  ctx.availableUnits = myUnits.filter(unit => !ctx.used.has(unit.id));
  ctx.volleyFactor = enemies.length ? Math.min(1, ctx.actionsPerTurn / enemies.length) : 1;

  // 队列里已有治疗：锁定被治疗友军，后续不再排移动（否则治疗结算时 fizzle）。
  for (const action of queue) {
    if (action.type === 'heal' && action.supportId) {
      const support = myUnits.find(unit => unit.id === action.supportId);
      if (!support) continue;
      const aim = computeAim(game, support, 'healShape', { q: action.q, r: action.r });
      if (!aim) continue;
      for (const ally of myUnits) {
        if (ally.hp >= ally.maxHp) continue;
        if (!aim.cells.some(cell => sameCell(cell, ally))) continue;
        ctx.healLockedUnits.add(ally.id);
      }
    }
  }

  Object.assign(ctx, buildEnemyModel(ctx));
  ctx.enemyDeployRisk = buildEnemyDeployRisk(ctx);
  for (const unit of myUnits) {
    const objective = objectiveFor(ctx, unit);
    if (objective) ctx.objectives.set(unit.id, objective);
  }
  return ctx;
}

// ---------------------------------------------------------------- 每轮计划缓存

const planCache = new Map();

function cacheKey(game, owner, roundNumber) {
  return `${game.id ?? 'g'}:${owner}:${roundNumber}`;
}

function pruneCache(currentKey) {
  for (const key of planCache.keys()) {
    if (key !== currentKey) planCache.delete(key);
  }
}

/**
 * 兵棋推演算法主模块
 */
export default {
  name: 'kriegspiel',
  description: '兵棋推演算法：真实结算 rollout + 整份计划联合搜索 + 风险规避',

  async decide(game, utils, ctx) {
    const owner = ctx?.owner;
    if (!owner || !game.plan) return null;
    if ((game.plan.committed ?? []).includes(owner)) return null;

    const queue = game.plan.myQueue ?? game.plan.queues?.[owner] ?? [];
    const limit = game.config?.balance?.actionsPerTurn ?? 5;
    if (queue.length >= limit) return null;

    const roundNumber = game.turn?.roundNumber ?? game.turn?.turnNumber ?? 1;
    const key = cacheKey(game, owner, roundNumber);
    let entry = planCache.get(key);
    if (!entry) {
      pruneCache(key);
      const context = buildContext(game, owner, utils);
      const actions = context.availableUnits.length || context.utils.deployOrigins(game, owner).length
        ? searchBestPlan(context)
        : [];
      entry = { actions, cursor: 0 };
      planCache.set(key, entry);
    }

    const queueSigs = new Set(queue.map(action => actionSignature({
      type: action.type,
      payload: {
        ...(action.type === 'attack' ? { attackerId: action.attackerId } : {}),
        ...(action.type === 'heal' ? { supportId: action.supportId } : {}),
        ...(action.type === 'move' ? { unitId: action.unitId } : {}),
        ...(action.type === 'deploy' ? { unitType: action.unitType, fromId: action.fromId } : {}),
        ...(typeof action.q === 'number' ? { q: action.q, r: action.r } : {}),
      },
    })));

    while (entry.cursor < entry.actions.length) {
      const action = entry.actions[entry.cursor++];
      if (queueSigs.has(actionSignature(action))) continue; // 已入队
      return { type: action.type, payload: action.payload };
    }
    return null;
  },
};

// 测试/标定用的内部入口（runner 只读 default）。
export const kriegspielInternals = {
  buildContext,
  buildEnemyModel,
  simulateRound,
  evalBoard,
  scorePlan,
  searchBestPlan,
  generateCandidates,
  sampleAllEnemyPlans,
  isPlanLegal,
  mulberry32,
};
