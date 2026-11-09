// tests/api/events.test.ts
import { EventEmitter } from 'node:events';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { startTestServer, createGameAndJoin } from '../helpers.js';
import type { FastifyInstance } from 'fastify';
import { createInitialGame, globalStore } from '../../src/state/store.js';
import { closeSseConnections, eventsRoutes } from '../../src/api/events.js';
import { globalEventBus } from '../../src/events/bus.js';
import { renderMetrics, resetMetrics } from '../../src/utils/metrics.js';
import type { GameEvent } from '../../src/types.js';

describe('Events API', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    for (const id of globalStore.list()) await globalStore.delete(id);
    app = await startTestServer();
  });

  afterEach(async () => {
    closeSseConnections();
    await app.close();
  });

  it('GET /events returns all events as JSON by default', async () => {
    const { gameId } = await createGameAndJoin(app);
    const res = await app.inject({
      method: 'GET', url: `/api/games/${gameId}/events`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events.some((e: any) => e.type === 'game_start')).toBe(true);
  });

  it('GET /events?after=N returns only events after seq N', async () => {
    const { gameId, tokenA } = await createGameAndJoin(app);
    const game = globalStore.get(gameId)!;
    const lastSeq = game.events.at(-1)!.seq;
    await app.inject({
      method: 'POST', url: `/api/games/${gameId}/end-turn`,
      headers: { 'x-player-token': tokenA },
    });
    const res = await app.inject({
      method: 'GET', url: `/api/games/${gameId}/events?after=${lastSeq}`,
    });
    const body = res.json();
    for (const e of body.events) {
      expect(e.seq).toBeGreaterThan(lastSeq);
    }
    expect(body.events.length).toBeGreaterThan(0);
  });

  it('GET /events returns 404 for missing game', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/games/nope/events' });
    expect(res.statusCode).toBe(404);
  });

  it('returns proxy-safe headers for SSE streams', async () => {
    const { gameId } = await createGameAndJoin(app);
    const res = await app.inject({
      method: 'GET', url: `/api/games/${gameId}/events?close=true`,
      headers: { accept: 'text/event-stream' },
    });
    expect(res.headers['x-accel-buffering']).toBe('no');
    expect(res.body).toContain('retry: 3000');
    expect(res.body).toContain('id: 1');
    expect(res.body).toContain('data:');
  });

  it('resumes from Last-Event-ID instead of replaying the whole history', async () => {
    const { gameId, tokenA } = await createGameAndJoin(app);
    const game = globalStore.get(gameId)!;
    const lastSeq = game.events.at(-1)!.seq;
    await app.inject({
      method: 'POST', url: `/api/games/${gameId}/end-turn`,
      headers: { 'x-player-token': tokenA },
    });

    const res = await app.inject({
      method: 'GET', url: `/api/games/${gameId}/events?close=true`,
      headers: { accept: 'text/event-stream', 'last-event-id': String(lastSeq) },
    });
    const ids = res.body
      .split('\n')
      .filter(line => line.startsWith('id: '))
      .map(line => Number(line.slice(4)));
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(id).toBeGreaterThan(lastSeq);
  });
});

class SlowResponse extends EventEmitter {
  frames: string[] = [];
  writableLength = 0;
  writableEnded = false;
  destroyed = false;
  blockAt = 2;
  throwOnWrite = false;

  writeHead() {}
  write(frame: string): boolean {
    if (this.throwOnWrite) throw new Error('socket closed');
    this.frames.push(frame);
    const blocked = this.frames.length === this.blockAt;
    this.writableLength = blocked ? Buffer.byteLength(frame) : 0;
    return !blocked;
  }
  end() {
    this.writableEnded = true;
    this.emit('close');
  }
  destroy() {
    this.destroyed = true;
    this.emit('close');
  }
  drain() {
    this.writableLength = 0;
    this.emit('drain');
  }
  sequences(): number[] {
    return this.frames.flatMap(frame => {
      const match = /^id: (\d+)/.exec(frame);
      return match ? [Number(match[1])] : [];
    });
  }
}

