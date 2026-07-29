import type { MapCell, Position, TerrainType } from '../types.js';
import { hexKey, hexNeighbors, isValidHex } from '../engine/hex.js';

export interface TerrainOverride extends Position {
  terrain: TerrainType;
}

// 旧地图仍以 radius 描述完整六边形；加载时统一展开为权威格子列表。
export function createRadiusPlayableCells(radius: number): Position[] {
  const cells: Position[] = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      if (isValidHex({ q, r }, radius)) cells.push({ q, r });
    }
  }
  return cells;
}

export function hasPlayableCell(cells: readonly Position[], q: number, r: number): boolean {
  return cells.some(cell => cell.q === q && cell.r === r);
}

export function createMapCells(
  playableCells: readonly Position[],
  terrainCells: readonly TerrainOverride[],
): MapCell[] {
  const terrain = new Map(terrainCells.map(cell => [hexKey(cell), cell.terrain]));
  return playableCells.map(cell => ({
    q: cell.q,
    r: cell.r,
    terrain: terrain.get(hexKey(cell)) ?? 'plain',
  }));
}

export function arePlayableCellsConnected(cells: readonly Position[]): boolean {
  if (cells.length === 0) return false;
  const remaining = new Set(cells.map(hexKey));
  const queue: Position[] = [{ ...cells[0] }];
  remaining.delete(hexKey(cells[0]));
  for (let index = 0; index < queue.length; index++) {
    for (const neighbor of hexNeighbors(queue[index])) {
      const key = hexKey(neighbor);
      if (!remaining.delete(key)) continue;
      queue.push(neighbor);
    }
  }
  return remaining.size === 0;
}
