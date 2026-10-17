// src/config/randomMap.ts
// 随机地图生成器：为 AI 训练提供可播种、参数可随机/可固定的战场。
// 生成结果必须通过 loader.validateGeneratedMap 的完整校验，保证地形连通、
// 出生位合法等既有约束，任何情况下都产出可玩的地图。
import type { ControlPointKind, GameMode, Position, UnitType } from '../types.js';
import { isAnnihilationMode } from '../types.js';
import { hexDistance, hexKey } from '../engine/hex.js';
import { createRadiusPlayableCells } from './geometry.js';
import type { MapConfig, SpawnSlotConfig, UnitSpec } from './loader.js';
import { validateGeneratedMap } from './loader.js';

/** 单个随机参数：省略=默认范围随机，数字=固定值，[min, max]=区间随机。 */
export type RandomParam = number | [number, number];

export interface RandomMapOptions {
  /** 随机种子（数字或字符串）；同种子产出完全相同的地图。 */
  seed?: number | string;
  /** 游戏模式：standard（默认）/ annihilation / simultaneous / royale。 */
  mode?: GameMode;
  /**
   * 旋转对称公平模式，默认 true。取 360/n 与六边形网格自映射角（60° 整数倍）的最小公倍角：
   * 2/4/8 人 → 180°、3 人 → 120°、6 人 → 60°；5/7 人无对称解，如实降级为非对称。
   */
  symmetric?: boolean;
  radius?: RandomParam;
  /** 水域占可玩格比例（不可通行、不可爆破）。 */
  waterDensity?: RandomParam;
  /** 阻挡（墙）占可玩格比例（不可通行，可被重装单位爆破拆除）。 */
  wallDensity?: RandomParam;
  /**
   * @deprecated 旧的合并地形密度（水+墙）。仍接受，但仅当未显式给出 `waterDensity` / `wallDensity`
   * 时生效，按水 60% / 墙 40% 拆分，等价于旧版取 `'water' : 'blocker' = 6 : 4` 的期望比例。
   */
  terrainDensity?: RandomParam;
  controlPointCount?: RandomParam;
  maxTurns?: RandomParam;
  actionsPerTurn?: RandomParam;
  /** 兵种数值围绕基准的浮动比例（0-0.5）。 */
  unitStatVariation?: RandomParam;
  startingSupplies?: RandomParam;
  baseIncome?: RandomParam;
  headquartersHp?: RandomParam;
  headquartersDefense?: RandomParam;
  /**
   * 初始单位数量（0-4）。省略=0-4 均匀随机（现行为）。
   * v3.3.0：RL 随机域联合边角重要性采样（RL_RANDOM_CORNER_BOOST）用它把
   * 低 HQ×多据点×满编开局的熔炉系图生态位组合提频——各维边缘分布
   * 虽已拓宽，联合命中率是边缘概率的乘积 <<1%（v3.1.1 起旧版 forge 连续 0:48）。
   * 3.5.11 该图重做为 molten-throne（熔池王座，原 forge）：20 回合长局、24 据点、每方 6 单位起手，上述生态位
   * 描述已过时，且覆盖缺口（上界 4 < 6）待 RL 域重校准时收口。
   */
  startingUnitCount?: RandomParam;
  /**
   * 初始单位兵种权重（步兵/侦察/重装/远程，0-10，留空＝默认 2/2/1/1）。省略或固定标量都不消耗
   * 随机数流——加权抽样按「权重比例展开成等价池」与旧 `POOL[floor(rng()*6)]` 逐位同分布，
   * 默认 2/2/1/1 恰好展开成旧的 6 格池，默认路径生成的地图完全不变。support 不给权重（奶妈不适合开局硬给）。
   */
  startingWeightInfantry?: RandomParam;
  /** 初始侦察兵权重（0-10，留空＝默认 2）。省略/标量不消耗随机数流。 */
  startingWeightScout?: RandomParam;
  /** 初始重装权重（0-10，留空＝默认 1）。省略/标量不消耗随机数流。 */
  startingWeightHeavy?: RandomParam;
  /** 初始远程兵（游侠）权重（0-10，留空＝默认 1）。省略/标量不消耗随机数流。 */
  startingWeightRanger?: RandomParam;
  /** 歼灭/大逃杀：首次炮火回合（≥1）。 */
  artilleryStartRound?: RandomParam;
  /** 歼灭/大逃杀：炮火间隔回合数（≥1）。 */
  artilleryIntervalRounds?: RandomParam;
  /** 歼灭/大逃杀：炮火伤害（≥1）。 */
  artilleryDamage?: RandomParam;
  /** 歼灭/大逃杀：最终安全区半径（≥0 且 < 地图半径）。 */
  artilleryMinimumSafeRadius?: RandomParam;
}

interface ParamBound {
  min: number;
  max: number;
  integer: boolean;
}

