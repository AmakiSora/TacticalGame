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
  bunker_a:   '#5a4a8a',
  bunker_b:   '#8a5a5a',
  wall_a:     '#6a6a5a',
  wall_b:     '#8a7a5a',
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
  // lobby
  joinPanel:      $('join-panel'),
  gameId:         $('game-id'),
  createName:     $('create-name'),
  joinName:       $('join-name'),
  mapSelect:      $('map-select'),
  btnCreate:      $('btn-create'),
  btnJoin:        $('btn-join'),
  btnConnectCreate: $('btn-connect-create'),
  connStatus:     $('conn-status'),
  createResult:   $('create-result'),
  createdGameId:  $('created-game-id'),
  createdToken:   $('created-token'),
  joinResult:     $('join-result'),
  joinStatusText: $('join-status-text'),

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

// ─── lobby tab switching ───
document.querySelectorAll('.lobby-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.lobby-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.lobby-tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
  });
});

// ─── copy buttons ───
document.querySelectorAll('.btn-copy').forEach(btn => {
  btn.addEventListener('click', () => {
    const sourceEl = document.getElementById(btn.dataset.copy);
    if (!sourceEl) return;
    navigator.clipboard.writeText(sourceEl.textContent).then(() => {
      btn.textContent = '已复制';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = '复制'; btn.classList.remove('copied'); }, 1500);
    });
  });
});

const ctx = els.canvas.getContext('2d');

// ─── game config (derived from game_start event) ───
let gameConfig = null;
let playerNames = { player_a: '玩家 A', player_b: '玩家 B' };

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
let interactionMode = 'idle'; // 'idle' | 'unit_selected' | 'move_mode' | 'attack_mode' | 'heal_mode' | 'building_selected'
let rangeHighlights = [];     // [{x, y, type: 'move'|'attack'|'heal'}]
let selectedBuildingId = null;

