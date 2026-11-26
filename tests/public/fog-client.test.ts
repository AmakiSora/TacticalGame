import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');
const PLAYER_PAGES = ['public/play.js', 'public/play-m.js'];
const SPECTATOR_PAGES = ['public/app.js', 'public/spectator-m.js'];

function slice(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  expect(from, `缺少 ${start}`).toBeGreaterThan(-1);
  expect(to, `${start} 之后缺少 ${end}`).toBeGreaterThan(from);
  return source.slice(from, to);
}

function loadRulesSheet(): { buildHtml: (config: any) => string } {
  const context: any = { window: {} };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(read('public/rules-sheet.js'), context);
  return context.window.RulesSheet;
}

/** 在最小沙箱里执行客户端的 scoreBreakdown：隐藏分项必须提前返回，不能触碰 scoreTerms。 */
function loadScoreBreakdown(file: string): (score: any) => string {
  const fnSource = slice(read(file), 'function scoreBreakdown(score) {', 'function scoreRank(');
  const context: any = {
    scoreTerms: () => { throw new Error('hidden score must not be expanded'); },
    formatScore: (value: number) => String(value),
    esc: (value: string) => String(value),
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(`${fnSource}\nglobalThis.__breakdown = scoreBreakdown;`, context);
  return context.__breakdown;
}

describe('fog player pages', () => {
  it('loads the shared fog helpers and treats fog as a simultaneous mode', () => {
    for (const page of PLAYER_PAGES) {
      const source = read(page);

      expect(source, page).toContain("import './fog.js';");
      // 浏览器里走 FogView；无 DOM 的 VM 沙箱回落到同口径字面量。
      expect(source, page).toContain('window.FogView.isSimultaneousMode(mode)');
      expect(source, page).toContain('window.FogView.isAnnihilationMode(mode)');
      expect(source, page).toContain("return mode === 'simultaneous' || mode === 'royale' || mode === 'fog';");
      expect(source, page).toContain("return mode === 'annihilation' || mode === 'royale';");
      // 入口谓词自带字面量（测试会单独切出执行），同样涵盖迷雾。
      expect(source, page).toMatch(/function isSimultaneous\(\) \{\r?\n  const mode = gameConfig\?\.mode;\r?\n  return mode === 'simultaneous' \|\| mode === 'royale' \|\| mode === 'fog';/);
      expect(source, page).toMatch(/function isSimultaneousLobby\(lobby\) \{\r?\n(?:.*\r?\n)?  const mode = lobby\?\.mode;\r?\n  return mode === 'simultaneous' \|\| mode === 'royale' \|\| mode === 'fog';/);
      // 模式标签可直接显示「迷雾」，而炮火/歼灭分支不因迷雾打开。
      expect(source, page).toContain("mode === 'fog' ? '迷雾'");
      expect(source, page).not.toContain("mode === 'fog' || mode === 'annihilation'");
    }
  });

  it('takes units and fog projection from the authoritative GET response', () => {
    for (const page of PLAYER_PAGES) {
      const source = read(page);

      expect(source, page).toContain('fog: null');
      expect(source, page).toContain("Object.prototype.hasOwnProperty.call(data, 'fog')");
      expect(source, page).toContain('window.FogView.normalizeProjection(data.fog)');
      expect(source, page).toContain('mergeFogUnits(data.units)');

      const merge = slice(source, 'function mergeFogUnits(units) {', 'function cellAt(');
      // 投影是权威集合：旧单位中被隐藏的条目要消失，只保留已阵亡记录。
      expect(merge, page).toContain('const next = new Map();');
      expect(merge, page).toContain('state.units = next;');
      expect(merge, page).toContain('unit.alive === false');
      expect(merge, page).not.toContain('ghost');
    }
  });

  it('darkens only server-hidden cells and never computes vision itself', () => {
    for (const page of PLAYER_PAGES) {
      const source = read(page);
      const layer = slice(source, 'function drawFogLayer() {', 'function drawFogGhosts()');

      expect(layer, page).toContain('if (!fogEnabled() || state.fog.revealed) return;');
      expect(layer, page).toContain('window.FogView.cellHidden(state.fog, cell.q, cell.r)');
      expect(layer, page).toContain("'rgba(3, 7, 11, .64)'");
      // 地形仍可辨认：暗层是半透明填充，不是整块遮罩。
      expect(layer, page).not.toContain('globalCompositeOperation');
      expect(layer, page).not.toContain('vision');
    }
  });

  it('draws ghosts at 40% alpha with a dashed ring and question badge, outside selection', () => {
    for (const page of PLAYER_PAGES) {
      const source = read(page);
      const ghosts = slice(source, 'function drawFogGhosts() {', 'function ');

      expect(ghosts, page).toContain('ctx.globalAlpha = .4;');
      expect(ghosts, page).toContain('ctx.setLineDash([4, 3]);');
      expect(ghosts, page).toContain("fillText('?'");
      expect(ghosts, page).toContain('drawUnitGlyph(ghost.type');
      // 残影只来自 lastSeen，不进 state.units，因此 entityAt 永远选不中它。
      expect(source, page).toContain('window.FogView.ghostsFor(state.fog, state.units)');
      const entityAt = slice(source, 'function entityAt(', 'function occupied(');
      expect(entityAt, page).not.toContain('ghost');
      expect(entityAt, page).not.toContain('FogView');
    }
  });

  it('marks attacks on cells without a visible unit as blind fire', () => {
    for (const page of PLAYER_PAGES) {
      const source = read(page);

      expect(source, page).toContain('window.FogView.blindFireHint(state.fog, hasVisibleTarget)');
      expect(source, page).toContain("tone: 'blind'");
      expect(source, page).toContain("' | 盲射'");
      // 命中预测只遍历可见单位；残影不参与候选。
      const preview = slice(source, 'function aimPreview(', 'function drawChipAt(');
      expect(preview, page).toContain('entityAt(cell.q, cell.r)');
      expect(preview, page).not.toContain('ghostAt');
      expect(preview, page).toContain('hasVisibleTarget');
      // 迷雾不影响治疗：只有攻击才补盲射角标。
      expect(preview, page).toContain('if (!isHeal && fogEnabled())');
    }
  });

  it('shows ghost and hidden-cell notes on hover without making ghosts entities', () => {
    for (const page of PLAYER_PAGES) {
      const source = read(page);

      expect(source, page).toContain('残影 ${UNIT_NAMES[ghost.type] || \'单位\'} ${ghost.hp}/${ghost.maxHp}（第${ghost.seenRound}轮）');
      expect(source, page).toContain("' | 视野外'");
      expect(source, page).toContain('window.FogView.ghostAt(state.fog, state.units');
    }
  });

  it('passes the player token on the SSE URL because EventSource cannot set headers', () => {
    for (const page of PLAYER_PAGES) {
      const source = read(page);

      expect(source, page).toContain('const authQuery = myToken ?');
      expect(source, page).toContain('${authQuery}');
      expect(source, page).toContain('?after=${lastSeq}');
    }
  });
});

describe('fog score privacy', () => {
  it('renders hidden opponent breakdowns as masked copy instead of zero terms', () => {
    for (const page of [...PLAYER_PAGES, ...SPECTATOR_PAGES]) {
      const source = read(page);
      expect(source, page).toContain("if (score?.hidden) return '<div class=\"score-breakdown score-breakdown-masked\">对手分项不可见（迷雾）</div>';");

      const breakdown = loadScoreBreakdown(page);
      const html = breakdown({ hidden: true, total: 292.2 });
      expect(html, page).toContain('对手分项不可见（迷雾）');
      expect(html, page).not.toContain('敌方总部伤害');
      expect(html, page).not.toContain('×');
    }
  });

  it('styles the masked breakdown on every score panel stylesheet', () => {
    for (const file of ['public/style.css', 'public/play.css', 'public/play-m.css', 'public/spectator-m.css']) {
      expect(read(file), file).toContain('.score-breakdown.score-breakdown-masked');
    }
  });
});

describe('fog spectator pages', () => {
  it('discovers fog games anonymously, then retries with X-Spectator-Token', () => {
    for (const page of SPECTATOR_PAGES) {
      const source = read(page);
      const meta = slice(source, 'async function fetchSpectatorMeta(', 'function setFogLock(');

      expect(source, page).toContain("const SPECTATOR_TOKEN_PREFIX = 'tacticalGame.spectator.';");
      expect(source, page).toContain('new URLSearchParams(window.location.search)');
      expect(source, page).toContain("params.get('spectatorToken')");
      expect(meta, page).toContain('const token = readSpectatorTokenFor(id);');
      expect(source, page).toContain('function isSimultaneousReplay() {');
      expect(source, page).toContain("return mode === 'simultaneous' || mode === 'royale' || mode === 'fog';");
      expect(meta, page).toContain('publicData.config?.mode === \'fog\' || publicData.fog?.enabled === true');
      // 非迷雾局不受陈旧令牌影响。
      expect(meta, page).toContain('if (!fogGame) return { data: publicData, fogGame: false };');
      expect(meta, page).toContain("headers: { 'X-Spectator-Token': token }");
      expect(meta, page).toContain('authed.status === 401');
    }
  });

  it('shows a token-required lock instead of rebuilding the board from projected events', () => {
    for (const page of SPECTATOR_PAGES) {
      const source = read(page);
      const locked = slice(source, 'function showFogLocked(', 'async function loadGameState(');
      const load = slice(source, 'async function loadGameState(', 'function subscribeSse(');

      expect(source, page).toContain("'迷雾模式对局需要观战令牌。'");
      expect(source, page).toContain("'观战令牌无效，无法查看迷雾对局。'");
      // 锁定页只消费公开字段（地图/总部/据点/轮次），并清空事件，绝不用半量事件重放。
      expect(locked, page).toContain('state.map = cloneMapPayload(data?.map || {})');
      expect(locked, page).toContain('data?.headquarters');
      expect(locked, page).toContain('allEvents = [];');
      expect(locked, page).not.toContain('/events');
      // loadGameState 在请求事件流之前就分流到锁定页。
      expect(load, page).toContain('if (meta.fogGame && meta.locked) {');
      expect(load.indexOf('meta.fogGame && meta.locked')).toBeLessThan(load.indexOf('/events'));
    }
  });

  it('never fabricates adjudication scores on the locked public view', () => {
    for (const page of SPECTATOR_PAGES) {
      const source = read(page);

      expect(source, page).toContain('let fogLockedView = false;');
      // 隐藏裁决时不再回落到本地补算，分项全 0 的"算式"不得出现在公开页。
      const live = slice(source, 'function liveAdjudicationScores(', 'function liveAdjudicationRankings(');
      expect(live, page).toContain('if (fogLockedView) return null;');
      expect(source, page).toContain('迷雾对局需观战令牌查看裁决');

      const locked = slice(source, 'function showFogLocked(', 'async function loadGameState(');
      expect(locked, page).toContain('fogLockedView = true;');
      expect(locked.indexOf('fogLockedView = true;')).toBeLessThan(locked.indexOf('renderSidebar()'));

      const clear = slice(source, 'function clearFogLock(', 'function showFogLocked(');
      expect(clear, page).toContain('fogLockedView = false;');

      // 导入回放自带事件，不再沿用锁定页的遮罩/裁决屏蔽（遮罩也要真的收起）。
      const imported = slice(source, 'function loadImportedReplay(', 'function importJson(');
      expect(imported, page).toContain('clearFogLock();');
      expect(imported, page).toContain('liveFogGame = false;');
      expect(imported, page).not.toContain('setFogLock(');
    }
  });

  it('hides the desktop fog lock once a valid token is loaded', () => {
    // 桌面端没有全局 .hidden 规则，.fog-lock 自己声明了 display:flex，必须显式收起。
    const css = read('public/style.css');
    expect(css).toMatch(/\.fog-lock\.hidden\s*\{\s*display:\s*none;?\s*\}/);
    expect(read('public/spectator-m.css')).toContain('body.spectator-m-shell .hidden');
  });

  it('uses query tokens for SSE and resets fog state when switching games', () => {
    for (const page of SPECTATOR_PAGES) {
      const source = read(page);

      expect(source, page).toContain('const token = readSpectatorTokenFor(id);');
      expect(source, page).toContain('const authQuery = liveFogGame && token && !fogPublicTerminal ?');
      expect(source, page).toContain('spectatorToken=${encodeURIComponent(token)}');
      expect(slice(source, 'function resetLoadedGame(', 'function ')).toContain('liveFogGame = false;');
      expect(slice(source, 'function resetLoadedGame(', 'function ')).toContain('fogPublicTerminal = false;');
      expect(source, page).toContain('clearFogLock();');
    }
  });

  it('offers a spectator token field on desktop and mobile settings', () => {
    expect(read('public/spectator.html')).toContain('id="settings-spectator-token"');
    expect(read('public/spectator.html')).toContain('id="btn-save-spectator-token"');
    expect(read('public/spectator-m.html')).toContain('id="settings-spectator-token"');
    expect(read('public/spectator-m.html')).toContain('id="btn-save-spectator-token"');
    expect(read('public/spectator.html')).toContain('id="fog-lock"');
    expect(read('public/spectator-m.html')).toContain('id="fog-lock"');
    expect(read('public/style.css')).toContain('.fog-lock');
    expect(read('public/spectator-m.css')).toContain('.fog-lock');
    for (const page of SPECTATOR_PAGES) {
      expect(read(page), page).toContain('function saveSpectatorTokenFromSettings()');
    }
  });
});

/**
 * 旧固化事件的匿名 game_start 可能没有公开地图（4.0.0 时期的 public 载荷只含轮号，新局带公开地形），
 * 无座用户（房主旁观）点「进入游戏」时 state.cells 为空。enterGame 必须先把
 * 无 token 用户转去观战页，不能被 cells 判空拦下弹「获取对局状态失败」。
 */
function loadEnterGame(file: string, options: { myToken: string | null; cells?: number; ok?: boolean; spectatorToken?: string | null }) {
  const source = read(file);
  // enterGame 现在经 spectatorPageUrl 拼观战链接：连同上面的助手一起切出来执行。
  const helperStart = source.indexOf('function spectatorPageUrl(page) {');
  const start = helperStart >= 0 ? helperStart : source.indexOf('async function enterGame() {');
  const end = source.indexOf('\n// 刷新/重开后用本地会话回到对局', start);
  expect(start, `${file} 缺少 enterGame`).toBeGreaterThan(-1);
  expect(end, `${file} enterGame 之后缺少 reconnectSavedSession 注释`).toBeGreaterThan(start);
  const body = source.slice(start, end);
  const toast = vi.fn();
  const location = { href: '' };
  const joinPanel = { classList: { add: vi.fn(), remove: vi.fn() } };
  const gameUI = { classList: { add: vi.fn(), remove: vi.fn() } };
  const subscribeSse = vi.fn();
  const context: any = {
    gameId: 'fog-entry-game',
    lobbyPollSession: 0,
    document: { hidden: false, getElementById: () => null },
    closeMapDialog: vi.fn(),
    startSeatSync: vi.fn(),
    loadFullState: vi.fn(async () => options.ok !== false),
    state: { cells: Array.from({ length: options.cells ?? 0 }, () => ({})) },
    myToken: options.myToken,
    spectatorToken: options.spectatorToken ?? null,
    toast,
    window: { location },
    stopLobbyPolling: vi.fn(),
    stopAvailableGamesRefresh: vi.fn(),
    sse: null,
    els: { joinPanel, gameUI },
    subscribeSse,
    drawBoard: vi.fn(),
    renderSidebar: vi.fn(),
    statusBadge: vi.fn(),
    requestAnimationFrame: vi.fn(),
    fitBoardToViewport: vi.fn(),
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(`${body}\nglobalThis.__enterGame = enterGame;`, context);
  return { enterGame: context.__enterGame as () => Promise<void>, toast, location, subscribeSse, joinPanel, gameUI };
}

describe('fog anonymous game entry', () => {
  it('sends a seatless host to the spectator page before the empty-map guard', async () => {
    for (const page of PLAYER_PAGES) {
      const h = loadEnterGame(page, { myToken: null, cells: 0 });
      await h.enterGame();

      expect(h.toast, page).not.toHaveBeenCalled();
      expect(h.subscribeSse, page).not.toHaveBeenCalled();
      expect(h.location.href, page).toBe(
        page === 'public/play-m.js'
          ? '/spectator-m.html?gameId=fog-entry-game'
          : '/spectator.html?gameId=fog-entry-game',
      );
    }
  });

  it('carries the host spectator token into the spectator URL and omits it without one', async () => {
    for (const page of PLAYER_PAGES) {
      const token = 'tok/en +?';
      const withToken = loadEnterGame(page, { myToken: null, cells: 0, spectatorToken: token });
      await withToken.enterGame();
      const pageName = page === 'public/play-m.js' ? 'spectator-m.html' : 'spectator.html';
      expect(withToken.location.href, page).toBe(
        `/${pageName}?gameId=fog-entry-game&spectatorToken=${encodeURIComponent(token)}`,
      );

      // 非迷雾局建房响应没有令牌（null / 空串）：链接不得留下空参数。
      const withoutToken = loadEnterGame(page, { myToken: null, cells: 0, spectatorToken: '' });
      await withoutToken.enterGame();
      expect(withoutToken.location.href, page).toBe(`/${pageName}?gameId=fog-entry-game`);
    }
  });

  it('keeps the state-load error for seated players with an empty board', async () => {
    for (const page of PLAYER_PAGES) {
      const h = loadEnterGame(page, { myToken: 'player-token', cells: 0 });
      await h.enterGame();

      expect(h.toast, page).toHaveBeenCalledWith('获取对局状态失败，请稍后重试', 'err');
      expect(h.location.href, page).toBe('');
    }
  });

  it('still enters the board for a seated player with a loaded map', async () => {
    for (const page of PLAYER_PAGES) {
      const h = loadEnterGame(page, { myToken: 'player-token', cells: 4 });
      await h.enterGame();

      expect(h.toast, page).not.toHaveBeenCalled();
      expect(h.location.href, page).toBe('');
      expect(h.subscribeSse, page).toHaveBeenCalledTimes(1);
      expect(h.joinPanel.classList.add, page).toHaveBeenCalledWith('hidden');
      expect(h.gameUI.classList.remove, page).toHaveBeenCalledWith('hidden');
    }
  });

  it('keeps the token branch ahead of the cells guard in source order', () => {
    for (const page of PLAYER_PAGES) {
      const source = read(page);
      const start = source.indexOf('async function enterGame() {');
      expect(start, page).toBeGreaterThan(-1);
      const body = source.slice(start, source.indexOf('\n// 刷新/重开后用本地会话回到对局', start));
      const tokenBranch = body.indexOf('if (!myToken) {');
      const cellsGuard = body.indexOf('!state.cells.length');
      expect(tokenBranch, page).toBeGreaterThan(-1);
      expect(cellsGuard, page).toBeGreaterThan(-1);
      expect(tokenBranch, page).toBeLessThan(cellsGuard);
    }
  });
});

/** 在最小沙箱里执行观战元数据探测：终局迷雾局匿名不得再被锁。 */
function loadSpectatorMeta(file: string, publicData: any, options: { token?: string | null; tokens?: Record<string, string>; authed?: any } = {}) {
  const source = read(file);
  const start = source.indexOf('async function fetchSpectatorMeta(');
  const end = source.indexOf('function setFogLock(', start);
  expect(start, `${file} 缺少 fetchSpectatorMeta`).toBeGreaterThan(-1);
  expect(end, `${file} fetchSpectatorMeta 之后缺少 setFogLock`).toBeGreaterThan(start);
  const body = source.slice(start, end);
  const calls: Array<{ url: string; authed: boolean }> = [];
  const fetchMock = vi.fn(async (url: string, init?: { headers?: unknown }) => {
    const authed = Boolean(init?.headers);
    calls.push({ url, authed });
    if (!authed) return { ok: true, status: 200, json: async () => publicData };
    return options.authed ?? { ok: true, status: 200, json: async () => ({ ...publicData, authed: true }) };
  });
  // 令牌按对局取：默认对任何 id 都给 options.token；tokens 用来看 A 局令牌不会出现在 B 局。
  const context: any = {
    fetch: fetchMock,
    readSpectatorTokenFor: (id: string) => options.tokens?.[id] ?? options.token ?? '',
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(`${body}\nglobalThis.__meta = fetchSpectatorMeta;`, context);
  return { meta: context.__meta as (id: string) => Promise<any>, calls };
}

describe('fog finished games are public', () => {
  it('unlocks a finished fog game for an anonymous spectator', async () => {
    for (const page of SPECTATOR_PAGES) {
      const publicData = {
        phase: 'game_over',
        config: { mode: 'fog' },
        fog: { enabled: true, revealed: true },
        result: { winner: 'player_b' },
      };
      const h = loadSpectatorMeta(page, publicData);
      const meta = await h.meta('finished-game');

      expect(meta, page).toMatchObject({ fogGame: true, locked: false, unauthorized: false });
      expect(meta.data, page).toBe(publicData);
      // 终局不造特权头：只做一次匿名 GET，全量事件交给匿名 /events。
      expect(h.calls, page).toEqual([{ url: '/api/games/finished-game', authed: false }]);
    }
  });

  it('treats a stored terminal result as finished even without phase', async () => {
    for (const page of SPECTATOR_PAGES) {
      const publicData = { config: { mode: 'fog' }, fog: { enabled: true }, result: { winner: 'player_a' } };
      const meta = await loadSpectatorMeta(page, publicData).meta('finished-game');

      expect(meta, page).toMatchObject({ fogGame: true, locked: false, unauthorized: false });
    }
  });

  it('keeps an in-progress fog game locked without a token', async () => {
    for (const page of SPECTATOR_PAGES) {
      const publicData = { phase: 'active', config: { mode: 'fog' }, fog: { enabled: true, revealed: false }, result: null };
      const h = loadSpectatorMeta(page, publicData);
      const meta = await h.meta('live-game');

      expect(meta, page).toMatchObject({ fogGame: true, locked: true, unauthorized: false });
      expect(h.calls, page).toHaveLength(1);
    }
  });

  it('keeps the token path for live games and the unlocked data for finished ones', async () => {
    for (const page of SPECTATOR_PAGES) {
      const live = { phase: 'active', config: { mode: 'fog' }, fog: { enabled: true }, result: null };
      const withToken = loadSpectatorMeta(page, live, { token: 'spectator-token' });
      const liveMeta = await withToken.meta('live-game');

      expect(liveMeta, page).toMatchObject({ fogGame: true, locked: false });
      expect(liveMeta.data, page).toMatchObject({ authed: true });
      expect(withToken.calls.map(call => call.authed), page).toEqual([false, true]);

      const finished = { phase: 'game_over', config: { mode: 'fog' }, fog: { enabled: true }, result: { winner: 'player_a' } };
      const finishedMeta = await loadSpectatorMeta(page, finished, { token: 'spectator-token' }).meta('finished-game');
      expect(finishedMeta, page).toMatchObject({ fogGame: true, locked: false, unauthorized: false });
    }
  });

  it('still reports a bad token on a live fog game', async () => {
    for (const page of SPECTATOR_PAGES) {
      const live = { phase: 'active', config: { mode: 'fog' }, fog: { enabled: true }, result: null };
      const h = loadSpectatorMeta(page, live, {
        token: 'bad-token',
        authed: { ok: false, status: 401, json: async () => ({}) },
      });
      const meta = await h.meta('live-game');

      expect(meta, page).toMatchObject({ fogGame: true, locked: true, unauthorized: true });
    }
  });

  it('never sends another game token when probing this game', async () => {
    for (const page of SPECTATOR_PAGES) {
      const live = { phase: 'active', config: { mode: 'fog' }, fog: { enabled: true }, result: null };
      const h = loadSpectatorMeta(page, live, { tokens: { 'game-a': 'token-a' } });
      const meta = await h.meta('game-b');

      // A 局令牌不得出现在 B 局的探测请求里（否则 B 局会 401，甚至跨局带权限）。
      expect(meta, page).toMatchObject({ fogGame: true, locked: true, unauthorized: false });
      expect(h.calls, page).toEqual([{ url: '/api/games/game-b', authed: false }]);
    }
  });

  it('loads unlocked games through the anonymous events path without privileged headers', () => {
    for (const page of SPECTATOR_PAGES) {
      const source = read(page);
      const load = slice(source, 'async function loadGameState(', 'function subscribeSse(');
      // 无令牌与终局都走匿名 /events：终局不再出示本地残留令牌，也不另造特权头。
      expect(load, page).toContain("fogPublicTerminal = Boolean(meta.fogGame && (meta.data?.phase === 'game_over' || meta.data?.result));");
      expect(load, page).toContain('const token = readSpectatorTokenFor(id);');
      expect(load, page).toContain('const headers = meta.fogGame && token && !fogPublicTerminal ?');
      expect(load, page).toContain("{ 'X-Spectator-Token': token } : {}");
    }
  });
});

/** 抽出真实 loadGameState + subscribeSse：终局加载与 SSE 都不得再出示本地残留令牌。 */
function loadSpectatorLoad(file: string, options: { token?: string | null; tokens?: Record<string, string>; meta: any; events?: any[] }) {
  const source = read(file);
  const start = source.indexOf('async function loadGameState(');
  const endMarker = file === 'public/app.js' ? "canvas.addEventListener('mousemove'" : 'function updateHoverFromPoint(';
  const end = source.indexOf(endMarker, start);
  expect(start, `${file} 缺少 loadGameState`).toBeGreaterThan(-1);
  expect(end, `${file} loadGameState/subscribeSse 之后缺少分节标记`).toBeGreaterThan(start);
  const body = source.slice(start, end);
  const urls: string[] = [];
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ events: options.events ?? [] }) }));
  class FakeEventSource {
    onmessage: ((e: any) => void) | null = null;
    onerror: (() => void) | null = null;
    closed = false;
    constructor(readonly url: string) { urls.push(url); }
    close() { this.closed = true; }
  }
  const fetchSpectatorMeta = vi.fn(async () => options.meta);
  const showFogLocked = vi.fn();
  const startFogUnlockPoll = vi.fn();
  const stopFogUnlockPoll = vi.fn();
  const factory = new Function(
    'fetchSpectatorMeta', 'fetch', 'EventSource', 'readSpectatorTokenFor',
    'showFogLocked', 'startFogUnlockPoll', 'stopFogUnlockPoll',
    `let gameLoadVersion = 0;
     let liveSse = null;
     let importedReplayMeta = null;
     let pinnedReplayStep = false;
     let liveFogGame = false;
     let fogPublicTerminal = false;
     let gameConfig = null;
     let playerNames = {};
     let currentStep = -1;
     let allEvents = [];
     let state = { cells: [] };
     const statusEl = { textContent: '' };
     const forceAdjudicateBtn = { disabled: false };
     function pausePlayback() {}
     function clearFogLock() {}
     function defaultPlayerNames() { return {}; }
     function buildTimelineMarkers() {}
     function rebuildToStep() {}
     function renderEventLog() {}
     function renderDrawerEventLog() {}
     function updateControls() {}
     function stepForward() {}
     function createEmptyState() { return { cells: [] }; }
     function drawBoard() {}
     function renderSidebar() {}
     function renderDetail() {}
     const boardAnimation = { reset() {}, syncState() {} };
     ${body}
     return {
       loadGameState, subscribeSse, statusEl,
       snapshot: () => ({ liveFogGame, fogPublicTerminal, allEvents }),
     };`,
  );
  const api = factory(
    fetchSpectatorMeta, fetchMock, FakeEventSource,
    (id: string) => options.tokens?.[id] ?? options.token ?? '',
    showFogLocked, startFogUnlockPoll, stopFogUnlockPoll,
  );
  return { ...api, urls, fetchMock, fetchSpectatorMeta, showFogLocked, startFogUnlockPoll, stopFogUnlockPoll };
}

