import { readFileSync } from 'node:fs';
import { createContext, Script } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PLAYERS = ['play.js', 'play-m.js'];
const SPECTATORS = ['app.js', 'spectator-m.js'];
const read = (file: string) => readFileSync(new URL(`../../public/${file}`, import.meta.url), 'utf8');

// 顶层函数按源码边界抽取，执行真实函数；仅替换网络、计时器和无关的 UI。
function fn(source: string, name: string) {
  const match = new RegExp(`^(?:async )?function ${name}\\(`, 'm').exec(source);
  if (!match) throw new Error(`Missing ${name}`);
  return source.slice(match.index, source.indexOf('\n}', match.index) + 2);
}
function block(source: string, start: string, end: string) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a);
  if (a < 0 || b < 0) throw new Error(`Missing block ${start}`);
  return source.slice(a, b);
}

class Element {
  value = '';
  checked = true;
  disabled = false;
  textContent = '';
  className = '';
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  children: Element[] = [];
  private html = '';
  constructor(readonly tagName = 'DIV') {}
  classList = {
    contains: (name: string) => this.className.split(' ').includes(name),
    add: (name: string) => { this.classList.toggle(name, true); },
    remove: (name: string) => { this.classList.toggle(name, false); },
    toggle: (name: string, on = !this.classList.contains(name)) => {
      const names = new Set(this.className.split(' ').filter(Boolean));
      if (on) names.add(name); else names.delete(name);
      this.className = [...names].join(' ');
      return on;
    },
  };
  set innerHTML(html: string) {
    this.html = html;
    this.children = [];
    if (this.tagName === 'SELECT') this.value = '';
    // 抽屉真实渲染输出的 button，保留 class/data-id 供行为断言和事件绑定。
    for (const match of html.matchAll(/<button[^>]*class="([^"]+)"[^>]*data-id="([^"]+)"/g)) {
      const child = new Element('BUTTON');
      child.className = match[1]!;
      child.dataset.id = match[2]!;
      this.children.push(child);
    }
  }
  get innerHTML() { return this.html; }
  get options() { return this.children; }
  append(child: Element) { this.children.push(child); }
  appendChild(child: Element) { this.append(child); }
  replaceChildren() { this.children = []; }
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  addEventListener() {}
  querySelectorAll(selector: string) {
    const className = selector.match(/^\.([\w-]+)/)?.[1];
    return this.children.filter(child => className && child.classList.contains(className));
  }
}

function environment() {
  const listeners: Array<() => void> = [];
  const nodes = new Map<string, Element>();
  const document = {
    hidden: false,
    addEventListener(type: string, cb: () => void) { if (type === 'visibilitychange') listeners.push(cb); },
    getElementById(id: string) {
      if (!nodes.has(id)) nodes.set(id, new Element());
      return nodes.get(id)!;
    },
    createElement(tag: string) { return new Element(tag.toUpperCase()); },
  };
  const requests: Array<{ url: string; resolve: (response: unknown) => void; reject: (error: Error) => void }> = [];
  const fetch = vi.fn((url: string) => new Promise((resolve, reject) => requests.push({ url, resolve, reject })));
  return {
    document, fetch, requests,
    setHidden(hidden: boolean) { document.hidden = hidden; listeners.forEach(cb => cb()); },
    async respond(index: number, data: unknown, status = 200) {
      const json = vi.fn(async () => data);
      requests[index]!.resolve({ ok: status >= 200 && status < 300, status, json });
      for (let i = 0; i < 12; i++) await Promise.resolve();
      return json;
    },
  };
}

function lobbyHarness(file: string) {
  const source = read(file);
  const env = environment();
  const render = vi.fn();
  const enter = vi.fn(async () => {});
  const removal = vi.fn(() => false);
  const context = createContext({
    document: env.document, fetch: env.fetch, setTimeout, clearTimeout,
    renderLobbySummary: render, enterGame: enter, handleLobbyRemoval: removal,
    statusBadge: vi.fn(), els: { lobbySummary: {}, joinLobbySummary: {}, joinStatusText: new Element() },
  });
  const run = (code: string) => new Script(code).runInContext(context);
  run(`
    let gameId = 'room-a'; const hostToken = 'host'; const myToken = null;
    const seatSync = { baseVersion: 3 };
    ${block(source, 'let lobbyPollTimer =', '// 房主房间卡')}
    ${fn(source, 'refreshLobbySummary')}
    ${fn(source, 'isStaleSeatVersion')}
    ${block(source, 'function stopLobbyPolling()', 'async function kickLobbyPlayer(')}
  `);
  return { ...env, run, render, enter, removal };
}

