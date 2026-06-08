const CELL = 28;
const GRID_COLOR = '#1a2a30';

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function playerName(owner) {
  return playerNames[owner] || (owner === 'player_a' ? '玩家 A' : '玩家 B');
}

// ─── game config (derived from game_start event) ───
let gameConfig = null;
let playerNames = { player_a: '玩家 A', player_b: '玩家 B' };

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const gameSelect = document.getElementById('game-select');
const refreshBtn = document.getElementById('refresh-list');
const statusEl = document.getElementById('status');
const resourcesEl = document.getElementById('resources');
const turnInfoEl = document.getElementById('turn-info');
const eventsEl = document.getElementById('events');
const detailEl = document.getElementById('detail-content');
const cellInfoEl = document.getElementById('cell-info');
const selDetailEl = document.getElementById('selection-detail');
let hoverCell = null;

// Replay controls
const btnStart = document.getElementById('btn-start');
const btnPrev = document.getElementById('btn-prev');
const btnPlay = document.getElementById('btn-play');
const btnNext = document.getElementById('btn-next');
const btnEnd = document.getElementById('btn-end');
const speedSelect = document.getElementById('speed-select');
const stepInfo = document.getElementById('step-info');
const timeline = document.getElementById('timeline');
const timelineMarkers = document.getElementById('timeline-markers');

let allEvents = [];       // Full event array for current game
let currentStep = -1;     // Index into allEvents (-1 = before first event)
let playing = false;
let playTimer = null;
let liveSse = null;

// Auto-refresh
const autoRefreshCb = document.getElementById('auto-refresh');
const followLatestCb = document.getElementById('follow-latest');
let refreshTimer = null;
const REFRESH_INTERVAL = 5000;

// Reconstructed state at currentStep
let state = null;

// ─── Animation system ───
const ANIM_MOVE_DURATION = 220;
const ANIM_SPAWN_DURATION = 280;
const ANIM_DEATH_DURATION = 300;
const ANIM_FLASH_DURATION = 350;
const ANIM_FLOAT_DURATION = 600;

let animations = [];       // Active animations
let animating = false;      // True while animations are running
let animBlocked = false;     // True when waiting for animations to finish before next step
let pendingStepCallback = null; // Called when animations finish

function px(gridX) { return gridX * CELL + CELL / 2; }
function py(gridY) { return gridY * CELL + CELL / 2; }

function now() { return performance.now(); }

function addAnim(a) {
  a.startTime = now();
  animations.push(a);
}

function snapshotEntity(type, id, entity) {
  return { type, id, x: entity.x, y: entity.y, hp: entity.hp, alive: entity.alive, owner: entity.owner, etype: entity.type, isBuilding: entity.isBuilding };
}

function snapshotState(s) {
  const snap = { units: new Map(), buildings: new Map() };
  for (const [id, u] of s.units) snap.units.set(id, snapshotEntity('unit', id, u));
  for (const [id, b] of s.buildings) snap.buildings.set(id, snapshotEntity('building', id, b));
  return snap;
}

function buildAnimationsForEvent(oldSnap, ev) {
  const p = ev.payload;
  switch (ev.type) {
    case 'move': {
      const oldU = oldSnap.units.get(p.unitId);
      if (oldU) {
        addAnim({
          kind: 'move', unitId: p.unitId,
          fromX: oldU.x, fromY: oldU.y, toX: p.toX, toY: p.toY,
          duration: ANIM_MOVE_DURATION, owner: oldU.owner, etype: oldU.etype,
        });
      }
      break;
    }
    case 'produce_complete': {
      addAnim({
        kind: 'spawn', id: p.unitId, x: p.x, y: p.y,
        duration: ANIM_SPAWN_DURATION, owner: p.owner, etype: p.type,
      });
      break;
    }
    case 'build': {
      addAnim({
        kind: 'spawn', id: p.buildingId, x: p.x, y: p.y,
        duration: ANIM_SPAWN_DURATION, owner: p.owner, etype: p.type,
      });
      break;
    }
    case 'attack': {
      const target = oldSnap.units.get(p.targetId) || oldSnap.buildings.get(p.targetId);
      if (target) {
        addAnim({
          kind: 'flash', id: p.targetId, x: target.x, y: target.y,
          color: 'attack', duration: ANIM_FLASH_DURATION,
        });
        addAnim({
          kind: 'float', x: target.x, y: target.y, text: `-${p.damage}`,
          color: '#f44', duration: ANIM_FLOAT_DURATION,
        });
      }
      break;
    }
    case 'heal': {
      const target = oldSnap.units.get(p.targetId);
      if (target) {
        addAnim({
          kind: 'flash', id: p.targetId, x: target.x, y: target.y,
          color: 'heal', duration: ANIM_FLASH_DURATION,
        });
        addAnim({
          kind: 'float', x: target.x, y: target.y, text: `+${p.amount}`,
          color: '#5f8', duration: ANIM_FLOAT_DURATION,
        });
      }
      break;
    }
    case 'unit_death': {
      const oldU = oldSnap.units.get(p.unitId);
      if (oldU) {
        addAnim({
          kind: 'death', id: p.unitId, x: p.x, y: p.y,
          duration: ANIM_DEATH_DURATION, owner: oldU.owner, etype: oldU.etype,
        });
      }
      break;
    }
    case 'base_destroyed': {
      const oldB = oldSnap.buildings.get(p.buildingId);
      if (oldB) {
        addAnim({
          kind: 'death', id: p.buildingId, x: p.x, y: p.y,
          duration: ANIM_DEATH_DURATION, owner: oldB.owner, etype: oldB.etype,
        });
      }
      break;
    }
  }
}

