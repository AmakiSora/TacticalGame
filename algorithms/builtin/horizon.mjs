// horizon.mjs — 内置同时回合算法（注册名 horizon）
//
// 视界算法（Horizon，仅同时回合模式）
//
// 同时回合的每一轮都是一次"盲下整份有序计划、按行动点分步同时结算"的博弈。
// 这类博弈里单轮最优常常是多轮陷阱：一轮之内"再挨一下换一格据点"很划算，三轮之后
// 就是总部被斩首。视界算法把每一份候选计划都放进分步结算镜像里真打一遍，再把结算后
// 的棋盘**投影到终局**，用"投影终局分差 → 胜率"给计划定价：
//
//   1. 分步结算镜像：逐条对齐 src/engine/simultaneousResolve.ts 的 resolveRoundSteps
//      （级联预检 → 步初占用 → 到达判定 → 部署 → 移动 → 爆破 → 攻击/治疗 → 死亡），
//      以期望伤害/期望治疗量推进，回合末按引擎口径占点；
//   2. 视界评估（把一轮结算后的棋盘投影到终局，套用 engine.scorePlayer 的同一公式）：
//      - 威胁场：下一轮各方单位对每格每兵种的期望伤害，折算单位存活率与军力；
//      - 据点：到达时间模型——持有方保有到最早的对手到达为止（格上站着单位时对手要先
//        拔点），其后按 exp(−到达轮数/τ) 分摊剩余回合，守点方加成；收入一并计入经济项；
//      - 总部：两轮攻城压力——攻城位一格一人、守方站住的攻城位不可用、守卫火力折算
//        存活率，按每轮行动点预算贪心排出期望伤害；
//      - 胜率：投影终局分差换成胜率（领先时自动保守、落后时自动冒险），歼灭风险按未封顶
//        的攻城压力单独计价，本轮就被歼的局面按"撑到第几步"排序；
//   3. 同构对手：对手计划由同一个规划器站在对手座位上生成（对手眼中其他人静态开火），
//      与"静态开火""扰动贪心""斩首变体"组成加权场景集；
//   4. 束搜索：逐行动点在前缀投影局面上枚举候选，按场景集期望值保留前 B 个前缀；
//   5. 对抗探针：对选出的计划求对手的最优回应，并入场景集后对决赛圈重新排序。
//
// 地图差异（兵种数值、攻击形状、行动点、裁决权重、据点、地形、部署规则）只经
// game.config / game.cells / game.controlPoints 等公开状态进入决策；只读己方
// plan.myQueue，不读取也不推测服务器未下发的对手计划。

const HEX_DIRS = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

/**
 * 读取数值型环境变量（便于标定时扫参），非法值回退默认。
 * @param {string} name
 * @param {number} fallback
 * @returns {number}
 */
function envNumber(name, fallback) {
  const raw = typeof process !== 'undefined' ? process.env?.[name] : undefined;
  const value = raw === undefined || raw === '' ? Number.NaN : Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/** 可调参数（环境变量 HORIZON_*）。 */
const PARAMS = {
  /** 单轮规划墙钟上限（毫秒），到点即收敛到当前最优。 */
  timeBudgetMs: envNumber('HORIZON_TIME_MS', 900),
  /** 己方束宽。 */
  beamWidth: envNumber('HORIZON_BEAM', 3),
  /** 最后一层保留的决赛圈计划数（供对抗探针重排）。 */
  finalists: envNumber('HORIZON_FINALISTS', 8),
  /** 每个单位保留的攻击 / 移动候选数。 */
  attacksPerUnit: envNumber('HORIZON_ATTACK_CANDS', 3),
  movesPerUnit: envNumber('HORIZON_MOVE_CANDS', 5),
  deployCands: envNumber('HORIZON_DEPLOY_CANDS', 4),
  /** 对手同构规划的束宽与候选上限（更省）。 */
  enemyMovesPerUnit: envNumber('HORIZON_ENEMY_MOVE_CANDS', 3),
  /** 单位每轮的有效移动倍数：多行动点让一个单位一轮可连走，但受共享行动点约束。 */
  speedMoves: envNumber('HORIZON_SPEED', 1.5),
  /** 据点争夺期按到达先后分摊的温度（轮）。 */
  cpTau: envNumber('HORIZON_CP_TAU', 1.5),
  /** 持有方单位已守在据点上时的争夺加成。 */
  cpDefend: envNumber('HORIZON_CP_DEFEND', 1.5),
  /** 争夺期里持有方无人在场时的惯性权重，与中立据点的"无人认领"权重。 */
  cpInertia: envNumber('HORIZON_CP_INERTIA', 0.5),
  cpNeutral: envNumber('HORIZON_CP_NEUTRAL', 0.25),
  /** 据点格上站着某方单位时，其余各方要先拔点的额外到达推迟（轮）。 */
  cpOccupyDelay: envNumber('HORIZON_CP_OCCUPY', 1.5),
  /** 据点流量与收入项的整体放大（标定用，默认 1）。 */
  cpBoost: envNumber('HORIZON_CP_BOOST', 1),
  /** 补给的折算价值（相对军力权重）：补给不直接计分，但会变成部队。 */
  supplyValue: envNumber('HORIZON_SUPPLY_VALUE', 0.8),
  /** 下一轮威胁中实际落到某单位头上的比例。 */
  threatShare: envNumber('HORIZON_THREAT', 0.45),
  /** 胜率换算的尺度系数（越小越"果断"）。 */
  sigmaScale: envNumber('HORIZON_SIGMA', 1.0),
  /** 线性分差的打破平局权重（胜率饱和时仍保留梯度）。 */
  linearWeight: envNumber('HORIZON_LINEAR', 0.04),
  /** 斩首变体对手：本轮总部伤害（按总部满血归一）的额外加价。 */
  assaultBonus: envNumber('HORIZON_ASSAULT', 0.8),
  /** 探针之后是否带着探针场景再做一次束搜索（1 开 0 关）。 */
  secondPass: envNumber('HORIZON_SECOND', 0) > 0,
  /** 对抗探针场景的权重。 */
  probeWeight: envNumber('HORIZON_PROBE', 0.3),
  /** 无回合上限地图的投影视界（轮）。 */
  openHorizon: envNumber('HORIZON_OPEN_ROUNDS', 8),
};

// ------------------------------------------------------------------ 小工具

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function logistic(x) {
  if (x > 30) return 1;
  if (x < -30) return 0;
  return 1 / (1 + Math.exp(-x));
}

/** 确定性随机源（扰动对手变体用），不依赖 Math.random，便于复现。 */
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

function hashString(text) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

// ------------------------------------------------------------------ 棋盘模型

/**
 * 由公开快照建立本轮棋盘：格子下标化、邻接表、地形、全源地形距离（只按水/障碍寻路，
 * 与 planning.ts 的计划期寻路同口径——单位与总部不挡路）。
 * @param {object} game
 * @returns {object}
 */
function buildBoard(game) {
  const cells = game.cells ?? [];
  const N = cells.length;
  const CQ = new Int16Array(N);
  const CR = new Int16Array(N);
  const index = new Map();
  const terrain = new Map();
  for (let i = 0; i < N; i++) {
    CQ[i] = cells[i].q;
    CR[i] = cells[i].r;
    const key = `${cells[i].q},${cells[i].r}`;
    index.set(key, i);
    terrain.set(key, cells[i].terrain ?? 'plain');
  }
  // map.terrainCells 是覆盖层，优先于 cells（与 gameIndex.buildIndex 同序）。
  for (const cell of game.map?.terrainCells ?? []) {
    const key = `${cell.q},${cell.r}`;
    if (index.has(key)) terrain.set(key, cell.terrain);
  }
  const passable = new Uint8Array(N);
  const blocker = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const t = terrain.get(`${CQ[i]},${CR[i]}`);
    passable[i] = t === 'plain' ? 1 : 0;
    blocker[i] = t === 'blocker' ? 1 : 0;
  }
  const nbr = new Int16Array(N * 6).fill(-1);
  for (let i = 0; i < N; i++) {
    for (let d = 0; d < 6; d++) {
      const j = index.get(`${CQ[i] + HEX_DIRS[d].q},${CR[i] + HEX_DIRS[d].r}`);
      if (j !== undefined) nbr[i * 6 + d] = j;
    }
  }
  const board = { N, CQ, CR, index, passable, blocker, nbr, dist: null };
  board.dist = allPairsDistance(board, null);
  return board;
}

/**
 * 全源 BFS 距离（Uint8，255 = 不可达）。进入一格要求该格可通行；起点本身不限。
 * @param {object} board
 * @param {Set<number>|null} cleared 额外视为平地的格（自有爆破的投影）
 */
function allPairsDistance(board, cleared) {
  const { N, nbr, passable } = board;
  const dist = new Uint8Array(N * N).fill(255);
  const queue = new Int16Array(N);
  for (let s = 0; s < N; s++) {
    const base = s * N;
    dist[base + s] = 0;
    let head = 0;
    let tail = 0;
    queue[tail++] = s;
    while (head < tail) {
      const cur = queue[head++];
      const dc = dist[base + cur];
      if (dc >= 254) continue;
      for (let d = 0; d < 6; d++) {
        const nx = nbr[cur * 6 + d];
        if (nx < 0 || dist[base + nx] !== 255) continue;
        if (!passable[nx] && !(cleared && cleared.has(nx))) continue;
        dist[base + nx] = dc + 1;
        queue[tail++] = nx;
      }
    }
  }
  return dist;
}

/** 单源 BFS（带自有爆破投影），只在计划里有爆破时使用。 */
function bfsFrom(board, source, cleared, limit) {
  const { N, nbr, passable } = board;
  const dist = new Uint8Array(N).fill(255);
  const queue = new Int16Array(N);
  let head = 0;
  let tail = 0;
  dist[source] = 0;
  queue[tail++] = source;
  while (head < tail) {
    const cur = queue[head++];
    if (dist[cur] >= limit) continue;
    for (let d = 0; d < 6; d++) {
      const nx = nbr[cur * 6 + d];
      if (nx < 0 || dist[nx] !== 255) continue;
      if (!passable[nx] && !(cleared && cleared.has(nx))) continue;
      dist[nx] = dist[cur] + 1;
      queue[tail++] = nx;
    }
  }
  return dist;
}

function hexDistQR(aq, ar, bq, br) {
  const dq = aq - bq;
  const dr = ar - br;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
}

