// algorithms/builtin/matrix-eq.mjs
//
// 矩阵均衡算法（Matrix Equilibrium）——同时回合模式的第三条技术路线：
// 把每一轮升维成「计划组合 × 计划组合」的矩阵博弈，用自我对弈的
// 后悔匹配（regret matching / 单步 CFR）在该矩阵上求解均衡混合策略，
// 再从均衡分布中抽样本轮完整计划逐动作入队。
//
// 与 random-sim 的差别：random-sim 是动作级无模型均匀随机；本算法的
// 随机性出现在「均衡混合」这一层——抽样分布是对手无论怎么读盘都
// 无法系统性剥削的最优响应意义上的混合，而不是均匀撒点。
//
// 与 dest-prob 的差别（三条轴）：
//   1. 决策粒度：dest-prob 每次 decide 做一次边际贪心 argmax（单动作
//      期望值最高者胜）；本算法一次性求解整轮 ≤5 个动作的组合计划，
//      组合间的协同（占点+护点、锁射+驱赶）直接进入支付矩阵。
//   2. 对手模型来源：dest-prob 用固定启发式（softmax 落点分布）预测
//      敌人；本算法的对手策略是博弈解的内生部分（自我对弈均衡），
//      并用 round_resolved 事件史重建的敌方真实计划做实证校正——
//      dest-prob 完全不看历史事件。
//   3. 输出形态：dest-prob 确定性输出，面对会读盘的对手（人或强 AI）
//      会被反预测（skill/simultaneous.md 原话：enemies see YOUR board
//      too——avoid the obvious hex）；本算法输出混合策略，同一棋盘
//      不同轮次可以打出不同计划，天然反读盘。
//
// 管线（每轮）：
//   检测新回合 → 生成我方 K 个候选计划（策略人格 + 随机权重贪心）
//   → 生成敌方 K' 个镜像候选计划 + 事件史实证计划
//   → 镜像结算器（部署冲突 → 移动冲突 → 拆除 → 治疗 → 攻击锁定/覆盖
//      → 死亡 → 占点 → 维修/收入）逐组合模拟，支付按裁定权重
//      （scorePlayer 增量）计价
//   → 2 人局：CFR 自我对弈解均衡，再与「对实证分布的纯最优响应」
//      按 ε 混合（鲁棒-利用）；3+ 人：对场景分布做后悔匹配
//   → 从混合分布抽一个计划缓存，decide 逐动作吐出
//
// 随机性由 mulberry32 提供，种子 = fnv(gameId:owner:roundNumber)：
// 同一局同一轮可复现（回放/标定友好），跨轮可变（反读盘）。
//
// 约束：所有枚举镜像 src/engine/planning.ts 的入队校验（形状瞄准、
// 一单位一轮一动作、己方目的格认领、部署预算扣减、BFS 可达），结算
// 模拟镜像 src/engine/simultaneous.ts 的阶段顺序与判定（含 attackLock、
// 治疗按移动后站位、目的格冲突全员失败、同回合互杀、击杀先入账后判死），
// 保证 runner 不会因非法动作空耗重问配额。

// ---------------------------------------------------------------- 常量

const MY_PORTFOLIO_SIZE = 10;      // 我方候选计划数（人格 + 随机权重）
const ENEMY_PORTFOLIO_SIZE = 9;    // 每个敌方席位的镜像候选计划数
const MAX_EMPIRICAL_PLANS = 3;     // 事件史重建的敌方计划，每席位最多保留
const MULTI_SCENARIOS = 24;        // ≥3 人局联合场景抽样数
const CFR_ITERATIONS = 300;        // 后悔匹配迭代轮数
const EXPLOIT_WEIGHT = 0.15;       // 鲁棒-利用混合中纯最优响应的权重 ε
const HQ_WIN_BONUS = 1e6;          // 模拟中摧毁敌方总部的支付（终局级）
const ACTION_NOISE = 0.12;         // 人格贪心内的 PRNG 扰动幅度（比例）

const HEX_DIRS = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

