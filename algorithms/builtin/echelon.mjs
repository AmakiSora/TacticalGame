// algorithms/builtin/echelon.mjs
//
// 雁阵算法：royale 模式（同时回合 × 歼灭缩圈）的效用决策型内置算法。
//
// 设计完全从引擎规则第一性原理推导，不参考仓库内其他算法的实现；所有规则参数
// （兵种形状/射程/锁定、attacksPerUnit、炮火时刻表、据点收入、裁决权重）都从对局
// config 与实时状态读取，不含任何地图名或回合数特例——未来新增 royale 地图无需
// 改动本文件。
//
// ── 核心机制 ─────────────────────────────────────────────────────────────
// 1. 逐拍贪心剧本（stateless re-plan）：同时回合的队列下标就是行动点序号，前缀即
//    已定剧本。每次 decide() 从 plan.myQueue 读回前缀、镜像引擎重放投影（站位、
//    地形、攻击次数、已花补给、各步目的格声明、已打出的期望伤害），再在"下一拍"
//    上枚举全部候选动作，取边际效用最高者返回；null 即提交。被拒动作不改变状态，
//    用模块内记忆（轮次 + 队列长度 + 上次发射指纹）识别重问并轮换次优候选，
//    避免确定性算法原地打转。
// 2. 敌军落点扩散预报：敌我计划互为秘密，攻击又是瞄格制（打"结算时站在此格"的
//    敌人）。对每个敌军单位建立各行动点的落点分布：停留大质量 + 一跳扩散（BFS
//    地形可达、按距离衰减）+ 双跳扩散（步数 ≥2 时小质量），按目标朝向（接敌向
//    我军、危险中向外圈疏散）与危险规避加权。
// 3. 精确战斗算术：伤害 = max(最小伤害, 攻 − 防 + U[−v..v])，击杀概率按均匀分布
//    解析计算；attackLock（计划时点击格上有敌即锁定、未逃出射程必中）单独按
//    "目标满机动逃出射程的可达比例"建模命中；己方前缀攻击的期望伤害累计进目标
//    有效血量，集火击杀在贪心序列里自然成型。斩杀敌方最后一单位（army wipe 即
//    获胜）给支配性加分。
// 4. 炮火圈生存调度：从 config.annihilation.artillery 推导任意未来轮次的安全半径；
//    "本轮边界就会挨炮"的格子 = 当前危险格 ∪（下轮即缩圈时的）预警格，站在上面的
//    单位获得压倒性疏散效用（链式双移靠逐拍自然完成）。部署/治疗按引擎口径只在
//    当前危险圈外（起点、落点、施法覆盖格），新生儿落点再避开下轮圈。
// 5. 兵种角色与编成目标全部由 config.units 推导（治疗者/锁定手/占领者/前排/机动），
//    发育期按缺口补员；部署、驻屯、接敌风筝、占点、守巢在同一效用尺度上竞争行动点。
//
// 注册名 echelon（展示名「雁阵算法」、参与者 id `algo_echelon@v1`），modes ['royale']。

// ────────────────────────────── 可调常数 ──────────────────────────────
// 全部集中在此，与档案文档 algorithms/docs/algorithms/echelon.md 一一对应。

const TUNE = {
  // ── 落点预报 ──
  /** 敌军停留概率（不移动、原地开火或待命）。 */
  FORECAST_STAY: 0.45,
  /** 敌人射程内有我军（可原地开火）时的停留概率上调。 */
  FORECAST_STAY_ENGAGED: 0.62,
  /** 上轮移动过的躲避者：停留质量（躲避舞步破解）。 */
  FORECAST_STAY_DODGER: 0.15,
  /** 一跳扩散按 BFS 距离的衰减系数。 */
  FORECAST_DECAY: 0.72,
  /** 步数 ≥2 时双跳扩散的总质量。 */
  FORECAST_DOUBLE: 0.12,
  /** 双跳扩散的距离衰减。 */
  FORECAST_DOUBLE_DECAY: 0.7,
  /** 朝目标方向格的加权倍率。 */
  FORECAST_ALIGN: 1.3,
  /** 敌人视角危险格的质量折减（敌人也会疏散）。 */
  FORECAST_DANGER_SHRINK: 0.35,
  /** 危险中的敌人：停留质量再乘的折减（大概率拔腿就跑）。 */
  FORECAST_FLEE_STAY: 0.2,
  /** 锁定命中建模：目标不动的概率之外的逃逸面按可达比例计。 */
  LOCK_ESCAPE_MOVES: 0.55,

  // ── 战斗效用 ──
  /** 期望伤害在效用里的权重（击杀价值以 1 为基准）。磨血也要压过站桩。 */
  W_CHIP: 1.4,
  /**
   * 击杀进度价值：对打不死的目标，单次命中的价值 = 单位价值 ÷ 还需命中次数，
   * 再乘本系数——越接近击杀单次命中越值钱，集火自然涌现。
   */
  W_CHIP_FINISH: 2.0,
  /** 反击风险权重：被瞄准时停留 = 每轮稳定掉血，躲避要成为真实选项。 */
  W_RISK: 1.0,
  /** 后拍动作的每拍折扣（早拍击杀让目标后续队列作废）。 */
  STEP_DISCOUNT: 0.97,
  /** 敌人瞄我计划时刻格（未移动）时的命中估计。 */
  HIT_STAY: 0.5,
  /** 我已移走时的漏单命中估计。 */
  HIT_MOVED: 0.16,
  /** 被锁定时的命中估计（未逃出射程几乎必中）。 */
  HIT_LOCKED: 0.75,
  /** 锁定逃逸的富余格数：目标多跑 1 格视为基本逃出。 */
  LOCK_ESCAPE_SLACK: 1,

  // ── 炮火生存 ──
  /** 疏散效用系数：每点炮伤折算效用 = damage × W_EVAC × (0.8 + 单位价值/80)。 */
  W_EVAC: 0.9,
  /** 撤不干净（仍留在危险圈）时的折算。 */
  EVAC_PARTIAL: 0.45,
  /** 下轮炮圈的预防性罚值（占满伤害的比例）。 */
  NEXT_DANGER_FRACTION: 0.25,

  // ── 位置效用 ──
  /** 驻屯：希望保持的"安全半径内圈"余量（比下轮圈再往里 1 环）。 */
  STAGE_MARGIN: 1,
  /** 驻屯推进权重（每偏离目标半径 1 格扣的效用）。 */
  W_ADVANCE: 1.6,
  /** 爆破距离场：穿一堵墙的等效步数代价。 */
  BLAST_COST: 5,
  /** 路线权重：每点爆破距离扣的效用（牵引全军沿场向心）。 */
  W_ROUTE: 0.35,
  /** 爆破进度权重：每缩短 1 点爆破距离的效用。 */
  W_BLAST_PROGRESS: 1.2,
  /** 爆破效用上限（防止对一堵墙过度执念）。 */
  BLAST_EV_CAP: 30,
  /** 编队凝聚：与最近友军的距离惩罚权重。 */
  W_COHESION: 0.08,
  /** 治疗者驻疗位：离最近伤兵超出治疗范围时每格的效用损失。 */
  W_HEAL_STATION: 1.1,
  /** 与友军/自队声明格重叠的拥挤惩罚。 */
  W_CROWD: 1.0,
  /** 敌我接敌半径：敌军进入"其机动+射程+该余量"内即转接敌姿态。 */
  ENGAGE_REACH: 2,
  /** 接敌时的贴射程罚（进对方射程内的每格效用损失）。 */
  W_EXPOSED: 1.2,
  /** 接敌时的安全风筝奖励。 */
  BONUS_KITE: 0.6,

  // ── 据点 ──
  /** 占领价值：基础分 + 每点轮收入 × 该系数。 */
  W_CP_INCOME: 2.2,
  CP_PAD_BASE: 14,
  /** 守巢（站住己方受威胁据点）价值。 */
  CP_GUARD: 10,

  // ── 部署 ──
  /** 部署基础效用。 */
  DEPLOY_BASE: 20,
  /** 接敌期（圈已收缩/接敌）部署意愿折减。 */
  DEPLOY_WARTIME: 0.8,
  /** 新生儿落进下轮炮圈的部署效用折减。 */
  DEPLOY_NEXT_DANGER: 0.55,
  /** 出生据点 2 环内的拥挤上限（超过则停止补员，先让部队流出走廊）。 */
  POCKET_CROWD_LIMIT: 5,

  // ── 编成 ──
  /** 每几名战斗单位配 1 名治疗者。 */
  HEALER_RATIO: 4,
  HEALER_CAP: 3,
  /** 锁定手占战斗单位的目标比例（每 N 人 1 名）。 */
  SNIPER_RATIO: 3,
  /** 机动占领者目标数量。 */
  RUNNER_TARGET: 2,
  /** 前排（高血量坦克）占战斗单位的目标比例（每 N 人 1 名）。 */
  FRONT_RATIO: 3,

  /** 让位奖励：站在己方可部署据点旁堵死补员落点时，挪一格的额外效用。 */
  UNBLOCK_BONUS: 10,

  // ── 其他 ──
  /** 效用低于此值的动作不占用行动点（直接提交）。 */
  COMMIT_THRESHOLD: 1.0,
  /** 支持单位估值倍率（续航引擎）。 */
  VALUE_SUPPORT: 1.35,
  /** 锁定兵种估值倍率。 */
  VALUE_LOCK: 1.15,
  /** 可占领兵种估值倍率。 */
  VALUE_CAPTURER: 1.08,
};