function cellDist(M, a, b) {
  return hexDistQR(M.board.CQ[a], M.board.CR[a], M.board.CQ[b], M.board.CR[b]);
}

// ------------------------------------------------------------------ 形状（镜像 planning.ts）

/** 与 planning.ts shapeSpecFor 同口径。 */
function shapeOf(spec, kind) {
  const shape = spec?.[kind];
  if (!shape) return { type: 'single', length: 1 };
  if (shape.type === 'line') return { type: 'line', length: shape.length ?? 2 };
  if (shape.type === 'arc') return { type: 'arc', length: 3 };
  return { type: 'single', length: 1 };
}

/**
 * 逐条镜像 planning.ts 的 computeCoveredCells：返回覆盖格坐标（可能含图外格）或 null。
 */
function coveredQR(fromQ, fromR, shape, kind, toQ, toR, range) {
  const dq = toQ - fromQ;
  const dr = toR - fromR;
  const distance = hexDistQR(fromQ, fromR, toQ, toR);
  if (distance > range) return null;
  if (shape.type === 'single') {
    if (kind === 'attackShape' && distance === 0) return null;
    return [[toQ, toR]];
  }
  if (shape.type === 'arc') {
    if (distance !== 1) return null;
    const direction = HEX_DIRS.findIndex(d => d.q === dq && d.r === dr);
    if (direction < 0) return null;
    return [(direction + 5) % 6, direction, (direction + 1) % 6]
      .map(i => [fromQ + HEX_DIRS[i].q, fromR + HEX_DIRS[i].r]);
  }
  const length = Math.min(shape.length, range);
  for (let direction = 0; direction < 6; direction++) {
    const d = HEX_DIRS[direction];
    const k = d.q !== 0 ? dq / d.q : dr / d.r;
    if (!Number.isInteger(k) || k < 1 || k > length) continue;
    if (d.q * k !== dq || d.r * k !== dr) continue;
    const cells = [];
    for (let step = 1; step <= length; step++) cells.push([fromQ + d.q * step, fromR + d.r * step]);
    return cells;
  }
  return null;
}

/**
 * 覆盖格（只保留图内格下标）；瞄准不合法返回 null。按参数缓存（纯函数）。
 */
function coverCells(M, from, type, kind, target, range) {
  const key = `${from}|${target}|${type}|${kind}|${range}`;
  const cached = M.coverCache.get(key);
  if (cached !== undefined) return cached;
  const { CQ, CR, index } = M.board;
  const shape = shapeOf(M.specs[type], kind);
  const qr = coveredQR(CQ[from], CR[from], shape, kind, CQ[target], CR[target], range);
  let result = null;
  if (qr) {
    result = [];
    for (const [q, r] of qr) {
      const i = index.get(`${q},${r}`);
      if (i !== undefined) result.push(i);
    }
  }
  M.coverCache.set(key, result);
  return result;
}

/**
 * 一个单位从某格出发的全部合法瞄准（按覆盖格去重；line 每方向取最近的图内点击格）。
 * @returns {{click: number, cover: number[]}[]}
 */
function aimsFrom(M, from, type, kind, range) {
  const key = `${from}|${type}|${kind}|${range}`;
  const cached = M.aimCache.get(key);
  if (cached) return cached;
  const { N, CQ, CR } = M.board;
  const aims = [];
  const seen = new Set();
  for (let t = 0; t < N; t++) {
    if (hexDistQR(CQ[from], CR[from], CQ[t], CR[t]) > range) continue;
    const cover = coverCells(M, from, type, kind, t, range);
    if (!cover) continue;
    const shape = shapeOf(M.specs[type], kind);
    // attackLock 的单格瞄准以点击格为锁定依据，不能按覆盖去重合并。
    const sig = shape.type === 'single' ? `s${t}` : cover.join(',');
    if (seen.has(sig)) continue;
    seen.add(sig);
    aims.push({ click: t, cover });
  }
  M.aimCache.set(key, aims);
  return aims;
}

/** 期望伤害：E[max(minDmg, atk − def + U{−v..v})]，与 combat.ts computeDamage 同分布。 */
function expDamage(M, atk, def) {
  const key = atk * 4096 + def;
  const cached = M.dmgCache.get(key);
  if (cached !== undefined) return cached;
  const v = M.dmgVar;
  let total = 0;
  for (let k = -v; k <= v; k++) total += Math.max(M.minDmg, atk - def + k);
  const value = total / (2 * v + 1);
  M.dmgCache.set(key, value);
  return value;
}

function expHeal(M, unit) {
  return (unit.heal ?? 0) + M.healVar / 2;
}

function healRangeOf(M, unit) {
  return M.specs[unit.type]?.healRange ?? unit.rng;
}

// ------------------------------------------------------------------ 本轮模型

/**
 * 每轮构建一次的完整模型：棋盘、座位、单位、据点、权重、已入账统计与各类缓存。
 * @param {object} game 公开快照
 * @param {string} owner 己方座位
 */
function buildModel(game, owner) {
  const board = buildBoard(game);
  const balance = game.config?.balance ?? {};
  const weights = balance.adjudicationWeights ?? {};
  const specs = game.config?.units ?? {};
  const turnOrder = game.turn?.turnOrder?.length ? game.turn.turnOrder : Object.keys(game.players ?? {});
  const seats = turnOrder.filter(id => game.players?.[id]?.status === 'active');
  const seatIndex = new Map(seats.map((id, i) => [id, i]));
  const P = seats.length;
  const me = seatIndex.get(owner);
  const round = game.turn?.roundNumber ?? 1;
  const maxTurns = balance.maxTurns === null || balance.maxTurns === undefined ? null : balance.maxTurns;
  const remaining = maxTurns === null ? PARAMS.openHorizon : Math.max(0, maxTurns - round);

  const M = {
    game, owner, board, specs, balance, seats, seatIndex, P, me, round, maxTurns, remaining,
    totalRounds: maxTurns === null ? round + remaining : maxTurns,
    A: balance.actionsPerTurn ?? 5,
    attackLimit: balance.attacksPerUnit ?? 1,
    minDmg: balance.minimumDamage ?? 1,
    dmgVar: balance.damageVarianceRange ?? 0,
    healVar: balance.healVarianceRange ?? 0,
    deployFromHq: balance.deployFromHq !== false,
    W: {
      dmg: weights.enemyHqDamage ?? 0,
      hp: weights.ownHqHp ?? 0,
      cp: weights.controlPoint ?? 0,
      army: weights.armyValue ?? 0,
      sup: weights.supplies ?? 0,
      kill: weights.killValue ?? 0,
      flow: weights.controlPointFlowRatio ?? 0.7,
    },
    coverCache: new Map(),
    aimCache: new Map(),
    dmgCache: new Map(),
    staticCache: new Map(),
    presence: null,
    danger: null,
    deadline: Infinity,
    hardDeadline: Infinity,
    sims: 0,
    assaultSeat: -1,
  };

  const dangerCells = game.artillery?.dangerCells ?? [];
  if (dangerCells.length) {
    M.danger = new Set();
    for (const cell of dangerCells) {
      const i = board.index.get(`${cell.q},${cell.r}`);
      if (i !== undefined) M.danger.add(i);
    }
  }

  // 兵种下标：威胁区、攻城位等缓存都按整数下标索引。
  M.types = Object.keys(specs);
  M.typeIdx = new Map(M.types.map((t, i) => [t, i]));
  M.typeDef = Float64Array.from(M.types.map(t => specs[t].defense ?? 0));
  M.zoneLists = new Array(M.types.length * board.N * 2);
  M.fireArr = new Array(M.types.length * P);

  // 单位：按 game.units 数组顺序（引擎的占位/结算先后都依赖这个顺序）。
  const units = [];
  const unitIndexById = new Map();
  for (const unit of game.units ?? []) {
    if (!unit.alive) continue;
    const seat = seatIndex.get(unit.owner);
    if (seat === undefined) continue;
    const cell = board.index.get(`${unit.q},${unit.r}`);
    if (cell === undefined) continue;
    unitIndexById.set(unit.id, units.length);
    units.push(makeSimUnit(M, unit.id, seat, unit.type, cell, unit));
  }
  M.unitIndexById = unitIndexById;
  M.unitsOfSeat = seats.map((_, s) => units.map((u, i) => (u.seat === s ? i : -1)).filter(i => i >= 0));
  // 锁定射击按"计划时刻点击格上的非己方单位"判定（units 顺序第一个）。
  M.planTimeAt = new Int16Array(board.N).fill(-1);
  for (let i = units.length - 1; i >= 0; i--) M.planTimeAt[units[i].cell] = i;

  // 总部
  M.hqCell = new Int16Array(P).fill(-1);
  M.hqDef = new Float64Array(P);
  M.hqMax = new Float64Array(P);
  M.hqId = new Array(P).fill(null);
  const hqHp = new Float64Array(P);
  const hqAlive = new Uint8Array(P);
  for (let s = 0; s < P; s++) {
    const hq = game.headquarters?.[seats[s]];
    if (!hq) continue;
    const cell = board.index.get(`${hq.q},${hq.r}`);
    if (cell === undefined) continue;
    M.hqCell[s] = cell;
    M.hqDef[s] = hq.defense ?? 0;
    M.hqMax[s] = hq.maxHp ?? hq.hp ?? 0;
    M.hqId[s] = hq.id;
    hqHp[s] = hq.alive ? hq.hp : 0;
    hqAlive[s] = hq.alive ? 1 : 0;
  }

  // 据点
  const typeSpecs = balance.controlPointTypes ?? {};
  M.cps = [];
  const cpOwner = new Int8Array((game.controlPoints ?? []).length).fill(-1);
  (game.controlPoints ?? []).forEach((point, i) => {
    const cell = board.index.get(`${point.q},${point.r}`);
    const kindSpec = point.kind ? typeSpecs[point.kind] ?? null : null;
    M.cps.push({
      id: point.id, cell: cell ?? -1, kind: point.kind,
      income: kindSpec?.income ?? balance.controlPointIncome ?? 0,
      discount: kindSpec?.deployDiscount ?? 0,
      canDeploy: kindSpec?.canDeploy !== false,
    });
    const seat = point.owner ? seatIndex.get(point.owner) : undefined;
    cpOwner[i] = seat === undefined ? -1 : seat;
  });

  const sup = new Float64Array(P);
  for (let s = 0; s < P; s++) sup[s] = game.resources?.[seats[s]]?.supplies ?? 0;
  const active = new Uint8Array(P).fill(1);

  M.st0 = {
    units, hqHp, hqAlive, cpOwner, sup, active,
    hqDmg: new Float64Array(P), kills: new Float64Array(P), cleared: null, over: false,
  };

  // 已入账统计：优先读 players[].stats，缺省回退 adjudication 快照。
  M.bankHqDmg = new Float64Array(P);
  M.bankKills = new Float64Array(P);
  M.bankHold = new Float64Array(P);
  const holdRounds = Math.max(0, round - 1);
  for (let s = 0; s < P; s++) {
    const id = seats[s];
    const stats = game.players?.[id]?.stats;
    const score = game.adjudication?.scores?.[id];
    M.bankHqDmg[s] = stats?.headquartersDamage ?? score?.headquartersDamage ?? 0;
    M.bankKills[s] = stats?.killValue ?? score?.killValue ?? 0;
    if (typeof stats?.controlHold === 'number') M.bankHold[s] = stats.controlHold;
    else if (typeof score?.controlHold === 'number') M.bankHold[s] = score.controlHold * holdRounds;
    else M.bankHold[s] = cpOwner.reduce((n, o) => n + (o === s ? 1 : 0), 0) * holdRounds;
  }

  M.hqMaxAvg = P ? Array.from(M.hqMax).reduce((a, b) => a + b, 0) / P : 1;
  // 胜率换算的单轮摆动尺度：一格据点或一次典型总部命中谁大取谁。
  const hqDefAvg = P ? Array.from(M.hqDef).reduce((a, b) => a + b, 0) / P : 0;
  const hitAvg = M.types.length
    ? M.types.reduce((sum, t) => sum + expDamage(M, specs[t].attack ?? 0, hqDefAvg), 0) / M.types.length
    : 10;
  M.swing = Math.max(1, 1.2 * Math.max(M.W.cp * 1.5, M.W.dmg * hitAvg, 1));

  return M;
}

