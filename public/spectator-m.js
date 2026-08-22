const HEX_SIZE = 28;
const PAD = 42;
const SQRT3 = Math.sqrt(3);

const TERRAIN = {
  plain: '#111923',
  water: '#183a55',
  blocker: '#393f46',
};
const PLAYER_IDS = [
  'player_a', 'player_b', 'player_c', 'player_d',
  'player_e', 'player_f', 'player_g', 'player_h',
];
const OWNER_COLORS = {
  player_a: '#66ccff',
  player_b: '#ff9966',
  player_c: '#9fdf6f',
  player_d: '#d98cff',
  player_e: '#ffd166',
  player_f: '#72e0d1',
  player_g: '#f27a9a',
  player_h: '#a7b7ff',
};
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
const APP_VERSION = window.APP_VERSION;
const REPLAY_EXPORT_FORMAT = 'hex-v2-replay';
const REPLAY_SCHEMA_VERSION = APP_VERSION;

let gameConfig = null;
let playerNames = defaultPlayerNames();
let allEvents = [];
let currentStep = -1;
let playing = false;
let playTimer = null;
let liveSse = null;
let pinnedReplayStep = false;
let importedReplayMeta = null;
let state = null;
let hoverCell = null;
let layout = { minX: 0, minY: 0, width: 840, height: 840 };
let gamesList = [];
// mobile board transform (forked from app.js for phone shell)
let boardScale = 1;
let boardPanX = 0;
let boardPanY = 0;
const BOARD_SCALE_MIN = 0.4;
const BOARD_SCALE_MAX = 3;
const TAP_MOVE_THRESHOLD = 8;
const boardWorld = document.getElementById('board-world');
const boardViewport = document.getElementById('board-viewport');

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const boardAnimation = window.BoardAnimation.create({ hexToPixel, ownerColor });
const gameSelect = document.getElementById('game-select');
const gamePicker = document.querySelector('.game-picker');
const gamePickerButton = document.getElementById('game-picker-button');
const gamePickerLabel = document.getElementById('game-picker-label');
const gamePickerMenu = document.getElementById('game-picker-menu');
const refreshBtn = document.getElementById('refresh-list');
const forceAdjudicateBtn = document.getElementById('force-adjudicate');
const deleteGameBtn = document.getElementById('delete-game');
const statusEl = document.getElementById('status');
const resourcesEl = document.getElementById('resources');
const scorePanelEl = document.getElementById('score-panel');
const turnInfoEl = document.getElementById('turn-info');
const eventsEl = document.getElementById('events');
const detailEl = document.getElementById('detail-content');
const cellInfoEl = document.getElementById('cell-info');
const selDetailEl = document.getElementById('selection-detail');
const btnStart = document.getElementById('btn-start');
const btnPrev = document.getElementById('btn-prev');
const btnPlay = document.getElementById('btn-play');
const btnNext = document.getElementById('btn-next');
const btnEnd = document.getElementById('btn-end');
const speedSelect = document.getElementById('speed-select');
const stepInfo = document.getElementById('step-info');
const timeline = document.getElementById('timeline');
const timelineMarkers = document.getElementById('timeline-markers');
const autoRefreshCb = document.getElementById('auto-refresh');
const followLatestCb = document.getElementById('follow-latest');
const refreshIntervalInput = document.getElementById('refresh-interval');
const btnSettings = document.getElementById('btn-settings');
const settingsPopover = document.getElementById('settings-popover');
const btnExportJson = document.getElementById('btn-export-json');
const btnImport = document.getElementById('btn-import');
const importFile = document.getElementById('import-file');
const settingsControlToken = document.getElementById('settings-control-token');
const btnSaveControlToken = document.getElementById('btn-save-control-token');


function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function playerLabel(owner) {
  const index = PLAYER_IDS.indexOf(owner);
  return index >= 0 ? String.fromCharCode(65 + index) : String(owner || '?').replace(/^player_/, '').toUpperCase();
}

function defaultPlayerNames() {
  return Object.fromEntries(PLAYER_IDS.map(owner => [owner, `玩家 ${playerLabel(owner)}`]));
}

function playerName(owner) {
  return playerNames[owner] || `玩家 ${playerLabel(owner)}`;
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

function isSimultaneousReplay() {
  return gameConfig?.mode === 'simultaneous';
}

function replayActionUsageText() {
  const maxActions = gameConfig?.balance?.actionsPerTurn ?? 0;
  if (!maxActions) return '';
  if (!isSimultaneousReplay()) return `${state?.turn?.actionsUsed ?? 0}/${maxActions}`;
  const entries = Object.entries(state?.turn?.actionsUsedByPlayer || {});
  return entries.length
    ? entries.map(([owner, used]) => `${playerLabel(owner)} ${used}/${maxActions}`).join(' · ')
    : '各玩家独立计数';
}

function playerNameControl(owner) {
  return `<button class="player-name ${ownerClass(owner)}" data-rename-player="${owner}" title="更改玩家名字">${esc(playerName(owner))}</button>`;
}

function ownerClass(owner) {
  return owner ? String(owner).replace(/_/g, '-') : 'neutral';
}

function ownerColor(owner) {
  return OWNER_COLORS[owner] || '#9aa7b3';
}

function joinedPlayerIds() {
  if (!state) return [];
  const seen = new Set(Object.keys(state.players || {}));
  for (const owner of Object.keys(state.resources || {})) seen.add(owner);
  for (const hq of state.headquarters?.values?.() || []) seen.add(hq.owner);
  for (const unit of state.units?.values?.() || []) seen.add(unit.owner);
  return PLAYER_IDS.filter(owner => seen.has(owner));
}

function key(pos) { return `${pos.q},${pos.r}`; }
function hexDistance(a, b) {
  return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs((-a.q - a.r) - (-b.q - b.r)));
}
function hexToRaw(q, r) {
  return { x: HEX_SIZE * SQRT3 * (q + r / 2), y: HEX_SIZE * 1.5 * r };
}
function hexToPixel(q, r) {
  const raw = hexToRaw(q, r);
  return { x: raw.x - layout.minX + PAD, y: raw.y - layout.minY + PAD };
}
function cubeRound(q, r) {
  let x = q, z = r, y = -x - z;
  let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
  const xDiff = Math.abs(rx - x), yDiff = Math.abs(ry - y), zDiff = Math.abs(rz - z);
  if (xDiff > yDiff && xDiff > zDiff) rx = -ry - rz;
  else if (yDiff > zDiff) ry = -rx - rz;
  else rz = -rx - ry;
  return { q: rx, r: rz };
}
function pixelToHex(px, py) {
  const x = px + layout.minX - PAD;
  const y = py + layout.minY - PAD;
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
  if (!boardViewport || !canvas.width) return;
  const vw = boardViewport.clientWidth;
  const vh = boardViewport.clientHeight;
  // absolute children can leave stage at 0x0 until layout stretch applies
  if (vw < 2 || vh < 2) {
    requestAnimationFrame(fitBoardToViewport);
    return;
  }
  const sx = vw / canvas.width;
  const sy = vh / canvas.height;
  boardScale = clampBoardScale(Math.min(sx, sy) * 0.96);
  boardPanX = (vw - canvas.width * boardScale) / 2;
  boardPanY = (vh - canvas.height * boardScale) / 2;
  setBoardTransform();
}
function eventToCanvasPoint(e) {
  if (!boardViewport) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / Math.max(1, rect.width)),
      y: (e.clientY - rect.top) * (canvas.height / Math.max(1, rect.height)),
    };
  }
  const rect = boardViewport.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left - boardPanX) / boardScale,
    y: (e.clientY - rect.top - boardPanY) / boardScale,
  };
}
function hexCorners(q, r, inset = 0) {
  const c = hexToPixel(q, r);
  const size = HEX_SIZE - inset;
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 180 * (60 * i - 30);
    pts.push({ x: c.x + size * Math.cos(angle), y: c.y + size * Math.sin(angle) });
  }
  return pts;
}
function pathHex(q, r, inset = 0) {
  const pts = hexCorners(q, r, inset);
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}
function computeLayout(cells) {
  const pts = cells.flatMap(c => hexCornersRaw(c.q, c.r));
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  layout = {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    width: Math.ceil(Math.max(...xs) - Math.min(...xs) + PAD * 2),
    height: Math.ceil(Math.max(...ys) - Math.min(...ys) + PAD * 2),
  };
  canvas.width = layout.width;
  canvas.height = layout.height;
  requestAnimationFrame(fitBoardToViewport);
}
function hexCornersRaw(q, r) {
  const c = hexToRaw(q, r);
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 180 * (60 * i - 30);
    pts.push({ x: c.x + HEX_SIZE * Math.cos(angle), y: c.y + HEX_SIZE * Math.sin(angle) });
  }
  return pts;
}

