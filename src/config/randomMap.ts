// src/config/randomMap.ts
// 随机地图生成器：为 AI 训练提供可播种、参数可随机/可固定的战场。
// 生成结果必须通过 loader.validateGeneratedMap 的完整校验，保证地形连通、
// 出生位合法等既有约束，任何情况下都产出可玩的地图。
import type { ControlPointKind, Position, UnitType } from '../types.js';
import { hexDistance, hexKey } from '../engine/hex.js';
import { createRadiusPlayableCells } from './geometry.js';
import type { MapConfig, SpawnSlotConfig, UnitSpec } from './loader.js';
import { validateGeneratedMap } from './loader.js';

/** 单个随机参数：省略=默认范围随机，数字=固定值，[min, max]=区间随机。 */
export type RandomParam = number | [number, number];

export interface RandomMapOptions {
  /** 随机种子（数字或字符串）；同种子产出完全相同的地图。 */
  seed?: number | string;
  /** 旋转对称公平模式，默认 true。 */
  symmetric?: boolean;
  radius?: RandomParam;
  /** 水域+障碍占可玩格比例。 */
  terrainDensity?: RandomParam;
  controlPointCount?: RandomParam;
  maxTurns?: RandomParam;
  actionsPerTurn?: RandomParam;
  /** 兵种数值围绕基准的浮动比例（0-0.5）。 */
  unitStatVariation?: RandomParam;
  startingSupplies?: RandomParam;
  baseIncome?: RandomParam;
  controlPointIncome?: RandomParam;
  headquartersHp?: RandomParam;
  headquartersDefense?: RandomParam;
}

interface ParamBound {
  min: number;
  max: number;
  integer: boolean;
}

/** 各参数的合法边界，同时是未指定时的默认随机范围。 */
const PARAM_BOUNDS: Record<string, ParamBound> = {
  radius: { min: 4, max: 12, integer: true },
  terrainDensity: { min: 0, max: 0.4, integer: false },
  controlPointCount: { min: 1, max: 9, integer: true },
  maxTurns: { min: 1, max: 99, integer: true },
  actionsPerTurn: { min: 1, max: 20, integer: true },
  unitStatVariation: { min: 0, max: 0.5, integer: false },
  startingSupplies: { min: 0, max: 9999, integer: true },
  baseIncome: { min: 0, max: 999, integer: true },
  controlPointIncome: { min: 0, max: 999, integer: true },
  headquartersHp: { min: 1, max: 9999, integer: true },
  headquartersDefense: { min: 0, max: 99, integer: true },
};

const DEFAULT_RANGES: Record<string, [number, number]> = {
  radius: [6, 10],
  terrainDensity: [0.02, 0.12],
  controlPointCount: [3, 5],
  maxTurns: [10, 25],
  actionsPerTurn: [3, 8],
  unitStatVariation: [0, 0.25],
  startingSupplies: [60, 120],
  baseIncome: [8, 14],
  controlPointIncome: [8, 16],
  headquartersHp: [120, 240],
  headquartersDefense: [3, 10],
};

/** 校验并收敛前端/RL 传入的随机参数；非法结构直接抛错（API 返回 400）。 */
export function sanitizeRandomOptions(input: unknown): RandomMapOptions {
  if (input === undefined || input === null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('random options must be an object');
  }
  const raw = input as Record<string, unknown>;
  const options: RandomMapOptions = {};

  if (raw.seed !== undefined) {
    if (typeof raw.seed === 'number') {
      if (!Number.isFinite(raw.seed)) throw new Error('random.seed must be finite');
      options.seed = raw.seed;
    } else if (typeof raw.seed === 'string') {
      if (raw.seed.length === 0 || raw.seed.length > 64) throw new Error('random.seed must be 1-64 chars');
      options.seed = raw.seed;
    } else {
      throw new Error('random.seed must be a number or string');
    }
  }
  if (raw.symmetric !== undefined) {
    if (typeof raw.symmetric !== 'boolean') throw new Error('random.symmetric must be boolean');
    options.symmetric = raw.symmetric;
  }

  for (const [key, bound] of Object.entries(PARAM_BOUNDS)) {
    const value = raw[key];
    if (value === undefined) continue;
    options[key as Exclude<keyof RandomMapOptions, 'seed' | 'symmetric'>] = sanitizeParam(key, value, bound);
  }

  const known = new Set(['seed', 'symmetric', ...Object.keys(PARAM_BOUNDS)]);
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) throw new Error(`unknown random option "${key}"`);
  }
  return options;
}

