// algorithms/builtin/dest-prob.mjs
//
// 落点概率算法（Destination Probability）——同时回合模式的
// 对手落点建模 + 预测射击 + 目的格冲突规避算法。
//
// 与 random-sim 的差别：不做随机抽样，所有计划动作按期望收益竞标。
// 与标准模式 threat / field 的差别：它们评估的是"当前棋盘"的威胁；
// 同时回合的命中判定发生在移动/部署之后，真正决定伤害的是"敌人会站到哪"。
// 本算法先为每个敌军建立落点概率分布（目标引力 + 火力机会 − 我方威胁 +
// 原地惯性），再在此分布上计算三件事：
//   1. 预测射击：攻击收益 = 覆盖格上敌军出现概率 × 伤害，而不是只看当前站位；
//   2. 冲突规避：移动/部署目的格若被多个敌军高概率认领，成功率先打折——
//      同时模式里同一目的格被 ≥2 人声明会让所有人一起失败；
//   3. 威胁预判：用敌军落点分布反推我方每个候选落点的期望承伤，而不是把
//      敌军可达格并集当成均匀威胁。
//
// 另外把据点按"裁定权重 × 预计持有回合 + 收入"计价（据点流量分占 0.7），
// 所以开局会优先铺开占点，而不是像随机基线那样把行动点撒在空地上。
//
// 3.8.0 起同时回合按行动点分步结算：同一单位可以在多个行动点连续行动，
// 队列顺序就是行动点顺序。v2 的候选生成改为「队列前缀投影」：
//   - 攻击/治疗/爆破的起点按已排队移动的投影站位计算；
//   - 移动只按地形 BFS（单位/总部不再挡路），占用留到结算判定；
//   - 同一单位可重复出招，但攻击次数受 balance.attacksPerUnit 限制；
//   - 目的格冲突仍按概率规避（同一格多个到达者会在结算时一起失败）。
//
// 约束：所有枚举镜像 src/engine/planning.ts 的 3.8 入队校验（形状、
// 前缀投影、攻击次数上限、部署预算、炮火危险区），保证 runner 不会因
// 非法动作空耗重问配额。

const HEX_DIRS = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

// ─── 效用尺度：1 点期望伤害 ≈ DAMAGE_SCALE 分；其余项按此校准 ───
const DAMAGE_SCALE = 6;
const KILL_WEIGHT = 0.9;
const LIKELY_KILL_WEIGHT = 0.55;
const HQ_DAMAGE_BONUS = 1.3;
const HQ_KILL = 6000;
/** 攻击覆盖到敌方据点的"区域拒止"附加分（占该据点价值比例）。 */
const DENIAL_WEIGHT = 0.05;
const HEAL_SCALE = 7.5;
/** 落点期望承伤 → 效用损失。 */
const THREAT_SCALE = 0.9;
/** 攻击动作会让单位原地停留，额外计入一部分下回合承伤。 */
const EXPOSURE_WEIGHT = 0.5;
/** 向目标推进 1 格的效用。 */
const PROGRESS_SCALE = 16;
/** 接近据点时的额外引力（按剩余距离归一化）。 */
const APPROACH_WEIGHT = 0.18;
/** 一次行动机会的机会成本：目的格冲突失败时扣除。 */
const ACTION_COST = 80;
/** 部署基准分：新单位价值 + 站位价值，低于一次高价值占点/攻击。 */
const DEPLOY_BASE = 170;
/** 重装爆破的低优先级基准分：只在不挤占占点/攻击时使用。 */
const DEMOLISH_UTILITY = 80;
const CROWD_PENALTY = 7;
const GARRISON_BONUS = 35;
const MIN_SCORE = 0.5;
/** 据点价值按最多持有 4 回合计价，避免把"假设守到终局"的虚高收益算进去。 */
const CP_HOLD_CAP = 4;

// ─── 敌军落点模型 ───
const ENEMY_TOP_K = 8;
const ENEMY_SCORE_WINDOW = 70;
const ENEMY_TEMP = 24;
/** 原地惯性：移动要花一次行动，且可能撞上目的格冲突。 */
const ENEMY_STAY_BONUS = 12;

const cellKey = pos => `${pos.q},${pos.r}`;
const sameCell = (a, b) => a.q === b.q && a.r === b.r;

function hexDistance(a, b) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  const ds = -a.q - a.r - (-b.q - b.r);
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds));
}

function unitValue(unit) {
  return 120 + (unit.cost || 50) * 3;
}

function parseKey(key) {
  const [q, r] = key.split(',').map(Number);
  return { q, r };
}

