/* ════════════════════════════════════════════
   战棋对战 — 玩家控制台
   ════════════════════════════════════════════ */

// ─── constants ───
const CELL = 28;
const COLORS = {
  grid:       '#1a2a30',
  bg:         '#0a0e14',
  gold:       '#da0',
  hq_a:       '#2a60a0',
  hq_b:       '#a04020',
  barracks_a: '#3a8ad9',
  barracks_b: '#d96a3a',
  miner_a:    '#4a9a6a',
  miner_b:    '#9a7a3a',
  building_a: '#3a8ad9',
  building_b: '#d96a3a',
  unit_a:     '#6cf',
  unit_b:     '#f86',
  hq_build_a: '#1a4070',
  hq_build_b: '#703010',
  select:     '#fff',
  hover:      'rgba(255,255,255,.08)',
};

// ─── DOM refs ───
const $ = id => document.getElementById(id);
const els = {
  // join panel
  joinPanel:    $('join-panel'),
  gameId:       $('game-id'),
  playerToken:  $('player-token'),
  mapSelect:    $('map-select'),
  btnCreate:    $('btn-create'),
  btnJoin:      $('btn-join'),
  btnConnect:   $('btn-connect'),
  joinResult:   $('join-result'),
  connStatus:   $('conn-status'),

  // game UI
  gameUI:       $('game-ui'),
  canvas:       $('board'),
  cellInfo:     $('cell-info'),

  // sidebar
  turnBadge:    $('turn-badge'),
  resDisplay:   $('resources-display'),
  btnEndTurn:   $('btn-end-turn'),
  btnRefresh:   $('btn-refresh'),
  selDetail:    $('selection-detail'),
  events:       $('events'),
};

const ctx = els.canvas.getContext('2d');

// ─── game config (derived from game_start event) ───
let gameConfig = null;

async function loadMapList() {
  try {
    const res = await fetch('/api/maps');
    const { maps } = await res.json();
    const sel = els.mapSelect;
    if (!sel) return;
    sel.innerHTML = '';
    for (const m of maps) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = `${m.name} — ${m.description}`;
      sel.appendChild(opt);
    }
  } catch (e) { console.error('Failed to load map list:', e); }
}

// ─── state ───
let state = null;          // reconstructed game state
let gameId = null;
let myToken = null;
let myPlayer = null;       // 'player_a' | 'player_b'
let sse = null;
let hoverCell = null;
let selectedUnitId = null;
let interactionMode = 'idle'; // 'idle' | 'unit_selected' | 'building_selected'
let rangeHighlights = [];     // [{x, y, type: 'move'|'attack'|'heal'}]
let selectedBuildingId = null;

// ─── helpers ───
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function toast(msg, type = 'info') {
  const t = $('toast');
  t.textContent = msg;
  t.className = `show ${type}`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.className = '', 2500);
}

function showResult(el, msg, ok) {
  el.textContent = msg;
  el.className = `result show ${ok ? 'ok' : 'err'}`;
}

function statusBadge(text, cls) {
  els.connStatus.textContent = text;
  els.connStatus.className = `badge ${cls}`;
}

// ─── API calls ───
const API = {
  async post(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Player-Token': myToken,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return { ok: res.ok, status: res.status, data };
  },

  async get(path) {
    const res = await fetch(path, {
      headers: { 'X-Player-Token': myToken },
    });
    const data = await res.json();
    return { ok: res.ok, status: res.status, data };
  },
};

// ─── event reconstruction (same logic as spectator) ───
function createEmptyState() {
  const cfg = gameConfig || {};
  const map = cfg.map || {};
  const eco = cfg.economy || {};
  return {
    mapWidth: map.width || 20, mapHeight: map.height || 20,
    miningPoints: [],
    terrain: [],
    units: new Map(),
    buildings: new Map(),
    resources: { player_a: { gold: eco.startingGold || 100 }, player_b: { gold: eco.startingGold || 100 } },
    turn: { turnNumber: 1, currentOwner: 'player_a', phase: 'waiting_command' },
    eventLog: [],
    winner: null,
  };
}

