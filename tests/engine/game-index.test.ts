import { describe, expect, it } from 'vitest';
import { createInitialGame } from '../../src/state/store.js';
import { EventBus } from '../../src/events/bus.js';
import { moveUnit } from '../../src/engine/units.js';
import {
  findReachableCells, getCellOccupant, getTerrain, isInBounds,
} from '../../src/engine/validation.js';
import { getGameIndex } from '../../src/engine/gameIndex.js';
import type { GameState, Position, Unit } from '../../src/types.js';

function naiveTerrain(game: GameState, q: number, r: number): string {
  const override = game.map.terrainCells.find(cell => cell.q === q && cell.r === r);
  if (override) return override.terrain;
  return game.cells.find(cell => cell.q === q && cell.r === r)?.terrain ?? 'blocker';
}

function naiveInBounds(game: GameState, q: number, r: number): boolean {
  return game.cells.some(cell => cell.q === q && cell.r === r);
}

function naiveOccupant(game: GameState, q: number, r: number): string | null {
  const unit = game.units.find(candidate => candidate.alive && candidate.q === q && candidate.r === r);
  if (unit) return `unit:${unit.id}`;
  const hq = Object.values(game.headquarters).find(candidate => candidate.alive && candidate.q === q && candidate.r === r);
  return hq ? `hq:${hq.id}` : null;
}

function indexOccupant(game: GameState, q: number, r: number): string | null {
  const occupant = getCellOccupant(game, q, r);
  if (!occupant) return null;
  return `${occupant.kind === 'unit' ? 'unit' : 'hq'}:${occupant.entity.id}`;
}

function naiveReachable(game: GameState, unit: Unit): Position[] {
  const visited = new Set<string>([`${unit.q},${unit.r}`]);
  const result: Position[] = [];
  const queue: { pos: Position; distance: number }[] = [{ pos: { q: unit.q, r: unit.r }, distance: 0 }];
  const directions = [
    { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
    { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
  ];
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i]!;
    if (current.distance >= unit.moveRange) continue;
    for (const direction of directions) {
      const next = { q: current.pos.q + direction.q, r: current.pos.r + direction.r };
      const key = `${next.q},${next.r}`;
      if (visited.has(key)) continue;
      visited.add(key);
      if (!naiveInBounds(game, next.q, next.r)) continue;
      if (naiveTerrain(game, next.q, next.r) !== 'plain') continue;
      if (naiveOccupant(game, next.q, next.r) !== null) continue;
      result.push(next);
      queue.push({ pos: next, distance: current.distance + 1 });
    }
  }
  return result;
}

function sortPositions(positions: Position[]): string[] {
  return positions.map(pos => `${pos.q},${pos.r}`).sort();
}

function assertIndexMatches(game: GameState): void {
  for (const cell of game.cells) {
    expect(getTerrain(game, cell.q, cell.r)).toBe(naiveTerrain(game, cell.q, cell.r));
    expect(isInBounds(game, cell.q, cell.r)).toBe(true);
    expect(indexOccupant(game, cell.q, cell.r)).toBe(naiveOccupant(game, cell.q, cell.r));
  }
  expect(isInBounds(game, 99, 99)).toBe(false);
  for (const unit of game.units) {
    expect(sortPositions(findReachableCells(game, unit))).toEqual(sortPositions(naiveReachable(game, unit)));
  }
}

describe('game index', () => {
  it('matches the previous linear implementations before and after a move', () => {
    const game = createInitialGame('index-equivalence');
    assertIndexMatches(game);
    expect(game.stateVersion).toBeUndefined();

    const bus = new EventBus();
    const unit = game.units.find(candidate => candidate.alive)!;
    const target = findReachableCells(game, unit)[0];
    if (target) {
      const result = moveUnit(game, bus, unit.owner, unit.id, target.q, target.r);
      expect(result.ok).toBe(true);
      expect(game.stateVersion).toBeGreaterThan(0);
    }
    assertIndexMatches(game);
  });

  it('keeps dead units retrievable by id but out of the occupancy map', () => {
    const game = createInitialGame('index-dead');
    const unit = game.units.find(candidate => candidate.alive)!;
    unit.alive = false;
    game.stateVersion = (game.stateVersion ?? 0) + 1;

    const index = getGameIndex(game);
    expect(index.unitById.get(unit.id)).toBe(unit);
    expect(index.occupants.has(`${unit.q},${unit.r}`)).toBe(false);
    expect(getCellOccupant(game, unit.q, unit.r)).toBeNull();
  });
});
