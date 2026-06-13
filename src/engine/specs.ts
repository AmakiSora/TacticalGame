// src/engine/specs.ts
import type { MapConfig, UnitSpec } from '../config/loader.js';
import type { UnitType } from '../types.js';

export type { UnitSpec };

export function getUnitSpec(config: MapConfig, type: UnitType): UnitSpec {
  return config.units[type];
}
