import {
  createModel, cloneState, distances, cover, aims, safeRadius, damage, advance, finishRound,
} from '../lib/royale-model.mjs';

const clock = () => performance.now();
const hexDistance = (a, b) => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.q + a.r - b.q - b.r));
const signature = a => JSON.stringify([a.type, a.u, a.c, a.unitType, a.fromId]);
const cache = new Map();
const MAX_CACHE = 32;

function options() {
  const number = (name, fallback, min, max) => {
    const raw = Number(process.env[name]);
    return Number.isFinite(raw) && raw >= min ? Math.min(max, raw) : fallback;
  };
  return {
    timeMs: number('APEX_TIME_MS', 750, 10, 5000),
    beam: Math.floor(number('APEX_BEAM', 4, 1, 12)),
    nodes: Math.floor(number('APEX_NODES', 1600, 20, 20000)),
  };
}

function recentConflicts(game) {
  return (game.events ?? []).filter(e => e.type === 'action_failed' && e.payload?.type === 'move'
    && e.payload.reason === 'destination_conflict' && e.payload.roundNumber >= game.turn.roundNumber - 2
    && e.payload.roundNumber < game.turn.roundNumber);
}

function prepare(game) {
  const M = createModel(game);
  const conflicts = new Map();
  for (const { payload: p } of recentConflicts(game)) {
    const u = M.initial.units.findIndex(u => u.id === p.unitId);
    const c = M.index.get(`${p.detail?.q},${p.detail?.r}`);
    if (u < 0 || c === undefined || M.initial.units[u].q !== p.detail?.fromQ || M.initial.units[u].r !== p.detail?.fromR) continue;
    const key = `${u}:${c}:${p.step}`;
    const entry = conflicts.get(key) ?? { u, c, step: p.step, rounds: new Set() };
    entry.rounds.add(p.roundNumber);
    conflicts.set(key, entry);
  }
  M.repeatedArrivals = [...conflicts.values()].filter(e => e.rounds.size === 2).sort((a, b) => a.step - b.step);
  M.radius = M.cells.map(c => hexDistance(c, { q: 0, r: 0 }));
  M.pathCache = new Map();
  M.escapeCache = new Map();
  M.power = new Map();
  M.positionCache = new Map();
  const types = Object.keys(M.specs);
  const avgHp = types.reduce((n, t) => n + M.specs[t].hp, 0) / Math.max(1, types.length);
  const avgHit = types.reduce((n, t) => n + (M.specs[t].attack ?? 0), 0) / Math.max(1, types.length);
  M.scale = Math.max(1, avgHp);
  for (const type of types) {
    const u = M.specs[type];
    const hit = types.reduce((n, t) => n + damage(M, u, M.specs[t]), 0) / Math.max(1, types.length);
    const shape = u.attackShape?.type;
    const reach = 1 + 0.48 * Math.max(0, u.attackRange - 1) + (u.attackLock ? 0.3 : 0);
    const area = shape === 'arc' ? 1.2 : shape === 'line' ? 1.12 : 1;
    const durability = Math.sqrt(u.hp / M.scale) * (1 + (u.defense ?? 0) / Math.max(1, avgHit) * 0.35);
    const offense = 0.25 + 1.1 * hit / Math.max(1, avgHit) * reach * area;
    M.power.set(type, durability * offense * (0.45 + 0.3 * Math.sqrt(u.moveRange)));
  }
  M.averageCost = types.reduce((n, t) => n + M.specs[t].cost, 0) / Math.max(1, types.length);
  return M;
}

function terrainKey(S) {
  return S.terrain.map(t => t === 'plain' ? 'p' : t === 'water' ? 'w' : 'b').join('');
}

function path(M, S, from) {
  const key = `${terrainKey(S)}:${from}`;
  let row = M.pathCache.get(key);
  if (!row) {
    row = distances(M, S, from);
    M.pathCache.set(key, row);
  }
  return row;
}

