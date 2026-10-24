// algorithms/builtin/tempo.mjs
//
// 时序掌控算法（同时回合专用，地图通用）：
//   1. 敌方剧本预测——为每个敌军单位推一条最可能的行为剧本（抢点 / 原地开火 /
//      残血撤退 / 向最近目标推进），逐拍投影其位置，作为预测射击与避险的依据；
//   2. 威胁时间线——把敌方预测射击（高权重）与可及火力区（低权重）叠加成
//      「第 k 拍 × 格子」的伤害地图，移动候选按落地拍起的累计暴露计价；
//   3. 裁决姿态——读取 adjudication 快照的分差与剩余轮数调节攻守：
//      领先收敛避险、落后加压求变、临近末轮清空补给，全部权重来自 config；
//   4. 逐拍排程——斩杀/锁定射击抢早拍（早击杀作废受害者后续动作）、
//      占点到达压末拍（少挨打照样拿点）、治疗排在预测伤害之后、部署抢先当墙。
//
// 接口：decide(game, utils, ctx) 每次返回一个动作（入队），null 表示提交。
// 每次调用都从「已入队前缀」之后的投影局面重排剩余计划，天然适配 runner 的
// 逐条入队循环；模块级记忆识别「上一次给出的动作未被服务器接受」并在重排时
// 禁掉它，避免确定性算法在被拒动作上打转。

// ---------------------------------------------------------------- 基础几何

const HEX_DIRS = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

function cellKey(p) {
  return `${p.q},${p.r}`;
}

function hexDist(a, b) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
}

/** 稳定微扰：同值候选按内容哈希分出确定次序，不引入随机源。 */
function jitter(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return ((h >>> 0) % 1000) / 1000000;
}

// ---------------------------------------------------------------- 形状覆盖

function shapeOf(spec, kind) {
  const shape = spec?.[kind];
  if (!shape) return { type: 'single', length: 1 };
  if (shape.type === 'line') return { type: 'line', length: shape.length ?? 2 };
  if (shape.type === 'arc') return { type: 'arc', length: 3 };
  return { type: 'single', length: 1 };
}

/**
 * 由施放者位置推导「瞄准 target 时」的覆盖格；不合法返回 null。
 * 与引擎 computeCoveredCells 同口径：single 射程内任选（攻击不可瞄自身）、
 * arc 瞄相邻格覆盖三格、line 瞄射线格覆盖前 min(length, range) 格。
 */
