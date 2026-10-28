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
  /** 点击「恢复随机」（内部会等 in-flight PUT 落地再发 DELETE）。 */
  reset(): Promise<void>;
  /** 直接复位停机门（新建 / 加入 / 恢复房间、进入对局前都走它）。 */
  start(): void;
  stop(message?: string | null): void;
  /** 拉一次大厅摘要（带 gameId 快照与 seatVersion 单调性守卫）。 */
  refresh(): Promise<unknown>;
  puts: Array<Record<string, unknown>>;
  calls: Array<{ method: string; url: string; body: unknown }>;
  toasts: Array<{ msg: string; type: string }>;
  state(): string;
  baseVersion(): number | null;
  draftOrder(): string | null;
  lobby(): { seatMode?: string; seatVersion?: number };
  seq(): number;
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
  const calls = [];
  const toasts = [];
  let renders = 0;
  let seatUndoPending = false;
  function renderLobbySummary(lobby) { renders += 1; if (lobby) latestLobby = lobby; }
  function toast(msg, type) { toasts.push({ msg, type }); }
  const document = { querySelectorAll: () => [] };
  const $ = () => null;
  function seatSleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
`;

interface SyncExtras {
  /** DELETE /host/seats 的响应队列（可带 delayMs 模拟在途）。 */
  deletes?: Array<() => { ok: boolean; status: number; body: unknown; delayMs?: number }>;
  /** GET /lobby 的响应队列（轮询版本单调性用例）。 */
  gets?: Array<() => { ok: boolean; status: number; body: unknown; delayMs?: number }>;
}

function harness(
  path: string,
  responses: Array<() => { ok: boolean; status: number; body: unknown }>,
  extras: SyncExtras = {},
): SyncHarness {
  const source = read(path);
  const body = `${STATE}
    ${STUBS}
    const deleteQueue = (__deletes || []).slice();
    const getQueue = (__gets || []).slice();
    globalThis.fetch = async (url, init = {}) => {
      const method = String(init.method || 'GET').toUpperCase();
      const payload = init.body ? JSON.parse(init.body) : null;
      calls.push({ method, url: String(url), body: payload });
      if (method === 'GET') {
        const next = getQueue.length > 1 ? getQueue.shift() : getQueue[0];
        const r = next ? next() : { ok: false, status: 404, body: {} };
        if (r.delayMs) await seatSleep(r.delayMs);
        return { ok: r.ok, status: r.status, json: async () => r.body };
      }
      if (method === 'DELETE') {
        const next = deleteQueue.length > 1 ? deleteQueue.shift() : deleteQueue[0];
        const r = next();
        if (r.delayMs) await seatSleep(r.delayMs);
        return { ok: r.ok, status: r.status, json: async () => r.body };
      }
      puts.push(payload);
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
    ${extractFunction(source, 'startSeatSync')}
    ${extractFunction(source, 'refreshLobbySummary')}
    ${extractFunction(source, 'isStaleSeatVersion')}
    ${extractFunction(source, 'dismissSeatUndo')}
    ${extractFunction(source, 'resetSeatOrder')}
    ${extractFunction(source, 'undoSeatReset')}
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
      reset() { return resetSeatOrder(); },
      start() { startSeatSync(); },
      stop(message = '已停止') { stopSeatSync(message); },
      refresh() { return refreshLobbySummary(); },
      advance(ms) { return new Promise(resolve => setTimeout(resolve, ms)); },
      puts,
      calls,
      toasts,
      state() { return seatSync.state; },
      baseVersion() { return seatSync.baseVersion; },
      draftOrder() { return seatDraft ? seatDraft.map(row => row.id).join(',') : null; },
      lobby() { return latestLobby || {}; },
      seq() { return seatSync.seq; },
      renders() { return renders; },
      stopped() { return seatSync.stopped; },
    };
  `;
  return new Function('responses', '__deletes', '__gets', body)(
    responses,
    extras.deletes ?? [],
    extras.gets ?? [],
  ) as SyncHarness;
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

describe('seat sync: 恢复随机 clears queued intents (#19)', () => {
  for (const path of CLIENTS) {
    it(`cancels a debounced PUT when 恢复随机 follows within the window (${path})`, async () => {
      const ui = harness(
        path,
        [() => ({ ok: true, status: 200, body: { seatVersion: 4, lobby: lobbyOf() } })],
        {
          deletes: [() => ({
            ok: true,
            status: 200,
            body: { seatVersion: 5, lobby: { ...lobbyOf(), seatMode: 'random', seatVersion: 5 } },
          })],
        },
      );
      ui.setLobby(lobbyOf());
      // 点 ▲ 后（180ms 合并窗口内）马上点「恢复随机」。
      ui.setOrder(['player_b', 'player_a', 'player_c']);
      ui.push();
      await ui.reset();

      // 只有 DELETE 发出，之后没有任何 PUT（旧意图被作废，不能把座位又重建出来）。
      expect(ui.puts).toHaveLength(0);
      expect(ui.calls.filter(call => call.method === 'DELETE')).toHaveLength(1);
      await ui.advance(400);
      expect(ui.calls.filter(call => call.method === 'PUT')).toHaveLength(0);
      expect(ui.lobby().seatMode).toBe('random');
      expect(ui.baseVersion()).toBe(5);
      // 撤销入口挂着，但新意图会摘掉它（这里只验证状态机没有把旧意图留在队列里）。
      expect(ui.state()).toBe('idle');
    });

    it(`waits for an in-flight PUT before deleting (${path})`, async () => {
      const deleteLobby = { ...lobbyOf(), seatMode: 'random', seatVersion: 6 };
      const ui = harness(
        path,
        [() => ({ ok: true, status: 200, body: { seatVersion: 4, lobby: lobbyOf() } })],
        { deletes: [() => ({ ok: true, status: 200, body: { seatVersion: 6, lobby: deleteLobby } })] },
      );
      ui.setLobby(lobbyOf());
      ui.setOrder(['player_b', 'player_a', 'player_c']);
      ui.push();
      // 越过合并窗口 → PUT 已经在飞（桩是同步 resolve，但 reset 仍要先等 inFlight 落下）。
      await ui.advance(200);
      await ui.reset();
      await ui.advance(60);
      const methods = ui.calls.map(call => call.method);
      expect(methods.filter(method => method === 'DELETE')).toHaveLength(1);
      // 之后没有补发的 PUT（desired 已清空）。
      expect(methods.filter(method => method === 'PUT')).toHaveLength(1);
      expect(ui.baseVersion()).toBe(6);
    });
  }
});

describe('seat sync: stop is not a one-way gate (#20)', () => {
  for (const path of CLIENTS) {
    it(`startSeatSync clears the whole sync state (${path})`, async () => {
      const ui = harness(path, [() => ({ ok: true, status: 200, body: { seatVersion: 4, lobby: lobbyOf() } })]);
      ui.setLobby(lobbyOf());
      ui.setOrder(['player_b', 'player_a', 'player_c']);
      ui.push();
      ui.stop('对局已开始，座位已锁定');
      expect(ui.stopped()).toBe(true);

      // 新房间 / 新对局前复位：停机门、意图、状态、基线全部清空。
      ui.start();
      expect(ui.stopped()).toBe(false);
      expect(ui.state()).toBe('idle');
      expect(ui.draftOrder()).toBe(null);

      // 复位后还能正常同步。
      ui.setLobby(lobbyOf());
      ui.setOrder(['player_c', 'player_b', 'player_a']);
      ui.push();
      await ui.advance(200);
      expect(ui.puts).toHaveLength(1);
      expect(ui.state()).toBe('idle');
    });
  }
});

describe('lobby polling: version monotonicity + room identity (#24)', () => {
  for (const path of CLIENTS) {
    it(`drops a lobby response whose seatVersion went backwards (${path})`, async () => {
      const ui = harness(
        path,
        [() => ({ ok: true, status: 200, body: { seatVersion: 4, lobby: lobbyOf(undefined, 4) } })],
        {
          gets: [
            // 先喂一条更旧的响应（v3），基线是 v4：整条丢弃，视图不回退。
            () => ({ ok: true, status: 200, body: { gameId: 'g1', seatVersion: 3, ...lobbyOf(undefined, 3) } }),
            () => ({ ok: true, status: 200, body: { gameId: 'g1', seatVersion: 5, ...lobbyOf(undefined, 5) } }),
          ],
        },
      );
      ui.setLobby(lobbyOf(undefined, 3));
      ui.setOrder(['player_b', 'player_a', 'player_c']);
      ui.push();
      await ui.advance(200);
      expect(ui.baseVersion()).toBe(4);

      // v3 的轮询响应：丢弃（否则会把已提交的顺序回退）。
      const dropped = await ui.refresh();
      expect(dropped).toBe(null);
      expect(ui.baseVersion()).toBe(4);
      // 视图没被旧响应拉回 v3（latestLobby 仍是同步成功后的那份）。
      expect(ui.lobby().seatVersion).toBe(4);

      // v5 的响应正常吸收。
      const applied = await ui.refresh();
      expect(applied).not.toBe(null);
    });

    it(`drops a response that belongs to another room (${path})`, async () => {
      const ui = harness(
        path,
        [],
        {
          gets: [
            () => ({ ok: true, status: 200, body: { gameId: 'other-room', seatVersion: 9, ...lobbyOf(undefined, 9) } }),
          ],
        },
      );
      ui.setLobby(lobbyOf(undefined, 3));
      const rendered = ui.renders();
      const dropped = await ui.refresh();
      expect(dropped).toBe(null);
      // 旧房间的响应不会渲染到新房间卡片上。
      expect(ui.renders()).toBe(rendered);
      expect(ui.lobby().seatVersion).toBe(3);
    });
  }
});


describe('seat sync lifecycle wiring (#20 / #24)', () => {
  for (const path of CLIENTS) {
    it(`resets the stop gate at every room entry and before entering a game (${path})`, () => {
      const source = read(path);
      expect(source, `${path} 缺 startSeatSync`).toContain('function startSeatSync()');
      // 建房 / 加入 / 恢复房间 / enterGame 各一处：4 个复位调用点。
      expect((source.match(/startSeatSync\(\);/g) ?? []).length, path).toBeGreaterThanOrEqual(4);

      // enterGame 必须复位座位同步状态；且不允许再用「先 stopSeatSync(null) 再立刻复位」
      // 这种自相矛盾的写法（净效果并没有停机，注释会误导读者）。
      expect(source, `${path} enterGame 未复位座位同步`)
        .toMatch(/async function enterGame\(\)[\s\S]{0,600}?startSeatSync\(\);/);
      expect(source, `${path} enterGame 仍在调用 stopSeatSync(null)`).not.toContain('stopSeatSync(null);');

      // stopped 是可复位的闸门而不是单向门：唯一复位入口必须写回 false。
      expect(source, `${path} startSeatSync 没复位 stopped`)
        .toMatch(/function startSeatSync\(\)\s*\{[\s\S]{0,400}?seatSync\.stopped = false;/);
      // 但「对局已开始」这条路仍要设闸门（handleSeatOutcome 的 started 分支）。
      expect(source, `${path} 缺对局已开始时的停机分支`)
        .toContain("stopSeatSync('对局已开始，座位已锁定')");
      // 座位同步只在大厅期发请求。
      expect(source, `${path} pushIntent 缺大厅期门槛`).toContain("if (lobby?.phase !== 'lobby') return;");
    });

    it(`stops the old room polling and guards stale responses (${path})`, () => {
      const source = read(path);
      expect(source, `${path} 缺座位版本单调性守卫`).toContain('function isStaleSeatVersion(');
      expect(source, `${path} 轮询没快照 gameId`)
        .toContain('const requestGameId = gameId;');
      expect(source, `${path} 响应没校验 gameId`)
        .toContain('data.gameId !== requestGameId');
      // 建房 / 加入前先停掉旧房间的轮询。
      expect(source, `${path} btnCreate 前没停轮询`)
        .toMatch(/els\.btnCreate\.addEventListener\('click'[\s\S]{0,200}stopLobbyPolling\(\)/);
      expect(source, `${path} btnJoin 前没停轮询`)
        .toMatch(/els\.btnJoin\.addEventListener\('click'[\s\S]{0,260}stopLobbyPolling\(\)/);
    });
  }
});

