// 经纬：把任务的收益、行动点成本与生存期限放在同一张排程表里。
// 规则只来自公开快照；结算镜像的依据为引擎 simultaneousResolve.ts。
// 不读取其他席位的秘密队列，也不依赖其他策略模块。

const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const key = p => `${p.q},${p.r}`;
const distance = (a, b) => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.q + a.r - b.q - b.r));
const adjacent = p => DIRS.map(([q, r]) => ({ q: p.q + q, r: p.r + r }));
const subject = a => a.unitId ?? a.attackerId ?? a.supportId;
const flat = a => ({ type: a.type, ...(a.payload ?? a) });
const command = a => { const { type, ...payload } = a; return { type, payload }; };
const signature = a => {
  const p = flat(a);
  return [p.type, subject(p), p.unitType, p.fromId, p.q, p.r].join('|');
};
const planCache = new Map();

/** 从配置计算合法瞄准及全部覆盖格；边界由调用者对点击格检查。 */
function footprint(from, spec, kind, target, range) {
  const d = distance(from, target);
  if (d > range) return null;
  const shape = spec?.[kind]?.type ?? 'single';
  if (shape === 'single') return d === 0 && kind === 'attackShape' ? null : [{ q: target.q, r: target.r }];
  if (shape === 'arc') {
    if (d !== 1) return null;
    const n = DIRS.findIndex(([q, r]) => from.q + q === target.q && from.r + r === target.r);
    return [(n + 5) % 6, n, (n + 1) % 6].map(i => ({ q: from.q + DIRS[i][0], r: from.r + DIRS[i][1] }));
  }
  const length = Math.min(range, spec?.[kind]?.length ?? 2);
  if (d < 1 || d > length) return null;
  const ray = DIRS.find(([q, r]) => from.q + q * d === target.q && from.r + r * d === target.r);
  return ray ? Array.from({ length }, (_, i) => ({ q: from.q + ray[0] * (i + 1), r: from.r + ray[1] * (i + 1) })) : null;
}

/** 轻量副本：主动枚举公开字段，绝不复制服务器私有状态。 */
function boardCopy(game) {
  return {
    config: game.config,
    cells: game.cells.map(c => ({ ...c })),
    units: game.units.map(u => ({ ...u })),
    headquarters: Object.fromEntries(Object.entries(game.headquarters ?? {}).map(([id, h]) => [id, { ...h }])),
    controlPoints: (game.controlPoints ?? []).map(p => ({ ...p })),
    resources: Object.fromEntries(Object.entries(game.resources ?? {}).map(([id, r]) => [id, { ...r }])),
    players: Object.fromEntries(Object.entries(game.players ?? {}).map(([id, p]) => [id, { status: p.status, stats: { ...p.stats } }])),
    turn: { ...game.turn },
  };
}