function sanitizeParam(key: string, value: unknown, bound: ParamBound): RandomParam {
  const clamp = (v: number): number => {
    const clamped = Math.min(bound.max, Math.max(bound.min, v));
    return bound.integer ? Math.round(clamped) : Number(clamped.toFixed(4));
  };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`random.${key} must be finite`);
    return clamp(value);
  }
  if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
    if (!Number.isFinite(value[0]) || !Number.isFinite(value[1])) throw new Error(`random.${key} range must be finite`);
    const lo = clamp(Math.min(value[0], value[1]));
    const hi = clamp(Math.max(value[0], value[1]));
    return lo === hi ? lo : [lo, hi];
  }
  throw new Error(`random.${key} must be a number or [min, max]`);
}

// ---------- 种子化 PRNG ----------

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createRng(seed: number | string | undefined): { rng: () => number; seedText: string } {
  const seedText = seed === undefined
    ? Math.floor(Math.random() * 1e12).toString(36)
    : String(seed);
  return { rng: mulberry32(xmur3(`random-map:${seedText}`)()), seedText };
}

// ---------- 参数解析 ----------

function resolveParam(
  param: RandomParam | undefined,
  key: string,
  rng: () => number,
): number {
  const bound = PARAM_BOUNDS[key];
  const [defMin, defMax] = DEFAULT_RANGES[key];
  let lo: number;
  let hi: number;
  if (param === undefined) {
    lo = defMin;
    hi = defMax;
  } else if (typeof param === 'number') {
    return param;
  } else {
    lo = param[0];
    hi = param[1];
  }
  const value = lo + rng() * (hi - lo);
  return bound.integer ? Math.round(value) : value;
}

function shuffleInPlace<T>(items: T[], rng: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

// ---------- 六边形几何 ----------

/** 尖顶六边形轴向坐标：像素方向角 -> 最近格子。 */
function axialFromAngle(angle: number, distance: number): Position {
  const x = Math.cos(angle) * distance;
  const y = Math.sin(angle) * distance;
  const qf = (Math.sqrt(3) / 3) * x - (1 / 3) * y;
  const rf = (2 / 3) * y;
  return cubeRound(qf, rf);
}

function cubeRound(qf: number, rf: number): Position {
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  let s = Math.round(sf);
  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q, r };
}

function mirror(pos: Position): Position {
  return { q: -pos.q, r: -pos.r };
}

/** 180° 旋转对称的半区判定；原点 (0,0) 是唯一不动点。 */
function inHalfPlane(pos: Position): boolean {
  return pos.q < 0 || (pos.q === 0 && pos.r < 0);
}

function pixelAngle(pos: Position): number {
  const x = Math.sqrt(3) * (pos.q + pos.r / 2);
  const y = 1.5 * pos.r;
  return Math.atan2(y, x);
}

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs(d);
}

// ---------- 生成主体 ----------

const UNIT_BASE: Record<UnitType, UnitSpec> = {
  infantry: { hp: 100, attack: 30, defense: 8, moveRange: 3, attackRange: 1, cost: 45, canCapture: true },
  scout: { hp: 65, attack: 16, defense: 4, moveRange: 5, attackRange: 1, cost: 38, canCapture: true },
  heavy: { hp: 150, attack: 38, defense: 13, moveRange: 2, attackRange: 1, cost: 92, canCapture: false },
  ranger: { hp: 72, attack: 44, defense: 3, moveRange: 2, attackRange: 3, cost: 78, canCapture: false },
  support: { hp: 82, attack: 10, defense: 5, moveRange: 3, attackRange: 1, cost: 60, canCapture: false, healPower: 22 },
};