const HEX_DIRS = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

function hexDistance(a, b) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(-a.q - a.r - (-b.q - b.r)));
}

function cellKey(p) {
  return `${p.q},${p.r}`;
}

function neighborsOf(p) {
  return HEX_DIRS.map(d => ({ q: p.q + d.q, r: p.r + d.r }));
}

// ────────────────────────────── 配置解析 ──────────────────────────────

function unitSpecOf(game, type) {
  return game.config?.units?.[type] ?? null;
}

function balanceOf(game) {
  return game.config?.balance ?? {};
}

/** 每单位每轮攻击上限；缺省 1（与 engine/planning.ts attackLimitFor 同口径）。 */
function attackLimitOf(game) {
  return balanceOf(game).attacksPerUnit ?? 1;
}

function varianceOf(game) {
  return balanceOf(game).damageVarianceRange ?? 0;
}

function minDamageOf(game) {
  return balanceOf(game).minimumDamage ?? 1;
}

function cpTypeSpec(game, kind) {
  if (!kind) return null;
  return game.config?.balance?.controlPointTypes?.[kind] ?? null;
}

function cpIncome(game, point) {
  return cpTypeSpec(game, point.kind)?.income ?? 0;
}

function cpCanDeploy(game, point) {
  const spec = cpTypeSpec(game, point.kind);
  return spec ? spec.canDeploy !== false : true;
}

function cpDiscount(game, point) {
  return cpTypeSpec(game, point.kind)?.deployDiscount ?? 0;
}

function healRangeOf(game, spec, unit) {
  return spec?.healRange ?? unit.attackRange;
}

/** 治疗量期望：healPower + 均匀[0..healVarianceRange] 的中点。 */
function healMeanOf(game, spec) {
  return (spec?.healPower ?? 0) + (balanceOf(game).healVarianceRange ?? 0) / 2;
}

/** 兵种角色：全部从 spec 字段推导，不依赖兵种名。 */
function unitRole(spec) {
  return {
    healer: (spec?.healPower ?? 0) > 0,
    lock: Boolean(spec?.attackLock),
    capturer: Boolean(spec?.canCapture),
    front: (spec?.hp ?? 0) >= 100,
  };
}

function unitValue(game, type) {
  const spec = unitSpecOf(game, type);
  if (!spec) return 10;
  const role = unitRole(spec);
  let value = spec.cost ?? 10;
  if (role.healer) value *= TUNE.VALUE_SUPPORT;
  if (role.lock) value *= TUNE.VALUE_LOCK;
  if (role.capturer) value *= TUNE.VALUE_CAPTURER;
  return value;
}

// ────────────────────────────── 炮火时间线 ──────────────────────────────

/**
 * 从 config 推导任意轮次的安全半径（与 engine/artillery.ts artilleryStateForRound
 * 的公式同构，只用于前瞻预测）。
 */
function safeRadiusAtRound(game, roundNumber) {
  const config = game.config?.annihilation?.artillery;
  const radius = game.map?.radius ?? 0;
  if (!config) return radius;
  const shrinkCount = roundNumber < config.startRound
    ? 0
    : Math.floor((roundNumber - config.startRound) / config.intervalRounds) + 1;
  return Math.max(config.minimumSafeRadius, radius - shrinkCount);
}

function artilleryDamageOf(game) {
  return game.config?.annihilation?.artillery?.damage ?? 0;
}

/** 当前危险圈（引擎口径：部署/治疗禁区、轮界炮伤区）。 */
function dangerSetOf(game) {
  const set = new Set();
  for (const cell of game.artillery?.dangerCells ?? []) set.add(cellKey(cell));
  return set;
}

/** 本轮边界就会挨炮的格子：当前危险格 ∪（下轮即缩圈时的）预警格。 */
function imminentDangerSetOf(game, danger) {
  const set = new Set(danger);
  const round = game.turn?.roundNumber ?? 1;
  const nextShrink = game.artillery?.nextShrinkRound ?? null;
  if (nextShrink !== null && nextShrink - round <= 1) {
    for (const cell of game.artillery?.warningCells ?? []) set.add(cellKey(cell));
  }
  return set;
}

/** 下轮边界（round+1）的危险格集合：本轮结束时不该停留的位置。 */
function nextRoundDangerSetOf(game) {
  const radius = safeRadiusAtRound(game, (game.turn?.roundNumber ?? 1) + 1);
  const set = new Set();
  for (const cell of game.cells ?? []) {
    if (hexDistance(cell, { q: 0, r: 0 }) > radius) set.add(cellKey(cell));
  }
  return set;
}

// ────────────────────────────── 地形与可达 ──────────────────────────────

/** 与引擎 gameIndex 同序的地形解析：cells 先铺、map.terrainCells 按序覆盖（后者优先）。 */
function terrainIndexMapOf(game) {
  const terrain = new Map();
  for (const cell of game.cells ?? []) terrain.set(cellKey(cell), cell.terrain);
  for (const cell of game.map?.terrainCells ?? []) terrain.set(cellKey(cell), cell.terrain);
  return terrain;
}

function terrainAtOf(game, terrainOverride, pos) {
  const key = cellKey(pos);
  if (terrainOverride.has(key)) return terrainOverride.get(key);
  // terrainCells 覆盖层可能同格多次定义（后者优先），倒序找最后一条。
  const cells = game.map?.terrainCells;
  if (cells) {
    for (let i = cells.length - 1; i >= 0; i--) {
      const cell = cells[i];
      if (cell.q === pos.q && cell.r === pos.r) return cell.terrain;
    }
  }
  const cell = game.cells?.find(c => c.q === pos.q && c.r === pos.r);
  return cell?.terrain ?? 'blocker';
}

function playableSetOf(game) {
  const set = new Set();
  for (const cell of game.cells ?? []) set.add(cellKey(cell));
  return set;
}

/**
 * 爆破距离场：从圈心做 Dijkstra（只在 plain 格上驻留），plain↔plain 边代价 1；
 * 两个共享 blocker 邻居的 plain 格之间视为"可爆破传送"边，代价 2 + BLAST_COST
 * （走到墙边 1 拍 + 爆破约 BLAST_COST 拍等效 + 迈入 1 拍）。水不可爆破，天然断路。
 * 返回 Map<cellKey, 距离>；含全部 plain 格（除非被水彻底隔离）。
 *
 * 这一层把"缩圈的终点是圈心"翻译成可跟随的势场：有墙挡路时距离场自动把全军
 * 牵引到墙门，工兵爆破后场值骤降、路线改道——对任何地图形状成立。
 */
