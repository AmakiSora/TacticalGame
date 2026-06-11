// src/config/loader.ts
import { readFileSync, readdirSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

export interface UnitSpec {
  hp: number;
  attack: number;
  defense: number;
  moveRange: number;
  attackRange: number;
  cost: number;
  productionTime: number;
}

export interface BuildingSpec {
  hp: number;
  cost: number;
  buildTime: number;
  attack?: number;
  defense?: number;
  attackRange?: number;
  attacksPerTurn?: number;
}

export interface MapConfig {
  name: string;
  description: string;
  units: Record<string, UnitSpec>;
  buildings: Record<string, BuildingSpec>;
  canProduce: Record<string, string[]>;
  economy: {
    startingGold: number;
    minerIncome: number;
    baseIncome: number;
  };
  map: {
    width: number;
    height: number;
    buildRange: number;
    headquartersPositions: Record<string, { x: number; y: number }>;
    miningPoints: { x: number; y: number }[];
    terrain: number[][];
  };
  combat: {
    damageVarianceRange: number;
    healBase: number;
    healVarianceRange: number;
    minimumDamage: number;
    healRange: number;
  };
}

export type GameBalanceConfig = MapConfig;

const maps = new Map<string, MapConfig>();

function assertPositiveInt(obj: Record<string, unknown>, key: string, ctx: string): number {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
    throw new Error(`${ctx}.${key} must be a non-negative number, got: ${v}`);
  }
  return v;
}

function assertPositive(obj: Record<string, unknown>, key: string, ctx: string): number {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
    throw new Error(`${ctx}.${key} must be a positive number, got: ${v}`);
  }
  return v;
}