const CONTROL_POINT_TYPES: Record<ControlPointKind, { income: number; deployDiscount: number; repairAmount: number }> = {
  supply: { income: 12, deployDiscount: 0, repairAmount: 0 },
  forward_base: { income: 8, deployDiscount: 8, repairAmount: 0 },
  repair: { income: 8, deployDiscount: 0, repairAmount: 10 },
};

const KIND_CYCLE: ControlPointKind[] = ['supply', 'forward_base', 'repair'];

const KIND_NAMES: Record<ControlPointKind, string> = {
  supply: '补给站',
  forward_base: '前哨基地',
  repair: '维修站',
};

const HEX_OFFSETS: Position[] = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

/**
 * 生成一张随机地图配置。playerCount 决定出生位数量（2-8）。
 * 内部会反复重试地形抽样直到所有出生位/据点经可通行格互相连通，
 * 因此返回值始终可玩；失败兜底是清空障碍地形。
 */
export function generateRandomMapConfig(options: RandomMapOptions, playerCount: number): MapConfig {
  if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > 8) {
    throw new Error('playerCount must be an integer between 2 and 8');
  }
  const { rng, seedText } = createRng(options.seed);
  const symmetric = options.symmetric ?? true;

  // 半径：多人局保证足够空间。
  let radius = Math.round(resolveParam(options.radius, 'radius', rng));
  radius = Math.max(radius, playerCount <= 4 ? 5 : playerCount <= 6 ? 6 : 7);

  const playableCells = createRadiusPlayableCells(radius);
  const playableSet = new Set(playableCells.map(hexKey));

  // 出生位：均分角度，保证偶数玩家时两两中心对称。
  const spawnDistance = Math.max(3, radius - 1);
  const baseAngle = rng() * Math.PI * 2;
  const spawnPositions: Position[] = [];
  const taken = new Set<string>();
  for (let i = 0; i < playerCount; i++) {
    const ideal = axialFromAngle(baseAngle + (i * 2 * Math.PI) / playerCount, spawnDistance);
    const pos = findFreeCell(ideal, playableSet, taken, radius);
    spawnPositions.push(pos);
    taken.add(hexKey(pos));
  }

  // 据点：中心（数量为奇数时）+ 环形分布；对称模式成对赋类型。
  const cpCount = Math.round(resolveParam(options.controlPointCount, 'controlPointCount', rng));
  const controlPoints = placeControlPoints(cpCount, radius, symmetric, rng, spawnPositions, playableSet, taken);

  // 回合/行动点/经济/总部参数。
  const maxTurns = Math.round(resolveParam(options.maxTurns, 'maxTurns', rng));
  const actionsPerTurn = Math.round(resolveParam(options.actionsPerTurn, 'actionsPerTurn', rng));
  const startingSupplies = Math.round(resolveParam(options.startingSupplies, 'startingSupplies', rng));
  const baseIncome = Math.round(resolveParam(options.baseIncome, 'baseIncome', rng));
  const controlPointIncome = Math.round(resolveParam(options.controlPointIncome, 'controlPointIncome', rng));
  const headquartersHp = Math.round(resolveParam(options.headquartersHp, 'headquartersHp', rng));
  const headquartersDefense = Math.round(resolveParam(options.headquartersDefense, 'headquartersDefense', rng));
  const variation = resolveParam(options.unitStatVariation, 'unitStatVariation', rng);

  // 地形：保护出生区与据点，抽样后校验连通性，失败重抽。
  const density = resolveParam(options.terrainDensity, 'terrainDensity', rng);
  const terrainCells = sampleTerrain(
    density, symmetric, rng, playableCells, playableSet, spawnPositions, controlPoints.map(cp => ({ q: cp.q, r: cp.r })),
  );

  // 出生位配置（总部 + 初始单位）。
  const spawnSlots = buildSpawnSlots(spawnPositions, playableSet, controlPoints, symmetric);

  const config = {
    mode: 'standard',
    name: '随机战场',
    description: `种子 ${seedText} · 半径 ${radius} · ${playerCount} 人 · ${symmetric ? '对称' : '非对称'}`,
    grid: 'hex',
    orientation: 'pointy',
    radius,
    playableCells,
    terrainCells,
    controlPoints,
    headquarters: {
      player_a: { ...spawnSlots[0].headquarters },
      player_b: { ...spawnSlots[1].headquarters },
    },
    startingUnits: [
      ...spawnSlots[0].startingUnits.map(unit => ({ ...unit, owner: 'player_a' as const })),
      ...spawnSlots[1].startingUnits.map(unit => ({ ...unit, owner: 'player_b' as const })),
    ],
    spawnSlots,
    layouts: { [playerCount]: spawnSlots.map(slot => slot.id) },
    supportedPlayerCounts: [playerCount],
    units: buildUnitSpecs(variation, rng),
    headquartersSpec: { hp: headquartersHp, defense: headquartersDefense },
    balance: {
      startingSupplies,
      baseIncome,
      controlPointIncome,
      damageVarianceRange: 3,
      minimumDamage: 1,
      healVarianceRange: 6,
      actionsPerTurn,
      maxTurns,
      adjudicationWeights: { enemyHqDamage: 5, ownHqHp: 2, controlPoint: 90, armyValue: 2, supplies: 1 },
      controlPointTypes: {
        supply: { ...CONTROL_POINT_TYPES.supply },
        forward_base: { ...CONTROL_POINT_TYPES.forward_base },
        repair: { ...CONTROL_POINT_TYPES.repair },
      },
    },
  };

  // 最终兜底校验：任何生成结果都必须通过与静态地图相同的验证。
  return validateGeneratedMap(config, 'random') as MapConfig;
}