function applyEvent(s, ev) {
  s.eventLog.push(ev);
  const p = ev.payload || {};
  switch (ev.type) {
    case 'game_start':
      s.mapWidth = p.mapWidth ?? (gameConfig?.map?.width ?? 20);
      s.mapHeight = p.mapHeight ?? (gameConfig?.map?.height ?? 20);
      s.miningPoints = p.miningPoints ?? [];
      s.terrain = p.terrain ?? [];
      // buildings from payload or defaults
      if (p.buildings) {
        for (const b of p.buildings) s.buildings.set(b.id, {
          ...b, production: b.production || null, buildProgress: b.buildProgress || 0,
        });
      } else {
        const hqPos = gameConfig?.map?.headquartersPositions || {};
        const hqHp = gameConfig?.buildings?.headquarters?.hp || 200;
        const posA = hqPos.player_a || { x: 3, y: 10 };
        const posB = hqPos.player_b || { x: 16, y: 10 };
        s.buildings.set('hq_a', { id:'hq_a', owner:'player_a', type:'headquarters', x:posA.x, y:posA.y, hp:hqHp, maxHp:hqHp, alive:true, isBuilding:false, production:null, buildProgress:0 });
        s.buildings.set('hq_b', { id:'hq_b', owner:'player_b', type:'headquarters', x:posB.x, y:posB.y, hp:hqHp, maxHp:hqHp, alive:true, isBuilding:false, production:null, buildProgress:0 });
      }
      break;
    case 'build':
      s.resources[p.owner].gold -= (p.cost || 0);
      {
        const bMaxHp = gameConfig?.buildings?.[p.type]?.hp || 60;
        s.buildings.set(p.buildingId, {
          id: p.buildingId, owner: p.owner, type: p.type,
          x: p.x, y: p.y, hp: p.hp || bMaxHp, maxHp: p.maxHp || bMaxHp,
          alive: true, isBuilding: true, production: null, buildProgress: 0,
        });
      }
      break;
    case 'build_complete': {
      const b = s.buildings.get(p.buildingId);
      if (b) { b.isBuilding = false; b.buildProgress = 0; }
      break;
    }
    case 'produce':
      s.resources[p.owner].gold -= (p.cost || 0);
      {
        const b = s.buildings.get(p.buildingId);
        if (b) b.production = { type: p.unitType, turnsRemaining: p.turns || 1 };
      }
      break;
    case 'produce_complete': {
      const b = s.buildings.get(p.buildingId);
      if (b) b.production = null;
      {
        const uSpec = gameConfig?.units?.[p.type] || {};
        s.units.set(p.unitId, {
          id: p.unitId, owner: p.owner, type: p.type,
          x: p.x, y: p.y,
          hp: p.hp || uSpec.hp || 100, maxHp: p.maxHp || uSpec.hp || 100,
          attack: p.attack || uSpec.attack || 0, defense: p.defense || uSpec.defense || 0,
          moveRange: p.moveRange || uSpec.moveRange || 0, attackRange: p.attackRange || uSpec.attackRange || 0,
          alive: true, hasMoved: false, hasAttacked: false,
        });
      }
      break;
    }
    case 'move': {
      const u = s.units.get(p.unitId);
      if (u) { u.x = p.toX; u.y = p.toY; u.hasMoved = true; }
      break;
    }
    case 'attack': {
      const t = s.units.get(p.targetId) || s.buildings.get(p.targetId);
      if (t) { t.hp = p.targetHp; if (p.attackerHasAttacked) { const a = s.units.get(ev.payload.attackerId); if (a) a.hasAttacked = true; } }
      break;
    }
    case 'heal': {
      const t = s.units.get(p.targetId);
      if (t) t.hp = p.targetHp;
      break;
    }
    case 'unit_death': {
      const u = s.units.get(p.unitId);
      if (u) u.alive = false;
      break;
    }
    case 'base_destroyed': {
      const b = s.buildings.get(p.buildingId);
      if (b) b.alive = false;
      break;
    }
    case 'mine':
    case 'base_income':
      s.resources[p.owner].gold += p.amount;
      break;
    case 'reset_actions':
      for (const u of s.units.values()) {
        if (u.owner === p.owner) {
          u.hasMoved = false;
          u.hasAttacked = false;
        }
      }
      break;
    case 'turn_end':
      s.turn.currentOwner = p.nextOwner;
      s.turn.turnNumber = p.turnNumber;
      break;
    case 'game_over':
      s.turn.phase = 'game_over';
      s.winner = p.winner;
      break;
  }
}

async function loadFullState() {
  const { ok, data } = await API.get(`/api/games/${gameId}/events`);
  if (!ok) return false;
  state = createEmptyState();
  for (const ev of data.events) applyEvent(state, ev);
  return true;
}

// ─── map interaction helpers ───
function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function isOccupied(x, y) {
  for (const u of state.units.values()) {
    if (u.alive && u.x === x && u.y === y) return true;
  }
  for (const b of state.buildings.values()) {
    if (b.alive && b.x === x && b.y === y) return true;
  }
  return false;
}

