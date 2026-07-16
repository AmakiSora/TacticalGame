const HEX_SIZE = 28;
const PAD = 42;
const SQRT3 = Math.sqrt(3);
const PLAYER_IDS = ['player_a', 'player_b', 'player_c', 'player_d', 'player_e', 'player_f', 'player_g', 'player_h'];
const OWNER_COLOR = {
  player_a: '#66ccff', player_b: '#ff9966', player_c: '#a5d76e', player_d: '#d78cff',
  player_e: '#ffd166', player_f: '#5eead4', player_g: '#f472b6', player_h: '#c4b5fd',
};
const TERRAIN = { plain: '#111923', water: '#183a55', blocker: '#393f46' };
const UNIT_NAMES = { infantry: '步兵', scout: '侦察兵', heavy: '重装', ranger: '远程兵', support: '支援兵' };
const UNIT_LABELS = { infantry: 'INF', scout: 'SCT', heavy: 'HVY', ranger: 'RNG', support: 'SUP', headquarters: 'HQ' };
const CONTROL_POINT_LABELS = { supply: 'SUP', forward_base: 'FWD', repair: 'REP' };
const CONTROL_POINT_NAMES = { supply: '补给站', forward_base: '前线基地', repair: '维修站' };
const UNIT_SHORT_NAMES = { infantry: '步', scout: '侦', heavy: '重', ranger: '远', support: '支', headquarters: '部' };
const CONTROL_POINT_SHORT_NAMES = { supply: '给', forward_base: '前', repair: '修' };
function entityShortName(type) {
  return UNIT_SHORT_NAMES[type] || CONTROL_POINT_SHORT_NAMES[type] || '?';
}
function entityTokenClass(type) {
  return type || '';
}
function entityTokenMarkup(type, ownerClass, title) {
  const cls = entityTokenClass(type);
  const label = entityShortName(type);
  return `<div class="visual-token ${ownerClass}">
    <span class="token-icon ${cls}" title="${esc(title)}"></span>
    <span class="token-label">${esc(label)}</span>
  </div>`;
}

const $ = id => document.getElementById(id);
const els = {
  joinPanel: $('join-panel'), gameId: $('game-id'), createName: $('create-name'), joinName: $('join-name'),
  mapSelect: $('map-select'), mapPicker: $('map-picker'), maxPlayers: $('max-players'), hostParticipate: $('host-participate'),
  btnCreate: $('btn-create'), btnJoin: $('btn-join'), btnConnectCreate: $('btn-connect-create'), btnConnectJoin: $('btn-connect-join'), btnStartGame: $('btn-start-game'),
  connStatus: $('conn-status'), createResult: $('create-result'), createdGameId: $('created-game-id'),
  createdHostToken: $('created-host-token'), createdToken: $('created-token'), createdPlayerTokenRow: $('created-player-token-row'),
  lobbySummary: $('lobby-summary'), joinLobbySummary: $('join-lobby-summary'), joinResult: $('join-result'), joinStatusText: $('join-status-text'),
  joinPlayerToken: $('join-player-token'), joinPlayerTokenRow: $('join-player-token-row'),
  gameUI: $('game-ui'), canvas: $('board'), cellInfo: $('cell-info'), turnBadge: $('turn-badge'),
  resDisplay: $('resources-display'), actionsDisplay: $('actions-display'),
  btnEndTurn: $('btn-end-turn'), btnRefresh: $('btn-refresh'),
  selDetail: $('selection-detail'), events: $('events'), scorePanel: $('score-panel'),
};
const ctx = els.canvas.getContext('2d');

let gameConfig = null;
let playerNames = defaultPlayerNames();
let state = null;
let gameId = null;
let myToken = null;
let hostToken = null;
let myPlayer = null;
let sse = null;
let lobbyPollTimer = null;
let hoverCell = null;
let selectedUnitId = null;
let selectedOriginId = null;
let selectedDeployType = null;
let interactionMode = 'idle';
let rangeHighlights = [];
let layout = { minX: 0, minY: 0, width: 840, height: 840 };
let availableMaps = [];

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function defaultPlayerNames() { return Object.fromEntries(PLAYER_IDS.map((id, index) => [id, `玩家 ${String.fromCharCode(65 + index)}`])); }
function playerName(owner) { return playerNames[owner] || defaultPlayerNames()[owner] || owner || '未知玩家'; }
function playerClass(owner) { return owner ? owner.replace('_', '-') : 'neutral'; }
function joinedPlayerIds() {
  const fromPlayers = state?.players ? PLAYER_IDS.filter(id => state.players[id]) : [];
  if (fromPlayers.length) return fromPlayers;
  const owners = new Set([
    ...[...(state?.headquarters?.values?.() || [])].map(h => h.owner),
    ...[...(state?.units?.values?.() || [])].map(u => u.owner),
    ...Object.keys(state?.resources || {}),
  ].filter(Boolean));
  return PLAYER_IDS.filter(id => owners.has(id));
}
function maxTurnsLabel() {
  const maxTurns = gameConfig?.balance?.maxTurns;
  return Number.isFinite(maxTurns) && maxTurns > 0 ? `${maxTurns}回合` : '回合上限';
}
function currentTurnNumber() {
  return state?.turn?.roundNumber || state?.turn?.turnNumber || 0;
}
function turnProgressLabel() {
  const current = currentTurnNumber();
  const maxTurns = gameConfig?.balance?.maxTurns;
  return Number.isFinite(maxTurns) && maxTurns > 0 ? `${current}/${maxTurns}` : String(current);
}
function statusBadge(text, cls) { els.connStatus.textContent = text; els.connStatus.className = `badge ${cls}`; }
function toast(msg, type = 'info') {
  const t = $('toast'); t.textContent = msg; t.className = `show ${type}`;
  clearTimeout(t._timer); t._timer = setTimeout(() => t.className = '', 2400);
}
function hexKey(p) { return `${p.q},${p.r}`; }
function hexDistance(a, b) { return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs((-a.q - a.r) - (-b.q - b.r))); }
function hexNeighbors(p) { return [{ q: p.q + 1, r: p.r }, { q: p.q + 1, r: p.r - 1 }, { q: p.q, r: p.r - 1 }, { q: p.q - 1, r: p.r }, { q: p.q - 1, r: p.r + 1 }, { q: p.q, r: p.r + 1 }]; }
function hexToRaw(q, r) { return { x: HEX_SIZE * SQRT3 * (q + r / 2), y: HEX_SIZE * 1.5 * r }; }
function hexCornersRaw(q, r) {
  const c = hexToRaw(q, r);
  return Array.from({ length: 6 }, (_, i) => {
    const a = Math.PI / 180 * (60 * i - 30);
    return { x: c.x + HEX_SIZE * Math.cos(a), y: c.y + HEX_SIZE * Math.sin(a) };
  });
}
function computeLayout(cells) {
  const pts = cells.flatMap(c => hexCornersRaw(c.q, c.r));
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  layout = { minX: Math.min(...xs), minY: Math.min(...ys), width: Math.ceil(Math.max(...xs) - Math.min(...xs) + PAD * 2), height: Math.ceil(Math.max(...ys) - Math.min(...ys) + PAD * 2) };
  els.canvas.width = layout.width; els.canvas.height = layout.height;
}
function hexToPixel(q, r) {
  const raw = hexToRaw(q, r);
  return { x: raw.x - layout.minX + PAD, y: raw.y - layout.minY + PAD };
}
function cubeRound(q, r) {
  let x = q, z = r, y = -x - z;
  let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
  const xd = Math.abs(rx - x), yd = Math.abs(ry - y), zd = Math.abs(rz - z);
  if (xd > yd && xd > zd) rx = -ry - rz;
  else if (yd > zd) ry = -rx - rz;
  else rz = -rx - ry;
  return { q: rx, r: rz };
}
function pixelToHex(px, py) {
  const x = px + layout.minX - PAD, y = py + layout.minY - PAD;
  return cubeRound((SQRT3 / 3 * x - 1 / 3 * y) / HEX_SIZE, (2 / 3 * y) / HEX_SIZE);
}
function canvasCssMetrics() {
  const rect = els.canvas.getBoundingClientRect();
  const style = getComputedStyle(els.canvas);
  const borderLeft = parseFloat(style.borderLeftWidth) || 0;
  const borderTop = parseFloat(style.borderTopWidth) || 0;
  const borderRight = parseFloat(style.borderRightWidth) || 0;
  const borderBottom = parseFloat(style.borderBottomWidth) || 0;
  const cssWidth = Math.max(1, rect.width - borderLeft - borderRight);
  const cssHeight = Math.max(1, rect.height - borderTop - borderBottom);
  return { rect, borderLeft, borderTop, cssWidth, cssHeight };
}
function eventToCanvasPoint(e) {
  const m = canvasCssMetrics();
  return {
    x: (e.clientX - m.rect.left - m.borderLeft) * (els.canvas.width / m.cssWidth),
    y: (e.clientY - m.rect.top - m.borderTop) * (els.canvas.height / m.cssHeight),
  };
}
function canvasToCssPoint(p) {
  const m = canvasCssMetrics();
  return {
    x: m.borderLeft + p.x * (m.cssWidth / els.canvas.width),
    y: m.borderTop + p.y * (m.cssHeight / els.canvas.height),
  };
}
function pathHex(q, r, inset = 0) {
  const c = hexToPixel(q, r), size = HEX_SIZE - inset;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 180 * (60 * i - 30);
    const x = c.x + size * Math.cos(a), y = c.y + size * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

const API = {
  async post(path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (myToken) headers['X-Player-Token'] = myToken;
    const res = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body) });
    const data = await res.json();
    return { ok: res.ok, status: res.status, data };
  },
  async get(path) {
    const headers = {};
    if (myToken) headers['X-Player-Token'] = myToken;
    const res = await fetch(path, { headers });
    const data = await res.json();
    return { ok: res.ok, status: res.status, data };
  },
};

