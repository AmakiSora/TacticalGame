// src/engine/events.ts
import type { GameState, GameEvent, EventType } from '../types.js';
import type { EventBus } from '../events/bus.js';

/**
 * 追加一条事件到 game.events 并通过 bus 广播。
 *
 * 回合号自动注入：对局开始后（phase !== 'lobby'），若 payload 未显式携带
 * roundNumber，则自动补上 game.turn.roundNumber。这保证所有事件都能被下游
 * 按回合归属，修复了标准/歼灭模式行动事件（attack / move / deploy / heal /
 * demolish / income / unit_death 等）缺失 roundNumber 导致按回合统计时全部
 * 堆积到 R0 的 schema 不一致问题（simultaneous 模式已显式传入，不受影响）。
 */
export function appendEvent(
  game: GameState,
  bus: EventBus,
  type: EventType,
  payload: Record<string, unknown>,
): GameEvent {
  const cloned = structuredClone(payload);
  if (cloned.roundNumber === undefined && game.phase !== 'lobby') {
    cloned.roundNumber = game.turn.roundNumber;
  }
  const event: GameEvent = {
    seq: game.events.length + 1,
    type,
    timestamp: Date.now(),
    payload: cloned,
  };
  game.events.push(event);
  bus.emit(game.id, event);
  return event;
}
