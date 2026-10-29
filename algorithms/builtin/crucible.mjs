// algorithms/builtin/crucible.mjs
//
// 熔炉算法（crucible）—— 歼灭模式独立设计。
//
// 设计出发点（全部由歼灭规则本身推导，不借鉴任何既有算法）：
//   1. 战斗单向无 retaliation：击杀不仅拿走对方输出，还按造价计入 killValue，
//      因此"能否在本回合凑出斩杀"是行动排序的第一性指标。
//   2. 炮火击杀无归属：己方单位被圈烧死是纯亏，敌方被烧死只是军队价值蒸发。
//      每个单位都要沿缩圈时间线做"向心逃逸"推演，把不可避免的圈伤折进局面分。
//   3. AP 按单位激活计费：一个激活 = 移动 + 攻击/治疗，部署当回合还能免费补刀。
//      整回合是一个组合优化问题，用束搜索在镜像棋盘上排激活顺序（让路/集火/补员）。
//   4. 对手下一回合必然集火：用"移动范围 + 射程"的可达投影 + 贪心斩杀分配，
//      估计己方每个单位的期望损失，作为对抗性局面评估的主项。
//
// 接口：decide(state, utils, ctx) 逐动作返回；回合首次调用时做整回合规划，
// 之后按队列吐动作，每步对真实状态做合法性校验，偏差即重规划。

const DIRS = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

const BEAM_WIDTH = 7;
const MAX_DEPTH = 8;
const DEST_KEEP = 4;
const DEPLOY_KEEP = 6;
const RING_HORIZON = 5;

function hexDist(a, b) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
}

function ck(q, r) { return q + ',' + r; }

function neighborsOf(p) {
  const out = [];
  for (const d of DIRS) out.push({ q: p.q + d.q, r: p.r + d.r });
  return out;
}

// ---------------------------------------------------------------------------
// 静态模型：从真实状态提取本局规则参数（一切以本局 config 为准，不写死）
// ---------------------------------------------------------------------------

function buildModel(state, me) {
  const cfg = state.config;
  const bal = cfg.balance;
  const weights = bal.adjudicationWeights || {};
  const armyW = weights.armyValue ?? 1;
  const killW = weights.killValue ?? 0;
  const supW = weights.supplies ?? 0;
  const cpW = weights.controlPoint ?? 0;

  const terrain = new Map();
  for (const c of state.cells) terrain.set(ck(c.q, c.r), c.terrain);
  for (const c of state.map?.terrainCells || []) terrain.set(ck(c.q, c.r), c.terrain);

  const art = cfg.annihilation?.artillery || null;
  const radius = state.map.radius;
  const radiusAt = (round) => {
    if (!art) return radius;
    const shrinks = round < art.startRound
      ? 0
      : Math.floor((round - art.startRound) / art.intervalRounds) + 1;
    return Math.max(art.minimumSafeRadius, radius - shrinks);
  };

  const danger = new Set();
  for (const c of state.artillery?.dangerCells || []) danger.add(ck(c.q, c.r));

  const cpSpec = (kind) => bal.controlPointTypes?.[kind] || null;

  return {
    me,
    state,
    cfg,
    bal,
    armyW,
    killW,
    supW,
    cpW,
    terrain,
    cells: new Set(terrain.keys()),
    danger,
    art,
    radius,
    radiusAt,
    cpSpec,
    round: state.turn.roundNumber,
    maxTurns: bal.maxTurns,
    apLimit: bal.actionsPerTurn,
    minDmg: bal.minimumDamage ?? 1,
    variance: bal.damageVarianceRange ?? 0,
    healVar: bal.healVarianceRange ?? 0,
    unitSpecs: cfg.units,
    cpTemplates: state.controlPoints.map((p) => ({
      id: p.id, q: p.q, r: p.r, kind: p.kind, owner: p.owner,
      income: cpSpec(p.kind)?.income ?? 0,
      canDeploy: cpSpec(p.kind)?.canDeploy !== false,
      repair: cpSpec(p.kind)?.repairAmount ?? 0,
    })),
  };
}

function expectedDamage(model, attacker, target) {
  return Math.max(model.minDmg, attacker.attack - target.defense);
}

function unitArmyValue(model, u) {
  return u.cost * (u.hp / u.maxHp) * model.armyW;
}

// ---------------------------------------------------------------------------
// 镜像棋盘：束搜索用的轻量模拟状态
// ---------------------------------------------------------------------------

