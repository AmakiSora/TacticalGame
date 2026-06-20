const HEX_SIZE = 28;
const PAD = 42;
const SQRT3 = Math.sqrt(3);
const OWNER_COLOR = { player_a: '#66ccff', player_b: '#ff9966' };
const TERRAIN = { plain: '#111923', water: '#183a55', blocker: '#393f46' };
const UNIT_NAMES = { infantry: '步兵', scout: '侦察兵', heavy: '重装', ranger: '远程兵', support: '支援兵' };
const UNIT_LABELS = { infantry: 'INF', scout: 'SCT', heavy: 'HVY', ranger: 'RNG', support: 'SUP', headquarters: 'HQ' };

const $ = id => document.getElementById(id);
const els = {
  joinPanel: $('join-panel'), gameId: $('game-id'), createName: $('create-name'), joinName: $('join-name'),
  mapSelect: $('map-select'), btnCreate: $('btn-create'), btnJoin: $('btn-join'), btnConnectCreate: $('btn-connect-create'),
  connStatus: $('conn-status'), createResult: $('create-result'), createdGameId: $('created-game-id'),
  createdToken: $('created-token'), joinResult: $('join-result'), joinStatusText: $('join-status-text'),
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
let myPlayer = null;
let sse = null;
let hoverCell = null;
let selectedUnitId = null;
let selectedOriginId = null;
let selectedDeployType = null;
let interactionMode = 'idle';
let rangeHighlights = [];
let layout = { minX: 0, minY: 0, width: 840, height: 840 };

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function defaultPlayerNames() { return { player_a: '玩家 A', player_b: '玩家 B' }; }
function playerName(owner) { return playerNames[owner] || (owner === 'player_a' ? '玩家 A' : '玩家 B'); }
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
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Player-Token': myToken }, body: JSON.stringify(body) });
    const data = await res.json();
    return { ok: res.ok, status: res.status, data };
  },
  async get(path) {
    const res = await fetch(path, { headers: { 'X-Player-Token': myToken } });
    const data = await res.json();
    return { ok: res.ok, status: res.status, data };
  },
};

async function loadMapList() {
  const res = await fetch('/api/maps');
  const { maps } = await res.json();
  els.mapSelect.innerHTML = maps.map(m => `<option value="${esc(m.id)}">${esc(m.name)} - ${esc(m.description)}</option>`).join('');
}

