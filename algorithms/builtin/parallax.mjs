const STEPS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const key = (p) => `${p.q},${p.r}`;
const distance = (a, b) => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.q + a.r - b.q - b.r));
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

function geometry(cells, overrides, headquarters) {
  const ids = new Map(cells.map((c, i) => [key(c), i]));
  const terrain = cells.map(c => c.terrain);
  for (const c of overrides) if (ids.has(key(c))) terrain[ids.get(key(c))] = c.terrain;
  const neighbors = cells.map(c => STEPS.map(([q, r]) => ids.get(`${c.q + q},${c.r + r}`)).filter(i => i !== undefined));
  const hqCells = new Set(headquarters.filter(h => h.alive).map(h => ids.get(key(h))));
  return { cells, ids, terrain, neighbors, hqCells, fields: new Map() };
}

export function createSearchState(view) {
  const hqs = Object.values(view.headquarters);
  const geo = geometry(view.cells, view.map.terrainCells, hqs);
  const locate = entity => ({ ...entity, p: geo.ids.get(key(entity)) });
  return {
    geo, config: view.config, owner: view.turn.currentPlayerId ?? view.turn.currentOwner,
    order: [...view.turn.turnOrder], acted: [...view.turn.actedThisRound],
    round: view.turn.roundNumber ?? view.turn.turnNumber, ap: view.turn.actionsUsed,
    units: view.units.filter(u => u.alive).map(locate), hqs: hqs.filter(h => h.alive).map(locate),
    points: view.controlPoints.map(locate),
    supplies: Object.fromEntries(Object.entries(view.resources).map(([id, r]) => [id, r.supplies])),
    stats: Object.fromEntries(Object.entries(view.players).map(([id, p]) => [id, { ...p.stats }])),
    active: view.turn.turnOrder.filter(id => view.players[id]?.status === 'active'),
    terminal: view.phase !== 'active', winner: view.winner, serial: 0,
  };
}

function copy(s) {
  return { ...s, units: s.units.map(u => ({ ...u })), hqs: s.hqs.map(h => ({ ...h })),
    points: s.points.map(p => ({ ...p })), supplies: { ...s.supplies },
    stats: Object.fromEntries(Object.entries(s.stats).map(([id, v]) => [id, { ...v }])),
    active: [...s.active], acted: [...s.acted] };
}

function field(s, target, range = 0, breaking = false) {
  const g = s.geo;
  const cacheKey = `${target}:${range}:${breaking}`;
  if (g.fields.has(cacheKey)) return g.fields.get(cacheKey);
  const costs = new Float64Array(g.cells.length).fill(Infinity);
  const buckets = [];
  const add = (p, d) => { costs[p] = d; (buckets[d] ??= []).push(p); };
  for (let i = 0; i < g.cells.length; i++) {
    if (distance(g.cells[i], g.cells[target]) <= range && !g.hqCells.has(i) && g.terrain[i] === 'plain') add(i, 0);
  }
  for (let d = 0; d < buckets.length; d++) {
    for (const p of buckets[d] ?? []) {
      if (costs[p] !== d) continue;
      for (const n of g.neighbors[p]) {
        if (g.hqCells.has(n)) continue;
        const step = g.terrain[n] === 'plain' ? 1 : breaking && g.terrain[n] === 'blocker' ? 5 : Infinity;
        if (d + step < costs[n]) add(n, d + step);
      }
    }
  }
  g.fields.set(cacheKey, costs);
  return costs;
}

function occupied(s, except) {
  const result = new Set(s.hqs.map(h => h.p));
  for (const u of s.units) if (u.id !== except) result.add(u.p);
  return result;
}

export function reachablePositions(s, unit) {
  const blocked = occupied(s, unit.id);
  const visited = new Set([unit.p]);
  const queue = [[unit.p, 0]];
  const result = [];
  for (let i = 0; i < queue.length; i++) {
    const [p, depth] = queue[i];
    if (depth + 1 > unit.moveRange) continue;
    for (const n of s.geo.neighbors[p]) {
      if (visited.has(n)) continue;
      visited.add(n);
      if (s.geo.terrain[n] !== 'plain' || blocked.has(n)) continue;
      result.push(n);
      queue.push([n, depth + 1]);
    }
  }
  return result;
}