function inwardField(M, S, radius, breach) {
  const key = `${terrainKey(S)}:${radius}:${breach}`;
  let row = M.escapeCache.get(key);
  if (row) return row;
  row = new Float64Array(M.cells.length).fill(Infinity);
  const queue = [];
  for (let c = 0; c < row.length; c++) {
    if (S.terrain[c] === 'plain' && M.radius[c] <= radius) { row[c] = 0; queue.push(c); }
  }
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i];
    for (const n of M.neighbors[c]) {
      const cost = S.terrain[n] === 'plain' ? 1 : breach && S.terrain[n] === 'blocker' ? 4 : Infinity;
      if (row[n] <= row[c] + cost) continue;
      row[n] = row[c] + cost;
      queue.push(n);
    }
  }
  M.escapeCache.set(key, row);
  return row;
}

function canBreach(S, seat) {
  return S.units.some(u => u.alive && u.s === seat && u.type === 'heavy');
}

function evacuation(M, S, unit, c = unit.c) {
  const breach = canBreach(S, unit.s);
  const fields = Array.from({ length: 6 }, (_, h) => inwardField(M, S, safeRadius(M, M.round + h + 1), breach));
  let loss = 0;
  for (let h = 0; h < fields.length; h++) {
    const d = fields[h][c];
    if (d === 0) continue;
    const moves = unit.moveRange > 0 ? d / unit.moveRange : Infinity;
    const late = Math.max(0, moves - h * 0.75);
    const exposure = Math.min(2, late / (h + 1));
    loss = Math.max(loss, exposure);
  }
  const shell = M.game.config.annihilation?.artillery?.damage ?? 0;
  return loss * Math.min(1.5, shell / Math.max(1, unit.hp) + 0.35);
}

function strength(M, S, u) {
  let value = M.power.get(u.type) ?? 1;
  if (u.type === 'support' && u.healPower > 0) {
    const allies = S.units.filter(v => v.alive && v.s === u.s && v.type !== 'support');
    const supports = S.units.filter(v => v.alive && v.s === u.s && v.type === 'support').length;
    value += (0.8 + Math.min(1.5, allies.length / Math.max(1, supports) * 0.4)) * u.healPower / M.scale * 2;
  }
  return value * (0.25 + 0.75 * Math.max(0, u.hp) / u.maxHp);
}

function threatAt(M, S, u, c) {
  let threat = 0;
  for (const v of S.units) {
    if (!v.alive || v.s === u.s || v.attackRange <= 0) continue;
    const d = hexDistance(M.cells[c], M.cells[v.c]);
    if (d > v.attackRange + v.moveRange) continue;
    const direct = cover(M, v, c, 'attackShape');
    const p = direct ? 0.65 : d <= v.attackRange ? 0.23 : 0.12;
    threat += damage(M, v, u) * p;
  }
  return threat;
}

function positionValue(M, S, u, c, style = 'balanced') {
  const breach = canBreach(S, u.s);
  const key = `${terrainKey(S)}|${u.s}|${u.type}|${u.hp}|${c}|${style}|${breach}`;
  // Positions are scored against the public round-start army, not an opponent's hidden plan.
  let value = M.positionCache.get(key);
  if (value !== undefined) return value;
  const reference = M.initial;
  const power = M.power.get(u.type) ?? 1;
  const risk = threatAt(M, reference, u, c) / Math.max(1, u.hp);
  value = -power * (style === 'hunter' ? 0.3 : 0.65) * Math.min(2, risk)
    - power * (style === 'hunter' ? 0.9 : 1.5) * evacuation(M, S, u, c);
  const row = path(M, S, c);
  let contact = Infinity;
  let fire = 0;
  const moved = { ...u, c };
  for (const enemy of reference.units) {
    if (!enemy.alive || enemy.s === u.s) continue;
    contact = Math.min(contact, row[enemy.c]);
    if (cover(M, moved, enemy.c, 'attackShape')) {
      const hit = damage(M, u, enemy);
      fire = Math.max(fire, hit / Math.max(1, enemy.hp) * (M.power.get(enemy.type) ?? 1));
    }
  }
  value += Math.min(1.1, fire) * (style === 'hunter' ? 0.6 : 0.32);
  if (Number.isFinite(contact)) {
    value -= power * 0.035 * Math.min(12, Math.max(0, contact - u.attackRange) / Math.max(1, u.moveRange));
  }
  if (u.type === 'support') {
    let nearest = Infinity;
    for (const ally of reference.units) {
      if (!ally.alive || ally.s !== u.s || ally.type === 'support') continue;
      nearest = Math.min(nearest, row[ally.c]);
    }
    value -= 0.035 * Math.min(10, nearest);
  }
  const finalRadius = M.game.config.annihilation?.artillery?.minimumSafeRadius;
  if (finalRadius !== undefined) {
    const inner = inwardField(M, S, finalRadius, breach)[c];
    value -= power * 0.09 * Math.min(40, inner / Math.max(1, u.moveRange));
  }
  M.positionCache.set(key, value);
  return value;
}

