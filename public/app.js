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
let state = null;
let hoverCell = null;
let layout = { minX: 0, minY: 0, width: 840, height: 840 };
let gamesList = [];

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const gameSelect = document.getElementById('game-select');
const gamePicker = document.querySelector('.game-picker');
const gamePickerButton = document.getElementById('game-picker-button');
const gamePickerLabel = document.getElementById('game-picker-label');
const gamePickerMenu = document.getElementById('game-picker-menu');
const refreshBtn = document.getElementById('refresh-list');
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
function canvasCssMetrics() {
  const rect = canvas.getBoundingClientRect();
  const style = getComputedStyle(canvas);
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
    x: (e.clientX - m.rect.left - m.borderLeft) * (canvas.width / m.cssWidth),
    y: (e.clientY - m.rect.top - m.borderTop) * (canvas.height / m.cssHeight),
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
    },
    winner: null,
    result: null,
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

function applyEvent(s, ev) {
  if (s.eventLog.some(existing => existing.seq === ev.seq)) return;
  s.eventLog.push(ev);
  const p = ev.payload || {};
  switch (ev.type) {
    case 'game_start':
      gameConfig = p.config;
      if (p.playerNames) playerNames = { ...p.playerNames };
      s.players = JSON.parse(JSON.stringify(p.players || {}));
      s.turn.turnOrder = [...(p.turnOrder || [])];
      s.turn.currentPlayerId = p.firstPlayer || s.turn.turnOrder[0] || null;
      s.turn.currentOwner = s.turn.currentPlayerId;
      s.turn.roundNumber = 1;
      s.turn.turnNumber = 1;
      s.turn.phase = 'active';
      s.turn.actionsUsed = 0;
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
      if (u) { u.q = p.toQ; u.r = p.toR; u.hasMoved = true; u.actionSpent = true; }
      if (typeof p.actionsUsed === 'number') s.turn.actionsUsed = p.actionsUsed;
      break;
    }
    case 'attack': {
      const target = s.units.get(p.targetId) || s.headquarters.get(p.targetId);
      const a = s.units.get(p.attackerId);
      const previousHp = target ? target.hp : null;
      if (target) target.hp = p.targetHp;
      if (a) { a.hasActed = true; a.actionSpent = true; }
      // Track cumulative HQ damage for adjudication scoring (matches server stats).
      if (target && previousHp != null && (p.targetKind === 'headquarters' || s.headquarters.has(p.targetId)) && a) {
        const player = s.players[a.owner];
        if (player) {
          if (!player.stats) player.stats = { headquartersDamage: 0, unitsDestroyed: 0, playersEliminated: 0 };
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
    case 'reset_actions':
      for (const u of s.units.values()) {
        if (u.owner === p.owner) { u.hasMoved = false; u.hasActed = false; u.actionSpent = false; }
      }
      if (typeof p.actionsUsed === 'number') s.turn.actionsUsed = p.actionsUsed;
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
    case 'turn_skipped':
      break;
    case 'player_eliminated':
      if (s.players[p.playerId]) s.players[p.playerId].status = 'eliminated';
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
      if (u) { u.hasActed = true; u.actionSpent = true; }
      if (typeof p.actionsUsed === 'number') s.turn.actionsUsed = p.actionsUsed;
      break;
    }
  }
}

function rebuildToStep(step) {
  playerNames = defaultPlayerNames();
  hoverCell = null;
  cellInfoEl.textContent = '';
  state = createEmptyState();
  for (let i = 0; i <= step && i < allEvents.length; i++) applyEvent(state, allEvents[i]);
  currentStep = step;
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

function drawUnitMarker(u) {
  if (!u.alive) return;
  const p = hexToPixel(u.q, u.r);
  ctx.fillStyle = ownerColor(u.owner);
  ctx.beginPath();
  ctx.arc(p.x, p.y, HEX_SIZE * 0.42, 0, Math.PI * 2);
  ctx.fill();
  drawUnitGlyph(u.type, p.x, p.y);
  drawHpBar(p.x, p.y - 21, 34, u.hp, u.maxHp);
  if (u.hasMoved || u.hasActed) {
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath();
    ctx.arc(p.x + 12, p.y + 12, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawHeadquartersMarker(hq) {
  const p = hexToPixel(hq.q, hq.r);
  pathHex(hq.q, hq.r, 5);
  ctx.fillStyle = hq.alive ? ownerColor(hq.owner) : '#555';
  ctx.globalAlpha = hq.alive ? 0.78 : 0.3;
  ctx.fill();
  ctx.globalAlpha = 1;
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
  drawHpBar(p.x, p.y - 25, 42, hq.hp, hq.maxHp);
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

function drawBoard() {
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

  if (hoverCell) {
    pathHex(hoverCell.q, hoverCell.r, 2);
    ctx.fillStyle = 'rgba(255,255,255,.08)';
    ctx.fill();
  }

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

function formatEventShort(ev) {
  const p = ev.payload || {};
  switch (ev.type) {
    case 'game_start': return '对局开始';
    case 'deploy': return `部署 ${p.unitType} @(${p.q},${p.r})`;
    case 'move': return `移动 ${String(p.unitId).slice(0, 6)} -> (${p.toQ},${p.toR})`;
    case 'attack': return `攻击 ${String(p.targetId).slice(0, 6)} 伤害:${p.damage}`;
    case 'heal': return `治疗 ${String(p.targetId).slice(0, 6)} +${p.amount}`;
    case 'unit_death': return `单位阵亡 ${String(p.unitId).slice(0, 6)}`;
    case 'headquarters_destroyed': return `指挥部摧毁 ${playerName(p.owner)}`;
    case 'player_eliminated': return `${playerName(p.playerId)} 被淘汰`;
    case 'control_point_neutralized': return `据点中立 ${p.pointId || ''}`;
    case 'control_point_captured': return `占领 ${p.name}`;
    case 'control_point_repair': return `${p.pointName || '维修站'} 修复 ${String(p.unitId).slice(0, 6)} +${p.amount}`;
    case 'income': return `${playerName(p.owner)} 收入 +${p.amount}`;
    case 'comeback_supply': return `${playerName(p.owner)} 追赶补给 +${p.amount}（落后${p.scoreGapPercent}%）`;
    case 'turn_end': return `回合结束 -> ${playerName(p.nextPlayerId || p.nextOwner)} (${p.turnNumber || p.roundNumber})`;
    case 'round_end': return `第 ${p.roundNumber || '?'} 轮结束`;
    case 'turn_skipped': return `跳过 ${playerName(p.playerId)}`;
    case 'game_over':
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
  const ownHq = [...state.headquarters.values()].find(h => h.owner === owner);
  if (!ownHq) return null;
  // Prefer per-player cumulative HQ damage from attack events (server-compatible).
  // Fall back to total enemy HQ damage only when stats are unavailable (legacy replays).
  const tracked = state.players?.[owner]?.stats?.headquartersDamage;
  const headquartersDamage = typeof tracked === 'number'
    ? tracked
    : [...state.headquarters.values()]
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
  const players = joinedPlayerIds();
  if (players.length < 2) return null;
  const scores = Object.fromEntries(players.map(owner => [owner, playerScore(owner)]));
  return Object.values(scores).every(Boolean) ? scores : null;
}

function scoreBreakdown(score) {
  const hqDamage = score.headquartersDamage ?? score.enemyHqDamage ?? 0;
  return `HQ伤害 ${hqDamage} · HQ血量 ${score.ownHqHp} · 据点 ${score.controlPoints} · 兵力 ${score.armyValue} · 补给 ${score.supplies}`;
}

function renderScorePanel() {
  if (!scorePanelEl) return;
  const scores = state?.result?.scores || computeAdjudicationScores();
  if (!scores) {
    scorePanelEl.innerHTML = '<h3>分数排行榜</h3><div class="score-empty">等待对局开始</div>';
    return;
  }
  const resultRanks = new Map((state?.result?.rankings || []).map(row => [row.playerId, row.rank]));
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
  resourcesEl.innerHTML = `<h3>资源</h3>
    <div class="resource-grid">
      ${resourceCards || '<div class="resource-empty">等待对局开始</div>'}
    </div>`;
  renderScorePanel();
  const owner = state.turn.currentPlayerId || state.turn.currentOwner;
  const maxActions = gameConfig?.balance?.actionsPerTurn ?? 0;
  const actionsLine = maxActions
    ? `<div class="turn-meta"><span>行动点</span><strong>${state.turn.actionsUsed ?? 0}/${maxActions}</strong></div>`
    : '';
  turnInfoEl.innerHTML = `<h3>回合</h3>
    <div class="turn-card ${ownerClass(owner)}">
      <div class="turn-head">
        <strong class="turn-count">${esc(turnProgressLabel())}</strong>
        <span class="turn-player">${playerNameControl(owner)}</span>
      </div>
      ${actionsLine}
      ${state.result ? `<div class="result-note">${esc(resultText(state.result))}</div>` : ''}
    </div>`;

  eventsEl.innerHTML = '';
  allEvents.forEach((ev, i) => {
    const li = document.createElement('li');
    li.dataset.type = ev.type;
    li.textContent = `#${ev.seq} ${formatEventShort(ev)}`;
    if (i === currentStep) li.classList.add('active');
    li.addEventListener('click', () => { pausePlayback(); rebuildToStep(i); });
    eventsEl.appendChild(li);
  });
}

function resultText(result) {
  if (result.reason === 'turn_limit_draw') return `${maxTurnsLabel()}裁决平局`;
  if (result.reason === 'turn_limit_score') return `${maxTurnsLabel()}裁决胜者: ${playerName(result.winner)}`;
  return `胜者: ${playerName(result.winner)}`;
}

function renderDetail() {
  if (!state || currentStep < 0 || currentStep >= allEvents.length) {
    detailEl.innerHTML = '<span style="color:#666">无操作</span>';
    return;
  }
  const ev = allEvents[currentStep];
  detailEl.innerHTML = `<span class="ev-type ${ev.type}">${esc(ev.type)}</span><span style="color:#888">#${ev.seq}</span><span class="ev-payload">${esc(JSON.stringify(ev.payload, null, 2))}</span>`;
}

function updateControls() {
  const total = allEvents.length;
  stepInfo.textContent = currentStep < 0 ? `开始前 / ${total}` : `${currentStep + 1} / ${total}`;
  timeline.min = 0;
  timeline.max = Math.max(0, total - 1);
  timeline.value = Math.max(0, currentStep);
  btnPlay.textContent = playing ? '⏸' : '▶';
  btnPlay.classList.toggle('active', playing);
}

function stepForward() {
  if (currentStep >= allEvents.length - 1) { pausePlayback(); return; }
  applyEvent(state, allEvents[currentStep + 1]);
  currentStep++;
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
  return `${game.id.slice(0, 8)} - ${game.phase} 回合${game.turnNumber}`;
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

function closeGamePicker() {
  gamePicker.classList.remove('open');
  gamePickerButton.setAttribute('aria-expanded', 'false');
}

function toggleGamePicker() {
  const open = !gamePicker.classList.contains('open');
  gamePicker.classList.toggle('open', open);
  gamePickerButton.setAttribute('aria-expanded', String(open));
}

function syncGamePickerLabel() {
  const selected = gamesList.find(g => g.id === gameSelect.value);
  gamePickerLabel.textContent = selected ? gameOptionText(selected) : '-- 选择对局 --';
  gamePickerMenu.querySelectorAll('.game-picker-option').forEach(option => {
    option.classList.toggle('active', option.dataset.gameId === gameSelect.value);
    option.setAttribute('aria-selected', String(option.dataset.gameId === gameSelect.value));
  });
}

function renderGamePickerMenu() {
  gamePickerMenu.replaceChildren();
  if (gamesList.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'game-picker-empty';
    empty.textContent = '暂无在线对局';
    gamePickerMenu.append(empty);
    syncGamePickerLabel();
    return;
  }
  for (const game of gamesList) {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'game-picker-option';
    option.dataset.gameId = game.id;
    option.setAttribute('role', 'option');
    option.innerHTML = `<span class="game-id">${esc(game.id.slice(0, 8))}</span>
      <span class="phase-badge">${esc(game.phase)}</span>
      <span class="game-meta-line">回合 ${esc(game.turnNumber)} · ${esc(game.mapId || 'default')}</span>`;
    option.addEventListener('click', () => selectGame(game.id));
    gamePickerMenu.append(option);
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
  const res = await fetch('/api/games');
  const { games } = await res.json();
  gamesList = (games || []).map(normalizeListedGame).filter(game => game.id);
  const prev = gameSelect.value;
  gameSelect.innerHTML = '<option value="">-- 选择对局 --</option>';
  for (const g of gamesList) {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = `${g.id.slice(0, 8)} - ${g.phase} 回合${g.turnNumber}`;
    gameSelect.appendChild(opt);
  }
  if (prev && [...gameSelect.options].some(o => o.value === prev)) gameSelect.value = prev;
  renderGamePickerMenu();
  return gamesList;
}

function resetLoadedGame(message = '请选择在线对局') {
  pausePlayback();
  if (liveSse) liveSse.close();
  liveSse = null;
  pinnedReplayStep = false;
  gameConfig = null;
  playerNames = defaultPlayerNames();
  allEvents = [];
  currentStep = -1;
  hoverCell = null;
  state = createEmptyState();
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
  statusEl.textContent = message;
}

async function deleteCurrentGame() {
  const id = gameSelect.value;
  if (!id || id === 'offline') {
    statusEl.textContent = '请选择在线对局后再删除';
    return;
  }
  const game = gamesList.find(g => g.id === id);
  const phase = game?.phase || '未知';
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
  pinnedReplayStep = false;
  const res = await fetch(`/api/games/${id}/events`);
  const { events } = await res.json();
  allEvents = events;
  buildTimelineMarkers();
  if (allEvents.length > 0) rebuildToStep(allEvents.length - 1);
  else { state = createEmptyState(); drawBoard(); renderSidebar(); renderDetail(); updateControls(); }
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
    statusEl.textContent = '实时连接中';
  };
  liveSse.onerror = () => { statusEl.textContent = 'SSE 断开，自动重连中'; };
}

canvas.addEventListener('mousemove', e => {
  if (!state || state.cells.length === 0) return;
  const p = eventToCanvasPoint(e);
  const h = pixelToHex(p.x, p.y);
  hoverCell = state.cells.some(c => c.q === h.q && c.r === h.r) ? h : null;
  if (!hoverCell) { cellInfoEl.textContent = ''; drawBoard(); return; }
  const ent = entityAt(h.q, h.r);
  const cp = [...state.controlPoints.values()].find(p => p.q === h.q && p.r === h.r);
  cellInfoEl.textContent = `(${h.q}, ${h.r})${cp ? ` | ${cp.name}` : ''}${ent ? ` | ${ent.type || 'HQ'} ${ent.hp}/${ent.maxHp}` : ''}`;
  renderSelectionInfo(ent, cp);
  drawBoard();
});
canvas.addEventListener('mouseleave', () => { hoverCell = null; cellInfoEl.textContent = ''; drawBoard(); });
canvas.addEventListener('click', () => {
  if (!hoverCell) return;
  renderSelectionInfo(entityAt(hoverCell.q, hoverCell.r), [...state.controlPoints.values()].find(p => p.q === hoverCell.q && p.r === hoverCell.r));
});

function renderSelectionInfo(ent, cp) {
  if (!ent && !cp) {
    selDetailEl.textContent = '点击或悬停棋盘查看单位、指挥部或据点信息';
    return;
  }
  let html = '';
  if (cp) html += renderControlPointCard(cp);
  if (ent) html += renderEntityCard(ent);
  selDetailEl.innerHTML = html;
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
    gameId: gameSelect.value || 'offline',
    mapId: replayMapId(),
    playerNames,
    exportedAt: new Date().toISOString(),
    eventCount: allEvents.length,
    finalResult: latestGameOverResult(),
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
  events.forEach((ev, index) => {
    if (!ev || typeof ev !== 'object') throw new Error(`第 ${index + 1} 个事件不是对象`);
    if (typeof ev.seq !== 'number' || !Number.isFinite(ev.seq)) throw new Error(`第 ${index + 1} 个事件缺少有效 seq`);
    if (typeof ev.type !== 'string' || !ev.type) throw new Error(`第 ${index + 1} 个事件缺少有效 type`);
    if (!ev.payload || typeof ev.payload !== 'object' || Array.isArray(ev.payload)) throw new Error(`第 ${index + 1} 个事件缺少有效 payload`);
  });
  return {
    format: Array.isArray(data) ? 'legacy-event-array' : data.format || 'legacy-replay-object',
    schemaVersion,
    gameId: Array.isArray(data) ? 'offline' : data.gameId,
    finalResult: Array.isArray(data) ? null : data.finalResult ?? null,
    events,
  };
}

function loadImportedReplay(replay) {
  pausePlayback();
  allEvents = replay.events;
  pinnedReplayStep = false;
  buildTimelineMarkers();
  if (allEvents.length) rebuildToStep(allEvents.length - 1);
  else {
    state = createEmptyState();
    currentStep = -1;
    drawBoard();
    renderSidebar();
    renderDetail();
    updateControls();
  }
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
gamePickerButton.addEventListener('click', e => { e.stopPropagation(); toggleGamePicker(); });
gamePickerButton.addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    toggleGamePicker();
  }
  if (e.key === 'Escape') closeGamePicker();
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    gamePicker.classList.add('open');
    gamePickerButton.setAttribute('aria-expanded', 'true');
    gamePickerMenu.querySelector('.game-picker-option')?.focus();
  }
});
gamePickerMenu.addEventListener('click', e => e.stopPropagation());
gamePickerMenu.addEventListener('keydown', e => e.stopPropagation());
refreshBtn.addEventListener('click', fetchGameList);
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
btnSettings.addEventListener('click', e => { e.stopPropagation(); settingsPopover.classList.toggle('open'); });
document.addEventListener('click', e => { if (!settingsPopover.contains(e.target) && e.target !== btnSettings) settingsPopover.classList.remove('open'); });
document.addEventListener('click', e => { if (!gamePicker.contains(e.target)) closeGamePicker(); });
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