function makeSim(model) {
  const state = model.state;
  const units = [];
  const occ = new Map();
  for (const u of state.units) {
    if (!u.alive) continue;
    const c = {
      id: u.id, owner: u.owner, type: u.type, q: u.q, r: u.r,
      hp: u.hp, maxHp: u.maxHp, attack: u.attack, defense: u.defense,
      moveRange: u.moveRange, attackRange: u.attackRange, cost: u.cost,
      canCapture: u.canCapture, healPower: u.healPower ?? 0,
      hasMoved: u.hasMoved, hasActed: u.hasActed, actionSpent: u.actionSpent,
    };
    units.push(c);
    occ.set(ck(c.q, c.r), c);
  }
  const cpOwner = new Map();
  for (const p of model.cpTemplates) cpOwner.set(p.id, p.owner);
  return {
    units,
    occ,
    terrain: model.terrain,
    actionsUsed: state.turn.actionsUsed,
    supplies: state.resources?.[model.me]?.supplies ?? 0,
    killMine: state.players?.[model.me]?.stats?.killValue ?? 0,
    killTheirs: new Map(),
    cpOwner,
    nextUnitId: 0,
  };
}

function cloneSim(sim) {
  return {
    units: sim.units.map((u) => ({ ...u })),
    occ: new Map(sim.occ),
    terrain: sim.terrain,
    actionsUsed: sim.actionsUsed,
    supplies: sim.supplies,
    killMine: sim.killMine,
    killTheirs: new Map(sim.killTheirs),
    cpOwner: new Map(sim.cpOwner),
    nextUnitId: sim.nextUnitId,
  };
}

function passable(model, sim, q, r) {
  const k = ck(q, r);
  return model.cells.has(k) && (sim.terrain.get(k) ?? 'blocker') === 'plain';
}

function reachable(model, sim, u) {
  const start = ck(u.q, u.r);
  const dist = new Map([[start, 0]]);
  const queue = [{ q: u.q, r: u.r, d: 0 }];
  const out = [];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    if (cur.d >= u.moveRange) continue;
    for (const n of neighborsOf(cur)) {
      const k = ck(n.q, n.r);
      if (dist.has(k)) continue;
      dist.set(k, cur.d + 1);
      if (!passable(model, sim, n.q, n.r) || sim.occ.has(k)) continue;
      out.push({ q: n.q, r: n.r, d: cur.d + 1 });
      queue.push({ q: n.q, r: n.r, d: cur.d + 1 });
    }
  }
  return { cells: out, dist };
}

// BFS 距离场：从某格出发到所有格的步行距离（忽略射程，仅移动）
function distanceField(model, sim, from, maxDist) {
  const dist = new Map([[ck(from.q, from.r), 0]]);
  const queue = [{ q: from.q, r: from.r, d: 0 }];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    if (cur.d >= maxDist) continue;
    for (const n of neighborsOf(cur)) {
      const k = ck(n.q, n.r);
      if (dist.has(k)) continue;
      const d = cur.d + 1;
      dist.set(k, d);
      if (!passable(model, sim, n.q, n.r) || sim.occ.has(k)) continue;
      queue.push({ q: n.q, r: n.r, d });
    }
  }
  return dist;
}

function aliveUnits(sim, owner) {
  return sim.units.filter((u) => u.hp > 0 && (owner === undefined || u.owner === owner));
}

function enemiesOf(model, sim) {
  return aliveUnits(sim).filter((u) => u.owner !== model.me);
}

// ---------------------------------------------------------------------------
// 激活候选：一个单位的（移动 + 攻击/治疗/爆破）或一次部署（+免费补刀）
// ---------------------------------------------------------------------------

function attackOptions(model, sim, u, from) {
  const out = [];
  for (const t of enemiesOf(model, sim)) {
    if (hexDist(from, t) <= u.attackRange) {
      const dmg = expectedDamage(model, u, t);
      out.push({ target: t, dmg, kills: dmg >= t.hp });
    }
  }
  return out;
}

function healOptions(model, sim, u, from) {
  if (u.type !== 'support' || !u.healPower) return [];
  const range = model.unitSpecs[u.type]?.healRange ?? u.attackRange;
  const out = [];
  for (const t of aliveUnits(sim, u.owner)) {
    if (t.id === u.id || t.hp >= t.maxHp) continue;
    if (model.danger.has(ck(t.q, t.r))) continue;
    if (hexDist(from, t) <= range) {
      out.push({ target: t, amount: Math.min(u.healPower, t.maxHp - t.hp) });
    }
  }
  return out;
}