/** 由快照单位或兵种配置构造结算镜像用的轻量单位。 */
function makeSimUnit(M, id, seat, type, cell, source) {
  const spec = M.specs[type] ?? {};
  const hp = source ? source.hp : spec.hp;
  return {
    id, seat, type, ti: M.typeIdx.get(type) ?? -1, cell,
    hp, maxHp: source ? (source.maxHp ?? spec.hp) : spec.hp,
    atk: source ? (source.attack ?? spec.attack) : spec.attack,
    def: source ? (source.defense ?? spec.defense) : spec.defense,
    mv: source ? (source.moveRange ?? spec.moveRange) : spec.moveRange,
    rng: source ? (source.attackRange ?? spec.attackRange) : spec.attackRange,
    cap: source ? Boolean(source.canCapture ?? spec.canCapture) : Boolean(spec.canCapture),
    heal: source ? (source.healPower ?? spec.healPower ?? 0) : (spec.healPower ?? 0),
    cost: source ? (source.cost ?? spec.cost ?? 0) : (spec.cost ?? 0),
    lock: Boolean(spec.attackLock),
    alive: true,
  };
}

function cloneState(st) {
  const units = new Array(st.units.length);
  for (let i = 0; i < st.units.length; i++) units[i] = { ...st.units[i] };
  return {
    units,
    hqHp: Float64Array.from(st.hqHp),
    hqAlive: Uint8Array.from(st.hqAlive),
    cpOwner: Int8Array.from(st.cpOwner),
    sup: Float64Array.from(st.sup),
    active: Uint8Array.from(st.active),
    hqDmg: Float64Array.from(st.hqDmg),
    kills: Float64Array.from(st.kills),
    cleared: st.cleared ? new Set(st.cleared) : null,
    over: st.over,
  };
}

// ------------------------------------------------------------------ 分步结算镜像（对齐 simultaneousResolve.ts）

function passableNow(M, st, cell) {
  return M.board.passable[cell] === 1 || Boolean(st.cleared && st.cleared.has(cell));
}

function blockerNow(M, st, cell) {
  return M.board.blocker[cell] === 1 && !(st.cleared && st.cleared.has(cell));
}

/** 当前格上的占据者：≥0 单位下标（units 顺序第一个存活），≤ −2 为总部（−2 − seat），−1 空。 */
function occupantNow(M, st, cell) {
  const units = st.units;
  for (let i = 0; i < units.length; i++) {
    if (units[i].alive && units[i].cell === cell) return i;
  }
  for (let s = 0; s < M.P; s++) {
    if (st.hqAlive[s] && M.hqCell[s] === cell) return -2 - s;
  }
  return -1;
}

/** 步初占位快照（captureOccupants 同口径：单位优先、units 顺序第一个）。 */
function occupancySnapshot(M, st) {
  const occ = new Int16Array(M.board.N).fill(-1);
  const units = st.units;
  for (let i = 0; i < units.length; i++) {
    if (units[i].alive && occ[units[i].cell] === -1) occ[units[i].cell] = i;
  }
  for (let s = 0; s < M.P; s++) {
    if (st.hqAlive[s] && M.hqCell[s] >= 0 && occ[M.hqCell[s]] === -1) occ[M.hqCell[s]] = -2 - s;
  }
  return occ;
}

/** 到达判定（solveArrivals 同口径）：同格多到达全失败、阻挡/占用失败、依赖链迭代传播。 */
function solveArrivals(M, st, kept, occ) {
  const failed = new Set();
  const arrivals = [];
  for (const item of kept) if (item.a.k === 'move' || item.a.k === 'deploy') arrivals.push(item);
  if (!arrivals.length) return failed;
  const byCell = new Map();
  const mover = new Map();
  for (const item of arrivals) {
    const list = byCell.get(item.a.c);
    if (list) list.push(item);
    else byCell.set(item.a.c, [item]);
    if (item.a.k === 'move') mover.set(item.a.u, item);
  }
  for (const [cell, list] of byCell) {
    if (list.length > 1) {
      for (const item of list) failed.add(item);
      continue;
    }
    const item = list[0];
    if (!passableNow(M, st, cell)) { failed.add(item); continue; }
    const o = occ[cell];
    if (o === -1) continue;
    if (o <= -2) { failed.add(item); continue; }
    if (!mover.has(o)) failed.add(item);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of arrivals) {
      if (failed.has(item)) continue;
      const o = occ[item.a.c];
      if (o < 0) continue;
      const dependency = mover.get(o);
      if (dependency && failed.has(dependency)) {
        failed.add(item);
        changed = true;
      }
    }
  }
  return failed;
}

function deployDiscount(M, st, seat, fromId) {
  for (let i = 0; i < M.cps.length; i++) {
    if (M.cps[i].id === fromId && st.cpOwner[i] === seat) return M.cps[i].discount;
  }
  return 0;
}

/** 淘汰：单位移除、据点中立、总部归零（markPlayerEliminated 同口径）。 */
function eliminateSeat(M, st, seat) {
  st.active[seat] = 0;
  (st.elimStep ??= new Int8Array(M.P))[seat] = st.step ?? 0;
  st.hqAlive[seat] = 0;
  st.hqHp[seat] = 0;
  for (const unit of st.units) if (unit.seat === seat) unit.alive = false;
  for (let i = 0; i < st.cpOwner.length; i++) if (st.cpOwner[i] === seat) st.cpOwner[i] = -1;
}

/** 攻击与治疗（resolveAttacksAndHeals 同口径；期望伤害/期望治疗）。 */
function resolveCombat(M, st, kept, failedUnits, attackCount) {
  const units = st.units;
  const strikes = [];
  for (const item of kept) {
    if (item.a.k !== 'attack') continue;
    const ui = item.a.u;
    const attacker = units[ui];
    if (!attacker || !attacker.alive || attacker.seat !== item.s) { failedUnits.add(ui); continue; }
    const used = attackCount.get(ui) ?? 0;
    if (used >= M.attackLimit) { failedUnits.add(ui); continue; }
    attackCount.set(ui, used + 1);
    const cover = coverCells(M, attacker.cell, attacker.type, 'attackShape', item.a.c, attacker.rng);
    if (!cover) { failedUnits.add(ui); continue; }
    let lock = -1;
    if (attacker.lock) {
      const at = M.planTimeAt[item.a.c];
      if (at >= 0 && M.st0.units[at].seat !== item.s) lock = at;
    }
    strikes.push({ s: item.s, attacker, cover, lock });
  }
  const heals = [];
  for (const item of kept) {
    if (item.a.k !== 'heal') continue;
    const support = units[item.a.u];
    if (!support || !support.alive || support.seat !== item.s || support.type !== 'support') continue;
    const cover = coverCells(M, support.cell, support.type, 'healShape', item.a.c, healRangeOf(M, support));
    if (!cover) continue;
    if (M.danger && (M.danger.has(support.cell) || cover.some(c => M.danger.has(c)))) continue;
    heals.push({ s: item.s, support, cover });
  }
  for (const heal of heals) {
    for (const cell of heal.cover) {
      let target = null;
      for (const unit of units) {
        if (unit.alive && unit.seat === heal.s && unit.cell === cell) { target = unit; break; }
      }
      if (!target || target.hp >= target.maxHp) continue;
      target.hp += Math.min(target.maxHp - target.hp, expHeal(M, heal.support));
    }
  }
  const deadUnits = [];
  const deadHqs = [];
  const recorded = new Set();
  for (const strike of strikes) {
    const targets = [];
    if (strike.lock >= 0) {
      const entity = units[strike.lock];
      if (entity && entity.alive && cellDist(M, strike.attacker.cell, entity.cell) <= strike.attacker.rng) {
        targets.push(strike.lock);
      }
    } else {
      for (const cell of strike.cover) {
        const o = occupantNow(M, st, cell);
        if (o >= 0) {
          if (units[o].seat !== strike.s) targets.push(o);
        } else if (o <= -2) {
          const seat = -2 - o;
          if (seat !== strike.s) targets.push(o);
        }
      }
    }
    for (const t of targets) {
      if (t >= 0) {
        const entity = units[t];
        const damage = expDamage(M, strike.attacker.atk, entity.def);
        entity.hp = Math.max(0, entity.hp - damage);
        if (entity.hp === 0 && !recorded.has(t)) {
          recorded.add(t);
          deadUnits.push(t);
          if (st.active[strike.s]) st.kills[strike.s] += entity.cost;
        }
      } else {
        const seat = -2 - t;
        const damage = expDamage(M, strike.attacker.atk, M.hqDef[seat]);
        const actual = Math.min(st.hqHp[seat], damage);
        st.hqHp[seat] = Math.max(0, st.hqHp[seat] - damage);
        st.hqDmg[strike.s] += actual;
        const key = -100 - seat;
        if (st.hqHp[seat] === 0 && !recorded.has(key)) {
          recorded.add(key);
          deadHqs.push(seat);
        }
      }
    }
  }
  for (const t of deadUnits) units[t].alive = false;
  for (const seat of deadHqs) eliminateSeat(M, st, seat);
}

