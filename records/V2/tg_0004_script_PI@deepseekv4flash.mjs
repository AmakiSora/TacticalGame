#!/usr/bin/env node

const DEFAULT_URL = 'http://localhost:3100';
const HEX_DIRECTIONS = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

function parseArgs(argv) {
  const args = {
    url: DEFAULT_URL,
    side: 'a',
    game: '',
    token: '',
    map: 'default',
    name: '',
    maxTurns: 80,
    delayMs: 500,
    once: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[++i];
    };
    if (arg === '--url') args.url = next();
    else if (arg === '--side') args.side = next();
    else if (arg === '--game') args.game = next();
    else if (arg === '--token') args.token = next();
    else if (arg === '--map') args.map = next();
    else if (arg === '--name') args.name = next();
    else if (arg === '--max-turns') args.maxTurns = Number(next());
    else if (arg === '--delay-ms') args.delayMs = Number(next());
    else if (arg === '--once') args.once = true;
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (args.side !== 'a' && args.side !== 'b') throw new Error('--side must be a or b');
  if (!Number.isFinite(args.maxTurns) || args.maxTurns < 1) throw new Error('--max-turns must be a positive number');
  if (!Number.isFinite(args.delayMs) || args.delayMs < 0) throw new Error('--delay-ms must be a non-negative number');
  args.url = args.url.replace(/\/+$/, '');
  return args;
}

function printHelp() {
  console.log(`Usage:
  node skill/ai-player.mjs --side a [--url ${DEFAULT_URL}] [--map default]
  node skill/ai-player.mjs --side b --game <gameId>
  node skill/ai-player.mjs --side a --game <gameId> --token <playerAToken>

Options:
  --url <url>          API base URL, default ${DEFAULT_URL}
  --side <a|b>         Seat to play
  --game <id>          Existing game id
  --token <token>      Existing player token
  --map <mapId>        Map id for new games, default default
  --name <name>        Player display name
  --max-turns <n>      Stop after this many observed turns, default 80
  --delay-ms <n>       Poll delay while waiting, default 500
  --once              Play at most one owned turn
`);
}

function playerId(side) {
  return side === 'a' ? 'player_a' : 'player_b';
}

