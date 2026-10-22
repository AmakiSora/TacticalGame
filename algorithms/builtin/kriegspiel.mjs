// algorithms/builtin/kriegspiel.mjs
//
// 兵棋推演算法（Kriegspiel / rollout）——同时回合模式的
// 「真实结算模拟 + 整份计划联合搜索」算法。
//
// 与 random-sim / dest-prob 的根本差别：
//   - random-sim：不思考，随机入队；
//   - dest-prob：用**解析公式**给每个动作单独估期望收益，再逐个**边际贪心**挑选，
//     从不真正模拟结算（dest-prob.md「已知限制 #2：不做联合计划搜索」）；
//   - 本算法：把**整份计划**塞进一个 JS 版的分步结算器里跑一遍——行动点顺序、
//     级联失败、到达判定（同一步先移出后移入、链式腾格、依赖传播）、single/line/arc
//     形状覆盖、attackLock 锁定跟随、伤害掷骰、先治疗后扣伤、死亡淘汰、占点，全部按
//     src/engine/simultaneousResolve.ts 的 resolveRoundSteps 口径真实结算——用**模拟出来的
//     棋盘**给整份计划打分，并在计划空间里做**联合搜索**（分步候选生成 + 蒙特卡洛
//     rollout 选择 + 爬山精修）。于是它能找到 dest-prob 结构上找不到的东西：跨行动点的
//     移动→攻击组合拳、两单位同一步集火斩杀、用 wait 把火力对齐到敌人走进扇形之后、
//     先爆破再让友军通过、故意让一格到达冲突失败换别处 tempo。
//
// 对抗「可被反预测」：每份计划对**对手组合（objective / aggressive / random 三种性格）**
// 采样多份敌方计划做 rollout，最终分取「均值 − λ·标准差」的风险调整值，而不是单点最优，
// 因此对刻意反预测或随机对手都更稳（补 dest-prob.md「已知限制 #1」）。
//
// 约束：形状推导复用 dest-prob 已逐字镜像 planning.ts 的 computeAim / enumerateAims；
// 计划合法性逐字镜像 planning.ts 的队列前缀投影校验（只按地形寻路、attacksPerUnit 上限、
// 占用推迟到结算）；结算器逐字镜像 simultaneousResolve.ts 的分步结算（单轮，不含炮火
// 收缩/收入/维修，用棋盘估值收口）。
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
  /** 爬山邻域粗筛用的 rollout 次数（胜出者再按 rollouts 复核）。 */
  screenRollouts: Number(process.env.KRIEG_SCREEN ?? 8),
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
/** 待命（wait）的静态分：恒为负，因此只会由爬山搜索为「对齐行动点」主动插入。 */
const WAIT_SCORE = -5;
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

// ---------------------------------------------------------------- 计划期投影与合法性镜像
// 引擎（src/engine/planning.ts）在入队时按**队列前缀投影**做结构性校验：队列数组顺序
// 就是行动点顺序，同一单位可以在多个行动点连续行动，攻击/治疗/爆破/移动的起点要按
// 之前排的移动投影计算，自己先前排的爆破会把目标格视为 plain；寻路只按地形（水/障碍
// 挡路），**忽略单位与总部占位**。目的格是否被占、部署格是否被占、治疗覆盖里有没有
// 友军，全部推迟到结算时判定。以下逐字镜像该口径，保证 rollout 用的计划与真实入队
// 结果一致（零被拒）。

/** 计划动作归属的单位。我方计划的字段嵌在 payload 里，与引擎的顶层字段一一对应。 */
const actionUnitId = action => {
  const payload = action.payload ?? {};
  return payload.unitId ?? payload.attackerId ?? payload.supportId;
};

/** 顺序敏感的计划签名：行动点顺序不同就是不同计划，不能排序后比较。 */
const actionSignature = action => JSON.stringify([action.type, action.payload ?? {}]);
const planSignature = plan => plan.map(actionSignature).join(';');

const attackLimitFor = game => game.config?.balance?.attacksPerUnit ?? 1;

function inBounds(ctx, q, r) {
  return ctx.cellSet.has(`${q},${r}`);
}

/** 地形：地图覆写优先，其次基础格，最后按引擎口径视为 blocker。 */
function terrainAt(ctx, q, r) {
  const key = `${q},${r}`;
  return ctx.terrainOverride.get(key) ?? ctx.terrainByCell.get(key) ?? 'blocker';
}

function projectedTerrain(ctx, projection, q, r) {
  return projection.terrain.get(`${q},${r}`) ?? terrainAt(ctx, q, r);
}

/** 计划期可达格：只按地形寻路，忽略单位与总部（镜像 planningReachableCells）。 */
function planReachable(ctx, from, range, projection) {
  const result = [];
  if (!(range > 0)) return result;
  const visited = new Set([cellKey(from)]);
  const queue = [{ pos: from, distance: 0 }];
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    if (current.distance >= range) continue;
    for (const d of HEX_DIRS) {
      const next = { q: current.pos.q + d.q, r: current.pos.r + d.r };
      const key = cellKey(next);
      if (visited.has(key)) continue;
      visited.add(key);
      if (!inBounds(ctx, next.q, next.r)) continue;
      if (projectedTerrain(ctx, projection, next.q, next.r) !== 'plain') continue;
      result.push(next);
      queue.push({ pos: next, distance: current.distance + 1 });
    }
  }
  return result;
}

/** 把 plan（数组顺序 = 行动点顺序）投影成虚拟站位与虚拟地形（镜像 projectPlanQueue）。 */
function projectPlan(ctx, plan) {
  const positions = new Map();
  const terrain = new Map();
  const positionOf = id => positions.get(id) ?? ctx.basePositions.get(id) ?? null;
  for (const action of plan) {
    const payload = action.payload ?? {};
    const id = actionUnitId(action);
    if (action.type === 'move' && id && typeof payload.q === 'number') {
      positions.set(id, { q: payload.q, r: payload.r });
    } else if (action.type === 'demolish' && typeof payload.q === 'number') {
      terrain.set(`${payload.q},${payload.r}`, 'plain');
    }
  }
  return { positions, terrain, positionOf };
}

/** 某单位在执行完 prefix 之后的虚拟站位。 */
function projectedPosition(ctx, projection, id) {
  return projection.positions.get(id) ?? ctx.basePositions.get(id) ?? null;
}

function queuedAttackCount(plan, unitId) {
  let count = 0;
  for (const action of plan) {
    if (action.type === 'attack' && action.payload?.attackerId === unitId) count++;
  }
  return count;
}

function deployCost(ctx, payload) {
  const spec = ctx.game.config?.units?.[payload.unitType];
  if (!spec) return Infinity;
  const origin = ctx.deployOriginById.get(payload.fromId);
  return origin ? ctx.utils.effectiveDeployCost(ctx.game, payload.unitType, origin) : spec.cost;
}

