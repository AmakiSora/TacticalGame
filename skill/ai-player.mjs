#!/usr/bin/env node
// AI Player for the Tactical War Game
// Usage: node ai-player.mjs [--url http://localhost:3000] [--side a|b] [--game <id>]
// Creates a game if no --game provided, or joins an existing one.

function getArg(name, fallback) {
  const eq = process.argv.find(a => a.startsWith(`${name}=`));
  if (eq) return eq.split('=').slice(1).join('=');
  const idx = process.argv.indexOf(name);
  if (idx !== -1 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return fallback;
}

const BASE_URL = getArg('--url', 'http://localhost:3000');
const SIDE = getArg('--side', 'a');
const GAME_ARG = getArg('--game', null);

const PLAYER_ID = SIDE === 'a' ? 'player_a' : 'player_b';
const ENEMY_ID = SIDE === 'a' ? 'player_b' : 'player_a';

// --- Game Constants ---
const UNIT_SPECS = {
  infantry: { hp: 100, attack: 20, defense: 8, moveRange: 3, attackRange: 1, cost: 40, productionTime: 1 },
  sniper:   { hp: 60,  attack: 35, defense: 3, moveRange: 2, attackRange: 4, cost: 60, productionTime: 2 },
  tank:     { hp: 150, attack: 25, defense: 15, moveRange: 2, attackRange: 1, cost: 80, productionTime: 3 },
  medic:    { hp: 70,  attack: 5,  defense: 5, moveRange: 3, attackRange: 1, cost: 50, productionTime: 1 },
};

// Grid is 20x20
const GRID_SIZE = 20;

const MINING_POINTS = [
  { x: 6, y: 7 }, { x: 6, y: 13 },
  { x: 13, y: 7 }, { x: 13, y: 13 },
];

const HQ_POS = { player_a: { x: 3, y: 10 }, player_b: { x: 16, y: 10 } };

// --- API Helpers ---
async function api(method, path, token, body) {
  const opts = { method, headers: {} };
  if (token) opts.headers['X-Player-Token'] = token;
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE_URL}${path}`, opts);
  const data = await res.json();
  if (!res.ok && res.status !== 409) {
    console.error(`  API ${method} ${path} -> ${res.status}: ${data.error || JSON.stringify(data)}`);
  }
  return { status: res.status, data };
}

async function getState(token) {
  const { data } = await api('GET', `/api/games/${gameId}`, token);
  return data;
}

// --- Setup ---
let gameId, token;

async function setup() {
  if (GAME_ARG) {
    gameId = GAME_ARG;
    // Join existing game
    const { data } = await api('POST', `/api/games/${gameId}/join`, null);
    token = data[`player${SIDE.toUpperCase()}Token`];
    if (!token) {
      // Maybe we created it — get token from creation
      console.error(`Could not get token for player ${SIDE}. Did the other side already join?`);
      process.exit(1);
    }
    console.log(`Joined game ${gameId} as player_${SIDE}`);
  } else {
    // Create new game
    const { data } = await api('POST', '/api/games', null);
    gameId = data.gameId;
    token = data[`player${SIDE.toUpperCase()}Token`];
    console.log(`Created game ${gameId} as player_${SIDE}`);
    console.log(`Waiting for opponent to join...`);

    // Poll until game starts
    while (true) {
      const st = await getState(token);
      if (st.phase === 'waiting_command') break;
      if (st.phase === 'game_over') { console.log('Game over before we started!'); process.exit(0); }
      await sleep(1000);
    }
    console.log('Game started!');
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// --- AI Decision Engine ---
function manhattan(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }

function my(state) {
  return {
    units: state.units.filter(u => u.owner === PLAYER_ID && u.alive),
    buildings: state.buildings.filter(b => b.owner === PLAYER_ID && b.alive),
    gold: state.resources[PLAYER_ID].gold,
  };
}

function enemy(state) {
  const enemyId = PLAYER_ID === 'player_a' ? 'player_b' : 'player_a';
  return {
    units: state.units.filter(u => u.owner === enemyId && u.alive),
    buildings: state.buildings.filter(b => b.owner === enemyId && b.alive),
    hq: state.buildings.find(b => b.owner === enemyId && b.type === 'headquarters' && b.alive),
  };
}

function unclaimedMiningPoints(state) {
  const myMiners = state.buildings.filter(b => b.owner === PLAYER_ID && b.type === 'miner' && b.alive);
  return MINING_POINTS.filter(mp =>
    !myMiners.some(m => m.x === mp.x && m.y === mp.y)
  );
}

function completedBarracks(state) {
  return my(state).buildings.filter(b => b.type === 'barracks' && !b.isBuilding && b.production === null);
}

function completedProducers(state) {
  // Only barracks can produce units (HQ cannot produce)
  return my(state).buildings.filter(b =>
    b.type === 'barracks' && !b.isBuilding && b.production === null
  );
}

function hasBarracks(state) {
  return my(state).buildings.some(b => b.type === 'barracks' && !b.isBuilding);
}

// Priority: position for economy > build miners > build barracks > produce > combat
async function executeTurn(state) {
  let gold = my(state).gold;
  const actions = [];

  // --- PHASE 0: POSITION UNITS FOR ECONOMY ---
  // Move idle units toward nearest unclaimed mining points to enable building
  const unclaimedEarly = unclaimedMiningPoints(state);
  const idleUnits = my(state).units.filter(u => !u.hasMoved);
  if (unclaimedEarly.length > 0 && idleUnits.length > 0) {
    const hqPos = HQ_POS[PLAYER_ID];
    const sortedMP = [...unclaimedEarly].sort((a, b) => manhattan(a, hqPos) - manhattan(b, hqPos));
    const targetMP = sortedMP[0];

    for (const unit of idleUnits) {
      if (manhattan(unit, targetMP) <= 2) continue;
      const alreadyCovered = [...my(state).units, ...my(state).buildings].some(
        e => e.id !== unit.id && manhattan(e, targetMP) <= 2
      );
      if (alreadyCovered) break;

      let bestMove = null;
      let bestDist = manhattan(unit, targetMP);
      for (let dx = -unit.moveRange; dx <= unit.moveRange; dx++) {
        for (let dy = -unit.moveRange; dy <= unit.moveRange; dy++) {
          if (Math.abs(dx) + Math.abs(dy) > unit.moveRange || (dx === 0 && dy === 0)) continue;
          const nx = unit.x + dx, ny = unit.y + dy;
          if (nx < 0 || nx >= GRID_SIZE || ny < 0 || ny >= GRID_SIZE) continue;
          const occupied = state.units.find(u => u.alive && u.x === nx && u.y === ny) ||
                           state.buildings.find(b => b.alive && b.x === nx && b.y === ny);
          if (occupied) continue;
          const dist = manhattan({ x: nx, y: ny }, targetMP);
          if (dist < bestDist) { bestDist = dist; bestMove = { x: nx, y: ny }; }
        }
      }
      if (bestMove) {
        console.log(`  ${unit.type} moving toward mining point: (${unit.x},${unit.y})->(${bestMove.x},${bestMove.y})`);
        await api('POST', `/api/games/${gameId}/move`, token, { unitId: unit.id, x: bestMove.x, y: bestMove.y });
        actions.push('move_to_mine');
        break;
      }
    }
  }

  // --- PHASE 1: ECONOMY — BUILD MINERS ---
  const unclaimed = unclaimedMiningPoints(state);
  if (unclaimed.length > 0 && gold >= 30) {
    if (actions.includes('move_to_mine')) state = await getState(token);
    const hqPos = HQ_POS[PLAYER_ID];
    const sorted = [...unclaimed].sort((a, b) => manhattan(a, hqPos) - manhattan(b, hqPos));

    for (const mp of sorted) {
      if (gold < 30) break;
      const occupant = state.units.find(u => u.alive && u.x === mp.x && u.y === mp.y) ||
                       state.buildings.find(b => b.alive && b.x === mp.x && b.y === mp.y);
      if (occupant) continue;

      const inRange = [...my(state).units, ...my(state).buildings].some(
        e => manhattan(e, mp) <= 2
      );
      if (!inRange) continue;

      console.log(`  Building miner at (${mp.x},${mp.y})`);
      await api('POST', `/api/games/${gameId}/build`, token, { type: 'miner', x: mp.x, y: mp.y });
      gold -= 30;
      actions.push('build_miner');
    }
  }

  // --- PHASE 2: BUILD BARRACKS (MUST come before production — HQ cannot produce) ---
  if (gold >= 50 && !hasBarracks(state)) {
    if (actions.length > 0) state = await getState(token);
    const friendlyEntities = [...my(state).units, ...my(state).buildings];
    let bestPos = null;
    let bestScore = -Infinity;
    for (const e of friendlyEntities) {
      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
          if (Math.abs(dx) + Math.abs(dy) > 2) continue;
          const bx = e.x + dx, by = e.y + dy;
          if (bx < 0 || bx >= GRID_SIZE || by < 0 || by >= GRID_SIZE) continue;
          const occupied = state.units.find(u => u.alive && u.x === bx && u.y === by) ||
                           state.buildings.find(b => b.alive && b.x === bx && b.y === by);
          if (occupied) continue;
          const enemyHq = HQ_POS[PLAYER_ID === 'player_a' ? 'player_b' : 'player_a'];
          const score = -manhattan({ x: bx, y: by }, enemyHq);
          if (score > bestScore) {
            bestScore = score;
            bestPos = { x: bx, y: by };
          }
        }
      }
    }
    if (bestPos) {
      console.log(`  Building barracks at (${bestPos.x},${bestPos.y})`);
      await api('POST', `/api/games/${gameId}/build`, token, { type: 'barracks', x: bestPos.x, y: bestPos.y });
      gold -= 50;
      actions.push('build_barracks');
    }
  }

  // --- PHASE 3: PRODUCTION (from barracks only — HQ cannot produce) ---
  if (actions.length > 0) state = await getState(token);
  const producers = completedProducers(state);
  for (const b of producers) {
    if (gold < 40) break;

    const army = my(state).units;
    const counts = { infantry: 0, sniper: 0, tank: 0, medic: 0 };
    army.forEach(u => counts[u.type]++);

    let unitType;
    if (counts.infantry < 3) {
      if (gold >= 40) unitType = 'infantry';
    } else if (counts.tank < 2 && gold >= 80) {
      unitType = 'tank';
    } else if (counts.sniper < 2 && gold >= 60) {
      unitType = 'sniper';
    } else if (counts.medic < 1 && counts.infantry + counts.tank >= 3 && gold >= 50) {
      unitType = 'medic';
    } else if (gold >= 40) {
      unitType = 'infantry';
    }

    if (unitType) {
      console.log(`  Producing ${unitType} from ${b.type} (${b.id.slice(0, 8)})`);
      await api('POST', `/api/games/${gameId}/produce`, token, { buildingId: b.id, unitType });
      gold -= UNIT_SPECS[unitType].cost;
      actions.push(`produce_${unitType}`);
    }
  }

  // --- PHASE 3b: BUILD WALLS (tactical blocking) ---
  if (gold >= 20 && state.turn.turnNumber > 2) {
    if (actions.length > 0) state = await getState(token);
    const myData = my(state);
    const eData = enemy(state);

    // Find threatened miners: miners with enemies within 3 cells
    const threatenedMiners = myData.buildings.filter(b =>
      b.type === 'miner' && !b.isBuilding &&
      eData.units.some(e => manhattan(b, e) <= 3)
    );

    // Build wall between threatened miner and nearest enemy
    if (threatenedMiners.length > 0 && gold >= 20) {
      for (const miner of threatenedMiners) {
        if (gold < 20) break;
        const nearestEnemy = eData.units.reduce((best, e) =>
          !best || manhattan(miner, e) < manhattan(miner, best) ? e : best, null
        );
        if (!nearestEnemy) continue;

        // Find wall position between miner and enemy
        const dx = nearestEnemy.x - miner.x;
        const dy = nearestEnemy.y - miner.y;
        const step = Math.abs(dx) > Math.abs(dy)
          ? { x: miner.x + Math.sign(dx), y: miner.y }
          : { x: miner.x, y: miner.y + Math.sign(dy) };

        const occupied = state.units.find(u => u.alive && u.x === step.x && u.y === step.y) ||
                         state.buildings.find(b => b.alive && b.x === step.x && b.y === step.y);
        if (occupied) continue;

        const inRange = [...myData.units, ...myData.buildings].some(e => manhattan(e, step) <= 4);
        if (!inRange) continue;

        console.log(`  Building defensive wall at (${step.x},${step.y}) near miner (${miner.x},${miner.y})`);
        await api('POST', `/api/games/${gameId}/build`, token, { type: 'wall', x: step.x, y: step.y });
        gold -= 20;
        actions.push('build_wall_defense');
      }
    }

    // Build chokepoint wall if gold remaining: find narrow passages
    if (gold >= 20) {
      if (actions.length > 0) state = await getState(token);
      const friendly = [...my(state).units, ...my(state).buildings];
      // Check if there's a narrow gap (1-2 wide between permanent walls or water) near the front line
      for (const ent of friendly) {
        if (gold < 20) break;
        for (let dx = -4; dx <= 4; dx++) {
          for (let dy = -4; dy <= 4; dy++) {
            if (Math.abs(dx) + Math.abs(dy) > 4) continue;
            if (gold < 20) break;
            const wx = ent.x + dx, wy = ent.y + dy;
            if (wx < 0 || wx >= GRID_SIZE || wy < 0 || wy >= GRID_SIZE) continue;
            const occupied = state.units.find(u => u.alive && u.x === wx && u.y === wy) ||
                             state.buildings.find(b => b.alive && b.x === wx && b.y === wy);
            if (occupied) continue;
            // Only build if within wallBuildRange
            const inRange = friendly.some(e => manhattan(e, { x: wx, y: wy }) <= 4);
            if (!inRange) continue;
            // Build wall in chokepoint: cell between two impassable cells
            const neighbors = [
              { x: wx + 1, y: wy }, { x: wx - 1, y: wy },
              { x: wx, y: wy + 1 }, { x: wx, y: wy - 1 },
            ];
            const impassable = neighbors.filter(n => {
              if (n.x < 0 || n.x >= GRID_SIZE || n.y < 0 || n.y >= GRID_SIZE) return true;
              const occ = state.units.find(u => u.alive && u.x === n.x && u.y === n.y) ||
                          state.buildings.find(b => b.alive && b.x === n.x && b.y === n.y);
              return occ && occ.owner !== PLAYER_ID;
            });
            if (impassable.length >= 2) {
              console.log(`  Building chokepoint wall at (${wx},${wy})`);
              await api('POST', `/api/games/${gameId}/build`, token, { type: 'wall', x: wx, y: wy });
              gold -= 20;
              actions.push('build_wall_choke');
              break;
            }
          }
        }
      }
    }
  }

  // --- PHASE 4: COMBAT ---
  // Refresh state to get accurate hasMoved/hasAttacked flags
  if (actions.length > 0) state = await getState(token);
  const myUnits = my(state).units;
  const enemyData = enemy(state);
  const enemyHq = enemyData.hq;

  for (const unit of myUnits) {
    // Try to attack first (if in range and hasn't attacked)
    if (!unit.hasAttacked) {
      // Find targets in range
      const targetsInRange = [
        ...enemyData.units.filter(e => manhattan(unit, e) <= unit.attackRange),
        ...enemyData.buildings.filter(e => manhattan(unit, e) <= unit.attackRange),
      ];

      // Priority: HQ > enemy units (lowest HP first) > blocking walls > production buildings > miners
      const hqTarget = targetsInRange.find(t => t.type === 'headquarters');
      const unitTargets = targetsInRange.filter(t => 'attack' in t).sort((a, b) => a.hp - b.hp);
      const wallTargets = targetsInRange.filter(t => t.type === 'wall').sort((a, b) => a.hp - b.hp);
      const prodBuildings = targetsInRange.filter(t => !('attack' in t) && t.type !== 'miner' && t.type !== 'wall');
      const miners = targetsInRange.filter(t => t.type === 'miner');

      const target = hqTarget || unitTargets[0] || wallTargets[0] || prodBuildings[0] || miners[0];

      if (target) {
        console.log(`  ${unit.type} (${unit.id.slice(0, 8)}) attacking ${target.type || target.unitType} (${target.id.slice(0, 8)}) HP:${target.hp}`);
        await api('POST', `/api/games/${gameId}/attack`, token, { attackerId: unit.id, targetId: target.id });
        actions.push('attack');
        continue; // Don't move if we attacked
      }
    }

    // Move toward enemy HQ or nearest enemy
    if (!unit.hasMoved) {
      const dest = enemyHq || enemyData.units[0];
      if (!dest) continue;

      // Calculate best move: get closer to target while staying in bounds
      let bestMove = null;
      let bestDist = manhattan(unit, dest);

      const moves = [
        { x: unit.x + 1, y: unit.y },
        { x: unit.x - 1, y: unit.y },
        { x: unit.x, y: unit.y + 1 },
        { x: unit.x, y: unit.y - 1 },
      ];

      // Also consider multi-step moves within moveRange
      for (let dx = -unit.moveRange; dx <= unit.moveRange; dx++) {
        for (let dy = -unit.moveRange; dy <= unit.moveRange; dy++) {
          if (Math.abs(dx) + Math.abs(dy) > unit.moveRange || (dx === 0 && dy === 0)) continue;
          const nx = unit.x + dx;
          const ny = unit.y + dy;
          if (nx < 0 || nx >= GRID_SIZE || ny < 0 || ny >= GRID_SIZE) continue;
          const occupied = state.units.find(u => u.alive && u.x === nx && u.y === ny) ||
                           state.buildings.find(b => b.alive && b.x === nx && b.y === ny);
          if (occupied) continue;
          const dist = manhattan({ x: nx, y: ny }, dest);
          if (dist < bestDist) {
            bestDist = dist;
            bestMove = { x: nx, y: ny };
          }
        }
      }

      if (bestMove) {
        console.log(`  ${unit.type} (${unit.id.slice(0, 8)}) moving (${unit.x},${unit.y})->(${bestMove.x},${bestMove.y})`);
        await api('POST', `/api/games/${gameId}/move`, token, { unitId: unit.id, x: bestMove.x, y: bestMove.y });
        actions.push('move');

        // After moving, try to attack if now in range
        if (!unit.hasAttacked) {
          // Re-fetch state after move to get accurate positions
          // For efficiency, use the planned position
          const newPos = bestMove;
          const targetsAfterMove = [
            ...enemyData.units.filter(e => manhattan(newPos, e) <= unit.attackRange),
            ...enemyData.buildings.filter(e => manhattan(newPos, e) <= unit.attackRange),
          ].sort((a, b) => a.hp - b.hp);
          const hqAfter = targetsAfterMove.find(t => t.type === 'headquarters');
          const targetAfter = hqAfter || targetsAfterMove[0];
          if (targetAfter) {
            console.log(`  ${unit.type} attacking after move: ${targetAfter.type} HP:${targetAfter.hp}`);
            await api('POST', `/api/games/${gameId}/attack`, token, { attackerId: unit.id, targetId: targetAfter.id });
            actions.push('attack');
          }
        }
      }
    }
  }

  // --- PHASE 5: MEDIC HEALS ---
  const medics = myUnits.filter(u => u.type === 'medic' && !u.hasAttacked);
  for (const medic of medics) {
    const injured = my(state).units.filter(u =>
      u.id !== medic.id && u.alive && u.hp < u.maxHp && manhattan(medic, u) <= 1
    ).sort((a, b) => a.hp - b.hp);

    if (injured[0]) {
      console.log(`  Medic healing ${injured[0].type} (HP: ${injured[0].hp}/${injured[0].maxHp})`);
      await api('POST', `/api/games/${gameId}/heal`, token, { medicId: medic.id, targetId: injured[0].id });
      actions.push('heal');
    }
  }

  return actions;
}

// --- Main Loop ---
async function main() {
  await setup();

  let turnCount = 0;
  while (true) {
    const state = await getState(token);

    if (state.phase === 'game_over') {
      console.log(`\nGame Over! Winner: ${state.winner}`);
      console.log(`I (${PLAYER_ID}) ${state.winner === PLAYER_ID ? 'WON!' : 'lost.'}`);
      break;
    }

    if (state.turn.currentOwner !== PLAYER_ID) {
      // Not our turn — poll
      await sleep(500);
      continue;
    }

    turnCount++;
    console.log(`\n=== Turn ${state.turn.turnNumber} (${PLAYER_ID}) | Gold: ${my(state).gold} ===`);

    const actions = await executeTurn(state);
    console.log(`  Actions taken: ${actions.length > 0 ? actions.join(', ') : 'none'}`);

    // End turn
    console.log('  Ending turn...');
    await api('POST', `/api/games/${gameId}/end-turn`, token);

    await sleep(200); // Brief pause before polling
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