function findFreeCell(ideal: Position, playableSet: Set<string>, taken: Set<string>, radius: number): Position {
  const isValid = (pos: Position): boolean =>
    playableSet.has(hexKey(pos)) && !taken.has(hexKey(pos)) && hexDistance(pos, { q: 0, r: 0 }) >= 2;
  if (isValid(ideal)) return ideal;
  // 由近及远螺旋搜索最近的可用格。
  const candidates: Position[] = [];
  for (let range = 1; range <= radius; range++) {
    for (let dq = -range; dq <= range; dq++) {
      for (let dr = Math.max(-range, -dq - range); dr <= Math.min(range, -dq + range); dr++) {
        if (Math.max(Math.abs(dq), Math.abs(dr), Math.abs(-dq - dr)) !== range) continue;
        candidates.push({ q: ideal.q + dq, r: ideal.r + dr });
      }
    }
    for (const candidate of candidates) {
      if (isValid(candidate)) return candidate;
    }
    candidates.length = 0;
  }
  throw new Error('no free cell available for spawn slot');
}

interface GeneratedControlPoint {
  id: string;
  name: string;
  kind: ControlPointKind;
  q: number;
  r: number;
}

function placeControlPoints(
  count: number,
  radius: number,
  symmetric: boolean,
  rng: () => number,
  spawnPositions: Position[],
  playableSet: Set<string>,
  taken: Set<string>,
): GeneratedControlPoint[] {
  const points: GeneratedControlPoint[] = [];
  const claim = (pos: Position, kind: ControlPointKind): boolean => {
    if (!playableSet.has(hexKey(pos)) || taken.has(hexKey(pos))) return false;
    if (spawnPositions.some(spawn => hexDistance(spawn, pos) < 3)) return false;
    taken.add(hexKey(pos));
    const index = points.length;
    points.push({ id: `cp_${index + 1}`, name: `${KIND_NAMES[kind]} ${index + 1}`, kind, q: pos.q, r: pos.r });
    return true;
  };

  const includeCenter = count % 2 === 1;
  const ringCount = count - (includeCenter ? 1 : 0);
  const ringDistance = Math.max(2, Math.round(radius / 2));
  const ringBase = rng() * Math.PI * 2;

  if (includeCenter) {
    const centerKind = KIND_CYCLE[Math.floor(rng() * KIND_CYCLE.length)];
    if (!claim({ q: 0, r: 0 }, centerKind)) {
      // 中心不可用时退化为环形多放一个（偶数化）。
      return placeControlPoints(count + 1, radius, symmetric, rng, spawnPositions, playableSet, new Set([...taken].filter(key => key !== '0,0')));
    }
  }

  if (symmetric) {
    // 成对放置：半区角度取 ringCount/2 对，类型按对循环，保证镜像一致。
    for (let i = 0; i < ringCount / 2; i++) {
      const kind = KIND_CYCLE[i % KIND_CYCLE.length];
      const angle = ringBase + (i * 2 * Math.PI) / ringCount;
      const pos = axialFromAngle(angle, ringDistance);
      claim(pos, kind);
      claim(mirror(pos), kind);
    }
  } else {
    for (let i = 0; i < ringCount; i++) {
      const kind = KIND_CYCLE[i % KIND_CYCLE.length];
      const angle = ringBase + (i * 2 * Math.PI) / ringCount + (rng() - 0.5) * (Math.PI / ringCount);
      const distance = ringDistance + Math.floor(rng() * 3) - 1;
      const pos = axialFromAngle(angle, Math.max(1, distance));
      if (!claim(pos, kind)) claim(axialFromAngle(angle, ringDistance), kind);
    }
  }
  return points;
}

