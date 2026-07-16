import { pathToFileURL } from 'node:url';

const DEFAULT_URL = process.env.TACTICAL_GAME_URL || '';
const HEX_DIRECTIONS = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];
const PLAYER_IDS = ['player_a', 'player_b', 'player_c', 'player_d', 'player_e', 'player_f', 'player_g', 'player_h'];

function parseArgs(argv) {
  const args = {
    url: DEFAULT_URL,
    side: 'a',
    game: '',
    token: '',
    hostToken: '',
    map: 'default',
    name: '',
    maxPlayers: 2,
    maxTurns: 80,
    delayMs: 500,
    once: false,
    autoStart: true,
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
    else if (arg === '--host-token') args.hostToken = next();
    else if (arg === '--map') args.map = next();
    else if (arg === '--name') args.name = next();
    else if (arg === '--max-players') args.maxPlayers = Number(next());
    else if (arg === '--max-turns') args.maxTurns = Number(next());
    else if (arg === '--delay-ms') args.delayMs = Number(next());
    else if (arg === '--once') args.once = true;
    else if (arg === '--no-auto-start') args.autoStart = false;
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  playerId(args.side);
  if (!Number.isInteger(args.maxPlayers) || args.maxPlayers < 2 || args.maxPlayers > 8) {
    throw new Error('--max-players must be an integer from 2 to 8');
  }
  if (!Number.isFinite(args.maxTurns) || args.maxTurns < 1) throw new Error('--max-turns must be a positive number');
  if (!Number.isFinite(args.delayMs) || args.delayMs < 0) throw new Error('--delay-ms must be a non-negative number');
  if (!args.url) throw new Error('--url is required (or set TACTICAL_GAME_URL)');
  args.url = args.url.replace(/\/+$/, '');
  return args;
}

function printHelp() {
  console.log(`Usage:
  node skill/ai-player.mjs --url <serverUrl> --side a [--map default] [--max-players 2]
  node skill/ai-player.mjs --url <serverUrl> --side b --game <gameId>
  node skill/ai-player.mjs --url <serverUrl> --side player_c --game <gameId> --token <playerToken>

Options:
  --url <url>          API base URL; required unless TACTICAL_GAME_URL is set
  --side <a-h|player_a-player_h> Expected seat when joining; create always becomes player_a
  --game <id>          Existing game id
  --token <token>      Existing player token
  --host-token <token> Host token used to auto-start a lobby
  --map <mapId>        Map id for new games, default default
  --max-players <n>    Lobby size for new games, 2-8, default 2
  --name <name>        Player display name
  --max-turns <n>      Stop after this many owned turns, default 80
  --delay-ms <n>       Poll delay while waiting, default 500
  --once               Play at most one owned turn
  --no-auto-start      Do not call /start even when a host token is available
`);
}

function playerId(side) {
  if (PLAYER_IDS.includes(side)) return side;
  if (/^[a-h]$/.test(side)) return `player_${side}`;
  throw new Error('--side must be a-h or player_a-player_h');
}

function playerLabel(owner) {
  return owner.replace('player_', '').toUpperCase();
}

function activePlayerIds(game) {
  if (game.players) {
    return PLAYER_IDS.filter(id => game.players[id]?.status === 'active');
  }
  return Object.keys(game.headquarters || {}).filter(id => game.headquarters[id]?.alive !== false);
}

function enemyPlayerIds(game, owner) {
  return activePlayerIds(game).filter(id => id !== owner);
}

function nearestEnemyHeadquarters(game, owner, from) {
  return enemyPlayerIds(game, owner)
    .map(id => game.headquarters[id])
    .filter(Boolean)
    .sort((a, b) => hexDistance(from, a) - hexDistance(from, b))[0] || null;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function request(baseUrl, method, path, body, token, hostToken) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['X-Player-Token'] = token;
  if (hostToken) headers['X-Host-Token'] = hostToken;
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
  const expectedOwner = playerId(args.side);
  const name = args.name || `AI ${playerLabel(expectedOwner)}`;

  if (args.game && args.token) {
    return {
      gameId: args.game,
      token: args.token,
      owner: expectedOwner,
      hostToken: args.hostToken || '',
      autoStart: args.autoStart && Boolean(args.hostToken),
    };
  }

  if (args.game && !args.token) {
    try {
      const joined = await request(args.url, 'POST', `/api/games/${args.game}/join`, { name }, '');
      if (!joined.player?.token || !joined.player?.id) throw new Error('join response did not include player token');
      if (joined.player.id !== expectedOwner) {
        throw new Error(`joined as ${joined.player.id}, expected ${expectedOwner}; pass --token for an existing seat`);
      }
      console.log(`Joined game ${args.game} as ${joined.player.id}`);
      return {
        gameId: args.game,
        token: joined.player.token,
        owner: joined.player.id,
        hostToken: args.hostToken || '',
        autoStart: args.autoStart && Boolean(args.hostToken),
      };
    } catch (err) {
      const detail = err.data ? ` ${JSON.stringify(err.data)}` : '';
      throw new Error(`Failed to join game ${args.game}.${detail || ` ${err.message}`}`);
    }
  }

  if (expectedOwner !== 'player_a') {
    throw new Error('creating a lobby always assigns player_a; pass --game to join another seat');
  }

  const created = await request(args.url, 'POST', '/api/games', {
    mapId: args.map,
    maxPlayers: args.maxPlayers,
    participate: true,
    playerName: name,
  }, '');
  if (!created.gameId || !created.player?.token || !created.player?.id || !created.hostToken) {
    throw new Error('create response did not include gameId, hostToken, and player token');
  }
  console.log(`Created lobby ${created.gameId} as ${created.player.id} (maxPlayers=${args.maxPlayers})`);
  console.log(`Host token: ${created.hostToken}`);
  return {
    gameId: created.gameId,
    token: created.player.token,
    owner: created.player.id,
    hostToken: created.hostToken,
    autoStart: args.autoStart,
  };
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

function controlPointEffect(game, point) {
  if (!point?.kind) return null;
  return game.config?.balance?.controlPointTypes?.[point.kind] || null;
}

function effectiveDeployCost(game, unitType, origin) {
  const base = game.config.units[unitType].cost;
  const discount = controlPointEffect(game, origin)?.deployDiscount || 0;
  return Math.max(0, base - discount);
}

function controlPointPriority(game, point) {
  const effect = controlPointEffect(game, point);
  if (!effect) return 8;
  if (point.kind === 'supply') return 16;
  if (point.kind === 'forward_base') return 13;
  if (point.kind === 'repair') return 11;
  return effect.income || 8;
}

function nearestOwnedRepairPoint(game, owner, unit) {
  if (unit.hp >= unit.maxHp * 0.7) return null;
  return game.controlPoints
    .filter(point => point.owner === owner && point.kind === 'repair' && (controlPointEffect(game, point)?.repairAmount || 0) > 0)
    .sort((a, b) => hexDistance(unit, a) - hexDistance(unit, b))[0] || null;
}

/** Units the owner can still spend an action point on this turn (not yet activated). */
function activatableUnits(game, owner) {
  return livingUnits(game, owner).filter(u => !u.actionSpent);
}

function enemyTargets(game, owner) {
  return [
    ...game.units.filter(u => u.owner !== owner && u.alive && enemyPlayerIds(game, owner).includes(u.owner)).map(u => ({ kind: 'unit', entity: u })),
    ...enemyPlayerIds(game, owner).map(id => ({ kind: 'headquarters', entity: game.headquarters[id] })),
  ].filter(t => t.entity?.alive);
}

function targetScore(target) {
  if (target.kind === 'headquarters') return 10000 - target.entity.hp;
  const typeBonus = {
    support: 500,
    ranger: 420,
    scout: 350,
    infantry: 320,
    heavy: 180,
  }[target.entity.type] || 0;
  const heavyPenalty = target.entity.type === 'heavy' && target.entity.hp > 80 ? 180 : 0;
  return typeBonus + (target.entity.maxHp - target.entity.hp) * 4 - target.entity.hp - heavyPenalty;
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

export function movementGoal(game, owner, unit) {
  const ownedPoints = game.controlPoints.filter(p => p.owner === owner).length;
  const endgamePush = game.turn.turnNumber >= 8 || ownedPoints >= 3;
  const adjudicationMode = game.turn.turnNumber >= 15;
  const enemyHq = nearestEnemyHeadquarters(game, owner, unit);

  if (enemyHq && (endgamePush || adjudicationMode) && ['scout', 'ranger', 'infantry'].includes(unit.type)) {
    return enemyHq;
  }

  const repairPoint = nearestOwnedRepairPoint(game, owner, unit);
  if (repairPoint) return repairPoint;

  if (unit.canCapture) {
    const point = game.controlPoints
      .filter(p => p.owner !== owner)
      .sort((a, b) =>
        (controlPointPriority(game, b) - hexDistance(unit, b)) -
        (controlPointPriority(game, a) - hexDistance(unit, a)))[0];
    if (point) return point;
  }

  const vulnerableEnemy = game.units
    .filter(u => u.owner !== owner && u.alive && enemyPlayerIds(game, owner).includes(u.owner))
    .sort((a, b) => targetScore({ kind: 'unit', entity: b }) - targetScore({ kind: 'unit', entity: a }))[0];
  if (vulnerableEnemy && unit.type === 'ranger') return vulnerableEnemy;
  return enemyHq || game.controlPoints.find(p => p.owner !== owner) || unit;
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

function deployChoice(game, owner, origins = deployOrigins(game, owner)) {
  const supplies = game.resources[owner].supplies;
  const friendly = livingUnits(game, owner);
  const damaged = friendly.filter(u => u.hp < u.maxHp * 0.65).length;
  const counts = Object.fromEntries(['infantry', 'scout', 'heavy', 'ranger', 'support'].map(t => [t, friendly.filter(u => u.type === t).length]));
  const specs = game.config.units;

  const preferences = [];
  if (damaged >= 2 && counts.support < 2) preferences.push('support');
  if (game.turn.turnNumber <= 3) preferences.push('scout', 'infantry');
  preferences.push('ranger', 'heavy', 'infantry', 'scout', 'support');
  return preferences.find(type =>
    specs[type] && origins.some(origin => supplies >= effectiveDeployCost(game, type, origin))) || null;
}

export function shouldStrategicDeploy(game, owner) {
  if (actionsRemaining(game) <= 0) return false;
  if (!deployChoice(game, owner)) return false;
  const friendly = livingUnits(game, owner).length;
  const enemy = enemyPlayerIds(game, owner).reduce((sum, id) => sum + livingUnits(game, id).length, 0);
  const ownedPoints = game.controlPoints.filter(p => p.owner === owner).length;
  const supplies = game.resources[owner].supplies;
  return supplies >= 90 || friendly <= enemy || ownedPoints >= 2 || game.turn.turnNumber >= 8;
}

async function tryDeploy(game, args, seat) {
  if (actionsRemaining(game) <= 0) return false;
  const origins = deployOrigins(game, seat.owner);
  const unitType = deployChoice(game, seat.owner, origins);
  if (!unitType) return false;

  const enemyHq = nearestEnemyHeadquarters(game, seat.owner, origins[0]) || origins[0];
  const candidateMoves = [];
  for (const origin of origins) {
    const cost = effectiveDeployCost(game, unitType, origin);
    if (game.resources[seat.owner].supplies < cost) continue;
    for (const pos of neighbors(origin)) {
      if (isEmptyPlain(game, pos)) {
        candidateMoves.push({ origin, pos, distance: hexDistance(pos, enemyHq), cost });
      }
    }
  }
  candidateMoves.sort((a, b) => (a.distance - b.distance) || (a.cost - b.cost));
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

async function readLobby(args, seat) {
  return request(args.url, 'GET', `/api/games/${seat.gameId}/lobby`, undefined, '');
}

async function refreshAfterAction(args, seat) {
  return readGame(args, seat);
}

async function tryStartLobby(args, seat) {
  if (!seat.autoStart || !seat.hostToken) return false;
  try {
    const lobby = await readLobby(args, seat);
    if (lobby.phase !== 'lobby') return false;
    const count = lobby.playerCount || 0;
    const maxPlayers = lobby.maxPlayers || 0;
    // 默认等人满再开局，避免 4 人房在 2 人时提前 start。
    if (count < 2 || (maxPlayers > 0 && count < maxPlayers)) {
      console.log(`Waiting for more players before start: ${count}/${maxPlayers || '?'}`);
      return false;
    }
    await request(args.url, 'POST', `/api/games/${seat.gameId}/start`, {}, undefined, seat.hostToken);
    console.log(`Started game ${seat.gameId} with ${count} players`);
    return true;
  } catch (err) {
    if (err.data?.code === 'lobby_not_ready' || err.data?.code === 'game_already_started') return false;
    console.error(`Start failed: ${err.message}`);
    return false;
  }
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

    try {
      if (shouldStrategicDeploy(game, seat.owner) && await tryDeploy(game, args, seat)) {
        game = await refreshAfterAction(args, seat);
        acted = changed = true;
      }
    } catch (err) {
      console.error(`Deploy failed: ${err.message}`);
    }
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
    const game = await readGame(args, seat);

    if (game.winner || game.phase === 'game_over') {
      console.log(`Game over. Winner: ${game.winner}`);
      return;
    }

    const self = game.players?.[seat.owner];
    if (self && self.status && self.status !== 'active' && game.phase === 'active') {
      console.log(`Eliminated as ${seat.owner} (status=${self.status}).`);
      return;
    }

    if (game.phase === 'lobby') {
      await tryStartLobby(args, seat);
      console.log(`Waiting for game to start: lobby`);
      await sleep(args.delayMs);
      continue;
    }

    if (game.phase !== 'active') {
      console.log(`Waiting for game to start: ${game.phase}`);
      await sleep(args.delayMs);
      continue;
    }

    if ((game.turn.currentPlayerId ?? game.turn.currentOwner) !== seat.owner) {
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}