/** 单轮分步镜像；只结算动作，不冒充包含收入/维修/裁决的完整引擎。 */
function resolveSteps(game, plans, random = () => 0.5) {
  const b = boardCopy(game), balance = b.config.balance;
  const order = (game.turn?.turnOrder ?? Object.keys(b.players)).filter(o => b.players[o]?.status === 'active');
  const queues = Object.fromEntries(order.map(o => [o, (plans[o] ?? []).map(flat)]));
  const initial = b.units.filter(u => u.alive).map(u => ({ id: u.id, owner: u.owner, q: u.q, r: u.r }));
  const failedUnits = new Set(), attackCounts = new Map(), outcomes = [];
  const terrain = new Map(b.cells.map(c => [key(c), c]));
  const living = id => b.units.find(u => u.id === id && u.alive);
  const occupant = p => b.units.find(u => u.alive && key(u) === key(p)) ?? Object.values(b.headquarters).find(h => h.alive && key(h) === key(p));
  const outcome = (item, status, reason) => outcomes.push({ owner: item.owner, step: item.step, type: item.a.type, unitId: subject(item.a), status, ...(reason ? { reason } : {}) });
  const fail = (item, reason, cascade = true) => { outcome(item, 'failed', reason); if (cascade && subject(item.a)) failedUnits.add(subject(item.a)); };
  let ending = null, steps = 0, serial = 0;
  const count = Math.max(0, ...Object.values(queues).map(q => q.length));
  for (let i = 0; i < count; i++) {
    const items = [];
    let activeActions = 0;
    for (const owner of order) {
      const a = queues[owner][i];
      if (!a || b.players[owner].status !== 'active') continue;
      activeActions++;
      const item = { owner, a, step: i + 1 }, id = subject(a);
      if (id && !living(id)) fail(item, 'unit_gone');
      else if (id && failedUnits.has(id)) fail(item, 'previous_action_failed');
      else items.push(item);
    }
    if (!activeActions) continue;
    steps = i + 1;
    const occupied = new Map();
    for (const u of [...b.units, ...Object.values(b.headquarters)]) if (u.alive && !occupied.has(key(u))) occupied.set(key(u), u);
    const arrivals = items.filter(x => ['move', 'deploy'].includes(x.a.type));
    const destinations = new Map(), moving = new Map(), failures = new Map();
    for (const x of arrivals) {
      const k = key(x.a); destinations.set(k, (destinations.get(k) ?? 0) + 1);
      if (x.a.type === 'move') moving.set(x.a.unitId, x);
    }
    for (const x of arrivals) {
      const k = key(x.a), there = occupied.get(k);
      if (destinations.get(k) > 1) failures.set(x, 'destination_conflict');
      else if (terrain.get(k)?.terrain !== 'plain') failures.set(x, 'destination_blocked');
      else if (there && !moving.has(there.id)) failures.set(x, 'destination_occupied');
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const x of arrivals) {
        const dependency = moving.get(occupied.get(key(x.a))?.id);
        if (!failures.has(x) && dependency && failures.has(dependency)) { failures.set(x, 'destination_occupied'); changed = true; }
      }
    }
    // 引擎固定先部署后移动；到达判定已经用步初占位完成。
    for (const kind of ['deploy', 'move']) for (const x of arrivals.filter(x => x.a.type === kind)) {
      const a = x.a;
      if (failures.has(x)) { fail(x, failures.get(x), kind === 'move'); continue; }
      if (kind === 'move') {
        const u = living(a.unitId);
        if (!u || u.owner !== x.owner) { fail(x, 'unit_gone'); continue; }
        u.q = a.q; u.r = a.r; u.hasMoved = true; outcome(x, 'executed');
      } else {
        const s = b.config.units[a.unitType];
        if (!s) { fail(x, 'unknown_unit', false); continue; }
        const cp = b.controlPoints.find(p => p.owner === x.owner && p.id === a.fromId);
        const cost = Math.max(0, s.cost - (balance.controlPointTypes?.[cp?.kind]?.deployDiscount ?? 0));
        if (!b.resources[x.owner] || b.resources[x.owner].supplies < cost) { fail(x, 'insufficient_supplies', false); continue; }
        b.resources[x.owner].supplies -= cost;
        b.units.push({ ...s, id: `~new:${x.owner}:${serial++}`, owner: x.owner, type: a.unitType, q: a.q, r: a.r, maxHp: s.hp, alive: true, hasMoved: true, hasActed: false, actionSpent: true });
        outcome(x, 'executed');
      }
    }
    for (const x of items.filter(x => x.a.type === 'demolish')) {
      const u = living(x.a.unitId), c = terrain.get(key(x.a));
      if (!u || u.type !== 'heavy' || distance(u, x.a) > 1 || c?.terrain !== 'blocker' || occupant(x.a)) fail(x, 'invalid_target');
      else { c.terrain = 'plain'; u.hasActed = true; outcome(x, 'executed'); }
    }
    for (const x of items.filter(x => x.a.type === 'wait')) outcome(x, 'executed');
    const strikes = [];
    for (const x of items.filter(x => x.a.type === 'attack')) {
      const u = living(x.a.attackerId);
      if (!u || u.owner !== x.owner) { fail(x, 'unit_gone'); continue; }
      const used = attackCounts.get(u.id) ?? 0;
      if (used >= (balance.attacksPerUnit ?? 1)) { fail(x, 'attack_limit_reached'); continue; }
      attackCounts.set(u.id, used + 1);
      const s = b.config.units[u.type], cells = footprint(u, s, 'attackShape', x.a, u.attackRange);
      if (!cells) { fail(x, 'out_of_range'); continue; }
      u.hasActed = true;
      const lock = s.attackLock ? initial.find(p => p.owner !== x.owner && key(p) === key(x.a)) : null;
      strikes.push({ x, u, cells, lock });
    }
    // 治疗先封顶，随后扣伤；满血单位不能预存治疗抵消本步伤害。
    for (const x of items.filter(x => x.a.type === 'heal')) {
      const u = living(x.a.supportId), s = b.config.units[u?.type];
      const cells = u && u.type === 'support' ? footprint(u, s, 'healShape', x.a, s.healRange ?? u.attackRange) : null;
      if (!cells) { outcome(x, 'fizzled', 'out_of_range'); continue; }
      u.hasActed = true;
      const targets = cells.map(p => b.units.find(v => v.alive && v.owner === x.owner && key(v) === key(p))).filter(Boolean);
      let applied = 0;
      for (const v of targets) if (v.hp < v.maxHp) {
        const amount = Math.min(v.maxHp - v.hp, (u.healPower ?? 0) + Math.floor(random() * (balance.healVarianceRange + 1)));
        if (amount > 0) { v.hp += amount; applied += amount; }
      }
      outcome(x, applied ? 'executed' : 'fizzled', applied ? undefined : targets.length ? 'already_healthy' : 'out_of_range');
    }
    const deaths = new Map();
    for (const { x, u, cells, lock } of strikes) {
      const locked = lock ? living(lock.id) : null;
      const targets = lock
        ? (locked && distance(u, locked) <= u.attackRange ? [locked] : [])
        : cells.map(occupant).filter(v => v && v.owner !== x.owner);
      if (!targets.length) { outcome(x, 'missed', lock ? 'target_escaped' : undefined); continue; }
      for (const v of targets) {
        const amount = Math.max(balance.minimumDamage, u.attack - v.defense + Math.floor(random() * (2 * balance.damageVarianceRange + 1)) - balance.damageVarianceRange);
        const actual = Math.min(v.hp, amount); v.hp = Math.max(0, v.hp - amount);
        const hq = b.headquarters[v.owner]?.id === v.id;
        if (hq) b.players[x.owner].stats.headquartersDamage = (b.players[x.owner].stats.headquartersDamage ?? 0) + actual;
        if (v.hp === 0 && !deaths.has(v.id)) {
          deaths.set(v.id, v);
          if (!hq) b.players[x.owner].stats.killValue = (b.players[x.owner].stats.killValue ?? 0) + v.cost;
        }
      }
      outcome(x, 'executed');
    }
    // 保留全部已发射炮弹后再淘汰，互杀成立；淘汰清掉该席位全部单位。
    for (const v of deaths.values()) {
      v.alive = false;
      if (b.headquarters[v.owner]?.id !== v.id) continue;
      b.players[v.owner].status = 'eliminated';
      b.units = b.units.filter(u => u.owner !== v.owner);
      for (const p of b.controlPoints) if (p.owner === v.owner) p.owner = null;
    }
    const active = order.filter(o => b.players[o].status === 'active');
    if (active.length <= 1) { ending = active[0] ?? null; break; }
  }
  return { board: b, outcomes, ending, steps };
}

