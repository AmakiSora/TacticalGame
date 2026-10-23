const DIRS = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

const planCache = new Map();

function key(p) {
  return `${p.q},${p.r}`;
}

function distance(a, b) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
}

function neighbors(p) {
  return DIRS.map(d => ({ q: p.q + d.q, r: p.r + d.r }));
}

function noise(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function actionKey(action) {
  return JSON.stringify(action);
}

function external(action) {
  if (!action) return null;
  const payload = {};
  for (const field of ['unitId', 'attackerId', 'supportId', 'unitType', 'fromId', 'q', 'r']) {
    if (action[field] !== undefined) payload[field] = action[field];
  }
  return { type: action.type, payload };
}

function unitId(action) {
  return action.unitId ?? action.attackerId ?? action.supportId;
}

function activeOwners(game) {
  return Object.keys(game.players || {}).filter(id => game.players[id]?.status === 'active');
}

function makeContext(game, owner) {
  return {
    game,
    owner,
    cells: new Map((game.cells || []).map(cell => [key(cell), cell])),
    baseUnits: (game.units || []).filter(unit => unit.alive).map(unit => ({ ...unit })),
    initialWorld: makeWorld(game),
    seed: `${game.id}|${game.turn?.roundNumber ?? 0}|${owner}`,
  };
}

function makeWorld(game) {
  return {
    units: (game.units || []).filter(unit => unit.alive).map(unit => ({ ...unit })),
    headquarters: Object.fromEntries(Object.entries(game.headquarters || {}).map(([id, hq]) => [id, { ...hq }])),
    controlPoints: (game.controlPoints || []).map(point => ({ ...point })),
    resources: structuredClone(game.resources || {}),
    players: Object.fromEntries(Object.entries(game.players || {}).map(([id, player]) => [id, {
      status: player.status,
      stats: { ...(player.stats || {}) },
    }])),
    terrain: new Map((game.map?.terrainCells || []).map(cell => [key(cell), cell.terrain])),
    failedUnits: new Set(),
    attackCounts: new Map(),
    actionableUnits: new Set((game.units || []).filter(unit => unit.alive).map(unit => unit.id)),
    ownFailures: 0,
    ownMisses: 0,
    nextUnitId: 1,
  };
}

function cloneWorld(world) {
  return {
    units: world.units.map(unit => ({ ...unit })),
    headquarters: Object.fromEntries(Object.entries(world.headquarters).map(([id, hq]) => [id, { ...hq }])),
    controlPoints: world.controlPoints.map(point => ({ ...point })),
    resources: Object.fromEntries(Object.entries(world.resources).map(([id, value]) => [id, { ...value }])),
    players: Object.fromEntries(Object.entries(world.players).map(([id, player]) => [id, {
      status: player.status,
      stats: { ...player.stats },
    }])),
    terrain: new Map(world.terrain),
    failedUnits: new Set(world.failedUnits),
    attackCounts: new Map(world.attackCounts),
    actionableUnits: new Set(world.actionableUnits),
    ownFailures: world.ownFailures,
    ownMisses: world.ownMisses,
    nextUnitId: world.nextUnitId,
  };
}

function terrainAt(ctx, world, p) {
  return world.terrain.get(key(p)) ?? ctx.cells.get(key(p))?.terrain ?? 'blocker';
}

function dangerAt(ctx, p) {
  return Boolean(ctx.game.artillery?.dangerCells?.some(cell => cell.q === p.q && cell.r === p.r));
}

function warningAt(ctx, p) {
  return Boolean(ctx.game.artillery?.warningCells?.some(cell => cell.q === p.q && cell.r === p.r));
}

function unitAt(world, p) {
  return world.units.find(unit => unit.alive && unit.q === p.q && unit.r === p.r);
}

function occupantAt(world, p) {
  const unit = unitAt(world, p);
  if (unit) return { kind: 'unit', entity: unit };
  const hq = Object.values(world.headquarters).find(item => item.alive && item.q === p.q && item.r === p.r);
  return hq ? { kind: 'headquarters', entity: hq } : null;
}

function shapeFor(spec, kind) {
  const shape = spec?.[kind];
  if (shape?.type === 'line') return { type: 'line', length: shape.length ?? 2 };
  if (shape?.type === 'arc') return { type: 'arc', length: 3 };
  return { type: 'single', length: 1 };
}

function coveredCells(ctx, from, unit, kind, target) {
  const spec = ctx.game.config.units[unit.type];
  const shape = shapeFor(spec, kind);
  const range = kind === 'healShape'
    ? spec?.healRange ?? unit.attackRange
    : unit.attackRange;
  const dq = target.q - from.q;
  const dr = target.r - from.r;
  const dist = distance(from, target);
  if (dist > range) return null;
  if (shape.type === 'single') {
    if (kind === 'attackShape' && dist === 0) return null;
    return { type: 'single', direction: 0, cells: [{ q: target.q, r: target.r }] };
  }
  if (shape.type === 'arc') {
    const direction = DIRS.findIndex(d => d.q === dq && d.r === dr);
    if (direction < 0) return null;
    return {
      type: 'arc',
      direction,
      cells: [(direction + 5) % 6, direction, (direction + 1) % 6].map(index => ({
        q: from.q + DIRS[index].q,
        r: from.r + DIRS[index].r,
      })),
    };
  }
  const length = Math.min(shape.length, range);
  for (let direction = 0; direction < 6; direction++) {
    const d = DIRS[direction];
    const steps = d.q !== 0 ? dq / d.q : dr / d.r;
    if (!Number.isInteger(steps) || steps < 1 || steps > length) continue;
    if (d.q * steps !== dq || d.r * steps !== dr) continue;
    return {
      type: 'line',
      direction,
      cells: Array.from({ length }, (_, index) => ({
        q: from.q + d.q * (index + 1),
        r: from.r + d.r * (index + 1),
      })),
    };
  }
  return null;
}

function reachable(ctx, world, from, range, terrain = world.terrain) {
  const seen = new Set([key(from)]);
  const result = [];
  const queue = [{ p: { q: from.q, r: from.r }, d: 0 }];
  const terrainWorld = { ...world, terrain };
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    if (current.d >= range) continue;
    for (const next of neighbors(current.p)) {
      const k = key(next);
      if (seen.has(k) || !ctx.cells.has(k)) continue;
      seen.add(k);
      if (terrainAt(ctx, terrainWorld, next) !== 'plain') continue;
      result.push(next);
      queue.push({ p: next, d: current.d + 1 });
    }
  }
  return result;
}