function immediateAttackValue(model, u, opt) {
  const t = opt.target;
  if (opt.kills) {
    return t.cost * (model.killW + model.armyW * (t.hp / t.maxHp)) + t.attack * 0.6;
  }
  return opt.dmg * model.armyW * (t.cost / t.maxHp) + Math.min(opt.dmg, t.hp) * 0.05;
}

function immediateHealValue(model, opt) {
  const t = opt.target;
  return opt.amount * model.armyW * (t.cost / t.maxHp);
}

// 占领价值：该据点在被圈吞掉前还能产多少收入 + 部署坪价值
function captureValue(model, sim, cp, round) {
  if (cp.owner === model.me) return 0;
  const d = hexDist(cp, { q: 0, r: 0 });
  let safeRounds = 0;
  const horizon = model.maxTurns == null ? round + 12 : model.maxTurns;
  for (let r = round + 1; r <= horizon; r++) {
    if (d <= model.radiusAt(r)) safeRounds++;
    else break;
  }
  if (safeRounds <= 0) return 0;
  let v = cp.income * safeRounds * 0.8;
  if (model.cpW > 0) {
    const totalRounds = Math.max(1, horizon - round);
    const endSafe = d <= model.radiusAt(horizon);
    v += model.cpW * (0.7 * (safeRounds / totalRounds) + 0.3 * (endSafe ? 1 : 0));
  }
  if (cp.canDeploy) {
    const myOrigins = model.cpTemplates.filter(
      (p) => sim.cpOwner.get(p.id) === model.me && p.canDeploy && !model.danger.has(ck(p.q, p.r)),
    ).length;
    if (myOrigins < 2) v += 18;
  }
  return v;
}

function cpAt(model, q, r) {
  return model.cpTemplates.find((p) => p.q === q && p.r === r) || null;
}

// 快速位置启发：用于候选剪枝（不做完整评估）
function destHeuristic(model, sim, u, dest, bestAction) {
  let v = bestAction ? bestAction.value : 0;
  const cp = cpAt(model, dest.q, dest.r);
  if (cp && u.canCapture) v += captureValue(model, sim, cp, model.round);
  // 向安全中心靠拢的趋势（圈会收缩），以及远离当前危险
  const dNow = hexDist(u, { q: 0, r: 0 });
  const dNew = hexDist(dest, { q: 0, r: 0 });
  const radNext = model.radiusAt(model.round + 1);
  if (dNow > radNext) v += (dNow - Math.max(dNew, radNext)) * 6;
  if (model.danger.has(ck(dest.q, dest.r))) v -= 30;
  // 与敌军的距离：近战贴脸、远程保持射程边缘
  const enemies = enemiesOf(model, sim);
  if (enemies.length) {
    let nearest = Infinity;
    for (const e of enemies) nearest = Math.min(nearest, hexDist(dest, e));
    if (u.attackRange <= 1) v += Math.max(0, 6 - nearest) * 1.2;
    else v += Math.max(0, nearest - 2) * 0.4 - Math.max(0, 3 - nearest) * 2;
  }
  return v;
}

function unitCandidates(model, sim, u) {
  const cands = [];
  const canMove = !u.hasMoved;
  const canAct = !u.hasActed;
  if (!canMove && !canAct) return cands;
  const free = u.actionSpent;
  if (!free && sim.actionsUsed >= model.apLimit) return cands;

  const dests = [{ q: u.q, r: u.r, d: 0 }];
  if (canMove) {
    const { cells } = reachable(model, sim, u);
    for (const c of cells) dests.push(c);
  }

  const scored = [];
  for (const dest of dests) {
    const from = { q: dest.q, r: dest.r };
    let best = null;
    if (canAct) {
      for (const opt of attackOptions(model, sim, u, from)) {
        const value = immediateAttackValue(model, u, opt);
        if (!best || value > best.value) best = { kind: 'attack', opt, value };
      }
      if (u.type === 'support' && !model.danger.has(ck(u.q, u.r))) {
        for (const opt of healOptions(model, sim, u, from)) {
          const value = immediateHealValue(model, opt);
          if (!best || value > best.value) best = { kind: 'heal', opt, value };
        }
      }
      if (!best && u.type === 'heavy') {
        for (const n of neighborsOf(from)) {
          const k = ck(n.q, n.r);
          if (model.cells.has(k) && (sim.terrain.get(k) ?? 'blocker') === 'blocker' && !sim.occ.has(k)) {
            const towardCenter = hexDist(n, { q: 0, r: 0 }) < hexDist(from, { q: 0, r: 0 });
            if (towardCenter) { best = { kind: 'demolish', q: n.q, r: n.r, value: 4 }; break; }
          }
        }
      }
    }
    if (!canMove && dest.d !== 0) continue;
    scored.push({ dest, best, h: destHeuristic(model, sim, u, dest, best) });
  }
  scored.sort((a, b) => b.h - a.h);
  // 原地不动且无动作 = 空激活，白耗 AP，直接剔除
  const useful = scored.filter((s) => s.dest.d !== 0 || s.best);
  const kept = useful.slice(0, DEST_KEEP);
  for (const s of kept) {
    if (!canMove && s.dest.d !== 0) continue;
    cands.push({
      kind: 'unit',
      unitId: u.id,
      dest: { q: s.dest.q, r: s.dest.r },
      action: s.best,
      cheap: s.h,
    });
  }
  return cands;
}

