// algorithms/builtin/fog-scout.mjs
//
// 迷雾模式（fog）启发式基线：雾眼/侦察推进 + 视野内交战 + 残影盲射。
//
// 只消费服务端投影后的玩家视角（契约 §4.3、skill/fog.md）：
// - game.units：自己全部单位 + 视野内敌军；隐藏敌军**不在数组里**，本文件不做任何反推；
// - game.fog.lastSeen：本阵营的残影（盲射目标）；
// - 公开信息：地形、总部位置/血量、据点归属/类型、补给、轮号、自己的计划队列。
// 注意：visibleCells 只用来确认「迷雾是否已揭」，**不进评分**——它是 hex 线段
// 光栅化的结果，在 120°/180° 旋转下会差 1~2 格，把逐格计数写进评分会让同一套
// 启发式在不同出生点走出不同形状（西北座胜率被压到 3% 的直接原因）。侦察收益改用
// 「目标格视野内、且不在其他己方单位视野内」的纯己方几何量（coverageGain）。
// 地图定义与 config 只用来读兵种数值、视野半径、部署规则与据点类型效果；不据此
// 推断隐藏单位的位置，也不使用炮火/贴目等非 fog 机制。
//
// 决策按「每轮最多 actionsPerTurn 个入队动作」推进；返回 null 表示提交计划。
// 优先级：斩杀/高价值攻击 > 治疗 > 占点与总部防御走位 > 侦察前压 > 残影盲射 > 部署。
// 候选动作全部按引擎 planning.ts 的入队校验镜像生成：地形寻路（units 不挡路）、
// 形状/射程瞄准（single/line/arc）、部署起点/平原/补给、每单位攻击次数与行动点预算，
// 因此不会给服务器送非法动作（runner 遇拒绝会空耗重问配额）。

const DIRS = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

// 与 src/engine/fog.ts 的 FOG_VISION_DEFAULTS 同口径；实际半径优先读地图覆盖值。
const VISION_FALLBACK = { scout: 4, ranger: 3, infantry: 2, support: 2, heavy: 1 };
// 目标价值只用于「打谁更值」，不是引擎数值；数值越高越优先集火。
const UNIT_VALUE = { scout: 320, infantry: 300, heavy: 260, ranger: 420, support: 380 };
// 敌方一个单位下一拍的压力权重（可移动 + 可攻击的粗威胁场）。
const THREAT_WEIGHT = { ranger: 3, heavy: 2, infantry: 1.5, scout: 1, support: 0.6 };
// 走位时对威胁暴露的惩罚系数（侦察/支援更怕死）。
const DANGER_WEIGHT = { scout: 90, ranger: 70, support: 80, infantry: 45, heavy: 25 };
const MAX_DEPLOYS_PER_ROUND = 2;

/**
 * 短期记忆：上一轮给某单位排的移动目标，下一轮没到位就算失败。
 *
 * 同一进程内按 (gameId, owner) 隔离（状态与 SSE 均为进程内，见 AGENTS.md）。
 * 失败的格子在下一轮扣分，让单位改选次优格，而不是机械地每轮重排同一格：
 * fog-crossing 中央格 (0,0) 是旋转不动点，三座侦察兵都会把它排成最优目标，
 * 同一步到达就全员 destination_conflict，随后每轮原地重排、连带把该单位后续
 * 动作全部作废（previous_action_failed）。
 * 扣分刻意低于据点占领价值（1600+）：高价值目标值得再试，记忆只打消「不是
 * 目标的重复撞格」；升级到能压过占点的扣分会把 2 人图拉成 28/72（已回归验证）。
 */
const planMemory = new Map();
const PLAN_MEMORY_LIMIT = 128;
const FAILED_CELL_PENALTY = 900;
const FAILED_CELL_DECAY = 300;

function memoryFor(game, owner) {
  const key = `${game.id}|${owner}`;
  let memory = planMemory.get(key);
  if (!memory) {
    if (planMemory.size >= PLAN_MEMORY_LIMIT) planMemory.delete(planMemory.keys().next().value);
    memory = { round: null, planned: new Map(), failed: new Map() };
    planMemory.set(key, memory);
  }
  return memory;
}

/** 结算上一轮：到位的删除；没到位的记成失败格，只保留 2 轮。 */
function settlePlanMemory(C, memory) {
  if (memory.round === C.round) return;
  if (memory.round !== null) {
    for (const [unitId, plan] of memory.planned) {
      const unit = C.own.find(candidate => candidate.id === unitId);
      if (!unit) { memory.planned.delete(unitId); continue; }
      if (unit.q === plan.q && unit.r === plan.r) { memory.planned.delete(unitId); continue; }
      memory.failed.set(cellKey(plan), C.round - 1);
    }
  }
  memory.planned.clear();
  memory.round = C.round;
  for (const [cell, round] of memory.failed) {
    if (C.round - round > 2) memory.failed.delete(cell);
  }
}

