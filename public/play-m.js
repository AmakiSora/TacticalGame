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
  availableGames: $('available-games'), btnRefreshGames: $('btn-refresh-games'),
  gameUI: $('game-ui'), canvas: $('board'), cellInfo: $('cell-info'), turnBadge: $('turn-badge'),
  resDisplay: $('resources-display'), actionsDisplay: $('actions-display'),
  btnEndTurn: $('btn-end-turn'), btnRefresh: $('btn-refresh'), planPanel: $('plan-panel'),
  btnSkipReplay: $('btn-skip-replay'),
  selDetail: $('selection-detail'), events: $('events'), scorePanel: $('score-panel'),
  btnSettings: $('btn-settings'), settingsPopover: $('settings-popover'),
  settingsControlToken: $('settings-control-token'), btnSaveControlToken: $('btn-save-control-token'),
  settingsGameId: $('settings-game-id'), settingsPlayerToken: $('settings-player-token'), settingsHostToken: $('settings-host-token'),
  btnSaveSession: $('btn-save-session'), btnEnterSession: $('btn-enter-session'), btnClearSession: $('btn-clear-session'),
  botDialog: $('bot-dialog'), botDialogBackdrop: $('bot-dialog-backdrop'),
  botName: $('bot-name'), botModel: $('bot-model'), btnBotConfirm: $('btn-bot-confirm'), btnBotCancel: $('btn-bot-cancel'),
};
const ctx = els.canvas.getContext('2d');
let gameConfig = null;
const boardAnimation = window.BoardAnimation.create({
  hexToPixel,
  ownerColor: owner => OWNER_COLOR[owner] || '#9aa7b2',
  unitSpec: type => gameConfig?.units?.[type],
});

let playerNames = defaultPlayerNames();
let state = null;
let gameId = null;
let myToken = null;
let hostToken = null;
let myPlayer = null;
let sse = null;

// 结算回放：SSE 事件入队，按阶段分组按序播放；「跳过结算」直达终态。
const playback = window.PlaybackQueue.create({
  apply: ev => applyEvent(state, ev),
  effect: ev => boardAnimation.recordEvent(ev, state),
  sync: animate => boardAnimation.syncState(state, { animate }),
  render: () => { drawBoard(); renderSidebar(); },
  refresh: async () => { await refreshAdjudication(); renderSidebar(); },
  lastSeq: () => state?.eventLog?.at(-1)?.seq ?? 0,
  onActiveChange: active => { els.btnSkipReplay?.classList.toggle('hidden', !active); },
});
let lobbyPollTimer = null;
let availableGamesTimer = null;
let availableGamesLoading = false;
let hoverCell = null;
let selectedUnitId = null;
let selectedOriginId = null;
let selectedDeployType = null;
let interactionMode = 'idle';
let rangeHighlights = [];
let layout = { minX: 0, minY: 0, width: 840, height: 840 };
let availableMaps = [];
// mobile board transform (forked from play.js for phone shell)
let boardScale = 1;
let boardPanX = 0;
let boardPanY = 0;
const BOARD_SCALE_MIN = 0.4;
const BOARD_SCALE_MAX = 3;
const TAP_MOVE_THRESHOLD = 8;
const boardWorld = document.getElementById('board-world');
const boardViewport = document.getElementById('board-viewport');

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
  requestAnimationFrame(fitBoardToViewport);
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
function setBoardTransform() {
  if (!boardWorld) return;
  boardWorld.style.transform = `translate(${boardPanX}px, ${boardPanY}px) scale(${boardScale})`;
}
function clampBoardScale(s) {
  return Math.min(BOARD_SCALE_MAX, Math.max(BOARD_SCALE_MIN, s));
}
function fitBoardToViewport() {
  if (!boardViewport || !els.canvas.width) return;
  const vw = boardViewport.clientWidth;
  const vh = boardViewport.clientHeight;
  // absolute children can leave stage at 0x0 until layout stretch applies
  if (vw < 2 || vh < 2) {
    requestAnimationFrame(fitBoardToViewport);
    return;
  }
  const sx = vw / els.canvas.width;
  const sy = vh / els.canvas.height;
  boardScale = clampBoardScale(Math.min(sx, sy) * 0.96);
  boardPanX = (vw - els.canvas.width * boardScale) / 2;
  boardPanY = (vh - els.canvas.height * boardScale) / 2;
  setBoardTransform();
}
function eventToCanvasPoint(e) {
  if (!boardViewport) {
    const rect = els.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (els.canvas.width / Math.max(1, rect.width)),
      y: (e.clientY - rect.top) * (els.canvas.height / Math.max(1, rect.height)),
    };
  }
  const rect = boardViewport.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left - boardPanX) / boardScale,
    y: (e.clientY - rect.top - boardPanY) / boardScale,
  };
}
function canvasToCssPoint(p) {
  // popup is inside board-world (pre-transform coordinates)
  return { x: p.x, y: p.y };
}
function clampPopupInViewport(popup) {
  if (!popup || !boardViewport) return;
  const pr = popup.getBoundingClientRect();
  const vr = boardViewport.getBoundingClientRect();
  let dx = 0, dy = 0;
  if (pr.right > vr.right - 6) dx = (vr.right - 6 - pr.right) / boardScale;
  if (pr.left < vr.left + 6) dx = (vr.left + 6 - pr.left) / boardScale;
  if (pr.bottom > vr.bottom - 6) dy = (vr.bottom - 6 - pr.bottom) / boardScale;
  if (pr.top < vr.top + 6) dy = (vr.top + 6 - pr.top) / boardScale;
  if (dx || dy) {
    const left = parseFloat(popup.style.left) || 0;
    const top = parseFloat(popup.style.top) || 0;
    popup.style.left = `${left + dx}px`;
    popup.style.top = `${top + dy}px`;
  }
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
  els.mapSelect.innerHTML = `<option value="random">随机地图（参数可配）</option>`
    + maps.map(m => `<option value="${esc(m.id)}">${esc(m.name)} - ${esc(m.description)}</option>`).join('');
  // 默认仍选中第一张静态地图，保持原有创建习惯。
  if (maps[0]) els.mapSelect.value = maps[0].id;
  renderMapPicker(maps);
  syncMaxPlayersOptions();
  window.RandomMapUI?.setSelected(els.mapSelect.value);
}
function persistSession() {
  try {
    localStorage.setItem('tacticalGame.session', JSON.stringify({ gameId, myToken, myPlayer, hostToken }));
  } catch {
    // 浏览器禁用本地存储时不影响本局操作。
  }
}

function readStoredSession() {
  try {
    const raw = localStorage.getItem('tacticalGame.session');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      gameId: parsed.gameId || null,
      myToken: parsed.myToken || null,
      myPlayer: parsed.myPlayer || null,
      hostToken: parsed.hostToken || null,
    };
  } catch {
    return null;
  }
}

function fillSettingsFromSession() {
  if (els.settingsControlToken) {
    try {
      els.settingsControlToken.value = localStorage.getItem('autoControlToken') || '';
    } catch {
      els.settingsControlToken.value = '';
    }
  }
  if (els.settingsGameId) els.settingsGameId.value = gameId || '';
  if (els.settingsPlayerToken) els.settingsPlayerToken.value = myToken || '';
  if (els.settingsHostToken) els.settingsHostToken.value = hostToken || '';
}

function saveControlToken() {
  if (!els.settingsControlToken) return;
  try {
    localStorage.setItem('autoControlToken', els.settingsControlToken.value);
    toast('Control token 已保存', 'ok');
  } catch {
    toast('无法写入本地存储', 'err');
  }
}

function applySessionFieldsFromSettings() {
  const nextGameId = (els.settingsGameId?.value || '').trim();
  if (!nextGameId) {
    toast('请填写 Game ID', 'err');
    return false;
  }
  gameId = nextGameId;
  myToken = (els.settingsPlayerToken?.value || '').trim() || null;
  hostToken = (els.settingsHostToken?.value || '').trim() || null;
  // 仅保存 token 时无法可靠推断座位，保留已有 myPlayer。
  return true;
}

function saveSessionFromSettings() {
  if (!applySessionFieldsFromSettings()) return false;
  persistSession();
  fillSettingsFromSession();
  toast('会话已保存', 'ok');
  return true;
}

function clearSessionFromSettings() {
  gameId = null;
  myToken = null;
  hostToken = null;
  myPlayer = null;
  try {
    localStorage.removeItem('tacticalGame.session');
  } catch {
    // 浏览器禁用本地存储时只清内存。
  }
  fillSettingsFromSession();
  toast('会话已清除', 'ok');
}

async function enterGameFromSettings() {
  if (!applySessionFieldsFromSettings()) return;
  persistSession();
  if (els.gameId) els.gameId.value = gameId;
  await enterGame();
}