function deployOrigins(M, S, seat) {
  return M.game.controlPoints.flatMap((p, i) => {
    const spec = M.game.config.balance.controlPointTypes?.[p.kind];
    const c = M.index.get(`${p.q},${p.r}`);
    return S.cpOwners[i] === seat && spec?.canDeploy !== false && c !== undefined
      && M.radius[c] <= safeRadius(M, M.round)
      ? [{ id: p.id, c, discount: spec?.deployDiscount ?? 0 }] : [];
  });
}

function newUnit(M, seat, type, c) {
  const spec = M.specs[type];
  return { ...spec, maxHp: spec.hp, type, id: null, alive: true, c, s: seat, owner: M.seats[seat] };
}

function project(M, seat, plan) {
  const S = cloneState(M.initial);
  const attacks = new Map();
  for (const a of plan) {
    const u = S.units[a.u];
    if (a.type === 'move' && u) u.c = a.c;
    if (a.type === 'demolish') S.terrain[a.c] = 'plain';
    if (a.type === 'attack') attacks.set(a.u, (attacks.get(a.u) ?? 0) + 1);
    if (a.type === 'deploy') {
      const origin = deployOrigins(M, M.initial, seat).find(o => o.id === a.fromId);
      S.supplies[seat] -= Math.max(0, M.specs[a.unitType].cost - (origin?.discount ?? 0));
      S.units.push(newUnit(M, seat, a.unitType, a.c));
    }
  }
  return { S, attacks };
}

function attackValue(M, S, u, a) {
  const cells = cover(M, u, a.c, 'attackShape');
  if (!cells) return 0;
  const locked = M.specs[u.type].attackLock
    ? M.initial.units.find(v => v.alive && v.s !== u.s && v.c === a.c) : null;
  const tracked = locked && S.units.find(v => v.id === locked.id && v.alive);
  const targets = tracked
    ? (hexDistance(M.cells[tracked.c], M.cells[u.c]) <= u.attackRange ? [tracked] : [])
    : S.units.filter(v => v.alive && v.s !== u.s && cells.includes(v.c));
  return targets.reduce((sum, v) => {
    const hit = damage(M, u, v);
    const lethal = hit >= v.hp ? 0.55 : 0;
    return sum + strength(M, S, { ...v, hp: v.maxHp }) * (Math.min(v.hp, hit) / v.maxHp + lethal);
  }, 0);
}

