const DIRECTIONS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const key = p => `${p.q},${p.r}`;
const distance = (a, b) => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.q + a.r - b.q - b.r));
const radius = p => Math.max(Math.abs(p.q), Math.abs(p.r), Math.abs(p.q + p.r));
const neighbors = p => DIRECTIONS.map(([q, r]) => ({ q: p.q + q, r: p.r + r }));
const action = (type, payload) => ({ type, payload });

function shapeCells(from, spec, kind, aim, range) {
  const shape = spec?.[kind]?.type ?? 'single';
  const d = distance(from, aim);
  if (d > range) return [];
  if (shape === 'single') return kind === 'attackShape' && d === 0 ? [] : [aim];
  const direction = DIRECTIONS.findIndex(([q, r]) => from.q + q * d === aim.q && from.r + r * d === aim.r);
  if (direction < 0 || d === 0) return [];
  if (shape === 'arc') {
    if (d !== 1) return [];
    return [-1, 0, 1].map(offset => {
      const [q, r] = DIRECTIONS[(direction + offset + 6) % 6];
      return { q: from.q + q, r: from.r + r };
    });
  }
  const length = Math.min(range, spec[kind].length ?? 2);
  if (d > length) return [];
  const [q, r] = DIRECTIONS[direction];
  return Array.from({ length }, (_, i) => ({ q: from.q + q * (i + 1), r: from.r + r * (i + 1) }));
}

function futureRadius(game, rounds) {
  const live = game.artillery;
  if (!live) return game.map.radius;
  const artillery = game.config.annihilation.artillery;
  const next = live.nextShrinkRound;
  if (next === null || game.turn.roundNumber + rounds < next) return live.safeRadius;
  const shrinks = 1 + Math.floor((game.turn.roundNumber + rounds - next) / artillery.intervalRounds);
  return Math.max(artillery.minimumSafeRadius, live.safeRadius - shrinks);
}

function damageStats(attacker, target, balance) {
  const variance = balance.damageVarianceRange;
  const floor = Math.min(target.hp, balance.minimumDamage);
  const base = attacker.attack - target.defense;
  if (variance > Number.MAX_SAFE_INTEGER / 2) {
    const lower = Math.max(0, Math.min(1, 0.5 + (floor - base) / variance / 2));
    const upper = Math.max(lower, Math.min(1, 0.5 + (target.hp - base) / variance / 2));
    return { damage: floor * lower + target.hp * (1 - upper) + (floor + target.hp) / 2 * (upper - lower),
      kills: floor >= target.hp ? 1 : 1 - upper };
  }
  const span = variance * 2 + 1;
  const count = Math.floor(span);
  const remainder = span - count;
  const start = base - variance;
  const first = Math.max(0, Math.min(count, Math.ceil(floor - start)));
  const last = Math.max(first, Math.min(count, Math.ceil(target.hp - start)));
  const middle = last > first ? start + first + (last - first - 1) / 2 : 0;
  const final = Math.min(target.hp, Math.max(floor, start + count));
  const damage = floor * (first / span) + middle * ((last - first) / span)
    + target.hp * ((count - last) / span) + final * (remainder / span);
  const kills = floor >= target.hp ? 1 : (count - last + (start + count >= target.hp ? remainder : 0)) / span;
  return { damage, kills };
}

function assignment(costs) {
  const n = costs.length;
  const m = costs[0]?.length ?? 0;
  const u = Array(n + 1).fill(0);
  const v = Array(m + 1).fill(0);
  const p = Array(m + 1).fill(0);
  const way = Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const min = Array(m + 1).fill(Infinity);
    const used = Array(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = costs[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < min[j]) { min[j] = cur; way[j] = j0; }
        if (min[j] < delta) { delta = min[j]; j1 = j; }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; }
        else min[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }
  const result = Array(n).fill(-1);
  for (let j = 1; j <= m; j++) if (p[j]) result[p[j] - 1] = j - 1;
  return result;
}