export function damageProfile(s, attacker, target) {
  const { damageVarianceRange: variance, minimumDamage: minimum } = s.config.balance;
  let mean = 0, actual = 0, kill = 0;
  const outcomes = 2 * variance + 1;
  for (let i = 0; i < outcomes; i++) {
    const damage = Math.max(minimum, attacker.attack - target.defense + i - variance);
    mean += damage / outcomes;
    actual += Math.min(target.hp, damage) / outcomes;
    if (damage >= target.hp) kill += 1 / outcomes;
  }
  return { mean, actual, kill: Math.min(1, kill), low: Math.max(minimum, attacker.attack - target.defense - variance), high: Math.max(minimum, attacker.attack - target.defense + variance) };
}

function pointSpec(s, p) { return s.config.balance.controlPointTypes?.[p.kind]; }
function income(s, p) { return pointSpec(s, p)?.income ?? s.config.balance.controlPointIncome ?? 0; }
function projectedPoints(s) {
  return s.points.map(p => {
    const u = s.units.find(u => u.owner === s.owner && u.canCapture && u.p === p.p);
    return u ? { ...p, owner: s.owner } : p;
  });
}
function life(s) {
  return s.config.balance.maxTurns === null ? 10 : Math.max(0, s.config.balance.maxTurns - s.round + 1);
}
function arrivalValue(s, turns, decay) {
  return s.config.balance.maxTurns === null ? 1 / (1 + turns * 0.5) : turns < life(s) ? Math.pow(decay, turns) : 0;
}
function resourcePrice(s) {
  const w = s.config.balance.adjudicationWeights;
  return w.supplies + Math.min(1, Math.max(0, life(s) - 1) / 3) * (w.armyValue + 0.7);
}
function unitValue(s, u) {
  const w = s.config.balance.adjudicationWeights;
  const future = Math.min(1, Math.max(0, life(s) - 1) / 3);
  const combat = 0.32 * u.maxHp + 1.3 * u.attack + 12 * u.attackRange + (u.canCapture ? 15 : 0);
  return w.armyValue * u.cost * u.hp / Math.max(1, u.maxHp) + future * combat * (0.45 + 0.55 * u.hp / Math.max(1, u.maxHp));
}
function hpPrice(s, u) {
  return (unitValue(s, u) + u.cost * (s.config.balance.adjudicationWeights.killValue ?? 0)) / Math.max(1, u.hp);
}
function pointValue(s, p) {
  const b = s.config.balance, w = b.adjudicationWeights;
  const rounds = life(s), flow = w.controlPointFlowRatio ?? 0.7;
  const score = w.controlPoint * (1 - flow + flow * (b.maxTurns === null ? 1 : rounds / b.maxTurns));
  return score + income(s, p) * resourcePrice(s) * Math.min(4, Math.max(0, rounds - 1)) +
    Math.min(1, rounds / 3) * ((pointSpec(s, p)?.canDeploy === false ? 0 : 22) + (pointSpec(s, p)?.repairAmount ?? 0));
}
function travel(s, u, p, range = 0) {
  const steps = field(s, p, range, u.type === 'heavy')[u.p];
  return steps === 0 ? 0 : u.moveRange > 0 ? steps / u.moveRange : Infinity;
}
function enemyWeight(s, owner, enemy) {
  if (s.active.length <= 2) return 1;
  const hq = s.hqs.find(h => h.owner === owner);
  const theirs = s.hqs.find(h => h.owner === enemy);
  const near = hq && theirs ? distance(s.geo.cells[hq.p], s.geo.cells[theirs.p]) : 10;
  return 0.45 + 0.55 / (1 + near / 10);
}