// ---------------------------------------------------------------- 形状镜像

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

/**
 * 镜像 src/engine/planning.ts 的 coveredCellsFor：返回点击格推导出的覆盖形状。
 * 这是所有攻/治枚举的唯一合法口径——必须与引擎逐字同构。
 */
function computeAim(game, unit, kind, click) {
  const shape = shapeSpec(game, unit.type, kind);
  const range = kind === 'attackShape' ? (unit.attackRange ?? 1) : healRangeFor(game, unit);
  const dq = click.q - unit.q;
  const dr = click.r - unit.r;
  if (hexDistance(unit, click) > range) return null;

  if (shape.type === 'single') {
    if (kind === 'attackShape' && dq === 0 && dr === 0) return null;
    return { type: 'single', direction: 0, cells: [{ q: click.q, r: click.r }] };
  }

  if (shape.type === 'arc') {
    if (hexDistance(unit, click) !== 1) return null;
    const direction = HEX_DIRS.findIndex(d => d.q === dq && d.r === dr);
    if (direction < 0) return null;
    return {
      type: 'arc',
      direction,
      cells: [(direction + 5) % 6, direction, (direction + 1) % 6].map(index => ({
        q: unit.q + HEX_DIRS[index].q,
        r: unit.r + HEX_DIRS[index].r,
      })),
    };
  }

  // line：点击格必须落在正六方向射线上，距离 1..min(length, range)。
  const length = Math.min(shape.length, range);
  for (let direction = 0; direction < 6; direction++) {
    const d = HEX_DIRS[direction];
    const k = d.q !== 0 ? dq / d.q : dr / d.r;
    if (!Number.isInteger(k) || k < 1 || k > length) continue;
    if (d.q * k !== dq || d.r * k !== dr) continue;
    const cells = [];
    for (let step = 1; step <= length; step++) {
      cells.push({ q: unit.q + d.q * step, r: unit.r + d.r * step });
    }
    return { type: 'line', direction, cells };
  }
  return null;
}

/** 枚举一个单位所有合法瞄准（按覆盖形状去重由调用方处理）。 */
function enumerateAims(game, unit, kind) {
  const shape = shapeSpec(game, unit.type, kind);
  const range = kind === 'attackShape' ? (unit.attackRange ?? 1) : healRangeFor(game, unit);
  const inBounds = new Set(game.cells.map(cellKey));
  const aims = [];

  if (shape.type === 'single') {
    for (const cell of game.cells) {
      const distance = hexDistance(unit, cell);
      if (distance > range) continue;
      if (kind === 'attackShape' && distance === 0) continue;
      aims.push({ click: { q: cell.q, r: cell.r }, aim: { type: 'single', direction: 0, cells: [{ q: cell.q, r: cell.r }] } });
    }
    return aims;
  }

  if (shape.type === 'arc') {
    for (const d of HEX_DIRS) {
      const click = { q: unit.q + d.q, r: unit.r + d.r };
      if (!inBounds.has(cellKey(click))) continue;
      const aim = computeAim(game, unit, kind, click);
      if (aim) aims.push({ click, aim });
    }
    return aims;
  }

  for (const d of HEX_DIRS) {
    const click = { q: unit.q + d.q, r: unit.r + d.r };
    if (!inBounds.has(cellKey(click))) continue;
    const aim = computeAim(game, unit, kind, click);
    if (aim && aim.cells.length) aims.push({ click, aim });
  }
  return aims;
}

/**
 * 某单位从 pos 出发、按攻击形状最多能覆盖到的格并集。
 * 用于敌军落点打分（近似：不区分朝向，只问"这个落点能不能打到某个目标"）。
 */
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

/**
 * 队列前缀投影：和 src/engine/planning.ts:projectPlanQueue 同口径。
 * 只投影自己的移动与爆破；前面的动作失败会在结算时级联作废后续动作，
 * 但计划期仍按“假设成功”生成候选。
 */
function projectPlan(queue) {
  const positions = new Map();
  const terrain = new Map();
  const deployCells = new Set();
  for (const action of queue) {
    const unitId = action.unitId ?? action.attackerId ?? action.supportId;
    if (action.type === 'move' && unitId && Number.isFinite(action.q) && Number.isFinite(action.r)) {
      positions.set(unitId, { q: action.q, r: action.r });
    } else if (action.type === 'demolish' && Number.isFinite(action.q) && Number.isFinite(action.r)) {
      terrain.set(cellKey(action), 'plain');
    } else if (action.type === 'deploy' && Number.isFinite(action.q) && Number.isFinite(action.r)) {
      deployCells.add(cellKey(action));
    }
  }
  return { positions, terrain, deployCells };
}