/** 地形寻路忽略单位；占位仅限制每次动作的落点。 */
function topology(board) {
  const cells = new Map(board.cells.map(c => [key(c), c])), reachCache = new Map(), fieldCache = new Map();
  const field = target => {
    const id = key(target);
    if (fieldCache.has(id)) return fieldCache.get(id);
    const result = new Map([[id, 0]]), pending = [target];
    for (let i = 0; i < pending.length; i++) for (const n of adjacent(pending[i])) {
      const k = key(n);
      if (result.has(k) || cells.get(k)?.terrain !== 'plain') continue;
      result.set(k, result.get(key(pending[i])) + 1); pending.push(n);
    }
    fieldCache.set(id, result); return result;
  };
  const reach = (from, range) => {
    const id = `${key(from)}:${range}`;
    if (reachCache.has(id)) return reachCache.get(id);
    const visited = new Set([key(from)]), pending = [{ ...from, d: 0 }], result = [];
    for (let i = 0; i < pending.length; i++) {
      const p = pending[i]; if (p.d >= range) continue;
      for (const n of adjacent(p)) {
        const k = key(n);
        if (visited.has(k) || cells.get(k)?.terrain !== 'plain') continue;
        visited.add(k); result.push(n); pending.push({ ...n, d: p.d + 1 });
      }
    }
    reachCache.set(id, result); return result;
  };
  return { cells, field, reach };
}