function updateAnimations() {
  const t = now();
  animations = animations.filter(a => t - a.startTime < a.duration);
  if (animations.length === 0 && animBlocked) {
    animBlocked = false;
    animating = false;
    if (pendingStepCallback) {
      const cb = pendingStepCallback;
      pendingStepCallback = null;
      cb();
    }
  }
}

function drawAnimations() {
  const t = now();
  for (const a of animations) {
    const elapsed = t - a.startTime;
    const progress = Math.min(1, elapsed / a.duration);
    const ease = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;

    switch (a.kind) {
      case 'move': {
        // Hide the unit at its final position (already in state), draw it interpolated
        const cx = px(a.fromX) + (px(a.toX) - px(a.fromX)) * ease;
        const cy = py(a.fromY) + (py(a.toY) - py(a.fromY)) * ease;
        const color = a.owner === 'player_a' ? '#6cf' : '#f86';
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(cx, cy, CELL / 3, 0, 6.28);
        ctx.fill();
        ctx.fillStyle = '#000';
        ctx.font = '9px sans-serif';
        const letter = a.etype === 'infantry' ? 'I' : a.etype === 'sniper' ? 'S' : a.etype === 'tank' ? 'T' : 'M';
        ctx.fillText(letter, cx - 3, cy + 3);
        // Mark this unit as "being animated" so drawBoard skips it
        a._active = true;
        break;
      }
      case 'spawn': {
        const scale = ease;
        const alpha = ease;
        const r = CELL / 3 * scale;
        const color = a.owner === 'player_a' ? '#6cf' : '#f86';
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(px(a.x), py(a.y), r, 0, 6.28);
        ctx.fill();
        ctx.restore();
        break;
      }
      case 'death': {
        const alpha = 1 - ease;
        const scale = 1 - ease * 0.5;
        const color = a.owner === 'player_a' ? '#6cf' : '#f86';
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(px(a.x), py(a.y), CELL / 3 * scale, 0, 6.28);
        ctx.fill();
        ctx.restore();
        break;
      }
      case 'flash': {
        const alpha = 1 - progress;
        const radius = CELL / 2 + CELL * progress;
        const color = a.color === 'attack' ? 'rgba(255,60,60,' : 'rgba(60,255,120,';
        ctx.save();
        ctx.strokeStyle = color + alpha + ')';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px(a.x), py(a.y), radius, 0, 6.28);
        ctx.stroke();
        // Inner glow
        ctx.fillStyle = color + (alpha * 0.3) + ')';
        ctx.beginPath();
        ctx.arc(px(a.x), py(a.y), CELL / 2, 0, 6.28);
        ctx.fill();
        ctx.restore();
        break;
      }
      case 'float': {
        const yOffset = -CELL * 1.5 * ease;
        const alpha = progress < 0.7 ? 1 : 1 - (progress - 0.7) / 0.3;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = a.color;
        ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(a.text, px(a.x), py(a.y) + yOffset);
        ctx.restore();
        break;
      }
    }
  }
}

function isAnimating() {
  return animations.length > 0;
}

function onAnimationsDone(cb) {
  if (!isAnimating()) { cb(); return; }
  animBlocked = true;
  pendingStepCallback = cb;
}

function animLoop() {
  if (!animating) return;
  drawBoard();
  drawAnimations();
  updateAnimations();
  if (isAnimating()) {
    requestAnimationFrame(animLoop);
  } else {
    animating = false;
    drawBoard(); // Final clean draw
  }
}

// ─── Game list ───

async function fetchGameList() {
  const res = await fetch('/api/games');
  const { games } = await res.json();
  const prevValue = gameSelect.value;
  gameSelect.innerHTML = '<option value="">-- 选择对局 --</option>';
  for (const g of games) {
    const opt = document.createElement('option');
    opt.value = g.id;
    const names = g.playerNames || {};
    const nameA = names.player_a || 'A';
    const nameB = names.player_b || 'B';
    opt.textContent = `${g.id.slice(0, 8)} — ${g.phase} (回合 ${g.turnNumber}, ${g.currentOwner === 'player_a' ? nameA : nameB})`;
    gameSelect.appendChild(opt);
  }
  // Restore previous selection if still available
  if (prevValue && [...gameSelect.options].some(o => o.value === prevValue)) {
    gameSelect.value = prevValue;
  }
  return games;
}

// ─── State reconstruction ───

function createEmptyState() {
  const cfg = gameConfig || {};
  const map = cfg.map || {};
  const eco = cfg.economy || {};
  return {
    mapWidth: map.width || 20, mapHeight: map.height || 20,
    miningPoints: [],
    terrain: [],
    units: new Map(), buildings: new Map(),
    resources: { player_a: { gold: eco.startingGold || 100 }, player_b: { gold: eco.startingGold || 100 } },
    turn: { turnNumber: 1, currentOwner: 'player_a', phase: 'waiting_command' },
    eventLog: [], winner: null,
  };
}