/**
 * 单轮分步结算（resolveRoundSteps + 轮末占点）。queues 按座位下标索引。
 * @param {object} M
 * @param {Array<Array<object>>} queues
 * @param {Function} [onStep] 每步结算后的回调（采集对手落点用）
 * @returns {object} 结算后的状态
 */
function simulate(M, queues, onStep) {
  M.sims++;
  const st = cloneState(M.st0);
  const units = st.units;
  let maxSteps = 0;
  for (let s = 0; s < M.P; s++) maxSteps = Math.max(maxSteps, queues[s]?.length ?? 0);
  const failedUnits = new Set();
  const attackCount = new Map();
  for (let step = 1; step <= maxSteps; step++) {
    if (st.over) break;
    st.step = step;
    const kept = [];
    let any = false;
    for (let s = 0; s < M.P; s++) {
      if (!st.active[s]) continue;
      const a = queues[s]?.[step - 1];
      if (!a) continue;
      any = true;
      // 1. 级联预检：单位已亡 → unit_gone；先前硬失败 → previous_action_failed。
      if (a.u !== undefined && a.u >= 0) {
        const unit = units[a.u];
        if (!unit || !unit.alive) { failedUnits.add(a.u); continue; }
        if (failedUnits.has(a.u)) continue;
      }
      kept.push({ s, a });
    }
    if (!any) continue;
    // 2-3. 步初占用快照 + 到达判定
    const occ = occupancySnapshot(M, st);
    const failedArrivals = solveArrivals(M, st, kept, occ);
    // 4. 部署（按座位顺序扣补给）
    for (const item of kept) {
      if (item.a.k !== 'deploy' || failedArrivals.has(item)) continue;
      const spec = M.specs[item.a.ut];
      if (!spec) continue;
      const cost = spec.cost - Math.min(spec.cost, deployDiscount(M, st, item.s, item.a.from));
      if (st.sup[item.s] < cost) continue;
      st.sup[item.s] -= cost;
      units.push(makeSimUnit(M, null, item.s, item.a.ut, item.a.c, null));
    }
    // 5. 移动
    for (const item of kept) {
      if (item.a.k !== 'move') continue;
      const unit = units[item.a.u];
      if (!unit || !unit.alive || unit.seat !== item.s) { failedUnits.add(item.a.u); continue; }
      if (failedArrivals.has(item)) { failedUnits.add(item.a.u); continue; }
      unit.cell = item.a.c;
    }
    // 6. 爆破（清出的平地从下一步起生效）
    let clearedNow = null;
    for (const item of kept) {
      if (item.a.k !== 'demolish') continue;
      const unit = units[item.a.u];
      if (!unit || !unit.alive || unit.seat !== item.s) { failedUnits.add(item.a.u); continue; }
      const c = item.a.c;
      if (unit.type !== 'heavy' || cellDist(M, unit.cell, c) > 1 || !blockerNow(M, st, c)
        || (clearedNow && clearedNow.has(c)) || occupantNow(M, st, c) !== -1) {
        failedUnits.add(item.a.u);
        continue;
      }
      (clearedNow ??= new Set()).add(c);
    }
    if (clearedNow) {
      st.cleared ??= new Set();
      for (const c of clearedNow) st.cleared.add(c);
    }
    // 7-9. 攻击/治疗与死亡淘汰
    resolveCombat(M, st, kept, failedUnits, attackCount);
    // 10. 终局检查
    let activeCount = 0;
    for (let s = 0; s < M.P; s++) activeCount += st.active[s];
    if (activeCount <= 1) st.over = true;
    if (onStep) onStep(step, st);
  }
  if (!st.over) {
    // 轮末占点（captureControlPoints，按 turnOrder 的存活座位顺序）。
    for (let s = 0; s < M.P; s++) {
      if (!st.active[s]) continue;
      for (let i = 0; i < M.cps.length; i++) {
        if (st.cpOwner[i] === s) continue;
        const cell = M.cps[i].cell;
        for (const unit of units) {
          if (unit.alive && unit.seat === s && unit.cap && unit.cell === cell) { st.cpOwner[i] = s; break; }
        }
      }
    }
  }
  return st;
}

// ------------------------------------------------------------------ 威胁区（下一轮）

/**
 * 兵种在某格的可打击格列表：moved=0 为原地可打格，1 为走一次（≤ moveRange）后可打格。
 * 按 (兵种下标, 格, moved) 整数下标缓存。
 */
function zoneList(M, ti, cell, moved) {
  const N = M.board.N;
  const slot = (ti * N + cell) * 2 + moved;
  const cached = M.zoneLists[slot];
  if (cached) return cached;
  const type = M.types[ti];
  const spec = M.specs[type] ?? {};
  const range = spec.attackRange ?? 1;
  const mark = new Uint8Array(N);
  if (!moved) {
    for (const aim of aimsFrom(M, cell, type, 'attackShape', range)) for (const c of aim.cover) mark[c] = 1;
  } else {
    const mv = spec.moveRange ?? 0;
    const base = cell * N;
    for (let y = 0; y < N; y++) {
      if (M.board.dist[base + y] > mv) continue;
      for (const c of zoneList(M, ti, y, 0)) mark[c] = 1;
    }
  }
  const list = [];
  for (let c = 0; c < N; c++) if (mark[c]) list.push(c);
  const result = Int16Array.from(list);
  M.zoneLists[slot] = result;
  return result;
}

/**
 * 下一轮威胁场：fields[seat][ti × N + cell] = 该座位全部单位下一轮对站在 cell 上的
 * ti 兵种的期望伤害之和（原地可打按 1、需走位按 0.65 计）。每次评估只算一遍，
 * 存活率与守卫火力都从这里 O(1) 查表。
 */
function threatFields(M, st) {
  const T = M.types.length;
  const N = M.board.N;
  const fields = new Array(M.P).fill(null);
  for (const v of st.units) {
    if (!v.alive || v.atk <= 0 || v.ti < 0 || !st.active[v.seat]) continue;
    let field = fields[v.seat];
    if (!field) field = fields[v.seat] = new Float64Array(T * N);
    const far = zoneList(M, v.ti, v.cell, 1);
    const near = zoneList(M, v.ti, v.cell, 0);
    for (let t = 0; t < T; t++) {
      const dmg = expDamage(M, v.atk, M.typeDef[t]);
      const base = t * N;
      const farDmg = dmg * 0.65;
      const nearDmg = dmg * 0.35;
      for (let k = 0; k < far.length; k++) field[base + far[k]] += farDmg;
      for (let k = 0; k < near.length; k++) field[base + near[k]] += nearDmg;
    }
  }
  return fields;
}

/** 威胁 → 撑过一轮的近似存活率（k = 落到头上的期望伤害 / 当前血量）。 */
function survivalOf(threat, hp, share) {
  if (threat <= 0) return 1;
  const k = (threat * share) / Math.max(1, hp);
  return 1 / (1 + (k / 0.8) ** 3);
}

/** 各兵种对某总部的可开火格（与 coverCells 同口径推导）。 */
function fireCellsFor(M, ti, seat) {
  const slot = ti * M.P + seat;
  const cached = M.fireArr[slot];
  if (cached) return cached;
  const target = M.hqCell[seat];
  const type = M.types[ti];
  const spec = M.specs[type] ?? {};
  const range = spec.attackRange ?? 1;
  const cells = [];
  if (target >= 0 && (spec.attack ?? 0) > 0) {
    const { N, passable } = M.board;
    for (let y = 0; y < N; y++) {
      if (!passable[y] || y === target) continue;
      if (cellDist(M, y, target) > range) continue;
      if (aimsFrom(M, y, type, 'attackShape', range).some(aim => aim.cover.includes(target))) cells.push(y);
    }
  }
  M.fireArr[slot] = cells;
  return cells;
}

/**
 * p 对 q 总部的两轮攻城压力（期望伤害）。
 * - 攻城位容量：每个攻城位只容一个攻击者（按"步数少、价值高"贪心匹配，每个攻击者只
 *   保留最好的三个攻城位参与匹配），守方单位站住的攻城位不可用（近战贴身封堵）；
 * - 守卫火力：攻击者在攻城位上的价值按守方威胁场折算存活率；
 * - 行动点：每轮 A 点，已在位的先开火，余下点数依次给最近的攻击者走位，走到位还有
 *   点数就补一枪。首轮按 0.85、次轮按 0.5 计入（对方未必全力攻城）。
 */
function siegePressure(M, st, p, q, surv, seatOccupy, window, fields) {
  const units = st.units;
  const { dist, N } = M.board;
  const guardField = fields ? fields[q] : null;
  const pairs = [];
  const local = [];
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (!u.alive || u.seat !== p || u.atk <= 0 || u.ti < 0) continue;
    const cells = fireCellsFor(M, u.ti, q);
    if (!cells.length) continue;
    const hit = expDamage(M, u.atk, M.hqDef[q]);
    const base = u.cell * N;
    local.length = 0;
    for (const y of cells) {
      const o = seatOccupy[y];
      if (o === q) continue;
      if (o >= 0 && o !== p && y !== u.cell) continue;
      const d = dist[base + y];
      if (d === 255) continue;
      const moves = d === 0 ? 0 : Math.ceil(d / Math.max(1, u.mv));
      if (moves > 2 * window) continue;
      const guard = guardField ? survivalOf(guardField[u.ti * N + y], u.hp, PARAMS.threatShare * 1.5) : 1;
      local.push({ i, y, moves, value: hit * guard * (moves > 0 ? surv[i] : 1) });
    }
    local.sort((x, y) => x.moves - y.moves || y.value - x.value);
    for (let k = 0; k < local.length && k < 3; k++) pairs.push(local[k]);
  }
  if (!pairs.length) return 0;
  pairs.sort((x, y) => x.moves - y.moves || y.value - x.value);
  const usedUnit = new Set();
  const usedCell = new Set();
  const list = [];
  for (const pair of pairs) {
    if (usedUnit.has(pair.i) || usedCell.has(pair.y)) continue;
    usedUnit.add(pair.i);
    usedCell.add(pair.y);
    list.push({ moves: pair.moves, hit: pair.value });
  }
  const weights = [0.85, 0.5];
  let total = 0;
  for (let w = 0; w < window; w++) {
    let ap = M.A;
    let dealt = 0;
    for (const u of list) {
      if (u.moves === 0 && ap > 0) { dealt += u.hit; ap--; }
    }
    for (const u of list) {
      if (u.moves === 0 || ap <= 0) continue;
      while (u.moves > 0 && ap > 0) { u.moves--; ap--; }
      if (u.moves === 0 && ap > 0) { dealt += u.hit; ap--; }
    }
    total += weights[w] * dealt;
  }
  // 不在这里按剩余血量封顶：歼灭风险要看"压力是血量的几倍"，封顶后三个攻击者和两个
  // 攻击者都只是"恰好打空"，防守动作就看不出价值；投影分数由调用方按血量封顶。
  return total;
}

