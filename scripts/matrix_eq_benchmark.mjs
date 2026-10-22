// scripts/matrix_eq_benchmark.mjs
//
// 无服务器基准：matrix-eq vs random-sim / dest-prob 各 30 局（交替座位），
// 外加 dest-prob vs random-sim 30 局作为裁判保真度锚点（仓库文档口径 100:0）。
//
// 裁判 = 算法自带镜像结算器（真随机掷骰模式）+ 引擎回合生命周期镜像：
//   计划（decide 循环 + 独立合法性校验，镜像 interfaces.mjs 拒绝重问语义）
//   → 结算（部署/移动冲突 → 拆除 → 治疗 → 攻击 → 死亡 → 占点）
//   → 流量累计 → 终局判定（HQ 摧毁 / 15 回合裁定）
//   → 翻盘补给（4 回合起，分差 ≥40%） → 边界收入+维修（首回合无收入）
//
// 用法：node scripts/matrix_eq_benchmark.mjs [每对局数=30] [matchup=all|meq-rs|meq-dp|dp-rs]

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const GAMES = Number(process.argv[2] ?? 30);
const WHICH = process.argv[3] ?? 'all';
// 双模式路径解析：仓库模式（本包并入 TacticalGame 仓库后）用仓库自身的
// 算法/地图；包模式回退开发工作区的 3.8.0 仓库副本（对手 .mjs 均为
// "3.7 大脑跑 3.8 引擎"的真实对照）。
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
const MAP_PATH = firstExisting(
  join(ROOT, 'maps/standoff.json'),
  findUp('tmp/6ad92a18263c124b45549e8d_TacticalGame380/maps/standoff.json'));
// v2 = 包内/仓库内的 matrix-eq.mjs；v1 需要外部对照副本（包模式取
// 工作区 3.8.0 仓库内置版；仓库模式下与 v2 同文件时跳过）。
const ALGO_MEQ = firstExisting(
  join(ROOT, 'algorithms/builtin/matrix-eq.mjs'),
  findUp('download/matrix-eq/matrix-eq.mjs'));
const BOT_DIRS = [
  join(ROOT, 'algorithms/builtin'),
  findUp('tmp/6ad92a18263c124b45549e8d_TacticalGame380/algorithms/builtin'),
].filter(Boolean);
const botImport = name => {
  const hit = BOT_DIRS.map(d => join(d, `${name}.mjs`)).find(existsSync);
  if (!hit) throw new Error(`找不到算法 ${name}.mjs（搜索: ${BOT_DIRS.join(', ')}）`);
  return import(pathToFileURL(hit).href);
};
const REPO_LIB = firstExisting(
  join(ROOT, 'algorithms/lib/game-utils.mjs'),
  findUp('tmp/6ad92a18263c124b45549e8d_TacticalGame380/algorithms/lib/game-utils.mjs'));
// v1 对照 = 3.8.0 官方收录的旧版（只在开发工作区副本里；仓库模式下
// 与 v2 同文件，跳过——诚实口径：仓库内无 v1 可对照）。
const V1_PATH = findUp('tmp/6ad92a18263c124b45549e8d_TacticalGame380/algorithms/builtin/matrix-eq.mjs');
const hasV1 = V1_PATH && resolve(V1_PATH) !== resolve(ALGO_MEQ);

const map = JSON.parse(readFileSync(MAP_PATH, 'utf8'));
// v2 = 3.8.0 引擎适配版；裁判（分步结算器/校验器）取自 v2。
const { default: matrixEq, matrixEqInternals: I } = await import(pathToFileURL(ALGO_MEQ).href);
// v1 = 官方收录的旧版（3.7 阶段结算大脑，跑在 3.8 分步引擎上）。
const { default: matrixEqV1 } = hasV1 ? await import(pathToFileURL(V1_PATH).href) : { default: null };
const { default: randomSim } = await botImport('random-sim');
const { default: destProb } = await botImport('dest-prob');
const { default: kriegspiel } = await botImport('kriegspiel');
const utils = await import(pathToFileURL(REPO_LIB).href);
console.log(`[基准] v2: ${ALGO_MEQ}${hasV1 ? ` | v1 对照: ${V1_PATH}` : ''}`);
console.log(`[基准] 地图: ${MAP_PATH}`);

