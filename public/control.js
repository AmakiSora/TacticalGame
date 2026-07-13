const tokenInput = document.getElementById('control-token');
const statusText = document.getElementById('status-text');
const statusMessage = document.getElementById('status-message');
const logOutput = document.getElementById('log-output');
const logSearch = document.getElementById('log-search');
const autoScrollLogs = document.getElementById('auto-scroll-logs');
const configForm = document.getElementById('config-form');
const configDirty = document.getElementById('config-dirty');
const playerFields = document.getElementById('player-fields');
const PLAYER_IDS = ['player_a', 'player_b', 'player_c', 'player_d', 'player_e', 'player_f', 'player_g', 'player_h'];
const logs = [];
let lastLogSeq = 0;
let currentStatus = 'idle';
let busy = false;
let dirty = false;
let logStream = null;
let pollTimer = null;
/** Keep full multi-seat player configs even when the UI only shows the active count. */
let playerConfigCache = {};

function token() {
  return localStorage.getItem('autoControlToken') || '';
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (token()) headers['x-control-token'] = token();
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status}`);
  return data;
}

function setStatus(text, detail = '') {
  statusText.textContent = text;
  statusMessage.textContent = detail || text;
}

function setDirty(value) {
  dirty = value;
  configDirty.textContent = dirty ? '配置未保存' : '配置已同步';
  configDirty.classList.toggle('dirty', dirty);
}

function setBusy(value, message = '') {
  busy = value;
  if (message) setStatus(currentStatus, message);
  updateControls(currentStatus);
}

function setActiveTab(name) {
  const monitor = name === 'monitor';
  document.getElementById('tab-monitor').classList.toggle('active', monitor);
  document.getElementById('tab-config').classList.toggle('active', !monitor);
  document.getElementById('tab-monitor').setAttribute('aria-selected', String(monitor));
  document.getElementById('tab-config').setAttribute('aria-selected', String(!monitor));
  document.getElementById('panel-monitor').hidden = !monitor;
  document.getElementById('panel-config').hidden = monitor;
  document.getElementById('panel-monitor').classList.toggle('active', monitor);
  document.getElementById('panel-config').classList.toggle('active', !monitor);
  localStorage.setItem('autoControlActiveTab', name);
}

function updateControls(status = currentStatus) {
  currentStatus = status || 'idle';
  const running = status === 'running';
  const paused = status === 'paused';
  const bootstrapping = status === 'bootstrapping';
  const stopping = status === 'stopping';
  const active = running || paused || bootstrapping || stopping;

  document.getElementById('btn-start').disabled = busy || active;
  document.getElementById('btn-pause').disabled = busy || !running;
  document.getElementById('btn-resume').disabled = busy || !paused;
  document.getElementById('btn-stop').disabled = busy || !(running || paused || bootstrapping);
  document.getElementById('btn-save-config').disabled = busy;
  document.getElementById('btn-send-manual').disabled = busy;
}

function emptyPlayer() {
  return {
    provider: '',
    model: '',
    name: '',
    session: '',
    skill: '',
    prompt: '',
    startPrompt: '',
    commandMode: 'fields',
    advancedCommand: '',
  };
}

function playerLegend(side) {
  return 'Player ' + side.replace('player_', '').toUpperCase();
}

function ensurePlayerFields(count) {
  const activeCount = Math.max(2, Math.min(8, Number(count) || 2));
  const existing = new Map(
    [...playerFields.querySelectorAll('fieldset[data-side]')].map(fs => [fs.dataset.side, fs]),
  );

  for (const [side, fieldset] of existing) {
    playerConfigCache[side] = readPlayerFromFieldset(fieldset);
  }

  playerFields.replaceChildren();
  for (let i = 0; i < activeCount; i++) {
    const side = PLAYER_IDS[i];
    const fieldset = document.createElement('fieldset');
    fieldset.dataset.side = side;
    fieldset.innerHTML =
      '<legend>' + playerLegend(side) + '</legend>' +
      '<div class="field-grid">' +
      '<label>Provider <input name="provider" /></label>' +
      '<label>Model <input name="model" /></label>' +
      '<label>Name <input name="name" /></label>' +
      '<label>Session <input name="session" /></label>' +
      '<label>Skill <input name="skill" /></label>' +
      '<label>Command Mode <select name="commandMode"><option value="fields">fields</option><option value="advanced">advanced</option></select></label>' +
      '</div>' +
      '<label>Prompt <textarea name="prompt"></textarea></label>' +
      '<label>Start Prompt <textarea name="startPrompt"></textarea></label>' +
      '<label>Advanced Command <textarea name="advancedCommand"></textarea></label>';
    playerFields.append(fieldset);
    fillPlayerFieldset(fieldset, playerConfigCache[side] || emptyPlayer());
  }

  const manualSide = document.getElementById('manual-side');
  if (manualSide) {
    const current = manualSide.value;
    manualSide.replaceChildren();
    for (let i = 0; i < activeCount; i++) {
      const side = PLAYER_IDS[i];
      const option = document.createElement('option');
      option.value = side;
      option.textContent = side;
      manualSide.append(option);
    }
    if ([...manualSide.options].some(o => o.value === current)) manualSide.value = current;
  }
}

function fillPlayerFieldset(fieldset, player) {
  for (const key of ['provider', 'model', 'name', 'session', 'skill', 'prompt', 'startPrompt', 'commandMode', 'advancedCommand']) {
    const el = fieldset.querySelector('[name="' + key + '"]');
    if (el) el.value = player?.[key] || '';
  }
}

function readPlayerFromFieldset(fieldset) {
  const player = emptyPlayer();
  for (const key of Object.keys(player)) {
    const el = fieldset.querySelector('[name="' + key + '"]');
    if (el) player[key] = el.value;
  }
  return player;
}

function fillConfig(config) {
  document.getElementById('game-id').value = config.gameId || '';
  document.getElementById('map-id').value = config.mapId || 'default';
  document.getElementById('bootstrap').checked = Boolean(config.bootstrap);
  document.getElementById('interval').value = config.intervalSeconds;
  document.getElementById('timeout').value = config.timeoutSeconds;

  playerConfigCache = {};
  for (const side of PLAYER_IDS) {
    playerConfigCache[side] = Object.assign(emptyPlayer(), config.players?.[side] || {});
  }
  const playerCount = Math.max(2, Math.min(8, Number(config.playerCount) || 2));
  document.getElementById('player-count').value = String(playerCount);
  ensurePlayerFields(playerCount);
  setDirty(false);
}

function readConfig() {
  const playerCount = Math.max(2, Math.min(8, Number(document.getElementById('player-count').value) || 2));
  for (const fieldset of playerFields.querySelectorAll('fieldset[data-side]')) {
    playerConfigCache[fieldset.dataset.side] = readPlayerFromFieldset(fieldset);
  }
  const players = {};
  for (const side of PLAYER_IDS) {
    players[side] = Object.assign(emptyPlayer(), playerConfigCache[side] || {});
  }
  return {
    gameId: document.getElementById('game-id').value || null,
    mapId: document.getElementById('map-id').value || 'default',
    bootstrap: document.getElementById('bootstrap').checked,
    playerCount: playerCount,
    intervalSeconds: Number(document.getElementById('interval').value) || 2,
    timeoutSeconds: Number(document.getElementById('timeout').value) || 10,
    players: players,
  };
}

function renderStatus(status) {
  document.getElementById('state-status').textContent = status.status;
  document.getElementById('state-game').textContent = status.gameId || '-';
  document.getElementById('state-seq').textContent = status.lastSeq || 0;
  document.getElementById('state-child').textContent = status.runningChild || '-';
  setStatus(status.status, status.runningChild ? ('运行中: ' + status.runningChild) : ('控制器状态: ' + status.status));
  updateControls(status.status);
}

function appendLogs(entries) {
  for (const entry of entries || []) {
    if (entry.seq <= lastLogSeq) continue;
    lastLogSeq = entry.seq;
    logs.push(entry);
  }
  renderLogs();
}

function formatLogEntry(entry) {
  return entry.seq + ' ' + new Date(entry.timestamp).toLocaleTimeString() + ' ' + entry.level + ' ' + entry.message;
}

function filteredLogs() {
  const level = document.getElementById('log-level').value;
  const query = logSearch.value.trim().toLowerCase();
  return logs.filter(entry => {
    const message = formatLogEntry(entry);
    return (!level || entry.level === level) && (!query || message.toLowerCase().includes(query));
  });
}

function renderLogs() {
  const visible = filteredLogs();
  logOutput.replaceChildren();
  if (visible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-log';
    empty.textContent = logs.length === 0 ? '暂无日志' : '没有匹配的日志';
    logOutput.append(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const entry of visible) {
    const line = document.createElement('div');
    line.className = 'log-line ' + entry.level;

    const seq = document.createElement('span');
    seq.className = 'log-seq';
    seq.textContent = String(entry.seq);

    const time = document.createElement('span');
    time.className = 'log-time';
    time.textContent = new Date(entry.timestamp).toLocaleTimeString();

    const level = document.createElement('span');
    level.className = 'log-level';
    level.textContent = entry.level;

    const message = document.createElement('span');
    message.className = 'log-message';
    message.textContent = entry.message;

    line.append(seq, time, level, message);
    fragment.append(line);
  }
  logOutput.append(fragment);
  if (autoScrollLogs.checked) {
    logOutput.scrollTop = logOutput.scrollHeight;
  }
}

function visibleLogText() {
  return filteredLogs().map(formatLogEntry).join('\n');
}

async function refresh(options = {}) {
  const status = await api('/api/control/status');
  renderStatus(status);
  if (status.config && (options.forceConfig || !dirty)) fillConfig(status.config);
  appendLogs(status.logs || []);
}

async function loadLogs() {
  const data = await api('/api/control/logs?after=' + lastLogSeq);
  appendLogs(data.logs);
}

function startLogStream() {
  if (logStream) logStream.close();
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (!window.EventSource) {
    pollTimer = setInterval(loadLogs, 1500);
    return;
  }
  const qs = token() ? ('?token=' + encodeURIComponent(token())) : '';
  logStream = new EventSource('/api/control/logs/stream' + qs);
  logStream.onmessage = ev => {
    const payload = JSON.parse(ev.data);
    if (payload.status) renderStatus(payload.status);
    appendLogs(payload.logs || []);
  };
  logStream.onerror = () => {
    logStream.close();
    logStream = null;
    if (!pollTimer) pollTimer = setInterval(loadLogs, 1500);
  };
}

async function saveConfig({ silent = false } = {}) {
  if (!silent) setBusy(true, '正在保存配置...');
  await api('/api/control/config', { method: 'PUT', body: JSON.stringify(readConfig()) });
  setDirty(false);
  if (!silent) {
    await refresh({ forceConfig: true });
    setStatus(currentStatus, '配置已保存');
    setBusy(false);
  }
}

async function runAction(message, action) {
  setBusy(true, message);
  try {
    await action();
  } catch (err) {
    setStatus('error', err.message);
  } finally {
    setBusy(false);
  }
}

document.getElementById('tab-monitor').onclick = () => setActiveTab('monitor');
document.getElementById('tab-config').onclick = () => setActiveTab('config');

configForm.addEventListener('input', () => setDirty(true));
configForm.addEventListener('change', () => setDirty(true));
document.getElementById('player-count').addEventListener('change', () => {
  ensurePlayerFields(document.getElementById('player-count').value);
  setDirty(true);
});

document.getElementById('btn-save-token').onclick = async () => {
  await runAction('正在刷新控制器状态...', async () => {
    localStorage.setItem('autoControlToken', tokenInput.value);
    await refresh({ forceConfig: true });
    startLogStream();
  });
};
document.getElementById('btn-save-config').onclick = async () => {
  await runAction('正在保存配置...', async () => {
    await saveConfig({ silent: true });
    await refresh({ forceConfig: true });
    setStatus(currentStatus, '配置已保存');
  });
};
document.getElementById('btn-start').onclick = async () => {
  await runAction('正在保存配置并启动...', async () => {
    await saveConfig({ silent: true });
    await api('/api/control/start', { method: 'POST' });
    await refresh({ forceConfig: true });
    setActiveTab('monitor');
  });
};
document.getElementById('btn-pause').onclick = async () => {
  await runAction('正在暂停...', async () => renderStatus(await api('/api/control/pause', { method: 'POST' })));
};
document.getElementById('btn-resume').onclick = async () => {
  await runAction('正在恢复...', async () => renderStatus(await api('/api/control/resume', { method: 'POST' })));
};
document.getElementById('btn-stop').onclick = async () => {
  await runAction('正在停止...', async () => renderStatus(await api('/api/control/stop', { method: 'POST' })));
};
document.getElementById('btn-send-manual').onclick = async () => {
  await runAction('正在发送手动指令...', async () => {
    await api('/api/control/manual', {
      method: 'POST',
      body: JSON.stringify({
        side: document.getElementById('manual-side').value,
        prompt: document.getElementById('manual-prompt').value,
      }),
    });
    await loadLogs();
  });
};
document.getElementById('btn-clear-view').onclick = () => {
  logs.length = 0;
  renderLogs();
};
document.getElementById('btn-copy-logs').onclick = () => navigator.clipboard.writeText(visibleLogText());
document.getElementById('log-level').onchange = renderLogs;
logSearch.oninput = renderLogs;
autoScrollLogs.onchange = () => {
  if (autoScrollLogs.checked) {
    logOutput.scrollTop = logOutput.scrollHeight;
  }
};

if (window.APP_VERSION) document.querySelector('.version-badge').textContent = 'v' + window.APP_VERSION;
tokenInput.value = token();
ensurePlayerFields(2);
setActiveTab(localStorage.getItem('autoControlActiveTab') || 'monitor');
updateControls(currentStatus);
refresh({ forceConfig: true }).then(startLogStream).catch(err => setStatus('error', err.message));