function createEmptyState() {
  return { cells: [], controlPoints: new Map(), headquarters: new Map(), units: new Map(), resources: { player_a: { supplies: 0 }, player_b: { supplies: 0 } }, turn: { turnNumber: 1, currentOwner: 'player_a', actionsUsed: 0 }, winner: null, result: null, eventLog: [] };
}
function applyEvent(s, ev) {
  if (s.eventLog.some(existing => existing.seq === ev.seq)) return;
  s.eventLog.push(ev);
  const p = ev.payload || {};
  switch (ev.type) {
    case 'game_start':
      gameConfig = p.config; if (p.playerNames) playerNames = { ...p.playerNames };
      s.cells = p.map.cells || [];
      s.controlPoints = new Map((p.controlPoints || []).map(cp => [cp.id, { ...cp }]));
      s.headquarters = new Map(Object.values(p.headquarters || {}).map(h => [h.id, { ...h }]));
      s.units = new Map((p.units || []).map(u => [u.id, { ...u }]));
      s.resources = JSON.parse(JSON.stringify(p.resources || s.resources));
      computeLayout(s.cells);
      break;
    case 'deploy':
      s.resources[p.owner].supplies -= p.cost || 0;
      s.units.set(p.unitId, { id: p.unitId, owner: p.owner, type: p.unitType, q: p.q, r: p.r, hp: p.hp, maxHp: p.hp, attack: p.attack, defense: p.defense, moveRange: p.moveRange, attackRange: p.attackRange, alive: true, hasMoved: true, hasActed: false, actionSpent: true, canCapture: !!p.canCapture, healPower: p.healPower, cost: p.cost });
      if (typeof p.actionsUsed === 'number') s.turn.actionsUsed = p.actionsUsed;
      break;
    case 'move': { const u = s.units.get(p.unitId); if (u) { u.q = p.toQ; u.r = p.toR; u.hasMoved = true; u.actionSpent = true; } if (typeof p.actionsUsed === 'number') s.turn.actionsUsed = p.actionsUsed; break; }
    case 'attack': { const t = s.units.get(p.targetId) || s.headquarters.get(p.targetId); if (t) t.hp = p.targetHp; const a = s.units.get(p.attackerId); if (a) { a.hasActed = true; a.actionSpent = true; } if (typeof p.actionsUsed === 'number') s.turn.actionsUsed = p.actionsUsed; break; }
    case 'heal': { const t = s.units.get(p.targetId); if (t) t.hp = p.targetHp; const u = s.units.get(p.supportId); if (u) { u.hasActed = true; u.actionSpent = true; } if (typeof p.actionsUsed === 'number') s.turn.actionsUsed = p.actionsUsed; break; }
    case 'unit_death': { const u = s.units.get(p.unitId); if (u) u.alive = false; break; }
    case 'headquarters_destroyed': { const h = s.headquarters.get(p.headquartersId); if (h) h.alive = false; break; }
    case 'control_point_captured': { const cp = s.controlPoints.get(p.pointId); if (cp) cp.owner = p.owner; break; }
    case 'income': s.resources[p.owner].supplies += p.amount; break;
    case 'reset_actions':
      for (const u of s.units.values()) if (u.owner === p.owner) { u.hasMoved = false; u.hasActed = false; u.actionSpent = false; }
      if (typeof p.actionsUsed === 'number') s.turn.actionsUsed = p.actionsUsed;
      break;
    case 'turn_end': s.turn.currentOwner = p.nextOwner; s.turn.turnNumber = p.turnNumber; s.turn.actionsUsed = 0; break;
    case 'game_over':
      s.winner = p.winner;
      s.result = { winner: p.winner ?? null, reason: p.reason || 'headquarters_destroyed', scores: p.scores };
      break;
    case 'name_rename': playerNames[p.playerId] = p.name; break;
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

function drawHpBar(x, y, width, hp, maxHp) {
  if (!maxHp || hp >= maxHp) return;
  ctx.fillStyle = '#190d0d'; ctx.fillRect(x - width / 2, y, width, 4);
  ctx.fillStyle = hp / maxHp > 0.5 ? '#49b66d' : hp / maxHp > 0.25 ? '#d0a832' : '#d65a4a';
  ctx.fillRect(x - width / 2, y, width * Math.max(0, hp / maxHp), 4);
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
      ${statItem('收入', `+${gameConfig?.balance?.controlPointIncome ?? 20}`, 'cost')}
      ${statItem('部署', cp.owner ? '可用' : '中立', cp.owner ? 'move' : '')}
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
    ctx.fillStyle = h.type === 'move' ? 'rgba(60,200,120,.20)' : h.type === 'attack' ? 'rgba(255,80,80,.20)' : h.type === 'deploy' ? 'rgba(240,210,90,.24)' : 'rgba(80,220,180,.20)';
    ctx.fill();
  }
  if (hoverCell) { pathHex(hoverCell.q, hoverCell.r, 2); ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fill(); }
  for (const cp of state.controlPoints.values()) {
    const p = hexToPixel(cp.q, cp.r); pathHex(cp.q, cp.r, 8);
    ctx.fillStyle = cp.owner ? OWNER_COLOR[cp.owner] : '#d6b34a'; ctx.globalAlpha = .32; ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = cp.owner ? OWNER_COLOR[cp.owner] : '#d6b34a'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#f0d77c'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('CP', p.x, p.y + 4);
  }
  for (const hq of state.headquarters.values()) {
    const p = hexToPixel(hq.q, hq.r); pathHex(hq.q, hq.r, 5); ctx.fillStyle = hq.alive ? OWNER_COLOR[hq.owner] : '#555'; ctx.globalAlpha = hq.alive ? .78 : .3; ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = '#071016'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('HQ', p.x, p.y + 4); drawHpBar(p.x, p.y - 25, 42, hq.hp, hq.maxHp);
  }
  for (const u of state.units.values()) {
    if (!u.alive) continue;
    const p = hexToPixel(u.q, u.r); ctx.fillStyle = OWNER_COLOR[u.owner]; ctx.beginPath(); ctx.arc(p.x, p.y, HEX_SIZE * .42, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#071016'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(unitLabel(u.type), p.x, p.y + 4); drawHpBar(p.x, p.y - 21, 34, u.hp, u.maxHp);
    if (u.hasMoved || u.hasActed) { ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.arc(p.x + 12, p.y + 12, 5, 0, Math.PI * 2); ctx.fill(); }
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
  const enemy = owner === 'player_a' ? 'player_b' : 'player_a';
  const ownHq = [...state.headquarters.values()].find(h => h.owner === owner);
  const enemyHq = [...state.headquarters.values()].find(h => h.owner === enemy);
  if (!ownHq || !enemyHq) return null;
  const enemyHqDamage = Math.max(0, (enemyHq.maxHp || 0) - (enemyHq.hp || 0));
  const ownHqHp = Math.max(0, ownHq.hp || 0);
  const controlPoints = [...state.controlPoints.values()].filter(p => p.owner === owner).length;
  const armyValue = [...state.units.values()]
    .filter(u => u.owner === owner && u.alive)
    .reduce((sum, unit) => sum + Math.round((unit.cost || 0) * ((unit.hp || 0) / (unit.maxHp || 1))), 0);
  const supplies = state.resources?.[owner]?.supplies || 0;
  return {
    enemyHqDamage,
    ownHqHp,
    controlPoints,
    armyValue,
    supplies,
    total:
      enemyHqDamage * weights.enemyHqDamage +
      ownHqHp * weights.ownHqHp +
      controlPoints * weights.controlPoint +
      armyValue * weights.armyValue +
      supplies * weights.supplies,
  };
}

function computeAdjudicationScores() {
  const playerA = playerScore('player_a');
  const playerB = playerScore('player_b');
  return playerA && playerB ? { player_a: playerA, player_b: playerB } : null;
}

function scoreBreakdown(score) {
  return `HQ伤害 ${score.enemyHqDamage} · HQ血量 ${score.ownHqHp} · 据点 ${score.controlPoints} · 兵力 ${score.armyValue} · 补给 ${score.supplies}`;
}

function renderScoreRow(owner, score) {
  const cls = owner === 'player_a' ? 'player-a' : 'player-b';
  const mine = owner === myPlayer ? ' mine' : '';
  return `<div class="score-row ${cls}${mine}">
    <div class="score-row-head"><span>${esc(playerName(owner))}${owner === myPlayer ? '（你）' : ''}</span><strong>${score.total}</strong></div>
    <div class="score-breakdown">${esc(scoreBreakdown(score))}</div>
  </div>`;
}

function renderScorePanel() {
  const scorePanelEl = els.scorePanel;
  if (!scorePanelEl) return;
  const scores = computeAdjudicationScores();
  if (!scores) {
    scorePanelEl.innerHTML = '<h3>裁决分</h3><div class="score-empty">等待对局开始</div>';
    return;
  }
  const a = scores.player_a;
  const b = scores.player_b;
  const leader = a.total === b.total ? '当前平分' : `${playerName(a.total > b.total ? 'player_a' : 'player_b')} 领先 ${Math.abs(a.total - b.total)}`;
  scorePanelEl.innerHTML = `<h3>裁决分</h3>
    <div class="score-leader">${esc(leader)}</div>
    ${renderScoreRow('player_a', a)}
    ${renderScoreRow('player_b', b)}`;
}

function renderSidebar() {
  if (!state) return;
  const owner = state.turn.currentOwner;
  els.turnBadge.textContent = `回合 ${state.turn.turnNumber} · ${playerName(owner)}`;
  els.turnBadge.classList.toggle('my-turn', owner === myPlayer);
  els.resDisplay.innerHTML = `<span class="res-a ${myPlayer === 'player_a' ? 'res-me' : ''}">${esc(playerName('player_a'))}: ${state.resources.player_a.supplies}</span><span class="res-b ${myPlayer === 'player_b' ? 'res-me' : ''}">${esc(playerName('player_b'))}: ${state.resources.player_b.supplies}</span>`;
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
    case 'income': return `${playerName(p.owner)} 收入 +${p.amount}`;
    case 'reset_actions': return `${playerName(p.owner)} 单位已重置`;
    case 'turn_end': return `轮到 ${playerName(p.nextOwner)}`;
    case 'game_over':
      if (p.reason === 'turn_limit_draw') return '20回合裁决平局';
      if (p.reason === 'turn_limit_score') return `${playerName(p.winner)} 20回合裁决获胜`;
      return `${playerName(p.winner)} 获胜`;
    case 'name_rename': return `${p.playerId} 改名为 ${p.name}`;
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
  if (unit.owner !== myPlayer || state.turn.currentOwner !== myPlayer) return;
  const items = [];
  if (!unit.hasMoved) items.push({ label: '移动', action: 'move' });
  if (!unit.hasActed) items.push({ label: unit.type === 'support' ? '治疗' : '攻击', action: unit.type === 'support' ? 'heal' : 'attack' });
  if (items.length) showPopup(unit, '单位操作', items, action => {
    closePopup();
    if (action === 'move') { interactionMode = 'move_mode'; rangeHighlights = reachable(unit).map(p => ({ ...p, type: 'move' })); }
    if (action === 'attack') { interactionMode = 'attack_mode'; rangeHighlights = [...state.units.values(), ...state.headquarters.values()].filter(e => e.owner !== myPlayer && e.alive && hexDistance(unit, e) <= unit.attackRange).map(e => ({ q: e.q, r: e.r, type: 'attack' })); }
    if (action === 'heal') { interactionMode = 'heal_mode'; rangeHighlights = [...state.units.values()].filter(e => e.owner === myPlayer && e.alive && e.hp < e.maxHp && hexDistance(unit, e) <= unit.attackRange).map(e => ({ q: e.q, r: e.r, type: 'heal' })); }
    drawBoard();
  });
}
function selectDeployOrigin(origin) {
  selectedOriginId = origin.id; selectedUnitId = null; selectedDeployType = null; interactionMode = 'deploy_origin'; rangeHighlights = [];
  renderSidebar(); drawBoard();
  if (origin.owner !== myPlayer && origin.owner !== undefined) return;
  if (state.turn.currentOwner !== myPlayer) return;
  const items = Object.entries(gameConfig.units).map(([type, spec]) => ({ label: UNIT_NAMES[type], action: 'deploy', type, cost: spec.cost }));
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
  if (interactionMode === 'attack_mode' && rangeHighlights.some(h => h.q === hoverCell.q && h.r === hoverCell.r)) {
    const target = entityAt(hoverCell.q, hoverCell.r);
    if (target && await apiAction(`/api/games/${gameId}/attack`, { attackerId: selectedUnitId, targetId: target.id })) afterAction('攻击成功');
    return;
  }
  if (interactionMode === 'heal_mode' && rangeHighlights.some(h => h.q === hoverCell.q && h.r === hoverCell.r)) {
    if (unit && await apiAction(`/api/games/${gameId}/heal`, { supportId: selectedUnitId, targetId: unit.id })) afterAction('治疗成功');
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
  sse = new EventSource(`/api/games/${gameId}/events?after=${lastSeq}&token=${encodeURIComponent(myToken)}`);
  sse.onmessage = e => { applyEvent(state, JSON.parse(e.data)); drawBoard(); renderSidebar(); };
  sse.onerror = () => statusBadge('SSE 断开', 'err');
  sse.onopen = () => statusBadge('已连接', 'ok');
}

els.btnEndTurn.addEventListener('click', async () => { if (await apiAction(`/api/games/${gameId}/end-turn`, {})) afterAction('回合结束'); });
els.btnRefresh.addEventListener('click', async () => { await loadFullState(); drawBoard(); renderSidebar(); toast('状态已刷新', 'ok'); });
els.btnCreate.addEventListener('click', async () => {
  els.btnCreate.disabled = true;
  try {
    const res = await fetch('/api/games', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mapId: els.mapSelect.value || 'default', name: els.createName.value.trim() || undefined }) });
    const data = await res.json();
    if (!res.ok) {
      toast(data.error || '创建失败', 'err');
      return;
    }
    myToken = data.playerAToken; myPlayer = 'player_a'; gameId = data.gameId;
    els.createdGameId.textContent = gameId; els.createdToken.textContent = myToken; els.createResult.classList.remove('hidden');
  } catch {
    toast('创建失败：无法连接服务器', 'err');
  } finally {
    els.btnCreate.disabled = false;
  }
});
els.btnJoin.addEventListener('click', async () => {
  const gid = els.gameId.value.trim(); if (!gid) return;
  const res = await fetch(`/api/games/${gid}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: els.joinName.value.trim() || undefined }) });
  const data = await res.json();
  if (!res.ok) { els.joinStatusText.textContent = `加入失败: ${data.error}`; els.joinResult.classList.remove('hidden'); return; }
  myToken = data.playerBToken; myPlayer = 'player_b'; gameId = gid;
  await enterGame();
});
els.btnConnectCreate.addEventListener('click', enterGame);
async function enterGame() {
  const ok = await loadFullState();
  if (!ok) return toast('无法加载游戏状态', 'err');
  els.joinPanel.classList.add('hidden'); els.gameUI.classList.remove('hidden');
  subscribeSse(); drawBoard(); renderSidebar(); statusBadge('已连接', 'ok');
}
document.querySelectorAll('.lobby-tab').forEach(tab => tab.addEventListener('click', () => {
  document.querySelectorAll('.lobby-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.lobby-tab-content').forEach(c => c.classList.remove('active'));
  tab.classList.add('active'); $(`tab-${tab.dataset.tab}`).classList.add('active');
}));
document.querySelectorAll('.btn-copy').forEach(btn => btn.addEventListener('click', () => navigator.clipboard.writeText($(btn.dataset.copy).textContent)));
document.addEventListener('keydown', e => { if (e.key === 'Escape') deselect(); });
document.addEventListener('click', e => { const popup = $('map-popup'); if (!popup.classList.contains('hidden') && !popup.contains(e.target) && e.target !== els.canvas) closePopup(); });
loadMapList();