const BOTS = { 'matrix-eq': matrixEq, 'random-sim': randomSim, 'dest-prob': destProb, 'kriegspiel': kriegspiel };
if (matrixEqV1) BOTS['matrix-eq-v1'] = matrixEqV1;
const OWNER_A = 'player_a';
const OWNER_B = 'player_b';
// 回合顺序对照开关：BENCH_TURN_ORDER=ba 时 player_b 先结算/先计划。
const SEAT_ORDER = (process.env.BENCH_TURN_ORDER ?? 'ab') === 'ba'
  ? [OWNER_B, OWNER_A] : [OWNER_A, OWNER_B];


// ---------------------------------------------------------------- 状态构造

let unitSeq = 0;
function mkUnit(owner, type, q, r) {
  const s = map.units[type];
  return {
    id: `u_${owner}_${unitSeq++}`, owner, type, q, r,
    hp: s.hp, maxHp: s.hp, attack: s.attack, defense: s.defense,
    moveRange: s.moveRange, attackRange: s.attackRange,
    canCapture: s.canCapture, attackLock: s.attackLock ?? false,
    healPower: s.healPower ?? 0, cost: s.cost, alive: true,
    hasActed: false, actionSpent: false,
  };
}

function createGame(gameId) {
  const cells = [];
  for (let q = -5; q <= 5; q++) for (let r = -5; r <= 5; r++) {
    if (Math.abs(q + r) > 5) continue;
    const t = map.terrainCells.find(c => c.q === q && c.r === r);
    cells.push({ q, r, terrain: t ? t.terrain : 'plain' });
  }
  const slotA = map.spawnSlots.find(s => s.id === 'slot_1');
  const slotB = map.spawnSlots.find(s => s.id === 'slot_4');
  const units = [];
  for (const su of slotA.startingUnits) units.push(mkUnit(OWNER_A, su.type, su.q, su.r));
  for (const su of slotB.startingUnits) units.push(mkUnit(OWNER_B, su.type, su.q, su.r));
  return {
    id: gameId, mode: 'simultaneous', cells, map: { terrainCells: map.terrainCells },
    units,
    headquarters: {
      [OWNER_A]: { id: `hq_${OWNER_A}`, owner: OWNER_A, q: slotA.headquarters.q, r: slotA.headquarters.r, hp: 200, maxHp: 200, defense: 6, alive: true },
      [OWNER_B]: { id: `hq_${OWNER_B}`, owner: OWNER_B, q: slotB.headquarters.q, r: slotB.headquarters.r, hp: 200, maxHp: 200, defense: 6, alive: true },
    },
    controlPoints: map.controlPoints.map(cp => ({ ...cp, owner: null })),
    resources: { [OWNER_A]: { supplies: 120 }, [OWNER_B]: { supplies: 120 } },
    players: {
      [OWNER_A]: { status: 'active', stats: { headquartersDamage: 0, killValue: 0, controlHold: 0, controlHoldRounds: 0 } },
      [OWNER_B]: { status: 'active', stats: { headquartersDamage: 0, killValue: 0, controlHold: 0, controlHoldRounds: 0 } },
    },
    turn: { roundNumber: 1, turnNumber: 1, turnOrder: SEAT_ORDER, actionsUsed: 0 },
    plan: { queues: { [OWNER_A]: [], [OWNER_B]: [] }, committed: [] },
    config: { units: map.units, headquartersSpec: map.headquartersSpec, balance: map.balance, mode: 'simultaneous' },
    events: [],
  };
}

// ---------------------------------------------------------------- 独立合法性校验（复刻 planning.ts）

const DIRS = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];
const dist = (a, b) => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(-a.q - a.r - (-b.q - b.r)));
const key = p => `${p.q},${p.r}`;

