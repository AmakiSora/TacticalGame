// src/events/bus.ts
import type { GameEvent } from '../types.js';

export type EventHandler = (event: GameEvent) => void;

export class EventBus {
  private subscribers: Map<string, Set<EventHandler>> = new Map();

  subscribe(gameId: string, handler: EventHandler): () => void {
    if (!this.subscribers.has(gameId)) {
      this.subscribers.set(gameId, new Set());
    }
    this.subscribers.get(gameId)!.add(handler);
    return () => this.unsubscribe(gameId, handler);
  }

  unsubscribe(gameId: string, handler: EventHandler): void {
    this.subscribers.get(gameId)?.delete(handler);
  }

  emit(gameId: string, event: GameEvent): void {
    const handlers = this.subscribers.get(gameId);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        handler(event);
      } catch (err) {
        console.error('Event handler error:', err);
      }
    }
  }

  clear(gameId: string): void {
    this.subscribers.delete(gameId);
  }
}

export const globalEventBus = new EventBus();