describe('fog terminal games drop any leftover spectator token', () => {
  it('sends no token to /events or SSE once the fog game is over', async () => {
    for (const page of SPECTATOR_PAGES) {
      const h = loadSpectatorLoad(page, {
        token: 'stale-token',
        meta: { fogGame: true, locked: false, unauthorized: false, data: { phase: 'game_over', result: { winner: 'player_a' } } },
        events: [{ seq: 1, type: 'game_start' }, { seq: 2, type: 'game_over' }],
      });

      expect(await h.loadGameState('finished-game'), page).toBeUndefined();
      expect(h.snapshot().fogPublicTerminal, page).toBe(true);
      expect(h.fetchMock, page).toHaveBeenCalledTimes(1);
      expect(h.fetchMock.mock.calls[0][0], page).toBe('/api/games/finished-game/events');
      // 终局匿名分支：本地陈旧令牌不进请求头，页面不会被它打进 401。
      expect(h.fetchMock.mock.calls[0][1]?.headers, page).toEqual({});
      expect(h.showFogLocked, page).not.toHaveBeenCalled();
      expect(h.statusEl.textContent, page).not.toContain('观战令牌');
      expect(h.snapshot().allEvents, page).toHaveLength(2);

      h.subscribeSse('finished-game');
      expect(h.urls, page).toEqual(['/api/games/finished-game/events?after=2']);
    }
  });

  it('keeps the anonymous finished-game load when no token is stored', async () => {
    for (const page of SPECTATOR_PAGES) {
      const h = loadSpectatorLoad(page, {
        token: null,
        meta: { fogGame: true, locked: false, unauthorized: false, data: { phase: 'game_over' } },
        events: [{ seq: 1 }],
      });
      await h.loadGameState('finished-game');

      expect(h.fetchMock.mock.calls[0][1]?.headers, page).toEqual({});
      h.subscribeSse('finished-game');
      expect(h.urls, page).toEqual(['/api/games/finished-game/events?after=1']);
    }
  });

  it('still sends the token for a live fog game and keeps the 401 lock', async () => {
    for (const page of SPECTATOR_PAGES) {
      const live = loadSpectatorLoad(page, {
        token: 'live-token',
        meta: { fogGame: true, locked: false, data: { phase: 'active', config: { mode: 'fog' } } },
        events: [{ seq: 7 }],
      });
      await live.loadGameState('live-game');

      expect(live.snapshot().fogPublicTerminal, page).toBe(false);
      expect(live.fetchMock.mock.calls[0][1]?.headers, page).toEqual({ 'X-Spectator-Token': 'live-token' });
      live.subscribeSse('live-game');
      expect(live.urls, page).toEqual(['/api/games/live-game/events?after=7&spectatorToken=live-token']);

      const bad = loadSpectatorLoad(page, {
        token: 'bad-token',
        meta: { fogGame: true, locked: true, unauthorized: true, data: { phase: 'active' } },
      });
      expect(await bad.loadGameState('live-game'), page).toBe(false);
      expect(bad.showFogLocked, page).toHaveBeenCalledWith({ phase: 'active' }, true);
      expect(bad.startFogUnlockPoll, page).toHaveBeenCalledWith('live-game');
      expect(bad.fetchMock, page).not.toHaveBeenCalled();
    }
  });

  it('sends each game only its own token on /events and SSE', async () => {
    for (const page of SPECTATOR_PAGES) {
      const h = loadSpectatorLoad(page, {
        tokens: { 'game-a': 'token-a' },
        meta: { fogGame: true, locked: false, data: { phase: 'active' } },
        events: [{ seq: 1 }],
      });

      await h.loadGameState('game-b');
      expect(h.fetchMock.mock.calls[0][1]?.headers, page).toEqual({});
      h.subscribeSse('game-b');
      expect(h.urls.at(-1), page).toBe('/api/games/game-b/events?after=1');

      await h.loadGameState('game-a');
      expect(h.fetchMock.mock.calls[1][1]?.headers, page).toEqual({ 'X-Spectator-Token': 'token-a' });
      h.subscribeSse('game-a');
      expect(h.urls.at(-1), page).toBe('/api/games/game-a/events?after=1&spectatorToken=token-a');
    }
  });

  it('clears the terminal flag when a later selection is a live game', async () => {
    for (const page of SPECTATOR_PAGES) {
      const h = loadSpectatorLoad(page, {
        token: 'live-token',
        meta: { fogGame: true, locked: false, data: { phase: 'game_over' } },
      });
      await h.loadGameState('finished-game');
      expect(h.snapshot().fogPublicTerminal, page).toBe(true);

      h.fetchSpectatorMeta.mockResolvedValueOnce({ fogGame: true, locked: false, data: { phase: 'active' } });
      await h.loadGameState('live-game');
      expect(h.snapshot().fogPublicTerminal, page).toBe(false);
      expect(h.fetchMock.mock.calls[1][1]?.headers, page).toEqual({ 'X-Spectator-Token': 'live-token' });
      h.subscribeSse('live-game');
      expect(h.urls.at(-1), page).toContain('spectatorToken=live-token');
    }
  });
});