/** 只记移动：攻击/治疗不被撞格影响，不需要重试保护。 */
function rememberAction(memory, action) {
  if (action?.type !== 'move') return;
  memory.planned.set(action.payload.unitId, { q: action.payload.q, r: action.payload.r });
}

const cellKey = pos => `${pos.q},${pos.r}`;
const parseKey = key => {
  const [q, r] = key.split(',');
  return { q: Number(q), r: Number(r) };
};

function hexDistance(a, b) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(a.q + a.r - b.q - b.r));
}

function neighbors(pos) {
  return DIRS.map(d => ({ q: pos.q + d.q, r: pos.r + d.r }));
}

function shapeOf(spec, kind) {
  const shape = spec?.[kind];
  if (shape?.type === 'line') return { type: 'line', length: shape.length ?? 2 };
  if (shape?.type === 'arc') return { type: 'arc', length: 3 };
  return { type: 'single', length: 1 };
}

/**
 * 与 planning.ts 的 coveredCellsFor 同口径：返回覆盖格（合法）或 null（非法）。
 * 只用于判断「这一枪/这一针能不能排队」，不需要 direction。
 */
function aimCells(C, from, spec, kind, target, range) {
  if (!Number.isFinite(target.q) || !Number.isFinite(target.r)) return null;
  if (!C.inBounds(target)) return null;
  const distance = hexDistance(from, target);
  if (distance > range) return null;
  const shape = shapeOf(spec, kind);
  if (shape.type === 'single') {
    if (kind === 'attackShape' && distance === 0) return null;
    return [{ q: target.q, r: target.r }];
  }
  if (shape.type === 'arc') {
    if (distance !== 1) return null;
    const direction = DIRS.findIndex(
      d => d.q === target.q - from.q && d.r === target.r - from.r,
    );
    if (direction < 0) return null;
    return [(direction + 5) % 6, direction, (direction + 1) % 6]
      .map(index => ({ q: from.q + DIRS[index].q, r: from.r + DIRS[index].r }));
  }
  // line：目标格必须落在某个正六方向射线上，距离 1..min(length, range)。
  const length = Math.min(shape.length, range);
  const dq = target.q - from.q;
  const dr = target.r - from.r;
  for (const d of DIRS) {
    const k = d.q !== 0 ? dq / d.q : dr / d.r;
    if (!Number.isInteger(k) || k < 1 || k > length) continue;
    if (d.q * k !== dq || d.r * k !== dr) continue;
    const cells = [];
    for (let step = 1; step <= length; step++) {
      cells.push({ q: from.q + d.q * step, r: from.r + d.r * step });
    }
    return cells;
  }
  return null;
}

/** 只按地形 BFS（单位不挡路），镜像 planningReachableCells。 */
function reachableCells(C, from, moveRange) {
  const visited = new Set([cellKey(from)]);
  const result = [];
  const queue = [{ pos: from, distance: 0 }];
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    if (current.distance >= moveRange) continue;
    for (const next of neighbors(current.pos)) {
      const key = cellKey(next);
      if (visited.has(key)) continue;
      visited.add(key);
      if (!C.inBounds(next)) continue;
      if (C.terrainAt(next) !== 'plain') continue;
      result.push(next);
      queue.push({ pos: next, distance: current.distance + 1 });
    }
  }
  return result;
}

// ------------------------------------------------------------------ 上下文

