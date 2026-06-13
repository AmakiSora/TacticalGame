// src/config/loader.ts
import { readFileSync, readdirSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PlayerId, TerrainType, UnitType } from '../types.js';
import { isValidHex } from '../engine/hex.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

export interface UnitSpec {
  hp: number;
  attack: number;
  defense: number;
  moveRange: number;
  attackRange: number;
  cost: number;
  canCapture: boolean;
  healPower?: number;
}

export interface HeadquartersSpec {
  hp: number;
  defense: number;
}

export interface TerrainCellConfig {
  q: number;
  r: number;
  terrain: TerrainType;
}

export interface ControlPointConfig {
  id: string;
  name: string;
  q: number;
  r: number;
}

export interface StartingUnitConfig {
  owner: PlayerId;
  type: UnitType;
  q: number;
  r: number;
}

export interface MapConfig {
  name: string;
  description: string;
  grid: 'hex';
  orientation: 'pointy';
  radius: number;
  terrainCells: TerrainCellConfig[];
  controlPoints: ControlPointConfig[];
  headquarters: Record<PlayerId, { q: number; r: number }>;
  startingUnits: StartingUnitConfig[];
  units: Record<UnitType, UnitSpec>;
  headquartersSpec: HeadquartersSpec;
  balance: {
    startingSupplies: number;
    baseIncome: number;
    controlPointIncome: number;
    damageVarianceRange: number;
    minimumDamage: number;
    healVarianceRange: number;
  };
}

const maps = new Map<string, MapConfig>();