/** prefix 里已排部署的总花费（镜像 plannedDeploySpend）。 */
function plannedDeploySpend(ctx, prefix) {
  let spend = 0;
  for (const action of prefix) {
    if (action.type !== 'deploy') continue;
    const cost = deployCost(ctx, action.payload ?? {});
    if (Number.isFinite(cost)) spend += cost;
  }
  return spend;
}

/** 在 prefix 投影下判定 action 能否入队（镜像 planning.ts 的 checkDeploy/Move/Attack/Heal/Demolish）。 */
function isActionLegal(ctx, prefix, action) {
  const game = ctx.game;
  const payload = action.payload ?? {};
  if (action.type === 'wait') return prefix.length < ctx.actionsPerTurn;
  if (prefix.length >= ctx.actionsPerTurn) return false;
  if (typeof payload.q !== 'number' || typeof payload.r !== 'number') return false;
  const projection = projectPlan(ctx, prefix);

  if (action.type === 'deploy') {
    const spec = game.config?.units?.[payload.unitType];
    if (!spec) return false;
    const origin = ctx.deployOriginById.get(payload.fromId);
    if (!origin) return false;
    if (isArtilleryDanger(game, origin) || isArtilleryDanger(game, payload)) return false;
    if (!inBounds(ctx, payload.q, payload.r)) return false;
    if (hexDistance(origin, payload) !== 1) return false;
    if (projectedTerrain(ctx, projection, payload.q, payload.r) !== 'plain') return false;
    return ctx.supplies - plannedDeploySpend(ctx, prefix) >= deployCost(ctx, payload);
  }

  const id = actionUnitId(action);
  if (!id) return false;
  const unit = ctx.unitById.get(id);
  if (!unit) return false;
  const from = projectedPosition(ctx, projection, id);
  if (!from) return false;

  if (action.type === 'move') {
    if (from.q === payload.q && from.r === payload.r) return false;
    if (!inBounds(ctx, payload.q, payload.r)) return false;
    return planReachable(ctx, from, unit.moveRange ?? 0, projection)
      .some(cell => cell.q === payload.q && cell.r === payload.r);
  }
  if (action.type === 'attack') {
    if (queuedAttackCount(prefix, id) >= ctx.attackLimit) return false;
    if (!inBounds(ctx, payload.q, payload.r)) return false;
    return Boolean(computeAim(game, { ...unit, q: from.q, r: from.r }, 'attackShape', payload));
  }
  if (action.type === 'heal') {
    if (unit.type !== 'support') return false;
    if (!inBounds(ctx, payload.q, payload.r)) return false;
    return Boolean(computeAim(game, { ...unit, q: from.q, r: from.r }, 'healShape', payload));
  }
  if (action.type === 'demolish') {
    if (unit.type !== 'heavy') return false;
    if (!inBounds(ctx, payload.q, payload.r)) return false;
    if (hexDistance(from, payload) > 1) return false;
    return projectedTerrain(ctx, projection, payload.q, payload.r) === 'blocker';
  }
  return false;
}

/** 整份计划逐条按前缀投影校验；任一动作会被入队拒绝即视为非法。 */
function isPlanLegal(ctx, plan) {
  if (plan.length > ctx.actionsPerTurn) return false;
  for (let i = 0; i < plan.length; i++) {
    if (!isActionLegal(ctx, plan.slice(0, i), plan[i])) return false;
  }
  return true;
}

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
    // 计划期寻路只按地形（引擎已不再把单位/总部当墙），故不能用 utils.reachableCells。
    const reach = planReachable(ctx, enemy, enemy.moveRange ?? 0, ctx.emptyProjection);
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
        // 部署目标是否被占留到结算判定，计划期只看地形。
        if (!inBounds(ctx, cell.q, cell.r) || terrainAt(ctx, cell.q, cell.r) !== 'plain') continue;
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

function exposurePenalty(ctx, attacker, at) {
  const incoming = incomingDamageAt(ctx, at ?? attacker, attacker.defense);
  let penalty = incoming * THREAT_SCALE * 0.5;
  if (incoming >= attacker.hp) penalty += unitValue(attacker) * 0.25;
  return penalty;
}