function expectedDamage(ctx, attacker, target) {
  return Math.max(ctx.game.config.balance.minimumDamage ?? 1, attacker.attack - target.defense);
}

function targetValue(target) {
  if (target.kind === 'headquarters') return 3.2;
  return 0.8 + (target.entity.cost ?? 50) / 90;
}

function targetsFor(world, owner) {
  const enemies = Object.keys(world.players).filter(id => id !== owner && world.players[id]?.status === 'active');
  return [
    ...world.units.filter(unit => unit.alive && enemies.includes(unit.owner)).map(entity => ({ kind: 'unit', entity })),
    ...enemies.map(id => world.headquarters[id]).filter(hq => hq?.alive).map(entity => ({ kind: 'headquarters', entity })),
  ];
}

function bestShotFrom(ctx, world, owner, unit, from) {
  let best = 0;
  for (const target of targetsFor(world, owner)) {
    const aim = coveredCells(ctx, from, unit, 'attackShape', target.entity);
    if (!aim) continue;
    let value = 0;
    if (ctx.game.config.units[unit.type]?.attackLock && target.kind === 'unit') {
      value = expectedDamage(ctx, unit, target.entity) * targetValue(target);
    } else {
      for (const cell of aim.cells) {
        const occupant = occupantAt(world, cell);
        if (occupant && occupant.entity.owner !== owner) {
          value += expectedDamage(ctx, unit, occupant.entity) * targetValue(occupant);
        }
      }
    }
    best = Math.max(best, value);
  }
  return best;
}

function projectedQueue(ctx, queue) {
  const positions = new Map(ctx.baseUnits.filter(unit => unit.owner === ctx.owner).map(unit => [unit.id, { q: unit.q, r: unit.r }]));
  const attacks = new Map();
  const terrain = new Map(ctx.initialWorld.terrain);
  let deploySpent = 0;
  for (const action of queue) {
    const id = unitId(action);
    if (action.type === 'move' && id) positions.set(id, { q: action.q, r: action.r });
    if (action.type === 'attack' && action.attackerId) {
      attacks.set(action.attackerId, (attacks.get(action.attackerId) ?? 0) + 1);
    }
    if (action.type === 'demolish') terrain.set(key(action), 'plain');
    if (action.type === 'deploy') {
      const spec = ctx.game.config.units[action.unitType];
      const origin = [...Object.values(ctx.initialWorld.headquarters), ...ctx.initialWorld.controlPoints]
        .find(item => item.id === action.fromId);
      const discount = ctx.game.config.balance.controlPointTypes?.[origin?.kind]?.deployDiscount ?? 0;
      deploySpent += Math.max(0, (spec?.cost ?? 0) - discount);
    }
  }
  return { positions, attacks, terrain, deploySpent };
}

function addProjection(node, action) {
  const positions = new Map(node.positions);
  const attacks = new Map(node.attacks);
  const terrain = new Map(node.terrain);
  let deploySpent = node.deploySpent;
  const id = unitId(action);
  if (action.type === 'move' && id) positions.set(id, { q: action.q, r: action.r });
  if (action.type === 'attack' && action.attackerId) attacks.set(action.attackerId, (attacks.get(action.attackerId) ?? 0) + 1);
  if (action.type === 'demolish') terrain.set(key(action), 'plain');
  if (action.type === 'deploy') deploySpent += action._cost ?? 0;
  return { positions, attacks, terrain, deploySpent };
}