function spectatorHarness(file: string) {
  const source = read(file);
  const env = environment();
  const load = vi.fn(async (_id: string, _isCurrent?: () => boolean) => {});
  const subscribe = vi.fn();
  const gameSelect = new Element('SELECT');
  const label = new Element();
  const menu = new Element();
  const picker = new Element();
  const pickerButton = new Element();
  picker.className = 'open';
  pickerButton.setAttribute('aria-expanded', 'true');
  const force = new Element();
  force.disabled = true;
  const context = createContext({
    document: env.document, fetch: env.fetch, setTimeout, clearTimeout,
    gameSelect, gamePickerLabel: label, gamePickerMenu: menu, gamePicker: picker,
    gamePickerButton: pickerButton, forceAdjudicateBtn: force,
    autoRefreshCb: new Element(), followLatestCb: new Element(), statusEl: new Element(),
    loadGameState: load, subscribeSse: subscribe, resetLoadedGame: vi.fn(),
    syncPickerCurrent: vi.fn(), closePicker: vi.fn(), renderGamePickerMenu: vi.fn(),
    MODE_LABELS: { standard: '标准' }, esc: (s: unknown) => String(s), playerName: (s: string) => s,
    phaseLabel: (phase: string) => ({ active: '进行中', lobby: '大厅', game_over: '已结束' })[phase],
  });
  const run = (code: string) => new Script(code).runInContext(context);
  run(`let gamesList = []; let activeRecordId = null;
    ${['normalizeListedGame', 'sortGamesByLatest', 'fetchGameList', 'selectGame'].map(name => fn(source, name)).join('\n')}
    ${file === 'spectator-m.js' ? [
      'gameOptionText', 'gameBadgesHtml', 'gamePlayersLineHtml', 'gameMatches',
      'closeGamePicker', 'syncGamePickerLabel', 'updateForceAdjudicateButton',
      'renderGamePickerMenu', 'renderDrawerGameList',
    ].map(name => fn(source, name)).join('\n') : ''}
    ${block(source, 'let refreshTimer =', "gameSelect.addEventListener('change'")}
  `);
  return { ...env, run, load, subscribe, gameSelect, label, menu, picker, pickerButton, force };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

for (const file of PLAYERS) describe(`${file} lobby lifecycle`, () => {
  it('waits for slow requests to finish before starting the next interval', async () => {
    const h = lobbyHarness(file);
    h.run('startLobbyPolling()');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    await h.respond(0, { gameId: 'room-a', phase: 'lobby', seatVersion: 3 });
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1499);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.fetch).toHaveBeenCalledTimes(2);
  });

  it('pauses hidden requests and refreshes once on visibility, even during a slow flight', async () => {
    const h = lobbyHarness(file);
    h.setHidden(true);
    h.run('startLobbyPolling()');
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.fetch).not.toHaveBeenCalled();
    h.setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    h.setHidden(true);
    await h.respond(0, { phase: 'active', gameId: 'room-a' });
    expect(h.enter).not.toHaveBeenCalled();
    expect(h.render).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    h.setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    h.setHidden(true);
    h.setHidden(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.fetch).toHaveBeenCalledTimes(2);
    await h.respond(1, { phase: 'lobby', gameId: 'room-a' });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.fetch).toHaveBeenCalledTimes(3);
    await h.respond(2, { phase: 'active', gameId: 'room-a' });
    expect(h.enter).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['stop', 'restart', 'room'])('discards %s responses without reviving an old timer or entering a game', async action => {
    const h = lobbyHarness(file);
    h.run('startLobbyPolling()');
    await vi.advanceTimersByTimeAsync(1500);
    h.run(action === 'stop' ? 'stopLobbyPolling()' : action === 'restart' ? 'startLobbyPolling()' : "gameId = 'room-b'; startLobbyPolling()");
    await vi.advanceTimersByTimeAsync(9000);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    await h.respond(0, { phase: 'active', gameId: 'room-a', seatVersion: 9 });
    expect(h.enter).not.toHaveBeenCalled();
    expect(h.render).not.toHaveBeenCalled();
    expect(h.removal).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(action === 'stop' ? 0 : 1);
    if (action !== 'stop') {
      await vi.advanceTimersByTimeAsync(1500);
      expect(h.fetch).toHaveBeenCalledTimes(2);
      expect(h.requests[1]!.url).toContain(action === 'room' ? 'room-b' : 'room-a');
    }
  });

  it.each(['stop', 'restart', 'room', 'hidden'])('also cancels the actual enterGame event load after %s', async action => {
    const h = lobbyHarness(file);
    const source = read(file);
    h.run(`
      let state = { cells: ['existing-board'] };
      let entryResets = 0;
      const playback = { reset() { entryResets++; } };
      function closeMapDialog() {}
      function startSeatSync() {}
      ${block(source, 'const API = {', 'async function loadMapList(')}
      ${fn(source, 'loadFullState')}
      ${fn(source, 'enterGame')}
      startLobbyPolling();
    `);
    await vi.advanceTimersByTimeAsync(1500);
    await h.respond(0, { phase: 'active', gameId: 'room-a' });
    expect(h.requests[1]!.url).toBe('/api/games/room-a/events');
    if (action === 'hidden') h.setHidden(true);
    else h.run(action === 'stop' ? 'stopLobbyPolling()' : action === 'restart' ? 'startLobbyPolling()' : "gameId = 'room-b'; startLobbyPolling()");
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.fetch).toHaveBeenCalledTimes(2);
    await h.respond(1, { events: [] });
    expect(h.run('entryResets')).toBe(0);
    expect(h.run('state.cells')).toEqual(['existing-board']);
    expect(vi.getTimerCount()).toBe(action === 'stop' || action === 'hidden' ? 0 : 1);
    if (action === 'hidden') {
      h.setHidden(false);
      await vi.advanceTimersByTimeAsync(0);
      expect(h.fetch).toHaveBeenCalledTimes(3);
      expect(h.requests[2]!.url).toBe('/api/games/room-a/lobby');
    }
  });

  it('preserves the seat-version and room-id guards before rendering or entering', async () => {
    const h = lobbyHarness(file);
    h.run('startLobbyPolling()');
    await vi.advanceTimersByTimeAsync(1500);
    await h.respond(0, { phase: 'active', gameId: 'room-a', seatVersion: 2 });
    await vi.advanceTimersByTimeAsync(1500);
    await h.respond(1, { phase: 'active', gameId: 'wrong-room', seatVersion: 9 });
    expect(h.render).not.toHaveBeenCalled();
    expect(h.enter).not.toHaveBeenCalled();
  });
});