function sampleTerrain(
  density: number,
  symmetric: boolean,
  rng: () => number,
  playableCells: Position[],
  playableSet: Set<string>,
  spawnPositions: Position[],
  controlPointPositions: Position[],
): { q: number; r: number; terrain: 'water' | 'blocker' }[] {
  const protectedCells = new Set<string>();
  for (const cell of playableCells) {
    const nearSpawn = spawnPositions.some(spawn => hexDistance(spawn, cell) <= 2);
    const nearCenterOrCp = hexDistance(cell, { q: 0, r: 0 }) <= 1
      || controlPointPositions.some(cp => hexDistance(cp, cell) <= 1);
    if (nearSpawn || nearCenterOrCp) protectedCells.add(hexKey(cell));
  }

  let currentDensity = density;
  for (let attempt = 0; attempt < 200; attempt++) {
    if (attempt > 0 && attempt % 50 === 0) currentDensity = Math.max(0, currentDensity - 0.03);
    const terrainCount = Math.floor(playableCells.length * currentDensity);
    const terrain = new Map<string, 'water' | 'blocker'>();

    if (terrainCount > 0) {
      const candidates = playableCells.filter(cell => {
        if (protectedCells.has(hexKey(cell))) return false;
        return !symmetric || inHalfPlane(cell);
      });
      shuffleInPlace(candidates, rng);
      const picks = candidates.slice(0, symmetric ? Math.ceil(terrainCount / 2) : terrainCount);
      for (const cell of picks) {
        const kind: 'water' | 'blocker' = rng() < 0.6 ? 'water' : 'blocker';
        terrain.set(hexKey(cell), kind);
        if (symmetric) {
          const mirrored = mirror(cell);
          if (playableSet.has(hexKey(mirrored)) && !protectedCells.has(hexKey(mirrored))) {
            terrain.set(hexKey(mirrored), kind);
          }
        }
      }
    }

    if (allReachable(playableCells, terrain, spawnPositions, controlPointPositions)) {
      return [...terrain.entries()].map(([key, kind]) => {
        const [q, r] = key.split(',').map(Number);
        return { q, r, terrain: kind };
      }).sort((a, b) => a.q - b.q || a.r - b.r);
    }
  }
  // 兜底：不放任何障碍地形，保证可玩。
  return [];
}

/** 从第一个出生位出发，全部可通行格必须连通（出生位/据点受保护必为 plain，自然覆盖）。 */
function allReachable(
  playableCells: Position[],
  terrain: Map<string, 'water' | 'blocker'>,
  spawnPositions: Position[],
  controlPointPositions: Position[],
): boolean {
  const passable = new Set(playableCells.map(hexKey).filter(key => !terrain.has(key)));
  const start = hexKey(spawnPositions[0]);
  if (!passable.has(start)) return false;
  for (const target of [...spawnPositions, ...controlPointPositions]) {
    if (!passable.has(hexKey(target))) return false;
  }
  const visited = new Set<string>([start]);
  const queue: Position[] = [spawnPositions[0]];
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    for (const [dq, dr] of [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]) {
      const next = { q: current.q + dq, r: current.r + dr };
      const key = hexKey(next);
      if (!passable.has(key) || visited.has(key)) continue;
      visited.add(key);
      queue.push(next);
    }
  }
  return visited.size === passable.size;
}

