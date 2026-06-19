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
      infantry: { hp: 100, attack: 28, defense: 8, moveRange: 3, attackRange: 1, cost: 45, canCapture: true },
      scout: { hp: 70, attack: 18, defense: 4, moveRange: 5, attackRange: 1, cost: 40, canCapture: true },
      heavy: { hp: 145, attack: 36, defense: 14, moveRange: 2, attackRange: 1, cost: 90, canCapture: false },
      ranger: { hp: 75, attack: 46, defense: 3, moveRange: 2, attackRange: 3, cost: 75, canCapture: false },
      support: { hp: 80, attack: 12, defense: 5, moveRange: 3, attackRange: 1, cost: 60, canCapture: false, healPower: 20 },
    },
    headquartersSpec: { hp: 200, defense: 8 },
    balance: {
      startingSupplies: 80,
      baseIncome: 10,
      controlPointIncome: 15,
      damageVarianceRange: 3,
      minimumDamage: 1,
      healVarianceRange: 6,
      actionsPerTurn: 5,
      maxTurns: 20,
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
