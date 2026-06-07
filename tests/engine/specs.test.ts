// tests/engine/specs.test.ts
import { describe, it, expect } from 'vitest';
import { getUnitSpec, getBuildingSpec, getCanProduce } from '../../src/engine/specs.js';
import { getDefaultMapConfig } from '../../src/config/loader.js';

const config = getDefaultMapConfig();

describe('specs', () => {
  it('infantry has expected stats', () => {
    expect(getUnitSpec(config, 'infantry')).toEqual({
      hp: 100, attack: 20, defense: 8,
      moveRange: 3, attackRange: 1,
      cost: 40, productionTime: 1,
    });
  });

  it('tank is highest hp unit', () => {
    expect(getUnitSpec(config, 'tank').hp).toBe(150);
  });

  it('barracks costs 50 gold and takes 2 turns', () => {
    expect(getBuildingSpec(config, 'barracks').cost).toBe(50);
    expect(getBuildingSpec(config, 'barracks').buildTime).toBe(2);
  });

  it('headquarters cannot produce any units', () => {
    expect(getCanProduce(config, 'headquarters')).toEqual([]);
  });

  it('barracks can produce all 4 unit types', () => {
    expect(getCanProduce(config, 'barracks').sort()).toEqual(
      ['infantry', 'medic', 'sniper', 'tank']
    );
  });

  it('miner cannot produce units', () => {
    expect(getCanProduce(config, 'miner')).toEqual([]);
  });
});
