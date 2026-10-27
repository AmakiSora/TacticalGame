import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * 大厅座位列表（v6）：
 * - 改动即时生效 → 没有「保存座位 / 恢复随机」底栏；「恢复随机」挪进列表头、5 秒撤销。
 * - 成员操作合并成一个槽（自己=改名 / 房主看别人=踢出 / 非房主看别人=空占位）。
 * - 同步态只用状态点表达（灰/琥珀/红），不出现任何可见文字标签。
 * - 模式分支：顺序模式「设为先手」+ ▲ 角标；同时回合「置顶」、DOM 里零「先手」。
 */
function read(path: string): string {
  return readFileSync(path, 'utf-8');
}

const CLIENTS = ['public/play.js', 'public/play-m.js'];
const STYLES = ['public/play.css', 'public/play-m.css'];

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

const STUBS = `
  const esc = value => String(value);
  const OWNER_COLOR = {};
  const els = { lobbySummary: null };
  let myPlayer = null;
  let myToken = null;
  let seatDraft = null;
  let seatDraftFirst = 0;
  let seatSync = { state: 'idle', stopped: false };
`;

interface UiHarness {
  setSelf(playerId: string | null, token?: string): void;
  setDraft(rows: Array<{ id: string; name: string }> | null, first?: number): void;
  setSync(state: string, stopped?: boolean): void;
  seatPlanMarkup(lobby: unknown, canManage: boolean): string;
  lobbySummaryMarkup(lobby: unknown, canKick: boolean): string;
}

function harness(path: string): UiHarness {
  const source = read(path);
  const body = `${STUBS}
    ${extractFunction(source, 'isSimultaneousLobby')}
    ${extractFunction(source, 'lobbyPlayerNames')}
    ${extractFunction(source, 'clampFirstSeat')}
    ${extractFunction(source, 'seatViewOf')}
    ${extractFunction(source, 'seatIntentOf')}
    ${extractFunction(source, 'currentFirstSeat')}
    ${extractFunction(source, 'seatSyncLabel')}
    ${extractFunction(source, 'seatSyncText')}
    ${extractFunction(source, 'seatPlanMarkup')}
    ${extractFunction(source, 'lobbyPhaseLabel')}
    ${extractFunction(source, 'seatPlanMarkup') ? '' : ''}
    ${extractFunction(source, 'lobbyWinnerName')}
    ${extractFunction(source, 'lobbyResultMarkup')}
    ${extractFunction(source, 'lobbySummaryMarkup')}
    return {
      setSelf(playerId, token = 'self-token') { myPlayer = playerId; myToken = token; },
      setDraft(rows, first = 0) { seatDraft = rows; seatDraftFirst = first; },
      setSync(state, stopped = false) { seatSync.state = state; seatSync.stopped = stopped; },
      seatPlanMarkup,
      lobbySummaryMarkup,
    };
  `;
  return new Function(body)() as UiHarness;
}

const SLOT_TOKENS = /data-seat-op=|class="lobby-rename"|class="lobby-kick"|data-seat-up=|data-seat-down=|data-seat-first=|data-seat-top=/g;

function rowChunks(html: string): string[] {
  return html
    .split('<div class="lobby-seat-row')
    .slice(1)
    .map(part => part.split('</div>')[0]!);
}

function seatsLobby(overrides: Record<string, unknown> = {}) {
  const order = ['player_a', 'player_b', 'player_c'];
  return {
    phase: 'lobby',
    mapId: 'multiplayer-ring',
    mode: 'standard',
    seatMode: 'manual',
    seatVersion: 2,
    firstSeat: 0,
    maxPlayers: 6,
    supportedPlayerCounts: [2, 3, 6],
    layoutSlots: ['slot_1', 'slot_3', 'slot_5'],
    players: order.map(id => ({ id, name: id.slice(-1).toUpperCase() })),
    seats: order.map((id, index) => ({
      seat: index + 1, playerId: id, name: id.slice(-1).toUpperCase(), spawnSlotId: null,
    })),
    ...overrides,
  };
}

function emptyLobby(overrides: Record<string, unknown> = {}) {
  return {
    phase: 'lobby',
    mapId: 'multiplayer-ring',
    mode: 'standard',
    seatMode: 'random',
    seatVersion: 0,
    firstSeat: 0,
    maxPlayers: 6,
    supportedPlayerCounts: [2, 3, 6],
    layoutSlots: [],
    players: [],
    seats: [],
    ...overrides,
  };
}