async function loadMapList() {
  const res = await fetch('/api/maps');
  const { maps } = await res.json();
  availableMaps = maps || [];
  els.mapSelect.innerHTML = maps.map(m => `<option value="${esc(m.id)}">${esc(m.name)} - ${esc(m.description)}</option>`).join('');
  renderMapPicker(maps);
  syncMaxPlayersOptions();
}
function persistSession() {
  try {
    localStorage.setItem('tacticalGame.session', JSON.stringify({ gameId, myToken, myPlayer, hostToken }));
  } catch {
    // 浏览器禁用本地存储时不影响本局操作。
  }
}

function previewCells(radius) {
  const cells = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      if (Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r)) <= radius) cells.push({ q, r });
    }
  }
  return cells;
}

function previewHexToRaw(q, r, size) {
  return { x: size * SQRT3 * (q + r / 2), y: size * 1.5 * r };
}

function previewHexCornersRaw(q, r, size) {
  const c = previewHexToRaw(q, r, size);
  return Array.from({ length: 6 }, (_, i) => {
    const a = Math.PI / 180 * (60 * i - 30);
    return { x: c.x + size * Math.cos(a), y: c.y + size * Math.sin(a) };
  });
}

function renderMapPreview(preview) {
  if (!preview || !Number.isFinite(preview.radius)) {
    return '<div class="map-preview empty">暂无预览</div>';
  }

  const size = 7;
  const pad = 8;
  const cells = previewCells(preview.radius);
  const terrain = new Map((preview.terrainCells || []).map(cell => [hexKey(cell), cell.terrain]));
  const allCorners = cells.flatMap(cell => previewHexCornersRaw(cell.q, cell.r, size));
  const minX = Math.min(...allCorners.map(p => p.x));
  const minY = Math.min(...allCorners.map(p => p.y));
  const maxX = Math.max(...allCorners.map(p => p.x));
  const maxY = Math.max(...allCorners.map(p => p.y));
  const width = Math.ceil(maxX - minX + pad * 2);
  const height = Math.ceil(maxY - minY + pad * 2);
  const point = pos => {
    const raw = previewHexToRaw(pos.q, pos.r, size);
    return { x: raw.x - minX + pad, y: raw.y - minY + pad };
  };
  const polygon = cell => previewHexCornersRaw(cell.q, cell.r, size)
    .map(p => `${(p.x - minX + pad).toFixed(1)},${(p.y - minY + pad).toFixed(1)}`)
    .join(' ');
  const hexes = cells.map(cell => {
    const terrainClass = terrain.get(hexKey(cell)) || 'plain';
    return `<polygon class="preview-hex ${terrainClass}" points="${polygon(cell)}"></polygon>`;
  }).join('');
  const controlPoints = (preview.controlPoints || []).map(cp => {
    const p = point(cp);
    return `<circle class="preview-marker cp" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.4"><title>${esc(cp.name)}</title></circle>`;
  }).join('');
  const headquarters = Object.entries(preview.headquarters || {}).map(([owner, pos]) => {
    const p = point(pos);
    const cls = owner === 'player_a' ? 'hq-a' : 'hq-b';
    return `<rect class="preview-marker hq ${cls}" x="${(p.x - 4).toFixed(1)}" y="${(p.y - 4).toFixed(1)}" width="8" height="8" rx="1.5"></rect>`;
  }).join('');

  return `<div class="map-preview" aria-hidden="true">
    <svg viewBox="0 0 ${width} ${height}" role="img" focusable="false">
      ${hexes}${controlPoints}${headquarters}
    </svg>
  </div>`;
}

function syncMapSelection() {
  if (!els.mapPicker) return;
  const selected = els.mapSelect.value || 'default';
  els.mapPicker.querySelectorAll('.map-card').forEach(card => {
    const isSelected = card.dataset.mapId === selected;
    card.classList.toggle('selected-map', isSelected);
    card.setAttribute('aria-checked', String(isSelected));
    card.tabIndex = isSelected ? 0 : -1;
  });
}

function selectMap(mapId) {
  els.mapSelect.value = mapId;
  syncMapSelection();
  syncMaxPlayersOptions();
}

function syncMaxPlayersOptions() {
  if (!els.maxPlayers) return;
  const map = availableMaps.find(item => item.id === els.mapSelect.value);
  const supported = new Set(map?.preview?.supportedPlayerCounts || [2]);
  for (const option of els.maxPlayers.options) {
    option.disabled = !supported.has(Number(option.value));
  }
  if (!supported.has(Number(els.maxPlayers.value))) {
    els.maxPlayers.value = String(Math.min(...supported));
  }
}

