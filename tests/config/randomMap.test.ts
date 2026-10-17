import { describe, expect, it } from 'vitest';
import { generateRandomMapConfig, sanitizeRandomOptions } from '../../src/config/randomMap.js';
import { loadMaps, resetConfig, validateGeneratedMap } from '../../src/config/loader.js';
import { hexDistance } from '../../src/engine/hex.js';

function cellKey(pos: { q: number; r: number }): string {
  return `${pos.q},${pos.r}`;
}

/** 取负并归一 -0：配置侧把 -0 规范成 0，期望值同样处理后再比对。 */
function neg(value: number): number {
  return value === 0 ? 0 : -value;
}

/** 绕中心旋转 steps×60°（六边形网格整格映射）：(q, r) → (-r, q + r)，并把 -0 归一。 */
function rot(pos: { q: number; r: number }, steps: number): { q: number; r: number } {
  const normalized = ((steps % 6) + 6) % 6;
  let current = { q: pos.q, r: pos.r };
  for (let i = 0; i < normalized; i++) {
    const q = current.q;
    current = { q: current.r === 0 ? 0 : -current.r, r: q + current.r === 0 ? 0 : q + current.r };
  }
  return current;
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
      expect(terrain.has(`${neg(cell.q)},${neg(cell.r)}`)).toBe(true);
    }

    const [slotA, slotB] = config.spawnSlots;
    expect(slotB.headquarters).toEqual({ q: neg(slotA.headquarters.q), r: neg(slotA.headquarters.r) });
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
      expect(cpSet.has(`${neg(cp.q)},${neg(cp.r)}`)).toBe(true);
      const twin = config.controlPoints.find(other => other.q === neg(cp.q) && other.r === neg(cp.r));
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

  it('defaults to standard mode without an annihilation block', () => {
    const config = generateRandomMapConfig({ seed: 'mode-default' }, 2);
    expect(config.mode).toBe('standard');
    expect('annihilation' in config).toBe(false);
  });

  it('supports all four game modes with mode-appropriate artillery blocks', () => {
    resetConfig();
    loadMaps();
    const expectations = {
      standard: { annihilation: false },
      annihilation: { annihilation: true },
      simultaneous: { annihilation: false },
      royale: { annihilation: true },
    } as const;
    for (const [mode, expected] of Object.entries(expectations)) {
      const config = generateRandomMapConfig({ seed: `mode-${mode}`, mode: mode as any }, 2);
      expect(config.mode, mode).toBe(mode);
      expect(('annihilation' in config), mode).toBe(expected.annihilation);
      if (expected.annihilation) {
        // 歼灭/大逃杀必须带炮火配置且数值在边界表范围内。
        expect(config.annihilation!.artillery).toMatchObject({
          startRound: expect.any(Number),
          intervalRounds: expect.any(Number),
          damage: expect.any(Number),
          minimumSafeRadius: expect.any(Number),
        });
        const artillery = config.annihilation!.artillery;
        expect(artillery.startRound).toBeGreaterThanOrEqual(1);
        expect(artillery.intervalRounds).toBeGreaterThanOrEqual(1);
        expect(artillery.damage).toBeGreaterThanOrEqual(1);
        expect(artillery.minimumSafeRadius).toBeGreaterThanOrEqual(0);
        expect(artillery.minimumSafeRadius).toBeLessThan(config.radius);
      }
      // 歼灭/大逃杀的出生位按序绑定唯一据点（store 据此设据点归属）。
      if (expected.annihilation && config.controlPoints.length >= config.spawnSlots.length) {
        const boundIds = config.spawnSlots.map(slot => slot.controlPointId);
        expect(new Set(boundIds).size, mode).toBe(config.spawnSlots.length);
        for (const id of boundIds) {
          expect(config.controlPoints.some(cp => cp.id === id), `${mode}:${id}`).toBe(true);
        }
      }
      expect(() => validateGeneratedMap(JSON.parse(JSON.stringify(config))), mode).not.toThrow();
    }
    resetConfig();
    loadMaps();
  });

  it('honors fixed artillery parameters in annihilation mode', () => {
    const config = generateRandomMapConfig({
      seed: 'artillery-fixed',
      mode: 'annihilation',
      artilleryStartRound: 7,
      artilleryIntervalRounds: 2,
      artilleryDamage: 18,
      artilleryMinimumSafeRadius: 1,
    }, 2);
    expect(config.annihilation!.artillery).toEqual({
      startRound: 7,
      intervalRounds: 2,
      damage: 18,
      minimumSafeRadius: 1,
    });
  });

  it('tops up control points to cover spawn slots in annihilation mode', () => {
    // 请求 1 个据点（< 出生位数 2）：歼灭模式必须保证据点数 ≥ 出生位数，否则
    // loader 的「每个出生位绑定唯一据点」约束无法满足。
    const config = generateRandomMapConfig({
      seed: 'cp-short',
      mode: 'annihilation',
      controlPointCount: 1,
    }, 2);
    expect(config.controlPoints.length).toBeGreaterThanOrEqual(config.spawnSlots.length);
    const ids = new Set(config.spawnSlots.map(slot => slot.controlPointId));
    expect(ids.size).toBe(config.spawnSlots.length);
    for (const id of ids) {
      expect(config.controlPoints.some(cp => cp.id === id)).toBe(true);
    }
  });

  it('binds each spawn slot to a nearby distinct control point instead of by index', () => {
    // 回归：此前按 controlPoints[index] 顺序绑定，出生位常被绑到地图另一侧的据点
    // （实测 77% 非最近、最远 12 格，偶数据点时中心点还被边缘出生位占有）。改为
    // 就近唯一分配后，除「最近据点已被不更远的出生位占走」这一争用情形外，必须绑最近据点。
    for (const playerCount of [2, 3, 4, 5, 6]) {
      for (const seed of ['bind-a', 'bind-b', 'bind-c']) {
        const config = generateRandomMapConfig({ seed, mode: 'annihilation', symmetric: false }, playerCount);
        const byId = new Map(config.controlPoints.map(cp => [cp.id, cp]));
        const ownerOf = new Map(config.spawnSlots.map(slot => [slot.controlPointId, slot]));
        for (const slot of config.spawnSlots) {
          const bound = byId.get(slot.controlPointId);
          expect(bound, `${seed}:${playerCount}:${slot.id} 未绑定据点`).toBeDefined();
          if (!bound) continue;
          let nearest = bound;
          let nearestDistance = hexDistance(slot.headquarters, bound);
          for (const cp of config.controlPoints) {
            const distance = hexDistance(slot.headquarters, cp);
            if (distance < nearestDistance) {
              nearest = cp;
              nearestDistance = distance;
            }
          }
          if (nearest.id !== bound.id) {
            // 最近的据点被另一出生位占用，且该占用者到它的距离不比自己远（就近贪心的必然结果）。
            const occupant = ownerOf.get(nearest.id);
            expect(occupant, `${seed}:${playerCount}:${nearest.id} 无归属`).toBeDefined();
            if (occupant) {
              expect(hexDistance(occupant.headquarters, nearest)).toBeLessThanOrEqual(nearestDistance);
            }
          }
        }
      }
    }
  });

  it('binds mirror spawn slots to mirror control points in symmetric annihilation maps', () => {
    // 对称偶数局必须保持开局领土镜像：出生位 i 与其镜像位绑定的据点互为镜像，
    // 且据点集本身镜像闭合——补放也必须成对，否则对称性会从源头被破坏。
    for (const playerCount of [2, 4, 6, 8]) {
      for (const seed of ['sym-bind-a', 'sym-bind-b', 'sym-bind-c']) {
        const config = generateRandomMapConfig({ seed, mode: 'royale', symmetric: true }, playerCount);
        const keys = new Set(config.controlPoints.map(cp => cellKey(cp)));
        for (const cp of config.controlPoints) {
          expect(keys.has(cellKey({ q: neg(cp.q), r: neg(cp.r) })), `${seed}:${playerCount}:${cp.id} 缺镜像`).toBe(true);
        }
        const byId = new Map(config.controlPoints.map(cp => [cp.id, cp]));
        const count = config.spawnSlots.length;
        for (let index = 0; index < count; index++) {
          const here = byId.get(config.spawnSlots[index].controlPointId);
          const mirrored = byId.get(config.spawnSlots[(index + count / 2) % count].controlPointId);
          expect(here, `${seed}:${playerCount}:${index} 未绑定`).toBeDefined();
          expect(mirrored, `${seed}:${playerCount}:${index + count / 2} 未绑定`).toBeDefined();
          if (!here || !mirrored) continue;
          expect({ q: mirrored.q, r: mirrored.r }).toEqual({ q: neg(here.q), r: neg(here.r) });
        }
      }
    }
  });

  it('generalizes rotation symmetry to the largest hex-compatible angle per player count', () => {
    // 六边形网格只在 60° 整数倍旋转下自映射；出生位需要 360/n。二者最小公倍角 = step60×60°。
    // 2/4/8 人 → 180°（m=2）；3 人 → 120°（m=3）；6 人 → 60°（m=6）。
    const cases: Record<number, number> = { 2: 3, 3: 2, 4: 3, 6: 1, 8: 3 };
    for (const [key, step60] of Object.entries(cases)) {
      const playerCount = Number(key);
      const sectors = 6 / step60;
      const stride = playerCount / sectors;
      for (const seed of ['rot-a', 'rot-b', 'rot-c']) {
        const config = generateRandomMapConfig({ seed, symmetric: true }, playerCount);
        const closed = (items: { q: number; r: number }[]): boolean => {
          const keys = new Set(items.map(cellKey));
          return items.every(pos => keys.has(cellKey(rot(pos, step60))));
        };
        expect(closed(config.spawnSlots.map(slot => slot.headquarters)), `${seed}:${playerCount} 出生位`).toBe(true);
        expect(closed(config.terrainCells), `${seed}:${playerCount} 地形`).toBe(true);
        expect(closed(config.controlPoints), `${seed}:${playerCount} 据点`).toBe(true);
        // 初始单位按同一旋转成组：轨道代表点的单位旋转后即对位出生位的单位。
        for (let i = 0; i < stride; i++) {
          for (let j = 1; j < sectors; j++) {
            const from = config.spawnSlots[i].startingUnits;
            const to = config.spawnSlots[i + j * stride].startingUnits;
            expect(to, `${seed}:${playerCount} 单位数`).toHaveLength(from.length);
            for (let unitIndex = 0; unitIndex < from.length; unitIndex++) {
              expect(to[unitIndex].type).toBe(from[unitIndex].type);
              expect({ q: to[unitIndex].q, r: to[unitIndex].r }).toEqual(rot(from[unitIndex], j * step60));
            }
          }
        }
      }
    }
  });

  it('keeps annihilation territory rotation-closed for every symmetric player count', () => {
    const cases: Record<number, number> = { 2: 3, 3: 2, 4: 3, 6: 1, 8: 3 };
    for (const [key, step60] of Object.entries(cases)) {
      const playerCount = Number(key);
      const sectors = 6 / step60;
      const stride = playerCount / sectors;
      const config = generateRandomMapConfig({ seed: 'bind-rot', mode: 'annihilation', symmetric: true }, playerCount);
      const byId = new Map(config.controlPoints.map(cp => [cp.id, cp]));
      const boundIds = config.spawnSlots.map(slot => slot.controlPointId);
      expect(new Set(boundIds).size, `${playerCount} 人绑定唯一`).toBe(playerCount);
      for (let i = 0; i < stride; i++) {
        for (let j = 1; j < sectors; j++) {
          const base = byId.get(config.spawnSlots[i].controlPointId)!;
          const peer = byId.get(config.spawnSlots[i + j * stride].controlPointId)!;
          expect(peer, `${playerCount}:${i}+${j * stride}`).toBeDefined();
          expect({ q: peer.q, r: peer.r }).toEqual(rot(base, j * step60));
        }
      }
    }
  });

  it('falls back to a non-symmetric layout when the player count admits no hex rotation (5/7)', () => {
    // 5 人需 72°、7 人需 360/7°，都不是 60° 的整数倍，六边盘无法自映射；如实降级而非假称对称。
    for (const playerCount of [5, 7]) {
      const config = generateRandomMapConfig({ seed: 'no-sym', symmetric: true }, playerCount);
      expect(config.description).toContain('非对称');
      expect(config.spawnSlots).toHaveLength(playerCount);
      expect(() => validateGeneratedMap(JSON.parse(JSON.stringify(config)))).not.toThrow();
      const b = generateRandomMapConfig({ seed: 'no-sym', symmetric: false }, playerCount);
      expect(JSON.stringify(config)).toBe(JSON.stringify(b));
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
            expect(slotB.headquarters).toEqual({ q: neg(slotA.headquarters.q), r: neg(slotA.headquarters.r) });
            expect(slotB.startingUnits).toHaveLength(slotA.startingUnits.length);
            for (const unit of slotA.startingUnits) {
              const twin = slotB.startingUnits.find(other => other.q === neg(unit.q) && other.r === neg(unit.r));
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

  it('never places terrain on a spawn headquarters or its neighbours', () => {
    // 初始单位只落在总部的 6 个邻格，且落格前不查地形；出生位保护必须覆盖这 6 格，
    // 否则会出兵站水里。用高密度压力验证该不变量。
    for (const playerCount of [2, 3, 4, 6]) {
      for (const symmetric of [true, false]) {
        const config = generateRandomMapConfig(
          { seed: 'spawn-plain', mode: 'annihilation', symmetric, terrainDensity: 0.3 }, playerCount,
        );
        const terrain = new Set(config.terrainCells.map(cellKey));
        for (const slot of config.spawnSlots) {
          expect(terrain.has(cellKey(slot.headquarters)), `总部落在 ${cellKey(slot.headquarters)}`).toBe(false);
          for (const unit of slot.startingUnits) {
            expect(terrain.has(cellKey(unit)), `初始单位落在 ${cellKey(unit)}`).toBe(false);
          }
        }
      }
    }
  });

  it('scatters terrain across the map instead of only the rim', () => {
    // 回归：此前出生位保护 2 环、据点保护 1 环，出生位/据点又多又均分时会连成整条带，
    // 把整个中圈挤出采样域，障碍只剩最外几圈（6 人图实测中圈 100% 无地形）。
    for (const playerCount of [2, 3, 4, 6]) {
      for (const symmetric of [true, false]) {
        let withInnerTerrain = 0;
        const games = 40;
        for (let seed = 0; seed < games; seed++) {
          const config = generateRandomMapConfig({ seed: `scatter-${seed}`, symmetric, terrainDensity: 0.12 }, playerCount);
          const innerHalf = Math.floor(config.radius / 2);
          if (config.terrainCells.some(cell => hexDistance(cell, { q: 0, r: 0 }) <= innerHalf)) withInnerTerrain++;
        }
        expect(withInnerTerrain, `${playerCount}人 symmetric=${symmetric}`).toBeGreaterThanOrEqual(games * 0.3);
      }
    }
  });

  it('splits terrain into independently controlled water and wall densities', () => {
    // 水域与阻挡各自独立：某类密度为 0 时整局不出现该类；两者都为正时两类都出现。
    const cases: Array<{ waterDensity: number; wallDensity: number; expectWater: boolean; expectWall: boolean }> = [
      { waterDensity: 0.06, wallDensity: 0, expectWater: true, expectWall: false },
      { waterDensity: 0, wallDensity: 0.06, expectWater: false, expectWall: true },
      { waterDensity: 0.06, wallDensity: 0.06, expectWater: true, expectWall: true },
    ];
    for (const { waterDensity, wallDensity, expectWater, expectWall } of cases) {
      for (let seed = 0; seed < 12; seed++) {
        const config = generateRandomMapConfig({ seed: `split-${seed}`, symmetric: true, waterDensity, wallDensity }, 4);
        const water = config.terrainCells.filter(cell => cell.terrain === 'water').length;
        const wall = config.terrainCells.filter(cell => cell.terrain === 'blocker').length;
        const label = `water=${waterDensity} wall=${wallDensity} seed=${seed}`;
        if (expectWater) expect(water, `${label} 缺水域`).toBeGreaterThan(0);
        else expect(water, `${label} 出现水域`).toBe(0);
        if (expectWall) expect(wall, `${label} 缺阻挡`).toBeGreaterThan(0);
        else expect(wall, `${label} 出现阻挡`).toBe(0);
      }
    }
    // 小地图 + 极小正值密度也必须真的出现（floor 曾把 0.005×91 格算成 0 格）。
    const tiny = generateRandomMapConfig(
      { seed: 'tiny-densities', symmetric: true, radius: 5, waterDensity: 0.005, wallDensity: 0.005 }, 6,
    );
    expect(tiny.terrainCells.some(cell => cell.terrain === 'water')).toBe(true);
    expect(tiny.terrainCells.some(cell => cell.terrain === 'blocker')).toBe(true);
  });

  it('lets starting unit weights steer the unit mix and exclude types', () => {
    // startingUnitCount 固定 4（硬边界内），50 个种子 × 2 出生位 × 4 单位 = 400 个样本足够统计；
    // support 刻意不设权重，任何路径都不应产出。
    const collect = (options: Omit<Parameters<typeof generateRandomMapConfig>[0], 'seed'> & { seed: string }) => {
      const types: string[] = [];
      for (let seed = 0; seed < 50; seed++) {
        const config = generateRandomMapConfig({ ...options, seed: `${options.seed}-${seed}` }, 2);
        for (const slot of config.spawnSlots) {
          for (const unit of slot.startingUnits) types.push(unit.type);
        }
      }
      return types;
    };

    // 权重 0 排除兵种：重装/远程权重为 0 时两者绝迹，步兵/侦察兵 50/50 都出现。
    const noHeavyRanger = collect({ seed: 'weight-zero', startingUnitCount: 4, startingWeightHeavy: 0, startingWeightRanger: 0 });
    expect(noHeavyRanger).toHaveLength(400);
    expect(new Set(noHeavyRanger)).toEqual(new Set(['infantry', 'scout']));

    // 单一权重：其余全 0 时只出该兵种。
    const onlyHeavy = collect({ seed: 'weight-only', startingUnitCount: 4, startingWeightInfantry: 0, startingWeightScout: 0, startingWeightHeavy: 3, startingWeightRanger: 0 });
    expect(new Set(onlyHeavy)).toEqual(new Set(['heavy']));

    // 全 0 权重回退旧均匀池：400 单位下池中全部 4 类都该出现。
    const allZero = collect({ seed: 'weight-fallback', startingUnitCount: 4, startingWeightInfantry: 0, startingWeightScout: 0, startingWeightHeavy: 0, startingWeightRanger: 0 });
    expect(new Set(allZero)).toEqual(new Set(['infantry', 'scout', 'heavy', 'ranger']));

    // 比例生效：步兵 1 vs 重装 9（10% vs 90%），400 次抽样按大数定律卡宽区间（期望 40，±5σ≈30）。
    const infantry = collect({ seed: 'weight-ratio', startingUnitCount: 4, startingWeightInfantry: 1, startingWeightScout: 0, startingWeightRanger: 0, startingWeightHeavy: 9 });
    const infantryCount = infantry.filter(type => type === 'infantry').length;
    expect(infantryCount, `步兵占比应约 10%（实测 ${infantryCount}/400）`).toBeGreaterThan(10);
    expect(infantryCount).toBeLessThan(70);
  });

  it('keeps fixed scalar starting weights rng-neutral and bit-identical to the default path', () => {
    // 标量权重（含显式默认值 2/2/1/1）不消耗随机数流：地图其余部分与省略权重的默认路径逐位一致。
    const base = generateRandomMapConfig({ seed: 'weight-neutral' }, 4);
    const scalars = generateRandomMapConfig(
      { seed: 'weight-neutral', startingWeightInfantry: 2, startingWeightScout: 2, startingWeightHeavy: 1, startingWeightRanger: 1 }, 4,
    );
    expect(JSON.stringify(scalars)).toBe(JSON.stringify(base));
    // 区间形态是显式非默认路径（各消耗 1 次 rng），只要求同种子可复现。
    const ranged = generateRandomMapConfig(
      { seed: 'weight-range', startingWeightInfantry: [1, 3], startingWeightScout: [1, 3], startingWeightHeavy: [0.5, 1.5], startingWeightRanger: [0.5, 1.5] }, 4,
    );
    const rangedAgain = generateRandomMapConfig(
      { seed: 'weight-range', startingWeightInfantry: [1, 3], startingWeightScout: [1, 3], startingWeightHeavy: [0.5, 1.5], startingWeightRanger: [0.5, 1.5] }, 4,
    );
    expect(JSON.stringify(rangedAgain)).toBe(JSON.stringify(ranged));
  });

  it('keeps fixed combat variance rng-neutral and ranged variance reproducible', () => {
    // 伤害/治疗波动默认是固定 3/6：显式固定为 3/6 与省略逐位一致（固定标量零消耗路径）。
    const base = generateRandomMapConfig({ seed: 'variance-neutral' }, 4);
    const scalars = generateRandomMapConfig(
      { seed: 'variance-neutral', damageVarianceRange: 3, healVarianceRange: 6 }, 4,
    );
    expect(JSON.stringify(scalars)).toBe(JSON.stringify(base));
    // 区间形态是显式非默认路径（各消耗 1 次 rng）：同种子可复现、取值为区间内整数。
    const ranged = generateRandomMapConfig(
      { seed: 'variance-range', damageVarianceRange: [0, 20], healVarianceRange: [0, 20] }, 4,
    );
    const rangedAgain = generateRandomMapConfig(
      { seed: 'variance-range', damageVarianceRange: [0, 20], healVarianceRange: [0, 20] }, 4,
    );
    expect(JSON.stringify(rangedAgain)).toBe(JSON.stringify(ranged));
    for (const value of [ranged.balance.damageVarianceRange, ranged.balance.healVarianceRange]) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(20);
    }
  });

  it('overrides adjudication army value and per-kind control point income', () => {
    const config = generateRandomMapConfig({
      seed: 'adjudication', adjudicationArmyValue: 5, supplyIncome: 12, forwardBaseIncome: 3, repairIncome: 0,
    }, 2);
    expect(config.balance.adjudicationWeights.armyValue).toBe(5);
    // 补给权重恒 0（不开放）；击杀分仍按军队价值权重的 25%~50% 推导（5 → 1.25~2.5）。
    expect(config.balance.adjudicationWeights.supplies).toBe(0);
    expect(config.balance.adjudicationWeights.killValue).toBeGreaterThanOrEqual(1.25);
    expect(config.balance.adjudicationWeights.killValue).toBeLessThanOrEqual(2.5);
    expect(config.balance.controlPointTypes.supply.income).toBe(12);
    expect(config.balance.controlPointTypes.forward_base.income).toBe(3);
    expect(config.balance.controlPointTypes.repair.income).toBe(0);
    // 部署折扣 / 维修量保持基准，不随收入参数漂移。
    expect(config.balance.controlPointTypes.forward_base.deployDiscount).toBe(8);
    expect(config.balance.controlPointTypes.repair.repairAmount).toBe(10);
    // armyValue=0：击杀分随之归零。
    const zero = generateRandomMapConfig({ seed: 'adjudication-zero', adjudicationArmyValue: 0 }, 2);
    expect(zero.balance.adjudicationWeights.armyValue).toBe(0);
    expect(zero.balance.adjudicationWeights.killValue).toBe(0);
    // 区间形态：同种子可复现、落在区间内。
    const ranged = generateRandomMapConfig(
      { seed: 'adjudication-range', adjudicationArmyValue: [2, 6], supplyIncome: [10, 30] }, 2,
    );
    expect(ranged.balance.adjudicationWeights.armyValue).toBeGreaterThanOrEqual(2);
    expect(ranged.balance.adjudicationWeights.armyValue).toBeLessThanOrEqual(6);
    expect(ranged.balance.controlPointTypes.supply.income).toBeGreaterThanOrEqual(10);
    expect(ranged.balance.controlPointTypes.supply.income).toBeLessThanOrEqual(30);
  });

  it('overrides per-type unit stats exactly and keeps ranges reproducible', () => {
    // 标量＝精确值（不再抖动）；未覆盖的属性仍围绕基准值抖动（默认浮动区间 0-0.25 → 100 血落在 75-125）。
    const fixed = generateRandomMapConfig({
      seed: 'unit-stats', infantryAttack: 40, rangerMoveRange: 6, supportHealPower: 30,
    }, 2);
    expect(fixed.units.infantry.attack).toBe(40);
    expect(fixed.units.ranger.moveRange).toBe(6);
    expect(fixed.units.support.healPower).toBe(30);
    expect(fixed.units.infantry.hp).toBeGreaterThanOrEqual(75);
    expect(fixed.units.infantry.hp).toBeLessThanOrEqual(125);
    // 区间形态：同种子可复现、落在区间内。
    const ranged = generateRandomMapConfig(
      { seed: 'unit-stats-range', infantryHp: [120, 140], scoutCost: [40, 50], heavyMoveRange: [2, 4] }, 2,
    );
    const rangedAgain = generateRandomMapConfig(
      { seed: 'unit-stats-range', infantryHp: [120, 140], scoutCost: [40, 50], heavyMoveRange: [2, 4] }, 2,
    );
    expect(JSON.stringify(rangedAgain)).toBe(JSON.stringify(ranged));
    expect(ranged.units.infantry.hp).toBeGreaterThanOrEqual(120);
    expect(ranged.units.infantry.hp).toBeLessThanOrEqual(140);
    expect(ranged.units.scout.cost).toBeGreaterThanOrEqual(40);
    expect(ranged.units.scout.cost).toBeLessThanOrEqual(50);
    expect(ranged.units.heavy.moveRange).toBeGreaterThanOrEqual(2);
    expect(ranged.units.heavy.moveRange).toBeLessThanOrEqual(4);
  });

  it('keeps the deprecated terrainDensity as a 60/40 alias for water/wall', () => {
    const sanitized = sanitizeRandomOptions({ terrainDensity: 0.1 });
    expect(sanitized.terrainDensity).toBeUndefined();
    expect(sanitized.waterDensity).toBeCloseTo(0.06);
    expect(sanitized.wallDensity).toBeCloseTo(0.04);
    expect(sanitizeRandomOptions({ terrainDensity: [0.02, 0.12] })).toEqual({
      waterDensity: [0.012, 0.072],
      wallDensity: [0.008, 0.048],
    });
    // 生成器可被直接调用（不经 sanitize），旧参数在这里同样要生效。
    const legacy = generateRandomMapConfig({ seed: 'legacy-density', terrainDensity: 0.12 }, 4);
    const explicit = generateRandomMapConfig({ seed: 'legacy-density', waterDensity: 0.072, wallDensity: 0.048 }, 4);
    expect(JSON.stringify(legacy)).toBe(JSON.stringify(explicit));
    // 与新细分参数同给则报错，避免静默忽略其中一边。
    expect(() => sanitizeRandomOptions({ terrainDensity: 0.1, waterDensity: 0.02 }))
      .toThrow('terrainDensity is deprecated');
    expect(() => generateRandomMapConfig({ seed: 'x', terrainDensity: 0.1, wallDensity: 0.02 }, 4))
      .toThrow('terrainDensity is deprecated');
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
    // molten-throne(100 血总部/24 据点) 等静态图极值；裁决权重与据点类型收入也必须可变。
    const seen = {
      minAp: 99, maxAp: 0, minSupplies: 9999, maxSupplies: 0,
      minHq: 9999, maxHq: 0, minCp: 99, maxCp: 0,
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
    expect(sanitizeRandomOptions({ mode: 'royale' })).toEqual({ mode: 'royale' });
  });

  it('clamps out-of-range values and collapses ranges', () => {
    expect(sanitizeRandomOptions({ radius: 999 }).radius).toBe(12);
    expect(sanitizeRandomOptions({ maxTurns: [50, 5] }).maxTurns).toEqual([5, 50]);
    expect(sanitizeRandomOptions({ actionsPerTurn: [7, 7] }).actionsPerTurn).toBe(7);
    expect(sanitizeRandomOptions({ artilleryDamage: 999 })).toEqual({ artilleryDamage: 30 });
    expect(sanitizeRandomOptions({ artilleryStartRound: [0, 99] }).artilleryStartRound).toEqual([1, 10]);
    expect(sanitizeRandomOptions({ artilleryMinimumSafeRadius: -1 })).toEqual({ artilleryMinimumSafeRadius: 0 });
    // 初始兵种权重：0-10、允许小数（step 0.5 只是 UI 步长，不是硬约束）。
    expect(sanitizeRandomOptions({ startingWeightInfantry: 2, startingWeightScout: [1, 3] }))
      .toEqual({ startingWeightInfantry: 2, startingWeightScout: [1, 3] });
    expect(sanitizeRandomOptions({ startingWeightHeavy: 10.5 }).startingWeightHeavy).toBe(10);
    expect(sanitizeRandomOptions({ startingWeightRanger: -2 }).startingWeightRanger).toBe(0);
    expect(sanitizeRandomOptions({ startingUnitCount: 7 }).startingUnitCount).toBe(6);
    // 3.6.2 放宽后的硬边界与新增参数同样走钳位。
    expect(sanitizeRandomOptions({ controlPointCount: 99 }).controlPointCount).toBe(24);
    expect(sanitizeRandomOptions({ damageVarianceRange: 999 }).damageVarianceRange).toBe(20);
    expect(sanitizeRandomOptions({ healVarianceRange: -3 }).healVarianceRange).toBe(0);
    expect(sanitizeRandomOptions({ adjudicationArmyValue: 99 }).adjudicationArmyValue).toBe(10);
    expect(sanitizeRandomOptions({ supplyIncome: [5, 999] }).supplyIncome).toEqual([5, 40]);
    expect(sanitizeRandomOptions({ forwardBaseIncome: 33 }).forwardBaseIncome).toBe(20);
    expect(sanitizeRandomOptions({ repairIncome: -1 }).repairIncome).toBe(0);
    expect(sanitizeRandomOptions({ infantryAttack: 999 }).infantryAttack).toBe(200);
    expect(sanitizeRandomOptions({ supportHealPower: -5 }).supportHealPower).toBe(0);
    // 整数参数非整数输入按四舍五入（与 resolveParam 的整数口径一致）。
    expect(sanitizeRandomOptions({ heavyMoveRange: 2.6 }).heavyMoveRange).toBe(3);
  });

  it('rejects malformed options', () => {
    expect(() => sanitizeRandomOptions('nope')).toThrow();
    expect(() => sanitizeRandomOptions({ maxTurns: 'many' })).toThrow('maxTurns');
    expect(() => sanitizeRandomOptions({ maxTurns: [1] })).toThrow('maxTurns');
    expect(() => sanitizeRandomOptions({ maxTurns: Number.NaN })).toThrow();
    expect(() => sanitizeRandomOptions({ symmetric: 'yes' })).toThrow('symmetric');
    expect(() => sanitizeRandomOptions({ seed: '' })).toThrow('seed');
    expect(() => sanitizeRandomOptions({ mode: 'chaos' })).toThrow('random.mode must be one of');
    expect(() => sanitizeRandomOptions({ mode: 42 })).toThrow('random.mode must be one of');
    expect(() => sanitizeRandomOptions({ bogus: 1 })).toThrow('unknown random option');
  });
});
