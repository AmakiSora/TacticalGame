import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
    controlPoints: [{ id: 'cp', name: 'Center', kind: 'supply', q: 0, r: 0 }],
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
      controlPointTypes: {
        supply: { income: 12, deployDiscount: 0, repairAmount: 0 },
        forward_base: { income: 8, deployDiscount: 8, repairAmount: 0 },
        repair: { income: 8, deployDiscount: 0, repairAmount: 10 },
      },
    },
  };
}

function whirlpoolMap() {
  return JSON.parse(readFileSync('maps/whirlpool.json', 'utf8')) as Record<string, any>;
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

  it('validates heal shape length against healRange instead of attackRange', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tactical-map-'));
    const map = validMap() as Record<string, any>;
    map.units.support.healShape = { type: 'line', length: 2 };
    map.units.support.healRange = 2;
    writeFileSync(join(dir, 'default.json'), JSON.stringify(map));

    expect(() => loadMaps(dir)).not.toThrow();
    expect(getMapConfig('default').units.support.healRange).toBe(2);
    resetConfig();

    const invalidDir = mkdtempSync(join(tmpdir(), 'tactical-map-'));
    map.units.support.healRange = 1;
    writeFileSync(join(invalidDir, 'default.json'), JSON.stringify(map));
    expect(() => loadMaps(invalidDir)).toThrow('units.support.healShape.length must not exceed healRange');
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

  it('accepts null maxTurns as an unlimited-round map', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tactical-map-'));
    const map = validMap() as Record<string, any>;
    map.balance.maxTurns = null;
    writeFileSync(join(dir, 'default.json'), JSON.stringify(map));

    loadMaps(dir);

    expect(getMapConfig('default').balance.maxTurns).toBeNull();
    expect(listMaps().find(item => item.id === 'default')!.preview.maxTurns).toBeNull();
    resetConfig();
  });

  it.each([[0], [-3], ['15'], [true]])(
    'rejects maxTurns %# that is neither a positive number nor null',
    maxTurns => {
      const dir = mkdtempSync(join(tmpdir(), 'tactical-map-'));
      const map = validMap() as Record<string, any>;
      map.balance.maxTurns = maxTurns;
      writeFileSync(join(dir, 'default.json'), JSON.stringify(map));

      expect(() => loadMaps(dir)).toThrow('balance.maxTurns must be a number >= 1');
      resetConfig();
    },
  );

  it.each([[false], [true]])(
    'accepts deployFromHq %# as an optional map balance flag',
    deployFromHq => {
      const dir = mkdtempSync(join(tmpdir(), 'tactical-map-'));
      const map = validMap() as Record<string, any>;
      map.balance.deployFromHq = deployFromHq;
      writeFileSync(join(dir, 'default.json'), JSON.stringify(map));

      loadMaps(dir);

      expect(getMapConfig('default').balance.deployFromHq).toBe(deployFromHq);
      resetConfig();
    },
  );

  it.each([[0], ['false'], [null]])(
    'rejects deployFromHq %# that is not boolean',
    deployFromHq => {
      const dir = mkdtempSync(join(tmpdir(), 'tactical-map-'));
      const map = validMap() as Record<string, any>;
      map.balance.deployFromHq = deployFromHq;
      writeFileSync(join(dir, 'default.json'), JSON.stringify(map));

      expect(() => loadMaps(dir)).toThrow('balance.deployFromHq must be boolean');
      resetConfig();
    },
  );

  it('ships whirlpool as an unlimited-round standard map', () => {
    resetConfig();
    loadMaps();

    const map = listMaps().find(item => item.id === 'whirlpool')!;

    expect(map.preview.mode).toBe('standard');
    expect(map.preview.maxTurns).toBeNull();
    expect(getMapConfig('whirlpool').balance.maxTurns).toBeNull();
    resetConfig();
  });

  it('validates the optional effective action adjudication weight', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tactical-map-'));
    const map = validMap() as unknown as BrokenMap;
    (map.balance.adjudicationWeights as Record<string, unknown>).effectiveActions = 'invalid';
    writeFileSync(join(dir, 'default.json'), JSON.stringify(map));

    expect(() => loadMaps(dir)).toThrow('adjudicationWeights.effectiveActions must be a number >= 0');
    resetConfig();
  });

  it('requires control point type config on every map', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tactical-map-'));
    const map = validMap() as unknown as BrokenMap;
    delete map.balance.controlPointTypes;
    writeFileSync(join(dir, 'default.json'), JSON.stringify(map));

    expect(() => loadMaps(dir)).toThrow('balance.controlPointTypes is required');
    resetConfig();
  });

  it('requires kind on every control point', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tactical-map-'));
    const map = validMap() as unknown as BrokenMap;
    map.controlPoints = [
      { id: 'cp_a', name: 'Typed', q: 0, r: 0, kind: 'supply' },
      { id: 'cp_b', name: 'Untyped', q: 0, r: 1 },
    ];
    writeFileSync(join(dir, 'default.json'), JSON.stringify(map));

    expect(() => loadMaps(dir)).toThrow('controlPoints[1].kind is required');
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

  it('accepts per-kind deploy switches and surfaces them on the loaded config', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tactical-map-'));
    const map = validMap() as unknown as BrokenMap;
    map.controlPoints = [{ id: 'cp_a', name: 'Typed', q: 0, r: 0, kind: 'supply' }];
    map.balance.controlPointTypes = {
      ...controlPointTypes(),
      supply: { ...controlPointTypes().supply, canDeploy: false },
    };
    writeFileSync(join(dir, 'default.json'), JSON.stringify(map));
    resetConfig();
    loadMaps(dir);

    const loaded = getMapConfig('default');
    expect(loaded.balance.controlPointTypes?.supply.canDeploy).toBe(false);
    expect(loaded.balance.controlPointTypes?.forward_base.canDeploy).toBeUndefined();
    resetConfig();
  });

  it('rejects non-boolean canDeploy on control point types', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tactical-map-'));
    const map = validMap() as unknown as BrokenMap;
    map.controlPoints = [{ id: 'cp_a', name: 'Typed', q: 0, r: 0, kind: 'supply' }];
    map.balance.controlPointTypes = {
      ...controlPointTypes(),
      supply: { ...controlPointTypes().supply, canDeploy: 'yes' },
    };
    writeFileSync(join(dir, 'default.json'), JSON.stringify(map));

    expect(() => loadMaps(dir)).toThrow('balance.controlPointTypes.supply.canDeploy must be boolean');
    resetConfig();
  });

  it('loads dual-lanes as a typed control point map alongside the converted default map', () => {
    resetConfig();
    loadMaps();

    const legacy = getMapConfig('default');
    const dual = getMapConfig('dual-lanes');

    // 普通据点已移除：default 图五个据点全部转为补给站，收入沿用原统一值 12。
    expect(legacy.controlPoints.map(point => point.kind)).toEqual([
      'supply', 'supply', 'supply', 'supply', 'supply',
    ]);
    expect(legacy.balance.controlPointTypes?.supply).toMatchObject({ income: 12, deployDiscount: 0, repairAmount: 0 });
    expect(legacy.balance.controlPointIncome).toBeUndefined();
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
    expect(map.preview.cells).toHaveLength(217);
    expect(map.preview.maxTurns).toBe(15);
    expect(map.preview.terrainCells).toContainEqual({ q: -1, r: -2, terrain: 'water' });
    expect(map.preview.controlPoints).toContainEqual(expect.objectContaining({ name: '中央阵地', q: 0, r: 0 }));
    expect(map.preview.headquarters.player_a).toEqual({ q: -8, r: 0 });
    expect(map.preview.headquarters.player_b).toEqual({ q: 8, r: 0 });
    resetConfig();
  });

  it('keeps annihilation mode separate from map identity', () => {
    resetConfig();
    loadMaps();

    const map = listMaps().find(item => item.id === 'artillery-zone')!;

    expect(map.name).toBe('炮火禁区');
    expect(map.preview.mode).toBe('annihilation');
    expect(map.preview.supportedPlayerCounts).toEqual([2, 3, 6]);
    expect(listMaps().some(item => item.id === 'annihilation')).toBe(false);
    resetConfig();
  });

  it('keeps artillery-zone terrain, spawn points and armies rotationally symmetric', () => {
    resetConfig();
    loadMaps();
    const map = getMapConfig('artillery-zone');
    const rotate = (pos: { q: number; r: number }) => ({ q: -pos.r, r: pos.q + pos.r });
    const terrain = new Map(map.terrainCells.map(cell => [`${cell.q},${cell.r}`, cell.terrain]));
    const points = new Set(map.controlPoints.map(point => `${point.q},${point.r}`));
    const headquarters = new Set(map.spawnSlots.map(slot => `${slot.headquarters.q},${slot.headquarters.r}`));
    const armies = new Set(map.spawnSlots.flatMap(slot =>
      slot.startingUnits.map(unit => `${unit.type}:${unit.q},${unit.r}`)));

    for (const cell of map.terrainCells) {
      const rotated = rotate(cell);
      expect(terrain.get(`${rotated.q},${rotated.r}`)).toBe(cell.terrain);
    }
    for (const point of map.controlPoints) {
      const rotated = rotate(point);
      expect(points.has(`${rotated.q},${rotated.r}`)).toBe(true);
    }
    for (const slot of map.spawnSlots) {
      const rotated = rotate(slot.headquarters);
      expect(headquarters.has(`${rotated.q},${rotated.r}`)).toBe(true);
      expect(slot.startingUnits.map(unit => unit.type)).toEqual(['infantry', 'infantry', 'heavy']);
      const direction = slot.id.slice('slot_'.length);
      const matchingSupply = map.controlPoints.find(point => point.id === `supply_${direction}`)!;
      const infantry = slot.startingUnits.filter(unit => unit.type === 'infantry');
      expect(infantry.some(unit =>
        hexDistance(unit, matchingSupply) <= map.units.infantry.moveRange)).toBe(true);
      for (const unit of slot.startingUnits) {
        const rotatedUnit = rotate(unit);
        expect(armies.has(`${unit.type}:${rotatedUnit.q},${rotatedUnit.r}`)).toBe(true);
      }
    }
    expect(map.controlPoints.filter(point => point.kind === 'forward_base')).toHaveLength(6);
    expect(map.controlPoints.filter(point => point.kind === 'supply')).toHaveLength(6);
    expect(map.controlPoints.filter(point => point.kind === 'forward_base')
      .every(point => hexDistance(point, { q: 0, r: 0 }) === 4)).toBe(true);
    expect(map.controlPoints.filter(point => point.kind === 'supply')
      .every(point => hexDistance(point, { q: 0, r: 0 }) === 3)).toBe(true);
    expect(map.balance).toMatchObject({
      baseIncome: 8,
      actionsPerTurn: 4,
      maxTurns: 20,
      controlPointTypes: {
        forward_base: { income: 4 },
        supply: { income: 8 },
      },
    });
    const middlePhaseIncome = 4 * (8 + 4 + 8);
    expect(Math.floor(middlePhaseIncome / map.units.scout.cost)).toBe(2);
    expect(map.layouts).toEqual({
      2: ['slot_east', 'slot_west'],
      3: ['slot_east', 'slot_northwest', 'slot_southwest'],
      6: ['slot_east', 'slot_northeast', 'slot_northwest', 'slot_west', 'slot_southwest', 'slot_southeast'],
    });
    resetConfig();
  });

  it('loads legacy radius maps and irregular maps into the same authoritative cell model', () => {
    resetConfig();
    loadMaps();

    const legacy = getMapConfig('default');
    const irregular = getMapConfig('whirlpool');
    const preview = listMaps().find(item => item.id === 'whirlpool')!.preview;

    expect(legacy.playableCells).toHaveLength(217);
    expect(irregular.playableCells).toHaveLength(217);
    expect(preview.cells).toHaveLength(217);
    expect(preview.supportedPlayerCounts).toEqual([2, 3, 6]);
    expect(irregular.playableCells.some(cell => cell.q === 9 && cell.r === 0)).toBe(false);
    resetConfig();
  });

  it.each([
    ['duplicate', (map: Record<string, any>) => map.playableCells.push({ ...map.playableCells[0] }), 'duplicates'],
    ['disconnected', (map: Record<string, any>) => {
      map.playableCells = [map.playableCells[0], map.playableCells[map.playableCells.length - 1]];
    }, 'must form one connected area'],
    ['object outside', (map: Record<string, any>) => {
      // 先挖掉一个在半径内的格子，再往该格放地形，才能构造「半径内但不属于 playableCells」。
      map.playableCells = map.playableCells.filter((cell: any) => !(cell.q === 8 && cell.r === 0));
      map.terrainCells.push({ q: 8, r: 0, terrain: 'water' });
    }, 'is outside playableCells'],
  ])('rejects invalid irregular geometry: %s', (_name, mutate, message) => {
    const dir = mkdtempSync(join(tmpdir(), 'tactical-map-'));
    const map = whirlpoolMap();
    mutate(map);
    writeFileSync(join(dir, 'default.json'), JSON.stringify(map));
    expect(() => loadMaps(dir)).toThrow(message);
    resetConfig();
  });

  it('keeps engine boundary checks independent from radius geometry', () => {
    const validationSource = readFileSync('src/engine/validation.ts', 'utf8');
    expect(validationSource).not.toContain('isValidHex');
    expect(validationSource).toContain('game.cells.some');
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

  it('loads molten-throne map with diagonal HQs and a 24-point crucible for king-of-the-hill play', () => {
    resetConfig();
    loadMaps();

    const map = getMapConfig('molten-throne');
    expect(map.name).toBe('熔池王座');
    // 本图运行于同时回合模式（秘密计划、统一结算）
    expect(map.mode).toBe('simultaneous');
    expect(map.radius).toBe(6);
    expect(map.balance.maxTurns).toBe(20);
    // 对角线总部：双方斜向对峙，距离为 10
    expect(map.headquarters.player_a).toEqual({ q: -5, r: 5 });
    expect(map.headquarters.player_b).toEqual({ q: 5, r: -5 });
    expect(hexDistance(map.headquarters.player_a, map.headquarters.player_b)).toBe(10);
    expect(map.headquartersSpec.hp).toBe(100);
    expect(map.headquartersSpec.defense).toBe(3);

    // 占点为王：24 座据点全部类型化，不再有全局 controlPointIncome，增援不得从总部部署
    expect(map.controlPoints.length).toBe(24);
    expect(map.balance.controlPointIncome).toBeUndefined();
    expect(map.balance.deployFromHq).toBe(false);
    // 全图仅前哨站可部署：补给站/维修站显式 canDeploy:false
    expect(map.balance.controlPointTypes?.supply.canDeploy).toBe(false);
    expect(map.balance.controlPointTypes?.repair.canDeploy).toBe(false);
    const kindCounts = map.controlPoints.reduce<Record<string, number>>((acc, point) => {
      acc[point.kind] = (acc[point.kind] ?? 0) + 1;
      return acc;
    }, {});
    expect(kindCounts).toEqual({ supply: 16, repair: 4, forward_base: 4 });
    // 据点名全图唯一，观战与战报可读
    const names = map.controlPoints.map(point => point.name);
    expect(new Set(names).size).toBe(names.length);
    // 部署起点（前哨站）内外两环各一对：内环东北/西南，外环西北/东南对角；修缮点各领其侧
    const kindAt = (q: number, r: number) => map.controlPoints.find(c => c.q === q && c.r === r)!.kind;
    expect(kindAt(1, -1)).toBe('forward_base');
    expect(kindAt(-1, 1)).toBe('forward_base');
    expect(kindAt(-2, -2)).toBe('forward_base');
    expect(kindAt(2, 2)).toBe('forward_base');
    expect(kindAt(-2, -1)).toBe('repair');
    expect(kindAt(-1, -2)).toBe('repair');
    expect(kindAt(2, 1)).toBe('repair');
    expect(kindAt(1, 2)).toBe('repair');

    // 24 座据点关于原点 180° 对称、类型一致
    for (const point of map.controlPoints) {
      expect(point.kind).toBeTruthy();
      const mirror = originReflection(point);
      const counterpart = map.controlPoints.find(c => c.q === mirror.q && c.r === mirror.r);
      expect(counterpart, `${point.id} should mirror to (${mirror.q},${mirror.r})`).toBeTruthy();
      expect(counterpart!.kind).toBe(point.kind);
    }

    // 地形关于原点对称
    for (const cell of map.terrainCells) {
      const mirror = originReflection(cell);
      const counterpart = map.terrainCells.find(c => c.q === mirror.q && c.r === mirror.r);
      expect(counterpart, `terrain (${cell.q},${cell.r}) should mirror to (${mirror.q},${mirror.r})`).toBeTruthy();
      expect(counterpart!.terrain).toBe(cell.terrain);
    }

    // 中央熔池不可通行；西北/东南两角墙垣加水域封死，争夺全部压向中腹
    expect(terrainAt(map, 0, 0)).toBe('water');
    expect(terrainAt(map, -3, -3)).toBe('water');
    expect(terrainAt(map, 3, 3)).toBe('water');
    expect(terrainAt(map, -3, 0)).toBe('blocker');
    expect(terrainAt(map, 0, -3)).toBe('blocker');
    expect(terrainAt(map, 3, 0)).toBe('blocker');
    expect(terrainAt(map, 0, 3)).toBe('blocker');
    // 斜向窄缝仍可通行
    expect(terrainAt(map, 1, -1)).toBe('plain');
    expect(terrainAt(map, -1, 1)).toBe('plain');

    // 起手 5 斥候 + 1 支援（斥候为唯一可占点兵种），槽位关于原点对称、归属互换
    expect(map.startingUnits.length).toBe(12);
    for (const slot of map.spawnSlots) {
      expect(slot.startingUnits.map(u => u.type).sort()).toEqual(['scout', 'scout', 'scout', 'scout', 'scout', 'support']);
    }
    for (const unit of map.startingUnits) {
      const mirror = originReflection(unit);
      const counterpart = map.startingUnits.find(c => c.q === mirror.q && c.r === mirror.r);
      expect(counterpart, `starting unit (${unit.q},${unit.r}) should mirror to (${mirror.q},${mirror.r})`).toBeTruthy();
      expect(counterpart!.type).toBe(unit.type);
      expect(counterpart!.owner).toBe(unit.owner === 'player_a' ? 'player_b' : 'player_a');
    }
    // 本图斥候特化为可战之兵（攻 25，其余地图为 16）
    expect(map.units.scout.attack).toBe(25);

    resetConfig();
  });

  it('ships whirlpool with a combat-viable but non-monopolised unit table', () => {
    resetConfig();
    loadMaps();

    const map = getMapConfig('whirlpool');
    const units = map.units;
    const variance = map.balance.damageVarianceRange;
    const types = ['infantry', 'scout', 'heavy', 'ranger', 'support'] as const;
    const worstHit = (attacker: (typeof types)[number], target: (typeof types)[number]) =>
      units[attacker].attack - units[target].defense - variance;

    // 廉价杂兵不允许互相秒杀：以本图基线攻击（步兵）衡量，任何单位都要能活过一次最坏掷骰
    for (const type of types) {
      expect(worstHit('infantry', type), `infantry can one-shot ${type}`).toBeLessThan(units[type].hp);
    }

    // 专精克制必须真的成立：远程全额秒掉侦察，否则轻装海无解
    expect(worstHit('ranger', 'scout')).toBeGreaterThanOrEqual(units.scout.hp);

    // 重装靠耐久而非爆发：不允许一击秒杀任何兵种
    for (const type of types) {
      expect(worstHit('heavy', type), `heavy can one-shot ${type}`).toBeLessThan(units[type].hp);
    }

    // 每点成本的存活击数不得出现垄断：重装允许领跑，但保持在步兵的 1.35 倍以内
    const hitsToDie = (type: (typeof types)[number]) =>
      Math.ceil(units[type].hp / Math.max(1, units.infantry.attack - units[type].defense));
    const perCost = (type: (typeof types)[number]) => hitsToDie(type) / units[type].cost;
    const infantryPerCost = perCost('infantry');
    for (const type of types) {
      expect(perCost(type) / infantryPerCost, `${type} durability-per-cost out of band`)
        .toBeLessThanOrEqual(1.35);
    }

    // 占点权只交给廉价单位：可占领兵种必须比不可占领的重装与远程便宜
    const capturers = types.filter(type => units[type].canCapture);
    expect(capturers).toEqual(['infantry', 'scout']);
    for (const type of capturers) {
      expect(units[type].cost).toBeLessThan(units.heavy.cost);
      expect(units[type].cost).toBeLessThan(units.ranger.cost);
    }

    resetConfig();
  });

  it('loads the royale map snowflake with artillery config and control-point spawns', () => {
    resetConfig();
    loadMaps();

    const map = getMapConfig('snowflake');
    expect(map.mode).toBe('royale');
    expect(map.name).toBe('雪花');
    expect(map.balance.maxTurns).toBeNull();
    expect(map.annihilation?.artillery).toEqual({
      startRound: 6, intervalRounds: 1, damage: 25, minimumSafeRadius: 1,
    });
    expect(map.spawnSlots.length).toBe(6);
    for (const slot of map.spawnSlots) {
      expect(slot.controlPointId).toBeTruthy();
      expect(map.controlPoints.some(point => point.id === slot.controlPointId)).toBe(true);
    }
    expect(map.balance.adjudicationWeights.killValue).toBe(1.5);
    resetConfig();
  });

  it('exposes snowflake in the map list as a royale preview', () => {
    resetConfig();
    loadMaps();

    const map = listMaps().find(item => item.id === 'snowflake')!;
    expect(map.name).toBe('雪花');
    expect(map.preview.mode).toBe('royale');
    expect(map.preview.maxTurns).toBeNull();
    expect(map.preview.artillery).toEqual({
      startRound: 6, intervalRounds: 1, damage: 25, minimumSafeRadius: 1,
    });
    resetConfig();
  });

  function royaleMap() {
    const base: Record<string, unknown> = { ...validMap() };
    // 新式 spawnSlots 存在时遗留 headquarters/startingUnits 不再参与推导，删除以免与控制点抢格。
    delete base.headquarters;
    delete base.startingUnits;
    return {
      ...base,
      mode: 'royale',
      annihilation: { artillery: { startRound: 6, intervalRounds: 1, damage: 25, minimumSafeRadius: 0 } },
      controlPoints: [
        { id: 'cp_a', name: 'A', kind: 'supply', q: 1, r: 0 },
        { id: 'cp_b', name: 'B', kind: 'supply', q: -1, r: 0 },
      ],
      spawnSlots: [
        { id: 'slot_a', headquarters: { q: 2, r: 0 }, controlPointId: 'cp_a', startingUnits: [] },
        { id: 'slot_b', headquarters: { q: -2, r: 0 }, controlPointId: 'cp_b', startingUnits: [] },
      ],
      layouts: { '2': ['slot_a', 'slot_b'] },
    } as Record<string, unknown>;
  }

  it('accepts a minimal royale map with minimumSafeRadius 0', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tactical-map-'));
    writeFileSync(join(dir, 'default.json'), JSON.stringify(royaleMap()));

    expect(() => loadMaps(dir)).not.toThrow();
    expect(getMapConfig('default').mode).toBe('royale');
    resetConfig();
  });

  it('requires the annihilation block in royale mode', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tactical-map-'));
    const map = royaleMap();
    delete map.annihilation;
    writeFileSync(join(dir, 'default.json'), JSON.stringify(map));

    expect(() => loadMaps(dir)).toThrow('Map "default".annihilation must be an object');
    resetConfig();
  });

  it('still rejects the annihilation block on standard and simultaneous maps', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tactical-map-'));
    const map = { ...validMap(), annihilation: { artillery: { startRound: 6, intervalRounds: 1, damage: 25, minimumSafeRadius: 0 } } };
    writeFileSync(join(dir, 'default.json'), JSON.stringify(map));

    expect(() => loadMaps(dir)).toThrow('Map "default".annihilation is only valid in annihilation or royale mode');
    resetConfig();
  });

  it.each([
    [-1, 'minimumSafeRadius must be a number >= 0'],
    [2, 'minimumSafeRadius must be smaller than radius'],
    [1.5, 'minimumSafeRadius must be an integer'],
  ])('validates royale artillery minimumSafeRadius %#', (minimumSafeRadius, message) => {
    const dir = mkdtempSync(join(tmpdir(), 'tactical-map-'));
    const map = royaleMap() as Record<string, any>;
    map.annihilation.artillery.minimumSafeRadius = minimumSafeRadius;
    writeFileSync(join(dir, 'default.json'), JSON.stringify(map));

    expect(() => loadMaps(dir)).toThrow(message);
    resetConfig();
  });

  it('requires royale spawn slots to bind control points', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tactical-map-'));
    const map = royaleMap() as Record<string, any>;
    delete map.spawnSlots[1].controlPointId;
    writeFileSync(join(dir, 'default.json'), JSON.stringify(map));

    expect(() => loadMaps(dir)).toThrow('spawnSlots[1].controlPointId');
    resetConfig();
  });
});