/** 计划期结构校验：独立于静止敌人假设，严格遵循己方队列投影。 */
function legalPlan(game, owner, queue) {
  const b = boardCopy(game), balance = b.config.balance, attacks = new Map();
  if (queue.length > balance.actionsPerTurn) return false;
  let topo = topology(b), money = b.resources[owner]?.supplies ?? 0;
  for (const raw of queue) {
    const a = flat(raw), id = subject(a), u = b.units.find(u => u.alive && u.owner === owner && u.id === id);
    if (a.type === 'wait') continue;
    if (!topo.cells.has(key(a))) return false;
    if (a.type === 'deploy') {
      const s = b.config.units[a.unitType], origin = origins(b, owner).find(p => p.id === a.fromId);
      if (!s || !origin || distance(origin, a) !== 1 || topo.cells.get(key(a)).terrain !== 'plain') return false;
      money -= Math.max(0, s.cost - (balance.controlPointTypes?.[origin.kind]?.deployDiscount ?? 0));
      if (money < 0) return false;
      continue;
    }
    if (!u) return false;
    if (a.type === 'move') {
      if (!topo.reach(u, u.moveRange).some(p => key(p) === key(a))) return false;
      u.q = a.q; u.r = a.r;
    } else if (a.type === 'attack' || a.type === 'heal') {
      const s = b.config.units[u.type], heal = a.type === 'heal';
      if (heal && u.type !== 'support') return false;
      if (!footprint(u, s, heal ? 'healShape' : 'attackShape', a, heal ? s.healRange ?? u.attackRange : u.attackRange)) return false;
      if (!heal) { const n = (attacks.get(u.id) ?? 0) + 1; attacks.set(u.id, n); if (n > (balance.attacksPerUnit ?? 1)) return false; }
    } else if (a.type === 'demolish') {
      const cell = topo.cells.get(key(a));
      if (u.type !== 'heavy' || distance(u, a) > 1 || cell.terrain !== 'blocker') return false;
      cell.terrain = 'plain'; topo = topology(b);
    } else return false;
  }
  return true;
}

/** 部署入口的归属在轮末才变化，不借用本轮尚未结算的占点。 */
function origins(b, owner) {
  return [
    ...(b.config.balance.deployFromHq !== false && b.headquarters[owner]?.alive ? [b.headquarters[owner]] : []),
    ...b.controlPoints.filter(p => p.owner === owner && b.config.balance.controlPointTypes?.[p.kind]?.canDeploy !== false),
  ];
}