function restoreSessionIntoMemory() {
  const session = readStoredSession();
  if (!session?.gameId) return;
  gameId = session.gameId;
  myToken = session.myToken;
  myPlayer = session.myPlayer;
  hostToken = session.hostToken;
  if (els.gameId) els.gameId.value = gameId;
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
  if (!preview || !Array.isArray(preview.cells) || preview.cells.length === 0) {
    return '<div class="map-preview empty">暂无预览</div>';
  }

  const size = 7;
  const pad = 8;
  const cells = preview.cells;
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
    const terrainClass = cell.terrain || 'plain';
    return `<polygon class="preview-hex ${terrainClass}" points="${polygon(cell)}"></polygon>`;
  }).join('');
  const controlPoints = (preview.controlPoints || []).map(cp => {
    const p = point(cp);
    return `<circle class="preview-marker cp" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.4"><title>${esc(cp.name)}</title></circle>`;
  }).join('');
  const spawnHeadquarters = (preview.mode === 'annihilation' ? [] : (preview.spawnSlots || [])).map((slot, index) => ({
    id: slot.id,
    index,
    ...slot.headquarters,
  }));
  const legacyHeadquarters = preview.mode === 'annihilation' ? [] : Object.entries(preview.headquarters || {}).map(([id, pos], index) => ({ id, index, ...pos }));
  const headquarters = (spawnHeadquarters.length ? spawnHeadquarters : legacyHeadquarters).map(slot => {
    const p = point(slot);
    return `<rect class="preview-marker hq hq-slot-${slot.index + 1}" x="${(p.x - 4).toFixed(1)}" y="${(p.y - 4).toFixed(1)}" width="8" height="8" rx="1.5"><title>${esc(slot.id)}</title></rect>`;
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
  window.RandomMapUI?.setSelected(mapId);
}

function syncMaxPlayersOptions() {
  if (!els.maxPlayers) return;
  // 随机地图支持任意 2-8 人；静态地图按各自支持的人数。
  const selected = els.mapSelect.value;
  const supported = selected === 'random'
    ? new Set([2, 3, 4, 5, 6, 7, 8])
    : new Set(availableMaps.find(item => item.id === selected)?.preview?.supportedPlayerCounts || [2]);
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
  const randomCard = window.RandomMapUI?.renderRandomMapCard(selected === 'random') || '';
  els.mapPicker.innerHTML = randomCard + maps.map(map => {
    const isSelected = map.id === selected;
	    const controlPointCount = map.preview?.controlPoints?.length ?? 0;
	    const radius = map.preview?.radius ?? '-';
		    const maxTurns = map.preview?.maxTurns ?? '-';
		    const actionsPerTurn = map.preview?.actionsPerTurn ?? '-';
	    const counts = (map.preview?.supportedPlayerCounts || [2]).join('/');
	    const modeLabel = map.preview?.mode === 'simultaneous' ? '同时' : map.preview?.mode === 'annihilation' ? '歼灭' : '标准';
    return `<button type="button" class="map-card ${isSelected ? 'selected-map' : ''}" data-map-id="${esc(map.id)}" role="radio" aria-checked="${isSelected}" aria-label="${esc(map.name)} (${esc(map.id)})">
      ${renderMapPreview(map.preview)}
      <span class="map-card-copy">
        <span class="map-card-name"><span class="map-card-name-zh">${esc(map.name)}</span><span class="map-card-name-en">${esc(map.id)}</span></span>
        <span class="map-card-meta">
          <span class="meta-tag" data-label="地图半径">⊘${esc(radius)}</span>
          <span class="meta-tag" data-label="据点数">⬡${controlPointCount}</span>
          <span class="meta-tag" data-label="玩家数">⚑${esc(counts)}</span>
          <span class="meta-tag" data-label="每回合行动点">♟${esc(actionsPerTurn)}</span>
          <span class="meta-tag" data-label="最大回合数">⏱${esc(maxTurns)}</span>
          <span class="meta-tag" data-label="游戏模式">${esc(modeLabel)}</span>
        </span>
      </span>
      <span class="map-card-tooltip" role="tooltip">
        <span class="tooltip-name">${esc(map.name)} <span class="tooltip-id">${esc(map.id)}</span></span>
        <span class="tooltip-desc">${esc(map.description)}</span>
        <span class="tooltip-stats">
          <span class="tooltip-stat"><b>⊘ ${esc(radius)}</b>地图半径</span>
          <span class="tooltip-stat"><b>⬡ ${controlPointCount}</b>据点数</span>
          <span class="tooltip-stat"><b>⚑ ${esc(counts)}</b>玩家数</span>
          <span class="tooltip-stat"><b>♟ ${esc(actionsPerTurn)}</b>每回合行动点</span>
          <span class="tooltip-stat"><b>⏱ ${esc(maxTurns)}</b>最大回合数</span>
        </span>
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
    plan: { committed: [], myQueue: [] },
    winner: null,
    result: null,
    adjudication: null,
    artillery: null,
    eventLog: [],
  };
}
function recordActionPoint(s, owner, payload) {
  if (!owner || typeof payload.actionsUsed !== 'number' || payload.actionsUsed <= (s.turn.actionsUsed ?? 0)) return;
  const player = s.players?.[owner];
  if (!player) return;
  if (!player.stats) player.stats = { headquartersDamage: 0, unitsDestroyed: 0, playersEliminated: 0, actionPointsUsed: 0, actionMerit: 0 };
  player.stats.actionPointsUsed = (player.stats.actionPointsUsed ?? 0) + payload.actionsUsed - (s.turn.actionsUsed ?? 0);
}
function recordActionMerit(s, owner, type, payload) {
  const fixed = type === 'deploy' || type === 'demolish' ? 1 : type === 'control_point_captured' ? 2 : 0;
  const amount = type === 'attack' ? payload.actualDamage ?? payload.damage : type === 'heal' ? payload.amount : 0;
  const merit = fixed || (typeof amount === 'number' && amount > 0 ? Math.ceil(amount / 20) : 0);
  const player = owner ? s.players?.[owner] : null;
  if (!player || merit <= 0) return;
  if (!player.stats) player.stats = { headquartersDamage: 0, unitsDestroyed: 0, playersEliminated: 0, actionPointsUsed: 0, actionMerit: 0 };
  player.stats.actionMerit = (player.stats.actionMerit ?? 0) + merit;
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
      s.turn.currentPlayerId = gameConfig?.mode === 'simultaneous' ? null : (p.firstPlayer || s.turn.turnOrder[0] || null);
      s.turn.currentOwner = s.turn.currentPlayerId;
      s.plan = { committed: [], myQueue: [] };
      s.map = cloneMapPayload(p.map);
      s.cells = s.map.cells || [];
      s.controlPoints = new Map((p.controlPoints || []).map(cp => [cp.id, { ...cp }]));
      s.headquarters = new Map(Object.values(p.headquarters || {}).map(h => [h.id, { ...h }]));
      s.units = new Map((p.units || []).map(u => [u.id, { ...u }]));
      s.resources = JSON.parse(JSON.stringify(p.resources || s.resources));
      s.artillery = p.artillery ? JSON.parse(JSON.stringify(p.artillery)) : null;
      computeLayout(s.cells);
      break;
    case 'deploy':
      recordActionPoint(s, p.owner, p);
      recordActionMerit(s, p.owner, ev.type, p);
      if (!s.resources[p.owner]) s.resources[p.owner] = { supplies: 0 };
      s.resources[p.owner].supplies -= p.cost || 0;
      s.units.set(p.unitId, { id: p.unitId, owner: p.owner, type: p.unitType, q: p.q, r: p.r, hp: p.hp, maxHp: p.hp, attack: p.attack, defense: p.defense, moveRange: p.moveRange, attackRange: p.attackRange, alive: true, hasMoved: true, hasActed: false, actionSpent: true, canCapture: !!p.canCapture, healPower: p.healPower, cost: p.unitCost ?? p.cost });
      if (typeof p.actionsUsed === 'number') s.turn.actionsUsed = p.actionsUsed;
      break;
    case 'move': { const u = s.units.get(p.unitId); recordActionPoint(s, p.owner || u?.owner, p); if (u) { u.q = p.toQ; u.r = p.toR; u.hasMoved = true; u.actionSpent = true; } if (typeof p.actionsUsed === 'number') s.turn.actionsUsed = p.actionsUsed; break; }
    case 'attack': { const t = s.units.get(p.targetId) || s.headquarters.get(p.targetId); if (t) t.hp = p.targetHp; const a = s.units.get(p.attackerId); recordActionPoint(s, p.owner || a?.owner, p); recordActionMerit(s, p.owner || a?.owner, ev.type, p); if (a) { a.hasActed = true; a.actionSpent = true; } if (typeof p.actionsUsed === 'number') s.turn.actionsUsed = p.actionsUsed; break; }
    case 'heal': { const t = s.units.get(p.targetId); if (t) t.hp = p.targetHp; const u = s.units.get(p.supportId); recordActionPoint(s, p.owner || u?.owner, p); recordActionMerit(s, p.owner || u?.owner, ev.type, p); if (u) { u.hasActed = true; u.actionSpent = true; } if (typeof p.actionsUsed === 'number') s.turn.actionsUsed = p.actionsUsed; break; }
    case 'unit_death': { const u = s.units.get(p.unitId); if (u) u.alive = false; break; }
    case 'headquarters_destroyed': { const h = s.headquarters.get(p.headquartersId); if (h) h.alive = false; break; }
    case 'control_point_captured': { recordActionMerit(s, p.owner, ev.type, p); const cp = s.controlPoints.get(p.pointId); if (cp) cp.owner = p.owner; break; }
    case 'control_point_repair': { const u = s.units.get(p.unitId); if (u) u.hp = p.unitHp; break; }
    case 'income':
      if (!s.resources[p.owner]) s.resources[p.owner] = { supplies: 0 };
      s.resources[p.owner].supplies += p.amount;
      break;
    case 'comeback_supply':
      if (!s.resources[p.owner]) s.resources[p.owner] = { supplies: 0 };
      s.resources[p.owner].supplies += p.amount;
      break;
    case 'artillery_warning':
      s.artillery = { ...(s.artillery || {}), safeRadius: p.safeRadius, warningCells: p.warningCells || [], nextShrinkRound: p.nextShrinkRound };
      break;
    case 'artillery_shrunk':
      s.artillery = { safeRadius: p.safeRadius, dangerCells: p.dangerCells || [], warningCells: p.warningCells || [], nextShrinkRound: p.nextShrinkRound };
      break;
    case 'artillery_damage': {
      const unit = s.units.get(p.unitId);
      if (unit) unit.hp = p.unitHp;
      break;
    }
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
      if (s.players[p.playerId]) {
        s.players[p.playerId].status = 'eliminated';
        if (p.score && typeof p.score === 'object') s.players[p.playerId].adjudicationScore = p.score;
      }
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
    case 'plan_committed':
      if (!s.plan) s.plan = { committed: [], myQueue: [] };
      if (Array.isArray(p.committed)) s.plan.committed = [...p.committed];
      break;
    case 'round_end':
      break;
    case 'round_resolved':
      s.plan = { committed: [], myQueue: [] };
      s.lastRoundResults = p.results || null;
      break;
    case 'round_start':
      s.turn.roundNumber = p.roundNumber || s.turn.roundNumber + 1;
      s.turn.turnNumber = s.turn.roundNumber;
      s.turn.actionsUsed = 0;
      // 同时模式没有 reset_actions 事件：新回合开启即重置全员单位行动标志。
      for (const u of s.units.values()) { u.hasMoved = false; u.hasActed = false; u.actionSpent = false; }
      s.plan = { committed: Array.isArray(p.committed) ? [...p.committed] : [], myQueue: [] };
      break;
    case 'game_over':
      s.winner = p.winner;
      s.result = { winner: p.winner ?? null, reason: p.reason || 'headquarters_destroyed', scores: p.scores, rankings: p.rankings };
      if (p.scores) {
        s.adjudication = {
          ...(s.adjudication || {}),
          scores: p.scores,
          rankings: p.rankings || s.adjudication?.rankings || [],
          leaders: leadersFromGameOverPayload(p),
        };
      }
      break;
    case 'name_rename': playerNames[p.playerId] = p.name; break;
    case 'demolish': {
      setCellTerrain(s, p.q, p.r, p.toTerrain || 'plain');
      const u = s.units.get(p.unitId);
      recordActionPoint(s, p.owner || u?.owner, p);
      recordActionMerit(s, p.owner || u?.owner, ev.type, p);
      if (u) { u.hasActed = true; u.actionSpent = true; }
      if (typeof p.actionsUsed === 'number') s.turn.actionsUsed = p.actionsUsed;
      break;
    }
  }
}
/** Leaders among the adjudication contender pool (active seats, else all scored seats). */
function leadersFromGameOverPayload(p) {
  if (p?.winner) return [p.winner];
  const scores = p?.scores || {};
  const rankings = Array.isArray(p?.rankings) ? p.rankings : [];
  const activeIds = rankings.filter(row => row.status === 'active').map(row => row.playerId);
  const pool = activeIds.length > 0 ? activeIds : Object.keys(scores);
  if (pool.length === 0) return [];
  const top = Math.max(...pool.map(id => scores[id]?.total ?? 0));
  return pool.filter(id => (scores[id]?.total ?? 0) === top);
}

async function loadFullState() {
  const { ok, data } = await API.get(`/api/games/${gameId}/events`);
  if (!ok) return false;
  playback.reset();
  playerNames = defaultPlayerNames();
  state = createEmptyState();
  for (const ev of data.events) applyEvent(state, ev);
  boardAnimation.reset();
  boardAnimation.syncState(state, { animate: false });
  await refreshAdjudication();
  return true;
}

let adjudicationRefreshInFlight = null;
let adjudicationRefreshQueued = false;

/** Pull authoritative live scoreboard from GET /api/games/:id when a player token is available. */
async function refreshAdjudication() {
  if (!gameId || !myToken || !state) return false;
  // Coalesce concurrent SSE bursts into one GET.
  if (adjudicationRefreshInFlight) {
    adjudicationRefreshQueued = true;
    return adjudicationRefreshInFlight;
  }
  adjudicationRefreshInFlight = (async () => {
    try {
      do {
        adjudicationRefreshQueued = false;
        const { ok, data } = await API.get(`/api/games/${gameId}`);
        if (!ok || !data?.adjudication || !state) return false;
        state.adjudication = data.adjudication;
        // 同时模式：合并服务器返回的计划状态（自己的队列 + 已确认名单）。
        if (data.plan) {
          state.plan = {
            committed: Array.isArray(data.plan.committed) ? [...data.plan.committed] : (state.plan?.committed ?? []),
            myQueue: Array.isArray(data.plan.myQueue) ? [...data.plan.myQueue] : (state.plan?.myQueue ?? []),
          };
        }
      } while (adjudicationRefreshQueued);
      return true;
    } finally {
      adjudicationRefreshInFlight = null;
    }
  })();
  return adjudicationRefreshInFlight;
}

function cellAt(q, r) { return state.cells.find(c => c.q === q && c.r === r); }
function isPlain(q, r) { return cellAt(q, r)?.terrain === 'plain'; }
function isArtilleryDangerCell(q, r) { return Boolean(state.artillery?.dangerCells?.some(cell => cell.q === q && cell.r === r)); }
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
  if (isArtilleryDangerCell(origin.q, origin.r)) return [];
  return hexNeighbors(origin).filter(p => isPlain(p.q, p.r) && !occupied(p.q, p.r) && !isArtilleryDangerCell(p.q, p.r));
}
const SHAPE_HEX_DIRS = [{ q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 }, { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }];
function unitShapeSpec(unit, kind) {
  const shape = gameConfig?.units?.[unit.type]?.[kind];
  if (!shape) return { type: 'single', length: 1 };
  if (shape.type === 'line') return { type: 'line', length: shape.length ?? 2 };
  if (shape.type === 'arc') return { type: 'arc', length: 3 };
  return { type: 'single', length: 1 };
}
function unitHealRange(unit) {
  return gameConfig?.units?.[unit.type]?.healRange ?? unit.attackRange;
}
/** 客户端镜像服务端的形状瞄准推导：返回 { type, direction, cells } 或 null（不可瞄准）。 */
function shapeAimFor(unit, kind, q, r) {
  const shape = unitShapeSpec(unit, kind);
  const dq = q - unit.q, dr = r - unit.r;
  if (shape.type === 'single') {
    const d = hexDistance(unit, { q, r });
    if (d > (kind === 'healShape' ? unitHealRange(unit) : unit.attackRange)) return null;
    if (kind === 'attackShape' && d === 0) return null;
    return { type: 'single', direction: 0, cells: [{ q, r }] };
  }
  if (shape.type === 'arc') {
    if (hexDistance(unit, { q, r }) !== 1) return null;
    const direction = SHAPE_HEX_DIRS.findIndex(dir => dir.q === dq && dir.r === dr);
    if (direction < 0) return null;
    const idx = [(direction + 5) % 6, direction, (direction + 1) % 6];
    return { type: 'arc', direction, cells: idx.map(i => ({ q: unit.q + SHAPE_HEX_DIRS[i].q, r: unit.r + SHAPE_HEX_DIRS[i].r })) };
  }
  for (let direction = 0; direction < 6; direction++) {
    const dir = SHAPE_HEX_DIRS[direction];
    const k = dir.q !== 0 ? dq / dir.q : dr / dir.r;
    if (!Number.isInteger(k) || k < 1 || k > shape.length) continue;
    if (dir.q * k !== dq || dir.r * k !== dr) continue;
    const cells = [];
    for (let s = 1; s <= shape.length; s++) cells.push({ q: unit.q + dir.q * s, r: unit.r + dir.r * s });
    return { type: 'line', direction, cells };
  }
  return null;
}
/** 可点击的瞄准格集合。旧地图无形状配置 → single = 射程内全部格（与历史行为一致）。 */
function aimableCells(unit, kind) {
  const aims = [];
  for (const c of state.cells) {
    if (shapeAimFor(unit, kind, c.q, c.r)) aims.push({ q: c.q, r: c.r });
  }
  return aims;
}
function attackRangeCells(unit) {
  return aimableCells(unit, 'attackShape');
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

function drawUnitMarker(u, view = null) {
  if (!u.alive && !view) return;
  const p = view || hexToPixel(u.q, u.r);
  const alpha = view?.alpha ?? 1;
  const scale = view?.scale ?? 1;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(p.x, p.y);
  ctx.scale(scale, scale);
  ctx.translate(-p.x, -p.y);
  ctx.fillStyle = OWNER_COLOR[u.owner] || '#9aa7b2';
  ctx.beginPath();
  ctx.arc(p.x, p.y, HEX_SIZE * .42, 0, Math.PI * 2);
  ctx.fill();
  drawUnitGlyph(u.type, p.x, p.y);
  if (u.hasMoved || u.hasActed) {
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.beginPath();
    ctx.arc(p.x + 12, p.y + 12, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = alpha;
  drawHpBar(p.x, p.y - 21, 34, u.hp, u.maxHp);
  ctx.restore();
}

function drawHeadquartersMarker(hq, view = null) {
  if (!hq.alive && !view) return;
  const p = view || hexToPixel(hq.q, hq.r);
  const alpha = view?.alpha ?? 1;
  const scale = view?.scale ?? 1;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(p.x, p.y);
  ctx.scale(scale, scale);
  ctx.translate(-p.x, -p.y);
  pathHex(hq.q, hq.r, 5);
  ctx.fillStyle = hq.alive ? (OWNER_COLOR[hq.owner] || '#9aa7b2') : "#555";
  ctx.globalAlpha = alpha * (hq.alive ? .78 : .3);
  ctx.fill();
  ctx.globalAlpha = alpha;
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
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = alpha;
  drawHpBar(p.x, p.y - 25, 42, hq.hp, hq.maxHp);
  ctx.restore();
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
function drawBoard(now = performance.now()) {
  if (!state || state.cells.length === 0) return;
  ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
  ctx.fillStyle = '#0a0e14'; ctx.fillRect(0, 0, els.canvas.width, els.canvas.height);
  for (const c of state.cells) {
    pathHex(c.q, c.r, 1); ctx.fillStyle = TERRAIN[c.terrain] || TERRAIN.plain; ctx.fill(); ctx.strokeStyle = '#20313d'; ctx.lineWidth = 1; ctx.stroke();
  }
  for (const cell of state.artillery?.warningCells || []) {
    pathHex(cell.q, cell.r, 2); ctx.fillStyle = 'rgba(244, 177, 66, .22)'; ctx.fill(); ctx.strokeStyle = 'rgba(255, 205, 105, .72)'; ctx.lineWidth = 1.5; ctx.stroke();
  }
  for (const cell of state.artillery?.dangerCells || []) {
    pathHex(cell.q, cell.r, 2); ctx.fillStyle = 'rgba(205, 55, 45, .34)'; ctx.fill(); ctx.strokeStyle = 'rgba(255, 95, 75, .68)'; ctx.lineWidth = 1.5; ctx.stroke();
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
  boardAnimation.forEachHeadquarters((hq, view) => drawHeadquartersMarker(hq, view));
  boardAnimation.forEachUnit((u, view) => drawUnitMarker(u, view));
  boardAnimation.drawEffects(ctx, now);
}

function renderLoop(now) {
  if (boardAnimation.isActive()) {
    boardAnimation.update(now);
    drawBoard(now);
  }
  requestAnimationFrame(renderLoop);
}

function actionsPerTurn() { return gameConfig?.balance?.actionsPerTurn ?? 0; }
function isSimultaneous() { return gameConfig?.mode === 'simultaneous'; }
function myPlanQueue() { return state?.plan?.myQueue ?? []; }
function committedList() { return state?.plan?.committed ?? []; }
function committedStatusHtml() {
  if (!isSimultaneous()) return '';
  const players = joinedPlayerIds().filter(id => state.players?.[id]?.status !== 'eliminated');
  const committed = new Set(committedList().filter(id => players.includes(id)));
  if (!players.length) return '';
  const tags = players.map(id => `<span class="turn-commit-tag ${playerClass(id)}${committed.has(id) ? ' is-committed' : ' is-pending'}" title="${esc(playerName(id))}"><span class="turn-commit-icon" aria-hidden="true">${committed.has(id) ? '✓' : ''}</span><span>${esc(String(id).replace(/^player_/, '').toUpperCase())}</span></span>`).join('');
  return `<div class="turn-commit-status" aria-label="计划提交状态"><span class="turn-commit-count">${committed.size}/${players.length} 已提交</span><div class="turn-commit-tags">${tags}</div></div>`;
}
function iCommitted() { return committedList().includes(myPlayer); }
/** 当下是否允许我方操作：顺序模式=轮到我；同时模式=计划阶段且我未确认。 */
function canActNow() {
  if (!state || state.winner) return false;
  if (playback.isActive()) return false; // 结算回放中暂不可操作。
  if (isSimultaneous()) {
    return state.players?.[myPlayer]?.status === 'active' && !iCommitted();
  }
  return (state.turn?.currentPlayerId || state.turn?.currentOwner) === myPlayer;
}
/** 同时模式：该单位本回合是否已有排队动作（每单位一个动作）。 */
function unitHasPlannedAction(unitId) {
  return myPlanQueue().some(a => a.unitId === unitId || a.attackerId === unitId || a.supportId === unitId);
}
function describePlanAction(a) {
  const typeLabel = { deploy: '部署', move: '移动', attack: '攻击', heal: '治疗', demolish: '爆破' }[a.type] || a.type;
  if (a.type === 'heal') return Number.isFinite(a.q) && Number.isFinite(a.r) ? `${typeLabel} → (${a.q}, ${a.r})` : `${typeLabel} 友方单位`;
  if (Number.isFinite(a.q) && Number.isFinite(a.r)) return `${typeLabel} → (${a.q}, ${a.r})`;
  return typeLabel;
}
function renderPlanPanel() {
  const el = els.planPanel;
  if (!el) return;
  if (!isSimultaneous()) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const queue = myPlanQueue();
  const max = actionsPerTurn();
  const activeCount = joinedPlayerIds().filter(id => state.players[id]?.status === 'active').length;
  const committedNames = committedList().map(id => playerName(id)).join('、') || '—';
  const rows = queue.map(a => `
    <li class="plan-item">
      <span>${esc(describePlanAction(a))}</span>
      ${iCommitted() ? '' : `<button class="plan-revoke" data-revoke="${esc(a.id)}" title="撤销该指令">撤销</button>`}
    </li>`).join('');
  el.innerHTML = `<h3>本回合计划 <span class="plan-count">${queue.length}/${max}</span></h3>
    <ul class="plan-list">${rows || '<li class="plan-empty">尚未下达指令，点击棋盘单位开始排队</li>'}</ul>
    <div class="plan-status">${iCommitted() ? '已确认，等待全员提交后统一结算' : `已确认 ${committedList().length}/${activeCount}（${esc(committedNames)}）`}</div>`;
  el.querySelectorAll('.plan-revoke').forEach(btn => btn.addEventListener('click', async () => {
    if (await apiAction(`/api/games/${gameId}/plan/revoke`, { actionId: btn.dataset.revoke })) {
      await refreshAdjudication();
      renderSidebar();
      drawBoard();
    }
  }));
}
function renderActionsDisplay(owner) {
  const max = actionsPerTurn();
  if (!max || !els.actionsDisplay) { if (els.actionsDisplay) els.actionsDisplay.innerHTML = ''; return; }
  if (isSimultaneous()) {
    const usedSim = myPlanQueue().length;
    const remainingSim = Math.max(0, max - usedSim);
    els.actionsDisplay.innerHTML = `<div class="hud-chip hud-ap mine${remainingSim === 0 ? ' exhausted' : ''}">
      <span class="hud-label">行动</span>
      <strong class="hud-value${remainingSim === 0 ? ' zero' : ''}">${remainingSim}/${max}</strong>
      <span class="hud-sub">${remainingSim === 0 ? '计划已满' : '计划剩余'}</span>
    </div>`;
    return;
  }
  const used = state.turn.actionsUsed || 0;
  const remaining = Math.max(0, max - used);
  const isMine = owner === myPlayer;
  const exhausted = remaining === 0;
  els.actionsDisplay.classList.toggle('exhausted', isMine && exhausted);
  els.actionsDisplay.classList.toggle('mine', isMine);
  const value = isMine ? `${remaining}/${max}` : `${used}/${max}`;
  const sub = isMine ? (exhausted ? '已用尽' : '剩余') : '本回合已用';
  els.actionsDisplay.innerHTML = `<div class="hud-chip hud-ap${isMine ? ' mine' : ''}${exhausted && isMine ? ' exhausted' : ''}">
    <span class="hud-label">行动</span>
    <strong class="hud-value${exhausted && isMine ? ' zero' : ''}">${value}</strong>
    <span class="hud-sub">${sub}</span>
  </div>`;
}

function playerScore(owner) {
  const weights = gameConfig?.balance?.adjudicationWeights;
  if (!weights || !state) return null;
  const preserved = state.players?.[owner]?.status === 'eliminated'
    ? state.players[owner].adjudicationScore
    : null;
  if (preserved) return { ...preserved };
  const ownHq = [...state.headquarters.values()].find(h => h.owner === owner);
  if (!ownHq && gameConfig?.mode !== 'annihilation') return null;
  const headquartersDamage = state.players?.[owner]?.stats?.headquartersDamage ?? [...state.headquarters.values()]
    .filter(h => h.owner !== owner)
    .reduce((sum, hq) => sum + Math.max(0, (hq.maxHp || 0) - (hq.hp || 0)), 0);
  const ownHqHp = ownHq ? Math.max(0, ownHq.hp || 0) : 0;
  const controlPoints = [...state.controlPoints.values()].filter(p => p.owner === owner).length;
  const armyValue = [...state.units.values()]
    .filter(u => u.owner === owner && u.alive)
    .reduce((sum, unit) => sum + Math.round((unit.cost || 0) * ((unit.hp || 0) / (unit.maxHp || 1))), 0);
  const supplies = state.resources?.[owner]?.supplies || 0;
  const actionScorePerPoint = gameConfig?.balance?.adjudicationWeights?.effectiveActions
    ?? gameConfig?.balance?.adjudicationWeights?.actionPoints
    ?? (gameConfig?.mode === 'annihilation' ? 10 : 2);
  const actionScore = (state.players?.[owner]?.stats?.actionMerit ?? 0) * actionScorePerPoint;
  return {
    headquartersDamage,
    enemyHqDamage: headquartersDamage,
    ownHqHp,
    controlPoints,
    armyValue,
    supplies,
    actionScore,
    total:
      headquartersDamage * weights.enemyHqDamage +
      ownHqHp * weights.ownHqHp +
      controlPoints * weights.controlPoint +
      armyValue * weights.armyValue +
      supplies * weights.supplies + actionScore,
  };
}

function computeAdjudicationScores() {
  const scores = Object.fromEntries(joinedPlayerIds().map(id => [id, playerScore(id)]).filter(([, score]) => score));
  return Object.keys(scores).length ? scores : null;
}

/** Prefer server `adjudication` / final `result`, else recompute from local event state. */
function liveAdjudicationScores() {
  const serverScores = state?.adjudication?.scores;
  if (serverScores && Object.keys(serverScores).length > 0) return serverScores;
  if (state?.result?.scores && Object.keys(state.result.scores).length > 0) return state.result.scores;
  return computeAdjudicationScores();
}

function liveAdjudicationRankings() {
  const rows = state?.adjudication?.rankings || state?.result?.rankings || [];
  return Array.isArray(rows) ? rows : [];
}

function scoreBreakdown(score) {
  if (gameConfig?.mode === 'annihilation') return `存活兵力 ${score.armyValue} · 行动分 ${score.actionScore ?? 0}`;
  return `HQ伤害 ${score.headquartersDamage ?? score.enemyHqDamage} · HQ血量 ${score.ownHqHp} · 据点 ${score.controlPoints} · 兵力 ${score.armyValue} · 补给 ${score.supplies} · 行动分 ${score.actionScore ?? 0}`;
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
  const scores = liveAdjudicationScores();
  if (!scores) {
    scorePanelEl.innerHTML = '<h3>分数排行榜</h3><div class="score-empty">等待对局开始</div>';
    return;
  }
  const resultRanks = new Map(liveAdjudicationRankings().map(row => [row.playerId, row.rank]));
  const rows = Object.entries(scores).sort(([ownerA, scoreA], [ownerB, scoreB]) => {
    const rankA = resultRanks.get(ownerA);
    const rankB = resultRanks.get(ownerB);
    if (typeof rankA === 'number' && typeof rankB === 'number') return rankA - rankB;
    if (typeof rankA === 'number') return -1;
    if (typeof rankB === 'number') return 1;
    return (scoreB.total ?? 0) - (scoreA.total ?? 0);
  });
  scorePanelEl.innerHTML = `<h3>分数排行榜</h3>
    ${rows.map(([owner, score], index) => renderScoreRow(owner, score, resultRanks.get(owner) ?? scoreRank(rows, index))).join('')}`;
}

function renderResourceListHtml(owner) {
  const resourceRows = joinedPlayerIds().map(id => {
    const color = OWNER_COLOR[id] || '#9aa7b2';
    const supplies = state.resources?.[id]?.supplies ?? 0;
    return `<div class="resource-pill ${playerClass(id)} ${myPlayer === id ? 'mine' : ''}" style="border-left-color:${esc(color)}">
      <span>${esc(playerName(id))}${myPlayer === id ? '（你）' : ''}</span><strong>${supplies}</strong>
    </div>`;
  }).join('');
  if (isSimultaneous()) {
    return `<div class="status-grid drawer-resource-grid">
      <div class="status-card active-turn ${iCommitted() ? '' : 'mine'}">
        <span>${iCommitted() ? '已确认 · 等待结算' : '计划阶段 · 全员同时下令'}</span>
        <strong>${committedList().length}/${joinedPlayerIds().filter(id => state.players[id]?.status === 'active').length} 已确认</strong>
      </div>
      ${resourceRows}
    </div>`;
  }
  return `<div class="status-grid drawer-resource-grid">
    <div class="status-card active-turn ${owner === myPlayer ? 'mine' : ''}">
      <span>${owner === myPlayer ? '你的回合' : '当前行动'}</span>
      <strong>${esc(playerName(owner) || '—')}</strong>
    </div>
    ${resourceRows}
  </div>`;
}

function renderSidebar() {
  if (!state) return;
  const simultaneous = isSimultaneous();
  const replaying = playback.isActive();
  const owner = simultaneous ? null : (state.turn.currentPlayerId || state.turn.currentOwner);
  const mine = simultaneous ? (!iCommitted() && !state.winner && !replaying) : owner === myPlayer;
  const commitStatus = committedStatusHtml();
  els.turnBadge.innerHTML = `
    <span class="turn-kicker">${simultaneous ? (replaying ? '结算回放中…' : (iCommitted() ? '已确认 · 等待全员' : '同时计划阶段')) : (mine ? '你的回合' : '等待中')}</span>
    <strong class="turn-count">${esc(turnProgressLabel())}</strong>
    <span class="turn-player">${simultaneous ? `${committedList().length}/${joinedPlayerIds().filter(id => state.players[id]?.status === 'active').length} 已确认` : esc(playerName(owner) || '—')}</span>${commitStatus}`;
  els.turnBadge.classList.toggle('my-turn', mine);

  // Compact top strip: only my supplies (full multiplayer list lives in drawer)
  const mySupplies = myPlayer != null ? (state.resources?.[myPlayer]?.supplies ?? 0) : null;
  if (mySupplies == null) {
    els.resDisplay.innerHTML = '';
  } else {
    els.resDisplay.innerHTML = `<div class="hud-chip hud-supply mine">
      <span class="hud-label">补给</span>
      <strong class="hud-value">${mySupplies}</strong>
      <span class="hud-sub">我的</span>
    </div>`;
  }

  const drawerResources = document.getElementById('drawer-resources');
  if (drawerResources) drawerResources.innerHTML = renderResourceListHtml(owner);

  renderActionsDisplay(owner);
  renderScorePanel();
  renderPlanPanel();
  els.btnEndTurn.textContent = simultaneous ? (iCommitted() ? '等待结算…' : '确认行动') : '结束回合';
  const endTurnBar = document.getElementById('btn-end-turn-bar');
  if (endTurnBar) endTurnBar.textContent = els.btnEndTurn.textContent;
  els.events.innerHTML = '';
  for (const ev of state.eventLog.slice(-60)) {
    const li = document.createElement('li'); li.className = `type-${ev.type}`;
    li.innerHTML = `<span class="ev-seq">#${ev.seq}</span><span class="ev-type">${esc(ev.type)}</span>${esc(formatEventShort(ev))}`;
    els.events.appendChild(li);
  }
  els.events.scrollTop = els.events.scrollHeight;
  renderSelectionInfo();
  syncMobileChrome();
}
function syncMobileChrome() {
  const drawerScore = document.getElementById('drawer-score');
  if (drawerScore && els.scorePanel) drawerScore.innerHTML = els.scorePanel.innerHTML;
  const drawerEvents = document.getElementById('drawer-events');
  if (drawerEvents && els.events) drawerEvents.innerHTML = els.events.innerHTML;
  const drawerSel = document.getElementById('drawer-selection');
  if (drawerSel) {
    let ent = null;
    if (selectedUnitId) ent = state?.units?.get(selectedUnitId);
    if (!ent && selectedOriginId) ent = state?.headquarters?.get(selectedOriginId) || state?.controlPoints?.get(selectedOriginId);
    if (ent && 'hp' in ent) drawerSel.innerHTML = renderEntityCard(ent);
    else if (ent) drawerSel.innerHTML = renderControlPointCard(ent);
    else drawerSel.innerHTML = '<div class="sel-note">未选中单位或据点</div>';
  }
  const drawerHints = document.getElementById('drawer-hints');
  const hints = document.querySelector('#action-hints .hint-list');
  if (drawerHints && hints) drawerHints.innerHTML = hints.innerHTML;
}

function formatEventShort(ev) {
  const p = ev.payload || {};
  switch (ev.type) {
    case 'game_start': return '对局开始';
    case 'deploy': return `${playerName(p.owner)} 部署 ${UNIT_NAMES[p.unitType] || p.unitType}`;
    case 'move': return `移动到 (${p.toQ}, ${p.toR})`;
    case 'attack': return p.hit === false ? `开火落空 (${p.q}, ${p.r})` : `攻击造成 ${p.damage} 伤害`;
    case 'heal': return `治疗 +${p.amount}`;
    case 'unit_death': return `${UNIT_NAMES[p.unitType] || '单位'} 阵亡`;
    case 'headquarters_destroyed': return `${playerName(p.owner)} 指挥部被摧毁`;
    case 'control_point_captured': return `${playerName(p.owner)} 占领 ${p.name}`;
    case 'control_point_repair': return `${p.pointName || '维修站'} 修复单位 +${p.amount}`;
    case 'income': return `${playerName(p.owner)} 收入 +${p.amount}`;
    case 'comeback_supply': return `${playerName(p.owner)} 追赶补给 +${p.amount}（落后${p.scoreGapPercent}%）`;
    case 'artillery_warning': return `炮火预警：第 ${p.nextShrinkRound} 轮收缩`;
    case 'artillery_shrunk': return `炮火收缩：安全半径 ${p.safeRadius}`;
    case 'artillery_damage': return `${playerName(p.owner)} 单位遭炮击 -${p.damage}`;
    case 'reset_actions': return `${playerName(p.owner)} 单位已重置`;
    case 'turn_end': return `轮到 ${playerName(p.nextOwner)}`;
    case 'game_over':
      if (p.reason === 'mutual_annihilation') return '双方同归于尽';
      if (p.reason === 'forced_adjudication_draw') return '强制裁决平局';
      if (p.reason === 'forced_adjudication_score') return `${playerName(p.winner)} 强制裁决获胜`;
      if (p.reason === 'turn_limit_draw') return `${maxTurnsLabel()}裁决平局`;
      if (p.reason === 'turn_limit_score') return `${playerName(p.winner)} ${maxTurnsLabel()}裁决获胜`;
      return `${playerName(p.winner)} 获胜`;
    case 'name_rename': return `${p.playerId} 改名为 ${p.name}`;
    case 'demolish': return `${playerName(p.owner)} 爆破 (${p.q}, ${p.r})`;
    case 'plan_committed': return `${playerName(p.playerId)} 已确认本回合计划`;
    case 'round_start': return `第 ${p.roundNumber} 回合计划阶段开始`;
    case 'round_resolved': return `第 ${p.roundNumber} 回合同时结算完毕`;
    case 'action_failed': {
      const typeLabel = { deploy: '部署', move: '移动', attack: '攻击', heal: '治疗', demolish: '爆破' }[p.type] || '动作';
      const reasonLabel = { destination_conflict: '目标格撞车，全部失败', insufficient_supplies: '补给不足', unit_gone: '单位已不存在', out_of_range: '超出射程，落空', already_healthy: '目标无需治疗', invalid_target: '目标无效', target_gone: '目标已消失' }[p.reason] || p.reason || '失败';
      return `${playerName(p.owner)} ${typeLabel}未执行：${reasonLabel}`;
    }
    default: return JSON.stringify(p).slice(0, 100);
  }
}

function renderSelectionInfo(ent) {
  if (!ent && selectedUnitId) ent = state.units.get(selectedUnitId);
  if (!ent && selectedOriginId) ent = state.headquarters.get(selectedOriginId) || state.controlPoints.get(selectedOriginId);
  if (!ent) {
    els.selDetail.innerHTML = '<span class="sel-summary-text">点击棋盘上的单位、总部或据点查看详情</span>';
    return;
  }
  els.selDetail.innerHTML = renderSelectionSummary(ent);
}

function renderSelectionSummary(ent) {
  if ('hp' in ent) {
    const type = ent.type || 'headquarters';
    const title = UNIT_NAMES[type] || '指挥部';
    return `<span class="sel-summary-line">
      <strong>${esc(title)}</strong>
      <span class="sel-summary-meta">${esc(playerName(ent.owner))} · HP ${Math.max(0, ent.hp)}/${ent.maxHp} · (${ent.q},${ent.r})</span>
      <span class="sel-summary-hint">详情 ▾</span>
    </span>`;
  }
  const owner = ent.owner ? playerName(ent.owner) : '中立';
  return `<span class="sel-summary-line">
    <strong>${esc(ent.name || '据点')}</strong>
    <span class="sel-summary-meta">${esc(owner)} · (${ent.q},${ent.r})</span>
    <span class="sel-summary-hint">详情 ▾</span>
  </span>`;
}

function showPopup(cell, title, items, cb) {
  const dock = $('action-dock');
  const popup = $('map-popup');
  if (dock) {
    // mobile: bottom action strip — never covers the board
    dock.innerHTML = `<div class="action-dock-title">${esc(title)}</div>` +
      items.map(i => `<button type="button" class="action-dock-btn" data-action="${esc(i.action)}" data-type="${esc(i.type || '')}">
        <span>${esc(i.label)}</span>${i.cost != null ? `<span class="map-popup-cost">${i.cost}</span>` : ''}
      </button>`).join('') +
      `<button type="button" class="action-dock-btn action-dock-cancel" data-action="__cancel">取消</button>`;
    dock.classList.remove('hidden');
    if (popup) popup.classList.add('hidden');
    dock.querySelectorAll('button').forEach(btn => {
      let fired = false;
      const run = (ev) => {
        if (fired) return;
        fired = true;
        ev.preventDefault();
        ev.stopPropagation();
        if (btn.dataset.action === '__cancel') { deselect(); return; }
        cb(btn.dataset.action, btn.dataset.type);
      };
      btn.addEventListener('pointerup', run);
      btn.addEventListener('click', run);
    });
    return;
  }
  const p = canvasToCssPoint(hexToPixel(cell.q, cell.r));
  popup.style.left = `${p.x + 18}px`; popup.style.top = `${p.y - 10}px`;
  popup.innerHTML = `<div class="map-popup-title">${esc(title)}</div>` + items.map(i => `<button class="map-popup-btn" data-action="${esc(i.action)}" data-type="${esc(i.type || '')}"><span>${esc(i.label)}</span>${i.cost != null ? `<span class="map-popup-cost">${i.cost}</span>` : ''}</button>`).join('');
  popup.classList.remove('hidden');
  popup.querySelectorAll('button').forEach(btn => {
    let fired = false;
    const run = (ev) => {
      if (fired) return;
      fired = true;
      ev.preventDefault();
      ev.stopPropagation();
      cb(btn.dataset.action, btn.dataset.type);
    };
    btn.addEventListener('pointerup', run);
    btn.addEventListener('click', run);
  });
  requestAnimationFrame(() => clampPopupInViewport(popup));
}
function closePopup() {
  const popup = $('map-popup');
  if (popup) popup.classList.add('hidden');
  const dock = $('action-dock');
  if (dock) {
    dock.classList.add('hidden');
    dock.innerHTML = '';
  }
}
function deselect() { selectedUnitId = null; selectedOriginId = null; selectedDeployType = null; interactionMode = 'idle'; rangeHighlights = []; closePopup(); renderSidebar(); drawBoard(); }

async function apiAction(path, body) {
  const { ok, data } = await API.post(path, body);
  if (!ok) toast(`${data.error || '操作失败'} (${data.code || ''})`, 'err');
  return ok;
}
async function afterAction(msg) {
  toast(msg, 'ok');
  await refreshAdjudication();
  deselect();
}

function selectUnit(unit) {
  selectedUnitId = unit.id; selectedOriginId = null; selectedDeployType = null; interactionMode = 'unit_selected'; rangeHighlights = [];
  renderSidebar(); drawBoard();
  if (unit.owner !== myPlayer || !canActNow()) return;
  // 同时模式：已有排队动作的单位本回合不能再下令（每单位一个动作）。
  const plannedAlready = isSimultaneous() && unitHasPlannedAction(unit.id);
  const items = [];
  if (!unit.hasMoved && !plannedAlready) items.push({ label: '移动', action: 'move' });
  if (!unit.hasActed && !plannedAlready) items.push({ label: unit.type === 'support' ? '治疗' : '攻击', action: unit.type === 'support' ? 'heal' : 'attack' });
  if (unit.type === 'heavy' && !unit.hasActed && !plannedAlready && demolishableCells(unit).length > 0) items.push({ label: '爆破', action: 'demolish' });
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
    if (action === 'heal') {
      interactionMode = 'heal_mode';
      if (isSimultaneous()) {
        // 区域治疗：所有"覆盖格内含友军"的瞄准格都可点击。
        rangeHighlights = aimableCells(unit, 'healShape').filter(pos => {
          const aim = shapeAimFor(unit, 'healShape', pos.q, pos.r);
          return aim.cells.some(c => [...state.units.values()].some(e => e.alive && e.owner === myPlayer && e.q === c.q && e.r === c.r));
        }).map(p => ({ ...p, type: 'heal' }));
      } else {
        rangeHighlights = [...state.units.values()].filter(e => e.owner === myPlayer && e.alive && e.hp < e.maxHp && hexDistance(unit, e) <= unitHealRange(unit)).map(e => ({ q: e.q, r: e.r, type: 'heal' }));
      }
    }
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
  if (!canActNow()) return;
  const items = Object.entries(gameConfig.units).map(([type]) => ({ label: UNIT_NAMES[type], action: 'deploy', type, cost: effectiveDeployCost(type, origin) }));
  showPopup(origin, '部署单位', items, (_action, type) => {
    closePopup(); interactionMode = 'deploy_mode'; selectedOriginId = origin.id; selectedDeployType = type;
    rangeHighlights = deployCells(origin).map(p => ({ ...p, type: 'deploy', unitType: type }));
    drawBoard();
  });
}

async function handleBoardTap(cell) {
  if (!cell || !state) return;
  if (playback.isActive()) return; // 回放期间棋盘点击不响应（用「跳过结算」快进）。
  hoverCell = cell;
  const unit = [...state.units.values()].find(u => u.alive && u.q === cell.q && u.r === cell.r);
  const hq = [...state.headquarters.values()].find(h => h.alive && h.q === cell.q && h.r === cell.r);
  const cp = [...state.controlPoints.values()].find(p => p.q === cell.q && p.r === cell.r);

  if (interactionMode === 'move_mode' && rangeHighlights.some(h => h.q === cell.q && h.r === cell.r)) {
    if (await apiAction(`/api/games/${gameId}/move`, { unitId: selectedUnitId, q: cell.q, r: cell.r })) afterAction(isSimultaneous() ? '移动指令已入队' : '移动成功');
    return;
  }
  if (interactionMode === 'attack_mode') {
    const hit = rangeHighlights.find(h => h.q === cell.q && h.r === cell.r);
    const enemyClick = hit?.type === 'attack';
    // 同时模式下射程内任意格都可开火（预测性射击）；顺序模式仍只能点敌方实体格。
    if (enemyClick || (isSimultaneous() && hit?.type === 'attack-radius')) {
      if (isSimultaneous()) {
        if (await apiAction(`/api/games/${gameId}/attack`, { attackerId: selectedUnitId, q: cell.q, r: cell.r })) afterAction('开火指令已入队');
      } else {
        const target = entityAt(cell.q, cell.r);
        if (target && target.owner !== myPlayer && target.alive && await apiAction(`/api/games/${gameId}/attack`, { attackerId: selectedUnitId, targetId: target.id })) afterAction('攻击成功');
      }
      return;
    }
  }
  if (interactionMode === 'heal_mode' && rangeHighlights.some(h => h.q === cell.q && h.r === cell.r)) {
    if (isSimultaneous()) {
      if (await apiAction(`/api/games/${gameId}/heal`, { supportId: selectedUnitId, q: cell.q, r: cell.r })) afterAction('治疗指令已入队');
    } else if (unit && await apiAction(`/api/games/${gameId}/heal`, { supportId: selectedUnitId, targetId: unit.id })) {
      afterAction('治疗成功');
    }
    return;
  }
  if (interactionMode === 'demolish_mode' && rangeHighlights.some(h => h.q === cell.q && h.r === cell.r)) {
    if (await apiAction(`/api/games/${gameId}/demolish`, { unitId: selectedUnitId, q: cell.q, r: cell.r })) afterAction(isSimultaneous() ? '爆破指令已入队' : '爆破成功');
    return;
  }
  if (interactionMode === 'deploy_mode' && rangeHighlights.some(h => h.q === cell.q && h.r === cell.r)) {
    if (await apiAction(`/api/games/${gameId}/deploy`, { unitType: selectedDeployType, fromId: selectedOriginId, q: cell.q, r: cell.r })) afterAction(isSimultaneous() ? '部署指令已入队' : '部署成功');
    return;
  }

  closePopup(); rangeHighlights = [];
  if (unit) selectUnit(unit);
  else if (hq && hq.owner === myPlayer) selectDeployOrigin(hq);
  else if (cp && cp.owner === myPlayer) selectDeployOrigin(cp);
  else { selectedUnitId = null; selectedOriginId = null; renderSelectionInfo(hq || cp); drawBoard(); }
}

function updateHoverFromPoint(p) {
  if (!state || state.cells.length === 0) return;
  const h = pixelToHex(p.x, p.y);
  hoverCell = cellAt(h.q, h.r) ? h : null;
  if (!hoverCell) els.cellInfo.textContent = '';
  else {
    const ent = entityAt(h.q, h.r);
    const cp = [...state.controlPoints.values()].find(c => c.q === h.q && c.r === h.r);
    els.cellInfo.textContent = `(${h.q}, ${h.r})${cp ? ` | ${cp.name}` : ''}${ent ? ` | ${UNIT_NAMES[ent.type] || 'HQ'} ${ent.hp}/${ent.maxHp}` : ''}`;
  }
  drawBoard();
}

const gesture = {
  pointers: new Map(),
  mode: 'none',
  startX: 0, startY: 0,
  originPanX: 0, originPanY: 0,
  originScale: 1,
  pinchDist: 0,
  moved: false,
  downEvent: null,
};
function pointerList() { return [...gesture.pointers.values()]; }
function dist(a, b) {
  const dx = a.clientX - b.clientX, dy = a.clientY - b.clientY;
  return Math.hypot(dx, dy) || 1;
}
function midpoint(a, b) {
  return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
}
function onPointerDown(e) {
  if (!boardViewport) return;
  // popup / zoom UI must receive real clicks; preventDefault would suppress them
  if (e.target.closest?.('.zoom-controls, .map-popup, .action-dock, button, a, input, select, label')) return;
  boardViewport.setPointerCapture?.(e.pointerId);
  gesture.pointers.set(e.pointerId, e);
  gesture.moved = false;
  if (gesture.pointers.size === 1) {
    gesture.mode = 'pan';
    gesture.startX = e.clientX;
    gesture.startY = e.clientY;
    gesture.originPanX = boardPanX;
    gesture.originPanY = boardPanY;
    gesture.downEvent = e;
  } else if (gesture.pointers.size >= 2) {
    const [a, b] = pointerList();
    gesture.mode = 'pinch';
    gesture.pinchDist = dist(a, b);
    gesture.originScale = boardScale;
    gesture.originPanX = boardPanX;
    gesture.originPanY = boardPanY;
    const mid = midpoint(a, b);
    gesture.startX = mid.x;
    gesture.startY = mid.y;
    gesture.downEvent = null;
  }
  e.preventDefault();
}
function onPointerMove(e) {
  if (!gesture.pointers.has(e.pointerId)) return;
  gesture.pointers.set(e.pointerId, e);
  if (gesture.mode === 'pan' && gesture.pointers.size === 1) {
    const dx = e.clientX - gesture.startX;
    const dy = e.clientY - gesture.startY;
    if (Math.hypot(dx, dy) > TAP_MOVE_THRESHOLD) gesture.moved = true;
    if (gesture.moved) {
      boardPanX = gesture.originPanX + dx;
      boardPanY = gesture.originPanY + dy;
      setBoardTransform();
    } else {
      updateHoverFromPoint(eventToCanvasPoint(e));
    }
  } else if (gesture.mode === 'pinch' && gesture.pointers.size >= 2) {
    gesture.moved = true;
    const [a, b] = pointerList();
    const d = dist(a, b);
    const mid = midpoint(a, b);
    const nextScale = clampBoardScale(gesture.originScale * (d / gesture.pinchDist));
    const rect = boardViewport.getBoundingClientRect();
    const vx = mid.x - rect.left;
    const vy = mid.y - rect.top;
    const worldX = (vx - gesture.originPanX) / gesture.originScale;
    const worldY = (vy - gesture.originPanY) / gesture.originScale;
    boardScale = nextScale;
    boardPanX = vx - worldX * boardScale;
    boardPanY = vy - worldY * boardScale;
    setBoardTransform();
  }
  e.preventDefault();
}
async function onPointerUp(e) {
  if (!gesture.pointers.has(e.pointerId)) return;
  const wasTap = gesture.mode === 'pan' && !gesture.moved && gesture.pointers.size === 1;
  gesture.pointers.delete(e.pointerId);
  if (wasTap && state) {
    const src = gesture.downEvent || e;
    const pt = eventToCanvasPoint(src);
    const h = pixelToHex(pt.x, pt.y);
    const cell = cellAt(h.q, h.r) ? h : null;
    gesture.downEvent = null;
    await handleBoardTap(cell);
  } else {
    gesture.downEvent = null;
  }
  if (gesture.pointers.size === 0) gesture.mode = 'none';
  else if (gesture.pointers.size === 1) {
    const only = pointerList()[0];
    gesture.mode = 'pan';
    gesture.startX = only.clientX;
    gesture.startY = only.clientY;
    gesture.originPanX = boardPanX;
    gesture.originPanY = boardPanY;
    gesture.moved = true;
  }
}
function onPointerCancel(e) {
  gesture.pointers.delete(e.pointerId);
  if (gesture.pointers.size === 0) gesture.mode = 'none';
}

const gestureTarget = boardViewport || els.canvas;
gestureTarget.addEventListener('pointerdown', onPointerDown, { passive: false });
gestureTarget.addEventListener('pointermove', onPointerMove, { passive: false });
gestureTarget.addEventListener('pointerup', onPointerUp);
gestureTarget.addEventListener('pointercancel', onPointerCancel);
gestureTarget.addEventListener('contextmenu', e => { e.preventDefault(); deselect(); });
gestureTarget.addEventListener('wheel', e => {
  e.preventDefault();
  if (!boardViewport) return;
  const rect = boardViewport.getBoundingClientRect();
  const vx = e.clientX - rect.left;
  const vy = e.clientY - rect.top;
  const worldX = (vx - boardPanX) / boardScale;
  const worldY = (vy - boardPanY) / boardScale;
  const next = clampBoardScale(boardScale * (e.deltaY < 0 ? 1.1 : 0.9));
  boardScale = next;
  boardPanX = vx - worldX * boardScale;
  boardPanY = vy - worldY * boardScale;
  setBoardTransform();
}, { passive: false });

function subscribeSse() {
  if (sse) sse.close();
  const lastSeq = state?.eventLog.at(-1)?.seq ?? 0;
  sse = new EventSource(`/api/games/${gameId}/events?after=${lastSeq}`);
  sse.onmessage = e => {
    playback.enqueue(JSON.parse(e.data));
  };
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

function lobbySummaryMarkup(lobby, canKick = false) {
  const players = lobby.players || [];
  const supported = (lobby.supportedPlayerCounts || []).join('/');
  const canAddBot = canKick && lobby.phase === 'lobby' && players.length < lobby.maxPlayers;
  return `<div class="lobby-summary-head">
    <span>${esc(lobby.phase === 'active' ? '已开始' : '等待开局')}</span>
    <strong>${players.length}/${lobby.maxPlayers}</strong>
  </div>
  <div class="lobby-summary-meta">地图 ${esc(lobby.mapId)} · 支持 ${esc(supported)} 人</div>
  <div class="lobby-player-list">${players.map(player => `<span class="lobby-player" style="border-color:${esc(OWNER_COLOR[player.id] || '#7f98a9')}"><span>${esc(player.name || player.id)}</span>${canKick && lobby.phase === 'lobby' && player.id !== myPlayer ? `<button type="button" class="lobby-kick" data-kick-player="${esc(player.id)}">踢出</button>` : ''}</span>`).join('')}${canAddBot ? `<button type="button" class="lobby-player lobby-add-bot" data-add-bot="1" title="添加强化学习 AI"><span class="ui-icon icon-plus" aria-hidden="true"></span><span>添加 AI</span></button>` : ''}</div>`;
}

function renderLobbySummary(lobby, target = els.lobbySummary, canKick = target === els.lobbySummary && Boolean(hostToken)) {
  if (!target || !lobby) return;
  target.innerHTML = lobbySummaryMarkup(lobby, canKick);
}

function renderAvailableGames(games) {
  if (!els.availableGames) return;
  const joinableGames = games
    .filter(game => game.phase === 'lobby' && game.playerCount < game.maxPlayers)
    .reverse();
  if (!joinableGames.length) {
    els.availableGames.innerHTML = '<p class="available-games-state">暂无等待加入的对局</p>';
    return;
  }
  const selectedId = els.gameId.value.trim();
  els.availableGames.innerHTML = joinableGames.map(game => {
    const id = String(game.gameId || '');
    const selected = id === selectedId;
    return `<button type="button" class="available-game${selected ? ' selected' : ''}" data-available-game-id="${esc(id)}" aria-pressed="${selected}" title="${esc(id)}">
      <span class="available-game-id">${esc(id)}</span>
      <span class="available-game-seats">${esc(game.playerCount)}/${esc(game.maxPlayers)} 人</span>
      <span class="available-game-map">地图 ${esc(game.mapId || 'default')}</span>
      <span class="available-game-action">选择</span>
    </button>`;
  }).join('');
}

async function refreshAvailableGames() {
  if (!els.availableGames || availableGamesLoading) return;
  availableGamesLoading = true;
  els.btnRefreshGames?.classList.add('refreshing');
  if (els.btnRefreshGames) els.btnRefreshGames.disabled = true;
  try {
    const res = await fetch('/api/games');
    if (!res.ok) throw new Error('request failed');
    const data = await res.json();
    renderAvailableGames(Array.isArray(data.games) ? data.games : []);
  } catch {
    if (!els.availableGames.querySelector('.available-game')) {
      els.availableGames.innerHTML = '<p class="available-games-state">暂时无法获取对局</p>';
    }
  } finally {
    availableGamesLoading = false;
    els.btnRefreshGames?.classList.remove('refreshing');
    if (els.btnRefreshGames) els.btnRefreshGames.disabled = false;
  }
}

function startAvailableGamesRefresh() {
  refreshAvailableGames();
  if (availableGamesTimer) clearInterval(availableGamesTimer);
  availableGamesTimer = setInterval(() => {
    if (!document.hidden && !els.joinPanel.classList.contains('hidden')) refreshAvailableGames();
  }, 5000);
}

function stopAvailableGamesRefresh() {
  if (availableGamesTimer) clearInterval(availableGamesTimer);
  availableGamesTimer = null;
}

async function refreshLobbySummary() {
  if (!gameId) return null;
  const res = await fetch(`/api/games/${gameId}/lobby`);
  const data = await res.json();
  if (res.ok) {
    renderLobbySummary(data, els.lobbySummary, Boolean(hostToken));
    renderLobbySummary(data, els.joinLobbySummary);
  }
  return res.ok ? data : null;
}

function handleLobbyRemoval(lobby) {
  if (!myPlayer || !lobby || lobby.phase !== 'lobby') return false;
  if ((lobby.players || []).some(player => player.id === myPlayer)) return false;
  stopLobbyPolling();
  if (sse) { sse.close(); sse = null; }
  myToken = null;
  myPlayer = null;
  persistSession();
  if (els.joinStatusText) els.joinStatusText.textContent = '你已被房主移出大厅';
  if (els.joinPlayerToken) els.joinPlayerToken.textContent = '';
  els.joinPlayerTokenRow?.classList.add('hidden');
  els.joinResult?.classList.remove('hidden');
  statusBadge('已移出', 'err');
  toast('你已被房主移出大厅', 'err');
  return true;
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
      if (handleLobbyRemoval(lobby)) return;
      if (lobby?.phase !== 'active') return;
      stopLobbyPolling();
      if (els.joinStatusText) els.joinStatusText.textContent = '房主已开始，正在进入游戏…';
      await enterGame();
    } catch {
      statusBadge('大厅中', 'idle');
    }
  }, 1500);
}