function applyEvent(s, ev) {
  s.eventLog.push(ev);
  switch (ev.type) {
    case 'game_start':
      if (ev.payload.config) gameConfig = ev.payload.config;
      if (ev.payload.playerNames) playerNames = ev.payload.playerNames;
      s.mapWidth = ev.payload.mapWidth ?? (gameConfig?.map?.width ?? 20);
      s.mapHeight = ev.payload.mapHeight ?? (gameConfig?.map?.height ?? 20);
      s.miningPoints = ev.payload.miningPoints ?? [];
      s.terrain = ev.payload.terrain ?? [];
      if (ev.payload.buildings) {
        for (const b of ev.payload.buildings) {
          s.buildings.set(b.id, { ...b, production: b.production || null, buildProgress: b.buildProgress || 0 });
        }
      } else {
        const hqPos = gameConfig?.map?.headquartersPositions || {};
        const hqHp = gameConfig?.buildings?.headquarters?.hp || 200;
        const posA = hqPos.player_a || { x: 3, y: 10 };
        const posB = hqPos.player_b || { x: 16, y: 10 };
        s.buildings.set('hq_a', { id: 'hq_a', owner: 'player_a', type: 'headquarters', x: posA.x, y: posA.y, hp: hqHp, maxHp: hqHp, alive: true, isBuilding: false, production: null, buildProgress: 0 });
        s.buildings.set('hq_b', { id: 'hq_b', owner: 'player_b', type: 'headquarters', x: posB.x, y: posB.y, hp: hqHp, maxHp: hqHp, alive: true, isBuilding: false, production: null, buildProgress: 0 });
      }
      break;
    case 'build': {
      const bMaxHp = gameConfig?.buildings?.[ev.payload.type]?.hp || 60;
      s.resources[ev.payload.owner].gold -= ev.payload.cost || 0;
      s.buildings.set(ev.payload.buildingId, {
        id: ev.payload.buildingId, owner: ev.payload.owner, type: ev.payload.type,
        x: ev.payload.x, y: ev.payload.y,
        hp: bMaxHp, maxHp: bMaxHp,
        alive: true, isBuilding: true, production: null,
      });
      break;
    }
    case 'build_tick': {
      const b = s.buildings.get(ev.payload.buildingId);
      if (b) b.buildProgress = ev.payload.buildProgress;
      break;
    }
    case 'build_complete': {
      const b = s.buildings.get(ev.payload.buildingId);
      if (b) b.isBuilding = false;
      break;
    }
    case 'produce': {
      const b = s.buildings.get(ev.payload.buildingId);
      if (b) b.production = { type: ev.payload.unitType, turnsRemaining: ev.payload.productionTime };
      s.resources[ev.payload.owner].gold -= getUnitCost(ev.payload.unitType);
      break;
    }
    case 'produce_complete': {
      // Clear production slot on the building that produced this unit
      for (const b of s.buildings.values()) {
        if (b.owner === ev.payload.owner && b.production && b.production.type === ev.payload.type) {
          b.production = null;
          break;
        }
      }
      s.units.set(ev.payload.unitId, {
        id: ev.payload.unitId, owner: ev.payload.owner, type: ev.payload.type,
        x: ev.payload.x, y: ev.payload.y,
        hp: getUnitMaxHp(ev.payload.type), maxHp: getUnitMaxHp(ev.payload.type),
        alive: true, hasMoved: false, hasAttacked: false,
      });
      break;
    }
    case 'move': {
      const u = s.units.get(ev.payload.unitId);
      if (u) { u.x = ev.payload.toX; u.y = ev.payload.toY; u.hasMoved = true; }
      break;
    }
    case 'attack': {
      const t = s.units.get(ev.payload.targetId) || s.buildings.get(ev.payload.targetId);
      if (t) t.hp = ev.payload.targetHp;
      const a = s.units.get(ev.payload.attackerId);
      if (a) a.hasAttacked = true;
      break;
    }
    case 'heal': {
      const t = s.units.get(ev.payload.targetId);
      if (t) t.hp = ev.payload.targetHp;
      const m = s.units.get(ev.payload.medicId);
      if (m) m.hasAttacked = true;
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

function getUnitMaxHp(type) {
  return gameConfig?.units?.[type]?.hp || 100;
}

function getUnitCost(type) {
  return gameConfig?.units?.[type]?.cost || 0;
}

// ─── Replay: reconstruct state at a given step ───

function rebuildToStep(step) {
  // Clear animation state for instant jumps
  animations = [];
  animating = false;
  animBlocked = false;
  pendingStepCallback = null;

  state = createEmptyState();
  for (let i = 0; i <= step && i < allEvents.length; i++) {
    applyEvent(state, allEvents[i]);
  }
  currentStep = step;
  drawBoard();
  renderSidebar();
  renderDetail();
  updateControls();
}

// ─── Board rendering ───

function drawHpBar(cx, cy, hp, maxHp, barWidth) {
  if (hp >= maxHp) return;
  const ratio = hp / maxHp;
  const barH = 3;
  const x = cx - barWidth / 2;
  const y = cy;
  ctx.fillStyle = '#111';
  ctx.fillRect(x - 1, y - 1, barWidth + 2, barH + 2);
  ctx.fillStyle = ratio > 0.5 ? '#4a4' : ratio > 0.25 ? '#ca0' : '#e33';
  ctx.fillRect(x, y, barWidth * ratio, barH);
}

function drawBoard() {
  if (!state) return;
  canvas.width = state.mapWidth * CELL;
  canvas.height = state.mapHeight * CELL;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;
  for (let i = 0; i <= state.mapWidth; i++) {
    ctx.beginPath(); ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, state.mapHeight * CELL); ctx.stroke();
  }
  for (let j = 0; j <= state.mapHeight; j++) {
    ctx.beginPath(); ctx.moveTo(0, j * CELL); ctx.lineTo(state.mapWidth * CELL, j * CELL); ctx.stroke();
  }
  // hover highlight
  if (hoverCell) {
    ctx.fillStyle = 'rgba(255,255,255,.08)';
    ctx.fillRect(hoverCell.x * CELL, hoverCell.y * CELL, CELL, CELL);
  }

  ctx.fillStyle = '#b80';
  for (const p of state.miningPoints) {
    ctx.beginPath();
    ctx.arc(p.x * CELL + CELL / 2, p.y * CELL + CELL / 2, 4, 0, 6.28);
    ctx.fill();
  }
  // terrain
  for (let y = 0; y < state.mapHeight; y++) {
    for (let x = 0; x < state.mapWidth; x++) {
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
  for (const b of state.buildings.values()) {
    if (!b.alive) {
      // ghost for destroyed buildings
      ctx.save();
      ctx.globalAlpha = .25;
      const isA = b.owner === 'player_a';
      ctx.fillStyle = b.type === 'headquarters' ? (isA ? '#1a4070' : '#703010')
        : b.type === 'barracks' ? (isA ? '#2a5a90' : '#904a20')
        : (isA ? '#2a6a4a' : '#6a5a2a');
      ctx.fillRect(b.x * CELL + 2, b.y * CELL + 2, CELL - 4, CELL - 4);
      ctx.restore();
      continue;
    }
    const isA = b.owner === 'player_a';
    let color;
    if (b.type === 'headquarters') color = isA ? '#2a60a0' : '#a04020';
    else if (b.type === 'barracks') color = isA ? '#3a8ad9' : '#d96a3a';
    else color = isA ? '#4a9a6a' : '#9a7a3a';

    if (b.isBuilding) {
      // building under construction — dark base + progress bar
      ctx.fillStyle = '#333';
      ctx.fillRect(b.x * CELL + 1, b.y * CELL + 1, CELL - 2, CELL - 2);
      ctx.fillStyle = color;
      const buildTime = gameConfig?.buildings?.[b.type]?.buildTime || 1;
      const pct = Math.max(0, 1 - (b.buildProgress || 0) / buildTime);
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
    ctx.textAlign = 'left';

    // hp bar
    drawHpBar(b.x * CELL + CELL / 2, b.y * CELL - 2, b.hp, b.maxHp, CELL - 6);

    // production indicator (yellow dot)
    if (b.production) {
      ctx.fillStyle = '#ff0';
      ctx.beginPath();
      ctx.arc(b.x * CELL + CELL - 4, b.y * CELL + 4, 3, 0, 6.28);
      ctx.fill();
    }
  }
  for (const u of state.units.values()) {
    if (!u.alive) continue;
    // Skip units currently being animated by a move
    if (animations.some(a => a.kind === 'move' && a.unitId === u.id && a._active)) continue;
    const color = u.owner === 'player_a' ? '#6cf' : '#f86';
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(u.x * CELL + CELL / 2, u.y * CELL + CELL / 2, CELL / 3, 0, 6.28);
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    const letter = u.type === 'infantry' ? 'I' : u.type === 'sniper' ? 'S' : u.type === 'tank' ? 'T' : 'M';
    ctx.fillText(letter, u.x * CELL + CELL / 2, u.y * CELL + CELL / 2 + 3);
    ctx.textAlign = 'left';

    // highlight hovered entity
    if (hoverCell && hoverCell.x === u.x && hoverCell.y === u.y) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.strokeRect(u.x * CELL + 1, u.y * CELL + 1, CELL - 2, CELL - 2);
    }

    drawHpBar(u.x * CELL + CELL / 2, u.y * CELL - 2, u.hp, u.maxHp, CELL - 4);
  }

  // highlight hovered building
  if (hoverCell) {
    const hb = [...state.buildings.values()].find(b => b.alive && b.x === hoverCell.x && b.y === hoverCell.y);
    if (hb) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.strokeRect(hb.x * CELL + 1, hb.y * CELL + 1, CELL - 2, CELL - 2);
    }
  }
}

// ─── Canvas hover & selection ───

canvas.addEventListener('mousemove', e => {
  if (!state) return;
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left) / CELL);
  const y = Math.floor((e.clientY - rect.top) / CELL);
  if (x < 0 || y < 0 || x >= state.mapWidth || y >= state.mapHeight) {
    hoverCell = null;
    cellInfoEl.textContent = '';
    return;
  }
  hoverCell = { x, y };
  const u = [...state.units.values()].find(u => u.alive && u.x === x && u.y === y);
  const b = [...state.buildings.values()].find(b => b.alive && b.x === x && b.y === y);
  let info = `(${x}, ${y})`;
  if (u) {
    const typeName = u.type === 'infantry' ? '步兵' : u.type === 'sniper' ? '狙击手' : u.type === 'tank' ? '坦克' : '医疗兵';
    info += ` | ${typeName} [${playerName(u.owner)}] HP:${u.hp}/${u.maxHp}`;
  }
  if (b) {
    const typeName = b.type === 'headquarters' ? '总部' : b.type === 'barracks' ? '兵营' : '采矿器';
    const status = b.isBuilding ? ' 建造中' : b.production ? ` 生产${b.production.type}` : '';
    info += ` | ${typeName} [${playerName(b.owner)}] HP:${b.hp}/${b.maxHp}${status}`;
  }
  cellInfoEl.textContent = info;
  renderSelectionInfo(u, b);
});

canvas.addEventListener('mouseleave', () => {
  hoverCell = null;
  cellInfoEl.textContent = '';
});

canvas.addEventListener('click', e => {
  if (!state) return;
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left) / CELL);
  const y = Math.floor((e.clientY - rect.top) / CELL);
  if (x < 0 || y < 0 || x >= state.mapWidth || y >= state.mapHeight) return;
  const u = [...state.units.values()].find(u => u.alive && u.x === x && u.y === y);
  const b = [...state.buildings.values()].find(b => b.alive && b.x === x && b.y === y);
  if (u || b) renderSelectionInfo(u, b);
});

