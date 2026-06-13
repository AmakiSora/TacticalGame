// src/engine/units.ts
import type { GameState, PlayerId } from '../types.js';
import type { EventBus } from '../events/bus.js';
import type { Result } from './result.js';
import { findReachableCells } from './validation.js';
import { appendEvent } from './events.js';

export function moveUnit(
  game: GameState,
  bus: EventBus,
  owner: PlayerId,
  unitId: string,
  q: number,
  r: number,
): Result {
  const unit = game.units.find(u => u.id === unitId && u.owner === owner && u.alive);
  if (!unit) return { ok: false, code: 'unit_not_found', message: 'unit not found' };
  if (unit.hasMoved) return { ok: false, code: 'invalid_move', message: 'already moved this turn' };
  if (unit.q === q && unit.r === r) return { ok: false, code: 'invalid_move', message: 'same cell' };

  const reachable = findReachableCells(game, unit);
  if (!reachable.some(pos => pos.q === q && pos.r === r)) {
    return { ok: false, code: 'invalid_move', message: 'target is not reachable' };
  }

  const fromQ = unit.q;
  const fromR = unit.r;
  unit.q = q;
  unit.r = r;
  unit.hasMoved = true;
  appendEvent(game, bus, 'move', { unitId: unit.id, owner, fromQ, fromR, toQ: q, toR: r });
  return { ok: true };
}