// ─── helpers ───
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function playerName(owner) {
  return playerNames[owner] || (owner === 'player_a' ? '玩家 A' : '玩家 B');
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
      if (p.config) gameConfig = p.config;
      if (p.playerNames) playerNames = p.playerNames;
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
        const bSpec = gameConfig?.buildings?.[p.type] || {};
        const bMaxHp = bSpec.hp || 60;
        const newBuilding = {
          id: p.buildingId, owner: p.owner, type: p.type,
          x: p.x, y: p.y, hp: p.hp || bMaxHp, maxHp: p.maxHp || bMaxHp,
          alive: true, isBuilding: true, production: null, buildProgress: p.buildTime || 0,
        };
        if (bSpec.attacksPerTurn != null) {
          newBuilding.attack = bSpec.attack;
          newBuilding.defense = bSpec.defense;
          newBuilding.attackRange = bSpec.attackRange;
          newBuilding.attacksLeft = 0;
        } else if (bSpec.defense != null) {
          newBuilding.defense = bSpec.defense;
        }
        s.buildings.set(p.buildingId, newBuilding);
      }
      break;
    case 'build_tick': {
      const b = s.buildings.get(p.buildingId);
      if (b) b.buildProgress = p.buildProgress;
      break;
    }
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
      const ab = s.buildings.get(p.attackerId);
      if (ab && ab.attacksLeft != null) ab.attacksLeft = Math.max(0, ab.attacksLeft - 1);
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
    case 'sell': {
      const b = s.buildings.get(p.buildingId);
      if (b) b.alive = false;
      s.resources[p.owner].gold += p.refund;
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
      for (const b of s.buildings.values()) {
        if (b.owner === p.owner && b.alive && !b.isBuilding && b.attacksLeft != null) {
          const spec = gameConfig?.buildings?.[b.type];
          b.attacksLeft = spec?.attacksPerTurn ?? 0;
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

function entityAtBuilding(x, y) {
  for (const b of state.buildings.values()) {
    if (b.alive && b.x === x && b.y === y) return b;
  }
  return null;
}

function computeMoveHighlights(unit) {
  rangeHighlights = [];
  const spec = gameConfig?.units?.[unit.type];
  if (!spec || unit.hasMoved) return;
  const W = state.mapWidth, H = state.mapHeight;
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

function computeAttackHighlights(unit) {
  rangeHighlights = [];
  const spec = gameConfig?.units?.[unit.type];
  if (!spec || unit.hasAttacked) return;
  for (const t of state.units.values()) {
    if (t.alive && t.owner !== myPlayer && manhattan(unit, t) <= spec.attackRange) {
      rangeHighlights.push({ x: t.x, y: t.y, type: 'attack' });
    }
  }
  for (const b of state.buildings.values()) {
    if (b.alive && b.owner !== myPlayer && manhattan(unit, b) <= spec.attackRange) {
      if (!rangeHighlights.find(h => h.x === b.x && h.y === b.y)) {
        rangeHighlights.push({ x: b.x, y: b.y, type: 'attack' });
      }
    }
  }
}

function computeHealHighlights(unit) {
  rangeHighlights = [];
  if (unit.type !== 'medic' || unit.hasAttacked) return;
  for (const t of state.units.values()) {
    if (t.alive && t.owner === myPlayer && t.hp < t.maxHp && manhattan(unit, t) <= 1) {
      rangeHighlights.push({ x: t.x, y: t.y, type: 'heal' });
    }
  }
}

function computeBunkerAttackHighlights(bunker) {
  rangeHighlights = [];
  if (!bunker || bunker.isBuilding || (bunker.attacksLeft ?? 0) <= 0) return;
  const range = bunker.attackRange ?? 2;
  for (const t of state.units.values()) {
    if (t.alive && t.owner !== myPlayer && manhattan(bunker, t) <= range) {
      rangeHighlights.push({ x: t.x, y: t.y, type: 'attack' });
    }
  }
  for (const b of state.buildings.values()) {
    if (b.alive && b.owner !== myPlayer && manhattan(bunker, b) <= range) {
      if (!rangeHighlights.find(h => h.x === b.x && h.y === b.y)) {
        rangeHighlights.push({ x: b.x, y: b.y, type: 'attack' });
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
  const buildRange = gameConfig?.map?.buildRange ?? 2;
  const wallRange = gameConfig?.map?.wallBuildRange ?? buildRange;
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      if (isOccupied(x, y)) continue;
      if (friendlyEntities.some(e => manhattan(e, { x, y }) <= wallRange)) {
        rangeHighlights.push({ x, y, type: 'move' });
      }
    }
  }
}

// ─── popup system ───
const mapPopup = $('map-popup');

function showPopup(cellX, cellY, title, items, onAction) {
  const wrapRect = els.canvas.parentElement.getBoundingClientRect();
  const canvasRect = els.canvas.getBoundingClientRect();
  const px = canvasRect.left - wrapRect.left + cellX * CELL + CELL;
  const py = canvasRect.top - wrapRect.top + cellY * CELL;

  let html = `<div class="map-popup-title">${esc(title)}</div>`;
  for (const item of items) {
    const afford = item.cost === undefined || state.resources[myPlayer].gold >= item.cost;
    let costHtml = '';
    if (item.gain !== undefined) {
      costHtml = `<span class="map-popup-cost gain">+${item.gain}金</span>`;
    } else if (item.cost !== undefined) {
      costHtml = `<span class="map-popup-cost ${afford ? '' : 'cant-afford'}">${item.cost}金</span>`;
    }
    html += `<button class="map-popup-btn" data-action="${esc(item.action)}" data-params='${esc(JSON.stringify(item.params || {}))}'>
      <span>${esc(item.label)}</span>
      ${costHtml}
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
      if (onAction) {
        onAction(action, params);
      } else {
        await handlePopupAction(action, params);
        closePopup();
      }
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
  } else if (action === 'sell') {
    await apiAction(`/api/games/${gameId}/sell`, {
      buildingId: params.buildingId,
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
    else if (b.type === 'bunker') color = isA ? COLORS.bunker_a : COLORS.bunker_b;
    else if (b.type === 'wall') color = isA ? COLORS.wall_a : COLORS.wall_b;
    else color = isA ? COLORS.miner_a : COLORS.miner_b;

    if (b.isBuilding) {
      // progress bar
      ctx.fillStyle = '#333';
      ctx.fillRect(b.x * CELL + 1, b.y * CELL + 1, CELL - 2, CELL - 2);
      ctx.fillStyle = color;
      const buildTime = gameConfig?.buildings?.[b.type]?.buildTime || 1;
      const pct = 1 - (b.buildProgress || 0) / buildTime;
      ctx.fillRect(b.x * CELL + 1, b.y * CELL + CELL - 4, (CELL - 2) * pct, 3);
    } else {
      ctx.fillStyle = color;
      ctx.fillRect(b.x * CELL + 2, b.y * CELL + 2, CELL - 4, CELL - 4);
    }

    // label
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    const letter = b.type === 'headquarters' ? 'HQ' : b.type === 'barracks' ? 'B' : b.type === 'bunker' ? 'MG' : b.type === 'wall' ? 'W' : 'M';
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

  // hover border highlight on entities
  if (hoverCell) {
    const hu = [...state.units.values()].find(u => u.alive && u.x === hoverCell.x && u.y === hoverCell.y);
    const hb = [...state.buildings.values()].find(b => b.alive && b.x === hoverCell.x && b.y === hoverCell.y);
    if (hu || hb) {
      ctx.strokeStyle = 'rgba(255,255,255,.6)';
      ctx.lineWidth = 2;
      ctx.strokeRect(hoverCell.x * CELL + 1, hoverCell.y * CELL + 1, CELL - 2, CELL - 2);
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
  els.turnBadge.textContent = `回合 ${t.turnNumber} — ${isMyTurn ? '你的回合' : playerName(t.currentOwner)}`;
  els.turnBadge.className = `turn-badge ${isMyTurn ? 'my-turn' : ''}`;
  els.btnEndTurn.disabled = !isMyTurn;

  // resources
  const me = (myPlayer === 'player_a' ? 'res-a' : 'res-b') + ' res-me';
  const opp = myPlayer === 'player_a' ? 'res-b' : 'res-a';
  const oppPlayer = myPlayer === 'player_a' ? 'player_b' : 'player_a';
  els.resDisplay.innerHTML = `
    <div class="${me}">💰 ${esc(playerName(myPlayer))}: ${state.resources[myPlayer].gold} 金</div>
    <div class="${opp}">💰 ${esc(playerName(oppPlayer))}: ${state.resources[oppPlayer].gold} 金</div>
    ${state.winner ? `<div style="color:#ff8;font-weight:700;margin-top:4px">🏆 胜者: ${playerName(state.winner)}</div>` : ''}
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
      const ownerName = playerName(u.owner);
      const typeName = u.type === 'infantry' ? '步兵' : u.type === 'sniper' ? '狙击手' : u.type === 'tank' ? '坦克' : '医疗兵';
      const hpPct = Math.round((u.hp / u.maxHp) * 100);
      const hpColor = hpPct > 50 ? '#4a8' : hpPct > 25 ? '#ca0' : '#e33';
      const actions = [];
      if (!u.hasMoved) actions.push('移动');
      if (!u.hasAttacked) actions.push(u.type === 'medic' ? '治疗' : '攻击');
      const modeHint = interactionMode === 'move_mode' ? '🏃 选择移动目标'
        : interactionMode === 'attack_mode' ? '⚔️ 选择攻击目标'
        : interactionMode === 'heal_mode' ? '💊 选择治疗目标'
        : null;
      el.innerHTML = `
        <div class="sel-type"><span class="${ownerCls}">[${esc(ownerName)}]</span> ${esc(typeName)}</div>
        <div class="sel-hp">❤️ ${u.hp} / ${u.maxHp} <span class="sel-hp-bar"><span class="sel-hp-fill" style="width:${hpPct}%;background:${hpColor}"></span></span></div>
        <div class="sel-stat">⚔️ 攻击 ${u.attack}　🛡️ 防御 ${u.defense}　🏃 移动 ${u.moveRange}　🎯 射程 ${u.attackRange}</div>
        <div class="sel-stat">📍 位置 (${u.x}, ${u.y})</div>
        ${modeHint ? `<div class="sel-actions" style="color:#6cf">${modeHint} — 点击高亮格子 (Esc取消)</div>`
          : actions.length > 0 ? `<div class="sel-actions">点击单位选择操作</div>`
          : '<div class="sel-actions" style="color:#a66">本回合已行动</div>'}
      `;
      return;
    }
  }

  if (selectedBuildingId) {
    const b = state.buildings.get(selectedBuildingId);
    if (b && b.alive) {
      const ownerCls = b.owner === 'player_a' ? 'sel-owner-a' : 'sel-owner-b';
      const ownerName = playerName(b.owner);
      const typeName = b.type === 'headquarters' ? '总部' : b.type === 'barracks' ? '兵营' : b.type === 'bunker' ? '碉堡' : b.type === 'wall' ? '墙壁' : '采矿器';
      const hpPct = Math.round((b.hp / b.maxHp) * 100);
      const hpColor = hpPct > 50 ? '#4a8' : hpPct > 25 ? '#ca0' : '#e33';
      const statusText = b.isBuilding
        ? `🔨 建造中 (剩余 ${b.buildProgress || 0} 回合)`
        : b.production
        ? `🏭 生产中: ${b.production.type === 'infantry' ? '步兵' : b.production.type === 'sniper' ? '狙击手' : b.production.type === 'tank' ? '坦克' : '医疗兵'} (剩余 ${b.production.turnsRemaining} 回合)`
        : '✅ 空闲';
      const modeHint = interactionMode === 'bunker_attack_mode' ? '⚔️ 选择攻击目标 (Esc取消)' : '';
      const bunkerStats = b.type === 'bunker' && !b.isBuilding
        ? `<div class="sel-stat">⚔️ 攻击 ${b.attack ?? '-'}　🛡️ 防御 ${b.defense ?? '-'}　🎯 射程 ${b.attackRange ?? '-'}　🔫 剩余 ${b.attacksLeft ?? 0}/2</div>`
        : '';
      const wallStats = b.type === 'wall' && !b.isBuilding
        ? `<div class="sel-stat">🧱 防御 ${b.defense ?? 5}　|　纯障碍物，无法攻击和生产</div>`
        : '';
      el.innerHTML = `
        <div class="sel-type"><span class="${ownerCls}">[${esc(ownerName)}]</span> ${esc(typeName)}</div>
        <div class="sel-hp">❤️ ${b.hp} / ${b.maxHp} <span class="sel-hp-bar"><span class="sel-hp-fill" style="width:${hpPct}%;background:${hpColor}"></span></span></div>
        ${bunkerStats}
        ${wallStats}
        <div class="sel-stat">📍 位置 (${b.x}, ${b.y})</div>
        <div class="sel-stat">${statusText}</div>
        ${modeHint ? `<div class="sel-actions" style="color:#6cf">${modeHint}</div>` : ''}
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
    if (u) {
      const typeName = u.type === 'infantry' ? '步兵' : u.type === 'sniper' ? '狙击手' : u.type === 'tank' ? '坦克' : '医疗兵';
      info += ` | ${typeName} [${playerName(u.owner)}] HP:${u.hp}/${u.maxHp}`;
    }
    if (b) {
      const typeName = b.type === 'headquarters' ? '总部' : b.type === 'barracks' ? '兵营' : b.type === 'bunker' ? '碉堡' : b.type === 'wall' ? '墙壁' : '采矿器';
      const status = b.isBuilding ? ' 建造中' : b.production ? ` 生产${b.production.type === 'infantry' ? '步兵' : b.production.type === 'sniper' ? '狙击手' : b.production.type === 'tank' ? '坦克' : '医疗兵'}` : '';
      const bunkerInfo = b.type === 'bunker' && !b.isBuilding ? ` ⚔️${b.attack ?? '-'}/🎯${b.attackRange ?? '-'} 剩余${b.attacksLeft ?? 0}` : '';
      const wallInfo = b.type === 'wall' && !b.isBuilding ? ` 🛡️${b.defense ?? 5}` : '';
      info += ` | ${typeName} [${playerName(b.owner)}] HP:${b.hp}/${b.maxHp}${status}${bunkerInfo}${wallInfo}`;
    }
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

  // ── bunker_attack_mode: click on highlighted enemy → bunker attacks ──
  if (interactionMode === 'bunker_attack_mode' && selectedBuildingId) {
    const bunker = state.buildings.get(selectedBuildingId);
    if (!bunker || !bunker.alive) { deselectAll(); return; }
    if (bunker.x === cell.x && bunker.y === cell.y) {
      interactionMode = 'building_selected';
      rangeHighlights = [];
      renderSidebar();
      drawBoard();
      return;
    }
    const highlight = rangeHighlights.find(h => h.x === cell.x && h.y === cell.y && h.type === 'attack');
    if (highlight) {
      const target = entityAt(cell.x, cell.y);
      if (target && target.owner !== myPlayer) {
        doBunkerAttack(bunker, target);
        return;
      }
    }
    // click outside → cancel mode
    interactionMode = 'idle';
    selectedBuildingId = null;
    rangeHighlights = [];
    closePopup();
  }

  // ── building_selected: ignore (popup handles it) ──
  if (interactionMode === 'building_selected') return;

  // ── action modes: move_mode / attack_mode / heal_mode ──
  if ((interactionMode === 'move_mode' || interactionMode === 'attack_mode' || interactionMode === 'heal_mode') && selectedUnitId) {
    const sel = state.units.get(selectedUnitId);
    if (!sel || !sel.alive) { deselectAll(); return; }

    // clicked same unit → cancel action, go back to unit_selected
    if (sel.x === cell.x && sel.y === cell.y) {
      interactionMode = 'unit_selected';
      rangeHighlights = [];
      closePopup();
      renderSidebar();
      drawBoard();
      return;
    }

    // check if click is on a highlighted target
    const highlight = rangeHighlights.find(h => h.x === cell.x && h.y === cell.y);
    if (highlight) {
      if (interactionMode === 'move_mode' && highlight.type === 'move') {
        doMove(sel, cell.x, cell.y);
        return;
      }
      if (interactionMode === 'attack_mode' && highlight.type === 'attack') {
        const target = entityAt(cell.x, cell.y);
        if (target && target.owner !== myPlayer) {
          doAttack(sel, target);
          return;
        }
      }
      if (interactionMode === 'heal_mode' && highlight.type === 'heal') {
        const target = entityAt(cell.x, cell.y, myPlayer);
        if (target && target.hp < target.maxHp) {
          doHeal(sel, target);
          return;
        }
      }
    }

    // click outside valid range → cancel mode, fall through to select whatever is at new cell
    closePopup();
    rangeHighlights = [];
    interactionMode = 'idle';
    selectedUnitId = null;
    selectedBuildingId = null;
  }

  // ── unit_selected (viewing) mode ──
  if (interactionMode === 'unit_selected') {
    // clicked same unit → deselect
    const sel = state.units.get(selectedUnitId);
    if (sel && sel.x === cell.x && sel.y === cell.y) {
      deselectAll();
      return;
    }
    // clicked anything else → deselect first, then fall through to idle handling
    closePopup();
    rangeHighlights = [];
    interactionMode = 'idle';
    selectedUnitId = null;
  }

  // ── idle mode ──
  closePopup();

  // clicked any unit → select it
  const unit = entityAt(cell.x, cell.y);
  if (unit && unit.id && gameConfig?.units?.[unit.type]) {
    selectedUnitId = unit.id;
    interactionMode = 'unit_selected';
    renderSidebar();
    drawBoard();
    // own unit → show action popup
    if (unit.owner === myPlayer && unit.alive) {
      const items = [];
      if (!unit.hasMoved) items.push({ label: '移动', action: 'move' });
      if (!unit.hasAttacked) items.push({ label: unit.type === 'medic' ? '治疗' : '攻击', action: unit.type === 'medic' ? 'heal' : 'attack' });
      if (items.length > 0) {
        showPopup(cell.x, cell.y, '操作', items, (action) => {
          closePopup();
          if (action === 'move') {
            interactionMode = 'move_mode';
            computeMoveHighlights(unit);
          } else if (action === 'attack') {
            interactionMode = 'attack_mode';
            computeAttackHighlights(unit);
          } else if (action === 'heal') {
            interactionMode = 'heal_mode';
            computeHealHighlights(unit);
          }
          drawBoard();
        });
      }
    }
    return;
  }

  // clicked any building → select it
  const building = entityAtBuilding(cell.x, cell.y);
  if (building && building.alive) {
    selectedBuildingId = building.id;
    interactionMode = 'building_selected';
    renderSidebar();
    drawBoard();
    // own barracks/miner/bunker → show action popup
    if (building.owner === myPlayer && !building.isBuilding) {
      const items = [];
      if (building.type === 'barracks') {
        const canProduce = gameConfig?.canProduce?.barracks || ['infantry', 'sniper', 'tank', 'medic'];
        for (const ut of canProduce) {
          items.push({
            label: ut === 'infantry' ? '步兵' : ut === 'sniper' ? '狙击手' : ut === 'tank' ? '坦克' : '医疗兵',
            cost: gameConfig?.units?.[ut]?.cost ?? 0,
            action: 'produce',
            params: { buildingId: building.id, unitType: ut },
          });
        }
      }
      if (building.type === 'bunker' && (building.attacksLeft ?? 0) > 0) {
        items.push({ label: `攻击 (剩余 ${building.attacksLeft})`, action: 'bunker_attack', params: { buildingId: building.id } });
      }
      const spec = gameConfig?.buildings?.[building.type];
      const refund = spec ? Math.floor(spec.cost * 0.8) : 0;
      items.push({ label: '出售', gain: refund, action: 'sell', params: { buildingId: building.id } });
      const title = building.type === 'barracks' ? '生产单位' : building.type === 'bunker' ? '碉堡操作' : building.type === 'wall' ? '墙壁' : '操作';
      showPopup(cell.x, cell.y, title, items, (action, params) => {
        if (action === 'bunker_attack') {
          closePopup();
          interactionMode = 'bunker_attack_mode';
          selectedBuildingId = params.buildingId;
          computeBunkerAttackHighlights(building);
          renderSidebar();
          drawBoard();
        } else {
          handlePopupAction(action, params);
          closePopup();
        }
      });
    }
    return;
  }

  // clicked empty cell → check build range
  if (!entityAt(cell.x, cell.y)) {
    const friendlyEntities = [
      ...[...state.units.values()].filter(u => u.alive && u.owner === myPlayer),
      ...[...state.buildings.values()].filter(b => b.alive && b.owner === myPlayer),
    ];
    const inBuildRange = friendlyEntities.some(e => manhattan(e, cell) <= (gameConfig?.map?.buildRange ?? 2));
    const inWallRange = friendlyEntities.some(e => manhattan(e, cell) <= (gameConfig?.map?.wallBuildRange ?? (gameConfig?.map?.buildRange ?? 2)));
    if (inBuildRange || inWallRange) {
      interactionMode = 'building_selected';
      const items = [];
      if (inBuildRange) {
        items.push(
          { label: '兵营', cost: gameConfig?.buildings?.barracks?.cost ?? 50, action: 'build', params: { type: 'barracks', x: cell.x, y: cell.y } },
          { label: '采矿器', cost: gameConfig?.buildings?.miner?.cost ?? 30, action: 'build', params: { type: 'miner', x: cell.x, y: cell.y } },
          { label: '碉堡', cost: gameConfig?.buildings?.bunker?.cost ?? 70, action: 'build', params: { type: 'bunker', x: cell.x, y: cell.y } },
        );
      }
      if (inWallRange) {
        items.push(
          { label: '墙壁', cost: gameConfig?.buildings?.wall?.cost ?? 20, action: 'build', params: { type: 'wall', x: cell.x, y: cell.y } },
        );
      }
      const title = inBuildRange ? '建造' : '建造墙壁';
      showPopup(cell.x, cell.y, title, items);
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

async function doBunkerAttack(bunker, target) {
  const { ok, data } = await API.post(`/api/games/${gameId}/attack`, { attackerId: bunker.id, targetId: target.id });
  if (ok) {
    toast('碉堡攻击', 'ok');
    // re-select bunker, refresh highlights for possible second attack
    const refreshed = state.buildings.get(bunker.id);
    if (refreshed && (refreshed.attacksLeft ?? 0) > 0) {
      computeBunkerAttackHighlights(refreshed);
      drawBoard();
    } else {
      deselectAll();
    }
  } else {
    toast(`${data.error || '攻击失败'} (${data.code || ''})`, 'err');
  }
}

// ─── SSE subscription ───
function subscribeSse() {
  if (sse) sse.close();
  sse = new EventSource(`/api/games/${gameId}/events?token=${encodeURIComponent(myToken)}`);
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

// ─── create game ───
els.btnCreate.addEventListener('click', async () => {
  const mapId = els.mapSelect?.value || 'default';
  els.btnCreate.disabled = true;
  els.btnCreate.textContent = '创建中…';

  const name = els.createName.value.trim();
  const res = await fetch('/api/games', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mapId, name: name || undefined }),
  });
  const data = await res.json();

  myToken = data.playerAToken;
  myPlayer = 'player_a';
  gameId = data.gameId;

  els.createdGameId.textContent = data.gameId;
  els.createdToken.textContent = data.playerAToken;
  els.createResult.classList.remove('hidden');
  els.btnCreate.disabled = false;
  els.btnCreate.textContent = '➕ 创建新游戏';
});

// ─── join game (auto-connect) ───
els.btnJoin.addEventListener('click', async () => {
  const gid = els.gameId.value.trim();
  if (!gid) {
    els.joinStatusText.textContent = '请输入游戏 ID';
    els.joinStatusText.className = 'lobby-status err';
    els.joinResult.classList.remove('hidden');
    return;
  }

  els.btnJoin.disabled = true;
  els.btnJoin.textContent = '加入中…';

  const name = els.joinName.value.trim();
  const res = await fetch(`/api/games/${gid}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name || undefined }),
  });
  const data = await res.json();

  if (!res.ok) {
    els.joinStatusText.textContent = `加入失败: ${data.error}`;
    els.joinStatusText.className = 'lobby-status err';
    els.joinResult.classList.remove('hidden');
    els.btnJoin.disabled = false;
    els.btnJoin.textContent = '🔗 加入游戏';
    return;
  }

  myToken = data.playerBToken;
  myPlayer = 'player_b';
  gameId = gid;

  els.joinStatusText.textContent = '已加入，正在连接…';
  els.joinStatusText.className = 'lobby-status connecting';
  els.joinResult.classList.remove('hidden');

  const ok = await loadFullState();
  if (!ok) {
    els.joinStatusText.textContent = '加载游戏状态失败';
    els.joinStatusText.className = 'lobby-status err';
    els.btnJoin.disabled = false;
    els.btnJoin.textContent = '🔗 加入游戏';
    return;
  }

  els.joinPanel.classList.add('hidden');
  els.gameUI.classList.remove('hidden');
  statusBadge('已连接', 'ok');
  subscribeSse();
  drawBoard();
  renderSidebar();
});

// ─── connect after create ───
els.btnConnectCreate.addEventListener('click', async () => {
  if (!gameId || !myToken) { toast('缺少游戏 ID 或 Token', 'err'); return; }

  els.btnConnectCreate.disabled = true;
  els.btnConnectCreate.textContent = '连接中…';

  const ok = await loadFullState();
  if (!ok) {
    toast('无法加载游戏状态', 'err');
    els.btnConnectCreate.disabled = false;
    els.btnConnectCreate.textContent = '✅ 连接进入游戏';
    return;
  }

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