function deployCandidates(model, sim) {
  const out = [];
  if (sim.actionsUsed >= model.apLimit) return out;
  const origins = model.cpTemplates.filter(
    (p) => sim.cpOwner.get(p.id) === model.me && p.canDeploy && !model.danger.has(ck(p.q, p.r)),
  );
  if (!origins.length) return out;
  const myUnits = aliveUnits(sim, model.me);
  const damaged = myUnits.filter((u) => u.hp < u.maxHp * 0.6).length;
  const supports = myUnits.filter((u) => u.type === 'support').length;
  const enemyCount = enemiesOf(model, sim).length;
  // 空场紧急：没有军队时部署是唯一生存手段，候选必须存在且置顶
  const emergency = myUnits.length === 0;
  const roundsLeft = model.maxTurns == null ? 8 : Math.max(0, model.maxTurns - model.round);

  for (const origin of origins) {
    for (const n of neighborsOf(origin)) {
      const k = ck(n.q, n.r);
      if (!passable(model, sim, n.q, n.r) || sim.occ.has(k) || model.danger.has(k)) continue;
      for (const [type, spec] of Object.entries(model.unitSpecs)) {
        const discount = model.cpSpec(origin.kind)?.deployDiscount ?? 0;
        const cost = Math.max(0, spec.cost - Math.min(spec.cost, discount));
        if (sim.supplies < cost) continue;
        const probe = {
          type, q: n.q, r: n.r, attack: spec.attack, defense: spec.defense,
          attackRange: spec.attackRange, maxHp: spec.hp, hp: spec.hp, cost: spec.cost,
          healPower: spec.healPower ?? 0, owner: model.me,
        };
        let immediate = 0;
        let bestOpt = null;
        for (const opt of attackOptions(model, sim, probe, n)) {
          const v = immediateAttackValue(model, probe, opt);
          if (v > immediate) { immediate = v; bestOpt = { kind: 'attack', opt, value: v }; }
        }
        let v = spec.cost * model.armyW * 0.55 + immediate;
        if (type === 'support') {
          v += damaged >= 2 && supports < 2 ? 25 : -20;
        }
        if (type === 'scout' || type === 'infantry') {
          v += myUnits.length <= enemyCount ? 6 : 0;
        }
        // 开局扩军：补给充裕且军队单薄时主动补员（随机图可能 0 初始单位）
        if (myUnits.length < 3 && sim.supplies >= cost + 60 && roundsLeft > 3) v += 30;
        if (emergency) v += 5000 + spec.hp * 0.1;
        // 暴露惩罚：落点离敌越近越危险（完整评估里还会细算）
        let nearest = Infinity;
        for (const e of enemiesOf(model, sim)) nearest = Math.min(nearest, hexDist(n, e));
        if (nearest <= 2 && !emergency) v -= (3 - nearest) * 12;
        out.push({
          kind: 'deploy', unitType: type, fromId: origin.id,
          q: n.q, r: n.r, cost, action: bestOpt, cheap: v,
        });
      }
    }
  }
  out.sort((a, b) => b.cheap - a.cheap);
  return out.slice(0, DEPLOY_KEEP);
}

// ---------------------------------------------------------------------------
// 在镜像上执行一个激活
// ---------------------------------------------------------------------------

