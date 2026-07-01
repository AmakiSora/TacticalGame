import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getMapConfig, listMaps, loadMaps, resetConfig } from '../../src/config/loader.js';
import { hexDistance } from '../../src/engine/hex.js';

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

function controlPointTypes() {
  return {
    supply: { income: 12, deployDiscount: 0, repairAmount: 0 },
    forward_base: { income: 8, deployDiscount: 8, repairAmount: 0 },
    repair: { income: 8, deployDiscount: 0, repairAmount: 10 },
  };
}

function visualYAxisMirror(pos: { q: number; r: number }) {
  return { q: -pos.q - pos.r, r: pos.r };
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

  it('requires full control point type config when any control point is typed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tactical-map-'));
    const map = validMap() as any;
    map.controlPoints = [
      { id: 'cp_a', name: 'Typed', q: 0, r: 0, kind: 'supply' },
      { id: 'cp_b', name: 'Untyped', q: 0, r: 1 },
    ];
    writeFileSync(join(dir, 'default.json'), JSON.stringify(map));

    expect(() => loadMaps(dir)).toThrow('balance.controlPointTypes is required');
    resetConfig();
  });

  it('rejects mixed typed and untyped control points even with type config', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tactical-map-'));
    const map = validMap() as any;
    map.balance.controlPointTypes = controlPointTypes();
    map.controlPoints = [
      { id: 'cp_a', name: 'Typed', q: 0, r: 0, kind: 'supply' },
      { id: 'cp_b', name: 'Untyped', q: 0, r: 1 },
    ];
    writeFileSync(join(dir, 'default.json'), JSON.stringify(map));

    expect(() => loadMaps(dir)).toThrow('controlPoints must all define kind');
    resetConfig();
  });

  it('requires every supported control point type to be configured', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tactical-map-'));
    const map = validMap() as any;
    map.controlPoints = [{ id: 'cp_a', name: 'Typed', q: 0, r: 0, kind: 'supply' }];
    map.balance.controlPointTypes = controlPointTypes();
    delete map.balance.controlPointTypes.repair;
    writeFileSync(join(dir, 'default.json'), JSON.stringify(map));

    expect(() => loadMaps(dir)).toThrow('balance.controlPointTypes.repair must be an object');
    resetConfig();
  });

  it('loads dual-lanes as a typed control point map without changing legacy maps', () => {
    resetConfig();
    loadMaps();

    const legacy = getMapConfig('default');
    const dual = getMapConfig('dual-lanes');

    expect(legacy.controlPoints.every(point => !('kind' in point))).toBe(true);
    expect(legacy.balance.controlPointTypes).toBeUndefined();
    expect(dual.controlPoints.map(point => point.kind)).toEqual([
      'supply', 'repair', 'supply', 'forward_base', 'repair', 'forward_base',
    ]);
    expect(dual.startingUnits).toEqual([]);
    expect(dual.balance.startingSupplies).toBe(208);
    expect(dual.balance.controlPointTypes?.forward_base.deployDiscount).toBe(8);
    const laneIncome = (ids: string[]) => ids.reduce((sum, id) => {
      const point = dual.controlPoints.find(cp => cp.id === id)!;
      return sum + dual.balance.controlPointTypes![point.kind!].income;
    }, 0);
    expect(laneIncome(['cp_nw', 'cp_nc', 'cp_ne'])).toBeGreaterThan(laneIncome(['cp_sw', 'cp_sc', 'cp_se']));
    expect(['cp_nw', 'cp_nc', 'cp_ne']).toHaveLength(['cp_sw', 'cp_sc', 'cp_se'].length);
    resetConfig();
  });

  it('includes lightweight preview geometry in map listings', () => {
    resetConfig();
    loadMaps();

    const map = listMaps().find(item => item.id === 'default')!;

    expect(map.preview.radius).toBe(8);
    expect(map.preview.terrainCells).toContainEqual({ q: -1, r: -2, terrain: 'water' });
    expect(map.preview.controlPoints).toContainEqual(expect.objectContaining({ name: '中央阵地', q: 0, r: 0 }));
    expect(map.preview.headquarters.player_a).toEqual({ q: -8, r: 0 });
    expect(map.preview.headquarters.player_b).toEqual({ q: 8, r: 0 });
    resetConfig();
  });

  it('keeps dual-lanes lane roles mirrored around the center axis', () => {
    resetConfig();
    loadMaps();

    const dual = getMapConfig('dual-lanes');
    const kindById = Object.fromEntries(dual.controlPoints.map(point => [point.id, point.kind]));

    expect([kindById.cp_nw, kindById.cp_nc, kindById.cp_ne]).toEqual(['supply', 'repair', 'supply']);
    expect([kindById.cp_sw, kindById.cp_sc, kindById.cp_se]).toEqual(['forward_base', 'repair', 'forward_base']);
    expect(kindById.cp_nw).toBe(kindById.cp_ne);
    expect(kindById.cp_sw).toBe(kindById.cp_se);
    resetConfig();
  });

  it('spaces dual-lanes control points four hexes apart within each lane', () => {
    resetConfig();
    loadMaps();

    const dual = getMapConfig('dual-lanes');
    const byId = Object.fromEntries(dual.controlPoints.map(point => [point.id, point]));

    expect(hexDistance(byId.cp_nw, byId.cp_nc)).toBe(4);
    expect(hexDistance(byId.cp_nc, byId.cp_ne)).toBe(4);
    expect(hexDistance(byId.cp_sw, byId.cp_sc)).toBe(4);
    expect(hexDistance(byId.cp_sc, byId.cp_se)).toBe(4);
    resetConfig();
  });

  it('keeps dual-lanes geometry symmetric around the visual y-axis', () => {
    resetConfig();
    loadMaps();

    const dual = getMapConfig('dual-lanes');
    for (const point of dual.controlPoints) {
      const mirror = visualYAxisMirror(point);
      const counterpart = dual.controlPoints.find(candidate => candidate.q === mirror.q && candidate.r === mirror.r);
      expect(counterpart, `${point.id} should mirror to (${mirror.q},${mirror.r})`).toBeTruthy();
      expect(counterpart!.kind).toBe(point.kind);
    }

    for (const cell of dual.terrainCells) {
      const mirror = visualYAxisMirror(cell);
      const counterpart = dual.terrainCells.find(candidate => candidate.q === mirror.q && candidate.r === mirror.r);
      expect(counterpart, `terrain (${cell.q},${cell.r}) should mirror to (${mirror.q},${mirror.r})`).toBeTruthy();
      expect(counterpart!.terrain).toBe(cell.terrain);
    }
    resetConfig();
  });
});