// 策略人格：动作竞标权重（cp=占点 fire=火力 safety=避险 heal=治疗
// deploy=部署 advance=推进）。生成器按权重做带扰动贪心构造整轮计划。
const PERSONAS = [
  { name: 'occupy', w: { cp: 3.0, fire: 1.0, safety: 0.6, heal: 1.2, deploy: 1.6, advance: 0.4 } },
  { name: 'strike', w: { cp: 0.8, fire: 3.0, safety: 1.0, heal: 0.8, deploy: 0.8, advance: 1.2 } },
  { name: 'turtle', w: { cp: 0.6, fire: 1.0, safety: 2.5, heal: 2.5, deploy: 1.0, advance: 0.0 } },
  { name: 'advance', w: { cp: 1.0, fire: 1.5, safety: 0.8, heal: 0.8, deploy: 1.2, advance: 3.0 } },
  { name: 'hold', w: { cp: 0.5, fire: 2.0, safety: 1.5, heal: 1.5, deploy: 0.5, advance: 0.2 } },
  { name: 'skirmish', w: { cp: 1.5, fire: 1.8, safety: 1.8, heal: 1.0, deploy: 1.0, advance: 1.0 } },
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

// ---------------------------------------------------------------- 合法动作枚举
// 镜像 src/engine/planning.ts 的入队校验：一单位一轮一动作（以现有队列
// 为准）、己方目的格认领互斥、BFS 可达（把所有单位当障碍）、形状瞄准、
// 部署相邻空平原 + 预算。攻击/治疗瞄准格只要求形状合法（预测射击允许
// 打空格），治疗额外要求计划时刻覆盖格内有存活友军。

function plannedUnitIds(queue) {
  const ids = new Set();
  for (const a of queue) {
    const id = a.unitId ?? a.attackerId ?? a.supportId;
    if (id) ids.add(id);
  }
  return ids;
}

function claimedCells(queue) {
  const set = new Set();
  for (const a of queue) {
    if (a.type === 'move' || a.type === 'deploy') set.add(hexKey(a));
  }
  return set;
}

function plannedDeploySpend(board, queue) {
  let sum = 0;
  for (const a of queue) {
    if (a.type !== 'deploy' || !a.unitType) continue;
    const spec = board.unitsSpec[a.unitType];
    if (!spec) continue;
    sum += spec.cost - deployDiscount(board, a.owner ?? '?', a.fromId);
  }
  return sum;
}

function deployDiscount(board, owner, fromId) {
  const origin = boardDeployOrigin(board, owner, fromId);
  if (!origin) return 0;
  const kinds = board.balance?.controlPointTypes ?? {};
  const kind = kinds[origin.kind ?? 'supply'];
  return Math.min(999, kind?.deployDiscount ?? 0);
}

function boardDeployOrigin(board, owner, fromId) {
  const hq = board.hqs[owner];
  if (hq && hq.alive && hq.id === fromId) return hq;
  if (hq && hq.alive && fromId === `${owner}_hq`) return hq;
  const cp = board.cps.find(c => c.id === fromId && c.owner === owner);
  if (cp) return cp;
  // 状态里总部可能没有 id 字段：fromId 形如 'hq' / 'headquarters:player_a'。
  if (hq && hq.alive && (fromId === 'hq' || fromId === 'headquarters')) return hq;
  return null;
}

/** BFS 可达格（镜像 findReachableCells：所有单位为障碍、仅平原）。 */
function reachableCells(board, unit, occupants) {
  const visited = new Set([hexKey(unit)]);
  const result = [];
  const queue = [{ pos: unit, distance: 0 }];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    if (cur.distance >= unit.moveRange) continue;
    for (const next of neighborsOf(cur.pos)) {
      const key = hexKey(next);
      if (visited.has(key)) continue;
      visited.add(key);
      if (!board.cells.has(key)) continue;
      if (boardTerrainAt(board, next) !== 'plain') continue;
      if (occupants.has(key)) continue;
      result.push({ q: next.q, r: next.r });
      queue.push({ pos: next, distance: cur.distance + 1 });
    }
  }
  return result;
}

/** 枚举某单位全部合法攻击瞄准（含重复覆盖格的不同锁定目标）。 */
function enumerateAttackAims(board, unit) {
  const spec = board.unitsSpec[unit.type] ?? {};
  const shape = shapeSpecFor(spec, 'attackShape');
  const aims = [];
  const seen = new Set();
  const tryAim = (target) => {
    const aim = computeCoveredCells(unit, shape, 'attackShape', target, unit.attackRange);
    if (!aim) return;
    const key = `${unit.q},${unit.r}|${aim.type}|${aim.direction}|${target.q},${target.r}`;
    if (seen.has(key)) return;
    seen.add(key);
    aims.push({ target: { q: target.q, r: target.r }, aim });
  };
  if (shape.type === 'single') {
    // 射程内所有格（含空格：预测射击）。
    for (let dq = -unit.attackRange; dq <= unit.attackRange; dq++) {
      for (let dr = -unit.attackRange; dr <= unit.attackRange; dr++) {
        if (hexDistance(unit, { q: unit.q + dq, r: unit.r + dr }) > unit.attackRange) continue;
        tryAim({ q: unit.q + dq, r: unit.r + dr });
      }
    }
  } else if (shape.type === 'arc') {
    for (const d of HEX_DIRS) tryAim({ q: unit.q + d.q, r: unit.r + d.r });
  } else {
    for (const d of HEX_DIRS) {
      const maxK = Math.min(shape.length, unit.attackRange);
      for (let k = 1; k <= maxK; k++) tryAim({ q: unit.q + k * d.q, r: unit.r + k * d.r });
    }
  }
  return aims.filter(a => board.cells.has(hexKey(a.target)));
}