function renderSelectionInfo(u, b) {
  if (!selDetailEl) return;
  if (u) {
    const ownerCls = u.owner === 'player_a' ? 'player-a' : 'player-b';
    const ownerName = playerName(u.owner);
    const typeName = u.type === 'infantry' ? '步兵' : u.type === 'sniper' ? '狙击手' : u.type === 'tank' ? '坦克' : '医疗兵';
    const hpPct = Math.round((u.hp / u.maxHp) * 100);
    const hpColor = hpPct > 50 ? '#4a8' : hpPct > 25 ? '#ca0' : '#e33';
    const actions = [];
    if (!u.hasMoved) actions.push('可移动');
    if (!u.hasAttacked) actions.push(u.type === 'medic' ? '可治疗' : '可攻击');
    const spec = gameConfig?.units?.[u.type] || {};
    selDetailEl.innerHTML = `
      <div style="font-weight:700;font-size:15px;margin-bottom:4px"><span class="${ownerCls}">[${esc(ownerName)}]</span> ${esc(typeName)}</div>
      <div style="color:#8a8">❤️ ${u.hp} / ${u.maxHp} <span style="display:inline-block;width:80px;height:6px;background:#2a1a1a;border-radius:3px;vertical-align:middle;margin-left:6px"><span style="display:block;height:100%;border-radius:3px;background:${hpColor};width:${hpPct}%"></span></span></div>
      <div style="color:#9ab;font-size:12px;margin-top:4px">⚔️ 攻击 ${spec.attack ?? '-'}　🛡️ 防御 ${spec.defense ?? '-'}</div>
      <div style="color:#9ab;font-size:12px">🏃 移动 ${spec.moveRange ?? '-'}　🎯 射程 ${spec.attackRange ?? '-'}</div>
      <div style="color:#5a7a8a;font-size:12px;margin-top:4px">📍 (${u.x}, ${u.y})</div>
      ${actions.length > 0 ? `<div style="color:#6a8;font-size:11px;margin-top:4px">${actions.join(' · ')}</div>` : '<div style="color:#a66;font-size:11px;margin-top:4px">本回合已行动</div>'}
    `;
    return;
  }
  if (b) {
    const ownerCls = b.owner === 'player_a' ? 'player-a' : 'player-b';
    const ownerName = playerName(b.owner);
    const typeName = b.type === 'headquarters' ? '总部' : b.type === 'barracks' ? '兵营' : '采矿器';
    const hpPct = Math.round((b.hp / b.maxHp) * 100);
    const hpColor = hpPct > 50 ? '#4a8' : hpPct > 25 ? '#ca0' : '#e33';
    const statusText = b.isBuilding
      ? `🔨 建造中 (剩余 ${b.buildProgress || 0} 回合)`
      : b.production
      ? `🏭 生产中: ${b.production.type === 'infantry' ? '步兵' : b.production.type === 'sniper' ? '狙击手' : b.production.type === 'tank' ? '坦克' : '医疗兵'} (剩余 ${b.production.turnsRemaining} 回合)`
      : '✅ 空闲';
    selDetailEl.innerHTML = `
      <div style="font-weight:700;font-size:15px;margin-bottom:4px"><span class="${ownerCls}">[${esc(ownerName)}]</span> ${esc(typeName)}</div>
      <div style="color:#8a8">❤️ ${b.hp} / ${b.maxHp} <span style="display:inline-block;width:80px;height:6px;background:#2a1a1a;border-radius:3px;vertical-align:middle;margin-left:6px"><span style="display:block;height:100%;border-radius:3px;background:${hpColor};width:${hpPct}%"></span></span></div>
      <div style="color:#5a7a8a;font-size:12px;margin-top:4px">📍 (${b.x}, ${b.y})</div>
      <div style="color:#9ab;font-size:12px;margin-top:4px">${statusText}</div>
    `;
    return;
  }
  selDetailEl.textContent = '点击或悬停棋盘查看单位/建筑信息';
}