function projectedPos(projection, unit) {
  return projection.positions.get(unit.id) ?? { q: unit.q, r: unit.r };
}

function projectedTerrain(game, projection, pos, utils) {
  return projection.terrain.get(cellKey(pos)) ?? utils.terrainAt(game, pos);
}

/** 计划期移动可达格：只受地形限制，单位/总部不挡路（镜像 planning.ts）。 */
function terrainReachable(game, from, moveRange, projection, utils) {
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
      if (!utils.isPlayable(game, next)) continue;
      if (projectedTerrain(game, projection, next, utils) !== 'plain') continue;
      reachable.push(next);
      queue.push({ p: next, d: cur.d + 1 });
    }
  }
  return reachable;
}

/**
 * 当前步的己方投影占位：
 * - 己方单位按前缀投影后的位置；
 * - 之前排队的 deploy 也占住目标格（新单位计划期没有 id）；
 * - 敌方单位/总部按当前棋盘保守排除（它们是否离开由结算决定）。
 */
function projectedEmpty(game, owner, projection, pos, utils) {
  for (const unit of utils.livingUnits(game, owner)) {
    const at = projectedPos(projection, unit);
    if (sameCell(at, pos)) return false;
  }
  if (projection.deployCells.has(cellKey(pos))) return false;
  for (const unit of game.units ?? []) {
    if (unit.alive && unit.owner !== owner && sameCell(unit, pos)) return false;
  }
  for (const hq of Object.values(game.headquarters ?? {})) {
    if (hq.alive && sameCell(hq, pos)) return false;
  }
  return true;
}

function attackLimitFor(game) {
  return game.config?.balance?.attacksPerUnit ?? 1;
}

function queuedAttackCount(queue, unitId) {
  return queue.filter(action => action.type === 'attack' && action.attackerId === unitId).length;
}

function claimedCells(queue) {
  const claimed = new Set();
  for (const action of queue) {
    if ((action.type === 'deploy' || action.type === 'move') && typeof action.q === 'number') {
      claimed.add(`${action.q},${action.r}`);
    }
  }
  return claimed;
}