function buildContext(game, owner, queue) {
  const cells = new Map();
  for (const cell of game.cells ?? []) {
    if (Number.isFinite(cell.q) && Number.isFinite(cell.r)) cells.set(cellKey(cell), cell);
  }
  if (cells.size === 0) return null;

  const terrain = new Map();
  for (const [key, cell] of cells) terrain.set(key, cell.terrain ?? 'plain');
  // map.terrainCells 是覆盖层，优先于 cells（与引擎 getTerrain 同序）。
  for (const cell of game.map?.terrainCells ?? []) {
    if (cells.has(cellKey(cell))) terrain.set(cellKey(cell), cell.terrain);
  }

  const fog = game.fog;
  const revealed = !fog || fog.revealed === true;

  const units = (game.units ?? []).filter(unit => unit && unit.alive !== false);
  const own = units.filter(unit => unit.owner === owner);
  const enemies = units.filter(unit => unit.owner !== owner);

  const round = game.turn?.roundNumber ?? game.turn?.turnNumber ?? 1;
  const rawSightings = Array.isArray(fog?.lastSeen)
    ? fog.lastSeen
    : Object.values(fog?.lastSeen?.[owner] ?? {});
  const sightings = rawSightings.filter(sighting =>
    sighting && sighting.owner !== owner
    && Number.isFinite(sighting.q) && Number.isFinite(sighting.r)
    && (sighting.hp ?? 1) > 0
    && (sighting.seenRound ?? 0) >= round - 1,
  );

  const positions = new Map();
  for (const unit of own) positions.set(unit.id, { q: unit.q, r: unit.r });
  const movedUnits = new Set();
  const attacked = new Map();
  const healUsed = new Set();
  const claimed = new Set();
  const queuedAttackCells = new Set();
  for (const action of queue) {
    if (!action || typeof action !== 'object') continue;
    if (action.type === 'move' && action.unitId && Number.isFinite(action.q) && Number.isFinite(action.r)) {
      positions.set(action.unitId, { q: action.q, r: action.r });
      movedUnits.add(action.unitId);
      claimed.add(cellKey(action));
    } else if (action.type === 'deploy' && Number.isFinite(action.q) && Number.isFinite(action.r)) {
      claimed.add(cellKey(action));
    } else if (action.type === 'attack' && action.attackerId && Number.isFinite(action.q)) {
      attacked.set(action.attackerId, (attacked.get(action.attackerId) ?? 0) + 1);
      queuedAttackCells.add(cellKey(action));
    } else if (action.type === 'heal' && action.supportId) {
      healUsed.add(action.supportId);
    }
  }

  const ownOccupied = new Set([...positions.values()].map(cellKey));
  const enemyCells = new Set(enemies.map(unit => cellKey(unit)));
  const enemyIds = new Set(enemies.map(unit => unit.id));
  const sightingsCells = new Set(sightings.map(sighting => cellKey(sighting)));

  const hqs = Object.entries(game.headquarters ?? {})
    .filter(([, hq]) => hq && hq.alive !== false && (hq.hp ?? 0) > 0);
  const ownHq = hqs.find(([id]) => id === owner)?.[1] ?? null;
  const enemyHqs = hqs
    .filter(([id]) => id !== owner)
    .map(([id, hq]) => ({ ...hq, owner: hq.owner ?? id }));
  const hqCells = new Set(hqs.map(([, hq]) => cellKey(hq)));

  const cps = (game.controlPoints ?? []).filter(point => point && Number.isFinite(point.q));
  const cpByCell = new Map(cps.map(point => [cellKey(point), point]));
  const repairPoints = cps.filter(point =>
    point.owner === owner
    && (game.config?.balance?.controlPointTypes?.[point.kind]?.repairAmount ?? 0) > 0,
  );

  const hqThreats = ownHq
    ? [
      ...enemies.filter(unit => hexDistance(unit, ownHq) <= 6),
      ...sightings.filter(sighting => hexDistance(sighting, ownHq) <= 5),
    ]
    : [];

  const deployOrigins = [];
  if (ownHq && game.config?.balance?.deployFromHq !== false) deployOrigins.push(ownHq);
  for (const point of cps) {
    if (point.owner !== owner) continue;
    const spec = game.config?.balance?.controlPointTypes?.[point.kind];
    if (spec?.canDeploy === false) continue;
    deployOrigins.push(point);
  }
  const sortedOrigins = [...deployOrigins].sort((a, b) =>
    nearestEnemyHqDistance({ q: a.q, r: a.r }, enemyHqs)
    - nearestEnemyHqDistance({ q: b.q, r: b.r }, enemyHqs),
  );
  // 候选排序的稳定序号：单位/总部的 id 是 randomUUID，跨进程不可复现；
  // 只拿数组下标做 tie-break，保证同种子同动作序列可逐局复现。
  const ownIndex = new Map(own.map((unit, index) => [unit.id, index]));
  const originIndex = new Map(sortedOrigins.map((origin, index) => [origin.id, index]));

  const specFor = type => game.config?.units?.[type] ?? {};
  const visionFor = type => {
    const override = game.config?.fog?.vision?.[type];
    const raw = override ?? VISION_FALLBACK[type] ?? 0;
    return Math.max(0, Math.min(8, Math.trunc(raw)));
  };
  const deployDiscount = origin => {
    const point = cps.find(candidate => candidate.id === origin.id && candidate.owner === owner);
    if (!point) return 0;
    return game.config?.balance?.controlPointTypes?.[point.kind]?.deployDiscount ?? 0;
  };
  const deployCost = (type, origin) =>
    Math.max(0, (specFor(type).cost ?? Infinity) - deployDiscount(origin));

  let plannedSpend = 0;
  let plannedDeploys = 0;
  for (const action of queue) {
    if (action?.type !== 'deploy') continue;
    plannedDeploys++;
    const origin = sortedOrigins.find(candidate => candidate.id === action.fromId);
    const cost = specFor(action.unitType).cost ?? 0;
    plannedSpend += Math.max(0, cost - (origin ? deployDiscount(origin) : 0));
  }

  const coverageCache = new Map();
  const ownCells = [...cells.keys()].map(parseKey);
  const C = {
    frameOf: buildSeatFrame(cells, ownHq, own),
    game, owner, queue, round,
    cells, terrain, revealed,
    own, enemies, sightings,
    positions, movedUnits, attacked, healUsed, claimed, queuedAttackCells,
    ownOccupied, enemyCells, enemyIds, sightingsCells, hqCells,
    ownHq, enemyHqs, hqs,
    cps, cpByCell, repairPoints, hqThreats,
    deployOrigins: sortedOrigins,
    ownIndex, originIndex,
    supplies: game.resources?.[owner]?.supplies ?? 0,
    plannedSpend,
    plannedDeploys,
    attackLimit: game.config?.balance?.attacksPerUnit ?? 1,
    minimumDamage: game.config?.balance?.minimumDamage ?? 1,
    specFor, visionFor, deployCost,
    inBounds: pos => cells.has(cellKey(pos)),
    terrainAt: pos => terrain.get(cellKey(pos)) ?? 'blocker',
    cpPriority: point => controlPriority(game, point),
    nearestEnemyHqDistance: pos => nearestEnemyHqDistance(pos, enemyHqs),
    // 侦查收益：目标格视野内、且不在其他己方单位视野内的格子数。
    // 只用公开地形 + 己方坐标，不依赖服务端 visibleCells 的逐格光栅结果——
    // 那个在 120° 旋转下会差 1~2 格（引擎侧已知），直接进评分会把噪声放大成
    // 固定方向的走位偏置，把三个座位的胜率拉开。
    coverageGain: (pos, radius, selfId) => {
      if (radius <= 0) return 0;
      const key = `${cellKey(pos)}|${radius}|${selfId}`;
      const cached = coverageCache.get(key);
      if (cached !== undefined) return cached;
      const mates = own.filter(unit => unit.id !== selfId);
      let count = 0;
      for (const cell of ownCells) {
        if (hexDistance(pos, cell) > radius) continue;
        if (mates.some(mate => hexDistance(cell, positions.get(mate.id) ?? mate) <= visionFor(mate.type))) continue;
        count++;
      }
      coverageCache.set(key, count);
      return count;
    },
    exposure: pos => exposureAt(enemies, sightings, pos),
  };
  return C;
}