function context(game, owner, queue) {
  const balance = game.config.balance;
  const board = new Map(game.cells.map(cell => [key(cell), { ...cell }]));
  for (const cell of game.map.terrainCells) {
    if (board.has(key(cell))) board.get(key(cell)).terrain = cell.terrain;
  }
  const units = game.units.filter(u => u.alive).map(u => ({ ...u, attacks: 0, moves: 0, planned: false }));
  const friends = units.filter(u => u.owner === owner);
  const enemies = units.filter(u => u.owner !== owner);
  const byId = new Map(units.map(u => [u.id, u]));
  const originals = new Map(units.map(u => [u.id, { q: u.q, r: u.r }]));
  const danger = new Set((game.artillery?.dangerCells ?? []).map(key));
  const specs = Object.values(game.config.units);
  const average = field => specs.reduce((sum, spec) => sum + spec[field], 0) / specs.length;
  const scale = { hp: average('hp'), attack: Math.max(1, average('attack')), range: Math.max(1, average('attackRange')), cost: Math.max(1, average('cost')) };
  const value = unit => Math.max(1, 0.35 * unit.cost + scale.cost * (
    0.4 * unit.maxHp / scale.hp + 0.35 * unit.attack / scale.attack + 0.25 * unit.attackRange / scale.range
    + 0.3 * (unit.healPower ?? 0) / scale.attack));
  let supplies = game.resources[owner]?.supplies ?? 0;
  const discount = id => {
    const point = game.controlPoints.find(p => p.id === id && p.owner === owner);
    return balance.controlPointTypes?.[point?.kind]?.deployDiscount ?? 0;
  };
  const coverage = (unit, kind, aim) => shapeCells(unit, game.config.units[unit.type], kind, aim,
    kind === 'healShape' ? game.config.units[unit.type].healRange ?? unit.attackRange : unit.attackRange);
  const hitTargets = (unit, aim) => {
    if (game.config.units[unit.type].attackLock) {
      const locked = enemies.find(e => key(originals.get(e.id)) === key(aim));
      if (locked && locked.hp > 0) return [locked];
    }
    const cells = new Set(coverage(unit, 'attackShape', aim).map(key));
    return enemies.filter(e => cells.has(key(e)) && e.hp > 0);
  };
  for (const entry of queue) {
    const unit = byId.get(entry.unitId ?? entry.attackerId ?? entry.supportId);
    if (entry.type === 'move' && unit) {
      unit.q = entry.q; unit.r = entry.r; unit.moves++;
    } else if (entry.type === 'demolish' && board.has(key(entry))) {
      board.get(key(entry)).terrain = 'plain';
    } else if (entry.type === 'deploy') {
      const spec = game.config.units[entry.unitType];
      supplies -= Math.max(0, spec.cost - discount(entry.fromId));
      friends.push({ ...spec, maxHp: spec.hp, type: entry.unitType, q: entry.q, r: entry.r, owner, planned: true });
    } else if (entry.type === 'attack' && unit) {
      unit.attacks++;
      for (const enemy of hitTargets(unit, entry)) {
        const amount = damageStats(unit, enemy, balance).damage;
        // Reserve expected damage, but keep the cell occupied until real resolution.
        enemy.hp = Math.max(0, enemy.hp - amount);
      }
    } else if (entry.type === 'heal' && unit) {
      const cells = coverage(unit, 'healShape', entry);
      if (!danger.has(key(unit)) && !cells.some(p => board.has(key(p)) && danger.has(key(p)))) {
        const covered = new Set(cells.map(key));
        for (const friend of friends) if (covered.has(key(friend))) {
          friend.hp = Math.min(friend.maxHp, friend.hp + (unit.healPower ?? 0) + (balance.healVarianceRange ?? 0) / 2);
        }
      }
    }
  }
  const occupied = new Set([...friends, ...enemies].map(key));
  const plain = [...board.values()].filter(cell => cell.terrain === 'plain');
  const distanceCache = new Map();
  function paths(from) {
    const id = key(from);
    if (distanceCache.has(id)) return distanceCache.get(id);
    const result = new Map([[id, 0]]);
    const pending = [from];
    for (let i = 0; i < pending.length; i++) {
      const cell = pending[i];
      for (const next of neighbors(cell)) {
        const k = key(next);
        if (result.has(k) || board.get(k)?.terrain !== 'plain') continue;
        result.set(k, result.get(key(cell)) + 1);
        pending.push(next);
      }
    }
    distanceCache.set(id, result);
    return result;
  }
  const c = { game, owner, balance, board, plain, friends, enemies, originals, danger, supplies,
    occupied, paths, value, coverage, hitTargets, discount, remaining: balance.actionsPerTurn - queue.length, step: queue.length };
  c.shelters = shelters(c);
  return c;
}

