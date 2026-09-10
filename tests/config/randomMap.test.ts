import { describe, expect, it } from 'vitest';
import { generateRandomMapConfig, sanitizeRandomOptions } from '../../src/config/randomMap.js';
import { loadMaps, resetConfig, validateGeneratedMap } from '../../src/config/loader.js';

function cellKey(pos: { q: number; r: number }): string {
  return `${pos.q},${pos.r}`;
}

describe('random map generator', () => {
  it('produces deterministic output for the same seed', () => {
    const first = generateRandomMapConfig({ seed: 'training-42' }, 2);
    const second = generateRandomMapConfig({ seed: 'training-42' }, 2);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));

    const other = generateRandomMapConfig({ seed: 'training-43' }, 2);
    expect(JSON.stringify(other)).not.toBe(JSON.stringify(first));
  });

  it('keeps symmetric maps mirror-invariant across terrain, spawns and control points', () => {
    const config = generateRandomMapConfig({ seed: 'mirror', symmetric: true }, 2);

    const terrain = new Set(config.terrainCells.map(cellKey));
    for (const cell of config.terrainCells) {
      expect(terrain.has(`${-cell.q},${-cell.r}`)).toBe(true);
    }

    const [slotA, slotB] = config.spawnSlots;
    expect(slotB.headquarters).toEqual({ q: -slotA.headquarters.q, r: -slotA.headquarters.r });
    // 初始单位布局严格镜像：相对位置取反后类型一致。
    const unitBAt = (q: number, r: number) =>
      slotB.startingUnits.find(unit => unit.q === slotB.headquarters.q - (q - slotA.headquarters.q)
        && unit.r === slotB.headquarters.r - (r - slotA.headquarters.r));
    for (const unit of slotA.startingUnits) {
      const twin = unitBAt(unit.q, unit.r);
      expect(twin).toBeDefined();
      expect(twin!.type).toBe(unit.type);
    }

    const cpSet = new Set(config.controlPoints.map(cp => cellKey(cp)));
    for (const cp of config.controlPoints) {
      expect(cpSet.has(`${-cp.q},${-cp.r}`)).toBe(true);
      const twin = config.controlPoints.find(other => other.q === -cp.q && other.r === -cp.r);
      expect(twin!.kind).toBe(cp.kind);
    }
  });

  it('honors fixed parameters exactly', () => {
    const config = generateRandomMapConfig({
      seed: 'fixed',
      maxTurns: 30,
      actionsPerTurn: 4,
      radius: 9,
      startingSupplies: 200,
      unitStatVariation: 0,
    }, 2);
    expect(config.balance.maxTurns).toBe(30);
    expect(config.balance.actionsPerTurn).toBe(4);
    expect(config.radius).toBe(9);
    expect(config.balance.startingSupplies).toBe(200);
    // 零浮动时兵种数值与基准一致。
    expect(config.units.infantry).toMatchObject({ hp: 100, attack: 30, moveRange: 3, cost: 45 });
  });

  it('supports random ranges for parameters', () => {
    for (let i = 0; i < 10; i++) {
      const config = generateRandomMapConfig({ maxTurns: [12, 13] }, 2);
      expect([12, 13]).toContain(config.balance.maxTurns);
    }
  });

  it('always generates configs that pass the standard map validation', () => {
    resetConfig();
    loadMaps();
    for (const playerCount of [2, 3, 4, 5, 6, 7, 8]) {
      for (let seed = 0; seed < 6; seed++) {
        const config = generateRandomMapConfig({ seed: `smoke-${seed}` }, playerCount);
        expect(() => validateGeneratedMap(JSON.parse(JSON.stringify(config)))).not.toThrow();
        expect(config.spawnSlots).toHaveLength(playerCount);
        expect(config.layouts[String(playerCount)]).toHaveLength(playerCount);
        // 每个出生位都有总部；初始单位数量 0-4 且全员一致（公平性，dual-lanes 式 0 单位合法）。
        const unitCounts = new Set(config.spawnSlots.map(slot => slot.startingUnits.length));
        expect(unitCounts.size).toBe(1);
        expect([...unitCounts][0]).toBeLessThanOrEqual(4);
        // 偶数人数对称局：成对出生位的总部与初始单位（含兵种）严格镜像。
        if (playerCount % 2 === 0) {
          for (let i = 0; i < playerCount / 2; i++) {
            const slotA = config.spawnSlots[i];
            const slotB = config.spawnSlots[i + playerCount / 2];
            expect(slotB.headquarters).toEqual({ q: -slotA.headquarters.q, r: -slotA.headquarters.r });
            expect(slotB.startingUnits).toHaveLength(slotA.startingUnits.length);
            for (const unit of slotA.startingUnits) {
              const twin = slotB.startingUnits.find(other => other.q === -unit.q && other.r === -unit.r);
              expect(twin, `unit ${unit.type}@(${unit.q},${unit.r}) missing mirror`).toBeDefined();
              expect(twin!.type).toBe(unit.type);
            }
          }
        }
      }
    }
    resetConfig();
    loadMaps();
  });

  it('keeps playable terrain connected for generated maps', () => {
    const config = generateRandomMapConfig({ seed: 'connect', terrainDensity: 0.35 }, 4);
    const blocked = new Set(config.terrainCells.map(cellKey));
    const playable = config.playableCells.filter(cell => !blocked.has(cellKey(cell)));
    const adjacency = new Map<string, string[]>();
    const keyOf = cellKey;
    const playableSet = new Set(playable.map(keyOf));
    for (const cell of playable) {
      const neighbors = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]
        .map(([dq, dr]) => `${cell.q + dq},${cell.r + dr}`)
        .filter(key => playableSet.has(key));
      adjacency.set(keyOf(cell), neighbors);
    }
    const visited = new Set<string>([keyOf(playable[0])]);
    const queue = [keyOf(playable[0])];
    while (queue.length > 0) {
      for (const neighbor of adjacency.get(queue.shift()!) || []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    expect(visited.size).toBe(playable.length);
  });

  it('generates varied unit stats within the requested variation', () => {
    const config = generateRandomMapConfig({ seed: 'units', unitStatVariation: 0.5 }, 2);
    const infantry = config.units.infantry;
    expect(infantry.hp).toBeGreaterThanOrEqual(50);
    expect(infantry.hp).toBeLessThanOrEqual(150);
    expect(infantry.moveRange).toBeGreaterThanOrEqual(1);
    expect(infantry.canCapture).toBe(true);
    expect(config.units.support.healPower).toBeGreaterThanOrEqual(5);
  });

  it('default domain covers the static-map extremes (RL 训练分布包线)', () => {
    // v3.0.2-v3.1.0 三代 whack-a-mole 的根因修复：随机图默认域必须覆盖
    // danger-close(1 行动点/20 补给/零据点收入)、dual-lanes(0 初始单位/208 补给)、
    // forge(100 血总部/6 据点) 等静态图极值；裁决权重与据点类型收入也必须可变。
    const seen = {
      minAp: 99, maxAp: 0, minSupplies: 9999, maxSupplies: 0,
      minHq: 9999, maxHq: 0, minCp: 99, maxCp: 0, minCpIncome: 999, maxCpIncome: -1,
      zeroUnits: 0, fourUnits: 0,
      adjWeights: new Set<string>(), cpTypeIncome: new Set<string>(),
    };
    for (let seed = 0; seed < 300; seed++) {
      const config = generateRandomMapConfig({ seed: `coverage-${seed}` }, 2);
      const b = config.balance;
      seen.minAp = Math.min(seen.minAp, b.actionsPerTurn); seen.maxAp = Math.max(seen.maxAp, b.actionsPerTurn);
      seen.minSupplies = Math.min(seen.minSupplies, b.startingSupplies); seen.maxSupplies = Math.max(seen.maxSupplies, b.startingSupplies);
      const hq = config.headquartersSpec.hp;
      seen.minHq = Math.min(seen.minHq, hq); seen.maxHq = Math.max(seen.maxHq, hq);
      seen.minCp = Math.min(seen.minCp, config.controlPoints.length); seen.maxCp = Math.max(seen.maxCp, config.controlPoints.length);
      seen.minCpIncome = Math.min(seen.minCpIncome, b.controlPointIncome); seen.maxCpIncome = Math.max(seen.maxCpIncome, b.controlPointIncome);
      const units = config.spawnSlots[0].startingUnits.length;
      if (units === 0) seen.zeroUnits++;
      if (units === 4) seen.fourUnits++;
      seen.adjWeights.add(JSON.stringify(b.adjudicationWeights));
      seen.cpTypeIncome.add(JSON.stringify(b.controlPointTypes));
    }
    expect(seen.minAp).toBe(1); expect(seen.maxAp).toBe(8);
    expect(seen.minSupplies).toBeLessThanOrEqual(40); expect(seen.maxSupplies).toBeGreaterThanOrEqual(200);
    expect(seen.minHq).toBeLessThanOrEqual(100); expect(seen.maxHq).toBeGreaterThanOrEqual(220);
    expect(seen.minCp).toBe(2); expect(seen.maxCp).toBe(6);
    expect(seen.minCpIncome).toBe(0); expect(seen.maxCpIncome).toBeGreaterThanOrEqual(14);
    expect(seen.zeroUnits).toBeGreaterThan(0); expect(seen.fourUnits).toBeGreaterThan(0);
    expect(seen.adjWeights.size).toBeGreaterThan(50);
    expect(seen.cpTypeIncome.size).toBeGreaterThan(50);
  });
});