function nearestEnemyHqDistance(pos, enemyHqs) {
  let best = Infinity;
  for (const hq of enemyHqs) best = Math.min(best, hexDistance(pos, hq));
  return best;
}

function controlPriority(game, point) {
  const effect = game.config?.balance?.controlPointTypes?.[point.kind] ?? null;
  if (point.kind === 'supply') return 16;
  if (point.kind === 'forward_base') return 13;
  if (point.kind === 'repair') return 11;
  return effect?.income || 8;
}

function exposureAt(enemies, sightings, pos) {
  let risk = 0;
  for (const enemy of enemies) {
    const reach = (enemy.moveRange ?? 0) + (enemy.attackRange ?? 0);
    if (hexDistance(pos, enemy) <= reach) risk += THREAT_WEIGHT[enemy.type] ?? 1;
  }
  for (const sighting of sightings) {
    if (hexDistance(pos, sighting) <= 3) risk += 0.4;
  }
  return risk;
}

// ------------------------------------------------------------------ 攻击

function attackCandidates(C) {
  const candidates = [];
  const targets = [
    ...C.enemies.map(unit => ({ kind: 'unit', entity: unit, pos: { q: unit.q, r: unit.r } })),
    ...C.enemyHqs.map(hq => ({ kind: 'headquarters', entity: hq, pos: { q: hq.q, r: hq.r } })),
  ];

  for (const unit of C.own) {
    if ((C.attacked.get(unit.id) ?? 0) >= C.attackLimit) continue;
    if (!(unit.attackRange > 0)) continue;
    const from = C.positions.get(unit.id) ?? { q: unit.q, r: unit.r };
    const spec = C.specFor(unit.type);
    for (const target of targets) {
      const key = cellKey(target.pos);
      // 同一格本轮已排过攻击：再排一次多半是空刀（先一步已打死/打跑）。
      if (C.queuedAttackCells.has(key)) continue;
      if (!aimCells(C, from, spec, 'attackShape', target.pos, unit.attackRange)) continue;
      candidates.push({
        action: { type: 'attack', payload: { attackerId: unit.id, q: target.pos.q, r: target.pos.r } },
        score: scoreAttack(C, unit, target),
        tie: C.frameOf(target.pos),
        pos: { q: target.pos.q, r: target.pos.r },
        order: C.ownIndex.get(unit.id) ?? 0,
      });
    }
  }
  return candidates;
}