function attackStaticScore(ctx, attacker, from, aim, click) {
  let value = 0;
  const spec = ctx.game.config?.units?.[attacker.type];
  if (spec?.attackLock) {
    // 锁定射击按**计划时刻**点击格上的敌方单位判定（引擎 planTimePositions 口径）。
    const locked = ctx.enemies.find(enemy => sameCell(enemy, click));
    if (locked) {
      const dist = ctx.distByUnit.get(locked.id);
      let inRange = 0;
      for (const [key, probability] of dist) {
        if (hexDistance(from, parseKey(key)) <= (attacker.attackRange ?? 1)) inRange += probability;
      }
      const damage = damageStats(ctx, attacker.attack, locked.defense);
      value += Math.min(damage.avg, locked.hp) * inRange * DAMAGE_SCALE;
      if (damage.worst >= locked.hp) value += unitValue(locked) * KILL_WEIGHT * inRange;
      else if (damage.avg >= locked.hp) value += unitValue(locked) * 0.55 * inRange;
      return value - exposurePenalty(ctx, attacker, from);
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
  return value - exposurePenalty(ctx, attacker, from);
}

function stayValue(ctx, unit, from) {
  let value = 0;
  const cp = ctx.cpByKey.get(cellKey(from));
  if (cp && cp.owner !== ctx.owner && unit.canCapture) value += cpValue(ctx, cp, ctx.owner);
  else if (cp && cp.owner === ctx.owner) value += GARRISON_BONUS;
  value += fireOpportunity(ctx, unit, from) * 0.45;
  value -= incomingDamageAt(ctx, from, unit.defense) * THREAT_SCALE;
  return value;
}

function destinationValue(ctx, unit, from, pos, projection) {
  let value = 0;
  const cp = ctx.cpByKey.get(cellKey(pos));
  if (cp && cp.owner !== ctx.owner && unit.canCapture) value += cpValue(ctx, cp, ctx.owner);
  else if (cp && cp.owner === ctx.owner) value += GARRISON_BONUS;
  const objective = ctx.objectives.get(unit.id);
  if (objective) {
    const progress = hexDistance(from, objective.pos) - hexDistance(pos, objective.pos);
    if (progress > 0) value += progress * PROGRESS_SCALE;
  }
  value += fireOpportunity(ctx, unit, pos) * 0.35;
  value -= incomingDamageAt(ctx, pos, unit.defense) * THREAT_SCALE;
  // 友军站位按投影取：本计划里已经排过移动的友军，拥挤判定要用它的新格子。
  let friends = 0;
  for (const friend of ctx.myUnits) {
    if (friend.id === unit.id) continue;
    const at = projectedPosition(ctx, projection, friend.id) ?? friend;
    if (hexDistance(pos, at) === 1) friends++;
  }
  value -= Math.max(0, friends - 1) * CROWD_PENALTY;
  return value;
}

function moveStaticScore(ctx, unit, from, pos, projection) {
  const success = Math.max(0.05, 1 - combinedClaimRisk(ctx, cellKey(pos)));
  const gain = destinationValue(ctx, unit, from, pos, projection) - stayValue(ctx, unit, from);
  return success * gain - (1 - success) * ACTION_COST;
}

function healStaticScore(ctx, support, aim, projection) {
  let value = 0;
  let anyWounded = false;
  for (const ally of ctx.myUnits) {
    if (ally.hp >= ally.maxHp) continue;
    // 治疗按本行动点结算时的站位判定，因此友军位置也要用投影。
    const at = projectedPosition(ctx, projection, ally.id) ?? ally;
    if (!aim.cells.some(cell => sameCell(cell, at))) continue;
    anyWounded = true;
    const missing = ally.maxHp - ally.hp;
    const amount = Math.min(missing, (support.healPower ?? 0) + ctx.healVariance / 2);
    let gain = amount * HEAL_SCALE;
    const danger = incomingDamageAt(ctx, at, ally.defense);
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
// 分步引擎下，「下一步能排什么」取决于队列前缀投影出的站位与地形，因此候选必须按
// 行动点逐个生成，不能像单发结算那样一次性枚举整轮。

const DEMOLISH_REACH = 10;

/** 前缀执行完后被己方单位/新部署单位占住的格：再往这些格排 move/deploy 必然 destination_occupied。 */
function cellsTakenByPrefix(ctx, projection, prefix) {
  const taken = new Set();
  for (const unit of ctx.myUnits) {
    const at = projectedPosition(ctx, projection, unit.id);
    if (at) taken.add(cellKey(at));
  }
  if (ctx.myHq) taken.add(cellKey(ctx.myHq));
  // 部署出来的单位 id 计划期未知，本轮不可能再被自己调度，落点视为长期占用。
  for (const action of prefix) {
    if (action.type === 'deploy') taken.add(cellKey(action.payload ?? {}));
  }
  return taken;
}

function demolishStaticScore(ctx, prefix, projection, pos) {
  const key = cellKey(pos);
  const cleared = { positions: projection.positions, terrain: new Map(projection.terrain).set(key, 'plain') };
  let value = -ACTION_COST * 0.35;
  for (const friend of ctx.myUnits) {
    const at = projectedPosition(ctx, projection, friend.id) ?? friend;
    const before = planReachable(ctx, at, friend.moveRange ?? 0, projection).length;
    const after = planReachable(ctx, at, friend.moveRange ?? 0, cleared).length;
    value += (after - before) * DEMOLISH_REACH;
  }
  // 结算时目标格上有单位 → 爆破失败并**级联作废**该单位本轮后续动作，代价远高于一个行动点。
  if (ctx.occupiedAtPlan.has(key)) value -= ACTION_COST * 2;
  for (const action of prefix) {
    if (action.type === 'demolish' && cellKey(action.payload ?? {}) === key) return -Infinity;
  }
  return value;
}

/** 生成 prefix 之后那个行动点上所有合法且有正收益的候选，按分数降序（末位恒为 wait）。 */
function stepCandidates(ctx, prefix, cache) {
  const signature = planSignature(prefix);
  if (cache?.has(signature)) return cache.get(signature);
  const game = ctx.game;
  const projection = projectPlan(ctx, prefix);
  const taken = cellsTakenByPrefix(ctx, projection, prefix);
  const spent = plannedDeploySpend(ctx, prefix);
  const candidates = [];
  const push = (type, unitId, cell, score, action) => {
    if (!(score > MIN_SCORE)) return;
    candidates.push({ type, unitId, cell, score, action });
  };

  for (const unit of ctx.myUnits) {
    const from = projectedPosition(ctx, projection, unit.id);
    if (!from) continue;
    const virtual = from.q === unit.q && from.r === unit.r ? unit : { ...unit, q: from.q, r: from.r };

    if ((unit.attackRange ?? 0) > 0 && queuedAttackCount(prefix, unit.id) < ctx.attackLimit) {
      const seen = new Set();
      for (const { aim, click } of enumerateAims(game, virtual, 'attackShape')) {
        const coverage = aim.cells.map(cellKey).join('|');
        if (seen.has(coverage)) continue;
        seen.add(coverage);
        push('attack', unit.id, null, attackStaticScore(ctx, unit, from, aim, click),
          { type: 'attack', payload: { attackerId: unit.id, q: click.q, r: click.r } });
      }
    }

    if (unit.type === 'support' && !isArtilleryDanger(game, from)) {
      const seen = new Set();
      for (const { aim, click } of enumerateAims(game, virtual, 'healShape')) {
        if (aim.cells.some(cell => isArtilleryDanger(game, cell))) continue;
        const coverage = aim.cells.map(cellKey).join('|');
        if (seen.has(coverage)) continue;
        seen.add(coverage);
        const score = healStaticScore(ctx, unit, aim, projection);
        if (!Number.isFinite(score)) continue;
        push('heal', unit.id, null, score,
          { type: 'heal', payload: { supportId: unit.id, q: click.q, r: click.r } });
      }
    }

    for (const pos of planReachable(ctx, from, unit.moveRange ?? 0, projection)) {
      if (isArtilleryDanger(game, pos)) continue;
      if (taken.has(cellKey(pos))) continue;
      push('move', unit.id, cellKey(pos), moveStaticScore(ctx, unit, from, pos, projection),
        { type: 'move', payload: { unitId: unit.id, q: pos.q, r: pos.r } });
    }

    if (unit.type === 'heavy') {
      for (const pos of ctx.utils.neighbors(virtual)) {
        if (!inBounds(ctx, pos.q, pos.r)) continue;
        if (projectedTerrain(ctx, projection, pos.q, pos.r) !== 'blocker') continue;
        const score = demolishStaticScore(ctx, prefix, projection, pos);
        if (!Number.isFinite(score)) continue;
        push('demolish', unit.id, cellKey(pos), score,
          { type: 'demolish', payload: { unitId: unit.id, q: pos.q, r: pos.r } });
      }
    }
  }

  const budget = ctx.supplies - spent;
  for (const origin of ctx.deployOrigins) {
    if (isArtilleryDanger(game, origin)) continue;
    for (const type of ctx.unitTypes) {
      const spec = game.config.units[type];
      if (!spec) continue;
      const cost = ctx.utils.effectiveDeployCost(game, type, origin);
      if (cost > budget) continue;
      for (const pos of ctx.utils.neighbors(origin)) {
        if (!inBounds(ctx, pos.q, pos.r) || terrainAt(ctx, pos.q, pos.r) !== 'plain') continue;
        if (isArtilleryDanger(game, pos)) continue;
        if (taken.has(cellKey(pos))) continue;
        push('deploy', null, cellKey(pos), deployStaticScore(ctx, type, spec, origin, pos),
          { type: 'deploy', payload: { unitType: type, fromId: origin.id, q: pos.q, r: pos.r } });
      }
    }
  }

  candidates.push({ type: 'wait', unitId: null, cell: null, score: WAIT_SCORE, action: { type: 'wait', payload: {} } });
  candidates.sort((a, b) => b.score - a.score);
  cache?.set(signature, candidates);
  return candidates;
}

// ---------------------------------------------------------------- 计划构造（有序分步）

/** 逐步构造：每一步都在当前前缀投影下重新生成候选，pick 返回 null 即收工。 */
function buildPlanStepwise(ctx, rng, pick, cache) {
  const plan = [];
  while (plan.length < ctx.actionsPerTurn) {
    const candidates = stepCandidates(ctx, plan, cache);
    const chosen = pick(candidates, rng);
    if (!chosen) break;
    plan.push(chosen.action);
  }
  return plan;
}

/** 静态贪心：每步取当前最高分动作，直到无正分动作或预算耗尽。 */
function greedyPlan(ctx, cache) {
  return buildPlanStepwise(ctx, null,
    candidates => (candidates[0] && candidates[0].score > MIN_SCORE ? candidates[0] : null), cache);
}

/** softmax 采样：在近似同分的候选里按温度采样，产出多样化的完整有序计划。 */
function sampledPlan(ctx, rng, cache) {
  return buildPlanStepwise(ctx, rng, candidates => {
    const eligible = candidates.slice(0, 24);
    if (!eligible.length || eligible[0].score <= MIN_SCORE) return null;
    const maxScore = eligible[0].score;
    const weights = eligible.map(candidate => Math.exp((candidate.score - maxScore) / CFG.sampleTemp));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let pick = rng() * total;
    for (let i = 0; i < eligible.length; i++) {
      pick -= weights[i];
      if (pick <= 0) return eligible[i];
    }
    return eligible[eligible.length - 1];
  }, cache);
}

function generateSeedPlans(ctx, cache) {
  const plans = [];
  const seen = new Set();
  const push = plan => {
    if (!plan.length) return;
    // 顺序敏感：行动点顺序不同就是不同计划，签名不能排序。
    const key = planSignature(plan);
    if (seen.has(key)) return;
    seen.add(key);
    plans.push(plan);
  };
  push(greedyPlan(ctx, cache));
  const rng = mulberry32(ctx.seed ^ 0x5bf03635);
  let guard = 0;
  while (plans.length < CFG.candidates && guard++ < CFG.candidates * 6) {
    push(sampledPlan(ctx, rng, cache));
  }
  return plans;
}

// ---------------------------------------------------------------- JS 分步单轮结算器
// 逐字镜像 src/engine/simultaneousResolve.ts 的 resolveRoundSteps（单轮）：队列数组顺序
// 就是行动点顺序，第 k 步在所有席位之间同时结算完之后才进入第 k+1 步；每一步内部子阶段
// 固定为：级联预检 → 到达判定 → 部署 → 移动 → 爆破 → 待命 → 攻击/治疗 → 死亡淘汰 →
// 终局检查。不含炮火收缩 / 收入 / 维修 / 翻盘补给——单轮 rollout 只需结算后的棋盘，
// 用 evalBoard 收口。

function createSimState(ctx) {
  const game = ctx.game;
  const units = [];
  const unitById = new Map();
  for (const unit of game.units) {
    if (!unit.alive) continue;
    const sim = {
      id: unit.id, owner: unit.owner, type: unit.type, q: unit.q, r: unit.r,
      hp: unit.hp, maxHp: unit.maxHp, attack: unit.attack, defense: unit.defense,
      attackRange: unit.attackRange, moveRange: unit.moveRange, canCapture: unit.canCapture,
      healPower: unit.healPower, cost: unit.cost, alive: true,
    };
    units.push(sim);
    unitById.set(sim.id, sim);
  }
  const hq = new Map();
  for (const [seat, source] of Object.entries(game.headquarters ?? {})) {
    if (!source) continue;
    hq.set(seat, {
      id: source.id ?? `hq_${seat}`, owner: seat, q: source.q, r: source.r,
      hp: source.hp, maxHp: source.maxHp, defense: source.defense, alive: source.alive !== false,
    });
  }
  return { units, unitById, hq };
}

function simulateRoundSteps(ctx, myPlan, enemyPlans, rng) {
  const game = ctx.game;
  const { units, unitById, hq } = createSimState(ctx);
  const cps = (game.controlPoints ?? []).map(cp => ({ id: cp.id, q: cp.q, r: cp.r, kind: cp.kind, owner: cp.owner }));
  const supplies = new Map();
  for (const [seat, resources] of Object.entries(game.resources ?? {})) supplies.set(seat, resources?.supplies ?? 0);
  // 爆破会改写地形，且从**下一步**起生效（本步内其余判定仍看旧地形）。
  const terrain = new Map(ctx.terrainOverride);
  const terrainNow = (q, r) => terrain.get(`${q},${r}`) ?? ctx.terrainByCell.get(`${q},${r}`) ?? 'blocker';
  const annihilation = game.config?.mode === 'annihilation' || game.config?.mode === 'royale';

  const queues = new Map();
  queues.set(ctx.owner, myPlan ?? []);
  for (const [seat, plan] of Object.entries(enemyPlans ?? {})) queues.set(seat, plan ?? []);
  const order = [...ctx.turnOrder];
  for (const seat of queues.keys()) if (!order.includes(seat)) order.push(seat);

  // 引擎用 action.id 索引到达判定结果；模拟动作没有 id，按下标分配一个稳定的。
  const items = new Map();
  let maxSteps = 0;
  for (const seat of order) {
    const plan = queues.get(seat) ?? [];
    maxSteps = Math.max(maxSteps, plan.length);
    items.set(seat, plan.map((action, index) => ({ seat, action, step: index + 1, id: `${seat}#${index}` })));
  }

  const nextRandom = () => rng();
  const rollDamage = (attack, defense) =>
    Math.max(ctx.minDamage, attack - defense + (Math.floor(nextRandom() * (2 * ctx.variance + 1)) - ctx.variance));
  const rollHeal = support => (support.healPower ?? 0) + Math.floor(nextRandom() * (ctx.healVariance + 1));

  const failedUnits = new Set();
  const attackCounts = new Map();
  const eliminated = new Set();
  const hqDamageBy = new Map();
  const killValueBy = new Map();
  const seatActive = seat => {
    if (eliminated.has(seat)) return false;
    const home = hq.get(seat);
    if (home && !home.alive) return false;
    if (annihilation && !units.some(unit => unit.owner === seat && unit.alive)) return false;
    return true;
  };

  let steps = 0;
  let ended = false;
  for (let step = 1; step <= maxSteps; step++) {
    // ---- activeAtStep：被淘汰席位的剩余队列不再产生结果
    const stepItems = [];
    for (const seat of order) {
      if (!seatActive(seat)) continue;
      const item = items.get(seat)?.[step - 1];
      if (item) stepItems.push(item);
    }
    if (!stepItems.length) continue;
    steps = step;

    // ---- 1. 级联预检：单位已阵亡或本轮先前硬失败 → 后续动作全部作废
    const kept = [];
    for (const item of stepItems) {
      const unitId = actionUnitId(item.action);
      if (!unitId) { kept.push(item); continue; }
      const unit = unitById.get(unitId);
      if (!unit || !unit.alive) { failedUnits.add(unitId); continue; }
      if (failedUnits.has(unitId)) continue;
      kept.push(item);
    }

    // ---- 2. 本步开始时的占位快照（后续移动不影响判定）
    const occupants = new Map();
    for (const unit of units) {
      if (!unit.alive) continue;
      const key = cellKey(unit);
      if (!occupants.has(key)) occupants.set(key, { kind: 'unit', entity: unit });
    }
    for (const home of hq.values()) {
      if (!home.alive) continue;
      const key = cellKey(home);
      if (!occupants.has(key)) occupants.set(key, { kind: 'headquarters', entity: home });
    }

    // ---- 3. 到达判定：同格多认领全败；否则看「本步所有成功移出之后」的占用，
    //         依赖的移出失败则依赖者也失败（迭代到稳定），因此交换与链式腾格可以成功。
    const arrivals = [];
    for (const item of kept) {
      const payload = item.action.payload ?? {};
      if (item.action.type !== 'move' && item.action.type !== 'deploy') continue;
      if (typeof payload.q !== 'number' || typeof payload.r !== 'number') continue;
      arrivals.push({
        item,
        to: { q: payload.q, r: payload.r },
        moverId: item.action.type === 'move' ? payload.unitId : undefined,
      });
    }
    const arrivalsByCell = new Map();
    for (const arrival of arrivals) {
      const key = cellKey(arrival.to);
      const list = arrivalsByCell.get(key);
      if (list) list.push(arrival);
      else arrivalsByCell.set(key, [arrival]);
    }
    const moverByUnit = new Map();
    for (const arrival of arrivals) {
      if (arrival.moverId) moverByUnit.set(arrival.moverId, arrival.item.id);
    }
    const arrivalFailure = new Map();
    for (const [key, list] of arrivalsByCell) {
      if (list.length > 1) {
        for (const arrival of list) arrivalFailure.set(arrival.item.id, 'destination_conflict');
        continue;
      }
      const arrival = list[0];
      if (!ctx.cellSet.has(key) || terrainNow(arrival.to.q, arrival.to.r) !== 'plain') {
        arrivalFailure.set(arrival.item.id, 'destination_blocked');
        continue;
      }
      const occupant = occupants.get(key);
      if (!occupant) continue;
      if (occupant.kind === 'headquarters') {
        arrivalFailure.set(arrival.item.id, 'destination_occupied');
        continue;
      }
      if (!moverByUnit.has(occupant.entity.id)) arrivalFailure.set(arrival.item.id, 'destination_occupied');
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const arrival of arrivals) {
        if (arrivalFailure.has(arrival.item.id)) continue;
        const occupant = occupants.get(cellKey(arrival.to));
        if (!occupant || occupant.kind !== 'unit') continue;
        const dependency = moverByUnit.get(occupant.entity.id);
        if (dependency && arrivalFailure.has(dependency)) {
          arrivalFailure.set(arrival.item.id, 'destination_occupied');
          changed = true;
        }
      }
    }

    // ---- 4. 部署
    for (const item of kept) {
      if (item.action.type !== 'deploy') continue;
      if (arrivalFailure.has(item.id)) continue;
      const payload = item.action.payload;
      const spec = game.config?.units?.[payload.unitType];
      if (!spec) continue;
      const origin = ctx.deployOriginsBySeat.get(item.seat)?.get(payload.fromId);
      const cost = origin ? ctx.utils.effectiveDeployCost(game, payload.unitType, origin) : spec.cost;
      const budget = supplies.get(item.seat) ?? 0;
      if (budget < cost) continue;
      supplies.set(item.seat, budget - cost);
      const unit = {
        id: `sim_${item.id}_${payload.unitType}`, owner: item.seat, type: payload.unitType,
        q: payload.q, r: payload.r, hp: spec.hp, maxHp: spec.hp, attack: spec.attack,
        defense: spec.defense, attackRange: spec.attackRange, moveRange: spec.moveRange,
        canCapture: spec.canCapture, healPower: spec.healPower, cost: spec.cost, alive: true,
      };
      units.push(unit);
      unitById.set(unit.id, unit);
    }

    // ---- 5. 移动（到达失败会级联作废该单位本轮后续动作）
    for (const item of kept) {
      if (item.action.type !== 'move') continue;
      const unitId = item.action.payload.unitId;
      const unit = unitById.get(unitId);
      if (!unit || unit.owner !== item.seat || !unit.alive) { failedUnits.add(unitId); continue; }
      if (arrivalFailure.has(item.id)) { failedUnits.add(unitId); continue; }
      unit.q = item.action.payload.q;
      unit.r = item.action.payload.r;
    }

    // 移动/部署之后的实时占位：爆破的目标格判占用、攻击的目标格找人都用它。
    const liveOccupants = new Map();
    for (const unit of units) {
      if (!unit.alive) continue;
      const key = cellKey(unit);
      if (!liveOccupants.has(key)) liveOccupants.set(key, { kind: 'unit', entity: unit });
    }
    for (const home of hq.values()) {
      if (!home.alive) continue;
      const key = cellKey(home);
      if (!liveOccupants.has(key)) liveOccupants.set(key, { kind: 'headquarters', entity: home });
    }

    // ---- 6. 爆破（同一步内同格只允许一次；格上有单位则失败并级联）
    const clearedThisStep = new Set();
    for (const item of kept) {
      if (item.action.type !== 'demolish') continue;
      const payload = item.action.payload;
      const unit = unitById.get(payload.unitId);
      const key = cellKey(payload);
      if (
        !unit || unit.owner !== item.seat || !unit.alive
        || unit.type !== 'heavy' || hexDistance(unit, payload) > 1
        || !ctx.cellSet.has(key) || terrainNow(payload.q, payload.r) !== 'blocker'
        || clearedThisStep.has(key) || liveOccupants.has(key)
      ) {
        if (unit) failedUnits.add(unit.id);
        continue;
      }
      terrain.set(key, 'plain');
      clearedThisStep.add(key);
    }

    // ---- 7. 待命：只消耗行动点，无状态变化。

    // ---- 8. 攻击与治疗
    const strikes = [];
    for (const item of kept) {
      if (item.action.type !== 'attack') continue;
      const payload = item.action.payload;
      const attacker = unitById.get(payload.attackerId);
      if (!attacker || attacker.owner !== item.seat || !attacker.alive) {
        failedUnits.add(payload.attackerId);
        continue;
      }
      const used = attackCounts.get(attacker.id) ?? 0;
      if (used >= ctx.attackLimit) { failedUnits.add(attacker.id); continue; }
      attackCounts.set(attacker.id, used + 1);
      const aim = computeAim(game, attacker, 'attackShape', payload);
      if (!aim) { failedUnits.add(attacker.id); continue; }
      let lockedId = null;
      if (game.config?.units?.[attacker.type]?.attackLock) {
        const entry = ctx.planTimeCellUnit.get(cellKey(payload));
        if (entry && entry.owner !== item.seat) lockedId = entry.id;
      }
      strikes.push({ item, attacker, aim, lockedId });
    }

    const heals = [];
    for (const item of kept) {
      if (item.action.type !== 'heal') continue;
      const payload = item.action.payload;
      const support = unitById.get(payload.supportId);
      if (!support || support.owner !== item.seat || !support.alive || support.type !== 'support') continue;
      const aim = computeAim(game, support, 'healShape', payload);
      if (!aim) continue;
      if (isArtilleryDanger(game, support)
        || aim.cells.some(cell => ctx.cellSet.has(cellKey(cell)) && isArtilleryDanger(game, cell))) continue;
      heals.push({ item, support, aim });
    }

    // 先施放全部治疗（按本步移动后的最终站位、覆盖格内每个受伤友军各自掷量），
    // 再按行动顺序施加伤害——净 HP 等价于同时结算，且击杀归属确定。
    for (const heal of heals) {
      for (const cell of heal.aim.cells) {
        const target = units.find(unit =>
          unit.alive && unit.owner === heal.item.seat && unit.q === cell.q && unit.r === cell.r);
        if (!target || target.hp >= target.maxHp) continue;
        const applied = Math.min(target.maxHp - target.hp, rollHeal(heal.support));
        if (applied > 0) target.hp += applied;
      }
    }

    const deaths = [];
    const recorded = new Set();
    for (const strike of strikes) {
      const targets = [];
      if (strike.lockedId) {
        // 锁定射击：目标只要没逃出攻击者射程，跑到哪里都命中；逃出则整发落空（不回退形状）。
        const entity = unitById.get(strike.lockedId);
        if (entity && entity.alive && hexDistance(strike.attacker, entity) <= strike.attacker.attackRange) {
          targets.push({ kind: 'unit', entity });
        }
      } else {
        for (const cell of strike.aim.cells) {
          const occupant = liveOccupants.get(cellKey(cell));
          if (occupant && occupant.entity.owner !== strike.item.seat) targets.push(occupant);
        }
      }
      for (const target of targets) {
        const entity = target.entity;
        const damage = rollDamage(strike.attacker.attack, entity.defense);
        const actual = Math.min(entity.hp, damage);
        entity.hp = Math.max(0, entity.hp - damage);
        if (target.kind === 'headquarters') {
          hqDamageBy.set(strike.item.seat, (hqDamageBy.get(strike.item.seat) ?? 0) + actual);
        }
        // 死亡统一延后到本步全部伤害施加完毕：同一步互杀成立，攻击者阵亡不影响其炮弹。
        if (entity.hp === 0 && !recorded.has(entity.id)) {
          recorded.add(entity.id);
          deaths.push({ kind: target.kind, entity, killer: strike.item.seat });
          if (target.kind === 'unit') {
            killValueBy.set(strike.item.seat, (killValueBy.get(strike.item.seat) ?? 0) + (entity.cost ?? 0));
          }
        }
      }
    }

    // ---- 9. 死亡与淘汰
    for (const death of deaths) {
      death.entity.alive = false;
      if (death.kind === 'headquarters') eliminated.add(death.entity.owner);
    }
    if (annihilation) {
      for (const seat of order) {
        if (eliminated.has(seat)) continue;
        if (units.some(unit => unit.owner === seat && unit.alive)) continue;
        eliminated.add(seat);
      }
    }

    // ---- 10. 终局检查
    const active = order.filter(seatActive);
    if (active.length <= 1) { ended = true; break; }
  }

  // 占点：终局回合引擎直接 endGame 返回，**不**再占点。
  if (!ended) {
    for (const seat of order) {
      if (!seatActive(seat)) continue;
      for (const point of cps) {
        if (point.owner === seat) continue;
        const capturer = units.find(unit =>
          unit.alive && unit.owner === seat && unit.canCapture && unit.q === point.q && unit.r === point.r);
        if (capturer) point.owner = seat;
      }
    }
  }

  return {
    units, hq, cps, supplies, hqDamageBy, killValueBy, ended, steps,
    activeSeats: order.filter(seatActive),
  };
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
  if (sim.hq.get(ctx.owner)?.alive === false) return -TERMINAL;
  if (!ctx.enemySeats.some(seat => sim.hq.get(seat)?.alive !== false)) return TERMINAL;
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
// 敌方计划同样是**有序**的：每个行动点从该席位的单位里挑一个动作，因此可以采样出
// 「第 1 步移动、第 2 步攻击」这类跨行动点组合，与真实对手的队列同构。

const PERSONALITIES = ['objective', 'aggressive', 'random'];

function sampleFromDist(dist, rng) {
  let pick = rng();
  for (const [key, probability] of dist) {
    pick -= probability;
    if (pick <= 0) return parseKey(key);
  }
  return parseKey(dist.keys().next().value);
}

function shuffled(list, rng) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** 敌攻击瞄准：从我方当前格 / 可达格（预测）/ 总部里挑一个位于其投影站位射程内的目标格。 */
function sampleEnemyAttackAim(ctx, unit, from, rng) {
  const range = unit.attackRange ?? 0;
  const virtual = { ...unit, q: from.q, r: from.r };
  const targets = [];
  for (const mine of ctx.myUnits) {
    if (hexDistance(from, mine) <= range) targets.push({ q: mine.q, r: mine.r, w: 3 });
    for (const cell of ctx.myReach.get(mine.id) ?? []) {
      if (hexDistance(from, cell) <= range) targets.push({ q: cell.q, r: cell.r, w: 1 });
    }
  }
  if (ctx.myHq && hexDistance(from, ctx.myHq) <= range) targets.push({ q: ctx.myHq.q, r: ctx.myHq.r, w: 2 });
  if (!targets.length) return null;
  const total = targets.reduce((sum, target) => sum + target.w, 0);
  let pick = rng() * total;
  let chosen = targets[0];
  for (const target of targets) {
    pick -= target.w;
    if (pick <= 0) { chosen = target; break; }
  }
  if (!computeAim(ctx.game, virtual, 'attackShape', { q: chosen.q, r: chosen.r })) return null;
  return { type: 'attack', payload: { attackerId: unit.id, q: chosen.q, r: chosen.r } };
}

/** 为一个敌方席位采样一份**有序**合法计划（性格决定攻击倾向与落点分布）。 */
function sampleEnemyPlan(ctx, seat, rng) {
  const personality = PERSONALITIES[Math.floor(rng() * PERSONALITIES.length)];
  const budget = ctx.actionsPerTurn;
  const list = ctx.enemiesBySeat.get(seat) ?? [];
  const plan = [];
  const projected = new Map();
  const moved = new Set();
  const attacks = new Map();
  const claimed = new Set();
  const posOf = unit => projected.get(unit.id) ?? { q: unit.q, r: unit.r };
  const pAttack = personality === 'aggressive' ? 0.7 : personality === 'objective' ? 0.4 : 0.5;

  const deployOnce = () => {
    const supplies = ctx.enemySupplies.get(seat) ?? 0;
    if (!ctx.unitTypes.length) return null;
    for (const origin of ctx.deployOriginsBySeat.get(seat)?.values() ?? []) {
      const affordable = ctx.unitTypes.filter(
        type => ctx.utils.effectiveDeployCost(ctx.game, type, origin) <= supplies);
      if (!affordable.length) continue;
      const spots = ctx.utils.neighbors(origin).filter(pos =>
        inBounds(ctx, pos.q, pos.r) && terrainAt(ctx, pos.q, pos.r) === 'plain' && !claimed.has(cellKey(pos)));
      if (!spots.length) continue;
      const type = affordable[Math.floor(rng() * affordable.length)];
      const pos = spots[Math.floor(rng() * spots.length)];
      claimed.add(cellKey(pos));
      return { type: 'deploy', payload: { unitType: type, fromId: origin.id, q: pos.q, r: pos.r } };
    }
    return null;
  };

  while (plan.length < budget) {
    // 部署：偶发，且只在该席位还没花掉太多行动点时考虑。
    if (rng() < 0.18) {
      const deploy = deployOnce();
      if (deploy) { plan.push(deploy); continue; }
    }
    let action = null;
    for (const unit of shuffled(list, rng)) {
      const from = posOf(unit);
      if ((unit.attackRange ?? 0) > 0 && (attacks.get(unit.id) ?? 0) < ctx.attackLimit && rng() < pAttack) {
        const aim = sampleEnemyAttackAim(ctx, unit, from, rng);
        if (aim) {
          attacks.set(unit.id, (attacks.get(unit.id) ?? 0) + 1);
          action = aim;
          break;
        }
      }
      if (moved.has(unit.id)) continue;
      const reach = ctx.reachByUnit.get(unit.id) ?? [];
      if (!reach.length || rng() >= 0.85) continue;
      let dest;
      if (personality === 'random') dest = reach[Math.floor(rng() * reach.length)];
      else {
        const dist = ctx.distByUnit.get(unit.id);
        dest = dist ? sampleFromDist(dist, rng) : reach[Math.floor(rng() * reach.length)];
      }
      if (!dest || sameCell(dest, from) || claimed.has(cellKey(dest))) continue;
      claimed.add(cellKey(dest));
      moved.add(unit.id);
      projected.set(unit.id, { q: dest.q, r: dest.r });
      action = { type: 'move', payload: { unitId: unit.id, q: dest.q, r: dest.r } };
      break;
    }
    if (!action) break;
    plan.push(action);
  }
  return plan;
}

function sampleAllEnemyPlans(ctx, rng) {
  const plans = {};
  for (const seat of ctx.enemySeats) plans[seat] = sampleEnemyPlan(ctx, seat, rng);
  return plans;
}

// ---------------------------------------------------------------- 计划打分（rollout）

function scorePlan(ctx, plan, baseSeed, rollouts = CFG.rollouts) {
  let sum = 0;
  let sumSq = 0;
  let hasTerminal = false;
  for (let i = 0; i < rollouts; i++) {
    const rng = mulberry32((baseSeed + Math.imul(i + 1, 0x9e3779b9)) >>> 0);
    const enemyPlans = sampleAllEnemyPlans(ctx, rng);
    const value = evalBoard(ctx, simulateRoundSteps(ctx, plan, enemyPlans, rng));
    if (Math.abs(value) >= TERMINAL / 2) hasTerminal = true;
    sum += value;
    sumSq += value * value;
  }
  const mean = sum / rollouts;
  const std = Math.sqrt(Math.max(0, sumSq / rollouts - mean * mean));
  // 终局样本（±TERMINAL）会把 std 拉爆：命中终局时直接按均值主导，避免风险项掩盖必胜/必败。
  const risk = hasTerminal ? mean : mean - CFG.riskLambda * std;
  return { mean, std, risk };
}

// ---------------------------------------------------------------- 联合搜索

const withSlot = (plan, slot, action) => [...plan.slice(0, slot), action, ...plan.slice(slot + 1)];
const withoutSlot = (plan, slot) => [...plan.slice(0, slot), ...plan.slice(slot + 1)];
const swapped = (plan, slot) => {
  const copy = [...plan];
  [copy[slot], copy[slot + 1]] = [copy[slot + 1], copy[slot]];
  return copy;
};
const insertAt = (plan, slot, action) => [...plan.slice(0, slot), action, ...plan.slice(slot)];

/**
 * 爬山精修：在「替换某一步 / 插入 wait 对齐行动点 / 交换相邻两步 / 追加一步 / 删掉一步」
 * 的邻域里找改进。改动第 k 步会改变 k 之后所有步的投影，因此每个候选都过一遍 isPlanLegal。
 * 邻域先用少量 rollout 粗筛，只有胜出者才按满额 rollout 复核。
 */
function refinePlan(ctx, best, cache, deadline) {
  const over = () => Date.now() > deadline;
  const maxImprovements = CFG.refinePasses * Math.max(1, ctx.actionsPerTurn);
  let improvements = 0;

  while (improvements < maxImprovements && !over()) {
    let winner = null;
    outer:
    for (let slot = 0; slot <= best.plan.length && !over(); slot++) {
      const neighbors = [];
      if (slot < best.plan.length) {
        const current = best.plan[slot];
        const prefix = best.plan.slice(0, slot);
        const unitId = actionUnitId(current);
        for (const candidate of stepCandidates(ctx, prefix, cache)) {
          if (candidate.type === 'wait') continue;
          if (unitId && candidate.unitId !== unitId) continue;
          if (actionSignature(candidate.action) === actionSignature(current)) continue;
          neighbors.push(withSlot(best.plan, slot, candidate.action));
          if (neighbors.length >= 8) break;
        }
        neighbors.push(withoutSlot(best.plan, slot));
        if (best.plan.length < ctx.actionsPerTurn) {
          neighbors.push(insertAt(best.plan, slot, { type: 'wait', payload: {} }));
        }
        if (slot + 1 < best.plan.length) neighbors.push(swapped(best.plan, slot));
      } else if (best.plan.length < ctx.actionsPerTurn) {
        for (const candidate of stepCandidates(ctx, best.plan, cache)) {
          if (candidate.score <= MIN_SCORE) continue;
          neighbors.push([...best.plan, candidate.action]);
          if (neighbors.length >= 8) break;
        }
      }
      for (const trial of neighbors) {
        if (planSignature(trial) === planSignature(best.plan)) continue;
        if (!isPlanLegal(ctx, trial)) continue;
        const score = scorePlan(ctx, trial, ctx.seed, CFG.screenRollouts).risk;
        if (!winner || score > winner.score) winner = { plan: trial, score };
        if (over()) break outer;
      }
    }
    if (!winner) break;
    // 粗筛胜出者按满额 rollout 复核，避免被小样本噪音牵着走。
    const confirmed = scorePlan(ctx, winner.plan, ctx.seed).risk;
    if (confirmed <= best.score + 1e-6) break;
    best = { plan: winner.plan, score: confirmed };
    improvements++;
  }
  return best;
}

function searchBestPlan(ctx) {
  const deadline = Date.now() + CFG.timeBudgetMs;
  const cache = new Map();
  const seeds = generateSeedPlans(ctx, cache);
  let best = { plan: [], score: -Infinity };
  for (const plan of seeds) {
    const score = scorePlan(ctx, plan, ctx.seed).risk;
    if (score > best.score) best = { plan, score };
    if (Date.now() > deadline) return best.plan;
  }
  if (!best.plan.length) return [];
  return refinePlan(ctx, best, cache, deadline).plan;
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
  const cellSet = new Set();
  const terrainByCell = new Map();
  for (const cell of game.cells ?? []) {
    const key = `${cell.q},${cell.r}`;
    cellSet.add(key);
    terrainByCell.set(key, cell.terrain ?? 'plain');
  }
  const terrainOverride = new Map();
  for (const cell of game.map?.terrainCells ?? []) terrainOverride.set(`${cell.q},${cell.r}`, cell.terrain);

  // 回合开始（= 计划时刻）的站位：投影兜底、锁定射击判定都用它。
  const basePositions = new Map();
  const planTimeCellUnit = new Map();
  const occupiedAtPlan = new Set();
  for (const unit of game.units ?? []) {
    if (!unit.alive) continue;
    basePositions.set(unit.id, { q: unit.q, r: unit.r });
    planTimeCellUnit.set(`${unit.q},${unit.r}`, { id: unit.id, owner: unit.owner });
    occupiedAtPlan.add(`${unit.q},${unit.r}`);
  }
  for (const home of Object.values(game.headquarters ?? {})) {
    if (home?.alive !== false && home) occupiedAtPlan.add(`${home.q},${home.r}`);
  }

  const turnOrder = (game.turn?.turnOrder ?? []).filter(seat => game.players?.[seat]?.status === 'active');
  const deployOriginsBySeat = new Map();
  for (const seat of new Set([owner, ...enemySeats])) {
    deployOriginsBySeat.set(seat, new Map(utils.deployOrigins(game, seat).map(origin => [origin.id, origin])));
  }

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
    objectives: new Map(),
    myReach: new Map(),
    enemySupplies: new Map(enemySeats.map(seat => [seat, game.resources?.[seat]?.supplies ?? 0])),
    supplies: game.resources?.[owner]?.supplies ?? 0,
    turnOrder,
    maxTurns: game.config?.balance?.maxTurns === null ? null : (game.config?.balance?.maxTurns ?? 15),
    roundNumber,
    actionsPerTurn: game.config?.balance?.actionsPerTurn ?? 5,
    attackLimit: attackLimitFor(game),
    variance: game.config?.balance?.damageVarianceRange ?? 3,
    healVariance: game.config?.balance?.healVarianceRange ?? 6,
    minDamage: game.config?.balance?.minimumDamage ?? 1,
    volleyFactor: 1,
    seed: stateSeed(game, owner, roundNumber),
    cellSet,
    terrainByCell,
    terrainOverride,
    emptyProjection: { positions: new Map(), terrain: new Map() },
    basePositions,
    planTimeCellUnit,
    occupiedAtPlan,
    unitById: new Map(myUnits.map(unit => [unit.id, unit])),
    unitTypes: Object.keys(game.config?.units ?? {}),
    deployOrigins: utils.deployOrigins(game, owner),
    deployOriginById: deployOriginsBySeat.get(owner) ?? new Map(),
    deployOriginsBySeat,
    enemyDeployRisk: new Map(),
    distByUnit: new Map(),
    reachByUnit: new Map(),
    presence: new Map(),
    claimRisk: new Map(),
    attackEntries: new Map(),
  };
  if (!ctx.turnOrder.length) ctx.turnOrder = [owner, ...enemySeats];
  // 结算顺序里己方席位必须存在，否则 simulateRoundSteps 会漏掉我方队列。
  if (!ctx.turnOrder.includes(owner)) ctx.turnOrder = [owner, ...ctx.turnOrder];

  for (const hq of ctx.enemyHqs.values()) ctx.enemyHqByKey.set(cellKey(hq), hq);
  for (const unit of myUnits) {
    ctx.myReach.set(unit.id, planReachable(ctx, unit, unit.moveRange ?? 0, ctx.emptyProjection));
    for (const neighbor of utils.neighbors(unit)) ctx.nearMyUnitCells.add(cellKey(neighbor));
  }
  ctx.volleyFactor = enemies.length ? Math.min(1, ctx.actionsPerTurn / enemies.length) : 1;

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

/** 把引擎的 PendingAction 还原成计划动作形状（去掉 id/direction），用于跳过已入队的动作。 */
function queuedToPlanAction(action) {
  const payload = {};
  if (action.type === 'attack') payload.attackerId = action.attackerId;
  else if (action.type === 'heal') payload.supportId = action.supportId;
  else if (action.type === 'move' || action.type === 'demolish') payload.unitId = action.unitId;
  else if (action.type === 'deploy') { payload.unitType = action.unitType; payload.fromId = action.fromId; }
  if (typeof action.q === 'number') { payload.q = action.q; payload.r = action.r; }
  return { type: action.type, payload };
}

/**
 * 兵棋推演算法主模块
 */
export default {
  name: 'kriegspiel',
  description: '兵棋推演算法：分步结算 rollout + 整份计划联合搜索 + 风险规避',

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
      const actions = context.myUnits.length || context.deployOrigins.length
        ? searchBestPlan(context)
        : [];
      entry = { actions, cursor: 0 };
      planCache.set(key, entry);
    }

    // 已入队动作按签名**计数**跳过：wait 的签名全都一样，用集合会把后续 wait 全吞掉。
    const queued = new Map();
    for (const action of queue) {
      const signature = actionSignature(queuedToPlanAction(action));
      queued.set(signature, (queued.get(signature) ?? 0) + 1);
    }

    while (entry.cursor < entry.actions.length) {
      const action = entry.actions[entry.cursor++];
      const signature = actionSignature(action);
      const left = queued.get(signature) ?? 0;
      if (left > 0) { queued.set(signature, left - 1); continue; }
      return { type: action.type, payload: action.payload };
    }
    return null;
  },
};

// 测试/标定用的内部入口（runner 只读 default）。
export const kriegspielInternals = {
  buildContext,
  buildEnemyModel,
  projectPlan,
  isActionLegal,
  isPlanLegal,
  stepCandidates,
  generateSeedPlans,
  simulateRoundSteps,
  evalBoard,
  scorePlan,
  searchBestPlan,
  sampleAllEnemyPlans,
  mulberry32,
};
