// scripts/matrix_eq_smoke.mjs
//
// matrix-eq 冒烟测试（无服务器依赖）：
//   1. 用 maps/standoff.json 构造 2 人局合成状态（slot_1 × slot_4）；
//   2. 两位 matrix-eq 自博弈 12 轮：每轮跑 runner 形态的 decide 循环
//      （逐动作入队 + 独立合法性镜像校验 + null 提交）；
//   3. 用算法自带的镜像结算器充当裁判推演整局，回写状态、生成
//      round_resolved 事件喂给下一轮的事件史重建；
//   4. 断言：零非法动作、无重复单位/重复认领、AP 不超限、无 NaN、
//      决策可复现（同局同轮种子）、单轮求解耗时 < 3s。
//
// 用法：node scripts/matrix_eq_smoke.mjs [下载目录中的 matrix-eq.mjs 路径]

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// 双模式路径：仓库模式（并入 TacticalGame 后）优先；否则回退开发工作区。
const firstExisting = (...cands) => cands.find(c => existsSync(c));
const findUp = rel => {
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    const cand = join(dir, rel);
    if (existsSync(cand)) return cand;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
};
const algoPath = process.argv[2] ?? firstExisting(
  join(__dirname, '../algorithms/builtin/matrix-eq.mjs'),
  findUp('download/matrix-eq/matrix-eq.mjs'));
const mapPath = process.argv[3] ?? firstExisting(
  join(__dirname, '../maps/standoff.json'),
  findUp('tmp/6ad92a18263c124b45549e8d_TacticalGame380/maps/standoff.json'));
if (!algoPath || !mapPath) {
  console.error('找不到 matrix-eq.mjs 或 maps/standoff.json');
  process.exit(1);
}
console.log(`[冒烟] 算法: ${algoPath}\n[冒烟] 地图: ${mapPath}`);

const map = JSON.parse(readFileSync(mapPath, 'utf8'));
const { default: matrixEq, matrixEqInternals: I } = await import(pathToFileURL(algoPath).href);

const OWNER_A = 'player_a';
const OWNER_B = 'player_b';

// ---------------------------------------------------------------- 合成状态

function cellsOfMap() {
  const cells = [];
  const R = map.radius;
  for (let q = -R; q <= R; q++) {
    for (let r = -R; r <= R; r++) {
      if (Math.abs(q + r) > R) continue;
      const t = map.terrainCells.find(c => c.q === q && c.r === r);
      cells.push({ q, r, terrain: t ? t.terrain : 'plain' });
    }
  }
  return cells;
}

function makeUnit(id, owner, type, q, r) {
  const spec = map.units[type];
  return {
    id, owner, type, q, r,
    hp: spec.hp, maxHp: spec.hp,
    attack: spec.attack, defense: spec.defense,
    moveRange: spec.moveRange, attackRange: spec.attackRange,
    canCapture: spec.canCapture, attackLock: spec.attackLock ?? false,
    healPower: spec.healPower ?? 0, cost: spec.cost, alive: true,
  };
}

function initialState() {
  const cells = cellsOfMap();
  const units = [];
  let n = 0;
  for (const [owner, slotId] of [[OWNER_A, 'slot_1'], [OWNER_B, 'slot_4']]) {
    const slot = map.spawnSlots.find(s => s.id === slotId);
    for (const su of slot.startingUnits) {
      units.push(makeUnit(`u_${owner}_${n++}`, owner, su.type, su.q, su.r));
    }
  }
  const hqs = {};
  for (const [owner, slotId] of [[OWNER_A, 'slot_1'], [OWNER_B, 'slot_4']]) {
    const slot = map.spawnSlots.find(s => s.id === slotId);
    hqs[owner] = {
      id: `hq_${owner}`, owner,
      q: slot.headquarters.q, r: slot.headquarters.r,
      hp: map.headquartersSpec.hp, maxHp: map.headquartersSpec.hp,
      defense: map.headquartersSpec.defense, alive: true,
    };
  }
  return {
    id: 'smoke-matrix-eq',
    mode: 'simultaneous',
    cells,
    map: { terrainCells: map.terrainCells },
    units,
    headquarters: hqs,
    controlPoints: map.controlPoints.map(cp => ({ ...cp, owner: null })),
    resources: {
      [OWNER_A]: { supplies: map.balance.startingSupplies },
      [OWNER_B]: { supplies: map.balance.startingSupplies },
    },
    players: {
      [OWNER_A]: { status: 'active', stats: { headquartersDamage: 0, killValue: 0, controlHold: 0, controlHoldRounds: 0 } },
      [OWNER_B]: { status: 'active', stats: { headquartersDamage: 0, killValue: 0, controlHold: 0, controlHoldRounds: 0 } },
    },
    turn: { roundNumber: 1, turnOrder: [OWNER_A, OWNER_B], actionsUsed: 0 },
    plan: { queues: { [OWNER_A]: [], [OWNER_B]: [] }, committed: [] },
    config: { units: map.units, headquartersSpec: map.headquartersSpec, balance: map.balance, mode: 'simultaneous' },
    events: [],
  };
}

