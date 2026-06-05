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
const detailEl = document.getElementById('detail-content');

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
  gameSelect.innerHTML = '<option value="">-- 选择对局 --</option>';
  for (const g of games) {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = `${g.id.slice(0, 8)} — ${g.phase} (回合 ${g.turnNumber}, ${g.currentOwner})`;
    gameSelect.appendChild(opt);
  }
}

// ─── State reconstruction ───

function createEmptyState() {
  return {
    mapWidth: 20, mapHeight: 20,
    miningPoints: [],
    units: new Map(), buildings: new Map(),
    resources: { player_a: { gold: 100 }, player_b: { gold: 100 } },
    turn: { turnNumber: 1, currentOwner: 'player_a', phase: 'waiting_command' },
    eventLog: [], winner: null,
  };
}

function applyEvent(s, ev) {
  s.eventLog.push(ev);
  switch (ev.type) {
    case 'game_start':
      s.mapWidth = ev.payload.mapWidth ?? 20;
      s.mapHeight = ev.payload.mapHeight ?? 20;
      s.miningPoints = ev.payload.miningPoints ?? [];
      if (ev.payload.buildings) {
        for (const b of ev.payload.buildings) {
          s.buildings.set(b.id, { ...b, production: b.production || null, buildProgress: b.buildProgress || 0 });
        }
      } else {
        s.buildings.set('hq_a', { id: 'hq_a', owner: 'player_a', type: 'headquarters', x: 4, y: 15, hp: 200, maxHp: 200, alive: true, isBuilding: false, production: null, buildProgress: 0 });
        s.buildings.set('hq_b', { id: 'hq_b', owner: 'player_b', type: 'headquarters', x: 25, y: 15, hp: 200, maxHp: 200, alive: true, isBuilding: false, production: null, buildProgress: 0 });
      }
      break;
    case 'build': {
      const maxHp = { headquarters: 200, barracks: 100, miner: 60 };
      s.resources[ev.payload.owner].gold -= ev.payload.cost || 0;
      s.buildings.set(ev.payload.buildingId, {
        id: ev.payload.buildingId, owner: ev.payload.owner, type: ev.payload.type,
        x: ev.payload.x, y: ev.payload.y,
        hp: maxHp[ev.payload.type] || 60, maxHp: maxHp[ev.payload.type] || 60,
        alive: true, isBuilding: true, production: null,
      });
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
  const hp = { infantry: 100, sniper: 60, tank: 150, medic: 70 };
  return hp[type] || 100;
}

function getUnitCost(type) {
  const cost = { infantry: 40, sniper: 60, tank: 80, medic: 50 };
  return cost[type] || 0;
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
    drawHpBar(b.x * CELL + CELL / 2, b.y * CELL + CELL - 1, b.hp, b.maxHp, CELL - 6);
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
    ctx.font = '9px sans-serif';
    const letter = u.type === 'infantry' ? 'I' : u.type === 'sniper' ? 'S' : u.type === 'tank' ? 'T' : 'M';
    ctx.fillText(letter, u.x * CELL + CELL / 2 - 3, u.y * CELL + CELL / 2 + 3);
    drawHpBar(u.x * CELL + CELL / 2, u.y * CELL - 2, u.hp, u.maxHp, CELL - 4);
  }
}

// ─── Sidebar ───

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
    <span class="ev-type ${typeClass}">${ev.type}</span>
    <span style="color:#888">#${ev.seq}</span>
    <span class="ev-payload">${payloadStr}</span>
  `;
}

function getTypeClass(type) {
  const classes = {
    attack: 'attack', move: 'move', build: 'build', build_complete: 'build',
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
    case 'build_complete': return `建造完成 ${p.buildingId?.slice(0,6)}`;
    case 'produce': return `生产 ${p.unitType}`;
    case 'produce_complete': return `${p.type} 出现在(${p.x},${p.y})`;
    case 'unit_death': return `单位阵亡 ${p.unitId?.slice(0,6)}`;
    case 'base_destroyed': return `建筑摧毁 ${p.type} @(${p.x},${p.y})`;
    case 'turn_end': return `回合结束 → ${p.nextOwner} (回合${p.turnNumber})`;
    case 'game_over': return `游戏结束 胜者:${p.winner}`;
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
    } catch (err) { console.error(err); }
  };
  liveSse.onerror = () => { statusEl.textContent = 'SSE 断开'; };
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

// ─── Init ───

fetchGameList();
