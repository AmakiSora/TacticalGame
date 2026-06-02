// tests/engine/specs.test.ts
import { describe, it, expect } from 'vitest';
import { UNIT_SPECS, BUILDING_SPECS, CAN_PRODUCE } from '../../src/engine/specs.js';

describe('specs', () => {
  it('infantry has expected stats', () => {
    expect(UNIT_SPECS.infantry).toEqual({
      hp: 100, attack: 20, defense: 8,
      moveRange: 3, attackRange: 1,
      cost: 40, productionTime: 1,
    });
  });

  it('tank is highest hp unit', () => {
    expect(UNIT_SPECS.tank.hp).toBe(150);
  });

  it('barracks costs 50 gold and takes 2 turns', () => {
    expect(BUILDING_SPECS.barracks.cost).toBe(50);
    expect(BUILDING_SPECS.barracks.buildTime).toBe(2);
  });

  it('headquarters can produce infantry but not tanks', () => {
    expect(CAN_PRODUCE.headquarters).toEqual(['infantry']);
  });

  it('barracks can produce all 4 unit types', () => {
    expect(CAN_PRODUCE.barracks.sort()).toEqual(
      ['infantry', 'medic', 'sniper', 'tank']
    );
  });

  it('miner cannot produce units', () => {
    expect(CAN_PRODUCE.miner).toEqual([]);
  });
});