function incoming(c, unit, position) {
  const teams = new Map();
  for (const enemy of c.enemies) {
    const d = distance(enemy, position);
    const spec = c.game.config.units[enemy.type];
    const direct = shapeCells(enemy, spec, 'attackShape', position, enemy.attackRange).length > 0;
    const reachable = d <= enemy.attackRange + enemy.moveRange;
    if (!direct && !reachable) continue;
    const power = Math.max(c.balance.minimumDamage, enemy.attack - unit.defense);
    const alive = Math.min(1, enemy.hp / Math.max(1, power));
    const threat = power * alive * (direct ? (spec.attackLock ? 0.95 : 0.72) : 0.2);
    const team = teams.get(enemy.owner) ?? [];
    team.push(threat);
    teams.set(enemy.owner, team);
  }
  let total = 0;
  for (const team of teams.values()) total += team.sort((a, b) => b - a)
    .slice(0, c.balance.actionsPerTurn).reduce((a, b) => a + b, 0);
  return total;
}

function stormCost(c, unit, pos) {
  if (!c.game.artillery) return 0;
  const damage = c.game.config.annihilation.artillery.damage;
  const next = radius(pos) > futureRadius(c.game, 1) || c.danger.has(key(pos));
  const later = radius(pos) > futureRadius(c.game, 3);
  return c.value(unit) * ((next ? 2 * Math.min(unit.hp, damage) / unit.maxHp + (unit.hp <= damage ? 3 : 0) : 0)
    + (later ? 0.12 : 0));
}

function shelters(c) {
  const mobile = c.friends.filter(u => !u.planned);
  if (!mobile.length || !c.plain.length) return new Map();
  const minRadius = c.game.config.annihilation?.artillery.minimumSafeRadius ?? 0;
  const targets = c.plain.filter(p => !c.enemies.some(e => key(e) === key(p)) && !c.friends.some(u => u.planned && key(u) === key(p)));
  // Private dummy berths keep the assignment feasible when the usable board is full.
  const columns = [...targets, ...mobile.map(() => null)];
  const costs = mobile.map((unit, i) => columns.map((pos, j) => {
    if (pos === null) return j - targets.length === i ? 40 : 1e6;
    const travel = c.paths(unit).get(key(pos));
    if (travel === undefined) return 1e5;
    const exposure = Math.max(0, radius(pos) - minRadius);
    const risk = incoming(c, unit, pos) / Math.max(1, unit.hp);
    const firing = c.enemies.some(e => c.coverage({ ...unit, q: pos.q, r: pos.r }, 'attackShape', e).length);
    return 0.65 * travel / Math.max(1, unit.moveRange) + 1.1 * exposure + Math.min(4, risk) * 0.65
      - (firing ? 0.6 : 0) + stormCost(c, unit, pos) / c.value(unit) * 2;
  }));
  const match = assignment(costs);
  return new Map(mobile.map((u, i) => [u.id, columns[match[i]] ?? u]));
}