for (const file of SPECTATORS) describe(`${file} spectator lifecycle`, () => {
  it('does not replace the board or SSE with an old selection whose events arrive late', async () => {
    const h = spectatorHarness(file);
    h.run(`
      let allEvents = [{ seq: 99 }];
      let gameLoadVersion = 0;
      let liveSse = null;
      let gameConfig = null;
      let playerNames = {};
      let currentStep = -1;
      function defaultPlayerNames() { return {}; }
      let importedReplayMeta = null;
      let pinnedReplayStep = false;
      function pausePlayback() {}
      function buildTimelineMarkers() {}
      function rebuildToStep() {}
      ${fn(read(file), 'loadGameState')}
    `);
    const first = h.run("selectGame('old-room')");
    const second = h.run("selectGame('new-room')");
    await h.respond(1, { events: [{ seq: 2 }] });
    await second;
    await h.respond(0, { events: [{ seq: 1 }] });
    await first;
    expect(h.run('allEvents')).toEqual([{ seq: 2 }]);
    expect(h.gameSelect.value).toBe('new-room');
    expect(h.subscribe).toHaveBeenCalledTimes(1);
    expect(h.subscribe).toHaveBeenCalledWith('new-room');
  });

  it('does not overlap slow list requests and schedules only after completion', async () => {
    const h = spectatorHarness(file);
    h.run('startAutoRefresh()');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    await h.respond(0, { games: [] });
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(4999);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.fetch).toHaveBeenCalledTimes(2);
  });

  it('does not follow or schedule on hidden completion; resumes exactly once', async () => {
    const h = spectatorHarness(file);
    h.setHidden(true);
    h.run('startAutoRefresh()');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(h.fetch).not.toHaveBeenCalled();
    h.setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    h.setHidden(true);
    await h.respond(0, { games: [{ id: 'new', phase: 'active' }] });
    expect(h.load).not.toHaveBeenCalled();
    expect(h.run('gamesList')).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    h.setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    h.setHidden(true);
    h.setHidden(false);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(h.fetch).toHaveBeenCalledTimes(2);
    await h.respond(1, { games: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.fetch).toHaveBeenCalledTimes(3);
  });

  it.each(['stop', 'restart', 'room'])('ignores a list completed after %s', async action => {
    const h = spectatorHarness(file);
    h.run('startAutoRefresh()');
    await vi.advanceTimersByTimeAsync(5000);
    h.run(action === 'stop' ? 'stopAutoRefresh()' : action === 'restart' ? 'startAutoRefresh()' : "gameSelect.value = 'manual-room'");
    await vi.advanceTimersByTimeAsync(15_000);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    await h.respond(0, { games: [{ id: 'auto-room', phase: 'active' }] });
    expect(h.load).not.toHaveBeenCalled();
    expect(h.subscribe).not.toHaveBeenCalled();
    expect(h.run('gamesList')).toEqual([]);
    expect(vi.getTimerCount()).toBe(action === 'stop' ? 0 : 1);
    if (action === 'room') expect(h.gameSelect.value).toBe('manual-room');
  });
});