describe('seat list: no save bar, immediate sync (V6-4/5)', () => {
  for (const path of CLIENTS) {
    it(`has no save bar or save button left (${path})`, () => {
      const source = read(path);
      expect(source, `${path} 还有保存按钮`).not.toContain('data-seat-save');
      expect(source, `${path} 还有底栏`).not.toContain('lobby-seat-footer');
      expect(source, `${path} 还有 saveSeatOrder`).not.toContain('saveSeatOrder');
      // 点击即发：pushIntent 用 180ms 合并窗口后自动 flush。
      expect(source, `${path} 缺 pushIntent`).toContain('function pushIntent(lobby)');
      expect(source, `${path} 合并窗口不是 180ms`).toContain('const SEAT_SYNC_DELAY = 180;');
      expect(source, `${path} 缺自动 flush`).toContain('function scheduleSeatFlush()');
    });

    it(`expresses sync state with a dot only, never a visible label (${path})`, () => {
      const ui = harness(path);
      ui.setSync('pending');
      const html = ui.seatPlanMarkup(seatsLobby(), true);
      expect(html).toContain('data-seat-sync="pending"');
      expect(html).toContain('lobby-seat-sync-dot');
      expect(html).toContain('is-pending');
      // 不再有「预览」这种可见标签，也没有预览态 class。
      expect(html).not.toContain('预览');
      expect(read(path), `${path} 还有 is-seat-preview`).not.toContain('is-seat-preview');
    });

    it(`moves 恢复随机 into the summary head and offers undo instead of a confirm (${path})`, () => {
      const ui = harness(path);
      const html = ui.lobbySummaryMarkup(seatsLobby(), true);
      // 恢复随机在标题行内，且排在座位列表之前。
      const headAt = html.indexOf('class="lobby-summary-head"');
      const resetAt = html.indexOf('data-seat-reset="1"');
      const listAt = html.indexOf('class="lobby-seats"');
      expect(resetAt).toBeGreaterThan(headAt);
      expect(resetAt).toBeLessThan(listAt);
      // 标题行下不再有「地图 X · 支持 N 人」那一行（用户：其它位置已有）。
      expect(html, `${path} 还有地图 / 支持人数重复行`).not.toContain('lobby-summary-meta');
      // 不弹确认，改为 toast 里带「撤销」。
      const source = read(path);
      expect(source, `${path} 恢复随机仍在弹确认`).not.toContain('恢复随机座位？');
      expect(source, `${path} 缺撤销入口`).toContain("label: '撤销'");
      expect(source, `${path} 撤销窗口不是 5 秒`).toContain('timeout: 5000');
      expect(source, `${path} 缺撤销实现`).toContain('function undoSeatReset(');
    });

    it(`hides 恢复随机 when nothing is arranged (${path})`, () => {
      const ui = harness(path);
      const html = ui.lobbySummaryMarkup(emptyLobby(), true);
      expect(html).not.toContain('data-seat-reset');
    });
  }
});

describe('seat rows: one member slot (V6-7)', () => {
  for (const path of CLIENTS) {
    it(`renders exactly one member op per row (${path})`, () => {
      const ui = harness(path);
      ui.setSelf('player_b');
      const html = ui.seatPlanMarkup(seatsLobby(), true);
      const rows = rowChunks(html);
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        expect(row.match(/class="lobby-seat-member"/g)?.length, row).toBe(1);
        expect(row.match(/data-rename-self|data-kick-player|data-seat-op="member"/g)?.length, row).toBe(1);
        // 同步点是行首唯一的状态表达。
        expect(row.match(/lobby-seat-sync-dot/g)?.length).toBe(1);
      }
      // 自己行=改名、别人行=踢出。
      expect(rows[1]).toContain('class="lobby-rename"');
      expect(rows[1]).not.toContain('data-kick-player');
      expect(rows[0]).toContain('data-kick-player="player_a"');
      expect(rows[0]).not.toContain('class="lobby-rename"');
    });

    it(`keeps four slots (member + ▲ + ▼ + third) in every host row (${path})`, () => {
      const ui = harness(path);
      const html = ui.seatPlanMarkup(seatsLobby(), true);
      for (const row of rowChunks(html)) {
        // 4 = 成员槽 + ▲ + ▼ + 先手/置顶，缺的用同宽占位补齐。
        expect(row.match(SLOT_TOKENS)?.length, row).toBe(4);
        expect(row.match(/class="lobby-seat-slot"/g)?.length).toBe(1);
      }
    });

    it(`gives read-only rows just the (empty) member slot (${path})`, () => {
      const ui = harness(path);
      const html = ui.seatPlanMarkup(seatsLobby(), false);
      for (const row of rowChunks(html)) {
        expect(row.match(SLOT_TOKENS)?.length, row).toBe(1);
        expect(row).not.toContain('data-seat-up');
        expect(row).not.toContain('data-seat-first');
        expect(row).not.toContain('data-seat-top');
      }
    });
  }

  it('drops the old double member slot rule (V6-7)', () => {
    for (const path of STYLES) {
      const css = read(path);
      expect(css, `${path} 仍有双槽宽度规则`).not.toContain('.lobby-seat-op-empty[data-seat-op="member"]');
      expect(css, `${path} 还有底栏样式`).not.toContain('.lobby-seat-footer');
      expect(css, `${path} 还有保存按钮样式`).not.toContain('.lobby-seat-save');
      // 成员槽仍固定 46px（只是不再有双槽占位）。
      expect(css, `${path} 成员槽宽丢了`).toContain('.lobby-rename, .lobby-kick');
    }
  });
});