function candidateActions(M, seat, plan, forecasts = [], style = 'balanced') {
  const { S, attacks } = project(M, seat, plan);
  const occupied = new Set(S.units.filter(u => u.alive).map(u => u.c));
  const results = [];
  const add = (a, prior) => results.push({ a, prior });
  const future = forecasts.length ? forecasts : [S];
  for (let i = 0; i < M.initial.units.length; i++) {
    const u = S.units[i];
    if (!u.alive || u.s !== seat) continue;
    if ((attacks.get(i) ?? 0) < M.attackLimit && u.attackRange > 0) {
      const scored = aims(M, u, 'attackShape').map(aim => {
        const a = { type: 'attack', u: i, c: aim.c };
        const values = future.map(st => attackValue(M, st, u, a));
        return { a, prior: values.reduce((n, v) => n + v, 0) / values.length + 0.15 * attackValue(M, S, u, a) };
      }).filter(x => x.prior > 0);
      scored.sort((a, b) => b.prior - a.prior);
      results.push(...scored.slice(0, 3));
    }
    if (u.type === 'support' && u.healPower > 0 && M.radius[u.c] <= safeRadius(M, M.round)) {
      const scored = [];
      for (const aim of aims(M, u, 'healShape')) {
        if (aim.cover.some(c => M.radius[c] > safeRadius(M, M.round))) continue;
        let gain = 0;
        for (const st of future) {
          for (const v of st.units) {
            const own = S.units.find(w => w.id === v.id && w.id !== null);
            if (!v.alive || v.s !== seat || !aim.cover.includes(own?.c ?? v.c)) continue;
            gain += Math.min(v.maxHp - v.hp, u.healPower + (M.game.config.balance.healVarianceRange ?? 0) / 2)
              / v.maxHp * (M.power.get(v.type) ?? 1) / future.length;
          }
        }
        if (gain > 0) scored.push({ a: { type: 'heal', u: i, c: aim.c }, prior: gain });
      }
      scored.sort((a, b) => b.prior - a.prior);
      results.push(...scored.slice(0, 2));
    }
    if (style !== 'hold' && u.moveRange > 0) {
      const row = path(M, S, u.c);
      const base = positionValue(M, S, u, u.c, style);
      const scored = [];
      for (let c = 0; c < M.cells.length; c++) {
        if (c === u.c || occupied.has(c) || row[c] > u.moveRange) continue;
        let gain = positionValue(M, S, u, c, style) - base;
        if (u.canCapture) {
          const cp = M.game.controlPoints.findIndex(p => p.q === M.cells[c].q && p.r === M.cells[c].r);
          if (cp >= 0 && S.cpOwners[cp] !== seat && M.radius[c] <= safeRadius(M, M.round + 1)) gain += 0.35;
        }
        scored.push({ a: { type: 'move', u: i, c }, prior: gain + 0.015 });
      }
      scored.sort((a, b) => b.prior - a.prior);
      results.push(...scored.slice(0, 3));
    }
    if (u.type === 'heavy' && style !== 'hold') {
      for (const c of M.neighbors[u.c]) {
        if (c < 0 || S.terrain[c] !== 'blocker' || occupied.has(c)) continue;
        const changed = { ...S, terrain: S.terrain.slice() };
        changed.terrain[c] = 'plain';
        const gain = positionValue(M, changed, u, u.c, style) - positionValue(M, S, u, u.c, style);
        if (gain > 0.015) add({ type: 'demolish', u: i, c }, gain);
      }
    }
  }
  const mine = S.units.filter(u => u.alive && u.s === seat);
  for (const origin of deployOrigins(M, M.initial, seat)) {
    for (const type of Object.keys(M.specs)) {
      const cost = Math.max(0, M.specs[type].cost - origin.discount);
      if (cost > S.supplies[seat]) continue;
      for (const c of M.neighbors[origin.c]) {
        if (c < 0 || occupied.has(c) || S.terrain[c] !== 'plain' || M.radius[c] > safeRadius(M, M.round)) continue;
        const unit = newUnit(M, seat, type, c);
        const withUnit = { ...S, units: S.units.concat(unit) };
        const sizePenalty = Math.max(0.32, 1 - Math.max(0, mine.length - M.A * 0.8) * 0.13);
        const gain = strength(M, withUnit, unit) * sizePenalty + positionValue(M, S, unit, c, style)
          - 0.6 * cost / Math.max(1, M.averageCost);
        add({ type: 'deploy', unitType: type, fromId: origin.id, c }, mine.length ? gain : gain + 10);
      }
    }
  }
  results.sort((a, b) => b.prior - a.prior);
  const chosen = [];
  const perActor = new Map();
  for (const x of results) {
    const actor = x.a.type === 'deploy' ? `deploy:${x.a.unitType}` : `${x.a.type}:${x.a.u}`;
    const n = perActor.get(actor) ?? 0;
    if (n >= 2) continue;
    chosen.push(x);
    perActor.set(actor, n + 1);
    if (chosen.length >= 22) break;
  }
  chosen.push({ a: { type: 'wait' }, prior: -0.001 });
  return chosen;
}