it('mobile auto-follow synchronizes the actual picker label, adjudication button and drawer selection', async () => {
  const h = spectatorHarness('spectator-m.js');
  h.run('startAutoRefresh()');
  await vi.advanceTimersByTimeAsync(5000);
  await h.respond(0, { games: [
    { id: 'latest01', phase: 'active', createdAt: 2 },
    { id: 'older001', phase: 'game_over', createdAt: 1 },
  ] });
  expect(h.load).toHaveBeenCalledTimes(1);
  expect(h.load.mock.calls[0]?.[0]).toBe('latest01');
  expect(h.subscribe).toHaveBeenCalledWith('latest01');
  expect(h.gameSelect.value).toBe('latest01');
  expect(h.label.textContent).toBe('latest01 · 进行中');
  expect(h.force.disabled).toBe(false);
  expect(h.menu.children.map(el => [el.dataset.gameId, el.attributes['aria-selected']])).toEqual([
    ['latest01', 'true'], ['older001', 'false'],
  ]);
  expect(h.picker.classList.contains('open')).toBe(false);
  expect(h.pickerButton.attributes['aria-expanded']).toBe('false');
  const drawer = h.document.getElementById('drawer-game-list');
  expect(drawer.children.filter(el => el.classList.contains('active')).map(el => el.dataset.id)).toEqual(['latest01']);

  await vi.advanceTimersByTimeAsync(5000);
  await h.respond(1, { games: [{ id: 'finished', phase: 'game_over', turnNumber: 18, createdAt: 3 }] });
  expect(h.label.textContent).toBe('finished · 回合18');
  expect(h.force.disabled).toBe(true);
  expect(drawer.children.filter(el => el.classList.contains('active')).map(el => el.dataset.id)).toEqual(['finished']);
});

for (const file of PLAYERS) describe(`${file} API 304 consumers`, () => {
  function harness() {
    const source = read(file);
    const env = environment();
    const reset = vi.fn();
    const state = { turn: { phase: 'active' }, plan: { committed: ['a'], myQueue: [{ id: 'plan-a' }] }, adjudication: { score: 42 } };
    const context = createContext({ fetch: env.fetch, playback: { reset }, boardAnimation: { reset, syncState: reset }, state });
    const run = (code: string) => new Script(code).runInContext(context);
    run(`let myToken = 'token'; let gameId = 'room-a';
      ${block(source, 'const API = {', 'async function loadMapList(')}
      ${fn(source, 'loadFullState')}
      ${block(source, 'let adjudicationRefreshInFlight =', 'function cellAt(')}
    `);
    return { ...env, run, reset, state };
  }

  it('never reads an empty 304 body or clears the current score, plan, events or animation', async () => {
    const h = harness();
    const snapshot = structuredClone(h.state);
    const score = h.run('refreshAdjudication()');
    const json = await h.respond(0, null, 304);
    expect(await score).toBe(true);
    expect(json).not.toHaveBeenCalled();
    expect(h.state).toEqual(snapshot);
    const full = h.run('loadFullState()');
    const eventJson = await h.respond(1, null, 304);
    expect(await full).toBe(true);
    expect(eventJson).not.toHaveBeenCalled();
    expect(h.reset).not.toHaveBeenCalled();
    expect(h.state).toEqual(snapshot);
  });

  it('keeps a queued refresh after 304 and merges its subsequent authoritative plan', async () => {
    const h = harness();
    const first = h.run('refreshAdjudication()');
    const queued = h.run('refreshAdjudication()');
    expect(h.fetch).toHaveBeenCalledTimes(1);
    await h.respond(0, null, 304);
    expect(h.fetch).toHaveBeenCalledTimes(2);
    await h.respond(1, { plan: { committed: ['a', 'b'], myQueue: [] }, phase: 'active' });
    expect(await first).toBe(true);
    expect(await queued).toBe(true);
    expect(h.state.plan).toEqual({ committed: ['a', 'b'], myQueue: [] });
    expect(h.run('adjudicationRefreshInFlight')).toBe(null);
  });
});
