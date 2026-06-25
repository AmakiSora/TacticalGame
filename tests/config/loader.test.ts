import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadMaps, resetConfig } from '../../src/config/loader.js';

function validMap() {
  return {
    name: 'Test',
    description: 'Test map',
    grid: 'hex',
    orientation: 'pointy',
    radius: 2,
    terrainCells: [],
    controlPoints: [{ id: 'cp', name: 'Center', q: 0, r: 0 }],
    headquarters: {
      player_a: { q: -2, r: 0 },
      player_b: { q: 2, r: 0 },
    },
    startingUnits: [],
    units: {
      infantry: { hp: 100, attack: 30, defense: 8, moveRange: 3, attackRange: 1, cost: 45, canCapture: true },
      scout: { hp: 65, attack: 16, defense: 4, moveRange: 5, attackRange: 1, cost: 38, canCapture: true },
      heavy: { hp: 150, attack: 38, defense: 13, moveRange: 2, attackRange: 1, cost: 92, canCapture: false },
      ranger: { hp: 72, attack: 44, defense: 3, moveRange: 2, attackRange: 3, cost: 78, canCapture: false },
      support: { hp: 82, attack: 10, defense: 5, moveRange: 3, attackRange: 1, cost: 60, canCapture: false, healPower: 22 },
    },
    headquartersSpec: { hp: 180, defense: 6 },
    balance: {
      startingSupplies: 80,
      baseIncome: 10,
      controlPointIncome: 12,
      damageVarianceRange: 3,
      minimumDamage: 1,
      healVarianceRange: 6,
      actionsPerTurn: 5,
      maxTurns: 15,
      adjudicationWeights: {
        enemyHqDamage: 4,
        ownHqHp: 2,
        controlPoint: 120,
        armyValue: 2,
        supplies: 1,
      },
    },
  };
}

describe('map config loader', () => {
  it('requires maxTurns and adjudication weights', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tactical-map-'));
    const map = validMap();
    delete (map.balance as any).maxTurns;
    writeFileSync(join(dir, 'default.json'), JSON.stringify(map));

    expect(() => loadMaps(dir)).toThrow('balance.maxTurns is required');
    resetConfig();
  });
});
