const CELL = 28;
const GRID_COLOR = '#244';

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const gameSelect = document.getElementById('game-select');
const refreshBtn = document.getElementById('refresh-list');
const statusEl = document.getElementById('status');
const resourcesEl = document.getElementById('resources');
const turnInfoEl = document.getElementById('turn-info');
const eventsEl = document.getElementById('events');

let state = null;
let sse = null;

async function fetchGameList() {
  const res = await fetch('/api/games');
  const { games } = await res.json();
  gameSelect.innerHTML = '<option value="">-- 选择对局 --</option>';
  for (const g of games) {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = `${g.id.slice(0, 8)} — ${g.phase} (回合 ${g.turnNumber}, ${g.currentOwner})`;
    gameSelect.appendChild(opt);
  }
}

async function loadGameState(id) {
  state = null;
  const res = await fetch(`/api/games/${id}/events`);
  const { events } = await res.json();
  state = reconstructState(events);
  drawBoard();
  renderSidebar();
}

function reconstructState(events) {
  const s = {
    mapWidth: 30, mapHeight: 30,
    miningPoints: [],
    units: new Map(), buildings: new Map(),
    resources: { player_a: { gold: 100 }, player_b: { gold: 100 } },
    turn: { turnNumber: 1, currentOwner: 'player_a', phase: 'waiting_command' },
    eventLog: [], winner: null,
  };
  for (const ev of events) applyEvent(s, ev);
  return s;
}

function applyEvent(s, ev) {
  s.eventLog.push(ev);
  switch (ev.type) {
    case 'game_start':
      s.mapWidth = ev.payload.mapWidth ?? 30;
      s.mapHeight = ev.payload.mapHeight ?? 30;
      s.miningPoints = ev.payload.miningPoints ?? [];
      s.buildings.set('hq_a', { id: 'hq_a', owner: 'player_a', type: 'headquarters', x: 4, y: 15, hp: 200, maxHp: 200, alive: true, isBuilding: false });
      s.buildings.set('hq_b', { id: 'hq_b', owner: 'player_b', type: 'headquarters', x: 25, y: 15, hp: 200, maxHp: 200, alive: true, isBuilding: false });
      break;
    case 'build':
      s.buildings.set(ev.payload.buildingId, {
        id: ev.payload.buildingId, owner: ev.payload.owner, type: ev.payload.type,
        x: ev.payload.x, y: ev.payload.y, hp: 60, maxHp: 60, alive: true, isBuilding: true,
      });
      break;
    case 'build_complete': {
      const b = s.buildings.get(ev.payload.buildingId);
      if (b) b.isBuilding = false;
      break;
    }
    case 'produce_complete':
      s.units.set(ev.payload.unitId, {
        id: ev.payload.unitId, owner: ev.payload.owner, type: ev.payload.type,
        x: ev.payload.x, y: ev.payload.y, hp: 100, maxHp: 100, alive: true,
      });
      break;
    case 'move': {
      const u = s.units.get(ev.payload.unitId);
      if (u) { u.x = ev.payload.toX; u.y = ev.payload.toY; }
      break;
    }
    case 'attack': {
      const t = s.units.get(ev.payload.targetId) || s.buildings.get(ev.payload.targetId);
      if (t) t.hp = ev.payload.targetHp;
      break;
    }
    case 'heal': {
      const t = s.units.get(ev.payload.targetId);
      if (t) t.hp = ev.payload.targetHp;
      break;
    }
    case 'unit_death': {
      const u = s.units.get(ev.payload.unitId);
      if (u) u.alive = false;
      break;
    }
    case 'base_destroyed': {
      const b = s.buildings.get(ev.payload.buildingId);
      if (b) b.alive = false;
      break;
    }
    case 'mine':
    case 'base_income':
      s.resources[ev.payload.owner].gold += ev.payload.amount;
      break;
    case 'reset_actions':
      for (const u of s.units.values()) {
        if (u.owner === ev.payload.owner) {
          u.hasMoved = false;
          u.hasAttacked = false;
        }
      }
      break;
    case 'turn_end':
      s.turn.currentOwner = ev.payload.nextOwner;
      s.turn.turnNumber = ev.payload.turnNumber;
      break;
    case 'game_over':
      s.turn.phase = 'game_over';
      s.winner = ev.payload.winner;
      break;
  }
}

