// src/engine/events.ts
import type { GameState, GameEvent, EventType } from '../types.js';
import type { EventBus } from '../events/bus.js';

export function appendEvent(
  game: GameState,
  bus: EventBus,
  type: EventType,
  payload: Record<string, unknown>,
): GameEvent {
  const event: GameEvent = {
    seq: game.events.length + 1,
    type,
    timestamp: Date.now(),
    payload: structuredClone(payload),
  };
  game.events.push(event);
  bus.emit(game.id, event);
  return event;
}