function deployOrigins(ctx, world, owner) {
  const origins = [];
  if (ctx.game.config.balance.deployFromHq !== false && world.headquarters[owner]?.alive) {
    origins.push(world.headquarters[owner]);
  }
  for (const point of world.controlPoints) {
    if (point.owner !== owner) continue;
    if (ctx.game.config.balance.controlPointTypes?.[point.kind]?.canDeploy === false) continue;
    origins.push(point);
  }
  return origins;
}

function movementScore(ctx, world, owner, unit, destination, origin) {
  let score = noise(`${ctx.seed}|${unit.id}|${key(destination)}`) * 0.4;
  if (dangerAt(ctx, destination)) score -= 2000;
  if (warningAt(ctx, destination)) score -= 45;
  const occupant = occupantAt(world, destination);
  if (occupant) score -= occupant.kind === 'headquarters' ? 500 : 90;
  const shot = bestShotFrom(ctx, world, owner, unit, destination);
  score += shot * 1.45;

  const targets = targetsFor(world, owner);
  const hqs = targets.filter(target => target.kind === 'headquarters');
  const nearestHq = hqs.sort((a, b) => distance(destination, a.entity) - distance(destination, b.entity))[0];
  if (nearestHq) {
    score += (distance(origin, nearestHq.entity) - distance(destination, nearestHq.entity)) * 3.2;
    score -= Math.max(0, distance(destination, nearestHq.entity) - unit.attackRange) * 0.35;
  }

  if (unit.canCapture) {
    let bestGain = -Infinity;
    for (const point of world.controlPoints) {
      const before = distance(origin, point);
      const after = distance(destination, point);
      const desired = point.owner !== owner;
      let value = (before - after) * (desired ? 8 : 2);
      if (after === 0) value += desired ? 105 : 12;
      bestGain = Math.max(bestGain, value);
    }
    if (Number.isFinite(bestGain)) score += bestGain;
  }

  let exposure = 0;
  for (const enemy of world.units) {
    if (!enemy.alive || enemy.owner === owner || world.players[enemy.owner]?.status !== 'active') continue;
    const dist = distance(destination, enemy);
    if (dist <= enemy.attackRange + enemy.moveRange) {
      exposure += Math.max(1, enemy.attack - unit.defense) / Math.max(1, dist - enemy.moveRange + 1);
    }
  }
  score -= exposure * (unit.hp < unit.maxHp * 0.45 ? 1.15 : 0.42);
  const ownHq = world.headquarters[owner];
  if (ownHq?.alive) {
    const nearestThreat = Math.min(...world.units.filter(enemy => enemy.alive && enemy.owner !== owner)
      .map(enemy => distance(enemy, ownHq)), 99);
    if (nearestThreat <= 3) score += Math.max(0, 4 - distance(destination, ownHq)) * 9;
  }
  return score;
}