function positionValue(c, unit, pos) {
  const value = c.value(unit);
  const target = c.shelters.get(unit.id);
  const route = target ? c.paths(target).get(key(pos)) : undefined;
  const travel = route ?? (target ? c.board.size : radius(pos));
  const threat = incoming(c, unit, pos);
  const danger = value * (Math.min(unit.hp, threat) / unit.maxHp * 0.75
    + Math.max(0, threat - unit.hp * 0.65) / unit.maxHp * 0.75);
  const living = c.enemies.filter(e => e.hp > 0);
  const closeness = living.length ? Math.min(...living.map(e => distance(pos, e))) : 0;
  const fire = c.enemies.reduce((best, e) => {
    if (e.hp <= 0 || !c.coverage({ ...unit, q: pos.q, r: pos.r }, 'attackShape', e).length) return best;
    return Math.max(best, c.value(e) * damageStats(unit, e, c.balance).damage / e.maxHp);
  }, 0);
  let capture = 0;
  if (unit.canCapture) {
    for (const point of c.game.controlPoints) {
      if (key(point) !== key(pos) || point.owner === c.owner || c.danger.has(key(point))) continue;
      const spec = c.balance.controlPointTypes?.[point.kind];
      const window = Math.min(4, roundsSafe(c, point));
      capture += (spec?.income ?? c.balance.controlPointIncome ?? 0) * window * 0.3;
      if (spec?.canDeploy !== false && window > 0) capture += c.value(unit) * 0.18;
    }
  }
  return -value * 0.11 * travel / Math.max(1, unit.moveRange) - stormCost(c, unit, pos) - danger
    + fire * 0.32 - value * 0.012 * Math.min(12, closeness) + capture;
}

function roundsSafe(c, pos) {
  const live = c.game.artillery;
  if (!live || radius(pos) <= c.game.config.annihilation.artillery.minimumSafeRadius || live.nextShrinkRound === null) {
    return live && radius(pos) > live.safeRadius ? 0 : Infinity;
  }
  if (radius(pos) > live.safeRadius) return 0;
  return live.nextShrinkRound - c.game.turn.roundNumber
    + (live.safeRadius - radius(pos)) * c.game.config.annihilation.artillery.intervalRounds;
}

function aimOptions(c, unit, kind) {
  const spec = c.game.config.units[unit.type];
  const range = kind === 'healShape' ? spec.healRange ?? unit.attackRange : unit.attackRange;
  const shape = spec[kind]?.type ?? 'single';
  if (shape === 'arc') return neighbors(unit).filter(p => c.board.has(key(p)) && range >= 1);
  if (shape === 'line') {
    return DIRECTIONS.flatMap(([q, r]) => {
      for (let d = 1; d <= Math.min(range, spec[kind].length ?? 2); d++) {
        const aim = { q: unit.q + q * d, r: unit.r + r * d };
        if (c.board.has(key(aim))) return [aim];
      }
      return [];
    });
  }
  const list = kind === 'healShape' ? c.friends.map(u => u.id === unit.id ? unit : u) : c.enemies;
  return list.filter(u => (kind === 'healShape' || u.hp > 0) && distance(unit, u) <= range
    && (kind === 'healShape' || distance(unit, u) > 0)).map(u => ({ q: u.q, r: u.r }));
}

function attackValue(c, unit, aim, delay = 0) {
  let score = 0;
  const lock = c.game.config.units[unit.type].attackLock;
  for (const enemy of c.hitTargets(unit, aim)) {
    const stats = damageStats(unit, enemy, c.balance);
    const escaping = radius(enemy) > futureRadius(c.game, 1);
    const alternatives = [...c.paths(enemy)].filter(([k, d]) => d > 0 && d <= enemy.moveRange && !c.occupied.has(k)).length;
    const reliability = lock ? (alternatives ? 0.92 : 1)
      : alternatives ? Math.max(0.3, (escaping ? 0.5 : 0.84) - 0.025 * (c.step + delay)) : 1;
    const value = c.value(enemy);
    const last = c.enemies.filter(e => e.owner === enemy.owner && e.hp > 0).length === 1;
    score += reliability * value * (stats.damage / enemy.maxHp + stats.kills * (last ? 1.6 : 0.75));
  }
  return score;
}

