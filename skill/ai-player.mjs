#!/usr/bin/env node
// Hex V2 AI Player
// Usage: node skill/ai-player.mjs [--url http://localhost:3100] [--side a|b] [--game <id>]

function getArg(name, fallback) {
  const eq = process.argv.find(a => a.startsWith(`${name}=`));
  if (eq) return eq.split('=').slice(1).join('=');
  const idx = process.argv.indexOf(name);
  if (idx !== -1 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return fallback;
}

const BASE_URL = getArg('--url', 'http://localhost:3100');
const SIDE = getArg('--side', 'a');
const GAME_ARG = getArg('--game', null);
const PLAYER_ID = SIDE === 'a' ? 'player_a' : 'player_b';
const ENEMY_ID = SIDE === 'a' ? 'player_b' : 'player_a';

let gameId;
let token;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function hexDistance(a, b) {
  return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs((-a.q - a.r) - (-b.q - b.r)));
}
function hexNeighbors(p) {
  return [{ q: p.q + 1, r: p.r }, { q: p.q + 1, r: p.r - 1 }, { q: p.q, r: p.r - 1 }, { q: p.q - 1, r: p.r }, { q: p.q - 1, r: p.r + 1 }, { q: p.q, r: p.r + 1 }];
}
function key(p) { return `${p.q},${p.r}`; }