// ------------------------------------------------------------------ 视界评估

/**
 * 把结算后的棋盘投影到终局，返回各座位的投影终局分与各座位的歼灭风险。
 * @param {object} M
 * @param {object} st
 * @returns {{S: Float64Array, risk: Float64Array}}
 */
function projectScores(M, st) {
  const units = st.units;
  const nU = units.length;
  const R = M.remaining;
  const P = M.P;
  const { dist, N } = M.board;

  // 1. 下一轮威胁 → 期望掉血与存活率（终局轮之后没有下一轮）
  const fields = R > 0 ? threatFields(M, st) : null;
  const surv = new Float64Array(nU).fill(1);
  const lossArr = new Float64Array(nU);
  if (fields) {
    for (let i = 0; i < nU; i++) {
      const u = units[i];
      if (!u.alive || u.ti < 0) continue;
      let threat = 0;
      const slot = u.ti * N + u.cell;
      for (let s = 0; s < P; s++) if (s !== u.seat && fields[s]) threat += fields[s][slot];
      lossArr[i] = Math.min(u.hp, threat * PARAMS.threatShare);
      surv[i] = survivalOf(threat, u.hp, PARAMS.threatShare);
    }
  }

  // 2. 军力（按下一轮期望掉血折算）
  const army = new Float64Array(P);
  for (let i = 0; i < nU; i++) {
    const u = units[i];
    if (!u.alive) continue;
    army[u.seat] += (u.cost * Math.max(0, u.hp - lossArr[i] * 0.5)) / Math.max(1, u.maxHp);
  }

  // 3. 攻城压力：未来两轮内、按行动点预算贪心排出的最大总部伤害（见 siegePressure）
  const seatOccupy = new Int8Array(N).fill(-1);
  for (const u of units) if (u.alive) seatOccupy[u.cell] = u.seat;
  const futIn = new Float64Array(P);
  const futOut = new Float64Array(P);
  const pairOut = [];
  const pressure = new Float64Array(P);
  const window = Math.min(R, 2);
  for (let q = 0; q < P && window > 0; q++) {
    if (!st.active[q] || !st.hqAlive[q]) continue;
    for (let p = 0; p < P; p++) {
      if (p === q || !st.active[p]) continue;
      const raw = siegePressure(M, st, p, q, surv, seatOccupy, window, fields);
      pressure[q] += raw;
      const total = Math.min(raw, st.hqHp[q]);
      if (total > 0) pairOut.push([p, q, total]);
      futIn[q] += total;
    }
  }
  for (const [p, q, total] of pairOut) {
    const scale = futIn[q] > st.hqHp[q] ? st.hqHp[q] / futIn[q] : 1;
    futOut[p] += total * scale;
  }

  // 4. 据点：到达时间模型。各方最近占点单位的"到达轮数"（受威胁的单位按存活率推迟），
  //    格上站着某方单位时其余各方要先拔点（额外推迟）。持有方保有到最早的对手到达为止，
  //    其后按到达先后的 softmax 分摊剩余回合；终局持有概率同理。
  const holds = new Float64Array(P);
  const income = new Float64Array(P);
  const endProb = new Float64Array(P);
  const held = new Float64Array(P);
  const arrive = new Float64Array(P);
  const weights = new Float64Array(P);
  for (let c = 0; c < M.cps.length; c++) {
    const cell = M.cps[c].cell;
    if (cell < 0) continue;
    const owner = st.cpOwner[c] >= 0 && st.active[st.cpOwner[c]] ? st.cpOwner[c] : -1;
    if (owner >= 0) held[owner] += 1;
    if (R <= 0) continue;
    arrive.fill(Infinity);
    for (let i = 0; i < nU; i++) {
      const u = units[i];
      if (!u.alive || !u.cap || !st.active[u.seat]) continue;
      const d = dist[u.cell * N + cell];
      if (d === 255) continue;
      const rounds = (d === 0 ? 0 : Math.ceil(d / Math.max(1, u.mv * PARAMS.speedMoves))) + (1 - surv[i]) * 2;
      if (rounds < arrive[u.seat]) arrive[u.seat] = rounds;
    }
    const occupant = seatOccupy[cell];
    if (occupant >= 0) {
      for (let s = 0; s < P; s++) if (s !== occupant) arrive[s] += PARAMS.cpOccupyDelay;
    }
    // first：除持有方外最早到达的一方（中立据点则为所有方中最早的）。
    let first = Infinity;
    for (let s = 0; s < P; s++) if (s !== owner && arrive[s] < first) first = arrive[s];
    if (owner < 0) {
      if (first >= R) continue;
    } else {
      const kept = Math.min(R, first);
      holds[owner] += kept;
      income[owner] += kept * M.cps[c].income;
      if (kept >= R) { endProb[owner] += 1; continue; }
    }
    // 争夺期：权重 exp(−到达轮数/τ)，到得越早越强；持有方的单位在对手之前已到位
    // （守着点）再乘守方加成；持有方附近没有占点单位时只剩归属惯性。
    const rest = R - first;
    const firstWeight = Math.exp(-first / PARAMS.cpTau);
    let denom = owner < 0 ? PARAMS.cpNeutral * firstWeight : 0;
    for (let s = 0; s < P; s++) weights[s] = 0;
    for (let s = 0; s < P; s++) {
      if (Number.isFinite(arrive[s])) {
        weights[s] = Math.exp(-arrive[s] / PARAMS.cpTau);
        if (s === owner && arrive[s] <= first) weights[s] *= PARAMS.cpDefend;
      }
      if (s === owner) weights[s] = Math.max(weights[s], PARAMS.cpInertia * firstWeight);
      denom += weights[s];
    }
    if (denom <= 0) continue;
    for (let s = 0; s < P; s++) {
      if (weights[s] <= 0) continue;
      const pi = weights[s] / denom;
      holds[s] += rest * pi;
      income[s] += rest * pi * M.cps[c].income;
      endProb[s] += pi;
    }
  }

  // 5. 投影终局分（engine.scorePlayer 的同一公式）+ 经济项：补给与据点收入不直接计分，
  //    但会在剩余回合里变成部队，按军力权重折算（supplyValue）。
  const W = M.W;
  const supplyWorth = Math.max(W.sup, W.army * PARAMS.supplyValue);
  const S = new Float64Array(P);
  const risk = new Float64Array(P);
  for (let s = 0; s < P; s++) {
    if (!st.active[s]) { S[s] = -Infinity; risk[s] = 1; continue; }
    const holdTotal = M.bankHold[s] + held[s] + holds[s];
    const endHeld = R > 0 ? endProb[s] : held[s];
    const hpLeft = Math.max(0, st.hqHp[s] - Math.min(futIn[s], st.hqHp[s]));
    S[s] = W.dmg * (M.bankHqDmg[s] + st.hqDmg[s] + futOut[s])
      + W.hp * hpLeft
      + PARAMS.cpBoost * W.cp * (W.flow * holdTotal / Math.max(1, M.totalRounds) + (1 - W.flow) * endHeld)
      + W.army * army[s]
      + supplyWorth * (st.sup[s] + PARAMS.cpBoost * income[s])
      + W.kill * (M.bankKills[s] + st.kills[s]);
    risk[s] = st.hqAlive[s] && M.hqCell[s] >= 0
      ? logistic((pressure[s] / Math.max(1, st.hqHp[s]) - 1) * 4)
      : (M.hqCell[s] >= 0 ? 1 : 0);
  }
  return { S, risk };
}

/**
 * 某座位视角的局面价值 ∈ [0, 1]（近似胜率）+ 线性分差的微小打破平局项。
 */
function evaluate(M, st, seat) {
  // 本轮就被歼灭：仍按"撑到第几步"排序——多撑一步，对手偏离预测时就多一分活路。
  if (!st.active[seat]) return -0.5 + 0.1 * ((st.elimStep?.[seat] ?? 0) / (M.A + 1));
  const rivals = [];
  for (let s = 0; s < M.P; s++) if (s !== seat && st.active[s]) rivals.push(s);
  if (!rivals.length) return 1.5;
  const { S, risk } = projectScores(M, st);
  const sigma = M.swing * PARAMS.sigmaScale * Math.sqrt(M.remaining + 1);
  let rivalScore;
  if (rivals.length === 1) {
    rivalScore = S[rivals[0]];
  } else {
    // 多席位：对手分做 log-sum-exp 软最大，压过其中任何一家都不够，要压过"最强那家"。
    const temp = M.swing * 0.5;
    let maxS = -Infinity;
    for (const r of rivals) maxS = Math.max(maxS, S[r]);
    let sum = 0;
    for (const r of rivals) sum += Math.exp((S[r] - maxS) / temp);
    rivalScore = maxS + temp * Math.log(sum) - temp * Math.log(rivals.length) * 0.5;
  }
  const diff = S[seat] - rivalScore;
  const pScore = logistic((1.7 * diff) / sigma);
  const myRisk = risk[seat];
  let value;
  if (rivals.length === 1) {
    const theirRisk = risk[rivals[0]];
    value = (1 - myRisk) * (theirRisk + (1 - theirRisk) * pScore);
  } else {
    value = (1 - myRisk) * pScore;
  }
  if (M.assaultSeat === seat) value += PARAMS.assaultBonus * st.hqDmg[seat] / Math.max(1, M.hqMaxAvg);
  return value + PARAMS.linearWeight * (diff / (M.swing * (M.remaining + 1)));
}

// ------------------------------------------------------------------ 计划期合法性镜像（对齐 planning.ts）

