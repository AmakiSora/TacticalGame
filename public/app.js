const HEX_SIZE = 28;
const PAD = 42;
const SQRT3 = Math.sqrt(3);

const TERRAIN = {
  plain: '#111923',
  water: '#183a55',
  blocker: '#393f46',
};
const OWNER_COLOR = { player_a: '#66ccff', player_b: '#ff9966' };
const UNIT_NAMES = { infantry: '步兵', scout: '侦察兵', heavy: '重装', ranger: '远程兵', support: '支援兵' };
const UNIT_LABELS = { infantry: 'INF', scout: 'SCT', heavy: 'HVY', ranger: 'RNG', support: 'SUP', headquarters: 'HQ' };

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
const btnExportHtml = document.getElementById('btn-export-html');
const btnExportJson = document.getElementById('btn-export-json');
const btnImport = document.getElementById('btn-import');
const importFile = document.getElementById('import-file');

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function defaultPlayerNames() {
  return { player_a: '玩家 A', player_b: '玩家 B' };
}

function playerName(owner) {
  return playerNames[owner] || (owner === 'player_a' ? '玩家 A' : '玩家 B');
}

function playerNameControl(owner) {
  const cls = owner === 'player_a' ? 'player-a' : 'player-b';
  return `<button class="player-name ${cls}" data-rename-player="${owner}" title="更改玩家名字">${esc(playerName(owner))}</button>`;
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
    map: { radius: 8, cells: [], terrainCells: [] },
    cells: [],
    controlPoints: new Map(),
    headquarters: new Map(),
    units: new Map(),
    resources: { player_a: { supplies: 0 }, player_b: { supplies: 0 } },
    turn: { turnNumber: 1, currentOwner: 'player_a', phase: 'waiting_command' },
    winner: null,
    eventLog: [],
  };
}

function entityAt(q, r) {
  for (const u of state.units.values()) if (u.alive && u.q === q && u.r === r) return u;
  for (const h of state.headquarters.values()) if (h.alive && h.q === q && h.r === r) return h;
  return null;
}