function scoreAttack(C, unit, target) {
  const entity = target.entity;
  const expected = Math.max(C.minimumDamage, (unit.attack ?? 0) - (entity.defense ?? 0));
  if (target.kind === 'headquarters') {
    // 总部是公开目标：能拆就拆，斩杀直接淘汰对手。
    if (expected >= (entity.hp ?? 0)) return 13000;
    return 6000 + Math.min(expected, entity.hp ?? 0) * 12;
  }
  const value = UNIT_VALUE[entity.type] ?? 300;
  if (expected >= (entity.hp ?? 0)) return 10000 + value;
  return 5200 + value * 0.6 + Math.min(expected, entity.hp ?? 0) * 8 - (entity.hp ?? 0) * 0.4;
}

function blindFireCandidates(C) {
  const candidates = [];
  if (C.revealed) return candidates;

  for (const unit of C.own) {
    if ((C.attacked.get(unit.id) ?? 0) >= C.attackLimit) continue;
    if (!(unit.attackRange > 0)) continue;
    const from = C.positions.get(unit.id) ?? { q: unit.q, r: unit.r };
    const spec = C.specFor(unit.type);
    const shape = shapeOf(spec, 'attackShape');

    for (const sighting of C.sightings) {
      const key = cellKey(sighting);
      // 视野内已确认的敌军走 attackCandidates；同一单位已可见时不再打它的旧位置。
      if (C.enemyIds.has(sighting.unitId) || C.enemyCells.has(key) || C.queuedAttackCells.has(key)) continue;
      // 己方已占/下一步要占的格子不可能同时站着敌军，打它是纯浪费行动点。
      if (C.ownOccupied.has(key) || C.claimed.has(key)) continue;
      if (!aimCells(C, from, spec, 'attackShape', sighting, unit.attackRange)) continue;
      const stale = Math.max(0, C.round - 1 - (sighting.seenRound ?? C.round - 1));
      // 盲射是「买信息/买概率」：给残影一个中等价位，低于占点与防御，高于普通推进。
      // line/arc 覆盖多格，命中概率更高，略加权。
      let score = 1900 + (UNIT_VALUE[sighting.type] ?? 200) * 0.4 - stale * 250;
      if (shape.type !== 'single') score += 120;
      candidates.push({
        action: { type: 'attack', payload: { attackerId: unit.id, q: sighting.q, r: sighting.r } },
        score,
        tie: C.frameOf(sighting),
        pos: { q: sighting.q, r: sighting.r },
        order: C.ownIndex.get(unit.id) ?? 0,
      });
    }
  }
  return candidates;
}

// ------------------------------------------------------------------ 治疗

function healCandidates(C) {
  const candidates = [];
  for (const support of C.own) {
    // 引擎 checkHeal 硬性要求 type === 'support'；不能只看 healPower。
    if (support.type !== 'support') continue;
    if (C.healUsed.has(support.id)) continue;
    const spec = C.specFor(support.type);
    const healPower = spec.healPower ?? support.healPower ?? 0;
    if (!(healPower > 0)) continue;
    const healRange = spec.healRange ?? support.attackRange ?? 0;
    if (!(healRange > 0)) continue;
    const from = C.positions.get(support.id) ?? { q: support.q, r: support.r };

    for (const ally of C.own) {
      if ((ally.hp ?? 0) >= (ally.maxHp ?? 0)) continue;
      const pos = C.positions.get(ally.id) ?? { q: ally.q, r: ally.r };
      if (!aimCells(C, from, spec, 'healShape', pos, healRange)) continue;
      const missing = (ally.maxHp ?? 0) - (ally.hp ?? 0);
      const score = 3200 + missing * 4 + (UNIT_VALUE[ally.type] ?? 0) * 0.3;
      candidates.push({
        action: { type: 'heal', payload: { supportId: support.id, q: pos.q, r: pos.r } },
        score,
        tie: C.frameOf(pos),
        pos,
        order: C.ownIndex.get(support.id) ?? 0,
      });
    }
  }
  return candidates;
}

// ------------------------------------------------------------------ 走位