function plannedDeploySpend(game, owner, queue, utils) {
  const origins = new Map(utils.deployOrigins(game, owner).map(origin => [origin.id, origin]));
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

// ---------------------------------------------------------------- 据点计价

/** 据点价值：裁定流量权重 × 预计持有回合 + 收入，敌方据点按攻防转换放大。 */
function cpValue(ctx, cp, owner) {
  if (cp.owner === owner) return 0;
  const remaining = ctx.maxTurns === null
    ? 12
    : Math.max(1, ctx.maxTurns - ctx.roundNumber + 1);
  const hold = Math.min(remaining, CP_HOLD_CAP);
  const weights = ctx.game.config?.balance?.adjudicationWeights ?? {};
  const weight = weights.controlPoint ?? 60;
  const flow = weights.controlPointFlowRatio ?? 0.7;
  const income = ctx.utils.cpKindEffect(ctx.game, cp)?.income
    ?? ctx.game.config?.balance?.controlPointIncome
    ?? 8;
  let value = weight * (flow * hold + (1 - flow)) + income * hold * 2;
  if (cp.owner) value *= 1.5;
  return value;
}

// ---------------------------------------------------------------- 敌军落点分布

function damageStats(ctx, attack, defense) {
  return {
    avg: Math.max(ctx.minDamage, (attack ?? 0) - (defense || 0)),
    worst: Math.max(ctx.minDamage, (attack ?? 0) - (defense || 0) - ctx.variance),
  };
}

/** 敌方从 pos 出发能打出的最佳单次伤害（用于预测敌军为什么去某个落点）。 */
function enemyBestAttackAt(ctx, enemy, pos) {
  const covered = coverageUnion(ctx.game, enemy, pos, 'attackShape');
  let best = 0;
  const targets = [
    ...ctx.myUnitsForThreat.map(unit => ({ kind: 'unit', entity: unit })),
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

/** 敌军在我方当前火力下的落点风险（只按当前站位近似，不替敌军做深度推演）。 */
function enemySafetyAt(ctx, enemy, pos) {
  let threat = 0;
  for (const unit of ctx.myUnitsForThreat) {
    if (hexDistance(pos, unit) <= (unit.attackRange ?? 1)) {
      const damage = damageStats(ctx, unit.attack, enemy.defense);
      threat += damage.avg * 0.45;
    }
  }
  return threat;
}

/** 敌军落点打分：占点引力 + 火力机会 + 支援锚点 − 我方威胁 + 原地惯性。 */
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
      if (distance < currentDistance) {
        score += (currentDistance - distance) * value * 0.05;
      }
    }
  } else if (enemy.type === 'support') {
    // 支援兵不冲锋：贴近受伤友军（治疗）比贴近我方战线更有价值。
    for (const ally of ctx.enemies) {
      if (ally.owner !== enemy.owner || ally.id === enemy.id || ally.hp >= ally.maxHp) continue;
      const missing = ally.maxHp - ally.hp;
      score += (missing / ally.maxHp) * 90 / (1 + hexDistance(pos, ally));
    }
    if (ctx.enemyHqs.has(enemy.owner)) score += 20 / (1 + hexDistance(pos, ctx.enemyHqs.get(enemy.owner)));
  } else {
    // 非占点兵种：向最近的我方单位/总部靠拢。
    let nearest = Infinity;
    for (const unit of ctx.myUnitsForThreat) nearest = Math.min(nearest, hexDistance(pos, unit));
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
 * - presence：每个格 → Map(unitId, probability)
 * - claimRisk：每个格被至少一个敌军移动/部署认领的概率
 * - attackEntries：每个格可能吃到的敌方火力（含概率权重）
 */
function buildEnemyModel(ctx) {
  const distByUnit = new Map();
  const presence = new Map();
  const claimRisk = new Map();
  const attackEntries = new Map();
  // 敌军每步也可能行动；但敌方行动点仍要分给移动/攻击/部署，按单位数摊薄。
  const actionRate = Math.min(1, ctx.actionsPerTurn / Math.max(1, ctx.enemies.length));
  for (const enemy of ctx.enemies) {
    const candidates = [
      { q: enemy.q, r: enemy.r },
      ...ctx.utils.reachableCells(ctx.game, enemy),
    ];
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
    // 原地必须保留：敌军可能选择攻击/治疗/部署，而不是移动。
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
    // 未行动/未移动的概率回填到原地。
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

      // 该落点出发的覆盖格：敌方可能把这一枪打向任何覆盖格，按目标价值加权。
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

  return { distByUnit, presence, claimRisk, attackEntries };
}

/** 我方目标格被敌方选为射击目标的权重：当前站位最可预测，据点次之，空地最低。 */
function targetWeight(ctx, key) {
  if (ctx.myUnitCells.has(key) || ctx.myHqCell === key) return 1;
  if (ctx.contestedCpCells.has(key)) return 0.5;
  if (ctx.nearMyUnitCells.has(key)) return 0.25;
  return 0.08;
}

/** 敌军部署可能抢格的风险：只按"有兵、有粮、有部署源"做低权重估计。 */
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

/** 我方在 pos 站一个 defense 单位时，下一轮可能吃到的期望伤害。 */
function incomingDamageAt(ctx, pos, defense) {
  const entries = ctx.attackEntries.get(cellKey(pos));
  if (!entries?.length) return 0;
  let total = 0;
  for (const entry of entries) {
    total += Math.max(ctx.minDamage, entry.attack - (defense || 0)) * entry.probability * entry.weight;
  }
  return total * ctx.volleyFactor;
}

// ---------------------------------------------------------------- 我方行动评估

/** 从 pos 出发下一轮能打出的最佳火力（移动/驻留的机会成本）。 */
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
    else if (damage.avg >= enemy.hp) value += unitValue(enemy) * LIKELY_KILL_WEIGHT * probability;
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

/** 当前队列前缀下，单位在“下一个待排动作”开始时的虚拟站位。 */
function projectedUnit(ctx, unit) {
  const at = projectedPos(ctx.projection, unit);
  return { ...unit, q: at.q, r: at.r };
}

/** 单位留在原地的价值：已站在非己方据点上时，原地也能完成占领。 */
function stayValue(ctx, unit) {
  const at = projectedUnit(ctx, unit);
  let value = 0;
  const cp = ctx.cpByKey.get(cellKey(at));
  if (cp && cp.owner !== ctx.owner && at.canCapture) value += cpValue(ctx, cp, ctx.owner);
  else if (cp && cp.owner === ctx.owner) value += GARRISON_BONUS;

  value += fireOpportunity(ctx, at, at) * 0.45;
  value -= incomingDamageAt(ctx, at, at.defense) * THREAT_SCALE;
  return value;
}

/** 单位走到 pos 的静态价值（不含冲突成功率与原地比较）。 */
function destinationValue(ctx, unit, pos) {
  const from = projectedUnit(ctx, unit);
  let value = 0;
  const cp = ctx.cpByKey.get(cellKey(pos));
  if (cp && cp.owner !== ctx.owner && unit.canCapture) value += cpValue(ctx, cp, ctx.owner);
  else if (cp && cp.owner === ctx.owner) value += GARRISON_BONUS;

  const objective = ctx.objectives.get(unit.id);
  if (objective) {
    const before = hexDistance(from, objective.pos);
    const after = hexDistance(pos, objective.pos);
    const progress = before - after;
    if (progress > 0) {
      value += progress * PROGRESS_SCALE;
      if (objective.kind === 'cp') {
        value += cpValue(ctx, objective.pos, ctx.owner) * APPROACH_WEIGHT * (progress / Math.max(1, before));
      }
    }
  }

  value += fireOpportunity(ctx, unit, pos) * 0.35;
  value -= incomingDamageAt(ctx, pos, unit.defense) * THREAT_SCALE;

  let friends = 0;
  for (const friend of ctx.myUnits) {
    if (friend.id !== unit.id && hexDistance(pos, projectedUnit(ctx, friend)) === 1) friends++;
  }
  value -= Math.max(0, friends - 1) * CROWD_PENALTY;
  return value;
}

/** 移动期望收益：成功则拿落点价值，冲突失败则留在原地并浪费一次行动。 */
function moveScore(ctx, unit, pos) {
  const success = Math.max(0.05, 1 - combinedClaimRisk(ctx, cellKey(pos)));
  const gain = success * (destinationValue(ctx, unit, pos) - stayValue(ctx, unit))
    - (1 - success) * ACTION_COST;
  return gain;
}

/** 攻击期望收益：覆盖格上的敌军出现概率 × 伤害 + 击杀/总部/拒止奖励 − 原地承伤。 */
function attackScore(ctx, attacker, aim, click) {
  let value = 0;

  // 锁定射击：目标当前在点击格上时，只要不逃出射程就必中，按落点分布求命中率。
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
      else if (damage.avg >= locked.hp) value += unitValue(locked) * LIKELY_KILL_WEIGHT * inRange;
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
        else if (damage.avg >= enemy.hp) value += unitValue(enemy) * LIKELY_KILL_WEIGHT * probability;
      }
    }

    const hq = ctx.enemyHqByKey.get(key);
    if (hq) {
      const damage = damageStats(ctx, attacker.attack, hq.defense);
      value += damage.avg * DAMAGE_SCALE * HQ_DAMAGE_BONUS;
      if (damage.avg >= hq.hp) value += HQ_KILL;
    }

    // 区域拒止：朝敌方据点/争夺点预瞄，即使这轮没打中，也压缩对方占点空间。
    const cp = ctx.cpByKey.get(key);
    if (cp && cp.owner !== ctx.owner) {
      let probability = 0;
      if (entries) for (const p of entries.values()) probability += p;
      value += Math.min(1, probability) * cpValue(ctx, cp, ctx.owner) * DENIAL_WEIGHT;
    }
  }

  return value - exposurePenalty(ctx, attacker);
}

