const DIRECTIONS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const key = p => `${p.q},${p.r}`;
const distance = (a, b) => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.q + a.r - b.q - b.r));
const action = (type, payload) => ({ type, payload });

export function damageDistribution(attack, defense, variance, minimumDamage = 1) {
  const spread = Math.max(0, Math.floor(variance));
  const outcomes = new Map();
  for (let delta = -spread; delta <= spread; delta++) {
    const amount = Math.max(minimumDamage, attack + delta - defense);
    outcomes.set(amount, (outcomes.get(amount) ?? 0) + 1 / (2 * spread + 1));
  }
  return [...outcomes];
}

function convolve(hp, distribution, shot) {
  const next = new Map();
  for (const [before, probability] of distribution) {
    for (const [damage, chance] of shot) {
      const after = Math.min(hp, before + damage);
      next.set(after, (next.get(after) ?? 0) + probability * chance);
    }
  }
  return [...next];
}

function boardFor(game) {
  const cells = new Map(game.cells.map(cell => [key(cell), { ...cell }]));
  for (const cell of game.map.terrainCells) {
    if (cells.has(key(cell))) cells.get(key(cell)).terrain = cell.terrain;
  }
  const positions = [...cells.values()];
  const ids = new Map(positions.map((p, i) => [key(p), i]));
  const neighbors = positions.map(p => DIRECTIONS.map(([q, r]) => ids.get(`${p.q + q},${p.r + r}`)).filter(i => i !== undefined));
  return { positions, ids, neighbors, plain: positions.map(p => p.terrain === 'plain') };
}

function reachable(world, unit, occupied = world.occupied) {
  const start = world.board.ids.get(key(unit));
  const steps = new Map([[start, 0]]);
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head];
    if (steps.get(at) >= unit.moveRange) continue;
    for (const next of world.board.neighbors[at]) {
      if (steps.has(next) || !world.board.plain[next] || occupied.has(next)) continue;
      steps.set(next, steps.get(at) + 1);
      queue.push(next);
    }
  }
  return queue;
}

function distances(world, targets, walls = false) {
  const result = new Float64Array(world.board.positions.length).fill(Infinity);
  const pending = [];
  for (const index of targets) {
    result[index] = 0;
    pending.push(index);
  }
  while (pending.length) {
    let best = 0;
    for (let i = 1; i < pending.length; i++) if (result[pending[i]] < result[pending[best]]) best = i;
    const at = pending.splice(best, 1)[0];
    for (const next of world.board.neighbors[at]) {
      const terrain = world.board.positions[next].terrain;
      if (!world.board.plain[next] && !(walls && terrain === 'blocker')) continue;
      const cost = result[at] + (terrain === 'blocker' ? 3 : 1);
      if (cost < result[next]) {
        result[next] = cost;
        pending.push(next);
      }
    }
  }
  return result;
}

function safeRadius(world, round) {
  const artillery = world.game.config.annihilation.artillery;
  const count = round < artillery.startRound ? 0 : 1 + Math.floor((round - artillery.startRound) / artillery.intervalRounds);
  return Math.max(artillery.minimumSafeRadius, world.game.map.radius - count);
}

function unitWorth(unit) {
  return unit.cost * (0.45 + 0.55 * unit.hp / unit.maxHp);
}

function shot(world, attacker, target) {
  return damageDistribution(attacker.attack, target.defense, world.variance, world.game.config.balance.minimumDamage);
}

function mean(distribution) {
  return distribution.reduce((total, [value, chance]) => total + value * chance, 0);
}

function casualties(world, target, distribution) {
  const damage = mean(distribution);
  const kill = distribution.reduce((p, [d, chance]) => p + (d >= target.hp ? chance : 0), 0);
  const army = target.cost * damage / target.maxHp;
  const remaining = world.units.filter(u => u.owner === target.owner).length + (world.units.some(u => u.id === target.id) ? 0 : 1);
  return army * world.armyWeight + kill * (target.cost * (world.killWeight + 0.85) + (remaining === 1 ? 90 + unitWorth(target) * 4 : 0));
}