function validateMap(id: string, config: unknown): asserts config is MapConfig {
  const c = config as Record<string, unknown>;
  for (const key of ['name', 'units', 'buildings', 'canProduce', 'economy', 'map', 'combat']) {
    if (!(key in c)) throw new Error(`Map "${id}" missing required key: "${key}"`);
  }
  if (typeof c.name !== 'string') throw new Error(`Map "${id}" name must be a string`);

  // Validate units
  const units = c.units as Record<string, unknown>;
  if (typeof units !== 'object' || units === null) throw new Error(`Map "${id}" units must be an object`);
  const unitKeys = ['hp', 'attack', 'defense', 'moveRange', 'attackRange', 'cost', 'productionTime'];
  for (const [unitType, spec] of Object.entries(units)) {
    const s = spec as Record<string, unknown>;
    for (const k of unitKeys) {
      assertPositiveInt(s, k, `units.${unitType}`);
    }
  }

  // Validate buildings
  const buildings = c.buildings as Record<string, unknown>;
  if (typeof buildings !== 'object' || buildings === null) throw new Error(`Map "${id}" buildings must be an object`);
  const buildingKeys = ['hp', 'cost', 'buildTime'];
  const attackKeys = ['attack', 'defense', 'attackRange', 'attacksPerTurn'];
  for (const [bType, spec] of Object.entries(buildings)) {
    const s = spec as Record<string, unknown>;
    for (const k of buildingKeys) {
      assertPositiveInt(s, k, `buildings.${bType}`);
    }
    const hasAnyAttack = attackKeys.some(k => k in s);
    if (hasAnyAttack) {
      for (const k of attackKeys) {
        if (!(k in s)) {
          throw new Error(`buildings.${bType} has some attack keys but missing "${k}" — all of ${attackKeys.join(', ')} required together`);
        }
        assertPositiveInt(s, k, `buildings.${bType}`);
      }
    }
  }

  // Validate canProduce references
  const canProduce = c.canProduce as Record<string, unknown>;
  if (typeof canProduce !== 'object' || canProduce === null) throw new Error(`Map "${id}" canProduce must be an object`);
  for (const [bType, produces] of Object.entries(canProduce)) {
    if (!(bType in buildings)) throw new Error(`Map "${id}" canProduce references unknown building "${bType}"`);
    if (!Array.isArray(produces)) throw new Error(`Map "${id}" canProduce.${bType} must be an array`);
    for (const uType of produces) {
      if (typeof uType !== 'string' || !(uType in units)) {
        throw new Error(`Map "${id}" canProduce.${bType} references unknown unit "${uType}"`);
      }
    }
  }

  // Validate economy
  const econ = c.economy as Record<string, unknown>;
  assertPositiveInt(econ, 'startingGold', `Map "${id}" economy`);
  assertPositiveInt(econ, 'minerIncome', `Map "${id}" economy`);
  assertPositiveInt(econ, 'baseIncome', `Map "${id}" economy`);

  // Validate map
  const map = c.map as Record<string, unknown>;
  for (const key of ['width', 'height', 'buildRange', 'headquartersPositions', 'miningPoints', 'terrain']) {
    if (!(key in map)) throw new Error(`Map "${id}" missing map.${key}`);
  }
  const w = assertPositive(map, 'width', `Map "${id}" map`);
  const h = assertPositive(map, 'height', `Map "${id}" map`);
  assertPositiveInt(map, 'buildRange', `Map "${id}" map`);

  // Validate terrain dimensions and values
  const terrain = map.terrain as number[][];
  if (!Array.isArray(terrain) || terrain.length !== h) {
    throw new Error(`Map "${id}" terrain rows (${terrain?.length}) !== height (${h})`);
  }
  for (let y = 0; y < h; y++) {
    if (!Array.isArray(terrain[y]) || terrain[y].length !== w) {
      throw new Error(`Map "${id}" terrain row ${y} cols (${terrain[y]?.length}) !== width (${w})`);
    }
    for (let x = 0; x < w; x++) {
      const v = terrain[y][x];
      if (v !== 0 && v !== 1 && v !== 2) {
        throw new Error(`Map "${id}" terrain[${y}][${x}] must be 0, 1, or 2, got: ${v}`);
      }
    }
  }

  // Validate HQ positions
  const hqPos = map.headquartersPositions as Record<string, unknown>;
  if (typeof hqPos !== 'object' || hqPos === null) throw new Error(`Map "${id}" headquartersPositions must be an object`);
  for (const owner of ['player_a', 'player_b']) {
    const pos = hqPos[owner] as Record<string, unknown> | undefined;
    if (!pos || typeof pos !== 'object') throw new Error(`Map "${id}" missing headquartersPositions.${owner}`);
    const px = assertPositiveInt(pos, 'x', `headquartersPositions.${owner}`);
    const py = assertPositiveInt(pos, 'y', `headquartersPositions.${owner}`);
    if (px >= w || py >= h) throw new Error(`Map "${id}" headquartersPositions.${owner} (${px},${py}) out of bounds`);
  }

  // Validate mining points
  const miningPoints = map.miningPoints as unknown[];
  if (!Array.isArray(miningPoints)) throw new Error(`Map "${id}" miningPoints must be an array`);
  for (let i = 0; i < miningPoints.length; i++) {
    const mp = miningPoints[i] as Record<string, unknown>;
    const mx = assertPositiveInt(mp, 'x', `miningPoints[${i}]`);
    const my = assertPositiveInt(mp, 'y', `miningPoints[${i}]`);
    if (mx >= w || my >= h) throw new Error(`Map "${id}" miningPoints[${i}] (${mx},${my}) out of bounds`);
  }

  // Validate combat
  const combat = c.combat as Record<string, unknown>;
  assertPositiveInt(combat, 'damageVarianceRange', `Map "${id}" combat`);
  assertPositiveInt(combat, 'healBase', `Map "${id}" combat`);
  assertPositiveInt(combat, 'healVarianceRange', `Map "${id}" combat`);
  assertPositiveInt(combat, 'minimumDamage', `Map "${id}" combat`);
  assertPositiveInt(combat, 'healRange', `Map "${id}" combat`);
}

export function loadMaps(mapsDir?: string): void {
  const dir = mapsDir ?? join(PROJECT_ROOT, 'maps');
  let files: string[];
  try {
    files = readdirSync(dir).filter(f => f.endsWith('.json'));
  } catch {
    throw new Error(`Cannot read maps directory at ${dir}`);
  }
  if (files.length === 0) {
    throw new Error(`No map files found in ${dir}`);
  }
  maps.clear();
  for (const file of files) {
    const id = basename(file, '.json');
    const filePath = join(dir, file);
    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf-8');
    } catch {
      throw new Error(`Cannot read map file ${filePath}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`Map file ${file} is not valid JSON`);
    }
    validateMap(id, parsed);
    maps.set(id, parsed as MapConfig);
  }
}

export function getMapConfig(id: string): MapConfig {
  const config = maps.get(id);
  if (!config) {
    throw new Error(`Map "${id}" not found. Available: ${[...maps.keys()].join(', ')}`);
  }
  return config;
}

export function listMaps(): { id: string; name: string; description: string }[] {
  return [...maps.entries()].map(([id, cfg]) => ({
    id,
    name: cfg.name,
    description: cfg.description,
  }));
}

export function getDefaultMapConfig(): MapConfig {
  return getMapConfig('default');
}

export function getConfig(): GameBalanceConfig {
  return getDefaultMapConfig();
}

export function resetConfig(): void {
  maps.clear();
}