function inBounds(state, q, r) {
  return state.cells.some(c => c.q === q && c.r === r);
}
function terrainOf(state, q, r) {
  const t = state.map.terrainCells.find(c => c.q === q && c.r === r);
  if (t) return t.terrain;
  return state.cells.find(c => c.q === q && c.r === r)?.terrain ?? 'blocker';
}
function covered(unit, type, kind, target, range) {
  const s = map.units[type]?.[kind];
  const shape = !s ? { type: 'single', length: 1 }
    : s.type === 'line' ? { type: 'line', length: s.length ?? 2 }
    : s.type === 'arc' ? { type: 'arc', length: 3 } : { type: 'single', length: 1 };
  if (dist(unit, target) > range) return null;
  if (shape.type === 'single') {
    const d = dist(unit, target);
    if (kind === 'attackShape' && d === 0) return null;
    return { cells: [target] };
  }
  if (shape.type === 'arc') {
    if (dist(unit, target) !== 1) return null;
    const dir = DIRS.findIndex(d => unit.q + d.q === target.q && unit.r + d.r === target.r);
    if (dir < 0) return null;
    return { cells: [(dir + 5) % 6, dir, (dir + 1) % 6].map(i => ({ q: unit.q + DIRS[i].q, r: unit.r + DIRS[i].r })) };
  }
  const dq = target.q - unit.q, dr = target.r - unit.r;
  const length = Math.min(shape.length, range);
  for (let dir = 0; dir < 6; dir++) {
    const d = DIRS[dir];
    const k = d.q !== 0 ? dq / d.q : dr / d.r;
    if (!Number.isInteger(k) || k < 1 || k > length) continue;
    if (d.q * k !== dq || d.r * k !== dr) continue;
    const cells = [];
    for (let step = 1; step <= length; step++) cells.push({ q: unit.q + d.q * step, r: unit.r + d.r * step });
    return { cells };
  }
  return null;
}

function validateAction(state, owner, action, queue) {
  // 3.8.0 结构性校验（独立成文，防自证）：投影站位 + 地形寻路（单位不
  // 当墙）+ 攻击次数上限 + 部署预算；占用/冲突留给结算。
  const limit = map.balance.actionsPerTurn ?? 5;
  if (queue.length >= limit) return '动作数超过行动点上限';
  const positions = new Map();
  const attackCounts = new Map();
  let deploySpend = 0;
  for (const a of queue) {
    if (a.type === 'move' && a.unitId) positions.set(a.unitId, { q: a.q, r: a.r });
    if (a.type === 'attack' && a.attackerId) attackCounts.set(a.attackerId, (attackCounts.get(a.attackerId) ?? 0) + 1);
    if (a.type === 'deploy' && a.unitType) {
      const spec = map.units[a.unitType];
      if (!spec) continue;
      const origin = deployOriginOf(state, owner, a.fromId);
      const discount = origin ? Math.min(spec.cost, map.balance.controlPointTypes?.[origin.kind]?.deployDiscount ?? 0) : 0;
      deploySpend += spec.cost - discount;
    }
  }
  const unitOf = id => state.units.find(u => u.id === id && u.alive && u.owner === owner);
  const projected = id => positions.get(id) ?? unitOf(id);

  if (action.type === 'move') {
    const unit = unitOf(action.unitId);
    if (!unit) return '移动：单位不存在';
    if (!inBounds(state, action.q, action.r)) return '移动：出界';
    const from = projected(action.unitId);
    if (!from) return '移动：单位不存在';
    if (from.q === action.q && from.r === action.r) return '移动：目标与投影站位相同';
    const visited = new Set([key(from)]);
    const frontier = [{ q: from.q, r: from.r, d: 0 }];
    let reachable = false;
    for (let i = 0; i < frontier.length; i++) {
      const cur = frontier[i];
      if (cur.d >= unit.moveRange) continue;
      for (const d of DIRS) {
        const next = { q: cur.q + d.q, r: cur.r + d.r };
        const k = key(next);
        if (visited.has(k)) continue;
        visited.add(k);
        if (!inBounds(state, next.q, next.r)) continue;
        if (terrainOf(state, next.q, next.r) !== 'plain') continue;
        if (next.q === action.q && next.r === action.r) reachable = true;
        frontier.push({ ...next, d: cur.d + 1 });
      }
    }
    if (!reachable) return '移动：投影站位地形不可达';
    return null;
  }
  if (action.type === 'attack') {
    const unit = unitOf(action.attackerId);
    if (!unit) return '攻击：攻击方不存在';
    const attackLimit = map.balance.attacksPerUnit ?? 1;
    if ((attackCounts.get(unit.id) ?? 0) >= attackLimit) return '攻击：超过每单位攻击上限';
    if (!inBounds(state, action.q, action.r)) return '攻击：出界';
    const from = projected(action.attackerId);
    if (!from || !covered(from, unit.type, 'attackShape', action, unit.attackRange)) return '攻击：形状瞄准非法（投影站位）';
    return null;
  }
  if (action.type === 'heal') {
    const unit = unitOf(action.supportId);
    if (!unit) return '治疗：支援兵不存在';
    if (!inBounds(state, action.q, action.r)) return '治疗：出界';
    const from = projected(action.supportId);
    if (!from) return '治疗：单位不存在';
    const healRange = map.units[unit.type]?.healRange ?? unit.attackRange;
    if (!covered(from, unit.type, 'healShape', action, healRange)) return '治疗：形状瞄准非法（投影站位）';
    return null;
  }
  if (action.type === 'deploy') {
    const origin = deployOriginOf(state, owner, action.fromId);
    if (!origin) return '部署：起点无效';
    const spec = map.units[action.unitType];
    if (!spec) return '部署：未知兵种';
    if (dist(origin, action) !== 1) return '部署：必须相邻';
    if (!inBounds(state, action.q, action.r) || terrainOf(state, action.q, action.r) !== 'plain') {
      return '部署：非图内平原';
    }
    const kinds = map.balance.controlPointTypes ?? {};
    const discount = Math.min(spec.cost, kinds[origin.kind]?.deployDiscount ?? 0);
    const cost = spec.cost - discount;
    if (state.resources[owner].supplies - deploySpend < cost) return '部署：补给不足';
    return null;
  }
  if (action.type === 'demolish') {
    const unit = unitOf(action.unitId);
    if (!unit) return '拆除：单位不存在';
    if (unit.type !== 'heavy') return '拆除：非 heavy';
    if (!inBounds(state, action.q, action.r)) return '拆除：出界';
    const from = projected(action.unitId);
    if (!from || dist(from, action) > 1) return '拆除：不相邻（投影站位）';
    if (terrainOf(state, action.q, action.r) !== 'blocker') return '拆除：非障碍';
    return null;
  }
  if (action.type === 'wait') return null;
  return '未知动作类型';
}

