// algorithms/builtin/matrix-eq.mjs
//
// 矩阵均衡算法（Matrix Equilibrium）v2 ——同时回合模式的第三条技术路线：
// 把每一轮升维成「计划组合 × 计划组合」的矩阵博弈，用自我对弈的
// 后悔匹配（regret matching / 单步 CFR）在该矩阵上求解均衡混合策略，
// 再从均衡分布中抽样本轮完整计划逐动作入队。
//
// v2（面向 3.8.0 引擎改版）：
//   3.8.0 把同时模式改为「按行动点分步结算」——队列第 k 条在所有玩家之间
//   同时结算完成后才进入第 k+1 条；同一单位可在多个行动点连续行动（先移动
//   后攻击、连续两次移动）；计划期只做结构性校验（寻路只看地形、不看占位）；
//   结算期才判定目的格到达（允许同一步腾格/交换）、级联预检（单位先前动作
//   硬失败则后续作废）、每单位攻击次数上限、逐步死亡。本版本全面适配：
//   1. 镜像结算器重写为分步结算器（级联/到达求解/逐步死亡/攻击上限）；
//   2. 计划校验镜像 3.8 planning.ts 的结构性校验（投影站位 + 地形寻路）；
//   3. 计划生成器升级为「组合动作」生成：移动+攻击连击、先射后撤、
//      连续移动抢占点，充分利用多行动点机制；
//   4. 事件史重建升级：按步序重建敌方整轮计划（executed/failed 的部署、
//      攻击、移动、治疗均可还原），实证场景更精确；
//   5. 新增两项 v1 缺陷的针对性改进（v1 对 kriegspiel 8:22 的归因）：
//      a. 池内精修——对被选中执行的计划做有界爬山变异（换瞄准/换落点/
//         调步序/删动作），对场景分布评估后接受改进；
//      b. 自适应利用混合——实证轮数越多，越提高对「实证分布最优响应」
//         的采样权重 γ（对确定性对手形成剥削），其余权重保持均衡混合。
//
// 与 random-sim 的差别：random-sim 是动作级无模型均匀随机；本算法的
// 随机性出现在「均衡混合」这一层——抽样分布是对手无论怎么读盘都
// 无法系统性剥削的最优响应意义上的混合，而不是均匀撒点。
//
// 与 dest-prob 的差别（三条轴）：
//   1. 决策粒度：dest-prob 每次 decide 做一次边际贪心 argmax（单动作
//      期望值最高者胜）；本算法一次性求解整轮 ≤5 个动作的组合计划，
//      组合间的协同（连击/换位/占点+护点）直接进入支付矩阵。
//   2. 对手模型来源：dest-prob 用固定启发式（softmax 落点分布）预测
//      敌人；本算法的对手策略是博弈解的内生部分（自我对弈均衡），
//      并用事件史重建的敌方真实计划做实证校正。
//   3. 输出形态：dest-prob 确定性输出，面对会读盘的对手（人或强 AI）
//      会被反预测；本算法输出混合策略，同一棋盘不同轮次可以打出
//      不同计划，天然反读盘。
//
// 管线（每轮）：
//   检测新回合 → 生成我方 K 个候选组合计划（人格 + 随机权重贪心，
//   含连击/先射后撤/抢点模式）
//   → 生成敌方 K' 个镜像候选计划 + 事件史实证计划（按步序重建）
//   → 分步结算镜像器逐组合模拟（支付按裁定权重增量计价）
//   → 2 人局：CFR 自我对弈解均衡 + 自适应利用混合 γ；3+ 人：对场景
//     分布做后悔匹配
//   → 抽样一个计划 → 有界池内精修 → 缓存，decide 逐动作吐出
//
// 随机性由 mulberry32 提供，种子 = fnv(gameId:owner:roundNumber)：
// 同一局同一轮可复现（回放/标定友好），跨轮可变（反读盘）。
//
// 约束：所有枚举镜像 3.8.0 src/engine/planning.ts 的结构性入队校验
// （投影站位、地形寻路、攻击次数上限、部署预算扣减），结算模拟镜像
// src/engine/simultaneousResolve.ts 的分步判定（级联预检、到达求解、
// 同步腾格、先治疗后扣伤、逐步死亡、attackLock 锁定计划时刻站位），
// 保证 runner 不会因非法动作空耗重问配额。

// ---------------------------------------------------------------- 常量

const MY_PORTFOLIO_SIZE = 10;      // 我方候选计划数（人格 + 随机权重）
const ENEMY_PORTFOLIO_SIZE = 9;    // 每个敌方席位的镜像候选计划数
const MAX_EMPIRICAL_PLANS = 3;     // 事件史重建的敌方计划，每席位最多保留
const MULTI_SCENARIOS = 24;        // ≥3 人局联合场景抽样数
const CFR_ITERATIONS = 300;        // 后悔匹配迭代轮数
const HQ_WIN_BONUS = 1e6;          // 模拟中摧毁敌方总部的支付（终局级）
const ACTION_NOISE = 0.12;         // 人格贪心内的 PRNG 扰动幅度（比例）

// v2 改进参数。
const EXPLOIT_GAMMA_MAX = 0.45;    // 自适应利用混合的 γ 上限
const EXPLOIT_GAMMA_STEP = 0.12;   // 每一轮实证证据的 γ 增量
const REFINE_MUTANTS = 8;          // 池内精修的最大变异数
const REFINE_SCENARIOS = 6;        // 精修评估的场景数上限
const SOLVE_TIME_BUDGET_MS = 200;  // 矩阵求解的软时限（超时截断剩余行）
const REFINE_TIME_BUDGET_MS = 320; // 精修放弃的软时限

const HEX_DIRS = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

// 策略人格：动作竞标权重（cp=占点 fire=火力 safety=避险 heal=治疗
// deploy=部署 advance=推进 combo=连击倾向）。生成器按权重构造组合计划。
const PERSONAS = [
  { name: 'occupy', w: { cp: 3.0, fire: 1.0, safety: 0.6, heal: 1.2, deploy: 1.6, advance: 0.4, combo: 1.0 } },
  { name: 'strike', w: { cp: 0.8, fire: 3.0, safety: 1.0, heal: 0.8, deploy: 0.8, advance: 1.2, combo: 2.5 } },
  { name: 'turtle', w: { cp: 0.6, fire: 1.0, safety: 2.5, heal: 2.5, deploy: 1.0, advance: 0.0, combo: 0.4 } },
  { name: 'advance', w: { cp: 1.0, fire: 1.5, safety: 0.8, heal: 0.8, deploy: 1.2, advance: 3.0, combo: 2.0 } },
  { name: 'hold', w: { cp: 0.5, fire: 2.0, safety: 1.5, heal: 1.5, deploy: 0.5, advance: 0.2, combo: 1.2 } },
  { name: 'skirmish', w: { cp: 1.5, fire: 1.8, safety: 1.8, heal: 1.0, deploy: 1.0, advance: 1.0, combo: 1.8 } },
];

// ---------------------------------------------------------------- 随机数

/** FNV-1a 字符串散列 → uint32 种子。 */
function hashSeed(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG：返回 [0,1) 随机数。 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- 几何

function hexDistance(a, b) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(-a.q - a.r - (-b.q - b.r)));
}

function hexKey(p) { return `${p.q},${p.r}`; }

function sameCell(a, b) { return a.q === b.q && a.r === b.r; }

function neighborsOf(p) {
  return HEX_DIRS.map(d => ({ q: p.q + d.q, r: p.r + d.r }));
}

// ---------------------------------------------------------------- 形状覆盖
// 镜像 src/engine/planning.ts 的 shapeSpecFor + computeCoveredCells：
// single = 射程内任选一格（攻击不许打自身格）；line = 沿正六方向覆盖
// 前 length 格（瞄准格只决定方向）；arc = 点击相邻格定向，覆盖该格
// 及其左右相邻共 3 格。

function shapeSpecFor(spec, kind) {
  const shape = spec ? spec[kind] : null;
  if (!shape) return { type: 'single', length: 1 };
  if (shape.type === 'line') return { type: 'line', length: shape.length ?? 2 };
  if (shape.type === 'arc') return { type: 'arc', length: 3 };
  return { type: 'single', length: 1 };
}

function computeCoveredCells(from, shape, kind, target, range) {
  if (hexDistance(from, target) > range) return null;
  if (shape.type === 'single') {
    const distance = hexDistance(from, target);
    if (distance > range) return null;
    if (kind === 'attackShape' && distance === 0) return null;
    return { type: 'single', direction: 0, cells: [{ q: target.q, r: target.r }] };
  }
  if (shape.type === 'arc') {
    if (hexDistance(from, target) !== 1) return null;
    const dir = HEX_DIRS.findIndex(d =>
      from.q + d.q === target.q && from.r + d.r === target.r);
    if (dir < 0) return null;
    const left = HEX_DIRS[(dir + 5) % 6];
    const right = HEX_DIRS[(dir + 1) % 6];
    return {
      type: 'arc',
      direction: dir,
      cells: [
        { q: target.q, r: target.r },
        { q: from.q + left.q, r: from.r + left.r },
        { q: from.q + right.q, r: from.r + right.r },
      ],
    };
  }
  // line：点击格必须落在某个正六方向射线上，距离 1..min(length, range)。
  const dq = target.q - from.q;
  const dr = target.r - from.r;
  const length = Math.min(shape.length, range);
  for (let dir = 0; dir < 6; dir++) {
    const d = HEX_DIRS[dir];
    const k = d.q !== 0 ? dq / d.q : dr / d.r;
    if (!Number.isInteger(k) || k < 1 || k > length) continue;
    if (d.q * k !== dq || d.r * k !== dr) continue;
    const cells = [];
    for (let step = 1; step <= length; step++) {
      cells.push({ q: from.q + d.q * step, r: from.r + d.r * step });
    }
    return { type: 'line', direction: dir, cells };
  }
  return null;
}

// ---------------------------------------------------------------- 局面镜像

/**
 * 把 game 状态克隆成结算模拟器需要的最小可变结构。
 * 每次模拟独立克隆（每轮 ≤ ~150 次模拟，克隆量很小）。
 */
function cloneBoard(game) {
  const balance = game.config?.balance ?? {};
  const unitsSpec = game.config?.units ?? {};
  const hqSpec = game.config?.headquartersSpec ?? {};
  const units = (game.units ?? [])
    .filter(u => u && u.alive !== false)
    .map(u => ({
      id: u.id, owner: u.owner, type: u.type,
      q: u.q, r: u.r, hp: u.hp, maxHp: u.maxHp ?? hpOf(unitsSpec[u.type]),
      attack: u.attack, defense: u.defense,
      moveRange: u.moveRange, attackRange: u.attackRange,
      canCapture: u.canCapture, attackLock: u.attackLock ?? false,
      healPower: u.healPower ?? 0, cost: u.cost ?? (unitsSpec[u.type]?.cost ?? 0),
      alive: true,
    }));
  const hqs = {};
  for (const [owner, hq] of Object.entries(game.headquarters ?? {})) {
    if (!hq || hq.alive === false) continue;
    hqs[owner] = {
      id: hq.id ?? `${owner}_hq`, owner, q: hq.q, r: hq.r,
      hp: hq.hp, maxHp: hq.maxHp ?? hqSpec.hp ?? hq.hp,
      defense: hq.defense ?? hqSpec.defense ?? 0, alive: true,
    };
  }
  const cps = (game.controlPoints ?? []).map(cp => ({
    id: cp.id, q: cp.q, r: cp.r, kind: cp.kind ?? 'supply', owner: cp.owner ?? null,
  }));
  const players = {};
  for (const [id, p] of Object.entries(game.players ?? {})) {
    const stats = p?.stats ?? {};
    players[id] = {
      id, status: p?.status ?? 'active',
      stats: {
        headquartersDamage: stats.headquartersDamage ?? 0,
        killValue: stats.killValue ?? 0,
        controlHold: stats.controlHold ?? 0,
        controlHoldRounds: stats.controlHoldRounds ?? 0,
      },
    };
  }
  const supplies = {};
  for (const [id, res] of Object.entries(game.resources ?? {})) {
    supplies[id] = res?.supplies ?? 0;
  }
  const cells = new Set((game.cells ?? []).map(hexKey));
  const terrain = new Map((game.cells ?? []).map(c => [hexKey(c), c.terrain ?? 'plain']));
  for (const t of game.map?.terrainCells ?? []) terrain.set(hexKey(t), t.terrain);
  return {
    balance, unitsSpec, hqSpec, units, hqs, cps, players, supplies,
    cells, terrain,
    turnOrder: (game.turn?.turnOrder ?? Object.keys(players))
      .filter(id => players[id] && players[id].status === 'active'),
  };
}