function exposurePenalty(ctx, attacker) {
  const incoming = incomingDamageAt(ctx, attacker, attacker.defense);
  let penalty = incoming * THREAT_SCALE * EXPOSURE_WEIGHT;
  if (incoming >= attacker.hp) penalty += unitValue(attacker) * 0.25;
  return penalty;
}

// ---------------------------------------------------------------- 行动枚举

function attackOptions(ctx) {
  const options = [];
  for (const unit of ctx.myUnits) {
    if (!unit.attackRange) continue;
    if (queuedAttackCount(ctx.queue, unit.id) >= ctx.attackLimit) continue;
    const attacker = projectedUnit(ctx, unit);
    const aims = enumerateAims(ctx.game, attacker, 'attackShape');
    const seen = new Set();
    for (const { aim, click } of aims) {
      const signature = aim.cells.map(cellKey).join('|');
      if (seen.has(signature)) continue;
      seen.add(signature);
      const score = attackScore(ctx, attacker, aim, click);
      if (score <= MIN_SCORE) continue;
      options.push({
        type: 'attack',
        payload: { attackerId: unit.id, q: click.q, r: click.r },
        score,
      });
    }
  }
  return options;
}

function healOptions(ctx) {
  const options = [];
  for (const support of ctx.myUnits) {
    if (support.type !== 'support') continue;
    const caster = projectedUnit(ctx, support);
    if (isArtilleryDanger(ctx.game, caster)) continue;
    const aims = enumerateAims(ctx.game, caster, 'healShape');
    const seen = new Set();

    for (const { aim, click } of aims) {
      if (aim.cells.some(cell => isArtilleryDanger(ctx.game, cell))) continue;
      const signature = aim.cells.map(cellKey).join('|');
      if (seen.has(signature)) continue;
      seen.add(signature);

      let value = 0;
      let anyWounded = false;
      for (const ally of ctx.myUnits) {
        if (ally.hp >= ally.maxHp) continue;
        if (ctx.healedUnits.has(ally.id)) continue;
        const allyPos = projectedPos(ctx.projection, ally);
        if (!aim.cells.some(cell => sameCell(cell, allyPos))) continue;

        anyWounded = true;
        const missing = ally.maxHp - ally.hp;
        const amount = Math.min(missing, (support.healPower ?? 0) + ctx.healVariance / 2);
        let gain = amount * HEAL_SCALE;
        const danger = incomingDamageAt(ctx, allyPos, ally.defense);
        if (danger >= ally.hp) gain += unitValue(ally) * 0.35;
        else if (danger + amount >= ally.hp) gain += unitValue(ally) * 0.15;
        value += gain;
      }

      if (!anyWounded || value <= MIN_SCORE) continue;
      options.push({
        type: 'heal',
        payload: { supportId: support.id, q: click.q, r: click.r },
        score: value,
      });
    }
  }
  return options;
}

