// src/config/loader.ts
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
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

export interface GameBalanceConfig {
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
  };
  combat: {
    damageVarianceRange: number;
    healBase: number;
    healVarianceRange: number;
    minimumDamage: number;
    healRange: number;
  };
}

let cached: GameBalanceConfig | null = null;

function validate(config: unknown): asserts config is GameBalanceConfig {
  const c = config as Record<string, unknown>;
  const required = ['units', 'buildings', 'canProduce', 'economy', 'map', 'combat'];
  for (const key of required) {
    if (!(key in c)) {
      throw new Error(`game-balance.json missing required key: "${key}"`);
    }
  }
  const econ = c.economy as Record<string, unknown>;
  for (const key of ['startingGold', 'minerIncome', 'baseIncome']) {
    if (!(key in econ)) {
      throw new Error(`game-balance.json missing economy.${key}`);
    }
  }
  const map = c.map as Record<string, unknown>;
  for (const key of ['width', 'height', 'buildRange', 'headquartersPositions', 'miningPoints']) {
    if (!(key in map)) {
      throw new Error(`game-balance.json missing map.${key}`);
    }
  }
  const combat = c.combat as Record<string, unknown>;
  for (const key of ['damageVarianceRange', 'healBase', 'healVarianceRange', 'minimumDamage', 'healRange']) {
    if (!(key in combat)) {
      throw new Error(`game-balance.json missing combat.${key}`);
    }
  }
}

export function loadConfig(projectRoot?: string): GameBalanceConfig {
  if (cached) return cached;
  const root = projectRoot ?? PROJECT_ROOT;
  const filePath = join(root, 'game-balance.json');
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch {
    throw new Error(`Cannot read game-balance.json at ${filePath}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`game-balance.json is not valid JSON`);
  }
  validate(parsed);
  cached = parsed as GameBalanceConfig;
  return cached;
}

export function getConfig(): GameBalanceConfig {
  if (!cached) {
    throw new Error('Config not loaded. Call loadConfig() first.');
  }
  return cached;
}

export function resetConfig(): void {
  cached = null;
}
