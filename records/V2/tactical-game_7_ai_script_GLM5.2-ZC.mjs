// Autoplay script for Hex game - Player B side, polls and plays turns until game over.
import { setTimeout as sleep } from 'node:timers/promises';

const BASE = 'http://localhost:3100';
const GAME = 'bca5b803-61b9-4777-b4b3-6d4e24ded03d';
const TOKEN = '0cec96a5ed813542198be95def333ae6';
const ME = 'player_b';
const ENEMY = 'player_a';

const HEAD = { 'X-Player-Token': TOKEN, 'Content-Type': 'application/json' };

async function api(path, method = 'GET', body = null) {
  const opt = { method, headers: HEAD };
  if (body) opt.body = JSON.stringify(body);
  const r = await fetch(BASE + path, opt);
  const txt = await r.text();
  try { return { status: r.status, json: JSON.parse(txt) }; }
  catch { return { status: r.status, json: { _raw: txt } }; }
}

function hexDist(a, b) {
  const dq = a.q - b.q, dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
}

async function state() { return (await api('/api/games/' + GAME)).json; }

// Six axial neighbors (pointy-top)
const NEIGHBORS = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];

// impassable terrain (must avoid)
const BLOCKED = new Set([
  '-1,-2','0,-2','1,-2','-1,2','0,2','1,2', // water
  '-2,0','2,0','-5,-2','5,2' // blockers
]);

function isBlocked(q, r) {
  return BLOCKED.has(q + ',' + r);
}

// BFS reachable cells within range from start, avoiding blocked/units/hq
function reachable(s, start, range) {
  const occupied = new Map();
  for (const u of s.units) if (u.alive) occupied.set(u.q + ',' + u.r, true);
  occupied.set(s.headquarters.player_a.q + ',' + s.headquarters.player_a.r, true);
  occupied.set(s.headquarters.player_b.q + ',' + s.headquarters.player_b.r, true);
  const dist = new Map([[start.q + ',' + start.r, 0]]);
  const q = [[start.q, start.r, 0]];
  const res = [];
  while (q.length) {
    const [cq, cr, d] = q.shift();
    if (d >= range) continue;
    for (const [dq, dr] of NEIGHBORS) {
      const nq = cq + dq, nr = cr + dr, key = nq + ',' + nr;
      if (dist.has(key)) continue;
      if (isBlocked(nq, nr)) continue;
      if (occupied.has(key)) continue;
      // bounds check (radius 8 hex)
      if (Math.max(Math.abs(nq), Math.abs(nr), Math.abs(nq + nr)) > 8) continue;
      dist.set(key, d + 1);
      q.push([nq, nr, d + 1]);
      res.push({ q: nq, r: nr, d: d + 1 });
    }
  }
  return res;
}