function incoming(world, unit, index, removed = null) {
  const cacheKey = `${unit.id}:${unit.type}:${unit.hp}:${index}:${removed}`;
  if (world.riskCache.has(cacheKey)) return world.riskCache.get(cacheKey);
  const position = world.board.positions[index];
  const groups = new Map();
  for (const enemy of world.enemies) {
    if (enemy.id === removed || enemy.attack <= 0) continue;
    const canShoot = world.enemyReach.get(enemy.id).some(i => distance(world.board.positions[i], position) <= enemy.attackRange);
    if (!canShoot) continue;
    const present = distance(enemy, position) <= enemy.attackRange;
    const alternatives = world.friends.filter(friend => friend.id !== unit.id && world.enemyReach.get(enemy.id).some(i => distance(world.board.positions[i], friend) <= enemy.attackRange)).length;
    const probability = (present ? 1 : 0.8) * (0.45 + 0.55 / (1 + alternatives));
    const distribution = [[0, 1 - probability], ...shot(world, enemy, unit).map(([d, p]) => [d, p * probability])];
    const pair = { distribution, value: mean(distribution) };
    if (!groups.has(enemy.owner)) groups.set(enemy.owner, []);
    groups.get(enemy.owner).push(pair);
  }
  let distribution = [[0, 1]];
  for (const group of groups.values()) {
    group.sort((a, b) => b.value - a.value);
    for (const hit of group.slice(0, world.apLimit)) distribution = convolve(unit.hp, distribution, hit.distribution);
  }
  const result = { damage: mean(distribution), value: casualties(world, unit, distribution) };
  world.riskCache.set(cacheKey, result);
  return result;
}

function escapeDamage(world, moveRange) {
  const horizon = Math.min(6, world.game.config.balance.maxTurns === null ? 6 : world.game.config.balance.maxTurns - world.round);
  let future = new Float64Array(world.board.positions.length);
  for (let offset = horizon; offset >= 1; offset--) {
    let best = future;
    if (offset < horizon) {
      for (let step = 0; step < moveRange; step++) {
        const next = best.slice();
        for (let i = 0; i < next.length; i++) {
          if (!world.board.plain[i]) continue;
          for (const j of world.board.neighbors[i]) if (world.board.plain[j]) next[i] = Math.min(next[i], best[j]);
        }
        best = next;
      }
    }
    const radius = safeRadius(world, world.round + offset);
    future = best.map((loss, i) => loss * 0.92 + (distance(world.board.positions[i], { q: 0, r: 0 }) > radius ? world.game.config.annihilation.artillery.damage : 0));
  }
  return future;
}

function artilleryLoss(world, unit, index) {
  const loss = Math.min(unit.hp, world.escape.get(unit.moveRange)[index]);
  const kill = loss >= unit.hp;
  const remaining = world.friends.length + (world.units.some(u => u.id === unit.id) ? 0 : 1);
  return loss / unit.maxHp * unit.cost * world.armyWeight + (kill ? 2.5 * unitWorth(unit) + (remaining === 1 ? 400 : 0) : 0);
}

function pointValue(world, point, arrival) {
  const balance = world.game.config.balance;
  const spec = balance.controlPointTypes?.[point.kind] ?? {};
  const income = spec.income ?? balance.controlPointIncome ?? 0;
  const origins = world.points.filter(p => (p.owner === world.owner || p.id === point.id) && balance.controlPointTypes?.[p.kind]?.canDeploy !== false);
  let spendingTurns = 0;
  for (let turn = arrival + 1; turn <= Math.min(arrival + 5, 8); turn++) {
    if (balance.maxTurns !== null && world.round + turn > balance.maxTurns) break;
    if (origins.some(p => distance(p, { q: 0, r: 0 }) <= safeRadius(world, world.round + turn))) spendingTurns++;
  }
  const pad = spec.canDeploy !== false && distance(point, { q: 0, r: 0 }) <= safeRadius(world, world.round + arrival + 1);
  return income * spendingTurns * 1.5 + (pad ? 24 : 0) + world.controlWeight;
}