describe('seat list: mode semantics (V6-9)', () => {
  for (const path of CLIENTS) {
    it(`keeps 先手 for sequence modes (${path})`, () => {
      const ui = harness(path);
      const html = ui.seatPlanMarkup(seatsLobby(), true);
      expect(html).toContain('data-seat-first="1"');
      expect(html).toContain('设为先手');
      expect(html).toContain('lobby-seat-row is-first');
      expect(html).not.toContain('data-seat-top');
      // 先手只用右侧按钮的选中态表达（「先手」+ disabled），不再有列表头文字说明。
      expect(html).toContain('>先手</button>');
      expect(html, `${path} 列表头说明行应已删除`).not.toContain('座位已编排');
    });

    for (const mode of ['simultaneous', 'royale']) {
      it(`uses 置顶 and no 先手 anywhere in ${mode} rooms (${path})`, () => {
        const ui = harness(path);
        const html = ui.seatPlanMarkup(seatsLobby({ mode, mapId: 'standoff' }), true);
        expect(html).toContain('data-seat-top="1"');
        expect(html).toContain('>置顶</button>');
        // 结算顺序 / 「不分先后」这类说明文字整行删除（顺序看列表就懂）。
        expect(html).not.toContain('结算顺序');
        expect(html).not.toContain('同时回合不分先后');
        // 零「先手」：连说明句也不含这两个字（V6-9 / §12 收口）。
        expect((html.match(/先手/g) ?? []).length, mode).toBe(0);
        expect(html).not.toContain('data-seat-first');
        expect(html).not.toContain('lobby-seat-row is-first');
        for (const row of rowChunks(html)) expect(row.match(SLOT_TOKENS)?.length).toBe(4);
      });
    }
  }

  it('drops the seat list header copy but keeps the empty-state hint', () => {
    for (const path of CLIENTS) {
      const ui = harness(path);
      // 有人时：列表里不再有任何说明行；状态靠行内出生位槽 + 恢复随机按钮 + 状态点表达。
      const html = ui.seatPlanMarkup(seatsLobby(), true);
      expect(html, `${path} 还有列表头说明行`).not.toContain('lobby-seat-hint');
      expect(html, `${path} 还有常驻说明行`).not.toContain('lobby-seat-note');
      // 0 人空态提示仍然保留（那是添加 AI 入口的唯一上下文）。
      const empty = ui.seatPlanMarkup(emptyLobby(), true);
      expect(empty, `${path} 空态提示被删了`).toContain('lobby-seat-hint');
      expect(empty).toContain('还没有玩家加入');
    }
  });
});

describe('seat list: permissions and empty room (V6-10)', () => {
  for (const path of CLIENTS) {
    it(`keeps 添加 AI for the host of an empty room (${path})`, () => {
      const ui = harness(path);
      const html = ui.seatPlanMarkup(emptyLobby(), true);
      expect(html).toContain('data-add-bot="1"');
      expect(html).not.toContain('lobby-seat-row');
      expect(html).not.toContain('data-seat-first');
      expect(html).not.toContain('data-seat-up');
    });

    it(`renders nothing for a non-host in an empty room (${path})`, () => {
      const ui = harness(path);
      expect(ui.seatPlanMarkup(emptyLobby(), false)).toBe('');
    });

    it(`drops every seat control for a non-host (${path})`, () => {
      const ui = harness(path);
      const html = ui.seatPlanMarkup(seatsLobby(), false);
      for (const attr of ['data-seat-up', 'data-seat-down', 'data-seat-first', 'data-seat-top', 'data-add-bot']) {
        expect(html, attr).not.toContain(attr);
      }
      // 恢复随机与（标题行的）同步状态点也不给非房主；行内状态点是无害的状态提示，不算控件。
      const summary = ui.lobbySummaryMarkup(seatsLobby(), false);
      expect(summary).not.toContain('data-seat-reset');
      expect(summary).not.toContain('class="lobby-seat-sync"');
    });
  }
});