function generateOwnActions(ctx, node, world, banned) {
  const owner = ctx.owner;
  const units = ctx.baseUnits.filter(unit => unit.owner === owner);
  const targets = targetsFor(world, owner);
  const attackLimit = ctx.game.config.balance.attacksPerUnit ?? 1;
  const supplies = (ctx.initialWorld.resources[owner]?.supplies ?? 0) - node.deploySpent;
  const actions = [];

  const aimCells = new Map();
  const addAim = p => {
    if (ctx.cells.has(key(p))) aimCells.set(key(p), { q: p.q, r: p.r });
  };
  for (const target of targets) {
    addAim(target.entity);
    if (target.kind === 'unit') {
      for (const p of neighbors(target.entity)) addAim(p);
      for (const p of reachable(ctx, world, target.entity, target.entity.moveRange)) addAim(p);
    }
  }

  for (const unit of units) {
    const from = node.positions.get(unit.id) ?? unit;
    const moves = reachable(ctx, world, from, unit.moveRange, node.terrain)
      .map(p => ({ p, score: movementScore(ctx, world, owner, unit, p, from) }))
      .sort((a, b) => b.score - a.score);
    const selectedMoves = moves.slice(0, 3);
    for (const special of [
      moves.find(item => world.controlPoints.some(cp => cp.q === item.p.q && cp.r === item.p.r)),
      [...moves].sort((a, b) => bestShotFrom(ctx, world, owner, unit, b.p) - bestShotFrom(ctx, world, owner, unit, a.p))[0],
    ]) {
      if (special && !selectedMoves.some(item => key(item.p) === key(special.p))) selectedMoves.push(special);
    }
    for (const move of selectedMoves) {
      actions.push({ type: 'move', unitId: unit.id, q: move.p.q, r: move.p.r, _priority: move.score + 12 });
    }

    if ((node.attacks.get(unit.id) ?? 0) < attackLimit) {
      const shots = [];
      for (const aimPosition of aimCells.values()) {
        const aim = coveredCells(ctx, from, unit, 'attackShape', aimPosition);
        if (!aim) continue;
        let score = 0;
        for (const target of targets) {
          const locked = target.kind === 'unit' && ctx.game.config.units[unit.type]?.attackLock
            && target.entity.q === aimPosition.q && target.entity.r === aimPosition.r;
          const covered = aim.cells.some(cell => cell.q === target.entity.q && cell.r === target.entity.r);
          if (!locked && !covered) continue;
          const damage = Math.min(target.entity.hp, expectedDamage(ctx, unit, target.entity));
          score += damage * targetValue(target) * (locked ? 1.35 : 1);
          if (damage >= target.entity.hp) score += target.kind === 'headquarters' ? 4000 : 70 + target.entity.cost;
        }
        if (score <= 0) {
          score = aim.cells.reduce((sum, cell) => {
            const enemy = targets.find(target => target.kind === 'unit' && distance(target.entity, cell) <= target.entity.moveRange);
            return sum + (enemy ? expectedDamage(ctx, unit, enemy.entity) * 0.12 : 0);
          }, 0);
        }
        shots.push({ aimPosition, score });
      }
      shots.sort((a, b) => b.score - a.score);
      for (const shot of shots.slice(0, 4)) {
        actions.push({
          type: 'attack', attackerId: unit.id, q: shot.aimPosition.q, r: shot.aimPosition.r,
          _priority: shot.score + 30,
        });
      }
    }

    if (unit.type === 'support') {
      const range = ctx.game.config.units.support?.healRange ?? unit.attackRange;
      const healAims = [...ctx.cells.values()].filter(cell => distance(from, cell) <= range);
      const heals = [];
      for (const aimPosition of healAims) {
        const aim = coveredCells(ctx, from, unit, 'healShape', aimPosition);
        if (!aim) continue;
        let amount = 0;
        for (const friend of units) {
          const position = node.positions.get(friend.id) ?? friend;
          if (!aim.cells.some(cell => key(cell) === key(position))) continue;
          amount += Math.min(friend.maxHp - friend.hp, (unit.healPower ?? 0) + (ctx.game.config.balance.healVarianceRange ?? 0) / 2);
        }
        if (amount > 0) heals.push({ aimPosition, score: amount * 2.1 });
      }
      heals.sort((a, b) => b.score - a.score);
      for (const heal of heals.slice(0, 2)) {
        actions.push({ type: 'heal', supportId: unit.id, q: heal.aimPosition.q, r: heal.aimPosition.r, _priority: heal.score + 22 });
      }
    }

    if (unit.type === 'heavy') {
      for (const p of neighbors(from)) {
        if (terrainAt(ctx, { ...world, terrain: node.terrain }, p) === 'blocker') {
          actions.push({ type: 'demolish', unitId: unit.id, q: p.q, r: p.r, _priority: 3 });
        }
      }
    }
  }

  if (supplies > 0) {
    const origins = deployOrigins(ctx, ctx.initialWorld, owner);
    const counts = {};
    for (const unit of units) counts[unit.type] = (counts[unit.type] ?? 0) + 1;
    const deploys = [];
    for (const [type, spec] of Object.entries(ctx.game.config.units)) {
      for (const origin of origins) {
        const discount = ctx.game.config.balance.controlPointTypes?.[origin.kind]?.deployDiscount ?? 0;
        const cost = Math.max(0, spec.cost - discount);
        if (cost > supplies || dangerAt(ctx, origin)) continue;
        for (const p of neighbors(origin)) {
          if (!ctx.cells.has(key(p)) || terrainAt(ctx, { ...world, terrain: node.terrain }, p) !== 'plain' || dangerAt(ctx, p)) continue;
          if (occupantAt(world, p)) continue;
          const futureUnit = { ...spec, type, id: `future-${type}`, owner, q: p.q, r: p.r, hp: spec.hp, maxHp: spec.hp };
          const shot = bestShotFrom(ctx, world, owner, futureUnit, p);
          const nearest = targets.length ? Math.min(...targets.map(target => distance(p, target.entity))) : 0;
          const score = 32 + spec.cost * 0.18 + shot - nearest * 1.8 - (counts[type] ?? 0) * 7;
          deploys.push({ type: 'deploy', unitType: type, fromId: origin.id, q: p.q, r: p.r, _cost: cost, _priority: score });
        }
      }
    }
    deploys.sort((a, b) => b._priority - a._priority);
    actions.push(...deploys.slice(0, 3));
  }

  actions.push({ type: 'wait', _priority: -12 });
  const unique = new Map();
  for (const action of actions) {
    const id = actionKey(external(action));
    if (banned.has(id)) continue;
    const previous = unique.get(id);
    if (!previous || action._priority > previous._priority) unique.set(id, action);
  }
  return [...unique.values()].sort((a, b) => b._priority - a._priority).slice(0, 18);
}