function renderMapPicker(maps) {
  if (!els.mapPicker) return;
  if (!maps.length) {
    els.mapPicker.innerHTML = '<div class="map-picker-empty">暂无可用地图</div>';
    return;
  }
  const selected = els.mapSelect.value || maps[0].id;
  els.mapSelect.value = selected;
  els.mapPicker.innerHTML = maps.map(map => {
    const isSelected = map.id === selected;
	    const controlPointCount = map.preview?.controlPoints?.length ?? 0;
	    const radius = map.preview?.radius ?? '-';
		    const maxTurns = map.preview?.maxTurns ?? '-';
	    const counts = (map.preview?.supportedPlayerCounts || [2]).join('/');
    return `<button type="button" class="map-card ${isSelected ? 'selected-map' : ''}" data-map-id="${esc(map.id)}" role="radio" aria-checked="${isSelected}">
      ${renderMapPreview(map.preview)}
      <span class="map-card-copy">
        <span class="map-card-name">${esc(map.name)}</span>
        <span class="map-card-desc">${esc(map.description)}</span>
	        <span class="map-card-meta"><span>半径 ${esc(radius)}</span><span>${controlPointCount} 据点</span><span>${esc(counts)} 人</span><span>${esc(maxTurns)} 回合</span></span>
      </span>
    </button>`;
  }).join('');
  els.mapPicker.querySelectorAll('.map-card').forEach(card => {
    card.addEventListener('click', () => selectMap(card.dataset.mapId));
    card.addEventListener('keydown', e => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        selectMap(card.dataset.mapId);
      }
    });
  });
  syncMapSelection();
}

function createEmptyState() {
  return {
    players: {},
    cells: [],
    controlPoints: new Map(),
    headquarters: new Map(),
    units: new Map(),
    resources: {},
    turn: { roundNumber: 1, turnNumber: 1, currentPlayerId: null, currentOwner: null, turnOrder: [], actionsUsed: 0 },
    winner: null,
    result: null,
    eventLog: [],
  };
}
function applyEvent(s, ev) {
  if (s.eventLog.some(existing => existing.seq === ev.seq)) return;
  s.eventLog.push(ev);
  const p = ev.payload || {};
  switch (ev.type) {
    case 'game_start':
      gameConfig = p.config; if (p.playerNames) playerNames = { ...p.playerNames };
      s.players = JSON.parse(JSON.stringify(p.players || {}));
      s.turn.turnOrder = [...(p.turnOrder || [])];
      s.turn.currentPlayerId = p.firstPlayer || s.turn.turnOrder[0] || null;
      s.turn.currentOwner = s.turn.currentPlayerId;
      s.map = cloneMapPayload(p.map);
      s.cells = s.map.cells || [];
      s.controlPoints = new Map((p.controlPoints || []).map(cp => [cp.id, { ...cp }]));
      s.headquarters = new Map(Object.values(p.headquarters || {}).map(h => [h.id, { ...h }]));
      s.units = new Map((p.units || []).map(u => [u.id, { ...u }]));
      s.resources = JSON.parse(JSON.stringify(p.resources || s.resources));
      computeLayout(s.cells);
      break;
    case 'deploy':
      if (!s.resources[p.owner]) s.resources[p.owner] = { supplies: 0 };
      s.resources[p.owner].supplies -= p.cost || 0;
      s.units.set(p.unitId, { id: p.unitId, owner: p.owner, type: p.unitType, q: p.q, r: p.r, hp: p.hp, maxHp: p.hp, attack: p.attack, defense: p.defense, moveRange: p.moveRange, attackRange: p.attackRange, alive: true, hasMoved: true, hasActed: false, actionSpent: true, canCapture: !!p.canCapture, healPower: p.healPower, cost: p.unitCost ?? p.cost });
      if (typeof p.actionsUsed === 'number') s.turn.actionsUsed = p.actionsUsed;
      break;
    case 'move': { const u = s.units.get(p.unitId); if (u) { u.q = p.toQ; u.r = p.toR; u.hasMoved = true; u.actionSpent = true; } if (typeof p.actionsUsed === 'number') s.turn.actionsUsed = p.actionsUsed; break; }
    case 'attack': { const t = s.units.get(p.targetId) || s.headquarters.get(p.targetId); if (t) t.hp = p.targetHp; const a = s.units.get(p.attackerId); if (a) { a.hasActed = true; a.actionSpent = true; } if (typeof p.actionsUsed === 'number') s.turn.actionsUsed = p.actionsUsed; break; }
    case 'heal': { const t = s.units.get(p.targetId); if (t) t.hp = p.targetHp; const u = s.units.get(p.supportId); if (u) { u.hasActed = true; u.actionSpent = true; } if (typeof p.actionsUsed === 'number') s.turn.actionsUsed = p.actionsUsed; break; }
    case 'unit_death': { const u = s.units.get(p.unitId); if (u) u.alive = false; break; }
    case 'headquarters_destroyed': { const h = s.headquarters.get(p.headquartersId); if (h) h.alive = false; break; }
    case 'control_point_captured': { const cp = s.controlPoints.get(p.pointId); if (cp) cp.owner = p.owner; break; }
    case 'control_point_repair': { const u = s.units.get(p.unitId); if (u) u.hp = p.unitHp; break; }
    case 'income':
      if (!s.resources[p.owner]) s.resources[p.owner] = { supplies: 0 };
      s.resources[p.owner].supplies += p.amount;
      break;
    case 'comeback_supply':
      if (!s.resources[p.owner]) s.resources[p.owner] = { supplies: 0 };
      s.resources[p.owner].supplies += p.amount;
      break;
    case 'reset_actions':
      for (const u of s.units.values()) if (u.owner === p.owner) { u.hasMoved = false; u.hasActed = false; u.actionSpent = false; }
      if (typeof p.actionsUsed === 'number') s.turn.actionsUsed = p.actionsUsed;
      break;
    case 'turn_end':
      s.turn.currentOwner = p.nextPlayerId || p.nextOwner;
      s.turn.currentPlayerId = p.nextPlayerId || p.nextOwner;
      s.turn.roundNumber = p.roundNumber || p.turnNumber;
      s.turn.turnNumber = p.turnNumber || p.roundNumber;
      s.turn.actionsUsed = 0;
      break;
    case 'player_eliminated':
      if (s.players[p.playerId]) s.players[p.playerId].status = 'eliminated';
      for (const id of p.removedUnitIds || []) s.units.delete(id);
      for (const pointId of p.neutralizedPointIds || []) {
        const cp = s.controlPoints.get(pointId);
        if (cp) cp.owner = null;
      }
      break;
    case 'control_point_neutralized': {
      const cp = s.controlPoints.get(p.pointId);
      if (cp) cp.owner = null;
      break;
    }
    case 'game_over':
      s.winner = p.winner;
      s.result = { winner: p.winner ?? null, reason: p.reason || 'headquarters_destroyed', scores: p.scores };
      break;
    case 'name_rename': playerNames[p.playerId] = p.name; break;
    case 'demolish': {
      setCellTerrain(s, p.q, p.r, p.toTerrain || 'plain');
      const u = s.units.get(p.unitId);
      if (u) { u.hasActed = true; u.actionSpent = true; }
      if (typeof p.actionsUsed === 'number') s.turn.actionsUsed = p.actionsUsed;
      break;
    }
  }
}
async function loadFullState() {
  const { ok, data } = await API.get(`/api/games/${gameId}/events`);
  if (!ok) return false;
  playerNames = defaultPlayerNames();
  state = createEmptyState();
  for (const ev of data.events) applyEvent(state, ev);
  return true;
}