/**
 * 模拟器内部结构的浅层复制（每次模拟独立副本）：
 * units/hqs/cps/stats/terrain 逐个复制（结算中会变），cells/unitsSpec/
 * balance/turnOrder 只读共享。
 */
function copyBoard(board) {
  const units = board.units.map(u => ({ ...u }));
  const hqs = {};
  for (const [owner, hq] of Object.entries(board.hqs)) hqs[owner] = { ...hq };
  const cps = board.cps.map(cp => ({ ...cp }));
  const players = {};
  for (const [id, p] of Object.entries(board.players)) {
    players[id] = { id, status: p.status, stats: { ...p.stats } };
  }
  const supplies = { ...board.supplies };
  return {
    balance: board.balance, unitsSpec: board.unitsSpec, hqSpec: board.hqSpec,
    units, hqs, cps, players, supplies,
    cells: board.cells, terrain: new Map(board.terrain),
    turnOrder: board.turnOrder.slice(),
  };
}

function hpOf(spec) { return spec?.hp ?? 1; }

function boardTerrainAt(board, pos) {
  return board.terrain.get(hexKey(pos)) ?? 'blocker';
}

/** 计划时刻占位表：units + 总部（与引擎 occupants 同口径）。 */
function occupancyMap(board) {
  const map = new Map();
  for (const u of board.units) map.set(hexKey(u), { kind: 'unit', entity: u });
  for (const hq of Object.values(board.hqs)) {
    if (hq.alive) map.set(hexKey(hq), { kind: 'headquarters', entity: hq });
  }
  return map;
}

// ---------------------------------------------------------------- 计划投影与结构性校验
// 镜像 3.8.0 src/engine/planning.ts 的「结构性校验」口径：
//   计划期只看结构——单位归属、行动点预算、目标格在图内、形状/射程匹配
//   （起点按投影站位）、部署预算。占用/地形动态/目的格冲突一律留给结算期。
//   同一单位可多行动点连续行动（先移后攻、连移）；寻路只按地形（单位可能
//   会走开，不当作墙）；自己先前排的 demolish 投影成 plain。

/**
 * 计划队列投影：执行完当前队列后的虚拟站位 / 虚拟地形 / 攻击计数 /
 * 累计部署花费。只假设自己的动作全部成功（与引擎 projectPlanQueue 同义）。
 * owner 指定动作归属方（部署折扣按该方的部署起点计算）；缺省时回退动作上的
 * owner 字段，外部队列的动作可能没有该字段，此时折扣按 0 处理。
 */
function projectQueue(board, queue, owner) {
  const positions = new Map();
  const terrain = new Map();
  const attackCounts = new Map();
  let deploySpend = 0;
  for (const a of queue) {
    if (a.type === 'move' && a.unitId) {
      positions.set(a.unitId, { q: a.q, r: a.r });
    } else if (a.type === 'attack' && a.attackerId) {
      attackCounts.set(a.attackerId, (attackCounts.get(a.attackerId) ?? 0) + 1);
    } else if (a.type === 'demolish') {
      terrain.set(hexKey(a), 'plain');
    } else if (a.type === 'deploy' && a.unitType && a.fromId) {
      const spec = board.unitsSpec[a.unitType];
      if (spec) {
        const origin = boardDeployOrigin(board, owner ?? a.owner ?? '?', a.fromId);
        deploySpend += spec.cost - Math.min(spec.cost, origin
          ? deployDiscountFor(board, owner ?? a.owner ?? '?', origin) : 0);
      }
    }
  }
  return { positions, terrain, attackCounts, deploySpend };
}

/** 投影后的单位站位（无投影时回落到当前站位）。 */
function projectedPosition(board, projection, unitId) {
  const p = projection.positions.get(unitId);
  if (p) return p;
  const unit = board.units.find(u => u.id === unitId);
  return unit ? { q: unit.q, r: unit.r } : null;
}

/** 计划期可达格：只按（投影）地形寻路，忽略单位与总部占位。 */
function terrainReachable(board, from, range, projection) {
  const visited = new Set([hexKey(from)]);
  const result = [];
  const bfs = [{ pos: from, distance: 0 }];
  for (let i = 0; i < bfs.length; i++) {
    const cur = bfs[i];
    if (cur.distance >= range) continue;
    for (const next of neighborsOf(cur.pos)) {
      const key = hexKey(next);
      if (visited.has(key)) continue;
      visited.add(key);
      if (!board.cells.has(key)) continue;
      const terr = projection.terrain.get(key) ?? board.terrain.get(key) ?? 'blocker';
      if (terr !== 'plain') continue;
      result.push({ q: next.q, r: next.r });
      bfs.push({ pos: next, distance: cur.distance + 1 });
    }
  }
  return result;
}

/**
 * 结构性入队校验（镜像 3.8 planning.ts queueXxxAction 的检查链）。
 * 返回 null 表示合法，否则返回原因字符串。
 */
function structuralCheck(board, owner, action, queue) {
  const limit = board.balance?.actionsPerTurn ?? 5;
  if (queue.length >= limit) return '行动点预算已满';
  const projection = projectQueue(board, queue, owner);

  if (action.type === 'move') {
    const unit = board.units.find(u => u.id === action.unitId && u.owner === owner && u.alive !== false);
    if (!unit) return '移动：单位不存在';
    if (!board.cells.has(hexKey(action))) return '移动：目标格在地图之外';
    const from = projectedPosition(board, projection, unit.id);
    if (!from) return '移动：单位不存在';
    if (from.q === action.q && from.r === action.r) return '移动：目标与投影站位相同';
    if (!terrainReachable(board, from, unit.moveRange, projection)
      .some(pos => pos.q === action.q && pos.r === action.r)) {
      return '移动：投影站位地形不可达';
    }
    return null;
  }

  if (action.type === 'attack') {
    const unit = board.units.find(u => u.id === action.attackerId && u.owner === owner && u.alive !== false);
    if (!unit) return '攻击：单位不存在';
    const attackLimit = board.balance?.attacksPerUnit ?? 1;
    const used = projection.attackCounts.get(unit.id) ?? 0;
    if (used >= attackLimit) return `攻击：该单位本轮最多攻击 ${attackLimit} 次`;
    if (!board.cells.has(hexKey(action))) return '攻击：目标格在地图之外';
    const from = projectedPosition(board, projection, unit.id);
    if (!from) return '攻击：单位不存在';
    const spec = board.unitsSpec[unit.type] ?? {};
    const aim = computeCoveredCells(from, shapeSpecFor(spec, 'attackShape'), 'attackShape', action, unit.attackRange);
    if (!aim) return '攻击：形状/射程打不到目标格';
    return null;
  }

  if (action.type === 'heal') {
    const unit = board.units.find(u => u.id === action.supportId && u.owner === owner && u.alive !== false);
    if (!unit) return '治疗：单位不存在';
    if (!board.cells.has(hexKey(action))) return '治疗：目标格在地图之外';
    const from = projectedPosition(board, projection, unit.id);
    if (!from) return '治疗：单位不存在';
    const spec = board.unitsSpec[unit.type] ?? {};
    const healRange = spec.healRange ?? unit.attackRange ?? 1;
    const aim = computeCoveredCells(from, shapeSpecFor(spec, 'healShape'), 'healShape', action, healRange);
    if (!aim) return '治疗：形状/射程打不到目标格';
    return null;
  }

  if (action.type === 'deploy') {
    const spec = board.unitsSpec[action.unitType];
    if (!spec) return '部署：未知兵种';
    const origin = boardDeployOrigin(board, owner, action.fromId);
    if (!origin) return '部署：起点无效（须为总部或己方可部署据点）';
    if (hexDistance(origin, action) !== 1) return '部署：目标格不与起点相邻';
    if (!board.cells.has(hexKey(action))) return '部署：目标格在地图之外';
    const terr = projection.terrain.get(hexKey(action)) ?? board.terrain.get(hexKey(action)) ?? 'blocker';
    if (terr !== 'plain') return '部署：目标格不是平原';
    const discount = Math.min(spec.cost, deployDiscountFor(board, owner, origin));
    const cost = spec.cost - discount;
    if ((board.supplies[owner] ?? 0) - projection.deploySpend < cost) return '部署：补给不足';
    return null;
  }

  if (action.type === 'demolish') {
    const unit = board.units.find(u => u.id === action.unitId && u.owner === owner && u.alive !== false);
    if (!unit) return '拆除：单位不存在';
    if (unit.type !== 'heavy') return '拆除：只有 heavy 能拆除';
    if (!board.cells.has(hexKey(action))) return '拆除：目标格在地图之外';
    const from = projectedPosition(board, projection, unit.id);
    if (!from || hexDistance(from, action) > 1) return '拆除：目标格不在投影站位相邻';
    const terr = projection.terrain.get(hexKey(action)) ?? board.terrain.get(hexKey(action)) ?? 'blocker';
    if (terr !== 'blocker') return '拆除：目标格不是障碍';
    return null;
  }

  if (action.type === 'wait') return null; // 只占行动点
  return '未知动作类型';
}

function boardDeployOrigin(board, owner, fromId) {
  const hq = board.hqs[owner];
  const hqAllowed = board.balance?.deployFromHq !== false;
  if (hq && hq.alive && hqAllowed && hq.id === fromId) return hq;
  if (hq && hq.alive && hqAllowed && fromId === `${owner}_hq`) return hq;
  const cp = board.cps.find(c => c.id === fromId && c.owner === owner);
  if (cp && (board.balance?.controlPointTypes ?? {})[cp.kind ?? 'supply']?.canDeploy !== false) return cp;
  // 状态里总部可能没有 id 字段：fromId 形如 'hq' / 'headquarters:player_a'。
  if (hq && hq.alive && hqAllowed && (fromId === 'hq' || fromId === 'headquarters')) return hq;
  return null;
}