function moveOptions(ctx) {
  const options = [];
  for (const unit of ctx.myUnits) {
    const from = projectedUnit(ctx, unit);
    for (const pos of terrainReachable(ctx.game, from, unit.moveRange, ctx.projection, ctx.utils)) {
      if (ctx.claimed.has(cellKey(pos))) continue;
      if (!projectedEmpty(ctx.game, ctx.owner, ctx.projection, pos, ctx.utils)) continue;
      if (isArtilleryDanger(ctx.game, pos)) continue;
      const score = moveScore(ctx, unit, pos);
      if (score <= MIN_SCORE) continue;
      options.push({
        type: 'move',
        payload: { unitId: unit.id, q: pos.q, r: pos.r },
        score,
      });
    }
  }
  return options;
}

/** 重装爆破：用于清理通往目标的墙；只做低优先级的空隙利用。 */
function demolishOptions(ctx) {
  const options = [];
  for (const unit of ctx.myUnits) {
    if (unit.type !== 'heavy') continue;
    const from = projectedUnit(ctx, unit);
    const objective = ctx.objectives.get(unit.id);
    for (const pos of ctx.utils.neighbors(from)) {
      if (!ctx.utils.isPlayable(ctx.game, pos)) continue;
      if (projectedTerrain(ctx.game, ctx.projection, pos, ctx.utils) !== 'blocker') continue;
      if (ctx.utils.occupantAt(ctx.game, pos)) continue;
      if (objective && hexDistance(pos, objective.pos) >= hexDistance(from, objective.pos)) continue;
      options.push({
        type: 'demolish',
        payload: { unitId: unit.id, q: pos.q, r: pos.r },
        score: DEMOLISH_UTILITY,
      });
    }
  }
  return options;
}

function deployTypeBonus(ctx, type) {
  const base = { scout: 1.0, infantry: 1.05, ranger: 1.25, heavy: 1.15, support: 1.1 }[type] ?? 1;
  let bonus = 0;
  const counts = ctx.myTypeCounts;
  if (type === 'support' && !counts.support && ctx.myUnits.some(unit => unit.hp < unit.maxHp * 0.7)) bonus += 0.25;
  if (type === 'ranger' && !counts.ranger) bonus += 0.15;
  if (type === 'scout' && (counts.scout ?? 0) < 2) bonus += 0.12;
  if (type === 'infantry' && (counts.infantry ?? 0) < 2) bonus += 0.08;
  return base + bonus;
}

