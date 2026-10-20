// src/engine/units.ts
import type { GameState, PlayerId } from '../types.js';
import type { EventBus } from '../events/bus.js';
import type { Result } from './result.js';
import { findReachableCells, consumeAction, actionsRemaining } from './validation.js';
import { getGameIndex } from './gameIndex.js';
import { appendEvent } from './events.js';

export function moveUnit(
  game: GameState,
  bus: EventBus,
  owner: PlayerId,
  unitId: string,
  q: number,
  r: number,
): Result {
  const unit = getGameIndex(game).unitById.get(unitId);
  if (!unit || unit.owner !== owner || !unit.alive) {
    return { ok: false, code: 'unit_not_found', message: '找不到该单位' };
  }
  if (unit.hasMoved) return { ok: false, code: 'invalid_move', message: '该单位本回合已经移动过' };
  if (unit.q === q && unit.r === r) return { ok: false, code: 'invalid_move', message: '目标格就是当前所在格' };

  const reachable = findReachableCells(game, unit);
  if (!reachable.some(pos => pos.q === q && pos.r === r)) {
    return { ok: false, code: 'invalid_move', message: '目标格无法到达' };
  }

  const spent = consumeAction(game, unit);
  if (!spent.ok) return spent;

  const fromQ = unit.q;
  const fromR = unit.r;
  unit.q = q;
  unit.r = r;
  unit.hasMoved = true;
  appendEvent(game, bus, 'move', {
    unitId: unit.id, owner, fromQ, fromR, toQ: q, toR: r,
    actionsUsed: game.turn.actionsUsed, actionsRemaining: actionsRemaining(game),
  });
  return { ok: true };
}