function bestCurrentAttack(ctx, world, owner, attackCounts) {
  const limit = ctx.game.config.balance.attacksPerUnit ?? 1;
  let best = null;
  for (const unit of world.units) {
    if (!unit.alive || unit.owner !== owner || !world.actionableUnits.has(unit.id)
      || (attackCounts.get(unit.id) ?? 0) >= limit) continue;
    for (const target of targetsFor(world, owner)) {
      const aim = coveredCells(ctx, unit, unit, 'attackShape', target.entity);
      if (!aim) continue;
      let score = 0;
      if (ctx.game.config.units[unit.type]?.attackLock && target.kind === 'unit') {
        score = expectedDamage(ctx, unit, target.entity) * targetValue(target) * 1.3;
      } else {
        for (const cell of aim.cells) {
          const occupant = occupantAt(world, cell);
          if (!occupant || occupant.entity.owner === owner) continue;
          const damage = Math.min(occupant.entity.hp, expectedDamage(ctx, unit, occupant.entity));
          score += damage * targetValue(occupant);
          if (damage >= occupant.entity.hp) score += occupant.kind === 'headquarters' ? 3000 : 60;
        }
      }
      if (!best || score > best.score) {
        best = { type: 'attack', attackerId: unit.id, q: target.entity.q, r: target.entity.r, score };
      }
    }
  }
  return best;
}

function bestCurrentHeal(ctx, world, owner) {
  let best = null;
  for (const support of world.units) {
    if (!support.alive || support.owner !== owner || support.type !== 'support'
      || !world.actionableUnits.has(support.id)) continue;
    const friends = world.units.filter(unit => unit.alive && unit.owner === owner && unit.hp < unit.maxHp);
    for (const friend of friends) {
      const aims = [friend, ...neighbors(friend)];
      for (const target of aims) {
        const aim = coveredCells(ctx, support, support, 'healShape', target);
        if (!aim) continue;
        let amount = 0;
        for (const unit of friends) {
          if (aim.cells.some(cell => key(cell) === key(unit))) amount += Math.min(unit.maxHp - unit.hp, support.healPower ?? 0);
        }
        if (!best || amount > best.score) best = { type: 'heal', supportId: support.id, q: target.q, r: target.r, score: amount };
      }
    }
  }
  return best;
}

function chooseOpponentAction(ctx, world, owner, policy, step) {
  const attack = bestCurrentAttack(ctx, world, owner, world.attackCounts);
  const heal = bestCurrentHeal(ctx, world, owner);
  if (heal && heal.score >= 15 && (policy === 'objective' || !attack || heal.score > attack.score * 0.7)) return heal;
  if (attack && attack.score > 0 && (policy !== 'mobile' || noise(`${ctx.seed}|${owner}|${step}|mobile`) > 0.32)) return attack;

  let bestMove = null;
  for (const unit of world.units) {
    if (!unit.alive || unit.owner !== owner || !world.actionableUnits.has(unit.id)) continue;
    for (const p of reachable(ctx, world, unit, unit.moveRange)) {
      let score = movementScore(ctx, world, owner, unit, p, unit);
      if (policy === 'objective' && unit.canCapture) {
        score += Math.max(0, 4 - Math.min(...world.controlPoints.map(cp => distance(p, cp)), 4)) * 5;
      }
      if (policy === 'hold') score -= distance(unit, p) * 30;
      if (policy === 'mobile') score += bestShotFrom(ctx, world, owner, unit, p) * 0.8;
      score += noise(`${ctx.seed}|${policy}|${step}|${unit.id}|${key(p)}`) * 2;
      if (!bestMove || score > bestMove.score) bestMove = { type: 'move', unitId: unit.id, q: p.q, r: p.r, score };
    }
  }
  if (bestMove && (policy !== 'hold' || bestMove.score > 45)) return bestMove;
  if (attack) return attack;

  if (step === 0) {
    const units = world.units.filter(unit => unit.alive && unit.owner === owner);
    const supplies = world.resources[owner]?.supplies ?? 0;
    const types = Object.entries(ctx.game.config.units)
      .filter(([type]) => supplies >= ctx.game.config.units[type].cost)
      .sort((a, b) => (a[1].cost - (units.filter(unit => unit.type === a[0]).length * 18))
        - (b[1].cost - (units.filter(unit => unit.type === b[0]).length * 18)));
    for (const [type, spec] of types) {
      for (const origin of deployOrigins(ctx, world, owner)) {
        for (const p of neighbors(origin)) {
          if (ctx.cells.has(key(p)) && terrainAt(ctx, world, p) === 'plain' && !occupantAt(world, p) && !dangerAt(ctx, p)) {
            return { type: 'deploy', unitType: type, fromId: origin.id, q: p.q, r: p.r };
          }
        }
      }
    }
  }
  return { type: 'wait' };
}

function eliminate(world, owner) {
  if (world.players[owner]) world.players[owner].status = 'eliminated';
  for (const unit of world.units) if (unit.owner === owner) unit.alive = false;
  for (const point of world.controlPoints) if (point.owner === owner) point.owner = null;
}