function deployOptions(ctx) {
  const options = [];
  const supplies = ctx.game.resources?.[ctx.owner]?.supplies ?? 0;
  const remaining = supplies - plannedDeploySpend(ctx.game, ctx.owner, ctx.queue, ctx.utils);
  const unitTypes = Object.keys(ctx.game.config?.units ?? {});

  for (const origin of ctx.utils.deployOrigins(ctx.game, ctx.owner)) {
    if (isArtilleryDanger(ctx.game, origin)) continue;
    for (const type of unitTypes) {
      const spec = ctx.game.config.units[type];
      if (!spec) continue;
      const cost = ctx.utils.effectiveDeployCost(ctx.game, type, origin);
      if (cost > remaining) continue;

      for (const pos of ctx.utils.neighbors(origin)) {
        if (projectedTerrain(ctx.game, ctx.projection, pos, ctx.utils) !== 'plain') continue;
        if (ctx.claimed.has(cellKey(pos))) continue;
        if (!projectedEmpty(ctx.game, ctx.owner, ctx.projection, pos, ctx.utils)) continue;
        if (isArtilleryDanger(ctx.game, pos)) continue;

        let value = DEPLOY_BASE * deployTypeBonus(ctx, type);
        const cp = ctx.cpByKey.get(cellKey(pos));
        if (cp && cp.owner !== ctx.owner && spec.canCapture) value += cpValue(ctx, cp, ctx.owner);

        // 部署点靠近争夺点/敌方总部时略加分。
        let nearest = Infinity;
        for (const point of ctx.cps) {
          if (point.owner !== ctx.owner) nearest = Math.min(nearest, hexDistance(pos, point));
        }
        for (const hq of ctx.enemyHqs.values()) nearest = Math.min(nearest, hexDistance(pos, hq));
        if (Number.isFinite(nearest)) value += Math.max(0, 4 - nearest) * 12;

        const success = Math.max(0.05, 1 - combinedClaimRisk(ctx, cellKey(pos)));
        value = success * value - (1 - success) * ACTION_COST;
        value -= incomingDamageAt(ctx, pos, spec.defense ?? 0) * THREAT_SCALE * 0.7;
        if (value <= MIN_SCORE) continue;

        options.push({
          type: 'deploy',
          payload: { unitType: type, fromId: origin.id, q: pos.q, r: pos.r },
          score: value,
        });
      }
    }
  }
  return options;
}

// ---------------------------------------------------------------- 目标与上下文

function objectiveFor(ctx, unit) {
  const from = projectedUnit(ctx, unit);
  if (unit.canCapture) {
    let best = null;
    for (const cp of ctx.cps) {
      if (cp.owner === ctx.owner) continue;
      const value = cpValue(ctx, cp, ctx.owner);
      const distance = hexDistance(from, cp);
      const score = value / (1 + distance * 1.5);
      if (!best || score > best.score) best = { pos: cp, kind: 'cp', value, score };
    }
    if (best) return best;
  }

  if (unit.type === 'support') {
    const wounded = ctx.myUnits
      .filter(ally => ally.id !== unit.id && ally.hp < ally.maxHp)
      .sort((a, b) => (b.maxHp - b.hp) - (a.maxHp - a.hp));
    if (wounded[0]) {
      const at = projectedPos(ctx.projection, wounded[0]);
      return { pos: at, kind: 'ally', value: 0 };
    }
    if (ctx.myHq) return { pos: ctx.myHq, kind: 'hq', value: 0 };
  }

  let best = null;
  for (const enemy of ctx.enemies) {
    const score = 100 / (1 + hexDistance(from, enemy));
    if (!best || score > best.score) best = { pos: enemy, kind: 'unit', value: 0, score };
  }
  for (const hq of ctx.enemyHqs.values()) {
    const score = (unit.canCapture ? 120 : 90) / (1 + hexDistance(from, hq));
    if (!best || score > best.score) best = { pos: hq, kind: 'hq', value: 0, score };
  }
  return best;
}

