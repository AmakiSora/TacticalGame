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

function originReflection(pos: { q: number; r: number }) {
  return { q: -pos.q, r: -pos.r };
}

function terrainAt(
  map: { terrainCells: { q: number; r: number; terrain: string }[] },
  q: number,
  r: number,
) {
  return map.terrainCells.find(cell => cell.q === q && cell.r === r)?.terrain ?? 'plain';
}

// 故意构造非法地图以触发校验错误：放宽 balance 与 controlPoints 字段形状，
// 便于删除必填项或混入残缺据点。仅用于负面测试。
type BrokenMap = {
  balance: Record<string, unknown> & { controlPointTypes?: Record<string, unknown> };
  controlPoints: Array<{ id: string; name: string; q: number; r: number; kind?: string }>;
} & Record<string, unknown>;

describe('map config loader', () => {
  it('loads and validates optional comeback supply configuration', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tactical-map-'));
    const map = validMap();
    map.balance.comebackSupply = { startRound: 3, scoreGapPercent: 40, amountPerRound: 20 };
    writeFileSync(join(dir, 'default.json'), JSON.stringify(map));

    loadMaps(dir);
    expect(getMapConfig('default').balance.comebackSupply).toEqual({
      startRound: 3,
      scoreGapPercent: 40,
      amountPerRound: 20,
    });
    resetConfig();
  });

  it.each([
    [{ startRound: 3, scoreGapPercent: 40 }, 'amountPerRound must be a number >= 1'],
    [{ startRound: 0, scoreGapPercent: 40, amountPerRound: 20 }, 'startRound must be a number >= 1'],
    [{ startRound: 3, scoreGapPercent: 101, amountPerRound: 20 }, 'scoreGapPercent must be <= 100'],
    [{ startRound: 3, scoreGapPercent: 40.5, amountPerRound: 20 }, 'scoreGapPercent must be an integer'],
    [{ startRound: 3, scoreGapPercent: 40, amountPerRound: 0 }, 'amountPerRound must be a number >= 1'],
  ])('rejects invalid comeback supply configuration %#', (comebackSupply, message) => {
    const dir = mkdtempSync(join(tmpdir(), 'tactical-map-'));
    const map = validMap();
    map.balance.comebackSupply = comebackSupply;
    writeFileSync(join(dir, 'default.json'), JSON.stringify(map));

    expect(() => loadMaps(dir)).toThrow(message);
    resetConfig();
  });

  it('requires maxTurns and adjudication weights', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tactical-map-'));
    const map = validMap() as unknown as BrokenMap;
    delete map.balance.maxTurns;
    writeFileSync(join(dir, 'default.json'), JSON.stringify(map));

    expect(() => loadMaps(dir)).toThrow('balance.maxTurns is required');
    resetConfig();
  });

  it('requires full control point type config when any control point is typed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tactical-map-'));
    const map = validMap() as unknown as BrokenMap;
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
    const map = validMap() as unknown as BrokenMap;
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
    const map = validMap() as unknown as BrokenMap;
    map.controlPoints = [{ id: 'cp_a', name: 'Typed', q: 0, r: 0, kind: 'supply' }];
    map.balance.controlPointTypes = controlPointTypes();
    delete map.balance.controlPointTypes!.repair;
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
    expect(map.preview.maxTurns).toBe(15);
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

  it('keeps breach blocked through the center with only edge lanes open', () => {
    resetConfig();
    loadMaps();

    const breach = getMapConfig('breach');
    const blockers = breach.terrainCells
      .filter(cell => cell.terrain === 'blocker')
      .map(cell => `${cell.q},${cell.r}`)
      .sort();

    // Cross-shaped wall: full vertical wall at q=0 (r=-7..7),
    // horizontal arms at q=-1 (r=4,5,6) and q=1 (r=-6,-5,-4),
    // plus center cross bar at r=-1,0,1 for q=-1 and q=1
    const expectedBlockers = [
      // q=0 full vertical wall
      ...Array.from({ length: 15 }, (_, i) => `0,${i - 7}`),
      // q=-1 horizontal arm (upper right) + center cross
      '-1,-1', '-1,0', '-1,1', '-1,4', '-1,5', '-1,6',
      // q=1 horizontal arm (lower left) + center cross
      '1,-6', '1,-5', '1,-4', '1,-1', '1,0', '1,1',
    ].sort();

    expect(blockers).toEqual(expectedBlockers);
    // Edge lanes open at r=-7 and r=7 for q=-1 and q=1 (flanking the center wall)
    expect(terrainAt(breach, -1, -7)).toBe('plain');
    expect(terrainAt(breach, -1, 7)).toBe('plain');
    expect(terrainAt(breach, 1, -7)).toBe('plain');
    expect(terrainAt(breach, 1, 7)).toBe('plain');
    // Center wall column reaches the map edge
    expect(terrainAt(breach, 0, -7)).toBe('blocker');
    expect(terrainAt(breach, 0, 7)).toBe('blocker');
    for (const cell of breach.terrainCells) {
      const mirror = originReflection(cell);
      const counterpart = breach.terrainCells.find(candidate => candidate.q === mirror.q && candidate.r === mirror.r);
      expect(counterpart, `terrain (${cell.q},${cell.r}) should reflect to (${mirror.q},${mirror.r})`).toBeTruthy();
      expect(counterpart!.terrain).toBe(cell.terrain);
    }
    resetConfig();
  });

  it('loads forge map with diagonal HQs and a demolishable forge ring for 10-turn play', () => {
    resetConfig();
    loadMaps();

    const forge = getMapConfig('forge');
    expect(forge.name).toBe('熔炉之心');
    expect(forge.radius).toBe(5);
    expect(forge.balance.maxTurns).toBe(10);
    // 对角线总部：双方斜向对峙，距离为 8
    expect(forge.headquarters.player_a).toEqual({ q: -4, r: 4 });
    expect(forge.headquarters.player_b).toEqual({ q: 4, r: -4 });
    expect(hexDistance(forge.headquarters.player_a, forge.headquarters.player_b)).toBe(8);
    expect(forge.headquartersSpec.hp).toBe(100);
    expect(forge.headquartersSpec.defense).toBe(3);

    // 全部据点带类型，且关于原点 180° 对称、类型一致
    expect(forge.controlPoints.length).toBe(5);
    for (const point of forge.controlPoints) {
      expect(point.kind).toBeTruthy();
      const mirror = originReflection(point);
      const counterpart = forge.controlPoints.find(c => c.q === mirror.q && c.r === mirror.r);
      expect(counterpart, `${point.id} should mirror to (${mirror.q},${mirror.r})`).toBeTruthy();
      expect(counterpart!.kind).toBe(point.kind);
    }
    // 中央维修核心
    const core = forge.controlPoints.find(c => c.id === 'cp_core')!;
    expect(core.kind).toBe('repair');
    expect({ q: core.q, r: core.r }).toEqual({ q: 0, r: 0 });

    // 地形关于原点对称
    for (const cell of forge.terrainCells) {
      const mirror = originReflection(cell);
      const counterpart = forge.terrainCells.find(c => c.q === mirror.q && c.r === mirror.r);
      expect(counterpart, `terrain (${cell.q},${cell.r}) should mirror to (${mirror.q},${mirror.r})`).toBeTruthy();
      expect(counterpart!.terrain).toBe(cell.terrain);
    }

    // 熔炉环：核心的六个邻居中四块为阻挡，仅留对角线两道窄缝 (1,-1) 与 (-1,1)
    expect(terrainAt(forge, 1, 0)).toBe('blocker');
    expect(terrainAt(forge, 0, -1)).toBe('blocker');
    expect(terrainAt(forge, -1, 0)).toBe('blocker');
    expect(terrainAt(forge, 0, 1)).toBe('blocker');
    expect(terrainAt(forge, 1, -1)).toBe('plain');
    expect(terrainAt(forge, -1, 1)).toBe('plain');
    // 两根石柱扼守缝隙
    expect(terrainAt(forge, 2, -1)).toBe('blocker');
    expect(terrainAt(forge, -2, 1)).toBe('blocker');
    // 两汪熔岩封角
    expect(terrainAt(forge, -3, -2)).toBe('water');
    expect(terrainAt(forge, 3, 2)).toBe('water');

    // 起始单位关于原点对称、类型一致、归属互换
    expect(forge.startingUnits.length).toBe(8);
    for (const unit of forge.startingUnits) {
      const mirror = originReflection(unit);
      const counterpart = forge.startingUnits.find(c => c.q === mirror.q && c.r === mirror.r);
      expect(counterpart, `starting unit (${unit.q},${unit.r}) should mirror to (${mirror.q},${mirror.r})`).toBeTruthy();
      expect(counterpart!.type).toBe(unit.type);
      expect(counterpart!.owner).toBe(unit.owner === 'player_a' ? 'player_b' : 'player_a');
    }
    // 每方各有一台重装，用于爆破熔炉墙
    const aHeavy = forge.startingUnits.filter(u => u.owner === 'player_a' && u.type === 'heavy');
    const bHeavy = forge.startingUnits.filter(u => u.owner === 'player_b' && u.type === 'heavy');
    expect(aHeavy.length).toBe(1);
    expect(bHeavy.length).toBe(1);

    resetConfig();
  });
});