function resolveStep(ctx, previous, actions, planPositions) {
  const world = cloneWorld(previous);
  const kept = [];
  for (const action of actions) {
    const id = unitId(action);
    if (!id) {
      kept.push(action);
      continue;
    }
    const unit = world.units.find(item => item.id === id && item.alive);
    if (!unit || world.failedUnits.has(id)) {
      if (action.owner === ctx.owner) world.ownFailures++;
      if (unit) world.failedUnits.add(id);
      continue;
    }
    kept.push(action);
  }

  const occupants = new Map();
  for (const unit of world.units) if (unit.alive) occupants.set(key(unit), { kind: 'unit', entity: unit });
  for (const hq of Object.values(world.headquarters)) if (hq.alive) occupants.set(key(hq), { kind: 'headquarters', entity: hq });
  const arrivals = kept.filter(action => action.type === 'move' || action.type === 'deploy');
  const movers = new Map(arrivals.filter(action => action.type === 'move').map(action => [action.unitId, action]));
  const byDestination = new Map();
  for (const action of arrivals) {
    const list = byDestination.get(key(action)) ?? [];
    list.push(action);
    byDestination.set(key(action), list);
  }
  const failed = new Set();
  for (const list of byDestination.values()) {
    if (list.length > 1) for (const action of list) failed.add(action);
  }
  for (const action of arrivals) {
    const occupant = occupants.get(key(action));
    if (terrainAt(ctx, world, action) !== 'plain' || occupant?.kind === 'headquarters'
      || (occupant?.kind === 'unit' && !movers.has(occupant.entity.id))) failed.add(action);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const action of arrivals) {
      if (failed.has(action)) continue;
      const occupant = occupants.get(key(action));
      const dependency = occupant?.kind === 'unit' ? movers.get(occupant.entity.id) : null;
      if (dependency && failed.has(dependency)) {
        failed.add(action);
        changed = true;
      }
    }
  }

  for (const action of kept) {
    if (action.type !== 'deploy') continue;
    if (failed.has(action)) {
      if (action.owner === ctx.owner) world.ownFailures++;
      continue;
    }
    const spec = ctx.game.config.units[action.unitType];
    const origin = [...Object.values(world.headquarters), ...world.controlPoints].find(item => item.id === action.fromId);
    const discount = ctx.game.config.balance.controlPointTypes?.[origin?.kind]?.deployDiscount ?? 0;
    const cost = Math.max(0, (spec?.cost ?? 0) - discount);
    const resources = world.resources[action.owner];
    if (!spec || !resources || resources.supplies < cost) continue;
    resources.supplies -= cost;
    world.units.push({
      ...spec, id: `prism-${world.nextUnitId++}`, owner: action.owner, type: action.unitType,
      q: action.q, r: action.r, maxHp: spec.hp, hp: spec.hp, alive: true,
    });
  }
  for (const action of kept) {
    if (action.type !== 'move') continue;
    const unit = world.units.find(item => item.id === action.unitId);
    if (failed.has(action)) {
      world.failedUnits.add(action.unitId);
      if (action.owner === ctx.owner) world.ownFailures++;
      continue;
    }
    unit.q = action.q;
    unit.r = action.r;
  }
  for (const action of kept) {
    if (action.type !== 'demolish') continue;
    const unit = world.units.find(item => item.id === action.unitId && item.alive);
    if (!unit || unit.type !== 'heavy' || distance(unit, action) > 1
      || terrainAt(ctx, world, action) !== 'blocker' || occupantAt(world, action)) {
      world.failedUnits.add(action.unitId);
      if (action.owner === ctx.owner) world.ownFailures++;
      continue;
    }
    world.terrain.set(key(action), 'plain');
  }

  const heals = [];
  for (const action of kept) {
    if (action.type !== 'heal') continue;
    const support = world.units.find(item => item.id === action.supportId && item.alive);
    if (!support) continue;
    const aim = coveredCells(ctx, support, support, 'healShape', action);
    if (!aim || dangerAt(ctx, support) || aim.cells.some(cell => ctx.cells.has(key(cell)) && dangerAt(ctx, cell))) continue;
    heals.push({ action, support, aim });
  }
  for (const { action, aim } of heals) {
    const amount = (world.units.find(unit => unit.id === action.supportId)?.healPower ?? 0)
      + (ctx.game.config.balance.healVarianceRange ?? 0) / 2;
    for (const unit of world.units) {
      if (unit.alive && unit.owner === action.owner && unit.hp < unit.maxHp
        && aim.cells.some(cell => key(cell) === key(unit))) {
        unit.hp = Math.min(unit.maxHp, unit.hp + amount);
      }
    }
  }

  const strikes = [];
  const attackLimit = ctx.game.config.balance.attacksPerUnit ?? 1;
  for (const action of kept) {
    if (action.type !== 'attack') continue;
    const attacker = world.units.find(item => item.id === action.attackerId && item.alive);
    if (!attacker || (world.attackCounts.get(attacker.id) ?? 0) >= attackLimit) continue;
    const aim = coveredCells(ctx, attacker, attacker, 'attackShape', action);
    if (!aim) {
      world.failedUnits.add(attacker.id);
      if (action.owner === ctx.owner) world.ownFailures++;
      continue;
    }
    world.attackCounts.set(attacker.id, (world.attackCounts.get(attacker.id) ?? 0) + 1);
    let locked = null;
    if (ctx.game.config.units[attacker.type]?.attackLock) {
      locked = planPositions.find(entry => entry.unit.owner !== action.owner
        && entry.q === action.q && entry.r === action.r)?.unit ?? null;
    }
    strikes.push({ action, attacker, aim, locked });
  }

  const deaths = [];
  for (const { action, attacker, aim, locked } of strikes) {
    const targets = [];
    if (locked) {
      const current = world.units.find(unit => unit.id === locked.id && unit.alive);
      if (current && distance(attacker, current) <= attacker.attackRange) targets.push({ kind: 'unit', entity: current });
    } else {
      for (const cell of aim.cells) {
        const occupant = occupantAt(world, cell);
        if (occupant && occupant.entity.owner !== action.owner) targets.push(occupant);
      }
    }
    if (targets.length === 0 && action.owner === ctx.owner) world.ownMisses++;
    for (const target of targets) {
      if (!target.entity.alive) continue;
      const damage = Math.min(target.entity.hp, expectedDamage(ctx, attacker, target.entity));
      target.entity.hp = Math.max(0, target.entity.hp - damage);
      const stats = world.players[action.owner]?.stats;
      if (target.kind === 'headquarters' && stats) stats.headquartersDamage = (stats.headquartersDamage ?? 0) + damage;
      if (target.entity.hp === 0) deaths.push({ ...target, killer: action.owner });
    }
  }
  const recorded = new Set();
  for (const death of deaths) {
    if (recorded.has(death.entity.id)) continue;
    recorded.add(death.entity.id);
    death.entity.alive = false;
    if (death.kind === 'unit') {
      const stats = world.players[death.killer]?.stats;
      if (stats) stats.killValue = (stats.killValue ?? 0) + (death.entity.cost ?? 0);
    } else {
      eliminate(world, death.entity.owner);
    }
  }
  return world;
}

