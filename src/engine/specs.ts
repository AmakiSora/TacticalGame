// src/engine/specs.ts
import type { UnitType, BuildingType } from '../types.js';

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

export const UNIT_SPECS: Record<UnitType, UnitSpec> = {
  infantry: { hp: 100, attack: 20, defense: 8, moveRange: 3, attackRange: 1, cost: 40, productionTime: 1 },
  sniper:   { hp: 60,  attack: 35, defense: 3, moveRange: 2, attackRange: 4, cost: 60, productionTime: 2 },
  tank:     { hp: 150, attack: 25, defense: 15, moveRange: 2, attackRange: 1, cost: 80, productionTime: 3 },
  medic:    { hp: 70,  attack: 5,  defense: 5, moveRange: 3, attackRange: 1, cost: 50, productionTime: 1 },
};

export const BUILDING_SPECS: Record<BuildingType, BuildingSpec> = {
  headquarters: { hp: 200, cost: 0,  buildTime: 0 },
  barracks:     { hp: 100, cost: 50, buildTime: 2 },
  miner:        { hp: 60,  cost: 30, buildTime: 1 },
};

export const CAN_PRODUCE: Record<BuildingType, UnitType[]> = {
  headquarters: ['infantry'],
  barracks:     ['infantry', 'sniper', 'tank', 'medic'],
  miner:        [],
};

export const STARTING_GOLD = 100;
export const MINER_INCOME = 15;
export const BASE_INCOME = 5;
export const BUILD_RANGE = 2;
export const MAP_WIDTH = 30;
export const MAP_HEIGHT = 30;

export const HQ_POSITIONS: Record<'player_a' | 'player_b', { x: number; y: number }> = {
  player_a: { x: 4,  y: 15 },
  player_b: { x: 25, y: 15 },
};

export const MINING_POINTS = [
  { x: 10, y: 5  }, { x: 10, y: 15 }, { x: 10, y: 25 },
  { x: 19, y: 5  }, { x: 19, y: 15 }, { x: 19, y: 25 },
];
