// tests/api/fog-sse.test.ts
// SSE 逐事件投影：匿名只收公开事件，玩家收视野内事件，观战全量；
// 握手期历史帧与订阅后的实时帧走同一套投影。
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestServer } from '../helpers.js';
import { buildServer, LOG_REDACT_PATHS, redactRequestUrl } from '../../src/server.js';
import { globalStore } from '../../src/state/store.js';
import { appendEvent } from '../../src/engine/events.js';
import { globalEventBus } from '../../src/events/bus.js';
import { closeSseConnections, eventsRoutes } from '../../src/api/events.js';
import {
  createFogGame, fetchFogState, installFogMap, restoreMaps, sseDataLines,
} from './fog-fixtures.js';

beforeAll(() => installFogMap());
afterAll(() => restoreMaps());

let app: FastifyInstance;

afterEach(async () => {
  closeSseConnections();
  for (const id of globalStore.list()) await globalStore.delete(id);
  if (app) await app.close();
});

async function fogWithHiddenEvent() {
  app = await startTestServer();
  const fog = await createFogGame(app);
  const game = globalStore.get(fog.gameId)!;
  const visible = new Set(game.units.filter(unit => unit.owner === 'player_a').map(unit => unit.id));
  const hidden = game.units.find(unit => unit.owner === 'player_b' && !visible.has(unit.id))!;
  const event = appendEvent(game, globalEventBus, 'move', {
    owner: 'player_b',
    unitId: hidden.id,
    fromQ: hidden.q,
    fromR: hidden.r,
    toQ: hidden.q + 1,
    toR: hidden.r,
  });
  return { ...fog, hidden, event };
}