function drawBoard() {
  if (!state) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;
  for (let i = 0; i <= state.mapWidth; i++) {
    ctx.beginPath(); ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, state.mapHeight * CELL); ctx.stroke();
  }
  for (let j = 0; j <= state.mapHeight; j++) {
    ctx.beginPath(); ctx.moveTo(0, j * CELL); ctx.lineTo(state.mapWidth * CELL, j * CELL); ctx.stroke();
  }
  ctx.fillStyle = '#b80';
  for (const p of state.miningPoints) {
    ctx.beginPath();
    ctx.arc(p.x * CELL + CELL / 2, p.y * CELL + CELL / 2, 4, 0, 6.28);
    ctx.fill();
  }
  for (const b of state.buildings.values()) {
    if (!b.alive) continue;
    const color = b.owner === 'player_a' ? '#3a8ad9' : '#d96a3a';
    ctx.fillStyle = b.isBuilding ? '#666' : color;
    ctx.fillRect(b.x * CELL + 2, b.y * CELL + 2, CELL - 4, CELL - 4);
    ctx.fillStyle = '#fff';
    ctx.font = '10px sans-serif';
    const letter = b.type === 'headquarters' ? 'H' : b.type === 'barracks' ? 'B' : 'M';
    ctx.fillText(letter, b.x * CELL + CELL / 2 - 3, b.y * CELL + CELL / 2 + 4);
  }
  for (const u of state.units.values()) {
    if (!u.alive) continue;
    const color = u.owner === 'player_a' ? '#6cf' : '#f86';
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(u.x * CELL + CELL / 2, u.y * CELL + CELL / 2, CELL / 3, 0, 6.28);
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.font = '9px sans-serif';
    const letter = u.type === 'infantry' ? 'I' : u.type === 'sniper' ? 'S' : u.type === 'tank' ? 'T' : 'M';
    ctx.fillText(letter, u.x * CELL + CELL / 2 - 3, u.y * CELL + CELL / 2 + 3);
  }
}

function renderSidebar() {
  if (!state) return;
  resourcesEl.innerHTML = `
    <h3>资源</h3>
    <div><span class="player-a">玩家 A</span>: ${state.resources.player_a.gold} 金</div>
    <div><span class="player-b">玩家 B</span>: ${state.resources.player_b.gold} 金</div>
  `;
  turnInfoEl.innerHTML = `
    <h3>回合 ${state.turn.turnNumber}</h3>
    <div>当前: <span class="${state.turn.currentOwner === 'player_a' ? 'player-a' : 'player-b'}">${state.turn.currentOwner}</span></div>
    ${state.winner ? `<div>胜者: <strong>${state.winner}</strong></div>` : ''}
  `;
  eventsEl.innerHTML = '';
  for (const ev of state.eventLog.slice(-30)) {
    const li = document.createElement('li');
    li.textContent = `#${ev.seq} ${ev.type} ${JSON.stringify(ev.payload).slice(0, 80)}`;
    eventsEl.appendChild(li);
  }
}

function subscribeSse(id) {
  if (sse) sse.close();
  sse = new EventSource(`/api/games/${id}/events`);
  sse.onmessage = e => {
    try {
      const ev = JSON.parse(e.data);
      applyEvent(state, ev);
      drawBoard();
      renderSidebar();
    } catch (err) { console.error(err); }
  };
  sse.onerror = () => { statusEl.textContent = 'SSE 断开'; };
}

gameSelect.addEventListener('change', async () => {
  const id = gameSelect.value;
  if (!id) return;
  await loadGameState(id);
  subscribeSse(id);
  statusEl.textContent = '已订阅事件';
});
refreshBtn.addEventListener('click', fetchGameList);

fetchGameList();