function healingValue(c, unit, aim) {
  const cells = c.coverage(unit, 'healShape', aim);
  if (c.danger.has(key(unit)) || cells.some(p => c.board.has(key(p)) && c.danger.has(key(p)))) return 0;
  const keys = new Set(cells.map(key));
  let value = 0;
  for (const original of c.friends) {
    const friend = original.id === unit.id ? unit : original;
    if (!keys.has(key(friend))) continue;
    const amount = Math.min(friend.maxHp - friend.hp, (unit.healPower ?? 0) + (c.balance.healVarianceRange ?? 0) / 2);
    value += c.value(friend) * amount / friend.maxHp * (incoming(c, friend, friend) > friend.hp * 0.5 ? 2 : 1.15);
  }
  return value;
}

function demolishValue(c, unit, pos) {
  if (c.board.get(key(pos))?.terrain !== 'blocker') return 0;
  const beyond = neighbors(pos).filter(p => c.board.get(key(p))?.terrain === 'plain');
  let gain = 0;
  for (const friend of c.friends) {
    if (friend.planned || distance(friend, pos) > friend.moveRange + 2) continue;
    const current = c.paths(friend);
    const approach = Math.min(...beyond.map(p => current.get(key(p)) ?? 1e4));
    for (const exit of beyond) {
      if (radius(exit) >= radius(friend)) continue;
      const saved = (current.get(key(exit)) ?? 1e4) - approach - 2;
      gain = Math.max(gain, Math.min(6, saved) / Math.max(1, friend.moveRange) * c.value(friend) * 0.08);
    }
  }
  if (radius(pos) <= futureRadius(c.game, 3)) {
    const safeSlots = c.plain.filter(p => radius(p) <= futureRadius(c.game, 3)).length;
    if (c.friends.length + c.enemies.length > safeSlots) gain += c.value(unit) * 0.2;
  }
  return gain;
}

