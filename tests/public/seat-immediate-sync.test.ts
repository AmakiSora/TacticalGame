import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * V6：座位改动即时生效（单飞 + 合并）。把同步状态机从客户端源码里抽出来，
 * 在沙箱里跑（fake timers + fake fetch），验证：
 * ① 连点只发 1～2 个 PUT 且最后一次意图必胜；② 409 只 rebase 一次后自动重发；
 * ③ 5xx 退避重试 2 次后回滚；④ game_already_started 停机。
 */
const CLIENTS = ['public/play.js', 'public/play-m.js'];

function read(path: string): string {
  return readFileSync(path, 'utf-8');
}

function extractFunction(source: string, name: string): string {
  let start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`源码里找不到 ${name}()`);
  // async 函数的 `async` 在 `function` 之前，切片要带上它，否则沙箱里 await 非法。
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

interface SyncHarness {
  setLobby(lobby: unknown): void;
  /** 直接改乐观视图（模拟点击 ▲▼ 之后的本地顺序）。 */
  setOrder(ids: string[]): void;
  push(): void;
  flushNow(): Promise<void>;
  advance(ms: number): Promise<void>;
  puts: Array<Record<string, unknown>>;
  toasts: Array<{ msg: string; type: string }>;
  state(): string;
  baseVersion(): number | null;
  draftOrder(): string | null;
  renders(): number;
  stopped(): boolean;
}

/** 沙箱里注入的同步状态机初值（与源码保持一致，只把 DOM/网络换成桩）。 */
const STATE = `
  const SEAT_SYNC_DELAY = 180;
  const SEAT_SYNC_RETRY_DELAYS = [400, 900];
  let seatDraft = null;
  let seatDraftFirst = 0;
  let seatSync = {
    desired: null, seq: 0, baseVersion: null, inFlight: false, timer: null,
    state: 'idle', stopped: false, lastGoodLobby: null, retryIntent: null, failMessage: null,
  };
`;

const STUBS = `
  const esc = value => String(value);
  const OWNER_COLOR = {};
  const els = { lobbySummary: null };
  let latestLobby = null;
  let gameId = 'g1';
  let hostToken = 'host-token';
  const myPlayer = null;
  const myToken = null;
  const puts = [];
  const toasts = [];
  let renders = 0;
  function renderLobbySummary() { renders += 1; }
  function toast(msg, type) { toasts.push({ msg, type }); }
  const document = { querySelectorAll: () => [] };
  function seatSleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
`;

function harness(path: string, responses: Array<() => { ok: boolean; status: number; body: unknown }>): SyncHarness {
  const source = read(path);
  const body = `${STATE}
    ${STUBS}
    globalThis.fetch = async (url, init) => {
      puts.push(JSON.parse(init.body));
      const next = responses.length > 1 ? responses.shift() : responses[0];
      const r = next();
      return { ok: r.ok, status: r.status, json: async () => r.body };
    };
    ${extractFunction(source, 'isSimultaneousLobby')}
    ${extractFunction(source, 'lobbyPlayerNames')}
    ${extractFunction(source, 'clampFirstSeat')}
    ${extractFunction(source, 'seatViewOf')}
    ${extractFunction(source, 'rebaseSeatOrder')}
    ${extractFunction(source, 'seatIntentOf')}
    ${extractFunction(source, 'adoptServerLobby')}
    ${extractFunction(source, 'syncSeatBase')}
    ${extractFunction(source, 'pushIntent')}
    ${extractFunction(source, 'scheduleSeatFlush')}
    ${extractFunction(source, 'retrySeatSync')}
    ${extractFunction(source, 'putSeatIntent')}
    ${extractFunction(source, 'flushSeatSync')}
    ${extractFunction(source, 'handleSeatOutcome')}
    ${extractFunction(source, 'rollbackSeatSync')}
    ${extractFunction(source, 'flashSeatReverted')}
    ${extractFunction(source, 'stopSeatSync')}
    return {
      setLobby(lobby) {
        latestLobby = lobby;
        // 无未确认意图：基线与乐观视图跟服务端对齐（真实流程由 renderLobbySummary 触发）。
        syncSeatBase(lobby);
      },
      setOrder(ids) {
        if (!seatDraft) seatDraft = [];
        const names = lobbyPlayerNames(latestLobby);
        seatDraft = ids.map(id => ({ id, name: names.get(id) || id }));
      },
      push() { pushIntent(latestLobby); },
      flushNow() { return flushSeatSync(); },
      advance(ms) { return new Promise(resolve => setTimeout(resolve, ms)); },
      puts,
      toasts,
      state() { return seatSync.state; },
      baseVersion() { return seatSync.baseVersion; },
      draftOrder() { return seatDraft ? seatDraft.map(row => row.id).join(',') : null; },
      renders() { return renders; },
      stopped() { return seatSync.stopped; },
    };
  `;
  return new Function('responses', body)(responses) as SyncHarness;
}