function applyActivation(model, sim, cand) {
  if (cand.kind === 'deploy') {
    sim.actionsUsed += 1;
    sim.supplies -= cand.cost;
    const spec = model.unitSpecs[cand.unitType];
    const u = {
      id: `sim_new_${sim.nextUnitId++}`, owner: model.me, type: cand.unitType,
      q: cand.q, r: cand.r, hp: spec.hp, maxHp: spec.hp,
      attack: spec.attack, defense: spec.defense, moveRange: spec.moveRange,
      attackRange: spec.attackRange, cost: spec.cost, canCapture: !!spec.canCapture,
      healPower: spec.healPower ?? 0,
      hasMoved: true, hasActed: false, actionSpent: true,
    };
    sim.units.push(u);
    sim.occ.set(ck(u.q, u.r), u);
    if (cand.action?.kind === 'attack') doAttack(model, sim, u, cand.action.opt);
    return;
  }
  const u = sim.units.find((x) => x.id === cand.unitId);
  if (!u || u.hp <= 0) return;
  if (!u.actionSpent) { sim.actionsUsed += 1; u.actionSpent = true; }
  if (cand.dest.q !== u.q || cand.dest.r !== u.r) {
    sim.occ.delete(ck(u.q, u.r));
    u.q = cand.dest.q; u.r = cand.dest.r;
    u.hasMoved = true;
    sim.occ.set(ck(u.q, u.r), u);
  }
  const a = cand.action;
  if (a?.kind === 'attack') doAttack(model, sim, u, a.opt);
  else if (a?.kind === 'heal') {
    const t = sim.units.find((x) => x.id === a.opt.target.id);
    if (t && t.hp > 0) t.hp = Math.min(t.maxHp, t.hp + a.opt.amount);
    u.hasActed = true;
  } else if (a?.kind === 'demolish') {
    sim.terrain = new Map(sim.terrain);
    sim.terrain.set(ck(a.q, a.r), 'plain');
    u.hasActed = true;
  }
}

function doAttack(model, sim, u, opt) {
  const t = sim.units.find((x) => x.id === opt.target.id);
  u.hasActed = true;
  if (!t || t.hp <= 0) return;
  const dmg = expectedDamage(model, u, t);
  t.hp = Math.max(0, t.hp - dmg);
  if (t.hp <= 0) {
    sim.occ.delete(ck(t.q, t.r));
    if (t.owner === model.me) {
      // 镜像里己方不会被自己打死，此分支仅为结构完整
    } else {
      sim.killMine += t.cost;
    }
  }
}

// ---------------------------------------------------------------------------
// 对抗性局面评估
// ---------------------------------------------------------------------------

// 贪心集火分配：给定攻击方与防守方，估计防守方期望损失（分数口径）
function focusFireLoss(model, sim, attackers, defenders, fieldCache) {
  if (!attackers.length || !defenders.length) return 0;
  const dmgAcc = new Map();
  let loss = 0;
  const sorted = [...attackers].sort((a, b) => b.attack - a.attack);
  for (const e of sorted) {
    let field = fieldCache.get(e.id);
    if (!field) {
      field = distanceField(model, sim, e, e.moveRange);
      fieldCache.set(e.id, field);
    }
    let best = null;
    for (const u of defenders) {
      if (u.hp <= 0) continue;
      const already = dmgAcc.get(u.id) ?? 0;
      if (already >= u.hp) continue;
      // 可达性：u 周围 attackRange 内是否有 e 步行可达的格子
      let canHit = hexDist(e, u) <= e.attackRange;
      if (!canHit) {
        const ring = cellsWithin(u, e.attackRange);
        for (const c of ring) {
          const k = ck(c.q, c.r);
          const d = field.get(k);
          if (d === undefined || d > e.moveRange) continue;
          if (!passable(model, sim, c.q, c.r) || sim.occ.has(k)) continue;
          canHit = true;
          break;
        }
      }
      if (!canHit) continue;
      const dmg = Math.max(model.minDmg, e.attack - u.defense);
      const remaining = u.hp - already;
      const kills = dmg >= remaining;
      const marginal = kills
        ? u.cost * (model.killW + model.armyW * (remaining / u.maxHp)) + u.attack * 0.6
        : dmg * model.armyW * (u.cost / u.maxHp);
      if (!best || marginal > best.marginal) best = { u, dmg, marginal };
    }
    if (best) {
      dmgAcc.set(best.u.id, (dmgAcc.get(best.u.id) ?? 0) + best.dmg);
      loss += best.marginal;
    }
  }
  return loss;
}

function cellsWithin(center, range) {
  const out = [];
  for (let dq = -range; dq <= range; dq++) {
    for (let dr = Math.max(-range, -dq - range); dr <= Math.min(range, -dq + range); dr++) {
      out.push({ q: center.q + dq, r: center.r + dr });
    }
  }
  return out;
}