/** 枚举某单位从指定站位出发的全部合法攻击瞄准（含空格：预测射击）。 */
function enumerateAttackAimsFrom(board, unit, from) {
  const spec = board.unitsSpec[unit.type] ?? {};
  const shape = shapeSpecFor(spec, 'attackShape');
  const aims = [];
  const seen = new Set();
  const tryAim = (target) => {
    const aim = computeCoveredCells(from, shape, 'attackShape', target, unit.attackRange);
    if (!aim) return;
    // 线性武器的覆盖格只由 type|direction 决定（与点击格距离无关，引擎的
    // 锁定查找也只看计划时刻站位），同射线 k 步去重为一条瞄准；single/arc
    // 的覆盖随目标格变化，仍按格去重。
    const key = aim.type === 'line'
      ? `${aim.type}|${aim.direction}`
      : `${aim.type}|${aim.direction}|${target.q},${target.r}`;
    if (seen.has(key)) return;
    seen.add(key);
    aims.push({ target: { q: target.q, r: target.r }, aim });
  };
  if (shape.type === 'single') {
    for (let dq = -unit.attackRange; dq <= unit.attackRange; dq++) {
      for (let dr = -unit.attackRange; dr <= unit.attackRange; dr++) {
        if (hexDistance(from, { q: from.q + dq, r: from.r + dr }) > unit.attackRange) continue;
        tryAim({ q: from.q + dq, r: from.r + dr });
      }
    }
  } else if (shape.type === 'arc') {
    for (const d of HEX_DIRS) tryAim({ q: from.q + d.q, r: from.r + d.r });
  } else {
    for (const d of HEX_DIRS) {
      const maxK = Math.min(shape.length, unit.attackRange);
      for (let k = 1; k <= maxK; k++) tryAim({ q: from.q + k * d.q, r: from.r + k * d.r });
    }
  }
  return aims.filter(a => board.cells.has(hexKey(a.target)));
}

/** 枚举支援兵从指定站位出发的治疗瞄准（覆盖格含友军才有意义）。 */
function enumerateHealAimsFrom(board, unit, from, occupants) {
  const spec = board.unitsSpec[unit.type] ?? {};
  const shape = shapeSpecFor(spec, 'healShape');
  const healRange = spec.healRange ?? unit.attackRange ?? 1;
  const aims = [];
  const seen = new Set();
  for (const d of HEX_DIRS) {
    const target = { q: from.q + d.q, r: from.r + d.r };
    const aim = computeCoveredCells(from, shape, 'healShape', target, healRange);
    if (!aim) continue;
    const key = `${aim.type}|${aim.direction}`;
    if (seen.has(key)) continue;
    const coveredFriend = aim.cells.some(cell => {
      const occ = occupants.get(hexKey(cell));
      return occ && occ.kind === 'unit' && occ.entity.owner === unit.owner;
    });
    if (!coveredFriend) continue;
    seen.add(key);
    aims.push({ target, aim });
  }
  return aims;
}

function deployDiscountFor(board, owner, origin) {
  const kinds = board.balance?.controlPointTypes ?? {};
  const cfg = kinds[origin.kind ?? 'supply'];
  return Math.min(999, cfg?.deployDiscount ?? 0);
}

// ---------------------------------------------------------------- 计划生成器
// v2 组合动作生成器：3.8.0 允许同一单位在多个行动点连续行动，因此以
// 「单位组合」为生成单元——移动+攻击连击、先射后撤、连续移动抢点、
// 移动+治疗；组合按人格权重竞标，汇编模式决定步序：
//   advance：部署 → 全部移动 → 全部攻击/治疗（推进后齐射，打预测终位）
//   strike：全部攻击/治疗 → 全部移动（先手齐射，再位移躲后续火力）
//   free：  按组合竞标分排序原样交错。

function personaWeights(rng) {
  return {
    cp: 0.5 + rng() * 2.0,
    fire: 0.5 + rng() * 2.0,
    safety: 0.5 + rng() * 2.0,
    heal: 0.5 + rng() * 2.0,
    deploy: 0.5 + rng() * 2.0,
    advance: 0.5 + rng() * 2.0,
    combo: 0.5 + rng() * 2.0,
  };
}

/** 敌方落点先验：0.5 留原地，0.5 均摊到地形可达格（3.8 寻路不看占位）。 */
function enemyDestPrior(board, enemies) {
  const prior = new Map();
  const emptyProj = { terrain: new Map() };
  for (const u of enemies ?? board.units) {
    prior.set(hexKey(u), (prior.get(hexKey(u)) ?? 0) + 0.5);
    const reach = terrainReachable(board, u, u.moveRange, emptyProj);
    if (reach.length) {
      const share = 0.5 / reach.length;
      for (const c of reach) prior.set(hexKey(c), (prior.get(hexKey(c)) ?? 0) + share);
    }
  }
  return prior;
}

/** 我方每个候选落点的期望承伤（敌方按先验落点 + 从落点开火的覆盖）。 */
function exposureMap(board, enemies, destPrior) {
  const exposure = new Map();
  for (const enemy of enemies) {
    const spec = board.unitsSpec[enemy.type] ?? {};
    const shape = shapeSpecFor(spec, 'attackShape');
    for (const [posKey, p] of destPrior) {
      if (p < 0.08) continue;
      const pos = { q: Number(posKey.split(',')[0]), r: Number(posKey.split(',')[1]) };
      if (hexDistance(enemy, pos) > enemy.moveRange) continue;
      const targets = shape.type === 'single'
        ? cellsWithin(pos, enemy.attackRange)
        : HEX_DIRS.map(d => ({ q: pos.q + d.q, r: pos.r + d.r }));
      for (const t of targets) {
        const aim = computeCoveredCells(pos, shape, 'attackShape', t, enemy.attackRange);
        if (!aim) continue;
        for (const cell of aim.cells) {
          const k = hexKey(cell);
          exposure.set(k, (exposure.get(k) ?? 0) + p * expectedDamage(board, enemy, null));
        }
      }
    }
  }
  return exposure;
}

function cellsWithin(pos, range) {
  const out = [];
  for (let dq = -range; dq <= range; dq++) {
    for (let dr = -range; dr <= range; dr++) {
      if (hexDistance(pos, { q: pos.q + dq, r: pos.r + dr }) <= range) {
        out.push({ q: pos.q + dq, r: pos.r + dr });
      }
    }
  }
  return out;
}

function expectedDamage(board, attacker, target, simRng) {
  const min = board.balance?.minimumDamage ?? 1;
  const def = target
    ? (target.kind === 'headquarters' ? target.entity.defense : target.entity.defense ?? 0)
    : 0;
  if (simRng) {
    // 引擎口径：rollVariance = floor(rand × (2×range+1)) − range。
    const range = board.balance?.damageVarianceRange ?? 0;
    const roll = Math.floor(simRng() * (2 * range + 1)) - range;
    return Math.max(min, attacker.attack - def + roll);
  }
  return Math.max(min, attacker.attack - def);
}

function nearestTarget(pos, targets) {
  let best = null;
  let bestD = Infinity;
  for (const t of targets ?? []) {
    const d = hexDistance(pos, t);
    if (d < bestD) { bestD = d; best = t; }
  }
  return best;
}

/**
 * 从指定站位出发的攻击瞄准价值（timing=early 打当前站位为主，
 * late 打先验落点为主）。
 */
function strikeOptionValue(board, unit, from, target, aim, context, timing) {
  const { destPrior, occupants, enemyHq } = context;
  const nowW = timing === 'early' ? 0.6 : 0.35;
  const priorW = timing === 'early' ? 0.4 : 0.65;
  let value = 0;
  for (const cell of aim.cells) {
    const occ = occupants.get(hexKey(cell));
    if (occ && occ.kind === 'unit' && occ.entity.owner !== unit.owner) {
      const dmg = expectedDamage(board, unit, occ);
      value += nowW * dmg * (1 + (occ.entity.hp > 0 && dmg >= occ.entity.hp ? occ.entity.cost * 0.02 : 0));
    } else if (occ && occ.kind === 'headquarters' && occ.entity.owner !== unit.owner) {
      value += nowW * expectedDamage(board, unit, occ) * 2.2;
    }
    value += priorW * expectedDamage(board, unit, null) * (destPrior.get(hexKey(cell)) ?? 0);
    if (enemyHq && hexKey(enemyHq) === hexKey(cell)) value += 6;
  }
  return value;
}

/** 某单位在某站位的最佳瞄准（含价值）。 */
function bestStrikeFrom(board, unit, from, context, timing) {
  let best = null;
  let bestValue = -Infinity;
  for (const { target, aim } of enumerateAttackAimsFrom(board, unit, from)) {
    const value = strikeOptionValue(board, unit, from, target, aim, context, timing);
    if (value > bestValue) { bestValue = value; best = { target, aim, value }; }
  }
  return bestValue > 0 ? best : null;
}

/** 治疗组合：当前或先移动再治疗。 */
function supportCombo(board, unit, w, context, rng, slots) {
  const { occupants, planCtx } = context;
  const healSpec = board.unitsSpec[unit.type] ?? {};
  const healPower = (healSpec.healPower ?? 0) + (board.balance?.healVarianceRange ?? 0) / 2;
  if (healPower <= 0) return null;
  const healValue = option => {
    let v = 0;
    for (const cell of option.aim.cells) {
      const occ = occupants.get(hexKey(cell));
      if (!occ || occ.kind !== 'unit' || occ.entity.owner !== unit.owner) continue;
      const missing = occ.entity.maxHp - occ.entity.hp;
      if (missing > 0) v += Math.min(missing, healPower) * 0.5;
    }
    return v;
  };
  const nowAims = enumerateHealAimsFrom(board, unit, unit, occupants);
  let bestNow = null;
  let bestNowV = 0;
  for (const opt of nowAims) {
    const v = healValue(opt);
    if (v > bestNowV) { bestNowV = v; bestNow = opt; }
  }
  if (bestNowV > 0 && slots >= 1) {
    return { actions: [{ type: 'heal', owner: unit.owner, supportId: unit.id, q: bestNow.target.q, r: bestNow.target.r, direction: bestNow.aim.direction }], score: w.heal * bestNowV };
  }
  // 走向伤员再治疗（组合）。
  if (slots >= 2) {
    const wounded = board.units.filter(u => u.owner === unit.owner && u.hp < u.maxHp * 0.8);
    if (wounded.length) {
      const target = nearestTarget(unit, wounded);
      const reach = terrainReachable(board, unit, unit.moveRange, { terrain: new Map() })
        .filter(d => arrivalOk(board, occupants, d, planCtx, unit));
      let bestCell = null;
      let bestD = hexDistance(unit, target);
      for (const c of reach) {
        const d = hexDistance(c, target);
        if (d < bestD) { bestD = d; bestCell = c; }
      }
      if (bestCell) {
        const aimsAt = enumerateHealAimsFrom(board, unit, bestCell, occupants);
        let best = null;
        let bestV = 0;
        for (const opt of aimsAt) {
          const v = healValue(opt);
          if (v > bestV) { bestV = v; best = opt; }
        }
        if (bestV > 0) {
          return {
            actions: [
              { type: 'move', owner: unit.owner, unitId: unit.id, q: bestCell.q, r: bestCell.r },
              { type: 'heal', owner: unit.owner, supportId: unit.id, q: best.target.q, r: best.target.r, direction: best.aim.direction },
            ],
            score: w.heal * bestV * 0.9,
          };
        }
      }
    }
  }
  return null;
}

/**
 * 到达保守判定（生成器安全阀）：引擎允许同格冲突（全员失败）与依赖链，
 * 但**自己计划内部**的自冲突等于白送对手——生成期排除：
 *   1. 目的格已被本轮计划认领（任何步序的 move/deploy）；
 *   2. 目的格当前被占（除非占用者是我方更早排队移出的单位——其原格
 *      在我到达前已腾空，引擎依赖链允许）。
 * 敌方占用一律排除（跟车移动成功率低且失败会级联作废后续动作）。
 */
function arrivalOk(board, occupants, dest, planCtx, selfUnit) {
  const key = hexKey(dest);
  if (planCtx.plannedDest.has(key)) return false;
  const occ = occupants.get(key);
  if (!occ) return true;
  if (occ.kind !== 'unit') return false;
  if (occ.entity === selfUnit) return false;
  if (occ.entity.owner === selfUnit.owner) {
    return planCtx.freedOrigins.has(key);
  }
  return false; // 敌方占用：保守排除
}

