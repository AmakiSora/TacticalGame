// tests/engine/validation.test.ts
import { describe, it, expect } from 'vitest';
import {
  manhattanDistance,
  isInBounds,
  getCellOccupant,
  isInBuildRange,
  isMiningPoint,
  findAdjacentFreeCell,
} from '../../src/engine/validation.js';
import { createInitialGame } from '../../src/state/store.js';

describe('validation', () => {
  it('manhattanDistance computes correctly', () => {
    expect(manhattanDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(7);
    expect(manhattanDistance({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(0);
  });

  it('isInBounds returns true for valid cells', () => {
    expect(isInBounds(0, 0, 30, 30)).toBe(true);
    expect(isInBounds(29, 29, 30, 30)).toBe(true);
  });

  it('isInBounds returns false for out-of-bounds cells', () => {
    expect(isInBounds(-1, 0, 30, 30)).toBe(false);
    expect(isInBounds(30, 0, 30, 30)).toBe(false);
    expect(isInBounds(0, 30, 30, 30)).toBe(false);
  });

  it('getCellOccupant returns HQ at its location', () => {
    const game = createInitialGame('g1');
    const occ = getCellOccupant(game, 3, 10);
    expect(occ?.kind).toBe('building');
    expect((occ as any).entity.type).toBe('headquarters');
  });

  it('getCellOccupant returns null for empty cells', () => {
    const game = createInitialGame('g1');
    expect(getCellOccupant(game, 0, 0)).toBeNull();
  });

  it('isInBuildRange returns true near friendly HQ', () => {
    const game = createInitialGame('g1');
    expect(isInBuildRange(game, 'player_a', 4, 10)).toBe(true);
    expect(isInBuildRange(game, 'player_a', 3, 12)).toBe(true);
  });

  it('isInBuildRange returns false far from friendly objects', () => {
    const game = createInitialGame('g1');
    expect(isInBuildRange(game, 'player_a', 10, 10)).toBe(false);
  });

  it('isInBuildRange ignores enemy objects', () => {
    const game = createInitialGame('g1');
    expect(isInBuildRange(game, 'player_a', 16, 10)).toBe(false);
  });

  it('isMiningPoint identifies known mining points', () => {
    const game = createInitialGame('g1');
    expect(isMiningPoint(game, 6, 7)).toBe(true);
    expect(isMiningPoint(game, 0, 0)).toBe(false);
  });

  it('findAdjacentFreeCell returns a free neighbor', () => {
    const game = createInitialGame('g1');
    const cell = findAdjacentFreeCell(game, 3, 10);
    expect(cell).not.toBeNull();
    expect(manhattanDistance(cell!, { x: 3, y: 10 })).toBe(1);
  });
});
