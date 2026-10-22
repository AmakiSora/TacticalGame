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
const REPO = join(ROOT, 'tmp/6ad92a18263c124b45549e8d_TacticalGame372');
const firstExisting = (...cands) => cands.find(c => existsSync(c));
// 从脚本位置逐级向上找相对路径（兼容 仓库/scripts、包/scripts、工作区/scripts 三种深度）。
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
const GAMES = Number(process.argv[2] ?? 30);
const WHICH = process.argv[3] ?? 'all';

// 双模式路径解析：
//   仓库模式 —— 本包并入 TacticalGame 仓库后，对手算法取自仓库 algorithms/builtin，
//               地图取自仓库 maps/（kriegspiel 存在则自动加入对阵）；
//   包模式   —— 未并入时，取开发工作区解压的 3.7.2/3.7.3 仓库副本。
const MAP_PATH = firstExisting(
  join(ROOT, 'maps/standoff.json'),                                   // 仓库模式
  findUp('tmp/6ad92a18263c124b45549e8d_TacticalGame372/maps/standoff.json')); // 包模式
const ALGO_MEQ = firstExisting(
  join(ROOT, 'algorithms/builtin/matrix-eq.mjs'),                     // 仓库/包模式
  findUp('download/matrix-eq/matrix-eq.mjs'));                        // 开发工作区
const REPO_LIB = firstExisting(
  join(ROOT, 'algorithms/lib/game-utils.mjs'),
  findUp('tmp/6ad92a18263c124b45549e8d_TacticalGame372/algorithms/lib/game-utils.mjs'));
const BOT_DIRS = [
  join(ROOT, 'algorithms/builtin'),
  findUp('tmp/6ad92a18263c124b45549e8d_TacticalGame372/algorithms/builtin'),
].filter(Boolean);
const KRIEG_PATH = firstExisting(
  join(ROOT, 'algorithms/builtin/kriegspiel.mjs'),
  findUp('tmp/6ad92a18263c124b45549e8d_TacticalGame373/algorithms/builtin/kriegspiel.mjs'));
const botImport = name => {
  const hit = BOT_DIRS.map(d => join(d, `${name}.mjs`)).find(existsSync);
  if (!hit) throw new Error(`找不到算法 ${name}.mjs（搜索: ${BOT_DIRS.join(', ')}）`);
  return import(pathToFileURL(hit).href);
};

const map = JSON.parse(readFileSync(MAP_PATH, 'utf8'));
const { default: matrixEq, matrixEqInternals: I } = await import(pathToFileURL(ALGO_MEQ).href);
const { default: randomSim } = await botImport('random-sim');
const { default: destProb } = await botImport('dest-prob');
// 3.7.3 新算法：kriegspiel（兵棋推演，rollout 计划搜索）；存在时自动加入对阵。
const { default: kriegspiel } = KRIEG_PATH ? await import(pathToFileURL(KRIEG_PATH).href) : { default: null };
const utils = await import(pathToFileURL(REPO_LIB).href);
console.log(`[基准] matrix-eq: ${ALGO_MEQ}`);
console.log(`[基准] 地图: ${MAP_PATH}${kriegspiel ? '（含 kriegspiel）' : ''}`);