function createEmptyState() {
  return {
    players: {},
    map: { radius: 8, cells: [], terrainCells: [] },
    cells: [],
    controlPoints: new Map(),
    headquarters: new Map(),
    units: new Map(),
    resources: {},
    turn: {
      roundNumber: 1,
      turnNumber: 1,
      currentPlayerId: null,
      currentOwner: null,
      turnOrder: [],
      phase: 'waiting_command',
      actionsUsed: 0,
      actionsUsedByPlayer: {},
    },
    winner: null,
    result: null,
    artillery: null,
    eventLog: [],
  };
}

function entityAt(q, r) {
  for (const u of state.units.values()) if (u.alive && u.q === q && u.r === r) return u;
  for (const h of state.headquarters.values()) if (h.alive && h.q === q && h.r === r) return h;
  return null;
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

function recordActionPoint(s, owner, payload) {
  if (!owner || typeof payload.actionsUsed !== 'number') return;
  const player = s.players?.[owner];
  if (!player) return;
  if (!player.stats) player.stats = { headquartersDamage: 0, unitsDestroyed: 0, playersEliminated: 0, actionPointsUsed: 0, actionMerit: 0 };
  if (gameConfig?.mode === 'simultaneous') {
    const previous = s.turn.actionsUsedByPlayer?.[owner] ?? 0;
    if (payload.actionsUsed <= previous) return;
    if (!s.turn.actionsUsedByPlayer) s.turn.actionsUsedByPlayer = {};
    s.turn.actionsUsedByPlayer[owner] = payload.actionsUsed;
    player.stats.actionPointsUsed = (player.stats.actionPointsUsed ?? 0) + payload.actionsUsed - previous;
    return;
  }
  if (payload.actionsUsed <= (s.turn.actionsUsed ?? 0)) return;
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
      gameConfig = p.config || null;
      const simultaneousStart = p.mode === 'simultaneous' || p.config?.mode === 'simultaneous' || p.map?.mode === 'simultaneous';
      if (p.playerNames) playerNames = { ...p.playerNames };
      s.players = JSON.parse(JSON.stringify(p.players || {}));
      s.turn.turnOrder = [...(p.turnOrder || [])];
      s.turn.currentPlayerId = simultaneousStart ? null : (p.firstPlayer || s.turn.turnOrder[0] || null);
      s.turn.currentOwner = s.turn.currentPlayerId;
      s.turn.roundNumber = 1;
      s.turn.turnNumber = 1;
      s.turn.phase = 'active';
      s.turn.actionsUsed = 0;
      s.turn.actionsUsedByPlayer = {};
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
      s.units.set(p.unitId, {
        id: p.unitId, owner: p.owner, type: p.unitType, q: p.q, r: p.r,
        hp: p.hp, maxHp: p.hp, attack: p.attack, defense: p.defense,
        moveRange: p.moveRange, attackRange: p.attackRange,
        alive: true, hasMoved: true, hasActed: false, actionSpent: true,
        canCapture: !!p.canCapture, healPower: p.healPower, cost: p.unitCost ?? p.cost,
      });
      if (typeof p.actionsUsed === 'number') s.turn.actionsUsed = p.actionsUsed;
      break;
    case 'move': {
      const u = s.units.get(p.unitId);
      recordActionPoint(s, p.owner || u?.owner, p);
      if (u) { u.q = p.toQ; u.r = p.toR; u.hasMoved = true; u.actionSpent = true; }
      if (typeof p.actionsUsed === 'number') s.turn.actionsUsed = p.actionsUsed;
      break;
    }
    case 'attack': {
      const target = s.units.get(p.targetId) || s.headquarters.get(p.targetId);
      const a = s.units.get(p.attackerId);
      recordActionPoint(s, p.owner || a?.owner, p);
      recordActionMerit(s, p.owner || a?.owner, ev.type, p);
      const previousHp = target ? target.hp : null;
      if (target) target.hp = p.targetHp;
      if (a) { a.hasActed = true; a.actionSpent = true; }
      // Track cumulative HQ damage for adjudication scoring (matches server stats).
      if (target && previousHp != null && (p.targetKind === 'headquarters' || s.headquarters.has(p.targetId)) && a) {
        const player = s.players[a.owner];
        if (player) {
          if (!player.stats) player.stats = { headquartersDamage: 0, unitsDestroyed: 0, playersEliminated: 0, actionPointsUsed: 0, actionMerit: 0 };
          const actualDamage = Math.max(0, previousHp - (Number(p.targetHp) || 0));
          player.stats.headquartersDamage += actualDamage;
        }
      }
      if (typeof p.actionsUsed === 'number') s.turn.actionsUsed = p.actionsUsed;
      break;
    }
    case 'heal': {
      const target = s.units.get(p.targetId);
      if (target) target.hp = p.targetHp;
      const support = s.units.get(p.supportId);
      recordActionPoint(s, p.owner || support?.owner, p);
      recordActionMerit(s, p.owner || support?.owner, ev.type, p);
      if (support) { support.hasActed = true; support.actionSpent = true; }
      if (typeof p.actionsUsed === 'number') s.turn.actionsUsed = p.actionsUsed;
      break;
    }
    case 'unit_death': {
      const u = s.units.get(p.unitId);
      if (u) u.alive = false;
      break;
    }
    case 'headquarters_destroyed': {
      const h = s.headquarters.get(p.headquartersId);
      if (h) h.alive = false;
      break;
    }
    case 'control_point_captured': {
      recordActionMerit(s, p.owner, ev.type, p);
      const cp = s.controlPoints.get(p.pointId);
      if (cp) cp.owner = p.owner;
      break;
    }
    case 'control_point_repair': {
      const u = s.units.get(p.unitId);
      if (u) u.hp = p.unitHp;
      break;
    }
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
      for (const u of s.units.values()) {
        if (u.owner === p.owner) { u.hasMoved = false; u.hasActed = false; u.actionSpent = false; }
      }
      if (typeof p.actionsUsed === 'number') s.turn.actionsUsed = p.actionsUsed;
      if (gameConfig?.mode === 'simultaneous') s.turn.actionsUsedByPlayer = {};
      break;
    case 'turn_end':
      s.turn.currentOwner = p.nextPlayerId || p.nextOwner;
      s.turn.currentPlayerId = p.nextPlayerId || p.nextOwner;
      s.turn.roundNumber = p.roundNumber || p.turnNumber;
      s.turn.turnNumber = p.turnNumber || p.roundNumber;
      s.turn.actionsUsed = 0;
      break;
    case 'round_end':
      // Round boundary marker; turn_end that follows carries the new round number.
      break;
    case 'round_start':
      // 同时模式没有 turn_end / reset_actions，由 round_start 携带新回合号并重置单位行动标志。
      s.turn.roundNumber = p.roundNumber || s.turn.roundNumber + 1;
      s.turn.turnNumber = s.turn.roundNumber;
      s.turn.actionsUsed = 0;
      s.turn.actionsUsedByPlayer = {};
      if (gameConfig?.mode === 'simultaneous') {
        s.turn.currentPlayerId = null;
        s.turn.currentOwner = null;
      }
      for (const u of s.units.values()) { u.hasMoved = false; u.hasActed = false; u.actionSpent = false; }
      break;
    case 'plan_committed':
    case 'round_resolved':
      // 同时模式的计划期与结算汇总事件：不驱动棋盘，仅入日志。
      break;
    case 'action_failed':
      // 失败/落空动作仍消耗 AP；同时模式按玩家队列位置累计。
      recordActionPoint(s, p.owner, p);
      if (typeof p.actionsUsed === 'number' && gameConfig?.mode !== 'simultaneous') s.turn.actionsUsed = p.actionsUsed;
      break;
    case 'turn_skipped':
      break;
    case 'player_eliminated':
      if (s.players[p.playerId]) {
        s.players[p.playerId].status = 'eliminated';
        if (p.score && typeof p.score === 'object') s.players[p.playerId].adjudicationScore = p.score;
      }
      for (const id of p.removedUnitIds || []) s.units.delete(id);
      for (const hq of s.headquarters.values()) {
        if (hq.owner === p.playerId) {
          hq.hp = 0;
          hq.alive = false;
        }
      }
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
      s.turn.phase = 'game_over';
      s.winner = p.winner;
      s.result = { winner: p.winner ?? null, reason: p.reason || 'headquarters_destroyed', scores: p.scores, rankings: p.rankings };
      break;
    case 'name_rename':
      playerNames[p.playerId] = p.name;
      break;
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

function rebuildToStep(step) {
  gameConfig = null;
  playerNames = defaultPlayerNames();
  hoverCell = null;
  cellInfoEl.textContent = '';
  state = createEmptyState();
  for (let i = 0; i <= step && i < allEvents.length; i++) applyEvent(state, allEvents[i]);
  currentStep = step;
  boardAnimation.reset();
  boardAnimation.syncState(state, { animate: false });
  drawBoard();
  renderSidebar();
  renderDetail();
  updateControls();
}

function drawHpBar(x, y, width, hp, maxHp) {
  if (!maxHp || hp >= maxHp) return;
  ctx.fillStyle = '#190d0d';
  ctx.fillRect(x - width / 2, y, width, 4);
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
  ctx.fillStyle = ownerColor(u.owner);
  ctx.beginPath();
  ctx.arc(p.x, p.y, HEX_SIZE * 0.42, 0, Math.PI * 2);
  ctx.fill();
  drawUnitGlyph(u.type, p.x, p.y);
  if (u.hasMoved || u.hasActed) {
    ctx.fillStyle = 'rgba(0,0,0,.35)';
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
  ctx.fillStyle = hq.alive ? ownerColor(hq.owner) : '#555';
  ctx.globalAlpha = alpha * (hq.alive ? 0.78 : 0.3);
  ctx.fill();
  ctx.globalAlpha = alpha;
  ctx.save();
  ctx.fillStyle = '#071016';
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
  ctx.fillStyle = cp.owner ? ownerColor(cp.owner) : '#d6b34a';
  ctx.globalAlpha = 0.32;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = cp.owner ? ownerColor(cp.owner) : '#d6b34a';
  ctx.lineWidth = 2;
  ctx.stroke();
  if (cp.kind) {
    drawControlPointGlyph(cp.kind, p.x, p.y);
  }
}

function drawBoard(now = performance.now()) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0a0e14';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!state || state.cells.length === 0) return;

  for (const cell of state.cells) {
    pathHex(cell.q, cell.r, 1);
    ctx.fillStyle = TERRAIN[cell.terrain] || TERRAIN.plain;
    ctx.fill();
    ctx.strokeStyle = '#20313d';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  for (const cell of state.artillery?.warningCells || []) {
    pathHex(cell.q, cell.r, 2);
    ctx.fillStyle = 'rgba(244, 177, 66, .22)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 205, 105, .72)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  for (const cell of state.artillery?.dangerCells || []) {
    pathHex(cell.q, cell.r, 2);
    ctx.fillStyle = 'rgba(205, 55, 45, .34)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 95, 75, .68)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  if (hoverCell) {
    pathHex(hoverCell.q, hoverCell.r, 2);
    ctx.fillStyle = 'rgba(255,255,255,.08)';
    ctx.fill();
  }

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

function unitLabel(type) {
  return { infantry: 'INF', scout: 'SCT', heavy: 'HVY', ranger: 'RNG', support: 'SUP' }[type] || '?';
}

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

function renderEntityCard(ent) {
  const type = ent.type || 'headquarters';
  const title = UNIT_NAMES[type] || '指挥部';
  const entityOwnerClass = ownerClass(ent.owner);
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
      ${entityTokenMarkup(type, entityOwnerClass, title)}
      <div class="sel-title-wrap">
        <div class="sel-type">${esc(title)}</div>
        <div class="sel-owner">${playerNameControl(ent.owner)}</div>
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
  const cpOwnerClass = cp.owner ? ownerClass(cp.owner) : 'neutral';
  return `<div class="sel-card">
    <div class="sel-head">
      ${entityTokenMarkup(cp.kind || 'supply', cpOwnerClass, cp.name)}
      <div class="sel-title-wrap">
        <div class="sel-type">${esc(cp.name)}</div>
        <div class="sel-owner ${cpOwnerClass}">${esc(owner)}</div>
      </div>
    </div>
    <div class="sel-stat-grid">
      ${controlPointStats(cp)}
    </div>
    <div class="sel-coord">坐标 (${cp.q}, ${cp.r})</div>
  </div>`;
}

const EVENT_LABELS = {
  player_joined: '玩家加入',
  player_left: '玩家离开',
  game_start: '对局开始',
  move: '移动',
  attack: '攻击',
  heal: '治疗',
  unit_death: '单位阵亡',
  deploy: '部署单位',
  demolish: '爆破地形',
  control_point_captured: '占领据点',
  control_point_neutralized: '据点中立',
  control_point_repair: '据点维修',
  income: '收入结算',
  comeback_supply: '追赶补给',
  artillery_warning: '炮火预警',
  artillery_shrunk: '炮火收缩',
  artillery_damage: '炮火轰击',
  reset_actions: '结束回合',
  turn_skipped: '跳过回合',
  turn_end: '回合交接',
  round_end: '轮次结束',
  round_start: '轮次开始',
  round_resolved: '同时结算',
  plan_committed: '计划已确认',
  action_failed: '动作失败',
  headquarters_destroyed: '指挥部被毁',
  player_eliminated: '玩家淘汰',
  game_over: '对局结束',
  name_rename: '玩家改名',
};

const PHASE_LABELS = {
  lobby: '等待中',
  active: '进行中',
  game_over: '已结束',
};

function eventLabel(type) {
  return EVENT_LABELS[type] || type;
}

function phaseLabel(phase) {
  return PHASE_LABELS[phase] || phase;
}

function formatEventShort(ev) {
  const p = ev.payload || {};
  switch (ev.type) {
    case 'game_start': return '对局开始';
    case 'deploy': return `部署 ${UNIT_NAMES[p.unitType] || p.unitType} @(${p.q},${p.r})`;
    case 'move': return `移动 ${String(p.unitId).slice(0, 6)} -> (${p.toQ},${p.toR})`;
    case 'attack': return p.hit === false ? `开火落空 (${p.q},${p.r})` : `攻击 ${String(p.targetId).slice(0, 6)} 伤害:${p.damage}`;
    case 'heal': return `治疗 ${String(p.targetId).slice(0, 6)} +${p.amount}`;
    case 'unit_death': return `单位阵亡 ${String(p.unitId).slice(0, 6)}`;
    case 'headquarters_destroyed': return `指挥部摧毁 ${playerName(p.owner)}`;
    case 'player_eliminated': return `${playerName(p.playerId)} 被淘汰`;
    case 'control_point_neutralized': return `据点中立 ${p.pointId || ''}`;
    case 'control_point_captured': return `占领 ${p.name}`;
    case 'control_point_repair': return `${p.pointName || '维修站'} 修复 ${String(p.unitId).slice(0, 6)} +${p.amount}`;
    case 'income': return `${playerName(p.owner)} 收入 +${p.amount}`;
    case 'comeback_supply': return `${playerName(p.owner)} 追赶补给 +${p.amount}（落后${p.scoreGapPercent}%）`;
    case 'artillery_warning': return `炮火预警：第 ${p.nextShrinkRound} 轮收缩`;
    case 'artillery_shrunk': return `炮火收缩：安全半径 ${p.safeRadius}`;
    case 'artillery_damage': return `${playerName(p.owner)} 单位遭炮击 -${p.damage}`;
    case 'turn_end': return `回合结束 -> ${playerName(p.nextPlayerId || p.nextOwner)} (${p.turnNumber || p.roundNumber})`;
    case 'round_end': return `第 ${p.roundNumber || '?'} 轮结束`;
    case 'round_start': return `第 ${p.roundNumber || '?'} 轮计划阶段开始`;
    case 'round_resolved': return `第 ${p.roundNumber || '?'} 轮同时结算完毕`;
    case 'plan_committed': return `${playerName(p.playerId)} 已确认本回合计划`;
    case 'action_failed': {
      const failedLabel = { deploy: '部署', move: '移动', attack: '攻击', heal: '治疗', demolish: '爆破' }[p.type] || '动作';
      const failedReason = { destination_conflict: '目标格撞车', insufficient_supplies: '补给不足', unit_gone: '单位已不存在', out_of_range: '超出射程', already_healthy: '目标无需治疗', invalid_target: '目标无效', target_gone: '目标已消失' }[p.reason] || p.reason || '失败';
      return `${playerName(p.owner)} ${failedLabel}未执行：${failedReason}`;
    }
    case 'reset_actions': return `${playerName(p.owner)} 结束回合，动作点重置`;
    case 'turn_skipped': return `${playerName(p.playerId)} 跳过回合`;
    case 'player_joined': return `${p.name || playerName(p.playerId)} 加入对局`;
    case 'player_left': return `${playerName(p.playerId)} 离开对局`;
    case 'name_rename': return `${playerName(p.playerId)} 改名为 ${p.name}`;
    case 'game_over':
      if (p.reason === 'mutual_annihilation') return '双方同归于尽';
      if (p.reason === 'forced_adjudication_draw') return '强制裁决平局';
      if (p.reason === 'forced_adjudication_score') return `强制裁决 胜者:${playerName(p.winner)}`;
      if (p.reason === 'turn_limit_draw') return `${maxTurnsLabel()}裁决平局`;
      if (p.reason === 'turn_limit_score') return `${maxTurnsLabel()}裁决 胜者:${playerName(p.winner)}`;
      if (p.reason === 'last_player_standing') return `最后存活 胜者:${playerName(p.winner)}`;
      return `游戏结束 胜者:${playerName(p.winner)}`;
    case 'demolish': return `爆破 (${p.q},${p.r})`;
    default: return ev.type;
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
  if (!ownHq && gameConfig?.mode !== 'annihilation') return null;
  // Prefer per-player cumulative HQ damage from attack events (server-compatible).
  // Fall back to total enemy HQ damage only when stats are unavailable (legacy replays).
  const tracked = state.players?.[owner]?.stats?.headquartersDamage;
  const headquartersDamage = typeof tracked === 'number'
    ? tracked
    : [...state.headquarters.values()]
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
  const players = joinedPlayerIds();
  if (players.length < 2) return null;
  const scores = Object.fromEntries(players.map(owner => [owner, playerScore(owner)]));
  return Object.values(scores).every(Boolean) ? scores : null;
}

/** Final `result.scores` when present, else recompute from reconstructed event state. */
function liveAdjudicationScores() {
  if (state?.result?.scores && Object.keys(state.result.scores).length > 0) return state.result.scores;
  return computeAdjudicationScores();
}

function liveAdjudicationRankings() {
  const rows = state?.result?.rankings || [];
  return Array.isArray(rows) ? rows : [];
}

function scoreBreakdown(score) {
  const hqDamage = score.headquartersDamage ?? score.enemyHqDamage ?? 0;
  if (gameConfig?.mode === 'annihilation') return `存活兵力 ${score.armyValue} · 行动分 ${score.actionScore ?? 0}`;
  return `HQ伤害 ${hqDamage} · HQ血量 ${score.ownHqHp} · 据点 ${score.controlPoints} · 兵力 ${score.armyValue} · 补给 ${score.supplies} · 行动分 ${score.actionScore ?? 0}`;
}

function renderScorePanel() {
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

function scoreRank(rows, index) {
  const score = rows[index]?.[1]?.total ?? 0;
  const firstIndex = rows.findIndex(([, rowScore]) => (rowScore.total ?? 0) === score);
  return firstIndex + 1;
}

function renderScoreRow(owner, score, rank) {
  const cls = ownerClass(owner);
  const eliminated = state?.players?.[owner]?.status === 'eliminated';
  return `<div class="score-row ${cls}${eliminated ? ' eliminated' : ''}">
    <div class="score-row-head"><span><em class="score-rank">#${rank}</em>${playerNameControl(owner)}${eliminated ? ' <em class="score-status">已淘汰</em>' : ''}</span><strong>${score.total}</strong></div>
    <div class="score-breakdown">${esc(scoreBreakdown(score))}</div>
  </div>`;
}

function renderSidebar() {
  if (!state) return;
  const resourceCards = Object.entries(state.resources || {})
    .filter(([owner]) => PLAYER_IDS.includes(owner))
    .map(([owner, resource]) => `<div class="resource-card ${ownerClass(owner)}"><span>${playerNameControl(owner)}</span><strong>${resource.supplies ?? 0}</strong><em>补给</em></div>`)
    .join('');
  resourcesEl.innerHTML = `<div class="resource-grid">
      ${resourceCards || '<div class="resource-empty">等待对局开始</div>'}
    </div>`;
  renderScorePanel();

  const owner = isSimultaneousReplay() ? null : (state.turn.currentPlayerId || state.turn.currentOwner);
  const maxActions = gameConfig?.balance?.actionsPerTurn ?? 0;
  const used = state.turn.actionsUsed ?? 0;
  const remaining = maxActions ? Math.max(0, maxActions - used) : 0;
  const exhausted = !isSimultaneousReplay() && maxActions > 0 && remaining === 0;

  turnInfoEl.innerHTML = `
    <span class="turn-kicker">${state.result ? '已结束' : '当前回合'}</span>
    <strong class="turn-count">${esc(turnProgressLabel())}</strong>
    <span class="turn-player">${isSimultaneousReplay() ? '同时计划阶段' : esc(playerName(owner) || '—')}</span>`;
  turnInfoEl.className = `turn-badge ${ownerClass(owner)}${state.result ? ' finished' : ''}`;

  const actionsDisplay = document.getElementById('actions-display');
  if (actionsDisplay) {
    if (!maxActions) {
      actionsDisplay.innerHTML = '';
    } else {
      actionsDisplay.innerHTML = `<div class="hud-chip hud-ap${exhausted ? ' exhausted' : ''}">
        <span class="hud-label">行动</span>
        <strong class="hud-value${exhausted ? ' zero' : ''}">${esc(replayActionUsageText())}</strong>
        <span class="hud-sub">${isSimultaneousReplay() ? '各玩家队列独立' : '本回合已用'}</span>
      </div>`;
    }
  }

  eventsEl.innerHTML = '';
  allEvents.forEach((ev, i) => {
    const li = document.createElement('li');
    li.dataset.type = ev.type;
    li.textContent = `#${ev.seq} ${formatEventShort(ev)}`;
    if (i === currentStep) li.classList.add('active');
    li.addEventListener('click', () => { pausePlayback(); rebuildToStep(i); });
    eventsEl.appendChild(li);
  });
  syncMobileChrome();
}
function syncMobileChrome() {
  const drawerRes = document.getElementById('drawer-resources');
  if (drawerRes && resourcesEl) drawerRes.innerHTML = resourcesEl.innerHTML;
  const drawerScore = document.getElementById('drawer-score');
  if (drawerScore && scorePanelEl) drawerScore.innerHTML = scorePanelEl.innerHTML;
  const drawerSel = document.getElementById('drawer-selection');
  if (drawerSel && selDetailEl) drawerSel.innerHTML = selDetailEl.innerHTML;
  const drawerEvents = document.getElementById('drawer-events');
  if (drawerEvents && eventsEl) {
    drawerEvents.innerHTML = '';
    allEvents.forEach((ev, i) => {
      const li = document.createElement('li');
      li.dataset.type = ev.type;
      li.textContent = `#${ev.seq} ${formatEventShort(ev)}`;
      if (i === currentStep) li.classList.add('active');
      li.addEventListener('click', () => { pausePlayback(); rebuildToStep(i); closeDrawer(); });
      drawerEvents.appendChild(li);
    });
  }
  const drawerDetail = document.getElementById('drawer-event-detail');
  if (drawerDetail && detailEl) {
    // full payload stays in drawer; strip uses compact summary from renderDetail
    if (state && currentStep >= 0 && currentStep < allEvents.length) {
      const ev = allEvents[currentStep];
      drawerDetail.innerHTML = `<span class="ev-type ${ev.type}">${esc(eventLabel(ev.type))}</span><span style="color:#888">#${ev.seq}</span><span class="ev-payload">${esc(JSON.stringify(ev.payload, null, 2))}</span>`;
    }
  }
  renderDrawerGameList();
}

function resultText(result) {
  if (result.reason === 'forced_adjudication_draw') return '强制裁决平局';
  if (result.reason === 'forced_adjudication_score') return `强制裁决胜者: ${playerName(result.winner)}`;
  if (result.reason === 'turn_limit_draw') return `${maxTurnsLabel()}裁决平局`;
  if (result.reason === 'turn_limit_score') return `${maxTurnsLabel()}裁决胜者: ${playerName(result.winner)}`;
  return `胜者: ${playerName(result.winner)}`;
}

function renderDetail() {
  if (!state || currentStep < 0 || currentStep >= allEvents.length) {
    detailEl.innerHTML = '<span class="sel-summary-text">选择对局后使用时间轴回放</span>';
    const drawerDetail = document.getElementById('drawer-event-detail');
    if (drawerDetail) drawerDetail.innerHTML = '<span style="color:#666">无操作</span>';
    return;
  }
  const ev = allEvents[currentStep];
  const note = state.result && currentStep === allEvents.length - 1
    ? ` · ${resultText(state.result)}`
    : '';
  detailEl.innerHTML = `<div class="sel-summary-line">
    <strong>${esc(eventLabel(ev.type))}</strong>
    <span class="sel-summary-meta">#${ev.seq} · ${esc(formatEventShort(ev))}${esc(note)}</span>
    <span class="sel-summary-hint">详情 ▾</span>
  </div>`;
  const drawerDetail = document.getElementById('drawer-event-detail');
  if (drawerDetail) {
    drawerDetail.innerHTML = `<span class="ev-type ${ev.type}">${esc(eventLabel(ev.type))}</span><span style="color:#888">#${ev.seq}</span><span class="ev-payload">${esc(JSON.stringify(ev.payload, null, 2))}</span>`;
  }
}

function updateControls() {
  const total = allEvents.length;
  stepInfo.textContent = currentStep < 0 ? `开始前 / ${total}` : `${currentStep + 1} / ${total}`;
  timeline.min = 0;
  timeline.max = Math.max(0, total - 1);
  timeline.value = Math.max(0, currentStep);
  const playIcon = btnPlay.querySelector('.ui-icon');
  playIcon?.classList.toggle('icon-play', !playing);
  playIcon?.classList.toggle('icon-pause', playing);
  btnPlay.title = playing ? '暂停' : '播放';
  btnPlay.setAttribute('aria-label', playing ? '暂停' : '播放');
  btnPlay.classList.toggle('active', playing);
}

function stepForward() {
  if (currentStep >= allEvents.length - 1) { pausePlayback(); return; }
  const event = allEvents[currentStep + 1];
  applyEvent(state, event);
  currentStep++;
  boardAnimation.recordEvent(event, state);
  boardAnimation.syncState(state, { animate: event.type !== 'game_start' });
  drawBoard(); renderSidebar(); renderDetail(); updateControls();
}
function stepBackward() { if (currentStep > 0) rebuildToStep(currentStep - 1); }
function goToStart() { pausePlayback(); rebuildToStep(allEvents.length ? 0 : -1); }
function goToEnd() { pausePlayback(); pinnedReplayStep = false; rebuildToStep(allEvents.length - 1); }
function startPlayback() {
  if (allEvents.length === 0) return;
  if (currentStep >= allEvents.length - 1) rebuildToStep(-1);
  pinnedReplayStep = false;
  playing = true; updateControls(); scheduleNext();
}
function pausePlayback() {
  playing = false;
  if (playTimer) clearTimeout(playTimer);
  playTimer = null;
  updateControls();
}
function scheduleNext() {
  if (!playing) return;
  playTimer = setTimeout(() => { stepForward(); if (playing) scheduleNext(); }, Number(speedSelect.value) || 500);
}

function buildTimelineMarkers() {
  timelineMarkers.innerHTML = '';
  if (allEvents.length === 0) return;
  allEvents.forEach((ev, i) => {
    const marker = document.createElement('div');
    marker.className = `marker marker-${ev.type}`;
    marker.style.left = `${allEvents.length === 1 ? 0 : (i / (allEvents.length - 1)) * 100}%`;
    timelineMarkers.appendChild(marker);
  });
}

function gameOptionText(game) {
  return `${game.id.slice(0, 8)} - ${phaseLabel(game.phase)} 回合${game.turnNumber}`;
}

function normalizeListedGame(game) {
  const id = game.id || game.gameId;
  return {
    ...game,
    id,
    gameId: game.gameId || id,
    turnNumber: game.turnNumber ?? game.roundNumber ?? 1,
  };
}

function sortGamesByLatest(games) {
  return [...games].sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
}

function closeGamePicker() {
  if (!gamePicker || !gamePickerButton) return;
  gamePicker.classList.remove('open');
  gamePickerButton.setAttribute('aria-expanded', 'false');
}

function toggleGamePicker() {
  if (!gamePicker || !gamePickerButton) {
    openDrawer('game');
    return;
  }
  const open = !gamePicker.classList.contains('open');
  gamePicker.classList.toggle('open', open);
  gamePickerButton.setAttribute('aria-expanded', String(open));
}

function syncGamePickerLabel() {
  const selected = gamesList.find(g => g.id === gameSelect.value);
  if (gamePickerLabel) gamePickerLabel.textContent = selected ? gameOptionText(selected) : '-- 选择对局 --';
  gamePickerMenu?.querySelectorAll('.game-picker-option').forEach(option => {
    option.classList.toggle('active', option.dataset.gameId === gameSelect.value);
    option.setAttribute('aria-selected', String(option.dataset.gameId === gameSelect.value));
  });
  updateForceAdjudicateButton();
  renderDrawerGameList();
}

function updateForceAdjudicateButton() {
  if (!forceAdjudicateBtn) return;
  const selected = gamesList.find(game => game.id === gameSelect.value);
  forceAdjudicateBtn.disabled = selected?.phase !== 'active';
}

function renderGamePickerMenu() {
  if (gamePickerMenu) {
    gamePickerMenu.replaceChildren();
    if (gamesList.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'game-picker-empty';
      empty.textContent = '暂无在线对局';
      gamePickerMenu.append(empty);
    } else {
      for (const game of gamesList) {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = `game-picker-option phase-${game.phase || 'unknown'}`;
        option.dataset.gameId = game.id;
        option.setAttribute('role', 'option');
        option.innerHTML = `<span class="game-id">${esc(game.id.slice(0, 8))}</span>
          <span class="phase-badge phase-${esc(game.phase || 'unknown')}">${esc(phaseLabel(game.phase))}</span>
          <span class="game-meta-line">回合 ${esc(game.turnNumber)} · ${esc(game.mapId || 'default')}</span>`;
        option.addEventListener('click', () => selectGame(game.id));
        gamePickerMenu.append(option);
      }
    }
  }
  syncGamePickerLabel();
}

async function selectGame(id) {
  if (!id) return;
  gameSelect.value = id;
  syncGamePickerLabel();
  closeGamePicker();
  await loadGameState(id);
  subscribeSse(id);
}

async function fetchGameList() {
  let payload;
  try {
    const res = await fetch('/api/games');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    payload = await res.json();
  } catch {
    statusEl.textContent = '无法获取对局列表';
    return gamesList;
  }
  const { games } = payload || {};
  gamesList = sortGamesByLatest((games || []).map(normalizeListedGame)
    .filter(game => typeof game.id === 'string' && game.id.length > 0));
  const prev = gameSelect.value;
  gameSelect.innerHTML = '<option value="">-- 选择对局 --</option>';
  for (const g of gamesList) {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = `${g.id.slice(0, 8)} - ${phaseLabel(g.phase)} 回合${g.turnNumber}`;
    gameSelect.appendChild(opt);
  }
  if (prev && [...gameSelect.options].some(o => o.value === prev)) gameSelect.value = prev;
  renderGamePickerMenu();
  if (prev && gameSelect.value !== prev) resetLoadedGame('当前对局已不在线');
  return gamesList;
}

function resetLoadedGame(message = '请选择在线对局') {
  pausePlayback();
  importedReplayMeta = null;
  if (liveSse) liveSse.close();
  liveSse = null;
  pinnedReplayStep = false;
  gameConfig = null;
  playerNames = defaultPlayerNames();
  allEvents = [];
  currentStep = -1;
  hoverCell = null;
  state = createEmptyState();
  boardAnimation.reset();
  boardAnimation.syncState(state, { animate: false });
  buildTimelineMarkers();
  drawBoard();
  resourcesEl.innerHTML = '';
  scorePanelEl.innerHTML = '';
  turnInfoEl.innerHTML = '';
  eventsEl.innerHTML = '';
  detailEl.textContent = '选择对局后使用时间轴回放';
  selDetailEl.textContent = '点击或悬停棋盘查看单位、总部或据点信息';
  cellInfoEl.textContent = '';
  updateControls();
  updateForceAdjudicateButton();
  statusEl.textContent = message;
}

async function forceAdjudicateCurrentGame() {
  const id = gameSelect.value;
  const game = gamesList.find(item => item.id === id);
  if (!id || id === 'offline' || game?.phase !== 'active') {
    statusEl.textContent = '请选择进行中的在线对局';
    return;
  }

  const scores = pinnedReplayStep ? {} : (liveAdjudicationScores() || {});
  const standings = Object.entries(scores)
    .filter(([owner]) => state?.players?.[owner]?.status !== 'eliminated')
    .sort(([, a], [, b]) => (b.total ?? 0) - (a.total ?? 0))
    .map(([owner, score], index) => `${index + 1}. ${playerName(owner)}：${score.total ?? 0}`)
    .join('\n');
  const confirmed = confirm(`确定强制裁决当前对局？\n\n${standings || '将按当前分数结算'}\n\n裁决后对局立即结束，无法继续行动。`);
  if (!confirmed) return;

  forceAdjudicateBtn.disabled = true;
  forceAdjudicateBtn.textContent = '裁决中…';
  try {
    const headers = {};
    const controlToken = localStorage.getItem('autoControlToken') || '';
    if (controlToken) headers['x-control-token'] = controlToken;
    const res = await fetch(`/api/games/${encodeURIComponent(id)}/force-adjudicate`, { method: 'POST', headers });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      statusEl.textContent = body.error || '强制裁决失败';
      return;
    }
    await loadGameState(id);
    await fetchGameList();
    statusEl.textContent = '对局已按当前分数裁决';
  } finally {
    forceAdjudicateBtn.textContent = '强制裁决';
    updateForceAdjudicateButton();
  }
}

async function deleteCurrentGame() {
  const id = gameSelect.value;
  if (!id || id === 'offline') {
    statusEl.textContent = '请选择在线对局后再删除';
    return;
  }
  const game = gamesList.find(g => g.id === id);
  const phase = phaseLabel(game?.phase) || '未知';
  const turnNumber = game?.turnNumber ?? '未知';
  const ok = confirm(`确定删除对局 ${id}？\n阶段：${phase}\n回合：${turnNumber}\n\n该操作会删除内存与持久化文件中的对局，不能撤销。`);
  if (!ok) return;

  const headers = {};
  const controlToken = localStorage.getItem('autoControlToken') || '';
  if (controlToken) headers['x-control-token'] = controlToken;
  const res = await fetch(`/api/games/${encodeURIComponent(id)}`, { method: 'DELETE', headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    statusEl.textContent = body.error || '删除失败';
    return;
  }
  gameSelect.value = '';
  resetLoadedGame('对局已删除');
  await fetchGameList();
}

async function loadGameState(id) {
  pausePlayback();
  importedReplayMeta = null;
  pinnedReplayStep = false;
  const res = await fetch(`/api/games/${id}/events`);
  const { events } = await res.json();
  allEvents = events;
  buildTimelineMarkers();
  if (allEvents.length > 0) rebuildToStep(allEvents.length - 1);
  else {
    state = createEmptyState();
    boardAnimation.reset();
    boardAnimation.syncState(state, { animate: false });
    drawBoard(); renderSidebar(); renderDetail(); updateControls();
  }
}

function subscribeSse(id) {
  if (liveSse) liveSse.close();
  liveSse = new EventSource(`/api/games/${id}/events`);
  liveSse.onmessage = e => {
    const ev = JSON.parse(e.data);
    if (allEvents.some(existing => existing.seq === ev.seq)) return;
    const wasAtLatest = currentStep >= allEvents.length - 1;
    allEvents.push(ev);
    buildTimelineMarkers();
    if (!pinnedReplayStep && wasAtLatest) stepForward();
    else updateControls();
    if (ev.type === 'game_over') forceAdjudicateBtn.disabled = true;
    statusEl.textContent = '实时连接中';
  };
  liveSse.onerror = () => { statusEl.textContent = 'SSE 断开，自动重连中'; };
}

function updateHoverFromPoint(p) {
  if (!state || !state.cells?.length) return;
  const h = pixelToHex(p.x, p.y);
  hoverCell = state.cells.some(c => c.q === h.q && c.r === h.r) ? h : null;
  if (!hoverCell) {
    cellInfoEl.textContent = '';
  } else {
    const unit = [...(state.units?.values?.() || [])].find(u => u.alive && u.q === h.q && u.r === h.r);
    const hq = [...(state.headquarters?.values?.() || [])].find(x => x.alive && x.q === h.q && x.r === h.r);
    const cp = [...(state.controlPoints?.values?.() || [])].find(x => x.q === h.q && x.r === h.r);
    const ent = unit || hq;
    cellInfoEl.textContent = `(${h.q}, ${h.r})${cp ? ` | ${cp.name}` : ''}${ent ? ` | ${UNIT_NAMES[ent.type] || 'HQ'} ${ent.hp}/${ent.maxHp}` : ''}`;
  }
  drawBoard();
  if (hoverCell) {
    const unit = [...(state.units?.values?.() || [])].find(u => u.alive && u.q === hoverCell.q && u.r === hoverCell.r);
    const hq = [...(state.headquarters?.values?.() || [])].find(x => x.alive && x.q === hoverCell.q && x.r === hoverCell.r);
    const cp = [...(state.controlPoints?.values?.() || [])].find(x => x.q === hoverCell.q && x.r === hoverCell.r);
    renderSelectionInfo(unit || hq, cp);
  }
}

function handleBoardTap(cell) {
  if (!cell || !state) return;
  hoverCell = cell;
  const unit = [...(state.units?.values?.() || [])].find(u => u.alive && u.q === cell.q && u.r === cell.r);
  const hq = [...(state.headquarters?.values?.() || [])].find(x => x.alive && x.q === cell.q && x.r === cell.r);
  const cp = [...(state.controlPoints?.values?.() || [])].find(x => x.q === cell.q && x.r === cell.r);
  const ent = unit || hq;
  cellInfoEl.textContent = `(${cell.q}, ${cell.r})${cp ? ` | ${cp.name}` : ''}${ent ? ` | ${UNIT_NAMES[ent.type] || 'HQ'} ${ent.hp}/${ent.maxHp}` : ''}`;
  renderSelectionInfo(ent || null, cp || null);
  drawBoard();
  const drawerSel = document.getElementById('drawer-selection');
  if (drawerSel && selDetailEl) drawerSel.innerHTML = selDetailEl.innerHTML;
}

const gesture = {
  pointers: new Map(),
  mode: 'none',
  startX: 0, startY: 0,
  originPanX: 0, originPanY: 0,
  originScale: 1,
  pinchDist: 0,
  moved: false,
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
  if (!boardViewport || e.target.closest?.('.zoom-controls')) return;
  boardViewport.setPointerCapture?.(e.pointerId);
  gesture.pointers.set(e.pointerId, e);
  gesture.moved = false;
  if (gesture.pointers.size === 1) {
    gesture.mode = 'pan';
    gesture.startX = e.clientX;
    gesture.startY = e.clientY;
    gesture.originPanX = boardPanX;
    gesture.originPanY = boardPanY;
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
function onPointerUp(e) {
  if (!gesture.pointers.has(e.pointerId)) return;
  const wasTap = gesture.mode === 'pan' && !gesture.moved && gesture.pointers.size === 1;
  gesture.pointers.delete(e.pointerId);
  if (wasTap && state) {
    const pt = eventToCanvasPoint(e);
    const h = pixelToHex(pt.x, pt.y);
    const onBoard = state.cells?.some?.(c => c.q === h.q && c.r === h.r);
    handleBoardTap(onBoard ? h : null);
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

const gestureTarget = boardViewport || canvas;
gestureTarget.addEventListener('pointerdown', onPointerDown, { passive: false });
gestureTarget.addEventListener('pointermove', onPointerMove, { passive: false });
gestureTarget.addEventListener('pointerup', onPointerUp);
gestureTarget.addEventListener('pointercancel', onPointerCancel);
gestureTarget.addEventListener('contextmenu', e => e.preventDefault());
gestureTarget.addEventListener('wheel', e => {
  e.preventDefault();
  if (!boardViewport) return;
  const rect = boardViewport.getBoundingClientRect();
  const vx = e.clientX - rect.left;
  const vy = e.clientY - rect.top;
  const worldX = (vx - boardPanX) / boardScale;
  const worldY = (vy - boardPanY) / boardScale;
  boardScale = clampBoardScale(boardScale * (e.deltaY < 0 ? 1.1 : 0.9));
  boardPanX = vx - worldX * boardScale;
  boardPanY = vy - worldY * boardScale;
  setBoardTransform();
}, { passive: false });

function renderSelectionInfo(ent, cp) {
  if (!ent && !cp) {
    selDetailEl.innerHTML = '<div class="sel-note">点击棋盘查看单位、指挥部或据点信息</div>';
    const drawerSel = document.getElementById('drawer-selection');
    if (drawerSel) drawerSel.innerHTML = selDetailEl.innerHTML;
    return;
  }
  let html = '';
  if (cp) html += renderControlPointCard(cp);
  if (ent) html += renderEntityCard(ent);
  selDetailEl.innerHTML = html;
  const drawerSel = document.getElementById('drawer-selection');
  if (drawerSel) drawerSel.innerHTML = html;
}

async function renamePlayer(playerId) {
  if (window.EMBEDDED_EVENTS || !gameSelect.value || gameSelect.value === 'offline') {
    statusEl.textContent = '请选择在线对局后再改名';
    return;
  }
  const current = playerName(playerId);
  const next = prompt(`更改${current}的名字`, current);
  if (next === null) return;
  const name = next.trim();
  if (!name) {
    statusEl.textContent = '名字不能为空';
    return;
  }
  const headers = { 'Content-Type': 'application/json' };
  const controlToken = localStorage.getItem('autoControlToken') || '';
  if (controlToken) headers['x-control-token'] = controlToken;
  const res = await fetch(`/api/games/${gameSelect.value}/rename`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ playerId, name }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    statusEl.textContent = body.error || '改名失败';
    return;
  }
  statusEl.textContent = '名字已更新';
}

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
function gameFilename(ext) {
  const d = new Date();
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `tg_0_${date}.${ext}`;
}

function latestGameOverResult() {
  const gameOver = [...allEvents].reverse().find(ev => ev.type === 'game_over');
  if (!gameOver) return state?.result ?? null;
  const p = gameOver.payload || {};
  return { winner: p.winner ?? null, reason: p.reason || 'headquarters_destroyed', scores: p.scores };
}

function replayMapId() {
  const start = allEvents.find(ev => ev.type === 'game_start');
  return start?.payload?.config?.mapId || start?.payload?.config?.id || start?.payload?.map?.id || null;
}

function normalizeVersion(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return `${value}.0.0`;
  if (typeof value !== 'string') return null;
  return /^\d+\.\d+\.\d+$/.test(value) ? value : null;
}

function compareSemver(a, b) {
  const left = normalizeVersion(a);
  const right = normalizeVersion(b);
  if (!left || !right) return NaN;
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (leftParts[i] !== rightParts[i]) return leftParts[i] - rightParts[i];
  }
  return 0;
}

function buildReplayExport() {
  return {
    format: REPLAY_EXPORT_FORMAT,
    schemaVersion: REPLAY_SCHEMA_VERSION,
    gameId: importedReplayMeta?.gameId || gameSelect.value || 'offline',
    mapId: importedReplayMeta?.mapId || replayMapId(),
    playerNames: importedReplayMeta?.playerNames || playerNames,
    exportedAt: new Date().toISOString(),
    eventCount: allEvents.length,
    finalResult: importedReplayMeta?.finalResult ?? latestGameOverResult(),
    events: allEvents,
  };
}

function exportJson() {
  downloadFile(gameFilename('json'), JSON.stringify(buildReplayExport(), null, 2), 'application/json');
}

function normalizeImportedReplay(data) {
  const events = Array.isArray(data) ? data : data.events;
  const schemaVersion = Array.isArray(data) ? '1.0.0' : data.schemaVersion ?? '1.0.0';
  if (!Array.isArray(data) && data.format && data.format !== REPLAY_EXPORT_FORMAT) {
    throw new Error(`不支持的回放格式: ${data.format}`);
  }
  if (!normalizeVersion(schemaVersion)) throw new Error('回放版本号无效');
  if (compareSemver(schemaVersion, REPLAY_SCHEMA_VERSION) > 0) throw new Error(`回放版本 ${schemaVersion} 高于当前支持版本 ${REPLAY_SCHEMA_VERSION}`);
  if (!Array.isArray(events)) throw new Error('JSON 必须是事件数组或包含 events 数组的回放对象');
  const seenSeq = new Set();
  let previousSeq = null;
  events.forEach((ev, index) => {
    if (!ev || typeof ev !== 'object') throw new Error(`第 ${index + 1} 个事件不是对象`);
    if (typeof ev.seq !== 'number' || !Number.isFinite(ev.seq)) throw new Error(`第 ${index + 1} 个事件缺少有效 seq`);
    if (!Number.isInteger(ev.seq) || ev.seq <= 0) throw new Error(`第 ${index + 1} 个事件的 seq 必须是正整数`);
    if (seenSeq.has(ev.seq) || (previousSeq !== null && ev.seq <= previousSeq)) throw new Error(`第 ${index + 1} 个事件的 seq 重复或乱序`);
    seenSeq.add(ev.seq);
    previousSeq = ev.seq;
    if (typeof ev.type !== 'string' || !ev.type) throw new Error(`第 ${index + 1} 个事件缺少有效 type`);
    if (!ev.payload || typeof ev.payload !== 'object' || Array.isArray(ev.payload)) throw new Error(`第 ${index + 1} 个事件缺少有效 payload`);
  });
  const start = events.find(ev => ev.type === 'game_start');
  if (start && (!start.payload.map || !Array.isArray(start.payload.map.cells) || !start.payload.config || typeof start.payload.config !== 'object')) {
    throw new Error('回放包含不兼容的旧版 game_start 数据');
  }
  return {
    format: Array.isArray(data) ? 'legacy-event-array' : data.format || 'legacy-replay-object',
    schemaVersion,
    gameId: Array.isArray(data) ? 'offline' : data.gameId,
    mapId: Array.isArray(data) ? null : data.mapId ?? null,
    playerNames: Array.isArray(data) ? null : data.playerNames ?? null,
    finalResult: Array.isArray(data) ? null : data.finalResult ?? null,
    events,
  };
}

function loadImportedReplay(replay) {
  pausePlayback();
  importedReplayMeta = {
    gameId: replay.gameId || 'offline',
    mapId: replay.mapId || null,
    playerNames: replay.playerNames || null,
    finalResult: replay.finalResult ?? null,
  };
  allEvents = replay.events;
  pinnedReplayStep = false;
  buildTimelineMarkers();
  if (allEvents.length) rebuildToStep(allEvents.length - 1);
  else {
    state = createEmptyState();
    currentStep = -1;
    boardAnimation.reset();
    boardAnimation.syncState(state, { animate: false });
    drawBoard();
    renderSidebar();
    renderDetail();
    updateControls();
  }
  if (replay.playerNames) playerNames = { ...defaultPlayerNames(), ...replay.playerNames };
  renderSidebar();
  renderDetail();
  if (liveSse) liveSse.close();
  liveSse = null;
}

function importJson() { importFile.click(); }
importFile.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const replay = normalizeImportedReplay(data);
      loadImportedReplay(replay);
      statusEl.textContent = `已导入 ${allEvents.length} 事件`;
    } catch (err) {
      statusEl.textContent = `导入失败: ${err.message}`;
    } finally {
      importFile.value = '';
    }
  };
  reader.onerror = () => {
    statusEl.textContent = '导入失败: 无法读取文件';
    importFile.value = '';
  };
  reader.readAsText(file);
});

let refreshTimer = null;
let refreshInterval = 5000;
async function autoRefreshTick() {
  if (!autoRefreshCb.checked) return;
  const games = await fetchGameList();
  if (followLatestCb.checked && games[0] && games[0].id !== gameSelect.value) {
    gameSelect.value = games[0].id;
    await loadGameState(games[0].id);
    subscribeSse(games[0].id);
  }
}
function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(autoRefreshTick, refreshInterval);
}

gameSelect.addEventListener('change', async () => {
  await selectGame(gameSelect.value);
});
gamePickerButton?.addEventListener('click', e => { e.stopPropagation(); toggleGamePicker(); });
gamePickerButton?.addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    toggleGamePicker();
  }
  if (e.key === 'Escape') closeGamePicker();
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (!gamePicker || !gamePickerButton) return;
    gamePicker.classList.add('open');
    gamePickerButton.setAttribute('aria-expanded', 'true');
    gamePickerMenu?.querySelector('.game-picker-option')?.focus();
  }
});
gamePickerMenu?.addEventListener('click', e => e.stopPropagation());
gamePickerMenu?.addEventListener('keydown', e => e.stopPropagation());
refreshBtn.addEventListener('click', fetchGameList);
forceAdjudicateBtn?.addEventListener('click', forceAdjudicateCurrentGame);
deleteGameBtn.addEventListener('click', deleteCurrentGame);
btnStart.addEventListener('click', goToStart);
btnPrev.addEventListener('click', () => { pausePlayback(); stepBackward(); });
btnPlay.addEventListener('click', () => playing ? pausePlayback() : startPlayback());
btnNext.addEventListener('click', () => { pausePlayback(); stepForward(); });
btnEnd.addEventListener('click', goToEnd);
timeline.addEventListener('input', () => {
  pausePlayback();
  const step = Number(timeline.value);
  pinnedReplayStep = step < allEvents.length - 1;
  rebuildToStep(step);
});
btnExportJson.addEventListener('click', exportJson);
btnImport.addEventListener('click', importJson);
autoRefreshCb.addEventListener('change', () => { if (autoRefreshCb.checked) startAutoRefresh(); else clearInterval(refreshTimer); });
refreshIntervalInput.addEventListener('change', () => {
  refreshInterval = Math.max(1, Math.min(60, Number(refreshIntervalInput.value) || 5)) * 1000;
  if (autoRefreshCb.checked) startAutoRefresh();
});
// mobile: settings open via data-drawer; keep desktop popover path only if present
if (settingsPopover && btnSettings && !btnSettings.dataset.drawer) {
  btnSettings.addEventListener('click', e => {
    e.stopPropagation();
    fillControlTokenSettings();
    settingsPopover.classList.toggle('open');
  });
  document.addEventListener('click', e => {
    if (!settingsPopover.contains(e.target) && e.target !== btnSettings) settingsPopover.classList.remove('open');
  });
}
btnSaveControlToken?.addEventListener('click', saveControlTokenFromSettings);