function sideValue(s, owner, style) {
  const w = s.config.balance.adjudicationWeights;
  const own = s.units.filter(u => u.owner === owner);
  const enemy = s.units.filter(u => u.owner !== owner);
  const hq = s.hqs.find(h => h.owner === owner);
  const stats = s.stats[owner] ?? {};
  const rounds = life(s), future = Math.min(1, Math.max(0, rounds - 1) / 2);
  const points = projectedPoints(s);
  let v = (s.supplies[owner] ?? 0) * resourcePrice(s) + own.reduce((v, u) => v + unitValue(s, u), 0);
  v += (stats.headquartersDamage ?? 0) * w.enemyHqDamage * (style === 'siege' ? 1.25 : 1);
  v += (stats.killValue ?? 0) * (w.killValue ?? 0);
  if (hq) v += hq.hp * w.ownHqHp;
  const holdRounds = Math.max(1, stats.controlHoldRounds ?? 0);
  const flow = w.controlPointFlowRatio ?? 0.7;
  v += w.controlPoint * flow * (stats.controlHold ?? 0) / holdRounds * (1 - Math.min(1, rounds / (s.config.balance.maxTurns ?? rounds)));
  for (const p of points) {
    const worth = pointValue(s, p);
    if (p.owner === owner) v += worth;
    else {
      let arrival = Infinity;
      for (const u of own) if (u.canCapture) arrival = Math.min(arrival, travel(s, u, p.p));
      v += worth * 0.68 * arrivalValue(s, arrival, 0.57);
    }
    if (p.owner === owner) {
      const repair = pointSpec(s, p)?.repairAmount ?? 0;
      if (repair > 0) for (const u of own) {
        if (distance(s.geo.cells[p.p], s.geo.cells[u.p]) <= 1) v += Math.min(repair, u.maxHp - u.hp) * hpPrice(s, u) * 0.5 * future;
      }
    }
  }
  for (const target of s.hqs) {
    if (target.owner === owner) continue;
    const forces = own.map(u => {
      const turns = travel(s, u, target.p, u.attackRange);
      const hit = Math.max(s.config.balance.minimumDamage, u.attack - target.defense);
      return hit * arrivalValue(s, turns, 0.65);
    }).sort((a, b) => b - a).slice(0, s.config.balance.actionsPerTurn);
    const pressure = Math.min(target.hp, forces.reduce((a, b) => a + b, 0));
    v += pressure * (w.enemyHqDamage + 1.5) * 0.48 * future * (style === 'siege' ? 1.6 : 1);
  }
  for (const u of own) {
    let combatAccess = 0;
    for (const t of enemy) {
      const turns = travel(s, u, t.p, u.attackRange);
      combatAccess = Math.max(combatAccess, Math.max(1, u.attack - t.defense) * hpPrice(s, t) * arrivalValue(s, turns, 0.55));
    }
    v += combatAccess * 0.18 * future;
    if (u.type === 'support') {
      const range = s.config.units.support.healRange ?? u.attackRange;
      let care = 0;
      for (const t of own) care = Math.max(care, Math.min(t.maxHp - t.hp, u.healPower ?? 0) * hpPrice(s, t) * arrivalValue(s, travel(s, u, t.p, range), 0.5));
      v += care * 0.25 * future;
    }
  }
  return v;
}

function exposure(s, owner) {
  const defenders = [...s.units.filter(u => u.owner === owner), ...s.hqs.filter(h => h.owner === owner)];
  const attackers = s.units.filter(u => u.owner !== owner);
  let loss = 0;
  for (const target of defenders) {
    const isHq = !target.type;
    const byOwner = new Map();
    for (const enemy of attackers) {
      if (field(s, target.p, enemy.attackRange)[enemy.p] > enemy.moveRange) continue;
      const now = distance(s.geo.cells[enemy.p], s.geo.cells[target.p]) <= enemy.attackRange;
      const hit = Math.max(s.config.balance.minimumDamage, enemy.attack - target.defense);
      const entry = byOwner.get(enemy.owner) ?? [];
      entry.push(hit * (now ? 1 : 0.8));
      byOwner.set(enemy.owner, entry);
    }
    let incoming = 0;
    for (const hits of byOwner.values()) incoming += hits.sort((a, b) => b - a).slice(0, s.config.balance.actionsPerTurn).reduce((a, b) => a + b, 0);
    if (isHq) {
      const fraction = incoming / Math.max(1, target.hp);
      loss += Math.min(target.hp, incoming) * (s.config.balance.adjudicationWeights.ownHqHp + 1) * 0.3;
      loss += 1600 * Math.pow(clamp(fraction, 0, 1.5), 4);
      let siege = 0;
      for (const enemy of attackers) {
        const arrival = travel(s, enemy, target.p, enemy.attackRange);
        if (arrival >= 2.5) continue;
        let interception = 0;
        for (const u of defenders) {
          if (!u.type) continue;
          const chase = travel(s, u, enemy.p, u.attackRange);
          if (chase <= 1) interception += Math.max(s.config.balance.minimumDamage, u.attack - enemy.defense) * (chase === 0 ? 1 : 0.7);
        }
        const survival = clamp(1 - interception / Math.max(1, enemy.hp) * 0.65, 0.15, 1);
        siege += Math.max(s.config.balance.minimumDamage, enemy.attack - target.defense) * (2.5 - arrival) * survival;
      }
      loss += 650 * Math.pow(clamp(siege / Math.max(1, target.hp), 0, 2), 2);
    } else {
      loss += Math.min(target.hp, incoming) * hpPrice(s, target) * 0.23;
      loss += unitValue(s, target) * Math.pow(clamp(incoming / target.hp, 0, 1), 3) * 0.42;
    }
  }
  return loss;
}