/** 战斗单位组合：连击 / 先射后撤 / 抢点 / 齐射 / 原地开火。 */
function combatCombo(board, unit, w, context, rng, slots) {
  const { exposure, ownerTargets, destPrior, occupants, planCtx } = context;
  const noise = x => x * (1 + (rng() * 2 - 1) * ACTION_NOISE);
  const moveOptions = () => terrainReachable(board, unit, unit.moveRange, { terrain: new Map() })
    .filter(d => arrivalOk(board, occupants, d, planCtx, unit));
  const options = [];

  // E) 原地开火。
  const strikeNow = bestStrikeFrom(board, unit, unit, context, 'early');
  if (strikeNow) {
    options.push({
      actions: [{ type: 'attack', owner: unit.owner, attackerId: unit.id, q: strikeNow.target.q, r: strikeNow.target.r, direction: strikeNow.aim.direction }],
      score: w.fire * noise(strikeNow.value * 0.9),
    });
  }

  if (slots >= 2) {
    // B) 推进连击：先移动到打击位，再开火（打预测终位）。
    const reach = moveOptions();
    let bestAdvance = null;
    let bestAdvanceScore = -Infinity;
    for (const d of reach) {
      const strike = bestStrikeFrom(board, unit, d, context, 'late');
      if (!strike) continue;
      const exp = (exposure.get(hexKey(d)) ?? 0) * 0.12;
      const cpGain = unit.canCapture && ownerTargets.cpKeys?.has(hexKey(d)) ? w.cp * 14 : 0;
      const advanceGain = w.advance * 0.6;
      const s = w.combo * (strike.value * 1.25) + cpGain + advanceGain - w.safety * exp;
      if (s > bestAdvanceScore) { bestAdvanceScore = s; bestAdvance = { d, strike }; }
    }
    if (bestAdvance) {
      options.push({
        actions: [
          { type: 'move', owner: unit.owner, unitId: unit.id, q: bestAdvance.d.q, r: bestAdvance.d.r },
          { type: 'attack', owner: unit.owner, attackerId: unit.id, q: bestAdvance.strike.target.q, r: bestAdvance.strike.target.r, direction: bestAdvance.strike.aim.direction },
        ],
        score: noise(bestAdvanceScore),
      });
    }

    // C) 先射后撤：先手齐射当前站位，再位移到低暴露格。
    if (strikeNow) {
      let bestDisplace = null;
      let bestDExp = Infinity;
      for (const d of reach) {
        const exp = (exposure.get(hexKey(d)) ?? 0);
        if (exp < bestDExp) { bestDExp = exp; bestDisplace = d; }
      }
      if (bestDisplace) {
        options.push({
          actions: [
            { type: 'attack', owner: unit.owner, attackerId: unit.id, q: strikeNow.target.q, r: strikeNow.target.r, direction: strikeNow.aim.direction },
            { type: 'move', owner: unit.owner, unitId: unit.id, q: bestDisplace.q, r: bestDisplace.r },
          ],
          score: noise(w.fire * strikeNow.value * 0.85 + w.safety * 4 - w.safety * bestDExp * 0.12),
        });
      }
    }

    // D) 连续移动抢点 / 推进。
    if (unit.canCapture && ownerTargets.cp?.length) {
      const cp = nearestTarget(unit, ownerTargets.cp);
      if (cp && hexDistance(unit, cp) > unit.moveRange && hexDistance(unit, cp) <= unit.moveRange * 2) {
        // 两段移动落上据点：中转格选离据点最近的地形可达格。
        const reach1 = terrainReachable(board, unit, unit.moveRange, { terrain: new Map() });
        let mid = null;
        let midD = Infinity;
        for (const c of reach1) {
          if (hexDistance(c, cp) > unit.moveRange) continue;
          const d = hexDistance(c, cp);
          if (d < midD) { midD = d; mid = c; }
        }
        if (mid) {
          options.push({
            actions: [
              { type: 'move', owner: unit.owner, unitId: unit.id, q: mid.q, r: mid.r },
              { type: 'move', owner: unit.owner, unitId: unit.id, q: cp.q, r: cp.r },
            ],
            score: noise(w.cp * 18),
          });
        }
      }
    }
  }

  // A) 单移动：占点 / 推进 / 避险换位。
  {
    const reach = moveOptions();
    let bestMove = null;
    let bestMoveScore = -Infinity;
    for (const d of reach) {
      let s = 0;
      if (unit.canCapture && ownerTargets.cpKeys?.has(hexKey(d))) s += w.cp * 14;
      const cpT = nearestTarget(d, ownerTargets.cp ?? []);
      const cpNow = nearestTarget(unit, ownerTargets.cp ?? []);
      if (cpT && cpNow) s += w.cp * Math.max(0, hexDistance(unit, cpNow) - hexDistance(d, cpT)) * 4;
      if (ownerTargets.enemyHq) {
        s += w.advance * Math.max(0, hexDistance(unit, ownerTargets.enemyHq) - hexDistance(d, ownerTargets.enemyHq)) * 1.5;
      }
      s -= w.safety * (exposure.get(hexKey(d)) ?? 0) * 0.12;
      s -= 0.05;
      if (s > bestMoveScore) { bestMoveScore = s; bestMove = d; }
    }
    if (bestMove && bestMoveScore > 0.2) {
      options.push({
        actions: [{ type: 'move', owner: unit.owner, unitId: unit.id, q: bestMove.q, r: bestMove.r }],
        score: noise(bestMoveScore),
      });
    }
  }

  if (!options.length) return null;
  let best = null;
  let bestScore = -Infinity;
  for (const opt of options) {
    if (sScore(opt) > bestScore) { bestScore = sScore(opt); best = opt; }
  }
  return best;
  function sScore(opt) { return opt.score; }
}

/**
 * 生成一个完整组合计划。pattern ∈ 'advance' | 'strike' | 'free'。
 * 返回队列形态动作数组（步序 = 数组序）。
 */
function buildPlan(board, owner, weights, rng, seedQueue, pattern) {
  const queue = (seedQueue ?? []).map(a => ({ ...a, owner })).filter(a => a && a.type);
  const limit = board.balance?.actionsPerTurn ?? 5;
  const occupants = occupancyMap(board);
  const enemies = board.units.filter(u => u.owner !== owner);
  const destPrior = enemyDestPrior(board, enemies);
  const exposure = exposureMap(board, enemies, destPrior);
  const myUnits = board.units.filter(u => u.owner === owner);
  const enemyHq = Object.values(board.hqs).find(h => h.owner !== owner && h.alive) ?? null;
  const cpTargets = board.cps.filter(cp => cp.owner !== owner).map(cp => ({ q: cp.q, r: cp.r }));
  const planCtx = { plannedDest: new Set(), freedOrigins: new Set() };
  const context = {
    enemies, destPrior, exposure, occupants, planCtx,
    ownerTargets: {
      cp: cpTargets,
      cpKeys: new Set(cpTargets.map(hexKey)),
      enemyHq: enemyHq ? { q: enemyHq.q, r: enemyHq.r } : null,
    },
  };

  const combos = [];
  // 组合分配优先级（行动点是稀缺资源，让"位置价值最高"的单位先选）：
  // 占点型单位按距最近未占领据点的距离升序；战斗单位按火力价值降序。
  const unitPriority = u => {
    if (u.canCapture && cpTargets.length) {
      const t = nearestTarget(u, cpTargets);
      return 100 - hexDistance(u, t) * 4 + (u.attack ?? 0) * 0.1;
    }
    return (u.attack ?? 0) * 2 - hexDistance(u, enemyHq ?? u) * 0.5;
  };
  const orderedUnits = myUnits.slice().sort((a, b) => unitPriority(b) - unitPriority(a));
  for (const unit of orderedUnits) {
    if (queue.length >= limit) break;
    const slots = limit - queue.length - (combos.reduce((n, c) => n + c.actions.length, 0) || 0);
    if (slots <= 0) break;
    const combo = unit.type === 'support'
      ? supportCombo(board, unit, weights, context, rng, slots)
      : combatCombo(board, unit, weights, context, rng, slots);
    if (combo) {
      combos.push(combo);
      // 立即登记本组合的认领格/腾格，让后续单位的 reach 过滤看到。
      planCtx.freedOrigins.add(hexKey(unit));
      for (const action of combo.actions) {
        if (action.type === 'move' || action.type === 'deploy') {
          planCtx.plannedDest.add(hexKey(action));
        }
      }
    }
  }

  // 部署决策（人格加权）：部署总是第 1 步（新单位本轮不能行动，
  // 早部署早占格早吃收入）。
  const deployActions = [];
  const spent = projectQueue(board, queue, owner).deploySpend;
  const supplies = (board.supplies[owner] ?? 0) - spent;
  if (weights.deploy > 0.9 && queue.length + 1 < limit) {
    const origins = [];
    const ownHq = board.hqs[owner];
    if (ownHq && ownHq.alive && board.balance?.deployFromHq !== false) origins.push(ownHq);
    for (const cp of board.cps) {
      if (cp.owner === owner && (board.balance?.controlPointTypes ?? {})[cp.kind ?? 'supply']?.canDeploy !== false) {
        origins.push(cp);
      }
    }
    let bestDeploy = null;
    let bestDeployScore = -Infinity;
    for (const origin of origins) {
      const discount = Math.min(999, (board.balance?.controlPointTypes ?? {})[origin.kind ?? 'supply']?.deployDiscount ?? 0);
      for (const [typeName, spec] of Object.entries(board.unitsSpec)) {
        const cost = (spec?.cost ?? 999) - discount;
        if (cost > supplies) continue;
        for (const pos of neighborsOf(origin)) {
          if (!board.cells.has(hexKey(pos))) continue;
          if ((board.terrain.get(hexKey(pos)) ?? 'blocker') !== 'plain') continue;
          if (occupants.has(hexKey(pos))) continue;
          let s = weights.deploy * 2 + (spec.cost ?? 0) * 0.02;
          if (typeName === 'support') s += weights.heal * 3;
          if (typeName === 'ranger' || typeName === 'heavy') s += weights.fire * 1.5;
          const cpT = nearestTarget(pos, cpTargets);
          if (cpT) s += weights.cp * Math.max(0, 4 - hexDistance(pos, cpT)) * 0.8;
          s -= weights.safety * (exposure.get(hexKey(pos)) ?? 0) * 0.08;
          if (s > bestDeployScore) {
            bestDeployScore = s;
            bestDeploy = { type: 'deploy', owner, unitType: typeName, fromId: origin.id ?? `${owner}_hq`, q: pos.q, r: pos.r };
          }
        }
      }
    }
    if (bestDeploy && bestDeployScore > 2.5) deployActions.push(bestDeploy);
  }

  // 汇编：pattern 决定步序。
  const moves = [];
  const strikes = [];
  const ordered = [];
  for (const combo of combos) {
    for (const action of combo.actions) {
      (action.type === 'move' ? moves : strikes).push(action);
    }
  }
  const mode = pattern ?? (weights.combo > 1.6 ? 'strike' : 'advance');
  if (mode === 'advance') ordered.push(...deployActions, ...moves, ...strikes);
  else if (mode === 'strike') ordered.push(...deployActions, ...strikes, ...moves);
  else {
    // free：按组合原序交错。
    for (const combo of combos) ordered.push(...combo.actions);
    ordered.unshift(...deployActions);
  }

  // 拼接种子前缀 + 截断到行动点；逐动作结构性校验 + 自冲突过滤兜底。
  const out = queue.slice(0, limit);
  const finalClaim = new Set();
  const freed = new Set();
  for (const a of out) {
    if (a.type === 'move' || a.type === 'deploy') {
      finalClaim.add(hexKey(a));
      const unit = a.unitId ? board.units.find(u => u.id === a.unitId && u.owner === owner) : null;
      if (unit) freed.add(hexKey(unit));
    }
  }
  for (const action of ordered) {
    if (out.length >= limit) break;
    if (structuralCheck(board, owner, action, out)) continue; // 生成器 bug 兜底
    if (action.type === 'move' || action.type === 'deploy') {
      const key = hexKey(action);
      // 同计划内目的格互斥（引擎允许冲突，但自冲突=白送对手）。
      if (finalClaim.has(key)) continue;
      const occ = occupants.get(key);
      if (occ && !(action.type === 'move' && occ.kind === 'unit' && occ.entity.id === action.unitId)) {
        // 敌方占用 / 总部 / 未腾格的己方占用 → 排除。
        if (!(occ.kind === 'unit' && freed.has(key))) continue;
      }
      finalClaim.add(key);
      if (action.type === 'move' && action.unitId) {
        const unit = board.units.find(u => u.id === action.unitId && u.owner === owner);
        if (unit) freed.add(hexKey(unit));
      }
    }
    out.push(action);
  }
  return out;
}

