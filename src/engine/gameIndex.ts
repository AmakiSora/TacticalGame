// src/engine/gameIndex.ts
// 派生的棋盘/实体索引。索引不进入持久化，按 GameState.stateVersion 惰性重建；
// 任何成功变更都会在 appendEvent 中推进 stateVersion，因此下一次查询自动换新索引。
import type { GameState, Headquarters, MapCell, Position, TerrainType, Unit } from '../types.js';
import type { Occupant } from './validation.js';
import { hexKey } from './hex.js';

export interface GameIndex {
  /** 构建时的 stateVersion；与 GameState.stateVersion 不一致即重建。 */
  version: number;
  cells: Map<string, MapCell>;
  terrain: Map<string, TerrainType>;
  occupants: Map<string, Occupant>;
  danger: Set<string>;
  unitById: Map<string, Unit>;
  hqById: Map<string, Headquarters>;
  /** findReachableCells 的按单位缓存；随索引一起失效。 */
  reachable: Map<string, Position[]>;
}

const indexes = new WeakMap<GameState, GameIndex>();
const REACHABLE_CACHE_LIMIT = 512;

function versionOf(game: GameState): number {
  return game.stateVersion ?? 0;
}

function buildIndex(game: GameState, version: number): GameIndex {
  const cells = new Map<string, MapCell>();
  const terrain = new Map<string, TerrainType>();
  for (const cell of game.cells) {
    const key = hexKey(cell);
    cells.set(key, cell);
    terrain.set(key, cell.terrain);
  }
  // map.terrainCells 是地图覆盖层，优先于 cells；与 getTerrain 旧实现同序。
  for (const cell of game.map.terrainCells) {
    terrain.set(hexKey(cell), cell.terrain);
  }

  const unitById = new Map<string, Unit>();
  const hqById = new Map<string, Headquarters>();
  const occupants = new Map<string, Occupant>();
  // 旧实现按 units 数组顺序 find，第一个存活单位占位；保持同样顺序。
  for (const unit of game.units) {
    unitById.set(unit.id, unit);
    if (!unit.alive) continue;
    const key = hexKey(unit);
    if (!occupants.has(key)) occupants.set(key, { kind: 'unit', entity: unit });
  }
  for (const hq of Object.values(game.headquarters)) {
    hqById.set(hq.id, hq);
    if (!hq.alive) continue;
    const key = hexKey(hq);
    if (!occupants.has(key)) occupants.set(key, { kind: 'headquarters', entity: hq });
  }

  const danger = new Set<string>();
  for (const cell of game.artillery?.dangerCells ?? []) danger.add(hexKey(cell));

  return { version, cells, terrain, occupants, danger, unitById, hqById, reachable: new Map() };
}

export function getGameIndex(game: GameState): GameIndex {
  const cached = indexes.get(game);
  if (cached && cached.version === versionOf(game)) return cached;
  const index = buildIndex(game, versionOf(game));
  indexes.set(game, index);
  return index;
}

/** 仅测试/强制失效用；正常路径由 stateVersion 驱动。 */
export function invalidateGameIndex(game: GameState): void {
  indexes.delete(game);
}

/** 缓存一个单位在当前索引下的可达格；超出上限时丢弃最早条目。 */
export function cacheReachableText(index: GameIndex, key: string, cells: Position[]): Position[] {
  if (index.reachable.size >= REACHABLE_CACHE_LIMIT) {
    const oldest = index.reachable.keys().next().value;
    if (oldest !== undefined) index.reachable.delete(oldest);
  }
  index.reachable.set(key, cells);
  return cells;
}