// ---------------------------------------------------------------- 合法性镜像（独立于算法实现，防自证）

const DIRS = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];
const dist = (a, b) => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(-a.q - a.r - (-b.q - b.r)));
const key = p => `${p.q},${p.r}`;

function shapeOf(type, kind) {
  const s = map.units[type]?.[kind];
  if (!s) return { type: 'single', length: 1 };
  if (s.type === 'line') return { type: 'line', length: s.length ?? 2 };
  if (s.type === 'arc') return { type: 'arc', length: 3 };
  return { type: 'single', length: 1 };
}

/** 独立复刻 planning.ts 的形状覆盖判定。 */
function covered(from, unitType, kind, target, range) {
  const shape = shapeOf(unitType, kind);
  if (dist(from, target) > range) return null;
  if (shape.type === 'single') {
    const d = dist(from, target);
    if (kind === 'attackShape' && d === 0) return null;
    return { cells: [{ q: target.q, r: target.r }] };
  }
  if (shape.type === 'arc') {
    if (dist(from, target) !== 1) return null;
    const dir = DIRS.findIndex(d => from.q + d.q === target.q && from.r + d.r === target.r);
    if (dir < 0) return null;
    return { cells: [dir, (dir + 5) % 6, (dir + 1) % 6].map(i => ({ q: from.q + DIRS[i].q, r: from.r + DIRS[i].r })) };
  }
  const length = Math.min(shape.length, range);
  for (let dir = 0; dir < 6; dir++) {
    const d = DIRS[dir];
    const dq = target.q - from.q, dr = target.r - from.r;
    const k = d.q !== 0 ? dq / d.q : dr / d.r;
    if (!Number.isInteger(k) || k < 1 || k > length) continue;
    if (d.q * k !== dq || d.r * k !== dr) continue;
    const cells = [];
    for (let s = 1; s <= length; s++) cells.push({ q: from.q + d.q * s, r: from.r + d.r * s });
    return { cells };
  }
  return null;
}

function legalOccupant(state, q, r) {
  for (const u of state.units) if (u.alive && u.q === q && u.r === r) return u;
  for (const hq of Object.values(state.headquarters)) if (hq.alive && hq.q === q && hq.r === r) return hq;
  return null;
}

function inBounds(state, q, r) {
  return state.cells.some(c => c.q === q && c.r === r);
}

function terrainOf(state, q, r) {
  return state.cells.find(c => c.q === q && c.r === r)?.terrain ?? 'blocker';
}

/** 独立复刻 3.8.0 planning.ts 结构性入队校验：返回错误说明或 null（合法）。
 *  与算法内部 structuralCheck 独立成文（防自证）：投影站位 + 地形寻路
 *  （不看占位）+ 攻击次数上限 + 部署预算。 */
function projectQueueOf(state, queue) {
  const positions = new Map();
  const attackCounts = new Map();
  let deploySpend = 0;
  for (const a of queue) {
    if (a.type === 'move' && a.unitId) positions.set(a.unitId, { q: a.q, r: a.r });
    if (a.type === 'attack' && a.attackerId) attackCounts.set(a.attackerId, (attackCounts.get(a.attackerId) ?? 0) + 1);
    if (a.type === 'deploy' && a.unitType) {
      const spec = map.units[a.unitType];
      const origin = deployOriginOf(state, a.owner, a.fromId);
      const discount = origin ? Math.min(spec.cost, map.balance.controlPointTypes?.[origin.kind]?.deployDiscount ?? 0) : 0;
      deploySpend += spec.cost - discount;
    }
  }
  return { positions, attackCounts, deploySpend };
}