function entityAt(x, y, owner) {
  for (const u of state.units.values()) {
    if (u.alive && u.x === x && u.y === y && (!owner || u.owner === owner)) return u;
  }
  for (const b of state.buildings.values()) {
    if (b.alive && b.x === x && b.y === y && (!owner || b.owner === owner)) return b;
  }
  return null;
}

function computeRangeHighlights(unit) {
  rangeHighlights = [];
  const spec = gameConfig?.units?.[unit.type];
  if (!spec) return;
  const W = state.mapWidth, H = state.mapHeight;

  if (unit.type === 'medic' && !unit.hasAttacked) {
    // heal range: adjacent friendly damaged units
    for (const t of state.units.values()) {
      if (t.alive && t.owner === myPlayer && t.hp < t.maxHp && manhattan(unit, t) <= 1) {
        rangeHighlights.push({ x: t.x, y: t.y, type: 'heal' });
      }
    }
  }

  if (!unit.hasMoved) {
    for (let dx = -spec.moveRange; dx <= spec.moveRange; dx++) {
      for (let dy = -spec.moveRange; dy <= spec.moveRange; dy++) {
        if (Math.abs(dx) + Math.abs(dy) > spec.moveRange) continue;
        const nx = unit.x + dx, ny = unit.y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (nx === unit.x && ny === unit.y) continue;
        if (isOccupied(nx, ny)) continue;
        rangeHighlights.push({ x: nx, y: ny, type: 'move' });
      }
    }
  }

  if (!unit.hasAttacked) {
    for (const t of state.units.values()) {
      if (t.alive && t.owner !== myPlayer && manhattan(unit, t) <= spec.attackRange) {
        if (!rangeHighlights.find(h => h.x === t.x && h.y === t.y && h.type === 'attack')) {
          rangeHighlights.push({ x: t.x, y: t.y, type: 'attack' });
        }
      }
    }
    for (const b of state.buildings.values()) {
      if (b.alive && b.owner !== myPlayer && manhattan(unit, b) <= spec.attackRange) {
        if (!rangeHighlights.find(h => h.x === b.x && h.y === b.y && h.type === 'attack')) {
          rangeHighlights.push({ x: b.x, y: b.y, type: 'attack' });
        }
      }
    }
  }
}

function computeBuildHighlights() {
  rangeHighlights = [];
  const W = state.mapWidth, H = state.mapHeight;
  const friendlyEntities = [
    ...[...state.units.values()].filter(u => u.alive && u.owner === myPlayer),
    ...[...state.buildings.values()].filter(b => b.alive && b.owner === myPlayer),
  ];
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      if (isOccupied(x, y)) continue;
      if (friendlyEntities.some(e => manhattan(e, { x, y }) <= (gameConfig?.map?.buildRange ?? 2))) {
        rangeHighlights.push({ x, y, type: 'move' }); // reuse 'move' color (green)
      }
    }
  }
}

// ─── popup system ───
const mapPopup = $('map-popup');

function showPopup(cellX, cellY, title, items) {
  const wrapRect = els.canvas.parentElement.getBoundingClientRect();
  const canvasRect = els.canvas.getBoundingClientRect();
  const px = canvasRect.left - wrapRect.left + cellX * CELL + CELL;
  const py = canvasRect.top - wrapRect.top + cellY * CELL;

  let html = `<div class="map-popup-title">${esc(title)}</div>`;
  for (const item of items) {
    const afford = item.cost === undefined || state.resources[myPlayer].gold >= item.cost;
    html += `<button class="map-popup-btn" data-action="${esc(item.action)}" data-params='${esc(JSON.stringify(item.params || {}))}'>
      <span>${esc(item.label)}</span>
      ${item.cost !== undefined ? `<span class="map-popup-cost ${afford ? '' : 'cant-afford'}">${item.cost}金</span>` : ''}
    </button>`;
  }
  mapPopup.innerHTML = html;
  mapPopup.style.left = px + 'px';
  mapPopup.style.top = py + 'px';
  mapPopup.classList.remove('hidden');

  mapPopup.querySelectorAll('.map-popup-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      const params = JSON.parse(btn.dataset.params);
      await handlePopupAction(action, params);
      closePopup();
    });
  });
}

function closePopup() {
  mapPopup.classList.add('hidden');
  selectedBuildingId = null;
  interactionMode = 'idle';
  rangeHighlights = [];
}

async function handlePopupAction(action, params) {
  if (action === 'produce') {
    await apiAction(`/api/games/${gameId}/produce`, {
      buildingId: params.buildingId,
      unitType: params.unitType,
    });
  } else if (action === 'build') {
    await apiAction(`/api/games/${gameId}/build`, {
      type: params.type,
      x: params.x,
      y: params.y,
    });
  }
}

