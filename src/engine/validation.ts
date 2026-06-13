// src/engine/validation.ts
import type { GameState, Position, Unit, Headquarters, TerrainType } from '../types.js';
import { hexDistance, hexKey, hexNeighbors, isValidHex } from './hex.js';

export type Occupant =
  | { kind: 'unit'; entity: Unit }
  | { kind: 'headquarters'; entity: Headquarters };

export { hexDistance };

export function getTerrain(game: GameState, q: number, r: number): TerrainType {
  const override = game.map.terrainCells.find(c => c.q === q && c.r === r);
  if (override) return override.terrain;
  return game.cells.find(c => c.q === q && c.r === r)?.terrain ?? 'blocker';
}

export function isInBounds(game: GameState, q: number, r: number): boolean {
  return isValidHex({ q, r }, game.map.radius);
}

export function isPassable(game: GameState, q: number, r: number): boolean {
  return isInBounds(game, q, r) && getTerrain(game, q, r) === 'plain';
}

export function isDeployable(game: GameState, q: number, r: number): boolean {
  return isPassable(game, q, r) && getCellOccupant(game, q, r) === null;
}

export function getCellOccupant(game: GameState, q: number, r: number): Occupant | null {
  const unit = game.units.find(u => u.alive && u.q === q && u.r === r);
  if (unit) return { kind: 'unit', entity: unit };
  const hq = Object.values(game.headquarters).find(h => h.alive && h.q === q && h.r === r);
  if (hq) return { kind: 'headquarters', entity: hq };
  return null;
}

export function findReachableCells(game: GameState, unit: Unit): Position[] {
  const visited = new Set<string>([hexKey(unit)]);
  const result: Position[] = [];
  const queue: { pos: Position; distance: number }[] = [{ pos: { q: unit.q, r: unit.r }, distance: 0 }];

  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    if (current.distance >= unit.moveRange) continue;
    for (const next of hexNeighbors(current.pos)) {
      const key = hexKey(next);
      if (visited.has(key)) continue;
      visited.add(key);
      if (!isPassable(game, next.q, next.r)) continue;
      if (getCellOccupant(game, next.q, next.r) !== null) continue;
      result.push(next);
      queue.push({ pos: next, distance: current.distance + 1 });
    }
  }

  return result;
}

export function findAdjacentDeployCell(game: GameState, origin: Position): Position | null {
  return hexNeighbors(origin).find(pos => isDeployable(game, pos.q, pos.r)) ?? null;
}