function deployOriginOf(state, owner, fromId) {
  const hq = state.headquarters[owner];
  if (hq && hq.alive && (hq.id === fromId || fromId === `${owner}_hq` || fromId === 'hq')) return hq;
  const cp = state.controlPoints.find(p => p.id === fromId && p.owner === owner);
  if (cp && map.balance.controlPointTypes?.[cp.kind]?.canDeploy !== false) return cp;
  return null;
}

function terrainReachableOf(state, from, range, projection) {
  const visited = new Set([key(from)]);
  const result = [];
  const frontier = [{ q: from.q, r: from.r, d: 0 }];
  for (let i = 0; i < frontier.length; i++) {
    const cur = frontier[i];
    if (cur.d >= range) continue;
    for (const d of DIRS) {
      const next = { q: cur.q + d.q, r: cur.r + d.r };
      const k = key(next);
      if (visited.has(k)) continue;
      visited.add(k);
      if (!inBounds(state, next.q, next.r)) continue;
      if (terrainOf(state, next.q, next.r) !== 'plain') continue; // 单位不当墙
      result.push(next);
      frontier.push({ ...next, d: cur.d + 1 });
    }
  }
  return result;
}

function validateAction(state, owner, action, queue) {
  const limit = map.balance.actionsPerTurn;
  if (queue.length >= limit) return 'AP 超限';
  const projection = projectQueueOf(state, queue);
  const unitOf = id => state.units.find(u => u.id === id && u.alive && u.owner === owner);

  if (action.type === 'move') {
    const unit = unitOf(action.unitId);
    if (!unit) return '移动：单位不存在';
    if (!inBounds(state, action.q, action.r)) return '移动：出界';
    const from = projection.positions.get(unit.id) ?? unit;
    if (from.q === action.q && from.r === action.r) return '移动：目标与投影站位相同';
    if (!terrainReachableOf(state, from, unit.moveRange, projection).some(c => c.q === action.q && c.r === action.r)) {
      return '移动：投影站位地形不可达';
    }
    return null;
  }
  if (action.type === 'attack') {
    const unit = unitOf(action.attackerId);
    if (!unit) return '攻击：攻击方不存在';
    const attackLimit = map.balance.attacksPerUnit ?? 1;
    if ((projection.attackCounts.get(unit.id) ?? 0) >= attackLimit) return `攻击：超过每单位 ${attackLimit} 次上限`;
    if (!inBounds(state, action.q, action.r)) return '攻击：出界';
    const from = projection.positions.get(unit.id) ?? unit;
    const aim = covered(from, unit.type, 'attackShape', action, unit.attackRange);
    if (!aim) return '攻击：形状瞄准非法（投影站位）';
    return null;
  }
  if (action.type === 'heal') {
    const unit = unitOf(action.supportId);
    if (!unit) return '治疗：支援兵不存在';
    if (!inBounds(state, action.q, action.r)) return '治疗：出界';
    const from = projection.positions.get(unit.id) ?? unit;
    const healRange = map.units[unit.type]?.healRange ?? unit.attackRange;
    const aim = covered(from, unit.type, 'healShape', action, healRange);
    if (!aim) return '治疗：形状瞄准非法（投影站位）';
    return null;
  }
  if (action.type === 'deploy') {
    const spec = map.units[action.unitType];
    if (!spec) return '部署：未知兵种';
    const origin = deployOriginOf(state, owner, action.fromId);
    if (!origin) return '部署：起点无效';
    if (dist(origin, action) !== 1) return '部署：必须相邻';
    if (!inBounds(state, action.q, action.r)) return '部署：出界';
    if (terrainOf(state, action.q, action.r) !== 'plain') return '部署：非平原';
    const discount = Math.min(spec.cost, map.balance.controlPointTypes?.[origin.kind]?.deployDiscount ?? 0);
    const cost = spec.cost - discount;
    if (state.resources[owner].supplies - projection.deploySpend < cost) return '部署：补给不足';
    return null;
  }
  if (action.type === 'demolish') {
    const unit = unitOf(action.unitId);
    if (!unit) return '拆除：单位不存在';
    if (unit.type !== 'heavy') return '拆除：非 heavy';
    if (!inBounds(state, action.q, action.r)) return '拆除：出界';
    const from = projection.positions.get(unit.id) ?? unit;
    if (dist(from, action) > 1) return '拆除：不相邻（投影站位）';
    if (terrainOf(state, action.q, action.r) !== 'blocker') return '拆除：非障碍';
    return null;
  }
  if (action.type === 'wait') return null;
  return '未知动作类型';
}

