import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * 「连接进入游戏」与「开始游戏」合并：
 * - 房主大厅期只留「开始游戏」（startHostedGame 成功后自动进棋盘），「进入游戏」只在 active 出现；
 * - 加入者大厅期不给「进入游戏」，改为提示「房主开始后会自动进入游戏」，active 才显示；
 * - 对局结束一律走回放入口；
 * - enterGame() 不再有「点了才告知对局没开始」的路径。
 */
function read(path: string): string {
  return readFileSync(path, 'utf-8');
}

const PAGES = ['public/play.html', 'public/play-m.html'];
const CLIENTS = ['public/play.js', 'public/play-m.js'];

function extractFunction(source: string, name: string): string {
  let start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`源码里找不到 ${name}()`);
  if (source.slice(Math.max(0, start - 6), start) === 'async ') start -= 6;
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  let index = braceStart;
  for (; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) {
        index += 1;
        break;
      }
    }
  }
  return source.slice(start, index);
}

interface FakeEl {
  textContent: string;
  title: string;
  href: string;
  disabled: boolean;
  classList: {
    add(name: string): void;
    remove(name: string): void;
    contains(name: string): boolean;
    toggle(name: string, on?: boolean): boolean;
  };
}

interface RoomUiHarness {
  els: Record<string, FakeEl>;
  setLobby(lobby: unknown): void;
  syncHostSeatUi(): void;
  syncJoinRoomUi(lobby: unknown): void;
}

const EL_NAMES = [
  'createdPlayerTokenRow', 'createdToken', 'createdTokenCopy',
  'createRoomStatus', 'createRoomTitle', 'createRoomHint', 'createRoomBadge',
  'btnStartGame', 'btnHostParticipate', 'btnConnectCreate', 'btnViewReplay',
  'joinRoomStatus', 'joinRoomTitle', 'joinRoomHint', 'joinRoomBadge',
  'btnConnectJoin', 'btnViewReplayJoin',
];

function harness(path: string): RoomUiHarness {
  const source = read(path);
  const body = `
    const makeEl = () => {
      const set = new Set();
      return {
        textContent: '', title: '', href: '', disabled: false,
        classList: {
          add: name => set.add(name),
          remove: name => set.delete(name),
          contains: name => set.has(name),
          toggle: (name, on) => {
            const want = on === undefined ? !set.has(name) : Boolean(on);
            if (want) set.add(name); else set.delete(name);
            return want;
          },
        },
      };
    };
    const els = {};
    for (const name of ${JSON.stringify(EL_NAMES)}) els[name] = makeEl();
    let hostLobbySnapshot = null;
    let myToken = 'self-token';
    let myPlayer = 'player_a';
    let hostSeatBusy = false;
    const gameId = 'game-1';
    const lobbyPlayerName = () => '房主';
    const lobbyWinnerName = () => '房主';
    const syncCreateFormStatic = () => {};
    ${extractFunction(source, 'syncHostSeatUi')}
    ${extractFunction(source, 'syncJoinRoomUi')}
    return { els, syncHostSeatUi, syncJoinRoomUi, setLobby(lobby) { hostLobbySnapshot = lobby; } };
  `;
  return new Function(body)() as RoomUiHarness;
}

describe('host room card: 开始游戏 / 进入游戏 merged', () => {
  for (const path of CLIENTS) {
    it(`shows 进入游戏 only while the game is active (${path})`, () => {
      const ui = harness(path);
      ui.setLobby({ phase: 'lobby', playerCount: 1, maxPlayers: 6, players: [] });
      ui.syncHostSeatUi();
      expect(ui.els.btnConnectCreate!.classList.contains('hidden'), '大厅期不该有进入游戏').toBe(true);

      ui.setLobby({ phase: 'active', playerCount: 1, maxPlayers: 6, players: [] });
      ui.syncHostSeatUi();
      expect(ui.els.btnConnectCreate!.classList.contains('hidden'), 'active 期缺进入游戏').toBe(false);
      expect(ui.els.btnConnectCreate!.textContent).toBe('进入游戏');

      ui.setLobby({ phase: 'game_over', playerCount: 1, maxPlayers: 6, players: [] });
      ui.syncHostSeatUi();
      expect(ui.els.btnConnectCreate!.classList.contains('hidden'), '结束后走回放入口').toBe(true);
    });

    it(`gates the button on phase, not on participation (${path})`, () => {
      const body = extractFunction(read(path), 'syncHostSeatUi');
      expect(body, `${path} 进入游戏仍按参战状态控制`).toContain("classList.toggle('hidden', !active)");
      expect(body, `${path} 缺 phase 判断`).toContain("const active = lobby?.phase === 'active';");
    });
  }
});