/** 队列前缀投影：虚拟站位、攻击计数、部署花费与落点、自有爆破地形。 */
function projectPrefix(acts) {
  const pos = new Map();
  const attacks = new Map();
  const reserved = new Set();
  let spend = 0;
  let cleared = null;
  for (const a of acts) {
    if (a.k === 'move') pos.set(a.u, a.c);
    else if (a.k === 'attack') attacks.set(a.u, (attacks.get(a.u) ?? 0) + 1);
    else if (a.k === 'deploy') { spend += a.cost; reserved.add(a.c); }
    else if (a.k === 'demolish') (cleared ??= new Set()).add(a.c);
  }
  return { pos, attacks, reserved, spend, cleared };
}

/** 某座位当前合法的部署起点（deployOriginFor 同口径；据点归属按计划时刻）。 */
function deployOrigins(M, seat) {
  const origins = [];
  const st = M.st0;
  if (M.deployFromHq && st.hqAlive[seat] && M.hqCell[seat] >= 0 && M.hqId[seat]) {
    origins.push({ id: M.hqId[seat], cell: M.hqCell[seat], discount: 0 });
  }
  M.cps.forEach((cp, i) => {
    if (st.cpOwner[i] === seat && cp.canDeploy && cp.cell >= 0) {
      origins.push({ id: cp.id, cell: cp.cell, discount: cp.discount });
    }
  });
  return origins;
}

function deployCost(M, type, origin) {
  const cost = M.specs[type]?.cost ?? Infinity;
  return cost - Math.min(cost, origin.discount);
}

/**
 * 在给定前缀后追加动作是否能被引擎计划期校验接受（逐条对齐 planning.ts 的 check*）。
 */
function isLegalNext(M, seat, prefix, a) {
  if (prefix.length >= M.A) return false;
  const proj = projectPrefix(prefix);
  const st = M.st0;
  const terrainPlain = c => M.board.passable[c] === 1 || Boolean(proj.cleared && proj.cleared.has(c));
  if (a.k === 'wait') return true;
  if (a.k === 'deploy') {
    const spec = M.specs[a.ut];
    if (!spec || a.c < 0) return false;
    const origin = deployOrigins(M, seat).find(o => o.id === a.from);
    if (!origin) return false;
    if (M.danger && (M.danger.has(origin.cell) || M.danger.has(a.c))) return false;
    if (cellDist(M, origin.cell, a.c) !== 1) return false;
    if (!terrainPlain(a.c)) return false;
    return st.sup[seat] - proj.spend >= deployCost(M, a.ut, origin);
  }
  const unit = st.units[a.u];
  if (!unit || unit.seat !== seat || !unit.alive || a.c < 0) return false;
  const from = proj.pos.get(a.u) ?? unit.cell;
  if (a.k === 'move') {
    if (from === a.c) return false;
    if (proj.cleared) return bfsFrom(M.board, from, proj.cleared, unit.mv)[a.c] <= unit.mv;
    return M.board.dist[from * M.board.N + a.c] <= unit.mv;
  }
  if (a.k === 'attack') {
    if ((proj.attacks.get(a.u) ?? 0) >= M.attackLimit) return false;
    return coverCells(M, from, unit.type, 'attackShape', a.c, unit.rng) !== null;
  }
  if (a.k === 'heal') {
    if (unit.type !== 'support') return false;
    return coverCells(M, from, unit.type, 'healShape', a.c, healRangeOf(M, unit)) !== null;
  }
  if (a.k === 'demolish') {
    if (unit.type !== 'heavy') return false;
    if (cellDist(M, from, a.c) > 1) return false;
    return M.board.blocker[a.c] === 1 && !(proj.cleared && proj.cleared.has(a.c));
  }
  return false;
}

// ------------------------------------------------------------------ 候选生成

/** 动作签名（顺序敏感的计划签名由逐条拼接）。 */
function actSig(a) {
  switch (a.k) {
    case 'wait': return 'w';
    case 'deploy': return `d${a.ut}@${a.from}>${a.c}`;
    default: return `${a.k[0]}${a.u}>${a.c}`;
  }
}

function planSig(acts) {
  return acts.map(actSig).join(';');
}

/**
 * 单动作静态分（预筛用）：只把这一个变化施加到计划时刻局面上，用视界评估打分。
 * 结果按 (座位, 单位/兵种, 落点) 缓存；与前缀无关，只用于给候选排个先后。
 */
function staticMoveValue(M, seat, ui, cell) {
  const key = `m${seat}|${ui}|${cell}`;
  const cached = M.staticCache.get(key);
  if (cached !== undefined) return cached;
  const st = cloneState(M.st0);
  st.units[ui].cell = cell;
  const value = evaluate(M, st, seat);
  M.staticCache.set(key, value);
  return value;
}

function staticDeployValue(M, seat, type, cell) {
  const key = `d${seat}|${type}|${cell}`;
  const cached = M.staticCache.get(key);
  if (cached !== undefined) return cached;
  const st = cloneState(M.st0);
  st.units.push(makeSimUnit(M, null, seat, type, cell, null));
  const value = evaluate(M, st, seat);
  M.staticCache.set(key, value);
  return value;
}

/**
 * 攻击瞄准的先验分：覆盖格上敌方单位出现概率 × 期望伤害（击杀加成），敌方总部恒中。
 * presence 来自场景集预演（按行动点），没有时退回计划时刻站位。
 */
function aimPrior(M, seat, unit, aim, step, presence) {
  let value = 0;
  const st = M.st0;
  for (const c of aim.cover) {
    for (let q = 0; q < M.P; q++) {
      if (q !== seat && st.hqAlive[q] && M.hqCell[q] === c) value += expDamage(M, unit.atk, M.hqDef[q]) * 3;
    }
  }
  if (unit.lock) {
    const at = M.planTimeAt[aim.click];
    if (at >= 0 && st.units[at].seat !== seat) {
      const target = st.units[at];
      const dmg = expDamage(M, unit.atk, target.def);
      value += dmg * (dmg >= target.hp ? 2.5 : 1) * 0.9;
      return value;
    }
  }
  const table = presence?.[seat]?.[Math.min(step, (presence?.[seat]?.length ?? 1) - 1)];
  for (const c of aim.cover) {
    if (table) {
      const entries = table.get(c);
      if (!entries) continue;
      for (const [targetIndex, prob] of entries) {
        const target = st.units[targetIndex];
        if (!target) continue;
        const dmg = expDamage(M, unit.atk, target.def);
        value += prob * dmg * (dmg >= target.hp ? 2.5 : 1);
      }
    } else {
      const at = M.planTimeAt[c];
      if (at >= 0 && st.units[at].seat !== seat) {
        const target = st.units[at];
        const dmg = expDamage(M, unit.atk, target.def);
        value += 0.5 * dmg * (dmg >= target.hp ? 2.5 : 1);
      }
    }
  }
  return value;
}

/**
 * 给定前缀，为下一个行动点枚举候选（全部通过计划期合法性镜像）。
 * @param {object} M
 * @param {number} seat
 * @param {object[]} prefix
 * @param {object} opts { movesPerUnit, presence }
 */
function generateCandidates(M, seat, prefix, opts) {
  const proj = projectPrefix(prefix);
  const st = M.st0;
  const step = prefix.length;
  const out = [];
  // 本轮计划时刻被占用、结算时注定失败的格：敌方单位当前站位、任何总部、己方投影站位与预留部署格。
  const blocked = new Uint8Array(M.board.N);
  for (let i = 0; i < st.units.length; i++) {
    const u = st.units[i];
    if (!u.alive) continue;
    if (u.seat !== seat) blocked[u.cell] = 1;
    else blocked[proj.pos.get(i) ?? u.cell] = 1;
  }
  for (let s = 0; s < M.P; s++) if (M.hqCell[s] >= 0 && st.hqAlive[s]) blocked[M.hqCell[s]] = 1;
  for (const c of proj.reserved) blocked[c] = 1;

  for (const ui of M.unitsOfSeat[seat]) {
    const unit = st.units[ui];
    if (!unit.alive) continue;
    const from = proj.pos.get(ui) ?? unit.cell;
    // 攻击
    if (unit.atk > 0 && (proj.attacks.get(ui) ?? 0) < M.attackLimit) {
      const scored = [];
      for (const aim of aimsFrom(M, from, unit.type, 'attackShape', unit.rng)) {
        const prior = aimPrior(M, seat, unit, aim, step, opts.presence);
        if (prior > 0.5) scored.push({ prior, a: { k: 'attack', u: ui, c: aim.click } });
      }
      scored.sort((x, y) => y.prior - x.prior);
      for (const item of scored.slice(0, PARAMS.attacksPerUnit)) out.push(item.a);
    }
    // 治疗
    if (unit.type === 'support' && unit.heal > 0) {
      const scored = [];
      for (const aim of aimsFrom(M, from, unit.type, 'healShape', healRangeOf(M, unit))) {
        let gain = 0;
        for (const c of aim.cover) {
          for (const j of M.unitsOfSeat[seat]) {
            const ally = st.units[j];
            if (!ally.alive || (proj.pos.get(j) ?? ally.cell) !== c) continue;
            gain += Math.min(ally.maxHp - ally.hp, expHeal(M, unit));
          }
        }
        if (M.danger && (M.danger.has(from) || aim.cover.some(c => M.danger.has(c)))) gain = 0;
        if (gain > 1) scored.push({ prior: gain, a: { k: 'heal', u: ui, c: aim.click } });
      }
      scored.sort((x, y) => y.prior - x.prior);
      for (const item of scored.slice(0, 2)) out.push(item.a);
    }
    // 移动：地形可达格，排除注定失败的占用格；按静态视界分取前 K
    if (unit.mv > 0) {
      const { N } = M.board;
      const distRow = proj.cleared ? bfsFrom(M.board, from, proj.cleared, unit.mv) : null;
      const scored = [];
      for (let y = 0; y < N; y++) {
        if (y === from || blocked[y]) continue;
        const d = distRow ? distRow[y] : M.board.dist[from * N + y];
        if (d > unit.mv) continue;
        scored.push({ prior: staticMoveValue(M, seat, ui, y), a: { k: 'move', u: ui, c: y } });
      }
      scored.sort((x, y) => y.prior - x.prior);
      const keep = scored.slice(0, opts.movesPerUnit);
      out.push(...keep.map(item => item.a));
    }
    // 爆破
    if (unit.type === 'heavy') {
      for (let d = 0; d < 6; d++) {
        const c = M.board.nbr[from * 6 + d];
        if (c < 0 || M.board.blocker[c] !== 1 || (proj.cleared && proj.cleared.has(c))) continue;
        out.push({ k: 'demolish', u: ui, c });
      }
    }
  }
  // 部署
  const origins = deployOrigins(M, seat);
  if (origins.length && !(M.danger && origins.every(o => M.danger.has(o.cell)))) {
    const budget = st.sup[seat] - proj.spend;
    const scored = [];
    for (const type of Object.keys(M.specs)) {
      for (const origin of origins) {
        const cost = deployCost(M, type, origin);
        if (cost > budget) continue;
        if (M.danger && M.danger.has(origin.cell)) continue;
        for (let d = 0; d < 6; d++) {
          const c = M.board.nbr[origin.cell * 6 + d];
          if (c < 0 || blocked[c]) continue;
          if (!(M.board.passable[c] || (proj.cleared && proj.cleared.has(c)))) continue;
          if (M.danger && M.danger.has(c)) continue;
          scored.push({
            prior: staticDeployValue(M, seat, type, c),
            a: { k: 'deploy', ut: type, from: origin.id, c, cost },
          });
        }
      }
    }
    scored.sort((x, y) => y.prior - x.prior);
    const perType = new Map();
    let taken = 0;
    for (const item of scored) {
      const n = perType.get(item.a.ut) ?? 0;
      if (n >= 2) continue;
      perType.set(item.a.ut, n + 1);
      out.push(item.a);
      if (++taken >= PARAMS.deployCands) break;
    }
  }
  out.push({ k: 'wait' });
  const banned = opts.banned;
  return out.filter(a => !(banned && banned.has(actSig(a))) && isLegalNext(M, seat, prefix, a));
}

