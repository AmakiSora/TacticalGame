// src/engine/hex.ts
import type { Position } from '../types.js';

export const HEX_DIRECTIONS: Position[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export function hexKey(pos: Position): string {
  return `${pos.q},${pos.r}`;
}

export function hexDistance(a: Position, b: Position): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  const ds = -a.q - a.r - (-b.q - b.r);
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds));
}

export function hexNeighbors(pos: Position): Position[] {
  return HEX_DIRECTIONS.map(d => ({ q: pos.q + d.q, r: pos.r + d.r }));
}

export function isValidHex(pos: Position, radius: number): boolean {
  const s = -pos.q - pos.r;
  return Math.max(Math.abs(pos.q), Math.abs(pos.r), Math.abs(s)) <= radius;
}

export function hexRange(center: Position, range: number): Position[] {
  const cells: Position[] = [];
  for (let dq = -range; dq <= range; dq++) {
    const minDr = Math.max(-range, -dq - range);
    const maxDr = Math.min(range, -dq + range);
    for (let dr = minDr; dr <= maxDr; dr++) {
      cells.push({ q: center.q + dq, r: center.r + dr });
    }
  }
  return cells;
}