function effectiveControl(world) {
  const owners = new Map(world.controlPoints.map(point => [point.id, point.owner]));
  for (const point of world.controlPoints) {
    const capturer = world.units.find(unit => unit.alive && unit.canCapture && unit.q === point.q && unit.r === point.r);
    if (capturer) owners.set(point.id, capturer.owner);
  }
  return owners;
}

function playerScore(ctx, world, owner, control, finalRound) {
  if (world.players[owner]?.status !== 'active') return -100000;
  const weights = ctx.game.config.balance.adjudicationWeights ?? {};
  const stats = world.players[owner]?.stats ?? {};
  const army = world.units.filter(unit => unit.alive && unit.owner === owner)
    .reduce((sum, unit) => sum + (unit.cost ?? 50) * unit.hp / unit.maxHp, 0);
  const held = world.controlPoints.filter(point => control.get(point.id) === owner).length;
  let controlScore = held * (weights.controlPoint ?? 50);
  if (finalRound) {
    const flowRatio = weights.controlPointFlowRatio ?? 0.7;
    const rounds = Math.max(1, (stats.controlHoldRounds ?? 0) + 1);
    const flow = ((stats.controlHold ?? 0) + held) / rounds;
    controlScore = (weights.controlPoint ?? 50) * (flowRatio * flow + (1 - flowRatio) * held);
  }
  return (stats.headquartersDamage ?? 0) * (weights.enemyHqDamage ?? 4)
    + (world.headquarters[owner]?.hp ?? 0) * (weights.ownHqHp ?? 1)
    + controlScore
    + army * ((weights.armyValue ?? 0.3) + 0.72)
    + (world.resources[owner]?.supplies ?? 0) * ((weights.supplies ?? 0) + 0.06)
    + (stats.killValue ?? 0) * ((weights.killValue ?? 0) + 0.12);
}

function evaluate(ctx, world, finalRound) {
  const owners = Object.keys(world.players).filter(id => world.players[id]?.status === 'active');
  if (!owners.includes(ctx.owner)) return -100000;
  if (owners.length === 1) return 100000;
  const control = effectiveControl(world);
  const own = playerScore(ctx, world, ctx.owner, control, finalRound);
  const bestEnemy = Math.max(...owners.filter(id => id !== ctx.owner).map(id => playerScore(ctx, world, id, control, finalRound)));
  let score = own - bestEnemy + own * 0.08;

  for (const unit of world.units) {
    if (!unit.alive) continue;
    const sign = unit.owner === ctx.owner ? 1 : -1;
    if (dangerAt(ctx, unit)) score -= sign * 1200;
    if (warningAt(ctx, unit)) score -= sign * 30;
    const shot = bestShotFrom(ctx, world, unit.owner, unit, unit);
    score += sign * shot * (unit.owner === ctx.owner ? 0.24 : 0.3);
    if (unit.owner === ctx.owner && unit.canCapture) {
      const desired = world.controlPoints.filter(point => control.get(point.id) !== ctx.owner);
      if (desired.length) score -= Math.min(...desired.map(point => distance(unit, point))) * 1.4;
    }
  }
  score -= world.ownFailures * 28 + world.ownMisses * 3;
  return score;
}