function choose(c) {
  let best = null;
  let bestScore = 0.001;
  const offer = (actions, value) => {
    if (actions.length > c.remaining) return;
    const score = value / Math.pow(actions.length, 0.85);
    if (score > bestScore) { bestScore = score; best = actions[0]; }
  };
  const limit = c.balance.attacksPerUnit ?? 1;
  for (const unit of c.friends) {
    if (unit.planned) continue;
    const startValue = positionValue(c, unit, unit);
    const moveOptions = [...c.paths(unit)].filter(([k, d]) => d > 0 && d <= unit.moveRange && !c.occupied.has(k))
      .map(([k]) => c.board.get(k))
      .map(pos => ({ pos, gain: positionValue(c, unit, pos) - startValue - c.value(unit) * 0.015 }))
      .sort((a, b) => b.gain - a.gain);
    const attackOptions = unit.attacks < limit ? aimOptions(c, unit, 'attackShape')
      .map(aim => ({ aim, gain: attackValue(c, unit, aim) })).sort((a, b) => b.gain - a.gain) : [];
    for (const { aim, gain } of attackOptions) {
      const shot = action('attack', { attackerId: unit.id, q: aim.q, r: aim.r });
      offer([shot], gain);
      if (moveOptions[0]?.gain > 0) {
        const move = moveOptions[0];
        offer([shot, action('move', { unitId: unit.id, q: move.pos.q, r: move.pos.r })], gain + move.gain);
      }
    }
    if (unit.type === 'support') {
      for (const aim of aimOptions(c, unit, 'healShape')) {
        offer([action('heal', { supportId: unit.id, q: aim.q, r: aim.r })], healingValue(c, unit, aim));
      }
    }
    if (unit.type === 'heavy') {
      for (const pos of neighbors(unit)) {
        offer([action('demolish', { unitId: unit.id, q: pos.q, r: pos.r })], demolishValue(c, unit, pos));
      }
    }
    for (const { pos, gain } of moveOptions) {
      const move = action('move', { unitId: unit.id, q: pos.q, r: pos.r });
      offer([move], gain);
      if (c.remaining < 2) continue;
      const projected = { ...unit, q: pos.q, r: pos.r };
      if (unit.attacks < limit) {
        for (const aim of aimOptions(c, projected, 'attackShape')) {
          offer([move, action('attack', { attackerId: unit.id, q: aim.q, r: aim.r })],
            gain + attackValue(c, projected, aim, 1) * 0.9);
        }
      }
      if (unit.type === 'support') {
        for (const aim of aimOptions(c, projected, 'healShape')) {
          offer([move, action('heal', { supportId: unit.id, q: aim.q, r: aim.r })], gain + healingValue(c, projected, aim));
        }
      }
      if (unit.type === 'heavy') {
        for (const wall of neighbors(pos)) {
          offer([move, action('demolish', { unitId: unit.id, q: wall.q, r: wall.r })], gain + demolishValue(c, projected, wall));
        }
      }
    }
  }
  const armySize = c.friends.length;
  const burden = c.friends.reduce((sum, unit) => sum + Math.max(0, radius(unit) - futureRadius(c.game, 3)) / Math.max(1, unit.moveRange), 0);
  for (const point of c.game.controlPoints) {
    if (point.owner !== c.owner || c.danger.has(key(point))) continue;
    if (c.balance.controlPointTypes?.[point.kind]?.canDeploy === false) continue;
    for (const pos of neighbors(point)) {
      if (c.board.get(key(pos))?.terrain !== 'plain' || c.occupied.has(key(pos)) || c.danger.has(key(pos))) continue;
      for (const [type, spec] of Object.entries(c.game.config.units)) {
        const cost = Math.max(0, spec.cost - c.discount(point.id));
        if (cost > c.supplies) continue;
        const unit = { ...spec, type, maxHp: spec.hp, q: pos.q, r: pos.r };
        const value = c.value(unit);
        const mobility = Math.min(1, spec.moveRange / Math.max(1, radius(pos) - futureRadius(c.game, 3)));
        const supportCount = c.friends.filter(u => u.type === 'support').length;
        const utility = type === 'support' ? Math.min(1.2, armySize / 3) / (1 + supportCount * 2) : 1;
        const capacity = 1 / (1 + Math.pow(armySize / Math.max(2, c.balance.actionsPerTurn * 0.8), 3));
        const efficiency = Math.sqrt(value / Math.max(1, cost));
        const reach = Math.sqrt(spec.moveRange) * (1 + 0.35 * Math.max(0, spec.attackRange - 1));
        const risk = incoming(c, unit, pos) / spec.hp;
        const readiness = value * reach * utility * mobility / (1 + 0.08 * radius(pos));
        const gain = armySize === 0 ? readiness * 100 - value * risk
          : readiness * 0.55 * efficiency * capacity - value * risk * 0.65
            - stormCost(c, unit, pos) - burden * value * 0.035;
        offer([action('deploy', { unitType: type, fromId: point.id, q: pos.q, r: pos.r })], gain);
      }
    }
  }
  return best;
}

function decide(game, _utils, ctx = {}) {
  const owner = ctx.owner;
  if (game.config?.mode !== 'royale' || game.phase !== 'active' || !owner
    || game.players[owner]?.status !== 'active' || !game.plan || game.plan.committed.includes(owner)) return null;
  const queue = game.plan.myQueue ?? game.plan.queues?.[owner] ?? [];
  if (queue.length >= game.config.balance.actionsPerTurn) return null;
  return choose(context(game, owner, queue));
}

export default { name: 'ark', decide };