async function kickLobbyPlayer(playerId) {
  if (!gameId || !hostToken || !playerId) return;
  if (!window.confirm('确定要将该玩家移出大厅吗？')) return;
  const res = await fetch(`/api/games/${encodeURIComponent(gameId)}/players/${encodeURIComponent(playerId)}`, {
    method: 'DELETE',
    headers: { 'X-Host-Token': hostToken },
  });
  const data = await res.json();
  if (!res.ok) return toast(data.error || '踢出失败', 'err');
  renderLobbySummary(data.lobby, els.lobbySummary, true);
  toast('玩家已移出大厅', 'ok');
}

// —— 强化学习 AI：房主在大厅中一键添加 ——
let botModelsLoaded = false;

async function ensureBotModels() {
  if (botModelsLoaded) return;
  try {
    const res = await fetch('/api/rl/models');
    if (!res.ok) throw new Error('request failed');
    const data = await res.json();
    const models = (Array.isArray(data.models) ? data.models : [])
      .filter(model => model.supported === true);
    // 只展示已有版本快照运行器的模型；旧版本仍会按标签显示。
    els.botModel.innerHTML = models.length
      ? models.map(model => {
          const label = model.label ? `（${model.label}）` : '';
          return `<option value="${esc(model.file)}">${esc(model.file)}${label}</option>`;
        }).join('')
      : '<option value="">（服务器未找到可用模型）</option>';
    botModelsLoaded = models.length > 0;
  } catch {
    els.botModel.innerHTML = '<option value="">（无法获取模型列表）</option>';
  }
}