function positionValue(world, unit, index) {
  let value = -artilleryLoss(world, unit, index) * 1.4 - (world.clearance.get(index) ?? 0);
  const position = world.board.positions[index];
  if (unit.type === 'heavy' && Number.isFinite(world.breachDistances[index])) value -= world.breachDistances[index] * 2;
  const enemyDistance = world.combatDistances.get(unit.attackRange)?.[index] ?? Infinity;
  if (Number.isFinite(enemyDistance)) value += (unit.attack > 0 ? 34 : 2) / (1 + enemyDistance / Math.max(1, unit.moveRange));
  const cover = world.friends.filter(friend => friend.id !== unit.id).map(friend => Math.min(1, (friend.attack + (friend.healPower ?? 0)) / 35) / (1 + Math.max(0, distance(position, friend) - friend.attackRange)));
  cover.sort((a, b) => b - a);
  value += cover.slice(0, 2).reduce((sum, x) => sum + x, 0) * 14;
  if (unit.canCapture) {
    let capture = 0;
    for (const point of world.points) {
      if (point.owner === world.owner) continue;
      const travel = world.pointDistances.get(point.id)[index];
      if (!Number.isFinite(travel)) continue;
      const turns = travel / Math.max(1, unit.moveRange);
      let competing = Infinity;
      for (const friend of world.friends) {
        if (friend.id === unit.id || !friend.canCapture) continue;
        const at = world.board.ids.get(key(friend));
        competing = Math.min(competing, world.pointDistances.get(point.id)[at] / Math.max(1, friend.moveRange));
      }
      capture = Math.max(capture, pointValue(world, point, Math.ceil(turns)) / (1 + turns) * (turns > competing + 0.1 ? 0.18 : 1));
    }
    value += capture;
  }
  const open = world.board.neighbors[index].filter(i => world.board.plain[i] && !world.occupied.has(i)).length;
  value += open * 0.25;
  if (unit.healPower > 0) {
    let healing = 0;
    for (const friend of world.friends) {
      if (friend.id === unit.id) continue;
      healing = Math.max(healing, Math.min(friend.maxHp - friend.hp, unit.healPower) * friend.cost / friend.maxHp / (1 + distance(position, friend)));
    }
    value += healing * 2;
  }
  return value;
}

function makeWorld(game, owner) {
  const board = boardFor(game);
  const units = game.units.filter(u => u.alive);
  const balance = game.config.balance;
  const weights = game.adjudication?.weights ?? balance.adjudicationWeights;
  const world = {
    game, owner, board, units, friends: units.filter(u => u.owner === owner), enemies: units.filter(u => u.owner !== owner),
    occupied: new Map(units.map(u => [board.ids.get(key(u)), u])), points: game.controlPoints,
    round: game.turn.roundNumber, apLimit: balance.actionsPerTurn, ap: balance.actionsPerTurn - game.turn.actionsUsed,
    variance: balance.damageVarianceRange, armyWeight: Math.max(0.5, weights.armyValue), killWeight: weights.killValue ?? 0,
    controlWeight: weights.controlPoint, enemyReach: new Map(), pointDistances: new Map(), combatDistances: new Map(), escape: new Map(), riskCache: new Map(),
  };
  const core = board.positions.flatMap((p, i) => board.plain[i] && distance(p, { q: 0, r: 0 }) <= game.config.annihilation.artillery.minimumSafeRadius ? [i] : []);
  world.coreDistances = distances(world, core);
  world.breachDistances = distances(world, core, true);
  world.clearance = new Map();
  for (const blocker of world.friends) {
    const index = board.ids.get(key(blocker));
    const opened = new Map(world.occupied);
    opened.delete(index);
    let benefit = 0;
    for (const friend of world.friends) {
      if (friend.id === blocker.id || friend.hasMoved || (!friend.actionSpent && world.ap <= 0)) continue;
      const before = reachable(world, friend);
      const after = reachable(world, friend, opened);
      const route = friend.type === 'heavy' ? world.breachDistances : world.coreDistances;
      const beforeDistance = Math.min(...before.map(i => route[i]));
      const afterDistance = Math.min(...after.map(i => route[i]));
      if (afterDistance < beforeDistance) benefit += Math.min(18, (beforeDistance - afterDistance) * 5);
    }
    world.clearance.set(index, benefit);
  }
  for (const enemy of world.enemies) world.enemyReach.set(enemy.id, reachable(world, enemy));
  for (const point of world.points) world.pointDistances.set(point.id, distances(world, [board.ids.get(key(point))]));
  for (const unit of [...world.friends, ...Object.values(game.config.units)]) {
    if (!world.combatDistances.has(unit.attackRange)) {
      const targets = board.positions.flatMap((p, i) => board.plain[i] && world.enemies.some(e => distance(e, p) <= unit.attackRange) ? [i] : []);
      world.combatDistances.set(unit.attackRange, distances(world, targets));
    }
    if (!world.escape.has(unit.moveRange)) world.escape.set(unit.moveRange, escapeDamage(world, unit.moveRange));
  }
  return world;
}

