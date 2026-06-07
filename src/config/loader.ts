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

function validateMap(id: string, config: unknown): asserts config is MapConfig {
  const c = config as Record<string, unknown>;
  for (const key of ['name', 'units', 'buildings', 'canProduce', 'economy', 'map', 'combat']) {
    if (!(key in c)) throw new Error(`Map "${id}" missing required key: "${key}"`);
  }
  const econ = c.economy as Record<string, unknown>;
  for (const key of ['startingGold', 'minerIncome', 'baseIncome']) {
    if (!(key in econ)) throw new Error(`Map "${id}" missing economy.${key}`);
  }
  const map = c.map as Record<string, unknown>;
  for (const key of ['width', 'height', 'buildRange', 'headquartersPositions', 'miningPoints', 'terrain']) {
    if (!(key in map)) throw new Error(`Map "${id}" missing map.${key}`);
  }
  const combat = c.combat as Record<string, unknown>;
  for (const key of ['damageVarianceRange', 'healBase', 'healVarianceRange', 'minimumDamage', 'healRange']) {
    if (!(key in combat)) throw new Error(`Map "${id}" missing combat.${key}`);
  }
  // Validate terrain dimensions
  const terrain = map.terrain as number[][];
  const w = map.width as number;
  const h = map.height as number;
  if (!Array.isArray(terrain) || terrain.length !== h) {
    throw new Error(`Map "${id}" terrain rows (${terrain?.length}) !== height (${h})`);
  }
  for (let y = 0; y < h; y++) {
    if (!Array.isArray(terrain[y]) || terrain[y].length !== w) {
      throw new Error(`Map "${id}" terrain row ${y} cols (${terrain[y]?.length}) !== width (${w})`);
    }
  }
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
