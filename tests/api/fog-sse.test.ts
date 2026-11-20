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
  createFogGame, installFogMap, restoreMaps, sseDataLines,
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