// 沿缩圈时间线推演单位的"向心逃逸"，返回不可避免的圈伤损失（分数口径）
function ringLoss(model, sim, u, side) {
  if (!model.art) return 0;
  const horizon = model.maxTurns == null
    ? model.round + RING_HORIZON
    : Math.min(model.maxTurns, model.round + RING_HORIZON);
  let pos = { q: u.q, r: u.r };
  let hp = u.hp;
  let loss = 0;
  const dmg = model.art.damage;
  for (let r = model.round + 1; r <= horizon && hp > 0; r++) {
    const rad = model.radiusAt(r);
    // 尝试向心移动 moveRange 步（择最近邻格，避开障碍与占据）
    for (let step = 0; step < u.moveRange; step++) {
      if (hexDist(pos, { q: 0, r: 0 }) <= rad) break;
      let best = null;
      for (const n of neighborsOf(pos)) {
        const k = ck(n.q, n.r);
        if (!model.cells.has(k)) continue;
        if ((sim.terrain.get(k) ?? 'blocker') !== 'plain') continue;
        const occ = sim.occ.get(k);
        if (occ && occ.id !== u.id && occ.hp > 0) continue;
        const d = hexDist(n, { q: 0, r: 0 });
        if (!best || d < best.d) best = { q: n.q, r: n.r, d };
      }
      if (!best || best.d >= hexDist(pos, { q: 0, r: 0 })) break;
      pos = best;
    }
    if (hexDist(pos, { q: 0, r: 0 }) > rad) {
      const hit = Math.min(hp, dmg);
      hp -= hit;
      const frac = hit / u.maxHp;
      const w = side === 'mine' ? 1 : 0.85;
      loss += u.cost * model.armyW * frac * w;
      if (hp <= 0) break;
    }
  }
  return loss;
}

function evaluate(model, sim) {
  const mine = aliveUnits(sim, model.me);
  const theirs = enemiesOf(model, sim);
  // 先判己方：双方空场时部署是唯一活路，不能让"敌方全灭"分支抢先给满分
  if (!mine.length) return -1e6;
  if (!theirs.length) return 1e6;

  let score = 0;
  for (const u of mine) score += unitArmyValue(model, u);
  for (const u of theirs) score -= unitArmyValue(model, u);
  score += sim.killMine * model.killW;
  for (const [, kv] of sim.killTheirs) score -= kv * model.killW;
  score += sim.supplies * model.supW;

  // 补给转化为未来军力的期权价值（仅在有部署坪且还有回合时）
  const roundsLeft = model.maxTurns == null ? 8 : Math.max(0, model.maxTurns - model.round);
  const origins = model.cpTemplates.filter(
    (p) => sim.cpOwner.get(p.id) === model.me && p.canDeploy && !model.danger.has(ck(p.q, p.r)),
  ).length;
  if (origins > 0 && roundsLeft > 1) {
    score += Math.min(sim.supplies, 180) * 0.35;
  }

  // 对手下回合集火 vs 我方下回合威慑
  const theirCache = new Map();
  const myCache = new Map();
  score -= focusFireLoss(model, sim, theirs, mine, theirCache);
  score += 0.45 * focusFireLoss(model, sim, mine, theirs, myCache);

  // 炮火时间线：己方圈伤全扣，敌方圈伤折算收益
  for (const u of mine) score -= ringLoss(model, sim, u, 'mine');
  for (const u of theirs) score += ringLoss(model, sim, u, 'theirs');

  // 据点收入差（只算圈吞掉前的安全回合；站上即可下轮占领的也计入）
  const horizon = model.maxTurns == null ? model.round + 12 : model.maxTurns;
  for (const cp of model.cpTemplates) {
    let owner = sim.cpOwner.get(cp.id);
    if (owner !== model.me) {
      const capturer = mine.find((u) => u.canCapture && u.q === cp.q && u.r === cp.r);
      if (capturer) owner = model.me;
    }
    const d = hexDist(cp, { q: 0, r: 0 });
    let safeRounds = 0;
    for (let r = model.round + 1; r <= horizon; r++) {
      if (d <= model.radiusAt(r)) safeRounds++;
      else break;
    }
    const incomeVal = cp.income * safeRounds * 0.8;
    if (owner === model.me) score += incomeVal;
    else if (owner) score -= incomeVal;
    // 据点分权重非零的图（随机图常见）：持有本身直接计分
    if (model.cpW > 0) {
      const totalRounds = Math.max(1, horizon - model.round);
      const endSafe = d <= model.radiusAt(horizon);
      const cpScore = model.cpW * (0.7 * (safeRounds / totalRounds) + 0.3 * (endSafe ? 1 : 0));
      if (owner === model.me) score += cpScore;
      else if (owner) score -= cpScore;
    }
  }

  // 平局倾向：安全中心附近的微弱引力（鼓励在圈心集结而非外圈游荡）
  const finalRad = model.radiusAt(horizon);
  for (const u of mine) {
    const d = hexDist(u, { q: 0, r: 0 });
    if (d > finalRad) score -= (d - finalRad) * 0.6;
  }
  return score;
}