function cellAt(q, r) { return state.cells.find(c => c.q === q && c.r === r); }
function isPlain(q, r) { return cellAt(q, r)?.terrain === 'plain'; }
function entityAt(q, r, owner) {
  for (const u of state.units.values()) if (u.alive && u.q === q && u.r === r && (!owner || u.owner === owner)) return u;
  for (const h of state.headquarters.values()) if (h.alive && h.q === q && h.r === r && (!owner || h.owner === owner)) return h;
  return null;
}
function occupied(q, r) { return !!entityAt(q, r); }

function setCellTerrain(targetState, q, r, terrain) {
  const cell = targetState.cells.find(c => c.q === q && c.r === r);
  if (cell) cell.terrain = terrain;
}

function cloneMapPayload(map = {}) {
  return {
    ...map,
    cells: (map.cells || []).map(cell => ({ ...cell })),
    terrainCells: (map.terrainCells || []).map(cell => ({ ...cell })),
  };
}
function demolishableCells(unit) {
  if (unit.type !== 'heavy' || unit.hasActed) return [];
  return hexNeighbors(unit).filter(p => cellAt(p.q, p.r)?.terrain === 'blocker' && !occupied(p.q, p.r));
}
function reachable(unit) {
  const result = [], visited = new Set([hexKey(unit)]), queue = [{ q: unit.q, r: unit.r, d: 0 }];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    if (cur.d >= unit.moveRange) continue;
    for (const n of hexNeighbors(cur)) {
      const k = hexKey(n);
      if (visited.has(k)) continue;
      visited.add(k);
      if (!isPlain(n.q, n.r) || occupied(n.q, n.r)) continue;
      result.push(n);
      queue.push({ ...n, d: cur.d + 1 });
    }
  }
  return result;
}
function deployCells(origin) {
  return hexNeighbors(origin).filter(p => isPlain(p.q, p.r) && !occupied(p.q, p.r));
}
function attackRangeCells(unit) {
  return state.cells
    .map(c => ({ q: c.q, r: c.r, distance: hexDistance(unit, c) }))
    .filter(c => c.distance > 0 && c.distance <= unit.attackRange)
    .map(({ q, r }) => ({ q, r }));
}

function drawHpBar(x, y, width, hp, maxHp) {
  if (!maxHp || hp >= maxHp) return;
  ctx.fillStyle = '#190d0d'; ctx.fillRect(x - width / 2, y, width, 4);
  ctx.fillStyle = hp / maxHp > 0.5 ? '#49b66d' : hp / maxHp > 0.25 ? '#d0a832' : '#d65a4a';
  ctx.fillRect(x - width / 2, y, width * Math.max(0, hp / maxHp), 4);
}