function finalBoundary(s) {
  return s.config.balance.maxTurns !== null && s.round >= s.config.balance.maxTurns &&
    s.active.every(id => id === s.owner || s.acted.includes(id));
}

function evaluate(s, owner, style = 'balanced') {
  if (!s.active.includes(owner)) return -1e7;
  if (s.terminal) return s.winner === owner ? 1e7 : s.winner ? -1e7 : 0;
  if (finalBoundary(s)) {
    const end = copy(s); finishSearchTurn(end);
    const margin = adjudication(end, owner) - Math.max(...end.active.filter(id => id !== owner).map(id => adjudication(end, id)));
    return margin > 0 ? 1e7 + margin : margin;
  }
  let v = sideValue(s, owner, style) - exposure(s, owner) * (style === 'siege' ? 0.15 : 1);
  for (const enemy of s.active) if (enemy !== owner) v -= enemyWeight(s, owner, enemy) * (sideValue(s, enemy, style) - exposure(s, enemy) * 0.45);
  if (style === 'siege') v += (s.stats[owner]?.headquartersDamage ?? 0) * 12;
  return v;
}

function activate(s, u) {
  if (!u.actionSpent) { s.ap++; u.actionSpent = true; }
}
function eliminate(s, owner) {
  s.active = s.active.filter(p => p !== owner);
  s.units = s.units.filter(u => u.owner !== owner);
  s.hqs = s.hqs.filter(h => h.owner !== owner);
  s.points = s.points.map(p => p.owner === owner ? { ...p, owner: null } : p);
  s.geo = { ...s.geo, hqCells: new Set(s.hqs.map(h => h.p)), fields: new Map() };
  if (s.active.length === 1) { s.terminal = true; s.winner = s.active[0]; }
}

export function applySearchAction(s, action, roll = 'mean') {
  const p = action.payload;
  if (action.type === 'deploy') {
    const spec = s.config.units[p.unitType];
    const origin = s.points.find(cp => cp.id === p.fromId);
    const discount = origin ? pointSpec(s, origin)?.deployDiscount ?? 0 : 0;
    s.supplies[s.owner] -= Math.max(0, spec.cost - discount);
    s.ap++;
    const u = { ...spec, id: p.id ?? `@parallax${s.serial++}`, type: p.unitType, owner: s.owner,
      p: s.geo.ids.get(key(p)), q: p.q, r: p.r, maxHp: spec.hp, alive: true,
      hasMoved: true, hasActed: false, actionSpent: true };
    s.units.push(u);
    return;
  }
  const u = s.units.find(u => u.id === (p.unitId ?? p.attackerId ?? p.supportId));
  activate(s, u);
  if (action.type === 'move') {
    u.p = s.geo.ids.get(key(p)); u.q = p.q; u.r = p.r; u.hasMoved = true;
  } else if (action.type === 'attack') {
    const target = s.units.find(t => t.id === p.targetId) ?? s.hqs.find(t => t.id === p.targetId);
    const profile = damageProfile(s, u, target);
    const damage = roll === 'high' ? profile.high : roll === 'low' ? profile.low : profile.mean;
    const dealt = Math.min(target.hp, damage);
    target.hp = Math.max(0, target.hp - damage);
    u.hasActed = true;
    if (!target.type) s.stats[u.owner].headquartersDamage = (s.stats[u.owner].headquartersDamage ?? 0) + dealt;
    if (target.hp <= 1e-8) {
      if (!target.type) eliminate(s, target.owner);
      else {
        s.stats[u.owner].killValue = (s.stats[u.owner].killValue ?? 0) + target.cost;
        s.units = s.units.filter(t => t.id !== target.id);
      }
    }
  } else if (action.type === 'heal') {
    const target = s.units.find(t => t.id === p.targetId);
    const amount = (u.healPower ?? 0) + (roll === 'low' ? 0 : roll === 'high' ? s.config.balance.healVarianceRange : s.config.balance.healVarianceRange / 2);
    target.hp = Math.min(target.maxHp, target.hp + amount); u.hasActed = true;
  } else if (action.type === 'demolish') {
    const at = s.geo.ids.get(key(p));
    const terrain = [...s.geo.terrain]; terrain[at] = 'plain';
    s.geo = { ...s.geo, terrain, fields: new Map() }; u.hasActed = true;
  }
}

