// src/engine/specs.ts
import type { UnitType, BuildingType } from '../types.js';
import type { MapConfig, UnitSpec, BuildingSpec } from '../config/loader.js';

export type { UnitSpec, BuildingSpec };

export function getUnitSpec(config: MapConfig, type: UnitType): UnitSpec {
  return config.units[type];
}

export function getBuildingSpec(config: MapConfig, type: BuildingType): BuildingSpec {
  return config.buildings[type];
}

export function getCanProduce(config: MapConfig, type: BuildingType): UnitType[] {
  return config.canProduce[type] as UnitType[];
}

export function getStartingGold(config: MapConfig): number {
  return config.economy.startingGold;
}

export function getMinerIncome(config: MapConfig): number {
  return config.economy.minerIncome;
}

export function getBaseIncome(config: MapConfig): number {
  return config.economy.baseIncome;
}

export function getBuildRange(config: MapConfig): number {
  return config.map.buildRange;
}

export function getMapWidth(config: MapConfig): number {
  return config.map.width;
}

export function getMapHeight(config: MapConfig): number {
  return config.map.height;
}

export function getHQPositions(config: MapConfig): Record<'player_a' | 'player_b', { x: number; y: number }> {
  return config.map.headquartersPositions as Record<'player_a' | 'player_b', { x: number; y: number }>;
}

export function getMiningPoints(config: MapConfig): { x: number; y: number }[] {
  return config.map.miningPoints;
}