describe('SSE backpressure lifecycle', () => {
  const gameId = 'slow-sse-client';
  const event = (seq: number, payload = {}): GameEvent => ({ seq, type: 'move', timestamp: seq, payload });

  async function connect(raw: SlowResponse, close = false, after = 0) {
    let handler: (req: unknown, reply: unknown) => Promise<unknown>;
    await eventsRoutes({ get: (_path: string, route: typeof handler) => { handler = route; } } as unknown as FastifyInstance);
    await handler!({
      params: { id: gameId },
      query: { after: String(after), close: String(close) },
      headers: { accept: 'text/event-stream' },
      ip: '127.0.0.1',
    }, { raw, hijack() {} });
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    resetMetrics();
    const game = createInitialGame(gameId);
    game.events = [event(1), event(2), event(3)];
    await globalStore.save(game);
  });

  afterEach(async () => {
    closeSseConnections();
    globalEventBus.clear(gameId);
    await globalStore.delete(gameId);
    vi.useRealTimers();
  });

  it('pauses historical writes and resumes in sequence before queued live events', async () => {
    const raw = new SlowResponse();
    await connect(raw);
    expect(raw.sequences()).toEqual([1]);
    globalEventBus.emit(gameId, event(4));
    expect(raw.sequences()).toEqual([1]);
    raw.drain();
    expect(raw.sequences()).toEqual([1, 2, 3, 4]);
    raw.drain();
    expect(raw.sequences()).toEqual([1, 2, 3, 4]);
    expect(raw.destroyed).toBe(false);
  });

  it('pauses even when the retry preamble fills the response buffer', async () => {
    const raw = new SlowResponse();
    raw.blockAt = 1;
    await connect(raw);
    globalEventBus.emit(gameId, event(4));
    expect(raw.sequences()).toEqual([]);
    raw.drain();
    expect(raw.sequences()).toEqual([1, 2, 3, 4]);
  });

  it('rejects an oversized historical frame without buffering it', async () => {
    globalStore.get(gameId)!.events = [event(1, { text: 'x'.repeat(1024 * 1024) })];
    const raw = new SlowResponse();
    await connect(raw);
    expect(raw.destroyed).toBe(true);
    expect(raw.sequences()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('pauses live events behind a blocked heartbeat and resumes after drain', async () => {
    const raw = new SlowResponse();
    raw.blockAt = 5;
    await connect(raw);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(raw.frames.at(-1)).toBe(': heartbeat\n\n');
    globalEventBus.emit(gameId, event(4));
    expect(raw.sequences()).toEqual([1, 2, 3]);
    raw.drain();
    expect(raw.sequences()).toEqual([1, 2, 3, 4]);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(raw.destroyed).toBe(false);
  });

  it('waits for the final historical frame to drain before ending a finite stream', async () => {
    const raw = new SlowResponse();
    raw.blockAt = 4;
    await connect(raw, true);
    expect(raw.sequences()).toEqual([1, 2, 3]);
    expect(raw.writableEnded).toBe(false);
    raw.drain();
    expect(raw.writableEnded).toBe(true);
    expect(raw.destroyed).toBe(false);
    expect(raw.listenerCount('drain')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('applies backpressure to live events after history finishes', async () => {
    const raw = new SlowResponse();
    await connect(raw, false, 3);
    globalEventBus.emit(gameId, event(4));
    globalEventBus.emit(gameId, event(5));
    expect(raw.sequences()).toEqual([4]);
    raw.drain();
    expect(raw.sequences()).toEqual([4, 5]);
  });

  it('bounds queued live bytes and destroys an overflowing slow connection', async () => {
    const raw = new SlowResponse();
    await connect(raw);
    globalEventBus.emit(gameId, event(4, { text: '中'.repeat(200_000) }));
    expect(raw.destroyed).toBe(false);
    globalEventBus.emit(gameId, event(5, { text: '中'.repeat(200_000) }));
    expect(raw.destroyed).toBe(true);
    expect(raw.sequences()).toEqual([1]);
    expect(raw.listenerCount('drain')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(renderMetrics()).toContain('tactical_sse_disconnect_total{reason="buffer_limit"} 1');
  });

  it('times out blocked history without heartbeat writes or retained quotas', async () => {
    const raw = new SlowResponse();
    await connect(raw);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(raw.destroyed).toBe(true);
    expect(raw.frames).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
    expect(renderMetrics()).toContain('tactical_sse_connections 0');
    expect(renderMetrics()).toContain('tactical_sse_disconnect_total{reason="drain_timeout"} 1');
    const replacement = new SlowResponse();
    replacement.blockAt = 0;
    await connect(replacement, true);
    expect(replacement.sequences()).toEqual([1, 2, 3]);
  });

  it.each(['close', 'error'])('cleans up a response %s while waiting for drain', async kind => {
    const raw = new SlowResponse();
    await connect(raw);
    raw.emit(kind);
    raw.drain();
    globalEventBus.emit(gameId, event(4));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(raw.sequences()).toEqual([1]);
    expect(raw.listenerCount('drain')).toBe(0);
    expect(raw.listenerCount('close')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(renderMetrics()).toContain('tactical_sse_connections 0');
  });

  it('cleans up synchronous socket write errors', async () => {
    const raw = new SlowResponse();
    raw.throwOnWrite = true;
    await connect(raw);
    expect(raw.destroyed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(renderMetrics()).toContain('tactical_sse_connections 0');
  });
});
