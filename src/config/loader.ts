// src/config/loader.ts
import { readFileSync, readdirSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ControlPointKind, PlayerId, TerrainType, UnitType } from '../types.js';
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
  kind?: ControlPointKind;
  q: number;
  r: number;
}

export interface ControlPointTypeSpec {
  income: number;
  deployDiscount: number;
  repairAmount: number;
}

export interface StartingUnitConfig {
  owner: PlayerId;
  type: UnitType;
  q: number;
  r: number;
}

export interface SpawnUnitConfig {
  type: UnitType;
  q: number;
  r: number;
}

export interface SpawnSlotConfig {
  id: string;
  headquarters: { q: number; r: number };
  startingUnits: SpawnUnitConfig[];
}

export interface MapConfig {
  name: string;
  description: string;
  grid: 'hex';
  orientation: 'pointy';
  radius: number;
  terrainCells: TerrainCellConfig[];
  controlPoints: ControlPointConfig[];
  headquarters: Record<'player_a' | 'player_b', { q: number; r: number }>;
  startingUnits: StartingUnitConfig[];
  spawnSlots: SpawnSlotConfig[];
  layouts: Record<string, string[]>;
  supportedPlayerCounts: number[];
  units: Record<UnitType, UnitSpec>;
  headquartersSpec: HeadquartersSpec;
  balance: {
    startingSupplies: number;
    baseIncome: number;
    controlPointIncome: number;
    damageVarianceRange: number;
    minimumDamage: number;
    healVarianceRange: number;
    actionsPerTurn: number;
    maxTurns: number;
    adjudicationWeights: {
      enemyHqDamage: number;
      ownHqHp: number;
      controlPoint: number;
      armyValue: number;
      supplies: number;
    };
    controlPointTypes?: Record<ControlPointKind, ControlPointTypeSpec>;
  };
}

export interface MapPreview {
  radius: number;
  maxTurns: number;
  terrainCells: TerrainCellConfig[];
  controlPoints: ControlPointConfig[];
  headquarters: Record<'player_a' | 'player_b', { q: number; r: number }>;
  spawnSlots: SpawnSlotConfig[];
  supportedPlayerCounts: number[];
}

export interface MapListItem {
  id: string;
  name: string;
  description: string;
  preview: MapPreview;
}

const CONTROL_POINT_KINDS = ['supply', 'forward_base', 'repair'] as const satisfies readonly ControlPointKind[];

const maps = new Map<string, MapConfig>();