/** 3 人顺序模式大厅（seatVersion=3）。 */
function lobbyOf(ids: string[] = ['player_a', 'player_b', 'player_c'], seatVersion = 3) {
  return {
    phase: 'lobby',
    mapId: 'multiplayer-ring',
    mode: 'standard',
    seatMode: 'manual',
    seatVersion,
    firstSeat: 0,
    maxPlayers: 6,
    layoutSlots: [],
    players: ids.map(id => ({ id, name: id.slice(-1).toUpperCase() })),
    seats: ids.map((id, index) => ({ seat: index + 1, playerId: id, name: id.slice(-1).toUpperCase(), spawnSlotId: null })),
  };
}

describe('seat sync: single flight + coalescing (V6-1)', () => {
  for (const path of CLIENTS) {
    it(`collapses five clicks into at most two PUTs and keeps the last intent (${path})`, async () => {
      const ui = harness(path, [() => ({ ok: true, status: 200, body: { seatVersion: 4, lobby: lobbyOf() } })]);
      ui.setLobby(lobbyOf());
      const orders = [
        ['player_b', 'player_a', 'player_c'],
        ['player_b', 'player_c', 'player_a'],
        ['player_c', 'player_b', 'player_a'],
        ['player_c', 'player_a', 'player_b'],
        ['player_a', 'player_c', 'player_b'],
      ];
      // 连点 5 次：每次只改视图 + pushIntent，不等网络。
      for (const order of orders) {
        ui.setOrder(order);
        ui.push();
      }
      await ui.advance(200); // 越过 180ms 合并窗口 → 只发一次
      await ui.advance(60); // 让 in-flight 的 promise 收尾
      await ui.advance(200); // 若有补发，这次发出去
      expect(ui.puts.length).toBeLessThanOrEqual(2);
      const last = ui.puts[ui.puts.length - 1]!;
      expect(last.order).toEqual(['player_a', 'player_c', 'player_b']);
      expect(ui.state()).toBe('idle');
    });

    it(`carries ifVersion from seatVersion only (${path})`, async () => {
      const ui = harness(path, [() => ({ ok: true, status: 200, body: { seatVersion: 9, lobby: lobbyOf(undefined, 9) } })]);
      ui.setLobby(lobbyOf(undefined, 3));
      ui.setOrder(['player_b', 'player_a', 'player_c']);
      ui.push();
      await ui.advance(200);
      expect(ui.puts[0]!.ifVersion).toBe(3);
      // 成功后基线跟着响应走（不是 stateVersion）。
      expect(ui.baseVersion()).toBe(9);
    });
  }
});