/** 各参数的合法边界，同时是未指定时的默认随机范围。 */
const PARAM_BOUNDS: Record<string, ParamBound> = {
  radius: { min: 4, max: 12, integer: true },
  waterDensity: { min: 0, max: 0.4, integer: false },
  wallDensity: { min: 0, max: 0.4, integer: false },
  // 仅用于兼容旧调用方：解析后立即按 60/40 拆进 waterDensity / wallDensity，不参与生成。
  terrainDensity: { min: 0, max: 0.4, integer: false },
  controlPointCount: { min: 1, max: 9, integer: true },
  maxTurns: { min: 1, max: 99, integer: true },
  actionsPerTurn: { min: 1, max: 20, integer: true },
  unitStatVariation: { min: 0, max: 0.5, integer: false },
  startingSupplies: { min: 0, max: 9999, integer: true },
  baseIncome: { min: 0, max: 999, integer: true },
  headquartersHp: { min: 1, max: 9999, integer: true },
  headquartersDefense: { min: 0, max: 99, integer: true },
  startingUnitCount: { min: 0, max: 4, integer: true },
  // 初始兵种权重：0-10 的相对权重（非整数也合法），不进 DEFAULT_RANGES——省略时用标量默认 2/2/1/1
  // 且不消耗随机数流，见 STARTING_WEIGHT_DEFAULTS / resolveStartingWeights。
  startingWeightInfantry: { min: 0, max: 10, integer: false },
  startingWeightScout: { min: 0, max: 10, integer: false },
  startingWeightHeavy: { min: 0, max: 10, integer: false },
  startingWeightRanger: { min: 0, max: 10, integer: false },
  artilleryStartRound: { min: 1, max: 10, integer: true },
  artilleryIntervalRounds: { min: 1, max: 3, integer: true },
  artilleryDamage: { min: 5, max: 30, integer: true },
  artilleryMinimumSafeRadius: { min: 0, max: 3, integer: true },
};

/**
 * 硬边界只读视图，供前端滑块量程等消费方对齐——`public/random-map-ui.js` 的
 * `PARAMS[].min/max` 必须与此一致，由 `tests/public/random-map-ui.test.ts` 校验，避免两份边界漂移。
 */
export const RANDOM_PARAM_BOUNDS: Readonly<Record<string, Readonly<ParamBound>>> = PARAM_BOUNDS;

const DEFAULT_RANGES: Record<string, [number, number]> = {
  radius: [5, 10],
  // 水域 + 阻挡合计 ≈ 旧 terrainDensity 的 [0.02, 0.12]，保持默认地形总量不变。
  waterDensity: [0.01, 0.07],
  wallDensity: [0.01, 0.05],
  controlPointCount: [2, 6],
  maxTurns: [10, 30],
  actionsPerTurn: [1, 8],
  unitStatVariation: [0, 0.25],
  startingSupplies: [20, 220],
  baseIncome: [6, 14],
  headquartersHp: [80, 240],
  headquartersDefense: [3, 10],
  startingUnitCount: [0, 4],
  artilleryStartRound: [3, 8],
  artilleryIntervalRounds: [1, 2],
  artilleryDamage: [10, 25],
  artilleryMinimumSafeRadius: [0, 1],
};

/**
 * 初始兵种权重默认值（步兵/侦察/重装/远程 = 2/2/1/1）：加权抽样展开后恰好是旧的 6 格
 * STARTING_UNIT_POOL（步×2 侦×2 重×1 远×1），默认路径与旧实现逐位同分布。
 * 刻意不进 DEFAULT_RANGES——resolveParam 的省略路径会消耗随机数流，而权重省略/固定标量
 * 时必须零消耗，否则默认地图的 rng 流会整体错位、现有种子全部漂移。
 */
const STARTING_WEIGHT_DEFAULTS = { infantry: 2, scout: 2, heavy: 1, ranger: 1 };

// 默认域包线按 6 张静态图的极值校准（danger-close 的 1 行动点/20 补给/零据点收入、
// dual-lanes 的 0 初始单位/208 补给、molten-throne（原 forge）的 100 血总部/24 据点等），让随机图
// 本身就能覆盖全部静态图的规则空间——RL 侧 v3.0.2-v3.1.0 三代的 whack-a-mole
// （某张静态图整图崩塌）根因即这些维度从未进过训练分布。
// 已知缺口：3.5.11 molten-throne（原 forge）重做后每方起始 6 单位、据点 24，均超出本域
// （startingUnitCount 上界 4、controlPointCount 上界 9），待 RL 域重校准收口。

/** 裁决权重在静态图包线内随机：danger-close(20/1/30/1/0+kill0.25) ~ default(5/2/90/2/0+kill0.5)。
 *  3.6.0 起补给恒不计分（supplies: 0，杜绝囤补给/期末爆兵套利），
 *  击杀分按军队价值权重的 25%~50% 随机。 */
function sampleAdjudicationWeights(rng: () => number) {
  const armyValue = 1 + Math.floor(rng() * 2);
  return {
    enemyHqDamage: 3 + Math.floor(rng() * 18),
    ownHqHp: 1 + Math.floor(rng() * 2),
    controlPoint: 30 + Math.floor(rng() * 61),
    armyValue,
    supplies: 0,
    killValue: Math.round(armyValue * (0.25 + rng() * 0.25) * 100) / 100,
  };
}

/** 据点类型收入随机：danger-close(8/0/0) ~ breach(20/8/8)。折扣/维修量保持基准。 */
function sampleControlPointTypes(rng: () => number) {
  return {
    supply: { income: 8 + Math.floor(rng() * 13), deployDiscount: 0, repairAmount: 0, canDeploy: true },
    forward_base: { income: Math.floor(rng() * 9), deployDiscount: 8, repairAmount: 0, canDeploy: true },
    repair: { income: Math.floor(rng() * 9), deployDiscount: 0, repairAmount: 10, canDeploy: true },
  };
}

