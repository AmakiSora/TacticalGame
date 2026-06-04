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

  // build
  buildType:    $('build-type'),
  buildX:       $('build-x'),
  buildY:       $('build-y'),
  btnBuild:     $('btn-build'),

  // produce
  produceBldg:  $('produce-building'),
  produceType:  $('produce-type'),
  btnProduce:   $('btn-produce'),

  // move
  moveUnit:     $('move-unit'),
  moveX:        $('move-x'),
  moveY:        $('move-y'),
  btnMove:      $('btn-move'),

  // attack
  attackUnit:   $('attack-unit'),
  attackTarget: $('attack-target'),
  btnAttack:    $('btn-attack'),

  // heal
  healMedic:    $('heal-medic'),
  healTarget:   $('heal-target'),
  btnHeal:      $('btn-heal'),

  // events
  events:       $('events'),
};

const ctx = els.canvas.getContext('2d');

// ─── state ───
let state = null;          // reconstructed game state
let gameId = null;
let myToken = null;
let myPlayer = null;       // 'player_a' | 'player_b'
let sse = null;
let hoverCell = null;
let selectedUnitId = null;

// ─── helpers ───
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
  return {
    mapWidth: 30, mapHeight: 30,
    miningPoints: [],
    units: new Map(),
    buildings: new Map(),
    resources: { player_a: { gold: 100 }, player_b: { gold: 100 } },
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
      s.mapWidth = p.mapWidth ?? 30;
      s.mapHeight = p.mapHeight ?? 30;
      s.miningPoints = p.miningPoints ?? [];
      // buildings from payload or defaults
      if (p.buildings) {
        for (const b of p.buildings) s.buildings.set(b.id, { ...b });
      } else {
        s.buildings.set('hq_a', { id:'hq_a', owner:'player_a', type:'headquarters', x:4,  y:15, hp:200, maxHp:200, alive:true, isBuilding:false, production:null, buildProgress:0 });
        s.buildings.set('hq_b', { id:'hq_b', owner:'player_b', type:'headquarters', x:25, y:15, hp:200, maxHp:200, alive:true, isBuilding:false, production:null, buildProgress:0 });
      }
      break;
    case 'build':
      s.resources[p.owner].gold -= (p.cost || 0);
      s.buildings.set(p.buildingId, {
        id: p.buildingId, owner: p.owner, type: p.type,
        x: p.x, y: p.y, hp: p.hp || 60, maxHp: p.maxHp || 60,
        alive: true, isBuilding: true, production: null, buildProgress: 0,
      });
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
      s.units.set(p.unitId, {
        id: p.unitId, owner: p.owner, type: p.type,
        x: p.x, y: p.y,
        hp: p.hp || 100, maxHp: p.maxHp || 100,
        attack: p.attack || 0, defense: p.defense || 0,
        moveRange: p.moveRange || 0, attackRange: p.attackRange || 0,
        alive: true, hasMoved: false, hasAttacked: false,
      });
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
      s.resources[p.owner].gold += p.amount;
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

  // mining points
  ctx.fillStyle = COLORS.gold;
  for (const p of state.miningPoints) {
    ctx.beginPath();
    ctx.arc(p.x * CELL + CELL / 2, p.y * CELL + CELL / 2, 3, 0, Math.PI * 2);
    ctx.fill();
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
      ctx.strokeStyle = COLORS.select;
      ctx.lineWidth = 2;
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
    const color = u.owner === 'player_a' ? COLORS.unit_a : COLORS.unit_b;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(u.x * CELL + CELL / 2, u.y * CELL + CELL / 2, CELL / 3, 0, Math.PI * 2);
    ctx.fill();

    // inner circle for moved/attacked
    if (u.hasMoved && u.hasAttacked) {
      ctx.fillStyle = 'rgba(0,0,0,.4)';
      ctx.beginPath();
      ctx.arc(u.x * CELL + CELL / 2, u.y * CELL + CELL / 2, CELL / 5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = '#000';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    const letter = u.type === 'infantry' ? 'I' : u.type === 'sniper' ? 'S' : u.type === 'tank' ? 'T' : 'M';
    ctx.fillText(letter, u.x * CELL + CELL / 2, u.y * CELL + CELL / 2 + 3);

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

  // populate selects
  populateSelects();

  // events
  renderEvents();
}

function populateSelects() {
  if (!state) return;
  const myUnits = [...state.units.values()].filter(u => u.owner === myPlayer && u.alive);
  const allEnemyUnits = [...state.units.values()].filter(u => u.owner !== myPlayer && u.alive);
  const allEnemyBuildings = [...state.buildings.values()].filter(b => b.owner !== myPlayer && b.alive);
  const myBuildings = [...state.buildings.values()].filter(b => b.owner === myPlayer && b.alive && !b.isBuilding);
  const myBarracks = myBuildings.filter(b => b.type === 'barracks');
  const myMedics = myUnits.filter(u => u.type === 'medic');
  const myNonMedics = myUnits.filter(u => u.type !== 'medic');
  const healTargets = myUnits.filter(u => u.hp < u.maxHp);

  // move unit
  const moveSel = els.moveUnit;
  moveSel.innerHTML = '<option value="">-- 选择单位 --</option>';
  for (const u of myUnits) {
    moveSel.innerHTML += `<option value="${u.id}">${u.type} #${u.id.slice(-4)} (${u.x},${y=u.y})</option>`;
  }

  // produce building
  const prodSel = els.produceBldg;
  prodSel.innerHTML = '<option value="">-- 选择兵营 --</option>';
  for (const b of myBarracks) {
    prodSel.innerHTML += `<option value="${b.id}">兵营 #${b.id.slice(-4)} (${b.x},${b.y}) ${b.production ? '[生产中]' : ''}</option>`;
  }

  // attack
  const atkSel = els.attackUnit;
  atkSel.innerHTML = '<option value="">-- 攻击方 --</option>';
  for (const u of myNonMedics) {
    atkSel.innerHTML += `<option value="${u.id}">${u.type} #${u.id.slice(-4)}</option>`;
  }
  const tgtSel = els.attackTarget;
  tgtSel.innerHTML = '<option value="">-- 目标 --</option>';
  for (const u of allEnemyUnits) {
    tgtSel.innerHTML += `<option value="${u.id}">单位 ${u.type} #${u.id.slice(-4)}</option>`;
  }
  for (const b of allEnemyBuildings) {
    tgtSel.innerHTML += `<option value="${b.id}">建筑 ${b.type} #${b.id.slice(-4)}</option>`;
  }

  // heal
  const medSel = els.healMedic;
  medSel.innerHTML = '<option value="">-- 医疗兵 --</option>';
  for (const u of myMedics) {
    medSel.innerHTML += `<option value="${u.id}">医疗兵 #${u.id.slice(-4)}</option>`;
  }
  const healSel = els.healTarget;
  healSel.innerHTML = '<option value="">-- 治疗目标 --</option>';
  for (const u of healTargets) {
    healSel.innerHTML += `<option value="${u.id}">${u.type} #${u.id.slice(-4)} (hp:${u.hp}/${u.maxHp})</option>`;
  }
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
    li.innerHTML = `<span class="ev-seq">#${ev.seq}</span><span class="ev-type">${ev.type}</span>${payload}`;
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

els.canvas.addEventListener('click', e => {
  const cell = cellFromMouse(e);
  if (!cell) return;

  // check if clicked on own unit → select it
  const unit = [...state.units.values()].find(u => u.owner === myPlayer && u.alive && u.x === cell.x && u.y === cell.y);
  if (unit) {
    selectedUnitId = selectedUnitId === unit.id ? null : unit.id;
    // also populate move form with current pos
    els.moveUnit.value = unit.id;
    els.moveX.value = '';
    els.moveY.value = '';
    drawBoard();
    return;
  }

  // if a unit is selected and we clicked elsewhere → set move target
  if (selectedUnitId) {
    els.moveX.value = cell.x;
    els.moveY.value = cell.y;
  }

  // fill build coords
  els.buildX.value = cell.x;
  els.buildY.value = cell.y;

  // check if clicked enemy → set attack target
  const enemy = [...state.units.values()].find(u => u.owner !== myPlayer && u.alive && u.x === cell.x && u.y === cell.y)
    || [...state.buildings.values()].find(b => b.owner !== myPlayer && b.alive && b.x === cell.x && b.y === cell.y);
  if (enemy) {
    els.attackTarget.value = enemy.id;
    els.healTarget.value = enemy.id;
  }
});

// ─── SSE subscription ───
function subscribeSse() {
  if (sse) sse.close();
  sse = new EventSource(`/api/games/${gameId}/events`);
  sse.onmessage = e => {
    try {
      const ev = JSON.parse(e.data);
      if (!state) state = createEmptyState();
      applyEvent(state, ev);
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

els.btnBuild.addEventListener('click', async () => {
  await apiAction(`/api/games/${gameId}/build`, {
    type: els.buildType.value,
    x: Number(els.buildX.value),
    y: Number(els.buildY.value),
  });
});

els.btnProduce.addEventListener('click', async () => {
  await apiAction(`/api/games/${gameId}/produce`, {
    buildingId: els.produceBldg.value,
    unitType: els.produceType.value,
  });
});

els.btnMove.addEventListener('click', async () => {
  await apiAction(`/api/games/${gameId}/move`, {
    unitId: els.moveUnit.value,
    x: Number(els.moveX.value),
    y: Number(els.moveY.value),
  });
  selectedUnitId = null;
  drawBoard();
});

els.btnAttack.addEventListener('click', async () => {
  await apiAction(`/api/games/${gameId}/attack`, {
    attackerId: els.attackUnit.value,
    targetId: els.attackTarget.value,
  });
});

els.btnHeal.addEventListener('click', async () => {
  await apiAction(`/api/games/${gameId}/heal`, {
    medicId: els.healMedic.value,
    targetId: els.healTarget.value,
  });
});

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
  const res = await fetch('/api/games', { method: 'POST' });
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

  // load state first so UI renders immediately
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
    selectedUnitId = null;
    drawBoard();
  }
  if (e.key === ' ' || e.key === 'Enter') {
    if (state && state.turn.currentOwner === myPlayer) {
      els.btnEndTurn.click();
    }
  }
});