// ------------------------------------------------------------------ 计划打分与束搜索

/**
 * 计划在场景集下的期望价值。scenarios: [{ w, queues }]，queues[seat] 为该座位计划；
 * 被评估座位的那一格由 plan 替换。
 */
function scorePlan(M, seat, plan, scenarios, memo) {
  const sig = planSig(plan);
  if (memo) {
    const cached = memo.get(sig);
    if (cached !== undefined) return cached;
  }
  let total = 0;
  let weight = 0;
  for (const scenario of scenarios) {
    const queues = scenario.queues.slice();
    queues[seat] = plan;
    const st = simulate(M, queues);
    total += scenario.w * evaluate(M, st, seat);
    weight += scenario.w;
  }
  const value = weight > 0 ? total / weight : 0;
  if (memo) memo.set(sig, value);
  return value;
}

/**
 * 逐行动点束搜索。
 * @returns {{ plan: object[], value: number, finals: {plan: object[], value: number}[] }}
 */
function beamSearch(M, seat, prefix, scenarios, opts) {
  const memo = new Map();
  const deadline = opts.deadline ?? M.deadline;
  const width = opts.width ?? PARAMS.beamWidth;
  const finalists = opts.finalists ?? width;
  let beam = [{ plan: prefix.slice(), value: scorePlan(M, seat, prefix, scenarios, memo) }];
  let best = beam[0];
  for (let depth = prefix.length; depth < M.A; depth++) {
    const next = [];
    const seen = new Set();
    const lastLayer = depth === M.A - 1;
    for (const node of beam) {
      const candidates = generateCandidates(M, seat, node.plan, opts);
      for (const a of candidates) {
        const plan = node.plan.concat([a]);
        const sig = planSig(plan);
        if (seen.has(sig)) continue;
        seen.add(sig);
        next.push({ plan, value: scorePlan(M, seat, plan, scenarios, memo) });
        if (nowMs() > deadline) break;
      }
      if (nowMs() > deadline) break;
    }
    if (!next.length) break;
    next.sort((x, y) => y.value - x.value);
    beam = next.slice(0, lastLayer ? Math.max(width, finalists) : width);
    if (beam[0].value > best.value || best.plan.length < beam[0].plan.length) best = beam[0];
    if (nowMs() > deadline) break;
  }
  const finals = beam.slice().sort((x, y) => y.value - x.value);
  let top = finals[0] && finals[0].value >= best.value ? finals[0] : best;
  if (top.plan.length < M.A && opts.complete) {
    // 墙钟截断：用主场景单场景打分把剩余行动点贪心补满，不让行动点白白浪费。
    top = completePlan(M, seat, top, scenarios, opts);
  }
  return { plan: top.plan, value: top.value, finals };
}

/** 超时兜底：只用权重最大的场景逐步贪心补全计划（受硬上限 M.hardDeadline 约束）。 */
function completePlan(M, seat, node, scenarios, opts) {
  const main = [scenarios.reduce((a, b) => (b.w > a.w ? b : a))];
  const memo = new Map();
  let current = node;
  while (current.plan.length < M.A && nowMs() < M.hardDeadline) {
    let best = null;
    for (const a of generateCandidates(M, seat, current.plan, { ...opts, movesPerUnit: 2 })) {
      const plan = current.plan.concat([a]);
      const value = scorePlan(M, seat, plan, main, memo);
      if (!best || value > best.value) best = { plan, value };
    }
    if (!best || best.plan[best.plan.length - 1].k === 'wait') break;
    current = best;
  }
  return current;
}

// ------------------------------------------------------------------ 对手模型

/** 静态开火计划（0 阶对手）：不动，原地对当前站位的敌人/敌方总部挑最好的瞄准。 */
function staticFirePlan(M, seat) {
  const st = M.st0;
  const options = [];
  for (const ui of M.unitsOfSeat[seat]) {
    const unit = st.units[ui];
    if (!unit.alive || unit.atk <= 0) continue;
    let best = null;
    for (const aim of aimsFrom(M, unit.cell, unit.type, 'attackShape', unit.rng)) {
      const prior = aimPrior(M, seat, unit, aim, 0, null);
      if (prior > 0.5 && (!best || prior > best.prior)) best = { prior, a: { k: 'attack', u: ui, c: aim.click } };
    }
    if (best) options.push(best);
  }
  options.sort((x, y) => y.prior - x.prior);
  return options.slice(0, M.A).map(item => item.a);
}

/**
 * 场景集：每名对手 {同构贪心, 静态开火, 扰动贪心}；远处对手只用静态开火。
 * 同时记录各场景下对手单位逐步落点，作为己方瞄准的先验。
 */
function buildScenarios(M, deadline) {
  const me = M.me;
  const level0 = M.seats.map((_, s) => staticFirePlan(M, s));
  const relevant = [];
  for (let s = 0; s < M.P; s++) {
    if (s === me) continue;
    relevant.push({ s, d: seatDistance(M, me, s) });
  }
  relevant.sort((x, y) => x.d - y.d);
  // 双人局全量建模；多人局只对最近的两家做同构规划，其余静态开火。
  const modeled = new Set(relevant.slice(0, M.P <= 2 ? 1 : 2).map(item => item.s));
  const greedy = level0.slice();
  const noisy = level0.slice();
  const assault = level0.slice();
  for (const { s } of relevant) {
    if (!modeled.has(s) || nowMs() > deadline) continue;
    const others = level0.slice();
    const base = [{ w: 1, queues: others }];
    greedy[s] = beamSearch(M, s, [], base, {
      width: 1, movesPerUnit: PARAMS.enemyMovesPerUnit, presence: null, deadline,
    }).plan;
    noisy[s] = noisyPlan(M, s, base, deadline);
    // 斩首变体：同一个规划器，但对"本轮打到别人总部的伤害"额外加价。
    if (PARAMS.assaultBonus <= 0) continue;
    M.assaultSeat = s;
    assault[s] = beamSearch(M, s, [], base, {
      width: 1, movesPerUnit: PARAMS.enemyMovesPerUnit, presence: null, deadline,
    }).plan;
    M.assaultSeat = -1;
  }
  const scenarios = PARAMS.assaultBonus > 0 ? [
    { w: 0.40, queues: greedy, tag: 'greedy' },
    { w: 0.20, queues: level0, tag: 'static' },
    { w: 0.25, queues: noisy, tag: 'noisy' },
    { w: 0.15, queues: assault, tag: 'assault' },
  ] : [
    { w: 0.45, queues: greedy, tag: 'greedy' },
    { w: 0.25, queues: level0, tag: 'static' },
    { w: 0.30, queues: noisy, tag: 'noisy' },
  ];
  M.presence = collectPresence(M, scenarios);
  return scenarios;
}

/** 两个座位之间的"接触距离"：双方单位/总部的最近格距。 */
function seatDistance(M, a, b) {
  const st = M.st0;
  const cellsA = M.unitsOfSeat[a].map(i => st.units[i].cell);
  const cellsB = M.unitsOfSeat[b].map(i => st.units[i].cell);
  if (M.hqCell[a] >= 0) cellsA.push(M.hqCell[a]);
  if (M.hqCell[b] >= 0) cellsB.push(M.hqCell[b]);
  let best = Infinity;
  for (const x of cellsA) for (const y of cellsB) best = Math.min(best, cellDist(M, x, y));
  return best;
}

/** 扰动贪心：逐步在前几名候选里按扰动后的分数挑，给出另一份"像样但不同"的计划。 */
function noisyPlan(M, seat, scenarios, deadline) {
  const rng = mulberry32(hashString(`${M.game.id}|${M.round}|${seat}|noisy`));
  const memo = new Map();
  let plan = [];
  for (let depth = 0; depth < M.A; depth++) {
    if (nowMs() > deadline) break;
    const candidates = generateCandidates(M, seat, plan, { movesPerUnit: 2, presence: null });
    let best = null;
    for (const a of candidates) {
      const next = plan.concat([a]);
      const value = scorePlan(M, seat, next, scenarios, memo) + (rng() - 0.5) * 0.08;
      if (!best || value > best.value) best = { plan: next, value };
    }
    if (!best) break;
    plan = best.plan;
  }
  return plan;
}

/**
 * 场景集预演（己方空计划）：各对手单位在每个行动点之后的落点分布。
 * presence[seat][step] : Map<cell, [unitIndex, prob][]>（seat 为"观察者"座位）。
 */