// ─── drawing ───
function drawBoard() {
  if (!state) return;
  const { mapWidth: W, mapHeight: H } = state;
  els.canvas.width = W * CELL;
  els.canvas.height = H * CELL;
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, els.canvas.width, els.canvas.height);

  // grid
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= W; i++) {
    ctx.beginPath(); ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, H * CELL); ctx.stroke();
  }
  for (let j = 0; j <= H; j++) {
    ctx.beginPath(); ctx.moveTo(0, j * CELL); ctx.lineTo(W * CELL, j * CELL); ctx.stroke();
  }

  // terrain
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = state.terrain[y]?.[x] ?? 0;
      if (t === 1) {
        ctx.fillStyle = '#3a3a3a';
        ctx.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2);
        ctx.fillStyle = '#555';
        ctx.fillRect(x * CELL + 3, y * CELL + 3, CELL - 6, CELL - 6);
      } else if (t === 2) {
        ctx.fillStyle = '#1a3a5a';
        ctx.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2);
        ctx.fillStyle = '#2a5a8a';
        ctx.fillRect(x * CELL + 3, y * CELL + 3, CELL - 6, CELL - 6);
      }
    }
  }

  // mining points
  ctx.fillStyle = COLORS.gold;
  for (const p of state.miningPoints) {
    ctx.beginPath();
    ctx.arc(p.x * CELL + CELL / 2, p.y * CELL + CELL / 2, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // range highlights
  for (const h of rangeHighlights) {
    const px = h.x * CELL, py = h.y * CELL;
    if (h.type === 'move') {
      ctx.fillStyle = 'rgba(0, 200, 100, 0.15)';
      ctx.strokeStyle = 'rgba(0, 200, 100, 0.4)';
    } else if (h.type === 'attack') {
      ctx.fillStyle = 'rgba(255, 60, 60, 0.12)';
      ctx.strokeStyle = 'rgba(255, 60, 60, 0.35)';
    } else if (h.type === 'heal') {
      ctx.fillStyle = 'rgba(0, 200, 150, 0.15)';
      ctx.strokeStyle = 'rgba(0, 200, 150, 0.4)';
    }
    ctx.fillRect(px, py, CELL, CELL);
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, py + 0.5, CELL - 1, CELL - 1);
  }

  // hover highlight
  if (hoverCell) {
    ctx.fillStyle = COLORS.hover;
    ctx.fillRect(hoverCell.x * CELL, hoverCell.y * CELL, CELL, CELL);
  }

  // selected unit highlight
  if (selectedUnitId) {
    const u = state.units.get(selectedUnitId);
    if (u && u.alive) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(u.x * CELL + 1, u.y * CELL + 1, CELL - 2, CELL - 2);
    }
  }

  // buildings
  for (const b of state.buildings.values()) {
    if (!b.alive) {
      // ghost
      ctx.globalAlpha = .25;
      const isA = b.owner === 'player_a';
      ctx.fillStyle = b.type === 'headquarters' ? (isA ? COLORS.hq_build_a : COLORS.hq_build_b)
        : (isA ? COLORS.building_a : COLORS.building_b);
      ctx.fillRect(b.x * CELL + 2, b.y * CELL + 2, CELL - 4, CELL - 4);
      ctx.globalAlpha = 1;
      continue;
    }
    const isA = b.owner === 'player_a';
    let color;
    if (b.type === 'headquarters') color = isA ? COLORS.hq_a : COLORS.hq_b;
    else if (b.type === 'barracks') color = isA ? COLORS.barracks_a : COLORS.barracks_b;
    else color = isA ? COLORS.miner_a : COLORS.miner_b;

    if (b.isBuilding) {
      // progress bar
      ctx.fillStyle = '#333';
      ctx.fillRect(b.x * CELL + 1, b.y * CELL + 1, CELL - 2, CELL - 2);
      ctx.fillStyle = color;
      const pct = b.buildProgress || 0;
      ctx.fillRect(b.x * CELL + 1, b.y * CELL + CELL - 4, (CELL - 2) * pct, 3);
    } else {
      ctx.fillStyle = color;
      ctx.fillRect(b.x * CELL + 2, b.y * CELL + 2, CELL - 4, CELL - 4);
    }

    // label
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    const letter = b.type === 'headquarters' ? 'HQ' : b.type === 'barracks' ? 'B' : 'M';
    ctx.fillText(letter, b.x * CELL + CELL / 2, b.y * CELL + CELL / 2 + 4);

    // hp bar
    if (b.hp < b.maxHp) {
      drawHpBar(b.x * CELL + 2, b.y * CELL - 3, CELL - 4, b.hp / b.maxHp);
    }

    // production indicator
    if (b.production) {
      ctx.fillStyle = '#ff0';
      ctx.beginPath();
      ctx.arc(b.x * CELL + CELL - 4, b.y * CELL + 4, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // units
  for (const u of state.units.values()) {
    if (!u.alive) continue;
    const isMine = u.owner === myPlayer;
    const color = u.owner === 'player_a' ? COLORS.unit_a : COLORS.unit_b;
    const cx = u.x * CELL + CELL / 2, cy = u.y * CELL + CELL / 2;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, CELL / 3, 0, Math.PI * 2);
    ctx.fill();

    // spent indicator for enemy units only
    if (!isMine && u.hasMoved && u.hasAttacked) {
      ctx.fillStyle = 'rgba(0,0,0,.4)';
      ctx.beginPath();
      ctx.arc(cx, cy, CELL / 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // letter label
    ctx.fillStyle = '#000';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    const letter = u.type === 'infantry' ? 'I' : u.type === 'sniper' ? 'S' : u.type === 'tank' ? 'T' : 'M';
    ctx.fillText(letter, cx, cy + 3);

    // AP indicators for own units
    if (isMine) {
      const bx = u.x * CELL, by = u.y * CELL;
      if (!u.hasMoved) {
        ctx.fillStyle = '#0c8';
        ctx.beginPath();
        ctx.arc(bx + 4, by + CELL - 4, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      if (!u.hasAttacked) {
        ctx.fillStyle = '#f44';
        ctx.beginPath();
        ctx.arc(bx + CELL - 4, by + CELL - 4, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // hp bar
    if (u.hp < u.maxHp) {
      drawHpBar(u.x * CELL + 2, u.y * CELL - 3, CELL - 4, u.hp / u.maxHp);
    }
  }
}

function drawHpBar(x, y, w, pct) {
  ctx.fillStyle = '#300';
  ctx.fillRect(x, y, w, 3);
  ctx.fillStyle = pct > .5 ? '#0c0' : pct > .25 ? '#cc0' : '#c00';
  ctx.fillRect(x, y, w * pct, 3);
}

// ─── sidebar rendering ───
function renderSidebar() {
  if (!state) return;
  const t = state.turn;
  const isMyTurn = t.currentOwner === myPlayer;

  // turn badge
  els.turnBadge.textContent = `回合 ${t.turnNumber} — ${isMyTurn ? '你的回合' : t.currentOwner}`;
  els.turnBadge.className = `turn-badge ${isMyTurn ? 'my-turn' : ''}`;
  els.btnEndTurn.disabled = !isMyTurn;

  // resources
  const me = (myPlayer === 'player_a' ? 'res-a' : 'res-b') + ' res-me';
  const opp = myPlayer === 'player_a' ? 'res-b' : 'res-a';
  els.resDisplay.innerHTML = `
    <div class="${me}">💰 你: ${state.resources[myPlayer].gold} 金</div>
    <div class="${opp}">💰 对手: ${state.resources[myPlayer === 'player_a' ? 'player_b' : 'player_a'].gold} 金</div>
    ${state.winner ? `<div style="color:#ff8;font-weight:700;margin-top:4px">🏆 胜者: ${state.winner}</div>` : ''}
  `;

  // selection info
  renderSelectionInfo();

  // events
  renderEvents();
}

function renderSelectionInfo() {
  const el = els.selDetail;
  if (!el) return;

  if (selectedUnitId) {
    const u = state.units.get(selectedUnitId);
    if (u && u.alive) {
      const ownerCls = u.owner === 'player_a' ? 'sel-owner-a' : 'sel-owner-b';
      const ownerName = u.owner === myPlayer ? '己方' : '敌方';
      const typeName = u.type === 'infantry' ? '步兵' : u.type === 'sniper' ? '狙击手' : u.type === 'tank' ? '坦克' : '医疗兵';
      const hpPct = Math.round((u.hp / u.maxHp) * 100);
      const hpColor = hpPct > 50 ? '#4a8' : hpPct > 25 ? '#ca0' : '#e33';
      const actions = [];
      if (!u.hasMoved) actions.push('移动');
      if (!u.hasAttacked) actions.push(u.type === 'medic' ? '治疗' : '攻击');
      el.innerHTML = `
        <div class="sel-type"><span class="${ownerCls}">[${esc(ownerName)}]</span> ${esc(typeName)}</div>
        <div class="sel-hp">❤️ ${u.hp} / ${u.maxHp} <span class="sel-hp-bar"><span class="sel-hp-fill" style="width:${hpPct}%;background:${hpColor}"></span></span></div>
        <div class="sel-stat">⚔️ 攻击 ${u.attack}　🛡️ 防御 ${u.defense}　🏃 移动 ${u.moveRange}　🎯 射程 ${u.attackRange}</div>
        <div class="sel-stat">📍 位置 (${u.x}, ${u.y})</div>
        ${actions.length > 0 ? `<div class="sel-actions">可执行: ${actions.join(' / ')} — 点击高亮格子</div>` : '<div class="sel-actions" style="color:#a66">本回合已行动</div>'}
      `;
      return;
    }
  }

  if (selectedBuildingId) {
    const b = state.buildings.get(selectedBuildingId);
    if (b && b.alive) {
      const ownerCls = b.owner === 'player_a' ? 'sel-owner-a' : 'sel-owner-b';
      const ownerName = b.owner === myPlayer ? '己方' : '敌方';
      const typeName = b.type === 'headquarters' ? '总部' : b.type === 'barracks' ? '兵营' : '采矿器';
      const hpPct = Math.round((b.hp / b.maxHp) * 100);
      const hpColor = hpPct > 50 ? '#4a8' : hpPct > 25 ? '#ca0' : '#e33';
      const prodText = b.production
        ? `🏭 生产中: ${b.production.type === 'infantry' ? '步兵' : b.production.type === 'sniper' ? '狙击手' : b.production.type === 'tank' ? '坦克' : '医疗兵'} (剩余 ${b.production.turnsRemaining} 回合)`
        : '✅ 空闲';
      el.innerHTML = `
        <div class="sel-type"><span class="${ownerCls}">[${esc(ownerName)}]</span> ${esc(typeName)}</div>
        <div class="sel-hp">❤️ ${b.hp} / ${b.maxHp} <span class="sel-hp-bar"><span class="sel-hp-fill" style="width:${hpPct}%;background:${hpColor}"></span></span></div>
        <div class="sel-stat">📍 位置 (${b.x}, ${b.y})</div>
        <div class="sel-stat">${prodText}</div>
      `;
      return;
    }
  }

  el.textContent = '点击棋盘上的单位或建筑查看详情';
}

function renderEvents() {
  if (!state) return;
  const log = state.eventLog;
  els.events.innerHTML = '';
  const show = log.slice(-50);
  for (const ev of show) {
    const li = document.createElement('li');
    li.className = `type-${ev.type}`;
    const payload = JSON.stringify(ev.payload || {}).slice(0, 100);
    li.innerHTML = `<span class="ev-seq">#${ev.seq}</span><span class="ev-type">${esc(ev.type)}</span>${esc(payload)}`;
    els.events.appendChild(li);
  }
  els.events.scrollTop = els.events.scrollHeight;
}

// ─── canvas interaction ───
function cellFromMouse(e) {
  const rect = els.canvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left) / CELL);
  const y = Math.floor((e.clientY - rect.top) / CELL);
  if (!state) return null;
  if (x < 0 || y < 0 || x >= state.mapWidth || y >= state.mapHeight) return null;
  return { x, y };
}

els.canvas.addEventListener('mousemove', e => {
  hoverCell = cellFromMouse(e);
  if (hoverCell) {
    const u = [...state.units.values()].find(u => u.alive && u.x === hoverCell.x && u.y === hoverCell.y);
    const b = [...state.buildings.values()].find(b => b.alive && b.x === hoverCell.x && b.y === hoverCell.y);
    let info = `(${hoverCell.x}, ${hoverCell.y})`;
    if (u) info += ` | ${u.type} #${u.id.slice(-4)} [${u.owner}] hp:${u.hp}/${u.maxHp}`;
    if (b) info += ` | ${b.type} #${b.id.slice(-4)} [${b.owner}] hp:${b.hp}/${b.maxHp}`;
    els.cellInfo.textContent = info;
  } else {
    els.cellInfo.textContent = '';
  }
  drawBoard();
});

els.canvas.addEventListener('mouseleave', () => {
  hoverCell = null;
  els.cellInfo.textContent = '';
  drawBoard();
});

els.canvas.addEventListener('contextmenu', e => {
  e.preventDefault();
  selectedUnitId = null;
  selectedBuildingId = null;
  interactionMode = 'idle';
  rangeHighlights = [];
  closePopup();
  drawBoard();
});

els.canvas.addEventListener('click', e => {
  const cell = cellFromMouse(e);
  if (!cell || !state) return;

  // ── building_selected: ignore (popup handles it) ──
  if (interactionMode === 'building_selected') return;

  // ── unit_selected mode ──
  if (interactionMode === 'unit_selected' && selectedUnitId) {
    const sel = state.units.get(selectedUnitId);
    if (!sel || !sel.alive) { deselectAll(); return; }

    // clicked same unit → deselect
    if (sel.x === cell.x && sel.y === cell.y) {
      deselectAll();
      return;
    }

    // clicked another own unit → switch selection
    const otherOwn = entityAt(cell.x, cell.y, myPlayer);
    if (otherOwn && otherOwn.id && otherOwn.owner === myPlayer && !otherOwn.type?.startsWith?.('headquarters')) {
      // it's a unit (has moveRange in gameConfig)
      if (gameConfig?.units?.[otherOwn.type]) {
        selectedUnitId = otherOwn.id;
        computeRangeHighlights(otherOwn);
        renderSidebar();
        drawBoard();
        return;
      }
    }

    // check if click is on a highlighted cell
    const highlight = rangeHighlights.find(h => h.x === cell.x && h.y === cell.y);
    if (highlight) {
      if (highlight.type === 'move') {
        doMove(sel, cell.x, cell.y);
        return;
      }
      if (highlight.type === 'attack') {
        const target = entityAt(cell.x, cell.y);
        if (target && target.owner !== myPlayer) {
          doAttack(sel, target);
          return;
        }
      }
      if (highlight.type === 'heal') {
        const target = entityAt(cell.x, cell.y, myPlayer);
        if (target && target.hp < target.maxHp) {
          doHeal(sel, target);
          return;
        }
      }
    }

    // click outside valid range → deselect
    deselectAll();
    return;
  }

  // ── idle mode ──
  closePopup();

  // clicked own unit → select it
  const unit = entityAt(cell.x, cell.y, myPlayer);
  if (unit && unit.id && gameConfig?.units?.[unit.type]) {
    selectedUnitId = unit.id;
    interactionMode = 'unit_selected';
    computeRangeHighlights(unit);
    renderSidebar();
    drawBoard();
    return;
  }

  // clicked own building (barracks, completed) → show production popup
  if (unit && unit.type === 'barracks' && !unit.isBuilding) {
    selectedBuildingId = unit.id;
    interactionMode = 'building_selected';
    const canProduce = gameConfig?.canProduce?.barracks || ['infantry', 'sniper', 'tank', 'medic'];
    const items = canProduce.map(ut => ({
      label: ut === 'infantry' ? '步兵' : ut === 'sniper' ? '狙击手' : ut === 'tank' ? '坦克' : '医疗兵',
      cost: gameConfig?.units?.[ut]?.cost ?? 0,
      action: 'produce',
      params: { buildingId: unit.id, unitType: ut },
    }));
    showPopup(cell.x, cell.y, '生产单位', items);
    return;
  }

  // clicked empty cell → check build range
  if (!entityAt(cell.x, cell.y)) {
    const friendlyEntities = [
      ...[...state.units.values()].filter(u => u.alive && u.owner === myPlayer),
      ...[...state.buildings.values()].filter(b => b.alive && b.owner === myPlayer),
    ];
    const inRange = friendlyEntities.some(e => manhattan(e, cell) <= (gameConfig?.map?.buildRange ?? 2));
    if (inRange) {
      interactionMode = 'building_selected';
      const items = [
        { label: '兵营', cost: gameConfig?.buildings?.barracks?.cost ?? 50, action: 'build', params: { type: 'barracks', x: cell.x, y: cell.y } },
        { label: '采矿器', cost: gameConfig?.buildings?.miner?.cost ?? 30, action: 'build', params: { type: 'miner', x: cell.x, y: cell.y } },
      ];
      showPopup(cell.x, cell.y, '建造', items);
      computeBuildHighlights();
      drawBoard();
      return;
    }
  }

  // nothing relevant → deselect
  deselectAll();
});

function deselectAll() {
  selectedUnitId = null;
  selectedBuildingId = null;
  interactionMode = 'idle';
  rangeHighlights = [];
  renderSelectionInfo();
  drawBoard();
}

async function doMove(unit, x, y) {
  const { ok, data } = await API.post(`/api/games/${gameId}/move`, { unitId: unit.id, x, y });
  if (ok) {
    toast('移动成功', 'ok');
    deselectAll();
  } else {
    toast(`${data.error || '移动失败'} (${data.code || ''})`, 'err');
  }
}

async function doAttack(attacker, target) {
  const { ok, data } = await API.post(`/api/games/${gameId}/attack`, { attackerId: attacker.id, targetId: target.id });
  if (ok) {
    toast('攻击成功', 'ok');
    deselectAll();
  } else {
    toast(`${data.error || '攻击失败'} (${data.code || ''})`, 'err');
  }
}

async function doHeal(medic, target) {
  const { ok, data } = await API.post(`/api/games/${gameId}/heal`, { medicId: medic.id, targetId: target.id });
  if (ok) {
    toast('治疗成功', 'ok');
    deselectAll();
  } else {
    toast(`${data.error || '治疗失败'} (${data.code || ''})`, 'err');
  }
}

// ─── SSE subscription ───
function subscribeSse() {
  if (sse) sse.close();
  sse = new EventSource(`/api/games/${gameId}/events`);
  sse.onmessage = e => {
    try {
      const ev = JSON.parse(e.data);
      if (!state) state = createEmptyState();
      applyEvent(state, ev);
      // clear interaction state on turn change or game-relevant events
      if (ev.type === 'turn_end' || ev.type === 'move' || ev.type === 'attack' ||
          ev.type === 'heal' || ev.type === 'unit_death' || ev.type === 'base_destroyed') {
        selectedUnitId = null;
        selectedBuildingId = null;
        interactionMode = 'idle';
        rangeHighlights = [];
        closePopup();
      }
      drawBoard();
      renderSidebar();
    } catch (err) { console.error('SSE parse', err); }
  };
  sse.onerror = () => statusBadge('SSE 断开', 'err');
  sse.onopen = () => statusBadge('已连接', 'ok');
}

// ─── action handlers ───
async function apiAction(path, body) {
  const { ok, data } = await API.post(path, body);
  if (ok) {
    toast('操作成功', 'ok');
    return true;
  } else {
    toast(`${data.error || '错误'} (${data.code || ''})`, 'err');
    return false;
  }
}

els.btnEndTurn.addEventListener('click', async () => {
  await apiAction(`/api/games/${gameId}/end-turn`, {});
});

els.btnRefresh.addEventListener('click', async () => {
  await loadFullState();
  drawBoard();
  renderSidebar();
  toast('状态已刷新', 'ok');
});

// ─── join / create flow ───
els.btnCreate.addEventListener('click', async () => {
  const mapId = els.mapSelect?.value || 'default';
  const res = await fetch('/api/games', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mapId }),
  });
  const data = await res.json();
  els.gameId.value = data.gameId;
  els.playerToken.value = data.playerAToken;
  showResult(els.joinResult, `✅ 游戏已创建！\nGame ID: ${data.gameId}\nToken: ${data.playerAToken}\n\n请保存 token，然后将 gameId 发给对手。`, true);
  myToken = data.playerAToken;
  myPlayer = 'player_a';
  gameId = data.gameId;
  els.btnConnect.disabled = false;
});

els.btnJoin.addEventListener('click', async () => {
  const gid = els.gameId.value.trim();
  if (!gid) { showResult(els.joinResult, '请输入游戏 ID', false); return; }
  const res = await fetch(`/api/games/${gid}/join`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) { showResult(els.joinResult, `加入失败: ${data.error}`, false); return; }
  els.playerToken.value = data.playerBToken;
  showResult(els.joinResult, `✅ 已加入游戏！\nToken: ${data.playerBToken}`, true);
  myToken = data.playerBToken;
  myPlayer = 'player_b';
  gameId = gid;
  els.btnConnect.disabled = false;
});

els.btnConnect.addEventListener('click', async () => {
  gameId = els.gameId.value.trim();
  myToken = els.playerToken.value.trim();
  if (!gameId || !myToken) { toast('请填写游戏 ID 和 Token', 'err'); return; }

  if (!myPlayer) myPlayer = 'player_a';

  const ok = await loadFullState();
  if (!ok) { toast('无法加载游戏状态', 'err'); return; }

  // switch UI
  els.joinPanel.classList.add('hidden');
  els.gameUI.classList.remove('hidden');
  statusBadge('已连接', 'ok');

  subscribeSse();
  drawBoard();
  renderSidebar();
});

// ─── keyboard shortcuts ───
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closePopup();
    deselectAll();
  }
  if (e.key === ' ' || e.key === 'Enter') {
    if (state && state.turn.currentOwner === myPlayer) {
      els.btnEndTurn.click();
    }
  }
});

// close popup on outside click
document.addEventListener('click', e => {
  if (!mapPopup.classList.contains('hidden') && !mapPopup.contains(e.target) && e.target !== els.canvas) {
    closePopup();
    drawBoard();
  }
});

// load map list on startup
loadMapList();
