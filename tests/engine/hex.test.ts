import { describe, expect, it } from 'vitest';
import { hexDistance, hexNeighbors, hexRange, isValidHex } from '../../src/engine/hex.js';

describe('hex geometry', () => {
  it('computes axial hex distance', () => {
    expect(hexDistance({ q: 0, r: 0 }, { q: 3, r: -2 })).toBe(3);
    expect(hexDistance({ q: -8, r: 0 }, { q: 8, r: 0 })).toBe(16);
    expect(hexDistance({ q: 2, r: -3 }, { q: 2, r: -3 })).toBe(0);
  });

  it('returns the six axial neighbors', () => {
    expect(hexNeighbors({ q: 0, r: 0 })).toEqual([
      { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
      { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
    ]);
  });

  it('validates cells inside a radius map', () => {
    expect(isValidHex({ q: 8, r: 0 }, 8)).toBe(true);
    expect(isValidHex({ q: 0, r: -8 }, 8)).toBe(true);
    expect(isValidHex({ q: 8, r: 1 }, 8)).toBe(false);
  });

  it('enumerates all cells in range', () => {
    const cells = hexRange({ q: 0, r: 0 }, 2);
    expect(cells).toHaveLength(19);
    expect(cells).toContainEqual({ q: 2, r: -1 });
    expect(cells).not.toContainEqual({ q: 3, r: 0 });
  });
});