function evaluate(M, original, seat) {
  const S = cloneState(original);
  finishRound(M, S);
  const survivors = S.active.reduce((n, a) => n + Number(a), 0);
  if (survivors === 0) return -20;
  if (!S.active[seat]) return -1000;
  if (survivors === 1) return 1000;
  const values = M.seats.map(() => 0);
  const live = S.units.filter(u => u.alive).map(u => {
    const force = strength(M, S, u);
    const danger = threatAt(M, S, u, u.c) / Math.max(1, u.hp);
    const risk = (M.power.get(u.type) ?? 1) * 0.18 * Math.min(1.5, danger);
    const position = positionValue(M, S, u, u.c) * 0.6 - risk;
    return { u, force, position };
  }).sort((a, b) => b.force - a.force);
  const counts = M.seats.map((_, s) => live.filter(({ u }) => u.s === s).length);
  const capacity = Math.max(1, Math.min(M.A, M.cells.filter((_, c) => S.terrain[c] === 'plain'
    && M.radius[c] <= safeRadius(M, M.round + 4)).length));
  const used = M.seats.map(() => 0);
  for (const { u, force, position } of live) {
    const congestion = 0.35 ** Math.max(0, used[u.s]++ - capacity * 0.65);
    const raw = force * congestion + position * Math.sqrt(congestion);
    const scale = force * congestion * 0.25;
    values[u.s] += Math.max(0, raw) + scale * Math.log1p(Math.exp(-Math.abs(raw) / scale));
  }
  for (let s = 0; s < M.seats.length; s++) {
    if (!S.active[s]) continue;
    const origins = deployOrigins(M, S, s);
    const usable = origins.filter(o => M.radius[o.c] <= safeRadius(M, M.round + 2));
    const budget = Math.min(S.supplies[s], Math.max(0, M.A * 1.5 - counts[s]) * M.averageCost);
    values[s] += (usable.length ? 0.48 : origins.length ? 0.15 : 0) * budget / Math.max(1, M.averageCost);
    values[s] += Math.min(2, usable.length) * 0.18;
    values[s] += S.kills[s] / Math.max(1, M.averageCost) * 0.08;
  }
  const enemies = values.filter((_, s) => s !== seat && S.active[s]);
  const strongest = Math.max(...enemies);
  const mean = enemies.reduce((a, b) => a + b, 0) / enemies.length;
  return values[seat] - (0.65 * strongest + 0.35 * mean);
}

function enemyPlan(M, seat, style) {
  const plan = [];
  const forecast = cloneState(M.initial);
  for (let step = 0; step < M.A; step++) {
    const candidates = candidateActions(M, seat, plan, [forecast], style);
    const best = candidates[0];
    if (!best || best.prior <= 0) break;
    const a = best.a;
    plan.push(a);
    if (a.type === 'attack') {
      const u = forecast.units[a.u];
      const cells = cover(M, u, a.c, 'attackShape') ?? [];
      for (const v of forecast.units) {
        if (v.alive && v.s !== seat && cells.includes(v.c)) {
          v.hp = Math.max(0, v.hp - damage(M, u, v));
          if (v.hp === 0) v.alive = false;
        }
      }
    } else if (a.type === 'move') forecast.units[a.u].c = a.c;
    else if (a.type === 'heal') {
      const u = forecast.units[a.u];
      const cells = cover(M, u, a.c, 'healShape') ?? [];
      for (const v of forecast.units) if (v.alive && v.s === seat && cells.includes(v.c)) v.hp = Math.min(v.maxHp, v.hp + u.healPower);
    }
  }
  return plan;
}

function scenarios(M, seat) {
  return ['balanced', 'hunter', 'hold'].map((style, index) => ({
    weight: [0.5, 0.3, 0.2][index],
    plans: M.seats.map((_, s) => s === seat ? [] : enemyPlan(M, s, style)),
  }));
}