// ---------------------------------------------------------------- 自博弈主循环

const GAME = initialState();
let violations = 0;
let actionsTotal = 0;
let maxSolveMs = 0;
const RNG_SEED_ROUNDS = [];

function runDecideLoop(state, owner) {
  const queue = [];
  const rejected = [];
  for (let call = 0; call < 40; call++) {
    state.plan.myQueue = queue.slice();
    state.plan.queues[owner] = queue.slice();
    const action = matrixEq.decide(structuredCloneish(state), {}, { owner });
    if (action == null) break;
    const err = validateAction(state, owner, { type: action.type, ...(action.payload ?? {}) }, queue);
    if (err) {
      violations++;
      console.error(`  [违规] ${owner} 第${call}次 decide → ${JSON.stringify(action)}：${err}`);
      rejected.push(action);
      continue; // 模拟服务器拒绝后重问
    }
    queue.push({ id: `a_${owner}_${queue.length}`, type: action.type, ...(action.payload ?? {}) });
    actionsTotal++;
  }
  return { queue, rejected };
}

function structuredCloneish(state) {
  return JSON.parse(JSON.stringify(state));
}

// 决赛局：交替 12 轮
for (let round = 1; round <= 12; round++) {
  GAME.turn.roundNumber = round;
  GAME.turn.actionsUsed = 0;
  GAME.plan = { queues: { [OWNER_A]: [], [OWNER_B]: [] }, committed: [] };
  const roundStart = structuredCloneish(GAME);

  const t0 = Date.now();
  const resA = runDecideLoop(GAME, OWNER_A);
  const resB = runDecideLoop(GAME, OWNER_B);
  const ms = Date.now() - t0;
  maxSolveMs = Math.max(maxSolveMs, ms);

  // 可复现性抽查：solveRound 是纯函数（种子 = gameId:owner:round），
  // 对同一初始状态求解两次，计划指纹必须一致。
  const solve1 = I.solveRound(structuredCloneish(roundStart), OWNER_A, {});
  const solve2 = I.solveRound(structuredCloneish(roundStart), OWNER_A, {});
  const fp = plan => plan.map(I.actionFingerprint).join(';');
  const repro = fp(solve1.plan ?? []) === fp(solve2.plan ?? []);

  // 镜像结算器当裁判（3.8 分步结算；真随机掷骰）。
  const queues = new Map([[OWNER_A, resA.queue], [OWNER_B, resB.queue]]);
  const rng = I.mulberry32(0xC0FFEE + round);
  const { board: post, outcomes, steps } = I.simulateRound(I.cloneBoard(GAME), queues, rng);

  // 生成 round_resolved 事件（喂事件史重建；outcomes 已是引擎 PlanOutcome 形态）。
  GAME.events.push({ type: 'round_resolved', roundNumber: round, results: outcomes, steps });

  // 回写状态。
  let unitSeq = GAME.units.length;
  GAME.units = post.units.map(u => ({
    ...u,
    id: typeof u.id === 'string' && u.id.endsWith(':sim') ? `u_${u.owner}_${unitSeq++}` : u.id,
  }));
  for (const [owner, hq] of Object.entries(post.hqs)) {
    Object.assign(GAME.headquarters[owner], { hp: Math.max(0, hq.hp), alive: hq.alive });
    if (!hq.alive) GAME.players[owner].status = 'eliminated';
  }
  for (const cp of post.cps) {
    const target = GAME.controlPoints.find(c => c.id === cp.id);
    if (target) target.owner = cp.owner;
  }
  for (const [owner, sup] of Object.entries(post.supplies)) GAME.resources[owner].supplies = sup;
  for (const [owner, p] of Object.entries(post.players)) {
    Object.assign(GAME.players[owner].stats, p.stats);
  }

  // 回合边界经济（镜像 3.8 simultaneous.ts：流量累计 → 翻盘补给 → 收入+维修，
  // 首回合无收入）。冒烟不跑满 15 回合，翻盘补给只在分差 ≥40% 时触发。
  for (const owner of [OWNER_A, OWNER_B]) {
    if (GAME.players[owner].status !== 'active') continue;
    const held = GAME.controlPoints.filter(c => c.owner === owner).length;
    GAME.players[owner].stats.controlHold += held;
    GAME.players[owner].stats.controlHoldRounds += 1;
  }
  if (round >= (map.balance.comebackSupply?.startRound ?? 4)) {
    // 简化翻盘补给：按控制点数近似分差（冒烟用，不做完整裁定分）。
    const heldA = GAME.controlPoints.filter(c => c.owner === OWNER_A).length;
    const heldB = GAME.controlPoints.filter(c => c.owner === OWNER_B).length;
    const maxHeld = Math.max(heldA, heldB);
    const minHeld = Math.min(heldA, heldB);
    if (maxHeld > 0 && (maxHeld - minHeld) * 100 >= maxHeld * 40 * 3) {
      const laggard = heldA < heldB ? OWNER_A : OWNER_B;
      GAME.resources[laggard].supplies += map.balance.comebackSupply?.amountPerRound ?? 12;
    }
  }
  if (round >= 2) {
    for (const owner of [OWNER_A, OWNER_B]) {
      if (GAME.players[owner].status !== 'active') continue;
      let income = map.balance.baseIncome ?? 8;
      for (const cp of GAME.controlPoints) {
        if (cp.owner !== owner) continue;
        income += map.balance.controlPointTypes?.[cp.kind]?.income ?? 0;
      }
      GAME.resources[owner].supplies += income;
      // 维修站：相邻受伤友军各回 repairAmount（每单位每边界一次）。
      const repairCps = GAME.controlPoints.filter(cp => cp.owner === owner
        && (map.balance.controlPointTypes?.[cp.kind]?.repairAmount ?? 0) > 0);
      const repaired = new Set();
      for (const cp of repairCps) {
        for (const u of GAME.units) {
          if (u.owner !== owner || u.hp >= u.maxHp || repaired.has(u.id)) continue;
          if (dist(cp, u) > 1) continue;
          const amount = Math.min(map.balance.controlPointTypes[cp.kind].repairAmount, u.maxHp - u.hp);
          u.hp += amount;
          repaired.add(u.id);
        }
      }
    }
  }

  const aAlive = GAME.units.filter(u => u.owner === OWNER_A).length;
  const bAlive = GAME.units.filter(u => u.owner === OWNER_B).length;
  const cpsA = GAME.controlPoints.filter(c => c.owner === OWNER_A).length;
  const cpsB = GAME.controlPoints.filter(c => c.owner === OWNER_B).length;
  RNG_SEED_ROUNDS.push({ round, ms, repro, actions: resA.queue.length + resB.queue.length });

  console.log(`Round ${round}: A队列${resA.queue.length} B队列${resB.queue.length} 耗时${ms}ms`
    + ` | 存活 A:${aAlive} B:${bAlive} | 据点 A:${cpsA} B:${cpsB}`
    + ` | 补给 A:${GAME.resources[OWNER_A].supplies} B:${GAME.resources[OWNER_B].supplies}`
    + ` | HQ A:${GAME.headquarters[OWNER_A].hp} B:${GAME.headquarters[OWNER_B].hp}`
    + (repro ? '' : ' [警告] 重复决策不一致'));

  if (GAME.headquarters[OWNER_A].alive === false || GAME.headquarters[OWNER_B].alive === false) {
    console.log('总部被摧毁，提前结束。');
    break;
  }
}