function openBotDialog() {
  if (!gameId || !hostToken) return;
  closeBotDialog();
  els.botName.value = '';
  els.botDialog.classList.remove('hidden');
  els.botDialogBackdrop.classList.remove('hidden');
  ensureBotModels();
  els.botName.focus();
}

function closeBotDialog() {
  if (!els.botDialog.classList.contains('hidden')) {
    els.botDialog.classList.add('hidden');
    els.botDialogBackdrop.classList.add('hidden');
  }
}

async function confirmAddBot() {
  if (!gameId || !hostToken) return;
  const model = els.botModel.value;
  if (!model) return toast('没有可用模型', 'err');
  els.btnBotConfirm.disabled = true;
  try {
    const res = await fetch(`/api/games/${encodeURIComponent(gameId)}/bots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Host-Token': hostToken },
      body: JSON.stringify({ name: els.botName.value.trim() || undefined, model }),
    });
    const data = await res.json();
    if (!res.ok) return toast(data.error || '添加 AI 失败', 'err');
    closeBotDialog();
    renderLobbySummary(data.lobby, els.lobbySummary, true);
    toast('AI 已加入，等待开局', 'ok');
  } catch {
    toast('添加 AI 失败：无法连接服务器', 'err');
  } finally {
    els.btnBotConfirm.disabled = false;
  }
}

els.btnBotConfirm.addEventListener('click', confirmAddBot);
els.btnBotCancel.addEventListener('click', closeBotDialog);
els.botDialogBackdrop.addEventListener('click', closeBotDialog);

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
    window.location.href = `/spectator-m.html?gameId=${encodeURIComponent(gameId)}`;
    return;
  }
  await enterGame();
}

els.btnEndTurn.addEventListener('click', async () => { if (playback.isActive()) return; if (await apiAction(`/api/games/${gameId}/end-turn`, {})) afterAction(isSimultaneous() ? '本回合计划已确认，等待全员提交' : '回合结束'); });
els.btnSkipReplay?.addEventListener('click', () => playback.skip());
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
        ...(els.mapSelect.value === 'random' ? { random: window.RandomMapUI.collectRandomOptions() } : {}),
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
    renderLobbySummary(data.lobby, els.lobbySummary, true);
    els.createResult.classList.remove('hidden');
    statusBadge('大厅中', 'idle');
    startLobbyPolling();
    refreshAvailableGames();
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
  if (!res.ok) { els.joinStatusText.textContent = `加入失败: ${data.error}`; els.joinResult.classList.remove('hidden'); refreshAvailableGames(); return; }
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
  refreshAvailableGames();
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
    const lobby = await refreshLobbySummary();
    if (handleLobbyRemoval(lobby)) return;
    return toast('对局尚未开始', 'info');
  }
  if (!myToken) {
    window.location.href = `/spectator-m.html?gameId=${encodeURIComponent(gameId)}`;
    return;
  }
  stopLobbyPolling();
  stopAvailableGamesRefresh();
  if (sse) { sse.close(); sse = null; }
  els.joinPanel.classList.add('hidden'); els.gameUI.classList.remove('hidden');
  const bar = document.getElementById('bottom-bar');
  if (bar) bar.classList.remove('hidden');
  subscribeSse(); drawBoard(); renderSidebar(); statusBadge('已连接', 'ok');
  requestAnimationFrame(fitBoardToViewport);
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
  if (tab.dataset.tab === 'join') refreshAvailableGames();
}));
els.btnRefreshGames?.addEventListener('click', refreshAvailableGames);
document.addEventListener('click', e => {
  const availableGame = e.target.closest?.('[data-available-game-id]');
  if (availableGame) {
    els.gameId.value = availableGame.dataset.availableGameId;
    els.availableGames.querySelectorAll('.available-game').forEach(button => {
      const selected = button === availableGame;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    return;
  }
  const addBot = e.target.closest?.('[data-add-bot]');
  if (addBot) {
    e.preventDefault();
    openBotDialog();
    return;
  }
  const button = e.target.closest?.('[data-kick-player]');
  if (!button) return;
  e.preventDefault();
  kickLobbyPlayer(button.dataset.kickPlayer);
});
async function copyText(text) {
  const value = String(text ?? '').trim();
  if (!value) throw new Error('empty');

  // Clipboard API needs secure context (https/localhost). Phones often open via LAN IP over http.
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }

  // Fallback: temporary textarea + execCommand (works on many mobile browsers over http)
  const ta = document.createElement('textarea');
  ta.value = value;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '0';
  ta.style.left = '0';
  ta.style.width = '1px';
  ta.style.height = '1px';
  ta.style.padding = '0';
  ta.style.border = '0';
  ta.style.outline = '0';
  ta.style.boxShadow = 'none';
  ta.style.background = 'transparent';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, ta.value.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } finally {
    document.body.removeChild(ta);
  }
  if (!ok) throw new Error('copy failed');
}

document.querySelectorAll('.btn-copy').forEach(btn => btn.addEventListener('click', async () => {
  const el = $(btn.dataset.copy);
  const text = el?.textContent ?? '';
  try {
    await copyText(text);
    btn.classList.add('copied');
    clearTimeout(btn._copiedTimer);
    btn._copiedTimer = setTimeout(() => btn.classList.remove('copied'), 1500);
    toast('已复制', 'ok');
  } catch {
    toast('复制失败，请长按文本手动复制', 'err');
  }
}));
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeBotDialog(); deselect(); } });
document.addEventListener('click', e => {
  const popup = $('map-popup');
  if (!popup || popup.classList.contains('hidden')) return;
  if (popup.contains(e.target)) return;
  closePopup();
});
document.getElementById('map-popup')?.addEventListener('pointerdown', e => e.stopPropagation());
document.getElementById('map-popup')?.addEventListener('click', e => e.stopPropagation());

els.btnSettings?.addEventListener('click', () => openDrawer('settings'));
els.btnSaveControlToken?.addEventListener('click', saveControlToken);
els.btnSaveSession?.addEventListener('click', saveSessionFromSettings);
els.btnEnterSession?.addEventListener('click', enterGameFromSettings);
els.btnClearSession?.addEventListener('click', clearSessionFromSettings);
restoreSessionIntoMemory();
fillSettingsFromSession();

// mobile chrome: drawers, bottom bar, zoom buttons
const DRAWER_TITLES = { info: '信息', more: '更多', settings: '设置' };
function openDrawer(name) {
  const drawer = document.getElementById('drawer');
  const backdrop = document.getElementById('drawer-backdrop');
  if (!drawer) return;
  syncMobileChrome();
  if (name === 'settings') fillSettingsFromSession();
  drawer.querySelectorAll('.drawer-panel').forEach(p => p.classList.add('hidden'));
  const panel = document.getElementById(`drawer-panel-${name}`);
  if (panel) panel.classList.remove('hidden');
  const title = document.getElementById('drawer-title');
  if (title) title.textContent = DRAWER_TITLES[name] || name;
  drawer.classList.remove('hidden');
  backdrop?.classList.remove('hidden');
  drawer.setAttribute('aria-hidden', 'false');
  document.body.classList.add('drawer-open');
}
function closeDrawer() {
  document.getElementById('drawer')?.classList.add('hidden');
  document.getElementById('drawer-backdrop')?.classList.add('hidden');
  document.getElementById('drawer')?.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('drawer-open');
}
document.getElementById('btn-drawer-info')?.addEventListener('click', () => openDrawer('info'));
document.getElementById('btn-drawer-more')?.addEventListener('click', () => openDrawer('more'));
document.getElementById('selection-summary')?.addEventListener('click', () => openDrawer('info'));
document.getElementById('drawer-close')?.addEventListener('click', closeDrawer);
document.getElementById('drawer-backdrop')?.addEventListener('click', closeDrawer);
document.getElementById('btn-cancel')?.addEventListener('click', () => { deselect(); closeDrawer(); });
document.getElementById('btn-end-turn-bar')?.addEventListener('click', () => els.btnEndTurn?.click());
document.getElementById('btn-refresh-drawer')?.addEventListener('click', () => els.btnRefresh?.click());
document.getElementById('btn-zoom-in')?.addEventListener('click', () => {
  if (!boardViewport) return;
  const rect = boardViewport.getBoundingClientRect();
  const vx = rect.width / 2, vy = rect.height / 2;
  const worldX = (vx - boardPanX) / boardScale;
  const worldY = (vy - boardPanY) / boardScale;
  boardScale = clampBoardScale(boardScale * 1.2);
  boardPanX = vx - worldX * boardScale;
  boardPanY = vy - worldY * boardScale;
  setBoardTransform();
});
document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
  if (!boardViewport) return;
  const rect = boardViewport.getBoundingClientRect();
  const vx = rect.width / 2, vy = rect.height / 2;
  const worldX = (vx - boardPanX) / boardScale;
  const worldY = (vy - boardPanY) / boardScale;
  boardScale = clampBoardScale(boardScale / 1.2);
  boardPanX = vx - worldX * boardScale;
  boardPanY = vy - worldY * boardScale;
  setBoardTransform();
});
document.getElementById('btn-zoom-reset')?.addEventListener('click', () => fitBoardToViewport());
window.addEventListener('resize', () => {
  if (!els.gameUI?.classList.contains('hidden')) fitBoardToViewport();
});

window.RandomMapUI?.setPreviewRenderer(renderMapPreview);
loadMapList();
startAvailableGamesRefresh();
requestAnimationFrame(renderLoop);