function collectPresence(M, scenarios) {
  const me = M.me;
  const steps = [];
  for (let k = 0; k < M.A; k++) steps.push(new Map());
  let totalW = 0;
  for (const scenario of scenarios) totalW += scenario.w;
  for (const scenario of scenarios) {
    const queues = scenario.queues.slice();
    queues[me] = [];
    const w = scenario.w / Math.max(1e-9, totalW);
    const record = (k, st) => {
      const table = steps[k];
      for (let i = 0; i < M.st0.units.length; i++) {
        const u = st.units[i];
        if (!u.alive || u.seat === me) continue;
        let entries = table.get(u.cell);
        if (!entries) { entries = []; table.set(u.cell, entries); }
        const hit = entries.find(e => e[0] === i);
        if (hit) hit[1] += w;
        else entries.push([i, w]);
      }
    };
    let last = 0;
    const final = simulate(M, queues, (step, st) => {
      // 计划都从第 1 步连续排起，空步只会出现在队尾；中间步按当时站位记。
      for (let k = last; k < step; k++) record(k, st);
      last = step;
    });
    // 对手队列短于行动点：其余步按最终站位记。
    for (let k = last; k < M.A; k++) record(k, final);
  }
  const presence = [];
  presence[me] = steps;
  return presence;
}

// ------------------------------------------------------------------ 规划主流程

/**
 * 本轮整份计划：场景集 → 束搜索 → 对抗探针重排。
 * @param {object} M
 * @param {object[]} prefix 已入队的前缀（内部动作）
 * @param {Set<string>} banned 被引擎拒绝过的动作签名
 */
function planRound(M, prefix, banned) {
  // 分阶段墙钟：对手建模 ≤ 30%，首轮束搜索到 55%，探针 + 带探针场景的二次束搜索到 90%；
  // 超时补全的硬上限 1.1 倍。正常局面远用不满预算（搜索规模由束宽/候选数决定）。
  const start = nowMs();
  const budget = Number.isFinite(M.deadline) ? Math.max(1, M.deadline - start) : Infinity;
  M.hardDeadline = Number.isFinite(budget) ? start + budget * 1.1 : Infinity;
  const scenarios = buildScenarios(M, start + budget * 0.3);
  const opts = {
    width: PARAMS.beamWidth,
    finalists: PARAMS.finalists,
    movesPerUnit: PARAMS.movesPerUnit,
    presence: M.presence,
    banned,
    deadline: start + budget * 0.55,
    complete: true,
  };
  const search = beamSearch(M, M.me, prefix, scenarios, opts);
  let choice = search.plan;
  // 对抗探针：对手针对我方首选计划的最优回应。把它并入场景集后再搜一遍——
  // 首选计划若押注"对手正好这么走"（比如堵住预测中的那一格），会在这里被识破。
  if (nowMs() < M.deadline && PARAMS.probeWeight > 0) {
    const probeQueues = scenarios[0].queues.slice();
    let probed = false;
    for (let s = 0; s < M.P; s++) {
      if (s === M.me || nowMs() > M.deadline) continue;
      if (seatDistance(M, M.me, s) > 8 && M.P > 2) continue;
      const base = scenarios[1].queues.slice();
      base[M.me] = search.plan;
      probeQueues[s] = beamSearch(M, s, [], [{ w: 1, queues: base }], {
        width: 1, movesPerUnit: PARAMS.enemyMovesPerUnit, presence: null,
      }).plan;
      probed = true;
    }
    if (probed) {
      const merged = scenarios.map(sc => ({ ...sc, w: sc.w * (1 - PARAMS.probeWeight) }));
      merged.push({ w: PARAMS.probeWeight, queues: probeQueues, tag: 'probe' });
      const pool = search.finals.slice();
      if (PARAMS.secondPass && nowMs() < start + budget * 0.6) {
        const second = beamSearch(M, M.me, prefix, merged, { ...opts, deadline: start + budget * 0.9 });
        pool.push(...second.finals, { plan: second.plan });
      }
      let best = null;
      const memo = new Map();
      for (const finalist of pool) {
        const value = scorePlan(M, M.me, finalist.plan, merged, memo);
        if (!best || value > best.value) best = { plan: finalist.plan, value };
      }
      if (best) choice = best.plan;
    }
  }
  // 末尾的 wait 不改变任何结算，直接省掉（提前提交）。
  const plan = choice.slice();
  while (plan.length > prefix.length && plan[plan.length - 1].k === 'wait') plan.pop();
  return plan;
}

// ------------------------------------------------------------------ 与引擎/runner 的接口

/** 把 plan.myQueue 的条目解析为内部动作（用于前缀投影与对账）。 */
function parseQueue(M, queue) {
  const acts = [];
  for (const entry of queue ?? []) {
    const cell = typeof entry.q === 'number' ? M.board.index.get(`${entry.q},${entry.r}`) ?? -1 : -1;
    switch (entry.type) {
      case 'wait': acts.push({ k: 'wait' }); break;
      case 'move': acts.push({ k: 'move', u: M.unitIndexById.get(entry.unitId) ?? -1, c: cell }); break;
      case 'attack': acts.push({ k: 'attack', u: M.unitIndexById.get(entry.attackerId) ?? -1, c: cell }); break;
      case 'heal': acts.push({ k: 'heal', u: M.unitIndexById.get(entry.supportId) ?? -1, c: cell }); break;
      case 'demolish': acts.push({ k: 'demolish', u: M.unitIndexById.get(entry.unitId) ?? -1, c: cell }); break;
      case 'deploy': {
        const origin = deployOrigins(M, M.me).find(o => o.id === entry.fromId);
        const spec = M.specs[entry.unitType];
        const cost = spec ? (origin ? deployCost(M, entry.unitType, origin) : spec.cost) : 0;
        acts.push({ k: 'deploy', ut: entry.unitType, from: entry.fromId, c: cell, cost });
        break;
      }
      default: acts.push({ k: 'wait' });
    }
  }
  return acts;
}

/** 内部动作 → decide 返回的动作对象。 */
function toAction(M, a) {
  const { CQ, CR } = M.board;
  const unitId = a.u !== undefined && a.u >= 0 ? M.st0.units[a.u].id : undefined;
  switch (a.k) {
    case 'wait': return { type: 'wait', payload: {} };
    case 'move': return { type: 'move', payload: { unitId, q: CQ[a.c], r: CR[a.c] } };
    case 'attack': return { type: 'attack', payload: { attackerId: unitId, q: CQ[a.c], r: CR[a.c] } };
    case 'heal': return { type: 'heal', payload: { supportId: unitId, q: CQ[a.c], r: CR[a.c] } };
    case 'demolish': return { type: 'demolish', payload: { unitId, q: CQ[a.c], r: CR[a.c] } };
    case 'deploy': return { type: 'deploy', payload: { unitType: a.ut, fromId: a.from, q: CQ[a.c], r: CR[a.c] } };
    default: return null;
  }
}

/** 每轮计划缓存：键 `${gameId}|${owner}|${round}`，只保留最近若干条。 */
const roundCache = new Map();
const ROUND_CACHE_LIMIT = 64;

function rememberRound(key, entry) {
  if (roundCache.size >= ROUND_CACHE_LIMIT) {
    const oldest = roundCache.keys().next().value;
    if (oldest !== undefined) roundCache.delete(oldest);
  }
  roundCache.set(key, entry);
}

/** 两份动作序列是否逐条一致（对账 myQueue 与缓存计划的前缀）。 */
function samePrefix(acts, plan) {
  if (acts.length > plan.length) return false;
  for (let i = 0; i < acts.length; i++) if (actSig(acts[i]) !== actSig(plan[i])) return false;
  return true;
}

export default {
  name: 'horizon',
  description: '视界算法：分步结算镜像 + 多轮视界投影胜率评估 + 同构对手场景 + 束搜索 + 对抗探针',

  /**
   * 同时回合决策入口：每轮首次调用时规划整份有序计划并缓存，之后逐条吐出；
   * 返回 null 表示提交计划。
   * @param {object} game 公开快照（GET /api/games/:id 同口径）
   * @param {object} _utils 框架工具集（本算法自带几何/寻路，不依赖）
   * @param {{owner?: string}} [ctx] ctx.owner 为己方座位
   * @returns {Promise<object|null>}
   */
  async decide(game, _utils, ctx) {
    const owner = ctx?.owner ?? game?.turn?.currentPlayerId;
    if (!owner || !game || game.phase !== 'active') return null;
    // 只注册同时回合；大逃杀的炮火缩圈 / 无总部规则不在镜像与评估里，遇到直接提交。
    if (game.config?.mode !== 'simultaneous') return null;
    if (game.players?.[owner]?.status !== 'active') return null;
    if ((game.plan?.committed ?? []).includes(owner)) return null;
    const budget = game.config?.balance?.actionsPerTurn ?? 5;
    const queue = game.plan?.myQueue ?? [];
    if (queue.length >= budget) return null;

    const key = `${game.id}|${owner}|${game.turn?.roundNumber ?? 0}`;
    let entry = roundCache.get(key);
    try {
      const M = buildModel(game, owner);
      if (M.me === undefined) return null;
      const acts = parseQueue(M, queue);
      if (entry && entry.lastLength === queue.length && entry.lastSig) {
        // 上次吐出的动作没有入队（被引擎拒绝）：记入禁用表并重新规划。
        entry.banned.add(entry.lastSig);
        entry.plan = null;
      }
      if (!entry || !entry.plan || !samePrefix(acts, entry.plan)) {
        const banned = entry?.banned ?? new Set();
        M.deadline = nowMs() + PARAMS.timeBudgetMs;
        // planRound 返回含前缀的完整计划。
        entry = { plan: planRound(M, acts, banned), banned, lastLength: -1, lastSig: null };
        rememberRound(key, entry);
      }
      while (entry.plan.length > acts.length) {
        const next = entry.plan[acts.length];
        if (!entry.banned.has(actSig(next)) && isLegalNext(M, M.me, acts, next)) {
          entry.lastLength = queue.length;
          entry.lastSig = actSig(next);
          return toAction(M, next);
        }
        entry.plan.splice(acts.length, 1);
      }
      entry.lastLength = -1;
      entry.lastSig = null;
      return null;
    } catch (error) {
      if (typeof process !== 'undefined' && process.env?.HORIZON_STRICT === '1') throw error;
      return null;
    }
  },
};

/** 测试与标定用的内部入口（不属于算法契约）。 */
export const __internals = {
  PARAMS, buildModel, simulate, evaluate, projectScores, generateCandidates, isLegalNext,
  coverCells, aimsFrom, staticFirePlan, beamSearch, buildScenarios, planRound, parseQueue, toAction,
  roundCache,
};