describe('fog SSE projection', () => {
  it('anonymous stream carries public events only and no hidden unit id', async () => {
    const { gameId, hidden } = await fogWithHiddenEvent();
    const res = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}/events?close=true`,
      headers: { accept: 'text/event-stream' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('retry: 3000');
    expect(res.body).not.toContain(hidden.id);
    const events = sseDataLines(res.body);
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) expect(event.type).not.toBe('move');
  });

  it('player stream hides events of unseen enemy units', async () => {
    const { gameId, seats, hidden } = await fogWithHiddenEvent();
    const res = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}/events?close=true`,
      headers: { accept: 'text/event-stream', 'x-player-token': seats[0]!.token },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(hidden.id);
    expect(sseDataLines(res.body).some(event => event.type === 'move')).toBe(false);
  });

  it('spectator stream is the full log', async () => {
    const { gameId, spectatorToken, hidden } = await fogWithHiddenEvent();
    const game = globalStore.get(gameId)!;
    const res = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}/events?close=true`,
      headers: { accept: 'text/event-stream', 'x-spectator-token': spectatorToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(hidden.id);
    expect(sseDataLines(res.body)).toHaveLength(game.events.length);
  });

  it('rejects invalid credentials on the SSE handshake', async () => {
    const { gameId } = await fogWithHiddenEvent();
    const badSpectator = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}/events?close=true`,
      headers: { accept: 'text/event-stream', 'x-spectator-token': 'bad' },
    });
    expect(badSpectator.statusCode).toBe(401);
    expect(badSpectator.json().code).toBe('invalid_spectator_token');

    const badPlayer = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}/events?close=true`,
      headers: { accept: 'text/event-stream', 'x-player-token': 'bad' },
    });
    expect(badPlayer.statusCode).toBe(401);
    expect(badPlayer.json().code).toBe('invalid_token');
  });

  it('anonymous SSE game_start carries public map geometry but no hidden units', async () => {
    app = await startTestServer();
    const fog = await createFogGame(app);
    const game = globalStore.get(fog.gameId)!;
    const allUnitIds = game.units.map(unit => unit.id);

    const anonymous = await app.inject({
      method: 'GET',
      url: `/api/games/${fog.gameId}/events?close=true`,
      headers: { accept: 'text/event-stream' },
    });
    expect(anonymous.statusCode).toBe(200);
    const anonStart = sseDataLines(anonymous.body).find(event => event.type === 'game_start')!;
    expect(anonStart).toBeTruthy();
    const payload = anonStart.payload as Record<string, any>;
    expect(payload.mapId).toBe(game.mapId);
    expect(payload.map.cells.length).toBe(game.cells.length);
    expect(payload.roundNumber).toBeTypeOf('number');
    for (const key of ['units', 'headquarters', 'players', 'resources', 'controlPoints']) {
      expect(payload[key]).toBeUndefined();
    }
    for (const id of allUnitIds) expect(anonymous.body).not.toContain(id);

    // 玩家与观战帧不因公开地图修复而变形。
    const player = await app.inject({
      method: 'GET',
      url: `/api/games/${fog.gameId}/events?close=true`,
      headers: { accept: 'text/event-stream', 'x-player-token': fog.seats[0]!.token },
    });
    const playerStart = sseDataLines(player.body).find(event => event.type === 'game_start')!;
    expect((playerStart.payload as Record<string, any>).map.cells.length).toBe(game.cells.length);
    const spectator = await app.inject({
      method: 'GET',
      url: `/api/games/${fog.gameId}/events?close=true`,
      headers: { accept: 'text/event-stream', 'x-spectator-token': fog.spectatorToken },
    });
    const spectatorStart = sseDataLines(spectator.body).find(event => event.type === 'game_start')!;
    expect((spectatorStart.payload as Record<string, any>).units).toHaveLength(game.units.length);
  });

  it('terminal public SSE is the full log with global ids, no token needed', async () => {
    app = await startTestServer();
    const fog = await createFogGame(app);
    const game = globalStore.get(fog.gameId)!;
    const before = await fetchFogState(app, fog.gameId, { player: fog.seats[0]!.token });
    const visibleIds = new Set(before.body.units.map(unit => unit.id));
    const hidden = game.units.find(unit => unit.owner === 'player_b' && !visibleIds.has(unit.id))!;
    appendEvent(game, globalEventBus, 'move', {
      owner: 'player_b', unitId: hidden.id,
      fromQ: hidden.q, fromR: hidden.r, toQ: hidden.q + 1, toR: hidden.r,
    });
    const adjudicated = await app.inject({ method: 'POST', url: `/api/games/${fog.gameId}/force-adjudicate` });
    expect(adjudicated.statusCode).toBe(200);

    const anonymous = await app.inject({
      method: 'GET',
      url: `/api/games/${fog.gameId}/events?close=true`,
      headers: { accept: 'text/event-stream' },
    });
    expect(anonymous.statusCode).toBe(200);
    const events = sseDataLines(anonymous.body);
    expect(events.map(event => event.seq)).toEqual(game.events.map(event => event.seq));
    expect(events.some(event => event.type === 'move')).toBe(true);
    const over = events.find(event => event.type === 'game_over')!;
    expect(typeof (over.payload.scores as Record<string, any>).player_b.armyValue).toBe('number');
    expect(anonymous.body).not.toContain('fogViews');
    expect(anonymous.body).not.toContain('fogSeqs');

    // 观战同全量；玩家仍是冻结本人历史（隐藏行动不补出）。
    const spectator = await app.inject({
      method: 'GET',
      url: `/api/games/${fog.gameId}/events?close=true`,
      headers: { accept: 'text/event-stream', 'x-spectator-token': fog.spectatorToken },
    });
    expect(sseDataLines(spectator.body).map(event => event.seq)).toEqual(game.events.map(event => event.seq));
    const player = await app.inject({
      method: 'GET',
      url: `/api/games/${fog.gameId}/events?close=true`,
      headers: { accept: 'text/event-stream', 'x-player-token': fog.seats[0]!.token },
    });
    expect(sseDataLines(player.body).some(event => event.type === 'move')).toBe(false);
  });

  it('accepts stale spectator tokens on terminal SSE but rejects them while active', async () => {
    app = await startTestServer();
    const fog = await createFogGame(app);
    const stale = 'deadbeefdeadbeefdeadbeefdeadbeef';
    for (const headers of [
      { accept: 'text/event-stream', 'x-spectator-token': stale },
      { accept: 'text/event-stream' },
    ]) {
      const url = headers['x-spectator-token']
        ? `/api/games/${fog.gameId}/events?close=true`
        : `/api/games/${fog.gameId}/events?close=true&spectatorToken=${stale}`;
      const active = await app.inject({ method: 'GET', url, headers });
      expect(active.statusCode).toBe(401);
      expect(active.json().code).toBe('invalid_spectator_token');
    }

    const game = globalStore.get(fog.gameId)!;
    const hidden = game.units.find(unit => unit.owner === 'player_b')!;
    appendEvent(game, globalEventBus, 'move', {
      owner: 'player_b', unitId: hidden.id,
      fromQ: hidden.q, fromR: hidden.r, toQ: hidden.q + 1, toR: hidden.r,
    });
    expect((await app.inject({ method: 'POST', url: `/api/games/${fog.gameId}/force-adjudicate` })).statusCode).toBe(200);

    for (const headers of [
      { accept: 'text/event-stream', 'x-spectator-token': stale },
      { accept: 'text/event-stream' },
    ]) {
      const url = headers['x-spectator-token']
        ? `/api/games/${fog.gameId}/events?close=true`
        : `/api/games/${fog.gameId}/events?close=true&spectatorToken=${stale}`;
      const res = await app.inject({ method: 'GET', url, headers });
      expect(res.statusCode).toBe(200);
      const events = sseDataLines(res.body);
      expect(events.map(event => event.seq)).toEqual(game.events.map(event => event.seq));
      expect(events.some(event => event.type === 'move')).toBe(true);
      expect(typeof (events.find(event => event.type === 'game_over')!
        .payload.scores as Record<string, any>).player_b.armyValue).toBe('number');
    }
  });

  it('never writes the spectator token to access logs', async () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(String(chunk));
        callback();
      },
    });
    const loggedApp = await buildServer({ loggerStream: stream, logLevel: 'info' });
    let spectatorToken = '';
    try {
      const fog = await createFogGame(loggedApp);
      spectatorToken = fog.spectatorToken;
      chunks.length = 0;
      const res = await loggedApp.inject({
        method: 'GET',
        url: `/api/games/${fog.gameId}/events?close=true&spectatorToken=${spectatorToken}`,
        headers: { accept: 'text/event-stream' },
      });
      expect(res.statusCode).toBe(200);
    } finally {
      await loggedApp.close();
    }
    const log = chunks.join('');
    expect(log).toContain('spectatorToken=[REDACTED]');
    expect(log).not.toContain(spectatorToken);

    // 配置与正则的单测兜底：即使 pino 输出被重定向，脱敏规则本身也必须覆盖观战令牌。
    expect(LOG_REDACT_PATHS).toContain('req.query.spectatorToken');
    expect(LOG_REDACT_PATHS).toContain('req.query.token');
    const redacted = redactRequestUrl(
      `/api/games/x/events?after=3&spectatorToken=${spectatorToken}&token=player-secret&access_token=control-secret`,
    );
    expect(redacted).not.toContain(spectatorToken);
    expect(redacted).not.toContain('player-secret');
    expect(redacted).not.toContain('control-secret');
    expect(redacted).toContain('spectatorToken=[REDACTED]');
    expect(redacted).toContain('token=[REDACTED]');
    expect(redacted).toContain('access_token=[REDACTED]');
  });

  it('projects live frames too: hidden stays out, public still arrives', async () => {
    const { gameId, seats, hidden } = await fogWithHiddenEvent();
    const raw = new LiveRaw();
    await connectLive(raw, gameId, { accept: 'text/event-stream', 'x-player-token': seats[0]!.token });
    // 历史帧（已投影）先落盘；清空后只看实时帧。
    raw.frames.length = 0;

    const game = globalStore.get(gameId)!;
    appendEvent(game, globalEventBus, 'move', {
      owner: 'player_b',
      unitId: hidden.id,
      fromQ: hidden.q,
      fromR: hidden.r,
      toQ: hidden.q + 1,
      toR: hidden.r,
    });
    expect(raw.frames.join('')).not.toContain(hidden.id);

    appendEvent(game, globalEventBus, 'round_start', { roundNumber: game.turn.roundNumber });
    expect(raw.frames.join('')).toContain('round_start');
    await new Promise(resolve => setImmediate(resolve));
    expect(raw.frames.join('')).not.toContain(hidden.id);
  });
});

/** 只实现 SSE 路由用到的响应方法，走真实路由处理器而不是网络。 */
class LiveRaw extends EventEmitter {
  frames: string[] = [];
  writableLength = 0;
  writableEnded = false;
  destroyed = false;
  writeHead(): void {}
  write(frame: string): boolean {
    this.frames.push(frame);
    return true;
  }
  end(): void {
    this.writableEnded = true;
    this.emit('close');
  }
  destroy(): void {
    this.destroyed = true;
    this.emit('close');
  }
}

async function connectLive(raw: LiveRaw, gameId: string, headers: Record<string, string>): Promise<void> {
  let handler: ((req: unknown, reply: unknown) => Promise<unknown>) | undefined;
  await eventsRoutes({
    get: (_path: string, route: typeof handler) => { handler = route; },
  } as unknown as FastifyInstance);
  await handler!({
    params: { id: gameId },
    query: {},
    headers,
    ip: '127.0.0.1',
  }, { raw, hijack() {} });
}