describe('joiner room card: 进入游戏 only after the host starts', () => {
  for (const path of CLIENTS) {
    it(`hides 进入游戏 in the lobby and explains auto-enter instead (${path})`, () => {
      const ui = harness(path);
      ui.syncJoinRoomUi({ phase: 'lobby' });
      expect(ui.els.btnConnectJoin!.classList.contains('hidden'), '大厅期不该有进入游戏').toBe(true);
      expect(ui.els.joinRoomHint!.textContent).toContain('房主开始后会自动进入游戏');
      // 按钮收进 active 之后，提示句里不再承诺「手动点」。
      expect(ui.els.joinRoomHint!.textContent).not.toContain('手动点');
      expect(ui.els.joinRoomStatus!.textContent).toBe('等待房主开始');
    });

    it(`offers 进入游戏 once the game is active (${path})`, () => {
      const ui = harness(path);
      ui.syncJoinRoomUi({ phase: 'active' });
      expect(ui.els.btnConnectJoin!.classList.contains('hidden')).toBe(false);
      expect(ui.els.btnConnectJoin!.textContent).toBe('进入游戏');
      expect(ui.els.joinRoomHint!.textContent).toContain('点「进入游戏」');
      expect(ui.els.joinRoomStatus!.textContent).toBe('对局已开始');
    });

    it(`falls back to the replay entry after the game ends (${path})`, () => {
      const ui = harness(path);
      ui.syncJoinRoomUi({ phase: 'game_over' });
      expect(ui.els.btnConnectJoin!.classList.contains('hidden')).toBe(true);
      expect(ui.els.btnViewReplayJoin!.classList.contains('hidden')).toBe(false);
    });
  }
});

describe('enterGame no longer promises to learn the game has not started', () => {
  for (const path of CLIENTS) {
    it(`drops the 对局尚未开始 branch (${path})`, () => {
      const body = extractFunction(read(path), 'enterGame');
      expect(body, `${path} 还有「对局尚未开始」`).not.toContain('对局尚未开始');
      // 不再顺手回读大厅 / 判断被移出房间，避免多余的一整页状态刷新。
      expect(body, `${path} 还在回读大厅`).not.toContain('refreshLobbySummary');
      expect(body, `${path} 还在判断被移出房间`).not.toContain('handleLobbyRemoval');
      // 兜底用固定文案，不把服务端错误直接甩给用户。
      expect(body, `${path} 缺固定兜底文案`).toContain('获取对局状态失败，请稍后重试');
    });
  }
});

describe('markup defaults and copy', () => {
  it('keeps both connect buttons hidden until a render says otherwise', () => {
    for (const path of PAGES) {
      const html = read(path);
      expect(html, `${path} 房主进入游戏未默认隐藏`).toMatch(/id="btn-connect-create" class="btn success hidden"/);
      expect(html, `${path} 加入者进入游戏未默认隐藏`).toMatch(/id="btn-connect-join" class="btn success hidden"/);
      expect(html, `${path} 加入者提示未改`).toContain('房主开始后会自动进入游戏。');
    }
  });

  it('retires the old 连接进入游戏 label', () => {
    for (const path of [...PAGES, ...CLIENTS]) {
      expect(read(path), `${path} 还有「连接进入游戏」`).not.toContain('连接进入游戏');
    }
  });
});