function normalizeMapConfig(config: unknown): unknown {
  const c = asRecord(config, 'Map');
  if (Array.isArray(c.spawnSlots)) {
    const slots = c.spawnSlots as SpawnSlotConfig[];
    const first = slots[0];
    const second = slots[1] ?? slots[0];
    return {
      ...c,
      headquarters: c.headquarters ?? {
        player_a: first?.headquarters,
        player_b: second?.headquarters,
      },
      startingUnits: c.startingUnits ?? [
        ...(first?.startingUnits ?? []).map(unit => ({ ...unit, owner: 'player_a' })),
        ...(second?.startingUnits ?? []).map(unit => ({ ...unit, owner: 'player_b' })),
      ],
      layouts: c.layouts ?? { 2: slots.slice(0, 2).map(slot => slot.id) },
      supportedPlayerCounts: c.supportedPlayerCounts,
    };
  }

  const headquarters = asRecord(c.headquarters, 'headquarters');
  const startingUnits = Array.isArray(c.startingUnits) ? c.startingUnits as StartingUnitConfig[] : [];
  const spawnSlots: SpawnSlotConfig[] = ['player_a', 'player_b'].map(player => ({
    id: `slot_${player.slice(-1)}`,
    headquarters: { ...(headquarters[player] as { q: number; r: number }) },
    startingUnits: startingUnits
      .filter(unit => unit.owner === player)
      .map(({ owner: _owner, ...unit }) => ({ ...unit })),
  }));
  return {
    ...c,
    spawnSlots,
    layouts: { 2: spawnSlots.map(slot => slot.id) },
    supportedPlayerCounts: [2],
  };
}

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
  if (!('actionsPerTurn' in balance)) throw new Error(`Map "${id}".balance.actionsPerTurn is required`);
  assertNumber(balance, 'actionsPerTurn', `Map "${id}".balance`, 1);
  if (!('maxTurns' in balance)) throw new Error(`Map "${id}".balance.maxTurns is required`);
  assertNumber(balance, 'maxTurns', `Map "${id}".balance`, 1);
  if (!('adjudicationWeights' in balance)) {
    throw new Error(`Map "${id}".balance.adjudicationWeights is required`);
  }
  const weights = asRecord(balance.adjudicationWeights, `Map "${id}".balance.adjudicationWeights`);
  for (const key of ['enemyHqDamage', 'ownHqHp', 'controlPoint', 'armyValue', 'supplies']) {
    assertNumber(weights, key, `Map "${id}".balance.adjudicationWeights`, 0);
  }
  const controlPointTypes = 'controlPointTypes' in balance
    ? asRecord(balance.controlPointTypes, `Map "${id}".balance.controlPointTypes`)
    : null;
  if (controlPointTypes) {
    for (const kind of CONTROL_POINT_KINDS) {
      const spec = asRecord(controlPointTypes[kind], `Map "${id}".balance.controlPointTypes.${kind}`);
      assertNumber(spec, 'income', `Map "${id}".balance.controlPointTypes.${kind}`, 0);
      assertNumber(spec, 'deployDiscount', `Map "${id}".balance.controlPointTypes.${kind}`, 0);
      assertNumber(spec, 'repairAmount', `Map "${id}".balance.controlPointTypes.${kind}`, 0);
    }
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
  let typedControlPoints = 0;
  for (let i = 0; i < c.controlPoints.length; i++) {
    const cp = asRecord(c.controlPoints[i], `controlPoints[${i}]`);
    assertString(cp, 'id', `controlPoints[${i}]`);
    assertString(cp, 'name', `controlPoints[${i}]`);
    if ('kind' in cp) {
      if (!CONTROL_POINT_KINDS.includes(cp.kind as ControlPointKind)) {
        throw new Error(`controlPoints[${i}].kind must be supply, forward_base, or repair`);
      }
      typedControlPoints += 1;
    }
    const pos = assertPosition(cp, `controlPoints[${i}]`, radius);
    claim(pos, `controlPoints[${i}]`);
  }
  if (typedControlPoints > 0) {
    if (!controlPointTypes) {
      throw new Error(`Map "${id}".balance.controlPointTypes is required when control points use kind`);
    }
    if (typedControlPoints !== c.controlPoints.length) {
      throw new Error(`Map "${id}".controlPoints must all define kind when any control point is typed`);
    }
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

  if (!Array.isArray(c.spawnSlots) || c.spawnSlots.length < 2 || c.spawnSlots.length > 8) {
    throw new Error(`Map "${id}".spawnSlots must contain 2-8 slots`);
  }
  const spawnIds = new Set<string>();
  for (let i = 0; i < c.spawnSlots.length; i++) {
    const slot = asRecord(c.spawnSlots[i], `spawnSlots[${i}]`);
    const slotId = assertString(slot, 'id', `spawnSlots[${i}]`);
    if (spawnIds.has(slotId)) throw new Error(`spawnSlots[${i}].id must be unique`);
    spawnIds.add(slotId);
    assertPosition(asRecord(slot.headquarters, `spawnSlots[${i}].headquarters`), `spawnSlots[${i}].headquarters`, radius);
    if (!Array.isArray(slot.startingUnits)) throw new Error(`spawnSlots[${i}].startingUnits must be an array`);
    for (let j = 0; j < slot.startingUnits.length; j++) {
      const unit = asRecord(slot.startingUnits[j], `spawnSlots[${i}].startingUnits[${j}]`);
      if (!['infantry', 'scout', 'heavy', 'ranger', 'support'].includes(String(unit.type))) {
        throw new Error(`spawnSlots[${i}].startingUnits[${j}].type invalid`);
      }
      assertPosition(unit, `spawnSlots[${i}].startingUnits[${j}]`, radius);
    }
  }
  const layouts = asRecord(c.layouts, `Map "${id}".layouts`);
  const supportedCounts: number[] = [];
  for (const [countText, value] of Object.entries(layouts)) {
    const count = Number(countText);
    if (!Number.isInteger(count) || count < 2 || count > 8 || !Array.isArray(value) || value.length !== count) {
      throw new Error(`Map "${id}".layouts.${countText} must contain exactly ${countText} slots`);
    }
    const unique = new Set(value);
    if (unique.size !== value.length || value.some(slotId => typeof slotId !== 'string' || !spawnIds.has(slotId))) {
      throw new Error(`Map "${id}".layouts.${countText} contains invalid slots`);
    }
    supportedCounts.push(count);
  }
  supportedCounts.sort((a, b) => a - b);
  c.supportedPlayerCounts = supportedCounts;

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
    const parsed = normalizeMapConfig(JSON.parse(raw) as unknown);
    validateMap(id, parsed);
    maps.set(id, parsed as MapConfig);
  }
}

export function getMapConfig(id: string): MapConfig {
  const config = maps.get(id);
  if (!config) throw new Error(`Map "${id}" not found. Available: ${[...maps.keys()].join(', ')}`);
  return config;
}

export function listMaps(): MapListItem[] {
  return [...maps.entries()].map(([id, cfg]) => ({
    id,
    name: cfg.name,
    description: cfg.description,
    preview: {
      radius: cfg.radius,
      maxTurns: cfg.balance.maxTurns,
      terrainCells: cfg.terrainCells.map(cell => ({ ...cell })),
      controlPoints: cfg.controlPoints.map(point => ({ ...point })),
      headquarters: {
        player_a: { ...cfg.headquarters.player_a },
        player_b: { ...cfg.headquarters.player_b },
      },
      spawnSlots: cfg.spawnSlots.map(slot => ({
        ...slot,
        headquarters: { ...slot.headquarters },
        startingUnits: slot.startingUnits.map(unit => ({ ...unit })),
      })),
      supportedPlayerCounts: [...cfg.supportedPlayerCounts],
    },
  }));
}

export function getDefaultMapConfig(): MapConfig {
  return getMapConfig('default');
}

export function resetConfig(): void {
  maps.clear();
}