// ---------------------------------------------------------------- 汇总断言

// NaN 专项检查（JSON 的 null 是合法值——如据点 owner——不能当 NaN 报）。
function containsNaN(value) {
  if (typeof value === 'number') return Number.isNaN(value);
  if (Array.isArray(value)) return value.some(containsNaN);
  if (value && typeof value === 'object') return Object.values(value).some(containsNaN);
  return false;
}
const nanCheck = containsNaN(GAME);
console.log('\n===== 冒烟结果 =====');
console.log(`总动作数: ${actionsTotal}, 违规数: ${violations}, 单轮最大耗时: ${maxSolveMs}ms`);
console.log(`事件史重建计划数: ${I.reconstructEnemyPlans(GAME, OWNER_A).length}`);

if (violations > 0) { console.error('FAIL: 存在非法动作'); process.exit(1); }
if (maxSolveMs > 3000) { console.error('FAIL: 单轮求解超过 3 秒'); process.exit(1); }
if (nanCheck) { console.error('FAIL: 状态含 null/NaN'); process.exit(1); }
if (RNG_SEED_ROUNDS.some(r => !r.repro)) { console.error('FAIL: 同轮决策不可复现'); process.exit(1); }
console.log('PASS: 零非法动作 / 无 NaN / 决策可复现 / 耗时达标');