function otherPlayer(owner) {
  return owner === 'player_a' ? 'player_b' : 'player_a';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function request(baseUrl, method, path, body, token) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['X-Player-Token'] = token;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const code = data?.code ? ` ${data.code}` : '';
    const message = data?.error ? `: ${data.error}` : '';
    const err = new Error(`${method} ${path} failed (${res.status})${code}${message}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function setupSeat(args) {
  const owner = playerId(args.side);
  const name = args.name || `AI ${args.side.toUpperCase()}`;

  if (args.game && args.token) {
    return { gameId: args.game, token: args.token, owner };
  }

  if (args.game && args.side === 'a' && !args.token) {
    throw new Error('--game without --token can only join as --side b');
  }

  if (args.game && args.side === 'b') {
    try {
      const joined = await request(args.url, 'POST', `/api/games/${args.game}/join`, { name }, '');
      if (!joined.playerBToken) throw new Error('join response did not include playerBToken');
      console.log(`Joined game ${args.game} as player_b`);
      return { gameId: args.game, token: joined.playerBToken, owner };
    } catch (err) {
      const detail = err.data ? ` ${JSON.stringify(err.data)}` : '';
      throw new Error(`Failed to join game ${args.game}.${detail || ` ${err.message}`}`);
    }
  }

  const created = await request(args.url, 'POST', '/api/games', { mapId: args.map, name }, '');
  if (!created.gameId || !created.playerAToken) throw new Error('create response did not include gameId and playerAToken');
  console.log(`Created game ${created.gameId} as player_a`);
  console.log(`Token: ${created.playerAToken}`);
  return { gameId: created.gameId, token: created.playerAToken, owner };
}

function posKey(pos) {
  return `${pos.q},${pos.r}`;
}

function hexDistance(a, b) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  const ds = -a.q - a.r - (-b.q - b.r);
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds));
}

function neighbors(pos) {
  return HEX_DIRECTIONS.map(d => ({ q: pos.q + d.q, r: pos.r + d.r }));
}

function isValidHex(pos, radius) {
  const s = -pos.q - pos.r;
  return Math.max(Math.abs(pos.q), Math.abs(pos.r), Math.abs(s)) <= radius;
}

function terrainAt(game, pos) {
  const override = game.map.terrainCells.find(c => c.q === pos.q && c.r === pos.r);
  if (override) return override.terrain;
  const cell = game.cells.find(c => c.q === pos.q && c.r === pos.r);
  return cell?.terrain || 'blocker';
}

function occupantAt(game, pos) {
  const unit = game.units.find(u => u.alive && u.q === pos.q && u.r === pos.r);
  if (unit) return { kind: 'unit', entity: unit };
  const hq = Object.values(game.headquarters).find(h => h.alive && h.q === pos.q && h.r === pos.r);
  if (hq) return { kind: 'headquarters', entity: hq };
  return null;
}

function isPassable(game, pos) {
  return isValidHex(pos, game.map.radius) && terrainAt(game, pos) === 'plain';
}

function isEmptyPlain(game, pos) {
  return isPassable(game, pos) && occupantAt(game, pos) === null;
}

function reachableCells(game, unit) {
  const visited = new Set([posKey(unit)]);
  const result = [];
  const queue = [{ pos: { q: unit.q, r: unit.r }, distance: 0 }];

  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    if (current.distance >= unit.moveRange) continue;
    for (const next of neighbors(current.pos)) {
      const key = posKey(next);
      if (visited.has(key)) continue;
      visited.add(key);
      if (!isEmptyPlain(game, next)) continue;
      result.push(next);
      queue.push({ pos: next, distance: current.distance + 1 });
    }
  }

  return result;
}

function livingUnits(game, owner) {
  return game.units.filter(u => u.owner === owner && u.alive);
}

function actionsPerTurn(game) {
  return game.config?.balance?.actionsPerTurn ?? Infinity;
}

function actionsRemaining(game) {
  return Math.max(0, actionsPerTurn(game) - (game.turn?.actionsUsed ?? 0));
}

/** Units the owner can still spend an action point on this turn (not yet activated). */
function activatableUnits(game, owner) {
  return livingUnits(game, owner).filter(u => !u.actionSpent);
}

function enemyTargets(game, owner) {
  const enemy = otherPlayer(owner);
  return [
    ...game.units.filter(u => u.owner === enemy && u.alive).map(u => ({ kind: 'unit', entity: u })),
    { kind: 'headquarters', entity: game.headquarters[enemy] },
  ].filter(t => t.entity.alive);
}

function targetScore(target) {
  if (target.kind === 'headquarters') return 10000 - target.entity.hp;
  const typeBonus = {
    support: 500,
    ranger: 420,
    scout: 350,
    infantry: 320,
    heavy: 250,
  }[target.entity.type] || 0;
  return typeBonus + (target.entity.maxHp - target.entity.hp) * 4 - target.entity.hp;
}

async function tryAttack(game, args, seat, unit) {
  if (unit.hasActed) return false;
  const targets = enemyTargets(game, seat.owner)
    .filter(t => hexDistance(unit, t.entity) <= unit.attackRange)
    .sort((a, b) => targetScore(b) - targetScore(a));
  if (targets.length === 0) return false;
  const target = targets[0].entity;
  await request(args.url, 'POST', `/api/games/${seat.gameId}/attack`, {
    attackerId: unit.id,
    targetId: target.id,
  }, seat.token);
  console.log(`Attack ${unit.id} -> ${target.id}`);
  return true;
}

async function tryHeal(game, args, seat, unit) {
  if (unit.type !== 'support' || unit.hasActed) return false;
  const candidates = livingUnits(game, seat.owner)
    .filter(u => u.id !== unit.id && u.hp < u.maxHp && hexDistance(unit, u) <= unit.attackRange)
    .sort((a, b) => ((b.maxHp - b.hp) / b.maxHp) - ((a.maxHp - a.hp) / a.maxHp));
  if (candidates.length === 0) return false;
  await request(args.url, 'POST', `/api/games/${seat.gameId}/heal`, {
    supportId: unit.id,
    targetId: candidates[0].id,
  }, seat.token);
  console.log(`Heal ${unit.id} -> ${candidates[0].id}`);
  return true;
}

function movementGoal(game, owner, unit) {
  const enemy = otherPlayer(owner);
  if (unit.canCapture) {
    const point = game.controlPoints
      .filter(p => p.owner !== owner)
      .sort((a, b) => hexDistance(unit, a) - hexDistance(unit, b))[0];
    if (point) return point;
  }

  const vulnerableEnemy = game.units
    .filter(u => u.owner === enemy && u.alive)
    .sort((a, b) => targetScore({ kind: 'unit', entity: b }) - targetScore({ kind: 'unit', entity: a }))[0];
  if (vulnerableEnemy && unit.type === 'ranger') return vulnerableEnemy;
  return game.headquarters[enemy];
}

async function tryMove(game, args, seat, unit) {
  if (unit.hasMoved) return false;
  if (!unit.actionSpent && actionsRemaining(game) <= 0) return false;
  const reachable = reachableCells(game, unit);
  if (reachable.length === 0) return false;
  const goal = movementGoal(game, seat.owner, unit);
  const currentDistance = hexDistance(unit, goal);
  const best = reachable
    .map(pos => ({ pos, distance: hexDistance(pos, goal) }))
    .filter(item => item.distance < currentDistance || unit.canCapture)
    .sort((a, b) => a.distance - b.distance)[0];
  if (!best) return false;
  await request(args.url, 'POST', `/api/games/${seat.gameId}/move`, {
    unitId: unit.id,
    q: best.pos.q,
    r: best.pos.r,
  }, seat.token);
  console.log(`Move ${unit.id} -> ${best.pos.q},${best.pos.r}`);
  return true;
}

function deployOrigins(game, owner) {
  return [
    game.headquarters[owner],
    ...game.controlPoints.filter(p => p.owner === owner),
  ].filter(origin => origin && origin.alive !== false);
}

function deployChoice(game, owner) {
  const supplies = game.resources[owner].supplies;
  const friendly = livingUnits(game, owner);
  const damaged = friendly.filter(u => u.hp < u.maxHp * 0.65).length;
  const counts = Object.fromEntries(['infantry', 'scout', 'heavy', 'ranger', 'support'].map(t => [t, friendly.filter(u => u.type === t).length]));
  const specs = game.config.units;

  const preferences = [];
  if (damaged >= 2 && counts.support < 2) preferences.push('support');
  if (game.turn.turnNumber <= 3) preferences.push('scout', 'infantry');
  preferences.push('ranger', 'heavy', 'infantry', 'scout', 'support');
  return preferences.find(type => specs[type] && supplies >= specs[type].cost) || null;
}

async function tryDeploy(game, args, seat) {
  if (actionsRemaining(game) <= 0) return false;
  const unitType = deployChoice(game, seat.owner);
  if (!unitType) return false;

  const enemyHq = game.headquarters[otherPlayer(seat.owner)];
  const candidateMoves = [];
  for (const origin of deployOrigins(game, seat.owner)) {
    for (const pos of neighbors(origin)) {
      if (isEmptyPlain(game, pos)) {
        candidateMoves.push({ origin, pos, distance: hexDistance(pos, enemyHq) });
      }
    }
  }
  candidateMoves.sort((a, b) => a.distance - b.distance);
  if (candidateMoves.length === 0) return false;

  const pick = candidateMoves[0];
  await request(args.url, 'POST', `/api/games/${seat.gameId}/deploy`, {
    unitType,
    fromId: pick.origin.id,
    q: pick.pos.q,
    r: pick.pos.r,
  }, seat.token);
  console.log(`Deploy ${unitType} at ${pick.pos.q},${pick.pos.r}`);
  return true;
}

async function readGame(args, seat) {
  return request(args.url, 'GET', `/api/games/${seat.gameId}`, undefined, seat.token);
}

async function refreshAfterAction(args, seat) {
  return readGame(args, seat);
}

async function playOwnedTurn(game, args, seat) {
  let acted = false;

  for (let guard = 0; guard < 80; guard++) {
    let changed = false;
    const units = livingUnits(game, seat.owner)
      .sort((a, b) => (a.hasActed - b.hasActed) || targetScore({ kind: 'unit', entity: b }) - targetScore({ kind: 'unit', entity: a }));

    for (const unit of units) {
      try {
        if (await tryAttack(game, args, seat, unit)) {
          game = await refreshAfterAction(args, seat);
          acted = changed = true;
          break;
        }
        if (await tryHeal(game, args, seat, unit)) {
          game = await refreshAfterAction(args, seat);
          acted = changed = true;
          break;
        }
      } catch (err) {
        console.error(`Action failed: ${err.message}`);
      }
    }
    if (game.winner) break;
    if (changed) continue;

    for (const unit of livingUnits(game, seat.owner)) {
      try {
        if (await tryMove(game, args, seat, unit)) {
          game = await refreshAfterAction(args, seat);
          acted = changed = true;
          break;
        }
      } catch (err) {
        console.error(`Move failed: ${err.message}`);
      }
    }
    if (changed) continue;

    try {
      if (await tryDeploy(game, args, seat)) {
        game = await refreshAfterAction(args, seat);
        acted = changed = true;
      }
    } catch (err) {
      console.error(`Deploy failed: ${err.message}`);
    }
    if (!changed) break;
  }

  if (!game.winner) {
    await request(args.url, 'POST', `/api/games/${seat.gameId}/end-turn`, {}, seat.token);
    console.log(`End turn ${game.turn.turnNumber} (${seat.owner})${acted ? '' : ' with no useful action'}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const seat = await setupSeat(args);
  console.log(`Playing ${seat.owner} in game ${seat.gameId}`);

  let playedTurns = 0;
  while (playedTurns < args.maxTurns) {
    let game = await readGame(args, seat);
    if (game.winner || game.phase === 'game_over') {
      console.log(`Game over. Winner: ${game.winner}`);
      return;
    }
    if (game.phase !== 'waiting_command') {
      console.log(`Waiting for game to start: ${game.phase}`);
      await sleep(args.delayMs);
      continue;
    }
    if (game.turn.currentOwner !== seat.owner) {
      await sleep(args.delayMs);
      continue;
    }

    await playOwnedTurn(game, args, seat);
    playedTurns += 1;
    if (args.once) return;
    await sleep(args.delayMs);
  }

  console.log(`Stopped after ${playedTurns} owned turns without a winner.`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
