// tests/api/fog-projection.test.ts
// 迷雾 API 保密投影：玩家 A 看不到 B 的隐藏单位/事件/裁决分项；匿名只有公开视角；
// 观战令牌全量；ETag 按观者区分且 304 不串；非迷雾模式响应保持原样。
import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createGameAndJoin, startTestServer } from '../helpers.js';
import { globalStore } from '../../src/state/store.js';
import { appendEvent } from '../../src/engine/events.js';
import { globalEventBus } from '../../src/events/bus.js';
import {
  createFogGame, fetchFogState, installFogMap, restoreMaps,
} from './fog-fixtures.js';

beforeAll(() => installFogMap());
afterAll(() => restoreMaps());

let app: FastifyInstance;

afterEach(async () => {
  for (const id of globalStore.list()) await globalStore.delete(id);
  if (app) await app.close();
});

async function gameWithFog(players = 2) {
  app = await startTestServer();
  return createFogGame(app, players);
}

describe('fog state projection', () => {
  it('player A never sees hidden B units, unit ids or coordinates', async () => {
    const { gameId, seats } = await gameWithFog();
    const game = globalStore.get(gameId)!;
    const bIds = game.units.filter(unit => unit.owner === 'player_b').map(unit => unit.id);
    expect(bIds.length).toBeGreaterThan(0);

    const { res, body } = await fetchFogState(app, gameId, { player: seats[0]!.token });
    expect(res.statusCode).toBe(200);
    expect(body.fog.enabled).toBe(true);
    expect(body.fog.revealed).toBe(false);
    expect(body.fog.visibleCells.length).toBeGreaterThan(0);

    // 自己的单位全都在。
    const returned = new Set(body.units.map(unit => unit.id));
    for (const unit of game.units.filter(item => item.owner === 'player_a')) {
      expect(returned.has(unit.id)).toBe(true);
    }
    // B 至少有一个单位在 A 视野外。
    const hidden = bIds.filter(id => !returned.has(id));
    expect(hidden.length).toBeGreaterThan(0);
    // 隐藏单位的 id 不能出现在响应任何字段里（units/fog/events/adjudication）。
    for (const id of hidden) expect(res.body).not.toContain(id);
    // 返回的 B 单位必须确实落在 fog.visibleCells 内。
    const visibleCells = new Set(body.fog.visibleCells);
    for (const unit of body.units.filter(item => item.owner === 'player_b')) {
      expect(visibleCells.has(`${unit.q},${unit.r}`)).toBe(true);
    }

    // 计划队列同样只给本人：B 的队列不可见。
    expect(body.plan.queues.player_b).toBeUndefined();
  });

  it('redacts other players adjudication details but keeps their total and rank', async () => {
    const { gameId, seats } = await gameWithFog();
    const { body } = await fetchFogState(app, gameId, { player: seats[0]!.token });

    const own = body.adjudication.scores.player_a!;
    const other = body.adjudication.scores.player_b!;
    expect(typeof own.armyValue).toBe('number');
    expect(own.hidden).toBeUndefined();
    expect(other.hidden).toBe(true);
    expect(other.playerId).toBe('player_b');
    expect(typeof other.total).toBe('number');
    expect(typeof other.rank).toBe('number');
    expect(other.armyValue).toBeUndefined();
    expect(other.killValue).toBeUndefined();
    expect(other.supplies).toBeUndefined();

    const otherRanking = body.adjudication.rankings.find(item => item.playerId === 'player_b')!;
    expect(otherRanking.hidden).toBe(true);
    expect(otherRanking.score).toBeUndefined();
    const ownRanking = body.adjudication.rankings.find(item => item.playerId === 'player_a')!;
    expect(ownRanking.hidden).toBeUndefined();
    expect(typeof ownRanking.score?.total).toBe('number');
  });

  it('anonymous fog state is the safe public view: no units, no lastSeen, public events only', async () => {
    const { gameId } = await gameWithFog();
    const game = globalStore.get(gameId)!;
    const allUnitIds = game.units.map(unit => unit.id);

    const { res, body } = await fetchFogState(app, gameId);
    expect(res.statusCode).toBe(200);
    expect(body.units).toEqual([]);
    expect(body.fog).toEqual({ enabled: true, revealed: false, visibleCells: [], lastSeen: [] });
    // 匿名裁决只剩整体 hidden 标记。
    expect(body.adjudication).toEqual({ hidden: true });
    // 匿名不给行动事件；公开事件（开局/回合/加入等）仍在。
    expect(body.events.length).toBeGreaterThan(0);
    for (const event of body.events) {
      expect(['game_start', 'round_start', 'round_end', 'income', 'comeback_supply',
        'turn_end', 'plan_committed', 'wait', 'game_over', 'player_joined', 'player_left',
        'player_eliminated', 'name_rename', 'reset_actions', 'turn_skipped', 'bot_failed',
      ]).toContain(event.type);
    }
    for (const id of allUnitIds) expect(res.body).not.toContain(id);
  });

  it('spectator token gets the full view: all units, revealed fog, full events and scores', async () => {
    const { gameId, spectatorToken } = await gameWithFog();
    const game = globalStore.get(gameId)!;

    const { res, body } = await fetchFogState(app, gameId, { spectator: spectatorToken });
    expect(res.statusCode).toBe(200);
    expect(body.units).toHaveLength(game.units.length);
    expect(body.fog.revealed).toBe(true);
    expect(body.fog.visibleCells.length).toBe(game.cells.length);
    expect(body.fog.lastSeen).toEqual([]);
    expect(body.events).toHaveLength(game.events.length);
    expect(typeof body.adjudication.scores.player_b!.armyValue).toBe('number');
    // 观战也看不到计划队列内容，只能看到 committed。
    expect(body.plan.queues.player_a).toBeUndefined();
    expect(body.plan.queues.player_b).toBeUndefined();
  });

  it('projects hidden action events out of state events and the non-SSE event list', async () => {
    const { gameId, seats, spectatorToken } = await gameWithFog();
    const game = globalStore.get(gameId)!;
    // 找一个 A 看不见的 B 单位，手动追加一条它移动的事件。
    const { body: viewA } = await fetchFogState(app, gameId, { player: seats[0]!.token });
    const visibleIds = new Set(viewA.units.map(unit => unit.id));
    const hiddenUnit = game.units.find(unit => unit.owner === 'player_b' && !visibleIds.has(unit.id))!;
    expect(hiddenUnit).toBeTruthy();
    appendEvent(game, globalEventBus, 'move', {
      owner: 'player_b',
      unitId: hiddenUnit.id,
      fromQ: hiddenUnit.q,
      fromR: hiddenUnit.r,
      toQ: hiddenUnit.q + 1,
      toR: hiddenUnit.r,
    });

    const seen = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}/events`,
      headers: { 'x-player-token': seats[0]!.token },
    });
    expect(seen.statusCode).toBe(200);
    expect(seen.body).not.toContain(hiddenUnit.id);
    const seenEvents = (seen.json() as { events: { type: string }[] }).events;
    expect(seenEvents.some(event => event.type === 'move')).toBe(false);

    const anonymous = await app.inject({ method: 'GET', url: `/api/games/${gameId}/events` });
    expect(anonymous.statusCode).toBe(200);
    expect(anonymous.body).not.toContain(hiddenUnit.id);

    const full = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}/events`,
      headers: { 'x-spectator-token': spectatorToken },
    });
    expect(full.statusCode).toBe(200);
    expect(full.body).toContain(hiddenUnit.id);
    expect((full.json() as { events: { type: string }[] }).events.some(event => event.type === 'move')).toBe(true);

    // 状态响应里内嵌的 events 走同一投影。
    const { body: stateA } = await fetchFogState(app, gameId, { player: seats[0]!.token });
    expect(stateA.events.some(event => event.type === 'move')).toBe(false);
  });

  it('rejects an invalid spectator token and lets a valid player token win', async () => {
    const { gameId, seats } = await gameWithFog();
    const bad = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}`,
      headers: { 'x-spectator-token': 'not-a-real-token' },
    });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().code).toBe('invalid_spectator_token');

    const badEvents = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}/events?spectatorToken=not-a-real-token`,
    });
    expect(badEvents.statusCode).toBe(401);
    expect(badEvents.json().code).toBe('invalid_spectator_token');

    const both = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}`,
      headers: {
        'x-player-token': seats[0]!.token,
        'x-spectator-token': 'not-a-real-token',
      },
    });
    expect(both.statusCode).toBe(200);
    expect((both.json() as { units: unknown[] }).units.length).toBeLessThan(globalStore.get(gameId)!.units.length);

    const badPlayer = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}`,
      headers: { 'x-player-token': 'not-a-real-token' },
    });
    expect(badPlayer.statusCode).toBe(401);
    expect(badPlayer.json().code).toBe('invalid_token');
  });

  it('varies ETag by viewer and never serves a 304 across viewers', async () => {
    const { gameId, seats, spectatorToken } = await gameWithFog();
    const a = await fetchFogState(app, gameId, { player: seats[0]!.token });
    const b = await fetchFogState(app, gameId, { player: seats[1]!.token });
    const spectator = await fetchFogState(app, gameId, { spectator: spectatorToken });
    const anon = await fetchFogState(app, gameId);

    const etags = [
      a.res.headers.etag as string,
      b.res.headers.etag as string,
      spectator.res.headers.etag as string,
      anon.res.headers.etag as string,
    ];
    expect(new Set(etags).size).toBe(4);
    expect(etags[0]).toContain('-player:player_a');
    expect(etags[1]).toContain('-player:player_b');
    expect(etags[2]).toContain('-spectator');
    expect(etags[3]).toContain('-anon');
    for (const res of [a.res, b.res, spectator.res, anon.res]) {
      expect(res.headers.vary).toContain('X-Player-Token');
      expect(res.headers.vary).toContain('X-Spectator-Token');
    }

    const same = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}`,
      headers: { 'x-player-token': seats[0]!.token, 'if-none-match': etags[0]! },
    });
    expect(same.statusCode).toBe(304);
    const sameSpectator = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}`,
      headers: { 'x-spectator-token': spectatorToken, 'if-none-match': etags[2]! },
    });
    expect(sameSpectator.statusCode).toBe(304);

    // A 的 ETag 拿去请求 B / 匿名：必须 200 重新给出对应视图，不能复用 A 的 304。
    for (const [token, etag] of [[seats[1]!.token, etags[0]!], [null, etags[0]!]] as const) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/games/${gameId}`,
        headers: {
          ...(token ? { 'x-player-token': token } : {}),
          'if-none-match': etag,
        },
      });
      expect(res.statusCode).toBe(200);
    }
  });

  it('redacts terminal result scores for players/public and keeps spectator full', async () => {
    const { gameId, seats, spectatorToken } = await gameWithFog();
    const adjudicated = await app.inject({ method: 'POST', url: `/api/games/${gameId}/force-adjudicate` });
    expect(adjudicated.statusCode).toBe(200);
    const game = globalStore.get(gameId)!;
    expect(game.result).toBeTruthy();
    const rawA = game.result!.scores.player_a!;
    const rawB = game.result!.scores.player_b!;
    expect(typeof rawB.armyValue).toBe('number');

    const { body } = await fetchFogState(app, gameId, { player: seats[0]!.token });
    const view = body as unknown as { result: any; players: Record<string, any> };
    expect(view.result.scores.player_b).toEqual({ total: rawB.total, hidden: true });
    for (const key of ['armyValue', 'killValue', 'headquartersDamage', 'ownHqHp',
      'controlPoints', 'controlHold', 'supplies']) {
      expect(view.result.scores.player_b[key]).toBeUndefined();
    }
    expect(view.result.scores.player_a.armyValue).toBe(rawA.armyValue);
    const rankB = view.result.rankings.find((item: any) => item.playerId === 'player_b');
    expect(rankB.score).toEqual({ total: rawB.total, hidden: true });
    expect(rankB.playerId).toBe('player_b');
    expect(typeof rankB.rank).toBe('number');
    expect(rankB.status).toBeDefined();
    expect(rankB.score.armyValue).toBeUndefined();

    // game_over 事件里的 scores/rankings 走同一口径，不能成为第四条旁路。
    const overA = body.events.find(event => event.type === 'game_over')!;
    expect((overA.payload.scores as Record<string, unknown>).player_b)
      .toEqual({ total: rawB.total, hidden: true });
    expect((overA.payload.scores as Record<string, unknown>).player_a)
      .toMatchObject({ armyValue: rawA.armyValue });

    // 匿名 public：所有人只有 total，连 hidden 标记都不给。
    const pub = await fetchFogState(app, gameId);
    const pubView = pub.body as unknown as { result: any; players: Record<string, any> };
    expect(pubView.result.scores.player_a).toEqual({ total: rawA.total });
    expect(pubView.result.scores.player_b).toEqual({ total: rawB.total });
    expect(pubView.result.scores.player_a.armyValue).toBeUndefined();
    for (const ranking of pubView.result.rankings) {
      expect(ranking.score.armyValue).toBeUndefined();
      expect(ranking.score.total).toBeTypeOf('number');
    }
    const overPub = pub.body.events.find(event => event.type === 'game_over')!;
    expect((overPub.payload.scores as Record<string, unknown>).player_a).toEqual({ total: rawA.total });

    // 观战令牌：全量。
    const spectator = await fetchFogState(app, gameId, { spectator: spectatorToken });
    const spectatorView = spectator.body as unknown as { result: any };
    expect(spectatorView.result.scores.player_b.armyValue).toBe(rawB.armyValue);
    expect(spectatorView.result.scores.player_a.supplies).toBe(rawA.supplies);
    const overSpectator = spectator.body.events.find(event => event.type === 'game_over')!;
    expect((overSpectator.payload.scores as Record<string, any>).player_b.armyValue)
      .toBe(rawB.armyValue);

    // 投影只发生在响应副本里：内存中的终局结果仍完整。
    expect(game.result!.scores.player_b!.armyValue).toBe(rawB.armyValue);
  });

  it('drops other players adjudicationScore for player/public but keeps own and stats', async () => {
    const { gameId, seats, hostToken, spectatorToken } = await gameWithFog();
    const eliminated = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/host/eliminate`,
      headers: { 'x-host-token': hostToken },
      payload: { playerId: 'player_b' },
    });
    expect(eliminated.statusCode).toBe(200);
    const game = globalStore.get(gameId)!;
    expect(game.phase).toBe('game_over');
    const rawEliminated = game.players.player_b!.adjudicationScore!;
    expect(rawEliminated).toBeTruthy();
    expect(typeof rawEliminated.armyValue).toBe('number');

    // A（存活玩家）看不到 B 的分项记录，B 的 stats 整块删除。
    const { body: viewA } = await fetchFogState(app, gameId, { player: seats[0]!.token });
    const playersA = (viewA as unknown as { players: Record<string, any> }).players;
    expect(playersA.player_b.adjudicationScore).toBeUndefined();
    expect(playersA.player_b.stats).toBeUndefined();
    expect(playersA.player_a.stats).toBeTruthy();
    expect((viewA as unknown as { result: any }).result).toBeTruthy();
    expect((viewA as unknown as { result: any }).result.scores.player_b)
      .toEqual({ total: rawEliminated.total, hidden: true });

    // B 本人：自己的 adjudicationScore 保留，A 的删除。
    const { body: viewB } = await fetchFogState(app, gameId, { player: seats[1]!.token });
    const playersB = (viewB as unknown as { players: Record<string, any> }).players;
    expect(playersB.player_b.adjudicationScore).toEqual(rawEliminated);
    expect(playersB.player_b.stats).toBeTruthy();
    expect(playersB.player_a.adjudicationScore).toBeUndefined();
    expect(playersB.player_a.stats).toBeUndefined();

    // public：所有人的 adjudicationScore 都删除。
    const { body: pubBody } = await fetchFogState(app, gameId);
    const pubPlayers = (pubBody as unknown as { players: Record<string, any> }).players;
    for (const entry of Object.values(pubPlayers)) {
      expect(entry.adjudicationScore).toBeUndefined();
      expect(entry.stats).toBeUndefined();
    }

    // spectator：全量保留。
    const { body: spectatorBody } = await fetchFogState(app, gameId, { spectator: spectatorToken });
    const spectatorPlayers = (spectatorBody as unknown as { players: Record<string, any> }).players;
    expect(spectatorPlayers.player_b.adjudicationScore).toEqual(rawEliminated);
    expect(spectatorPlayers.player_b.stats).toBeTruthy();
    expect(game.players.player_b!.adjudicationScore).toEqual(rawEliminated);
  });

  it('deletes other players stats and eliminatedBy according to the viewer', async () => {
    const { gameId, seats, hostToken, spectatorToken } = await gameWithFog(3);
    const eliminated = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/host/eliminate`,
      headers: { 'x-host-token': hostToken },
      payload: { playerId: 'player_c' },
    });
    expect(eliminated.statusCode).toBe(200);
    const game = globalStore.get(gameId)!;
    expect(game.phase).not.toBe('game_over');
    // 模拟 A 击杀 C：引擎的 host_eliminated 不带击杀者，这里只验证投影口径。
    game.players.player_c!.eliminatedBy = 'player_a';
    const rawScore = game.players.player_c!.adjudicationScore!;
    expect(rawScore).toBeTruthy();

    const readPlayers = async (auth: { player?: string; spectator?: string }) => {
      const { body } = await fetchFogState(app, gameId, auth);
      return (body as unknown as { players: Record<string, any> }).players;
    };

    // A = 击杀者：C 的 eliminatedBy 保留，C 的 stats/分项删除；自己的 stats 保留。
    const a = await readPlayers({ player: seats[0]!.token });
    expect(a.player_c.eliminatedBy).toBe('player_a');
    expect(a.player_c.stats).toBeUndefined();
    expect(a.player_c.adjudicationScore).toBeUndefined();
    expect(a.player_a.stats).toBeTruthy();
    expect(a.player_b.stats).toBeUndefined();

    // B = 第三方：淘汰者身份与 stats 都删除，自己的 stats 保留。
    const b = await readPlayers({ player: seats[1]!.token });
    expect(b.player_c.eliminatedBy).toBeUndefined();
    expect(b.player_c.stats).toBeUndefined();
    expect(b.player_b.stats).toBeTruthy();
    expect(b.player_a.stats).toBeUndefined();

    // C = 被淘汰者本人：保留自己的 eliminatedBy、stats、adjudicationScore。
    const c = await readPlayers({ player: seats[2]!.token });
    expect(c.player_c.eliminatedBy).toBe('player_a');
    expect(c.player_c.stats).toBeTruthy();
    expect(c.player_c.adjudicationScore).toEqual(rawScore);
    expect(c.player_a.stats).toBeUndefined();

    // public：所有 stats/eliminatedBy/adjudicationScore 删除。
    const pub = await readPlayers({});
    for (const entry of Object.values(pub)) {
      expect(entry.stats).toBeUndefined();
      expect(entry.eliminatedBy).toBeUndefined();
      expect(entry.adjudicationScore).toBeUndefined();
    }

    // spectator：全量保留。
    const spec = await readPlayers({ spectator: spectatorToken });
    for (const id of ['player_a', 'player_b', 'player_c']) {
      expect(spec[id].stats).toBeTruthy();
    }
    expect(spec.player_c.eliminatedBy).toBe('player_a');
    expect(spec.player_c.adjudicationScore).toEqual(rawScore);
  });

  it('does not touch non-fog result or adjudicationScore', async () => {
    app = await startTestServer();
    const { gameId, hostToken, playerAToken } = await createGameAndJoin(app);
    const eliminated = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/host/eliminate`,
      headers: { 'x-host-token': hostToken },
      payload: { playerId: 'player_b' },
    });
    expect(eliminated.statusCode).toBe(200);
    const game = globalStore.get(gameId)!;
    expect(game.result).toBeTruthy();
    expect(game.players.player_b!.adjudicationScore).toBeTruthy();

    const res = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}`,
      headers: { 'x-player-token': playerAToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      result: { scores: Record<string, Record<string, unknown>> };
      players: Record<string, Record<string, unknown>>;
    };
    expect(typeof body.result.scores.player_b!.armyValue).toBe('number');
    expect(body.result.scores.player_b!.hidden).toBeUndefined();
    expect(body.players.player_b!.adjudicationScore).toBeTruthy();
    expect(body.players.player_b!.stats).toBeTruthy();
  });

  it('works end to end on the real fog-harbor map', async () => {
    app = await startTestServer();
    const create = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mapId: 'fog-harbor', maxPlayers: 2, playerName: 'A' },
    });
    expect(create.statusCode).toBe(200);
    const created = create.json() as { gameId: string; hostToken: string; player: { token: string }; spectatorToken: string };
    expect(created.spectatorToken).toMatch(/^[0-9a-f]{32}$/);
    const join = await app.inject({ method: 'POST', url: `/api/games/${created.gameId}/join`, payload: { name: 'B' } });
    expect(join.statusCode).toBe(200);
    const start = await app.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/start`,
      headers: { 'x-host-token': created.hostToken },
    });
    expect(start.statusCode).toBe(200);

    const game = globalStore.get(created.gameId)!;
    const { body: playerView } = await fetchFogState(app, created.gameId, { player: created.player.token });
    expect(playerView.units.length).toBeLessThan(game.units.length);
    const { body: spectatorView } = await fetchFogState(app, created.gameId, { spectator: created.spectatorToken });
    expect(spectatorView.units).toHaveLength(game.units.length);
    expect(spectatorView.fog.revealed).toBe(true);
  });

  it('leaves non-fog responses unchanged: all units/events, no fog field, anonymous still 401', async () => {
    app = await startTestServer();
    const { gameId, playerAToken, playerBToken } = await createGameAndJoin(app);
    const game = globalStore.get(gameId)!;

    const res = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}`,
      headers: { 'x-player-token': playerAToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown> & { units: unknown[]; events: unknown[]; fog?: unknown };
    expect(body.units).toHaveLength(game.units.length);
    expect(body.events).toHaveLength(game.events.length);
    expect(body.fog).toBeUndefined();
    expect(body.adjudication).toBeTruthy();

    const anonymous = await app.inject({ method: 'GET', url: `/api/games/${gameId}` });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json().code).toBe('invalid_token');

    // 非迷雾模式两个玩家的 ETag 仍按各自队列区分，但格式不加观者后缀。
    const a = await app.inject({
      method: 'GET', url: `/api/games/${gameId}`, headers: { 'x-player-token': playerAToken },
    });
    const b = await app.inject({
      method: 'GET', url: `/api/games/${gameId}`, headers: { 'x-player-token': playerBToken },
    });
    expect(a.headers.etag).not.toContain('-player:');
    expect(a.headers.etag).not.toContain('-anon');
    expect(b.headers.etag).not.toContain('-player:');
  });
});