// ---------------------------------------------------------------------------
// 整回合束搜索
// ---------------------------------------------------------------------------

function allCandidates(model, sim) {
  const cands = [];
  for (const u of aliveUnits(sim, model.me)) {
    cands.push(...unitCandidates(model, sim, u));
  }
  cands.push(...deployCandidates(model, sim));
  return cands;
}

function planTurn(model) {
  const root = makeSim(model);
  let beam = [{ sim: root, seq: [], score: evaluate(model, root) }];
  let best = beam[0];

  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const next = [];
    for (const node of beam) {
      const cands = allCandidates(model, node.sim);
      if (!cands.length) {
        next.push(node);
        continue;
      }
      // 剪枝：按廉价启发取前若干个，避免分支爆炸
      cands.sort((a, b) => b.cheap - a.cheap);
      const kept = cands.slice(0, 18);
      let expanded = false;
      for (const cand of kept) {
        const child = cloneSim(node.sim);
        applyActivation(model, child, cand);
        const score = evaluate(model, child);
        const seq = [...node.seq, cand];
        next.push({ sim: child, seq, score });
        if (score > best.score) best = { sim: child, seq, score };
        expanded = true;
      }
      if (!expanded) next.push(node);
    }
    if (!next.length) break;
    next.sort((a, b) => b.score - a.score);
    beam = next.slice(0, BEAM_WIDTH);
    // 所有候选都只剩"原地不动"时提前收敛
    const anyProgress = beam.some((n) => n.seq.length > depth);
    if (!anyProgress) break;
  }
  return best.seq;
}

// ---------------------------------------------------------------------------
// 计划 → 原子动作队列；对真实状态逐步校验
// ---------------------------------------------------------------------------

function planToActions(model, seq) {
  const sim = makeSim(model);
  const actions = [];
  for (const cand of seq) {
    if (cand.kind === 'deploy') {
      actions.push({
        type: 'deploy',
        payload: { unitType: cand.unitType, fromId: cand.fromId, q: cand.q, r: cand.r },
      });
      applyActivation(model, sim, cand);
      if (cand.action?.kind === 'attack') {
        // 部署产生的新单位真实 id 由服务器分配，用落点坐标延迟解析
        actions.push({
          type: 'attack',
          payload: { attackerId: null, deployQ: cand.q, deployR: cand.r, targetId: cand.action.opt.target.id },
        });
      }
      continue;
    }
    const u = sim.units.find((x) => x.id === cand.unitId);
    if (!u) continue;
    if (cand.dest.q !== u.q || cand.dest.r !== u.r) {
      actions.push({ type: 'move', payload: { unitId: u.id, q: cand.dest.q, r: cand.dest.r } });
    }
    const a = cand.action;
    if (a?.kind === 'attack') {
      actions.push({ type: 'attack', payload: { attackerId: u.id, targetId: a.opt.target.id } });
    } else if (a?.kind === 'heal') {
      actions.push({ type: 'heal', payload: { supportId: u.id, targetId: a.opt.target.id } });
    } else if (a?.kind === 'demolish') {
      actions.push({ type: 'demolish', payload: { unitId: u.id, q: a.q, r: a.r } });
    }
    applyActivation(model, sim, cand);
  }
  return actions;
}

function liveUnit(state, id) {
  return state.units.find((u) => u.id === id && u.alive);
}

