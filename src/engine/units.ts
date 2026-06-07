// src/engine/units.ts
import type { GameState, PlayerId } from '../types.js';
import type { EventBus } from '../events/bus.js';
import type { Result } from './building.js';
import { isInBounds, getCellOccupant, manhattanDistance, isPassable } from './validation.js';
import { appendEvent } from './events.js';

export function moveUnit(
  game: GameState,
  bus: EventBus,
  owner: PlayerId,
  unitId: string,
  toX: number,
  toY: number,
): Result {
  const unit = game.units.find(u => u.id === unitId && u.owner === owner && u.alive);
  if (!unit) {
    return { ok: false, code: 'unit_not_found', message: 'unit not found' };
  }
  if (unit.hasMoved) {
    return { ok: false, code: 'invalid_move', message: 'already moved this turn' };
  }
  if (!isInBounds(toX, toY, game.mapWidth, game.mapHeight)) {
    return { ok: false, code: 'invalid_move', message: 'out of bounds' };
  }
  if (unit.x === toX && unit.y === toY) {
    return { ok: false, code: 'invalid_move', message: 'same cell' };
  }
  const dist = manhattanDistance({ x: unit.x, y: unit.y }, { x: toX, y: toY });
  if (dist > unit.moveRange) {
    return { ok: false, code: 'invalid_move', message: `target too far (${dist} > ${unit.moveRange})` };
  }
  if (!isPassable(game, toX, toY)) {
    return { ok: false, code: 'invalid_move', message: 'target cell is impassable terrain' };
  }
  if (getCellOccupant(game, toX, toY) !== null) {
    return { ok: false, code: 'cell_occupied', message: 'target cell occupied' };
  }

  const fromX = unit.x, fromY = unit.y;
  unit.x = toX;
  unit.y = toY;
  unit.hasMoved = true;
  appendEvent(game, bus, 'move', {
    unitId: unit.id, owner, fromX, fromY, toX, toY,
  });
  return { ok: true };
}