/** 初始单位构成抽取池：现仅作全 0 权重回退（均匀抽）与文档用；基础兵种权重高，覆盖 breach(2 heavy) 等开局（molten-throne 3.5.11 起为斥候群开局，不在池内）。 */
const STARTING_UNIT_POOL: UnitType[] = ['infantry', 'infantry', 'scout', 'scout', 'heavy', 'ranger'];

/** 每方初始单位数量：默认 0-4 均匀随机（dual-lanes(0) 起，其余静态图 ≤3）；可用 options.startingUnitCount 收窄/固定。molten-throne 3.5.11 起为 6，超出本域。 */
function sampleStartingUnits(
  rng: () => number,
  count: number,
  weights: typeof STARTING_WEIGHT_DEFAULTS = STARTING_WEIGHT_DEFAULTS,
): UnitType[] {
  const total = weights.infantry + weights.scout + weights.heavy + weights.ranger;
  if (total <= 0) {
    // 全 0 权重＝没有有意义的比例，回退旧池（每单位仍恰好消耗 1 次 rng，流稳定）。
    return Array.from({ length: count }, () => STARTING_UNIT_POOL[Math.floor(rng() * STARTING_UNIT_POOL.length)]);
  }
  // 加权抽样：`pick = rng()*总权重` 落累积区间选桶。默认 2/2/1/1 时总权重 6、阈值 2/4/5
  // 皆为精确整数，与旧 `POOL[floor(rng()*6)]` 的 6 格池逐位同分布（含 u*6 恰落在边界的情形），
  // 默认路径生成的地图与旧实现完全一致。
  return Array.from({ length: count }, () => {
    const pick = rng() * total;
    if (pick < weights.infantry) return 'infantry';
    if (pick < weights.infantry + weights.scout) return 'scout';
    if (pick < weights.infantry + weights.scout + weights.heavy) return 'heavy';
    return 'ranger';
  });
}

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
  if (raw.mode !== undefined) {
    const MODES = ['standard', 'annihilation', 'simultaneous', 'royale'];
    if (typeof raw.mode !== 'string' || !MODES.includes(raw.mode)) {
      throw new Error('random.mode must be one of standard/annihilation/simultaneous/royale');
    }
    options.mode = raw.mode as GameMode;
  }

  for (const [key, bound] of Object.entries(PARAM_BOUNDS)) {
    const value = raw[key];
    if (value === undefined) continue;
    options[key as Exclude<keyof RandomMapOptions, 'seed' | 'symmetric' | 'mode'>] = sanitizeParam(key, value, bound);
  }

  // 兼容旧的合并地形密度：仅在未显式给出 waterDensity / wallDensity 时生效，按 60/40 拆分。
  splitLegacyTerrainDensity(options);

  const known = new Set(['seed', 'symmetric', 'mode', ...Object.keys(PARAM_BOUNDS)]);
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) throw new Error(`unknown random option "${key}"`);
  }
  return options;
}

/**
 * 兼容旧的合并地形密度 `terrainDensity`：按水域 60% / 阻挡 40% 拆进 `waterDensity` / `wallDensity`
 * （等价于旧版逐轨道取 `'water' : 'blocker' = 6 : 4` 的期望比例）。`sanitizeRandomOptions` 与
 * `generateRandomMapConfig` 都会调用它——后者可被直接调用、绕过 sanitize。与新的细分参数同给则报错。
 */