function deployOriginOf(state, owner, fromId) {
  const hq = state.headquarters[owner];
  if (hq && hq.alive && (hq.id === fromId || fromId === `${owner}_hq` || fromId === 'hq')) return hq;
  const cp = state.controlPoints.find(p => p.id === fromId && p.owner === owner);
  if (cp && map.balance.controlPointTypes?.[cp.kind]?.canDeploy !== false) return cp;
  return null;
}

// ---------------------------------------------------------------- 计划阶段（镜像 interfaces.mjs）

async function planPhase(state, bot, owner, meter) {
  const queue = [];
  let rejections = 0;
  for (let call = 0; call < 100; call++) {
    state.plan.myQueue = queue.slice();
    state.plan.queues[owner] = queue.slice();
    const snapshot = JSON.parse(JSON.stringify(state));
    const t0 = performance.now();
    let action = null;
    try {
      action = await bot.decide(snapshot, utils, { owner });
    } catch (err) {
      meter.errors++;
      console.error(`    [${owner}] decide 异常: ${err.message}`);
      break;
    }
    meter.decideMs += performance.now() - t0;
    meter.decideCalls++;
    if (action == null) break;
    if (!action.type) break;
    const err = validateAction(state, owner, { type: action.type, ...(action.payload ?? {}) }, queue);
    if (err) {
      rejections++;
      meter.illegal++;
      if (rejections >= 20) break; // 镜像 MAX_REJECTIONS：带着已排计划提交
      continue;
    }
    queue.push({ id: `a_${owner}_${queue.length}`, type: action.type, ...(action.payload ?? {}) });
    meter.actions++;
  }
  return queue;
}

// ---------------------------------------------------------------- 回合生命周期

function applyBoundaryIncome(state, round) {
  // 自第 2 回合起：基础收入 + 据点收入；维修站治疗相邻友军。
  for (const owner of SEAT_ORDER) {
    if (state.players[owner].status !== 'active') continue;
    const base = map.balance.baseIncome ?? 0;
    const owned = state.controlPoints.filter(p => p.owner === owner);
    const inc = owned.reduce((s, p) =>
      s + ((map.balance.controlPointTypes ?? {})[p.kind ?? 'supply']?.income ?? 0), 0);
    state.resources[owner].supplies += base + inc;
    const repaired = new Set();
    for (const p of owned) {
      const repairAmount = (map.balance.controlPointTypes ?? {})[p.kind ?? 'supply']?.repairAmount ?? 0;
      if (repairAmount <= 0) continue;
      for (const u of state.units) {
        if (u.owner !== owner || !u.alive || u.hp >= u.maxHp || repaired.has(u.id)) continue;
        if (dist(p, u) > 1) continue;
        u.hp = Math.min(u.maxHp, u.hp + Math.min(repairAmount, u.maxHp - u.hp));
        repaired.add(u.id);
      }
    }
  }
}