describe('sanitizeRandomOptions', () => {
  it('accepts empty and well-formed options', () => {
    expect(sanitizeRandomOptions(undefined)).toEqual({});
    expect(sanitizeRandomOptions({ seed: 'abc', symmetric: false, maxTurns: 20 }))
      .toEqual({ seed: 'abc', symmetric: false, maxTurns: 20 });
    expect(sanitizeRandomOptions({ radius: [5, 8] }).radius).toEqual([5, 8]);
  });

  it('clamps out-of-range values and collapses ranges', () => {
    expect(sanitizeRandomOptions({ radius: 999 }).radius).toBe(12);
    expect(sanitizeRandomOptions({ maxTurns: [50, 5] }).maxTurns).toEqual([5, 50]);
    expect(sanitizeRandomOptions({ actionsPerTurn: [7, 7] }).actionsPerTurn).toBe(7);
  });

  it('rejects malformed options', () => {
    expect(() => sanitizeRandomOptions('nope')).toThrow();
    expect(() => sanitizeRandomOptions({ maxTurns: 'many' })).toThrow('maxTurns');
    expect(() => sanitizeRandomOptions({ maxTurns: [1] })).toThrow('maxTurns');
    expect(() => sanitizeRandomOptions({ maxTurns: Number.NaN })).toThrow();
    expect(() => sanitizeRandomOptions({ symmetric: 'yes' })).toThrow('symmetric');
    expect(() => sanitizeRandomOptions({ seed: '' })).toThrow('seed');
    expect(() => sanitizeRandomOptions({ bogus: 1 })).toThrow('unknown random option');
  });
});