function blastDistanceFieldOf(game, playable, terrainOverride) {
  const center = { q: 0, r: 0 };
  if (!playable.has(cellKey(center))) {
    // 圈心不在可玩格（理论边界）：退化为以最近可玩格为源。
    for (const key of playable) {
      const [q, r] = key.split(',').map(Number);
      center.q = q; center.r = r;
      break;
    }
  }
  const terrain = terrainIndexMapOf(game);
  const isPlain = pos => {
    const key = cellKey(pos);
    return (terrainOverride.get(key) ?? terrain.get(key) ?? 'blocker') === 'plain';
  };
  // blocker 邻接索引：plain 格 → 相邻 blocker 列表（建一次）。
  const blockerAdj = new Map();
  for (const key of playable) {
    const [q, r] = key.split(',').map(Number);
    if (isPlain({ q, r })) continue;
    for (const n of neighborsOf({ q, r })) {
      const nKey = cellKey(n);
      if (!playable.has(nKey) || !isPlain(n)) continue;
      const list = blockerAdj.get(nKey);
      if (list) list.push({ q, r });
      else blockerAdj.set(nKey, [{ q, r }]);
    }
  }
  const startKey = cellKey(center);
  const dist = new Map();
  if (playable.has(startKey) && isPlain(center)) dist.set(startKey, 0);
  // 0/1 类 Dijkstra 用桶数组即可；规模小，直接朴素优先队列。
  const queue = [{ pos: center, d: 0 }];
  const push = (pos, d) => {
    queue.push({ pos, d });
  };
  while (queue.length) {
    let bestIndex = 0;
    for (let i = 1; i < queue.length; i++) {
      if (queue[i].d < queue[bestIndex].d) bestIndex = i;
    }
    const { pos, d } = queue.splice(bestIndex, 1)[0];
    const key = cellKey(pos);
    if (dist.get(key) !== undefined && dist.get(key) < d) continue;
    for (const n of neighborsOf(pos)) {
      const nKey = cellKey(n);
      if (!playable.has(nKey)) continue;
      if (!isPlain(n)) continue; // blocker 不驻留，只能被"传送"穿过
      const nd = d + 1;
      if (dist.get(nKey) === undefined || nd < dist.get(nKey)) {
        dist.set(nKey, nd);
        push(n, nd);
      }
    }
    // 爆破传送：经相邻 blocker 跳到墙另一侧的 plain 格。
    for (const wall of blockerAdj.get(key) ?? []) {
      for (const n of neighborsOf(wall)) {
        const nKey = cellKey(n);
        if (!playable.has(nKey) || !isPlain(n) || nKey === key) continue;
        const nd = d + 2 + TUNE.BLAST_COST;
        if (dist.get(nKey) === undefined || nd < dist.get(nKey)) {
          dist.set(nKey, nd);
          push(n, nd);
        }
      }
    }
  }
  return dist;
}

/**
 * 地形寻路可达格（水/障碍挡路，单位不挡路）——与 engine/planning.ts 计划期口径
 * 一致：单位可能本轮移动，不能当墙。返回 Map<cellKey, BFS 距离>。
 */
function reachableSetOf(game, from, range, terrainOverride, playable) {
  const terrain = terrainIndexMapOf(game);
  const visited = new Set([cellKey(from)]);
  const result = new Map();
  const queue = [{ pos: { q: from.q, r: from.r }, d: 0 }];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    if (cur.d >= range) continue;
    for (const next of neighborsOf(cur.pos)) {
      const key = cellKey(next);
      if (visited.has(key)) continue;
      visited.add(key);
      if (!playable.has(key)) continue;
      const t = terrainOverride.get(key) ?? terrain.get(key) ?? 'blocker';
      if (t !== 'plain') continue;
      result.set(key, cur.d + 1);
      queue.push({ pos: next, d: cur.d + 1 });
    }
  }
  return result;
}

// ────────────────────────────── 形状镜像 ──────────────────────────────
// 与 engine/planning.ts computeCoveredCells 同构：single / line / arc。

function shapeSpecOf(spec, kind) {
  const shape = spec?.[kind];
  if (!shape) return { type: 'single', length: 1 };
  if (shape.type === 'line') return { type: 'line', length: shape.length ?? 2 };
  if (shape.type === 'arc') return { type: 'arc', length: 3 };
  return { type: 'single', length: 1 };
}

/**
 * 由施放位与点击格推导覆盖格；不合法返回 null。from 用投影位。
 * 引擎口径：攻击不允许点自己脚下；治疗允许（覆盖含自身格）。
 */
function coveredCellsOf(spec, kind, from, aimCell, range) {
  if (!from) return null;
  const shape = shapeSpecOf(spec, kind);
  const dq = aimCell.q - from.q;
  const dr = aimCell.r - from.r;
  if (hexDistance(from, aimCell) > range) return null;
  if (shape.type === 'single') {
    const distance = hexDistance(from, aimCell);
    if (distance > range) return null;
    if (kind === 'attackShape' && distance === 0) return null;
    return { cells: [{ q: aimCell.q, r: aimCell.r }] };
  }
  if (shape.type === 'arc') {
    if (hexDistance(from, aimCell) !== 1) return null;
    const direction = HEX_DIRS.findIndex(d => d.q === dq && d.r === dr);
    if (direction < 0) return null;
    const cells = [(direction + 5) % 6, direction, (direction + 1) % 6]
      .map(index => ({ q: from.q + HEX_DIRS[index].q, r: from.r + HEX_DIRS[index].r }));
    return { cells };
  }
  const length = Math.min(shape.length, range);
  for (let direction = 0; direction < 6; direction++) {
    const d = HEX_DIRS[direction];
    const k = d.q !== 0 ? dq / d.q : dr / d.r;
    if (!Number.isInteger(k) || k < 1 || k > length) continue;
    if (d.q * k !== dq || d.r * k !== dr) continue;
    const cells = [];
    for (let step = 1; step <= length; step++) {
      cells.push({ q: from.q + d.q * step, r: from.r + d.r * step });
    }
    return { cells };
  }
  return null;
}

/** 枚举一个单位在 from 位可能点击的全部瞄准格。 */
function enumerateAimCells(from, shape, range, includeSelf) {
  const cells = [];
  if (shape.type === 'single') {
    if (includeSelf) cells.push({ q: from.q, r: from.r });
    for (let ring = 1; ring <= range; ring++) {
      for (const dir of HEX_DIRS) {
        cells.push({ q: from.q + dir.q * ring, r: from.r + dir.r * ring });
      }
    }
  } else if (shape.type === 'arc') {
    for (const dir of HEX_DIRS) cells.push({ q: from.q + dir.q, r: from.r + dir.r });
  } else {
    // line：同一射线上任意点击的覆盖集相同，每方向只需点一次。
    for (const dir of HEX_DIRS) cells.push({ q: from.q + dir.q, r: from.r + dir.r });
  }
  return cells;
}

// ────────────────────────────── 战斗算术 ──────────────────────────────

/** 期望伤害：均匀对称方差的均值被最小伤害截断（忽略截断对均值的高阶修正）。 */
function expectedDamageOf(game, attack, defense) {
  return Math.max(minDamageOf(game), attack - defense);
}

/**
 * 击杀概率：P(max(minDmg, atk − def + U[−v..v]) ≥ effectiveHp)，U 为均匀整数。
 * effectiveHp 允许传入"已计入我方前缀期望伤害"的血量做集火建模。
 */
function killProbabilityOf(game, attacker, target, effectiveHp) {
  const hp = Math.max(1, effectiveHp ?? target.hp);
  const minDamage = minDamageOf(game);
  if (hp <= minDamage) return 1; // 任何结算伤害都 ≥ minDmg ≥ hp
  const base = attacker.attack - target.defense;
  const variance = varianceOf(game);
  if (variance <= 0) return base >= hp ? 1 : 0;
  const needed = hp - base;
  const span = 2 * variance + 1;
  const hits = needed <= -variance ? span : Math.max(0, variance - Math.max(needed, -variance) + 1);
  return Math.min(1, hits / span);
}

// ────────────────────────────── 敌军落点预报 ──────────────────────────────

/**
 * 敌军上轮是否移动过（公开事件流：从上一个 round_start 到事件尾部的 move 事件）。
 * 躲避者（上轮移过）的落点预报要按"逃离威胁"建模，而不是按"接火停留"。
 */
