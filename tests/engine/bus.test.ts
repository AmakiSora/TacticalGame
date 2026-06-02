// tests/engine/bus.test.ts
import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../../src/events/bus.js';
import type { GameEvent } from '../../src/types.js';

describe('EventBus', () => {
  it('emits events to subscribers of the same gameId', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.subscribe('game1', handler);

    const evt: GameEvent = { seq: 1, type: 'move', timestamp: Date.now(), payload: {} };
    bus.emit('game1', evt);

    expect(handler).toHaveBeenCalledWith(evt);
  });

  it('does not deliver events to other gameId subscribers', () => {
    const bus = new EventBus();
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    bus.subscribe('gameA', handlerA);
    bus.subscribe('gameB', handlerB);

    bus.emit('gameA', { seq: 1, type: 'move', timestamp: 0, payload: {} });

    expect(handlerA).toHaveBeenCalledOnce();
    expect(handlerB).not.toHaveBeenCalled();
  });

  it('unsubscribe removes the handler', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    const unsub = bus.subscribe('g1', handler);
    unsub();
    bus.emit('g1', { seq: 1, type: 'move', timestamp: 0, payload: {} });
    expect(handler).not.toHaveBeenCalled();
  });
});
