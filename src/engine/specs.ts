// src/engine/specs.ts
import type { UnitType, BuildingType } from '../types.js';
import { getConfig } from '../config/loader.js';
import type { UnitSpec, BuildingSpec } from '../config/loader.js';

export type { UnitSpec, BuildingSpec };

export function getUnitSpec(type: UnitType): UnitSpec {
  return getConfig().units[type];
}

export function getBuildingSpec(type: BuildingType): BuildingSpec {
  return getConfig().buildings[type];
}

export function getCanProduce(type: BuildingType): UnitType[] {
  return getConfig().canProduce[type] as UnitType[];
}

export function getStartingGold(): number {
  return getConfig().economy.startingGold;
}

export function getMinerIncome(): number {
  return getConfig().economy.minerIncome;
}

export function getBaseIncome(): number {
  return getConfig().economy.baseIncome;
}

export function getBuildRange(): number {
  return getConfig().map.buildRange;
}

export function getMapWidth(): number {
  return getConfig().map.width;
}

export function getMapHeight(): number {
  return getConfig().map.height;
}

export function getHQPositions(): Record<'player_a' | 'player_b', { x: number; y: number }> {
  return getConfig().map.headquartersPositions as Record<'player_a' | 'player_b', { x: number; y: number }>;
}

export function getMiningPoints(): { x: number; y: number }[] {
  return getConfig().map.miningPoints;
}