// ---------------------------------------------------------------- 分步结算模拟器
// 镜像 3.8.0 src/engine/simultaneousResolve.ts 的「按行动点分步结算」：
//   队列第 k 条在所有玩家之间同时结算完，才进入第 k+1 条。每一步：
//   1. 级联预检：单位已亡/被淘汰 → 'unit_gone'；先前动作硬失败 →
//      'previous_action_failed'（作废后续）；
//   2. 到达求解（move+deploy 合并）：同格多到达全员失败、地形阻挡、
//      目的格被不动的单位/总部占用失败；被"本步正在移出的单位"占用
//      则形成依赖链（其移动失败 → 我的到达失败），迭代至稳定——
//      允许交换、链式腾格；
//   3. 拆除：heavy 从本步移动后站位相邻、目标格为 blocker 且为空；
//      地形立即变 plain（下一步的到达可用）；
//   4. wait：只占行动点；
//   5. 攻击/治疗（先治后扣伤，净 HP 等价同时）：攻击形状按攻击者
//      **本步结算后的实际站位**计算；锁定兵按计划时刻站位锁定目标，
//      未逃出射程必中；每单位攻击次数上限（含失败次数）；逐步死亡
//      （击杀入账在判死前，击杀归属确定）。
//   回合末：占点（站位改判归属）。
// 经济（收入/维修/翻盘补给/流量累计）不属于单轮结算，由裁判/支付层
// 另行处理（scoreOf 的 supplies 权重为 0，捕获激励由 payoffOf 的
// Δflow 项近似）。
// simRng 提供时伤害/治疗按引擎口径掷骰；否则用期望值（矩阵推演模式）。

function simulateRound(board, queuesByPlayer, simRng) {
  const sim = copyBoard(board);
  const order = sim.turnOrder
    .filter(id => sim.players[id] && sim.players[id].status === 'active' && queuesByPlayer.has(id));
  const queues = new Map(order.map(id => [id, (queuesByPlayer.get(id) ?? []).slice()]));
  const maxSteps = order.reduce((m, id) => Math.max(m, queues.get(id).length), 0);
  // 计划时刻站位（锁定射击依据，部署新单位不可被锁）。
  // 同时保留单位对象：锁定目标在后续行动点阵亡后仍是"存在过的计划时刻目标"，
  // 引擎会按 target_escaped 处理，而不是回退命中后来进入该格的单位。
  const planTimePos = new Map(sim.units.map(u => [u.id, { q: u.q, r: u.r }]));
  const planTimeUnits = new Map(sim.units.map(u => [u.id, u]));
  const failedUnits = new Set();
  const attackCounts = new Map();
  const attackLimit = sim.balance?.attacksPerUnit ?? 1;
  const outcomes = {};
  for (const id of sim.turnOrder) outcomes[id] = [];
  let steps = 0;

  const unitOf = (owner, id) => sim.units.find(u => u.id === id && u.owner === owner && u.alive);
  // 结果记录：与引擎 PlanOutcome 同形（unitId/q/r 顶层冗余一份，便于
  // 旧口径算法的事件史重建直接读取）。
  const record = (owner, action, status, reason, detail) => {
    const unitId = action.unitId ?? action.attackerId ?? action.supportId
      ?? detail?.unitId ?? undefined;
    outcomes[owner].push({
      type: action.type, status,
      ...(unitId ? { unitId } : {}),
      ...(action.q != null ? { q: action.q, r: action.r } : {}),
      ...(reason ? { reason } : {}),
      ...(detail ? { detail } : {}),
    });
  };

  for (let step = 1; step <= maxSteps; step++) {
    const activeCount = sim.turnOrder.filter(id => sim.players[id]?.status === 'active').length;
    if (activeCount <= 1) break;

    const items = [];
    for (const id of order) {
      const action = queues.get(id)[step - 1];
      if (action && sim.players[id]?.status === 'active') items.push({ owner: id, action });
    }
    if (!items.length) continue;
    steps = step;

    // 1. 级联预检。
    const kept = [];
    for (const item of items) {
      const a = item.action;
      if (a.type === 'wait') { record(item.owner, a, 'executed', null, {}); continue; }
      if (a.type === 'deploy') { kept.push(item); continue; }
      const unitId = a.unitId ?? a.attackerId ?? a.supportId;
      const unit = unitId ? unitOf(item.owner, unitId) : null;
      if (!unit) {
        record(item.owner, a, 'failed', 'unit_gone', { unitId });
        if (unitId) failedUnits.add(unitId);
        continue;
      }
      if (failedUnits.has(unitId)) {
        record(item.owner, a, 'failed', 'previous_action_failed', { unitId });
        continue;
      }
      kept.push(item);
    }

    // 2. 到达求解（move + deploy）。
    const occupants = new Map();
    for (const u of sim.units) if (u.alive) occupants.set(hexKey(u), { kind: 'unit', entity: u });
    for (const hq of Object.values(sim.hqs)) if (hq.alive) occupants.set(hexKey(hq), { kind: 'headquarters', entity: hq });

    const arrivals = [];
    for (const item of kept) {
      const a = item.action;
      if (a.type !== 'move' && a.type !== 'deploy') continue;
      const unit = a.type === 'move' ? unitOf(item.owner, a.unitId) : null;
      arrivals.push({ item, unit, key: hexKey(a), to: { q: a.q, r: a.r } });
    }
    const destCount = new Map();
    for (const arr of arrivals) destCount.set(arr.key, (destCount.get(arr.key) ?? 0) + 1);
    const failedArr = new Set();
    for (const arr of arrivals) {
      if (destCount.get(arr.key) > 1) { failedArr.add(arr); continue; }
      if (!sim.cells.has(arr.key)) { failedArr.add(arr); continue; }
      if ((sim.terrain.get(arr.key) ?? 'blocker') !== 'plain') { failedArr.add(arr); continue; }
      const occ = occupants.get(arr.key);
      if (occ && occ.kind === 'headquarters') { failedArr.add(arr); continue; }
      if (occ && occ.kind === 'unit') {
        const dep = arrivals.find(x => x.unit && x.unit.id === occ.entity.id && !failedArr.has(x));
        if (!dep) failedArr.add(arr); // 占用者本步不动 → 失败
      }
    }
    // 依赖链迭代至稳定（占用者本步移动失败 → 我的到达也失败）。
    let changed = true;
    while (changed) {
      changed = false;
      for (const arr of arrivals) {
        if (failedArr.has(arr)) continue;
        const occ = occupants.get(arr.key);
        if (!occ || occ.kind !== 'unit') continue;
        const dep = arrivals.find(x => x.unit && x.unit.id === occ.entity.id);
        if (dep && failedArr.has(dep)) { failedArr.add(arr); changed = true; }
      }
    }

    // 部署（先于移动应用：引擎 resolveDeploys 在 resolveMoves 之前）。
    for (const arr of arrivals) {
      const a = arr.item.action;
      if (a.type !== 'deploy') continue;
      if (failedArr.has(arr)) {
        record(arr.item.owner, a, 'failed', 'destination_conflict_or_blocked',
          { unitType: a.unitType, fromId: a.fromId, q: a.q, r: a.r });
        continue;
      }
      const spec = sim.unitsSpec[a.unitType];
      if (!spec) { record(arr.item.owner, a, 'failed', 'unknown_unit'); continue; }
      const origin = boardDeployOrigin(sim, arr.item.owner, a.fromId);
      const discount = origin ? Math.min(spec.cost, deployDiscountFor(sim, arr.item.owner, origin)) : 0;
      const cost = spec.cost - discount;
      if ((sim.supplies[arr.item.owner] ?? 0) < cost) {
        record(arr.item.owner, a, 'failed', 'insufficient_supplies', { unitType: a.unitType, fromId: a.fromId, q: a.q, r: a.r });
        continue;
      }
      sim.supplies[arr.item.owner] -= cost;
      const unit = {
        id: `${a.unitType}:${a.q},${a.r}:sim`, owner: arr.item.owner, type: a.unitType,
        q: a.q, r: a.r, hp: spec.hp, maxHp: spec.hp,
        attack: spec.attack, defense: spec.defense,
        moveRange: spec.moveRange, attackRange: spec.attackRange,
        canCapture: spec.canCapture ?? false, attackLock: spec.attackLock ?? false,
        healPower: spec.healPower ?? 0, cost: spec.cost, alive: true,
      };
      sim.units.push(unit);
      occupants.set(hexKey(unit), { kind: 'unit', entity: unit });
      // 不写入 planTimePos：计划时刻尚不存在的单位不可被锁定射击（与引擎一致）。
      record(arr.item.owner, a, 'executed', null,
        { unitId: unit.id, cost, unitType: a.unitType, fromId: a.fromId, q: a.q, r: a.r });
    }

    // 移动。
    for (const arr of arrivals) {
      const a = arr.item.action;
      if (a.type !== 'move') continue;
      if (failedArr.has(arr)) {
        record(arr.item.owner, a, 'failed', 'destination_conflict_or_blocked',
          { unitId: a.unitId, fromQ: arr.unit?.q, fromR: arr.unit?.r, toQ: a.q, toR: a.r });
        if (a.unitId) failedUnits.add(a.unitId);
        continue;
      }
      const unit = arr.unit;
      if (!unit) continue; // 预检已记 unit_gone
      const fromQ = unit.q, fromR = unit.r;
      // 先校验占用表归属再删除：两个同格单位互换时，第一个 mover 先写入了
      // 目的格，第二个 mover 若无条件 delete(hexKey(self)) 会把对方刚写入的
      // 条目当成自己的抹掉（对方从占用表消失，本步后续攻击判定漏目标）。
      if (occupants.get(hexKey(unit))?.entity === unit) occupants.delete(hexKey(unit));
      unit.q = a.q; unit.r = a.r;
      occupants.set(hexKey(unit), { kind: 'unit', entity: unit });
      record(arr.item.owner, a, 'executed', null, { unitId: a.unitId, fromQ, fromR, toQ: a.q, toR: a.r });
    }

    // 3. 拆除（本步移动后站位；地形立即生效）。
    const clearedThisStep = new Set();
    for (const item of kept) {
      const a = item.action;
      if (a.type !== 'demolish') continue;
      const unit = unitOf(item.owner, a.unitId);
      if (!unit || unit.type !== 'heavy') { record(item.owner, a, 'failed', 'unit_not_found'); continue; }
      const key = hexKey(a);
      if (!sim.cells.has(key) || (sim.terrain.get(key) ?? 'blocker') !== 'blocker'
        || hexDistance(unit, a) > 1 || occupants.has(key) || clearedThisStep.has(key)) {
        record(item.owner, a, 'failed', 'invalid_target', { q: a.q, r: a.r });
        failedUnits.add(a.unitId);
        continue;
      }
      sim.terrain.set(key, 'plain');
      clearedThisStep.add(key);
      record(item.owner, a, 'executed', null, { q: a.q, r: a.r });
    }

    // 4. 治疗（先治后扣伤；站位 = 本步移动后）。
    for (const item of kept) {
      const a = item.action;
      if (a.type !== 'heal') continue;
      const support = unitOf(item.owner, a.supportId);
      if (!support) { record(item.owner, a, 'failed', 'unit_gone', { supportId: a.supportId }); failedUnits.add(a.supportId); continue; }
      const spec = sim.unitsSpec[support.type] ?? {};
      const shape = shapeSpecFor(spec, 'healShape');
      const healRange = spec.healRange ?? support.attackRange ?? 1;
      const aim = computeCoveredCells(support, shape, 'healShape', a, healRange);
      if (!aim) { record(item.owner, a, 'failed', 'out_of_range', { q: a.q, r: a.r }); failedUnits.add(a.supportId); continue; }
      const base = support.healPower || spec.healPower || 0;
      const varianceRange = sim.balance?.healVarianceRange ?? 0;
      let applied = false;
      for (const cell of aim.cells) {
        const occ = occupants.get(hexKey(cell));
        if (!occ || occ.kind !== 'unit' || occ.entity.owner !== item.owner) continue;
        const u = occ.entity;
        if (u.hp >= u.maxHp) continue;
        const amount = simRng
          ? base + Math.floor(simRng() * (varianceRange + 1))
          : base + varianceRange / 2;
        u.hp = Math.min(u.maxHp, u.hp + amount);
        applied = true;
      }
      record(item.owner, a, applied ? 'executed' : 'fizzled', applied ? null : 'no_wounded_target', { q: a.q, r: a.r });
    }

    // 5. 攻击（按 turnOrder 顺序施加伤害；死亡推迟到本步末）。
    const deadThisStep = new Set();
    const hqDestroyed = new Set();
    for (const id of order) {
      for (const item of kept) {
        if (item.owner !== id || item.action.type !== 'attack') continue;
        const a = item.action;
        const attacker = unitOf(id, a.attackerId);
        if (!attacker) { record(id, a, 'failed', 'unit_gone', { attackerId: a.attackerId }); failedUnits.add(a.attackerId); continue; }
        if ((attackCounts.get(attacker.id) ?? 0) >= attackLimit) {
          record(id, a, 'failed', 'attack_limit_reached', { attackerId: a.attackerId });
          failedUnits.add(a.attackerId);
          continue;
        }
        attackCounts.set(attacker.id, (attackCounts.get(attacker.id) ?? 0) + 1);
        const spec = sim.unitsSpec[attacker.type] ?? {};
        const shape = shapeSpecFor(spec, 'attackShape');
        const aim = computeCoveredCells(attacker, shape, 'attackShape', a, attacker.attackRange);
        if (!aim) { record(id, a, 'failed', 'out_of_range', { attackerId: a.attackerId, q: a.q, r: a.r }); failedUnits.add(a.attackerId); continue; }

        const targets = [];
        // 锁定兵种只有在计划时刻点击格上确实有敌军时才进入锁定分支；
        // 否则引擎会回退到普通形状覆盖（见 simultaneouslyResolve.ts 的
        // strike.lockedEntity 分支），预测射击仍可能命中的是本步移动进来的单位。
        let locked = null;
        if (spec.attackLock) {
          for (const u of planTimeUnits.values()) {
            if (u.owner === id) continue;
            const pt = planTimePos.get(u.id);
            if (pt && pt.q === a.q && pt.r === a.r) {
              locked = u;
              break;
            }
          }
        }
        if (locked) {
          // 锁定：计划时刻站在瞄准格上的敌军；结算时未逃出射程必中。
          if (locked.alive && hexDistance(attacker, locked) <= attacker.attackRange) {
            targets.push({ kind: 'unit', entity: locked });
          }
          if (!targets.length) { record(id, a, 'missed', 'target_escaped', { attackerId: a.attackerId, q: a.q, r: a.r }); continue; }
        } else {
          for (const cell of aim.cells) {
            const occ = occupants.get(hexKey(cell));
            if (!occ) continue;
            if (occ.kind === 'unit' && (occ.entity.owner === id || occ.entity.hp <= 0)) continue;
            if (occ.kind === 'headquarters' && (occ.entity.owner === id || !occ.entity.alive)) continue;
            targets.push(occ);
          }
          if (!targets.length) { record(id, a, 'missed', null, { attackerId: a.attackerId, q: a.q, r: a.r }); continue; }
        }

        let hitAny = false;
        for (const target of targets) {
          const entity = target.entity;
          const dmg = expectedDamage(sim, attacker, target, simRng);
          // 引擎口径：入账伤害按实际扣血量截断（Math.min(entity.hp, dmg)），
          // 总部残血被补刀时不得超额计入 headquartersDamage。
          const actual = Math.min(entity.hp, dmg);
          entity.hp = Math.max(0, entity.hp - dmg);
          hitAny = true;
          if (target.kind === 'headquarters') {
            if (id !== entity.owner) {
              const stats = sim.players[id]?.stats;
              if (stats) stats.headquartersDamage += actual;
            }
            if (entity.hp <= 0 && entity.alive) {
              entity.alive = false;
              hqDestroyed.add(entity.owner);
            }
          } else if (entity.hp <= 0 && !deadThisStep.has(entity.id)) {
            deadThisStep.add(entity.id);
            const stats = sim.players[id]?.stats;
            if (stats) stats.killValue += entity.cost ?? 0;
          }
        }
        record(id, a, hitAny ? 'executed' : 'missed', null, { attackerId: a.attackerId, q: a.q, r: a.r });
      }
    }

    // 本步末死亡与淘汰。
    for (const unit of sim.units) {
      if (unit.alive && unit.hp <= 0) {
        unit.alive = false;
        occupants.delete(hexKey(unit));
      }
    }
    sim.units = sim.units.filter(u => u.alive);
    for (const owner of hqDestroyed) {
      const player = sim.players[owner];
      if (player) player.status = 'eliminated';
      sim.units = sim.units.filter(u => u.owner !== owner);
      for (const cp of sim.cps) if (cp.owner === owner) cp.owner = null;
    }
  }

  // 回合末：占点。
  const finalOcc = new Map();
  for (const u of sim.units) finalOcc.set(hexKey(u), u);
  for (const cp of sim.cps) {
    const occ = finalOcc.get(hexKey(cp));
    if (occ && occ.canCapture && sim.players[occ.owner]?.status === 'active') {
      cp.owner = occ.owner;
    }
  }

  return { board: sim, outcomes, steps };
}

