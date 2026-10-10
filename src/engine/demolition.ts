import type { GameState, PlayerId } from '../types.js';
import type { EventBus } from '../events/bus.js';
import type { Result } from './result.js';
import { appendEvent } from './events.js';
import { hexDistance } from './hex.js';
import { actionsRemaining, consumeAction, getCellOccupant, getTerrain, isInBounds } from './validation.js';

function setTerrain(game: GameState, q: number, r: number, terrain: 'plain'): void {
  const cell = game.cells.find(c => c.q === q && c.r === r);
  if (cell) cell.terrain = terrain;

  const override = game.map.terrainCells.find(c => c.q === q && c.r === r);
  if (override) {
    override.terrain = terrain;
  } else {
    game.map.terrainCells.push({ q, r, terrain });
  }
}

export function demolishTerrain(
  game: GameState,
  bus: EventBus,
  owner: PlayerId,
  unitId: string,
  q: number,
  r: number,
): Result {
  const unit = game.units.find(u => u.id === unitId && u.owner === owner && u.alive);
  if (!unit) return { ok: false, code: 'unit_not_found', message: 'unit not found' };
  if (unit.type !== 'heavy') return { ok: false, code: 'invalid_demolish', message: 'only heavy units can demolish terrain' };
  if (unit.hasActed) return { ok: false, code: 'invalid_demolish', message: 'already acted this turn' };
  if (hexDistance(unit, { q, r }) > 1) return { ok: false, code: 'invalid_demolish', message: 'target must be adjacent' };
  if (!isInBounds(game, q, r)) return { ok: false, code: 'invalid_demolish', message: 'target must be in bounds' };
  if (getTerrain(game, q, r) !== 'blocker') return { ok: false, code: 'invalid_demolish', message: 'target terrain is not blocker' };
  if (getCellOccupant(game, q, r) !== null) return { ok: false, code: 'invalid_demolish', message: 'target cell is occupied' };

  const spent = consumeAction(game, unit);
  if (!spent.ok) return spent;

  setTerrain(game, q, r, 'plain');
  unit.hasActed = true;
  appendEvent(game, bus, 'demolish', {
    unitId,
    owner,
    q,
    r,
    fromTerrain: 'blocker',
    toTerrain: 'plain',
    actionsUsed: game.turn.actionsUsed,
    actionsRemaining: actionsRemaining(game),
  });
  return { ok: true };
}