function grantComeback(state, round) {
  const cfg = map.balance.comebackSupply;
  if (!cfg || round < cfg.startRound) return;
  const active = [OWNER_A, OWNER_B].filter(o => state.players[o].status === 'active');
  if (active.length < 2) return;
  const scores = Object.fromEntries(active.map(o => [o, I.scoreOf(I.cloneBoard(state), o)]));
  const leader = Math.max(...active.map(o => scores[o]));
  if (leader <= 0) return;
  for (const o of active) {
    const gap = leader - scores[o];
    if (gap > 0 && gap * 100 >= leader * cfg.scoreGapPercent) {
      state.resources[o].supplies += cfg.amountPerRound;
    }
  }
}

function emitRoundResolved(state, round, queues, preBoard) {
  const results = {};
  for (const [owner, queue] of Object.entries(queues)) {
    results[owner] = queue.map(a => {
      if (a.type === 'move') {
        const u = preBoard.units.find(x => x.id === a.unitId);
        return { type: 'move', owner, status: 'executed', unitId: a.unitId,
          detail: { fromQ: u?.q, fromR: u?.r, toQ: a.q, toR: a.r } };
      }
      if (a.type === 'attack') {
        return { type: 'attack', owner, status: 'executed', unitId: a.attackerId,
          detail: { attackerId: a.attackerId, q: a.q, r: a.r } };
      }
      if (a.type === 'heal') {
        return { type: 'heal', owner, status: 'executed', unitId: a.supportId,
          detail: { supportId: a.supportId, q: a.q, r: a.r } };
      }
      if (a.type === 'deploy') {
        return { type: 'deploy', owner, status: 'executed',
          detail: { cost: map.units[a.unitType]?.cost ?? 0 } };
      }
      return { type: a.type, owner, status: 'executed' };
    });
  }
  state.events.push({ type: 'round_resolved', roundNumber: round, results });
}

