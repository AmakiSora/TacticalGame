// tests/api/fog-cursor.test.ts
// 4.0.1：fog 事件游标按观者固化序号。隐藏事件不推进 lastEventSeq/stateVersion/ETag，
// 不占观者序号；可见事件 +1；?after 与 wait 都按观者序号解释。
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestServer } from '../helpers.js';
import { globalStore } from '../../src/state/store.js';
import { appendEvent } from '../../src/engine/events.js';
import { globalEventBus } from '../../src/events/bus.js';
import {
  createFogGame, fetchFogState, installFogMap, restoreMaps, sseDataLines,
} from './fog-fixtures.js';

beforeAll(() => installFogMap());
afterAll(() => restoreMaps());

let app: FastifyInstance;

afterEach(async () => {
  for (const id of globalStore.list()) await globalStore.delete(id);
  if (app) await app.close();
});

async function fogGame(players = 2) {
  app = await startTestServer();
  return createFogGame(app, players);
}

describe('fog viewer cursors', () => {
  it('hidden events do not advance lastEventSeq/stateVersion/ETag; visible ones do', async () => {
    const { gameId, seats, spectatorToken } = await fogGame();
    const game = globalStore.get(gameId)!;
    const beforeA = await fetchFogState(app, gameId, { player: seats[0]!.token });
    const beforePublic = await fetchFogState(app, gameId);
    const beforeSpectator = await fetchFogState(app, gameId, { spectator: spectatorToken });
    const aSeq = beforeA.body.lastEventSeq;
    const aVersion = (beforeA.body as unknown as { stateVersion: number }).stateVersion;
    const publicSeq = beforePublic.body.lastEventSeq;
    const spectatorSeq = game.events.at(-1)!.seq;

    // 一条 A/public 都看不见的 B 移动。
    const visibleIds = new Set(beforeA.body.units.map(unit => unit.id));
    const hidden = game.units.find(unit => unit.owner === 'player_b' && !visibleIds.has(unit.id))!;
    appendEvent(game, globalEventBus, 'move', {
      owner: 'player_b', unitId: hidden.id,
      fromQ: hidden.q, fromR: hidden.r, toQ: hidden.q + 1, toR: hidden.r,
    });

    for (const cached of [beforeA, beforePublic]) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/games/${gameId}`,
        headers: {
          ...(cached === beforeA ? { 'x-player-token': seats[0]!.token } : {}),
          'if-none-match': cached.res.headers.etag as string,
        },
      });
      expect(res.statusCode).toBe(304);
    }
    const afterA = await fetchFogState(app, gameId, { player: seats[0]!.token });
    expect(afterA.body.lastEventSeq).toBe(aSeq);
    expect((afterA.body as unknown as { stateVersion: number }).stateVersion).toBe(aVersion);
    expect(afterA.res.headers.etag).toBe(beforeA.res.headers.etag);
    expect(afterA.body.events.some(event => event.type === 'move')).toBe(false);

    const afterPublic = await fetchFogState(app, gameId);
    expect(afterPublic.body.lastEventSeq).toBe(publicSeq);
    expect(afterPublic.res.headers.etag).toBe(beforePublic.res.headers.etag);

    // 观战是全量：隐藏动作对他们可见，全局 seq 推进且不带内部固化表。
    const afterSpectator = await fetchFogState(app, gameId, { spectator: spectatorToken });
    expect(afterSpectator.body.lastEventSeq).toBeGreaterThan(spectatorSeq);
    expect(afterSpectator.body.events.some(event => event.type === 'move')).toBe(true);
    expect(JSON.stringify(afterSpectator.body.events)).not.toContain('fogViews');
    expect(JSON.stringify(afterSpectator.body.events)).not.toContain('fogSeqs');
    expect(afterSpectator.res.headers.etag).not.toBe(beforeSpectator.res.headers.etag);

    // 可见的公开事件：玩家序号 +1，ETag 变化并返回 200。
    appendEvent(game, globalEventBus, 'round_start', { roundNumber: game.turn.roundNumber });
    const visibleA = await fetchFogState(app, gameId, { player: seats[0]!.token });
    expect(visibleA.body.lastEventSeq).toBe(aSeq + 1);
    expect((visibleA.body as unknown as { stateVersion: number }).stateVersion).toBe(aVersion + 1);
    expect(visibleA.res.headers.etag).not.toBe(afterA.res.headers.etag);
    const notCached = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}`,
      headers: {
        'x-player-token': seats[0]!.token,
        'if-none-match': afterA.res.headers.etag as string,
      },
    });
    expect(notCached.statusCode).toBe(200);
  });

  it('?after uses the viewer sequence and skips hidden events; spectator keeps global seq', async () => {
    const { gameId, seats, spectatorToken } = await fogGame();
    const game = globalStore.get(gameId)!;
    const before = await fetchFogState(app, gameId, { player: seats[0]!.token });
    const afterSeq = before.body.lastEventSeq;

    const visibleIds = new Set(before.body.units.map(unit => unit.id));
    const hidden = game.units.find(unit => unit.owner === 'player_b' && !visibleIds.has(unit.id))!;
    appendEvent(game, globalEventBus, 'move', {
      owner: 'player_b', unitId: hidden.id,
      fromQ: hidden.q, fromR: hidden.r, toQ: hidden.q + 1, toR: hidden.r,
    });
    appendEvent(game, globalEventBus, 'round_start', { roundNumber: game.turn.roundNumber });

    const playerIncrement = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}/events?after=${afterSeq}`,
      headers: { 'x-player-token': seats[0]!.token },
    });
    expect(playerIncrement.statusCode).toBe(200);
    const playerEvents = (playerIncrement.json() as { events: { seq: number; type: string }[] }).events;
    expect(playerEvents.map(event => event.seq)).toEqual([afterSeq + 1]);
    expect(playerEvents.some(event => event.type === 'move')).toBe(false);

    const anonymousIncrement = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}/events?after=${before.body.lastEventSeq}`,
    });
    const anonEvents = (anonymousIncrement.json() as { events: { seq: number; type: string }[] }).events;
    expect(anonEvents.map(event => event.seq)).toEqual([before.body.lastEventSeq + 1]);
    expect(anonEvents.some(event => event.type === 'move')).toBe(false);

    // spectator 用全局 seq，且响应里没有内部固化表。
    const globalAfter = game.events.length - 2;
    const spectatorEvents = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}/events?after=${globalAfter}`,
      headers: { 'x-spectator-token': spectatorToken },
    });
    expect(spectatorEvents.statusCode).toBe(200);
    const specBody = spectatorEvents.json() as { events: { seq: number; type: string }[] };
    expect(specBody.events.map(event => event.seq)).toEqual([globalAfter + 1, globalAfter + 2]);
    expect(specBody.events.some(event => event.type === 'move')).toBe(true);
    expect(spectatorEvents.body).not.toContain('fogViews');
    expect(spectatorEvents.body).not.toContain('fogSeqs');
  });

  it('wait ignores hidden events and returns the viewer sequence for visible ones', async () => {
    const { gameId, seats } = await fogGame();
    const game = globalStore.get(gameId)!;
    const before = await fetchFogState(app, gameId, { player: seats[0]!.token });
    const afterSeq = before.body.lastEventSeq;

    const visibleIds = new Set(before.body.units.map(unit => unit.id));
    const hidden = game.units.find(unit => unit.owner === 'player_b' && !visibleIds.has(unit.id))!;
    appendEvent(game, globalEventBus, 'move', {
      owner: 'player_b', unitId: hidden.id,
      fromQ: hidden.q, fromR: hidden.r, toQ: hidden.q + 1, toR: hidden.r,
    });
    const hiddenWait = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}/wait?afterSeq=${afterSeq}&timeout=0.15`,
      headers: { 'x-player-token': seats[0]!.token },
    });
    expect(hiddenWait.statusCode).toBe(200);
    expect(hiddenWait.json()).toEqual({ changed: false, seq: afterSeq });

    appendEvent(game, globalEventBus, 'round_start', { roundNumber: game.turn.roundNumber });
    const visibleWait = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}/wait?afterSeq=${afterSeq}&timeout=0.15`,
      headers: { 'x-player-token': seats[0]!.token },
    });
    expect(visibleWait.statusCode).toBe(200);
    expect(visibleWait.json()).toEqual({ changed: true, seq: afterSeq + 1 });
  });

  it('keeps SSE ids continuous per player while spectator keeps global ids', async () => {
    const { gameId, seats, spectatorToken } = await fogGame();
    const game = globalStore.get(gameId)!;
    const before = await fetchFogState(app, gameId, { player: seats[0]!.token });
    const visibleIds = new Set(before.body.units.map(unit => unit.id));
    const hidden = game.units.find(unit => unit.owner === 'player_b' && !visibleIds.has(unit.id))!;
    appendEvent(game, globalEventBus, 'move', {
      owner: 'player_b', unitId: hidden.id,
      fromQ: hidden.q, fromR: hidden.r, toQ: hidden.q + 1, toR: hidden.r,
    });
    appendEvent(game, globalEventBus, 'round_start', { roundNumber: game.turn.roundNumber });

    const playerSse = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}/events?close=true`,
      headers: { accept: 'text/event-stream', 'x-player-token': seats[0]!.token },
    });
    expect(playerSse.statusCode).toBe(200);
    const playerEvents = sseDataLines(playerSse.body);
    expect(playerEvents.map(event => event.seq)).toEqual(
      Array.from({ length: playerEvents.length }, (_, index) => index + 1),
    );
    expect(playerEvents.some(event => event.type === 'move')).toBe(false);

    const mid = Math.max(0, playerEvents.length - 2);
    const resumed = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}/events?close=true`,
      headers: {
        accept: 'text/event-stream',
        'x-player-token': seats[0]!.token,
        'last-event-id': String(mid),
      },
    });
    const resumedEvents = sseDataLines(resumed.body);
    expect(resumedEvents.map(event => event.seq)).toEqual(
      playerEvents.slice(mid).map(event => event.seq),
    );

    const spectatorSse = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}/events?close=true`,
      headers: { accept: 'text/event-stream', 'x-spectator-token': spectatorToken },
    });
    const spectatorEvents = sseDataLines(spectatorSse.body);
    expect(spectatorEvents.map(event => event.seq)).toEqual(
      game.events.map(event => event.seq),
    );
    expect(spectatorSse.body).not.toContain('fogViews');
    expect(spectatorSse.body).not.toContain('fogSeqs');
  });
});
