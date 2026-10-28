// Royale only, expected rolls; no HQ, events, score history, RNG replay or comeback supplies.
const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const key = ({ q, r }) => `${q},${r}`;
const hex = (a, b) => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.q + a.r - b.q - b.r));
const countActive = S => S.active.filter(Boolean).length;

export function createModel(game) {
  const overrides = new Map((game.map.terrainCells ?? []).map(cell => [key(cell), cell.terrain]));
  const cells = game.cells.map(({ q, r, terrain }) => ({ q, r, terrain: overrides.get(`${q},${r}`) ?? terrain }));
  const index = new Map(cells.map((cell, c) => [key(cell), c]));
  const seats = game.turn.turnOrder.filter(id => game.players[id]?.status === 'active');
  const M = {
    game, cells, index, specs: game.config.units, seats,
    A: game.config.balance.actionsPerTurn,
    attackLimit: game.config.balance.attacksPerUnit ?? 1,
    round: game.turn.roundNumber,
    neighbors: cells.map(({ q, r }) => DIRS.map(([dq, dr]) => index.get(`${q + dq},${r + dr}`)).filter(c => c !== undefined)),
    radii: cells.map(cell => hex(cell, { q: 0, r: 0 })),
    points: game.controlPoints.map(point => ({ ...point, c: index.get(key(point)) })),
    aimCache: new Map(),
  };
  M.initial = {
    units: game.units.filter(unit => unit.alive).map(unit => ({ ...unit, c: index.get(key(unit)), s: seats.indexOf(unit.owner) })),
    supplies: seats.map(id => game.resources[id]?.supplies ?? 0),
    cpOwners: M.points.map(point => seats.indexOf(point.owner)),
    terrain: cells.map(cell => cell.terrain),
    active: seats.map(() => true), kills: seats.map(() => 0),
    round: M.round, ended: game.phase === 'game_over',
  };
  return M;
}

export function cloneState(S) {
  return {
    ...S, units: S.units.map(unit => ({ ...unit })), supplies: [...S.supplies],
    cpOwners: [...S.cpOwners], terrain: [...S.terrain], active: [...S.active], kills: [...S.kills],
  };
}

export function distances(M, S, from) {
  const result = new Array(M.cells.length).fill(Infinity);
  if (!M.cells[from]) return result;
  result[from] = 0;
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i];
    for (const next of M.neighbors[c]) {
      if (result[next] !== Infinity || S.terrain[next] !== 'plain') continue;
      result[next] = result[c] + 1;
      queue.push(next);
    }
  }
  return result;
}

export function cover(M, unit, c, kind = 'attackShape') {
  const from = M.cells[unit.c], target = M.cells[c];
  if (!from || !target) return null;
  const spec = M.specs[unit.type];
  const range = kind === 'healShape' ? spec?.healRange ?? unit.attackRange : unit.attackRange;
  const shape = spec?.[kind];
  const distance = hex(from, target);
  if (distance > range) return null;
  if (!shape || !['line', 'arc'].includes(shape.type)) {
    return kind === 'attackShape' && distance === 0 ? null : [c];
  }
  const dq = target.q - from.q, dr = target.r - from.r;
  const direction = DIRS.findIndex(([q, r]) => q * distance === dq && r * distance === dr);
  if (!distance || direction < 0) return null;
  const at = (d, n = 1) => M.index.get(`${from.q + DIRS[d][0] * n},${from.r + DIRS[d][1] * n}`);
  if (shape.type === 'arc') {
    return distance === 1 ? [(direction + 5) % 6, direction, (direction + 1) % 6].map(d => at(d)).filter(c => c !== undefined) : null;
  }
  const length = Math.min(shape.length ?? 2, range);
  if (distance > length) return null;
  const result = [];
  for (let n = 1; n <= length; n++) {
    const c = at(direction, n);
    if (c !== undefined) result.push(c);
  }
  return result;
}

export function aims(M, unit, kind = 'attackShape') {
  const spec = M.specs[unit.type];
  const cacheKey = `${unit.c}:${kind}:${unit.attackRange}:${spec?.healRange}:${JSON.stringify(spec?.[kind])}`;
  if (!M.aimCache.has(cacheKey)) {
    // Keep every click: identical line coverage can lock different initial enemies.
    const result = [];
    for (let c = 0; c < M.cells.length; c++) {
      const covered = cover(M, unit, c, kind);
      if (covered) result.push({ c, cover: covered });
    }
    M.aimCache.set(cacheKey, result);
  }
  return M.aimCache.get(cacheKey);
}

export function safeRadius(M, round) {
  const config = M.game.config.annihilation?.artillery;
  if (!config || !['royale', 'annihilation'].includes(M.game.config.mode)) return Infinity;
  const shrinks = round < config.startRound ? 0 : Math.floor((round - config.startRound) / config.intervalRounds) + 1;
  return Math.max(config.minimumSafeRadius, M.game.map.radius - shrinks);
}

