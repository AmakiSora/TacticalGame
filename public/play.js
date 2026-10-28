// 共享依赖经 ESM import 保证执行顺序（替代原 classic script 标签的文档顺序）。
import './version.js';
import './ui-dialog.js';
import './preview-tooltip.js';
import './board-animation.js';
import './playback.js';
import './board-inspect.js';
import './rules-sheet.js';
import './random-map-ui.js';
import './agent-prompt.js';
import './layout-editor.js';

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
  createNameStatic: $('create-name-static'), createMaxPlayersStatic: $('create-max-players-static'),
  mapSelect: $('map-select'), mapPicker: $('map-picker'), maxPlayers: $('max-players'), hostParticipate: $('host-participate'),
  randomMapOptions: $('random-map-options'),
  createForm: $('create-form'), joinForm: $('join-form'),
  btnChangeMap: $('btn-change-map'), lobbyMapThumb: $('lobby-map-thumb'), lobbyMapName: $('lobby-map-name'),
  lobbyMapId: $('lobby-map-id'), lobbyMapMeta: $('lobby-map-meta'), lobbyMapDesc: $('lobby-map-desc'),
  lobbyMapLegend: $('lobby-map-legend'),
  mapFilterText: $('map-filter-text'), mapFilterMode: $('map-filter-mode'), mapDialogCount: $('map-dialog-count'),
  mapDialog: $('map-dialog'), mapDialogBackdrop: $('map-dialog-backdrop'), btnMapDialogClose: $('btn-map-dialog-close'),
  btnMapDialogCancel: $('btn-map-dialog-cancel'), btnMapDialogApply: $('btn-map-dialog-apply'),
  mapDialogSelected: $('map-dialog-selected'), mapDialogRandomFacts: $('map-dialog-random-facts'),
  btnMapRandomRefresh: $('btn-map-random-refresh'),
  btnCreate: $('btn-create'), btnJoin: $('btn-join'), btnConnectCreate: $('btn-connect-create'), btnConnectJoin: $('btn-connect-join'), btnStartGame: $('btn-start-game'),
  btnHostParticipate: $('btn-host-participate'), btnCreateAgain: $('btn-create-again'), btnJoinAgain: $('btn-join-again'),
  btnViewReplay: $('btn-view-replay'), btnViewReplayJoin: $('btn-view-replay-join'),
  connStatus: $('conn-status'), createResult: $('create-result'), createdGameId: $('created-game-id'),
  createdHostToken: $('created-host-token'), createdToken: $('created-token'), createdTokenCopy: $('created-token-copy'),
  createdMore: $('created-more'), btnCreatedMore: $('btn-created-more'),
  createdPlayerTokenRow: $('created-player-token-row'), createRoomStatus: $('create-room-status'),
  createRoomBadge: $('create-room-badge'), createRoomTitle: $('create-room-title'), createRoomHint: $('create-room-hint'),
  lobbySummary: $('lobby-summary'), joinLobbySummary: $('join-lobby-summary'), joinResult: $('join-result'), joinStatusText: $('join-status-text'),
  joinMapSummary: $('join-map-summary'), joinMapThumb: $('join-map-thumb'), joinMapLegend: $('join-map-legend'),
  joinMapName: $('join-map-name'), joinMapId: $('join-map-id'), joinMapMeta: $('join-map-meta'), joinMapDesc: $('join-map-desc'),
  joinRoomStatus: $('join-room-status'), joinRoomBadge: $('join-room-badge'), joinRoomTitle: $('join-room-title'), joinRoomHint: $('join-room-hint'),
  joinPlayerToken: $('join-player-token'), joinPlayerTokenRow: $('join-player-token-row'),
  availableGames: $('available-games'), btnRefreshGames: $('btn-refresh-games'),
  availableGamesModeFilter: $('available-games-mode-filter'), availableGamesMapFilter: $('available-games-map-filter'),
  gameUI: $('game-ui'), canvas: $('board'), cellInfo: $('cell-info'), turnBadge: $('turn-badge'),
  resDisplay: $('resources-display'), actionsDisplay: $('actions-display'),
  btnEndTurn: $('btn-end-turn'), btnRefresh: $('btn-refresh'), planPanel: $('plan-panel'),
  btnSkipReplay: $('btn-skip-replay'), btnQuitGame: $('btn-quit-game'), btnRules: $('btn-rules'),
  selDetail: $('selection-detail'), events: $('events'), scorePanel: $('score-panel'),
  btnSettings: $('btn-settings'), settingsPopover: $('settings-popover'),
  settingsControlToken: $('settings-control-token'), btnSaveControlToken: $('btn-save-control-token'),
  settingsGameId: $('settings-game-id'), settingsPlayerToken: $('settings-player-token'), settingsHostToken: $('settings-host-token'),
  btnSaveSession: $('btn-save-session'), btnEnterSession: $('btn-enter-session'), btnClearSession: $('btn-clear-session'),
  botDialog: $('bot-dialog'), botDialogBackdrop: $('bot-dialog-backdrop'),
  botName: $('bot-name'), botModel: $('bot-model'), btnBotConfirm: $('btn-bot-confirm'), btnBotCancel: $('btn-bot-cancel'),
  botPanelBots: $('bot-panel-bots'), botPanelAlgorithm: $('bot-panel-algorithm'), botPanelPrompt: $('bot-panel-prompt'),
  algorithmType: $('algorithm-type'), algorithmName: $('algorithm-name'), btnAlgorithmConfirm: $('btn-algorithm-confirm'), btnAlgorithmCancel: $('btn-algorithm-cancel'),
  botPromptName: $('bot-prompt-name'), botPromptText: $('bot-prompt-text'), botPromptSkill: $('bot-prompt-skill'),
  btnBotPromptCopy: $('btn-bot-prompt-copy'), btnBotPromptClose: $('btn-bot-prompt-close'),
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
// 本地会话记住的昵称：刷新后创建表单 / 加入表单仍能显示同一个名字。
let sessionName = null;
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
// 房主房间卡的最新大厅摘要：只有它决定「加入战斗」是否因满员而禁用。
let hostLobbySnapshot = null;
// 当前房间的最新摘要（房主 / 加入者共用），改名弹窗用它取当前显示名。
let latestLobby = null;
// 房主座位「乐观视图」：非空时座位区按它渲染（= 有未确认意图）；与服务端对齐后清空。
// 版本基线统一放在 seatSync.baseVersion（座位乐观锁），不再单独维护草稿版本变量。
let seatDraft = null;
let seatDraftFirst = 0;
/**
 * 座位即时同步状态机（v6）：单飞 + 合并。点击只更新 desired/seq，
 * 空闲时 180ms 后 flush；飞行中只记意图，回来后再补发一次，序号保证「最后一次意图必胜」。
 */
const SEAT_SYNC_DELAY = 180;
const SEAT_SYNC_RETRY_DELAYS = [400, 900];
let seatSync = {
  desired: null,      // 最新意图快照 { order: PlayerId[], firstSeat: number } | null
  seq: 0,             // 意图序号：每次点击 +1，用来判断「回来的响应是否已过时」
  baseVersion: null,  // ifVersion 基线（= 上次成功响应的 seatVersion）
  inFlight: false,
  timer: null,
  state: 'idle',      // idle | pending | error
  stopped: false,     // 对局已开始：停止同步并隐藏控件
  lastGoodLobby: null,
  retryIntent: null,  // 失败时留下的意图快照：点状态点可重提
  failMessage: null,  // 下一次回滚时要用的提示文案（撤销路径会改写）
};
// 上次画地图时的座位视图签名：座位顺序/归属没变就不重画 SVG（R2）。
let lastSeatViewSignature = '';
// 席位切换请求进行中：避免轮询重绘期间重复点击发出第二次 join/leave。
let hostSeatBusy = false;
let availableGamesTimer = null;
let availableGamesLoading = false;
let availableGamesData = [];
let availableGamesPage = 1;
const AVAILABLE_GAMES_PAGE_SIZE = 4;
let hoverCell = null;
let selectedUnitId = null;
let selectedOriginId = null;
let selectedDeployType = null;
let interactionMode = 'idle';
let rangeHighlights = [];
let layout = { minX: 0, minY: 0, width: 840, height: 840 };
let availableMaps = [];
let pendingMapId = null;
let roomMapId = null; // 当前恢复的房间实际使用的地图，用来校正建房表单的默认选图
let mapDialogOpen = false;
let mapDialogTab = 'builtin';
let lastStaticMapId = null;
let mapFilterText = '';
let mapFilterMode = '';
let mapDialogPreviewTimer = null;
let mapDialogReturnFocus = null;

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
  if (maxTurns === null) return '∞ 无上限';
  return Number.isFinite(maxTurns) && maxTurns > 0 ? `${maxTurns}回合` : '回合上限';
}
function currentTurnNumber() {
  return state?.turn?.roundNumber || state?.turn?.turnNumber || 0;
}
function turnProgressLabel() {
  const current = currentTurnNumber();
  const maxTurns = gameConfig?.balance?.maxTurns;
  if (maxTurns === null) return `${current}/∞`;
  return Number.isFinite(maxTurns) && maxTurns > 0 ? `${current}/${maxTurns}` : String(current);
}
function statusBadge(text, cls) { els.connStatus.textContent = text; els.connStatus.className = `badge ${cls}`; }
/**
 * 轻提示。action = { label, onClick, timeout } 时在文案后挂一个可点按钮（如「撤销」）；
 * 默认 2.4s 自动消失，带 action 的按 action.timeout 停留。
 */