// ---------------------------------------------------------------- 支付评估
// 镜像 src/engine/engine.ts scorePlayer 的裁定权重口径，计算「本轮结算
// 前后每位玩家的分数增量」；payoff = 我方增量 − 敌方（2 人）或 − 最大
// 对手（3+ 人），摧毁总部按终局级奖励计。

function scoreOf(board, owner) {
  const weights = board.balance?.adjudicationWeights ?? {};
  const wEnemyHq = weights.enemyHqDamage ?? 0;
  const wOwnHq = weights.ownHqHp ?? 0;
  const wCp = weights.controlPoint ?? 0;
  const wArmy = weights.armyValue ?? 0;
  const wSupplies = weights.supplies ?? 0;
  const wKill = weights.killValue ?? 0;
  const flowRatio = weights.controlPointFlowRatio ?? 0.7;
  const player = board.players[owner];
  if (!player) return 0;
  const stats = player.stats;
  const hq = board.hqs[owner];
  const ownHqHp = hq && hq.alive ? Math.max(0, hq.hp) : 0;
  const cps = board.cps.filter(cp => cp.owner === owner).length;
  const army = board.units
    .filter(u => u.owner === owner)
    .reduce((sum, u) => sum + Math.round(u.cost * (Math.max(0, u.hp) / u.maxHp)), 0);
  const holdRounds = Math.max(1, stats.controlHoldRounds);
  const controlHold = stats.controlHold / holdRounds;
  const controlScore = wCp * (flowRatio * controlHold + (1 - flowRatio) * cps);
  return wEnemyHq * stats.headquartersDamage
    + wOwnHq * ownHqHp
    + controlScore
    + wArmy * army
    + wSupplies * (board.supplies[owner] ?? 0)
    + wKill * stats.killValue;
}

function payoffOf(preBoard, postBoard, me, enemies) {
  let pay = scoreOf(postBoard, me) - scoreOf(preBoard, me);
  let worstEnemy = -Infinity;
  for (const enemy of enemies) {
    const delta = scoreOf(postBoard, enemy) - scoreOf(preBoard, enemy);
    if (delta > worstEnemy) worstEnemy = delta;
  }
  if (Number.isFinite(worstEnemy)) pay -= worstEnemy;
  // 捕获流价值近似：占点在裁定分里以「点数」计，但真实局里据点每回合
  // 都在累积流量分（0.7 权重的主导项）；单轮模拟不滚动流量，这里把
  // 本轮新增据点按一回合流量现值补进支付（与 v1 结算器内置口径同强度）。
  {
    const weights = preBoard.balance?.adjudicationWeights ?? {};
    const wCp = weights.controlPoint ?? 0;
    const flowRatio = weights.controlPointFlowRatio ?? 0.7;
    const cpsOf = b => b.cps.filter(cp => cp.owner === me).length;
    pay += wCp * flowRatio * (cpsOf(postBoard) - cpsOf(preBoard));
  }
  // 总部摧毁：终局级奖励。
  for (const enemy of enemies) {
    const hq = postBoard.hqs[enemy];
    if (preBoard.hqs[enemy] && (!hq || !hq.alive)) pay += HQ_WIN_BONUS;
  }
  const myHq = postBoard.hqs[me];
  if (preBoard.hqs[me] && (!myHq || !myHq.alive)) pay -= HQ_WIN_BONUS;
  return pay;
}

// ---------------------------------------------------------------- 事件史重建
// 3.8.0 的 round_resolved 结果带 step 序号与完整 detail（failed 移动含
// from/to、executed deploy 事件含 fromId/q/r/unitType）。按步序重建敌方
// 上一轮的真实整轮计划（含同一单位的「先移后攻」组合），作为对手组合
// 池的实证场景（fictitious play 味道）。dest-prob 完全不看事件史。