async function playGame(gameId, seatA, seatB, rngSeed) {
  const state = createGame(gameId);
  const bots = { [OWNER_A]: BOTS[seatA], [OWNER_B]: BOTS[seatB] };
  const meters = {
    [OWNER_A]: { actions: 0, illegal: 0, errors: 0, decideMs: 0, decideCalls: 0 },
    [OWNER_B]: { actions: 0, illegal: 0, errors: 0, decideMs: 0, decideCalls: 0 },
  };
  const rng = I.mulberry32(rngSeed >>> 0);
  const maxTurns = map.balance.maxTurns ?? 15;
  let winner = null;
  let reason = '';
  let rounds = 0;

  for (let round = 1; round <= maxTurns; round++) {
    rounds = round;
    state.turn.roundNumber = round;
    state.turn.turnNumber = round;
    state.turn.actionsUsed = 0;
    state.plan = { queues: { [OWNER_A]: [], [OWNER_B]: [] }, committed: [] };

    const queues = {};
    for (const owner of SEAT_ORDER) {
      if (state.players[owner].status !== 'active') continue;
      queues[owner] = await planPhase(state, bots[owner], owner, meters[owner]);
    }

    const preBoard = I.cloneBoard(state);
    const queuesMap = new Map(Object.entries(queues).filter(([, q]) => Array.isArray(q)));
    const { board: post, outcomes } = I.simulateRound(preBoard, queuesMap, rng);

    // 回写（3.8 分步结算：sim.units 已过滤死者；新单位重命名防 id 复用）。
    for (const u of post.units) {
      if (typeof u.id === 'string' && u.id.endsWith(':sim')) u.id = `u_${u.owner}_${unitSeq++}`;
    }
    state.units = post.units.map(u => ({ ...u, alive: true, hasActed: false, actionSpent: false }));
    for (const [owner, hq] of Object.entries(post.hqs)) {
      Object.assign(state.headquarters[owner], { hp: Math.max(0, hq.hp), alive: hq.alive });
      if (!hq.alive && state.players[owner].status === 'active') state.players[owner].status = 'eliminated';
    }
    for (const cp of post.cps) {
      const t = state.controlPoints.find(c => c.id === cp.id);
      if (t) t.owner = cp.owner;
    }
    for (const [owner, sup] of Object.entries(post.supplies)) state.resources[owner].supplies = sup;
    for (const [owner, p] of Object.entries(post.players)) Object.assign(state.players[owner].stats, p.stats);

    // 事件：round_resolved 直接用结算器的 PlanOutcome 形态结果（含步序）。
    state.events.push({ type: 'round_resolved', roundNumber: round, results: outcomes });

    // 终局：总部摧毁（2 人局立即分胜负）。
    const hqA = state.headquarters[OWNER_A];
    const hqB = state.headquarters[OWNER_B];
    if (!hqA.alive && !hqB.alive) { winner = 'draw'; reason = 'mutual_destruction'; break; }
    if (!hqA.alive) { winner = OWNER_B; reason = 'headquarters_destroyed'; break; }
    if (!hqB.alive) { winner = OWNER_A; reason = 'headquarters_destroyed'; break; }

    // 流量累计（仅存活着）。
    for (const owner of SEAT_ORDER) {
      if (state.players[owner].status !== 'active') continue;
      state.players[owner].stats.controlHoldRounds += 1;
      state.players[owner].stats.controlHold += state.controlPoints.filter(c => c.owner === owner).length;
    }

    if (round >= maxTurns) {
      const board = I.cloneBoard(state);
      const sA = I.scoreOf(board, OWNER_A);
      const sB = I.scoreOf(board, OWNER_B);
      winner = sA === sB ? 'draw' : (sA > sB ? OWNER_A : OWNER_B);
      reason = sA === sB ? 'turn_limit_draw' : 'turn_limit_score';
      break;
    }

    grantComeback(state, round);
    applyBoundaryIncome(state, round);
  }

  // 汇总。
  const board = I.cloneBoard(state);
  const summarize = owner => ({
    score: I.scoreOf(board, owner),
    cps: state.controlPoints.filter(c => c.owner === owner).length,
    army: state.units.filter(u => u.owner === owner).length,
    armyValue: state.units.filter(u => u.owner === owner)
      .reduce((s, u) => s + Math.round(u.cost * (u.hp / u.maxHp)), 0),
    hqDamage: state.players[owner].stats.headquartersDamage,
    kills: state.players[owner].stats.killValue,
    supplies: state.resources[owner].supplies,
  });
  const winnerName = winner === 'draw' ? 'draw'
    : (winner === OWNER_A ? seatA : seatB);
  return { winner: winnerName, reason, rounds, sA: summarize(OWNER_A), sB: summarize(OWNER_B),
    meters: { [seatA]: meters[OWNER_A], [seatB]: meters[OWNER_B] } };
}

// ---------------------------------------------------------------- 批量对局