function toast(msg, type = 'info', action = null) {
  const t = $('toast');
  clearTimeout(t._timer);
  t.textContent = msg;
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      clearTimeout(t._timer);
      t.className = '';
      action.onClick?.();
    });
    t.append(btn);
  }
  t.className = `show ${type}`;
  t._timer = setTimeout(() => t.className = '', action?.timeout ?? 2400);
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
    // 代理/浏览器可能把 304 直接暴露给 fetch；此时没有 body，不能调用 res.json()。
    if (res.status === 304) return { ok: true, status: 304, data: null, notModified: true };
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
  // 默认仍选中第一张静态地图，保持原有创建习惯；恢复既有房间时以房间地图为准。
  const restoredMap = roomMapId && (roomMapId === 'random' || maps.some(map => map.id === roomMapId))
    ? roomMapId
    : null;
  els.mapSelect.value = restoredMap || maps[0]?.id || 'default';
  renderMapPicker(maps);
  // 地图表与可用对局是两条并发请求：列表先到时先按 mapId 画，地图表到位后补缩略图和中文名。
  if (availableGamesData.length) renderAvailableGames(availableGamesData);
  renderLobbyMapSummary();
  // 恢复会话可能早于地图表加载完成，等地图表到位后把加入房间的预览补画一次。
  if (joinMapLobby && els.joinMapSummary && !els.joinMapSummary.classList.contains('hidden')) renderJoinMapCard(joinMapLobby);
  syncMaxPlayersOptions();
  // 随机图不在加载时自动生成预览：房间恢复时那会顺手把种子写回参数面板，悄悄固定下一次的随机图。
  if (roomMapId !== 'random') window.RandomMapUI?.setSelected(els.mapSelect.value);
  applyRoomMapSelection();
}
function persistSession() {
  try {
    localStorage.setItem('tacticalGame.session', JSON.stringify({ gameId, myToken, myPlayer, hostToken, name: sessionName }));
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
      name: parsed.name || null,
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

function clearSavedSession() {
  gameId = null;
  myToken = null;
  hostToken = null;
  myPlayer = null;
  sessionName = null;
  try {
    localStorage.removeItem('tacticalGame.session');
  } catch {
    // 浏览器禁用本地存储时只清内存。
  }
}

function clearSessionFromSettings() {
  clearSavedSession();
  fillSettingsFromSession();
  clearCreateRoomView();
  clearJoinRoomView();
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
  sessionName = session.name;
  if (sessionName) {
    if (els.createName) els.createName.value = sessionName;
    if (els.joinName) els.joinName.value = sessionName;
  }
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

// 单位详单数值：挂到 marker 的 data-stat-* 上，只带本图实际配置的字段（support 才带 heal）。
// 源头是服务端 preview.units，随机地图改数值时前端不用动。
function previewUnitStatAttrs(spec) {
  if (!spec) return '';
  return [
    ['hp', spec.hp],
    ['attack', spec.attack],
    ['defense', spec.defense],
    ['move', spec.moveRange],
    ['range', spec.attackRange],
    ['cost', spec.cost],
    ['heal', spec.healPower],
  ]
    .filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
    .map(([key, value]) => ` data-stat-${key}="${value}"`)
    .join('');
}

function renderMapPreview(preview, seatView = null) {
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
  // 据点：颜色沿用金色圆点；整格命中区，悬停看类型 / 收入 / 部署折扣 / 维修 / 能否部署。
  const cpNames = new Map((preview.controlPoints || []).map(cp => [cp.id, cp.name]));
  const controlPoints = (preview.controlPoints || []).map(cp => {
    const p = point(cp);
    const spec = preview.controlPointTypes?.[cp.kind] || null;
    const kindLabel = cp.kind ? (CONTROL_POINT_NAMES[cp.kind] || cp.kind) : '普通据点';
    const stats = [
      spec ? ` data-stat-income="+${spec.income}"` : '',
      spec?.deployDiscount ? ` data-stat-discount="-${spec.deployDiscount}"` : '',
      spec?.repairAmount ? ` data-stat-repair="+${spec.repairAmount}"` : '',
      ` data-stat-deploy="${spec?.canDeploy === false ? '不可部署' : '可用'}"`,
    ].join('');
    return `<g class="preview-point" data-preview-marker data-marker-kind="control-point" data-marker-title="${esc(cp.name)}" data-marker-sub="${esc(kindLabel)}" data-marker-token="${esc(cp.kind || 'supply')}"${stats}>
      <polygon class="preview-marker-hit" points="${polygon(cp)}"></polygon>
      <circle class="preview-marker cp" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.4"></circle>
    </g>`;
  }).join('');
  // 出生位：歼灭 / 大逃杀不建总部，但出生位仍决定初始单位的落点，必须标出来；
  // 这两种模式改用圆形「出生点」标记（区别于总部方块），详单里带出它绑定的起始据点与初始单位数。
  const annihilationMode = preview.mode === 'annihilation' || preview.mode === 'royale';
  const spawnSlots = (preview.spawnSlots || []).map((slot, index) => ({
    id: slot.id,
    index,
    controlPointId: slot.controlPointId,
    startingUnits: slot.startingUnits,
    ...slot.headquarters,
  }));
  const legacyHeadquarters = Object.entries(preview.headquarters || {}).map(([id, pos], index) => ({ id, index, controlPointId: undefined, ...pos }));
  const starts = spawnSlots.length ? spawnSlots : legacyHeadquarters;
  // 座位标记（R2）：座位下标 → layoutSlots[i] → 按 slot.id 找到出生位标记。
  // 注意不能按下标对应：layouts['3'] 可能是 [slot_1, slot_3, slot_5]（spawnSlots 下标 0/2/4），
  // 地图上「第 3 个出生位」并不等于「3 号座位」。
  const seatCandidates = Array.isArray(seatView?.slots) ? seatView.slots : [];
  const seatMarkOf = slot => (seatView?.marks instanceof Map ? seatView.marks.get(slot.id) : null) || null;
  const seatUnused = slot => seatCandidates.length > 0 && !seatCandidates.includes(slot.id);
  // 悬停互亮的钩子：座位视图在场时每个出生位 marker 都带 data-slot-id（不限已分配/未分配），
  // 没有座位视图时（地图卡、竞技场等 6 处复用）不输出，既有预览输出保持逐字不变。
  const seatSlotAttr = slot => (seatCandidates.length > 0 ? ` data-slot-id="${esc(slot.id)}"` : '');
  const seatBadge = (slot, p) => {
    const mark = seatMarkOf(slot);
    if (!mark) return '';
    const color = mark.color || '#9cc3d8';
    // 先手角标：不重排座号，只在先手那座上方多一枚 ▲（草稿态同样跟着走）。
    const first = mark.first
      ? `<text class="seat-first-badge" x="${p.x.toFixed(1)}" y="${(p.y - 7.4).toFixed(1)}" text-anchor="middle" fill="${esc(color)}">▲</text>`
      : '';
    return `<circle class="seat-mark-ring${mark.preview ? ' is-preview' : ''}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="6.6" stroke="${esc(color)}"></circle>
      <text class="seat-mark-no${mark.preview ? ' is-preview' : ''}" x="${p.x.toFixed(1)}" y="${(p.y + 2.4).toFixed(1)}" text-anchor="middle" fill="${esc(color)}">${mark.seat}</text>${first}`;
  };
  const headquarters = starts.map(slot => {
    const p = point(slot);
    const cpName = slot.controlPointId ? cpNames.get(slot.controlPointId) : '';
    const sub = `出生位 ${slot.index + 1}${cpName ? ` · ${cpName}` : ''}`;
    if (annihilationMode) {
      return `<g class="preview-point${seatUnused(slot) ? ' is-unused' : ''}" data-preview-marker${seatSlotAttr(slot)} data-marker-kind="spawn" data-marker-title="出生点" data-marker-sub="${esc(sub)}" data-marker-token="spawn" data-stat-units="${(slot.startingUnits || []).length}">
        <polygon class="preview-marker-hit" points="${polygon(slot)}"></polygon>
        <circle class="preview-marker spawn spawn-slot-${slot.index + 1}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4.2"></circle>${seatBadge(slot, p)}
      </g>`;
    }
    // 总部：血量 / 防御来自本图 headquartersSpec，是否可部署来自 balance.deployFromHq。
    const hq = preview.headquartersSpec;
    const stats = [
      hq ? ` data-stat-hp="${hq.hp}" data-stat-defense="${hq.defense}"` : '',
      ` data-stat-deploy="${preview.deployFromHq === false ? '不可部署' : '可用'}"`,
    ].join('');
    return `<g class="preview-point${seatUnused(slot) ? ' is-unused' : ''}" data-preview-marker${seatSlotAttr(slot)} data-marker-kind="headquarters" data-marker-title="总部" data-marker-sub="${esc(sub)}" data-marker-token="headquarters"${stats}>
      <polygon class="preview-marker-hit" points="${polygon(slot)}"></polygon>
      <rect class="preview-marker hq hq-slot-${slot.index + 1}" x="${(p.x - 4).toFixed(1)}" y="${(p.y - 4).toFixed(1)}" width="8" height="8" rx="1.5"></rect>${seatBadge(slot, p)}
    </g>`;
  }).join('');
  // 初始单位：预览数据一直带着 spawnSlots[].startingUnits（type/q/r），此前没画出来；
  // 小圆点标在单位实际落格（总部邻格）上，颜色按兵种区分。
  // 圆点本身只有 2.2 单位半径，卡片缩小时几乎指不中，所以整格盖一层透明命中区
  //（与小圆点同格，悬停单位所在格子即算悬停单位）；详单由 preview-tooltip.js 弹出。
  // 旧版 headquarters 兜底路径没有单位数据，自然为空。
  const startingUnits = starts
    .flatMap(slot => (slot.startingUnits || []).map(unit => ({ slot, unit })))
    .map(({ slot, unit }) => {
      // 兵种列表完全跟着 spawnSlots[].startingUnits 走（雾杉疏林等图支援兵也是初始单位）。
      const p = point(unit);
      const spec = preview.units?.[unit.type];
      const trait = [spec?.canCapture ? '可占点' : '', spec?.attackLock ? '锁定目标' : ''].filter(Boolean).join(' · ');
      return `<g class="preview-unit" data-preview-marker data-marker-kind="unit" data-marker-title="${esc(UNIT_NAMES[unit.type] || unit.type)}" data-marker-sub="初始单位 · 出生位 ${slot.index + 1}" data-marker-token="${unit.type}"${trait ? ` data-marker-trait="${trait}"` : ''}${previewUnitStatAttrs(spec)}>
        <polygon class="preview-marker-hit" points="${polygon(unit)}"></polygon>
        <circle class="preview-marker unit unit-${unit.type}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.2"></circle>
      </g>`;
    })
    .join('');

  return `<div class="map-preview" aria-hidden="true">
    <svg viewBox="0 0 ${width} ${height}" role="img" focusable="false">
      ${hexes}${controlPoints}${headquarters}${startingUnits}
    </svg>
  </div>`;
}

function mapModeLabel(mode) {
  return mode === 'simultaneous' ? '同时' : mode === 'annihilation' ? '歼灭' : mode === 'royale' ? '大逃杀' : '标准';
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

function syncPendingSelection() {
  if (!els.mapPicker) return;
  const selected = pendingMapId || els.mapSelect.value || 'default';
  els.mapPicker.querySelectorAll('.map-card').forEach(card => {
    const isSelected = card.dataset.mapId === selected;
    card.classList.toggle('selected-map', isSelected);
    card.setAttribute('aria-checked', String(isSelected));
    card.tabIndex = isSelected ? 0 : -1;
  });
}

function selectMap(mapId) {
  els.mapSelect.value = mapId;
  pendingMapId = mapId;
  syncMapSelection();
  syncMaxPlayersOptions();
  renderLobbyMapSummary();
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

/** 右上角数值表：图标 + 数值（金色）+ 中文名，两列由整块 grid 统一宽度。 */
function lobbyMapStatRows(map) {
  const preview = map.preview || {};
  const maxTurns = preview.maxTurns === null ? '∞' : (preview.maxTurns ?? '-');
  return [
    ['◈', mapModeLabel(preview.mode), '模式'],
    ['⊘', preview.radius ?? '-', '半径'],
    ['⬡', (preview.controlPoints || []).length, '据点'],
    ['⚑', (preview.supportedPlayerCounts || [2]).join('/'), '玩家'],
    ['♟', preview.actionsPerTurn ?? '-', '行动点'],
    ['⏱', maxTurns, '回合上限'],
  ];
}

function randomMapStatRows() {
  const preview = window.RandomMapUI?.lastPreview;
  if (!preview) {
    // 房间模式下拿大厅元信息回显，避免「2-8 人」和房间里实际支持的 6 人对不上。
    const lobby = isRoomMapView('random') ? latestLobby : null;
    if (lobby) {
      return [
        ['◈', mapModeLabel(lobby.mode), '模式'],
        ['⚑', lobby.maxPlayers ?? '-', '玩家'],
      ];
    }
    return [['◈', '随机', '模式'], ['⚑', '2-8', '玩家']];
  }
  const maxTurns = preview.maxTurns === null ? '∞' : (preview.maxTurns ?? '-');
  return [
    ['◈', mapModeLabel(preview.mode), '模式'],
    ['⊘', preview.radius ?? '-', '半径'],
    ['⬡', (preview.controlPoints || []).length, '据点'],
    ['⚑', '2-8', '玩家'],
    ['♟', preview.actionsPerTurn ?? '-', '行动点'],
    ['⏱', maxTurns, '回合上限'],
  ];
}

function lobbyMapStatsMarkup(rows) {
  return rows
    .map(([icon, value, label]) => `<span class="lobby-map-stat-key">${esc(icon)} ${esc(String(value))}</span><span class="lobby-map-stat-label">${esc(label)}</span>`)
    .join('');
}

const LOBBY_TERRAIN_ORDER = ['plain', 'water', 'blocker'];
const LOBBY_TERRAIN_LABELS = { plain: '平原', water: '水域', blocker: '障碍' };
const LOBBY_LEGEND_UNITS = ['infantry', 'scout', 'heavy', 'ranger'];

/** 预览左下角图例：只列这张图上真实出现的图元，初始单位按兵种分开列。 */
function lobbyMapLegendMarkup(preview) {
  if (!preview || !Array.isArray(preview.cells) || preview.cells.length === 0) return '';
  const terrains = new Set(preview.cells.map(cell => cell.terrain || 'plain'));
  const units = new Set();
  for (const slot of preview.spawnSlots || []) {
    for (const unit of slot.startingUnits || []) {
      if (LOBBY_LEGEND_UNITS.includes(unit.type)) units.add(unit.type);
    }
  }
  const item = (swatch, label) => `<span class="lobby-map-legend-item"><i class="${swatch}"></i>${esc(label)}</span>`;
  const items = [];
  for (const key of LOBBY_TERRAIN_ORDER) {
    if (terrains.has(key)) items.push(item(`lobby-map-swatch-hex ${key}`, LOBBY_TERRAIN_LABELS[key]));
  }
  if ((preview.controlPoints || []).length) items.push(item('lobby-map-swatch-cp', '据点'));
  const annihilation = preview.mode === 'annihilation' || preview.mode === 'royale';
  const starts = (preview.spawnSlots || []).length > 0 || Object.keys(preview.headquarters || {}).length > 0;
  if (starts) items.push(annihilation ? item('lobby-map-swatch-spawn', '出生点') : item('lobby-map-swatch-hq', '总部'));
  for (const type of LOBBY_LEGEND_UNITS) {
    if (!units.has(type)) continue;
    items.push(item(`lobby-map-swatch-unit ${type}`, UNIT_NAMES[type] || type));
  }
  return items.join('');
}

/** 把预览与图例一起画进摘要卡；没有预览时给一句占位说明。seatView 用于叠加座位标记（R2）。 */
function renderLobbyMapStage(preview, placeholder, seatView = null) {
  if (els.lobbyMapThumb) {
    els.lobbyMapThumb.innerHTML = preview
      ? renderMapPreview(preview, seatView)
      : `<div class="map-preview empty">${esc(placeholder || '暂无预览')}</div>`;
  }
  if (els.lobbyMapLegend) els.lobbyMapLegend.innerHTML = lobbyMapLegendMarkup(preview);
}

/** 房间卡展开时，建房表单的地图摘要代表的是「本局地图」，不是下一局的默认选图（见 isRoomMapView）。 */
function isRoomMapView(mapId) {
  return Boolean(els.createForm?.classList.contains('room-active'))
    && Boolean(latestLobby?.mapId)
    && latestLobby.mapId === mapId;
}

/** 恢复既有房间后把建房表单的选图纠正成房间实际地图，避免第一张静态图冒充本局地图。 */
function applyRoomMapSelection() {
  if (!roomMapId || !els.mapSelect) return;
  // 地图表还没回来时先按兵不动，loadMapList 结束时还会再调一次。
  if (roomMapId !== 'random' && !availableMaps.some(map => map.id === roomMapId)) {
    if (!availableMaps.length) return;
    roomMapId = availableMaps[0]?.id || null; // 房间用的地图已下线，退回第一张静态图
    if (!roomMapId) return;
  }
  if (els.mapSelect.value !== roomMapId) {
    els.mapSelect.value = roomMapId;
    pendingMapId = roomMapId;
    syncMapSelection();
    syncMaxPlayersOptions();
  }
  renderLobbyMapSummary();
}

/** 大厅首屏的「已选地图」摘要：静态图显示真实缩略图，随机图由 RandomMapUI 异步补预览。 */
function renderLobbyMapSummary() {
  if (!els.lobbyMapThumb) return;
  const mapId = els.mapSelect?.value || '';
  if (mapId === 'random') {
    // 房间里的随机图可能没有本地预览（刷新后）：此时给说明占位，不拿新生成的预览冒充本局地图。
    const roomView = isRoomMapView('random');
    const preview = window.RandomMapUI?.lastPreview;
    if (roomView) els.lobbyMapThumb.removeAttribute('data-random-map-preview');
    else els.lobbyMapThumb.setAttribute('data-random-map-preview', '');
    renderLobbyMapStage(preview, roomView ? '本局使用随机地图' : '随机地图（参数可配）', lobbySeatView(false));
    if (els.lobbyMapName) els.lobbyMapName.textContent = '随机地图';
    if (els.lobbyMapId) els.lobbyMapId.textContent = 'random';
    if (els.lobbyMapMeta) els.lobbyMapMeta.innerHTML = lobbyMapStatsMarkup(randomMapStatRows());
    if (els.lobbyMapDesc) {
      els.lobbyMapDesc.textContent = roomView
        ? '本局地图由创建时的随机参数生成，地形以对局内为准。'
        : '随机参数在「更换地图 → 随机地图」里调整；留空项由服务端默认。';
      els.lobbyMapDesc.title = els.lobbyMapDesc.textContent;
    }
    return;
  }

  els.lobbyMapThumb.removeAttribute('data-random-map-preview');
  const map = availableMaps.find(item => item.id === mapId);
  if (!map) {
    renderLobbyMapStage(null, '地图读取中…');
    if (els.lobbyMapName) els.lobbyMapName.textContent = '地图加载中…';
    if (els.lobbyMapId) els.lobbyMapId.textContent = '';
    if (els.lobbyMapMeta) els.lobbyMapMeta.innerHTML = '';
    if (els.lobbyMapDesc) els.lobbyMapDesc.textContent = '';
    return;
  }
  renderLobbyMapStage(map.preview, '暂无预览', lobbySeatView());
  if (els.lobbyMapName) els.lobbyMapName.textContent = map.name;
  if (els.lobbyMapId) els.lobbyMapId.textContent = map.id;
  if (els.lobbyMapMeta) els.lobbyMapMeta.innerHTML = lobbyMapStatsMarkup(lobbyMapStatRows(map));
  if (els.lobbyMapDesc) {
    els.lobbyMapDesc.textContent = map.description || '';
    els.lobbyMapDesc.title = map.description || '';
  }
}

let joinMapLobby = null;

/** 加入的房间也要能看到地图：静态图直接用 /api/maps 的预览，随机图再用对局状态补。 */
function renderJoinMapCard(lobby) {
  joinMapLobby = lobby || null;
  if (!els.joinMapSummary) return;
  if (!lobby) {
    els.joinMapSummary.classList.add('hidden');
    return;
  }
  const map = availableMaps.find(item => item.id === lobby.mapId);
  if (map) {
    fillJoinMapCard({ name: map.name, id: map.id, description: map.description || '', preview: map.preview });
  } else if (lobby.mapId === 'random') {
    fillJoinMapCard({
      name: '随机地图',
      id: 'random',
      description: '房主用随机参数生成的地图，具体参数不在大厅里展示。',
      preview: window.RandomMapUI?.lastPreview || null,
    });
    hydrateRandomJoinMapCard();
  } else {
    fillJoinMapCard({ name: lobby.mapId || '未知地图', id: lobby.mapId || '', description: '', preview: null });
  }
  els.joinMapSummary.classList.remove('hidden');
}

function fillJoinMapCard({ name, id, description, preview }) {
  if (els.joinMapThumb) {
    els.joinMapThumb.innerHTML = preview
      ? renderMapPreview(preview)
      : '<div class="map-preview empty">预览暂不可用</div>';
  }
  if (els.joinMapLegend) els.joinMapLegend.innerHTML = lobbyMapLegendMarkup(preview);
  if (els.joinMapName) els.joinMapName.textContent = name;
  if (els.joinMapId) els.joinMapId.textContent = id;
  if (els.joinMapDesc) els.joinMapDesc.textContent = description || '';
  if (els.joinMapMeta) els.joinMapMeta.innerHTML = preview ? lobbyMapStatsMarkup(lobbyMapStatRows({ preview })) : '';
}

/** 随机图大厅摘要里没有地图格：拿玩家 token 拉一次状态，按对局里真实的地图补出预览。 */
async function hydrateRandomJoinMapCard() {
  const lobby = joinMapLobby;
  if (!lobby || lobby.mapId !== 'random' || !gameId || !myToken) return;
  try {
    const res = await fetch(`/api/games/${gameId}`, { headers: { 'X-Player-Token': myToken } });
    if (!res.ok) return;
    const state = await res.json();
    if (joinMapLobby !== lobby || !state?.cells?.length) return;
    const config = state.config || {};
    fillJoinMapCard({
      name: config.name || '随机地图',
      id: 'random',
      description: config.description || '房主用随机参数生成的地图。',
      preview: {
        cells: state.cells,
        controlPoints: state.controlPoints || [],
        spawnSlots: config.spawnSlots || [],
        mode: config.mode,
        radius: config.radius,
        maxTurns: config.balance?.maxTurns,
        actionsPerTurn: config.balance?.actionsPerTurn,
        supportedPlayerCounts: config.supportedPlayerCounts,
        // 悬停详单要的数值：随机图大厅摘要里没有，直接从对局配置补齐。
        units: config.units,
        controlPointTypes: config.balance?.controlPointTypes,
        headquartersSpec: config.headquartersSpec,
        deployFromHq: config.balance?.deployFromHq !== false,
      },
    });
  } catch {
    // 预览补不出来时保留占位卡，不影响大厅操作。
  }
}

function renderMapPicker(maps) {
  if (!els.mapPicker) return;
  const list = Array.isArray(maps) ? maps : availableMaps;
  if (!list.length) {
    els.mapPicker.innerHTML = '<div class="map-picker-empty">暂无可用地图</div>';
    if (els.mapDialogCount) els.mapDialogCount.textContent = '0 张';
    return;
  }
  const text = mapFilterText.trim().toLowerCase();
  const filtered = list.filter(map => {
    const mode = map.preview?.mode || 'standard';
    if (mapFilterMode && mode !== mapFilterMode) return false;
    if (!text) return true;
    return `${map.name} ${map.id} ${map.description || ''}`.toLowerCase().includes(text);
  });
  const selected = pendingMapId || els.mapSelect.value || list[0].id;
  const randomCard = window.RandomMapUI?.renderRandomMapCard(selected === 'random') || '';
  const cards = filtered.map(map => {
    const isSelected = map.id === selected;
    const controlPointCount = map.preview?.controlPoints?.length ?? 0;
    const radius = map.preview?.radius ?? '-';
    const maxTurns = map.preview?.maxTurns === null ? '∞' : map.preview?.maxTurns ?? '-';
    const actionsPerTurn = map.preview?.actionsPerTurn ?? '-';
    const counts = (map.preview?.supportedPlayerCounts || [2]).join('/');
    const modeLabel = map.preview?.mode === 'simultaneous' ? '同时' : map.preview?.mode === 'annihilation' ? '歼灭' : map.preview?.mode === 'royale' ? '大逃杀' : '标准';
    return `<button type="button" class="map-card ${isSelected ? 'selected-map' : ''}" data-map-id="${esc(map.id)}" role="radio" aria-checked="${isSelected}" aria-label="${esc(map.name)} (${esc(map.id)})" title="${esc(map.name)} — ${esc(map.description || '')}">
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
  els.mapPicker.innerHTML = randomCard + (cards || '<div class="map-picker-empty">没有匹配的地图</div>');
  const lastRandomPreview = window.RandomMapUI?.lastPreview;
  const randomCardPreview = els.mapPicker.querySelector('.map-card-random .map-preview');
  if (lastRandomPreview && randomCardPreview) {
    randomCardPreview.outerHTML = renderMapPreview(lastRandomPreview);
  }
  els.mapPicker.querySelectorAll('.map-card').forEach(card => {
    card.addEventListener('click', () => choosePendingMap(card.dataset.mapId));
    card.addEventListener('keydown', e => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        choosePendingMap(card.dataset.mapId);
      }
    });
  });
  if (els.mapDialogCount) {
    els.mapDialogCount.textContent = `${filtered.length + (randomCard ? 1 : 0)} 张可选`;
  }
  if (mapDialogOpen) syncPendingSelection();
  else syncMapSelection();
}

function mapLabel(mapId) {
  return mapId === 'random' ? '随机地图' : (availableMaps.find(map => map.id === mapId)?.name || mapId || '未选择');
}

function renderMapDialogFooter() {
  if (!els.mapDialogSelected) return;
  const label = mapLabel(pendingMapId || els.mapSelect.value);
  els.mapDialogSelected.innerHTML = `已选：<b>${esc(label)}</b>`;
}

function randomFactsMarkup() {
  const preview = window.RandomMapUI?.lastPreview;
  if (!preview) return '<div class="rmo-fact"><span>状态</span><b>生成中…</b></div>';
  const seed = window.RandomMapUI?.lastSeed || '';
  const rows = [
    ['地图半径', preview.radius ?? '—'],
    ['据点数量', (preview.controlPoints || []).length],
    ['模式', mapModeLabel(preview.mode)],
    ['回合 / 行动点', `${preview.maxTurns === null ? '∞' : (preview.maxTurns ?? '—')} / ${preview.actionsPerTurn ?? '—'}`],
    ['种子', seed || '—'],
  ];
  return rows.map(([key, value]) =>
    `<div class="rmo-fact"><span>${esc(key)}</span><b>${esc(value)}</b></div>`).join('');
}

function renderMapDialogRandomFacts() {
  if (els.mapDialogRandomFacts) els.mapDialogRandomFacts.innerHTML = randomFactsMarkup();
}

function showMapDialogTab(tab) {
  mapDialogTab = tab === 'random' ? 'random' : 'builtin';
  document.querySelectorAll('.map-dialog-tab').forEach(button => {
    const active = button.dataset.mapTab === mapDialogTab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('.map-dialog-pane').forEach(pane => {
    pane.classList.toggle('active', pane.dataset.mapPane === mapDialogTab);
  });
  if (mapDialogTab === 'random') {
    pendingMapId = 'random';
    els.randomMapOptions?.classList.remove('hidden');
    const lastPreview = window.RandomMapUI?.lastPreview;
    if (lastPreview) {
      const rendered = renderMapPreview(lastPreview);
      document.querySelectorAll('[data-random-preview]').forEach(el => {
        el.classList.remove('rmo-preview-error');
        el.innerHTML = rendered;
      });
    } else {
      window.RandomMapUI?.refreshPreview(true);
    }
    renderMapDialogRandomFacts();
  } else {
    if (pendingMapId === 'random') {
      pendingMapId = lastStaticMapId || els.mapSelect.value || availableMaps[0]?.id || 'default';
    }
    syncPendingSelection();
  }
  renderMapDialogFooter();
}

function choosePendingMap(mapId) {
  if (!mapDialogOpen) return;
  if (mapId === 'random') {
    lastStaticMapId = lastStaticMapId || els.mapSelect.value;
    showMapDialogTab('random');
    return;
  }
  pendingMapId = mapId;
  lastStaticMapId = mapId;
  syncPendingSelection();
  renderMapDialogFooter();
}

function openMapDialog() {
  if (!els.mapDialog) return;
  // 弹层会盖住大厅预览，悬停详单先收起，免得浮在弹层上面。
  window.PreviewTooltip?.hide();
  mapDialogReturnFocus = document.activeElement;
  mapDialogOpen = true;
  mapFilterText = '';
  mapFilterMode = '';
  if (els.mapFilterText) els.mapFilterText.value = '';
  if (els.mapFilterMode) els.mapFilterMode.value = '';
  pendingMapId = els.mapSelect.value || availableMaps[0]?.id || 'default';
  lastStaticMapId = pendingMapId === 'random'
    ? (availableMaps[0]?.id || 'default')
    : pendingMapId;
  els.mapDialog.classList.remove('hidden');
  els.mapDialogBackdrop?.classList.remove('hidden');
  document.body.classList.add('map-dialog-open');
  renderMapPicker(availableMaps);
  showMapDialogTab(pendingMapId === 'random' ? 'random' : 'builtin');
  els.btnMapDialogClose?.focus();
}

function closeMapDialog() {
  if (!mapDialogOpen) return;
  mapDialogOpen = false;
  els.mapDialog?.classList.add('hidden');
  els.mapDialogBackdrop?.classList.add('hidden');
  document.body.classList.remove('map-dialog-open');
  pendingMapId = els.mapSelect.value;
  syncMapSelection();
  const target = mapDialogReturnFocus && mapDialogReturnFocus.isConnected
    ? mapDialogReturnFocus
    : els.btnChangeMap;
  target?.focus?.();
  mapDialogReturnFocus = null;
}

function applyMapDialog() {
  const mapId = pendingMapId || els.mapSelect.value;
  closeMapDialog();
  selectMap(mapId);
}

function scheduleMapDialogPreview() {
  if (!mapDialogOpen || mapDialogTab !== 'random') return;
  // 已选中随机地图时模块自己的 schedulePreview 会处理；这里只补「浏览随机页签但尚未选中」的情况。
  if (window.RandomMapUI?.isSelected()) return;
  clearTimeout(mapDialogPreviewTimer);
  mapDialogPreviewTimer = setTimeout(() => window.RandomMapUI?.refreshPreview(true), 450);
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
  if (!owner || typeof payload.actionsUsed !== 'number') return;
  const player = s.players?.[owner];
  if (!player) return;
  if (!player.stats) player.stats = { headquartersDamage: 0, unitsDestroyed: 0, playersEliminated: 0, actionPointsUsed: 0, actionMerit: 0 };
  // 顺序模式沿用全局 actionsUsed（每个座位回合重置）；同时模式每个玩家有自己的步序。
  if (!isSimultaneous()) {
    if (payload.actionsUsed <= (s.turn.actionsUsed ?? 0)) return;
    player.stats.actionPointsUsed = (player.stats.actionPointsUsed ?? 0) + payload.actionsUsed - (s.turn.actionsUsed ?? 0);
    return;
  }
  if (!s.turn.actionsUsedByPlayer) s.turn.actionsUsedByPlayer = {};
  const last = s.turn.actionsUsedByPlayer[owner] ?? 0;
  if (payload.actionsUsed <= last) return;
  player.stats.actionPointsUsed = (player.stats.actionPointsUsed ?? 0) + payload.actionsUsed - last;
  s.turn.actionsUsedByPlayer[owner] = payload.actionsUsed;
}
function ensureStats(player) {
  if (!player.stats) player.stats = { headquartersDamage: 0, unitsDestroyed: 0, playersEliminated: 0, actionPointsUsed: 0, actionMerit: 0 };
  return player.stats;
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
      if (!s.resources[p.owner]) s.resources[p.owner] = { supplies: 0 };
      s.resources[p.owner].supplies -= p.cost || 0;
      s.units.set(p.unitId, { id: p.unitId, owner: p.owner, type: p.unitType, q: p.q, r: p.r, hp: p.hp, maxHp: p.hp, attack: p.attack, defense: p.defense, moveRange: p.moveRange, attackRange: p.attackRange, alive: true, hasMoved: true, hasActed: false, actionSpent: true, canCapture: !!p.canCapture, healPower: p.healPower, cost: p.unitCost ?? p.cost });
      if (typeof p.actionsUsed === 'number') s.turn.actionsUsed = p.actionsUsed;
      break;
    case 'move': { const u = s.units.get(p.unitId); recordActionPoint(s, p.owner || u?.owner, p); if (u) { u.q = p.toQ; u.r = p.toR; u.hasMoved = true; u.actionSpent = true; } if (typeof p.actionsUsed === 'number') s.turn.actionsUsed = p.actionsUsed; break; }
    case 'attack': { const t = s.units.get(p.targetId) || s.headquarters.get(p.targetId); const previousHp = t ? t.hp : null; if (t) t.hp = p.targetHp; const a = s.units.get(p.attackerId); recordActionPoint(s, p.owner || a?.owner, p); if (a) { a.hasActed = true; a.actionSpent = true; }
      // 击杀入账：把活着的单位打到 0 血才是凶手（与服务器"最后一击归属"同口径，同一轮内打在尸体上的过量击杀不再重复记账）；炮火等环境击杀无归属。
      if (t && previousHp > 0 && p.targetHp === 0 && a && s.units.has(p.targetId)) { const pl = s.players[a.owner]; if (pl) { ensureStats(pl); pl.stats.killValue = (pl.stats.killValue ?? 0) + (t.cost || 0); } }
      if (typeof p.actionsUsed === 'number') s.turn.actionsUsed = p.actionsUsed; break; }
    case 'heal': { const t = s.units.get(p.targetId); if (t) t.hp = p.targetHp; const u = s.units.get(p.supportId); recordActionPoint(s, p.owner || u?.owner, p); if (u) { u.hasActed = true; u.actionSpent = true; } if (typeof p.actionsUsed === 'number') s.turn.actionsUsed = p.actionsUsed; break; }
    case 'wait': { recordActionPoint(s, p.owner, p); if (typeof p.actionsUsed === 'number') s.turn.actionsUsed = p.actionsUsed; break; }
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
      // 整轮边界：为未淘汰玩家累计据点持有（与服务器 accumulateControlHold 同口径）。
      if (p.gameOver !== true || p.controlHoldCounted === true) {
        for (const [pid, pl] of Object.entries(s.players || {})) {
          if (pl.status === 'eliminated') continue;
          ensureStats(pl);
          const held = [...s.controlPoints.values()].filter(cp => cp.owner === pid).length;
          pl.stats.controlHold = (pl.stats.controlHold ?? 0) + held;
          pl.stats.controlHoldRounds = (pl.stats.controlHoldRounds ?? 0) + 1;
        }
      }
      break;
    case 'round_resolved':
      // 结算明细由 move/attack/... 单体事件驱动棋盘；此处只重置计划阶段。
      s.plan = { committed: [], myQueue: [] };
      s.lastRoundResults = p.results || null;
      break;
    case 'round_start':
      s.turn.roundNumber = p.roundNumber || s.turn.roundNumber + 1;
      s.turn.turnNumber = s.turn.roundNumber;
      s.turn.actionsUsed = 0;
      s.turn.actionsUsedByPlayer = {};
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
        if (!ok || !state) return false;
        // 终局字段也要合并：SSE 在最后一轮断开时，GET 仍是唯一的真相来源。
        if (data?.winner !== undefined) state.winner = data.winner;
        if (data?.result !== undefined) state.result = data.result;
        if (data?.phase) state.turn.phase = data.phase;
        if (data?.adjudication) state.adjudication = data.adjudication;
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

/**
 * 同时模式：把当前计划队列投影成虚拟站位与虚拟地形（与服务端 planning.ts 同口径）。
 * 队列顺序即行动点顺序；攻击/治疗/爆破的起点、移动范围都按投影位置计算。
 */
function planProjection() {
  const positions = new Map();
  const terrain = new Map();
  const actionPositions = new Map();
  const positionOf = unitId => {
    if (positions.has(unitId)) return positions.get(unitId);
    const unit = state?.units?.get(unitId);
    return unit ? { q: unit.q, r: unit.r } : null;
  };
  for (const action of myPlanQueue()) {
    const unitId = action.unitId || action.attackerId || action.supportId;
    if (unitId) {
      const pos = positionOf(unitId);
      if (pos) actionPositions.set(action.id, pos);
    }
    if (action.type === 'move' && unitId && Number.isFinite(action.q) && Number.isFinite(action.r)) {
      positions.set(unitId, { q: action.q, r: action.r });
    } else if (action.type === 'demolish' && Number.isFinite(action.q) && Number.isFinite(action.r)) {
      terrain.set(hexKey({ q: action.q, r: action.r }), 'plain');
    }
  }
  return { positions, terrain, actionPositions };
}
function projectedUnitOrigin(unit) {
  return planProjection().positions.get(unit.id) || { q: unit.q, r: unit.r };
}
function projectedTerrainAt(q, r) {
  return planProjection().terrain.get(hexKey({ q, r })) ?? cellAt(q, r)?.terrain;
}

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
  const from = isSimultaneous() ? projectedUnitOrigin(unit) : unit;
  return hexNeighbors(from).filter(p => {
    const terrain = isSimultaneous() ? projectedTerrainAt(p.q, p.r) : cellAt(p.q, p.r)?.terrain;
    if (terrain !== 'blocker') return false;
    // 同时模式允许计划时目标格上有单位：对方/己方可能在本轮更早的行动点腾空。
    return isSimultaneous() || !occupied(p.q, p.r);
  });
}
function reachable(unit) {
  if (!isSimultaneous()) {
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
  // 同时模式：路径只受地形限制（水/障碍），单位/总部不挡路；目的地当前被占用也可入队。
  const projection = planProjection();
  const from = projection.positions.get(unit.id) || { q: unit.q, r: unit.r };
  const result = [], visited = new Set([hexKey(from)]), queue = [{ ...from, d: 0 }];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    if (cur.d >= unit.moveRange) continue;
    for (const n of hexNeighbors(cur)) {
      const k = hexKey(n);
      if (visited.has(k)) continue;
      visited.add(k);
      const terrain = projection.terrain.get(k) ?? cellAt(n.q, n.r)?.terrain;
      if (terrain !== 'plain') continue;
      result.push(n);
      queue.push({ ...n, d: cur.d + 1 });
    }
  }
  return result;
}
function deployCells(origin) {
  if (isArtilleryDangerCell(origin.q, origin.r)) return [];
  if (isSimultaneous()) {
    // 部署目标格当前被占也可以入队：本步其他单位可能先腾空。
    return hexNeighbors(origin).filter(p =>
      projectedTerrainAt(p.q, p.r) === 'plain' && !isArtilleryDangerCell(p.q, p.r));
  }
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
function shapeAimFor(unit, kind, q, r, origin = null) {
  const from = origin || unit;
  const shape = unitShapeSpec(unit, kind);
  const dq = q - from.q, dr = r - from.r;
  if (shape.type === 'single') {
    const d = hexDistance(from, { q, r });
    if (d > (kind === 'healShape' ? unitHealRange(unit) : unit.attackRange)) return null;
    if (kind === 'attackShape' && d === 0) return null;
    return { type: 'single', direction: 0, cells: [{ q, r }] };
  }
  if (shape.type === 'arc') {
    if (hexDistance(from, { q, r }) !== 1) return null;
    const direction = SHAPE_HEX_DIRS.findIndex(dir => dir.q === dq && dir.r === dr);
    if (direction < 0) return null;
    const idx = [(direction + 5) % 6, direction, (direction + 1) % 6];
    return { type: 'arc', direction, cells: idx.map(i => ({ q: from.q + SHAPE_HEX_DIRS[i].q, r: from.r + SHAPE_HEX_DIRS[i].r })) };
  }
  for (let direction = 0; direction < 6; direction++) {
    const dir = SHAPE_HEX_DIRS[direction];
    const k = dir.q !== 0 ? dq / dir.q : dr / dir.r;
    if (!Number.isInteger(k) || k < 1 || k > shape.length) continue;
    if (dir.q * k !== dq || dir.r * k !== dr) continue;
    const cells = [];
    for (let s = 1; s <= shape.length; s++) cells.push({ q: from.q + dir.q * s, r: from.r + dir.r * s });
    return { type: 'line', direction, cells };
  }
  return null;
}
/** 可点击的瞄准格集合。旧地图无形状配置 → single = 射程内全部格（与历史行为一致）。 */
function aimableCells(unit, kind, origin = null) {
  const from = origin || (isSimultaneous() ? projectedUnitOrigin(unit) : unit);
  const aims = [];
  for (const c of state.cells) {
    if (shapeAimFor(unit, kind, c.q, c.r, from)) aims.push({ q: c.q, r: c.r });
  }
  return aims;
}
function attackRangeCells(unit) {
  return aimableCells(unit, 'attackShape');
}

// —— 悬停看射程 / 攻击预演：推导覆盖格与伤害区间，不做任何服务器请求 ——
/** 悬停单位的射程/覆盖提示。顺序模式选择单位后正在选目标时（rangeHighlights 非空）不叠加，避免与已有高亮混涌。 */
function hoverRangeHint() {
  if (!state || state.cells.length === 0 || !hoverCell) return null;
  if (playback.isActive()) return null;
  if (interactionMode !== 'idle' && interactionMode !== 'unit_selected') return null;
  if (rangeHighlights.length > 0) return null;
  const unit = [...state.units.values()].find(u => u.alive && u.q === hoverCell.q && u.r === hoverCell.r);
  if (!unit) return null;
  // 同时模式按计划投影位置提示射程（同一单位可能先移动后攻击）。
  const hintUnit = isSimultaneous() ? { ...unit, ...projectedUnitOrigin(unit) } : unit;
  const hint = window.BoardInspect?.rangeHintFor(hintUnit, state.cells, gameConfig);
  return hint ? { ...hint, unit } : null;
}

/** 攻击/治疗瞄准预演：返回 { cells, entries }，entries 为 [{ q, r, text, tone, kill }]。 */
function aimPreview() {
  if (!state || !hoverCell) return null;
  if (interactionMode !== 'attack_mode' && interactionMode !== 'heal_mode') return null;
  const unit = state.units.get(selectedUnitId);
  if (!unit) return null;
  if (!rangeHighlights.some(h => h.q === hoverCell.q && h.r === hoverCell.r)) return null;
  const isHeal = interactionMode === 'heal_mode';
  let cells;
  if (isSimultaneous()) {
    const origin = projectedUnitOrigin(unit);
    const aim = shapeAimFor(unit, isHeal ? 'healShape' : 'attackShape', hoverCell.q, hoverCell.r, origin);
    if (!aim) return null;
    cells = aim.cells;
  } else {
    cells = [{ q: hoverCell.q, r: hoverCell.r }];
  }
  const balance = gameConfig?.balance || {};
  const variance = balance.damageVarianceRange ?? 0;
  const minimum = balance.minimumDamage ?? 1;
  const entries = [];
  for (const cell of cells) {
    if (isHeal) {
      const target = [...state.units.values()].find(u => u.alive && u.owner === myPlayer && u.q === cell.q && u.r === cell.r && u.hp < u.maxHp);
      if (!target) continue;
      const base = unit.healPower ?? 0;
      const max = base + (balance.healVarianceRange ?? 0);
      const missing = target.maxHp - target.hp;
      const lo = Math.min(base, missing), hi = Math.min(max, missing);
      entries.push({ q: cell.q, r: cell.r, tone: 'heal', kill: false, text: lo === hi ? `+${lo}` : `+${lo}~${hi}` });
    } else {
      const target = entityAt(cell.q, cell.r);
      if (!target || target.owner === myPlayer || target.alive === false) continue;
      const lo0 = Math.max(minimum, unit.attack - (target.defense ?? 0) - variance);
      const hi0 = Math.max(minimum, unit.attack - (target.defense ?? 0) + variance);
      const kill = hi0 >= target.hp;
      const lo = Math.min(lo0, target.hp), hi = Math.min(hi0, target.hp);
      entries.push({ q: cell.q, r: cell.r, tone: 'attack', kill, text: kill ? `-${hi} 致死` : lo === hi ? `-${lo}` : `-${lo}~${hi}` });
    }
  }
  // 顺序模式只有点到真实目标才有意义，空覆盖不提示。
  if (!isSimultaneous() && !entries.length) return null;
  return { cells, entries };
}

function drawChipAt(x, y, text, tone, kill) {
  ctx.save();
  ctx.font = 'bold 10px system-ui, sans-serif';
  const w = ctx.measureText(text).width + 10;
  const h = 15;
  const rx = x - w / 2, ry = y - h - 20;
  ctx.beginPath();
  ctx.moveTo(rx + 4, ry); ctx.lineTo(rx + w - 4, ry); ctx.arcTo(rx + w, ry, rx + w, ry + 4, 4);
  ctx.lineTo(rx + w, ry + h - 4); ctx.arcTo(rx + w, ry + h, rx + w - 4, ry + h, 4);
  ctx.lineTo(rx + 4, ry + h); ctx.arcTo(rx, ry + h, rx, ry + h - 4, 4);
  ctx.lineTo(rx, ry + 4); ctx.arcTo(rx, ry, rx + 4, ry, 4); ctx.closePath();
  ctx.fillStyle = tone === 'heal' ? 'rgba(8, 38, 30, .88)' : 'rgba(46, 10, 16, .88)';
  ctx.fill();
  ctx.strokeStyle = tone === 'heal' ? '#3effc8' : kill ? '#ff3b5c' : '#ff8a9a';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = tone === 'heal' ? '#8affdd' : kill ? '#ffb3c0' : '#ffd2da';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x, ry + h / 2 + 0.5);
  ctx.restore();
}

function drawHoverRangeHints() {
  const hint = hoverRangeHint();
  if (!hint) return;
  ctx.save();
  const heal = hint.kind === 'heal';
  ctx.fillStyle = heal ? 'rgba(62,255,200,.05)' : 'rgba(255,95,95,.06)';
  ctx.strokeStyle = heal ? 'rgba(62,255,200,.32)' : 'rgba(255,95,95,.34)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  for (const c of hint.cells) { pathHex(c.q, c.r, 3); ctx.fill(); ctx.stroke(); }
  ctx.setLineDash([]);
  const p = hexToPixel(hint.unit.q, hint.unit.r);
  ctx.strokeStyle = 'rgba(255,200,120,.7)';
  ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.arc(p.x, p.y, HEX_SIZE * .5, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

function drawAimPreview() {
  const preview = aimPreview();
  if (!preview) return;
  ctx.save();
  ctx.fillStyle = 'rgba(255,220,120,.07)';
  ctx.strokeStyle = 'rgba(255,220,120,.6)';
  ctx.lineWidth = 1.6;
  for (const c of preview.cells) { pathHex(c.q, c.r, 4); ctx.fill(); ctx.stroke(); }
  ctx.restore();
  for (const e of preview.entries) {
    const p = hexToPixel(e.q, e.r);
    drawChipAt(p.x, p.y, e.text, e.tone, e.kill);
  }
}

/** cellInfo 后追加的预演摘要，如「预计 -12~18、致死」。 */
function aimPreviewInfo() {
  const preview = aimPreview();
  if (!preview || !preview.entries.length) return '';
  const parts = preview.entries.map(e => e.text);
  return ` | 预计 ${parts.join('、')}`;
}

// —— 同时模式：已排队指令的棋盘预览（编号与计划面板清单一一对应） ——
const PLAN_COLORS = { move: '#3cc878', attack: '#ff5a5a', heal: '#50dcb4', deploy: '#f0d25a', demolish: '#ffaa46', wait: '#9aa7b2' };
const PLAN_KIND_LABELS = { move: '移动', attack: '攻击', heal: '治疗', deploy: '部署', demolish: '爆破', wait: '待命' };
let planHoverId = null;

function hexToRgba(hex, alpha) {
  const h = String(hex).replace('#', '');
  if (h.length !== 6) return `rgba(154,167,178,${alpha})`;
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${alpha})`;
}

/** 把我方计划队列翻译成预览图层；结算回放期间隐藏（棋盘上正在演真实结果）。 */
function planOverlays() {
  if (!isSimultaneous() || !state || playback.isActive()) return [];
  const projection = planProjection();
  return myPlanQueue().map((a, i) => {
    const base = { id: a.id, index: i + 1, kind: a.type, to: Number.isFinite(a.q) && Number.isFinite(a.r) ? { q: a.q, r: a.r } : null };
    const actionOrigin = projection.actionPositions.get(a.id) || null;
    if (a.type === 'deploy') {
      const origin = state.headquarters.get(a.fromId) || state.controlPoints.get(a.fromId) || null;
      return { ...base, unitType: a.unitType, from: origin ? { q: origin.q, r: origin.r } : null };
    }
    if (a.type === 'move' || a.type === 'demolish') {
      const unit = state.units.get(a.unitId) || null;
      return { ...base, unit, from: actionOrigin };
    }
    if (a.type === 'attack' || a.type === 'heal') {
      const unit = state.units.get(a.type === 'attack' ? a.attackerId : a.supportId) || null;
      if (!unit || !base.to || !actionOrigin) return null;
      const aim = shapeAimFor(unit, a.type === 'attack' ? 'attackShape' : 'healShape', a.q, a.r, actionOrigin);
      return { ...base, unit, from: actionOrigin, cells: aim?.cells || [base.to] };
    }
    return null;
  }).filter(Boolean);
}

function planBadge(x, y, index, color, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.fillStyle = '#0b1420'; ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.stroke();
  ctx.fillStyle = '#e8f0f8'; ctx.font = 'bold 9px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(index), x, y + 0.5);
  ctx.restore();
}

function planArrow(from, to, color, alpha) {
  const a = hexToPixel(from.q, from.r), b = hexToPixel(to.q, to.r);
  if (a.x === b.x && a.y === b.y) return;
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const sx = a.x + Math.cos(angle) * HEX_SIZE * 0.52, sy = a.y + Math.sin(angle) * HEX_SIZE * 0.52;
  const ex = b.x - Math.cos(angle) * HEX_SIZE * 0.58, ey = b.y - Math.sin(angle) * HEX_SIZE * 0.58;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash([7, 5]);
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(ex + Math.cos(angle) * 9, ey + Math.sin(angle) * 9);
  ctx.lineTo(ex + Math.cos(angle + 2.55) * 7, ey + Math.sin(angle + 2.55) * 7);
  ctx.lineTo(ex + Math.cos(angle - 2.55) * 7, ey + Math.sin(angle - 2.55) * 7);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

/** 目标格虚线高亮（画在实体单位之下）。 */
function drawPlanCellHighlights() {
  for (const o of planOverlays()) {
    if (!o.to) continue;
    const color = PLAN_COLORS[o.kind] || '#9aa7b2';
    const alpha = planHoverId && o.id !== planHoverId ? 0.25 : 1;
    for (const cell of o.cells || [o.to]) {
      pathHex(cell.q, cell.r, 4);
      ctx.fillStyle = hexToRgba(color, 0.14 * alpha);
      ctx.fill();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = hexToRgba(color, 0.8 * alpha);
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

/** 箭头 / 幽灵单位 / 编号角标（画在实体单位之上）。 */
function drawPlanActionOverlays() {
  for (const o of planOverlays()) {
    const color = PLAN_COLORS[o.kind] || '#9aa7b2';
    const alpha = planHoverId && o.id !== planHoverId ? 0.25 : 1;
    if (o.from && o.to) planArrow(o.from, o.to, color, alpha * 0.9);
    if ((o.kind === 'move' || o.kind === 'deploy') && o.to) {
      const ghostType = o.kind === 'move' ? o.unit?.type : o.unitType;
      if (ghostType) {
        const p = hexToPixel(o.to.q, o.to.r);
        ctx.save();
        ctx.globalAlpha = alpha * 0.5;
        ctx.fillStyle = OWNER_COLOR[myPlayer] || '#9aa7b2';
        ctx.beginPath(); ctx.arc(p.x, p.y, HEX_SIZE * .42, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = alpha;
        ctx.setLineDash([4, 3]); ctx.strokeStyle = color; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, HEX_SIZE * .42, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        drawUnitGlyph(ghostType, p.x, p.y);
        ctx.restore();
        planBadge(p.x + 13, p.y - 13, o.index, color, alpha);
      }
    } else if (o.to) {
      const p = hexToPixel(o.to.q, o.to.r);
      planBadge(p.x + 13, p.y - 13, o.index, color, alpha);
    }
    if (o.from) {
      const p = hexToPixel(o.from.q, o.from.r);
      planBadge(p.x - 14, p.y - 14, o.index, color, alpha);
    }
  }
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
function cpDeployEnabled(cp) {
  return controlPointEffect(cp)?.canDeploy !== false;
}
function controlPointLabel(cp) {
  return CONTROL_POINT_LABELS[cp?.kind] || 'CP';
}
function controlPointStats(cp) {
  const effect = controlPointEffect(cp);
  const income = effect ? effect.income : gameConfig?.balance?.controlPointIncome ?? 12;
  const deployable = cpDeployEnabled(cp);
  return [
    statItem('类型', cp.kind ? CONTROL_POINT_NAMES[cp.kind] || cp.kind : '普通据点', ''),
    statItem('收入', `+${income}`, 'cost'),
    effect?.deployDiscount ? statItem('部署折扣', `-${effect.deployDiscount}`, 'move') : '',
    effect?.repairAmount ? statItem('维修', `+${effect.repairAmount}`, 'heal') : '',
    statItem('部署', deployable ? (cp.owner ? '可用' : '中立') : '不可部署', deployable && cp.owner ? 'move' : ''),
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
    ${stats ? `<div class="sel-stat-grid">${stats}</div>` : `<div class="sel-note">${deployFromHqEnabled() ? '部署源' : '本图总部不可部署'}</div>`}
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
  drawHoverRangeHints();
  for (const h of rangeHighlights) {
    pathHex(h.q, h.r, 3);
    ctx.fillStyle = h.type === 'move' ? 'rgba(60,200,120,.20)' : h.type === 'move-occupied' ? 'rgba(240,140,60,.26)' : h.type === 'attack' ? 'rgba(255,80,80,.28)' : h.type === 'attack-radius' ? 'rgba(255,80,80,.08)' : h.type === 'deploy' ? 'rgba(240,210,90,.24)' : h.type === 'demolish' ? 'rgba(255,170,70,.28)' : 'rgba(80,220,180,.20)';
    ctx.fill();
  }
  drawPlanCellHighlights();
  if (hoverCell) { pathHex(hoverCell.q, hoverCell.r, 2); ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fill(); }
  for (const cp of state.controlPoints.values()) {
    drawControlPointMarker(cp);
  }
  boardAnimation.forEachHeadquarters((hq, view) => drawHeadquartersMarker(hq, view));
  boardAnimation.forEachUnit((u, view) => drawUnitMarker(u, view));
  drawPlanActionOverlays();
  drawAimPreview();
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
function isSimultaneous() { return gameConfig?.mode === 'simultaneous' || gameConfig?.mode === 'royale'; }
function isAnnihilationRules() { return gameConfig?.mode === 'annihilation' || gameConfig?.mode === 'royale'; }
function deployFromHqEnabled() { return gameConfig?.balance?.deployFromHq !== false; }
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
  if (!state || state.winner || state.result || state.turn?.phase === 'game_over') return false;
  if (playback.isActive()) return false; // 结算回放中暂不可操作。
  if (isSimultaneous()) {
    return state.players?.[myPlayer]?.status === 'active' && !iCommitted();
  }
  return (state.turn?.currentPlayerId || state.turn?.currentOwner) === myPlayer;
}
/** 同时模式：该单位在本轮队列里已排了多少步（用于卡片提示，不限制继续追加）。 */
function plannedStepsForUnit(unitId) {
  return myPlanQueue().filter(a => a.unitId === unitId || a.attackerId === unitId || a.supportId === unitId).length;
}
/** 每单位每轮攻击上限（地图 balance.attacksPerUnit，缺省 1）。 */
function attackLimit() {
  return gameConfig?.balance?.attacksPerUnit ?? 1;
}
function attacksPlannedForUnit(unitId) {
  return myPlanQueue().filter(a => a.type === 'attack' && a.attackerId === unitId).length;
}
function describePlanAction(a) {
  const typeLabel = { deploy: '部署', move: '移动', attack: '攻击', heal: '治疗', demolish: '爆破', wait: '待命' }[a.type] || a.type;
  if (a.type === 'wait') return '待命（本行动点不做任何事）';
  if (a.type === 'heal') return Number.isFinite(a.q) && Number.isFinite(a.r) ? `${typeLabel} → (${a.q}, ${a.r})` : `${typeLabel} 友方单位`;
  if (Number.isFinite(a.q) && Number.isFinite(a.r)) return `${typeLabel} → (${a.q}, ${a.r})`;
  return typeLabel;
}
let planReordering = false;
/** 调整计划顺序：队列顺序就是行动点顺序，重排会改变每条动作的结算步骤。 */
async function reorderPlan(fromIndex, toIndex) {
  if (planReordering) return;
  const queue = myPlanQueue();
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= queue.length || toIndex >= queue.length) return;
  const next = [...queue];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  planReordering = true;
  try {
    // 服务端原子重排：只接受当前队列的排列，失败时原计划保持不变。
    if (!await apiAction(`/api/games/${gameId}/plan/reorder`, { actionIds: next.map(a => a.id) })) return;
    await refreshAdjudication();
    renderSidebar();
    drawBoard();
  } finally {
    planReordering = false;
  }
}
async function clearAllPlans() {
  if (planReordering || !myPlanQueue().length) return;
  if (!await apiAction(`/api/games/${gameId}/plan/clear`, {})) return;
  toast('已清空本回合计划', 'ok');
  await refreshAdjudication();
  renderSidebar();
  drawBoard();
}
function renderPlanPanel() {
  const el = els.planPanel;
  if (!el) return;
  if (!isSimultaneous()) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const queue = myPlanQueue();
  // 撤销/重渲后悬停项可能已不在队列里，残留 id 会把全部预览压暗，需清掉。
  if (planHoverId && !queue.some(a => a.id === planHoverId)) planHoverId = null;
  const max = actionsPerTurn();
  const activeCount = joinedPlayerIds().filter(id => state.players[id]?.status === 'active').length;
  const committedNames = committedList().map(id => playerName(id)).join('、') || '—';
  const rows = queue.map((a, i) => `
    <li class="plan-item plan-kind-${esc(a.type)}" data-plan-id="${esc(a.id)}">
      <em class="plan-num" title="第 ${i + 1} 个行动点">${i + 1}</em>
      <span class="plan-desc">${esc(describePlanAction(a))}</span>
      ${iCommitted() ? '' : `<span class="plan-order"><button type="button" class="plan-order-btn" data-plan-move="${i}:${i - 1}" ${i === 0 ? 'disabled' : ''} title="上移一步" aria-label="上移第 ${i + 1} 条">▲</button><button type="button" class="plan-order-btn" data-plan-move="${i}:${i + 1}" ${i === queue.length - 1 ? 'disabled' : ''} title="下移一步" aria-label="下移第 ${i + 1} 条">▼</button></span><button class="plan-revoke" data-revoke="${esc(a.id)}" title="撤销该指令">撤销</button>`}
    </li>`).join('');
  const clearBtn = (!iCommitted() && queue.length > 0)
    ? `<button type="button" class="plan-clear-all">全部撤销（${queue.length} 条）</button>`
    : '';
  const waitBtn = (!iCommitted() && queue.length < max)
    ? '<button type="button" class="plan-wait">待命（占 1 行动点）</button>'
    : '';
  el.innerHTML = `<h3>本回合计划 <span class="plan-count">${queue.length}/${max}</span></h3>
    <div class="plan-hint">队列顺序 = 行动点顺序：第 N 条与所有玩家的第 N 条同时结算</div>
    <ul class="plan-list">${rows || '<li class="plan-empty">尚未下达指令，点击棋盘单位开始排队</li>'}</ul>
    ${(clearBtn || waitBtn) ? `<div class="plan-tools">${waitBtn}${clearBtn}</div>` : ''}
    <div class="plan-status">${iCommitted() ? '已确认，等待全员提交后统一结算' : `已确认 ${committedList().length}/${activeCount}（${esc(committedNames)}）`}</div>`;
  el.querySelectorAll('.plan-revoke').forEach(btn => btn.addEventListener('click', async () => {
    if (await apiAction(`/api/games/${gameId}/plan/revoke`, { actionId: btn.dataset.revoke })) {
      await refreshAdjudication();
      renderSidebar();
      drawBoard();
    }
  }));
  el.querySelectorAll('.plan-order-btn').forEach(btn => btn.addEventListener('click', () => {
    const [from, to] = String(btn.dataset.planMove || '').split(':').map(Number);
    reorderPlan(from, to);
  }));
  el.querySelector('.plan-clear-all')?.addEventListener('click', clearAllPlans);
  el.querySelector('.plan-wait')?.addEventListener('click', async () => {
    if (await apiAction(`/api/games/${gameId}/plan/wait`, {})) {
      toast('已排入待命（占 1 行动点）', 'ok');
      await refreshAdjudication();
      renderSidebar();
      drawBoard();
    }
  });
  // 悬停清单项时棋盘上对应预览加亮、其余压暗。
  el.querySelectorAll('.plan-item[data-plan-id]').forEach(item => {
    item.addEventListener('mouseenter', () => { if (planHoverId !== item.dataset.planId) { planHoverId = item.dataset.planId; drawBoard(); } });
    item.addEventListener('mouseleave', () => { if (planHoverId) { planHoverId = null; drawBoard(); } });
  });
}
function renderActionsDisplay(owner) {
  const max = actionsPerTurn();
  if (!max || !els.actionsDisplay) { if (els.actionsDisplay) els.actionsDisplay.innerHTML = ''; return; }
  if (isSimultaneous()) {
    const used = myPlanQueue().length;
    const remaining = Math.max(0, max - used);
    const exhausted = remaining === 0;
    els.actionsDisplay.classList.toggle('exhausted', exhausted);
    els.actionsDisplay.classList.toggle('mine', true);
    els.actionsDisplay.innerHTML = `<span class="actions-label">行动点</span><span class="actions-count ${exhausted ? 'zero' : ''}">${remaining}/${max}</span>${exhausted ? '<span class="actions-hint">计划已满，可撤销后重新排队</span>' : ''}`;
    return;
  }
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
  const preserved = state.players?.[owner]?.status === 'eliminated'
    ? state.players[owner].adjudicationScore
    : null;
  if (preserved) return { ...preserved };
  const ownHq = [...state.headquarters.values()].find(h => h.owner === owner);
  if (!ownHq && !isAnnihilationRules()) return null;
  const headquartersDamage = state.players?.[owner]?.stats?.headquartersDamage ?? [...state.headquarters.values()]
    .filter(h => h.owner !== owner)
    .reduce((sum, hq) => sum + Math.max(0, (hq.maxHp || 0) - (hq.hp || 0)), 0);
  const ownHqHp = ownHq ? Math.max(0, ownHq.hp || 0) : 0;
  const controlPoints = [...state.controlPoints.values()].filter(p => p.owner === owner).length;
  const armyValue = [...state.units.values()]
    .filter(u => u.owner === owner && u.alive)
    .reduce((sum, unit) => sum + Math.round((unit.cost || 0) * ((unit.hp || 0) / (unit.maxHp || 1))), 0);
  const supplies = state.resources?.[owner]?.supplies || 0;
  const killValue = state.players?.[owner]?.stats?.killValue ?? 0;
  const flowRatio = Number(weights.controlPointFlowRatio ?? 0.7);
  const holdRounds = Math.max(1, state.players?.[owner]?.stats?.controlHoldRounds ?? 0);
  const controlHold = Math.round(((state.players?.[owner]?.stats?.controlHold ?? 0) / holdRounds) * 100) / 100;
  const controlScore = weights.controlPoint * (flowRatio * controlHold + (1 - flowRatio) * controlPoints);
  return {
    headquartersDamage,
    enemyHqDamage: headquartersDamage,
    ownHqHp,
    controlPoints,
    controlHold,
    armyValue,
    supplies,
    killValue,
    total:
      headquartersDamage * weights.enemyHqDamage +
      ownHqHp * weights.ownHqHp +
      controlScore +
      armyValue * weights.armyValue +
      supplies * weights.supplies +
      killValue * (Number(weights.killValue) || 0),
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

const SCORE_TERM_DEFS = [
  ['敌方总部伤害', 'enemyHqDamage', score => score.headquartersDamage ?? score.enemyHqDamage ?? 0],
  ['己方总部血量', 'ownHqHp', score => score.ownHqHp ?? 0],
  ['存活兵力', 'armyValue', score => score.armyValue ?? 0],
  ['囤积补给', 'supplies', score => score.supplies ?? 0],
];

function adjudicationWeights() {
  return state?.adjudication?.weights ?? gameConfig?.balance?.adjudicationWeights ?? null;
}

function formatScore(value) {
  const n = Math.round((Number(value) || 0) * 10) / 10;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** 逐分项：原始数值 × 地图权重 = 该项得分；权重为 0 的项不参与裁决，直接省略。 */
function scoreTerms(score) {
  const weights = adjudicationWeights();
  if (!weights) return [];
  const terms = SCORE_TERM_DEFS.map(([label, weightKey, read]) => {
    const weight = Number(weights[weightKey]) || 0;
    const value = read(score);
    return { label, value, weight, part: value * weight };
  });
  const cpWeight = Number(weights.controlPoint) || 0;
  // 旧回放（3.6.0 前的分数快照含 actionScore）：据点按全额权重、附加"有效行动"项展示。
  if (score.actionScore !== undefined && score.killValue === undefined) {
    terms.splice(2, 0, {
      label: '占领据点', value: score.controlPoints ?? 0, weight: cpWeight,
      part: (score.controlPoints ?? 0) * cpWeight,
    });
    const perAction = weights.effectiveActions ?? weights.actionPoints ?? (isAnnihilationRules() ? 10 : 2);
    const actionScore = score.actionScore ?? 0;
    terms.push({ label: '有效行动', value: perAction > 0 ? actionScore / perAction : actionScore, weight: perAction, part: actionScore });
    return terms.filter(term => term.weight > 0);
  }
  const flowRatio = Number(weights.controlPointFlowRatio ?? 0.7);
  terms.splice(2, 0,
    {
      label: '据点持有(均值)', value: score.controlHold ?? 0, weight: cpWeight * flowRatio,
      part: (score.controlHold ?? 0) * cpWeight * flowRatio,
    },
    {
      label: '期末据点', value: score.controlPoints ?? 0, weight: cpWeight * (1 - flowRatio),
      part: (score.controlPoints ?? 0) * cpWeight * (1 - flowRatio),
    },
  );
  const killWeight = Number(weights.killValue) || 0;
  terms.push({
    label: '击杀价值', value: score.killValue ?? 0, weight: killWeight,
    part: (score.killValue ?? 0) * killWeight,
  });
  return terms.filter(term => term.weight > 0);
}

/** 权重条底色：按玩家色淡染，与卡片左边框同源。 */
function scoreTint(owner) {
  const hex = String(OWNER_COLOR[owner] || '#7f98a9').replace('#', '');
  if (hex.length !== 6) return 'rgba(127,152,169,.16)';
  const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r},${g},${b},.16)`;
}

function scoreBreakdown(score) {
  const terms = scoreTerms(score);
  if (!terms.length) return '';
  const total = Math.max(Number(score.total) || 0, terms.reduce((sum, term) => sum + Math.max(term.part, 0), 0));
  return `<div class="score-breakdown">${terms.map(term => {
    const share = total > 0 ? Math.min(100, Math.max(0, Math.round((Math.max(term.part, 0) / total) * 100))) : 0;
    const formula = `${term.label}：${formatScore(term.value)} × ${formatScore(term.weight)} = ${formatScore(term.part)}`;
    return `<div class="score-term${term.part > 0 ? '' : ' is-zero'}" style="--share:${share}%" title="${esc(formula)}">
      <span class="score-term-label">${esc(term.label)}</span>
      <span class="score-term-math"><span class="st-value">${formatScore(term.value)}</span><span class="st-weight">×${formatScore(term.weight)}</span><span class="st-eq">=</span><span class="st-part">${formatScore(term.part)}</span></span>
    </div>`;
  }).join('')}</div>`;
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
  const open = isScoreRowOpen(owner, owner === myPlayer);
  const chip = `<button class="score-toggle${open ? ' open' : ''}" type="button" aria-expanded="${open}" title="${open ? '收起裁决分算式' : '展开裁决分算式'}">公式<i>${open ? '▴' : '▾'}</i></button>`;
  return `<div class="score-row ${cls}${mine}${open ? ' expanded' : ''}" data-score-owner="${esc(owner)}" data-score-open="${open}" style="--tint:${scoreTint(owner)}">
    <div class="score-row-head"><span><em class="score-rank">#${rank}</em>${esc(playerName(owner))}${owner === myPlayer ? '（你）' : ''}${status}${chip}</span><strong>${formatScore(score.total)}</strong></div>
    ${open ? scoreBreakdown(score) : ''}
  </div>`;
}

/** 折叠态每人只占一行；默认展开我方席位，整卡可点，手动开合后按玩家记住（重渲染不丢）。 */
const scoreRowOpen = new Map();
let scoreToggleBound = false;

function isScoreRowOpen(owner, byDefault) {
  return scoreRowOpen.has(owner) ? scoreRowOpen.get(owner) : byDefault;
}

function bindScoreToggles() {
  if (scoreToggleBound) return;
  scoreToggleBound = true;
  document.addEventListener('click', event => {
    const row = event.target?.closest?.('[data-score-owner]');
    if (!row || !state) return;
    // 「公式」按钮是键盘可达的入口；卡内其它控件（改名按钮等）仍走各自逻辑。
    if (!event.target.closest('.score-toggle') && event.target.closest('button, a, input, select, textarea')) return;
    scoreRowOpen.set(row.dataset.scoreOwner, row.dataset.scoreOpen !== 'true');
    renderScorePanel();
  });
}

function renderScorePanel() {
  const scorePanelEl = els.scorePanel;
  if (!scorePanelEl) return;
  bindScoreToggles();
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

// 镜像引擎 collectIncome：回合开始补给 = 基础收入 + 名下据点收入之和，非活跃玩家不发放。
// 追赶补给在回合末按当时的分数快照发放，无法预判，不计入。
function nextTurnIncomeFor(owner) {
  if (state?.players?.[owner]?.status !== 'active') return null;
  const balance = gameConfig?.balance || {};
  const fallback = balance.controlPointIncome ?? 0;
  const control = [...(state.controlPoints?.values() ?? [])]
    .filter(point => point.owner === owner)
    .reduce((sum, point) => {
      const spec = point.kind ? balance.controlPointTypes?.[point.kind] : null;
      return sum + (spec ? spec.income ?? fallback : fallback);
    }, 0);
  return (balance.baseIncome ?? 0) + control;
}

function renderActionHint() {
  const value = actionsPerTurn() || '—';
  document.querySelectorAll('#action-hints [data-hint-ap]').forEach(el => { el.textContent = String(value); });
}
function renderSidebar() {
  if (!state) return;
  renderActionHint();
  const simultaneous = isSimultaneous();
  const replaying = playback.isActive();
  const owner = simultaneous ? null : (state.turn.currentPlayerId || state.turn.currentOwner);
  const commitStatus = committedStatusHtml();
  els.turnBadge.innerHTML = `<strong class="turn-count">${esc(turnProgressLabel())}</strong><span class="turn-player">${simultaneous ? (replaying ? '结算回放中…' : (iCommitted() ? '已确认 · 等待全员提交' : '同时计划阶段')) : esc(playerName(owner))}</span>${commitStatus}`;
  els.turnBadge.classList.toggle('my-turn', simultaneous ? (!iCommitted() && !state.winner && !replaying) : owner === myPlayer);
  const resourceRows = joinedPlayerIds().map(id => {
    const color = OWNER_COLOR[id] || '#9aa7b2';
    const supplies = state.resources?.[id]?.supplies ?? 0;
    const planFlag = simultaneous && committedList().includes(id) ? '<em class="res-committed" title="已确认本回合计划">✓</em>' : '';
    const nextIncome = nextTurnIncomeFor(id);
    const nextIncomeHtml = nextIncome == null
      ? ''
      : `<em class="resource-next" title="下回合补给收入" aria-label="下回合补给收入 +${nextIncome}">+${nextIncome}</em>`;
    // 大数字按位数缩字号，数字行永不换行溢出。
    const digitCount = String(supplies).length;
    const lenClass = digitCount > 6 ? ` len-${Math.min(digitCount, 9)}` : '';
    return `<div class="resource-pill ${playerClass(id)} ${myPlayer === id ? 'mine' : ''}${lenClass}" style="border-left-color:${esc(color)}">
      <div class="resource-head"><span>${esc(playerName(id))}${planFlag}</span>${nextIncomeHtml}</div><strong>${supplies}</strong>
    </div>`;
  }).join('');
  const statusCard = simultaneous
    ? `<div class="status-card active-turn ${iCommitted() ? '' : 'mine'}">
        <span>${iCommitted() ? '已确认 · 等待其他玩家' : '计划阶段 · 全员同时下令'}</span>
        <strong>${committedList().length}/${joinedPlayerIds().filter(id => state.players[id]?.status === 'active').length || 0} 已确认</strong>
      </div>`
    : `<div class="status-card active-turn ${owner === myPlayer ? 'mine' : ''}">
        <span>${owner === myPlayer ? '你的回合' : '等待对手'}</span>
        <strong>${esc(playerName(owner))}</strong>
      </div>`;
  els.resDisplay.innerHTML = `<div class="status-grid">
    ${statusCard}
    ${resourceRows}
  </div>`;
  // 无玩家 token 的观战房主没有操作权，结束回合只会得到 401。
  const endTurnUnavailable = !myToken || Boolean(state?.result) || state?.turn?.phase === 'game_over';
  const endTurnCommitted = simultaneous && iCommitted();
  els.btnEndTurn.classList.toggle('hidden', endTurnUnavailable);
  els.btnEndTurn.disabled = endTurnCommitted;
  els.btnEndTurn.textContent = simultaneous ? (endTurnCommitted ? '等待结算…' : '确认行动') : '结束回合';
  renderActionsDisplay(owner);
  renderScorePanel();
  renderPlanPanel();
  els.events.innerHTML = '';
  // 最新事件置顶（slice 已产出新数组，reverse 不会改动 state.eventLog）
  for (const ev of state.eventLog.slice(-60).reverse()) {
    const li = document.createElement('li'); li.className = `type-${ev.type}`;
    li.innerHTML = `<span class="ev-seq">#${ev.seq}</span><span class="ev-type">${esc(ev.type)}</span>${esc(formatEventShort(ev))}`;
    els.events.appendChild(li);
  }
  els.events.scrollTop = 0;
  renderSelectionInfo();
}

function formatEventShort(ev) {
  const p = ev.payload || {};
  switch (ev.type) {
    case 'game_start': return '对局开始';
    case 'deploy': return `${playerName(p.owner)} 部署 ${UNIT_NAMES[p.unitType] || p.unitType}`;
    case 'move': return `移动到 (${p.toQ}, ${p.toR})`;
    case 'attack': return p.hit === false ? `开火落空 (${p.q}, ${p.r})` : `攻击造成 ${p.damage} 伤害`;
    case 'heal': return `治疗 +${p.amount}`;
    case 'unit_death': return `${UNIT_NAMES[p.unitType || p.type] || '单位'} 阵亡`;
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
    case 'wait': return `${playerName(p.owner)} 第 ${p.actionsUsed} 个行动点待命`;
    case 'round_start': return `第 ${p.roundNumber} 回合计划阶段开始`;
    case 'round_resolved': return `第 ${p.roundNumber} 回合同时结算完毕`;
    case 'action_failed': {
      const typeLabel = { deploy: '部署', move: '移动', attack: '攻击', heal: '治疗', demolish: '爆破', wait: '待命' }[p.type] || '动作';
      const reasonLabel = { destination_conflict: '目标格撞车，全部失败', destination_blocked: '目标地形不可用', destination_occupied: '目标格仍被占用', previous_action_failed: '前一步失败，后续作废', artillery_zone: '炮火区内无法治疗', insufficient_supplies: '补给不足', unit_gone: '单位已不存在', unknown_unit: '兵种不存在', out_of_range: '超出射程，落空', already_healthy: '目标无需治疗', invalid_target: '目标无效', target_gone: '目标已消失' }[p.reason] || p.reason || '失败';
      const unitLabel = p.unitType ? `${UNIT_NAMES[p.unitType] || p.unitType}` : '';
      const from = p.detail && typeof p.detail.fromQ === 'number'
        ? `(${p.detail.fromQ},${p.detail.fromR})` : '';
      const target = typeof p.q === 'number' && typeof p.r === 'number'
        ? `(${p.q},${p.r})` : '';
      const move = from && target ? ` ${from}→${target}` : target ? ` @${target}` : '';
      const subject = unitLabel ? `${unitLabel}${move} ` : '';
      return `${playerName(p.owner)} ${subject}${typeLabel}未执行：${reasonLabel}`;
    }
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
  clampPopupInBoard(popup, p.x);
  popup.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => cb(btn.dataset.action, btn.dataset.type)));
}
// 锚点靠棋盘边缘时把弹出菜单收拢回 .board-wrap 可视区（右侧放不下翻到锚点左侧），避免撑出滚动条被裁切
function clampPopupInBoard(popup, anchorX) {
  const wrap = els.canvas.parentElement;
  if (!wrap) return;
  const w = popup.offsetWidth, h = popup.offsetHeight;
  const minX = wrap.scrollLeft + 6, minY = wrap.scrollTop + 6;
  const maxX = Math.max(minX, wrap.scrollLeft + wrap.clientWidth - w - 6);
  const maxY = Math.max(minY, wrap.scrollTop + wrap.clientHeight - h - 6);
  let left = parseFloat(popup.style.left) || 0;
  if (left > maxX) left = anchorX - 18 - w;
  popup.style.left = `${Math.min(Math.max(left, minX), maxX)}px`;
  popup.style.top = `${Math.min(Math.max(parseFloat(popup.style.top) || 0, minY), maxY)}px`;
}
function closePopup() { $('map-popup').classList.add('hidden'); }
function deselect() { selectedUnitId = null; selectedOriginId = null; selectedDeployType = null; interactionMode = 'idle'; rangeHighlights = []; closePopup(); renderSidebar(); drawBoard(); }

async function apiAction(path, body) {
  const { ok, data } = await API.post(path, body);
  if (!ok) {
    toast(`${data.error || '操作失败'} (${data.code || ''})`, 'err');
    // 503 persistence_degraded：动作已在内存生效，只是没落盘。不能当普通失败，
    // 否则本地队列/棋盘会停在旧状态，用户重试还会撞上 invalid_move。
    if (data?.applied === true) {
      if (isSimultaneous()) await refreshAdjudication();
      else await loadFullState();
      return false;
    }
  }
  // 同时模式：入队/撤回/清空都会在响应里回传最新队列，直接落到本地状态，
  // 不再等下一次 GET（条件请求可能命中 304，旧队列会让计划面板与棋盘预览滞后）。
  if (ok && Array.isArray(data?.queue) && state) {
    if (!state.plan) state.plan = { committed: [], myQueue: [] };
    state.plan.myQueue = [...data.queue];
  }
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
  const budgetLeft = myPlanQueue().length < actionsPerTurn();
  const plannedSteps = isSimultaneous() ? plannedStepsForUnit(unit.id) : 0;
  const attacksUsed = isSimultaneous() ? attacksPlannedForUnit(unit.id) : 0;
  const canAttack = !isSimultaneous() || attacksUsed < attackLimit();
  const items = [];
  if (budgetLeft && !unit.hasMoved) items.push({ label: '移动', action: 'move' });
  if (budgetLeft && !unit.hasActed && canAttack) items.push({ label: unit.type === 'support' ? '治疗' : '攻击', action: unit.type === 'support' ? 'heal' : 'attack' });
  if (budgetLeft && unit.type === 'heavy' && !unit.hasActed && demolishableCells(unit).length > 0) items.push({ label: '爆破', action: 'demolish' });
  if (!items.length && isSimultaneous() && attacksUsed >= attackLimit()) {
    toast(`该单位本轮攻击已达上限（${attackLimit()} 次）`, 'err');
  }
  if (items.length) showPopup(unit, plannedSteps > 0
    ? `单位操作（已排 ${plannedSteps} 步，攻击 ${attacksUsed}/${attackLimit()}）`
    : '单位操作', items, action => {
    closePopup();
    if (action === 'move') {
      interactionMode = 'move_mode';
      // 同时模式：当前被占的格子也可点击——本步其他单位可能先腾空；结算时再判。
      rangeHighlights = reachable(unit).map(p => ({ ...p, type: isSimultaneous() && occupied(p.q, p.r) ? 'move-occupied' : 'move' }));
    }
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
        // 同时模式：计划期只校验形状/射程，覆盖格内是否有友军留到结算判定。
        rangeHighlights = aimableCells(unit, 'healShape').map(p => ({ ...p, type: 'heal' }));
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

els.canvas.addEventListener('mousemove', e => {
  if (!state || state.cells.length === 0) return;
  const p = eventToCanvasPoint(e);
  const h = pixelToHex(p.x, p.y);
  hoverCell = cellAt(h.q, h.r) ? h : null;
  if (!hoverCell) els.cellInfo.textContent = '';
  else {
    const ent = entityAt(hoverCell.q, hoverCell.r);
    const cp = [...state.controlPoints.values()].find(p => p.q === hoverCell.q && p.r === hoverCell.r);
    const planned = planOverlays().find(o => (o.cells || (o.to ? [o.to] : [])).some(c => c.q === hoverCell.q && c.r === hoverCell.r));
    els.cellInfo.textContent = `(${hoverCell.q}, ${hoverCell.r})${cp ? ` | ${cp.name}` : ''}${ent ? ` | ${UNIT_NAMES[ent.type] || 'HQ'} ${ent.hp}/${ent.maxHp}` : ''}${planned ? ` | 计划#${planned.index} ${PLAN_KIND_LABELS[planned.kind] || planned.kind}` : ''}${aimPreviewInfo()}`;
  }
  drawBoard();
});
els.canvas.addEventListener('mouseleave', () => { hoverCell = null; els.cellInfo.textContent = ''; drawBoard(); });
els.canvas.addEventListener('contextmenu', e => { e.preventDefault(); deselect(); });
els.canvas.addEventListener('click', async () => {
  if (!hoverCell || !state) return;
  if (playback.isActive()) return; // 回放期间棋盘点击不响应（用「跳过结算」快进）。
  const unit = [...state.units.values()].find(u => u.alive && u.q === hoverCell.q && u.r === hoverCell.r);
  const hq = [...state.headquarters.values()].find(h => h.alive && h.q === hoverCell.q && h.r === hoverCell.r);
  const cp = [...state.controlPoints.values()].find(p => p.q === hoverCell.q && p.r === hoverCell.r);

  if (interactionMode === 'move_mode' && rangeHighlights.some(h => h.q === hoverCell.q && h.r === hoverCell.r)) {
    if (await apiAction(`/api/games/${gameId}/move`, { unitId: selectedUnitId, q: hoverCell.q, r: hoverCell.r })) afterAction(isSimultaneous() ? '移动指令已入队' : '移动成功');
    return;
  }
  if (interactionMode === 'attack_mode') {
    const hit = rangeHighlights.find(h => h.q === hoverCell.q && h.r === hoverCell.r);
    const enemyClick = hit?.type === 'attack';
    // 同时模式下射程内任意格都可开火（预测性射击）；顺序模式仍只能点敌方实体格。
    if (enemyClick || (isSimultaneous() && hit?.type === 'attack-radius')) {
      if (isSimultaneous()) {
        if (await apiAction(`/api/games/${gameId}/attack`, { attackerId: selectedUnitId, q: hoverCell.q, r: hoverCell.r })) afterAction('开火指令已入队');
      } else {
        const target = entityAt(hoverCell.q, hoverCell.r);
        if (target && target.owner !== myPlayer && target.alive && await apiAction(`/api/games/${gameId}/attack`, { attackerId: selectedUnitId, targetId: target.id })) afterAction('攻击成功');
      }
      return;
    }
  }
  if (interactionMode === 'heal_mode' && rangeHighlights.some(h => h.q === hoverCell.q && h.r === hoverCell.r)) {
    if (isSimultaneous()) {
      if (await apiAction(`/api/games/${gameId}/heal`, { supportId: selectedUnitId, q: hoverCell.q, r: hoverCell.r })) afterAction('治疗指令已入队');
    } else if (unit && await apiAction(`/api/games/${gameId}/heal`, { supportId: selectedUnitId, targetId: unit.id })) {
      afterAction('治疗成功');
    }
    return;
  }
  if (interactionMode === 'demolish_mode' && rangeHighlights.some(h => h.q === hoverCell.q && h.r === hoverCell.r)) {
    if (await apiAction(`/api/games/${gameId}/demolish`, { unitId: selectedUnitId, q: hoverCell.q, r: hoverCell.r })) afterAction(isSimultaneous() ? '爆破指令已入队' : '爆破成功');
    return;
  }
  if (interactionMode === 'deploy_mode' && rangeHighlights.some(h => h.q === hoverCell.q && h.r === hoverCell.r)) {
    if (await apiAction(`/api/games/${gameId}/deploy`, { unitType: selectedDeployType, fromId: selectedOriginId, q: hoverCell.q, r: hoverCell.r })) afterAction(isSimultaneous() ? '部署指令已入队' : '部署成功');
    return;
  }

  closePopup(); rangeHighlights = [];
  if (unit) selectUnit(unit);
  else if (hq && hq.owner === myPlayer && deployFromHqEnabled()) selectDeployOrigin(hq);
  else if (cp && cp.owner === myPlayer && cpDeployEnabled(cp)) selectDeployOrigin(cp);
  else { selectedUnitId = null; selectedOriginId = null; renderSelectionInfo(hq || cp); drawBoard(); }
});

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

/** 房间阶段文案：大厅卡只区分等待 / 进行中 / 已结束三种。 */
function lobbyPhaseLabel(lobby) {
  if (lobby?.phase === 'active') return '已开始';
  if (lobby?.phase === 'game_over') return '已结束';
  return '等待开局';
}

/** 已结束房间的胜者名（拿不到席位时退回玩家 id）。 */
function lobbyWinnerName(lobby) {
  if (!lobby?.winner) return '';
  const winner = (lobby.players || []).find(player => player.id === lobby.winner);
  return winner?.name || String(lobby.winner);
}

/** 已结束房间的结局行；未结束不渲染，等待中的房间保持原样。 */
function lobbyResultMarkup(lobby) {
  if (lobby?.phase !== 'game_over') return '';
  const winner = lobbyWinnerName(lobby);
  const result = winner ? `胜者：${winner}` : '本局无胜者';
  const round = Number.isFinite(lobby.roundNumber) ? ` · 第 ${lobby.roundNumber} 回合结束` : '';
  return `<div class="lobby-summary-result">${esc(result + round)}</div>`;
}

/**
 * 乐观视图：有未确认意图就按它，否则按服务端摘要。列表与地图共用同一份视图。
 * 座位与席位是两件事——座位号只决定出生点与处理顺序，席位 id 仍按加入顺序。
 */
function seatViewOf(lobby) {
  const seats = Array.isArray(lobby?.seats) ? lobby.seats : [];
  // 行是「成员视图」：`id` 与 `players[].id` 同名，便于直接当成员用（改名 / 踢出 / 上色）。
  const live = seats.map(seat => ({ id: seat.playerId, name: seat.name || seat.playerId }));
  if (!seatDraft) return live;
  // 成员数变化时合并而不是丢弃意图：在场者保留本地相对顺序，离开者剔除，新加入者追加末尾。
  const liveIds = new Set(live.map(row => row.id));
  const kept = seatDraft.filter(row => liveIds.has(row.id));
  const keptIds = new Set(kept.map(row => row.id));
  return kept.concat(live.filter(row => !keptIds.has(row.id)));
}

/** 把本地意图投影到最新成员名单（409 rebase 用；与 seatViewOf 同一套合并规则）。 */
function rebaseSeatOrder(order, lobby) {
  const live = (Array.isArray(lobby?.seats) ? lobby.seats : []).map(seat => seat.playerId);
  const liveIds = new Set(live);
  const kept = order.filter(id => liveIds.has(id));
  const keptIds = new Set(kept);
  return kept.concat(live.filter(id => !keptIds.has(id)));
}

/** 先手座号夹到合法范围（0 起）；同时回合 / 大逃杀恒 0。 */
function clampFirstSeat(value, length, simultaneous) {
  if (simultaneous || !Number.isInteger(value) || value < 0) return 0;
  return value >= length ? Math.max(0, length - 1) : value;
}

/** 开始一次本地改动：把当前视图固化成乐观草稿（首次改动时才建）。 */
function beginSeatEdit(lobby) {
  if (!seatDraft) {
    const rows = seatViewOf(lobby);
    // 名字按 playerId 从 lobby.players 现取，避免别人改名后草稿态残留旧名。
    const liveNames = lobbyPlayerNames(lobby);
    const seatNames = new Map((Array.isArray(lobby?.seats) ? lobby.seats : [])
      .map(seat => [seat.playerId, seat.name || seat.playerId]));
    seatDraft = rows.map(row => ({
      id: row.id,
      name: liveNames.get(row.id) || seatNames.get(row.id) || row.name || row.id,
    }));
    const simultaneous = isSimultaneousLobby(lobby);
    seatDraftFirst = clampFirstSeat(
      Number.isInteger(lobby?.firstSeat) ? lobby.firstSeat : 0,
      Math.max(1, rows.length),
      simultaneous,
    );
  }
  return seatDraft;
}

/** 与服务端对齐：清掉未确认意图，视图回到服务端值，基线跟随最新 seatVersion。 */
function adoptServerLobby(lobby) {
  seatDraft = null;
  seatDraftFirst = 0;
  if (lobby && Number.isInteger(lobby.seatVersion)) seatSync.baseVersion = lobby.seatVersion;
  if (lobby) seatSync.lastGoodLobby = lobby;
}

/** 当前视图 → PUT 意图（只含 order / firstSeat；layoutSlots 只读、不进 payload）。 */
function seatIntentOf(lobby) {
  const rows = seatViewOf(lobby);
  return {
    order: rows.map(row => row.id),
    firstSeat: clampFirstSeat(seatDraftFirst, rows.length, isSimultaneousLobby(lobby)),
  };
}

/** 无未确认意图时（轮询 / 成员进出 / 别人保存）把基线与视图跟服务端对齐。 */
function syncSeatBase(lobby) {
  if (!lobby) return;
  if (seatSync.inFlight || seatSync.desired) return; // 有意图在飞：乐观视图优先
  adoptServerLobby(lobby);
}

/** 状态点 / 读屏文案：同步态只做「轻量提示」，不出现任何可见文字标签。 */
function seatSyncLabel() {
  if (seatSync.state === 'error') return '同步失败，点此重试';
  if (seatSync.state === 'pending') return '正在同步';
  return '座位已同步';
}

function seatSyncText() {
  if (seatSync.state === 'error') return '座位同步失败';
  if (seatSync.state === 'pending') return '座位同步中';
  return '座位已同步';
}

/**
 * 点击后推一次意图：乐观视图已经改好，这里只登记 desired/seq 并安排 flush。
 * 空闲 → 180ms 后发；飞行中 → 什么都不发（回调里会补发最新意图）。
 */
function pushIntent(lobby) {
  if (!hostToken || seatSync.stopped) return;
  // 座位同步只在大厅期有意义：对局已经开始就别再发请求了。
  if (lobby?.phase !== 'lobby') return;
  // 新的改动意味着「恢复随机」的撤销入口已经过时，先摘掉它。
  dismissSeatUndo();
  seatSync.desired = seatIntentOf(lobby);
  seatSync.seq += 1;
  seatSync.state = 'pending';
  scheduleSeatFlush();
}

/** 安排一次 flush：飞行中什么都不排（回调补发），否则 180ms 合并窗口后发。 */
function scheduleSeatFlush() {
  if (seatSync.inFlight) return;
  clearTimeout(seatSync.timer);
  seatSync.timer = setTimeout(() => { seatSync.timer = null; flushSeatSync(); }, SEAT_SYNC_DELAY);
}

/** 失败后点状态点重提：把失败的意图**按当前名单合并**后放回乐观视图，立即再发一次。 */
function retrySeatSync() {
  const lobby = latestLobby;
  const intent = seatSync.retryIntent;
  if (!lobby || seatSync.stopped || !intent) return;
  // 失败期间名单可能变过（有人离开/加入）：和撤销一样走 rebase + seatIntentOf 的合并口径，
  // 不能拿裸快照直接重发。
  const order = rebaseSeatOrder(intent.order, lobby);
  const names = lobbyPlayerNames(lobby);
  seatDraft = order.map(id => ({ id, name: names.get(id) || id }));
  seatDraftFirst = clampFirstSeat(intent.firstSeat, order.length, isSimultaneousLobby(lobby));
  seatSync.retryIntent = null;
  seatSync.failMessage = null;
  pushIntent(lobby);
  renderLobbySummary(lobby, els.lobbySummary, true);
  flushSeatSync();
}

function seatSleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** 发一次 PUT，吃掉各类失败：返回 { kind, data }，不抛。 */
async function putSeatIntent(desired) {
  const payload = { order: [...desired.order], firstSeat: desired.firstSeat };
  if (Number.isInteger(seatSync.baseVersion)) payload.ifVersion = seatSync.baseVersion;
  let attempt = 0;
  let rebased = false;
  for (;;) {
    let res = null;
    try {
      res = await fetch(`/api/games/${encodeURIComponent(gameId)}/host/seats`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Host-Token': hostToken },
        body: JSON.stringify(payload),
      });
    } catch {
      res = null; // 网络失败按同一 payload 退避重试
    }
    const data = res ? await res.json().catch(() => ({})) : {};
    if (res && res.ok) return { kind: 'ok', data };
    if (data.code === 'game_already_started') return { kind: 'started', data };
    if (res && res.status === 409 && data.code === 'seat_conflict' && !rebased) {
      // rebase 一次：把本地意图投影到最新名单，基线换成响应里的 seatVersion，立刻重发。
      rebased = true;
      const latest = data.lobby || seatSync.lastGoodLobby;
      if (Number.isInteger(data.seatVersion)) seatSync.baseVersion = data.seatVersion;
      if (latest) {
        seatSync.lastGoodLobby = latest;
        desired.order = rebaseSeatOrder(desired.order, latest);
        desired.firstSeat = clampFirstSeat(desired.firstSeat, desired.order.length, isSimultaneousLobby(latest));
        payload.order = [...desired.order];
        payload.firstSeat = desired.firstSeat;
        payload.ifVersion = seatSync.baseVersion;
      }
      continue;
    }
    if (res && res.status === 400) return { kind: 'invalid', data };
    if (res && res.status === 409) return { kind: 'conflict', data };
    if (attempt < SEAT_SYNC_RETRY_DELAYS.length) {
      await seatSleep(SEAT_SYNC_RETRY_DELAYS[attempt]);
      attempt += 1;
      continue;
    }
    return { kind: 'failed', data };
  }
}

/** flush：单飞执行一次意图；回来后再判断是否还有更新的意图要补发。 */
async function flushSeatSync() {
  if (seatSync.inFlight || seatSync.stopped) return;
  // 只在大厅期发请求：进入对局后残留的意图一律作废（服务端也会 409）。
  if (latestLobby?.phase !== 'lobby') return;
  const desired = seatSync.desired;
  if (!desired) return;
  const seq = seatSync.seq;
  seatSync.inFlight = true;
  let outcome;
  try {
    outcome = await putSeatIntent(desired);
  } finally {
    seatSync.inFlight = false;
  }
  handleSeatOutcome(outcome, seq);
}

/** 结果处理：成功收敛 / rebase 后补发 / 各类失败回滚。 */
function handleSeatOutcome(outcome, seq) {
  const lobby = latestLobby;
  if (outcome.kind === 'ok') {
    if (Number.isInteger(outcome.data.seatVersion)) seatSync.baseVersion = outcome.data.seatVersion;
    const server = outcome.data.lobby || seatSync.lastGoodLobby || lobby;
    if (outcome.data.lobby) seatSync.lastGoodLobby = outcome.data.lobby;
    if (seatSync.seq !== seq && seatSync.desired) {
      // 期间又点了：把服务端基线吸收进来，但保留更新的本地意图。
      if (Number.isInteger(outcome.data.seatVersion)) seatSync.baseVersion = outcome.data.seatVersion;
      seatSync.state = 'pending';
      seatSync.retries = 0;
      if (server) renderLobbySummary(server, els.lobbySummary, true);
      flushSeatSync();
      return;
    }
    seatSync.desired = null;
    seatSync.state = 'idle';
    seatSync.retries = 0;
    if (server) {
      adoptServerLobby(server);
      // 响应顶层的 seatVersion 才是最新基线（lobby 摘要里的可能旧一拍）。
      if (Number.isInteger(outcome.data.seatVersion)) seatSync.baseVersion = outcome.data.seatVersion;
      renderLobbySummary(server, els.lobbySummary, true);
    }
    return;
  }
  if (outcome.kind === 'started') {
    stopSeatSync('对局已开始，座位已锁定');
    return;
  }
  if (outcome.kind === 'invalid') {
    rollbackSeatSync('座位没同步成功：名单已变化，已刷新', outcome.data.lobby);
    return;
  }
  if (outcome.kind === 'conflict') {
    rollbackSeatSync('座位已被其他人改动，已同步最新', outcome.data.lobby);
    return;
  }
  rollbackSeatSync(seatSync.failMessage || '座位同步失败，已回到服务器上的座位', null);
}

/** 回滚：视图换成服务端真值 + 红边 220ms + toast；失败的意图留着重提。 */
function rollbackSeatSync(message, lobby) {
  if (seatSync.desired) {
    seatSync.retryIntent = { order: [...seatSync.desired.order], firstSeat: seatSync.desired.firstSeat };
  }
  seatSync.desired = null;
  seatSync.state = 'error';
  seatSync.retries = 0;
  seatSync.failMessage = null;
  const server = lobby || seatSync.lastGoodLobby || latestLobby;
  adoptServerLobby(server);
  if (server) renderLobbySummary(server, els.lobbySummary, true);
  flashSeatReverted();
  toast(message, 'err');
}

/** 回滚时给座位行一次红边提示（220ms 后移除），避免用户以为改动生效了。 */
function flashSeatReverted() {
  const rows = document.querySelectorAll('.lobby-seat-row');
  rows.forEach(row => row.classList.add('is-reverted'));
  setTimeout(() => rows.forEach(row => row.classList.remove('is-reverted')), 220);
}

/** 对局已开始：停止同步、回滚视图并隐藏全部座位控件。message 传 null = 静默停机。 */
function stopSeatSync(message) {
  seatSync.stopped = true;
  seatSync.desired = null;
  seatSync.state = 'idle';
  clearTimeout(seatSync.timer);
  seatSync.timer = null;
  seatDraft = null;
  seatDraftFirst = 0;
  if (latestLobby) renderLobbySummary(latestLobby, els.lobbySummary, true);
  if (message) toast(message, 'info');
}

/**
 * 停机开关的**唯一复位入口**：新建 / 加入 / 恢复房间、以及进入对局前都调它。
 * stopped 只是「这台客户端不再同步座位」的一次性闸门，不能变成单向门——
 * 一旦某局开局把它设成 true，之后所有新房间都会失去座位控件与「添加 AI」。
 */
function startSeatSync() {
  seatSync.stopped = false;
  seatSync.desired = null;
  seatSync.retryIntent = null;
  seatSync.failMessage = null;
  seatSync.state = 'idle';
  seatSync.retries = 0;
  seatSync.lastGoodLobby = null;
  clearTimeout(seatSync.timer);
  seatSync.timer = null;
  seatSync.seq += 1;
}

/**
 * 同时回合 / 大逃杀没有「先手」：座位序只表示 ① 出生点槽位 ② 同一步内的结算处理顺序（tie-break）。
 * 判据用服务端已返回的 lobby.mode，不新增字段。
 */
function isSimultaneousLobby(lobby) {
  return lobby?.mode === 'simultaneous' || lobby?.mode === 'royale';
}

/**
 * 当前生效的先手，口径是**座位下标**而不是人：草稿态用草稿的先手下标，否则用服务端 firstSeat。
 * 座位重排时 moveSeatRow() 会让先手下标跟着那个人一起挪，所以「下标 → 人」的对应关系
 * 始终由这里的下标现算，地图「先手」角标与座位列表用的是同一个答案。
 * 同时回合 / 大逃杀没有先手，恒返回 0（该模式下调用方也不再渲染任何先手标记）。
 */
function currentFirstSeat(lobby) {
  if (isSimultaneousLobby(lobby)) return 0;
  if (seatDraft) return seatDraftFirst;
  return Number.isInteger(lobby?.firstSeat) ? lobby.firstSeat : 0;
}

/** 大厅成员名的实时来源：改名后座位摘要 / 草稿里的旧名字不能顶上来。 */
function lobbyPlayerNames(lobby) {
  return new Map((Array.isArray(lobby?.players) ? lobby.players : [])
    .map(player => [player.id, player.name || player.id]));
}

/**
 * 地图「座位 → 出生位」标记视图（R2）：草稿优先且标 preview，否则用已保存的编排；
 * 未编排（random 且无草稿）时不给任何归属，避免伪造未发生的随机结果。
 */
function lobbySeatView(dimUnused = true) {
  const lobby = latestLobby;
  if (!lobby || lobby.phase !== 'lobby') return null;
  const slots = Array.isArray(lobby.layoutSlots) ? lobby.layoutSlots : [];
  if (!slots.length) return null;
  const rows = seatViewOf(lobby);
  const arranged = Boolean(seatDraft) || lobby.seatMode === 'manual';
  const simultaneous = isSimultaneousLobby(lobby);
  const firstSeat = currentFirstSeat(lobby);
  const names = lobbyPlayerNames(lobby);
  const marks = new Map();
  if (arranged) {
    rows.forEach((row, index) => {
      const slotId = slots[index];
      if (!slotId) return;
      marks.set(slotId, {
        seat: index + 1,
        name: names.get(row.id) || row.name || row.id,
        color: OWNER_COLOR[row.id] || '#9cc3d8',
        preview: Boolean(seatDraft),
        // 先手角标（R2-10，仅顺序模式）：只标一个人，随座位下标走——重排后角标跟着先手本人移动。
        // 同时回合 / 大逃杀没有先手，整张地图不挂任何角标。
        first: !simultaneous && index === firstSeat,
      });
    });
  }
  // 随机图预览的出生位编号来源不可靠，不对未使用出生位做降透明，避免误导。
  return { slots: dimUnused ? slots : [], marks };
}

/**
 * 座位列表（R1：成员操作与排序操作合成一张列表）。
 * 房主可上下移动 / 指定先手（仅顺序模式）或置顶（同时回合）/ 改名 / 踢出 / 添加 AI / 保存 / 恢复随机；
 * 其他成员只读。座位与席位是两件事——座位号只决定出生点与处理顺序，席位 id 仍按加入顺序。
 */
function seatPlanMarkup(lobby, canManage, canKick = canManage) {
  const seats = Array.isArray(lobby?.seats) ? lobby.seats : [];
  if (lobby?.phase !== 'lobby') return '';
  const players = lobby.players || [];
  // 0 人房（房主建房时不参战）：座位列表整段早退会把「＋ 添加 AI」一起吞掉——那是全仓唯一入口，
  // 房间就永远开不了局。所以这里只给提示行 + 添加 AI，不渲染座位行 / 保存 / 恢复随机
  //（0 人时服务端会 400 invalid_seat_layout，也没有可保存的排列）。非房主没内容可看，仍然不渲染。
  // 「添加 AI」只看房主身份，不看座位控件是否可用：开局后 seatSync 停机也不该把入口一起收走。
  if (seats.length === 0) {
    const emptyAddBot = canKick && players.length < lobby.maxPlayers
      ? '<button type="button" class="lobby-seat-add-bot lobby-add-bot" data-add-bot="1" title="添加强化学习 AI"><span class="lobby-add-bot-plus">+</span><span>添加 AI</span></button>'
      : '';
    if (!emptyAddBot) return '';
    return `<div class="lobby-seats is-empty">
      <div class="lobby-seat-hint">还没有玩家加入：点下方可添加 AI，或把 Game ID 发给其他玩家</div>
      ${emptyAddBot}
    </div>`;
  }
  const rows = seatViewOf(lobby);
  const slots = Array.isArray(lobby.layoutSlots) ? lobby.layoutSlots : [];
  const manual = lobby.seatMode === 'manual';
  // 同时回合 / 大逃杀没有先手：列表头讲「结算顺序」，第三颗按钮是「置顶」（改 order，不改 firstSeat）。
  const simultaneous = isSimultaneousLobby(lobby);
  const firstSeat = currentFirstSeat(lobby);
  const names = lobbyPlayerNames(lobby);
  const nameOf = row => names.get(row.id) || row.name || row.id;
  // 出生点只有「已保存的编排」或「房主草稿」才有确定答案，随机且未编排时不下结论。
  const arranged = manual || Boolean(seatDraft);
  // 列表头不再有文字说明（顺序看列表就懂）。三种状态改用非文字线索表达：
  // · 未编排（random 且无草稿）→ 行内出生位槽为空 + 列表头没有「恢复随机」按钮 + 状态点灰色；
  // · 预览中 → 行内出生位随草稿即时变化（地图同步预览）+ 状态点琥珀（提交中）；
  // · 已编排 → 行内出生位有值 + 「恢复随机」按钮出现。
  const canAddBot = canKick && players.length < lobby.maxPlayers;
  // 操作槽位：改名 / 踢出 / ▲ / ▼ / 第三格（顺序模式=先手，同时模式=置顶），宽度由 CSS 固定；
  // 不可用的位置放同宽空占位，这样同一张列表里任意两行的按钮左右边界逐像素对齐。
  const opEmpty = kind => `<span class="lobby-seat-op-empty" data-seat-op="${kind}" aria-hidden="true"></span>`;
  // 行内同步态：提交中的行淡一点；状态点颜色见 CSS（灰=已同步 / 琥珀=提交中 / 红=失败）。
  const syncState = seatSync.stopped ? 'idle' : seatSync.state;
  const rowMarkup = (player, index) => {
    const slotId = arranged ? (slots[index] || seats[index]?.spawnSlotId || null) : null;
    // 同时模式没有先手：行高亮、按钮选中态一律不出现。
    const first = !simultaneous && index === firstSeat;
    const isSelf = player.id === myPlayer;
    const classes = ['lobby-seat-row'];
    if (first) classes.push('is-first');
    if (isSelf) classes.push('is-self');
    if (seatSync.state === 'pending') classes.push('is-pending');
    // 成员操作槽只有一个（固定 46px，三选一）：自己=改名 / 房主看别人=踢出 / 非房主看别人=空占位。
    const memberOp = isSelf && Boolean(myToken)
      ? '<button type="button" class="lobby-rename" data-rename-self="1" title="更改我的名字">改名</button>'
      : canManage && !isSelf
        ? `<button type="button" class="lobby-kick" data-kick-player="${esc(player.id)}">踢出</button>`
        : opEmpty('member');
    // 第三格：顺序模式 = 指定先手（只改 firstSeat）；同时模式 = 置顶（改 order，把该行挪到 1 号座位）。
    const third = simultaneous
      ? `<button type="button" class="lobby-seat-top" data-seat-top="${index}" title="移到 1 号座位"${index === 0 ? ' disabled' : ''}>置顶</button>`
      : `<button type="button" class="lobby-seat-first${first ? ' is-first' : ''}" data-seat-first="${index}"${first ? ' disabled' : ''}>${first ? '先手' : '设为先手'}</button>`;
    // 排序三格只给房主；非房主的列表每行都不渲染它们，行与行之间照样对齐。
    const sort = canManage
      ? `<span class="lobby-seat-actions">
          <button type="button" class="lobby-seat-move" data-seat-up="${index}" title="上移"${index === 0 ? ' disabled' : ''}>▲</button>
          <button type="button" class="lobby-seat-move" data-seat-down="${index}" title="下移"${index === rows.length - 1 ? ' disabled' : ''}>▼</button>
          ${third}
        </span>`
      : '';
    // 先手不用文字标签表达：行高亮 + 右侧那颗按钮的选中态（「先手」+ 绿框）就够了。
    return `<div class="${classes.join(' ')}"${slotId ? ` data-slot-id="${esc(slotId)}"` : ''}>
      <span class="lobby-seat-sync-dot" data-seat-sync="${syncState}" aria-hidden="true"></span>
      <span class="lobby-seat-no" style="border-color:${esc(OWNER_COLOR[player.id] || '#7f98a9')}">${index + 1}</span>
      <span class="lobby-seat-name">${esc(nameOf(player))}</span>
      <span class="lobby-seat-slot"${slotId ? ` title="${esc(slotId)}"` : ''}>${slotId ? esc(slotId) : ''}</span>
      <span class="lobby-seat-ops">
        <span class="lobby-seat-member">${memberOp}</span>
        ${sort}
      </span>
    </div>`;
  };
  const mySeat = rows.findIndex(row => row.id === myPlayer);
  const selfLine = mySeat >= 0 && !canManage
    ? `<div class="lobby-seat-self">你是 ${mySeat + 1} 号座位${manual
      ? simultaneous
        ? ` · 结算序第 ${mySeat + 1} 位`
        : ` · 第 ${((mySeat - firstSeat + rows.length) % rows.length) + 1} 顺位`
      : ' · 出生点开局随机'}</div>`
    : '';
  const addBotRow = canAddBot
    ? `<button type="button" class="lobby-seat-add-bot lobby-add-bot" data-add-bot="1" title="添加强化学习 AI"><span class="lobby-add-bot-plus">+</span><span>添加 AI</span></button>`
    : '';
  // 不再有「保存座位 / 恢复随机」底栏：改动即时提交，恢复随机挪到列表头。
  return `<div class="lobby-seats">
    ${rows.map(rowMarkup).join('')}
    ${addBotRow}
    ${selfLine}
  </div>`;
}

function lobbySummaryMarkup(lobby, canKick = false) {
  const players = lobby.players || [];
  const canManage = canKick && lobby.phase === 'lobby' && !seatSync.stopped;
  const editableCounts = (lobby.supportedPlayerCounts || []).filter(count => count >= players.length);
  const canEditMax = canManage && editableCounts.length > 1;
  const countMarkup = canEditMax
    ? `<button type="button" class="lobby-count-edit" data-edit-max-players="1" title="更改最大玩家数"><strong>${players.length}/${lobby.maxPlayers}</strong></button>`
    : `<strong>${players.length}/${lobby.maxPlayers}</strong>`;
  // 「恢复随机」：小号下划线文字按钮，放在列表头、人数左侧；本身已随机且无未确认意图时不渲染。
  const canReset = canManage && (lobby.seatMode === 'manual' || Boolean(seatDraft));
  const resetMarkup = canReset
    ? '<button type="button" class="lobby-seat-reset" data-seat-reset="1" title="取消编排，开局由服务端随机分配出生点">恢复随机</button>'
    : '';
  // 同步状态点：灰=已同步、琥珀=提交中（呼吸）、红=失败（可点重提）；不出现可见文字标签。
  const syncState = seatSync.stopped ? 'idle' : seatSync.state;
  const syncDot = canManage
    ? `<button type="button" class="lobby-seat-sync" data-seat-sync="${syncState}" title="${esc(seatSyncLabel())}"${syncState === 'error' ? '' : ' disabled'} aria-label="${esc(seatSyncLabel())}"><span class="lobby-seat-sync-dot" aria-hidden="true"></span></button>`
    : '';
  const syncLive = canManage
    ? `<span class="sr-only" aria-live="polite">${esc(seatSyncText())}</span>`
    : '';
  return `<div class="lobby-summary-head">
    <span>${esc(lobbyPhaseLabel(lobby))}</span>
    <span class="lobby-summary-head-ops">${resetMarkup}${syncDot}${countMarkup}</span>
    ${syncLive}
  </div>
  ${lobbyResultMarkup(lobby)}
  ${seatPlanMarkup(lobby, canManage, canKick)}`;
}

/** 房间创建后：名称 / 最大玩家数改为只读展示，参战开关跟随实际席位并禁用。 */
function syncCreateFormStatic() {
  const inRoom = Boolean(els.createForm?.classList.contains('room-active'));
  const participating = Boolean(myToken);
  els.hostParticipate?.closest('.checkbox-field')?.classList.toggle('is-room-static', inRoom);
  if (els.hostParticipate) els.hostParticipate.disabled = inRoom;
  if (!inRoom) return;
  if (els.hostParticipate) els.hostParticipate.checked = participating;
  const actualName = participating ? lobbyPlayerName(myPlayer) : '';
  // 参与后把真实名字写回隐藏输入，退出 / 再加入时沿用。
  if (actualName && els.createName) els.createName.value = actualName;
  const name = actualName || els.createName?.value.trim() || '未设置';
  if (els.createNameStatic) {
    els.createNameStatic.textContent = name;
    els.createNameStatic.title = name;
  }
  const maxPlayers = latestLobby?.maxPlayers ?? Number(els.maxPlayers?.value || 2);
  if (latestLobby?.maxPlayers && els.maxPlayers) els.maxPlayers.value = String(latestLobby.maxPlayers);
  if (els.createMaxPlayersStatic) els.createMaxPlayersStatic.textContent = `${maxPlayers} 人`;
}

/** 房间卡「更多 ▾」：展开 / 收起 HOST、PLAYER 凭证行（v6 压缩，默认只留 Game ID）。 */
function toggleCreatedMore() {
  if (!els.createdMore || !els.btnCreatedMore) return;
  const open = els.createdMore.classList.toggle('hidden') === false;
  els.btnCreatedMore.setAttribute('aria-expanded', String(open));
  const label = (els.btnCreatedMore.textContent || '').replace(/\s*[▾▴]\s*$/, '');
  els.btnCreatedMore.textContent = `${label} ${open ? '▴' : '▾'}`;
}

/** 房主席位卡：参战与否决定显示 token 还是「未参战」，并切换加入 / 退出战斗按钮。 */
function syncHostSeatUi() {
  const participating = Boolean(myToken);
  const lobby = hostLobbySnapshot;
  const ended = lobby?.phase === 'game_over';
  const openForPlayers = !lobby || lobby.phase === 'lobby';
  els.createdPlayerTokenRow?.classList.remove('hidden');
  if (els.createdToken) els.createdToken.textContent = participating ? myToken : '未参战';
  els.createdTokenCopy?.classList.toggle('hidden', !participating);
  if (els.createRoomStatus) {
    // v6 压缩：状态与提示合并成一行（原来是两行）。
    if (ended) {
      const winner = lobbyWinnerName(lobby);
      els.createRoomStatus.textContent = winner ? `对局已结束 · ${winner} 获胜` : '对局已结束 · 本局无胜者';
    } else {
      els.createRoomStatus.textContent = `${participating ? '等待玩家加入 · 房主参战' : '等待玩家加入 · 房主未参战'} · 把 Game ID 发给其他玩家`;
    }
  }
  if (els.createRoomTitle) els.createRoomTitle.textContent = ended ? '对局已结束' : '房间已创建';
  if (els.createRoomHint) {
    els.createRoomHint.textContent = ended
      ? '本局已结束，可查看回放，或点「重新创建」开新的一局。'
      : '把 Game ID 发给其他玩家；人齐后点「开始游戏」。';
  }
  if (els.createRoomBadge) {
    els.createRoomBadge.textContent = ended ? '已结束' : '大厅中';
    els.createRoomBadge.classList.toggle('ok', !ended);
    els.createRoomBadge.classList.toggle('idle', ended);
  }
  if (els.btnStartGame) {
    els.btnStartGame.classList.toggle('hidden', !openForPlayers);
    els.btnStartGame.disabled = !openForPlayers;
  }
  if (els.btnHostParticipate) {
    els.btnHostParticipate.textContent = participating ? '退出战斗' : '加入战斗';
    els.btnHostParticipate.classList.toggle('warning', participating);
    const full = !participating && Boolean(hostLobbySnapshot)
      && hostLobbySnapshot.phase === 'lobby'
      && hostLobbySnapshot.playerCount >= hostLobbySnapshot.maxPlayers;
    els.btnHostParticipate.disabled = hostSeatBusy || full || !openForPlayers;
    els.btnHostParticipate.classList.toggle('hidden', !openForPlayers);
    els.btnHostParticipate.title = !openForPlayers
      ? '本局已结束，不能再加入席位'
      : full ? '房间已满，无法加入战斗'
        : participating ? '退出战斗（保留房主身份）' : '以玩家身份加入战斗';
  }
  // 「进入游戏」只在对局 active 时出现：大厅期房主只用「开始游戏」（开局成功后自动进棋盘），
  // 对局结束走「查看回放」，都不该再出现这颗按钮。
  const active = lobby?.phase === 'active';
  if (els.btnConnectCreate) {
    els.btnConnectCreate.textContent = '进入游戏';
    els.btnConnectCreate.classList.toggle('hidden', !active);
  }
  if (els.btnViewReplay) {
    els.btnViewReplay.classList.toggle('hidden', !ended || !gameId);
    if (ended && gameId) els.btnViewReplay.href = `/spectator.html?gameId=${encodeURIComponent(gameId)}`;
  }
  syncCreateFormStatic();
}

/** 加入者房间卡：大厅期不给「进入游戏」（房主开局后会自动进棋盘），active 才显示，结束走回放入口。 */
function syncJoinRoomUi(lobby) {
  const ended = lobby?.phase === 'game_over';
  const active = lobby?.phase === 'active';
  if (els.joinRoomStatus) {
    if (ended) {
      const winner = lobbyWinnerName(lobby);
      els.joinRoomStatus.textContent = winner ? `对局已结束 · ${winner} 获胜` : '对局已结束 · 本局无胜者';
    } else {
      els.joinRoomStatus.textContent = active ? '对局已开始' : '等待房主开始';
    }
  }
  if (els.joinRoomTitle) els.joinRoomTitle.textContent = ended ? '对局已结束' : active ? '对局已开始' : '已加入房间';
  if (els.joinRoomHint) {
    els.joinRoomHint.textContent = ended
      ? '本局已结束，可查看回放，或点「返回大厅」。'
      : active ? '对局已开始，点「进入游戏」回到棋盘。'
        : '房主开始后会自动进入游戏。';
  }
  if (els.joinRoomBadge) {
    els.joinRoomBadge.textContent = ended ? '已结束' : active ? '进行中' : '大厅中';
    els.joinRoomBadge.classList.toggle('ok', !ended);
    els.joinRoomBadge.classList.toggle('idle', ended);
  }
  if (els.btnConnectJoin) {
    els.btnConnectJoin.textContent = '进入游戏';
    els.btnConnectJoin.classList.toggle('hidden', !active);
  }
  if (els.btnViewReplayJoin) {
    els.btnViewReplayJoin.classList.toggle('hidden', !ended || !gameId);
    if (ended && gameId) els.btnViewReplayJoin.href = `/spectator.html?gameId=${encodeURIComponent(gameId)}`;
  }
}

function renderLobbySummary(lobby, target = els.lobbySummary, canKick = target === els.lobbySummary && Boolean(hostToken)) {
  if (!target || !lobby) return;
  latestLobby = lobby;
  // 记录大厅元信息，供「对战提示词」页签自动填充地图与人数、算法清单按模式过滤。
  if (lobby.mapId) botLobbyMapId = lobby.mapId;
  if (lobby.maxPlayers) botLobbyMaxPlayers = lobby.maxPlayers;
  if (lobby.mode) botLobbyMode = lobby.mode;
  target.innerHTML = lobbySummaryMarkup(lobby, canKick);
  if (target === els.lobbySummary) {
    hostLobbySnapshot = lobby;
    syncHostSeatUi();
    // 没有未确认意图时，基线与乐观视图跟服务端对齐（成员进出 / 别人保存都能吸收）。
    syncSeatBase(lobby);
    // 座位视图变了才重画地图（悬停高亮走 class 切换，不进这里，避免 1.5s 轮询整段重绘掉帧）。
    const signature = seatViewSignature();
    if (signature !== lastSeatViewSignature) {
      lastSeatViewSignature = signature;
      renderLobbyMapSummary();
    }
  } else if (target === els.joinLobbySummary) {
    syncJoinRoomUi(lobby);
  }
}

/** 座位视图签名：地图只在座位归属 / 乐观视图 / 同步态变化时重画。 */
function seatViewSignature() {
  const lobby = latestLobby;
  if (!lobby) return '';
  const rows = lobby.phase === 'lobby' ? seatViewOf(lobby) : [];
  return [
    lobby.mapId || '', lobby.phase || '', lobby.seatMode || '',
    lobby.seatVersion ?? 0, seatDraft ? 'draft' : 'saved', seatSync.state || 'idle',
    rows.map(row => row.id).join(','),
  ].join('|');
}

/** 座位行 ↔ 地图标记双向高亮：只切 class，不触发重绘。 */
function setSeatHover(slotId) {
  document.querySelectorAll('[data-slot-id]').forEach(el => {
    el.classList.toggle('is-seat-hover', Boolean(slotId) && el.dataset.slotId === slotId);
  });
}

document.addEventListener('mouseover', e => {
  const el = e.target.closest?.('[data-slot-id]');
  if (el) setSeatHover(el.dataset.slotId);
});
document.addEventListener('mouseout', e => {
  const el = e.target.closest?.('[data-slot-id]');
  if (el) setSeatHover(null);
});

function availableGameModeLabel(mode) {
  return mode === 'simultaneous' ? '同时' : mode === 'annihilation' ? '歼灭' : mode === 'royale' ? '大逃杀' : '标准';
}

function availableGameAge(createdAt) {
  if (!createdAt) return '';
  const elapsed = Math.max(0, Date.now() - createdAt);
  if (elapsed < 60000) return '刚刚创建';
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

// 可用对局里的地图展示：中文名（以配置名为准，随机地图是「随机战场」）+ mapId 作英文辅名。
// 缩略图来自 /api/maps 的 preview；随机地图没有静态预览，用占位块代替。
function availableGameMapInfo(game) {
  const mapId = game.mapId || 'default';
  const map = availableMaps.find(item => item.id === mapId) || null;
  return {
    id: mapId,
    name: game.mapName || map?.name || (mapId === 'random' ? '随机战场' : mapId),
    preview: map?.preview || null,
  };
}

function syncAvailableGamesMapOptions(games) {
  if (!els.availableGamesMapFilter) return;
  const mapIds = [...new Set(games.map(game => game.mapId || 'default'))];
  const mapOptions = mapIds
    .map(mapId => availableGameMapInfo({ mapId }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  // 地图表是异步加载的：签名带上中文名，地图表到位后筛选下拉才会从 id 换成名字。
  const signature = mapOptions.map(item => `${item.id}:${item.name}`).join(',');
  if (els.availableGamesMapFilter.dataset.options === signature) return;
  els.availableGamesMapFilter.dataset.options = signature;
  els.availableGamesMapFilter.innerHTML = ['<option value="">全部地图</option>']
    .concat(mapOptions.map(item => `<option value="${esc(item.id)}">${esc(item.name)}${item.name === item.id ? '' : ` · ${esc(item.id)}`}</option>`)).join('');
  const current = els.availableGamesMapFilter.value;
  els.availableGamesMapFilter.value = mapOptions.some(item => item.id === current) ? current : '';
}

function renderAvailableGames(games) {
  if (!els.availableGames) return;
  const joinableGames = games
    .filter(game => game.phase === 'lobby' && game.playerCount < game.maxPlayers);
  if (!joinableGames.length) {
    availableGamesPage = 1;
    els.availableGames.innerHTML = `<p class="available-games-state">暂无等待加入的对局</p>`;
    return;
  }
  const modeFilter = els.availableGamesModeFilter?.value || '';
  const filteredGames = joinableGames
    .filter(game => !modeFilter || game.mode === modeFilter);
  syncAvailableGamesMapOptions(filteredGames);
  const mapFilter = els.availableGamesMapFilter?.value || '';
  const visibleGames = filteredGames
    .filter(game => !mapFilter || (game.mapId || 'default') === mapFilter);
  if (!visibleGames.length) {
    els.availableGames.innerHTML = `<p class="available-games-state">没有符合筛选条件的对局</p>`;
    return;
  }
  const pageCount = Math.max(1, Math.ceil(visibleGames.length / AVAILABLE_GAMES_PAGE_SIZE));
  availableGamesPage = Math.min(Math.max(availableGamesPage, 1), pageCount);
  const pageGames = visibleGames.slice(
    (availableGamesPage - 1) * AVAILABLE_GAMES_PAGE_SIZE,
    availableGamesPage * AVAILABLE_GAMES_PAGE_SIZE,
  );
  const selectedId = els.gameId.value.trim();
  const listHtml = pageGames.map(game => {
    const id = String(game.gameId || '');
    const selected = id === selectedId;
    const hostName = String(game.hostName || '').trim();
    const age = availableGameAge(game.createdAt);
    const map = availableGameMapInfo(game);
    const thumbnail = map.preview
      ? renderMapPreview(map.preview)
      : `<span class="available-game-thumb-empty">${map.id === 'random' ? '随机地图' : '暂无预览'}</span>`;
    const mapAlias = map.name === map.id
      ? ''
      : `<span class="available-game-mapalias">${esc(map.id)}</span>`;
    // 「房主：」标签不参与截断，长名字只截名字本身，列表里的房主信息不会缩成「房主：一…」。
    const hostMarkup = hostName
      ? `<span class="available-game-host"><span class="available-game-host-label">房主：</span><span class="available-game-host-name">${esc(hostName)}</span></span>`
      : '<span class="available-game-host"><span class="available-game-host-label">房主</span></span>';
    return `<button type="button" class="available-game${selected ? ' selected' : ''}" data-available-game-id="${esc(id)}" aria-pressed="${selected}" title="${esc(id)}">
      <span class="available-game-thumb" aria-hidden="true">${thumbnail}</span>
      <span class="available-game-main">
        <span class="available-game-head">
          <span class="available-game-mapname">${esc(map.name)}</span>${mapAlias}
        </span>
        <span class="available-game-meta">
          <span class="available-game-mode" data-mode="${esc(game.mode || 'standard')}">${esc(availableGameModeLabel(game.mode))}</span>
          <span class="available-game-seats">${esc(game.playerCount)}/${esc(game.maxPlayers)} 人</span>
          ${hostMarkup}
        </span>
        <span class="available-game-foot">
          <span class="available-game-id">房间号 ${esc(id)}</span>
          ${age ? `<span class="available-game-age">${esc(age)}</span>` : ''}
        </span>
      </span>
      <span class="available-game-action"><span class="available-game-action-label">${selected ? '已选' : '选择'}</span><span class="available-game-chevron" aria-hidden="true">›</span></span>
    </button>`;
  }).join('');
  els.availableGames.innerHTML = `${listHtml}
    <div class="available-games-pager" aria-label="对局列表翻页">
      <button type="button" class="available-games-page-btn" data-games-page="first" aria-label="最新一页" title="最新一页" ${availableGamesPage <= 1 ? 'disabled' : ''}>«</button>
      <button type="button" class="available-games-page-btn" data-games-page="prev" aria-label="上一页" ${availableGamesPage <= 1 ? 'disabled' : ''}>‹</button>
      <span class="available-games-pager-info">第 ${availableGamesPage} / ${pageCount} 页 · 共 ${visibleGames.length} 局</span>
      <button type="button" class="available-games-page-btn" data-games-page="next" aria-label="下一页" ${availableGamesPage >= pageCount ? 'disabled' : ''}>›</button>
      <button type="button" class="available-games-page-btn" data-games-page="last" aria-label="最后一页" title="最后一页" ${availableGamesPage >= pageCount ? 'disabled' : ''}>»</button>
    </div>`;
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
    availableGamesData = Array.isArray(data.games) ? data.games : [];
    renderAvailableGames(availableGamesData);
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
  // 请求发起时快照 gameId：响应回来时若已经切到别的房间，整条丢弃——否则旧房间的
  // 成员/座位会盖到新房间卡片上，甚至把新房间里的自己误判成「已被移出」。
  const requestGameId = gameId;
  const res = await fetch(`/api/games/${encodeURIComponent(requestGameId)}/lobby`);
  const data = await res.json().catch(() => null);
  if (requestGameId !== gameId) return null;
  if (!res.ok || !data) return null;
  if (typeof data.gameId === 'string' && data.gameId !== requestGameId) return null;
  // 座位版本单调性：比当前基线旧的响应说明是上一拍（或别人的旧快照），整条丢弃，
  // 否则会把已经提交成功的座位顺序回退掉。
  if (isStaleSeatVersion(data)) return null;
  // 只更新当前身份对应的房间卡：房主 / 加入者共用同一 gameId，两份摘要同时刷新会让
  // 「创建」页签显示别人房间的成员与地图（旧 bug 的根源）。
  if (hostToken) renderLobbySummary(data, els.lobbySummary, true);
  else if (myToken) renderLobbySummary(data, els.joinLobbySummary);
  return data;
}

/**
 * 轮询响应是否过期：先比 gameId（新房间的 seatVersion 从 0 起，全局单调比较会误杀），
 * 再比 seatVersion 是否回退到基线之前。
 */
function isStaleSeatVersion(lobby) {
  if (!Number.isInteger(lobby?.seatVersion)) return false;
  const base = seatSync.baseVersion;
  return Number.isInteger(base) && lobby.seatVersion < base;
}

function handleLobbyRemoval(lobby) {
  if (!myPlayer || !lobby || lobby.phase !== 'lobby') return false;
  if ((lobby.players || []).some(player => player.id === myPlayer)) return false;
  myToken = null;
  myPlayer = null;
  persistSession();
  if (hostToken) {
    // 房主自己的席位被移除（例如在另一标签页退出战斗）：保留房主视图与轮询。
    hostLobbySnapshot = lobby;
    syncHostSeatUi();
    toast('已退出战斗，房主身份保留', 'info');
    return false;
  }
  stopLobbyPolling();
  if (sse) { sse.close(); sse = null; }
  if (els.joinPlayerToken) els.joinPlayerToken.textContent = '';
  els.joinPlayerTokenRow?.classList.add('hidden');
  showJoinError('你已被房主移出大厅');
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
      // 发起时快照房间号：响应回来时若已经换了房间，这条轮询结果一律丢弃，
      // 也不能拿它去做「我被移出」的判定（那会清掉新房间的 token）。
      const polledGameId = gameId;
      const lobby = await refreshLobbySummary();
      if (polledGameId !== gameId) return;
      if (handleLobbyRemoval(lobby)) return;
      // 已结束的房间不会再开局，继续轮询没意义。
      if (lobby?.phase === 'game_over') { stopLobbyPolling(); return; }
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
  const ok = await window.UIDialog.confirm({
    title: '移出大厅成员？',
    message: '移出后该玩家会离开等待列表，需要重新加入才能继续等待。',
    confirmText: '移出',
    tone: 'danger',
  });
  if (!ok) return;
  const res = await fetch(`/api/games/${encodeURIComponent(gameId)}/players/${encodeURIComponent(playerId)}`, {
    method: 'DELETE',
    headers: { 'X-Host-Token': hostToken },
  });
  const data = await res.json();
  if (!res.ok) return toast(data.error || '踢出失败', 'err');
  renderLobbySummary(data.lobby, els.lobbySummary, true);
  toast('玩家已移出大厅', 'ok');
}

/** 房主点击「等待开局」右上角的人数，修改大厅最大玩家数。 */
async function changeLobbyMaxPlayers() {
  if (!gameId || !hostToken) return toast('缺少房主凭证', 'err');
  const lobby = latestLobby;
  if (!lobby) return;
  const joined = (lobby.players || []).length;
  const options = (lobby.supportedPlayerCounts || []).filter(count => count >= joined);
  if (options.length <= 1) return toast('该地图没有其他可选人数', 'info');
  const current = lobby.maxPlayers;
  const next = await window.UIDialog.prompt({
    title: '更改最大玩家数',
    message: `地图支持 ${options.join(' / ')} 人，当前已加入 ${joined} 人。`,
    value: String(current),
    confirmText: '保存',
    maxLength: 1,
  });
  if (next === null) return;
  const maxPlayers = Number(next.trim());
  if (!Number.isInteger(maxPlayers) || !options.includes(maxPlayers)) {
    return toast(`最大玩家数只能是 ${options.join(' / ')} 人`, 'err');
  }
  if (maxPlayers === current) return;
  const res = await fetch(`/api/games/${encodeURIComponent(gameId)}/host/max-players`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-Host-Token': hostToken },
    body: JSON.stringify({ maxPlayers }),
  });
  const data = await res.json();
  if (!res.ok) return toast(data.error || '修改最大玩家数失败', 'err');
  if (data.lobby) renderLobbySummary(data.lobby, els.lobbySummary, true);
  else await refreshLobbySummary();
  toast(`最大玩家数已改为 ${maxPlayers} 人`, 'ok');
}

/** 上移 / 下移一行座位；先手跟着那个人一起移动，避免「移了先手座位却没换人」。 */
function moveSeatRow(index, delta) {
  const lobby = latestLobby;
  if (!lobby || !Number.isInteger(index)) return;
  const rows = beginSeatEdit(lobby);
  const target = index + delta;
  if (target < 0 || target >= rows.length) return;
  [rows[index], rows[target]] = [rows[target], rows[index]];
  if (seatDraftFirst === index) seatDraftFirst = target;
  else if (seatDraftFirst === target) seatDraftFirst = index;
  afterSeatEdit(lobby);
}

/** 指定某一行为先手（其余顺位仍然按座位序循环）。仅标准 / 歼灭模式。 */
function setSeatFirstRow(index) {
  const lobby = latestLobby;
  if (!lobby || !Number.isInteger(index)) return;
  beginSeatEdit(lobby);
  seatDraftFirst = index;
  afterSeatEdit(lobby);
}

/**
 * 「置顶」（同时回合 / 大逃杀）：把该行挪到 1 号座位——改 order，不动 firstSeat（恒 0）。
 * 出生点跟着 order 走，所以地图会当场重排；这里不引入「先手」概念。
 */
function moveSeatRowToTop(index) {
  const lobby = latestLobby;
  if (!lobby || !Number.isInteger(index) || index <= 0) return;
  const rows = beginSeatEdit(lobby);
  if (index >= rows.length) return;
  const [row] = rows.splice(index, 1);
  rows.unshift(row);
  // 同时模式没有先手：1 号座位就是结算处理顺序的第一位。
  seatDraftFirst = 0;
  afterSeatEdit(lobby);
}

/** 本地改动之后：先登记意图（否则渲染时的对齐会覆盖乐观视图），再重绘 + 安排发送。 */
function afterSeatEdit(lobby) {
  pushIntent(lobby);
  renderLobbySummary(lobby, els.lobbySummary, true);
}

/** 「恢复随机」的撤销入口是否还挂着：出现新意图时要先摘掉它，免得撤销把新顺序覆盖掉。 */
let seatUndoPending = false;

function dismissSeatUndo() {
  if (!seatUndoPending) return;
  seatUndoPending = false;
  const t = $('toast');
  if (!t?.querySelector('.toast-action')) return;
  clearTimeout(t._timer);
  t.className = '';
}

/**
 * 恢复随机（不弹确认）：先作废所有未确认意图（含在途 PUT），再 DELETE 座位表；
 * DELETE 响应里的 seatVersion 成为新基线，之后 toast 带「撤销」，5 秒内可点。
 */
async function resetSeatOrder() {
  if (!gameId || !hostToken) return toast('缺少房主凭证', 'err');
  const lobby = latestLobby;
  if (!lobby) return;
  const snapshot = seatIntentOf(lobby); // 点击前的视图（撤销时还会按最新名单再合并一次）
  // ① 作废队列里的意图：清 desired / timer 并推进 seq（在途回调看到 seq 变了就不再补发）。
  seatSync.seq += 1;
  seatSync.desired = null;
  seatSync.retryIntent = null;
  clearTimeout(seatSync.timer);
  seatSync.timer = null;
  seatSync.state = 'idle';
  dismissSeatUndo();
  const resetSeq = seatSync.seq;
  // ② 有在途 PUT 时先等它 settle：DELETE 先落、旧 PUT 后落会把座位又建出来。
  for (let waited = 0; seatSync.inFlight && waited < 3000; waited += 60) {
    await seatSleep(60);
  }
  if (seatSync.seq !== resetSeq) return; // 等待期间又有新操作：交给那次操作决定
  const res = await fetch(`/api/games/${encodeURIComponent(gameId)}/host/seats`, {
    method: 'DELETE',
    headers: { 'X-Host-Token': hostToken },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (data.lobby) renderLobbySummary(data.lobby, els.lobbySummary, true);
    return toast(data.error || '恢复随机失败', 'err');
  }
  const version = Number.isInteger(data.seatVersion) ? data.seatVersion : seatSync.baseVersion;
  // ③ 新基线 + 再推进一次 seq：DELETE 之前登记过的意图全部作废。
  seatSync.seq += 1;
  seatSync.baseVersion = version;
  seatSync.desired = null;
  seatSync.retryIntent = null;
  seatSync.failMessage = null;
  seatSync.state = 'idle';
  if (data.lobby) {
    adoptServerLobby(data.lobby);
    renderLobbySummary(data.lobby, els.lobbySummary, true);
  }
  seatUndoPending = true;
  toast('已恢复随机座位', 'ok', {
    label: '撤销',
    timeout: 5000,
    onClick: () => {
      seatUndoPending = false;
      undoSeatReset(snapshot, version);
    },
  });
}

/** 撤销「恢复随机」：快照按最新名单合并后，走与点击同一套意图登记逻辑再 PUT 一次。 */
function undoSeatReset(snapshot, version) {
  if (!gameId || !hostToken || seatSync.stopped) return;
  const lobby = latestLobby;
  if (!lobby) return;
  // DELETE 之后名单可能变过（有人进出）：裸快照会带上已经离开的人，必须 rebase。
  const order = rebaseSeatOrder(snapshot.order, lobby);
  const names = lobbyPlayerNames(lobby);
  seatDraft = order.map(id => ({ id, name: names.get(id) || id }));
  seatDraftFirst = clampFirstSeat(snapshot.firstSeat, order.length, isSimultaneousLobby(lobby));
  seatSync.failMessage = '撤销失败，座位已随机';
  if (Number.isInteger(version)) seatSync.baseVersion = version;
  pushIntent(lobby);
  renderLobbySummary(lobby, els.lobbySummary, true);
  flushSeatSync(); // 撤销要即时，不等 180ms 合并窗口
}

function lobbyPlayerName(playerId) {
  if (!playerId) return '';
  return (latestLobby?.players || []).find(player => player.id === playerId)?.name || '';
}

async function promptLobbyName(current) {
  const next = await window.UIDialog.prompt({
    title: '更改名字',
    message: current ? `当前名字：${current}` : '输入大厅中显示的新名字',
    value: current,
    confirmText: '保存',
    maxLength: 50,
  });
  if (next === null) return null;
  const name = next.trim();
  if (!name) {
    toast('名字不能为空', 'err');
    return null;
  }
  return name;
}

/** 自己改自己的大厅显示名；房主与加入者都用各自的 player token。 */
async function renameSelf() {
  if (!gameId || !myToken) return toast('缺少玩家凭证', 'err');
  const name = await promptLobbyName(lobbyPlayerName(myPlayer));
  if (!name) return;
  const res = await fetch(`/api/games/${encodeURIComponent(gameId)}/player`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-Player-Token': myToken,
      // 房主自己改名时带上房主凭证，服务端同步大厅列表里的房主名。
      ...(hostToken ? { 'X-Host-Token': hostToken } : {}),
    },
    body: JSON.stringify({ name }),
  });
  const data = await res.json();
  if (!res.ok) return toast(data.error || '改名失败', 'err');
  // 之后重新加入 / 创建时沿用新名字。
  sessionName = name;
  if (els.createName) els.createName.value = name;
  if (els.joinName) els.joinName.value = name;
  persistSession();
  if (hostToken) {
    if (data.lobby) renderLobbySummary(data.lobby, els.lobbySummary, true);
  } else {
    if (data.lobby) renderLobbySummary(data.lobby, els.joinLobbySummary);
  }
  if (!data.lobby) await refreshLobbySummary();
  toast('名字已更新', 'ok');
}

// —— 强化学习 AI：房主在大厅中一键添加 ——
let botModelsLoaded = false;
// 大厅元信息快照（renderLobbySummary 时刷新），供提示词模板自动填充、算法清单按模式过滤。
let botLobbyMapId = '';
let botLobbyMaxPlayers = 0;
let botLobbyMode = '';

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
  els.algorithmName.value = '';
  switchBotTab('bots');
  els.botDialog.classList.remove('hidden');
  els.botDialogBackdrop.classList.remove('hidden');
  ensureBotModels();
  ensureAlgorithmTypes();
  renderBotPromptText();
  els.botName.focus();
}

// —— 算法脚本页签：算法清单从服务器按当前对局模式拉取 ——
// 算法按模式注册（注册表 ALGORITHM_META.modes），不同模式不能混用；
// 清单由 /api/algorithms 提供，勿再在前端另立写死的算法列表。
let algorithmTypesCache = null;

async function ensureAlgorithmTypes() {
  if (!algorithmTypesCache) {
    try {
      const res = await fetch('/api/algorithms');
      if (!res.ok) throw new Error('request failed');
      const data = await res.json();
      algorithmTypesCache = Array.isArray(data.algorithms) ? data.algorithms : [];
    } catch {
      algorithmTypesCache = [];
    }
  }
  // gameConfig 只在开局后的 game_start 事件才有值，而添加 AI 弹窗仅存在于大厅阶段，
  // 此时须回退到大厅快照的 mode，否则同时回合对局选不到同时模式算法、非标准模式全被 400 拒。
  const mode = gameConfig?.mode || botLobbyMode || 'standard';
  const available = algorithmTypesCache.filter(algo =>
    Array.isArray(algo.modes) ? algo.modes.includes(mode) : mode === 'standard');
  els.algorithmType.innerHTML = available.length
    ? available.map(algo =>
        `<option value="${esc(algo.id)}" data-name="${esc(algo.name)}">${esc(algo.name)}</option>`).join('')
    : '<option value="">（当前模式无可用算法）</option>';
  resetAlgorithmName();
}

// 默认名取所选算法的中文名
function defaultAlgorithmName() {
  return els.algorithmType.selectedOptions[0]?.dataset.name || '';
}

function resetAlgorithmName() {
  els.algorithmName.value = defaultAlgorithmName();
}

// —— 对战提示词页签：生成可复制的 agent 引导词 ——
function switchBotTab(tab) {
  const isBots = tab === 'bots';
  const isAlgorithm = tab === 'algorithm';
  const isPrompt = tab === 'prompt';
  els.botPanelBots.classList.toggle('hidden', !isBots);
  els.botPanelAlgorithm.classList.toggle('hidden', !isAlgorithm);
  els.botPanelPrompt.classList.toggle('hidden', !isPrompt);
  for (const btn of els.botDialog.querySelectorAll('[data-bot-tab]')) {
    const active = btn.dataset.botTab === tab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  }
}

function renderBotPromptText() {
  if (!window.AgentPromptUI) return;
  const map = availableMaps.find(item => item.id === botLobbyMapId);
  els.botPromptText.value = window.AgentPromptUI.buildPrompt({
    serverUrl: window.location.origin,
    gameId: gameId || '',
    players: String(botLobbyMaxPlayers || 2),
    mapName: map?.name || botLobbyMapId || '对战',
    mapId: botLobbyMapId || 'default',
    aiName: els.botPromptName.value.trim() || '<AI名字>',
    skillInstalled: els.botPromptSkill.checked,
  });
}

async function copyBotPrompt() {
  const ok = await window.AgentPromptUI.copyText(els.botPromptText.value);
  toast(ok ? '提示词已复制，发给对方 AI 即可' : '复制失败，请在文本框手动全选复制', ok ? 'ok' : 'err');
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

async function confirmAddAlgorithm() {
  if (!gameId || !hostToken) return;
  const botType = els.algorithmType.value;
  if (!botType) return toast('请选择算法类型', 'err');
  els.btnAlgorithmConfirm.disabled = true;
  try {
    const res = await fetch(`/api/games/${encodeURIComponent(gameId)}/bots/algorithm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Host-Token': hostToken },
      body: JSON.stringify({ botType, name: els.algorithmName.value.trim() || undefined }),
    });
    const data = await res.json();
    if (!res.ok) return toast(data.error || '添加算法 AI 失败', 'err');
    closeBotDialog();
    renderLobbySummary(data.lobby, els.lobbySummary, true);
    toast('算法 AI 已加入，等待开局', 'ok');
  } catch {
    toast('添加算法 AI 失败：无法连接服务器', 'err');
  } finally {
    els.btnAlgorithmConfirm.disabled = false;
  }
}

els.btnBotConfirm.addEventListener('click', confirmAddBot);
els.btnBotCancel.addEventListener('click', closeBotDialog);
els.btnAlgorithmConfirm.addEventListener('click', confirmAddAlgorithm);
els.btnAlgorithmCancel.addEventListener('click', closeBotDialog);
els.algorithmType.addEventListener('change', resetAlgorithmName);
els.botDialogBackdrop.addEventListener('click', closeBotDialog);
for (const btn of els.botDialog.querySelectorAll('[data-bot-tab]')) {
  btn.addEventListener('click', () => switchBotTab(btn.dataset.botTab));
}
els.botPromptName.addEventListener('input', renderBotPromptText);
els.botPromptSkill.addEventListener('change', renderBotPromptText);
els.btnBotPromptCopy.addEventListener('click', copyBotPrompt);
els.btnBotPromptClose.addEventListener('click', closeBotDialog);

/** 房间卡展开 / 收起：同一帧内量出展开态真实高度，再用 max-height 过渡，收起后动画结束才 display:none。 */
function animateRoomCard(card, visible) {
  if (!card) return;
  const isOpen = card.classList.contains('room-open');
  if (visible === isOpen) {
    if (visible) card.style.maxHeight = 'none';
    return;
  }
  card.classList.remove('hidden');
  // 页签没激活时量不到高度，直接按展开态显示，避免记下一个错误的 max-height。
  if (!card.offsetParent) {
    card.classList.add('room-open');
    card.style.maxHeight = 'none';
    return;
  }
  card.classList.add('room-measure');
  card.classList.add('room-open');
  const target = `${card.scrollHeight + 2}px`;
  if (visible) {
    card.classList.remove('room-open');
    card.style.maxHeight = '0px';
    void card.offsetHeight;
    card.classList.remove('room-measure');
    card.classList.add('room-open');
    card.style.maxHeight = target;
    window.setTimeout(() => {
      if (card.classList.contains('room-open')) card.style.maxHeight = 'none';
    }, 460);
    return;
  }
  card.style.maxHeight = target;
  void card.offsetHeight;
  card.classList.remove('room-measure');
  card.classList.remove('room-open');
  card.style.maxHeight = '0px';
  window.setTimeout(() => {
    if (card.classList.contains('room-open')) return;
    card.classList.add('hidden');
    card.style.maxHeight = '';
  }, 460);
}

function setCreateRoomVisible(visible) {
  if (!els.createResult) return;
  // 不整页切换：创建表单留在原地，房态把名称 / 人数换成只读值、地图收小、按钮退场。
  els.createForm?.classList.toggle('room-active', visible);
  // 房间卡展开时整页上移一档（`.panel.room-active { margin: 16px auto }`）：
  // 之前只给 create-form 加了 class，面板一直停在大厅态的 32px 边距上，白吃 16px。
  els.joinPanel?.classList.toggle('room-active', visible);
  els.createName?.classList.toggle('hidden', visible);
  els.createNameStatic?.classList.toggle('hidden', !visible);
  els.maxPlayers?.classList.toggle('hidden', visible);
  els.createMaxPlayersStatic?.classList.toggle('hidden', !visible);
  if (!visible) {
    // 返回设置时恢复可编辑，并回到默认「房主不参战」。
    if (els.hostParticipate) {
      els.hostParticipate.disabled = false;
      els.hostParticipate.checked = false;
    }
    els.hostParticipate?.closest('.checkbox-field')?.classList.remove('is-room-static');
  }
  syncCreateFormStatic();
  // 退出房态地图摘要要回到「下一局」的口径，不能继续显示「本局使用随机地图」。
  if (!visible) renderLobbyMapSummary();
  animateRoomCard(els.createResult, visible);
}

function setJoinRoomVisible(visible) {
  els.joinForm?.classList.toggle('hidden', visible);
  // 与房主卡同款：加入者卡展开时整页上移一档，别把大厅态的 32px 边距留在屏幕上。
  els.joinPanel?.classList.toggle('room-active', visible);
  if (visible) {
    animateRoomCard(els.joinResult, true);
  } else {
    renderJoinMapCard(null);
    animateRoomCard(els.joinResult, false);
  }
  if (visible && els.joinStatusText) {
    els.joinStatusText.textContent = '';
    els.joinStatusText.classList.add('hidden');
  }
}

function clearCreateRoomView() {
  setCreateRoomVisible(false);
  roomMapId = null;
  hostLobbySnapshot = null;
  if (els.createdGameId) els.createdGameId.textContent = '';
  if (els.createdHostToken) els.createdHostToken.textContent = '';
  if (els.createdToken) els.createdToken.textContent = '';
  if (els.createRoomStatus) els.createRoomStatus.textContent = '等待玩家加入';
  els.createdPlayerTokenRow?.classList.add('hidden');
  if (els.lobbySummary) els.lobbySummary.innerHTML = '';
}

function clearJoinRoomView() {
  setJoinRoomVisible(false);
  if (els.joinPlayerToken) els.joinPlayerToken.textContent = '';
  els.joinPlayerTokenRow?.classList.add('hidden');
  if (els.joinRoomStatus) els.joinRoomStatus.textContent = '';
  if (els.joinLobbySummary) els.joinLobbySummary.innerHTML = '';
  if (els.joinStatusText) {
    els.joinStatusText.textContent = '';
    els.joinStatusText.classList.add('hidden');
  }
}

/**
 * 创建和加入共用同一份 gameId / token 会话，切到另一局前必须让用户知道
 * 自己正在离开哪个大厅：房主加入别人会丢房主视图，加入者再建/再加入会离开原房间。
 * 只做提示，不删除服务器上的等待房间（服务端没有房主取消大厅的接口）。
 */
function confirmLobbySwitch(target, nextGameId = '') {
  if (hostToken && target === 'join') {
    return window.UIDialog.confirm({
      title: '离开自己创建的房间？',
      message: `你正在自己创建的房间（${gameId}）里等待。加入其他房间后会离开这个大厅，房主视图也会收起；原房间仍会留在等待列表中。`,
      confirmText: '继续加入',
      tone: 'warning',
    });
  }
  if (myToken && !hostToken) {
    if (target === 'create') {
      return window.UIDialog.confirm({
        title: '离开当前房间？',
        message: `你已加入房间（${gameId}）。创建新房间会离开当前房间，原房间仍会保留。`,
        confirmText: '继续创建',
        tone: 'warning',
      });
    }
    if (target === 'join' && nextGameId && nextGameId !== gameId) {
      return window.UIDialog.confirm({
        title: '切换到其他房间？',
        message: `你已加入房间（${gameId}）。加入其他房间会离开当前房间，原房间仍会保留。`,
        confirmText: '继续加入',
        tone: 'warning',
      });
    }
  }
  return Promise.resolve(true);
}

function showJoinError(message) {
  setJoinRoomVisible(false);
  if (els.joinStatusText) {
    els.joinStatusText.textContent = message;
    els.joinStatusText.classList.remove('hidden');
  }
}

/** 房主在大厅里切换自己的参战席位：已参战 → 退出战斗；未参战 → 加入战斗。 */
async function toggleHostSeat() {
  if (!gameId || !hostToken) return toast('缺少房主凭证', 'err');
  if (hostSeatBusy) return;
  const joining = !myToken;
  if (!joining) {
    const ok = await window.UIDialog.confirm({
      title: '退出战斗？',
      message: '退出后本局不再有你参战，房主身份仍保留，可随时点「加入战斗」回到席位。',
      confirmText: '退出战斗',
      tone: 'warning',
    });
    if (!ok) return;
  }
  hostSeatBusy = true;
  syncHostSeatUi();
  try {
    if (joining) {
      // 复用房主创建时的名称；留空则由服务端分配默认名。
      const res = await fetch(`/api/games/${encodeURIComponent(gameId)}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Host-Token': hostToken },
        body: JSON.stringify({ name: els.createName?.value.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) return toast(data.error || '加入战斗失败', 'err');
      myToken = data.player.token;
      myPlayer = data.player.id;
      sessionName = data.lobby?.players?.find(player => player.id === myPlayer)?.name
        || els.createName?.value.trim() || null;
      if (sessionName && els.createName) els.createName.value = sessionName;
      persistSession();
      renderLobbySummary(data.lobby, els.lobbySummary, true);
      toast('已加入战斗', 'ok');
    } else {
      // 用玩家凭证退出自己的席位；房主凭证与服务端房间都不受影响。
      const res = await fetch(`/api/games/${encodeURIComponent(gameId)}/leave`, {
        method: 'POST',
        headers: { 'X-Player-Token': myToken },
      });
      const data = await res.json();
      if (!res.ok) return toast(data.error || '退出战斗失败', 'err');
      myToken = null;
      myPlayer = null;
      persistSession();
      await refreshLobbySummary();
      syncHostSeatUi();
      toast('已退出战斗，房主身份保留', 'ok');
    }
  } catch {
    toast(`${joining ? '加入' : '退出'}战斗失败：无法连接服务器`, 'err');
  } finally {
    hostSeatBusy = false;
    syncHostSeatUi();
  }
}

async function startHostedGame() {
  if (!gameId || !hostToken) return toast('缺少房主凭证', 'err');
  if (hostLobbySnapshot && hostLobbySnapshot.phase !== 'lobby') {
    return toast(hostLobbySnapshot.phase === 'game_over' ? '对局已结束，不能再次开始' : '对局已经开始', 'err');
  }
  const res = await fetch(`/api/games/${gameId}/start`, {
    method: 'POST',
    headers: { 'X-Host-Token': hostToken },
  });
  const data = await res.json();
  if (!res.ok) return toast(data.error || '开始失败', 'err');
  toast('对局已开始', 'ok');
  stopLobbyPolling();
  await enterGame();
}

els.btnEndTurn.addEventListener('click', async () => { if (playback.isActive()) return; if (await apiAction(`/api/games/${gameId}/end-turn`, {})) afterAction(isSimultaneous() ? '本回合计划已确认，等待全员提交' : '回合结束'); });
// 退出对局是纯本地行为：清掉会话回到大厅页；席位保留、对局继续，由房主管理残留席位。
els.btnQuitGame?.addEventListener('click', async () => {
  const ok = await window.UIDialog.confirm({
    title: '退出本局对局？',
    message: '退出后将回到大厅页，本局无法再继续操作。席位会保留，对局仍继续进行。',
    confirmText: '退出对局',
    tone: 'danger',
  });
  if (!ok) return;
  clearSavedSession();
  window.location.reload();
});
els.btnSkipReplay?.addEventListener('click', () => playback.skip());
// 本局规则速查：内容随对局配置实时生成（进行中对局与历史回放各显示当时数值）。
const rulesSheet = window.RulesSheet?.attach({ triggerEl: els.btnRules, getConfig: () => gameConfig });
els.btnRefresh.addEventListener('click', async () => { await loadFullState(); drawBoard(); renderSidebar(); toast('状态已刷新', 'ok'); });
els.btnCreate.addEventListener('click', async () => {
  if (!(await confirmLobbySwitch('create'))) return;
  // 换房间前先停掉旧房间的轮询：否则旧响应会落到新房间的卡片上。
  stopLobbyPolling();
  const hadJoinedRoom = Boolean(myToken && !hostToken && gameId);
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
    // 新房间：旧房间的座位同步状态（含 stopped 停机门）一律复位。
    startSeatSync();
    sessionName = data.lobby?.players?.find(player => player.id === myPlayer)?.name
      || els.createName.value.trim() || null;
    if (sessionName) els.createName.value = sessionName;
    persistSession();
    clearJoinRoomView();
    els.createdGameId.textContent = gameId;
    els.createdHostToken.textContent = hostToken;
    renderLobbySummary(data.lobby, els.lobbySummary, true);
    roomMapId = data.lobby?.mapId || null;
    setCreateRoomVisible(true);
    applyRoomMapSelection();
    if (hadJoinedRoom) toast('已创建新房间，离开此前加入的房间（原房间仍保留）', 'info');
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
  if (!(await confirmLobbySwitch('join', gid))) return;
  // 同 btnCreate：换房间前停掉旧轮询。
  stopLobbyPolling();
  const hadHostedRoom = Boolean(hostToken);
  const hadJoinedRoom = Boolean(myToken && !hostToken && gameId);
  const previousGameId = gameId;
  const res = await fetch(`/api/games/${gid}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: els.joinName.value.trim() || undefined }) });
  const data = await res.json();
  if (!res.ok) { showJoinError(`加入失败: ${data.error}`); refreshAvailableGames(); return; }
  stopLobbyPolling();
  myToken = data.player.token;
  myPlayer = data.player.id;
  gameId = gid;
  hostToken = null;
  sessionName = data.lobby?.players?.find(player => player.id === myPlayer)?.name
    || els.joinName.value.trim() || null;
  if (sessionName) els.joinName.value = sessionName;
  persistSession();
  // 加入成功后清掉创建页签里旧房间的凭证与摘要，避免两套房间信息混在一起。
  clearCreateRoomView();
  if (hadHostedRoom) toast('已加入新房间，离开自己创建的房间（原房间仍留在等待列表）', 'info');
  else if (hadJoinedRoom && gid !== previousGameId) toast('已切换到新房间，离开此前加入的房间（原房间仍保留）', 'info');
  const roomStatus = data.lobby?.phase === 'active' ? '加入成功，正在进入游戏…' : '加入成功，等待房主开始';
  els.joinPlayerToken.textContent = myToken;
  els.joinPlayerTokenRow.classList.remove('hidden');
  setJoinRoomVisible(true);
  renderLobbySummary(data.lobby, els.joinLobbySummary);
  if (els.joinRoomStatus) els.joinRoomStatus.textContent = roomStatus;
  renderJoinMapCard(data.lobby);
  refreshAvailableGames();
  statusBadge(data.lobby?.phase === 'active' ? '正在进入' : '大厅中', 'idle');
  // 新房间：座位同步状态复位（旧房间的 stopped 停机门不能带过来）。
  startSeatSync();
  if (data.lobby?.phase === 'active') await enterGame();
  else {
    startLobbyPolling();
    subscribeLobbyStart();
  }
});
els.btnStartGame.addEventListener('click', startHostedGame);
els.btnHostParticipate?.addEventListener('click', toggleHostSeat);
els.btnConnectCreate.addEventListener('click', enterGame);
els.btnConnectJoin?.addEventListener('click', enterGame);

// 房间卡上的返回入口：只切换回表单，不隐式删除服务器上的等待房间。
els.btnCreateAgain?.addEventListener('click', async () => {
  const ok = await window.UIDialog.confirm({
    title: '返回设置？',
    message: '当前房间仍在等待。返回设置后重新创建会新建另一局，旧房间仍会留在等待列表中。',
    confirmText: '返回设置',
    tone: 'warning',
  });
  if (!ok) return;
  setCreateRoomVisible(false);
  els.createName?.focus();
  toast('已返回设置：点「创建新游戏」会新建一局', 'ok');
});
/** 返回大厅 = 退出当前加入的房间：释放席位、清会话，再回到加入表单。 */
async function leaveJoinedRoom() {
  if (!gameId || !myToken) {
    clearJoinRoomView();
    refreshAvailableGames();
    return;
  }
  // 对局已结束：服务器没有可释放的席位，直接清掉本地会话回大厅（回放仍留在观战页）。
  if (latestLobby?.phase === 'game_over') {
    stopLobbyPolling();
    if (sse) { sse.close(); sse = null; }
    clearSavedSession();
    clearJoinRoomView();
    statusBadge('未加入', 'idle');
    refreshAvailableGames();
    toast('对局已结束，已返回大厅', 'info');
    return;
  }
  const ok = await window.UIDialog.confirm({
    title: '返回大厅？',
    message: '返回大厅会退出当前房间并释放席位，需要重新加入才能继续等待。',
    confirmText: '退出房间',
    tone: 'warning',
  });
  if (!ok) return;
  if (els.btnJoinAgain) els.btnJoinAgain.disabled = true;
  try {
    const res = await fetch(`/api/games/${encodeURIComponent(gameId)}/leave`, {
      method: 'POST',
      headers: { 'X-Player-Token': myToken },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok && res.status !== 401 && res.status !== 404) {
      if (data.code === 'game_already_started') {
        // 对局已经开始，席位已锁定：直接进入对局。
        await enterGame();
        return;
      }
      return toast(data.error || '退出房间失败', 'err');
    }
    stopLobbyPolling();
    if (sse) { sse.close(); sse = null; }
    clearSavedSession();
    clearJoinRoomView();
    statusBadge('未加入', 'idle');
    refreshAvailableGames();
    toast(res.ok ? '已退出房间' : '席位已不存在，已返回大厅', res.ok ? 'ok' : 'info');
  } catch {
    toast('退出房间失败：无法连接服务器', 'err');
  } finally {
    if (els.btnJoinAgain) els.btnJoinAgain.disabled = false;
  }
}
// 返回大厅必须真正退出房间，否则再次加入同一房间会多出一个同名席位。
els.btnJoinAgain?.addEventListener('click', leaveJoinedRoom);

// 地图库弹层：摘要卡只负责打开，真正切图在弹层里确认。
els.btnChangeMap?.addEventListener('click', openMapDialog);
els.btnMapDialogClose?.addEventListener('click', closeMapDialog);
els.btnMapDialogCancel?.addEventListener('click', closeMapDialog);
els.mapDialogBackdrop?.addEventListener('click', closeMapDialog);
els.btnMapDialogApply?.addEventListener('click', applyMapDialog);
document.querySelectorAll('.map-dialog-tab').forEach(tab => {
  tab.addEventListener('click', () => showMapDialogTab(tab.dataset.mapTab));
});
els.mapFilterText?.addEventListener('input', () => {
  mapFilterText = els.mapFilterText.value;
  renderMapPicker(availableMaps);
});
els.mapFilterMode?.addEventListener('change', () => {
  mapFilterMode = els.mapFilterMode.value;
  renderMapPicker(availableMaps);
});
els.btnMapRandomRefresh?.addEventListener('click', () => {
  // 换一张走模块统一入口：种子锁定时模块会拒绝并保持这张图。
  window.RandomMapUI?.reroll(true);
});
els.randomMapOptions?.addEventListener('input', scheduleMapDialogPreview);
els.randomMapOptions?.addEventListener('change', scheduleMapDialogPreview);
els.maxPlayers?.addEventListener('change', () => {
  // 浏览随机页签但尚未选中随机图时，人数变化也要刷新弹层预览。
  if (mapDialogOpen && mapDialogTab === 'random' && !window.RandomMapUI?.isSelected()) {
    scheduleMapDialogPreview();
  }
});
async function enterGame() {
  closeMapDialog();
  // 进对局：复位座位同步状态（清待发意图 / 失败态 / 定时器，并推进 seq 作废在途回调）。
  // 这里不设 stopped 闸门：进对局后不再发请求由 flushSeatSync 里的 `latestLobby.phase !== 'lobby'`
  // 门槛负责；stopped 只因「对局已开始」事件设置（handleSeatOutcome 的 started 分支），且必须可复位，
  // 否则会变成单向门，把之后所有新房间的座位控件和「添加 AI」都锁死。
  // 草稿视图这里不清：下次大厅摘要对账时 adoptServerLobby() 会清，对局内也用不到。
  startSeatSync();
  const ok = await loadFullState();
  if (!ok || !state.cells.length) {
    // 这颗按钮只在对局 active 时出现，正常不会走到这里：只可能是开局瞬间事件流还没就绪的竞态。
    // 不回读大厅、不刷新整页，提示后让用户稍后再点。
    return toast('获取对局状态失败，请稍后重试', 'err');
  }
  if (!myToken) {
    // 未参战（房主默认旁观）或只有观战会话：对局开始后转到观战页。
    window.location.href = `/spectator.html?gameId=${encodeURIComponent(gameId)}`;
    return;
  }
  stopLobbyPolling();
  stopAvailableGamesRefresh();
  if (sse) { sse.close(); sse = null; }
  els.joinPanel.classList.add('hidden'); els.gameUI.classList.remove('hidden');
  subscribeSse(); drawBoard(); renderSidebar(); statusBadge('已连接', 'ok');
}

// 刷新/重开后用本地会话回到对局：active 直接进局，lobby 恢复大厅视图，对局已不存在则清会话。
async function reconnectSavedSession() {
  if (!gameId) return;
  let lobby = null;
  try {
    const res = await fetch(`/api/games/${encodeURIComponent(gameId)}/lobby`);
    lobby = res.ok ? await res.json() : null;
  } catch {
    return; // 服务器不可达时留在大厅页，不误清会话。
  }
  if (!lobby) {
    clearSavedSession();
    return;
  }
  if (myPlayer && !(lobby.players || []).some(player => player.id === myPlayer)) {
    // 已被房主移出大厅：清掉残留会话，避免每次打开都指向旧局。
    clearSavedSession();
    return;
  }
  if (lobby.phase === 'active') {
    await enterGame();
    return;
  }
  restoreLobbyView(lobby);
}

function restoreLobbyView(lobby) {
  // 刷新/重开恢复房间：座位同步状态复位，别把上一个对局留下的停机门带进来。
  startSeatSync();
  if (hostToken) {
    clearJoinRoomView();
    roomMapId = lobby.mapId || null;
    els.createdGameId.textContent = gameId;
    els.createdHostToken.textContent = hostToken;
    renderLobbySummary(lobby, els.lobbySummary, true);
    setCreateRoomVisible(true);
    // 建房表单里的地图摘要就是本局地图：恢复成房间实际用的那张，而不是 /api/maps 的第一张。
    applyRoomMapSelection();
    statusBadge(lobby.phase === 'game_over' ? '已结束' : '大厅中', 'idle');
  } else if (myToken) {
    clearCreateRoomView();
    document.querySelector('.lobby-tab[data-tab="join"]')?.click();
    if (els.joinPlayerToken) els.joinPlayerToken.textContent = myToken;
    els.joinPlayerTokenRow?.classList.remove('hidden');
    renderLobbySummary(lobby, els.joinLobbySummary);
    renderJoinMapCard(lobby);
    setJoinRoomVisible(true);
    statusBadge(lobby.phase === 'game_over' ? '已结束' : '大厅中', 'idle');
  } else {
    return; // 只有 gameId 的观战会话：维持大厅页现状。
  }
  // 已结束的房间不会再收到开局事件，不必继续轮询。
  if (lobby.phase === 'lobby') startLobbyPolling();
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
els.availableGamesModeFilter?.addEventListener('change', () => {
  availableGamesPage = 1;
  if (availableGamesData.length) renderAvailableGames(availableGamesData);
});
els.availableGamesMapFilter?.addEventListener('change', () => {
  availableGamesPage = 1;
  if (availableGamesData.length) renderAvailableGames(availableGamesData);
});
document.addEventListener('click', e => {
  const pageBtn = e.target.closest?.('[data-games-page]');
  if (pageBtn && !pageBtn.disabled) {
    const action = pageBtn.dataset.gamesPage;
    if (action === 'next') availableGamesPage += 1;
    else if (action === 'prev') availableGamesPage -= 1;
    else if (action === 'first') availableGamesPage = 1;
    else if (action === 'last') availableGamesPage = Number.POSITIVE_INFINITY;
    if (availableGamesData.length) renderAvailableGames(availableGamesData);
    return;
  }
  const availableGame = e.target.closest?.('[data-available-game-id]');
  if (availableGame) {
    els.gameId.value = availableGame.dataset.availableGameId;
    els.availableGames.querySelectorAll('.available-game').forEach(button => {
      const selected = button === availableGame;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
      const label = button.querySelector('.available-game-action-label');
      if (label) label.textContent = selected ? '已选' : '选择';
    });
    return;
  }
  const addBot = e.target.closest?.('[data-add-bot]');
  if (addBot) {
    e.preventDefault();
    openBotDialog();
    return;
  }
  const renameSelfButton = e.target.closest?.('[data-rename-self]');
  if (renameSelfButton) {
    e.preventDefault();
    renameSelf();
    return;
  }
  const maxPlayersButton = e.target.closest?.('[data-edit-max-players]');
  if (maxPlayersButton) {
    e.preventDefault();
    changeLobbyMaxPlayers();
    return;
  }
  const seatUp = e.target.closest?.('[data-seat-up]');
  if (seatUp) {
    e.preventDefault();
    moveSeatRow(Number(seatUp.dataset.seatUp), -1);
    return;
  }
  const seatDown = e.target.closest?.('[data-seat-down]');
  if (seatDown) {
    e.preventDefault();
    moveSeatRow(Number(seatDown.dataset.seatDown), 1);
    return;
  }
  const seatFirstButton = e.target.closest?.('[data-seat-first]');
  if (seatFirstButton) {
    e.preventDefault();
    setSeatFirstRow(Number(seatFirstButton.dataset.seatFirst));
    return;
  }
  const seatTopButton = e.target.closest?.('[data-seat-top]');
  if (seatTopButton) {
    e.preventDefault();
    moveSeatRowToTop(Number(seatTopButton.dataset.seatTop));
    return;
  }
  const seatResetButton = e.target.closest?.('[data-seat-reset]');
  if (seatResetButton) {
    e.preventDefault();
    resetSeatOrder();
    return;
  }
  // 同步状态点的失败态可点：用当前视图重提一次。
  const seatSyncButton = e.target.closest?.('.lobby-seat-sync');
  if (seatSyncButton) {
    e.preventDefault();
    if (seatSyncButton.dataset.seatSync === 'error') retrySeatSync();
    return;
  }
  // 房间卡「更多 ▾」：HOST / PLAYER 凭证默认收起（v6 省 ~72px）。
  if (e.target.closest?.('#btn-created-more')) {
    e.preventDefault();
    toggleCreatedMore();
    return;
  }
  const button = e.target.closest?.('[data-kick-player]');
  if (!button) return;
  e.preventDefault();
  kickLobbyPlayer(button.dataset.kickPlayer);
});
function copyText(text) {
  // 优先使用 Clipboard API，回退到 execCommand
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
  }
}

function onCopySuccess(btn) {
  btn.classList.add('copied');
  clearTimeout(btn._copiedTimer);
  btn._copiedTimer = setTimeout(() => btn.classList.remove('copied'), 1500);
  toast('已复制', 'ok');
}

document.querySelectorAll('.btn-copy').forEach(btn => btn.addEventListener('click', async () => {
  const text = $(btn.dataset.copy)?.textContent || '';
  if (!text) return toast('没有可复制的内容', 'err');
  try {
    await copyText(text);
    onCopySuccess(btn);
  } catch {
    toast('复制失败', 'err');
  }
}));
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeMapDialog(); closeBotDialog(); deselect(); } });
document.addEventListener('click', e => { const popup = $('map-popup'); if (!popup.classList.contains('hidden') && !popup.contains(e.target) && e.target !== els.canvas) closePopup(); });
els.btnSettings?.addEventListener('click', e => {
  e.stopPropagation();
  fillSettingsFromSession();
  els.settingsPopover?.classList.toggle('open');
});
document.addEventListener('click', e => {
  if (!els.settingsPopover || !els.btnSettings) return;
  if (!els.settingsPopover.contains(e.target) && e.target !== els.btnSettings) {
    els.settingsPopover.classList.remove('open');
  }
});
els.btnSaveControlToken?.addEventListener('click', e => {
  e.stopPropagation();
  saveControlToken();
});
els.btnSaveSession?.addEventListener('click', e => {
  e.stopPropagation();
  saveSessionFromSettings();
});
els.btnEnterSession?.addEventListener('click', e => {
  e.stopPropagation();
  enterGameFromSettings();
});
els.btnClearSession?.addEventListener('click', e => {
  e.stopPropagation();
  clearSessionFromSettings();
});
restoreSessionIntoMemory();
fillSettingsFromSession();
reconnectSavedSession();
window.RandomMapUI?.setPreviewRenderer(renderMapPreview);
if (window.RandomMapUI) {
  window.RandomMapUI.onPreview = () => {
    renderMapDialogRandomFacts();
    // 摘要卡与弹层共用同一份随机预览：参数一改，外面的地图和图例也要跟着变。
    if (els.mapSelect?.value === 'random') renderLobbyMapSummary();
  };
  renderMapDialogRandomFacts();
}
loadMapList();
startAvailableGamesRefresh();
requestAnimationFrame(renderLoop);