function reconstructEnemyPlans(game, me) {
  const plans = [];
  const events = game.events ?? [];
  for (let i = events.length - 1; i >= 0 && plans.length < MAX_EMPIRICAL_PLANS; i--) {
    const ev = events[i];
    if (!ev || ev.type !== 'round_resolved') continue;
    const results = ev.results ?? {};
    for (const [owner, outcomes] of Object.entries(results)) {
      if (owner === me) continue;
      if (!Array.isArray(outcomes) || !outcomes.length) continue;
      // 先按 step 排序再重建（结果数组本身按结算序，但步序才是队列序）。
      const sorted = outcomes
        .map((o, idx) => ({ o, idx }))
        .sort((a, b) => (a.o.step ?? a.idx) - (b.o.step ?? b.idx))
        .map(x => x.o);
      const plan = [];
      for (const outcome of sorted) {
        if (!outcome || !outcome.type) continue;
        if (outcome.type === 'attack') {
          const d = outcome.detail ?? {};
          const attackerId = d.attackerId ?? outcome.unitId;
          if (attackerId && d.q != null && d.r != null) {
            plan.push({ type: 'attack', owner, attackerId, q: d.q, r: d.r });
          }
        } else if (outcome.type === 'move') {
          const d = outcome.detail ?? {};
          const toQ = d.toQ ?? outcome.q, toR = d.toR ?? outcome.r;
          if (outcome.unitId && toQ != null && toR != null) {
            plan.push({ type: 'move', owner, unitId: outcome.unitId, q: toQ, r: toR });
          } else if (d.fromQ != null && d.fromR != null && toQ != null && toR != null) {
            const unit = (game.units ?? []).find(u =>
              u.alive !== false && u.q === toQ && u.r === toR && u.owner === owner);
            if (unit) plan.push({ type: 'move', owner, unitId: unit.id, q: toQ, r: toR });
          }
        } else if (outcome.type === 'deploy') {
          const d = outcome.detail ?? {};
          const fromId = d.fromId;
          const q = d.q ?? outcome.q, r = d.r ?? outcome.r;
          if (d.unitType && q != null && r != null) {
            plan.push({ type: 'deploy', owner, unitType: d.unitType, fromId, q, r });
          }
        } else if (outcome.type === 'heal') {
          const d = outcome.detail ?? {};
          const supportId = d.supportId ?? outcome.unitId;
          if (supportId && d.q != null && d.r != null) {
            plan.push({ type: 'heal', owner, supportId, q: d.q, r: d.r });
          }
        } else if (outcome.type === 'demolish') {
          const d = outcome.detail ?? {};
          if (outcome.unitId && d.q != null && d.r != null) {
            plan.push({ type: 'demolish', owner, unitId: outcome.unitId, q: d.q, r: d.r });
          }
        }
      }
      if (plan.length) plans.push({ owner, plan, round: ev.roundNumber });
    }
  }
  return plans;
}

// ---------------------------------------------------------------- 矩阵求解

/**
 * 2 人零和博弈的 CFR 自我对弈：双方各维护累计后悔，迭代产出平均策略。
 * payoff[i][j] = 我方纯策略 i 对敌方纯策略 j 的支付（敌方取负）。
 * 返回 { myMix, enemyMix }（归一化概率向量）。
 */
function solveTwoPlayer(payoff, iterations) {
  const K = payoff.length;
  const J = payoff[0]?.length ?? 0;
  if (!K || !J) return { myMix: [1], enemyMix: [1] };
  const regretI = new Float64Array(K);
  const regretJ = new Float64Array(J);
  const sumI = new Float64Array(K);
  const sumJ = new Float64Array(J);
  const mixI = new Float64Array(K);
  const mixJ = new Float64Array(J);
  const uI = new Float64Array(K);
  const uJ = new Float64Array(J);
  for (let t = 0; t < iterations; t++) {
    normalizeInto(mixI, regretI);
    normalizeInto(mixJ, regretJ);
    for (let i = 0; i < K; i++) sumI[i] += mixI[i];
    for (let j = 0; j < J; j++) sumJ[j] += mixJ[j];
    // 我方对当前敌方策略的期望支付。
    for (let i = 0; i < K; i++) {
      let v = 0;
      for (let j = 0; j < J; j++) v += mixJ[j] * payoff[i][j];
      uI[i] = v;
    }
    const vI = dot(mixI, uI);
    for (let i = 0; i < K; i++) regretI[i] += uI[i] - vI;
    // 敌方视角（零和取负）。
    for (let j = 0; j < J; j++) {
      let v = 0;
      for (let i = 0; i < K; i++) v -= mixI[i] * payoff[i][j];
      uJ[j] = v;
    }
    const vJ = dot(mixJ, uJ);
    for (let j = 0; j < J; j++) regretJ[j] += uJ[j] - vJ;
  }
  return { myMix: normalized(sumI), enemyMix: normalized(sumJ) };
}

/** 多人：对固定场景分布做我方单侧后悔匹配，返回平均策略。 */
function solveAgainstScenarios(payoff, scenarioWeights, iterations) {
  const K = payoff.length;
  const J = payoff[0]?.length ?? 0;
  if (!K || !J) return [1];
  const regret = new Float64Array(K);
  const sum = new Float64Array(K);
  const mix = new Float64Array(K);
  const u = new Float64Array(K);
  for (let t = 0; t < iterations; t++) {
    normalizeInto(mix, regret);
    for (let i = 0; i < K; i++) sum[i] += mix[i];
    for (let i = 0; i < K; i++) {
      let v = 0;
      for (let j = 0; j < J; j++) v += scenarioWeights[j] * payoff[i][j];
      u[i] = v;
    }
    const v = dot(mix, u);
    for (let i = 0; i < K; i++) regret[i] += u[i] - v;
  }
  return normalized(sum);
}