/** 抽出终局解锁慢轮询块，外部注入元数据探测与加载桩，便于 fake timers 驱动。 */
function loadFogUnlockPoll(file: string) {
  const source = read(file);
  const start = source.indexOf('// 已打开的锁定观战页要能自己醒过来');
  const end = source.indexOf('function setFogLock(', start);
  expect(start, `${file} 缺少终局解锁轮询块`).toBeGreaterThan(-1);
  expect(end, `${file} 轮询块之后缺少 setFogLock`).toBeGreaterThan(start);
  const block = source.slice(start, end);
  const gameSelect = { value: '' };
  const statusEl = { textContent: '' };
  const fetchSpectatorMeta = vi.fn(async () => ({ fogGame: true, locked: true }));
  const loadGameState = vi.fn(async () => true);
  const subscribeSse = vi.fn();
  const factory = new Function(
    'fetchSpectatorMeta', 'loadGameState', 'subscribeSse', 'gameSelect', 'statusEl',
    `${block}\nreturn { startFogUnlockPoll, stopFogUnlockPoll, FOG_UNLOCK_POLL_MS };`,
  );
  const api = factory(fetchSpectatorMeta, loadGameState, subscribeSse, gameSelect, statusEl);
  return { ...api, fetchSpectatorMeta, loadGameState, subscribeSse, gameSelect, statusEl };
}