function buildContext(game, owner, utils) {
  const cps = game.controlPoints || [];
  const queue = game.plan?.myQueue ?? game.plan?.queues?.[owner] ?? [];
  const myUnits = utils.livingUnits(game, owner);
  const enemySeats = utils.enemySeats(game, owner);
  const enemies = enemySeats.flatMap(seat => utils.livingUnits(game, seat));
  const projection = projectPlan(queue);
  const myUnitsForThreat = myUnits.map(unit => {
    const at = projectedPos(projection, unit);
    return { ...unit, q: at.q, r: at.r };
  });

  const myTypeCounts = {};
  for (const unit of myUnits) myTypeCounts[unit.type] = (myTypeCounts[unit.type] ?? 0) + 1;

  const ctx = {
    game,
    utils,
    owner,
    queue,
    step: queue.length + 1,
    projection,
    cps,
    myUnits,
    myUnitsForThreat,
    enemies,
    enemySeats,
    myTypeCounts,
    attackLimit: attackLimitFor(game),
    healedUnits: new Set(),
    myHq: game.headquarters?.[owner] ?? null,
    enemyHqs: new Map(enemySeats
      .map(seat => [seat, game.headquarters?.[seat]])
      .filter(([, hq]) => hq?.alive)),
    enemyById: new Map(enemies.map(enemy => [enemy.id, enemy])),
    enemyHqByKey: new Map(),
    cpByKey: new Map(cps.map(cp => [cellKey(cp), cp])),
    myUnitCells: new Set(myUnitsForThreat.map(cellKey)),
    nearMyUnitCells: new Set(),
    contestedCpCells: new Set(cps.filter(cp => cp.owner !== owner).map(cellKey)),
    myHqCell: game.headquarters?.[owner] ? cellKey(game.headquarters[owner]) : null,
    claimed: claimedCells(queue),
    objectives: new Map(),
    maxTurns: game.config?.balance?.maxTurns === null ? null : (game.config?.balance?.maxTurns ?? 15),
    roundNumber: game.turn?.roundNumber ?? game.turn?.turnNumber ?? 1,
    actionsPerTurn: game.config?.balance?.actionsPerTurn ?? 5,
    variance: game.config?.balance?.damageVarianceRange ?? 3,
    healVariance: game.config?.balance?.healVarianceRange ?? 6,
    minDamage: game.config?.balance?.minimumDamage ?? 1,
    volleyFactor: 1,
    enemyDeployRisk: new Map(),
    distByUnit: new Map(),
    presence: new Map(),
    claimRisk: new Map(),
    attackEntries: new Map(),
  };

  for (const hq of ctx.enemyHqs.values()) ctx.enemyHqByKey.set(cellKey(hq), hq);
  for (const unit of myUnitsForThreat) {
    for (const neighbor of utils.neighbors(unit)) ctx.nearMyUnitCells.add(cellKey(neighbor));
  }

  // 队列里已有的治疗：按投影覆盖标记目标，后续动作不再重复治疗同一人。
  for (const action of queue) {
    if (action.type !== 'heal' || !action.supportId) continue;
    const support = myUnits.find(unit => unit.id === action.supportId);
    if (!support) continue;
    const caster = { ...support, ...projectedPos(projection, support) };
    const aim = computeAim(game, caster, 'healShape', { q: action.q, r: action.r });
    if (!aim) continue;
    for (const ally of myUnits) {
      const at = projectedPos(projection, ally);
      if (aim.cells.some(cell => sameCell(cell, at))) ctx.healedUnits.add(ally.id);
    }
  }

  // 敌军模型必须在 ctx 的投影站位/据点集合就绪后构建。
  Object.assign(ctx, buildEnemyModel(ctx));
  ctx.enemyDeployRisk = buildEnemyDeployRisk(ctx);

  for (const unit of myUnits) {
    const objective = objectiveFor(ctx, unit);
    if (objective) ctx.objectives.set(unit.id, objective);
  }

  return ctx;
}

// ---------------------------------------------------------------- 主决策

function optionPriority(type) {
  switch (type) {
    case 'attack': return 5;
    case 'heal': return 4;
    case 'move': return 3;
    case 'deploy': return 2;
    case 'demolish': return 1;
    default: return 0;
  }
}

/**
 * 落点概率算法主模块
 */
export default {
  name: 'dest-prob',
  description: '落点概率算法：落点分布建模 + 预测射击 + 目的格冲突规避',

  async decide(game, utils, ctx) {
    const owner = ctx?.owner;
    if (!owner || !game.plan) return null;

    // 已提交：本轮无事可做（等结算）。
    if ((game.plan.committed ?? []).includes(owner)) return null;

    const queue = game.plan.myQueue ?? game.plan.queues?.[owner] ?? [];
    const limit = game.config?.balance?.actionsPerTurn ?? 5;
    if (queue.length >= limit) return null;

    const context = buildContext(game, owner, utils);
    if (!context.myUnits.length && !context.utils.deployOrigins(game, owner).length) return null;

    const options = [
      ...attackOptions(context),
      ...healOptions(context),
      ...moveOptions(context),
      ...demolishOptions(context),
      ...deployOptions(context),
    ];
    if (!options.length) return null;

    // 同分时只用动作类型优先级；不再用含随机单位 ID 的 JSON 做兜底排序，
    // 保证同一棋盘状态下决策可复现（对回放/标定都更友好）。
    options.sort((a, b) =>
      b.score - a.score
      || optionPriority(b.type) - optionPriority(a.type));
    const best = options[0];
    if (!best || best.score <= MIN_SCORE) return null;
    return { type: best.type, payload: best.payload };
  },
};

// 测试/标定用的内部入口（runner 只读 default）。
export const destProbInternals = {
  buildContext,
  buildEnemyModel,
  computeAim,
  enumerateAims,
  cpValue,
  hexDistance,
  moveOptions,
  attackOptions,
  healOptions,
  deployOptions,
  demolishOptions,
  moveScore,
  attackScore,
  projectedPos,
  terrainReachable,
};