function activationOptions(world, unit) {
  if (!unit.actionSpent && world.ap <= 0) return [];
  const start = world.board.ids.get(key(unit));
  const places = unit.hasMoved ? [start] : reachable(world, unit);
  const beforeRisk = incoming(world, unit, start).value;
  const beforePosition = positionValue(world, unit, start);
  const options = [];
  for (const index of places) {
    const position = world.board.positions[index];
    const moving = index !== start;
    const move = action('move', { unitId: unit.id, q: position.q, r: position.r });
    const risk = incoming(world, unit, index).value;
    const improvement = positionValue(world, unit, index) - beforePosition + (beforeRisk - risk) * 0.3;
    if (moving) options.push({ score: improvement - 0.4, first: move, unit, index });
    if (unit.hasActed) continue;
    if (unit.type === 'heavy') {
      for (const wall of world.board.neighbors[index]) {
        if (world.board.positions[wall].terrain !== 'blocker' || world.occupied.has(wall)) continue;
        if (world.breachDistances[wall] >= world.breachDistances[index]) continue;
        const beyond = world.board.neighbors[wall].filter(i => world.board.plain[i]);
        const after = Math.min(...beyond.map(i => world.coreDistances[i]));
        const saving = world.coreDistances[index] - after - 2;
        if (!(saving > 0) && Number.isFinite(world.coreDistances[index])) continue;
        const p = world.board.positions[wall];
        const reward = 12 + (Number.isFinite(saving) ? Math.min(40, saving * 5) : 30);
        options.push({ score: reward + improvement, first: moving ? move : action('demolish', { unitId: unit.id, q: p.q, r: p.r }), unit, index });
      }
    }
    if (unit.attack > 0) {
      for (const enemy of world.enemies) {
        const fromHere = distance(position, enemy) <= unit.attackRange;
        const fromStart = distance(unit, enemy) <= unit.attackRange;
        if (!fromHere && !fromStart) continue;
        const distribution = convolve(enemy.hp, [[0, 1]], shot(world, unit, enemy));
        const kill = distribution.find(([d]) => d >= enemy.hp)?.[1] ?? 0;
        const attack = action('attack', { attackerId: unit.id, targetId: enemy.id });
        const protection = kill * Math.max(0, risk - incoming(world, unit, index, enemy.id).value) * 0.85;
        const reward = casualties(world, enemy, distribution);
        options.push({ score: reward + improvement + protection, first: !moving || fromStart ? attack : move, unit, index, enemy, distribution, protection });
      }
    }
    if (unit.type === 'support' && unit.healPower > 0 && !world.game.artillery.dangerCells.some(p => key(p) === key(position))) {
      for (const target of world.friends) {
        const healRange = world.game.config.units[unit.type].healRange ?? unit.attackRange;
        const targetPosition = target.id === unit.id ? position : target;
        if (target.hp >= target.maxHp || distance(position, targetPosition) > healRange) continue;
        if (world.game.artillery.dangerCells.some(p => key(p) === key(targetPosition))) continue;
        const amount = Math.min(target.maxHp - target.hp, unit.healPower + world.game.config.balance.healVarianceRange / 2);
        const at = world.board.ids.get(key(target));
        const woundedRisk = incoming(world, target, at).value;
        const healedRisk = incoming(world, { ...target, hp: target.hp + amount }, at).value;
        const reward = amount / target.maxHp * target.cost * world.armyWeight + Math.max(0, woundedRisk - healedRisk) * 0.75;
        options.push({ score: reward + improvement, first: moving ? move : action('heal', { supportId: unit.id, targetId: target.id }), unit, index });
      }
    }
  }
  return options;
}

function salvoOptions(world, options) {
  const result = [];
  for (const target of world.enemies) {
    const byUnit = new Map();
    for (const option of options) {
      if (option.enemy?.id !== target.id) continue;
      if (!byUnit.has(option.unit.id) || byUnit.get(option.unit.id).score < option.score) byUnit.set(option.unit.id, option);
    }
    const choices = [...byUnit.values()].sort((a, b) => b.score - a.score).slice(0, 8);
    for (let mask = 1; mask < (1 << choices.length); mask++) {
      const selected = choices.filter((_, i) => mask & (1 << i));
      if (selected.length < 2 || selected.length > 4) continue;
      const ap = selected.filter(o => !o.unit.actionSpent).length;
      if (ap > world.ap) continue;
      if (new Set(selected.map(o => o.index)).size !== selected.length) continue;
      let distribution = [[0, 1]];
      let positioning = 0;
      for (const option of selected) {
        distribution = convolve(target.hp, distribution, shot(world, option.unit, target));
        positioning += option.score - casualties(world, target, option.distribution) - option.protection;
      }
      const kill = distribution.find(([d]) => d >= target.hp)?.[1] ?? 0;
      if (kill < 0.65) continue;
      const reward = casualties(world, target, distribution);
      const protection = selected.reduce((sum, option) => sum + Math.max(0, incoming(world, option.unit, option.index).value - incoming(world, option.unit, option.index, target.id).value), 0) * kill * 0.6;
      const score = (reward + positioning + protection) / Math.max(1, ap + 0.2 * (selected.length - ap));
      selected.sort((a, b) => Number(b.first.type === 'attack') - Number(a.first.type === 'attack') || b.score - a.score);
      result.push({ ...selected[0], score });
    }
  }
  return result;
}