/** 公开局面上的任务市场。敌方威胁是预算上界，不是猜测其秘密指令。 */
function market(game, owner, board, prefix, shared) {
  const b = board, balance = b.config.balance, weights = balance.adjudicationWeights;
  const topo = shared.topologies.get(b.cells.map(c => c.terrain[0]).join('')) ?? topology(b);
  shared.topologies.set(b.cells.map(c => c.terrain[0]).join(''), topo);
  const own = b.units.filter(u => u.alive && u.owner === owner);
  const enemies = b.units.filter(u => u.alive && u.owner !== owner);
  const headquarters = Object.values(b.headquarters).filter(h => h.alive && h.owner !== owner);
  const occupied = new Set([...b.units, ...Object.values(b.headquarters)].filter(u => u.alive).map(key));
  const initial = new Map(game.units.map(u => [u.id, u]));
  const counts = new Map();
  for (const a of prefix) if (a.type === 'attack') counts.set(a.attackerId, (counts.get(a.attackerId) ?? 0) + 1);
  const remaining = balance.actionsPerTurn - prefix.length;
  const rounds = balance.maxTurns == null ? 8 : Math.max(1, balance.maxTurns - game.turn.roundNumber + 1);
  const fade = Math.min(1, (rounds - 1) / 3);
  const damage = (u, v) => Math.max(balance.minimumDamage, u.attack - v.defense);
  const price = u => (u.cost ?? b.config.units[u.type]?.cost ?? 0) / Math.max(1, u.maxHp);
  const covers = (u, from, p) => footprint(from, b.config.units[u.type], 'attackShape', p, u.attackRange) !== null;
  const aims = (u, from, heal = false) => {
    const spec = b.config.units[u.type], kind = heal ? 'healShape' : 'attackShape';
    const range = heal ? spec.healRange ?? u.attackRange : u.attackRange;
    if ((spec[kind]?.type ?? 'single') !== 'single') return adjacent(from).filter(p => topo.cells.has(key(p)) && footprint(from, spec, kind, p, range));
    return b.cells.filter(p => distance(from, p) <= range && (heal || distance(from, p) > 0));
  };
  const ownHq = b.headquarters[owner];
  // 多方交战存在第三方收益：攻下一家不等于终局，不能用总部寿命换无关战线的分数。
  // 对每席位分别截断火力预算，以两轮接敌包络衡量回防紧迫度。
  const activeCount = Object.values(b.players).filter(p => p.status === 'active').length;
  const hqThreats = new Map();
  if (ownHq?.alive && activeCount > 2) for (const e of enemies) {
    const direct = covers(e, e, ownHq), gap = Math.max(0, distance(e, ownHq) - e.attackRange);
    const readiness = direct ? 1 : gap <= e.moveRange ? 0.55 : gap <= e.moveRange * 2 ? 0.12 : 0;
    if (!hqThreats.has(e.owner)) hqThreats.set(e.owner, []);
    hqThreats.get(e.owner).push(damage(e, ownHq) * readiness);
  }
  let pressure = 0;
  for (const values of hqThreats.values()) pressure += values.sort((a, b) => b - a).slice(0, balance.actionsPerTurn).reduce((a, b) => a + b, 0);
  const alarm = ownHq?.alive ? Math.min(6, Math.max(0, pressure * 2.5 / Math.max(1, ownHq.hp) - 0.5)) : 0;
  const urgency = v => {
    if (!ownHq?.alive) return 1;
    const d = distance(v, ownHq), approach = Math.max(0, Math.ceil((d - v.attackRange) / Math.max(1, v.moveRange)));
    if (approach > 2) return 1;
    return 1 + (approach === 0 ? 4 : approach === 1 ? 2.5 : 0.7) * Math.min(2, 65 / Math.max(10, ownHq.hp))
      + alarm * (approach === 0 ? 8 : approach === 1 ? 4 : 1);
  };
  // 每一席位的火力都受共享 AP 限制，避免多席位退化成“所有敌人围攻我”。
  const exposureCache = new Map();
  const exposure = (u, pos) => {
    const cacheKey = `${u.id}:${key(pos)}`;
    if (exposureCache.has(cacheKey)) return exposureCache.get(cacheKey);
    const old = initial.get(u.id) ?? u, moved = key(pos) !== key(old), byOwner = new Map();
    for (const e of enemies) {
      const direct = covers(e, e, pos), gap = Math.max(0, distance(e, pos) - e.attackRange);
      if (!direct && gap > e.moveRange) continue;
      const lock = b.config.units[e.type].attackLock && covers(e, e, old);
      const probability = direct ? lock ? 0.85 : moved ? 0.19 : 0.63 : moved ? 0.07 : 0.16;
      const value = damage(e, u) * probability;
      if (!byOwner.has(e.owner)) byOwner.set(e.owner, []);
      byOwner.get(e.owner).push(value);
    }
    let total = 0;
    for (const values of byOwner.values()) total += values.sort((a, b) => b - a).slice(0, balance.actionsPerTurn).reduce((a, b) => a + b, 0);
    // 承伤不仅损失残值，也可能抹掉后续整串行动。
    const cost = total * price(u) * (1.4 + weights.armyValue) + (total > u.hp * 0.65 ? 50 * Math.min(2, total / Math.max(1, u.hp)) : 0);
    exposureCache.set(cacheKey, cost); return cost;
  };
  const cpValue = p => {
    const effect = balance.controlPointTypes?.[p.kind] ?? {};
    const flow = weights.controlPointFlowRatio ?? 0.7;
    const horizon = balance.maxTurns == null ? 1 : rounds / Math.max(1, balance.maxTurns);
    const income = effect.income ?? balance.controlPointIncome ?? 0;
    const scarcity = !origins(b, owner).length && effect.canDeploy !== false ? 30 : 0;
    return weights.controlPoint * ((1 - flow) + flow * horizon) * (p.owner && p.owner !== owner ? 1.45 : 1)
      + income * Math.min(5, rounds - 1) * 1.4 + (effect.canDeploy !== false ? 12 * fade + scarcity * fade : 0)
      + (effect.repairAmount ?? 0) * 0.8 * fade;
  };
  const pendingOwner = p => b.units.find(u => u.alive && u.canCapture && key(u) === key(p))?.owner ?? p.owner;
  const leaveCost = u => {
    if (!u.canCapture) return 0;
    const p = b.controlPoints.find(p => key(p) === key(u) && p.owner !== owner);
    return p ? cpValue(p) : 0;
  };
  const shotGain = (u, from, aim) => {
    const cells = footprint(from, b.config.units[u.type], 'attackShape', aim, u.attackRange);
    if (!cells) return 0;
    const targets = [...enemies, ...headquarters].filter(v => cells.some(p => key(p) === key(v)));
    let total = 0;
    for (const v of targets) {
      const amount = Math.min(v.hp, damage(u, v));
      if (b.headquarters[v.owner]?.id === v.id) {
        // 攻城任务含下一轮继续开火的价值；脆弱总部的斩首期限自动缩短。
        total += (amount * (weights.enemyHqDamage + weights.ownHqHp * 0.6 + 1.5)
          + (amount >= v.hp ? 1800 : 55 * amount / Math.max(1, v.hp))
          + fade * amount * 0.65) / (1 + alarm);
      } else {
        const confidence = b.config.units[u.type].attackLock ? 0.94 : 0.82;
        const kill = amount >= v.hp ? (v.cost * (0.8 + (weights.killValue ?? 0)) + 30) : 0;
        total += confidence * (amount * price(v) * (1.2 + weights.armyValue) + kill) * urgency(v);
      }
    }
    return total;
  };
  const bestShot = (u, from) => {
    let best = null;
    for (const a of aims(u, from)) {
      const value = shotGain(u, from, a);
      if (value > (best?.gain ?? 0)) best = { aim: a, gain: value };
    }
    return best;
  };
  const missions = [], seen = new Set();
  const add = (actions, gain, label) => {
    if (!actions.length || actions.length > remaining || !(gain > 0.01) || !Number.isFinite(gain)) return;
    const s = actions.map(signature).join(';'); if (seen.has(s)) return; seen.add(s);
    missions.push({ actions, gain, label, rate: gain / Math.pow(actions.length, 0.9) });
  };
  // 到指定目标的连续机动。以地形最短距离下降为约束，不会在“势能”上绕圈刷分。
  const route = (u, target, budget) => {
    const field = topo.field(target); let pos = u; const actions = [];
    for (let n = 0; n < budget && key(pos) !== key(target); n++) {
      const options = topo.reach(pos, u.moveRange).filter(p => !occupied.has(key(p)) || key(p) === key(u));
      const current = field.get(key(pos)) ?? Infinity;
      options.sort((a, b) => {
        const va = (field.get(key(a)) ?? 1e6) * 18 + exposure(u, a) * 0.08;
        const vb = (field.get(key(b)) ?? 1e6) * 18 + exposure(u, b) * 0.08;
        return va - vb;
      });
      const next = options.find(p => (field.get(key(p)) ?? Infinity) < current);
      if (!next) break;
      actions.push({ type: 'move', unitId: u.id, q: next.q, r: next.r }); pos = next;
    }
    return { actions, pos, reached: key(pos) === key(target) };
  };
  for (const u of own) {
    if (!initial.has(u.id)) continue; // 本轮部署单位没有可引用的服务器 ID。
    if (performance.now() > shared.deadline) break;
    const availableAttack = (counts.get(u.id) ?? 0) < (balance.attacksPerUnit ?? 1);
    const oldRisk = exposure(u, u), depart = leaveCost(u);
    if (availableAttack) for (const aim of aims(u, u)) {
      const gain = shotGain(u, u, aim);
      add([{ type: 'attack', attackerId: u.id, q: aim.q, r: aim.r }], gain, 'fire');
    }
    if (u.type === 'support') for (const aim of aims(u, u, true)) {
      const covered = footprint(u, b.config.units[u.type], 'healShape', aim, b.config.units[u.type].healRange ?? u.attackRange);
      let gain = 0;
      for (const v of own) if (covered.some(p => key(p) === key(v))) {
        const heal = Math.min(v.maxHp - v.hp, (u.healPower ?? 0) + balance.healVarianceRange / 2);
        gain += heal * price(v) * (1.8 + weights.armyValue) + (heal > 0 && v.hp < v.maxHp * 0.4 ? 20 : 0);
      }
      add([{ type: 'heal', supportId: u.id, q: aim.q, r: aim.r }], gain, 'repair');
    }
    if (u.canCapture) for (const p of b.controlPoints) {
      if (pendingOwner(p) === owner || occupied.has(key(p))) continue;
      const trip = route(u, p, Math.min(remaining, 3));
      if (trip.reached) add(trip.actions, cpValue(p) - depart + (oldRisk - exposure(u, trip.pos)) * 0.55, 'capture');
      else if (trip.actions.length && rounds > 1) {
        const field = topo.field(p), before = field.get(key(u)) ?? Infinity, after = field.get(key(trip.pos)) ?? Infinity;
        const progress = Number.isFinite(before) ? (before - after) / Math.max(before, u.moveRange) : 0;
        add(trip.actions, cpValue(p) * 0.45 * progress - depart - exposure(u, trip.pos) * 0.45, 'approach');
      }
    }
    // 攻城与战斗任务从“有效射击格”反向找路，而非固定朝总部坐标走。
    if (availableAttack && remaining >= 2) {
      for (const target of [...headquarters, ...enemies].sort((a, b) => distance(u, a) - distance(u, b)).slice(0, 12)) {
        const firing = b.cells.filter(p => p.terrain === 'plain' && !occupied.has(key(p)) && covers(u, p, target));
        firing.sort((a, b) => distance(u, a) - distance(u, b) || exposure(u, a) - exposure(u, b));
        let best = null;
        for (const p of firing.slice(0, 4)) {
          const trip = route(u, p, Math.min(remaining - 1, 3));
          if (!trip.reached || !trip.actions.length) continue;
          const shot = bestShot(u, p); if (!shot) continue;
          const gain = shot.gain + (oldRisk - exposure(u, p)) * 0.65 - depart;
          const actions = [...trip.actions, { type: 'attack', attackerId: u.id, q: shot.aim.q, r: shot.aim.r }];
          if (!best || gain / actions.length > best.gain / best.actions.length) best = { actions, gain };
        }
        if (best) add(best.actions, best.gain, 'sortie');
      }
    }
    // 单步走位允许已经开火的单位脱离锁定圈，也让预算不足的攻城计划跨轮衔接。
    let bestAdvance = null, bestRetreat = null;
    for (const p of topo.reach(u, u.moveRange)) {
      if (occupied.has(key(p))) continue;
      const risk = exposure(u, p), saved = oldRisk - risk - depart;
      if (!bestRetreat || saved > bestRetreat.gain) bestRetreat = { p, gain: saved * 0.8 };
      if (!availableAttack || rounds <= 1) continue;
      for (const h of headquarters) {
        const before = Math.max(0, distance(u, h) - u.attackRange), after = Math.max(0, distance(p, h) - u.attackRange);
        if (after >= before) continue;
        const fire = damage(u, h) * (weights.enemyHqDamage + 1.5);
        const gain = fade * fire * 0.50 * (before - after) / Math.max(u.moveRange, before)
          + (after === 0 && covers(u, p, h) ? fade * fire * 0.30 : 0) - risk * 0.45 - depart;
        if (!bestAdvance || gain > bestAdvance.gain) bestAdvance = { p, gain };
      }
    }
    for (const option of [bestAdvance, bestRetreat]) if (option) add([{ type: 'move', unitId: u.id, q: option.p.q, r: option.p.r }], option.gain, 'position');
    if (u.type === 'heavy') for (const p of adjacent(u)) {
      if (topo.cells.get(key(p))?.terrain !== 'blocker' || occupied.has(key(p))) continue;
      const nearby = [...b.controlPoints.filter(c => pendingOwner(c) !== owner), ...headquarters];
      const useful = nearby.some(t => distance(p, t) < distance(u, t) && (topo.field(t).get(key(u)) ?? Infinity) > distance(u, t) + 2);
      if (useful) add([{ type: 'demolish', unitId: u.id, q: p.q, r: p.r }], 12 * fade, 'open');
    }
  }
  const cash = b.resources[owner]?.supplies ?? 0;
  recruitment: for (const origin of origins(b, owner)) for (const p of adjacent(origin)) {
    if (performance.now() > shared.deadline) break recruitment;
    if (topo.cells.get(key(p))?.terrain !== 'plain' || occupied.has(key(p))) continue;
    for (const [type, spec] of Object.entries(b.config.units)) {
      const cost = Math.max(0, spec.cost - (balance.controlPointTypes?.[origin.kind]?.deployDiscount ?? 0));
      if (cost > cash) continue;
      const u = { ...spec, id: `deploy:${type}`, type, owner, ...p, maxHp: spec.hp };
      const shot = bestShot(u, p), risk = exposure(u, p);
      const armyGain = spec.cost * weights.armyValue;
      const crowd = Math.max(0, own.length - balance.actionsPerTurn * 1.5);
      let gain = armyGain + fade * (spec.attack * 0.8 + spec.attackRange * 8 + (spec.canCapture ? 12 : 0)) / (1 + crowd * 0.5)
        + (shot?.gain ?? 0) * fade * 0.32 - cost * 0.65 * fade - risk * 0.7;
      const point = b.controlPoints.find(c => key(c) === key(p) && pendingOwner(c) !== owner);
      if (spec.canCapture && point) gain += cpValue(point);
      if (spec.healPower) gain += fade * own.reduce((sum, v) => sum + Math.min(v.maxHp - v.hp, spec.healPower), 0) * 0.15;
      add([{ type: 'deploy', unitType: type, fromId: origin.id, q: p.q, r: p.r }], gain, 'recruit');
    }
  }
  missions.sort((a, b) => b.rate - a.rate);
  return missions.slice(0, 12);
}