function applyEvent(s, ev) {
  s.eventLog.push(ev);
  const p = ev.payload || {};
  switch (ev.type) {
    case 'game_start':
      gameConfig = p.config;
      if (p.playerNames) playerNames = p.playerNames;
      s.map = p.map;
      s.cells = p.map.cells || [];
      s.controlPoints = new Map((p.controlPoints || []).map(cp => [cp.id, { ...cp }]));
      s.headquarters = new Map(Object.values(p.headquarters || {}).map(h => [h.id, { ...h }]));
      s.units = new Map((p.units || []).map(u => [u.id, { ...u }]));
      s.resources = JSON.parse(JSON.stringify(p.resources || s.resources));
      computeLayout(s.cells);
      break;
    case 'deploy':
      s.resources[p.owner].supplies -= p.cost || 0;
      s.units.set(p.unitId, {
        id: p.unitId, owner: p.owner, type: p.unitType, q: p.q, r: p.r,
        hp: p.hp, maxHp: p.hp, attack: p.attack, defense: p.defense,
        moveRange: p.moveRange, attackRange: p.attackRange,
        alive: true, hasMoved: true, hasActed: false,
        canCapture: !!p.canCapture, healPower: p.healPower, cost: p.cost,
      });
      break;
    case 'move': {
      const u = s.units.get(p.unitId);
      if (u) { u.q = p.toQ; u.r = p.toR; u.hasMoved = true; }
      break;
    }
    case 'attack': {
      const target = s.units.get(p.targetId) || s.headquarters.get(p.targetId);
      if (target) target.hp = p.targetHp;
      const a = s.units.get(p.attackerId);
      if (a) a.hasActed = true;
      break;
    }
    case 'heal': {
      const target = s.units.get(p.targetId);
      if (target) target.hp = p.targetHp;
      const support = s.units.get(p.supportId);
      if (support) support.hasActed = true;
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
    case 'income':
      s.resources[p.owner].supplies += p.amount;
      break;
    case 'reset_actions':
      for (const u of s.units.values()) {
        if (u.owner === p.owner) { u.hasMoved = false; u.hasActed = false; }
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
    case 'name_rename':
      playerNames[p.playerId] = p.name;
      break;
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
    const p = hexToPixel(cp.q, cp.r);
    pathHex(cp.q, cp.r, 8);
    ctx.fillStyle = cp.owner ? OWNER_COLOR[cp.owner] : '#d6b34a';
    ctx.globalAlpha = 0.32;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = cp.owner ? OWNER_COLOR[cp.owner] : '#d6b34a';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#f0d77c';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('CP', p.x, p.y + 4);
  }

  for (const hq of state.headquarters.values()) {
    const p = hexToPixel(hq.q, hq.r);
    pathHex(hq.q, hq.r, 5);
    ctx.fillStyle = hq.alive ? OWNER_COLOR[hq.owner] : '#555';
    ctx.globalAlpha = hq.alive ? 0.78 : 0.3;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#071016';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('HQ', p.x, p.y + 4);
    drawHpBar(p.x, p.y - 25, 42, hq.hp, hq.maxHp);
  }

  for (const u of state.units.values()) {
    if (!u.alive) continue;
    const p = hexToPixel(u.q, u.r);
    ctx.fillStyle = OWNER_COLOR[u.owner];
    ctx.beginPath();
    ctx.arc(p.x, p.y, HEX_SIZE * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#071016';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(unitLabel(u.type), p.x, p.y + 4);
    drawHpBar(p.x, p.y - 21, 34, u.hp, u.maxHp);
    if (u.hasMoved || u.hasActed) {
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.beginPath();
      ctx.arc(p.x + 12, p.y + 12, 5, 0, Math.PI * 2);
      ctx.fill();
    }
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

function renderEntityCard(ent) {
  const type = ent.type || 'headquarters';
  const title = UNIT_NAMES[type] || '指挥部';
  const ownerClass = ent.owner === 'player_a' ? 'player-a' : 'player-b';
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
      <div class="sel-token ${ownerClass}">${esc(UNIT_LABELS[type] || '?')}</div>
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
  const ownerClass = cp.owner === 'player_a' ? 'player-a' : cp.owner === 'player_b' ? 'player-b' : 'neutral';
  return `<div class="sel-card">
    <div class="sel-head">
      <div class="sel-token cp">CP</div>
      <div class="sel-title-wrap">
        <div class="sel-type">${esc(cp.name)}</div>
        <div class="sel-owner ${ownerClass}">${esc(owner)}</div>
      </div>
    </div>
    <div class="sel-stat-grid">
      ${statItem('收入', '+20', 'cost')}
      ${statItem('部署', cp.owner ? '可用' : '中立', cp.owner ? 'move' : '')}
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
    case 'headquarters_destroyed': return `指挥部摧毁 ${p.owner}`;
    case 'control_point_captured': return `占领 ${p.name}`;
    case 'income': return `${playerName(p.owner)} 收入 +${p.amount}`;
    case 'turn_end': return `回合结束 -> ${playerName(p.nextOwner)} (${p.turnNumber})`;
    case 'game_over': return `游戏结束 胜者:${playerName(p.winner)}`;
    default: return ev.type;
  }
}

function renderSidebar() {
  if (!state) return;
  resourcesEl.innerHTML = `<h3>资源</h3>
    <div>${playerNameControl('player_a')}: ${state.resources.player_a.supplies} 补给</div>
    <div>${playerNameControl('player_b')}: ${state.resources.player_b.supplies} 补给</div>
    <div style="margin-top:6px;color:#7a9aaa;font-size:12px">据点: ${[...state.controlPoints.values()].map(cp => `${cp.name}:${cp.owner ? playerName(cp.owner) : '中立'}`).join(' / ')}</div>`;
  const owner = state.turn.currentOwner;
  turnInfoEl.innerHTML = `<h3>回合 ${state.turn.turnNumber}</h3>
    <div>当前: ${playerNameControl(owner)}</div>
    ${state.winner ? `<div style="margin-top:6px;color:#f0d77c">胜者: ${esc(playerName(state.winner))}</div>` : ''}`;

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

async function fetchGameList() {
  const res = await fetch('/api/games');
  const { games } = await res.json();
  const prev = gameSelect.value;
  gameSelect.innerHTML = '<option value="">-- 选择对局 --</option>';
  for (const g of games) {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = `${g.id.slice(0, 8)} - ${g.phase} 回合${g.turnNumber}`;
    gameSelect.appendChild(opt);
  }
  if (prev && [...gameSelect.options].some(o => o.value === prev)) gameSelect.value = prev;
  return games;
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
  const rect = canvas.getBoundingClientRect();
  const h = pixelToHex(e.clientX - rect.left, e.clientY - rect.top);
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
  const res = await fetch(`/api/games/${gameSelect.value}/rename`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
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
  return `hex_game_${(gameSelect.value || 'unknown').slice(0, 8)}_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.${ext}`;
}
function exportJson() {
  downloadFile(gameFilename('json'), JSON.stringify({ gameId: gameSelect.value, exportedAt: new Date().toISOString(), events: allEvents }, null, 2), 'application/json');
}
async function exportHtml() {
  const [cssText, jsText] = await Promise.all([fetch('/style.css').then(r => r.text()), fetch('/app.js').then(r => r.text())]);
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>Hex Replay</title><style>${cssText}</style></head><body><main><div id="board-wrap"><canvas id="board"></canvas><div id="cell-info" class="cell-info"></div><div id="replay-controls"><div id="control-buttons"><button id="btn-start">⏮</button><button id="btn-prev">◀</button><button id="btn-play">▶</button><button id="btn-next">▶</button><button id="btn-end">⏭</button><select id="speed-select"><option value="500">1x</option></select><span id="step-info"></span></div><div id="timeline-wrap"><input type="range" id="timeline" min="0" max="0" value="0"><div id="timeline-markers"></div></div></div></div><aside id="sidebar"><section id="resources"></section><section id="turn-info"></section><section id="event-detail"><div id="detail-content"></div></section><section id="event-log"><ul id="events"></ul></section></aside><div id="selection-panel"><div id="selection-detail"></div></div></main><select id="game-select"><option value="offline" selected>offline</option></select><button id="refresh-list"></button><span id="status"></span><button id="btn-export-html"></button><button id="btn-export-json"></button><button id="btn-import"></button><input id="import-file" type="file"><input id="auto-refresh" type="checkbox"><input id="follow-latest" type="checkbox"><input id="refresh-interval" value="5"><button id="btn-settings"></button><div id="settings-popover"></div><script>window.EMBEDDED_EVENTS=${JSON.stringify(allEvents)};window.fetch=(url)=>Promise.resolve(new Response(JSON.stringify(url.includes('/events')?{events:window.EMBEDDED_EVENTS}:{games:[{id:'offline',phase:'replay',turnNumber:0,currentOwner:'player_a'}]})));window.EventSource=function(){return {close(){}}};</script><script>${jsText}</script></body></html>`;
  downloadFile(gameFilename('html'), html, 'text/html');
}
function importJson() { importFile.click(); }
importFile.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const data = JSON.parse(reader.result);
    allEvents = data.events || [];
    pinnedReplayStep = false;
    buildTimelineMarkers();
    if (allEvents.length) rebuildToStep(allEvents.length - 1);
    if (liveSse) liveSse.close();
    statusEl.textContent = `已导入 ${allEvents.length} 事件`;
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
  if (!gameSelect.value) return;
  await loadGameState(gameSelect.value);
  subscribeSse(gameSelect.value);
});
refreshBtn.addEventListener('click', fetchGameList);
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
btnExportHtml.addEventListener('click', exportHtml);
btnImport.addEventListener('click', importJson);
autoRefreshCb.addEventListener('change', () => { if (autoRefreshCb.checked) startAutoRefresh(); else clearInterval(refreshTimer); });
refreshIntervalInput.addEventListener('change', () => {
  refreshInterval = Math.max(1, Math.min(60, Number(refreshIntervalInput.value) || 5)) * 1000;
  if (autoRefreshCb.checked) startAutoRefresh();
});
btnSettings.addEventListener('click', e => { e.stopPropagation(); settingsPopover.classList.toggle('open'); });
document.addEventListener('click', e => { if (!settingsPopover.contains(e.target) && e.target !== btnSettings) settingsPopover.classList.remove('open'); });
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

fetchGameList();
startAutoRefresh();