async function runMatchup(name, seatA, seatB, count) {
  const wins = { [seatA]: 0, [seatB]: 0, draw: 0 };
  const stats = { [seatA]: [], [seatB]: [] };
  const meters = { [seatA]: { actions: 0, illegal: 0, errors: 0, decideMs: 0, decideCalls: 0 },
    [seatB]: { actions: 0, illegal: 0, errors: 0, decideMs: 0, decideCalls: 0 } };
  let totalRounds = 0;
  const t0 = Date.now();
  for (let i = 0; i < count; i++) {
    const gameId = `bench_${name}_${i}`;
    // 交替座位消除先后手偏差。
    const first = i % 2 === 0;
    const a = first ? seatA : seatB;
    const b = first ? seatB : seatA;
    const res = await playGame(gameId, a, b, (i * 2654435761) + 12345);
    wins[a] += res.winner === a ? 1 : 0;
    wins[b] += res.winner === b ? 1 : 0;
    wins.draw += res.winner === 'draw' ? 1 : 0;
    // 座位无关的战绩归并：奇数局 seatA 坐 OWNER_B。
    const seatAStat = first ? res.sA : res.sB;
    const seatBStat = first ? res.sB : res.sA;
    stats[seatA].push(seatAStat);
    stats[seatB].push(seatBStat);
    for (const k of [a, b]) {
      const m = res.meters[k];
      Object.assign(meters[k], {
        actions: meters[k].actions + m.actions, illegal: meters[k].illegal + m.illegal,
        errors: meters[k].errors + m.errors, decideMs: meters[k].decideMs + m.decideMs,
        decideCalls: meters[k].decideCalls + m.decideCalls,
      });
    }
    totalRounds += res.rounds;
    console.log(`  #${String(i + 1).padStart(2, '0')} ${a.padEnd(10)} vs ${b.padEnd(10)}`
      + ` → ${res.winner.padEnd(10)} ${res.reason.padEnd(22)} ${res.rounds}回合`
      + ` 分差 ${(first ? res.sA.score - res.sB.score : res.sB.score - res.sA.score).toFixed(0).padStart(5)}`
      + (meters[a].illegal + meters[b].illegal > 0 ? ' [有非法]' : ''));
  }
  const avg = arr => arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0;
  const mk = seat => ({
    winRate: wins[seat] / count,
    avgScore: avg(stats[seat].map(s => s.score)),
    avgCps: avg(stats[seat].map(s => s.cps)),
    avgArmyValue: avg(stats[seat].map(s => s.armyValue)),
    avgHqDamage: avg(stats[seat].map(s => s.hqDamage)),
    avgKills: avg(stats[seat].map(s => s.kills)),
    illegal: meters[seat].illegal,
    errors: meters[seat].errors,
    avgDecideMs: meters[seat].decideCalls ? meters[seat].decideMs / meters[seat].decideCalls : 0,
  });
  return { name, count, wins, totalRounds, avgRounds: totalRounds / count, elapsed: Date.now() - t0,
    detail: { [seatA]: mk(seatA), [seatB]: mk(seatB) } };
}

const matchups = [];
if (WHICH === 'all' || WHICH === 'meq-rs') matchups.push(['matrix-eq', 'random-sim']);
if (WHICH === 'all' || WHICH === 'meq-dp') matchups.push(['matrix-eq', 'dest-prob']);
if (WHICH === 'all' || WHICH === 'dp-rs') matchups.push(['dest-prob', 'random-sim']);
if (matrixEqV1 && (WHICH === 'all' || WHICH === 'meq2-v1')) matchups.push(['matrix-eq', 'matrix-eq-v1']);
if (WHICH === 'all' || WHICH === 'meq-krieg') matchups.push(['matrix-eq', 'kriegspiel']);
if (WHICH === 'all' || WHICH === 'krieg-dp') matchups.push(['kriegspiel', 'dest-prob']);
if (WHICH === 'all' || WHICH === 'krieg-rs') matchups.push(['kriegspiel', 'random-sim']);

const results = [];
for (const [a, b] of matchups) {
  console.log(`\n===== ${a} vs ${b}（${GAMES} 局，交替座位）=====`);
  results.push(await runMatchup(`${a}-vs-${b}`, a, b, GAMES));
}

console.log('\n\n==================== 汇总 ====================');
for (const r of results) {
  console.log(`\n【${r.name}】${r.count} 局，平均 ${r.avgRounds.toFixed(1)} 回合，耗时 ${r.elapsed}ms`);
  for (const [seat, d] of Object.entries(r.detail)) {
    console.log(`  ${seat.padEnd(10)} 胜率 ${(d.winRate * 100).toFixed(1)}%`
      + ` | 平均裁定分 ${d.avgScore.toFixed(0)}`
      + ` | 平均据点 ${d.avgCps.toFixed(1)}`
      + ` | 平均军队价值 ${d.avgArmyValue.toFixed(0)}`
      + ` | 平均敌方HQ伤害 ${d.avgHqDamage.toFixed(0)}`
      + ` | 平均击杀价值 ${d.avgKills.toFixed(0)}`
      + ` | 非法动作 ${d.illegal} 异常 ${d.errors}`
      + ` | 单次decide ${d.avgDecideMs.toFixed(1)}ms`);
  }
  console.log(`  平局 ${r.wins.draw} 局`);
}
console.log('\n说明：裁判为引擎镜像结算器（真随机掷骰），胜率数字与真实服务器存在小幅口径差；');
console.log('dest-prob vs random-sim 是裁判保真度锚点（仓库文档口径 100:0）。');