/** 有限宽度的变长任务排程：按 AP 分层，任务内的先后依赖不可拆散。 */
function schedule(game, owner, prefix, deadline) {
  const shared = { deadline, topologies: new Map() }, limit = game.config.balance.actionsPerTurn;
  const base = resolveSteps(game, { [owner]: prefix }).board;
  const buckets = Array.from({ length: limit + 1 }, () => []);
  const root = { plan: prefix, board: base, score: 0 };
  buckets[prefix.length].push(root); let best = root;
  for (let used = prefix.length; used < limit && performance.now() < deadline; used++) {
    const bucket = buckets[used].sort((a, b) => b.score - a.score).slice(0, 4);
    for (const node of bucket) {
      if (performance.now() > deadline) break;
      const options = market(game, owner, node.board, node.plan, shared);
      for (const option of options.slice(0, 8)) {
        const plan = [...node.plan, ...option.actions];
        if (!legalPlan(game, owner, plan)) continue;
        const result = resolveSteps(game, { [owner]: plan });
        if (result.outcomes.some(x => x.status === 'failed')) continue;
        const score = node.score + option.gain;
        const next = { plan, board: result.board, score };
        if (score > best.score) best = next;
        const target = buckets[plan.length];
        if (!target.some(n => n.plan.map(signature).join(';') === plan.map(signature).join(';'))) target.push(next);
        if (target.length > 40) target.sort((a, b) => b.score - a.score).splice(16);
      }
    }
  }
  return best.plan;
}

