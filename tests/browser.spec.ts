import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

interface Room {
  gameId: string;
  hostToken: string;
  player: { id: string; token: string };
}

let createdIds: string[] = [];
let browserErrors: string[] = [];

async function createRoom(request: APIRequestContext, name: string): Promise<Room> {
  const response = await request.post('/api/games', {
    data: { mapId: 'default', playerName: name, participate: true, maxPlayers: 2 },
  });
  expect(response.ok()).toBe(true);
  const room: Room = await response.json();
  createdIds.push(room.gameId);
  return room;
}

async function createRoomInBrowser(page: Page): Promise<Room> {
  await page.goto('/play.html');
  await expect(page.locator('#lobby-map-name')).not.toHaveText('地图加载中…');
  await page.locator('#btn-change-map').click();
  await page.locator('.map-card[data-map-id="default"]').click();
  await page.locator('#btn-map-dialog-apply').click();
  await expect(page.locator('#map-select')).toHaveValue('default');
  await page.locator('#create-name').fill('E2E 房主');
  await page.locator('label.checkbox-field').filter({ has: page.locator('#host-participate') }).click();
  await expect(page.locator('#host-participate')).toBeChecked();
  const created = page.waitForResponse(response => response.url().endsWith('/api/games') && response.request().method() === 'POST');
  await page.locator('#btn-create').click();
  const response = await created;
  expect(response.ok()).toBe(true);
  const room: Room = await response.json();
  createdIds.push(room.gameId);
  await expect(page.locator('#created-game-id')).toHaveText(room.gameId);
  return room;
}

async function joinRoom(request: APIRequestContext, room: Room) {
  const response = await request.post(`/api/games/${room.gameId}/join`, { data: { name: 'E2E 对手' } });
  expect(response.ok()).toBe(true);
  const joined = await response.json();
  const seats = await request.put(`/api/games/${room.gameId}/host/seats`, {
    headers: { 'x-host-token': room.hostToken },
    data: { order: [room.player.id, joined.player.id], firstSeat: 0 },
  });
  expect(seats.ok()).toBe(true);
  return joined;
}

/** 只加入、不编排座位：座位表停在 random 态（大厅不该标先手，点「设为先手」才落库）。 */
async function joinRoomUnarranged(request: APIRequestContext, room: Room) {
  const response = await request.post(`/api/games/${room.gameId}/join`, { data: { name: 'E2E 对手' } });
  expect(response.ok()).toBe(true);
  return (await response.json()) as { player: { id: string; token: string } };
}

async function setHidden(page: Page, hidden: boolean) {
  await page.evaluate(value => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value ? 'hidden' : 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

test.beforeEach(async ({ page }) => {
  createdIds = [];
  browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.message));
});

test.afterEach(async ({ page, request }) => {
  await page.goto('about:blank');
  for (const id of createdIds) {
    const response = await request.delete(`/api/games/${id}`, { headers: { 'x-control-token': 'isolated-browser-control' } });
    expect(response.ok()).toBe(true);
  }
  expect(browserErrors).toEqual([]);
});

test('creates a room, starts a game and receives turn changes through SSE', async ({ page, request, isMobile }) => {
  await page.addInitScript(() => {
    let terrainPaints = 0;
    const fill = CanvasRenderingContext2D.prototype.fill;
    CanvasRenderingContext2D.prototype.fill = function (...args: any[]) {
      if (!this.canvas.isConnected) terrainPaints++;
      return (fill as any).apply(this, args);
    };
    Object.defineProperty(window, '__terrainPaints', { get: () => terrainPaints });
    let sequence = 0;
    Object.defineProperty(window, '__lastSseSequence', { get: () => sequence });
    const NativeEventSource = window.EventSource;
    window.EventSource = class extends NativeEventSource {
      constructor(url: string | URL, options?: EventSourceInit) {
        super(url, options);
        this.addEventListener('message', event => { sequence = Math.max(sequence, Number(event.lastEventId)); });
      }
    };
  });
  const room = await createRoomInBrowser(page);
  await joinRoom(request, room);
  await expect(page.locator('#btn-start-game')).toBeEnabled();
  await page.locator('#btn-start-game').click();
  await expect(page.locator('#board')).toBeVisible();
  const endTurn = page.locator(isMobile ? '#btn-end-turn-bar' : '#btn-end-turn');
  await expect(endTurn).toBeEnabled();
  const terrainBefore = await page.evaluate(() => (window as any).__terrainPaints);
  expect(terrainBefore).toBeGreaterThan(0);
  const response = page.waitForResponse(item => item.url().endsWith(`/api/games/${room.gameId}/end-turn`));
  await endTurn.click();
  expect((await response).ok()).toBe(true);
  const stateResponse = await request.get(`/api/games/${room.gameId}`, { headers: { 'x-player-token': room.player.token } });
  expect(stateResponse.ok()).toBe(true);
  const state = await stateResponse.json();
  expect(state.turn.currentPlayerId).toBe('player_b');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __lastSseSequence: number }).__lastSseSequence))
    .toBeGreaterThanOrEqual(state.events.at(-1).seq);
  expect(await page.evaluate(() => (window as any).__terrainPaints)).toBe(terrainBefore);
});

