import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

// 方案 A：房主不参战时，开局后自动带本局观战令牌进观战页。
// 这些用例执行真实的 URL 拼接 / 会话持久化 / 按局存取函数，而不是只匹配源码字符串。

const read = (path: string) => readFileSync(path, 'utf8');

const PLAYER_LINKS = [
  { file: 'public/play.js', page: 'spectator.html' },
  { file: 'public/play-m.js', page: 'spectator-m.html' },
];
const SPECTATOR_PAGES = ['public/app.js', 'public/spectator-m.js'];

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, String(value)); },
    removeItem: (key: string) => { data.delete(key); },
    dump: () => Object.fromEntries(data),
  };
}

/** 切出大厅页的观战链接助手（spectatorPageUrl / spectatorShareUrl / syncSpectatorLinkUi / capture）。 */
function loadLinkHelpers(file: string) {
  const source = read(file);
  const start = source.indexOf('function spectatorPageUrl(page) {');
  const end = source.indexOf('async function enterGame() {', start);
  expect(start, `${file} 缺少 spectatorPageUrl`).toBeGreaterThan(-1);
  expect(end, `${file} 观战链接助手之后缺少 enterGame`).toBeGreaterThan(start);
  const body = source.slice(start, end);
  const classList = { toggle: vi.fn() };
  const els = {
    createdSpectatorRow: { classList },
    createdSpectatorUrl: { textContent: '' },
  };
  const context: any = {
    gameId: null,
    hostToken: null,
    spectatorToken: null,
    els,
    window: { location: { origin: 'http://127.0.0.1:3123' } },
    encodeURIComponent,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(
    `${body}\nglobalThis.__api = { spectatorPageUrl, spectatorShareUrl, syncSpectatorLinkUi, captureSpectatorToken };`,
    context,
  );
  return { api: context.__api, context, els, classList };
}

/** 切出大厅页的 persistSession / readStoredSession，用真实函数做一次落盘回读。 */
function loadSession(file: string) {
  const source = read(file);
  const start = source.indexOf('function persistSession() {');
  const end = source.indexOf('function fillSettingsFromSession() {', start);
  expect(start, `${file} 缺少 persistSession`).toBeGreaterThan(-1);
  expect(end, `${file} persistSession 之后缺少 fillSettingsFromSession`).toBeGreaterThan(start);
  const body = source.slice(start, end);
  const storage = memoryStorage();
  const factory = new Function(
    'localStorage',
    `let gameId = null, myToken = null, myPlayer = null, hostToken = null, spectatorToken = null, sessionName = null;
     ${body}
     return {
       persistSession,
       readStoredSession,
       set(next) {
         gameId = next.gameId;
         myToken = next.myToken ?? null;
         myPlayer = next.myPlayer ?? null;
         hostToken = next.hostToken ?? null;
         spectatorToken = next.spectatorToken ?? null;
         sessionName = next.sessionName ?? null;
       },
     };`,
  );
  return { api: factory(storage) as any, storage };
}

/** 切出观战页的按对局令牌存取（含模块加载时的 URL 令牌摄取）。 */
function loadSpectatorStore(file: string, options: { search?: string; seed?: Record<string, string> } = {}) {
  const source = read(file);
  const start = source.indexOf('const SPECTATOR_TOKEN_PREFIX');
  const endMarker = file === 'public/app.js'
    ? "const canvas = document.getElementById('board');"
    : '// mobile board transform';
  const end = source.indexOf(endMarker, start);
  expect(start, `${file} 缺少按局令牌存取`).toBeGreaterThan(-1);
  expect(end, `${file} 令牌存取之后缺少分节标记`).toBeGreaterThan(start);
  const body = source.slice(start, end);
  const storage = memoryStorage();
  for (const [key, value] of Object.entries(options.seed || {})) storage.setItem(key, value);
  const context: any = {
    localStorage: storage,
    URLSearchParams,
    window: { location: { search: options.search ?? '' } },
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(
    `${body}\nglobalThis.__api = { spectatorTokenKey, readSpectatorTokenFor, writeSpectatorTokenFor };`,
    context,
  );
  return { api: context.__api, storage };
}

describe('host spectator link', () => {
  it('adds the spectator token only when the game has one', () => {
    for (const { file, page } of PLAYER_LINKS) {
      const h = loadLinkHelpers(file);
      h.context.gameId = 'game-1';

      h.context.spectatorToken = null;
      expect(h.api.spectatorPageUrl(page), file).toBe(`/${page}?gameId=game-1`);
      expect(h.api.spectatorShareUrl(page), file).toBe('');

      h.context.spectatorToken = 'tok /?#';
      const query = `gameId=game-1&spectatorToken=${encodeURIComponent('tok /?#')}`;
      expect(h.api.spectatorPageUrl(page), file).toBe(`/${page}?${query}`);
      expect(h.api.spectatorShareUrl(page), file).toBe(`http://127.0.0.1:3123/${page}?${query}`);
    }
  });

  it('shows the copyable link only for a host holding a non-empty token', () => {
    for (const { file, page } of PLAYER_LINKS) {
      const h = loadLinkHelpers(file);
      h.context.gameId = 'game-1';
      h.context.hostToken = 'host-1';

      // 非迷雾局建房响应 spectatorToken 为空串：不出现观战链接入口。
      h.context.spectatorToken = h.api.captureSpectatorToken({ spectatorToken: '' });
      expect(h.context.spectatorToken, file).toBeNull();
      h.api.syncSpectatorLinkUi();
      expect(h.classList.toggle, file).toHaveBeenLastCalledWith('hidden', true);
      expect(h.els.createdSpectatorUrl.textContent, file).toBe('');

      h.context.spectatorToken = h.api.captureSpectatorToken({ spectatorToken: 'tok-1' });
      h.api.syncSpectatorLinkUi();
      expect(h.classList.toggle, file).toHaveBeenLastCalledWith('hidden', false);
      expect(h.els.createdSpectatorUrl.textContent, file)
        .toBe(`http://127.0.0.1:3123/${page}?gameId=game-1&spectatorToken=tok-1`);

      // 只有观战令牌、没有房主身份时也不该出现入口。
      h.context.hostToken = null;
      h.api.syncSpectatorLinkUi();
      expect(h.classList.toggle, file).toHaveBeenLastCalledWith('hidden', true);
    }
  });

  it('normalizes missing or empty create-response tokens to null', () => {
    for (const { file } of PLAYER_LINKS) {
      const h = loadLinkHelpers(file);
      expect(h.api.captureSpectatorToken({})).toBeNull();
      expect(h.api.captureSpectatorToken({ spectatorToken: '   ' })).toBe('   ');
      expect(h.api.captureSpectatorToken({ spectatorToken: null })).toBeNull();
      expect(h.api.captureSpectatorToken({ spectatorToken: 'tok' })).toBe('tok');
    }
  });
});

describe('host session keeps the spectator token with its game', () => {
  it('round-trips the token and treats a missing legacy field as null', () => {
    for (const { file } of PLAYER_LINKS) {
      const h = loadSession(file);
      h.api.set({ gameId: 'game-1', myToken: 'player-1', hostToken: 'host-1', spectatorToken: 'spec-1', sessionName: 'n' });
      h.api.persistSession();
      expect(h.api.readStoredSession(), file).toMatchObject({
        gameId: 'game-1',
        hostToken: 'host-1',
        spectatorToken: 'spec-1',
      });

      h.storage.setItem('tacticalGame.session', JSON.stringify({ gameId: 'old-game', hostToken: 'host-1' }));
      expect(h.api.readStoredSession().spectatorToken, file).toBeNull();
    }
  });
});

describe('spectator tokens are stored per game', () => {
  it('never returns game A token for game B', () => {
    for (const file of SPECTATOR_PAGES) {
      const h = loadSpectatorStore(file);
      expect(h.api.writeSpectatorTokenFor('game-a', 'token-a'), file).toBe(true);
      expect(h.api.readSpectatorTokenFor('game-a'), file).toBe('token-a');
      expect(h.api.readSpectatorTokenFor('game-b'), file).toBe('');
      expect(h.storage.getItem('tacticalGame.spectator.game-a'), file).toBe('token-a');

      h.api.writeSpectatorTokenFor('game-a', '');
      expect(h.api.readSpectatorTokenFor('game-a'), file).toBe('');
    }
  });

  it('writes a URL token under the linked game id only', () => {
    for (const file of SPECTATOR_PAGES) {
      const h = loadSpectatorStore(file, { search: '?gameId=game-a&spectatorToken=url-token' });
      expect(h.api.readSpectatorTokenFor('game-a'), file).toBe('url-token');
      expect(h.api.readSpectatorTokenFor('game-b'), file).toBe('');
    }
  });

  it('ignores a URL token without a game id', () => {
    for (const file of SPECTATOR_PAGES) {
      const h = loadSpectatorStore(file, { search: '?spectatorToken=orphan-token' });
      expect(h.api.readSpectatorTokenFor('game-a'), file).toBe('');
      expect(Object.keys(h.storage.dump()), file).toEqual([]);
    }
  });

  it('reads the legacy global key once and never reuses it', () => {
    for (const file of SPECTATOR_PAGES) {
      const h = loadSpectatorStore(file, { seed: { autoSpectatorToken: 'legacy-token' } });
      // 旧键没有所属对局信息，无法校验归属：加载时清除，任何对局都不再回落到它。
      expect(h.storage.getItem('autoSpectatorToken'), file).toBeNull();
      expect(h.api.readSpectatorTokenFor('game-a'), file).toBe('');
    }
  });
});