function collisionBackoff(M, action, step) {
  if (action.type !== 'move') return false;
  const claims = M.repeatedArrivals.filter(a => a.c === action.c && a.step === step + 1);
  // 连续互撞时轮换暂缓者，只改这一拍；待命与其他走位仍由搜索权衡。
  return claims.length > 1 && claims.some(a => a.u === action.u)
    && claims[M.round % claims.length].u !== action.u;
}

function stateFor(M) {
  return { S: cloneState(M.initial), context: { failed: new Set(), attacks: new Map() } };
}

function stepState(M, state, actions) {
  const next = {
    S: cloneState(state.S),
    context: { failed: new Set(state.context.failed), attacks: new Map(state.context.attacks) },
  };
  advance(M, next.S, actions, next.context);
  return next;
}

function nodeScore(M, seat, states, scenes) {
  const scores = states.map(st => evaluate(M, st.S, seat));
  const mean = scores.reduce((sum, x, i) => sum + x * scenes[i].weight, 0);
  return mean * 0.8 + Math.min(...scores) * 0.2;
}

function search(M, seat, prefix, scenes, opts, deadline, banned) {
  let states = scenes.map(() => stateFor(M));
  for (let k = 0; k < prefix.length; k++) {
    states = states.map((st, j) => stepState(M, st, M.seats.map((_, s) => s === seat ? prefix[k] : scenes[j].plans[s][k])));
  }
  let beam = [{ plan: prefix.slice(), states, score: nodeScore(M, seat, states, scenes) }];
  let nodes = 0;
  for (let k = prefix.length; k < M.A; k++) {
    const expanded = [];
    const seen = new Set();
    for (const node of beam) {
      const candidates = candidateActions(M, seat, node.plan, node.states.map(st => st.S));
      for (const { a } of candidates) {
        if ((k === prefix.length && banned.has(signature(a))) || collisionBackoff(M, a, k)) continue;
        const sig = node.plan.map(signature).concat(signature(a)).join('|');
        if (seen.has(sig)) continue;
        seen.add(sig);
        const next = node.states.map((st, j) => stepState(M, st, M.seats.map((_, s) => s === seat ? a : scenes[j].plans[s][k])));
        expanded.push({ plan: node.plan.concat(a), states: next, score: nodeScore(M, seat, next, scenes) - 0.0001 * (a.type !== 'wait') });
        nodes++;
        if (nodes >= opts.nodes || clock() > deadline) break;
      }
      if (nodes >= opts.nodes || clock() > deadline) break;
    }
    if (!expanded.length) break;
    expanded.sort((a, b) => b.score - a.score);
    beam = expanded.slice(0, opts.beam);
    if (nodes >= opts.nodes || clock() > deadline) break;
  }
  let best = beam[0];
  // Finish a usable plan even when a large board consumes the search budget.
  while (best.plan.length < M.A) {
    const k = best.plan.length;
    const candidates = candidateActions(M, seat, best.plan, best.states.map(st => st.S)).slice(0, 6);
    candidates.push({ a: { type: 'wait' } });
    let choice = null;
    for (const { a } of candidates) {
      if ((k === prefix.length && banned.has(signature(a))) || collisionBackoff(M, a, k)) continue;
      const next = best.states.map((st, j) => stepState(M, st, M.seats.map((_, s) => s === seat ? a : scenes[j].plans[s][k])));
      const score = nodeScore(M, seat, next, scenes);
      if (!choice || score > choice.score) choice = { plan: best.plan.concat(a), states: next, score };
    }
    if (!choice) break;
    best = choice;
  }
  return { best, finalists: beam, nodes };
}

function completeScore(M, seat, plan, scene) {
  let state = stateFor(M);
  for (let k = 0; k < M.A; k++) {
    state = stepState(M, state, M.seats.map((_, s) => s === seat ? plan[k] : scene.plans[s][k]));
  }
  return evaluate(M, state.S, seat);
}