function buildSpawnSlots(
  spawnPositions: Position[],
  playableSet: Set<string>,
  controlPoints: GeneratedControlPoint[],
  symmetric: boolean,
): SpawnSlotConfig[] {
  const occupied = new Set<string>(controlPoints.map(cp => hexKey(cp)));
  const slots: SpawnSlotConfig[] = new Array(spawnPositions.length);
  const placed: boolean[] = new Array(spawnPositions.length).fill(false);

  // 初始单位放在最靠近地图中心的三个邻格：正对中心放侦察兵，两侧放步兵。
  const unitCellsFor = (hq: Position): Position[] => {
    const hqAngle = pixelAngle(mirror(hq));
    return HEX_OFFSETS
      .map(offset => ({ q: hq.q + offset.q, r: hq.r + offset.r }))
      .filter(cell => playableSet.has(hexKey(cell)) && !occupied.has(hexKey(cell)))
      .sort((a, b) => angleDiff(pixelAngle({ q: a.q - hq.q, r: a.r - hq.r }), hqAngle)
        - angleDiff(pixelAngle({ q: b.q - hq.q, r: b.r - hq.r }), hqAngle))
      .slice(0, 3);
  };
  const assignUnits = (cells: Position[]) => cells.map((cell, unitIndex) => {
    occupied.add(hexKey(cell));
    return { type: (unitIndex === 0 ? 'scout' : 'infantry') as UnitType, q: cell.q, r: cell.r };
  });

  for (let index = 0; index < spawnPositions.length; index++) {
    if (placed[index]) continue;
    const hq = spawnPositions[index];
    occupied.add(hexKey(hq));
    // 偶数玩家对称局：镜像出生位成对处理，单位布局直接取反，
    // 规避「最靠中心方向」出现角度平局时两侧侦察兵站位不镜像的边角情况。
    const mirrorIndex = symmetric && spawnPositions.length % 2 === 0
      ? (index + spawnPositions.length / 2) % spawnPositions.length
      : -1;
    if (mirrorIndex >= 0 && !placed[mirrorIndex]) {
      const mirrorHq = mirror(hq);
      occupied.add(hexKey(mirrorHq));
      const cells = unitCellsFor(hq);
      slots[index] = {
        id: `slot_${String.fromCharCode(97 + index)}`,
        headquarters: { q: hq.q, r: hq.r },
        startingUnits: assignUnits(cells),
      };
      slots[mirrorIndex] = {
        id: `slot_${String.fromCharCode(97 + mirrorIndex)}`,
        headquarters: { q: mirrorHq.q, r: mirrorHq.r },
        startingUnits: assignUnits(cells.map(cell => mirror(cell))),
      };
      placed[index] = true;
      placed[mirrorIndex] = true;
    } else {
      slots[index] = {
        id: `slot_${String.fromCharCode(97 + index)}`,
        headquarters: { q: hq.q, r: hq.r },
        startingUnits: assignUnits(unitCellsFor(hq)),
      };
      placed[index] = true;
    }
  }
  return slots;
}

function buildUnitSpecs(variation: number, rng: () => number): Record<UnitType, UnitSpec> {
  const jitter = (value: number, floor: number): number =>
    Math.max(floor, Math.round(value * (1 + (rng() * 2 - 1) * variation)));
  const result = {} as Record<UnitType, UnitSpec>;
  for (const [type, base] of Object.entries(UNIT_BASE) as [UnitType, UnitSpec][]) {
    const spec: UnitSpec = {
      hp: jitter(base.hp, 10),
      attack: jitter(base.attack, 1),
      defense: jitter(base.defense, 0),
      moveRange: jitter(base.moveRange, 1),
      attackRange: jitter(base.attackRange, 1),
      cost: jitter(base.cost, 5),
      canCapture: base.canCapture,
    };
    if (base.healPower !== undefined) spec.healPower = jitter(base.healPower, 5);
    result[type] = spec;
  }
  return result;
}
