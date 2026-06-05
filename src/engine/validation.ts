// src/engine/validation.ts
import type { GameState, PlayerId, Position, Unit, Building } from '../types.js';
import { BUILD_RANGE, HQ_POSITIONS } from './specs.js';

export type Occupant =
  | { kind: 'unit'; entity: Unit }
  | { kind: 'building'; entity: Building };

export function manhattanDistance(a: Position, b: Position): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function isInBounds(x: number, y: number, w: number, h: number): boolean {
  return x >= 0 && x < w && y >= 0 && y < h;
}

export function getCellOccupant(game: GameState, x: number, y: number): Occupant | null {
  const unit = game.units.find(u => u.alive && u.x === x && u.y === y);
  if (unit) return { kind: 'unit', entity: unit };
  const building = game.buildings.find(b => b.alive && b.x === x && b.y === y);
  if (building) return { kind: 'building', entity: building };
  return null;
}

export function isInBuildRange(game: GameState, owner: PlayerId, x: number, y: number): boolean {
  const target = { x, y };
  for (const u of game.units) {
    if (u.owner !== owner || !u.alive) continue;
    if (manhattanDistance(u, target) <= BUILD_RANGE) return true;
  }
  for (const b of game.buildings) {
    if (b.owner !== owner || !b.alive) continue;
    if (manhattanDistance(b, target) <= BUILD_RANGE) return true;
  }
  return false;
}

export function isMiningPoint(game: GameState, x: number, y: number): boolean {
  return game.miningPoints.some(p => p.x === x && p.y === y);
}

export function findAdjacentFreeCell(game: GameState, x: number, y: number, owner?: PlayerId): Position | null {
  const candidates: Position[] = [
    { x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 },
  ];
  if (owner) {
    const hq = HQ_POSITIONS[owner];
    candidates.sort((a, b) => manhattanDistance(b, hq) - manhattanDistance(a, hq));
  }
  for (const c of candidates) {
    if (!isInBounds(c.x, c.y, game.mapWidth, game.mapHeight)) continue;
    if (getCellOccupant(game, c.x, c.y) === null) return c;
  }
  return null;
}