function normalizeInto(out, regrets) {
  let total = 0;
  for (let i = 0; i < regrets.length; i++) {
    out[i] = Math.max(0, regrets[i]);
    total += out[i];
  }
  if (total <= 0) {
    out.fill(1 / regrets.length);
    return out;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function normalized(arr) {
  let total = 0;
  for (const v of arr) total += v;
  if (total <= 0) {
    const out = new Float64Array(arr.length);
    out.fill(1 / Math.max(1, arr.length));
    return Array.from(out);
  }
  return Array.from(arr, v => v / total);
}

function sampleIndex(mix, rng) {
  let roll = rng();
  for (let i = 0; i < mix.length; i++) {
    roll -= mix[i];
    if (roll <= 0) return i;
  }
  return mix.length - 1;
}

// ---------------------------------------------------------------- 决策入口

const planCache = new Map(); // key: gameId:owner → 本轮已求解计划

function cacheKey(game, owner) {
  return `${game.id ?? 'anon'}:${owner}`;
}

function actionFingerprint(action) {
  const unit = action.unitId ?? action.attackerId ?? action.supportId ?? '';
  const extra = action.type === 'deploy' ? `|${action.unitType ?? ''}|${action.fromId ?? ''}` : '';
  return `${action.type}|${unit}|${action.q ?? 'x'},${action.r ?? 'x'}${extra}`;
}

/** 决定本轮使用的完整计划（矩阵均衡主流程）。 */
function solveRound(game, owner, utils) {
  const board = cloneBoard(game);
  const enemies = (game.turn?.turnOrder ?? Object.keys(game.players ?? {}))
    .filter(id => id !== owner && game.players?.[id]?.status === 'active');
  const roundNumber = game.turn?.roundNumber ?? game.turn?.turnNumber ?? 1;
  const rng = mulberry32(hashSeed(`${game.id ?? 'anon'}:${owner}:${roundNumber}`));

  // 我方候选计划：人格 + 随机权重（从当前已有队列续建）。
  const seedQueue = (game.plan?.myQueue ?? game.plan?.queues?.[owner] ?? [])
    .map(a => ({ ...a }));
  const myPlans = [];
  for (const persona of PERSONAS) {
    myPlans.push(buildPlan(board, owner, persona.w, rng, seedQueue));
  }
  const randomCount = Math.max(1, MY_PORTFOLIO_SIZE - PERSONAS.length);
  for (let i = 0; i < randomCount; i++) {
    myPlans.push(buildPlan(board, owner, personaWeights(rng), rng, seedQueue));
  }
  // 去重：完全相同的计划只留一份（贪心扰动小的时候会出现）。
  const seenPlan = new Set();
  const myPortfolio = myPlans.filter(p => {
    const key = p.map(actionFingerprint).join(';');
    if (!p.length || seenPlan.has(key)) return false;
    seenPlan.add(key);
    return true;
  });
  if (!myPortfolio.length) return { plan: seedQueue, alternatives: [] };

  // 敌方候选计划：同生成器镜像到敌方座位。
  const enemyPortfolios = new Map(); // enemyId → { persona: [...], empirical: [...] }
  const empirical = reconstructEnemyPlans(game, owner);
  for (const enemy of enemies) {
    const personaPlans = [];
    for (const persona of PERSONAS.slice(0, ENEMY_PORTFOLIO_SIZE > 6 ? 6 : ENEMY_PORTFOLIO_SIZE)) {
      personaPlans.push(buildPlan(board, enemy, persona.w, rng, []));
    }
    const randomN = Math.max(0, ENEMY_PORTFOLIO_SIZE - personaPlans.length);
    for (let i = 0; i < randomN; i++) {
      personaPlans.push(buildPlan(board, enemy, personaWeights(rng), rng, []));
    }
    // 实证计划：按敌方席位当前棋盘做结构性过滤（陈旧单位/非法落点剔除），
    // 保留合法前缀——历史计划的位置可能已变，逐动作校验防止"幻觉对手"。
    const empiricalPlans = empirical
      .filter(e => e.owner === enemy)
      .slice(0, MAX_EMPIRICAL_PLANS)
      .map(e => e.plan)
      .map(plan => {
        const out = [];
        for (const action of plan) {
          if (out.length >= (board.balance?.actionsPerTurn ?? 5)) break;
          if (structuralCheck(board, enemy, action, out)) continue;
          out.push(action);
        }
        return out;
      })
      .filter(plan => plan.length > 0);
    enemyPortfolios.set(enemy, { persona: personaPlans, empirical: empiricalPlans });
  }

  // 场景 = 各敌方座位一个计划的联合。
  const scenarios = [];   // [{ planByEnemy: Map, empirical: boolean }]
  if (enemies.length === 1) {
    const enemy = enemies[0];
    const portfolio = enemyPortfolios.get(enemy);
    for (const plan of portfolio.persona) {
      scenarios.push({ planByEnemy: new Map([[enemy, plan]]), empirical: false });
    }
    for (const plan of portfolio.empirical) {
      scenarios.push({ planByEnemy: new Map([[enemy, plan]]), empirical: true });
    }
  } else {
    // 3+ 人：按「每席位等抽」生成联合场景（先验为均匀）。
    const personaScenarios = [];
    for (let s = 0; s < MULTI_SCENARIOS; s++) {
      const planByEnemy = new Map();
      for (const enemy of enemies) {
        const portfolio = enemyPortfolios.get(enemy);
        const plans = portfolio.persona;
        planByEnemy.set(enemy, plans[Math.floor(rng() * plans.length) % plans.length]);
      }
      personaScenarios.push({ planByEnemy, empirical: false });
    }
    scenarios.push(...personaScenarios);
    // 实证联合：每席位取一份实证计划（若都有）。
    const allEmpirical = enemies.every(e => (enemyPortfolios.get(e)?.empirical ?? []).length > 0);
    if (allEmpirical) {
      const planByEnemy = new Map();
      for (const enemy of enemies) {
        planByEnemy.set(enemy, enemyPortfolios.get(enemy).empirical[0]);
      }
      scenarios.push({ planByEnemy, empirical: true });
    }
  }
  if (!scenarios.length) {
    return { plan: myPortfolio[0], alternatives: myPortfolio };
  }

  // 支付矩阵：myPortfolio × scenarios（分步结算模拟；软时限内截断）。
  const t0 = Date.now();
  const payoff = [];
  const keptPortfolio = [];
  for (const myPlan of myPortfolio) {
    const row = scenarios.map(scenario => {
      const queues = new Map();
      queues.set(owner, myPlan);
      for (const [enemy, plan] of scenario.planByEnemy) queues.set(enemy, plan);
      const { board: post } = simulateRound(board, queues);
      return payoffOf(board, post, owner, enemies);
    });
    payoff.push(row);
    keptPortfolio.push(myPlan);
    if (Date.now() - t0 > SOLVE_TIME_BUDGET_MS && keptPortfolio.length >= 6) break;
  }
  const solvedPortfolio = keptPortfolio;

  // 求解 + 采样。
  let myMix;
  const personaScenarioCount = scenarios.filter(s => !s.empirical).length;
  if (enemies.length === 1 && personaScenarioCount > 0) {
    // 2 人局：人格场景子矩阵做 CFR 自我对弈（实证列不进对手策略集，
    // 走下面的自适应利用混合）。
    const personaPayoff = payoff.map(row => row.slice(0, personaScenarioCount));
    const { myMix: eqMix } = solveTwoPlayer(personaPayoff, CFR_ITERATIONS);
    // 自适应利用混合：γ = min(γmax, step × 实证轮数)，证据越足越敢剥削
    // 确定性对手（v1 固定 ε=0.15 对 kriegspiel 类对手偏保守）。
    myMix = eqMix.slice();
    const empiricalCount = scenarios.length - personaScenarioCount;
    if (empiricalCount > 0) {
      const empiricalPayoff = payoff.map(row => row.slice(personaScenarioCount));
      const bestIdx = argmaxRowSum(empiricalPayoff);
      if (bestIdx >= 0) {
        const empiricalRounds = new Set(
          empirical.filter(e => e.round != null).map(e => e.round)).size
          || empiricalCount;
        const gamma = Math.min(EXPLOIT_GAMMA_MAX, EXPLOIT_GAMMA_STEP * empiricalRounds);
        for (let i = 0; i < myMix.length; i++) myMix[i] *= (1 - gamma);
        myMix[bestIdx] += gamma;
      }
    }
  } else {
    // 多人或无实证：对场景分布（人格均匀 + 实证加倍）单侧后悔匹配。
    const weights = scenarios.map(s => s.empirical ? 2.0 : 1.0);
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    const normWeights = weights.map(w => w / total);
    myMix = solveAgainstScenarios(payoff, normWeights, CFR_ITERATIONS);
  }

  let chosen = solvedPortfolio[sampleIndex(myMix, rng)];

  // 池内精修：对被选中执行的计划做有界爬山变异（换瞄准/换落点/调步序/
  // 删动作），对场景分布评估，严格更优才接受。v1 归因显示「一次性贪心
  // 构造无精修」是对 kriegspiel 落后的主因——这里补上（时限内）。
  chosen = refinePlan(board, owner, chosen, scenarios, enemies, t0);

  return { plan: chosen, alternatives: solvedPortfolio, mix: myMix };
}

/** 对执行计划做有界变异爬山；返回改进版或原计划。 */
function refinePlan(board, owner, plan, scenarios, enemies, t0) {
  if (!plan || !plan.length || Date.now() - t0 > REFINE_TIME_BUDGET_MS) return plan;
  const evalScenarios = scenarios.slice(0, REFINE_SCENARIOS);
  if (!evalScenarios.length) return plan;
  const evalPlan = candidate => {
    let total = 0;
    for (const scenario of evalScenarios) {
      const queues = new Map();
      queues.set(owner, candidate);
      for (const [enemy, eplan] of scenario.planByEnemy) queues.set(enemy, eplan);
      const { board: post } = simulateRound(board, queues);
      total += payoffOf(board, post, owner, enemies);
    }
    return total / evalScenarios.length;
  };
  const currentScore = evalPlan(plan);

  const mutants = [];
  const projection = projectQueue(board, plan, owner);
  // 1) 换瞄准：每个攻击动作换成同起点的次优瞄准（预测价值排序取第 2）。
  for (let i = 0; i < plan.length; i++) {
    const a = plan[i];
    if (a.type !== 'attack') continue;
    const unit = board.units.find(u => u.id === a.attackerId && u.owner === owner);
    if (!unit) continue;
    const from = projection.positions.get(unit.id) ?? unit;
    const context = {
      destPrior: enemyDestPrior(board, board.units.filter(u => u.owner !== owner)),
      occupants: occupancyMap(board),
      enemyHq: Object.values(board.hqs).find(h => h.owner !== owner && h.alive) ?? null,
    };
    const opts = enumerateAttackAimsFrom(board, unit, from)
      .map(opt => ({ opt, v: strikeOptionValue(board, unit, from, opt.target, opt.aim, context, 'late') }))
      .sort((a, b) => b.v - a.v);
    if (opts.length >= 2) {
      const alt = opts[1].opt;
      const mutant = plan.slice();
      mutant[i] = { ...a, q: alt.target.q, r: alt.target.r, direction: alt.aim.direction };
      mutants.push(mutant);
    }
    if (mutants.length >= REFINE_MUTANTS / 2) break;
  }
  // 2) 调步序：交换相邻的不同类型动作（改变开火/移动的相对时序）。
  for (let i = 0; i + 1 < plan.length && mutants.length < REFINE_MUTANTS - 2; i++) {
    if (plan[i].type === plan[i + 1].type) continue;
    const mutant = plan.slice();
    mutant[i] = plan[i + 1];
    mutant[i + 1] = plan[i];
    mutants.push(mutant);
  }
  // 3) 删末位动作（腾出行动点避免浪费在低价值动作上）。
  if (plan.length > 1) mutants.push(plan.slice(0, -1));

  let best = plan;
  let bestScore = currentScore;
  for (const mutant of mutants) {
    if (Date.now() - t0 > REFINE_TIME_BUDGET_MS) break;
    // 结构合法性：逐动作以前缀校验。
    let legal = true;
    for (let i = 0; i < mutant.length; i++) {
      if (structuralCheck(board, owner, mutant[i], mutant.slice(0, i))) { legal = false; break; }
    }
    if (!legal) continue;
    const score = evalPlan(mutant);
    if (score > bestScore) { bestScore = score; best = mutant; }
  }
  return best;
}

function argmaxRowSum(matrix) {
  let best = -1;
  let bestSum = -Infinity;
  for (let i = 0; i < matrix.length; i++) {
    let sum = 0;
    for (const v of matrix[i]) sum += v;
    if (sum > bestSum) { bestSum = sum; best = i; }
  }
  return best;
}

function decideImpl(game, utils, ctx) {
  const owner = ctx?.owner;
  if (!owner || !game?.plan) return null;
  if ((game.plan.committed ?? []).includes(owner)) return null;
  const limit = game.config?.balance?.actionsPerTurn ?? 5;
  const queue = game.plan.myQueue ?? game.plan.queues?.[owner] ?? [];
  if (queue.length >= limit) return null;

  const roundNumber = game.turn?.roundNumber ?? game.turn?.turnNumber ?? 1;
  const key = cacheKey(game, owner);
  let cache = planCache.get(key);
  if (!cache || cache.round !== roundNumber) {
    const solved = solveRound(game, owner, utils);
    cache = {
      round: roundNumber,
      plan: solved.plan,
      // 指纹可能重复（同一单位的两个 wait 动作指纹相同），按「同指纹出现
      // 次数」计数：用 Set 去重会让两个 wait 在吐出第一条后互相吞掉对方的
      // 拒绝/排队判定，导致第二条永远不再吐出。
      rejected: new Map(),
      emitted: new Map(),
    };
    planCache.set(key, cache);
    if (planCache.size > 32) {
      // 进程跨局复用时的容量兜底：清掉别的对局的陈旧缓存。
      for (const k of planCache.keys()) {
        if (k !== key) planCache.delete(k);
      }
    }
  }

  const queuedCounts = new Map();
  for (const fp of queue.map(actionFingerprint)) {
    queuedCounts.set(fp, (queuedCounts.get(fp) ?? 0) + 1);
  }
  const bump = (map, fp) => map.set(fp, (map.get(fp) ?? 0) + 1);
  // 吐出 n 次而队列里不足 n 条 → 至少 n - queued 条被拒；用差额更新，
  // 不能每次只 +1（同一指纹的多个动作可能同时被拒）。
  for (const [fp, emittedN] of cache.emitted) {
    const deficit = emittedN - (queuedCounts.get(fp) ?? 0);
    if (deficit > (cache.rejected.get(fp) ?? 0)) cache.rejected.set(fp, deficit);
  }

  // 逐条消费"已在队列"与"已知被拒"的计数：同一个指纹可能对应多个 wait，
  // 不能因为队列里已有一条同指纹动作就跳过计划里的全部同指纹动作。
  const remainingQueued = new Map(queuedCounts);
  const remainingRejected = new Map(cache.rejected);
  for (const action of cache.plan) {
    const fp = actionFingerprint(action);
    const queuedLeft = remainingQueued.get(fp) ?? 0;
    if (queuedLeft > 0) { remainingQueued.set(fp, queuedLeft - 1); continue; }
    const rejectedLeft = remainingRejected.get(fp) ?? 0;
    if (rejectedLeft > 0) { remainingRejected.set(fp, rejectedLeft - 1); continue; }
    if (!stillLegal(game, owner, action, queue)) {
      bump(cache.rejected, fp);
      remainingRejected.set(fp, (remainingRejected.get(fp) ?? 0) + 1);
      continue;
    }
    bump(cache.emitted, fp);
    return { type: action.type, payload: cleanPayload(action) };
  }
  // 计划全部入队或被拒 → 返回 null 提交（interfaces.mjs 会带已排计划提交）。
  return null;
}

function cleanPayload(action) {
  const payload = {};
  if (action.type === 'attack') {
    payload.attackerId = action.attackerId;
    payload.q = action.q; payload.r = action.r;
  } else if (action.type === 'heal') {
    payload.supportId = action.supportId;
    payload.q = action.q; payload.r = action.r;
  } else if (action.type === 'move') {
    payload.unitId = action.unitId;
    payload.q = action.q; payload.r = action.r;
  } else if (action.type === 'deploy') {
    payload.unitType = action.unitType;
    payload.fromId = action.fromId;
    payload.q = action.q; payload.r = action.r;
  } else if (action.type === 'demolish') {
    payload.unitId = action.unitId;
    payload.q = action.q; payload.r = action.r;
  }
  return payload;
}

/** 逐动作吐出前的最终校验（镜像 3.8 planning.ts 的结构性入队校验，
 *  含投影站位——队列里已排的动作会投影我方后续动作的起点）。 */
function stillLegal(game, owner, action, queue) {
  try {
    const board = cloneBoard(game);
    return structuralCheck(board, owner, action, queue) === null;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- 模块导出

const matrixEq = {
  name: 'matrix-eq',
  displayName: '矩阵均衡算法',
  description: '计划组合矩阵博弈 + CFR 均衡混合 + 分步结算模拟与事件史实证校正（3.8.0 引擎适配）',
  version: 'v2',
  modes: ['simultaneous'],

  decide(gameState, utils, ctx) {
    try {
      return decideImpl(gameState, utils, ctx);
    } catch (err) {
      // 内部异常时安全退出：返回 null 提交当前已排计划，绝不卡桌。
      console.warn(`[matrix-eq] decide fallback: ${err?.message ?? err}`);
      planCache.clear();
      return null;
    }
  },
};

export default matrixEq;

// 测试/标定用的内部入口（runner 只读 default）。
export const matrixEqInternals = {
  cloneBoard,
  copyBoard,
  computeCoveredCells,
  projectQueue,
  structuralCheck,
  terrainReachable,
  enumerateAttackAimsFrom,
  buildPlan,
  simulateRound,
  scoreOf,
  payoffOf,
  reconstructEnemyPlans,
  solveTwoPlayer,
  solveAgainstScenarios,
  solveRound,
  refinePlan,
  actionFingerprint,
  stillLegal,
  decideImpl,
  planCache,
  mulberry32,
  hashSeed,
};