/**
 * 返回一个计划动作；null 表示提交。缓存必须核对完整的有序前缀。
 * @param {object} game 公开 API 快照
 * @param {object} utils 框架工具（本策略不依赖其顺序模式寻路）
 * @param {{owner?: string}} ctx 当前席位
 * @returns {object|null} 策略接口动作
 */
function decide(game, utils, ctx) {
  const owner = ctx?.owner;
  if (!owner || game.config?.mode !== 'simultaneous' || game.phase !== 'active' || !game.plan || game.players?.[owner]?.status !== 'active') return null;
  const prefix = (game.plan.myQueue ?? []).map(flat), limit = game.config.balance.actionsPerTurn;
  if ((game.plan.committed ?? []).includes(owner) || prefix.length >= limit) return null;
  // 不把事件史、对手队列、随机状态或无关的地图元信息带进缓存键。
  const stamp = JSON.stringify([game.turn.roundNumber, game.cells, game.config.units, game.config.balance, game.units, game.headquarters, game.controlPoints, game.resources,
    Object.entries(game.players).map(([id, p]) => [id, p.status, p.stats])]);
  const cacheKey = `${game.id ?? ''}:${owner}`;
  let entry = planCache.get(cacheKey);
  if (!entry || entry.stamp !== stamp || !prefix.every((a, i) => signature(a) === signature(entry.plan[i] ?? { type: '?' }))) {
    const plan = schedule(game, owner, prefix, performance.now() + 650);
    entry = { stamp, plan }; planCache.delete(cacheKey); planCache.set(cacheKey, entry);
    if (planCache.size > 32) planCache.delete(planCache.keys().next().value);
  }
  const action = entry.plan[prefix.length];
  return action && legalPlan(game, owner, [...prefix, action]) ? command(action) : null;
}

export const tempoWeaveInternals = { footprint, resolveSteps, legalPlan, topology, schedule, market, clearCache: () => planCache.clear() };
export default { name: 'tempo-weave', description: '经纬：任务竞价、变长行动排程与总部生存期限约束', decide };