export function damage(M, attacker, target) {
  const { damageVarianceRange: variance = 0, minimumDamage = 1 } = M.game.config.balance;
  const width = 2 * variance + 1;
  let sum = 0;
  for (let roll = 0; roll < width; roll++) {
    sum += Math.max(minimumDamage, attacker.attack - target.defense + roll - variance) * Math.min(1, width - roll);
  }
  return sum / width;
}

function healAmount(M, support, target) {
  const width = (M.game.config.balance.healVarianceRange ?? 0) + 1;
  let sum = 0;
  for (let roll = 0; roll < width; roll++) {
    sum += Math.max(0, Math.min(target.maxHp - target.hp, (support.healPower ?? 0) + roll)) * Math.min(1, width - roll);
  }
  return sum / width;
}

function danger(M, S, c) {
  return M.radii[c] > safeRadius(M, S.round ?? M.round);
}

function pointSpec(M, point) {
  return M.game.config.balance.controlPointTypes?.[point.kind];
}

function deployCost(M, S, seat, action) {
  const spec = M.specs[action.unitType];
  const p = M.points.findIndex(point => point.id === action.fromId);
  if (!spec || p < 0 || S.cpOwners[p] !== seat || pointSpec(M, M.points[p])?.canDeploy === false) return null;
  const origin = M.points[p];
  if (!M.cells[action.c] || hex(origin, M.cells[action.c]) !== 1 || danger(M, S, origin.c) || danger(M, S, action.c)) return null;
  return spec.cost - Math.min(spec.cost, pointSpec(M, origin)?.deployDiscount ?? 0);
}

function deployUnit(M, seat, action) {
  const spec = M.specs[action.unitType], { q, r } = M.cells[action.c];
  return {
    id: null, owner: M.seats[seat], type: action.unitType, q, r, c: action.c, s: seat,
    hp: spec.hp, maxHp: spec.hp, attack: spec.attack, defense: spec.defense,
    moveRange: spec.moveRange, attackRange: spec.attackRange, cost: spec.cost,
    canCapture: spec.canCapture, healPower: spec.healPower,
    alive: true, hasMoved: true, hasActed: false, actionSpent: true,
  };
}

function occupants(S) {
  const result = new Map();
  S.units.forEach((unit, u) => { if (unit.alive && !result.has(unit.c)) result.set(unit.c, u); });
  return result;
}

function wipe(S) {
  for (let s = 0; s < S.active.length; s++) {
    if (!S.active[s] || S.units.some(unit => unit.s === s && unit.alive)) continue;
    S.active[s] = false;
    for (const unit of S.units) if (unit.s === s) { unit.alive = false; unit.hp = 0; }
    S.cpOwners = S.cpOwners.map(owner => owner === s ? -1 : owner);
  }
  if (countActive(S) <= 1) S.ended = true;
}

