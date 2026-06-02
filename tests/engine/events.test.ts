// tests/engine/events.test.ts
import { describe, it, expect, vi } from 'vitest';
import { appendEvent } from '../../src/engine/events.js';
import { createInitialGame } from '../../src/state/store.js';
import { EventBus } from '../../src/events/bus.js';

describe('appendEvent', () => {
  it('appends event with sequential seq starting at 1', () => {
    const game = createInitialGame('g1');
    const bus = new EventBus();
    const ev1 = appendEvent(game, bus, 'move', { foo: 1 });
    const ev2 = appendEvent(game, bus, 'attack', { bar: 2 });
    expect(ev1.seq).toBe(1);
    expect(ev2.seq).toBe(2);
    expect(game.events).toHaveLength(2);
  });

  it('stores payload and timestamp on the event', () => {
    const game = createInitialGame('g1');
    const bus = new EventBus();
    const ev = appendEvent(game, bus, 'mine', { gold: 15 });
    expect(ev.payload).toEqual({ gold: 15 });
    expect(typeof ev.timestamp).toBe('number');
  });

  it('emits event through bus to subscribers', () => {
    const game = createInitialGame('g1');
    const bus = new EventBus();
    const handler = vi.fn();
    bus.subscribe('g1', handler);
    appendEvent(game, bus, 'turn_end', {});
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].type).toBe('turn_end');
  });
});