function splitLegacyTerrainDensity(options: RandomMapOptions): void {
  if (options.terrainDensity === undefined) return;
  if (options.waterDensity !== undefined || options.wallDensity !== undefined) {
    throw new Error('random.terrainDensity is deprecated and cannot be combined with waterDensity/wallDensity');
  }
  const share = (param: RandomParam, ratio: number): RandomParam => {
    const round = (value: number): number => Number(value.toFixed(4));
    return Array.isArray(param) ? [round(param[0] * ratio), round(param[1] * ratio)] : round(param * ratio);
  };
  options.waterDensity = share(options.terrainDensity, 0.6);
  options.wallDensity = share(options.terrainDensity, 0.4);
  delete options.terrainDensity;
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

/**
 * 解析初始兵种权重：省略＝标量默认（零消耗）、固定标量直接用（零消耗）——这两条路径不碰
 * 随机数流，保证默认地图与旧实现逐位一致；区间形态按均匀分布抽一个权重（显式非默认路径，
 * 允许消耗 1 次 rng，四条权重按接口字段顺序依次解析，流稳定）。绝不能整表走 resolveParam——
 * 它的省略路径会消耗 rng，导致默认地图整体错位、现有种子全部漂移。
 */
function resolveStartingWeights(options: RandomMapOptions, rng: () => number): typeof STARTING_WEIGHT_DEFAULTS {
  const resolve = (param: RandomParam | undefined, def: number): number => {
    if (param === undefined) return def;
    if (typeof param === 'number') return param;
    return param[0] + rng() * (param[1] - param[0]);
  };
  return {
    infantry: resolve(options.startingWeightInfantry, STARTING_WEIGHT_DEFAULTS.infantry),
    scout: resolve(options.startingWeightScout, STARTING_WEIGHT_DEFAULTS.scout),
    heavy: resolve(options.startingWeightHeavy, STARTING_WEIGHT_DEFAULTS.heavy),
    ranger: resolve(options.startingWeightRanger, STARTING_WEIGHT_DEFAULTS.ranger),
  };
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
  // Math.round(-0.4) 会得到 -0；不归一就会让 hexKey 出现 "-0,3" 与 "0,3" 两套键而查表失配。
  return { q: nz(q), r: nz(r) };
}

/** 归一 -0：避免 hexKey 出现 "-0,3" 与 "0,3" 两套键，令格位查表失配。 */
function nz(value: number): number {
  return value === 0 ? 0 : value;
}

/** 180° 点对称（绕中心），等价于旋转 3×60°；也用于「朝中心」方向计算。 */
function mirror(pos: Position): Position {
  return { q: nz(-pos.q), r: nz(-pos.r) };
}

/** 60° 旋转在六边形网格上恰好是整格映射（轴向坐标）：(q, r) → (-r, q + r)。 */
function rotate60(pos: Position): Position {
  return { q: nz(-pos.r), r: nz(pos.q + pos.r) };
}

/** 绕中心旋转 steps×60°（steps 可为负）。 */
function rotateSteps(pos: Position, steps: number): Position {
  const normalized = ((steps % 6) + 6) % 6;
  let result = { q: pos.q, r: pos.r };
  for (let i = 0; i < normalized; i++) result = rotate60(result);
  return result;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

interface Symmetry {
  /** 对称扇区数 m：地图切成 m 个全等扇区，绕中心旋转 360/m 度互为镜像。 */
  sectors: number;
  /** 每个扇区对应的 60° 步数 r = 6/m。 */
  step60: number;
}

/**
 * 玩家数可用的旋转对称。六边形网格只在 60° 的整数倍旋转下自映射，而 n 个等分出生位需要
 * 每 360/n 度互相对应；两者取最小公倍角 r×60°（r = 6/gcd(n,6)）。r 取到 6 即只剩恒等变换，
 * 说明该人数在这张网格上根本没有对称解（5、7 人），返回 null 交由调用方如实降级。
 * 结果：2/4/8 人 → 180°（m=2）；3 人 → 120°（m=3）；6 人 → 60°（m=6）。
 */
function symmetryFor(playerCount: number): Symmetry | null {
  const step60 = 6 / gcd(playerCount, 6);
  if (step60 >= 6) return null;
  return { sectors: 6 / step60, step60 };
}

/** 单个格子所在的对称轨道（绕中心旋转整圈的 m 个落点；中心点轨道退化为自身）。 */
function orbitOf(pos: Position, symmetry: Symmetry): Position[] {
  return Array.from({ length: symmetry.sectors }, (_, j) => rotateSteps(pos, j * symmetry.step60));
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
export function generateRandomMapConfig(rawOptions: RandomMapOptions, playerCount: number): MapConfig {
  if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > 8) {
    throw new Error('playerCount must be an integer between 2 and 8');
  }
  // 本函数可被直接调用（RL/测试）而绕过 sanitize，故旧地形密度在这里也要归一化；
  // 用浅拷贝避免改写调用方传入的对象。
  const options = { ...rawOptions };
  splitLegacyTerrainDensity(options);
  const { rng, seedText } = createRng(options.seed);
  const requestedSymmetric = options.symmetric ?? true;
  const mode: GameMode = options.mode ?? 'standard';
  // 实际生效的对称：请求对称但该人数在六边形网格上无解时（5、7 人）如实降级为非对称，
  // 避免产出「标称对称、实则出生位与地形都不镜像」的假对称图。
  const symmetry = requestedSymmetric ? symmetryFor(playerCount) : null;
  const symmetric = symmetry !== null;

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
  // 对称模式：只保留每条旋转轨道（基本扇区内的 index < stride）的实测落点，
  // 其余出生位由轨道代表点绕中心旋转精确得出——findFreeCell 的避让会让落点偏离
  // 理想角位，若不归一化，地形/据点即使镜像、出生位也不镜像，公平性无从谈起。
  if (symmetry) {
    const stride = playerCount / symmetry.sectors;
    for (let i = 0; i < stride; i++) {
      for (let j = 1; j < symmetry.sectors; j++) {
        spawnPositions[i + j * stride] = rotateSteps(spawnPositions[i], j * symmetry.step60);
      }
    }
  }

  // 据点：中心（数量为奇数时）+ 环形分布；对称模式按旋转轨道整体放置。
  let cpCount = Math.round(resolveParam(options.controlPointCount, 'controlPointCount', rng));
  // 歼灭/大逃杀：每个出生位必须绑定唯一据点（loader 硬约束），请求量至少与出生位数持平。
  if (isAnnihilationMode(mode)) cpCount = Math.max(cpCount, playerCount);
  let controlPoints = placeControlPoints(cpCount, radius, symmetry, rng, spawnPositions, playableSet, taken);
  // 放置失败可能少于请求量：不足出生位数时放宽间距规则补放，保证绑定可行性。
  if (isAnnihilationMode(mode) && controlPoints.length < spawnPositions.length) {
    controlPoints = topUpControlPoints(
      controlPoints, spawnPositions, spawnPositions.length, playableSet, taken, symmetry,
    );
  }

  // 回合/行动点/经济/总部参数。
  const maxTurns = Math.round(resolveParam(options.maxTurns, 'maxTurns', rng));
  const actionsPerTurn = Math.round(resolveParam(options.actionsPerTurn, 'actionsPerTurn', rng));
  const startingSupplies = Math.round(resolveParam(options.startingSupplies, 'startingSupplies', rng));
  const baseIncome = Math.round(resolveParam(options.baseIncome, 'baseIncome', rng));
  const headquartersHp = Math.round(resolveParam(options.headquartersHp, 'headquartersHp', rng));
  const headquartersDefense = Math.round(resolveParam(options.headquartersDefense, 'headquartersDefense', rng));
  const variation = resolveParam(options.unitStatVariation, 'unitStatVariation', rng);

  // 炮火参数（仅歼灭/大逃杀注入配置）：固定序消费 rng 保证确定性。
  const artillery = {
    startRound: Math.round(resolveParam(options.artilleryStartRound, 'artilleryStartRound', rng)),
    intervalRounds: Math.round(resolveParam(options.artilleryIntervalRounds, 'artilleryIntervalRounds', rng)),
    damage: Math.round(resolveParam(options.artilleryDamage, 'artilleryDamage', rng)),
    minimumSafeRadius: Math.round(resolveParam(options.artilleryMinimumSafeRadius, 'artilleryMinimumSafeRadius', rng)),
  };

  // 地形：水域与阻挡各自独立密度（旧 terrainDensity 已在 sanitize 时按 60/40 拆开）。
  const waterDensity = resolveParam(options.waterDensity, 'waterDensity', rng);
  const wallDensity = resolveParam(options.wallDensity, 'wallDensity', rng);
  const terrainCells = sampleTerrain(
    waterDensity, wallDensity, symmetry, rng, playableCells, playableSet, spawnPositions,
    controlPoints.map(cp => ({ q: cp.q, r: cp.r })),
  );

  // 出生位配置（总部 + 初始单位）。初始单位数量/构成全局抽一次、全员共享（公平性）。
  // startingUnitCount 收窄/固定数量（v3.3.0 边角采样用），省略时走默认范围 [0,4] 均匀随机。
  // 兵种权重省略/固定标量时零消耗 rng（见 resolveStartingWeights），默认路径与旧池逐位一致。
  const startingUnitCount = Math.round(resolveParam(options.startingUnitCount, 'startingUnitCount', rng));
  const startingWeights = resolveStartingWeights(options, rng);
  const startingUnits = sampleStartingUnits(rng, startingUnitCount, startingWeights);
  const spawnSlots = buildSpawnSlots(mode, spawnPositions, playableSet, controlPoints, symmetry, startingUnits);

  const config = {
    mode,
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
      damageVarianceRange: 3,
      minimumDamage: 1,
      healVarianceRange: 6,
      actionsPerTurn,
      maxTurns,
      adjudicationWeights: sampleAdjudicationWeights(rng),
      controlPointTypes: sampleControlPointTypes(rng),
    },
    // 歼灭/大逃杀注入炮火收缩圈配置；minimumSafeRadius < radius 已由边界表保证（radius ≥ 5）。
    ...(isAnnihilationMode(mode) ? { annihilation: { artillery } } : {}),
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

function topUpControlPoints(
  existing: GeneratedControlPoint[],
  spawnPositions: Position[],
  target: number,
  playableSet: Set<string>,
  taken: Set<string>,
  symmetry: Symmetry | null,
): GeneratedControlPoint[] {
  const points = [...existing];
  // 在已有据点/出生位的邻近格补放，保持分布相对均匀；间距规则放宽，只要求格位空闲。
  const claimable = (pos: Position): boolean => playableSet.has(hexKey(pos)) && !taken.has(hexKey(pos));
  // 对称模式整轨道补放：单个据点会让据点集失去旋转闭合，对称局的领土分配随之无法镜像。
  const orbit = (pos: Position): Position[] => (symmetry ? orbitOf(pos, symmetry) : [pos]);
  const accept = (pos: Position): boolean => {
    const members = orbit(pos);
    const keys = new Set(members.map(hexKey));
    if (keys.size !== members.length) return false; // 退化为中心点（轨道只剩自身）时不补
    return members.every(claimable);
  };
  const candidatePool = (): Position[] => {
    const anchors = [...points.map(cp => ({ q: cp.q, r: cp.r })), ...spawnPositions];
    const seen = new Set<string>();
    const list: Position[] = [];
    for (const anchor of anchors) {
      for (const offset of HEX_OFFSETS) {
        const cell = { q: anchor.q + offset.q, r: anchor.r + offset.r };
        const key = hexKey(cell);
        if (seen.has(key)) continue;
        seen.add(key);
        list.push(cell);
      }
    }
    return list;
  };
  while (points.length < target) {
    let placed = false;
    for (const pos of candidatePool()) {
      if (!accept(pos)) continue;
      for (const cell of orbit(pos)) {
        const kind = KIND_CYCLE[points.length % KIND_CYCLE.length];
        points.push({
          id: `cp_${points.length + 1}`,
          name: `${KIND_NAMES[kind]} ${points.length + 1}`,
          kind,
          q: cell.q,
          r: cell.r,
        });
        taken.add(hexKey(cell));
      }
      placed = true;
      break;
    }
    if (!placed) break;
  }
  return points;
}

/**
 * 对称模式下的据点计划：据点须整轨道放置（中心点轨道为 1），故总数只能取 m×k 或 m×k+1。
 * 取不小于请求量的最小可达值——宁可略多，也不要把据点削到远少于请求（6 人局 m=6 时若取最近，
 * 请求 2 个据点会只剩中心 1 个）。m=2 时任意整数都可达，行为与旧版完全一致。
 */
function symmetricControlPointPlan(count: number, sectors: number): { orbits: number; center: boolean } {
  const achievable: number[] = [];
  for (let orbits = 0; orbits <= Math.ceil(count / sectors) + 1; orbits++) {
    achievable.push(orbits * sectors, orbits * sectors + 1);
  }
  const sorted = [...new Set(achievable)].filter(total => total >= 1).sort((a, b) => a - b);
  const chosen = sorted.find(total => total >= count) ?? sorted[sorted.length - 1];
  return { orbits: Math.floor(chosen / sectors), center: chosen % sectors === 1 };
}

function placeControlPoints(
  count: number,
  radius: number,
  symmetry: Symmetry | null,
  rng: () => number,
  spawnPositions: Position[],
  playableSet: Set<string>,
  taken: Set<string>,
): GeneratedControlPoint[] {
  const points: GeneratedControlPoint[] = [];
  const claimable = (pos: Position): boolean =>
    playableSet.has(hexKey(pos)) && !taken.has(hexKey(pos))
    && !spawnPositions.some(spawn => hexDistance(spawn, pos) < 3);
  const claim = (pos: Position, kind: ControlPointKind): boolean => {
    if (!claimable(pos)) return false;
    taken.add(hexKey(pos));
    const index = points.length;
    points.push({ id: `cp_${index + 1}`, name: `${KIND_NAMES[kind]} ${index + 1}`, kind, q: pos.q, r: pos.r });
    return true;
  };
  // 据点轨道必须整条原子放置：只放一半会在旋转下失衡（中心点轨道退化为自身，不参与）。
  const claimOrbit = (pos: Position, kind: ControlPointKind): boolean => {
    const members = symmetry ? orbitOf(pos, symmetry) : [pos];
    const keys = new Set(members.map(hexKey));
    if (keys.size !== members.length) return false;
    if (!members.every(claimable)) return false;
    for (const member of members) claim(member, kind);
    return true;
  };

  const ringDistance = Math.max(2, Math.round(radius / 2));
  const ringBase = rng() * Math.PI * 2;

  if (symmetry) {
    // 据点按轨道（扇区）放置：轨数 × m（外加可选中心点）。退避按「距离近→远→更近」×
    // 「角度扫满一个扇区」二维搜索，避免小半径下可放格子集中在边缘时整轨落空。
    const plan = symmetricControlPointPlan(count, symmetry.sectors);
    if (plan.center) {
      const centerKind = KIND_CYCLE[Math.floor(rng() * KIND_CYCLE.length)];
      claim({ q: 0, r: 0 }, centerKind);
    }
    const wedge = (2 * Math.PI) / symmetry.sectors;
    for (let i = 0; i < plan.orbits; i++) {
      const kind = KIND_CYCLE[i % KIND_CYCLE.length];
      const angle = ringBase + (i * wedge) / Math.max(1, plan.orbits);
      outer:
      for (let ringTry = 0; ringTry < 4; ringTry++) {
        const distance = Math.min(radius, Math.max(1, ringDistance + [0, 1, -1, 2][ringTry]));
        for (let sweep = 0; sweep < 12; sweep++) {
          const pos = axialFromAngle(angle + sweep * (wedge / 12), distance);
          if (claimOrbit(pos, kind)) break outer;
        }
      }
    }
  } else {
    const includeCenter = count % 2 === 1;
    const ringCount = count - (includeCenter ? 1 : 0);
    if (includeCenter) {
      const centerKind = KIND_CYCLE[Math.floor(rng() * KIND_CYCLE.length)];
      if (!claim({ q: 0, r: 0 }, centerKind)) {
        // 中心不可用时退化为环形多放一个（偶数化）。
        return placeControlPoints(count + 1, radius, null, rng, spawnPositions, playableSet, new Set([...taken].filter(key => key !== '0,0')));
      }
    }
    for (let i = 0; i < ringCount; i++) {
      const kind = KIND_CYCLE[i % KIND_CYCLE.length];
      const angle = ringBase + (i * 2 * Math.PI) / ringCount + (rng() - 0.5) * (Math.PI / ringCount);
      const distance = ringDistance + Math.floor(rng() * 3) - 1;
      const pos = axialFromAngle(angle, Math.max(1, distance));
      if (!claim(pos, kind)) claim(axialFromAngle(angle, ringDistance), kind);
    }
  }
  // 保底：极端小半径下环形落点可能全部失败，全局扫描任意可放轨道；
  // 连轨道都放不下（出生位贴中心）时退化为可放单点，至少保证有占点博弈。
  if (points.length === 0) {
    let matched = false;
    for (const key of playableSet) {
      const [q, r] = key.split(',').map(Number);
      if (claimOrbit({ q, r }, 'supply')) { matched = true; break; }
    }
    if (!matched) {
      for (const key of playableSet) {
        const [q, r] = key.split(',').map(Number);
        if (claim({ q, r }, 'supply') && points.length >= 2) break;
      }
    }
  }
  return points;
}

function sampleTerrain(
  waterDensity: number,
  wallDensity: number,
  symmetry: Symmetry | null,
  rng: () => number,
  playableCells: Position[],
  playableSet: Set<string>,
  spawnPositions: Position[],
  controlPointPositions: Position[],
): { q: number; r: number; terrain: 'water' | 'blocker' }[] {
  const protectedCells = new Set<string>();
  for (const cell of playableCells) {
    // 出生位只保护到 1 环：初始单位只落在总部的 6 个邻格，1 环足以保证它们不被地形占据；
    // 保护 2 环会在出生位较多时连成一整条带，把整个中圈挤出采样域（障碍只剩外圈）。
    const nearSpawn = spawnPositions.some(spawn => hexDistance(spawn, cell) <= 1);
    // 据点只保单格：部署单位只需据点本身可走，相邻连通性由 allReachable 兜底；
    // 若连相邻也保护，据点数量多且均分时（如 6 据点）会整环吃掉三层，中圈再无地形。
    const nearCenterOrCp = hexDistance(cell, { q: 0, r: 0 }) === 0
      || controlPointPositions.some(cp => hexDistance(cp, cell) === 0);
    if (nearSpawn || nearCenterOrCp) protectedCells.add(hexKey(cell));
  }
  // 基本域：每条旋转轨道只留一个代表格（按 (q,r) 取最小）。代表格抽样后整轨道复刻，
  // 只要出生位/据点集本身旋转闭合，保护格也闭合，复刻就不会落回受保护区域。
  const orbit = (pos: Position): Position[] => (symmetry ? orbitOf(pos, symmetry) : [pos]);
  const canonicalKey = (pos: Position): string => {
    if (!symmetry) return hexKey(pos);
    let best = pos;
    for (const member of orbit(pos)) {
      if (member.q < best.q || (member.q === best.q && member.r < best.r)) best = member;
    }
    return hexKey(best);
  };

  const sectors = symmetry ? symmetry.sectors : 1;
  // 水的占比在连通性重抽时保持不变，只整体摊薄总密度（每次重抽减 0.03）。
  const initialTotal = waterDensity + wallDensity;
  const waterShare = initialTotal > 0 ? waterDensity / initialTotal : 0;
  let currentTotal = initialTotal;
  for (let attempt = 0; attempt < 200; attempt++) {
    if (attempt > 0 && attempt % 50 === 0) currentTotal = Math.max(0, currentTotal - 0.03);
    const waterTarget = Math.floor(playableCells.length * currentTotal * waterShare);
    const wallTarget = Math.floor(playableCells.length * currentTotal * (1 - waterShare));
    const terrain = new Map<string, 'water' | 'blocker'>();

    if (currentTotal > 0 && (waterDensity > 0 || wallDensity > 0)) {
      const candidates = playableCells.filter(cell =>
        !protectedCells.has(hexKey(cell)) && hexKey(cell) === canonicalKey(cell));
      shuffleInPlace(candidates, rng);
      // 水域与阻挡各占前 / 后若干轨道（candidates 已打乱，故两类在空间上都是随机子集）。
      // 密度为 0 的一类整局不出现；正值密度至少给一组轨道——小地图上 floor 会把
      // 「设了 0.01 水域」算成 0 格，出现「请求水域却没有水」的观感 bug。
      const picksOf = (target: number, density: number): number =>
        (density > 0 ? Math.max(1, Math.ceil(target / sectors)) : 0);
      const waterPicks = picksOf(waterTarget, waterDensity);
      const wallPicks = picksOf(wallTarget, wallDensity);
      const picks = candidates.slice(0, waterPicks + wallPicks);
      for (let index = 0; index < picks.length; index++) {
        const kind: 'water' | 'blocker' = index < waterPicks ? 'water' : 'blocker';
        for (const member of orbit(picks[index])) {
          if (playableSet.has(hexKey(member))) terrain.set(hexKey(member), kind);
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

/**
 * 出生位 → 居留据点的唯一分配（歼灭/大逃杀专用，store 据此设开局据点归属）。
 * 采用「就近优先」贪心：每轮挑当前总距离最小的一对；对称局以整条旋转轨道整体计分，
 * 保证每个出生位绑定的是空间上邻近的据点（而非索引对位的据点），且对称局领土严格旋转闭合。
 */
function bindControlPoints(
  mode: GameMode,
  spawnPositions: Position[],
  controlPoints: GeneratedControlPoint[],
  symmetry: Symmetry | null,
): (string | undefined)[] {
  const count = spawnPositions.length;
  const bindings: (string | undefined)[] = new Array(count).fill(undefined);
  // 仅歼灭系需要据点归属；据点数不足以覆盖全部出生位时交由 loader 校验兜底（与旧行为一致）。
  if (!isAnnihilationMode(mode) || controlPoints.length < count) return bindings;

  const used = new Set<string>();
  const at = (cp: GeneratedControlPoint): Position => ({ q: cp.q, r: cp.r });
  const cpByKey = new Map(controlPoints.map(cp => [hexKey({ q: cp.q, r: cp.r }), cp]));
  const remaining = new Set(spawnPositions.map((_, index) => index));
  // 对称局：一条轨道内的出生位索引步长（把 360°/n 的角序换成 360°/m 的轨道序）。
  const stride = symmetry ? count / symmetry.sectors : 0;
  const orbitIndices = (index: number): number[] => (symmetry
    ? Array.from({ length: symmetry.sectors }, (_, j) => (index + j * stride) % count)
    : [index]);

  while (remaining.size > 0) {
    let best: {
      score: number;
      index: number;
      orbitIndices: number[];
      cpOrbit: GeneratedControlPoint[];
    } | null = null;
    for (const index of remaining) {
      const hq = spawnPositions[index];
      const orbitIdx = orbitIndices(index);
      // 出生位轨道落点：轨道代表点绕中心旋转（与 buildSpawnSlots 写入的 HQ 同源）。
      const spawnOrbit = symmetry
        ? orbitIdx.map((_, j) => (j === 0 ? hq : rotateSteps(hq, j * symmetry.step60)))
        : [hq];
      for (const cp of controlPoints) {
        if (used.has(cp.id)) continue;
        let cpOrbit: GeneratedControlPoint[];
        if (symmetry) {
          cpOrbit = [];
          let feasible = true;
          for (let j = 0; j < spawnOrbit.length; j++) {
            const member = cpByKey.get(hexKey(rotateSteps(at(cp), j * symmetry.step60)));
            if (member === undefined || used.has(member.id)) { feasible = false; break; }
            cpOrbit.push(member);
          }
          // 中心据点自映射（轨道退化为自身），不参与轨道绑定，留作公共争夺点。
          if (!feasible || new Set(cpOrbit.map(m => m.id)).size !== spawnOrbit.length) continue;
        } else {
          cpOrbit = [cp];
        }
        let score = 0;
        for (let j = 0; j < spawnOrbit.length; j++) score += hexDistance(spawnOrbit[j], at(cpOrbit[j]));
        if (best === null || score < best.score) best = { score, index, orbitIndices: orbitIdx, cpOrbit };
      }
    }
    if (best === null) {
      // 对称局无可用轨道（据点集不闭合的极端情形）：退化为各自就近唯一分配。
      for (const index of [...remaining]) {
        let pick: GeneratedControlPoint | null = null;
        let pickDistance = Number.POSITIVE_INFINITY;
        for (const cp of controlPoints) {
          if (used.has(cp.id)) continue;
          const distance = hexDistance(spawnPositions[index], at(cp));
          if (distance < pickDistance || (distance === pickDistance && pick !== null && cp.id < pick.id)) {
            pickDistance = distance;
            pick = cp;
          }
        }
        if (pick === null) break;
        bindings[index] = pick.id;
        used.add(pick.id);
        remaining.delete(index);
      }
      break;
    }
    for (let j = 0; j < best.orbitIndices.length; j++) {
      const slotIndex = best.orbitIndices[j];
      const cp = best.cpOrbit[j];
      bindings[slotIndex] = cp.id;
      used.add(cp.id);
      if (remaining.has(slotIndex)) remaining.delete(slotIndex);
    }
  }
  return bindings;
}

function buildSpawnSlots(
  mode: GameMode,
  spawnPositions: Position[],
  playableSet: Set<string>,
  controlPoints: GeneratedControlPoint[],
  symmetry: Symmetry | null,
  startingUnits: UnitType[],
): SpawnSlotConfig[] {
  // 歼灭/大逃杀的出生位绑定居留据点（store 据此设据点归属）：按空间就近唯一分配，
  // 对称局按旋转轨道成组处理，保证开局领土与静态图「老家据点」语义一致且旋转闭合。
  const bindings = bindControlPoints(mode, spawnPositions, controlPoints, symmetry);
  const occupied = new Set<string>(controlPoints.map(cp => hexKey(cp)));
  const slots: SpawnSlotConfig[] = new Array(spawnPositions.length);
  const placed: boolean[] = new Array(spawnPositions.length).fill(false);
  const count = spawnPositions.length;
  const stride = symmetry ? count / symmetry.sectors : 0;
  const orbitIndices = (index: number): number[] => (symmetry
    ? Array.from({ length: symmetry.sectors }, (_, j) => (index + j * stride) % count)
    : [index]);

  // 初始单位放在最靠近地图中心的几个邻格：从正对中心起按角度依次取格。
  const unitCellsFor = (hq: Position): Position[] => {
    const hqAngle = pixelAngle(mirror(hq));
    return HEX_OFFSETS
      .map(offset => ({ q: hq.q + offset.q, r: hq.r + offset.r }))
      .filter(cell => playableSet.has(hexKey(cell)) && !occupied.has(hexKey(cell)))
      .sort((a, b) => angleDiff(pixelAngle({ q: a.q - hq.q, r: a.r - hq.r }), hqAngle)
        - angleDiff(pixelAngle({ q: b.q - hq.q, r: b.r - hq.r }), hqAngle))
      .slice(0, startingUnits.length);
  };
  const assignUnits = (cells: Position[]) => cells.map((cell, unitIndex) => {
    occupied.add(hexKey(cell));
    return { type: startingUnits[unitIndex], q: cell.q, r: cell.r };
  });

  for (let index = 0; index < count; index++) {
    if (placed[index]) continue;
    const hq = spawnPositions[index];
    occupied.add(hexKey(hq));
    const orbit = orbitIndices(index);
    // 对称局：整条轨道一次处理，H Q 取轨道代表点旋转，单位布局同取旋转，
    // 规避「最靠中心方向」出现角度平局时两侧站位不镜像的边角情况。
    if (symmetry && orbit.every(i => !placed[i])) {
      for (let j = 1; j < orbit.length; j++) occupied.add(hexKey(spawnPositions[orbit[j]]));
      const cells = unitCellsFor(hq);
      for (let j = 0; j < orbit.length; j++) {
        const slotIndex = orbit[j];
        const slotHq = spawnPositions[slotIndex];
        const boundId = bindings[slotIndex];
        const slotCells = j === 0 ? cells : cells.map(cell => rotateSteps(cell, j * symmetry.step60));
        slots[slotIndex] = {
          id: `slot_${String.fromCharCode(97 + slotIndex)}`,
          headquarters: { q: slotHq.q, r: slotHq.r },
          ...(boundId !== undefined ? { controlPointId: boundId } : {}),
          startingUnits: assignUnits(slotCells),
        };
        placed[slotIndex] = true;
      }
    } else {
      const boundId = bindings[index];
      slots[index] = {
        id: `slot_${String.fromCharCode(97 + index)}`,
        headquarters: { q: hq.q, r: hq.r },
        ...(boundId !== undefined ? { controlPointId: boundId } : {}),
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