function movedLastRoundOf(game, enemy) {
  const events = game.events ?? [];
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type === 'round_start') return false; // 扫完上一轮仍未见移动
    if (event.type === 'move' && event.payload?.unitId === enemy.id) return true;
  }
  return false;
}

/**
 * 敌军单位在行动点 step 的落点分布：Map<cellKey, {cell, prob}>。
 * 模型：停留（大质量）+ 一跳扩散（BFS 可达、距离衰减）+ 双跳扩散（step ≥2 小质量）；
 * 朝目标方向格加权；危险格降权；危险中的单位改为向外圈疏散、停留质量骤降；
 * 能原地开火的敌人停留质量上调；上轮移动过的"躲避者"停留质量骤降、目标方向
 * 反转为逃离我方最近威胁（躲避方向可被覆盖预测，破解镜像躲避舞步）。
 */
function forecastOf(game, enemy, step, imminentDanger, cache) {
  const cacheKey = `${enemy.id}|${step}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const playable = playableSetOf(game);
  const spec = unitSpecOf(game, enemy.type);
  const moveRange = enemy.moveRange ?? spec?.moveRange ?? 0;
  const inDanger = imminentDanger.has(cellKey(enemy));
  // 接火判定：我方任一单位在它的射程内 → 大概率原地开火。
  const canFireInPlace = (game.units ?? []).some(u =>
    u.alive && u.owner !== enemy.owner
    && hexDistance(u, enemy) <= (enemy.attackRange ?? spec?.attackRange ?? 1));
  // 机动性实证：上轮移过的敌人是躲避者。
  const dodger = movedLastRoundOf(game, enemy);
  const stayBase = inDanger ? TUNE.FORECAST_FLEE_STAY
    : dodger ? TUNE.FORECAST_STAY_DODGER
    : canFireInPlace ? Math.max(TUNE.FORECAST_STAY, TUNE.FORECAST_STAY_ENGAGED)
    : TUNE.FORECAST_STAY;
  const stayMass = stayBase;
  const singleMass = Math.max(0, 1 - stayMass - (step >= 2 ? TUNE.FORECAST_DOUBLE : 0));
  const doubleMass = step >= 2 ? TUNE.FORECAST_DOUBLE : 0;

  // 目标方向：危险中 → 远离圈心（向外疏散）；躲避者 → 逃离我方最近威胁；
  // 常态 → 逼近最近的敌方单位（我军）。
  let objective;
  if (inDanger) {
    objective = { q: -enemy.q, r: -enemy.r };
  } else if (dodger) {
    let threat = null;
    let threatDist = Infinity;
    for (const unit of game.units ?? []) {
      if (!unit.alive || unit.owner === enemy.owner) continue;
      const d = hexDistance(enemy, unit);
      if (d < threatDist) { threatDist = d; threat = unit; }
    }
    objective = threat
      ? { q: enemy.q + (enemy.q - threat.q), r: enemy.r + (enemy.r - threat.r) }
      : { q: -enemy.q, r: -enemy.r };
  } else {
    let best = null;
    let bestDist = Infinity;
    for (const unit of game.units ?? []) {
      if (!unit.alive || unit.owner === enemy.owner) continue;
      const d = hexDistance(enemy, unit);
      if (d < bestDist) { bestDist = d; best = unit; }
    }
    objective = best ? { q: best.q, r: best.r } : { q: -enemy.q, r: -enemy.r };
  }

  const entries = new Map();
  const add = (cell, weight) => {
    const key = cellKey(cell);
    if (!playable.has(key)) return;
    const prev = entries.get(key);
    if (prev) prev.weight += weight;
    else entries.set(key, { cell: { q: cell.q, r: cell.r }, weight });
  };

  add(enemy, stayMass);

  const one = reachableSetOf(game, enemy, moveRange, new Map(), playable);
  for (const [key, d] of one) {
    const [q, r] = key.split(',').map(Number);
    const cell = { q, r };
    let weight = singleMass * Math.pow(TUNE.FORECAST_DECAY, d - 1);
    if (hexDistance(cell, objective) < hexDistance(enemy, objective)) {
      weight *= TUNE.FORECAST_ALIGN;
    }
    if (imminentDanger.has(key)) weight *= TUNE.FORECAST_DANGER_SHRINK;
    add(cell, weight);
  }

  if (doubleMass > 0 && moveRange > 0) {
    const two = reachableSetOf(game, enemy, moveRange * 2, new Map(), playable);
    for (const [key, d] of two) {
      if (d <= moveRange) continue;
      const [q, r] = key.split(',').map(Number);
      const cell = { q, r };
      let weight = doubleMass * Math.pow(TUNE.FORECAST_DOUBLE_DECAY, d - moveRange - 1);
      if (hexDistance(cell, objective) < hexDistance(enemy, objective)) {
        weight *= TUNE.FORECAST_ALIGN;
      }
      if (imminentDanger.has(key)) weight *= TUNE.FORECAST_DANGER_SHRINK;
      add(cell, weight);
    }
  }

  const total = [...entries.values()].reduce((sum, e) => sum + e.weight, 0) || 1;
  const distribution = new Map();
  for (const entry of entries.values()) {
    distribution.set(cellKey(entry.cell), { cell: entry.cell, prob: entry.weight / total });
  }
  cache.set(cacheKey, distribution);
  return distribution;
}

/**
 * 锁定射击的逃逸概率：目标以 1−P(不动) 的概率满机动逃离，
 * 逃出面 = 满机动可达格里在我射程之外的比例（攻击者停在施法位不动）。
 */
function lockEscapeProbabilityOf(game, from, target, range, playable) {
  const spec = unitSpecOf(game, target.type);
  const moveRange = target.moveRange ?? spec?.moveRange ?? 0;
  if (moveRange <= 0) return 0;
  const reach = reachableSetOf(game, target, moveRange, new Map(), playable);
  if (reach.size === 0) return 0;
  let outside = 0;
  for (const key of reach.keys()) {
    const [q, r] = key.split(',').map(Number);
    if (hexDistance(from, { q, r }) > range) outside += 1;
  }
  const escapeFace = outside / reach.size;
  return (1 - TUNE.FORECAST_STAY) * escapeFace;
}

// ────────────────────────────── 前缀投影（镜像） ──────────────────────────────
// 与 engine/planning.ts projectPlanQueue 同构，另附带：
// - attacksUsed：前缀里每个攻击者的已排攻击次数（attack_limit 镜像）；
// - deploySpend：前缀部署的已承诺补给；
// - claims：各行动点已声明的目的格（同拍自冲突判定）；
// - dealt：对每个敌人已排攻击的期望伤害累计（集火建模，锁定按必中计）；
// - kills：前缀里高概率击杀的敌人（从后续预报与候选里剔除）。

function projectPrefix(game, owner, queue) {
  const positions = new Map();
  const terrain = new Map();
  const attacksUsed = new Map();
  const deploySpend = { total: 0 };
  const claims = new Map();
  const kills = new Set();
  const dealt = new Map();
  const vacated = new Set();
  const deployDests = new Set();
  const healsDone = new Map();
  const playable = playableSetOf(game);

  const positionOf = unitId => {
    if (positions.has(unitId)) return positions.get(unitId);
    const unit = game.units?.find(u => u.id === unitId);
    return unit ? { q: unit.q, r: unit.r } : null;
  };

  queue.forEach((action, index) => {
    const step = index + 1;
    if (action.type === 'move' && action.unitId && typeof action.q === 'number') {
      const unit = game.units?.find(u => u.id === action.unitId);
      if (unit) vacated.add(cellKey(unit)); // 计划时刻格：结算时该格会腾空
      positions.set(action.unitId, { q: action.q, r: action.r });
      if (!claims.has(step)) claims.set(step, new Set());
      claims.get(step).add(cellKey(action));
    } else if (action.type === 'deploy' && typeof action.q === 'number') {
      if (!claims.has(step)) claims.set(step, new Set());
      claims.get(step).add(cellKey(action));
      deployDests.add(cellKey(action)); // 新生儿常驻该格
      const spec = unitSpecOf(game, action.unitType);
      const origin = (game.controlPoints ?? []).find(p => p.id === action.fromId) ?? null;
      const discount = Math.min(spec?.cost ?? 0, cpDiscount(game, origin));
      deploySpend.total += (spec?.cost ?? 0) - discount;
    } else if (action.type === 'demolish' && typeof action.q === 'number') {
      terrain.set(cellKey(action), 'plain');
    } else if (action.type === 'heal' && action.supportId && typeof action.q === 'number') {
      const support = game.units?.find(u => u.id === action.supportId);
      if (!support) return;
      const spec = unitSpecOf(game, support.type);
      const from = positionOf(action.supportId) ?? support;
      const aim = coveredCellsOf(spec, 'healShape', from, action,
        spec?.healRange ?? support.attackRange);
      if (!aim) return;
      const mean = healMeanOf(game, spec);
      for (const cell of aim.cells) {
        const ally = (game.units ?? []).find(
          u => u.alive && u.owner === owner && u.q === cell.q && u.r === cell.r);
        if (!ally || ally.hp >= ally.maxHp) continue;
        const missing = ally.maxHp - ally.hp - (healsDone.get(ally.id) ?? 0);
        if (missing <= 0) continue;
        healsDone.set(ally.id, (healsDone.get(ally.id) ?? 0) + Math.min(missing, mean));
      }
    } else if (action.type === 'attack' && action.attackerId && typeof action.q === 'number') {
      attacksUsed.set(action.attackerId, (attacksUsed.get(action.attackerId) ?? 0) + 1);
      const attacker = game.units?.find(u => u.id === action.attackerId);
      if (!attacker) return;
      const from = positionOf(action.attackerId) ?? attacker;
      const spec = unitSpecOf(game, attacker.type);
      const aim = coveredCellsOf(spec, 'attackShape', from, action, attacker.attackRange);
      if (!aim) return;
      for (const cell of aim.cells) {
        const target = (game.units ?? []).find(
          u => u.alive && u.owner !== owner && u.q === cell.q && u.r === cell.r);
        if (!target) continue;
        const damage = expectedDamageOf(game, attacker.attack, target.defense);
        // 锁定 ≈ 必中；非锁定只有目标停留时才吃满（按停留概率折算）。
        const hitMass = spec?.attackLock ? 1 : TUNE.FORECAST_STAY;
        dealt.set(target.id, (dealt.get(target.id) ?? 0) + damage * hitMass);
        const effectiveHp = target.hp - (dealt.get(target.id) ?? 0);
        if (killProbabilityOf(game, attacker, target, effectiveHp) >= 0.9) kills.add(target.id);
      }
    }
  });

  return { positions, terrain, attacksUsed, deploySpend, claims, kills, dealt, vacated, deployDests, healsDone };
}

// ────────────────────────────── 局面语义层 ──────────────────────────────

function myUnitsOf(game, owner) {
  return (game.units ?? []).filter(u => u.alive && u.owner === owner);
}

function enemyUnitsOf(game, owner) {
  const enemies = new Set(
    Object.keys(game.players ?? {}).filter(id => id !== owner && game.players[id]?.status === 'active'),
  );
  return (game.units ?? []).filter(u => u.alive && enemies.has(u.owner));
}

function suppliesOf(game, owner) {
  return game.resources?.[owner]?.supplies ?? 0;
}

/** 编成缺口：从兵种角色推导各角色目标数量，返回 Map<type, 缺口数>。 */
function compositionGapsOf(game, myUnits, queuedDeployTypes) {
  const specsByName = game.config?.units ?? {};
  const combat = myUnits.filter(u => !unitRole(unitSpecOf(game, u.type)).healer);
  const healers = myUnits.length - combat.length;
  const counts = { lock: 0, runner: 0, front: 0 };
  const tally = (type) => {
    const role = unitRole(specsByName[type]);
    if (!role.healer) {
      if (role.lock) counts.lock += 1;
      if (role.capturer && (specsByName[type].moveRange ?? 0) >= 4) counts.runner += 1;
      if (role.front) counts.front += 1;
    }
  };
  for (const unit of combat) tally(unit.type);
  // 在途部署计入缺口，否则同一缺口每拍重复触发、单一兵种过量。
  for (const type of queuedDeployTypes) tally(type);
  const combatTotal = combat.length + queuedDeployTypes.filter(
    type => !unitRole(specsByName[type]).healer).length;
  const gaps = new Map();
  const healerType = Object.keys(specsByName).find(type => unitRole(specsByName[type]).healer);
  const healerTarget = Math.min(TUNE.HEALER_CAP, Math.ceil(combatTotal / TUNE.HEALER_RATIO));
  if (healerType && healers < healerTarget) gaps.set(healerType, healerTarget - healers);
  const lockType = Object.keys(specsByName).find(type => unitRole(specsByName[type]).lock);
  const lockTarget = Math.ceil(combatTotal / TUNE.SNIPER_RATIO);
  if (lockType && counts.lock < lockTarget) gaps.set(lockType, lockTarget - counts.lock);
  const runnerType = Object.keys(specsByName)
    .filter(type => unitRole(specsByName[type]).capturer)
    .sort((a, b) => (specsByName[b].moveRange ?? 0) - (specsByName[a].moveRange ?? 0))[0];
  if (runnerType && counts.runner < TUNE.RUNNER_TARGET) gaps.set(runnerType, TUNE.RUNNER_TARGET - counts.runner);
  const frontType = Object.keys(specsByName)
    .filter(type => unitRole(specsByName[type]).front)
    .sort((a, b) => (specsByName[b].hp ?? 0) - (specsByName[a].hp ?? 0))[0];
  const frontTarget = Math.ceil(combatTotal / TUNE.FRONT_RATIO);
  if (frontType && counts.front < frontTarget) gaps.set(frontType, frontTarget - counts.front);
  return gaps;
}

/**
 * 驻屯目标半径：按"全军能在几轮内挪完"的地平线前瞻安全圈。
 * 行动点有限（每轮 ~AP 拍、其中大半要让给战斗/部署），全军整体挪一环要
 * armySize/4 轮，再 +1 轮冗余：缩圈开始前就启动行军（发育期即可往前赶），
 * 否则开缩后撤退永远追不上炮圈。
 */
function stagingRadiusOf(game, armySize) {
  const horizon = Math.max(2, Math.ceil(armySize / 4) + 1);
  const futureRadius = safeRadiusAtRound(game, (game.turn?.roundNumber ?? 1) + horizon);
  const minRadius = game.config?.annihilation?.artillery?.minimumSafeRadius ?? 0;
  return Math.max(minRadius, futureRadius - TUNE.STAGE_MARGIN);
}

/** 接敌判定：任意敌军进入"其机动 + 射程 + 余量"内即转接敌姿态。 */
function engagedOf(myUnits, enemies) {
  for (const mine of myUnits) {
    for (const enemy of enemies) {
      const reach = (enemy.moveRange ?? 0) + (enemy.attackRange ?? 1) + TUNE.ENGAGE_REACH;
      if (hexDistance(mine, enemy) <= reach) return true;
    }
  }
  return false;
}

/** 敌方对我据点的威胁：敌军单位两轮机动内能摸到该据点。 */
function cpThreatenedOf(point, enemies) {
  for (const enemy of enemies) {
    if (hexDistance(enemy, point) <= (enemy.moveRange ?? 0) * 2 + 1) return true;
  }
  return false;
}

// ────────────────────────────── 候选构建 ──────────────────────────────

/**
 * 下一拍的全部候选动作：{ action, ev, tag }。
 * 攻击/治疗/部署/爆破/移动在同一效用尺度上竞争行动点。
 */
function buildCandidates(game, owner) {
  const plan = game.plan ?? {};
  const queue = plan.myQueue ?? plan.queues?.[owner] ?? [];
  const budget = balanceOf(game).actionsPerTurn ?? 5;
  if (queue.length >= budget) return { candidates: [] };

  const projection = projectPrefix(game, owner, queue);
  const step = queue.length + 1;
  const discount = Math.pow(TUNE.STEP_DISCOUNT, step - 1);
  const myUnits = myUnitsOf(game, owner);
  const enemies = enemyUnitsOf(game, owner);
  // 注意：我军为空（如开局零单位的大逃杀图）时必须继续——部署候选是唯一的
  // 兵力来源，下面的逐单位循环对空列表天然跳过。

  const danger = dangerSetOf(game);
  const imminentDanger = imminentDangerSetOf(game, danger);
  const nextDanger = nextRoundDangerSetOf(game);
  const playable = playableSetOf(game);
  const blastField = blastDistanceFieldOf(game, playable, projection.terrain);
  const blastDistOf = pos => blastField.get(cellKey(pos)) ?? Infinity;
  const forecastCache = new Map();
  const supplies = suppliesOf(game, owner) - projection.deploySpend.total;
  const attackLimit = attackLimitOf(game);
  const engaged = engagedOf(myUnits, enemies);
  const stagingRadius = stagingRadiusOf(game, myUnits.length);
  const damagePerShell = artilleryDamageOf(game);
  const candidates = [];

  const claimAt = index => {
    if (!projection.claims.has(index)) projection.claims.set(index, new Set());
    return projection.claims.get(index);
  };
  const projectedPositionOf = unit => projection.positions.get(unit.id) ?? { q: unit.q, r: unit.r };
  const effectiveHpOf = target => Math.max(1, target.hp - (projection.dealt.get(target.id) ?? 0));
  const effectiveMissingOf = ally => Math.max(0, ally.maxHp - ally.hp - (projection.healsDone.get(ally.id) ?? 0));

  /**
   * 一次命中对目标的期望价值：能打死按单位价值计；打不死按"击杀进度"计
   * （单位价值 ÷ 还需命中次数 × W_CHIP_FINISH）——残血目标价值飙升，集火涌现。
   */
  const hitValueOf = (unit, target, mass) => {
    const effectiveHp = effectiveHpOf(target);
    const damage = expectedDamageOf(game, unit.attack, target.defense);
    const killProb = killProbabilityOf(game, unit, target, effectiveHp);
    if (killProb >= 1) return mass * unitValue(game, target.type);
    const hitsNeeded = Math.max(1, Math.ceil(effectiveHp / Math.max(1, damage)));
    const progressValue = unitValue(game, target.type) / hitsNeeded * TUNE.W_CHIP_FINISH;
    return mass * (killProb * unitValue(game, target.type) + (1 - killProb) * progressValue);
  };

  // ── 结算口径的占位模型 ──
  // 我军"最终投影位"（含前缀移动的终点、未动者的原位）与前缀部署落点视为从各自
  // 步骤起被占——移动/部署候选撞上必吃 destination_occupied / destination_conflict。
  // 敌军计划时刻站位是"大概率仍被占"（约五五开），用重罚而非禁入表达。
  const myFinalOccupied = new Set();
  for (const unit of myUnits) myFinalOccupied.add(cellKey(projectedPositionOf(unit)));
  for (const key of projection.deployDests) myFinalOccupied.add(key);
  const enemyPlanCells = new Set();
  for (const enemy of enemies) enemyPlanCells.add(cellKey(enemy));

  /**
   * 反击风险：我站在 pos 时预计吃到的期望伤害。
   * 敌人瞄格制只能稳瞄我"计划时刻"的站位；我移走后只有锁定与预测命中。
   */
  const counterRiskOf = (unit, pos, moved) => {
    let risk = 0;
    for (const enemy of enemies) {
      if (projection.kills.has(enemy.id)) continue;
      const spec = unitSpecOf(game, enemy.type);
      const range = enemy.attackRange ?? spec?.attackRange ?? 1;
      const distance = hexDistance(enemy, pos);
      const strikeReach = range + (enemy.moveRange ?? 0);
      if (distance > strikeReach) continue;
      let hitProb;
      if (spec?.attackLock) {
        hitProb = distance <= range + (enemy.moveRange ?? 0) + TUNE.LOCK_ESCAPE_SLACK
          ? TUNE.HIT_LOCKED
          : TUNE.HIT_MOVED;
      } else {
        hitProb = moved ? TUNE.HIT_MOVED : TUNE.HIT_STAY;
      }
      risk += hitProb * expectedDamageOf(game, enemy.attack ?? 0, unit.defense ?? 0);
    }
    return risk;
  };

  /** 疏散效用权重：单位越值钱越要先救。 */
  const evacWeightOf = unit => 0.8 + unitValue(game, unit.type) / 80;

  /** 位置效用：炮火生存 + 驻屯/接敌走位 + 编队 + 占点/守巢 + 威胁暴露。 */
  const positionScoreOf = (unit, pos, claimsExclude) => {
    const key = cellKey(pos);
    let score = 0;
    if (imminentDanger.has(key)) {
      score -= damagePerShell * TUNE.W_EVAC * evacWeightOf(unit);
    } else if (nextDanger.has(key)) {
      score -= damagePerShell * TUNE.NEXT_DANGER_FRACTION;
    }
    const centerDistance = hexDistance(pos, { q: 0, r: 0 });
    // 路线牵引：沿爆破距离场向心（有墙指向墙门，无墙指向圈心）。
    const blastDist = blastDistOf(pos);
    if (blastDist !== Infinity) score -= blastDist * TUNE.W_ROUTE;
    if (!engaged) {
      score -= Math.abs(centerDistance - stagingRadius) * TUNE.W_ADVANCE;
    } else {
      let nearest = null;
      let nearestDist = Infinity;
      for (const enemy of enemies) {
        if (projection.kills.has(enemy.id)) continue;
        const d = hexDistance(pos, enemy);
        if (d < nearestDist) { nearestDist = d; nearest = enemy; }
      }
      if (nearest) {
        const spec = unitSpecOf(game, unit.type);
        const myRange = unit.attackRange ?? spec?.attackRange ?? 1;
        const enemyReach = (nearest.attackRange ?? 1) + (nearest.moveRange ?? 0) * 0.5;
        if (nearestDist > myRange) {
          // 不封顶：相距多远就拉多强，否则 5 环外梯度全平、两军隔空对峙到被炮火磨死。
          // 冲进炮圈/敌火的风险仍由炮圈罚项与暴露罚项兜底。
          score -= (nearestDist - myRange) * TUNE.W_ADVANCE;
        } else if (nearestDist <= enemyReach) {
          score -= TUNE.W_EXPOSED * (enemyReach - nearestDist + 1);
        } else {
          score += TUNE.BONUS_KITE;
        }
      }
    }
    let cohesion = Infinity;
    for (const ally of myUnits) {
      if (ally.id === unit.id) continue;
      const d = hexDistance(pos, projectedPositionOf(ally));
      if (d < cohesion) cohesion = d;
    }
    if (cohesion !== Infinity) {
      score -= Math.min(cohesion, 3) * TUNE.W_COHESION;
      if (cohesion === 0) score -= TUNE.W_CROWD;
    }
    // 治疗者驻疗位：贴住最近伤兵的治疗范围（只按真实治疗范围生效）。
    if (unitRole(unitSpecOf(game, unit.type)).healer) {
      const healRange = healRangeOf(game, unitSpecOf(game, unit.type), unit);
      let station = Infinity;
      for (const ally of myUnits) {
        if (ally.id === unit.id || ally.hp >= ally.maxHp) continue;
        const d = hexDistance(pos, projectedPositionOf(ally));
        if (d < station) station = d;
      }
      if (station !== Infinity && station > healRange) {
        score -= (station - healRange) * TUNE.W_HEAL_STATION;
      }
    }
    if (claimsExclude?.has(key)) score -= TUNE.W_CROWD * 2;
    const point = (game.controlPoints ?? []).find(p => p.q === pos.q && p.r === pos.r);
    if (point) {
      if (point.owner !== owner && unitRole(unitSpecOf(game, unit.type)).capturer) {
        score += TUNE.CP_PAD_BASE + cpIncome(game, point) * TUNE.W_CP_INCOME;
      } else if (point.owner === owner && cpThreatenedOf(point, enemies)) {
        score += TUNE.CP_GUARD;
      }
    }
    score -= counterRiskOf(unit, pos, cellKey(pos) !== cellKey(unit)) * TUNE.W_RISK;
    return score;
  };

  // ── 移动 / 疏散 ──
  const specsAll = Object.values(game.config?.units ?? {});
  const minDeployCost = specsAll.length
    ? Math.min(...specsAll.map(s => s.cost ?? Infinity))
    : Infinity;
  const safeDeployPads = (game.controlPoints ?? []).filter(
    p => p.owner === owner && cpCanDeploy(game, p) && !danger.has(cellKey(p)));
  /** 单位是否正堵死某个可部署据点的全部落点。 */
  const blockingPadOf = pos => safeDeployPads.find(cp => {
    if (hexDistance(cp, pos) !== 1) return false;
    const openCells = neighborsOf(cp).filter(n =>
      playable.has(cellKey(n)) && terrainAtOf(game, projection.terrain, n) === 'plain');
    if (openCells.length === 0) return false;
    return openCells.every(n => {
      const occupant = (game.units ?? []).find(u => u.alive && u.q === n.q && u.r === n.r);
      return Boolean(occupant)
        && !(occupant.owner === owner && projection.vacated.has(cellKey(occupant)));
    });
  });
  for (const unit of myUnits) {
    const from = projectedPositionOf(unit);
    const reach = reachableSetOf(game, from, unit.moveRange, projection.terrain, playable);
    if (reach.size === 0) continue;
    const claimsHere = claimAt(step);
    const fromScore = positionScoreOf(unit, from, null);
    let bestCell = null;
    let bestScore = -Infinity;
    for (const [key, d] of reach) {
      if (myFinalOccupied.has(key)) continue; // 撞友军最终位 / 新生儿位 → 必失败
      if (projection.deployDests.has(key)) continue;
      const [q, r] = key.split(',').map(Number);
      const pos = { q, r };
      let score = positionScoreOf(unit, pos, claimsHere) - d * 0.05;
      if (enemyPlanCells.has(key)) score -= 30; // 敌军大概率仍占此格：到达即冲突+后续作废
      if (score > bestScore) { bestScore = score; bestCell = { q, r }; }
    }
    if (!bestCell) continue;
    let gain = bestScore - fromScore;
    if (blockingPadOf(from) && supplies >= minDeployCost && !imminentDanger.has(cellKey(from))) {
      gain += TUNE.UNBLOCK_BONUS; // 挪走给补员腾落点，下一拍部署自然接上
    }
    if (gain <= 0.05) continue;
    candidates.push({
      action: { type: 'move', payload: { unitId: unit.id, q: bestCell.q, r: bestCell.r } },
      ev: gain,
      tag: imminentDanger.has(cellKey(unit)) ? 'evacuate' : 'position',
    });
  }

  // ── 攻击 ──
  for (const unit of myUnits) {
    const used = projection.attacksUsed.get(unit.id) ?? 0;
    if (used >= attackLimit) continue;
    const spec = unitSpecOf(game, unit.type);
    if (!spec || unitRole(spec).healer) continue; // 治疗者把 AP 留给治疗与走位
    const from = projectedPositionOf(unit);
    const range = unit.attackRange ?? spec.attackRange ?? 1;
    const shape = shapeSpecOf(spec, 'attackShape');
    const seen = new Set();
    for (const aimCell of enumerateAimCells(from, shape, range, false)) {
      const aimKey = cellKey(aimCell);
      if (seen.has(aimKey)) continue;
      seen.add(aimKey);
      if (!playable.has(aimKey)) continue;
      const aim = coveredCellsOf(spec, 'attackShape', from, aimCell, range);
      if (!aim) continue;
      let ev = 0;
      let elimination = false;
      let lockTarget = null;
      if (spec.attackLock) {
        const occupant = (game.units ?? []).find(
          u => u.alive && u.owner !== owner && u.q === aimCell.q && u.r === aimCell.r);
        if (occupant && !projection.kills.has(occupant.id)) lockTarget = occupant;
      }
      if (lockTarget) {
        const escapeProb = lockEscapeProbabilityOf(game, from, lockTarget, range, playable);
        const hitProb = 1 - escapeProb;
        const seatEnemies = enemyUnitsOf(game, lockTarget.owner).length;
        elimination = killProbabilityOf(game, unit, lockTarget, effectiveHpOf(lockTarget)) >= 0.85
          && seatEnemies <= 1;
        ev += hitValueOf(unit, lockTarget, hitProb);
      } else {
        for (const enemy of enemies) {
          if (projection.kills.has(enemy.id)) continue;
          const distribution = forecastOf(game, enemy, step, imminentDanger, forecastCache);
          let mass = 0;
          for (const cell of aim.cells) {
            const entry = distribution.get(cellKey(cell));
            if (entry) mass += entry.prob;
          }
          if (mass <= 0.02) continue;
          const killProb = killProbabilityOf(game, unit, enemy, effectiveHpOf(enemy));
          const seatEnemies = enemyUnitsOf(game, enemy.owner).length;
          elimination = elimination || (killProb >= 0.85 && seatEnemies <= 1 && mass >= 0.6);
          ev += hitValueOf(unit, enemy, mass);
        }
      }
      if (ev <= 0) continue;
      if (elimination) ev += 1e6;
      // 反击风险不在这里再扣：positionScore 已含停留风险，攻击与"移动躲开"
      // 的比较 = 纯伤害价值 vs (位置收益 + 风险差)。这里再扣会双重计罚，
      // 导致接火时永远放风筝不还手。
      candidates.push({
        action: { type: 'attack', payload: { attackerId: unit.id, q: aimCell.q, r: aimCell.r } },
        ev: ev * discount,
        tag: lockTarget ? 'lock-shot' : 'attack',
      });
    }
  }

  // ── 治疗 ──
  for (const unit of myUnits) {
    const spec = unitSpecOf(game, unit.type);
    if (!spec || !unitRole(spec).healer) continue;
    const from = projectedPositionOf(unit);
    const range = healRangeOf(game, spec, unit);
    const shape = shapeSpecOf(spec, 'healShape');
    const seen = new Set();
    for (const aimCell of enumerateAimCells(from, shape, range, true)) {
      const aimKey = cellKey(aimCell);
      if (seen.has(aimKey)) continue;
      seen.add(aimKey);
      if (!playable.has(aimKey)) continue;
      const aim = coveredCellsOf(spec, 'healShape', from, aimCell, range);
      if (!aim) continue;
      // 引擎口径：施法者或任一覆盖格在当前危险圈 → 结算 fizzle。计划期直接跳过。
      if (danger.has(cellKey(from))) continue;
      if (aim.cells.some(cell => danger.has(cellKey(cell)))) continue;
      let ev = 0;
      for (const cell of aim.cells) {
        const ally = (game.units ?? []).find(
          u => u.alive && u.owner === owner && u.q === cell.q && u.r === cell.r);
        if (!ally) continue;
        const missing = effectiveMissingOf(ally); // 扣掉前缀已排治疗，避免重复排队落空
        if (missing <= 0) continue;
        ev += Math.min(missing, healMeanOf(game, spec));
      }
      if (ev <= 0) continue;
      candidates.push({
        action: { type: 'heal', payload: { supportId: unit.id, q: aimCell.q, r: aimCell.r } },
        ev: ev * 0.9 * discount,
        tag: 'heal',
      });
    }
  }

  // ── 部署 ──
  // 兵力上限：缩圈期每个单位平均每轮要花约 1 拍走位（贴着 1 环/轮的缩圈速度）
  // 加上战斗与治疗预留，行动点 +1 是养得起的全军规模——超编部队在炮圈里撤不动。
  // 另设凹地饱和门：出生据点邻格几乎占满时停止部署（部队要先流出走廊再补员）。
  const queuedDeployTypes = [];
  const planQueueAll = plan.myQueue ?? plan.queues?.[owner] ?? [];
  for (const action of planQueueAll) {
    if (action.type === 'deploy' && action.unitType) queuedDeployTypes.push(action.unitType);
  }
  const gaps = compositionGapsOf(game, myUnits, queuedDeployTypes);
  const maxArmy = budget + 1;
  const armySize = myUnits.length + queuedDeployTypes.length;
  const deployBlocked = armySize >= maxArmy;
  const deploySaturationGate = origin => {
    // 零兵力豁免：开局零单位的大逃杀图（army_destroyed 即淘汰）必须先爆兵活下来，
    // 饱和门只对已有部队的局面防凹地堵塞。
    if (myUnits.length === 0) return false;
    // 凹地拥挤门：据点 2 环内挤了太多自己人时停止补员——先流出走廊再爆兵，
    // 否则新兵把出生凹地塞死、全军动弹不得，缩圈开始后成片挨炮。
    const crowd = myUnits.filter(u => hexDistance(u, origin) <= 2).length
      + queuedDeploysNear(origin);
    const openCells = neighborsOf(origin).filter(n =>
      playable.has(cellKey(n))
      && terrainAtOf(game, projection.terrain, n) === 'plain'
      && !danger.has(cellKey(n))
      && !((game.units ?? []).some(u => u.alive && u.q === n.q && u.r === n.r))
      && !projection.deployDests.has(cellKey(n)));
    return crowd > TUNE.POCKET_CROWD_LIMIT || openCells.length < 2;
  };
  const queuedDeploysNear = origin => planQueueAll.filter(
    a => a.type === 'deploy' && typeof a.q === 'number'
      && hexDistance(a, origin) <= 2).length;
  for (const origin of (game.controlPoints ?? []).filter(p => p.owner === owner && cpCanDeploy(game, p))) {
    if (danger.has(cellKey(origin))) continue; // 引擎拒绝危险圈起点
    if (deployBlocked || deploySaturationGate(origin)) continue;
    for (const type of Object.keys(game.config?.units ?? {})) {
      const spec = unitSpecOf(game, type);
      if (!spec) continue;
      const cost = Math.max(0, (spec.cost ?? 0) - cpDiscount(game, origin));
      if (cost > supplies) continue;
      const gapBonus = (gaps.get(type) ?? 0) * 8;
      const urgency = engaged ? TUNE.DEPLOY_WARTIME : 1;
      for (const dir of HEX_DIRS) {
        const cell = { q: origin.q + dir.q, r: origin.r + dir.r };
        const key = cellKey(cell);
        if (!playable.has(key)) continue;
        if (terrainAtOf(game, projection.terrain, cell) !== 'plain') continue;
        if (danger.has(key)) continue; // 引擎拒绝危险圈落点
        if (claimAt(step).has(key)) continue;
        if (myFinalOccupied.has(key)) continue; // 友军最终位 / 前缀部署位 → 必失败
        if (enemyPlanCells.has(key)) continue; // 敌军大概率仍占，别赌
        let ev = TUNE.DEPLOY_BASE + unitValue(game, type) * 0.12 + gapBonus;
        if (nextDanger.has(key)) ev *= TUNE.DEPLOY_NEXT_DANGER;
        ev *= urgency;
        candidates.push({
          action: { type: 'deploy', payload: { unitType: type, fromId: origin.id, q: cell.q, r: cell.r } },
          ev,
          tag: 'deploy',
        });
      }
    }
  }

  // ── 爆破（工兵开路）：拆掉能显著缩短我爆破距离的墙 ──
  for (const unit of myUnits) {
    const spec = unitSpecOf(game, unit.type);
    // 引擎只允许 heavy 爆破（resolveDemolishes 的兵种门槛）。
    if (!spec || unit.type !== 'heavy') continue;
    const from = projectedPositionOf(unit);
    const myDist = blastDistOf(from);
    if (myDist === Infinity) continue;
    for (const dir of HEX_DIRS) {
      const wall = { q: from.q + dir.q, r: from.r + dir.r };
      const wallKey = cellKey(wall);
      if (!playable.has(wallKey)) continue;
      if (terrainAtOf(game, projection.terrain, wall) !== 'blocker') continue;
      if ((game.units ?? []).some(u => u.alive && u.q === wall.q && u.r === wall.r)) continue;
      // 墙打开后经它可达的最小场值 = 两侧 plain 邻格的最小场值 + 迈入 1。
      let opened = Infinity;
      for (const n of neighborsOf(wall)) {
        if (!playable.has(cellKey(n)) || terrainAtOf(game, projection.terrain, n) !== 'plain') continue;
        const d = blastField.get(cellKey(n));
        if (d !== undefined && d + 1 < opened) opened = d + 1;
      }
      if (opened === Infinity) continue;
      const gain = Math.min(myDist - (opened + 1), TUNE.BLAST_EV_CAP / TUNE.W_BLAST_PROGRESS);
      if (gain <= 0.5) continue;
      candidates.push({
        action: { type: 'demolish', payload: { unitId: unit.id, q: wall.q, r: wall.r } },
        ev: Math.min(gain * TUNE.W_BLAST_PROGRESS, TUNE.BLAST_EV_CAP),
        tag: 'demolish',
      });
    }
  }

  return { candidates };
}

// ────────────────────────────── 本地拒绝记忆 ──────────────────────────────
// 动作被引擎拒绝时状态不变、队列不增长，确定性的重算会再次给出同一动作。
// 用模块内记忆识别"同一轮同一队列长度下的重复发射"：把上次发射的指纹记入本轮
// 拒绝集，轮换次优候选。只记录自己发过的动作，不读任何隐藏信息。

const memoryByOwner = new Map();

function fingerprintOf(action) {
  return JSON.stringify({ type: action.type, payload: action.payload ?? {} });
}

function memoryOf(owner) {
  let memory = memoryByOwner.get(owner);
  if (!memory) {
    memory = { round: null, queueLen: null, lastEmitted: null, rejected: new Set() };
    memoryByOwner.set(owner, memory);
  }
  return memory;
}

// ────────────────────────────── 主入口 ──────────────────────────────

export default {
  name: 'echelon',
  description: '大逃杀：落点扩散预报 + 精确击杀概率 + 炮火圈生存调度的逐拍效用决策',

  /**
   * 决策函数：返回下一拍要入队的动作；null 表示提交计划。
   * 每次 call 无状态重算（前缀从 plan.myQueue 读回），拒绝记忆是唯一的模块内状态。
   */
  async decide(game, utils, ctx = {}) {
    void utils;
    const owner = ctx?.owner;
    if (!owner) return null;
    if (game?.config?.mode !== 'royale') return null;
    if (game?.phase !== 'active') return null;
    if (game?.players?.[owner]?.status !== 'active') return null;
    const plan = game.plan ?? {};
    if ((plan.committed ?? []).includes(owner)) return null;

    const round = game.turn?.roundNumber ?? 1;
    const queue = plan.myQueue ?? plan.queues?.[owner] ?? [];
    const memory = memoryOf(owner);
    if (memory.round !== round || memory.queueLen !== queue.length) {
      memory.round = round;
      memory.queueLen = queue.length;
      memory.rejected.clear();
      memory.lastEmitted = null;
    }

    const { candidates } = buildCandidates(game, owner);
    candidates.sort((a, b) => b.ev - a.ev
      || fingerprintOf(a.action).localeCompare(fingerprintOf(b.action)));

    let choice = candidates.find(candidate => !memory.rejected.has(fingerprintOf(candidate.action)));
    if (choice && memory.lastEmitted && fingerprintOf(choice.action) === memory.lastEmitted) {
      // 同一状态下再次被问 → 上次发射的动作被引擎拒绝，记入拒绝集后重选。
      memory.rejected.add(memory.lastEmitted);
      choice = candidates.find(candidate => !memory.rejected.has(fingerprintOf(candidate.action)));
    }
    if (!choice || choice.ev < TUNE.COMMIT_THRESHOLD) return null;

    memory.lastEmitted = fingerprintOf(choice.action);
    return { type: choice.action.type, payload: { ...choice.action.payload } };
  },
};

// 仅供测试：直接操纵拒绝记忆 / 读取调参表。运行链路（runner / local-worker）不使用。
export const __echelonTestHooks = {
  markRejected(owner, action) {
    memoryOf(owner).rejected.add(fingerprintOf(action));
  },
  resetMemory() {
    memoryByOwner.clear();
  },
  tune: TUNE,
  /** 调试：返回当前 decide 的全部候选（带效用与标签），不改变任何状态。 */
  debugCandidates(game, owner) {
    return buildCandidates(game, owner).candidates
      .map(c => ({ ...c, fp: fingerprintOf(c.action) }))
      .sort((a, b) => b.ev - a.ev);
  },
};