function actionLegal(model, state, action) {
  const me = model.me;
  const p = action.payload;
  const apLeft = state.config.balance.actionsPerTurn - state.turn.actionsUsed;
  if (action.type === 'move') {
    const u = liveUnit(state, p.unitId);
    if (!u || u.owner !== me || u.hasMoved) return false;
    if (!u.actionSpent && apLeft <= 0) return false;
    const sim = makeSim(model);
    const { cells } = reachable(model, sim, u);
    return cells.some((c) => c.q === p.q && c.r === p.r);
  }
  if (action.type === 'attack') {
    let u = liveUnit(state, p.attackerId);
    if (!u && p.deployQ !== undefined) {
      u = state.units.find(
        (x) => x.alive && x.owner === me && x.q === p.deployQ && x.r === p.deployR && !x.hasActed,
      );
      if (u) p.attackerId = u.id;
    }
    const t = liveUnit(state, p.targetId);
    if (!u || u.owner !== me || u.hasActed || !t || t.owner === me) return false;
    if (!u.actionSpent && apLeft <= 0) return false;
    return hexDist(u, t) <= u.attackRange;
  }
  if (action.type === 'heal') {
    const u = liveUnit(state, p.supportId);
    const t = liveUnit(state, p.targetId);
    if (!u || u.owner !== me || u.hasActed || u.type !== 'support' || !t || t.owner !== me) return false;
    if (t.hp >= t.maxHp) return false;
    if (!u.actionSpent && apLeft <= 0) return false;
    if (model.danger.has(ck(u.q, u.r)) || model.danger.has(ck(t.q, t.r))) return false;
    const range = model.unitSpecs[u.type]?.healRange ?? u.attackRange;
    return hexDist(u, t) <= range;
  }
  if (action.type === 'deploy') {
    if (apLeft <= 0) return false;
    const spec = model.unitSpecs[p.unitType];
    if (!spec) return false;
    const origin = model.cpTemplates.find((c) => c.id === p.fromId);
    if (!origin || state.controlPoints.find((c) => c.id === p.fromId)?.owner !== me) return false;
    if (!origin.canDeploy) return false;
    if (model.danger.has(ck(origin.q, origin.r)) || model.danger.has(ck(p.q, p.r))) return false;
    if (hexDist(origin, { q: p.q, r: p.r }) !== 1) return false;
    const k = ck(p.q, p.r);
    if (!model.cells.has(k) || model.terrain.get(k) !== 'plain') return false;
    if (state.units.some((u) => u.alive && u.q === p.q && u.r === p.r)) return false;
    const discount = model.cpSpec(origin.kind)?.deployDiscount ?? 0;
    const cost = Math.max(0, spec.cost - Math.min(spec.cost, discount));
    return (state.resources?.[me]?.supplies ?? 0) >= cost;
  }
  if (action.type === 'demolish') {
    const u = liveUnit(state, p.unitId);
    if (!u || u.owner !== me || u.hasActed || u.type !== 'heavy') return false;
    if (!u.actionSpent && apLeft <= 0) return false;
    if (hexDist(u, { q: p.q, r: p.r }) > 1) return false;
    const k = ck(p.q, p.r);
    return model.cells.has(k) && model.terrain.get(k) === 'blocker'
      && !state.units.some((x) => x.alive && x.q === p.q && x.r === p.r);
  }
  return false;
}

// ---------------------------------------------------------------------------
// decide 入口：回合级计划缓存 + 逐步校验 + 偏差重规划
// ---------------------------------------------------------------------------

const caches = new Map();

export default {
  name: 'crucible',
  description: '歼灭：整回合束搜索 + 对抗集火回推 + 缩圈时间线逃逸推演',

  decide(state, utils, ctx) {
    if (state.config?.mode !== 'annihilation') return null;
    if (state.phase !== 'active') return null;
    const me = ctx?.owner ?? state.turn.currentPlayerId;
    if (!me || state.turn.currentPlayerId !== me) return null;
    if (state.players?.[me]?.status !== 'active') return null;

    const cacheKey = `${state.id}:${me}`;
    let cache = caches.get(cacheKey);
    const model = buildModel(state, me);

    // 续队：计划里的后续动作逐个对真实状态校验，不合法就丢弃试下一个
    if (cache && cache.round === state.turn.roundNumber && cache.queue.length) {
      while (cache.queue.length) {
        const action = cache.queue[0];
        if (actionLegal(model, state, action)) {
          cache.queue.shift();
          return action;
        }
        cache.queue.shift();
      }
      caches.delete(cacheKey);
      cache = null;
    }
    if (cache && cache.round !== state.turn.roundNumber) {
      caches.delete(cacheKey);
      cache = null;
    }

    const seq = planTurn(model);
    const queue = planToActions(model, seq);
    while (queue.length && !actionLegal(model, state, queue[0])) queue.shift();
    if (!queue.length) {
      caches.delete(cacheKey);
      return null;
    }
    cache = { round: state.turn.roundNumber, queue };
    caches.set(cacheKey, cache);
    return cache.queue.shift();
  },
};