function adjudication(s, owner) {
  const w = s.config.balance.adjudicationWeights, stats = s.stats[owner];
  const hq = s.hqs.find(h => h.owner === owner);
  const held = s.points.filter(p => p.owner === owner).length;
  const flow = w.controlPointFlowRatio ?? 0.7;
  const average = Math.round((stats.controlHold ?? 0) / Math.max(1, stats.controlHoldRounds ?? 0) * 100) / 100;
  return (stats.headquartersDamage ?? 0) * w.enemyHqDamage + (hq?.hp ?? 0) * w.ownHqHp +
    w.controlPoint * (flow * average + (1 - flow) * held) +
    s.units.filter(u => u.owner === owner).reduce((v, u) => v + Math.round(u.cost * (u.hp / u.maxHp)), 0) * w.armyValue +
    (s.supplies[owner] ?? 0) * w.supplies + (stats.killValue ?? 0) * (w.killValue ?? 0);
}

export function finishSearchTurn(s) {
  if (s.terminal) return;
  s.points = projectedPoints(s);
  for (const u of s.units) if (u.owner === s.owner) { u.hasMoved = false; u.hasActed = false; u.actionSpent = false; }
  if (!s.acted.includes(s.owner)) s.acted.push(s.owner);
  if (s.active.every(id => s.acted.includes(id))) {
    for (const id of s.active) {
      s.stats[id].controlHold = (s.stats[id].controlHold ?? 0) + s.points.filter(p => p.owner === id).length;
      s.stats[id].controlHoldRounds = (s.stats[id].controlHoldRounds ?? 0) + 1;
    }
    if (s.config.balance.maxTurns !== null && s.round >= s.config.balance.maxTurns) {
      const scores = s.active.map(id => [id, adjudication(s, id)]).sort((a, b) => b[1] - a[1]);
      s.terminal = true; s.winner = scores[0][1] > scores[1][1] ? scores[0][0] : null;
      return;
    }
    const comeback = s.config.balance.comebackSupply;
    if (comeback && s.round >= comeback.startRound) {
      const scores = s.active.map(id => [id, adjudication(s, id)]);
      const leader = Math.max(...scores.map(([, score]) => score));
      for (const [id, score] of scores) if (leader > 0 && leader > score && (leader - score) * 100 >= leader * comeback.scoreGapPercent) s.supplies[id] += comeback.amountPerRound;
    }
    s.round++; s.acted = [];
  }
  const at = s.order.indexOf(s.owner);
  for (let i = 1; i <= s.order.length; i++) {
    const next = s.order[(at + i) % s.order.length];
    if (s.active.includes(next) && !s.acted.includes(next)) { s.owner = next; break; }
  }
  s.ap = 0;
  s.supplies[s.owner] += s.config.balance.baseIncome + s.points.filter(p => p.owner === s.owner).reduce((v, p) => v + income(s, p), 0);
  for (const u of s.units) {
    if (u.owner !== s.owner) continue;
    const repair = s.points.find(p => p.owner === s.owner && (pointSpec(s, p)?.repairAmount ?? 0) > 0 && distance(s.geo.cells[p.p], s.geo.cells[u.p]) <= 1);
    if (repair) u.hp = Math.min(u.maxHp, u.hp + pointSpec(s, repair).repairAmount);
  }
}

function actionAt(type, unit, pos, g) {
  return { type, payload: { unitId: unit.id, q: g.cells[pos].q, r: g.cells[pos].r } };
}
function attackAction(u, t) { return { type: 'attack', payload: { attackerId: u.id, targetId: t.id } }; }
function healAction(u, t) { return { type: 'heal', payload: { supportId: u.id, targetId: t.id } }; }