test('does not overlap slow lobby polls and refreshes when visibility returns', async ({ page }) => {
  await page.clock.install();
  const room = await createRoomInBrowser(page);
  let requests = 0;
  let release!: () => void;
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const firstFinished = new Promise<void>(resolve => { finish = resolve; });
  await page.route(`**/api/games/${room.gameId}/lobby`, async route => {
    requests += 1;
    if (requests === 1) await gate;
    await route.continue();
    finish();
  });
  try {
    await page.clock.runFor(1500);
    await expect.poll(() => requests).toBe(1);
    await page.clock.runFor(6000);
    expect(requests).toBe(1);
    await setHidden(page, true);
    const response = page.waitForResponse(item => item.url().endsWith(`/api/games/${room.gameId}/lobby`));
    release();
    await firstFinished;
    await (await response).finished();
    await page.clock.runFor(6000);
    expect(requests).toBe(1);
    await setHidden(page, false);
    await expect.poll(() => requests).toBe(2);
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('auto-follow updates the selected room label and adjudication availability', async ({ page, request, isMobile }) => {
  await page.clock.install();
  const first = await createRoom(request, 'E2E 旧大厅');
  await page.goto('/spectator.html');
  await page.locator('#game-select').selectOption(first.gameId, { force: true });
  await expect(page.locator('#force-adjudicate')).toBeDisabled();
  await page.locator('#btn-settings').click();
  const follow = page.locator(isMobile ? '#follow-latest-drawer' : '#follow-latest');
  await page.locator('label.toggle-row').filter({ has: follow }).click();
  await expect(follow).toBeChecked();
  await page.locator(isMobile ? '#drawer-close' : '#btn-settings').click();
  const next = await createRoom(request, 'E2E 新对局');
  await joinRoom(request, next);
  const started = await request.post(`/api/games/${next.gameId}/start`, { headers: { 'x-host-token': next.hostToken } });
  expect(started.ok()).toBe(true);
  await page.clock.runFor(5000);
  await expect(page.locator('#game-select')).toHaveValue(next.gameId);
  await expect(page.locator(isMobile ? '#game-picker-label' : '#picker-current-body')).toContainText(next.gameId.slice(0, 8));
  await expect(page.locator('#force-adjudicate')).toBeEnabled();
  await expect(page.locator('#board')).toBeVisible();
});

test('starts with the seat chosen in the lobby even when the seat sync is slow', async ({ page, request }) => {
  const room = await createRoomInBrowser(page);
  const second = await joinRoomUnarranged(request, room);
  // 座位编排的 PUT 故意慢：客户端必须先等它落库再发「开始」，否则服务端会用旧座位表开局。
  await page.route(`**/api/games/${room.gameId}/host/seats`, async route => {
    await new Promise(resolve => setTimeout(resolve, 600));
    await route.continue();
  });
  const requests: string[] = [];
  page.on('request', item => {
    const url = item.url();
    if (url.endsWith(`/api/games/${room.gameId}/host/seats`)) requests.push('seats');
    if (url.endsWith(`/api/games/${room.gameId}/start`)) requests.push('start');
  });
  await expect(page.locator('.lobby-seat-row')).toHaveCount(2);
  await expect(page.locator('#btn-start-game')).toBeEnabled();
  await page.locator('[data-seat-first="1"]').click();
  await page.locator('#btn-start-game').click();
  await expect(page.locator('#board')).toBeVisible();
  expect(requests.slice(0, 2)).toEqual(['seats', 'start']);
  const stateResponse = await request.get(`/api/games/${room.gameId}`, { headers: { 'x-player-token': room.player.token } });
  expect(stateResponse.ok()).toBe(true);
  const state = await stateResponse.json();
  expect(state.turn.currentPlayerId).toBe(second.player.id);
});

test('resumes spectator SSE after history and reuses log rows while pinned', async ({ page, request, isMobile }) => {
  await page.addInitScript(() => {
    const urls: string[] = [];
    const sequences: number[] = [];
    Object.assign(window, { __sseProbe: { urls, sequences } });
    const Native = window.EventSource;
    window.EventSource = class extends Native {
      constructor(url: string | URL, options?: EventSourceInit) {
        super(url, options);
        urls.push(String(url));
        this.addEventListener('message', event => sequences.push(JSON.parse(event.data).seq));
      }
    };
  });
  const room = await createRoom(request, 'E2E 增量日志');
  const joined = await joinRoom(request, room);
  expect((await request.post(`/api/games/${room.gameId}/start`, { headers: { 'x-host-token': room.hostToken } })).ok()).toBe(true);
  const initial = (await (await request.get(`/api/games/${room.gameId}/events`)).json()).events;
  const lastSeq = initial.at(-1).seq;
  await page.goto('/spectator.html');
  await page.locator('#game-select').selectOption(room.gameId, { force: true });
  const log = isMobile ? '#drawer-events' : '#events';
  await expect(page.locator(`${log} li`)).toHaveCount(initial.length);
  await expect.poll(() => page.evaluate(() => (window as any).__sseProbe.urls.at(-1)))
    .toBe(`/api/games/${room.gameId}/events?after=${lastSeq}`);
  await page.evaluate(log => {
    Object.assign(window, { __originalRow: document.querySelector(`${log} li[data-step="0"]`),
      __originalMarker: document.querySelector('#timeline-markers .marker') });
    const timeline = document.querySelector<HTMLInputElement>('#timeline')!;
    timeline.value = '0';
    timeline.dispatchEvent(new Event('input', { bubbles: true }));
  }, log);
  expect((await request.post(`/api/games/${room.gameId}/end-turn`, { headers: { 'x-player-token': room.player.token } })).ok()).toBe(true);
  const updated = (await (await request.get(`/api/games/${room.gameId}/events`)).json()).events;
  await expect(page.locator(`${log} li`)).toHaveCount(updated.length);
  await expect(page.locator('#timeline')).toHaveValue('0');
  await expect(page.locator(`${log} li.active`)).toHaveAttribute('data-step', '0');
  expect(await page.evaluate(log => ({
    sameRow: (window as any).__originalRow === document.querySelector(`${log} li[data-step="0"]`),
    sameMarker: (window as any).__originalMarker === document.querySelector('#timeline-markers .marker'),
    sequences: (window as any).__sseProbe.sequences,
  }), log)).toEqual({ sameRow: true, sameMarker: true, sequences: updated.filter((event: any) => event.seq > lastSeq).map((event: any) => event.seq) });
  if (isMobile) await page.locator('.bar-btn[data-drawer="events"]').click();
  await page.locator(`${log} li`).first().click();
  await expect(page.locator('#timeline')).toHaveValue(String(updated.length - 1));
  expect(await page.locator('#timeline-markers').evaluate(container => {
    const last = container.lastElementChild!;
    return Math.abs(parseFloat(getComputedStyle(last).left) - container.getBoundingClientRect().width) < 1;
  })).toBe(true);
  expect((await request.patch(`/api/games/${room.gameId}/player`, {
    headers: { 'x-player-token': joined.player.token }, data: { name: 'E2E 改名' },
  })).ok()).toBe(true);
  await expect(page.locator(`${log} li[data-type="turn_end"]`).first()).toContainText('E2E 改名');
  expect(await page.evaluate(log => (window as any).__originalRow === document.querySelector(`${log} li[data-step="0"]`), log)).toBe(true);
});

test('follows a lobby with no history through game start and resets the log on room change', async ({ page, request, isMobile }) => {
  const room = await createRoom(request, 'E2E 空历史');
  const other = await createRoom(request, 'E2E 另一局');
  await page.goto('/spectator.html');
  await page.locator('#game-select').selectOption(room.gameId, { force: true });
  const log = isMobile ? '#drawer-events' : '#events';
  await expect(page.locator(`${log} li`)).toHaveCount(0);
  await joinRoom(request, room);
  expect((await request.post(`/api/games/${room.gameId}/start`, { headers: { 'x-host-token': room.hostToken } })).ok()).toBe(true);
  await expect(page.locator(`${log} li[data-type="game_start"]`)).toHaveCount(1);
  await expect(page.locator('#timeline')).not.toHaveValue('0');
  // 切换到另一局（空大厅）：增量日志必须清空旧行，而不是残留上一局的行。
  await page.locator('#game-select').selectOption(other.gameId, { force: true });
  await expect(page.locator(`${log} li`)).toHaveCount(0);
  await expect(page.locator('#timeline-markers .marker')).toHaveCount(0);
});

test('invalidates cached terrain on demolition and restores it when seeking backwards', async ({ page, request, isMobile }) => {
  await page.addInitScript(() => {
    const fill = CanvasRenderingContext2D.prototype.fill;
    CanvasRenderingContext2D.prototype.fill = function (...args: any[]) {
      if (!this.canvas.isConnected) Object.assign(window, { __terrainCanvas: this.canvas });
      return (fill as any).apply(this, args);
    };
  });
  const room = await createRoom(request, 'E2E 地形缓存');
  await joinRoom(request, room);
  expect((await request.post(`/api/games/${room.gameId}/start`, { headers: { 'x-host-token': room.hostToken } })).ok()).toBe(true);
  const events = (await (await request.get(`/api/games/${room.gameId}/events`)).json()).events;
  const start = events.find((event: any) => event.type === 'game_start');
  start.seq = 1;
  const cell = start.payload.map.cells[0];
  cell.terrain = 'blocker';
  const replay = [start, ...Array.from({ length: 1000 }, (_, i) => ({
    seq: i + 2, type: 'wait', payload: { owner: 'player_a' }, timestamp: start.timestamp + i + 1,
  })), { seq: 1002, type: 'demolish', payload: { q: cell.q, r: cell.r, toTerrain: 'plain' }, timestamp: start.timestamp + 1001 }];
  await page.goto('/spectator.html');
  await page.locator('#import-file').setInputFiles({ name: 'terrain-replay.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(replay)) });
  const log = isMobile ? '#drawer-events' : '#events';
  await expect(page.locator(`${log} li`)).toHaveCount(1002);
  const terrain = () => page.evaluate(() => (window as any).__terrainCanvas.toDataURL());
  const demolished = await terrain();
  await page.locator('#btn-prev').click();
  await expect(page.locator('#timeline')).toHaveValue('1000');
  const restored = await terrain();
  expect(restored).not.toBe(demolished);
  await page.locator('#btn-next').click();
  await expect(page.locator('#timeline')).toHaveValue('1001');
  expect(await terrain()).toBe(demolished);
  await page.locator('#btn-prev').click();
  expect(await terrain()).toBe(restored);
});

test('keeps an idle board asleep and wakes it after a game event', async ({ page, request }) => {
  await page.addInitScript(() => {
    const original = window.requestAnimationFrame.bind(window);
    const cancel = window.cancelAnimationFrame.bind(window);
    const pending = new Set<number>();
    let completed = 0;
    Object.defineProperty(window, '__animationProbe', { value: { pending, get completed() { return completed; } } });
    window.requestAnimationFrame = callback => {
      const id = original(time => {
        pending.delete(id);
        completed += 1;
        callback(time);
      });
      pending.add(id);
      return id;
    };
    window.cancelAnimationFrame = id => {
      pending.delete(id);
      cancel(id);
    };
  });
  const room = await createRoom(request, 'E2E 动画');
  await joinRoom(request, room);
  expect((await request.post(`/api/games/${room.gameId}/start`, { headers: { 'x-host-token': room.hostToken } })).ok()).toBe(true);
  await page.goto('/spectator.html');
  await page.locator('#game-select').selectOption(room.gameId, { force: true });
  await expect(page.locator('#board')).toBeVisible();
  const frameState = () => page.evaluate(() => {
    const probe = (window as unknown as { __animationProbe: { pending: Set<number>; completed: number } }).__animationProbe;
    return { pending: probe.pending.size, completed: probe.completed };
  });
  await expect.poll(async () => (await frameState()).pending).toBe(0);
  const before = (await frameState()).completed;
  expect((await request.post(`/api/games/${room.gameId}/end-turn`, { headers: { 'x-player-token': room.player.token } })).ok()).toBe(true);
  await expect.poll(async () => (await frameState()).completed).toBeGreaterThan(before);
  await expect.poll(async () => (await frameState()).pending).toBe(0);
});