function scoreNode(ctx, node, finalRound) {
  let weighted = 0;
  let totalWeight = 0;
  let worst = Infinity;
  for (const scenario of node.scenarios) {
    const value = evaluate(ctx, scenario.world, finalRound);
    weighted += value * scenario.weight;
    totalWeight += scenario.weight;
    worst = Math.min(worst, value);
  }
  return weighted / totalWeight + Math.min(0, worst) * 0.12 - node.future.filter(action => action.type === 'wait').length * 0.4;
}

function synthesize(game, owner, prefix) {
  const ctx = makeContext(game, owner);
  const limit = game.config.balance.actionsPerTurn ?? 5;
  const projection = projectedQueue(ctx, prefix);
  const planPositions = ctx.baseUnits.map(unit => ({ unit: { ...unit }, q: unit.q, r: unit.r }));
  const definitions = [
    { policy: 'press', weight: 0.36 },
    { policy: 'mobile', weight: 0.25 },
    { policy: 'objective', weight: 0.25 },
    { policy: 'hold', weight: 0.14 },
  ];
  let scenarios = definitions.map(definition => ({ ...definition, world: cloneWorld(ctx.initialWorld) }));
  for (let step = 0; step < prefix.length; step++) {
    scenarios = scenarios.map(scenario => {
      const opponents = activeOwners(game).filter(id => id !== owner && scenario.world.players[id]?.status === 'active')
        .map(id => ({ ...chooseOpponentAction(ctx, scenario.world, id, scenario.policy, step), owner: id }));
      return { ...scenario, world: resolveStep(ctx, scenario.world, [{ ...prefix[step], owner }, ...opponents], planPositions) };
    });
  }

  let beam = [{ future: [], ...projection, scenarios, score: 0 }];
  const width = ctx.baseUnits.length > 10 ? 7 : 10;
  for (let depth = prefix.length; depth < limit; depth++) {
    const expanded = [];
    for (const node of beam) {
      const world = node.scenarios[0].world;
      const candidates = generateOwnActions(ctx, node, world, new Set());
      for (const action of candidates) {
        const nextProjection = addProjection(node, action);
        const nextScenarios = node.scenarios.map(scenario => {
          const opponents = activeOwners(game).filter(id => id !== owner && scenario.world.players[id]?.status === 'active')
            .map(id => ({ ...chooseOpponentAction(ctx, scenario.world, id, scenario.policy, depth), owner: id }));
          return {
            ...scenario,
            world: resolveStep(ctx, scenario.world, [{ ...action, owner }, ...opponents], planPositions),
          };
        });
        const next = { future: [...node.future, action], ...nextProjection, scenarios: nextScenarios, score: 0 };
        next.score = scoreNode(ctx, next, depth === limit - 1 && game.config.balance.maxTurns === game.turn?.roundNumber);
        expanded.push(next);
      }
    }
    expanded.sort((a, b) => b.score - a.score);
    beam = expanded.slice(0, width);
    if (beam.length === 0) break;
  }
  beam.sort((a, b) => b.score - a.score);
  return beam[0]?.future ?? [];
}

async function decide(game, _utils, context = {}) {
  const owner = context.owner;
  if (!owner || game.phase !== 'active' || game.players?.[owner]?.status !== 'active') return null;
  if (game.plan?.committed?.includes(owner)) return null;
  const queue = game.plan?.myQueue ?? [];
  const limit = game.config?.balance?.actionsPerTurn ?? 5;
  if (queue.length >= limit) return null;

  const cacheKey = `${game.id}|${owner}|${game.turn?.roundNumber ?? 0}`;
  let entry = planCache.get(cacheKey);
  const cacheValid = entry && queue.length >= entry.baseLength
    && entry.baseActions.every((saved, index) => actionKey(queue[index]) === saved);
  if (!cacheValid) {
    const future = synthesize(game, owner, queue);
    entry = { baseActions: queue.map(actionKey), baseLength: queue.length, future };
    planCache.set(cacheKey, entry);
    if (planCache.size > 24) planCache.delete(planCache.keys().next().value);
  }
  return external(entry.future[queue.length - entry.baseLength]);
}

export default {
  name: 'prism',
  description: '多情境联合队列束搜索：同步到达推演、斩杀防护与终局计分',
  decide,
};