async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (token) opts.headers['X-Player-Token'] = token;
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE_URL}${path}`, opts);
  const data = await res.json();
  if (!res.ok && res.status !== 409) console.error(`API ${method} ${path} -> ${res.status}: ${data.error}`);
  return { ok: res.ok, status: res.status, data };
}
async function getState() {
  return (await api('GET', `/api/games/${gameId}`)).data;
}

function my(state) {
  return {
    units: state.units.filter(u => u.owner === PLAYER_ID && u.alive),
    hq: state.headquarters[PLAYER_ID],
    points: state.controlPoints.filter(p => p.owner === PLAYER_ID),
    supplies: state.resources[PLAYER_ID].supplies,
  };
}
function enemy(state) {
  return {
    units: state.units.filter(u => u.owner === ENEMY_ID && u.alive),
    hq: state.headquarters[ENEMY_ID],
    points: state.controlPoints.filter(p => p.owner === ENEMY_ID),
  };
}
function isPlain(state, p) {
  return state.cells.some(c => c.q === p.q && c.r === p.r && c.terrain === 'plain');
}
function occupied(state, p) {
  return state.units.some(u => u.alive && u.q === p.q && u.r === p.r) ||
    Object.values(state.headquarters).some(h => h.alive && h.q === p.q && h.r === p.r);
}
function reachable(state, unit) {
  const result = [];
  const visited = new Set([key(unit)]);
  const queue = [{ q: unit.q, r: unit.r, d: 0 }];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    if (cur.d >= unit.moveRange) continue;
    for (const n of hexNeighbors(cur)) {
      const k = key(n);
      if (visited.has(k)) continue;
      visited.add(k);
      if (!isPlain(state, n) || occupied(state, n)) continue;
      result.push(n);
      queue.push({ ...n, d: cur.d + 1 });
    }
  }
  return result;
}
function deployCells(state, origin) {
  return hexNeighbors(origin).filter(p => isPlain(state, p) && !occupied(state, p));
}

async function setup() {
  if (GAME_ARG) {
    gameId = GAME_ARG;
    const { data } = await api('POST', `/api/games/${gameId}/join`, { name: `AI ${SIDE}` });
    token = data.playerBToken;
    console.log(`Joined ${gameId} as ${PLAYER_ID}`);
  } else {
    const { data } = await api('POST', '/api/games', { name: `AI ${SIDE}` });
    gameId = data.gameId;
    token = data.playerAToken;
    console.log(`Created ${gameId} as ${PLAYER_ID}`);
    console.log('Waiting for opponent...');
    while (true) {
      const st = await getState();
      if (st.phase === 'waiting_command') break;
      await sleep(1000);
    }
  }
}

function pickDeploy(state) {
  const mine = my(state);
  const units = mine.units;
  const injured = units.filter(u => u.hp < u.maxHp).length;
  const counts = Object.fromEntries(['infantry', 'scout', 'heavy', 'ranger', 'support'].map(t => [t, units.filter(u => u.type === t).length]));
  if (counts.infantry < 3) return 'infantry';
  if (counts.scout < 2) return 'scout';
  if (counts.heavy < 2) return 'heavy';
  if (counts.ranger < 2) return 'ranger';
  if (injured >= 2 && counts.support < 2) return 'support';
  return 'infantry';
}

async function deployIfUseful(state) {
  const mine = my(state);
  const type = pickDeploy(state);
  const cost = state.config.units[type].cost;
  if (mine.supplies < cost) return false;
  const origins = [mine.hq, ...mine.points].filter(Boolean)
    .sort((a, b) => hexDistance(a, enemy(state).hq) - hexDistance(b, enemy(state).hq));
  for (const origin of origins) {
    const cells = deployCells(state, origin).sort((a, b) => hexDistance(a, enemy(state).hq) - hexDistance(b, enemy(state).hq));
    if (cells[0]) {
      console.log(`Deploy ${type} at (${cells[0].q},${cells[0].r})`);
      return (await api('POST', `/api/games/${gameId}/deploy`, { unitType: type, fromId: origin.id, q: cells[0].q, r: cells[0].r })).ok;
    }
  }
  return false;
}

function targetScore(target) {
  if (!target.type) return 10000 - target.hp;
  const priority = { support: 500, ranger: 450, heavy: 400, infantry: 350, scout: 300 }[target.type] || 100;
  return priority + (target.maxHp - target.hp);
}

async function actUnit(state, unit) {
  const e = enemy(state);
  if (!unit.hasActed) {
    if (unit.type === 'support') {
      const injured = my(state).units.filter(u => u.id !== unit.id && u.hp < u.maxHp && hexDistance(unit, u) <= unit.attackRange)
        .sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp));
      if (injured[0]) return api('POST', `/api/games/${gameId}/heal`, { supportId: unit.id, targetId: injured[0].id });
    }
    const targets = [...e.units, e.hq].filter(t => t && t.alive && hexDistance(unit, t) <= unit.attackRange)
      .sort((a, b) => targetScore(b) - targetScore(a));
    if (targets[0]) return api('POST', `/api/games/${gameId}/attack`, { attackerId: unit.id, targetId: targets[0].id });
  }

  if (!unit.hasMoved) {
    const neutralOrEnemyPoints = state.controlPoints.filter(p => p.owner !== PLAYER_ID);
    const captureTarget = unit.canCapture && neutralOrEnemyPoints.length
      ? neutralOrEnemyPoints.sort((a, b) => hexDistance(unit, a) - hexDistance(unit, b))[0]
      : null;
    const dest = captureTarget || e.hq;
    const moves = reachable(state, unit).sort((a, b) => hexDistance(a, dest) - hexDistance(b, dest));
    if (moves[0] && hexDistance(moves[0], dest) < hexDistance(unit, dest)) {
      const moved = await api('POST', `/api/games/${gameId}/move`, { unitId: unit.id, q: moves[0].q, r: moves[0].r });
      if (!moved.ok) return moved;
      unit.q = moves[0].q; unit.r = moves[0].r; unit.hasMoved = true;
      const refreshed = await getState();
      const updated = refreshed.units.find(u => u.id === unit.id);
      if (updated && !updated.hasActed) return actUnit(refreshed, updated);
      return moved;
    }
  }
  return { ok: false };
}

async function executeTurn(state) {
  await deployIfUseful(state);
  state = await getState();
  for (const unit of my(state).units.sort((a, b) => {
    const order = { ranger: 0, heavy: 1, infantry: 2, scout: 3, support: 4 };
    return order[a.type] - order[b.type];
  })) {
    state = await getState();
    const fresh = state.units.find(u => u.id === unit.id && u.alive);
    if (fresh) await actUnit(state, fresh);
  }
  await api('POST', `/api/games/${gameId}/end-turn`, {});
}

async function main() {
  await setup();
  while (true) {
    const st = await getState();
    if (st.winner) { console.log(`Game over. Winner: ${st.winner}`); break; }
    if (st.turn.currentOwner !== PLAYER_ID) { await sleep(1200); continue; }
    console.log(`Turn ${st.turn.turnNumber}: ${PLAYER_ID}`);
    await executeTurn(st);
    await sleep(500);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