describe('seat sync: 409 rebase (V6-2)', () => {
  for (const path of CLIENTS) {
    it(`rebases once onto the newest member list and resends (${path})`, async () => {
      const grown = lobbyOf(['player_a', 'player_b', 'player_c', 'player_d'], 5);
      const ui = harness(path, [
        () => ({
          ok: false,
          status: 409,
          body: { code: 'seat_conflict', seatVersion: 5, lobby: grown },
        }),
        () => ({ ok: true, status: 200, body: { seatVersion: 6, lobby: grown } }),
      ]);
      ui.setLobby(lobbyOf(undefined, 3));
      ui.setOrder(['player_c', 'player_a', 'player_b']);
      ui.push();
      await ui.advance(200); // 第一次 PUT → 409
      await ui.advance(60); // rebase 后立刻重发
      expect(ui.puts).toHaveLength(2);
      // 新成员追加到末尾，本地相对顺序保留。
      expect(ui.puts[1]!.order).toEqual(['player_c', 'player_a', 'player_b', 'player_d']);
      expect(ui.puts[1]!.ifVersion).toBe(5);
      expect(ui.baseVersion()).toBe(6);
      expect(ui.state()).toBe('idle');
    });

    it(`rolls back and warns after a second 409 (${path})`, async () => {
      const grown = lobbyOf(['player_a', 'player_b', 'player_c', 'player_d'], 5);
      const conflict = () => ({
        ok: false,
        status: 409,
        body: { code: 'seat_conflict', seatVersion: 5, lobby: grown },
      });
      const ui = harness(path, [conflict, conflict]);
      ui.setLobby(lobbyOf(undefined, 3));
      ui.setOrder(['player_c', 'player_a', 'player_b']);
      ui.push();
      await ui.advance(200);
      await ui.advance(60);
      expect(ui.puts).toHaveLength(2);
      expect(ui.state()).toBe('error');
      expect(ui.toasts.at(-1)!.msg).toBe('座位已被其他人改动，已同步最新');
      // 回滚后视图回到服务端值（乐观视图被清空）。
      expect(ui.draftOrder()).toBe(null);
    });
  }
});

describe('seat sync: failures (V6-3)', () => {
  for (const path of CLIENTS) {
    it(`retries 5xx twice with backoff then rolls back (${path})`, async () => {
      const ui = harness(path, [() => ({ ok: false, status: 500, body: {} })]);
      ui.setLobby(lobbyOf());
      ui.setOrder(['player_b', 'player_a', 'player_c']);
      ui.push();
      await ui.advance(200); // 第一次
      await ui.advance(420); // 400ms 退避 → 第二次
      await ui.advance(920); // 900ms 退避 → 第三次
      expect(ui.puts).toHaveLength(3); // 1 次 + 重试 2 次
      expect(ui.state()).toBe('error');
      expect(ui.toasts.at(-1)!.msg).toContain('座位同步失败');
      expect(ui.draftOrder()).toBe(null);
    });

    it(`does not retry a 400 and refreshes immediately (${path})`, async () => {
      const ui = harness(path, [() => ({ ok: false, status: 400, body: { code: 'invalid_seat_layout' } })]);
      ui.setLobby(lobbyOf());
      ui.setOrder(['player_b', 'player_a', 'player_c']);
      ui.push();
      await ui.advance(200);
      expect(ui.puts).toHaveLength(1);
      expect(ui.toasts.at(-1)!.msg).toBe('座位没同步成功：名单已变化，已刷新');
    });

    it(`stops syncing when the game already started (${path})`, async () => {
      const ui = harness(path, [() => ({ ok: false, status: 409, body: { code: 'game_already_started' } })]);
      ui.setLobby(lobbyOf());
      ui.setOrder(['player_b', 'player_a', 'player_c']);
      ui.push();
      await ui.advance(200);
      expect(ui.stopped()).toBe(true);
      expect(ui.toasts.at(-1)!.msg).toBe('对局已开始，座位已锁定');
      // 停机后不再发请求。
      ui.push();
      await ui.advance(500);
      expect(ui.puts).toHaveLength(1);
    });
  }
});