function asRecord(value: unknown, ctx: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${ctx} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertString(obj: Record<string, unknown>, key: string, ctx: string): string {
  const value = obj[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${ctx}.${key} must be a non-empty string`);
  }
  return value;
}

function assertNumber(obj: Record<string, unknown>, key: string, ctx: string, min = 0): number {
  const value = obj[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) {
    throw new Error(`${ctx}.${key} must be a number >= ${min}`);
  }
  return value;
}

function assertPosition(obj: Record<string, unknown>, ctx: string, radius: number): { q: number; r: number } {
  const q = assertNumber(obj, 'q', ctx, -Infinity);
  const r = assertNumber(obj, 'r', ctx, -Infinity);
  if (!Number.isInteger(q) || !Number.isInteger(r)) throw new Error(`${ctx} q/r must be integers`);
  if (!isValidHex({ q, r }, radius)) throw new Error(`${ctx} (${q},${r}) is outside radius ${radius}`);
  return { q, r };
}

function validateMap(id: string, config: unknown): asserts config is MapConfig {
  const c = asRecord(config, `Map "${id}"`);
  const name = assertString(c, 'name', `Map "${id}"`);
  const description = assertString(c, 'description', `Map "${id}"`);
  if (c.grid !== 'hex') throw new Error(`Map "${id}" grid must be "hex"`);
  if (c.orientation !== 'pointy') throw new Error(`Map "${id}" orientation must be "pointy"`);
  const radius = assertNumber(c, 'radius', `Map "${id}"`, 1);
  if (!Number.isInteger(radius)) throw new Error(`Map "${id}" radius must be an integer`);

  const units = asRecord(c.units, `Map "${id}".units`) as Record<UnitType, UnitSpec>;
  for (const type of ['infantry', 'scout', 'heavy', 'ranger', 'support'] as UnitType[]) {
    const spec = asRecord(units[type], `units.${type}`);
    for (const key of ['hp', 'attack', 'defense', 'moveRange', 'attackRange', 'cost']) {
      assertNumber(spec, key, `units.${type}`, 0);
    }
    if (typeof spec.canCapture !== 'boolean') throw new Error(`units.${type}.canCapture must be boolean`);
    if ('healPower' in spec) assertNumber(spec, 'healPower', `units.${type}`, 0);
  }

  const hqSpec = asRecord(c.headquartersSpec, `Map "${id}".headquartersSpec`);
  assertNumber(hqSpec, 'hp', `Map "${id}".headquartersSpec`, 1);
  assertNumber(hqSpec, 'defense', `Map "${id}".headquartersSpec`, 0);

  const balance = asRecord(c.balance, `Map "${id}".balance`);
  for (const key of ['startingSupplies', 'baseIncome', 'controlPointIncome', 'damageVarianceRange', 'minimumDamage', 'healVarianceRange']) {
    assertNumber(balance, key, `Map "${id}".balance`, 0);
  }

  const hq = asRecord(c.headquarters, `Map "${id}".headquarters`);
  for (const player of ['player_a', 'player_b'] as PlayerId[]) {
    assertPosition(asRecord(hq[player], `headquarters.${player}`), `headquarters.${player}`, radius);
  }

  const occupied = new Set<string>();
  function claim(pos: { q: number; r: number }, ctx: string) {
    const key = `${pos.q},${pos.r}`;
    if (occupied.has(key)) throw new Error(`${ctx} overlaps another fixed map object at ${key}`);
    occupied.add(key);
  }
  claim(hq.player_a as { q: number; r: number }, 'headquarters.player_a');
  claim(hq.player_b as { q: number; r: number }, 'headquarters.player_b');

  if (!Array.isArray(c.terrainCells)) throw new Error(`Map "${id}".terrainCells must be an array`);
  for (let i = 0; i < c.terrainCells.length; i++) {
    const cell = asRecord(c.terrainCells[i], `terrainCells[${i}]`);
    assertPosition(cell, `terrainCells[${i}]`, radius);
    if (cell.terrain !== 'water' && cell.terrain !== 'blocker' && cell.terrain !== 'plain') {
      throw new Error(`terrainCells[${i}].terrain must be plain, water, or blocker`);
    }
  }

  if (!Array.isArray(c.controlPoints) || c.controlPoints.length === 0) {
    throw new Error(`Map "${id}".controlPoints must be a non-empty array`);
  }
  for (let i = 0; i < c.controlPoints.length; i++) {
    const cp = asRecord(c.controlPoints[i], `controlPoints[${i}]`);
    assertString(cp, 'id', `controlPoints[${i}]`);
    assertString(cp, 'name', `controlPoints[${i}]`);
    const pos = assertPosition(cp, `controlPoints[${i}]`, radius);
    claim(pos, `controlPoints[${i}]`);
  }

  if (!Array.isArray(c.startingUnits)) throw new Error(`Map "${id}".startingUnits must be an array`);
  for (let i = 0; i < c.startingUnits.length; i++) {
    const unit = asRecord(c.startingUnits[i], `startingUnits[${i}]`);
    if (unit.owner !== 'player_a' && unit.owner !== 'player_b') throw new Error(`startingUnits[${i}].owner invalid`);
    if (!['infantry', 'scout', 'heavy', 'ranger', 'support'].includes(String(unit.type))) {
      throw new Error(`startingUnits[${i}].type invalid`);
    }
    const pos = assertPosition(unit, `startingUnits[${i}]`, radius);
    claim(pos, `startingUnits[${i}]`);
  }

  void name;
  void description;
}

export function loadMaps(mapsDir?: string): void {
  const dir = mapsDir ?? join(PROJECT_ROOT, 'maps');
  let files: string[];
  try {
    files = readdirSync(dir).filter(f => f.endsWith('.json'));
  } catch {
    throw new Error(`Cannot read maps directory at ${dir}`);
  }
  if (files.length === 0) throw new Error(`No map files found in ${dir}`);
  maps.clear();
  for (const file of files) {
    const id = basename(file, '.json');
    const raw = readFileSync(join(dir, file), 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    validateMap(id, parsed);
    maps.set(id, parsed as MapConfig);
  }
}

export function getMapConfig(id: string): MapConfig {
  const config = maps.get(id);
  if (!config) throw new Error(`Map "${id}" not found. Available: ${[...maps.keys()].join(', ')}`);
  return config;
}

export function listMaps(): { id: string; name: string; description: string }[] {
  return [...maps.entries()].map(([id, cfg]) => ({ id, name: cfg.name, description: cfg.description }));
}

export function getDefaultMapConfig(): MapConfig {
  return getMapConfig('default');
}

export function resetConfig(): void {
  maps.clear();
}