function placement(s, u, pos, own, enemies) {
  const shadow = { ...u, p: pos };
  let value = 0;
  for (const p of s.points) {
    const occupying = own.find(t => t.p === p.p && t.canCapture);
    const ours = p.owner === u.owner || occupying;
    if (u.canCapture && (!ours || occupying?.id === u.id && p.owner !== u.owner)) {
      let other = Infinity;
      for (const t of own) if (t.id !== u.id && t.canCapture) other = Math.min(other, travel(s, t, p.p));
      const turns = travel(s, shadow, p.p);
      const worth = pointValue(s, p);
      const potential = arrivalValue(s, turns, 0.58);
      const alternative = arrivalValue(s, other, 0.58);
      value += worth * Math.max(0, potential - alternative * 0.85) * (turns === 0 ? 1.1 : 0.7);
    }
    if (p.owner === u.owner && distance(s.geo.cells[pos], s.geo.cells[p.p]) <= 1) value += Math.min(u.maxHp - u.hp, pointSpec(s, p)?.repairAmount ?? 0) * hpPrice(s, u) * 0.6;
  }
  let pressure = 0;
  for (const hq of s.hqs) if (hq.owner !== u.owner) {
    const turns = travel(s, shadow, hq.p, u.attackRange);
    pressure = Math.max(pressure, Math.max(1, u.attack - hq.defense) * (s.config.balance.adjudicationWeights.enemyHqDamage + 2) * arrivalValue(s, turns, 0.6) * 0.55);
  }
  value += pressure;
  let contact = 0, incoming = 0;
  for (const t of enemies) {
    const approach = travel(s, shadow, t.p, u.attackRange);
    contact = Math.max(contact, Math.max(1, u.attack - t.defense) * hpPrice(s, t) * arrivalValue(s, approach, 0.6) * 0.24);
    if (field(s, pos, t.attackRange)[t.p] <= t.moveRange) incoming += Math.max(s.config.balance.minimumDamage, t.attack - u.defense);
  }
  value += contact - hpPrice(s, u) * Math.min(incoming, u.hp) * 0.28 - unitValue(s, u) * Math.pow(clamp(incoming / Math.max(1, u.hp), 0, 1), 3) * 0.5;
  if (u.type === 'support') {
    const range = s.config.units.support.healRange ?? u.attackRange;
    for (const t of own) value += Math.min(t.maxHp - t.hp, u.healPower ?? 0) * hpPrice(s, t) * arrivalValue(s, travel(s, shadow, t.p, range), 0.5) * 0.35;
  }
  return value;
}

function shotValue(s, u, target, style) {
  const hit = damageProfile(s, u, target);
  if (!target.type) return hit.actual * (s.config.balance.adjudicationWeights.enemyHqDamage + s.config.balance.adjudicationWeights.ownHqHp + 2) * (style === 'siege' ? 1.6 : 1) + hit.kill * 100000;
  const price = hpPrice(s, target);
  return (hit.actual * price + hit.kill * (unitValue(s, target) * 0.65 + 25)) * (style === 'combat' ? 1.3 : 1);
}