function fillControlTokenSettings() {
  if (!settingsControlToken) return;
  try {
    settingsControlToken.value = localStorage.getItem('autoControlToken') || '';
  } catch {
    settingsControlToken.value = '';
  }
}

function saveControlTokenFromSettings() {
  if (!settingsControlToken) return;
  try {
    localStorage.setItem('autoControlToken', settingsControlToken.value);
    statusEl.textContent = 'Control token 已保存';
  } catch {
    statusEl.textContent = '无法写入本地存储';
  }
}
document.addEventListener('click', e => { if (gamePicker && !gamePicker.contains(e.target)) closeGamePicker(); });
document.addEventListener('click', e => {
  const target = e.target.closest('[data-rename-player]');
  if (!target) return;
  renamePlayer(target.dataset.renamePlayer);
});
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.key === ' ') { e.preventDefault(); playing ? pausePlayback() : startPlayback(); }
  if (e.key === 'ArrowRight') { e.preventDefault(); pausePlayback(); stepForward(); }
  if (e.key === 'ArrowLeft') { e.preventDefault(); pausePlayback(); stepBackward(); }
});

async function initializeApp() {
  const games = await fetchGameList();
  const params = new URLSearchParams(window.location.search);
  const requestedGameId = params.get('gameId') || params.get('game');
  if (requestedGameId) {
    const game = games.find(item => item.id === requestedGameId);
    if (game) await selectGame(game.id);
    else statusEl.textContent = `未找到对局 ${requestedGameId}`;
  }
  startAutoRefresh();
}