function drawUnitGlyph(type, x, y) {
  ctx.save();
  ctx.fillStyle = '#071016';
  ctx.strokeStyle = '#071016';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  switch (type) {
    case 'infantry': {
      ctx.moveTo(x, y - 5); ctx.lineTo(x, y + 5);
      ctx.moveTo(x - 5, y); ctx.lineTo(x + 5, y);
      ctx.stroke();
      break;
    }
    case 'scout': {
      ctx.moveTo(x, y - 6);
      ctx.lineTo(x - 5, y + 4);
      ctx.lineTo(x + 5, y + 4);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'heavy': {
      ctx.fillRect(x - 5, y - 5, 10, 10);
      break;
    }
    case 'ranger': {
      ctx.moveTo(x, y - 6);
      ctx.lineTo(x + 4, y);
      ctx.lineTo(x, y + 6);
      ctx.lineTo(x - 4, y);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'support': {
      ctx.moveTo(x - 2, y - 5); ctx.lineTo(x + 2, y - 5);
      ctx.lineTo(x + 2, y - 2); ctx.lineTo(x + 5, y - 2);
      ctx.lineTo(x + 5, y + 2); ctx.lineTo(x + 2, y + 2);
      ctx.lineTo(x + 2, y + 5); ctx.lineTo(x - 2, y + 5);
      ctx.lineTo(x - 2, y + 2); ctx.lineTo(x - 5, y + 2);
      ctx.lineTo(x - 5, y - 2); ctx.lineTo(x - 2, y - 2);
      ctx.closePath();
      ctx.fill();
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

function drawControlPointGlyph(kind, x, y) {
  ctx.save();
  ctx.fillStyle = '#071016';
  ctx.strokeStyle = '#071016';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  switch (kind) {
    case 'supply': {
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'forward_base': {
      ctx.moveTo(x - 3, y + 6);
      ctx.lineTo(x - 3, y - 6);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 3, y - 6);
      ctx.lineTo(x + 6, y - 2);
      ctx.lineTo(x - 3, y + 2);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'repair': {
      ctx.arc(x, y - 1, 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + 3, y + 3);
      ctx.lineTo(x + 6, y + 6);
      ctx.stroke();
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

function drawUnitMarker(u) {
  if (!u.alive) return;
  const p = hexToPixel(u.q, u.r);
  ctx.fillStyle = OWNER_COLOR[u.owner] || '#9aa7b2';
  ctx.beginPath();
  ctx.arc(p.x, p.y, HEX_SIZE * .42, 0, Math.PI * 2);
  ctx.fill();
  drawUnitGlyph(u.type, p.x, p.y);
  drawHpBar(p.x, p.y - 21, 34, u.hp, u.maxHp);
  if (u.hasMoved || u.hasActed) {
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.beginPath();
    ctx.arc(p.x + 12, p.y + 12, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawHeadquartersMarker(hq) {
  const p = hexToPixel(hq.q, hq.r);
  pathHex(hq.q, hq.r, 5);
  ctx.fillStyle = hq.alive ? (OWNER_COLOR[hq.owner] || '#9aa7b2') : "#555";
  ctx.globalAlpha = hq.alive ? .78 : .3;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.save();
  ctx.fillStyle = "#071016";
  ctx.beginPath();
  ctx.fillRect(p.x - 6, p.y - 2, 12, 8);
  ctx.beginPath();
  ctx.moveTo(p.x, p.y - 8);
  ctx.lineTo(p.x - 7, p.y - 2);
  ctx.lineTo(p.x + 7, p.y - 2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  drawHpBar(p.x, p.y - 25, 42, hq.hp, hq.maxHp);
}

function drawControlPointMarker(cp) {
  const p = hexToPixel(cp.q, cp.r);
  pathHex(cp.q, cp.r, 8);
  ctx.fillStyle = cp.owner ? (OWNER_COLOR[cp.owner] || '#9aa7b2') : "#d6b34a";
  ctx.globalAlpha = .32;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = cp.owner ? (OWNER_COLOR[cp.owner] || '#9aa7b2') : "#d6b34a";
  ctx.lineWidth = 2;
  ctx.stroke();
  if (cp.kind) {
    drawControlPointGlyph(cp.kind, p.x, p.y);
  }
}
function unitLabel(type) { return { infantry: 'INF', scout: 'SCT', heavy: 'HVY', ranger: 'RNG', support: 'SUP' }[type] || '?'; }
function hpClass(ent) {
  const ratio = ent.maxHp ? ent.hp / ent.maxHp : 1;
  return ratio > 0.5 ? 'healthy' : ratio > 0.25 ? 'wounded' : 'critical';
}
function statItem(label, value, tone = '') {
  if (value == null) return '';
  return `<div class="sel-stat-card ${tone}"><span>${label}</span><strong>${esc(value)}</strong></div>`;
}
function controlPointEffect(cp) {
  if (!cp?.kind) return null;
  return gameConfig?.balance?.controlPointTypes?.[cp.kind] || null;
}
function controlPointLabel(cp) {
  return CONTROL_POINT_LABELS[cp?.kind] || 'CP';
}
function controlPointStats(cp) {
  const effect = controlPointEffect(cp);
  const income = effect ? effect.income : gameConfig?.balance?.controlPointIncome ?? 12;
  return [
    statItem('类型', cp.kind ? CONTROL_POINT_NAMES[cp.kind] || cp.kind : '普通据点', ''),
    statItem('收入', `+${income}`, 'cost'),
    effect?.deployDiscount ? statItem('部署折扣', `-${effect.deployDiscount}`, 'move') : '',
    effect?.repairAmount ? statItem('维修', `+${effect.repairAmount}`, 'heal') : '',
    statItem('部署', cp.owner ? '可用' : '中立', cp.owner ? 'move' : ''),
  ].join('');
}
function effectiveDeployCost(type, origin) {
  const base = gameConfig.units[type].cost;
  const discount = controlPointEffect(origin)?.deployDiscount || 0;
  return Math.max(0, base - discount);
}
function renderEntityCard(ent) {
  const type = ent.type || 'headquarters';
  const title = UNIT_NAMES[type] || '指挥部';
  const ownerClass = playerClass(ent.owner);
  const hpPct = Math.max(0, Math.min(100, ent.maxHp ? (ent.hp / ent.maxHp) * 100 : 0));
  const stats = [
    statItem('攻击', ent.attack, 'attack'),
    statItem('防御', ent.defense, 'defense'),
    statItem('移动', ent.moveRange, 'move'),
    statItem('射程', ent.attackRange, 'range'),
    statItem('治疗', ent.healPower, 'heal'),
    statItem('费用', ent.cost, 'cost'),
  ].join('');
  return `<div class="sel-card">
    <div class="sel-head">
      ${entityTokenMarkup(type, ownerClass, title)}
      <div class="sel-title-wrap">
        <div class="sel-type">${esc(title)}</div>
        <div class="sel-owner ${ownerClass}">${esc(playerName(ent.owner))}</div>
      </div>
    </div>
    <div class="sel-hp-row">
      <div class="sel-hp-label"><span>生命</span><strong>${Math.max(0, ent.hp)} / ${ent.maxHp}</strong></div>
      <div class="sel-hp-bar"><span class="sel-hp-fill ${hpClass(ent)}" style="width:${hpPct}%"></span></div>
    </div>
    ${stats ? `<div class="sel-stat-grid">${stats}</div>` : '<div class="sel-note">部署源</div>'}
    <div class="sel-coord">坐标 (${ent.q}, ${ent.r})</div>
  </div>`;
}
function renderControlPointCard(cp) {
  const owner = cp.owner ? playerName(cp.owner) : '中立';
  const ownerClass = cp.owner ? playerClass(cp.owner) : 'neutral';
  return `<div class="sel-card">
    <div class="sel-head">
      ${entityTokenMarkup(cp.kind || 'supply', ownerClass, cp.name)}
      <div class="sel-title-wrap">
        <div class="sel-type">${esc(cp.name)}</div>
        <div class="sel-owner ${ownerClass}">${esc(owner)}</div>
      </div>
    </div>
    <div class="sel-stat-grid">
      ${controlPointStats(cp)}
    </div>
    <div class="sel-coord">坐标 (${cp.q}, ${cp.r})</div>
  </div>`;
}
function drawBoard() {
  if (!state || state.cells.length === 0) return;
  ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
  ctx.fillStyle = '#0a0e14'; ctx.fillRect(0, 0, els.canvas.width, els.canvas.height);
  for (const c of state.cells) {
    pathHex(c.q, c.r, 1); ctx.fillStyle = TERRAIN[c.terrain] || TERRAIN.plain; ctx.fill(); ctx.strokeStyle = '#20313d'; ctx.lineWidth = 1; ctx.stroke();
  }
  for (const h of rangeHighlights) {
    pathHex(h.q, h.r, 3);
    ctx.fillStyle = h.type === 'move' ? 'rgba(60,200,120,.20)' : h.type === 'attack' ? 'rgba(255,80,80,.28)' : h.type === 'attack-radius' ? 'rgba(255,80,80,.08)' : h.type === 'deploy' ? 'rgba(240,210,90,.24)' : h.type === 'demolish' ? 'rgba(255,170,70,.28)' : 'rgba(80,220,180,.20)';
    ctx.fill();
  }
  if (hoverCell) { pathHex(hoverCell.q, hoverCell.r, 2); ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fill(); }
  for (const cp of state.controlPoints.values()) {
    drawControlPointMarker(cp);
  }
  for (const hq of state.headquarters.values()) {
    drawHeadquartersMarker(hq);
  }
  for (const u of state.units.values()) {
    drawUnitMarker(u);
  }
}

function actionsPerTurn() { return gameConfig?.balance?.actionsPerTurn ?? 0; }
function renderActionsDisplay(owner) {
  const max = actionsPerTurn();
  if (!max || !els.actionsDisplay) { if (els.actionsDisplay) els.actionsDisplay.innerHTML = ''; return; }
  const used = state.turn.actionsUsed || 0;
  const remaining = Math.max(0, max - used);
  const isMine = owner === myPlayer;
  const exhausted = remaining === 0;
  els.actionsDisplay.classList.toggle('exhausted', isMine && exhausted);
  els.actionsDisplay.classList.toggle('mine', isMine);
  if (isMine) {
    els.actionsDisplay.innerHTML = `<span class="actions-label">行动点</span><span class="actions-count ${exhausted ? 'zero' : ''}">${remaining}/${max}</span>${exhausted ? '<span class="actions-hint">已用尽，仅可继续操作已行动单位</span>' : ''}`;
  } else {
    els.actionsDisplay.innerHTML = `<span class="actions-label">行动点</span><span class="actions-count">${used}/${max} 已用</span>`;
  }
}

function playerScore(owner) {
  const weights = gameConfig?.balance?.adjudicationWeights;
  if (!weights || !state) return null;
  const ownHq = [...state.headquarters.values()].find(h => h.owner === owner);
  if (!ownHq) return null;
  const headquartersDamage = state.players?.[owner]?.stats?.headquartersDamage ?? [...state.headquarters.values()]
    .filter(h => h.owner !== owner)
    .reduce((sum, hq) => sum + Math.max(0, (hq.maxHp || 0) - (hq.hp || 0)), 0);
  const ownHqHp = Math.max(0, ownHq.hp || 0);
  const controlPoints = [...state.controlPoints.values()].filter(p => p.owner === owner).length;
  const armyValue = [...state.units.values()]
    .filter(u => u.owner === owner && u.alive)
    .reduce((sum, unit) => sum + Math.round((unit.cost || 0) * ((unit.hp || 0) / (unit.maxHp || 1))), 0);
  const supplies = state.resources?.[owner]?.supplies || 0;
  return {
    headquartersDamage,
    enemyHqDamage: headquartersDamage,
    ownHqHp,
    controlPoints,
    armyValue,
    supplies,
    total:
      headquartersDamage * weights.enemyHqDamage +
      ownHqHp * weights.ownHqHp +
      controlPoints * weights.controlPoint +
      armyValue * weights.armyValue +
      supplies * weights.supplies,
  };
}

function computeAdjudicationScores() {
  const scores = Object.fromEntries(joinedPlayerIds().map(id => [id, playerScore(id)]).filter(([, score]) => score));
  return Object.keys(scores).length ? scores : null;
}

function scoreBreakdown(score) {
  return `HQ伤害 ${score.headquartersDamage ?? score.enemyHqDamage} · HQ血量 ${score.ownHqHp} · 据点 ${score.controlPoints} · 兵力 ${score.armyValue} · 补给 ${score.supplies}`;
}

function scoreRank(rows, index) {
  const score = rows[index]?.[1]?.total ?? 0;
  const firstIndex = rows.findIndex(([, rowScore]) => (rowScore.total ?? 0) === score);
  return firstIndex + 1;
}

function renderScoreRow(owner, score, rank) {
  const cls = playerClass(owner);
  const mine = owner === myPlayer ? ' mine' : '';
  const status = state.players?.[owner]?.status === 'eliminated' ? ' · 已淘汰' : '';
  return `<div class="score-row ${cls}${mine}">
    <div class="score-row-head"><span><em class="score-rank">#${rank}</em>${esc(playerName(owner))}${owner === myPlayer ? '（你）' : ''}${status}</span><strong>${score.total}</strong></div>
    <div class="score-breakdown">${esc(scoreBreakdown(score))}</div>
  </div>`;
}

function renderScorePanel() {
  const scorePanelEl = els.scorePanel;
  if (!scorePanelEl) return;
  const scores = computeAdjudicationScores();
  if (!scores) {
    scorePanelEl.innerHTML = '<h3>分数排行榜</h3><div class="score-empty">等待对局开始</div>';
    return;
  }
  const rows = Object.entries(scores).sort((a, b) => b[1].total - a[1].total);
  scorePanelEl.innerHTML = `<h3>分数排行榜</h3>
    ${rows.map(([owner, score], index) => renderScoreRow(owner, score, scoreRank(rows, index))).join('')}`;
}

function renderSidebar() {
  if (!state) return;
  const owner = state.turn.currentPlayerId || state.turn.currentOwner;
  els.turnBadge.innerHTML = `<strong class="turn-count">${esc(turnProgressLabel())}</strong><span class="turn-player">${esc(playerName(owner))}</span>`;
  els.turnBadge.classList.toggle('my-turn', owner === myPlayer);
  const resourceRows = joinedPlayerIds().map(id => {
    const color = OWNER_COLOR[id] || '#9aa7b2';
    const supplies = state.resources?.[id]?.supplies ?? 0;
    return `<div class="resource-pill ${playerClass(id)} ${myPlayer === id ? 'mine' : ''}" style="border-left-color:${esc(color)}">
      <span>${esc(playerName(id))}</span><strong>${supplies}</strong>
    </div>`;
  }).join('');
  els.resDisplay.innerHTML = `<div class="status-grid">
    <div class="status-card active-turn ${owner === myPlayer ? 'mine' : ''}">
      <span>${owner === myPlayer ? '你的回合' : '等待对手'}</span>
      <strong>${esc(playerName(owner))}</strong>
    </div>
    ${resourceRows}
  </div>`;
  renderActionsDisplay(owner);
  renderScorePanel();
  els.events.innerHTML = '';
  for (const ev of state.eventLog.slice(-60)) {
    const li = document.createElement('li'); li.className = `type-${ev.type}`;
    li.innerHTML = `<span class="ev-seq">#${ev.seq}</span><span class="ev-type">${esc(ev.type)}</span>${esc(formatEventShort(ev))}`;
    els.events.appendChild(li);
  }
  els.events.scrollTop = els.events.scrollHeight;
  renderSelectionInfo();
}

function formatEventShort(ev) {
  const p = ev.payload || {};
  switch (ev.type) {
    case 'game_start': return '对局开始';
    case 'deploy': return `${playerName(p.owner)} 部署 ${UNIT_NAMES[p.unitType] || p.unitType}`;
    case 'move': return `移动到 (${p.toQ}, ${p.toR})`;
    case 'attack': return `攻击造成 ${p.damage} 伤害`;
    case 'heal': return `治疗 +${p.amount}`;
    case 'unit_death': return `${UNIT_NAMES[p.unitType] || '单位'} 阵亡`;
    case 'headquarters_destroyed': return `${playerName(p.owner)} 指挥部被摧毁`;
    case 'control_point_captured': return `${playerName(p.owner)} 占领 ${p.name}`;
    case 'control_point_repair': return `${p.pointName || '维修站'} 修复单位 +${p.amount}`;
    case 'income': return `${playerName(p.owner)} 收入 +${p.amount}`;
    case 'comeback_supply': return `${playerName(p.owner)} 追赶补给 +${p.amount}（落后${p.scoreGapPercent}%）`;
    case 'reset_actions': return `${playerName(p.owner)} 单位已重置`;
    case 'turn_end': return `轮到 ${playerName(p.nextOwner)}`;
    case 'game_over':
      if (p.reason === 'turn_limit_draw') return `${maxTurnsLabel()}裁决平局`;
      if (p.reason === 'turn_limit_score') return `${playerName(p.winner)} ${maxTurnsLabel()}裁决获胜`;
      return `${playerName(p.winner)} 获胜`;
    case 'name_rename': return `${p.playerId} 改名为 ${p.name}`;
    case 'demolish': return `${playerName(p.owner)} 爆破 (${p.q}, ${p.r})`;
    default: return JSON.stringify(p).slice(0, 100);
  }
}

function renderSelectionInfo(ent) {
  if (!ent && selectedUnitId) ent = state.units.get(selectedUnitId);
  if (!ent && selectedOriginId) ent = state.headquarters.get(selectedOriginId) || state.controlPoints.get(selectedOriginId);
  if (!ent) { els.selDetail.textContent = '点击己方单位执行移动/攻击/治疗；点击己方 HQ 或据点部署单位。'; return; }
  if ('hp' in ent) {
    els.selDetail.innerHTML = renderEntityCard(ent);
  } else {
    els.selDetail.innerHTML = renderControlPointCard(ent);
  }
}

function showPopup(cell, title, items, cb) {
  const p = canvasToCssPoint(hexToPixel(cell.q, cell.r));
  const popup = $('map-popup');
  popup.style.left = `${p.x + 18}px`; popup.style.top = `${p.y - 10}px`;
  popup.innerHTML = `<div class="map-popup-title">${esc(title)}</div>` + items.map(i => `<button class="map-popup-btn" data-action="${esc(i.action)}" data-type="${esc(i.type || '')}"><span>${esc(i.label)}</span>${i.cost != null ? `<span class="map-popup-cost">${i.cost}</span>` : ''}</button>`).join('');
  popup.classList.remove('hidden');
  popup.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => cb(btn.dataset.action, btn.dataset.type)));
}
function closePopup() { $('map-popup').classList.add('hidden'); }
function deselect() { selectedUnitId = null; selectedOriginId = null; selectedDeployType = null; interactionMode = 'idle'; rangeHighlights = []; closePopup(); renderSidebar(); drawBoard(); }

async function apiAction(path, body) {
  const { ok, data } = await API.post(path, body);
  if (!ok) toast(`${data.error || '操作失败'} (${data.code || ''})`, 'err');
  return ok;
}
async function afterAction(msg) {
  toast(msg, 'ok'); deselect();
}

function selectUnit(unit) {
  selectedUnitId = unit.id; selectedOriginId = null; selectedDeployType = null; interactionMode = 'unit_selected'; rangeHighlights = [];
  renderSidebar(); drawBoard();
  if (unit.owner !== myPlayer || (state.turn.currentPlayerId || state.turn.currentOwner) !== myPlayer) return;
  const items = [];
  if (!unit.hasMoved) items.push({ label: '移动', action: 'move' });
  if (!unit.hasActed) items.push({ label: unit.type === 'support' ? '治疗' : '攻击', action: unit.type === 'support' ? 'heal' : 'attack' });
  if (unit.type === 'heavy' && !unit.hasActed && demolishableCells(unit).length > 0) items.push({ label: '爆破', action: 'demolish' });
  if (items.length) showPopup(unit, '单位操作', items, action => {
    closePopup();
    if (action === 'move') { interactionMode = 'move_mode'; rangeHighlights = reachable(unit).map(p => ({ ...p, type: 'move' })); }
    if (action === 'attack') {
      interactionMode = 'attack_mode';
      const inRange = attackRangeCells(unit);
      rangeHighlights = inRange.map(p => {
        const target = entityAt(p.q, p.r);
        const isEnemy = target && target.owner !== myPlayer && target.alive;
        return { ...p, type: isEnemy ? 'attack' : 'attack-radius' };
      });
    }
    if (action === 'heal') { interactionMode = 'heal_mode'; rangeHighlights = [...state.units.values()].filter(e => e.owner === myPlayer && e.alive && e.hp < e.maxHp && hexDistance(unit, e) <= unit.attackRange).map(e => ({ q: e.q, r: e.r, type: 'heal' })); }
    if (action === 'demolish') {
      interactionMode = 'demolish_mode';
      rangeHighlights = demolishableCells(unit).map(p => ({ ...p, type: 'demolish' }));
    }
    drawBoard();
  });
}
function selectDeployOrigin(origin) {
  selectedOriginId = origin.id; selectedUnitId = null; selectedDeployType = null; interactionMode = 'deploy_origin'; rangeHighlights = [];
  renderSidebar(); drawBoard();
  if (origin.owner !== myPlayer && origin.owner !== undefined) return;
  if ((state.turn.currentPlayerId || state.turn.currentOwner) !== myPlayer) return;
  const items = Object.entries(gameConfig.units).map(([type]) => ({ label: UNIT_NAMES[type], action: 'deploy', type, cost: effectiveDeployCost(type, origin) }));
  showPopup(origin, '部署单位', items, (_action, type) => {
    closePopup(); interactionMode = 'deploy_mode'; selectedOriginId = origin.id; selectedDeployType = type;
    rangeHighlights = deployCells(origin).map(p => ({ ...p, type: 'deploy', unitType: type }));
    drawBoard();
  });
}

els.canvas.addEventListener('mousemove', e => {
  if (!state || state.cells.length === 0) return;
  const p = eventToCanvasPoint(e);
  const h = pixelToHex(p.x, p.y);
  hoverCell = cellAt(h.q, h.r) ? h : null;
  if (!hoverCell) els.cellInfo.textContent = '';
  else {
    const ent = entityAt(h.q, h.r);
    const cp = [...state.controlPoints.values()].find(p => p.q === h.q && p.r === h.r);
    els.cellInfo.textContent = `(${h.q}, ${h.r})${cp ? ` | ${cp.name}` : ''}${ent ? ` | ${UNIT_NAMES[ent.type] || 'HQ'} ${ent.hp}/${ent.maxHp}` : ''}`;
  }
  drawBoard();
});
els.canvas.addEventListener('mouseleave', () => { hoverCell = null; els.cellInfo.textContent = ''; drawBoard(); });
els.canvas.addEventListener('contextmenu', e => { e.preventDefault(); deselect(); });
els.canvas.addEventListener('click', async () => {
  if (!hoverCell || !state) return;
  const unit = [...state.units.values()].find(u => u.alive && u.q === hoverCell.q && u.r === hoverCell.r);
  const hq = [...state.headquarters.values()].find(h => h.alive && h.q === hoverCell.q && h.r === hoverCell.r);
  const cp = [...state.controlPoints.values()].find(p => p.q === hoverCell.q && p.r === hoverCell.r);

  if (interactionMode === 'move_mode' && rangeHighlights.some(h => h.q === hoverCell.q && h.r === hoverCell.r)) {
    if (await apiAction(`/api/games/${gameId}/move`, { unitId: selectedUnitId, q: hoverCell.q, r: hoverCell.r })) afterAction('移动成功');
    return;
  }
  if (interactionMode === 'attack_mode') {
    const hit = rangeHighlights.find(h => h.q === hoverCell.q && h.r === hoverCell.r);
    if (hit?.type === 'attack') {
      const target = entityAt(hoverCell.q, hoverCell.r);
      if (target && target.owner !== myPlayer && target.alive && await apiAction(`/api/games/${gameId}/attack`, { attackerId: selectedUnitId, targetId: target.id })) afterAction('攻击成功');
      return;
    }
  }
  if (interactionMode === 'heal_mode' && rangeHighlights.some(h => h.q === hoverCell.q && h.r === hoverCell.r)) {
    if (unit && await apiAction(`/api/games/${gameId}/heal`, { supportId: selectedUnitId, targetId: unit.id })) afterAction('治疗成功');
    return;
  }
  if (interactionMode === 'demolish_mode' && rangeHighlights.some(h => h.q === hoverCell.q && h.r === hoverCell.r)) {
    if (await apiAction(`/api/games/${gameId}/demolish`, { unitId: selectedUnitId, q: hoverCell.q, r: hoverCell.r })) afterAction('爆破成功');
    return;
  }
  if (interactionMode === 'deploy_mode' && rangeHighlights.some(h => h.q === hoverCell.q && h.r === hoverCell.r)) {
    if (await apiAction(`/api/games/${gameId}/deploy`, { unitType: selectedDeployType, fromId: selectedOriginId, q: hoverCell.q, r: hoverCell.r })) afterAction('部署成功');
    return;
  }

  closePopup(); rangeHighlights = [];
  if (unit) selectUnit(unit);
  else if (hq && hq.owner === myPlayer) selectDeployOrigin(hq);
  else if (cp && cp.owner === myPlayer) selectDeployOrigin(cp);
  else { selectedUnitId = null; selectedOriginId = null; renderSelectionInfo(hq || cp); drawBoard(); }
});

function subscribeSse() {
  if (sse) sse.close();
  const lastSeq = state?.eventLog.at(-1)?.seq ?? 0;
  sse = new EventSource(`/api/games/${gameId}/events?after=${lastSeq}`);
  sse.onmessage = e => { applyEvent(state, JSON.parse(e.data)); drawBoard(); renderSidebar(); };
  sse.onerror = () => statusBadge('SSE 断开', 'err');
  sse.onopen = () => statusBadge('已连接', 'ok');
}

function subscribeLobbyStart() {
  if (sse) sse.close();
  sse = new EventSource(`/api/games/${gameId}/events?after=0`);
  sse.onmessage = async e => {
    const event = JSON.parse(e.data);
    if (event.type !== 'game_start') return;
    if (els.joinStatusText) els.joinStatusText.textContent = '房主已开始，正在进入游戏…';
    await enterGame();
  };
  sse.onerror = () => statusBadge('大厅中', 'idle');
  sse.onopen = () => statusBadge('大厅中', 'idle');
}

function lobbySummaryMarkup(lobby) {
  const players = lobby.players || [];
  const supported = (lobby.supportedPlayerCounts || []).join('/');
  return `<div class="lobby-summary-head">
    <span>${esc(lobby.phase === 'active' ? '已开始' : '等待开局')}</span>
    <strong>${players.length}/${lobby.maxPlayers}</strong>
  </div>
  <div class="lobby-summary-meta">地图 ${esc(lobby.mapId)} · 支持 ${esc(supported)} 人</div>
  <div class="lobby-player-list">${players.map(player => `<span class="lobby-player" style="border-color:${esc(OWNER_COLOR[player.id] || '#7f98a9')}">${esc(player.name || player.id)}</span>`).join('')}</div>`;
}

function renderLobbySummary(lobby, target = els.lobbySummary) {
  if (!target || !lobby) return;
  target.innerHTML = lobbySummaryMarkup(lobby);
}

async function refreshLobbySummary() {
  if (!gameId) return null;
  const res = await fetch(`/api/games/${gameId}/lobby`);
  const data = await res.json();
  if (res.ok) {
    renderLobbySummary(data, els.lobbySummary);
    renderLobbySummary(data, els.joinLobbySummary);
  }
  return res.ok ? data : null;
}

function stopLobbyPolling() {
  if (lobbyPollTimer) clearInterval(lobbyPollTimer);
  lobbyPollTimer = null;
}

function startLobbyPolling() {
  stopLobbyPolling();
  lobbyPollTimer = setInterval(async () => {
    try {
      const lobby = await refreshLobbySummary();
      if (lobby?.phase !== 'active') return;
      stopLobbyPolling();
      if (els.joinStatusText) els.joinStatusText.textContent = '房主已开始，正在进入游戏…';
      await enterGame();
    } catch {
      statusBadge('大厅中', 'idle');
    }
  }, 1500);
}

async function startHostedGame() {
  if (!gameId || !hostToken) return toast('缺少房主凭证', 'err');
  const res = await fetch(`/api/games/${gameId}/start`, {
    method: 'POST',
    headers: { 'X-Host-Token': hostToken },
  });
  const data = await res.json();
  if (!res.ok) return toast(data.error || '开始失败', 'err');
  toast('对局已开始', 'ok');
  stopLobbyPolling();
  if (!myToken) {
    window.location.href = `/spectator.html?gameId=${encodeURIComponent(gameId)}`;
    return;
  }
  await enterGame();
}

els.btnEndTurn.addEventListener('click', async () => { if (await apiAction(`/api/games/${gameId}/end-turn`, {})) afterAction('回合结束'); });
els.btnRefresh.addEventListener('click', async () => { await loadFullState(); drawBoard(); renderSidebar(); toast('状态已刷新', 'ok'); });
els.btnCreate.addEventListener('click', async () => {
  els.btnCreate.disabled = true;
  try {
    const res = await fetch('/api/games', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mapId: els.mapSelect.value || 'default',
        maxPlayers: Number(els.maxPlayers?.value || 2),
        participate: els.hostParticipate?.checked !== false,
        playerName: els.createName.value.trim() || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast(data.error || '创建失败', 'err');
      return;
    }
    gameId = data.gameId;
    hostToken = data.hostToken;
    myToken = data.player?.token || null;
    myPlayer = data.player?.id || null;
    persistSession();
    els.createdGameId.textContent = gameId;
    els.createdHostToken.textContent = hostToken;
    els.createdToken.textContent = myToken || '未参战';
    els.createdPlayerTokenRow.classList.toggle('hidden', !myToken);
    renderLobbySummary(data.lobby, els.lobbySummary);
    els.createResult.classList.remove('hidden');
    statusBadge('大厅中', 'idle');
    startLobbyPolling();
  } catch {
    toast('创建失败：无法连接服务器', 'err');
  } finally {
    els.btnCreate.disabled = false;
  }
});
els.btnJoin.addEventListener('click', async () => {
  const gid = els.gameId.value.trim(); if (!gid) return;
  stopLobbyPolling();
  const res = await fetch(`/api/games/${gid}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: els.joinName.value.trim() || undefined }) });
  const data = await res.json();
  if (!res.ok) { els.joinStatusText.textContent = `加入失败: ${data.error}`; els.joinResult.classList.remove('hidden'); return; }
  myToken = data.player.token;
  myPlayer = data.player.id;
  gameId = gid;
  hostToken = null;
  persistSession();
  els.joinStatusText.textContent = data.lobby?.phase === 'active' ? '加入成功，正在进入游戏…' : '加入成功，等待房主开始';
  els.joinPlayerToken.textContent = myToken;
  els.joinPlayerTokenRow.classList.remove('hidden');
  els.joinResult.classList.remove('hidden');
  renderLobbySummary(data.lobby, els.joinLobbySummary);
  statusBadge(data.lobby?.phase === 'active' ? '正在进入' : '大厅中', 'idle');
  if (data.lobby?.phase === 'active') await enterGame();
  else {
    startLobbyPolling();
    subscribeLobbyStart();
  }
});
els.btnStartGame.addEventListener('click', startHostedGame);
els.btnConnectCreate.addEventListener('click', enterGame);
els.btnConnectJoin?.addEventListener('click', enterGame);
async function enterGame() {
  const ok = await loadFullState();
  if (!ok || !state.cells.length) {
    await refreshLobbySummary();
    return toast('对局尚未开始', 'info');
  }
  if (!myToken) {
    window.location.href = `/spectator.html?gameId=${encodeURIComponent(gameId)}`;
    return;
  }
  stopLobbyPolling();
  if (sse) { sse.close(); sse = null; }
  els.joinPanel.classList.add('hidden'); els.gameUI.classList.remove('hidden');
  subscribeSse(); drawBoard(); renderSidebar(); statusBadge('已连接', 'ok');
}
function ensureJoinConnectButton() {
  if (!els.joinResult || els.btnConnectJoin) return;
  const btn = document.createElement('button');
  btn.id = 'btn-connect-join';
  btn.className = 'btn success';
  btn.style.width = '100%';
  btn.style.marginTop = '10px';
  btn.textContent = '进入游戏';
  btn.addEventListener('click', enterGame);
  els.joinResult.appendChild(btn);
  els.btnConnectJoin = btn;
}
ensureJoinConnectButton();
document.querySelectorAll('.lobby-tab').forEach(tab => tab.addEventListener('click', () => {
  document.querySelectorAll('.lobby-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.lobby-tab-content').forEach(c => c.classList.remove('active'));
  tab.classList.add('active'); $(`tab-${tab.dataset.tab}`).classList.add('active');
}));
document.querySelectorAll('.btn-copy').forEach(btn => btn.addEventListener('click', () => navigator.clipboard.writeText($(btn.dataset.copy).textContent)));
document.addEventListener('keydown', e => { if (e.key === 'Escape') deselect(); });
document.addEventListener('click', e => { const popup = $('map-popup'); if (!popup.classList.contains('hidden') && !popup.contains(e.target) && e.target !== els.canvas) closePopup(); });
loadMapList();