function planRound(M, seat, prefix, banned = new Set()) {
  const opts = options();
  const start = clock();
  const scenes = scenarios(M, seat);
  const result = search(M, seat, prefix, scenes, opts, start + opts.timeMs * 0.78, banned);
  let best = result.best;
  if (clock() < start + opts.timeMs && M.seats.length === 2) {
    const enemy = 1 - seat;
    const responseScene = { weight: 1, plans: M.seats.map((_, s) => s === seat ? best.plan : []) };
    const reply = search(M, enemy, [], [responseScene], { ...opts, beam: 1, nodes: 150 }, start + opts.timeMs * 0.9, new Set()).best.plan;
    const probe = { weight: 1, plans: M.seats.map((_, s) => s === enemy ? reply : []) };
    let robust = -Infinity;
    for (const finalist of [best, ...result.finalists.filter(n => n.plan.length === best.plan.length)]) {
      const score = finalist.score * 0.7 + completeScore(M, seat, finalist.plan, probe) * 0.3;
      if (score > robust) { robust = score; best = finalist; }
    }
  }
  const plan = best.plan.slice();
  while (plan.length > prefix.length && plan.at(-1).type === 'wait') plan.pop();
  return plan;
}

function parseQueue(M, queue) {
  return queue.map(a => {
    if (a.type === 'wait') return { type: 'wait' };
    const c = M.index.get(`${a.q},${a.r}`);
    if (a.type === 'deploy') return { type: a.type, unitType: a.unitType, fromId: a.fromId, c };
    const id = a.unitId ?? a.attackerId ?? a.supportId;
    return { type: a.type, u: M.initial.units.findIndex(u => u.id === id), c };
  });
}

function toAction(M, a) {
  if (a.type === 'wait') return { type: 'wait', payload: {} };
  const { q, r } = M.cells[a.c];
  if (a.type === 'deploy') return { type: a.type, payload: { unitType: a.unitType, fromId: a.fromId, q, r } };
  const field = a.type === 'attack' ? 'attackerId' : a.type === 'heal' ? 'supportId' : 'unitId';
  return { type: a.type, payload: { [field]: M.initial.units[a.u].id, q, r } };
}

function publicFingerprint(game) {
  return JSON.stringify([game.config, game.cells, game.map?.terrainCells, game.map?.radius, game.units,
    game.resources, game.controlPoints, game.turn?.turnOrder, Object.entries(game.players ?? {}).map(([id, p]) => [id, p?.status]), game.artillery, recentConflicts(game)]);
}

export default {
  name: 'apex',
  description: '绝境算法：缩圈时空寻路、兵力配比、多情境同步束搜索与对抗校验',
  async decide(game, _utils, ctx) {
    const owner = ctx?.owner;
    if (!owner || game?.phase !== 'active' || game.config?.mode !== 'royale' || !game.plan
      || game.players?.[owner]?.status !== 'active' || game.plan.committed?.includes(owner)) return null;
    const queue = game.plan.myQueue ?? [];
    if (queue.length >= game.config.balance.actionsPerTurn) return null;
    const key = `${game.id}|${owner}|${game.turn.roundNumber}`;
    const fingerprint = publicFingerprint(game);
    let entry = cache.get(key);
    if (!entry || entry.fingerprint !== fingerprint) {
      entry = { M: prepare(game), fingerprint, banned: new Set(), lastPrefix: null, last: null, plan: null };
      if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
      cache.set(key, entry);
    }
    const { M } = entry;
    const seat = M.seats.indexOf(owner);
    const prefix = parseQueue(M, queue);
    const prefixKey = JSON.stringify(prefix.map(signature));
    if (entry.lastPrefix === prefixKey && entry.last) {
      entry.banned.add(signature(entry.last));
      entry.plan = null;
    } else if (entry.lastPrefix !== prefixKey) {
      entry.banned.clear();
    }
    if (!entry.plan || prefix.some((a, i) => signature(a) !== signature(entry.plan[i] ?? {})) || prefix.length > entry.plan.length) {
      entry.plan = planRound(M, seat, prefix, entry.banned);
    }
    const next = entry.plan[prefix.length];
    entry.lastPrefix = prefixKey;
    entry.last = next ?? null;
    return next ? toAction(M, next) : null;
  },
};

export const __internals = { prepare, project, evacuation, evaluate, candidateActions, planRound, parseQueue, toAction, cache };