/** 枚举支援兵全部合法治疗瞄准（覆盖格内须有存活友军）。 */
function enumerateHealAims(board, unit, occupants) {
  const spec = board.unitsSpec[unit.type] ?? {};
  const shape = shapeSpecFor(spec, 'healShape');
  const healRange = spec.healRange ?? unit.attackRange ?? 1;
  const aims = [];
  const seen = new Set();
  for (const d of HEX_DIRS) {
    const target = { q: unit.q + d.q, r: unit.r + d.r };
    const aim = computeCoveredCells(unit, shape, 'healShape', target, healRange);
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

/** 枚举某席位的全部合法动作（不含拆除：对峙图上价值低，见文档局限）。 */
function enumerateActions(board, owner, queue) {
  const occupants = occupancyMap(board);
  const usedUnits = plannedUnitIds(queue);
  const claimed = claimedCells(queue);
  const limit = board.balance?.actionsPerTurn ?? 5;
  const remainingAp = limit - queue.length;
  const actions = [];
  if (remainingAp <= 0) return actions;

  for (const unit of board.units) {
    if (unit.owner !== owner || usedUnits.has(unit.id)) continue;
    // 攻击
    for (const { target, aim } of enumerateAttackAims(board, unit)) {
      actions.push({
        type: 'attack', unit, aim,
        payload: { attackerId: unit.id, q: target.q, r: target.r, direction: aim.direction },
      });
    }
    // 治疗
    if (unit.type === 'support' && (board.unitsSpec[unit.type]?.healPower ?? 0) > 0) {
      for (const { target, aim } of enumerateHealAims(board, unit, occupants)) {
        actions.push({
          type: 'heal', unit, aim,
          payload: { supportId: unit.id, q: target.q, r: target.r, direction: aim.direction },
        });
      }
    }
    // 移动
    for (const dest of reachableCells(board, unit, occupants)) {
      if (claimed.has(hexKey(dest))) continue;
      actions.push({ type: 'move', unit, payload: { unitId: unit.id, q: dest.q, r: dest.r } });
    }
  }
  // 部署：总部（deployFromHq !== false 时）+ 己方据点（canDeploy !== false 的
  // 类型即可部署源，对峙图 supply 点也算——与 deployOriginFor 同口径）。
  const supplies = board.supplies[owner] ?? 0;
  const spent = plannedDeploySpend(board, queue);
  const deployFromHq = board.balance?.deployFromHq !== false;
  const origins = [];
  const ownHq = board.hqs[owner];
  if (deployFromHq && ownHq && ownHq.alive) origins.push(ownHq);
  for (const cp of board.cps) {
    if (cp.owner !== owner) continue;
    const kindCfg = (board.balance?.controlPointTypes ?? {})[cp.kind ?? 'supply'];
    if (kindCfg?.canDeploy === false) continue;
    origins.push(cp);
  }
  for (const origin of origins) {
    for (const [typeName, spec] of Object.entries(board.unitsSpec)) {
      if (!spec || spec.cost == null) continue;
      const discount = Math.min(spec.cost, deployDiscountFor(board, owner, origin));
      const cost = spec.cost - discount;
      if (supplies - spent < cost) continue;
      for (const pos of neighborsOf(origin)) {
        if (!board.cells.has(hexKey(pos))) continue;
        if (boardTerrainAt(board, pos) !== 'plain') continue;
        if (occupants.has(hexKey(pos))) continue;
        if (claimed.has(hexKey(pos))) continue;
        actions.push({
          type: 'deploy', unit: null,
          payload: { unitType: typeName, fromId: origin.id ?? `${owner}_hq`, q: pos.q, r: pos.r },
        });
      }
    }
  }
  return actions;
}

function deployDiscountFor(board, owner, origin) {
  const kinds = board.balance?.controlPointTypes ?? {};
  const cfg = kinds[origin.kind ?? 'supply'];
  return Math.min(999, cfg?.deployDiscount ?? 0);
}

// ---------------------------------------------------------------- 计划生成器
// 人格贪心：每轮对候选动作按人格权重竞标 + PRNG 扰动，argmax 入队，
// 重复直到行动点用尽或无可行动作。产出完整计划（动作数组，队列形态）。

function personaWeights(rng) {
  return {
    cp: 0.5 + rng() * 2.0,
    fire: 0.5 + rng() * 2.0,
    safety: 0.5 + rng() * 2.0,
    heal: 0.5 + rng() * 2.0,
    deploy: 0.5 + rng() * 2.0,
    advance: 0.5 + rng() * 2.0,
  };
}

/** 敌方落点简单先验：0.5 留原地，0.5 均摊到 BFS 可达格。 */
function enemyDestPrior(board, occupants, enemies) {
  const prior = new Map();
  for (const u of enemies ?? board.units) {
    prior.set(hexKey(u), (prior.get(hexKey(u)) ?? 0) + 0.5);
    const reach = reachableCells(board, u, occupants);
    if (reach.length) {
      const share = 0.5 / reach.length;
      for (const c of reach) prior.set(hexKey(c), (prior.get(hexKey(c)) ?? 0) + share);
    }
  }
  return prior;
}

/** 我方每个候选落点的期望承伤（敌方按先验落点 + 从落点开火的覆盖）。 */
function exposureMap(board, occupants, enemies, destPrior) {
  const exposure = new Map();
  for (const enemy of enemies) {
    const spec = board.unitsSpec[enemy.type] ?? {};
    const shape = shapeSpecFor(spec, 'attackShape');
    // 敌人从「先验概率 > 0.08 的落点」开火的覆盖格并集 × 落点概率。
    for (const [posKey, p] of destPrior) {
      if (p < 0.08) continue;
      const pos = { q: Number(posKey.split(',')[0]), r: Number(posKey.split(',')[1]) };
      if (hexDistance(enemy, pos) > enemy.moveRange) continue;
      // 从该落点能打到的格：以 shape 枚举方向。
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

/** 单动作人格竞标分。 */
function actionScore(board, action, w, context) {
  const { enemies, destPrior, exposure, occupants, ownerTargets } = context;
  let score = 0;
  if (action.type === 'attack') {
    const unit = action.unit;
    let dmg = 0;
    if (unit.attackLock) {
      // 锁定射击：计划时刻站在瞄准格上的敌军，未逃出射程必命中。
      const occ = occupants.get(hexKey(action.payload));
      if (occ && occ.kind === 'unit' && occ.entity.owner !== unit.owner) {
        const escapeP = 0.35; // 逃出射程的粗略概率（移动力 ≥ 2 时不可忽略）
        dmg += expectedDamage(board, unit, occ) * (1 - escapeP);
      } else {
        // 锁定兵打空格：只有预测价值（先验落点）。
        dmg += expectedDamage(board, unit, null) * (destPrior.get(hexKey(action.payload)) ?? 0);
      }
    } else {
      for (const cell of action.aim.cells) {
        const occ = occupants.get(hexKey(cell));
        if (!occ || occ.kind !== 'unit' || occ.entity.owner === unit.owner) continue;
        dmg += expectedDamage(board, unit, occ) * 0.55; // 当前站位命中概率
      }
      // 预测射击：敌军先验会走进覆盖格。
      for (const cell of action.aim.cells) {
        dmg += expectedDamage(board, unit, null) * (destPrior.get(hexKey(cell)) ?? 0) * 0.45;
      }
    }
    score += w.fire * dmg * 0.6;
    score += w.fire * 0.8; // 火力人格的固定倾向（哪怕期望低也保留开火习惯）
  } else if (action.type === 'heal') {
    let heal = 0;
    for (const cell of action.aim.cells) {
      const occ = occupants.get(hexKey(cell));
      if (!occ || occ.kind !== 'unit' || occ.entity.owner !== action.unit.owner) continue;
      const missing = occ.entity.maxHp - occ.entity.hp;
      if (missing <= 0) continue;
      const expected = (board.unitsSpec[action.unit.type]?.healPower ?? 0)
        + (board.balance?.healVarianceRange ?? 0) / 2;
      heal += Math.min(missing, expected);
    }
    score += w.heal * heal * 0.5;
  } else if (action.type === 'move') {
    const unit = action.unit;
    const from = hexDistance(unit, action.payload);
    // 占点引力：离最优目标据点距离缩短。
    if (unit.canCapture) {
      const target = nearestTarget(action.payload, ownerTargets.cp ?? []);
      const targetNow = nearestTarget(unit, ownerTargets.cp ?? []);
      if (target && targetNow) {
        const gain = hexDistance(unit, targetNow) - hexDistance(action.payload, target);
        score += w.cp * Math.max(0, gain) * 3;
        // 站上据点的大额奖励。
        if (ownerTargets.cpKeys?.has(hexKey(action.payload))) score += w.cp * 8;
      }
    }
    // 推进引力。
    const hqTarget = ownerTargets.enemyHq;
    if (hqTarget) {
      const hqNow = hexDistance(unit, hqTarget);
      const hqNext = hexDistance(action.payload, hqTarget);
      score += w.advance * Math.max(0, hqNow - hqNext) * 1.5;
    }
    // 避险：落点期望承伤。
    score -= w.safety * (exposure.get(hexKey(action.payload)) ?? 0) * 0.12;
    score -= 0.05 * from; // 轻微的路途成本
  } else if (action.type === 'deploy') {
    const spec = board.unitsSpec[action.payload.unitType] ?? {};
    score += w.deploy * (spec.cost ?? 0) * 0.35 * 0.3;
    if (action.payload.unitType === 'support') score += w.heal * 4;
    const target = nearestTarget(action.payload, ownerTargets.cp ?? []);
    if (target) score += w.cp * Math.max(0, 4 - hexDistance(action.payload, target)) * 0.8;
  }
  return score;
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

/** 生成一个完整计划（贪心 + 扰动）。返回队列形态动作数组。 */
function buildPlan(board, owner, weights, rng, seedQueue) {
  // 种子队列（人类/上轮遗留的已排动作）归一成统一形态后作为固定前缀。
  const queue = (seedQueue ?? []).map(a => ({ ...a, owner })).filter(a => a && a.type);
  const occupants = occupancyMap(board);
  const enemies = board.units.filter(u => u.owner !== owner);
  // 先验落点只统计敌军（预测射击与避险都只关心敌方动向）。
  const destPrior = enemyDestPrior(board, occupants, enemies);
  const exposure = exposureMap(board, occupants, enemies, destPrior);
  const myUnits = board.units.filter(u => u.owner === owner);
  const enemyHq = Object.values(board.hqs).find(h => h.owner !== owner) ?? null;
  const cpTargets = board.cps
    .filter(cp => cp.owner !== owner)
    .map(cp => ({ q: cp.q, r: cp.r }));
  const context = {
    enemies, destPrior, exposure, occupants,
    ownerTargets: {
      cp: cpTargets,
      cpKeys: new Set(cpTargets.map(hexKey)),
      enemyHq: enemyHq ? { q: enemyHq.q, r: enemyHq.r } : null,
    },
  };
  const limit = board.balance?.actionsPerTurn ?? 5;
  let guard = limit * 4 + 8;
  while (queue.length < limit && guard-- > 0) {
    const options = enumerateActions(board, owner, queue);
    if (!options.length) break;
    let best = null;
    let bestScore = -Infinity;
    for (const option of options) {
      const base = actionScore(board, option, weights, context);
      const noise = 1 + (rng() * 2 - 1) * ACTION_NOISE;
      const s = base * noise;
      if (s > bestScore) { bestScore = s; best = option; }
    }
    if (!best || bestScore <= 0) break;
    queue.push({ type: best.type, owner, ...best.payload });
  }
  return queue;
}

// ---------------------------------------------------------------- 结算模拟器
// 镜像 src/engine/simultaneous.ts resolveRound 的阶段顺序与判定：
//   0. 计划时刻站位快照（锁定射击依据）
//   1. 部署：目的格冲突（跨全玩家的认领池）→ 补给扣减 → 生成单位
//   2. 移动：单位有效 → 目的格冲突 → 落位
//   3. 拆除（计划含拆除时）
//   4. 治疗：覆盖格内受伤友军（按移动后站位）各回 expected 血
//   5. 攻击：锁定目标（计划时刻瞄准格上的敌军，结算时未逃出射程必中，
//      与覆盖格无关）；非锁定：覆盖格上的敌方单位/总部各吃期望伤害；
//      同回合互杀成立，攻击者阵亡不影响其炮弹
//   6. 死亡与淘汰：击杀/总部伤害先入账再判死；总部摧毁 → 淘汰并移除单位
//   7. 占点：回合结束时站在据点上的 canCapture 单位改判归属
//   8. 维修站治疗 + 收入 + 据点持有累计（裁定流量分用）
// 伤害/治疗全部用期望值（damageVariance 期望为 0，healVariance 期望为
// range/2）；这对矩阵博弈的解是蒙特卡洛期望的确定性近似。

function simulateRound(board, queuesByPlayer, simRng) {
  const sim = copyBoard(board);
  const planTime = sim.units.map(u => ({ unit: u, q: u.q, r: u.r }));
  const occupants = occupancyMap(sim);
  const order = sim.turnOrder.filter(id => queuesByPlayer.has(id));

  // 认领池：deploy/move 目的格（所有玩家合并）。
  const claimCount = new Map();
  for (const id of order) {
    for (const action of queuesByPlayer.get(id)) {
      if (action.type !== 'move' && action.type !== 'deploy') continue;
      const k = hexKey(action);
      claimCount.set(k, (claimCount.get(k) ?? 0) + 1);
    }
  }
  const isConflict = action => (claimCount.get(hexKey(action)) ?? 0) > 1;

  // 阶段 1：部署。
  for (const id of order) {
    for (const action of queuesByPlayer.get(id)) {
      if (action.type !== 'deploy') continue;
      if (isConflict(action)) continue;
      const spec = sim.unitsSpec[action.unitType];
      if (!spec) continue;
      const origin = boardDeployOrigin(sim, id, action.fromId);
      if (!origin) continue;
      if (hexDistance(origin, action) !== 1) continue;
      const occ = occupants.get(hexKey(action));
      if (occ) continue;
      const discount = Math.min(spec.cost, deployDiscountFor(sim, id, origin));
      const cost = spec.cost - discount;
      if ((sim.supplies[id] ?? 0) < cost) continue;
      sim.supplies[id] -= cost;
      const unit = {
        id: `${action.unitType}:${action.q},${action.r}:sim`, owner: id, type: action.unitType,
        q: action.q, r: action.r, hp: spec.hp, maxHp: spec.hp,
        attack: spec.attack, defense: spec.defense,
        moveRange: spec.moveRange, attackRange: spec.attackRange,
        canCapture: spec.canCapture ?? false, attackLock: spec.attackLock ?? false,
        healPower: spec.healPower ?? 0, cost: spec.cost,
      };
      sim.units.push(unit);
      occupants.set(hexKey(unit), { kind: 'unit', entity: unit });
    }
  }

  // 阶段 2：移动。
  for (const id of order) {
    for (const action of queuesByPlayer.get(id)) {
      if (action.type !== 'move') continue;
      if (isConflict(action)) continue;
      const unit = sim.units.find(u => u.id === action.unitId && u.owner === id);
      if (!unit) continue;
      // 计划时刻 BFS 已保证可达（镜像校验），冲突过滤后落位无碰撞。
      occupants.delete(hexKey(unit));
      unit.q = action.q; unit.r = action.r;
      occupants.set(hexKey(unit), { kind: 'unit', entity: unit });
    }
  }

  // 阶段 3：拆除。
  for (const id of order) {
    for (const action of queuesByPlayer.get(id)) {
      if (action.type !== 'demolish') continue;
      const unit = sim.units.find(u => u.id === action.unitId && u.owner === id);
      if (!unit || unit.type !== 'heavy') continue;
      if (hexDistance(unit, action) > 1) continue;
      if (sim.terrain.get(hexKey(action)) !== 'blocker') continue;
      if (occupants.has(hexKey(action))) continue;
      sim.terrain.set(hexKey(action), 'plain');
    }
  }

  // 阶段 4：治疗（移动后站位）。simRng 提供时按引擎口径逐目标掷量，
  // 否则用期望值（算法内部推演模式）。
  for (const id of order) {
    for (const action of queuesByPlayer.get(id)) {
      if (action.type !== 'heal') continue;
      const support = sim.units.find(u => u.id === action.supportId && u.owner === id);
      if (!support || support.type !== 'support') continue;
      const spec = sim.unitsSpec[support.type] ?? {};
      const shape = shapeSpecFor(spec, 'healShape');
      const healRange = spec.healRange ?? support.attackRange ?? 1;
      const aim = computeCoveredCells(support, shape, 'healShape', action, healRange);
      if (!aim) continue;
      const base = support.healPower || spec.healPower || 0;
      const varianceRange = sim.balance?.healVarianceRange ?? 0;
      for (const cell of aim.cells) {
        const occ = occupants.get(hexKey(cell));
        if (!occ || occ.kind !== 'unit' || occ.entity.owner !== id) continue;
        const u = occ.entity;
        const amount = simRng
          ? base + Math.floor(simRng() * (varianceRange + 1))
          : base + varianceRange / 2;
        u.hp = Math.min(u.maxHp, u.hp + amount);
      }
    }
  }

  // 阶段 5：攻击（同回合全弹齐发后统一判死）。
  const deaths = [];
  const hqDestroyed = new Set();
  for (const id of order) {
    for (const action of queuesByPlayer.get(id)) {
      if (action.type !== 'attack') continue;
      const attacker = sim.units.find(u => u.id === action.attackerId && u.owner === id);
      if (!attacker) continue;
      const spec = sim.unitsSpec[attacker.type] ?? {};
      const shape = shapeSpecFor(spec, 'attackShape');
      const aim = computeCoveredCells(attacker, shape, 'attackShape', action, attacker.attackRange);
      if (!aim) continue;

      const targets = [];
      if (spec.attackLock) {
        const locked = planTime.find(entry =>
          entry.unit.owner !== id && entry.q === action.q && entry.r === action.r);
        if (locked && locked.unit.hp > 0 && hexDistance(attacker, locked.unit) <= attacker.attackRange) {
          // 锁定目标逃不出射程 → 必中（与覆盖格无关）。
          targets.push({ kind: 'unit', entity: locked.unit });
        }
        // 逃出射程或无人可锁 → 落空。
      } else {
        for (const cell of aim.cells) {
          const occ = occupants.get(hexKey(cell));
          if (!occ || occ.kind === 'unit' && occ.entity.owner === id) continue;
          if (occ.kind === 'headquarters' && occ.entity.owner === id) continue;
          if (occ.kind === 'unit' && occ.entity.hp <= 0) continue;
          if (occ.kind === 'headquarters' && !occ.entity.alive) continue;
          targets.push(occ);
        }
      }

      for (const target of targets) {
        const entity = target.entity;
        const dmg = expectedDamage(sim, attacker, target, simRng);
        entity.hp -= dmg;
        if (target.kind === 'headquarters') {
          // 伤害记账：敌方总部承伤记到攻击者名下（scorePlayer 口径）。
          if (id !== entity.owner) {
            const attackerStats = sim.players[id]?.stats;
            if (attackerStats) attackerStats.headquartersDamage += dmg;
          }
          if (entity.hp <= 0 && entity.alive) {
            entity.alive = false;
            hqDestroyed.add(entity.owner);
          }
        } else {
          if (entity.hp <= 0 && !deaths.some(d => d.entity === entity)) {
            deaths.push({ kind: 'unit', entity, killer: id });
            const killerStats = sim.players[id]?.stats;
            if (killerStats) killerStats.killValue += entity.cost ?? 0;
          }
        }
      }
    }
  }

  // 阶段 6：死亡与淘汰。
  for (const death of deaths) {
    const entity = death.entity;
    occupants.delete(hexKey(entity));
    sim.units = sim.units.filter(u => u !== entity);
  }
  for (const owner of hqDestroyed) {
    const player = sim.players[owner];
    if (player) player.status = 'eliminated';
    sim.units = sim.units.filter(u => u.owner !== owner);
    for (const cp of sim.cps) if (cp.owner === owner) cp.owner = null;
  }

  // 阶段 7：占点（回合末站位）。
  for (const cp of sim.cps) {
    const occ = occupants.get(hexKey(cp));
    if (occ && occ.kind === 'unit' && occ.entity.canCapture
      && sim.players[occ.entity.owner]?.status === 'active') {
      cp.owner = occ.entity.owner;
    }
  }

  // 阶段 8：维修 / 收入 / 据点持有累计。
  const kinds = sim.balance?.controlPointTypes ?? {};
  for (const cp of sim.cps) {
    const cfg = kinds[cp.kind ?? 'supply'] ?? {};
    const repair = cfg.repairAmount ?? 0;
    if (repair > 0) {
      const occ = occupants.get(hexKey(cp));
      if (occ && occ.kind === 'unit') {
        occ.entity.hp = Math.min(occ.entity.maxHp, occ.entity.hp + repair);
      }
    }
    const income = cfg.income ?? 0;
    if (cp.owner && sim.players[cp.owner]?.status === 'active') {
      sim.supplies[cp.owner] = (sim.supplies[cp.owner] ?? 0) + income;
    }
  }
  const baseIncome = sim.balance?.baseIncome ?? 0;
  for (const id of sim.turnOrder) {
    if (sim.players[id]?.status !== 'active') continue;
    sim.supplies[id] = (sim.supplies[id] ?? 0) + baseIncome;
    const held = sim.cps.filter(cp => cp.owner === id).length;
    sim.players[id].stats.controlHold += held;
    sim.players[id].stats.controlHoldRounds += 1;
  }

  return sim;
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
// 从 game.events 的 round_resolved 结果里重建敌方上一轮的真实计划
// （executed/failed/missed 都带 q/r 与单位信息）。dest-prob 完全不看
// 事件史；本算法把它当作对手组合池的实证校正（fictitious play 味道）。

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
      const plan = [];
      for (const outcome of outcomes) {
        if (!outcome || !outcome.type) continue;
        if (outcome.type === 'attack') {
          const d = outcome.detail ?? {};
          if (d.attackerId && d.q != null && d.r != null) {
            plan.push({ type: 'attack', owner, attackerId: d.attackerId, q: d.q, r: d.r });
          } else if (outcome.unitId && d.q != null && d.r != null) {
            plan.push({ type: 'attack', owner, attackerId: outcome.unitId, q: d.q, r: d.r });
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
          if (d.fromId && d.unitType && outcome.q != null && outcome.r != null) {
            plan.push({
              type: 'deploy', owner, unitType: d.unitType, fromId: d.fromId,
              q: outcome.q, r: outcome.r,
            });
          }
        } else if (outcome.type === 'heal') {
          const d = outcome.detail ?? {};
          const supportId = d.supportId ?? outcome.unitId;
          if (supportId && d.q != null && d.r != null) {
            plan.push({ type: 'heal', owner, supportId, q: d.q, r: d.r });
          }
        } else if (outcome.type === 'demolish') {
          if (outcome.unitId && outcome.q != null && outcome.r != null) {
            plan.push({ type: 'demolish', owner, unitId: outcome.unitId, q: outcome.q, r: outcome.r });
          }
        }
      }
      if (plan.length) plans.push({ owner, plan });
    }
  }
  // 只保留敌方座位（round_resolved 每轮一份，多席重建会交叉）。
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
    const empiricalPlans = empirical
      .filter(e => e.owner === enemy)
      .slice(0, MAX_EMPIRICAL_PLANS)
      .map(e => e.plan);
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

  // 支付矩阵：myPortfolio × scenarios。
  const payoff = myPortfolio.map(myPlan => scenarios.map(scenario => {
    const queues = new Map();
    queues.set(owner, myPlan);
    for (const [enemy, plan] of scenario.planByEnemy) queues.set(enemy, plan);
    const post = simulateRound(board, queues);
    return payoffOf(board, post, owner, enemies);
  }));

  // 求解 + 采样。
  let myMix;
  const personaScenarioCount = scenarios.filter(s => !s.empirical).length;
  if (enemies.length === 1 && personaScenarioCount > 0) {
    // 2 人局：人格场景子矩阵做 CFR 自我对弈（实证列不进对手策略集，
    // 走下面的利用混合）。
    const personaPayoff = payoff.map(row => row.slice(0, personaScenarioCount));
    const { myMix: eqMix } = solveTwoPlayer(personaPayoff, CFR_ITERATIONS);
    // 鲁棒-利用混合：ε 权重给「对实证分布的纯最优响应」。
    myMix = eqMix.slice();
    const empiricalCount = scenarios.length - personaScenarioCount;
    if (empiricalCount > 0) {
      const empiricalPayoff = payoff.map(row => row.slice(personaScenarioCount));
      const bestIdx = argmaxRowSum(empiricalPayoff);
      if (bestIdx >= 0) {
        for (let i = 0; i < myMix.length; i++) myMix[i] *= (1 - EXPLOIT_WEIGHT);
        myMix[bestIdx] += EXPLOIT_WEIGHT;
      }
    }
  } else {
    // 多人或无实证：对场景分布（人格均匀 + 实证加倍）单侧后悔匹配。
    const weights = scenarios.map(s => s.empirical ? 2.0 : 1.0);
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    const normWeights = weights.map(w => w / total);
    myMix = solveAgainstScenarios(payoff, normWeights, CFR_ITERATIONS);
  }

  const chosen = myPortfolio[sampleIndex(myMix, rng)];
  return { plan: chosen, alternatives: myPortfolio, mix: myMix };
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
      rejected: new Set(),
      emitted: new Set(),
    };
    planCache.set(key, cache);
    if (planCache.size > 32) {
      // 进程跨局复用时的容量兜底：清掉别的对局的陈旧缓存。
      for (const k of planCache.keys()) {
        if (k !== key) planCache.delete(k);
      }
    }
  }

  const queued = new Set(queue.map(actionFingerprint));
  // 吐出过但没出现在队列里 = 被服务器拒绝：记入拒绝集，跳过。
  for (const fp of cache.emitted) {
    if (!queued.has(fp)) cache.rejected.add(fp);
  }

  for (const action of cache.plan) {
    const fp = actionFingerprint(action);
    if (queued.has(fp)) continue;
    if (cache.rejected.has(fp)) continue;
    if (!stillLegal(game, owner, action, queue)) {
      cache.rejected.add(fp);
      continue;
    }
    cache.emitted.add(fp);
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

/** 逐动作吐出前的最终校验（镜像 planning.ts 的入队校验）。 */
function stillLegal(game, owner, action, queue) {
  try {
    const board = cloneBoard(game);
    const occupants = occupancyMap(board);
    const usedUnits = plannedUnitIds(queue);
    const claimed = claimedCells(queue);
    const limit = board.balance?.actionsPerTurn ?? 5;
    if (queue.length >= limit) return false;
    if (action.type === 'attack') {
      const unit = board.units.find(u => u.id === action.attackerId && u.owner === owner);
      if (!unit || usedUnits.has(unit.id)) return false;
      const spec = board.unitsSpec[unit.type] ?? {};
      const shape = shapeSpecFor(spec, 'attackShape');
      const aim = computeCoveredCells(unit, shape, 'attackShape', action, unit.attackRange);
      return Boolean(aim) && board.cells.has(hexKey(action));
    }
    if (action.type === 'heal') {
      const unit = board.units.find(u => u.id === action.supportId && u.owner === owner);
      if (!unit || unit.type !== 'support' || usedUnits.has(unit.id)) return false;
      const spec = board.unitsSpec[unit.type] ?? {};
      const shape = shapeSpecFor(spec, 'healShape');
      const healRange = spec.healRange ?? unit.attackRange ?? 1;
      const aim = computeCoveredCells(unit, shape, 'healShape', action, healRange);
      if (!aim) return false;
      return aim.cells.some(cell => {
        const occ = occupants.get(hexKey(cell));
        return occ && occ.kind === 'unit' && occ.entity.owner === owner;
      });
    }
    if (action.type === 'move') {
      const unit = board.units.find(u => u.id === action.unitId && u.owner === owner);
      if (!unit || usedUnits.has(unit.id)) return false;
      if (unit.q === action.q && unit.r === action.r) return false;
      if (claimed.has(hexKey(action))) return false;
      return reachableCells(board, unit, occupants)
        .some(pos => pos.q === action.q && pos.r === action.r);
    }
    if (action.type === 'deploy') {
      const spec = board.unitsSpec[action.unitType];
      if (!spec) return false;
      const origin = boardDeployOrigin(board, owner, action.fromId);
      if (!origin) return false;
      if (hexDistance(origin, action) !== 1) return false;
      if (!board.cells.has(hexKey(action))) return false;
      if (boardTerrainAt(board, action) !== 'plain') return false;
      if (occupants.has(hexKey(action))) return false;
      if (claimed.has(hexKey(action))) return false;
      const discount = Math.min(spec.cost, deployDiscountFor(board, owner, origin));
      const cost = spec.cost - discount;
      const spent = plannedDeploySpend(board, queue.filter(a => (a.owner ?? owner) === owner));
      return (board.supplies[owner] ?? 0) - spent >= cost;
    }
    if (action.type === 'demolish') {
      const unit = board.units.find(u => u.id === action.unitId && u.owner === owner);
      if (!unit || unit.type !== 'heavy' || usedUnits.has(unit.id)) return false;
      if (hexDistance(unit, action) > 1) return false;
      return boardTerrainAt(board, action) === 'blocker' && !occupants.has(hexKey(action));
    }
    return false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- 模块导出

const matrixEq = {
  name: 'matrix-eq',
  displayName: '矩阵均衡算法',
  description: '计划组合矩阵博弈 + CFR 均衡混合 + 结算模拟与事件史实证校正',
  version: 'v1',
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
  enumerateActions,
  buildPlan,
  simulateRound,
  scoreOf,
  payoffOf,
  reconstructEnemyPlans,
  solveTwoPlayer,
  solveAgainstScenarios,
  solveRound,
  actionFingerprint,
  stillLegal,
  mulberry32,
  hashSeed,
};