async function playTurn() {
  let s = await state();
  if (s.winner) return s;
  const maxActions = s.config.balance.actionsPerTurn;
  let safety = 40;
  while (s.turn.currentOwner === ME && !s.winner && safety-- > 0) {
    if (s.turn.actionsUsed >= maxActions) {
      await api('/api/games/' + GAME + '/end-turn', 'POST', {});
      console.log('  end-turn (action limit)');
      break;
    }
    const mine = s.units.filter(u => u.owner === ME && u.alive);
    const enemyHQ = s.headquarters[ENEMY];
    const myHQ = s.headquarters[ME];

    // 1) Attack enemy HQ if any in-range unit can (highest priority)
    const foes = s.units.filter(u => u.owner === ENEMY && u.alive);
    let acted = false;
    for (const a of mine) {
      if (a.hasActed) continue;
      if (hexDist(a, enemyHQ) <= a.attackRange) {
        const r = await api('/api/games/' + GAME + '/attack', 'POST', { attackerId: a.id, targetId: enemyHQ.id });
        if (r.json.ok) { console.log('  ATTACK HQ', a.type, 'dmg'); s = await state(); acted = true; break; }
      }
    }
    if (acted) continue;

    // 2) Attack killable/low-hp enemies; prefer support/ranger/capturing
    const priority = (t) => ({ support: 0, ranger: 1, scout: 2, infantry: 3, heavy: 4 }[t.type] ?? 5);
    const inRangeFoes = [...foes].filter(t => mine.some(a => !a.hasActed && hexDist(a, t) <= a.attackRange))
      .sort((x, y) => (x.hp - y.hp) || (priority(x) - priority(y)));
    for (const t of inRangeFoes) {
      // find best attacker (highest attack among those in range, not acted)
      const cand = mine.filter(a => !a.hasActed && hexDist(a, t) <= a.attackRange)
        .sort((x, y) => y.attack - x.attack);
      for (const a of cand) {
        const r = await api('/api/games/' + GAME + '/attack', 'POST', { attackerId: a.id, targetId: t.id });
        if (r.json.ok) { console.log('  attack', a.type, '->', t.type, t.hp); s = await state(); acted = true; break; }
        else { console.log('    atk fail', r.json.code); }
      }
      if (acted) break;
    }
    if (acted) continue;

    // 3) Heal: support heal most wounded adjacent friendly
    const supports = mine.filter(u => u.type === 'support' && !u.hasActed);
    for (const sup of supports) {
      const wounded = mine.filter(u => u.alive && u.hp < u.maxHp - 5)
        .sort((x, y) => (x.hp / x.maxHp) - (y.hp / y.maxHp));
      let didHeal = false;
      for (const w of wounded) {
        if (hexDist(sup, w) <= 1) {
          const r = await api('/api/games/' + GAME + '/heal', 'POST', { supportId: sup.id, targetId: w.id });
          if (r.json.ok) { console.log('  heal', w.type, w.hp, '->'); s = await state(); didHeal = true; break; }
        }
      }
      if (didHeal) { acted = true; break; }
    }
    if (acted) continue;

    // 4) Move: combat units toward enemy HQ using reachable set; capturing units grab nearby CPs first
    const cpsNeutral = s.controlPoints.filter(cp => cp.owner !== ME);
    const movers = mine.filter(u => !u.hasActed && u.type !== 'support')
      .sort((a, b) => hexDist(a, enemyHQ) - hexDist(b, enemyHQ));
    for (const u of movers) {
      const reach = reachable(s, u, u.moveRange);
      // capturing units: if a neutral CP is reachable, go there
      let best = null;
      if (u.canCapture) {
        for (const cp of cpsNeutral) {
          const hit = reach.find(c => c.q === cp.q && c.r === cp.r);
          if (hit) { best = hit; break; }
        }
      }
      if (!best) {
        // move toward enemy HQ; prefer cells that keep/increase attack options
        best = reach.sort((x, y) => {
          const dx = hexDist(x, enemyHQ) - hexDist(y, enemyHQ);
          if (dx !== 0) return dx;
          // tie-break: stay near damaged friendlies if support-like, else toward foes
          return 0;
        })[0];
      }
      if (best) {
        const r = await api('/api/games/' + GAME + '/move', 'POST', { unitId: u.id, q: best.q, r: best.r });
        if (r.json.ok) { console.log('  move', u.type, 'to', best.q, best.r, '(HQd', hexDist(best, enemyHQ) + ')'); s = await state(); acted = true; break; }
        else { console.log('    move fail', r.json.code); }
      }
    }
    if (acted) continue;

    // 5) Deploy: prefer ranger(75) > heavy(90) > support(60) > infantry(45) > scout(40) based on supplies
    const supplies = s.resources[ME].supplies;
    const myCps = s.controlPoints.filter(cp => cp.owner === ME);
    // also deploy from my HQ
    const deploySources = [...myCps, { id: myHQ.id, q: myHQ.q, r: myHQ.r }];
    const typeOrder = supplies >= 90 ? ['heavy', 'ranger', 'support', 'infantry']
      : supplies >= 75 ? ['ranger', 'support', 'infantry', 'scout']
      : supplies >= 60 ? ['support', 'infantry', 'scout']
      : supplies >= 45 ? ['infantry', 'scout'] : supplies >= 40 ? ['scout'] : [];
    let deployed = false;
    for (const src of deploySources) {
      for (const [dq, dr] of NEIGHBORS) {
        const tq = src.q + dq, tr = src.r + dr;
        if (isBlocked(tq, tr)) continue;
        if (s.units.some(u => u.alive && u.q === tq && u.r === tr)) continue;
        for (const t of typeOrder) {
          const r = await api('/api/games/' + GAME + '/deploy', 'POST', { unitType: t, fromId: src.id, q: tq, r: tr });
          if (r.json.ok) { console.log('  deploy', t, 'at', tq, tr, 'from', src.id.slice(0, 6)); deployed = true; break; }
        }
        if (deployed) break;
      }
      if (deployed) break;
    }
    if (deployed) { s = await state(); continue; }

    // 6) Nothing useful - end turn
    await api('/api/games/' + GAME + '/end-turn', 'POST', {});
    console.log('  end-turn (no actions)');
    break;
  }
  return await state();
}

async function main() {
  for (;;) {
    let s = await state();
    if (s.winner) {
      console.log('GAME OVER. Winner:', s.winner);
      break;
    }
    if (s.turn.currentOwner === ME) {
      console.log('=== My turn', s.turn.turnNumber, '(B) supplies', s.resources[ME].supplies, 'actions', s.turn.actionsUsed, '===');
      s = await playTurn();
      if (s.winner) { console.log('GAME OVER. Winner:', s.winner); break; }
    }
    await sleep(2500);
  }
  const s = await state();
  console.log('Final: A HQ', s.headquarters.player_a.hp, '| B HQ', s.headquarters.player_b.hp, '| winner', s.winner);
  console.log('A alive:', s.units.filter(u => u.owner === 'player_a' && u.alive).length, '| B alive:', s.units.filter(u => u.owner === 'player_b' && u.alive).length);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