function orders(s, style, limit) {
  const owner = s.owner;
  const own = s.units.filter(u => u.owner === owner);
  const enemies = s.units.filter(u => u.owner !== owner);
  const targets = [...enemies, ...s.hqs.filter(h => h.owner !== owner)];
  const room = s.ap < s.config.balance.actionsPerTurn;
  const candidates = [];
  const add = (actions, estimate) => { if (actions.length) candidates.push({ actions, estimate }); };
  for (const u of own) {
    if ((!u.actionSpent && !room) || u.hasMoved && u.hasActed) continue;
    const base = placement(s, u, u.p, own, enemies);
    const positions = [u.p, ...(!u.hasMoved ? reachablePositions(s, u) : [])];
    const values = new Map(positions.map(p => [p, placement(s, u, p, own, enemies) - base]));
    for (const pos of positions) {
      const moves = pos === u.p ? [] : [actionAt('move', u, pos, s.geo)];
      const movement = values.get(pos);
      if (moves.length) add(moves, movement);
      if (u.hasActed) continue;
      for (const t of targets) {
        const shot = attackAction(u, t), worth = shotValue(s, u, t, style);
        if (distance(s.geo.cells[pos], s.geo.cells[t.p]) <= u.attackRange) add([...moves, shot], movement + worth);
        if (moves.length && distance(s.geo.cells[u.p], s.geo.cells[t.p]) <= u.attackRange) add([shot, ...moves], movement + worth + 0.01);
      }
      if (u.type === 'support') {
        const range = s.config.units.support.healRange ?? u.attackRange;
        for (const t of own) {
          if (t.hp >= t.maxHp) continue;
          const amount = Math.min(t.maxHp - t.hp, (u.healPower ?? 0) + s.config.balance.healVarianceRange / 2);
          const worth = amount * hpPrice(s, t);
          if (t.id === u.id || distance(s.geo.cells[pos], s.geo.cells[t.p]) <= range) add([...moves, healAction(u, t)], movement + worth);
          if (moves.length && distance(s.geo.cells[u.p], s.geo.cells[t.p]) <= range) add([healAction(u, t), ...moves], movement + worth);
        }
      }
      if (u.type === 'heavy') {
        for (const at of s.geo.neighbors[pos]) {
          if (s.geo.terrain[at] !== 'blocker' || occupied(s).has(at)) continue;
          const demolition = actionAt('demolish', u, at, s.geo);
          let worth = 0;
          for (const p of [...s.points.filter(p => p.owner !== owner), ...s.hqs.filter(h => h.owner !== owner)]) {
            const range = p.hp === undefined ? 0 : u.attackRange;
            const f = field(s, p.p, range, true);
            if (f[at] < f[pos]) worth = Math.max(worth, (p.hp === undefined ? pointValue(s, p) : 180) / (1 + f[at]) * 0.8);
          }
          add([...moves, demolition], movement + worth);
          if (pos === u.p && !u.hasMoved && worth > 0) {
            const opened = copy(s); applySearchAction(opened, demolition);
            for (const n of reachablePositions(opened, u)) add([demolition, actionAt('move', u, n, s.geo)], placement(opened, u, n, own, enemies) - base + worth);
          }
        }
      }
    }
    if (!u.hasMoved && !u.hasActed) {
      for (const t of enemies) {
        if (distance(s.geo.cells[u.p], s.geo.cells[t.p]) > u.attackRange || damageProfile(s, u, t).kill < 0.99) continue;
        const cleared = copy(s); applySearchAction(cleared, attackAction(u, t), 'low');
        for (const pos of reachablePositions(cleared, u)) {
          if (values.has(pos)) continue;
          add([attackAction(u, t), actionAt('move', u, pos, s.geo)], shotValue(s, u, t, style) + placement(cleared, u, pos, own, enemies.filter(e => e.id !== t.id)) - base);
        }
      }
    }
  }
  if (room) {
    const sources = [
      ...s.hqs.filter(h => h.owner === owner && s.config.balance.deployFromHq !== false),
      ...s.points.filter(p => p.owner === owner && pointSpec(s, p)?.canDeploy !== false),
    ];
    const blocked = occupied(s);
    for (const source of sources) {
      const discount = source.type === undefined && source.kind ? pointSpec(s, source)?.deployDiscount ?? 0 : 0;
      for (const [type, spec] of Object.entries(s.config.units)) {
        const cost = Math.max(0, spec.cost - discount);
        if (cost > s.supplies[owner]) continue;
        for (const pos of s.geo.neighbors[source.p]) {
          if (s.geo.terrain[pos] !== 'plain' || blocked.has(pos)) continue;
          const u = { ...spec, type, owner, id: `@parallax${s.serial}`, p: pos, maxHp: spec.hp, hasMoved: true, hasActed: false, actionSpent: true };
          const action = { type: 'deploy', payload: { unitType: type, fromId: source.id, q: s.geo.cells[pos].q, r: s.geo.cells[pos].r } };
          const saturation = Math.max(0, own.length - s.config.balance.actionsPerTurn - 1) * 12 * Math.min(1, life(s) / 3);
          const worth = unitValue(s, u) - cost * resourcePrice(s) + placement(s, u, pos, own, enemies) * 0.6 - saturation;
          add([action], worth);
          for (const t of targets) if (distance(s.geo.cells[pos], s.geo.cells[t.p]) <= u.attackRange) add([action, attackAction(u, t)], worth + shotValue(s, u, t, style));
          if (type === 'support') for (const t of own) {
            const range = spec.healRange ?? spec.attackRange;
            if (t.hp < t.maxHp && distance(s.geo.cells[pos], s.geo.cells[t.p]) <= range) add([action, healAction(u, t)], worth + Math.min(t.maxHp - t.hp, spec.healPower + s.config.balance.healVarianceRange / 2) * hpPrice(s, t));
          }
        }
      }
    }
  }
  if (finalBoundary(s)) {
    for (const order of candidates) order.estimate = evaluate(advanceOrder(s, order), owner, style);
  }
  candidates.sort((a, b) => b.estimate - a.estimate);
  const chosen = [], signatures = new Set(), quotas = new Map();
  for (const order of candidates) {
    const first = order.actions[0], p = first.payload;
    const actor = p.unitId ?? p.attackerId ?? p.supportId ?? `${p.fromId}:${p.unitType}`;
    const signature = JSON.stringify(order.actions);
    if (signatures.has(signature) || (quotas.get(actor) ?? 0) >= Math.max(2, Math.ceil(limit / 4))) continue;
    signatures.add(signature); quotas.set(actor, (quotas.get(actor) ?? 0) + 1);
    chosen.push(order);
    if (chosen.length >= limit) break;
  }
  return chosen;
}