const BOTS = { 'matrix-eq': matrixEq, 'random-sim': randomSim, 'dest-prob': destProb, 'kriegspiel': kriegspiel };
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
  if (queue.length >= (map.balance.actionsPerTurn ?? 5)) return '动作数超过行动点上限';
  const usedUnits = new Set(queue.filter(a => a.unitId || a.attackerId || a.supportId)
    .map(a => a.unitId ?? a.attackerId ?? a.supportId));
  const claimed = new Set(queue.filter(a => a.type === 'move' || a.type === 'deploy').map(key));
  if (action.type === 'move') {
    const unit = state.units.find(u => u.id === action.unitId && u.alive && u.owner === owner);
    if (!unit) return '移动：单位不存在';
    if (unit.q === action.q && unit.r === action.r) return '移动：原地不动';
    if (usedUnits.has(action.unitId)) return '移动：该单位本轮已有计划';
    if (claimed.has(key(action))) return '移动：己方重复认领';
    const occ = new Set(state.units.filter(u => u.alive).map(u => key(u)));
    for (const hq of Object.values(state.headquarters)) if (hq.alive) occ.add(key(hq));
    const visited = new Set([key(unit)]);
    const frontier = [{ q: unit.q, r: unit.r, d: 0 }];
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
        if (occ.has(k)) continue;
        if (next.q === action.q && next.r === action.r) reachable = true;
        frontier.push({ ...next, d: cur.d + 1 });
      }
    }
    if (!reachable) return '移动：目的格不可达';
    return null;
  }
  if (action.type === 'attack') {
    const unit = state.units.find(u => u.id === action.attackerId && u.alive && u.owner === owner);
    if (!unit) return '攻击：攻击方不存在';
    if (usedUnits.has(action.attackerId)) return '攻击：该单位本轮已有计划';
    if (!inBounds(state, action.q, action.r)) return '攻击：出界';
    if (!covered(unit, unit.type, 'attackShape', action, unit.attackRange)) return '攻击：形状瞄准非法';
    return null;
  }
  if (action.type === 'heal') {
    const unit = state.units.find(u => u.id === action.supportId && u.alive && u.owner === owner);
    if (!unit) return '治疗：支援兵不存在';
    if (usedUnits.has(action.supportId)) return '治疗：该单位本轮已有计划';
    if (unit.type !== 'support') return '治疗：非支援兵';
    const healRange = map.units.support.healRange ?? unit.attackRange;
    const aim = covered(unit, unit.type, 'healShape', action, healRange);
    if (!aim) return '治疗：形状瞄准非法';
    const hasFriend = aim.cells.some(c =>
      state.units.some(u => u.alive && u.owner === owner && u.q === c.q && u.r === c.r));
    if (!hasFriend) return '治疗：覆盖内无友军';
    return null;
  }
  if (action.type === 'deploy') {
    if (claimed.has(key(action))) return '部署：己方重复认领';
    const origin = state.headquarters[owner].id === action.fromId
      ? state.headquarters[owner]
      : state.controlPoints.find(p => p.id === action.fromId && p.owner === owner);
    if (!origin) return '部署：起点无效';
    const spec = map.units[action.unitType];
    if (!spec) return '部署：未知兵种';
    if (dist(origin, action) !== 1) return '部署：必须相邻';
    const occupied = state.units.some(u => u.alive && u.q === action.q && u.r === action.r)
      || Object.values(state.headquarters).some(h => h.alive && h.q === action.q && h.r === action.r);
    if (occupied || !inBounds(state, action.q, action.r) || terrainOf(state, action.q, action.r) !== 'plain') {
      return '部署：目标非空平原';
    }
    const kinds = map.balance.controlPointTypes ?? {};
    const discount = origin.id === state.headquarters[owner].id ? 0
      : (kinds[origin.kind]?.deployDiscount ?? 0);
    const cost = spec.cost - Math.min(spec.cost, discount);
    const spent = queue.filter(a => a.type === 'deploy' && a.unitType).reduce((s, a) => {
      const sp = map.units[a.unitType];
      const o = state.controlPoints.find(p => p.id === a.fromId && p.owner === owner);
      const dd = o ? Math.min(sp.cost, kinds[o.kind]?.deployDiscount ?? 0) : 0;
      return s + sp.cost - dd;
    }, 0);
    if (state.resources[owner].supplies - spent < cost) return '部署：补给不足';
    return null;
  }
  return '未知动作类型';
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
    const post = I.simulateRound(preBoard, queuesMap, rng);

    // 回写。
    const deployed = post.units.filter(u => typeof u.id === 'string' && u.id.endsWith(':sim'));
    for (const u of deployed) u.id = `u_${u.owner}_${unitSeq++}`;
    state.units = post.units.filter(u => u.hp > 0).map(u => ({ ...u, alive: true, hasActed: false, actionSpent: false }));
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

    emitRoundResolved(state, round, queues, preBoard);

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
if (kriegspiel) {
  if (WHICH === 'all' || WHICH === 'meq-krieg') matchups.push(['matrix-eq', 'kriegspiel']);
  if (WHICH === 'all' || WHICH === 'krieg-dp') matchups.push(['kriegspiel', 'dest-prob']);
  if (WHICH === 'all' || WHICH === 'krieg-rs') matchups.push(['kriegspiel', 'random-sim']);
} else if (WHICH !== 'all' && ['meq-krieg', 'krieg-dp', 'krieg-rs'].includes(WHICH)) {
  console.error('当前仓库副本未找到 kriegspiel.mjs（需 3.7.3+）');
  process.exit(1);
}

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