function deploymentOptions(world) {
  if (world.ap <= 0) return [];
  const result = [];
  const supplies = world.game.resources[world.owner].supplies;
  const income = world.game.config.balance.baseIncome + world.points.filter(p => p.owner === world.owner).reduce((sum, p) => sum + (world.game.config.balance.controlPointTypes?.[p.kind]?.income ?? world.game.config.balance.controlPointIncome ?? 0), 0);
  const quality = spec => spec.attack * (1 + spec.attackRange) + spec.hp * 0.12 + spec.defense + (spec.healPower ?? 0) * 2;
  const preferred = Object.values(world.game.config.units).filter(s => s.cost <= supplies + income * 2).sort((a, b) => quality(b) - quality(a))[0];
  const danger = new Set(world.game.artillery.dangerCells.map(key));
  for (const point of world.points) {
    if (point.owner !== world.owner || danger.has(key(point))) continue;
    const pointSpec = world.game.config.balance.controlPointTypes?.[point.kind];
    if (pointSpec?.canDeploy === false) continue;
    const origin = world.board.ids.get(key(point));
    for (const index of world.board.neighbors[origin]) {
      if (!world.board.plain[index] || world.occupied.has(index) || danger.has(key(world.board.positions[index]))) continue;
      const position = world.board.positions[index];
      for (const [type, spec] of Object.entries(world.game.config.units)) {
        const cost = Math.max(0, spec.cost - (pointSpec?.deployDiscount ?? 0));
        if (cost > supplies) continue;
        const unit = { ...spec, ...position, id: '@deploy', type, owner: world.owner, hp: spec.hp, maxHp: spec.hp, alive: true, hasMoved: true, hasActed: false, actionSpent: true };
        const risk = incoming(world, unit, index).value;
        const pressure = Math.max(0, world.friends.length - world.apLimit) / Math.max(1, world.apLimit);
        const efficiency = (spec.attack * (1 + spec.attackRange * 0.25) + spec.hp * 0.13 + spec.defense) / Math.max(1, cost);
        let score = spec.cost * (1.0 + 0.55 * efficiency) / (1 + pressure * 0.6) - risk * 0.45 - artilleryLoss(world, unit, index) * 1.5;
        score += positionValue(world, unit, index) * 0.3;
        const weights = world.game.adjudication?.weights ?? world.game.config.balance.adjudicationWeights;
        score -= cost * weights.supplies;
        if (world.game.config.balance.maxTurns === world.round) score += spec.cost * weights.armyValue * 0.65;
        const attacks = activationOptions(world, unit).filter(o => o.enemy || o.first.type === 'heal');
        const immediate = Math.max(0, ...attacks.map(o => o.score));
        score += immediate;
        if (world.friends.length >= world.apLimit && preferred && distance(point, { q: 0, r: 0 }) <= safeRadius(world, world.round + 2) && world.game.config.balance.maxTurns !== world.round) {
          const wait = Math.max(0, preferred.cost - supplies) / Math.max(1, income);
          score -= Math.max(0, quality(preferred) - quality(spec)) * 0.8 / (1 + wait);
        }
        if (!world.friends.length) score += 500;
        result.push({ score, first: action('deploy', { unitType: type, fromId: point.id, q: position.q, r: position.r }), unit, index });
      }
    }
  }
  return result;
}

export default {
  name: 'sovereign',
  async decide(game, _utils, ctx = {}) {
    const owner = ctx.owner ?? game.turn?.currentPlayerId;
    if (game.config?.mode !== 'annihilation' || game.phase !== 'active' || !owner || game.turn.currentPlayerId !== owner || !game.artillery) return null;
    const world = makeWorld(game, owner);
    const options = world.friends.flatMap(unit => activationOptions(world, unit));
    options.push(...salvoOptions(world, options), ...deploymentOptions(world));
    options.sort((a, b) => b.score - a.score);
    return options[0]?.score > 0.05 ? options[0].first : null;
  },
};