function advanceOrder(s, order, roll = 'mean') {
  const next = copy(s);
  for (const action of order.actions) {
    if (next.terminal) break;
    applySearchAction(next, action, roll);
  }
  return next;
}

function turnPlans(start, width, style = 'balanced', roll = 'mean') {
  const owner = start.owner;
  let beam = [{ state: start, first: null, value: evaluate(start, owner, style) }];
  const endings = [];
  const depth = Math.min(18, start.config.balance.actionsPerTurn - start.ap + start.units.filter(u => u.owner === owner && u.actionSpent && (!u.hasMoved || !u.hasActed)).length + 2);
  for (let d = 0; d < depth && beam.length; d++) {
    const expanded = [];
    for (const node of beam) {
      endings.push(node);
      if (node.state.terminal) continue;
      for (const order of orders(node.state, style, width === 1 ? 5 : 12)) {
        const next = advanceOrder(node.state, order, roll);
        const value = evaluate(next, owner, style);
        if (value <= node.value + 1e-8) continue;
        expanded.push({ state: next, first: node.first ?? order.actions[0], value });
      }
    }
    expanded.sort((a, b) => b.value - a.value);
    const seen = new Set(), roots = new Map();
    beam = expanded.filter(node => {
      const first = JSON.stringify(node.first);
      const signature = `${first}:${node.state.units.map(u => `${u.id},${u.p},${u.hp},${+u.hasMoved}${+u.hasActed}`).join(';')}`;
      if (seen.has(signature) || (roots.get(first) ?? 0) >= Math.max(1, Math.floor(width / 2))) return false;
      seen.add(signature); roots.set(first, (roots.get(first) ?? 0) + 1); return true;
    }).slice(0, width);
  }
  endings.push(...beam);
  endings.sort((a, b) => b.value - a.value);
  const result = [], firsts = new Set();
  for (const node of endings) {
    const first = JSON.stringify(node.first);
    if (firsts.has(first)) continue;
    firsts.add(first);
    const state = copy(node.state); finishSearchTurn(state);
    result.push({ ...node, state });
    if (result.length >= width) break;
  }
  return result;
}

function decide(view, utils, context = {}) {
  const owner = context.owner ?? view.turn.currentPlayerId ?? view.turn.currentOwner;
  if (view.phase !== 'active' || view.config.mode !== 'standard' || owner !== (view.turn.currentPlayerId ?? view.turn.currentOwner) || view.players[owner]?.status !== 'active') return null;
  const start = createSearchState(view);
  const plans = [...turnPlans(start, 6), ...turnPlans(start, 1, 'siege')];
  let chosen = plans[0], best = -Infinity;
  for (const plan of plans) {
    if (plan.state.terminal && plan.state.winner === owner) return plan.first;
    let worst = Infinity;
    for (const style of ['balanced', 'siege']) {
      let response = plan.state;
      for (let i = 0; i < start.active.length - 1 && !response.terminal && response.owner !== owner; i++) response = turnPlans(response, 1, style, 'high')[0].state;
      let value = evaluate(response, owner);
      if (!response.terminal && response.owner === owner) {
        const reply = turnPlans(response, 1)[0].state;
        value = 0.6 * value + 0.4 * evaluate(reply, owner);
      }
      worst = Math.min(worst, value);
    }
    const value = worst + plan.value * 0.04;
    if (value > best) { best = value; chosen = plan; }
  }
  if (chosen?.first || chosen?.state.terminal) return chosen.first;
  const safe = [];
  for (const u of start.units) {
    if (u.owner !== owner || u.hasActed || !u.actionSpent && start.ap >= start.config.balance.actionsPerTurn) continue;
    for (const t of [...start.units, ...start.hqs]) {
      if (t.owner !== owner && distance(start.geo.cells[u.p], start.geo.cells[t.p]) <= u.attackRange) safe.push({ action: attackAction(u, t), value: shotValue(start, u, t, 'balanced') });
      if (u.type === 'support' && t.type && t.owner === owner && t.hp < t.maxHp && distance(start.geo.cells[u.p], start.geo.cells[t.p]) <= (start.config.units.support.healRange ?? u.attackRange)) safe.push({ action: healAction(u, t), value: Math.min(t.maxHp - t.hp, u.healPower ?? 0) * hpPrice(start, t) });
    }
  }
  safe.sort((a, b) => b.value - a.value);
  return safe[0]?.action ?? null;
}

export default { name: 'parallax', version: 'v1', decide };
