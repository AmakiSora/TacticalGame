import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * v6：`seatDraft` 从「未保存草稿」降级为「乐观视图」。
 * 行为级用例：抽 `seatViewOf` / `beginSeatEdit` / `rebaseSeatOrder` 直接跑，验证
 * ① 没意图时视图 = 服务端；② 有意图时保留本地相对顺序、剔除离开者、新加入者追加末尾；
 * ③ 409 rebase 用同一套合并规则；④ 名字按 playerId 从 lobby.players 现取（S5 不回退）。
 */
const CLIENTS = ['public/play.js', 'public/play-m.js'];

function read(path: string): string {
  return readFileSync(path, 'utf-8');
}

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

interface SeatRow { id: string; name: string }

interface ViewHarness {
  draft: SeatRow[] | null;
  first: number;
  setDraft(rows: SeatRow[] | null, first?: number): void;
  seatViewOf(lobby: unknown): SeatRow[];
  beginSeatEdit(lobby: unknown): SeatRow[];
  rebaseSeatOrder(order: string[], lobby: unknown): string[];
  clampFirstSeat(value: number, length: number, simultaneous: boolean): number;
}

function harness(path: string): ViewHarness {
  const source = read(path);
  const body = `
    const esc = value => String(value);
    const OWNER_COLOR = {};
    let seatDraft = null;
    let seatDraftFirst = 0;
    ${extractFunction(source, 'isSimultaneousLobby')}
    ${extractFunction(source, 'lobbyPlayerNames')}
    ${extractFunction(source, 'clampFirstSeat')}
    ${extractFunction(source, 'seatViewOf')}
    ${extractFunction(source, 'rebaseSeatOrder')}
    ${extractFunction(source, 'beginSeatEdit')}
    return {
      get draft() { return seatDraft; },
      get first() { return seatDraftFirst; },
      setDraft(rows, first = 0) { seatDraft = rows; seatDraftFirst = first; },
      seatViewOf,
      beginSeatEdit,
      rebaseSeatOrder,
      clampFirstSeat,
    };
  `;
  return new Function(body)() as ViewHarness;
}

function lobby(players: Array<[string, string]>, firstSeat = 0, mode = 'standard') {
  return {
    phase: 'lobby',
    mapId: 'multiplayer-ring',
    mode,
    seatMode: 'manual',
    seatVersion: 7,
    firstSeat,
    maxPlayers: 6,
    players: players.map(([id, name]) => ({ id, name })),
    seats: players.map(([playerId, name], index) => ({
      seat: index + 1, playerId, name, spawnSlotId: `slot_${index + 1}`,
    })),
  };
}

describe('seat optimistic view (v6)', () => {
  for (const path of CLIENTS) {
    it(`equals the server seats when there is no pending intent (${path})`, () => {
      const ui = harness(path);
      const live = lobby([['player_b', 'B'], ['player_a', 'A']], 0);
      expect(ui.seatViewOf(live).map(row => row.id)).toEqual(['player_b', 'player_a']);
      // 没有意图时 beginSeatEdit 固化出同一顺序，且不覆盖已有的乐观视图。
      expect(ui.beginSeatEdit(live).map(row => row.id)).toEqual(['player_b', 'player_a']);
      ui.setDraft([{ id: 'player_a', name: 'A' }, { id: 'player_b', name: 'B' }]);
      expect(ui.beginSeatEdit(live).map(row => row.id)).toEqual(['player_a', 'player_b']);
    });

    it(`keeps local order, drops leavers and appends joiners (${path})`, () => {
      const ui = harness(path);
      ui.setDraft([
        { id: 'player_c', name: 'C' },
        { id: 'player_a', name: 'A' },
        { id: 'player_b', name: 'B' },
      ]);
      // player_b 离开、player_d 加入：相对顺序保留、离开者剔除、新加入者追加末尾。
      const after = lobby([['player_a', 'A'], ['player_c', 'C'], ['player_d', 'D']]);
      expect(ui.seatViewOf(after).map(row => row.id)).toEqual(['player_c', 'player_a', 'player_d']);
    });

    it(`rebases the intent onto the newest member list with the same rule (${path})`, () => {
      const ui = harness(path);
      const grown = lobby([['player_a', 'A'], ['player_b', 'B'], ['player_c', 'C'], ['player_d', 'D']]);
      expect(ui.rebaseSeatOrder(['player_c', 'player_a', 'player_b'], grown))
        .toEqual(['player_c', 'player_a', 'player_b', 'player_d']);
      expect(ui.rebaseSeatOrder(['player_c', 'player_gone', 'player_a'], grown))
        .toEqual(['player_c', 'player_a', 'player_b', 'player_d']);
    });

    it(`clamps firstSeat and forces 0 in simultaneous modes (${path})`, () => {
      const ui = harness(path);
      expect(ui.clampFirstSeat(5, 3, false)).toBe(2);
      expect(ui.clampFirstSeat(-1, 3, false)).toBe(0);
      expect(ui.clampFirstSeat(2, 3, true)).toBe(0);
    });

    it(`takes names from the live player list, not the stale seat snapshot (${path})`, () => {
      const ui = harness(path);
      // seats 里是旧名，players 里是新名：固化的乐观视图要用新名。
      const renamed = {
        ...lobby([['player_a', '旧A'], ['player_b', '旧B']]),
        players: [{ id: 'player_a', name: '新A' }, { id: 'player_b', name: '新B' }],
      };
      expect(ui.beginSeatEdit(renamed).map(row => row.name)).toEqual(['新A', '新B']);
      expect(ui.seatViewOf(renamed).map(row => row.id)).toEqual(['player_a', 'player_b']);
    });
  }

  it('no longer keeps a separate draft version (v6)', () => {
    for (const path of CLIENTS) {
      const source = read(path);
      // 版本基线收敛到 seatSync.baseVersion，seatDraftVersion 必须彻底消失。
      expect(source, `${path} 仍有 seatDraftVersion`).not.toContain('seatDraftVersion');
      // 保存按钮 / 底栏也不该存在（即时提交）。
      expect(source, `${path} 仍有保存座位入口`).not.toContain('data-seat-save');
      expect(source, `${path} 仍有 saveSeatOrder`).not.toContain('saveSeatOrder');
      expect(source, `${path} 仍有 syncSeatPreviewBadge`).not.toContain('syncSeatPreviewBadge');
    }
  });
});