// ─── Sidebar ───

function renderSidebar() {
  if (!state) return;

  // Count units & buildings per player
  const counts = { a_units: 0, b_units: 0, a_bld: 0, b_bld: 0 };
  for (const u of state.units.values()) {
    if (!u.alive) continue;
    if (u.owner === 'player_a') counts.a_units++; else counts.b_units++;
  }
  for (const b of state.buildings.values()) {
    if (!b.alive) continue;
    if (b.owner === 'player_a') counts.a_bld++; else counts.b_bld++;
  }

  const turnOwner = state.turn.currentOwner;
  const isOver = state.turn.phase === 'game_over';

  resourcesEl.innerHTML = `
    <h3>资源 & 总览</h3>
    <div style="display:flex;gap:16px;margin-bottom:8px">
      <div><span class="player-a">${esc(playerName('player_a'))}</span>: ${state.resources.player_a.gold} 金</div>
      <div><span class="player-b">${esc(playerName('player_b'))}</span>: ${state.resources.player_b.gold} 金</div>
    </div>
    <div style="font-size:11px;color:#5a7a8a">
      <span class="player-a">${esc(playerName('player_a'))}</span>: ${counts.a_units} 单位 / ${counts.a_bld} 建筑
      &nbsp;|&nbsp;
      <span class="player-b">${esc(playerName('player_b'))}</span>: ${counts.b_units} 单位 / ${counts.b_bld} 建筑
    </div>
  `;
  turnInfoEl.innerHTML = `
    <h3>回合 ${state.turn.turnNumber}</h3>
    <div>当前: <span class="${turnOwner === 'player_a' ? 'player-a' : 'player-b'}">${esc(playerName(turnOwner))}</span></div>
    ${isOver ? `<div style="color:#ff8;font-weight:700;margin-top:4px">🏆 游戏结束 — 胜者: ${esc(state.winner ? playerName(state.winner) : '无')}</div>` : ''}
  `;

  // Event log — show all, highlight current
  eventsEl.innerHTML = '';
  for (let i = 0; i < allEvents.length; i++) {
    const ev = allEvents[i];
    const li = document.createElement('li');
    li.dataset.type = ev.type;
    li.textContent = `#${ev.seq} ${formatEventShort(ev)}`;
    if (i === currentStep) li.classList.add('active');
    li.addEventListener('click', () => {
      pausePlayback();
      rebuildToStep(i);
    });
    eventsEl.appendChild(li);
  }

  // Scroll active event into view
  const activeLi = eventsEl.querySelector('.active');
  if (activeLi) activeLi.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ─── Event detail ───

function renderDetail() {
  if (!state || currentStep < 0 || currentStep >= allEvents.length) {
    detailEl.innerHTML = '<span style="color:#666">无操作</span>';
    return;
  }
  const ev = allEvents[currentStep];
  const typeClass = getTypeClass(ev.type);
  const payloadStr = formatPayload(ev.payload);
  detailEl.innerHTML = `
    <span class="ev-type ${typeClass}">${esc(ev.type)}</span>
    <span style="color:#888">#${ev.seq}</span>
    <span class="ev-payload">${esc(payloadStr)}</span>
  `;
}

function getTypeClass(type) {
  const classes = {
    attack: 'attack', move: 'move', build: 'build', build_tick: 'build', build_complete: 'build',
    produce: 'produce', produce_complete: 'produce', heal: 'heal',
    turn_end: 'turn_end', game_over: 'game_over',
    unit_death: 'unit_death', base_destroyed: 'base_destroyed',
  };
  return classes[type] || 'other';
}

function formatPayload(payload) {
  const lines = [];
  for (const [k, v] of Object.entries(payload)) {
    let val = v;
    if (typeof val === 'string' && val.length > 20) val = val.slice(0, 12) + '…';
    lines.push(`${k}: ${JSON.stringify(val)}`);
  }
  return lines.join('\n');
}

function formatEventShort(ev) {
  const p = ev.payload;
  switch (ev.type) {
    case 'move': return `移动 ${p.unitId?.slice(0,6)} (${p.fromX},${p.fromY})->(${p.toX},${p.toY})`;
    case 'attack': return `攻击 ${p.attackerId?.slice(0,6)} → ${p.targetId?.slice(0,6)} 伤害:${p.damage}`;
    case 'heal': return `治疗 ${p.medicId?.slice(0,6)} → ${p.targetId?.slice(0,6)} +${p.amount}`;
    case 'build': return `建造 ${p.type} @(${p.x},${p.y})`;
    case 'build_tick': return `建造进度 ${p.type} 剩余${p.buildProgress}回合`;
    case 'build_complete': return `建造完成 ${p.buildingId?.slice(0,6)}`;
    case 'produce': return `生产 ${p.unitType}`;
    case 'produce_complete': return `${p.type} 出现在(${p.x},${p.y})`;
    case 'unit_death': return `单位阵亡 ${p.unitId?.slice(0,6)}`;
    case 'base_destroyed': return `建筑摧毁 ${p.type} @(${p.x},${p.y})`;
    case 'turn_end': return `回合结束 → ${playerName(p.nextOwner)} (回合${p.turnNumber})`;
    case 'game_over': return `游戏结束 胜者:${p.winner ? playerName(p.winner) : '无'}`;
    case 'mine': return `采矿收入 +${p.amount}`;
    case 'base_income': return `基础收入 +${p.amount}`;
    case 'reset_actions': return `行动重置 ${p.owner}`;
    default: return `${ev.type} ${JSON.stringify(p).slice(0,60)}`;
  }
}

// ─── Playback controls ───

function updateControls() {
  const total = allEvents.length;
  stepInfo.textContent = `${currentStep + 1} / ${total}`;
  timeline.max = Math.max(0, total - 1);
  timeline.value = currentStep;
  btnPlay.textContent = playing ? '⏸' : '▶';
  btnPlay.classList.toggle('active', playing);

  // Highlight active event in log
  const lis = eventsEl.querySelectorAll('li');
  lis.forEach((li, i) => {
    li.classList.toggle('active', i === currentStep);
  });
  const activeLi = eventsEl.querySelector('.active');
  if (activeLi) activeLi.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function stepForward() {
  if (currentStep >= allEvents.length - 1) {
    pausePlayback();
    return;
  }
  const nextStep = currentStep + 1;
  const ev = allEvents[nextStep];

  // Snapshot entities before applying event
  const oldSnap = state ? snapshotState(state) : null;

  // Apply event to state
  applyEvent(state, ev);
  currentStep = nextStep;

  // Build animations from the diff
  if (oldSnap) {
    animations = [];
    buildAnimationsForEvent(oldSnap, ev);
    if (isAnimating()) {
      animating = true;
      animBlocked = true;
      requestAnimationFrame(animLoop);
    }
  }

  renderSidebar();
  renderDetail();
  updateControls();
}

function stepBackward() {
  if (currentStep > 0) {
    rebuildToStep(currentStep - 1);
  }
}

function goToStart() {
  pausePlayback();
  rebuildToStep(-1);
}

function goToEnd() {
  pausePlayback();
  rebuildToStep(allEvents.length - 1);
}

function startPlayback() {
  if (allEvents.length === 0) return;
  if (currentStep >= allEvents.length - 1) {
    // Already at end, restart from beginning
    rebuildToStep(-1);
  }
  playing = true;
  updateControls();
  scheduleNext();
}

function pausePlayback() {
  playing = false;
  if (playTimer) { clearTimeout(playTimer); playTimer = null; }
  updateControls();
}

function togglePlayback() {
  if (playing) pausePlayback();
  else startPlayback();
}

function scheduleNext() {
  if (!playing) return;
  const speed = parseInt(speedSelect.value) || 500;
  // Wait for current animations + speed delay, then step
  const waitAndStep = () => {
    playTimer = setTimeout(() => {
      if (!playing) return;
      stepForward();
      if (playing) {
        if (isAnimating()) {
          onAnimationsDone(() => { if (playing) scheduleNext(); });
        } else {
          scheduleNext();
        }
      }
    }, speed);
  };
  if (isAnimating()) {
    onAnimationsDone(waitAndStep);
  } else {
    waitAndStep();
  }
}

// ─── Timeline markers ───

function buildTimelineMarkers() {
  timelineMarkers.innerHTML = '';
  const total = allEvents.length;
  if (total <= 1) return;
  for (let i = 0; i < total; i++) {
    const ev = allEvents[i];
    const marker = document.createElement('div');
    marker.className = `marker marker-${getTypeClass(ev.type)}`;
    marker.style.left = `${(i / (total - 1)) * 100}%`;
    timelineMarkers.appendChild(marker);
  }
}

// ─── Load game ───

async function loadGameState(id) {
  pausePlayback();
  allEvents = [];
  currentStep = -1;
  state = null;

  const res = await fetch(`/api/games/${id}/events`);
  const { events } = await res.json();
  allEvents = events;

  buildTimelineMarkers();

  // Jump to end
  if (allEvents.length > 0) {
    rebuildToStep(allEvents.length - 1);
  } else {
    state = createEmptyState();
    drawBoard();
    renderSidebar();
    renderDetail();
    updateControls();
  }
}

function subscribeSse(id) {
  if (liveSse) liveSse.close();
  liveSse = new EventSource(`/api/games/${id}/events`);
  liveSse.onmessage = e => {
    try {
      const ev = JSON.parse(e.data);
      allEvents.push(ev);
      buildTimelineMarkers();
      timeline.max = allEvents.length - 1;
      // If at end, auto-advance
      if (currentStep >= allEvents.length - 2) {
        stepForward();
      }
      updateControls();
      statusEl.textContent = '实时连接中';
    } catch (err) { console.error(err); }
  };
  liveSse.onerror = () => {
    statusEl.textContent = 'SSE 断开，重连中…';
    // EventSource auto-reconnects, but reload state on open
    liveSse.addEventListener('open', async () => {
      statusEl.textContent = '已重连，同步中…';
      await loadGameState(id);
      statusEl.textContent = '实时连接中';
    }, { once: true });
  };
}

// ─── Event listeners ───

gameSelect.addEventListener('change', async () => {
  const id = gameSelect.value;
  if (!id) return;
  await loadGameState(id);
  subscribeSse(id);
  statusEl.textContent = '已订阅事件';
});

refreshBtn.addEventListener('click', fetchGameList);

btnStart.addEventListener('click', goToStart);
btnPrev.addEventListener('click', () => { pausePlayback(); stepBackward(); });
btnPlay.addEventListener('click', togglePlayback);
btnNext.addEventListener('click', () => { pausePlayback(); stepForward(); });
btnEnd.addEventListener('click', goToEnd);

timeline.addEventListener('input', () => {
  pausePlayback();
  rebuildToStep(parseInt(timeline.value));
});

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  switch (e.key) {
    case ' ':
      e.preventDefault();
      togglePlayback();
      break;
    case 'ArrowRight':
      e.preventDefault();
      pausePlayback();
      stepForward();
      break;
    case 'ArrowLeft':
      e.preventDefault();
      pausePlayback();
      stepBackward();
      break;
    case 'Home':
      e.preventDefault();
      goToStart();
      break;
    case 'End':
      e.preventDefault();
      goToEnd();
      break;
  }
});