function coverageOf(from, spec, kind, target, range) {
  const shape = shapeOf(spec, kind);
  const dist = hexDist(from, target);
  if (dist > range) return null;
  if (shape.type === 'single') {
    if (kind === 'attackShape' && dist === 0) return null;
    return [{ q: target.q, r: target.r }];
  }
  if (shape.type === 'arc') {
    if (dist !== 1) return null;
    const dir = HEX_DIRS.findIndex(d => d.q === target.q - from.q && d.r === target.r - from.r);
    if (dir < 0) return null;
    return [(dir + 5) % 6, dir, (dir + 1) % 6].map(i => ({
      q: from.q + HEX_DIRS[i].q,
      r: from.r + HEX_DIRS[i].r,
    }));
  }
  const length = Math.min(shape.length, range);
  for (const d of HEX_DIRS) {
    const dq = target.q - from.q;
    const dr = target.r - from.r;
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

/** 单位在 from 处的全部合法攻击瞄准格（去重后的点击格）。 */
function attackAims(from, spec, range, focusCells) {
  const shape = shapeOf(spec, 'attackShape');
  if (shape.type === 'single') {
    const aims = new Map();
    for (const cell of focusCells) {
      if (coverageOf(from, spec, 'attackShape', cell, range)) aims.set(cellKey(cell), cell);
    }
    return [...aims.values()];
  }
  // arc 瞄相邻格定向；line 瞄射线上最远覆盖格（覆盖与瞄近端等价，取远端统一）。
  const length = Math.min(shape.length, range);
  const k = shape.type === 'arc' ? 1 : length;
  return HEX_DIRS.map(d => ({ q: from.q + d.q * k, r: from.r + d.r * k }));
}

/** 单位在 from 处的全部威胁可及格（威胁时间线的低权重泛化项）。 */
function coverableCells(from, spec, range) {
  const shape = shapeOf(spec, 'attackShape');
  if (shape.type === 'arc') {
    return HEX_DIRS.map(d => ({ q: from.q + d.q, r: from.r + d.r }));
  }
  if (shape.type === 'line') {
    const cells = [];
    const length = Math.min(shape.length, range);
    for (const d of HEX_DIRS) {
      for (let k = 1; k <= length; k++) cells.push({ q: from.q + d.q * k, r: from.r + d.r * k });
    }
    return cells;
  }
  const cells = [];
  for (let dq = -range; dq <= range; dq++) {
    for (let dr = Math.max(-range, -dq - range); dr <= Math.min(range, -dq + range); dr++) {
      if (dq === 0 && dr === 0) continue;
      cells.push({ q: from.q + dq, r: from.r + dr });
    }
  }
  return cells;
}

// ---------------------------------------------------------------- 局面工具

/** 只按地形寻路的可达格（计划期口径：单位与总部不挡路）。 */
function terrainField(ctx, from, range) {
  const visited = new Set([cellKey(from)]);
  const out = [];
  const queue = [{ p: { q: from.q, r: from.r }, d: 0 }];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    if (cur.d >= range) continue;
    for (const d of HEX_DIRS) {
      const n = { q: cur.p.q + d.q, r: cur.p.r + d.r };
      const k = cellKey(n);
      if (visited.has(k)) continue;
      visited.add(k);
      if (!ctx.playable.has(k)) continue;
      if (ctx.terrain.get(k) !== 'plain') continue;
      out.push(n);
      queue.push({ p: n, d: cur.d + 1 });
    }
  }
  return out;
}

function expectedDamage(ctx, attack, defense) {
  const min = ctx.balance.minimumDamage ?? 1;
  return Math.max(min, attack - defense);
}

function expectedHeal(ctx, support) {
  const spec = ctx.specs[support.type] ?? {};
  return (support.healPower ?? spec.healPower ?? 0) + (ctx.balance.healVarianceRange ?? 0) / 2;
}

function buildContext(game, owner) {
  const balance = game.config?.balance ?? {};
  const specs = game.config?.units ?? {};
  const playable = new Set((game.cells ?? []).map(c => `${c.q},${c.r}`));
  const terrain = new Map();
  for (const c of game.cells ?? []) terrain.set(`${c.q},${c.r}`, c.terrain ?? 'plain');
  for (const c of game.map?.terrainCells ?? []) terrain.set(`${c.q},${c.r}`, c.terrain);

  const seats = Object.keys(game.players ?? {}).filter(id => game.players[id]?.status === 'active');
  const enemySeats = seats.filter(id => id !== owner);
  const units = (game.units ?? []).filter(u => u.alive);
  const myUnits = units.filter(u => u.owner === owner);
  const enemies = units.filter(u => enemySeats.includes(u.owner));
  const myHqRaw = game.headquarters?.[owner];
  const myHq = myHqRaw && myHqRaw.alive !== false ? myHqRaw : null;
  const enemyHqs = enemySeats.map(id => game.headquarters?.[id]).filter(h => h && h.alive !== false);
  const cps = game.controlPoints ?? [];

  const round = game.turn?.roundNumber ?? game.turn?.turnNumber ?? 1;
  const maxTurns = game.adjudication?.maxTurns ?? balance.maxTurns ?? null;
  const roundsLeft = maxTurns ? Math.max(0, maxTurns - round) : 8;
  const horizon = Math.min(roundsLeft + 1, 8);

  const W = game.adjudication?.weights ?? balance.adjudicationWeights ?? {};
  const weights = {
    hqDmg: W.enemyHqDamage ?? 1,
    ownHq: W.ownHqHp ?? 1,
    cp: W.controlPoint ?? 1,
    army: W.armyValue ?? 1,
    supplies: W.supplies ?? 0,
    kill: W.killValue ?? 0,
    flow: W.controlPointFlowRatio ?? 0.7,
  };

  // 裁决姿态：领先（rel>0）收敛避险、落后加压；临近末轮把倾向推到极值。
  let rel = 0;
  const scores = game.adjudication?.scores;
  if (scores?.[owner]) {
    const mine = scores[owner].total ?? 0;
    const bestOther = Math.max(0, ...enemySeats.map(id => scores[id]?.total ?? 0));
    const denom = Math.max(50, Math.abs(mine), Math.abs(bestOther));
    rel = (mine - bestOther) / denom;
  }
  const endgame = maxTurns !== null && roundsLeft <= 2;
  let aggression = Math.min(1.8, Math.max(0.55, 1 - rel * 1.5));
  let riskAversion = Math.min(1.9, Math.max(0.5, 1 + rel * 1.5));
  if (endgame) {
    aggression = rel >= 0 ? 0.6 : 1.6;
    riskAversion = rel >= 0 ? 1.8 : 0.6;
  }

  const danger = new Set((game.artillery?.dangerCells ?? []).map(cellKey));

  return {
    game, owner, balance, specs, playable, terrain,
    seats, enemySeats, units, myUnits, enemies, myHq, enemyHqs, cps,
    round, maxTurns, roundsLeft, horizon, weights,
    aggression, riskAversion, endgame, danger,
    ap: Math.max(0, balance.actionsPerTurn ?? 5),
    attacksPerUnit: Math.max(1, balance.attacksPerUnit ?? 1),
  };
}

// ---------------------------------------------------------------- 价值标尺

function hpValueOf(ctx, unit) {
  const cost = ctx.specs[unit.type]?.cost ?? unit.cost ?? 50;
  return 0.4 + (ctx.weights.army * cost) / Math.max(1, unit.maxHp);
}

function damageValue(ctx, target, dmg) {
  if (target.kind === 'hq') {
    const kill = dmg >= target.entity.hp;
    return dmg * (0.25 + ctx.weights.hqDmg) + (kill ? 40 : 0);
  }
  const u = target.entity;
  const kill = dmg >= u.hp;
  const cost = ctx.specs[u.type]?.cost ?? u.cost ?? 50;
  return dmg * hpValueOf(ctx, u) + (kill ? 2 + (ctx.weights.kill + ctx.weights.army) * cost : 0);
}

function captureValue(ctx, cp) {
  const kindSpec = ctx.balance.controlPointTypes?.[cp.kind];
  const income = kindSpec?.income ?? ctx.balance.controlPointIncome ?? 0;
  return (
    1.5 +
    ctx.weights.cp * (ctx.weights.flow * ctx.horizon + (1 - ctx.weights.flow)) +
    income * ctx.horizon * (0.1 + ctx.weights.supplies)
  );
}

function healValue(ctx, ally, amount, threatAt) {
  const healed = Math.min(ally.maxHp - ally.hp, amount);
  if (healed <= 0) return 0;
  const saveBonus = threatAt >= ally.hp ? 1.8 : 1;
  return healed * hpValueOf(ctx, ally) * saveBonus;
}

// ---------------------------------------------------------------- 敌方剧本

/**
 * 为每个敌军单位推一条最可能的剧本并逐拍投影位置。
 * 剧本模型是通明的通用启发式（抢点 > 原地开火 > 残血撤退 > 推进），
 * 不针对任何具体对手或地图。返回 { posAt, shots, moved }。
 */
function predictEnemy(ctx, e, myConsidered) {
  const from = { q: e.q, r: e.r };
  const spec = ctx.specs[e.type] ?? {};
  const range = e.attackRange ?? spec.attackRange ?? 1;
  const reachable = terrainField(ctx, from, e.moveRange ?? spec.moveRange ?? 0);

  const targetValue = (t) =>
    t.kind === 'hq' ? 0.3 + ctx.weights.hqDmg : hpValueOf(ctx, t.entity);

  // 原地开火：当前位置已有可打目标 → 不动，第一步就打。
  const targetsHere = myConsidered.filter(t => hexDist(from, t.entity) <= range);
  if (targetsHere.length > 0) {
    const aim = targetsHere.slice().sort((a, b) => targetValue(b) - targetValue(a))[0];
    const cells = coverageOf(from, spec, 'attackShape', aim.entity, range) ?? [];
    return { posAt: () => from, shots: [{ step: 1, cells }], moved: false };
  }

  let dest = null;

  // 抢点：可占点单位且一步内有非己据点 → 第一步踩点。
  if (e.canCapture ?? spec.canCapture) {
    let best = null;
    let bestScore = -Infinity;
    for (const cp of ctx.cps) {
      if (cp.owner === e.owner) continue;
      if (!reachable.some(p => p.q === cp.q && p.r === cp.r)) continue;
      const score = captureValue(ctx, cp) - hexDist(from, cp) * 0.2;
      if (score > bestScore) { bestScore = score; best = cp; }
    }
    if (best) dest = { q: best.q, r: best.r };
  }

  // 残血撤退：向己方 HQ 侧拉开。
  if (!dest && e.hp <= e.maxHp * 0.3) {
    const ownHq = ctx.game.headquarters?.[e.owner];
    if (ownHq && ownHq.alive !== false && reachable.length > 0) {
      dest = reachable.slice().sort((a, b) => hexDist(a, ownHq) - hexDist(b, ownHq))[0];
    }
  }

  // 推进：朝最近的我方目标（总部优先）压上。
  if (!dest && reachable.length > 0 && myConsidered.length > 0) {
    const nearest = myConsidered
      .map(t => t.entity)
      .sort((a, b) => hexDist(from, a) - hexDist(from, b))[0];
    dest = reachable.slice().sort((a, b) => hexDist(a, nearest) - hexDist(b, nearest))[0];
  }

  const shots = [];
  if (dest) {
    // 移动后若有目标进射程 → 第二步开火（最常见的推进-射击节奏）。
    const targetsAfter = myConsidered.filter(t => hexDist(dest, t.entity) <= range);
    if (targetsAfter.length > 0) {
      const aim = targetsAfter.slice().sort((a, b) => targetValue(b) - targetValue(a))[0];
      const cells = coverageOf(dest, spec, 'attackShape', aim.entity, range) ?? [];
      shots.push({ step: 2, cells });
    }
  }
  return { posAt: () => dest ?? from, shots, moved: Boolean(dest) };
}

/**
 * 威胁时间线：threat[k] = Map(cellKey → 该拍落在该格的期望伤害)。
 * 预测射击高权重、可及火力区低权重；攻击在同拍移动之后结算，
 * 因此第 1 拍的威胁就按敌方投影位置计。
 */
function buildThreat(ctx, scripts, steps) {
  const threat = Array.from({ length: steps + 1 }, () => new Map());
  const avgDef = ctx.myUnits.length > 0
    ? ctx.myUnits.reduce((s, u) => s + (u.defense ?? ctx.specs[u.type]?.defense ?? 0), 0) / ctx.myUnits.length
    : 0;
  const add = (k, cell, amount) => {
    if (k < 1 || k > steps || amount <= 0) return;
    const map = threat[k];
    const key = cellKey(cell);
    map.set(key, (map.get(key) ?? 0) + amount);
  };
  for (const [e, script] of scripts) {
    const spec = ctx.specs[e.type] ?? {};
    const range = e.attackRange ?? spec.attackRange ?? 1;
    const dmg = expectedDamage(ctx, e.attack ?? spec.attack ?? 0, avgDef);
    for (const shot of script.shots) {
      for (let k = Math.max(1, shot.step); k <= steps; k++) {
        for (const cell of shot.cells) add(k, cell, dmg * 0.65);
      }
    }
    for (let k = 1; k <= steps; k++) {
      for (const cell of coverableCells(script.posAt(k), spec, range)) {
        add(k, cell, dmg * 0.08);
      }
    }
  }
  return threat;
}

function threatFrom(ctx, threat, cell, fromStep) {
  let sum = 0;
  const key = cellKey(cell);
  for (let k = Math.max(1, fromStep); k < threat.length; k++) sum += threat[k].get(key) ?? 0;
  return sum;
}

// ---------------------------------------------------------------- 候选生成

/**
 * 全部候选 mission：{ legs: [{type, payload, phase}], value, unitId?, deployCost? }。
 * phase: 'early' 斩杀/锁定/部署抢先 | 'mid' 常规 | 'late' 占点到达/治疗压末拍。
 */
function generateMissions(ctx, proj, threat, scripts) {
  const missions = [];

  // 敌占格预测：格子 → 占据概率（剧本落点 0.6 / 留守 0.25；HQ 恒 1）。
  const occProb = new Map();
  const bump = (cell, p) => {
    const k = cellKey(cell);
    occProb.set(k, Math.min(1, (occProb.get(k) ?? 0) + p));
  };
  for (const [e, script] of scripts) {
    bump(script.posAt(1), 0.6);
    if (script.moved) bump(e, 0.25);
  }
  for (const hq of ctx.enemyHqs) occProb.set(cellKey(hq), 1);
  const probAt = (cell) => occProb.get(cellKey(cell)) ?? 0;

  const enemyTargets = [
    ...ctx.enemies.map(u => ({ kind: 'unit', entity: u })),
    ...ctx.enemyHqs.map(h => ({ kind: 'hq', entity: h })),
  ];

  for (const u of ctx.myUnits) {
    const spec = ctx.specs[u.type] ?? {};
    const from = proj.positions.get(u.id) ?? { q: u.q, r: u.r };
    const attacksUsed = proj.attacks.get(u.id) ?? 0;
    const canAttack = (u.attack ?? spec.attack ?? 0) > 0 && attacksUsed < ctx.attacksPerUnit;
    const range = u.attackRange ?? spec.attackRange ?? 0;
    const moved = (proj.queue ?? []).some(a => a.type === 'move' && a.unitId === u.id);
    const reachable = moved ? [] : terrainField(ctx, from, u.moveRange ?? spec.moveRange ?? 0);

    // ---------- 攻击（原地 / 移动后） ----------
    if (canAttack && range > 0) {
      const focus = [];
      for (const t of enemyTargets) {
        focus.push({ q: t.entity.q, r: t.entity.r });
        const script = t.kind === 'unit' ? scripts.get(t.entity) : null;
        if (script && script.moved) focus.push(script.posAt(1));
      }
      const fromCells = [null, ...reachable.slice(0, 60)];
      for (const f of fromCells) {
        const pf = f ?? from;
        for (const aim of attackAims(pf, spec, range, focus)) {
          if (!ctx.playable.has(cellKey(aim))) continue;
          const cells = coverageOf(pf, spec, 'attackShape', aim, range);
          if (!cells) continue;
          let value = 0;
          let lethal = false;
          let locked = false;
          for (const t of enemyTargets) {
            const covered = cells.some(c => c.q === t.entity.q && c.r === t.entity.r);
            const script = t.kind === 'unit' ? scripts.get(t.entity) : null;
            const predicted = script
              ? cells.some(c => { const p = script.posAt(1); return c.q === p.q && c.r === p.r; })
              : false;
            if (!covered && !predicted) continue;
            // 锁定：计划时敌人正站在瞄准格上 → 未逃出射程必命中。
            const isLock = Boolean(spec.attackLock) && covered && t.kind === 'unit';
            let p;
            if (t.kind === 'hq') p = 1;
            else if (isLock) p = 0.95;
            else if (predicted && covered) p = 0.7;
            else if (predicted) p = 0.55;
            else p = script && !script.moved ? 0.6 : 0.22;
            const dmg = expectedDamage(ctx, u.attack ?? spec.attack ?? 0, t.entity.defense ?? 0);
            const v = damageValue(ctx, t, dmg) * p;
            value += v;
            if (p >= 0.5 && dmg >= (t.entity.hp ?? 0)) lethal = true;
            if (isLock) locked = true;
          }
          if (value <= 0.05) continue;
          value *= ctx.aggression;
          const legs = [];
          if (f) {
            const exposure = threatFrom(ctx, threat, f, 1) * hpValueOf(ctx, u) * ctx.riskAversion;
            // 移动腿要额外烧 1 拍 AP 并承担失败连锁：同值时原地开火优先。
            value -= exposure * 0.6 + 0.3;
            legs.push({ type: 'move', payload: { unitId: u.id, q: f.q, r: f.r }, phase: 'mid' });
          }
          legs.push({
            type: 'attack',
            payload: { attackerId: u.id, q: aim.q, r: aim.r },
            phase: lethal || locked ? 'early' : 'mid',
          });
          if (value <= 0.05) continue;
          missions.push({
            legs, unitId: u.id,
            value: value + jitter(`atk|${u.id}|${aim.q},${aim.r}|${pf.q},${pf.r}`),
          });
        }
      }
    }

    // ---------- 占点 ----------
    if (u.canCapture ?? spec.canCapture) {
      for (const cp of ctx.cps) {
        if (cp.owner === ctx.owner) continue;
        if (from.q === cp.q && from.r === cp.r) continue;
        if (!reachable.some(p => p.q === cp.q && p.r === cp.r)) continue;
        let value = captureValue(ctx, cp);
        value -= threatFrom(ctx, threat, cp, 1) * hpValueOf(ctx, u) * ctx.riskAversion * 0.8;
        // 敌人也盯着这个点（剧本落点概率）→ 到达冲突/对抢风险折价。
        value -= probAt(cp) * Math.max(0, value) * 0.5;
        if (value <= 0.05) continue;
        missions.push({
          legs: [{ type: 'move', payload: { unitId: u.id, q: cp.q, r: cp.r }, phase: 'late' }],
          unitId: u.id,
          value: value + jitter(`cap|${u.id}|${cp.id}`),
        });
      }
    }

    // ---------- 治疗 ----------
    if (u.type === 'support') {
      const healRange = spec.healRange ?? u.attackRange ?? spec.attackRange ?? 1;
      const amount = expectedHeal(ctx, u);
      const wounded = ctx.myUnits.filter(a => a.hp < a.maxHp);
      if (wounded.length > 0 && !ctx.danger.has(cellKey(from))) {
        const healFromCells = [null, ...reachable.slice(0, 40)];
        for (const f of healFromCells) {
          const pf = f ?? from;
          if (ctx.danger.has(cellKey(pf))) continue;
          for (const ally of wounded) {
            const allyPos = proj.positions.get(ally.id) ?? ally;
            let best = null;
            for (const aim of [allyPos, ...HEX_DIRS.map(d => ({ q: pf.q + d.q, r: pf.r + d.r }))]) {
              const cells = coverageOf(pf, spec, 'healShape', aim, healRange);
              if (!cells) continue;
              if (!cells.some(c => c.q === allyPos.q && c.r === allyPos.r)) continue;
              if (cells.some(c => ctx.danger.has(cellKey(c)))) continue;
              best = aim;
              break;
            }
            if (!best) continue;
            let value = healValue(ctx, ally, amount, threatFrom(ctx, threat, allyPos, 1));
            if (f) value -= 0.3; // 移动腿同值时让位给原地治疗。
            if (value <= 0.05) continue;
            const legs = [];
            if (f) legs.push({ type: 'move', payload: { unitId: u.id, q: f.q, r: f.r }, phase: 'mid' });
            legs.push({ type: 'heal', payload: { supportId: u.id, q: best.q, r: best.r }, phase: 'late' });
            missions.push({
              legs, unitId: u.id,
              value: value + jitter(`heal|${u.id}|${ally.id}`),
            });
          }
        }
      }
    }

    // ---------- 避险 / 推进（兜底走位） ----------
    if (reachable.length > 0) {
      const objective = pickObjective(ctx, u, from);
      if (objective) {
        const hereThreat = threatFrom(ctx, threat, from, 1);
        let best = null;
        let bestScore = -Infinity;
        for (const cell of reachable) {
          const th = threatFrom(ctx, threat, cell, 1);
          const score =
            (hexDist(from, objective) - hexDist(cell, objective)) * 0.45 +
            (hereThreat - th) * hpValueOf(ctx, u) * ctx.riskAversion * 0.5;
          if (score > bestScore) { bestScore = score; best = cell; }
        }
        if (best && bestScore > 0.15) {
          missions.push({
            legs: [{ type: 'move', payload: { unitId: u.id, q: best.q, r: best.r }, phase: 'mid' }],
            unitId: u.id,
            value: Math.min(bestScore, 1.2) + jitter(`adv|${u.id}|${best.q},${best.r}`),
            filler: true,
          });
        }
      }
    }
  }

  // ---------- 部署 ----------
  const supplies = ctx.game.resources?.[ctx.owner]?.supplies ?? 0;
  const mustDump = ctx.endgame || ctx.roundsLeft <= 1;
  const wantDeploy =
    ctx.myUnits.length <= ctx.enemies.length ||
    supplies >= 200 ||
    ctx.round <= 2 ||
    mustDump;
  if (wantDeploy) {
    for (const origin of deployOrigins(ctx)) {
      if (ctx.danger.has(cellKey(origin))) continue;
      for (const type of Object.keys(ctx.specs)) {
        const uspec = ctx.specs[type];
        if (!uspec) continue;
        const discount = Math.min(uspec.cost ?? 0, ctx.balance.controlPointTypes?.[origin.kind]?.deployDiscount ?? 0);
        const cost = Math.max(0, (uspec.cost ?? 0) - discount);
        if (cost > supplies - proj.spend) continue;
        // 兵种泛用评分（火力/生存/机动/占点/治疗），不指向任何地图。
        const typeScore =
          (uspec.attack ?? 0) * 1.6 +
          (uspec.hp ?? 0) / 12 +
          (uspec.attackRange ?? 0) * 2 +
          (uspec.moveRange ?? 0) * 0.8 +
          (uspec.canCapture ? 5 : 0) +
          (uspec.healPower ? 5 : 0) +
          (uspec.attackLock ? 3 : 0);
        for (const d of HEX_DIRS) {
          const cell = { q: origin.q + d.q, r: origin.r + d.r };
          const key = cellKey(cell);
          if (!ctx.playable.has(key)) continue;
          if (ctx.terrain.get(key) !== 'plain') continue;
          if (ctx.danger.has(key)) continue;
          const occupant = ctx.units.find(x => x.q === cell.q && x.r === cell.r);
          if (occupant && occupant.owner === ctx.owner) continue;
          const value =
            0.8 +
            typeScore * 0.12 * (ctx.weights.army + 0.3) * (mustDump ? 1.5 : 1) -
            threatFrom(ctx, threat, cell, 1) * 0.1 * ctx.riskAversion;
          if (value <= 0.05) continue;
          missions.push({
            legs: [{ type: 'deploy', payload: { unitType: type, fromId: origin.id, q: cell.q, r: cell.r }, phase: 'early' }],
            value: value + jitter(`dep|${type}|${origin.id}|${key}`),
            deployCost: cost,
          });
        }
      }
    }
  }

  return missions;
}

function pickObjective(ctx, u, from) {
  const spec = ctx.specs[u.type] ?? {};
  if (u.canCapture ?? spec.canCapture) {
    const open = ctx.cps.filter(cp => cp.owner !== ctx.owner);
    if (open.length > 0) {
      return open.slice().sort((a, b) =>
        (hexDist(from, a) - captureValue(ctx, a) * 0.15) -
        (hexDist(from, b) - captureValue(ctx, b) * 0.15),
      )[0];
    }
  }
  if (ctx.enemyHqs.length > 0) {
    return ctx.enemyHqs.slice().sort((a, b) => hexDist(from, a) - hexDist(from, b))[0];
  }
  return null;
}

function deployOrigins(ctx) {
  const origins = [];
  if (ctx.balance.deployFromHq !== false && ctx.myHq) origins.push(ctx.myHq);
  for (const cp of ctx.cps) {
    if (cp.owner !== ctx.owner) continue;
    if (ctx.balance.controlPointTypes?.[cp.kind]?.canDeploy === false) continue;
    origins.push(cp);
  }
  return origins;
}

// ---------------------------------------------------------------- 逐拍排程

/**
 * 把 mission 按价值贪心排成紧凑动作序列（队列位置 = 结算拍）：
 * early 尽量靠前（斩杀/锁定先结算，击杀作废受害者后续动作）、late 压尾
 * （占点到达/治疗放末拍）、mid 居中；多腿 mission（移动→攻击/治疗）
 * 两腿相邻插入、先移后打。容量不足时直接跳过该 mission——攻击/治疗的
 * 瞄准格是按投影位置校验的，不能砍掉移动腿降级（原地另有一份独立候选）。
 * 我方每拍至多一个动作，同拍目的格冲突天然不可能，无需额外认领表。
 * 返回 前缀（已入队）+ 新排 的完整计划。
 */
function scheduleMissions(ctx, missions, proj, banned) {
  const prefix = proj.queue.map(action => ({ type: action.type, payload: payloadOf(action) }));
  const capacity = Math.max(0, ctx.ap - prefix.length);
  const tail = [];
  const unitUsed = new Set();
  let spendReserved = 0;
  const suppliesLeft = () =>
    (ctx.game.resources?.[ctx.owner]?.supplies ?? 0) - proj.spend - spendReserved;

  const insertIndex = (phase) => {
    if (phase === 'early') {
      let i = 0;
      while (i < tail.length && tail[i].phase === 'early') i++;
      return i;
    }
    if (phase === 'mid') {
      let i = 0;
      while (i < tail.length && tail[i].phase !== 'late') i++;
      return i;
    }
    return tail.length;
  };

  const sorted = missions.slice().sort((a, b) => b.value - a.value);
  for (const mission of sorted) {
    if (mission.legs.some(leg => banned.has(legKey(leg)))) continue;
    if (mission.unitId && unitUsed.has(mission.unitId)) continue;
    if (mission.unitId && mission.legs.some(l => l.type === 'attack')) {
      if ((proj.attacks.get(mission.unitId) ?? 0) >= ctx.attacksPerUnit) continue;
    }
    if (mission.deployCost && mission.deployCost > suppliesLeft()) continue;
    if (tail.length + mission.legs.length > capacity) continue;

    const at = insertIndex(mission.legs[mission.legs.length - 1].phase);
    tail.splice(at, 0, ...mission.legs);
    if (mission.unitId) unitUsed.add(mission.unitId);
    if (mission.deployCost) spendReserved += mission.deployCost;
  }

  return [...prefix, ...tail];
}

function payloadOf(action) {
  const payload = {};
  for (const key of ['unitId', 'attackerId', 'supportId', 'unitType', 'fromId', 'q', 'r']) {
    if (action[key] !== undefined) payload[key] = action[key];
  }
  return payload;
}

function legKey(leg) {
  return JSON.stringify({ type: leg.type, payload: leg.payload });
}

// ---------------------------------------------------------------- 决策入口

/** 每轮记忆：识别「上次给出的动作未被接受」，重排时禁掉。 */
const roundMemory = new Map();
const MEMORY_LIMIT = 64;

async function decide(game, utils, ctx) {
  const owner = ctx?.owner;
  if (!owner) return null;
  if (game.phase !== 'active') return null;
  const plan = game.plan;
  if (!plan) return null;
  if ((plan.committed ?? []).includes(owner)) return null;

  const queue = plan.myQueue ?? plan.queues?.[owner] ?? [];
  const context = buildContext(game, owner);
  if (queue.length >= context.ap) return null;

  const roundKey = `${game.id ?? 'game'}|${context.round}|${owner}`;
  let memory = roundMemory.get(roundKey);
  if (!memory) {
    if (roundMemory.size >= MEMORY_LIMIT) {
      roundMemory.delete(roundMemory.keys().next().value);
    }
    memory = { offered: new Map(), banned: new Set() };
    roundMemory.set(roundKey, memory);
  }
  // 同一队列长度上给过动作而队列没增长 → 该动作被拒，禁掉重排。
  const lastOffered = memory.offered.get(queue.length);
  if (lastOffered) memory.banned.add(lastOffered);

  // 已入队前缀的投影：位置 / 攻击次数 / 部署花费。
  const proj = { positions: new Map(), attacks: new Map(), spend: 0, queue };
  for (const action of queue) {
    if (action.type === 'move' && action.unitId) {
      proj.positions.set(action.unitId, { q: action.q, r: action.r });
    } else if (action.type === 'attack' && action.attackerId) {
      proj.attacks.set(action.attackerId, (proj.attacks.get(action.attackerId) ?? 0) + 1);
    } else if (action.type === 'deploy' && action.unitType) {
      const spec = context.specs[action.unitType];
      const origin = [...(context.myHq ? [context.myHq] : []), ...context.cps].find(o => o.id === action.fromId);
      const discount = Math.min(spec?.cost ?? 0, context.balance.controlPointTypes?.[origin?.kind]?.deployDiscount ?? 0);
      proj.spend += Math.max(0, (spec?.cost ?? 0) - discount);
    }
  }

  // 敌方剧本与威胁时间线。
  const myConsidered = [
    ...context.myUnits.map(u => ({ kind: 'unit', entity: u })),
    ...(context.myHq ? [{ kind: 'hq', entity: context.myHq }] : []),
  ];
  const scripts = new Map();
  for (const e of context.enemies) scripts.set(e, predictEnemy(context, e, myConsidered));
  const threat = buildThreat(context, scripts, context.ap);

  const missions = generateMissions(context, proj, threat, scripts);
  if (process.env.TEMPO_DEBUG) {
    console.error('[tempo] missions:', missions.slice(0, 8).map(m => `${m.value.toFixed(2)} ${m.legs.map(l => l.type + '@' + (l.payload.q ?? '') + ',' + (l.payload.r ?? '')).join('>')}`));
  }
  const slots = scheduleMissions(context, missions, proj, memory.banned);
  const next = slots[queue.length] ?? null;
  if (!next) return null;

  const action = { type: next.type, payload: next.payload };
  memory.offered.set(queue.length, legKey(next));
  return action;
}

export default {
  name: 'tempo',
  description: '同时回合：敌方剧本逐拍投影 + 威胁时间线避险 + 裁决地平线姿态调节',
  decide,
};