function moveCandidates(C) {
  const candidates = [];
  for (const unit of C.own) {
    if (C.movedUnits.has(unit.id)) continue;
    const moveRange = unit.moveRange ?? C.specFor(unit.type).moveRange ?? 0;
    if (!(moveRange > 0)) continue;
    const from = C.positions.get(unit.id) ?? { q: unit.q, r: unit.r };

    for (const to of reachableCells(C, from, moveRange)) {
      const key = cellKey(to);
      if (C.ownOccupied.has(key) || C.claimed.has(key)) continue;
      if (C.enemyCells.has(key) || C.hqCells.has(key)) continue;
      // 残影格大概率仍有敌军：踩进去会 destination_occupied/conflict，白费一步。
      if (C.sightingsCells.has(key)) continue;

      candidates.push({
        action: { type: 'move', payload: { unitId: unit.id, q: to.q, r: to.r } },
        score: scoreMove(C, unit, from, to),
        tie: C.frameOf(to),
        pos: to,
        order: C.ownIndex.get(unit.id) ?? 0,
      });
    }
  }
  return candidates;
}

function scoreMove(C, unit, from, to) {
  const spec = C.specFor(unit.type);
  const distanceNow = C.nearestEnemyHqDistance(from);
  const distanceNew = C.nearestEnemyHqDistance(to);
  const advance = Number.isFinite(distanceNow) && Number.isFinite(distanceNew)
    ? distanceNow - distanceNew
    : 0;

  let score = 700;
  if (unit.type === 'scout') {
    score += advance * 45 + C.coverageGain(to, C.visionFor('scout'), unit.id) * 14;
  } else if (unit.type === 'ranger') {
    score += advance * 70 + C.coverageGain(to, C.visionFor('ranger'), unit.id) * 4;
    // 游侠保持射程外的舒服距离（2..3），被贴脸会先死。
    // 只用「最近敌军距离」标量：nearestEnemy 的平手挑选依赖数组顺序，旋转下不等变。
    const nearest = nearestEnemyDistance(C.enemies, to);
    if (Number.isFinite(nearest)) {
      score += (3 - Math.abs(nearest - Math.min(3, unit.attackRange))) * 35;
    }
  } else {
    score += advance * 80;
  }

  // 占点：能占的据点优先，补给点 > 前线基地 > 维修点。
  const point = C.cpByCell.get(cellKey(to));
  if (point && point.owner !== C.owner && unit.canCapture) {
    score += 1600 + C.cpPriority(point) * 6;
  }

  // 维修：残血单位向己方维修点靠拢，贴住（<=1）就能吃到轮界修理。
  if ((unit.hp ?? 0) <= (unit.maxHp ?? 0) * 0.6 && C.repairPoints.length > 0) {
    const now = Math.min(...C.repairPoints.map(point2 => hexDistance(from, point2)));
    const next = Math.min(...C.repairPoints.map(point2 => hexDistance(to, point2)));
    score += (now - next) * 50;
    if (next <= 1) score += 180;
  }

  // 总部防御：自家总部被看到/残影逼近时，优先回防（侦察兵仍留一半注意力给视野）。
  if (C.ownHq && C.hqThreats.length > 0) {
    const now = hexDistance(from, C.ownHq);
    const next = hexDistance(to, C.ownHq);
    const guard = unit.type === 'scout' ? 0.5 : 1.2;
    score += (now - next) * 110 * Math.min(3, C.hqThreats.length) * guard;
  }

  // 支援站位：优先贴住受伤友军（下一拍治疗），否则跟随主力。
  if (unit.type === 'support') {
    const wounded = C.own
      .filter(ally => (ally.hp ?? 0) < (ally.maxHp ?? 0))
      .map(ally => C.positions.get(ally.id) ?? { q: ally.q, r: ally.r });
    if (wounded.length > 0) {
      const nearest = nearestOf(wounded, to);
      const now = hexDistance(from, nearest);
      const next = hexDistance(to, nearest);
      score += (now - next) * 60;
      if (next <= (spec.healRange ?? unit.attackRange ?? 1)) score += 200;
    } else {
      const mates = C.own
        .filter(ally => ally.id !== unit.id)
        .map(ally => C.positions.get(ally.id) ?? { q: ally.q, r: ally.r });
      if (mates.length > 0) {
        const centroid = centroidOf(mates);
        const now = hexDistance(from, centroid);
        const next = hexDistance(to, centroid);
        score += (now - next) * 40;
      }
    }
  }

  // 攻击预置：走到能打到可见敌军/敌方总部的格子，下一拍就能开火。
  if ((C.attacked.get(unit.id) ?? 0) < C.attackLimit && (unit.attackRange > 0)) {
    let setups = 0;
    for (const enemy of C.enemies) {
      if (aimCells(C, to, spec, 'attackShape', enemy, unit.attackRange)) {
        setups++;
        if (setups >= 2) break;
      }
    }
    if (setups < 2) {
      for (const hq of C.enemyHqs) {
        if (aimCells(C, to, spec, 'attackShape', hq, unit.attackRange)) {
          setups++;
          break;
        }
      }
    }
    score += Math.min(setups, 2) * 260;
  }

  score -= C.exposure(to) * (DANGER_WEIGHT[unit.type] ?? 50);

  // 上一轮排过但没到位的格子：大概率是撞格/被占。扣分上限低于占点收益，
  // 只把「非目标的机械重排」换成次优格，不阻止继续争夺高价值据点。
  const failedRound = C.failedCells?.get(cellKey(to));
  if (failedRound !== undefined) {
    score -= FAILED_CELL_PENALTY - FAILED_CELL_DECAY * Math.max(0, C.round - 1 - failedRound);
  }

  // 侦察兵不要脱离全队太远：没有任何友军在两格内时扣分（孤军深入=白送视野）。
  if (unit.type === 'scout') {
    const mates = C.own
      .filter(ally => ally.id !== unit.id)
      .map(ally => C.positions.get(ally.id) ?? { q: ally.q, r: ally.r });
    if (mates.length > 0 && nearestOf(mates, to) > 3) score -= 140;
  }

  return score;
}