describe('fog locked spectator page auto-unlocks when the game ends', () => {
  it('unlocks on the next poll and loads the full anonymous view', async () => {
    vi.useFakeTimers();
    try {
      for (const page of SPECTATOR_PAGES) {
        const h = loadFogUnlockPoll(page);
        h.gameSelect.value = 'game-1';
        h.fetchSpectatorMeta
          .mockResolvedValueOnce({ fogGame: true, locked: true })
          .mockResolvedValue({ fogGame: true, locked: false });

        h.startFogUnlockPoll('game-1');
        // 慢轮询：先等一轮，不在锁定页渲染时立刻请求。
        expect(h.fetchSpectatorMeta, page).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(h.FOG_UNLOCK_POLL_MS);
        expect(h.fetchSpectatorMeta, page).toHaveBeenCalledTimes(1);
        expect(h.loadGameState, page).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(h.FOG_UNLOCK_POLL_MS);
        expect(h.fetchSpectatorMeta, page).toHaveBeenCalledTimes(2);
        expect(h.loadGameState, page).toHaveBeenCalledTimes(1);
        expect(h.loadGameState.mock.calls[0][0], page).toBe('game-1');
        expect(h.subscribeSse, page).toHaveBeenCalledWith('game-1');
        expect(h.statusEl.textContent, page).toContain('已解锁');

        // 解锁后不再轮询。
        await vi.advanceTimersByTimeAsync(h.FOG_UNLOCK_POLL_MS * 3);
        expect(h.fetchSpectatorMeta, page).toHaveBeenCalledTimes(2);
        h.stopFogUnlockPoll();
        vi.clearAllTimers();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps polling quietly while the fog game is still live', async () => {
    vi.useFakeTimers();
    try {
      for (const page of SPECTATOR_PAGES) {
        const h = loadFogUnlockPoll(page); // 每轮都 locked
        h.startFogUnlockPoll('game-1');

        await vi.advanceTimersByTimeAsync(h.FOG_UNLOCK_POLL_MS * 2);
        expect(h.fetchSpectatorMeta, page).toHaveBeenCalledTimes(2);
        expect(h.loadGameState, page).not.toHaveBeenCalled();
        expect(h.statusEl.textContent, page).toBe('');
        h.stopFogUnlockPoll();
        vi.clearAllTimers();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps exactly one timer when the locked page re-initializes', async () => {
    vi.useFakeTimers();
    try {
      for (const page of SPECTATOR_PAGES) {
        const h = loadFogUnlockPoll(page);
        h.startFogUnlockPoll('game-1');
        h.startFogUnlockPoll('game-1');
        h.startFogUnlockPoll('game-1');

        await vi.advanceTimersByTimeAsync(h.FOG_UNLOCK_POLL_MS);
        expect(h.fetchSpectatorMeta, page).toHaveBeenCalledTimes(1);
        h.stopFogUnlockPoll();
        vi.clearAllTimers();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels the pending poll when the page or game changes', async () => {
    vi.useFakeTimers();
    try {
      for (const page of SPECTATOR_PAGES) {
        const h = loadFogUnlockPoll(page);
        h.startFogUnlockPoll('game-1');
        h.stopFogUnlockPoll(); // 切走/卸载
        await vi.advanceTimersByTimeAsync(h.FOG_UNLOCK_POLL_MS * 2);
        expect(h.fetchSpectatorMeta, page).not.toHaveBeenCalled();

        // 换局后旧 tick 不生效，只为新对局保留一个定时器。
        h.startFogUnlockPoll('game-1');
        h.startFogUnlockPoll('game-2');
        await vi.advanceTimersByTimeAsync(h.FOG_UNLOCK_POLL_MS);
        expect(h.fetchSpectatorMeta, page).toHaveBeenCalledTimes(1);
        expect(h.fetchSpectatorMeta.mock.calls[0][0], page).toBe('game-2');
        h.stopFogUnlockPoll();
        vi.clearAllTimers();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('survives a failed poll with a single timer', async () => {
    vi.useFakeTimers();
    try {
      for (const page of SPECTATOR_PAGES) {
        const h = loadFogUnlockPoll(page);
        h.fetchSpectatorMeta
          .mockRejectedValueOnce(new Error('network'))
          .mockResolvedValueOnce({ fogGame: true, locked: true })
          .mockResolvedValue({ fogGame: true, locked: false });
        h.startFogUnlockPoll('game-1');

        await vi.advanceTimersByTimeAsync(h.FOG_UNLOCK_POLL_MS);
        expect(h.fetchSpectatorMeta, page).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(h.FOG_UNLOCK_POLL_MS);
        expect(h.fetchSpectatorMeta, page).toHaveBeenCalledTimes(2);
        expect(h.loadGameState, page).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(h.FOG_UNLOCK_POLL_MS);
        expect(h.fetchSpectatorMeta, page).toHaveBeenCalledTimes(3);
        expect(h.loadGameState, page).toHaveBeenCalledTimes(1);
        h.stopFogUnlockPoll();
        vi.clearAllTimers();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts the poll only on the locked branch and clears it on every reset path', () => {
    for (const page of SPECTATOR_PAGES) {
      const source = read(page);
      const load = slice(source, 'async function loadGameState(', 'function subscribeSse(');
      expect(load, page).toContain('stopFogUnlockPoll();');
      expect(load, page).toContain('startFogUnlockPoll(id);');
      expect(load.indexOf('startFogUnlockPoll(id);'), page)
        .toBeGreaterThan(load.indexOf('showFogLocked(meta.data, meta.unauthorized);'));

      expect(slice(source, 'function resetLoadedGame(', 'function forceAdjudicateCurrentGame('), page)
        .toContain('stopFogUnlockPoll();');
      expect(slice(source, 'function loadImportedReplay(', 'function importJson('), page)
        .toContain('stopFogUnlockPoll();');
      expect(source, page).toContain("window.addEventListener('pagehide', stopFogUnlockPoll);");
    }
  });
});

describe('fog presentation', () => {
  it('labels fog on home, stats and arena-stats without adding it to arena eval modes', () => {
    expect(read('public/index.html')).toContain('mode-badge mode-fog');
    expect(read('public/index.html')).toContain('同时回合 × 视野迷雾');
    expect(read('public/index.css')).toContain('.mode-fog {');
    expect(read('public/stats.js')).toContain("fog: '迷雾'");
    expect(read('public/arena-stats.js')).toContain("fog: '迷雾'");
    // 竞技场评估控制台不提供迷雾模式（服务端本期不把 fog 局纳入榜单/RL）。
    expect(read('public/arena.js')).not.toContain("'fog'");
    expect(read('public/arena.js')).not.toContain('迷雾');
  });

  it('renders fog rules and event copy from the server config only', () => {
    const RulesSheet = loadRulesSheet();
    const fogHarbor = JSON.parse(read('maps/fog-harbor.json'));
    const html = RulesSheet.buildHtml(fogHarbor);

    expect(html).toContain('迷雾（同时 × 视野迷雾）');
    expect(html).toContain('全程迷雾，终局公开');
    expect(html).toContain('侦察兵 4 · 远程兵 3 · 步兵 2 · 支援兵 2 · 重装 1');
    expect(html).toContain('阻挡地形挡视线，水域不挡');
    expect(html).toContain('本模式无炮火、无先手贴目');
    expect(html).toContain('揭雾');
    expect(html).not.toContain('炮火规则');

    // 同时回合的覆盖形状列对迷雾同样生效。
    expect(html).toContain('直线 2 格');
    const source = read('public/rules-sheet.js');
    expect(source).toContain("mode === 'simultaneous' || mode === 'royale' || mode === 'fog'");
  });
});
