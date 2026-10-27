import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestServer } from '../helpers.js';
import { globalStore } from '../../src/state/store.js';
import type { PlayerId } from '../../src/types.js';

interface SeatSummary {
  seat: number;
  playerId: PlayerId;
  name: string;
  spawnSlotId: string | null;
}

interface LobbyBody {
  phase: string;
  seatMode: 'random' | 'manual';
  seatVersion: number;
  firstSeat: number;
  seats: SeatSummary[];
  players: Array<{ id: PlayerId; name: string }>;
  /** 当前人数在本图上的候选出生位 id 顺序（R2 草稿预览用）。 */
  layoutSlots: string[];
}

describe('host seat assignment', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    for (const id of globalStore.list()) globalStore.delete(id);
    if (app) await app.close();
  });

  /** 建 3 人房（房主不参战），再让 A/B/C 依次加入。 */
  async function lobby3(
    mapId = 'multiplayer-ring',
    maxPlayers = 3,
  ): Promise<{ gameId: string; hostToken: string; tokens: Record<string, string> }> {
    const created = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mapId, maxPlayers, participate: false },
    });
    expect(created.statusCode).toBe(200);
    const { gameId, hostToken } = created.json() as { gameId: string; hostToken: string };
    const tokens: Record<string, string> = {};
    for (const name of ['A', 'B', 'C']) {
      const joined = await app.inject({ method: 'POST', url: `/api/games/${gameId}/join`, payload: { name } });
      expect(joined.statusCode).toBe(200);
      const player = joined.json().player as { id: PlayerId; token: string };
      tokens[player.id] = player.token;
    }
    return { gameId, hostToken, tokens };
  }

  async function getLobby(gameId: string): Promise<LobbyBody> {
    const res = await app.inject({ method: 'GET', url: `/api/games/${gameId}/lobby` });
    expect(res.statusCode).toBe(200);
    return res.json() as LobbyBody;
  }

  function putSeats(gameId: string, hostToken: string, payload: Record<string, unknown>) {
    return app.inject({
      method: 'PUT',
      url: `/api/games/${gameId}/host/seats`,
      headers: { 'X-Host-Token': hostToken },
      payload,
    });
  }

  it('reports random seats in the lobby before anything is arranged', async () => {
    app = await startTestServer();
    const { gameId } = await lobby3();
    const lobby = await getLobby(gameId);
    const slots = globalStore.get(gameId)!.config.layouts['3'];

    expect(lobby.seatMode).toBe('random');
    // 成员加入也推进座位版本（与 stateVersion 相互独立）：3 人陆续加入 = 从 0 递增到 3。
    expect(lobby.seatVersion).toBe(3);
    expect(lobby.seats).toHaveLength(3);
    expect(lobby.seats.map(seat => seat.seat)).toEqual([1, 2, 3]);
    // 未编排时出生点还没定，不能把开局才随机出来的结果当成既成事实。
    expect(lobby.seats.map(seat => seat.spawnSlotId)).toEqual([null, null, null]);
    // R2：候选出生位顺序始终给出（前端草稿预览按 layoutSlots[i] + slot.id 匹配）；
    // 它是 layouts['3'] = [slot_1, slot_3, slot_5] 这种跳位子集，不是 spawnSlots 的前 3 个。
    expect(lobby.layoutSlots).toEqual(slots);
    expect(lobby.layoutSlots).toEqual(['slot_1', 'slot_3', 'slot_5']);
  });

  it('stores the host seat order and pairs seats with spawn slots', async () => {
    app = await startTestServer();
    const { gameId, hostToken } = await lobby3();
    const game = globalStore.get(gameId)!;
    const slots = game.config.layouts['3'];
    const before = (await getLobby(gameId)).seatVersion;

    const saved = await putSeats(gameId, hostToken, { order: ['player_c', 'player_a', 'player_b'], firstSeat: 0 });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().seatVersion).toBe(before + 1);

    const lobby = await getLobby(gameId);
    expect(lobby.seatMode).toBe('manual');
    expect(lobby.seatVersion).toBe(before + 1);
    expect(lobby.firstSeat).toBe(0);
    expect(lobby.seats.map(seat => seat.playerId)).toEqual(['player_c', 'player_a', 'player_b']);
    expect(lobby.seats.map(seat => seat.spawnSlotId)).toEqual(slots);
    // manual 态的座位→出生位映射与 layoutSlots 同源（R2 前端直接用来叠地图标记）。
    expect(lobby.layoutSlots).toEqual(slots);
  });

  it('applies the arranged seats when the game starts', async () => {
    app = await startTestServer();
    const { gameId, hostToken } = await lobby3();
    const slots = globalStore.get(gameId)!.config.layouts['3'];
    await putSeats(gameId, hostToken, { order: ['player_c', 'player_a', 'player_b'], firstSeat: 0 });

    const started = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/start`, headers: { 'X-Host-Token': hostToken },
    });
    expect(started.statusCode).toBe(200);

    const game = globalStore.get(gameId)!;
    expect(game.players.player_c!.spawnSlotId).toBe(slots[0]);
    expect(game.players.player_a!.spawnSlotId).toBe(slots[1]);
    expect(game.turn.turnOrder).toEqual(['player_c', 'player_a', 'player_b']);
    expect(game.turn.currentPlayerId).toBe('player_c');
    const startEvent = game.events.find(event => event.type === 'game_start')!;
    expect((startEvent.payload as { turnOrder: PlayerId[] }).turnOrder).toEqual(['player_c', 'player_a', 'player_b']);
  });

  it('rotates the turn order with firstSeat while keeping the spawn pairing', async () => {
    app = await startTestServer();
    const { gameId, hostToken } = await lobby3();
    const slots = globalStore.get(gameId)!.config.layouts['3'];
    await putSeats(gameId, hostToken, { order: ['player_c', 'player_a', 'player_b'], firstSeat: 2 });

    await app.inject({ method: 'POST', url: `/api/games/${gameId}/start`, headers: { 'X-Host-Token': hostToken } });
    const game = globalStore.get(gameId)!;
    expect(game.players.player_c!.spawnSlotId).toBe(slots[0]);
    expect(game.turn.turnOrder).toEqual(['player_b', 'player_c', 'player_a']);
    expect(game.turn.currentPlayerId).toBe('player_b');
  });

  it('falls back to the random path after the host cancels the arrangement', async () => {
    app = await startTestServer();
    const { gameId, hostToken } = await lobby3();
    const saved = await putSeats(gameId, hostToken, { order: ['player_c', 'player_a', 'player_b'], firstSeat: 1 });
    expect(saved.statusCode).toBe(200);

    const cleared = await app.inject({
      method: 'DELETE', url: `/api/games/${gameId}/host/seats`, headers: { 'X-Host-Token': hostToken },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().seatVersion).toBe(saved.json().seatVersion + 1);

    const lobby = await getLobby(gameId);
    expect(lobby.seatMode).toBe('random');
    expect(globalStore.get(gameId)!.seatPlan).toBeNull();

    await app.inject({ method: 'POST', url: `/api/games/${gameId}/start`, headers: { 'X-Host-Token': hostToken } });
    expect(globalStore.get(gameId)!.turn.turnOrder).toHaveLength(3);
  });

  it('rejects seat orders that are not a permutation of the joined players', async () => {
    app = await startTestServer();
    const { gameId, hostToken } = await lobby3();

    const cases: Array<Record<string, unknown>> = [
      { order: ['player_a', 'player_b', 'player_d'] },        // 陌生人
      { order: ['player_a', 'player_a', 'player_b'] },        // 重复
      { order: ['player_a', 'player_b'] },                    // 缺人
      { order: ['player_a', 'player_b', 'player_c', 'player_d'] }, // 长度超出
      { order: 'player_a' },                                  // 非数组
      { order: [1, 2, 3] },                                   // 元素非字符串
      {},
    ];
    const versionBefore = (await getLobby(gameId)).seatVersion;
    for (const payload of cases) {
      const res = await putSeats(gameId, hostToken, payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json().code).toBe('invalid_seat_layout');
    }
    // 非法载荷不写状态、不推进版本。
    expect(globalStore.get(gameId)!.seatPlan ?? null).toBeNull();
    expect(globalStore.get(gameId)!.seatVersion).toBe(versionBefore);
  });

  it('rejects out-of-range or non-integer firstSeat values', async () => {
    app = await startTestServer();
    const { gameId, hostToken } = await lobby3();
    const order = ['player_a', 'player_b', 'player_c'];
    for (const firstSeat of [-1, 3, 1.5, '1', null]) {
      const res = await putSeats(gameId, hostToken, { order, firstSeat });
      expect(res.statusCode, String(firstSeat)).toBe(400);
      expect(res.json().code).toBe('invalid_seat_layout');
    }
    expect(globalStore.get(gameId)!.seatPlan ?? null).toBeNull();
  });

  it('only accepts the host token', async () => {
    app = await startTestServer();
    const { gameId, tokens } = await lobby3();
    const order = ['player_c', 'player_a', 'player_b'];

    const anonymous = await app.inject({
      method: 'PUT', url: `/api/games/${gameId}/host/seats`, payload: { order },
    });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json().code).toBe('invalid_host_token');

    const asPlayer = await app.inject({
      method: 'PUT',
      url: `/api/games/${gameId}/host/seats`,
      headers: { 'X-Player-Token': tokens.player_a },
      payload: { order },
    });
    expect(asPlayer.statusCode).toBe(401);
    expect(globalStore.get(gameId)!.seatPlan ?? null).toBeNull();
  });

  it('locks the seats once the game has started', async () => {
    app = await startTestServer();
    const { gameId, hostToken } = await lobby3();
    await app.inject({ method: 'POST', url: `/api/games/${gameId}/start`, headers: { 'X-Host-Token': hostToken } });
    const before = globalStore.get(gameId)!;

    const res = await putSeats(gameId, hostToken, { order: ['player_c', 'player_a', 'player_b'] });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('game_already_started');

    const cleared = await app.inject({
      method: 'DELETE', url: `/api/games/${gameId}/host/seats`, headers: { 'X-Host-Token': hostToken },
    });
    expect(cleared.statusCode).toBe(409);
    expect(globalStore.get(gameId)!.seatPlan ?? null).toBeNull();
    expect(before.turn.turnOrder).toEqual(globalStore.get(gameId)!.turn.turnOrder);
  });

  it('reports seat_conflict and keeps the first writer when ifVersion is stale', async () => {
    app = await startTestServer();
    const { gameId, hostToken } = await lobby3();
    // 两个标签页都读到同一个 seatVersion；第一个先提交。
    const stale = (await getLobby(gameId)).seatVersion;
    const first = await putSeats(gameId, hostToken, {
      order: ['player_c', 'player_a', 'player_b'], firstSeat: 0, ifVersion: stale,
    });
    expect(first.statusCode).toBe(200);

    const second = await putSeats(gameId, hostToken, {
      order: ['player_b', 'player_a', 'player_c'], firstSeat: 0, ifVersion: stale,
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('seat_conflict');
    expect(second.json().seatVersion).toBe(stale + 1);
    // 冲突响应直接带最新座位表，前端重绘无需再查。
    expect((second.json().lobby as LobbyBody).seats.map(seat => seat.playerId))
      .toEqual(['player_c', 'player_a', 'player_b']);
    expect(globalStore.get(gameId)!.seatPlan!.order).toEqual(['player_c', 'player_a', 'player_b']);
  });

  it('reports seat_conflict before payload validation when a stale payload follows a join', async () => {
    app = await startTestServer();
    // 6 人房：先 3 人，再让第 4 人加入，模拟「陈旧标签页 + 成员数已变」。
    const { gameId, hostToken } = await lobby3('multiplayer-ring', 6);
    const stale = (await getLobby(gameId)).seatVersion;
    const joined = await app.inject({ method: 'POST', url: `/api/games/${gameId}/join`, payload: { name: 'D' } });
    expect(joined.statusCode).toBe(200);
    expect((await getLobby(gameId)).seatVersion).toBe(stale + 1);

    const res = await putSeats(gameId, hostToken, {
      order: ['player_c', 'player_a', 'player_b'], firstSeat: 0, ifVersion: stale,
    });
    // 版本校验先于载荷校验：陈旧 order 长度已不是当前成员的排列，但用户该看到的是「有人进出」而非「载荷非法」。
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('seat_conflict');
    expect(res.json().seatVersion).toBe(stale + 1);
    expect((res.json().lobby as LobbyBody).seats).toHaveLength(4);
    // 冲突不落库：座位表仍是未编排。
    expect(globalStore.get(gameId)!.seatPlan ?? null).toBeNull();
  });

  it('is idempotent for replayed payloads but always bumps the version', async () => {
    app = await startTestServer();
    const { gameId, hostToken } = await lobby3();
    const before = (await getLobby(gameId)).seatVersion;
    for (let i = 0; i < 3; i += 1) {
      const res = await putSeats(gameId, hostToken, { order: ['player_b', 'player_c', 'player_a'] });
      expect(res.statusCode).toBe(200);
      expect(res.json().seatVersion).toBe(before + i + 1);
    }
    const lobby = await getLobby(gameId);
    expect(lobby.seats.map(seat => seat.playerId)).toEqual(['player_b', 'player_c', 'player_a']);
  });

  it('appends late joiners and shifts seats after a kick', async () => {
    app = await startTestServer();
    const created = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mapId: 'multiplayer-ring', maxPlayers: 3, participate: false },
    });
    const { gameId, hostToken } = created.json() as { gameId: string; hostToken: string };
    for (const name of ['A', 'B']) {
      await app.inject({ method: 'POST', url: `/api/games/${gameId}/join`, payload: { name } });
    }
    await putSeats(gameId, hostToken, { order: ['player_b', 'player_a'], firstSeat: 1 });
    const versionAfterSave = globalStore.get(gameId)!.seatVersion!;

    const third = await app.inject({ method: 'POST', url: `/api/games/${gameId}/join`, payload: { name: 'C' } });
    expect(third.statusCode).toBe(200);
    expect((third.json().lobby as LobbyBody).seats.map(seat => seat.playerId))
      .toEqual(['player_b', 'player_a', 'player_c']);
    const versionAfterJoin = globalStore.get(gameId)!.seatVersion!;
    expect(versionAfterJoin).toBeGreaterThan(versionAfterSave);

    const kicked = await app.inject({
      method: 'DELETE', url: `/api/games/${gameId}/players/player_b`, headers: { 'X-Host-Token': hostToken },
    });
    expect(kicked.statusCode).toBe(200);
    const lobby = await getLobby(gameId);
    expect(lobby.seats.map(seat => seat.playerId)).toEqual(['player_a', 'player_c']);
    // 被踢的是原先手（座位 2），剩下的座位前移后先手仍是 player_a。
    expect(lobby.firstSeat).toBe(0);
    expect(globalStore.get(gameId)!.seatVersion!).toBeGreaterThan(versionAfterJoin);
  });

  it('bumps stateVersion so conditional GETs never serve a stale ETag', async () => {
    app = await startTestServer();
    const { gameId, hostToken, tokens } = await lobby3();
    const first = await app.inject({
      method: 'GET', url: `/api/games/${gameId}`, headers: { 'X-Player-Token': tokens.player_a },
    });
    expect(first.statusCode).toBe(200);
    const etagBefore = first.headers.etag;

    await putSeats(gameId, hostToken, { order: ['player_c', 'player_a', 'player_b'] });

    const second = await app.inject({
      method: 'GET', url: `/api/games/${gameId}`, headers: { 'X-Player-Token': tokens.player_a },
    });
    expect(second.statusCode).toBe(200);
    expect(second.headers.etag).not.toBe(etagBefore);
  });

  it('returns a fresh 200 (not 304) after a member joins', async () => {
    app = await startTestServer();
    // maxPlayers=6 的房间先坐 3 人，留出加入空间。
    const { gameId, tokens } = await lobby3('multiplayer-ring', 6);
    const first = await app.inject({
      method: 'GET', url: `/api/games/${gameId}`, headers: { 'X-Player-Token': tokens.player_a },
    });
    expect(first.statusCode).toBe(200);

    // 成员变动走 player_joined 事件，appendEvent 会推进 stateVersion（src/engine/events.ts:32），
    // 因此拿旧 ETag 再请求必须是 200 且看到新玩家——防「事件驱动的版本推进被误删」这类回归。
    const joined = await app.inject({ method: 'POST', url: `/api/games/${gameId}/join`, payload: { name: 'D' } });
    expect(joined.statusCode).toBe(200);

    const second = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}`,
      headers: { 'X-Player-Token': tokens.player_a, 'If-None-Match': first.headers.etag },
    });
    expect(second.statusCode).toBe(200);
    expect(second.headers.etag).not.toBe(first.headers.etag);
    expect(Object.keys((second.json() as { players: Record<string, unknown> }).players)).toContain('player_d');
  });

  it('never blocks the start when the stored seat plan is corrupt', async () => {
    app = await startTestServer();
    const { gameId, hostToken } = await lobby3();
    const game = globalStore.get(gameId)!;
    // 绕过接口直接写脏座位表，模拟旧存档 / 手工改档。
    game.seatPlan = { order: ['player_c', 'player_a'] as PlayerId[], firstSeat: 0 };

    const started = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/start`, headers: { 'X-Host-Token': hostToken },
    });
    expect(started.statusCode).toBe(200);
    expect(game.seatPlan).toBeNull();
    expect(game.turn.turnOrder).toHaveLength(3);
  });

  it('keeps the arranged order as the tie-break order in simultaneous mode', async () => {
    app = await startTestServer();
    const { gameId, hostToken } = await lobby3('standoff');
    const slots = globalStore.get(gameId)!.config.layouts['3'];
    // 同时回合没有先手：firstSeat 归一化为 0，座位序 = 出生点 + 结算处理顺序（不旋转）。
    const saved = await putSeats(gameId, hostToken, { order: ['player_c', 'player_a', 'player_b'], firstSeat: 1 });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().firstSeat).toBe(0);

    await app.inject({ method: 'POST', url: `/api/games/${gameId}/start`, headers: { 'X-Host-Token': hostToken } });
    const game = globalStore.get(gameId)!;
    expect(game.turn.currentPlayerId).toBeNull();
    expect(game.turn.turnOrder).toEqual(['player_c', 'player_a', 'player_b']);
    // 出生点按座位号配对，结算处理顺序与座位序一致。
    expect(game.players.player_c!.spawnSlotId).toBe(slots[0]);
    expect(game.players.player_c!.turnOrder).toBe(0);
  });

  it('binds spawn control points to the arranged seats in annihilation mode', async () => {
    app = await startTestServer();
    const { gameId, hostToken } = await lobby3('artillery-zone');
    const config = globalStore.get(gameId)!.config;
    const slots = config.layouts['3'];
    const saved = await putSeats(gameId, hostToken, { order: ['player_b', 'player_c', 'player_a'], firstSeat: 0 });
    expect(saved.statusCode).toBe(200);

    await app.inject({ method: 'POST', url: `/api/games/${gameId}/start`, headers: { 'X-Host-Token': hostToken } });
    const game = globalStore.get(gameId)!;
    expect(game.headquarters).toEqual({});
    const ownedBySeat = slots.map((slotId, index) => {
      const slot = config.spawnSlots.find(candidate => candidate.id === slotId)!;
      return game.controlPoints.find(point => point.id === slot.controlPointId)!.owner;
    });
    expect(ownedBySeat).toEqual(['player_b', 'player_c', 'player_a']);
  });

  it('accepts a seat plan for a player count the map cannot start', async () => {
    app = await startTestServer();
    // multiplayer-ring 只支持 2/3/6 人：4 人时座位可保存但没有出生点映射，开局由既有校验拦下。
    const created = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mapId: 'multiplayer-ring', maxPlayers: 6, participate: false },
    });
    const { gameId, hostToken } = created.json() as { gameId: string; hostToken: string };
    for (const name of ['A', 'B', 'C', 'D']) {
      await app.inject({ method: 'POST', url: `/api/games/${gameId}/join`, payload: { name } });
    }

    const saved = await putSeats(gameId, hostToken, { order: ['player_d', 'player_c', 'player_b', 'player_a'] });
    expect(saved.statusCode).toBe(200);
    const lobby = saved.json().lobby as LobbyBody;
    expect(lobby.seatMode).toBe('manual');
    expect(lobby.seats.map(seat => seat.spawnSlotId)).toEqual([null, null, null, null]);
    // 该人数没有 layouts 条目：layoutSlots 为空数组，前端因此不会在地图上乱标座位。
    expect(lobby.layoutSlots).toEqual([]);

    const started = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/start`, headers: { 'X-Host-Token': hostToken },
    });
    expect(started.statusCode).toBe(400);
    expect(started.json().code).toBe('unsupported_player_count');
  });

  it('arranges seats on a generated random map', async () => {
    app = await startTestServer();
    const created = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mapId: 'random', maxPlayers: 3, participate: false, random: { seed: 'seat-plan-random' } },
    });
    expect(created.statusCode).toBe(200);
    const { gameId, hostToken } = created.json() as { gameId: string; hostToken: string };
    for (const name of ['A', 'B', 'C']) {
      await app.inject({ method: 'POST', url: `/api/games/${gameId}/join`, payload: { name } });
    }
    const slots = globalStore.get(gameId)!.config.layouts['3'];
    const saved = await putSeats(gameId, hostToken, { order: ['player_b', 'player_c', 'player_a'], firstSeat: 2 });
    expect(saved.statusCode).toBe(200);
    expect((saved.json().lobby as LobbyBody).seats.map(seat => seat.spawnSlotId)).toEqual(slots);

    const started = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/start`, headers: { 'X-Host-Token': hostToken },
    });
    expect(started.statusCode).toBe(200);
    const game = globalStore.get(gameId)!;
    expect(game.turn.turnOrder).toEqual(['player_a', 'player_b', 'player_c']);
    expect(game.players.player_b!.spawnSlotId).toBe(slots[0]);
  });

  it('has nothing to arrange while the room is empty', async () => {
    app = await startTestServer();
    const created = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mapId: 'multiplayer-ring', maxPlayers: 3, participate: false },
    });
    const { gameId, hostToken } = created.json() as { gameId: string; hostToken: string };

    const lobby = await getLobby(gameId);
    expect(lobby.seats).toEqual([]);
    expect(lobby.seatMode).toBe('random');
    // 0 人房没有候选出生位（layoutSlots 为空），前端地图不叠任何座位标记。
    expect(lobby.layoutSlots).toEqual([]);

    // 空房不做预排、不占位：任何座位表（含空数组）都拒绝，且必须是显式早判，
    // 不能落到「先手座位号越界」（那是参数问题，会误导排查）。
    for (const payload of [{ order: [] }, { order: ['player_a'] }]) {
      const res = await putSeats(gameId, hostToken, payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json().code).toBe('invalid_seat_layout');
      expect(res.json().error, JSON.stringify(payload)).toBe('当前没有已加入玩家，无法编排座位');
    }
  });
});

/**
 * 同时回合 / 大逃杀没有「先手」：座位序 = 出生点 + 同一步内的结算处理顺序。
 * 服务端口径：PUT 忽略传入的 firstSeat、一律存 0 并回 0（不报 400），lobbySummary 恒 0，
 * 开局 turnOrder 严格等于 order、currentPlayerId 为 null。
 */
describe('host seat assignment in simultaneous / royale rooms', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    for (const id of globalStore.list()) globalStore.delete(id);
    if (app) await app.close();
  });

  async function lobby2(mapId: string): Promise<{ gameId: string; hostToken: string }> {
    const created = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mapId, maxPlayers: 2, participate: false },
    });
    expect(created.statusCode, mapId).toBe(200);
    const { gameId, hostToken } = created.json() as { gameId: string; hostToken: string };
    for (const name of ['A', 'B']) {
      const joined = await app.inject({ method: 'POST', url: `/api/games/${gameId}/join`, payload: { name } });
      expect(joined.statusCode).toBe(200);
    }
    return { gameId, hostToken };
  }

  for (const mapId of ['standoff', 'snowflake']) {
    it(`normalizes firstSeat to 0 and keeps turnOrder === order (${mapId})`, async () => {
      app = await startTestServer();
      const { gameId, hostToken } = await lobby2(mapId);
      const game = globalStore.get(gameId)!;
      expect(game.config.mode, `${mapId} 应是同时回合系模式`).toMatch(/simultaneous|royale/);
      const versionBefore = (await app.inject({ method: 'GET', url: `/api/games/${gameId}/lobby` })).json().seatVersion;

      const saved = await app.inject({
        method: 'PUT',
        url: `/api/games/${gameId}/host/seats`,
        headers: { 'X-Host-Token': hostToken },
        payload: { order: ['player_b', 'player_a'], firstSeat: 1 },
      });
      // 不报 400：firstSeat 对顺序模式合法，只是在同时模式不适用，归一化即可。
      expect(saved.statusCode).toBe(200);
      const body = saved.json() as { seatVersion: number; firstSeat: number; lobby: LobbyBody };
      expect(body.firstSeat).toBe(0);
      expect(body.seatVersion).toBe(versionBefore + 1);
      expect(body.lobby.firstSeat).toBe(0);
      expect(body.lobby.seats.map(seat => seat.playerId)).toEqual(['player_b', 'player_a']);
      // 落库也必须是 0，不能「接受但留着」。
      expect(globalStore.get(gameId)!.seatPlan!.firstSeat).toBe(0);

      const started = await app.inject({
        method: 'POST', url: `/api/games/${gameId}/start`, headers: { 'X-Host-Token': hostToken },
      });
      expect(started.statusCode).toBe(200);
      const active = globalStore.get(gameId)!;
      // 座位序即出生点 + 结算处理顺序：不旋转。
      expect(active.turn.turnOrder).toEqual(['player_b', 'player_a']);
      expect(active.turn.currentPlayerId).toBeNull();
      expect(active.players.player_b!.turnOrder).toBe(0);
      expect(active.players.player_a!.turnOrder).toBe(1);
      expect(active.players.player_b!.spawnSlotId).toBe(active.config.layouts['2']![0]);
    });
  }

  it('still rejects an out-of-range firstSeat in standard rooms', async () => {
    app = await startTestServer();
    const created = await app.inject({
      method: 'POST', url: '/api/games', payload: { mapId: 'multiplayer-ring', maxPlayers: 2, participate: false },
    });
    const { gameId, hostToken } = created.json() as { gameId: string; hostToken: string };
    for (const name of ['A', 'B']) {
      await app.inject({ method: 'POST', url: `/api/games/${gameId}/join`, payload: { name } });
    }
    // 顺序模式行为逐字不变：越界仍然 400。
    const res = await app.inject({
      method: 'PUT',
      url: `/api/games/${gameId}/host/seats`,
      headers: { 'X-Host-Token': hostToken },
      payload: { order: ['player_a', 'player_b'], firstSeat: 2 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('invalid_seat_layout');
  });
});