function nearestEnemyDistance(enemies, pos) {
  let best = Infinity;
  for (const enemy of enemies) best = Math.min(best, hexDistance(pos, enemy));
  return best;
}

function nearestOf(positions, pos) {
  let best = Infinity;
  for (const candidate of positions) best = Math.min(best, hexDistance(pos, candidate));
  return best;
}

function centroidOf(positions) {
  if (positions.length === 0) return { q: 0, r: 0 };
  const total = positions.reduce((acc, pos) => ({ q: acc.q + pos.q, r: acc.r + pos.r }), { q: 0, r: 0 });
  return { q: total.q / positions.length, r: total.r / positions.length };
}

// ------------------------------------------------------------------ 座位坐标系

/**
 * 座位局部坐标系：原点 = 自家总部，极轴 = 自家总部→棋盘重心。
 *
 * 候选格用两个整数不变量排序：
 *   dot   = 沿极轴的投影（越大越靠中心）
 *   cross = 与极轴的叉积（符号区分左右两侧）
 * 平面坐标取整数缩放 X = 2q + r、Y = 3r，内积权重 (3, 1) 抵消两轴尺度差；
 * 120° 旋转是这两个坐标的等距变换，dot / cross 因而在「棋盘整体旋转 + 座位
 * 一起转到下一个座位」时数值不变。三个座位的同构候选拿到同一组 (dot, cross)，
 * 排序结果互为旋转像——这就是 tie-break 的等变性来源。
 *
 * 反例（修复前）：按 `${q},${r}` 字典序 tie-break，三个座位都偏向同一个绝对
 * 方向（q 越小越优先）。东座因此总往中心走、西北座被推向外圈角落，胜率被
 * 出生坐标绑死（fog-crossing east 58% / northwest 8%）。
 */
function buildSeatFrame(cells, ownHq, own) {
  const origin = ownHq ?? roundedCentroid(own) ?? { q: 0, r: 0 };
  const planeX = pos => 2 * pos.q + pos.r;
  const planeY = pos => 3 * pos.r;
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (const key of cells.keys()) {
    const pos = parseKey(key);
    sumX += planeX(pos);
    sumY += planeY(pos);
    count++;
  }
  const originX = planeX(origin);
  const originY = planeY(origin);
  // 未归一化的极轴向量（N 倍），只需符号/序关系，保持整数精确。
  const axisX = sumX - count * originX;
  const axisY = sumY - count * originY;
  const degenerate = axisX === 0 && axisY === 0;
  return pos => {
    const dx = planeX(pos) - originX;
    const dy = planeY(pos) - originY;
    if (degenerate) {
      // 总部正好在棋盘重心（无方向可锚）：退化成到原点的距离，仅保证确定。
      return { dot: -hexDistance(pos, origin), cross: 0 };
    }
    return {
      dot: 3 * dx * axisX + dy * axisY,
      cross: dx * axisY - dy * axisX,
    };
  };
}

/** 自家单位（无总部时）的取整重心；六角格旋转对称，取整与旋转可交换。 */
function roundedCentroid(own) {
  if (!own || own.length === 0) return null;
  const total = own.reduce((acc, unit) => ({ q: acc.q + unit.q, r: acc.r + unit.r }), { q: 0, r: 0 });
  return { q: Math.round(total.q / own.length), r: Math.round(total.r / own.length) };
}

// ------------------------------------------------------------------ 部署