export function advance(M, S, actions, context = { failed: new Set(), attacks: new Map() }) {
  if (S.ended || countActive(S) <= 1) return S;
  const { failed, attacks } = context;
  const kept = [];
  let hasAction = false;
  actions.forEach((action, s) => {
    if (!action || !S.active[s]) return;
    hasAction = true;
    if (action.u !== undefined) {
      const unit = S.units[action.u];
      if (!unit?.alive) { failed.add(action.u); return; }
      if (failed.has(action.u)) return;
    }
    kept.push({ ...action, s });
  });
  // An entirely absent step is not a wait and does not trigger the engine's wipe check.
  if (!hasAction) return S;
  const occupied = occupants(S);
  const arrivals = kept.filter(action => action.type === 'move' || action.type === 'deploy');
  const counts = new Map(), movers = new Map(), blocked = new Set();
  for (const action of arrivals) {
    counts.set(action.c, (counts.get(action.c) ?? 0) + 1);
    if (action.type === 'move') movers.set(action.u, action);
  }
  for (const action of arrivals) {
    if (counts.get(action.c) > 1 || S.terrain[action.c] !== 'plain'
      || (occupied.has(action.c) && !movers.has(occupied.get(action.c)))) blocked.add(action);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const action of arrivals) {
      if (!blocked.has(action) && blocked.has(movers.get(occupied.get(action.c)))) {
        blocked.add(action); changed = true;
      }
    }
  }
  for (const action of arrivals) {
    if (action.type !== 'deploy' || blocked.has(action)) continue;
    const cost = deployCost(M, S, action.s, action);
    if (cost === null || S.supplies[action.s] < cost) continue;
    S.supplies[action.s] -= cost;
    S.units.push(deployUnit(M, action.s, action));
  }
  for (const action of arrivals) {
    if (action.type !== 'move') continue;
    const unit = S.units[action.u];
    if (blocked.has(action) || unit.s !== action.s) { failed.add(action.u); continue; }
    unit.c = action.c;
    unit.q = M.cells[action.c].q; unit.r = M.cells[action.c].r;
    unit.hasMoved = true;
  }
  const finalOccupants = occupants(S);
  for (const action of kept) {
    if (action.type !== 'demolish') continue;
    const unit = S.units[action.u];
    if (unit.s !== action.s || unit.type !== 'heavy' || S.terrain[action.c] !== 'blocker'
      || hex(M.cells[unit.c], M.cells[action.c]) > 1 || finalOccupants.has(action.c)) {
      failed.add(action.u); continue;
    }
    S.terrain[action.c] = 'plain'; unit.hasActed = true;
  }
  const strikes = [];
  for (const action of kept) {
    if (action.type !== 'attack') continue;
    const unit = S.units[action.u], used = attacks.get(action.u) ?? 0;
    if (unit.s !== action.s || used >= M.attackLimit) { failed.add(action.u); continue; }
    attacks.set(action.u, used + 1);
    const covered = cover(M, unit, action.c);
    if (!covered) { failed.add(action.u); continue; }
    unit.hasActed = true;
    const locked = M.specs[unit.type]?.attackLock
      ? M.initial.units.findIndex(target => target.s !== action.s && target.c === action.c) : -1;
    strikes.push({ action, unit, covered, locked: S.units[locked]?.alive ? locked : -1 });
  }
  for (const action of kept) {
    if (action.type !== 'heal') continue;
    const support = S.units[action.u];
    if (support.s !== action.s || support.type !== 'support') continue;
    const covered = cover(M, support, action.c, 'healShape');
    if (!covered || danger(M, S, support.c) || covered.some(c => danger(M, S, c))) continue;
    support.hasActed = true;
    for (const c of covered) {
      const target = S.units.find(unit => unit.alive && unit.s === action.s && unit.c === c);
      if (target && target.hp < target.maxHp) target.hp += healAmount(M, support, target);
    }
  }
  const deaths = new Set();
  for (const { action, unit, covered, locked } of strikes) {
    const targets = locked >= 0
      ? (hex(M.cells[unit.c], M.cells[S.units[locked].c]) <= unit.attackRange ? [locked] : [])
      : covered.map(c => finalOccupants.get(c)).filter(u => u !== undefined && S.units[u].s !== action.s);
    for (const u of targets) {
      const target = S.units[u];
      target.hp = Math.max(0, target.hp - damage(M, unit, target));
      if (target.hp === 0 && !deaths.has(u)) { deaths.add(u); S.kills[action.s] += target.cost; }
    }
  }
  for (const u of deaths) S.units[u].alive = false;
  wipe(S);
  return S;
}

export function finishRound(M, S) {
  if (S.ended || countActive(S) <= 1) return S;
  for (let s = 0; s < S.active.length; s++) {
    if (!S.active[s]) continue;
    M.points.forEach((point, p) => {
      if (S.units.some(unit => unit.alive && unit.s === s && unit.canCapture && unit.c === point.c)) S.cpOwners[p] = s;
    });
  }
  const round = S.round ?? M.round;
  const limit = M.game.config.balance.maxTurns;
  if (limit != null && round >= limit) { S.ended = true; return S; }
  S.round = round + 1;
  if (safeRadius(M, S.round) !== Infinity) {
    for (const unit of S.units) {
      if (!unit.alive || !danger(M, S, unit.c)) continue;
      unit.hp = Math.max(0, unit.hp - M.game.config.annihilation.artillery.damage);
      if (unit.hp === 0) unit.alive = false;
    }
    wipe(S);
    if (S.ended) return S;
  }
  for (const unit of S.units) {
    if (unit.alive && S.active[unit.s]) { unit.hasMoved = false; unit.hasActed = false; unit.actionSpent = false; }
  }
  const balance = M.game.config.balance;
  for (let s = 0; s < S.active.length; s++) {
    if (!S.active[s]) continue;
    S.supplies[s] += balance.baseIncome;
    const repaired = new Set();
    M.points.forEach((point, p) => {
      if (S.cpOwners[p] !== s) return;
      const spec = pointSpec(M, point);
      S.supplies[s] += spec?.income ?? balance.controlPointIncome ?? 0;
      if (!spec?.repairAmount || danger(M, S, point.c)) return;
      for (let u = 0; u < S.units.length; u++) {
        const unit = S.units[u];
        if (!unit.alive || unit.s !== s || unit.hp >= unit.maxHp || repaired.has(u)
          || danger(M, S, unit.c) || hex(point, M.cells[unit.c]) > 1) continue;
        const amount = Math.min(spec.repairAmount, unit.maxHp - unit.hp);
        if (amount > 0) { unit.hp += amount; repaired.add(u); }
      }
    });
  }
  return S;
}

export const __internals = { hex, deployCost, healAmount };