// ─── Export / Import ───

const btnExportHtml = document.getElementById('btn-export-html');
const btnExportJson = document.getElementById('btn-export-json');
const btnImport = document.getElementById('btn-import');
const importFile = document.getElementById('import-file');

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function gameFilename(ext) {
  const id = gameSelect.value || 'unknown';
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `game_${id.slice(0, 8)}_${ts}.${ext}`;
}

function exportJson() {
  if (allEvents.length === 0) { alert('没有可导出的对局'); return; }
  const data = {
    gameId: gameSelect.value,
    exportedAt: new Date().toISOString(),
    eventCount: allEvents.length,
    events: allEvents,
  };
  downloadFile(gameFilename('json'), JSON.stringify(data, null, 2), 'application/json');
}

function exportHtml() {
  if (allEvents.length === 0) { alert('没有可导出的对局'); return; }

  // Fetch current CSS and JS to embed
  Promise.all([
    fetch('/style.css').then(r => r.text()),
    fetch('/app.js').then(r => r.text()),
  ]).then(([cssText, jsText]) => {
    // Build standalone HTML
    const eventsJson = JSON.stringify(allEvents);
    const gameId = gameSelect.value || 'unknown';
    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"/>
<title>战棋回放 — ${gameId.slice(0, 8)}</title>
<style>
${cssText}
/* Standalone overrides */
header { display: none; }
#replay-controls { border: 1px solid #333; }
body { padding-top: 12px; }
</style>
</head>
<body>
<main>
<div id="board-wrap">
  <canvas id="board" width="840" height="840"></canvas>
  <div id="replay-controls">
    <div id="control-buttons">
      <button id="btn-start" title="回到开始">⏮</button>
      <button id="btn-prev" title="上一步 (←)">◀</button>
      <button id="btn-play" title="播放/暂停 (Space)">▶</button>
      <button id="btn-next" title="下一步 (→)">▶</button>
      <button id="btn-end" title="跳到末尾">⏭</button>
      <select id="speed-select" title="播放速度">
        <option value="1000">0.5x</option>
        <option value="500" selected>1x</option>
        <option value="200">2.5x</option>
        <option value="100">5x</option>
        <option value="50">10x</option>
      </select>
      <span id="step-info">0 / 0</span>
    </div>
    <div id="timeline-wrap">
      <input type="range" id="timeline" min="0" max="0" value="0"/>
      <div id="timeline-markers"></div>
    </div>
  </div>
</div>
<aside id="sidebar">
  <section id="resources"></section>
  <section id="turn-info"></section>
  <section id="event-detail">
    <h3>当前操作</h3>
    <div id="detail-content">使用时间轴回放</div>
  </section>
  <section id="event-log">
    <h3>事件流</h3>
    <ul id="events"></ul>
  </section>
</aside>
</main>
<script>
// Embedded events data
const EMBEDDED_EVENTS = ${eventsJson};
// Override fetch for standalone mode
const _fetch = window.fetch;
window.fetch = function(url, opts) {
  if (typeof url === 'string' && url.includes('/events')) {
    return Promise.resolve(new Response(JSON.stringify({ events: EMBEDDED_EVENTS })));
  }
  if (typeof url === 'string' && url === '/api/games') {
    return Promise.resolve(new Response(JSON.stringify({ games: [
      { id: '${gameId}', phase: 'game_over', turnNumber: 0, currentOwner: 'player_a', winner: null }
    ] })));
  }
  return _fetch.call(this, url, opts);
};
</script>
<script>
${jsText}
</script>
</body>
</html>`;
    downloadFile(gameFilename('html'), html, 'text/html');
  });
}

function importJson() {
  importFile.click();
}

importFile.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data.events || !Array.isArray(data.events)) {
        alert('无效的对局文件：缺少 events 数组');
        return;
      }
      allEvents = data.events;
      buildTimelineMarkers();
      if (allEvents.length > 0) {
        rebuildToStep(allEvents.length - 1);
      }
      // Update game select to show imported game
      const importedId = data.gameId || 'imported';
      statusEl.textContent = `已导入 ${importedId.slice(0,8)} (${allEvents.length} 事件)`;
      // Disconnect SSE since this is a local import
      if (liveSse) { liveSse.close(); liveSse = null; }
    } catch (err) {
      alert('解析失败: ' + err.message);
    }
  };
  reader.readAsText(file);
  importFile.value = '';
});

btnExportHtml.addEventListener('click', exportHtml);
btnExportJson.addEventListener('click', exportJson);
btnImport.addEventListener('click', importJson);

// ─── Auto-refresh & follow latest ───

async function autoRefreshTick() {
  if (!autoRefreshCb.checked) return;
  const games = await fetchGameList();
  if (!games || games.length === 0) return;

  // Follow latest: auto-select the first (most recent) game
  if (followLatestCb.checked) {
    const latestId = games[0].id;
    const currentId = gameSelect.value;
    if (latestId !== currentId) {
      gameSelect.value = latestId;
      await loadGameState(latestId);
      subscribeSse(latestId);
      statusEl.textContent = '自动切换到最新对局';
    }
  }
}

function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(autoRefreshTick, REFRESH_INTERVAL);
}

function stopAutoRefresh() {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
}

autoRefreshCb.addEventListener('change', () => {
  if (autoRefreshCb.checked) startAutoRefresh();
  else stopAutoRefresh();
});

// ─── Init ───

fetchGameList();
startAutoRefresh();