function deployCandidates(C) {
  const candidates = [];
  if (C.plannedDeploys >= MAX_DEPLOYS_PER_ROUND) return candidates;
  const type = chooseDeployType(C);
  if (!type) return candidates;
  const remaining = C.supplies - C.plannedSpend;

  for (const origin of C.deployOrigins) {
    const cost = C.deployCost(type, origin);
    if (!Number.isFinite(cost) || cost > remaining) continue;
    for (const pos of neighbors(origin)) {
      if (!C.inBounds(pos) || C.terrainAt(pos) !== 'plain') continue;
      const key = cellKey(pos);
      if (C.claimed.has(key) || C.ownOccupied.has(key)) continue;
      if (C.enemyCells.has(key) || C.hqCells.has(key)) continue;
      if (C.sightingsCells.has(key)) continue;
      candidates.push({
        action: {
          type: 'deploy',
          payload: { unitType: type, fromId: origin.id, q: pos.q, r: pos.r },
        },
        score: scoreDeploy(C, type, origin, pos),
        tie: C.frameOf(pos),
        pos: { q: pos.q, r: pos.r },
        order: C.originIndex.get(origin.id) ?? 0,
      });
    }
  }
  return candidates;
}

function chooseDeployType(C) {
  const counts = {};
  for (const unit of C.own) counts[unit.type] = (counts[unit.type] ?? 0) + 1;
  const wounded = C.own.filter(unit => (unit.hp ?? 0) < (unit.maxHp ?? 0)).length;
  const available = C.supplies - C.plannedSpend;
  const cost = type => C.specFor(type).cost ?? Infinity;

  const order = [];
  // 没有侦察兵就补视野；没有远程就补射程；残血多且有补给就补维修。
  if ((counts.scout ?? 0) === 0) order.push('scout');
  if ((counts.support ?? 0) === 0 && wounded >= 2) order.push('support');
  if ((counts.ranger ?? 0) === 0) order.push('ranger');
  if (C.own.length <= 2) order.push('infantry');
  order.push('infantry', 'ranger', 'heavy');

  for (const type of order) {
    if (!Number.isFinite(cost(type))) continue;
    if (cost(type) <= available) return type;
  }
  return null;
}

function scoreDeploy(C, type, origin, pos) {
  let score = 1200;
  const distance = C.nearestEnemyHqDistance(origin);
  if (Number.isFinite(distance)) score += Math.max(0, 18 - distance) * 18;
  if (C.own.length < 3) score += 420;
  if (type === 'scout' && C.own.length < 5) score += 150;
  if (type === 'ranger') score += 120;
  if (type === 'support' && C.own.some(unit => (unit.hp ?? 0) < (unit.maxHp ?? 0))) score += 240;
  score -= C.exposure(pos) * 60;
  return score;
}

// ------------------------------------------------------------------ 入口

function compareCandidates(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  // tie-break 在座位局部坐标系里做（旋转等变），不用 `${q},${r}` 字典序。
  if (b.tie.dot !== a.tie.dot) return b.tie.dot - a.tie.dot;
  if (a.tie.cross !== b.tie.cross) return a.tie.cross - b.tie.cross;
  if (a.order !== b.order) return a.order - b.order;
  // 坐标系退化（总部在棋盘重心）时才需要：用绝对坐标把顺序补成全序。
  if (a.pos.q !== b.pos.q) return a.pos.q - b.pos.q;
  return a.pos.r - b.pos.r;
}

export default {
  name: 'fog-scout',
  description: '迷雾：视野内交战与残影盲射，侦察前压、据点争夺与总部攻防',

  async decide(game, _utils, ctx) {
    const owner = ctx?.owner;
    if (!owner || game?.config?.mode !== 'fog') return null;
    if (game.phase !== 'active') return null;
    if (game.players?.[owner]?.status !== 'active') return null;
    const plan = game.plan;
    if (!plan || (plan.committed ?? []).includes(owner)) return null;

    const queue = plan.queues?.[owner] ?? plan.myQueue ?? [];
    const actionLimit = game.config?.balance?.actionsPerTurn ?? 5;
    if (queue.length >= actionLimit) return null;

    const C = buildContext(game, owner, queue);
    if (!C) return null;
    const memory = memoryFor(game, owner);
    settlePlanMemory(C, memory);
    C.failedCells = memory.failed;

    const candidates = [
      ...attackCandidates(C),
      ...healCandidates(C),
      ...blindFireCandidates(C),
      ...moveCandidates(C),
      ...deployCandidates(C),
    ];
    if (candidates.length === 0) return null;
    candidates.sort(compareCandidates);
    const chosen = candidates[0].action;
    rememberAction(memory, chosen);
    return chosen;
  },
};