initializeApp();

// mobile chrome drawers
const DRAWER_TITLES = { game: '对局', situation: '局势', events: '事件', settings: '设置' };
function openDrawer(name) {
  const drawer = document.getElementById('drawer');
  const backdrop = document.getElementById('drawer-backdrop');
  if (!drawer) return;
  syncMobileChrome();
  if (name === 'settings') fillControlTokenSettings();
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
function renderDrawerGameList() {
  const list = document.getElementById('drawer-game-list');
  if (!list) return;
  const current = gameSelect?.value || '';
  if (!gamesList.length) {
    list.innerHTML = '<div class="drawer-game-option">暂无对局</div>';
    return;
  }
  list.innerHTML = gamesList.map(g => {
    const id = g.id || g.gameId || '';
    const phase = phaseLabel(g.phase || g.status) || '';
    const active = id === current ? ' active' : '';
    return `<button type="button" class="drawer-game-option${active}" data-id="${esc(id)}">
      <div class="game-id">${esc(id)}</div>
      <div class="game-meta-line">${esc(phase)}</div>
    </button>`;
  }).join('');
  list.querySelectorAll('.drawer-game-option[data-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      if (!id) return;
      await selectGame(id);
      closeDrawer();
    });
  });
}
document.querySelectorAll('[data-drawer]').forEach(btn => {
  btn.addEventListener('click', () => openDrawer(btn.dataset.drawer));
});
document.getElementById('drawer-close')?.addEventListener('click', closeDrawer);
document.getElementById('drawer-backdrop')?.addEventListener('click', closeDrawer);
document.getElementById('btn-refresh-list-drawer')?.addEventListener('click', () => refreshBtn?.click());
document.getElementById('btn-delete-drawer')?.addEventListener('click', () => deleteGameBtn?.click());
document.getElementById('btn-export-drawer')?.addEventListener('click', () => btnExportJson?.click());
document.getElementById('btn-import-drawer')?.addEventListener('click', () => btnImport?.click());

// mirror settings between hidden desktop controls and drawer
function bindMirrorCheckbox(src, dst) {
  if (!src || !dst) return;
  dst.checked = src.checked;
  dst.addEventListener('change', () => { src.checked = dst.checked; src.dispatchEvent(new Event('change')); });
  src.addEventListener('change', () => { dst.checked = src.checked; });
}
function bindMirrorNumber(src, dst) {
  if (!src || !dst) return;
  dst.value = src.value;
  dst.addEventListener('change', () => { src.value = dst.value; src.dispatchEvent(new Event('change')); });
  src.addEventListener('change', () => { dst.value = src.value; });
}
bindMirrorCheckbox(autoRefreshCb, document.getElementById('auto-refresh-drawer'));
bindMirrorCheckbox(followLatestCb, document.getElementById('follow-latest-drawer'));
bindMirrorNumber(refreshIntervalInput, document.getElementById('refresh-interval-drawer'));

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
window.addEventListener('resize', () => fitBoardToViewport());
requestAnimationFrame(renderLoop);
