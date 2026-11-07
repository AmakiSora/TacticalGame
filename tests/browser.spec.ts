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
  const response = page.waitForResponse(item => item.url().endsWith(`/api/games/${room.gameId}/end-turn`));
  await endTurn.click();
  expect((await response).ok()).toBe(true);
  const stateResponse = await request.get(`/api/games/${room.gameId}`, { headers: { 'x-player-token': room.player.token } });
  expect(stateResponse.ok()).toBe(true);
  const state = await stateResponse.json();
  expect(state.turn.currentPlayerId).toBe('player_b');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __lastSseSequence: number }).__lastSseSequence))
    .toBeGreaterThanOrEqual(state.events.at(-1).seq);
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
