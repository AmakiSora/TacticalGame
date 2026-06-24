const tokenInput = document.getElementById('control-token');
const statusText = document.getElementById('status-text');
const logOutput = document.getElementById('log-output');
const logs = [];
let lastLogSeq = 0;

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

function setStatus(text) {
  statusText.textContent = text;
}

function fillPlayer(side, player) {
  const fieldset = document.querySelector(`fieldset[data-side="${side}"]`);
  for (const key of ['provider', 'model', 'name', 'session', 'skill', 'prompt', 'startPrompt', 'commandMode', 'advancedCommand']) {
    const el = fieldset.querySelector(`[name="${key}"]`);
    el.value = player[key] || '';
  }
}

function readPlayer(side) {
  const fieldset = document.querySelector(`fieldset[data-side="${side}"]`);
  const player = {};
  for (const key of ['provider', 'model', 'name', 'session', 'skill', 'prompt', 'startPrompt', 'commandMode', 'advancedCommand']) {
    player[key] = fieldset.querySelector(`[name="${key}"]`).value;
  }
  return player;
}

function fillConfig(config) {
  document.getElementById('game-id').value = config.gameId || '';
  document.getElementById('map-id').value = config.mapId || 'default';
  document.getElementById('bootstrap').checked = Boolean(config.bootstrap);
  document.getElementById('interval').value = config.intervalSeconds;
  document.getElementById('timeout').value = config.timeoutSeconds;
  fillPlayer('player_a', config.players.player_a);
  fillPlayer('player_b', config.players.player_b);
}

function readConfig() {
  return {
    gameId: document.getElementById('game-id').value || null,
    mapId: document.getElementById('map-id').value || 'default',
    bootstrap: document.getElementById('bootstrap').checked,
    intervalSeconds: Number(document.getElementById('interval').value) || 2,
    timeoutSeconds: Number(document.getElementById('timeout').value) || 10,
    players: {
      player_a: readPlayer('player_a'),
      player_b: readPlayer('player_b'),
    },
  };
}

function renderStatus(status) {
  document.getElementById('state-status').textContent = status.status;
  document.getElementById('state-game').textContent = status.gameId || '-';
  document.getElementById('state-seq').textContent = status.lastSeq || 0;
  document.getElementById('state-child').textContent = status.runningChild || '-';
  setStatus(status.status);
}

function appendLogs(entries) {
  for (const entry of entries || []) {
    if (entry.seq <= lastLogSeq) continue;
    lastLogSeq = entry.seq;
    logs.push(entry);
  }
  renderLogs();
}

function renderLogs() {
  const level = document.getElementById('log-level').value;
  logOutput.textContent = logs
    .filter(entry => !level || entry.level === level)
    .map(entry => `${entry.seq} ${new Date(entry.timestamp).toLocaleTimeString()} ${entry.level} ${entry.message}`)
    .join('\n');
  logOutput.scrollTop = logOutput.scrollHeight;
}

async function refresh() {
  const status = await api('/api/control/status');
  renderStatus(status);
  if (status.config) fillConfig(status.config);
  appendLogs(status.logs || []);
}

async function loadLogs() {
  const data = await api(`/api/control/logs?after=${lastLogSeq}`);
  appendLogs(data.logs);
}

function startLogStream() {
  if (!window.EventSource) {
    setInterval(loadLogs, 1500);
    return;
  }
  const qs = token() ? `?token=${encodeURIComponent(token())}` : '';
  const stream = new EventSource(`/api/control/logs/stream${qs}`);
  stream.onmessage = ev => {
    const payload = JSON.parse(ev.data);
    if (payload.status) renderStatus(payload.status);
    appendLogs(payload.logs || []);
  };
  stream.onerror = () => {
    stream.close();
    setInterval(loadLogs, 1500);
  };
}

document.getElementById('btn-save-token').onclick = async () => {
  localStorage.setItem('autoControlToken', tokenInput.value);
  await refresh();
  startLogStream();
};
document.getElementById('btn-save-config').onclick = async () => {
  await api('/api/control/config', { method: 'PUT', body: JSON.stringify(readConfig()) });
  await refresh();
};
document.getElementById('btn-start').onclick = async () => {
  await api('/api/control/start', { method: 'POST' });
  await refresh();
};
document.getElementById('btn-pause').onclick = async () => {
  renderStatus(await api('/api/control/pause', { method: 'POST' }));
};
document.getElementById('btn-resume').onclick = async () => {
  renderStatus(await api('/api/control/resume', { method: 'POST' }));
};
document.getElementById('btn-stop').onclick = async () => {
  renderStatus(await api('/api/control/stop', { method: 'POST' }));
};
document.getElementById('btn-send-manual').onclick = async () => {
  await api('/api/control/manual', {
    method: 'POST',
    body: JSON.stringify({
      side: document.getElementById('manual-side').value,
      prompt: document.getElementById('manual-prompt').value,
    }),
  });
  await loadLogs();
};
document.getElementById('btn-clear-view').onclick = () => {
  logs.length = 0;
  renderLogs();
};
document.getElementById('btn-copy-logs').onclick = () => navigator.clipboard.writeText(logOutput.textContent);
document.getElementById('log-level').onchange = renderLogs;

if (window.APP_VERSION) document.querySelector('.version-badge').textContent = `v${window.APP_VERSION}`;
tokenInput.value = token();
refresh().then(startLogStream).catch(err => setStatus(err.message));
