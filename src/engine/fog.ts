// src/engine/fog.ts
// 迷雾模式（fog）的视野、残影与事件投影。
//
// 口径（契约 v1 §3）：
// - 视野按阵营共享：本人全部存活单位、存活总部、本人归属据点（各 1 格）。
// - 半径由 `fog.vision[type]` 覆盖默认值（0–8 整数）；0 表示该兵种只照亮自身所在格。
// - `blocker` 挡视线（不含起点/终点）；`water` 不挡；地图外/不可用格视为挡。
// - 残影保留 1 个完整规划轮：R 轮看见 → R+1 规划期仍返回 → R+2 起丢弃。
// - 交火/踩位/部署冲突由结算层调用 recordFogContact 强制写入 1 轮快照。
//
// 可见格按（stateVersion, roundNumber, phase, viewer）缓存；引擎每次 appendEvent
// 都会推进 stateVersion，因此缓存随状态自然失效。
import type {
  FogSighting, FogState, GameEvent, GameState, PlayerId, Position,
  TerrainType, Unit, UnitType,
} from '../types.js';
import { PLAYER_IDS, isFogMode } from '../types.js';
import { hexDistance, hexKey, hexRange } from './hex.js';
import { getGameIndex } from './gameIndex.js';

export const FOG_VISION_DEFAULTS: Record<UnitType, number> = {
  scout: 4,
  ranger: 3,
  infantry: 2,
  support: 2,
  heavy: 1,
};

export type FogVisionSource =
  | { kind: 'unit'; type: UnitType }
  | { kind: 'headquarters' }
  | { kind: 'controlPoint' };

export interface FogProjection {
  enabled: true;
  /** 终局/揭雾轮后 true：此时 units 为全量。 */
  revealed: boolean;
  /** 已排序的 "q,r"。 */
  visibleCells: string[];
  /** 已排序（seenRound desc, unitId asc）。 */
  lastSeen: FogSighting[];
}

// ------------------------------------------------------------------ 状态

export function createFogState(): FogState {
  return { lastSeen: {} };
}

/**
 * 幂等：补齐 lastSeen 缺失玩家；旧档无 fog 时按模式补。
 * 非 fog 模式不创建 fog 状态（缺省不改变既有行为）。
 */
export function normalizeFogState(game: GameState): void {
  if (!isFogMode(game.config.mode)) return;
  if (!game.fog) game.fog = createFogState();
  if (!game.fog.lastSeen || typeof game.fog.lastSeen !== 'object') game.fog.lastSeen = {};
  for (const id of PLAYER_IDS) {
    if (!game.fog.lastSeen[id]) game.fog.lastSeen[id] = {};
  }
}

function ensureFogState(game: GameState): FogState {
  if (!game.fog) game.fog = createFogState();
  if (!game.fog.lastSeen || typeof game.fog.lastSeen !== 'object') game.fog.lastSeen = {};
  return game.fog;
}

// ------------------------------------------------------------------ 视野

export function visionRadius(game: GameState, source: FogVisionSource): number {
  if (source.kind === 'unit') {
    const override = game.config.fog?.vision?.[source.type];
    const raw = override ?? FOG_VISION_DEFAULTS[source.type] ?? 0;
    return Math.max(0, Math.min(8, Math.trunc(raw)));
  }
  // 总部与己方据点各提供 1 格视野。
  return 1;
}

interface VisionCacheEntry {
  key: string;
  cells: Set<string>;
}

const visionCache = new WeakMap<GameState, Map<PlayerId, VisionCacheEntry>>();

function cacheKeyFor(game: GameState): string {
  // roundNumber / phase 一并入键：揭雾与终局揭晓不写事件时也能立即生效。
  return `${game.stateVersion ?? 0}:${game.turn.roundNumber}:${game.phase}`;
}

function allCellKeys(game: GameState): Set<string> {
  return new Set(game.cells.map(cell => hexKey(cell)));
}

/** 整数向下取整除法 + 非负余数（0 <= rem < d）。入参均为整数，全程无浮点误差。 */
function floorDivRem(n: number, d: number): [number, number] {
  const rem = ((n % d) + d) % d;
  return [(n - rem) / d, rem];
}

/**
 * 六角格之间的直线（不含起点/终点）；cube 坐标插值 + 取整。
 *
 * 插值点用整数有理数精确表示，取整不再依赖固定方向的微小偏置：插值点正好
 * 落在两格公共边/格点顶点时返回**全部**候选格（保守口径：其中任一为 blocker
 * 即挡视线）。候选集只由线段几何决定，因此：
 * - 棋盘对称变换 T 下等变：hexLineBetween(T(a), T(b)) = T(hexLineBetween(a, b))，
 *   180°/120° 旋转与镜像都成立（修复了镜像座位可见格 52 vs 53 的不对称）；
 * - 与方向无关：hexLineBetween(a, b) 与 hexLineBetween(b, a) 作为集合相同。
 */
export function hexLineBetween(from: Position, to: Position): Position[] {
  const distance = hexDistance(from, to);
  if (distance <= 1) return [];
  const cells: Position[] = [];
  const seen = new Set<string>();
  const push = (q: number, r: number): void => {
    const key = `${q},${r}`;
    if (key === hexKey(from) || key === hexKey(to) || seen.has(key)) return;
    seen.add(key);
    cells.push({ q, r });
  };
  for (let i = 1; i < distance; i++) {
    // 三轴插值点的分子（分母恒为 distance）：
    // x / z 由端点线性插值，y = -x - z 保证三点之和为 0。
    const x = from.q * (distance - i) + to.q * i;
    const z = from.r * (distance - i) + to.r * i;
    const y = -x - z;
    const [qx, rx] = floorDivRem(x, distance);
    const [qz, rz] = floorDivRem(z, distance);
    const [qy, ry] = floorDivRem(y, distance);
    // 三个余数之和必为 0、distance 或 2·distance：
    // - 0：插值点正落在格中心，唯一格；
    // - distance：需把一个轴向上取整，取余数最大的轴（并列=公共边，全取）；
    // - 2·distance：需要两个轴向上取整，等价于跳过余数最小的轴。
    const remSum = rx + rz + ry;
    if (remSum === 0) {
      push(qx, qz);
    } else if (remSum === distance) {
      const max = Math.max(rx, rz, ry);
      if (rx === max) push(qx + 1, qz);
      if (rz === max) push(qx, qz + 1);
      if (ry === max) push(qx, qz);
    } else {
      const min = Math.min(rx, rz, ry);
      if (rx === min) push(qx, qz + 1);
      if (rz === min) push(qx + 1, qz);
      if (ry === min) push(qx + 1, qz + 1);
    }
  }
  return cells;
}

type TerrainLookup = {
  hasCell(key: string): boolean;
  terrainAt(key: string): TerrainType | undefined;
};

function currentLookup(game: GameState): TerrainLookup {
  const index = getGameIndex(game);
  return {
    hasCell: key => index.cells.has(key),
    terrainAt: key => index.terrain.get(key),
  };
}

function lineOfSightClear(
  from: Position,
  to: Position,
  lookup: TerrainLookup,
): boolean {
  for (const cell of hexLineBetween(from, to)) {
    const key = hexKey(cell);
    // 地图外/不可用格视为挡视线；blocker 挡；water 不挡。
    if (!lookup.hasCell(key)) return false;
    if (lookup.terrainAt(key) === 'blocker') return false;
  }
  return true;
}

interface VisionSource {
  pos: Position;
  radius: number;
}

function sourcesForViewer(game: GameState, viewer: PlayerId): VisionSource[] {
  const sources: VisionSource[] = [];
  for (const unit of game.units) {
    if (!unit.alive || unit.owner !== viewer) continue;
    sources.push({ pos: { q: unit.q, r: unit.r }, radius: visionRadius(game, { kind: 'unit', type: unit.type }) });
  }
  const hq = game.headquarters[viewer];
  if (hq?.alive) {
    sources.push({ pos: { q: hq.q, r: hq.r }, radius: visionRadius(game, { kind: 'headquarters' }) });
  }
  for (const point of game.controlPoints) {
    if (point.owner !== viewer) continue;
    sources.push({ pos: { q: point.q, r: point.r }, radius: visionRadius(game, { kind: 'controlPoint' }) });
  }
  return sources;
}

function computeVisibleCells(
  sources: VisionSource[],
  lookup: TerrainLookup,
): Set<string> {
  const visible = new Set<string>();
  for (const source of sources) {
    const radius = Math.max(0, Math.min(8, Math.trunc(source.radius)));
    const cells = radius === 0 ? [{ q: source.pos.q, r: source.pos.r }] : hexRange(source.pos, radius);
    for (const cell of cells) {
      const key = hexKey(cell);
      if (!lookup.hasCell(key)) continue;
      if (visible.has(key)) continue;
      if (!lineOfSightClear(source.pos, cell, lookup)) continue;
      visible.add(key);
    }
  }
  return visible;
}

/**
 * 该观者当前能看见的格（含地形格；地图外不在集合内）。
 * 揭雾后返回全部可用格。返回副本，调用方可以安全修改。
 */
export function visibleCellsFor(game: GameState, viewer: PlayerId): Set<string> {
  if (!isFogMode(game.config.mode) || isFogRevealed(game)) return allCellKeys(game);
  let byViewer = visionCache.get(game);
  if (!byViewer) {
    byViewer = new Map();
    visionCache.set(game, byViewer);
  }
  const key = cacheKeyFor(game);
  const cached = byViewer.get(viewer);
  if (cached && cached.key === key) return new Set(cached.cells);
  const cells = computeVisibleCells(sourcesForViewer(game, viewer), currentLookup(game));
  byViewer.set(viewer, { key, cells });
  return new Set(cells);
}

export function isCellVisible(game: GameState, viewer: PlayerId, q: number, r: number): boolean {
  return visibleCellsFor(game, viewer).has(`${q},${r}`);
}

/** 该观者能看到的全部单位：自己的全部 + 视野内敌军。 */
export function unitsForViewer(game: GameState, viewer: PlayerId): Unit[] {
  if (!isFogMode(game.config.mode)) return game.units;
  if (isFogRevealed(game)) return game.units;
  const visible = visibleCellsFor(game, viewer);
  return game.units.filter(unit => unit.owner === viewer || visible.has(hexKey(unit)));
}

/** 非玩家视角（观战/匿名/非 fog 模式）统一返回全量。 */
export function allUnitsForFullView(game: GameState): Unit[] {
  return game.units;
}

// ------------------------------------------------------------------ 记忆

function sightingOf(unit: Unit, round: number): FogSighting {
  return {
    unitId: unit.id,
    owner: unit.owner,
    type: unit.type,
    q: unit.q,
    r: unit.r,
    hp: unit.hp,
    maxHp: unit.maxHp,
    seenRound: round,
  };
}

/** 交火/踩位/部署冲突：强制写入 1 个规划轮的对方快照（不产生事件）。 */
export function recordFogContact(game: GameState, viewer: PlayerId, target: Unit): void {
  if (!isFogMode(game.config.mode)) return;
  if (!game.players[viewer] || target.owner === viewer) return;
  const fog = ensureFogState(game);
  const memory = fog.lastSeen[viewer] ?? (fog.lastSeen[viewer] = {});
  memory[target.id] = sightingOf(target, game.turn.roundNumber);
}

/**
 * 每次事件 append 后调用：刷新所有存活玩家的 lastSeen（含过期裁剪）。
 * 淘汰玩家的记忆直接清空；其他玩家对被淘汰者的残影只等自然过期。
 */
export function updateFogMemory(game: GameState): void {
  if (!isFogMode(game.config.mode)) return;
  const round = game.turn.roundNumber;
  const fog = ensureFogState(game);
  for (const id of PLAYER_IDS) {
    const player = game.players[id];
    if (!player) continue;
    if (player.status === 'eliminated') {
      delete fog.lastSeen[id];
      continue;
    }
    if (player.status !== 'active') continue;
    const memory = fog.lastSeen[id] ?? (fog.lastSeen[id] = {});
    for (const [unitId, sighting] of Object.entries(memory)) {
      // R 轮看见 → R+1 规划期仍返回 → R+2 起丢弃。
      if (round > sighting.seenRound + 1) delete memory[unitId];
    }
    if (isFogRevealed(game)) continue;
    const visible = computeVisibleCells(sourcesForViewer(game, id), currentLookup(game));
    for (const unit of game.units) {
      if (unit.owner === id || !unit.alive) continue;
      if (!visible.has(hexKey(unit))) continue;
      memory[unit.id] = sightingOf(unit, round);
    }
  }
}

export function isFogRevealed(game: GameState): boolean {
  if (!isFogMode(game.config.mode)) return true;
  if (game.phase === 'game_over') return true;
  const revealFrom = game.config.fog?.revealFromRound ?? null;
  return revealFrom !== null && game.turn.roundNumber >= revealFrom;
}

function sortCellKeys(keys: Iterable<string>): string[] {
  return [...keys].sort((a, b) => {
    const [aq, ar] = a.split(',').map(Number);
    const [bq, br] = b.split(',').map(Number);
    return aq - bq || ar - br;
  });
}

export function fogProjectionFor(game: GameState, viewer: PlayerId): FogProjection {
  if (!isFogMode(game.config.mode) || isFogRevealed(game)) {
    return {
      enabled: true,
      revealed: true,
      visibleCells: sortCellKeys(allCellKeys(game)),
      lastSeen: [],
    };
  }
  const visible = visibleCellsFor(game, viewer);
  const memory = game.fog?.lastSeen?.[viewer] ?? {};
  const lastSeen = Object.values(memory)
    .filter(sighting => game.turn.roundNumber <= sighting.seenRound + 1)
    .sort((a, b) => b.seenRound - a.seenRound || (a.unitId < b.unitId ? -1 : a.unitId > b.unitId ? 1 : 0))
    .map(sighting => ({ ...sighting }));
  return {
    enabled: true,
    revealed: false,
    visibleCells: sortCellKeys(visible),
    lastSeen,
  };
}

// ------------------------------------------------------------------ 事件投影

function cloneEvent(event: GameEvent): GameEvent {
  return { ...event, payload: structuredClone(event.payload) };
}

function payloadNumber(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function payloadUnitId(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** 只在事件确实携带、且该单位对观者不可见时删除对应键。 */
function redactHiddenUnit(
  payload: Record<string, unknown>,
  key: string,
  game: GameState,
  viewer: PlayerId | null,
  isVisible: (unit: Unit) => boolean,
): void {
  const unitId = payloadUnitId(payload, key);
  if (!unitId) return;
  const unit = game.units.find(candidate => candidate.id === unitId);
  if (!unit) return;
  if (viewer && (unit.owner === viewer || isVisible(unit))) return;
  delete payload[key];
}

function projectScoresForViewer(
  payload: Record<string, unknown>,
  viewer: PlayerId | null,
): void {
  const scores = payload.scores;
  if (scores && typeof scores === 'object' && !Array.isArray(scores)) {
    const projected: Record<string, unknown> = {};
    for (const [id, score] of Object.entries(scores as Record<string, unknown>)) {
      const total = score && typeof score === 'object'
        ? (score as Record<string, unknown>).total ?? 0
        : 0;
      if (viewer && id === viewer) projected[id] = score;
      else projected[id] = viewer ? { total, hidden: true } : { total };
    }
    payload.scores = projected;
  }
  const rankings = payload.rankings;
  if (Array.isArray(rankings)) {
    payload.rankings = rankings.map(entry => {
      const record = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
      const score = record.score;
      const total = score && typeof score === 'object'
        ? (score as Record<string, unknown>).total ?? 0
        : 0;
      if (viewer && record.playerId === viewer) return record;
      return { ...record, score: viewer ? { total, hidden: true } : { total } };
    });
  }
}

function projectGameStart(
  game: GameState,
  event: GameEvent,
  viewer: PlayerId | null,
): GameEvent | null {
  const payload = event.payload;
  const roundNumber = payloadNumber(payload, 'roundNumber') ?? game.turn.roundNumber;
  if (!viewer) return { ...cloneEvent(event), payload: { roundNumber } };
  const cloned = cloneEvent(event);
  const units = Array.isArray(cloned.payload.units)
    ? cloned.payload.units as Record<string, unknown>[]
    : [];
  // 用 game_start 快照重建开局视野：本人单位 + 本人总部；开局据点均无主，不提供视野。
  const sources: VisionSource[] = [];
  for (const unit of units) {
    if (unit.owner !== viewer) continue;
    sources.push({
      pos: { q: Number(unit.q), r: Number(unit.r) },
      radius: visionRadius(game, { kind: 'unit', type: unit.type as UnitType }),
    });
  }
  const hq = (cloned.payload.headquarters as Record<string, unknown> | undefined)?.[viewer] as
    Record<string, unknown> | undefined;
  if (hq && hq.alive !== false) {
    sources.push({
      pos: { q: Number(hq.q), r: Number(hq.r) },
      radius: visionRadius(game, { kind: 'headquarters' }),
    });
  }
  const mapPayload = cloned.payload.map as Record<string, unknown> | undefined;
  const snapshotCells = Array.isArray(mapPayload?.cells)
    ? mapPayload.cells as Record<string, unknown>[]
    : [];
  let lookup: TerrainLookup;
  if (snapshotCells.length > 0) {
    const cells = new Set<string>();
    const terrain = new Map<string, TerrainType>();
    for (const cell of snapshotCells) {
      const key = `${cell.q},${cell.r}`;
      cells.add(key);
      terrain.set(key, cell.terrain as TerrainType);
    }
    for (const cell of (Array.isArray(mapPayload?.terrainCells) ? mapPayload.terrainCells : []) as Record<string, unknown>[]) {
      terrain.set(`${cell.q},${cell.r}`, cell.terrain as TerrainType);
    }
    lookup = {
      hasCell: key => cells.has(key),
      terrainAt: key => terrain.get(key),
    };
  } else {
    lookup = currentLookup(game);
  }
  const visible = computeVisibleCells(sources, lookup);
  cloned.payload.units = units.filter(unit => {
    if (unit.owner === viewer) return true;
    return visible.has(`${unit.q},${unit.r}`);
  });
  return cloned;
}

/**
 * 按契约 §4.4 投影单条事件。
 * - `viewer=null` 表示匿名公开视角。
 * - 非 fog 模式返回 null（调用方不替换原事件）。
 * - 拿不准时丢弃整条事件（null），不做部分揭示。
 */
export function projectEventForViewer(
  game: GameState,
  event: GameEvent,
  viewer: PlayerId | null,
): GameEvent | null {
  if (!isFogMode(game.config.mode)) return null;
  const visible = viewer ? visibleCellsFor(game, viewer) : null;
  const revealed = isFogRevealed(game);
  const cellVisible = (q: number | null, r: number | null): boolean => {
    if (!viewer) return false;
    if (revealed) return true;
    if (q === null || r === null) return false;
    return visible!.has(`${q},${r}`);
  };
  const unitVisible = (unit: Unit | undefined): boolean => {
    if (!viewer || !unit) return false;
    if (revealed) return true;
    return unit.owner === viewer || visible!.has(hexKey(unit));
  };
  const unitOf = (unitId: string | null): Unit | undefined =>
    unitId ? game.units.find(unit => unit.id === unitId) : undefined;
  const isOwnUnit = (unitId: string | null): boolean => {
    const unit = unitOf(unitId);
    return Boolean(viewer && unit && unit.owner === viewer);
  };

  switch (event.type) {
    // ---------------------------------------------------------- 公开事件
    case 'round_start':
    case 'round_end':
    case 'income':
    case 'comeback_supply':
    case 'turn_end':
    case 'plan_committed':
    case 'wait':
    case 'reset_actions':
    case 'turn_skipped':
    case 'player_joined':
    case 'player_left':
    case 'name_rename':
    case 'bot_failed':
    case 'artillery_warning':
    case 'artillery_shrunk':
    case 'artillery_damage':
      return cloneEvent(event);

    case 'player_eliminated': {
      const cloned = cloneEvent(event);
      // 被淘汰玩家的剩余单位 ID 属于隐藏信息：只有本人视角保留。
      if (!viewer || viewer !== cloned.payload.playerId) delete cloned.payload.removedUnitIds;
      // score 走裁决投影：本人完整；其他人仅总分 + hidden；匿名公开仅总分。
      const score = cloned.payload.score;
      if (score && typeof score === 'object' && !Array.isArray(score)) {
        const total = (score as Record<string, unknown>).total ?? 0;
        if (!viewer) cloned.payload.score = { total };
        else if (viewer !== cloned.payload.playerId) cloned.payload.score = { total, hidden: true };
      }
      projectScoresForViewer(cloned.payload, viewer);
      return cloned;
    }

    case 'game_over': {
      const cloned = cloneEvent(event);
      projectScoresForViewer(cloned.payload, viewer);
      return cloned;
    }

    case 'headquarters_destroyed': {
      const cloned = cloneEvent(event);
      // 总部被摧毁是公开结果；攻击者身份不随事件传播。
      for (const key of ['attackerId', 'attacker', 'killer', 'eliminatedBy']) delete cloned.payload[key];
      return cloned;
    }

    case 'control_point_neutralized':
      return cloneEvent(event);

    case 'control_point_captured': {
      const cloned = cloneEvent(event);
      // 据点信息与归属公开；隐藏执行者的 unitId / 坐标脱敏。
      delete cloned.payload.unitId;
      delete cloned.payload.q;
      delete cloned.payload.r;
      return cloned;
    }

    case 'control_point_repair': {
      const owner = clonedOwner(event.payload);
      const unitId = payloadUnitId(event.payload, 'unitId');
      if (viewer && (owner === viewer || isOwnUnit(unitId) || unitVisible(unitOf(unitId)))) {
        return cloneEvent(event);
      }
      return null;
    }

    // ---------------------------------------------------------- 行动事件
    case 'move': {
      const owner = clonedOwner(event.payload);
      if (!viewer) return null;
      if (owner === viewer) return cloneEvent(event);
      if (!cellVisible(payloadNumber(event.payload, 'toQ'), payloadNumber(event.payload, 'toR'))) return null;
      const cloned = cloneEvent(event);
      // 第三方只看到"有单位进入可见格"；起点仍可能是隐藏格，不跟踪。
      delete cloned.payload.fromQ;
      delete cloned.payload.fromR;
      return cloned;
    }

    case 'deploy': {
      const owner = clonedOwner(event.payload);
      if (!viewer) return null;
      if (owner === viewer) return cloneEvent(event);
      if (!cellVisible(payloadNumber(event.payload, 'q'), payloadNumber(event.payload, 'r'))) return null;
      return cloneEvent(event);
    }

    case 'demolish': {
      const owner = clonedOwner(event.payload);
      if (!viewer) return null;
      if (owner === viewer) return cloneEvent(event);
      if (!cellVisible(payloadNumber(event.payload, 'q'), payloadNumber(event.payload, 'r'))) return null;
      const cloned = cloneEvent(event);
      if (!unitVisible(unitOf(payloadUnitId(cloned.payload, 'unitId')))) delete cloned.payload.unitId;
      return cloned;
    }

    case 'heal': {
      const owner = clonedOwner(event.payload);
      if (!viewer) return null;
      if (owner === viewer) return cloneEvent(event);
      const supportVisible = unitVisible(unitOf(payloadUnitId(event.payload, 'supportId')));
      const targetVisible = unitVisible(unitOf(payloadUnitId(event.payload, 'targetId')));
      const q = payloadNumber(event.payload, 'q');
      const r = payloadNumber(event.payload, 'r');
      const cellOk = q !== null && r !== null
        ? cellVisible(q, r)
        : supportVisible || targetVisible;
      if (!cellOk || (!supportVisible && !targetVisible)) return null;
      const cloned = cloneEvent(event);
      if (!supportVisible) delete cloned.payload.supportId;
      if (!targetVisible) delete cloned.payload.targetId;
      return cloned;
    }

    case 'attack': {
      const owner = clonedOwner(event.payload);
      if (!viewer) return null;
      if (owner === viewer) return cloneEvent(event);
      const attackerId = payloadUnitId(event.payload, 'attackerId');
      const attacker = unitOf(attackerId);
      const targetId = payloadUnitId(event.payload, 'targetId');
      const target = unitOf(targetId);
      // 被攻击者本人（单位或总部）：规则上会拿到攻击者 1 轮快照，事件可保留。
      const hqTarget = event.payload.targetKind === 'headquarters' && targetId
        ? Object.values(game.headquarters).find(hq => hq.id === targetId)
        : undefined;
      if ((target && target.owner === viewer) || (hqTarget && hqTarget.owner === viewer)) {
        return cloneEvent(event);
      }
      const hit = event.payload.hit !== false;
      const q = payloadNumber(event.payload, 'q');
      const r = payloadNumber(event.payload, 'r');
      const cellOk = cellVisible(q, r)
        || cellVisible(payloadNumber(event.payload, 'aimQ'), payloadNumber(event.payload, 'aimR'));
      if (!cellOk) return null;
      const cloned = cloneEvent(event);
      // 第三方只看到交火发生；隐藏攻击者身份（attackerId / owner）脱敏。
      if (!unitVisible(attacker)) {
        delete cloned.payload.attackerId;
        delete cloned.payload.owner;
      }
      // 被命中目标若不可见，同样不暴露身份（坐标已可见时目标通常可见）。
      if (hit && !unitVisible(target)) {
        delete cloned.payload.targetId;
        delete cloned.payload.targetKind;
      }
      return cloned;
    }

    case 'action_failed': {
      // 失败原因可能间接暴露隐藏单位的位置/存在：只给行动者本人。
      if (!viewer) return null;
      return clonedOwner(event.payload) === viewer ? cloneEvent(event) : null;
    }

    // ---------------------------------------------------------- 死亡/结算
    case 'unit_death': {
      if (!viewer) return null;
      const owner = event.payload.owner;
      const killer = event.payload.killer;
      const unitId = payloadUnitId(event.payload, 'unitId');
      if (owner === viewer || killer === viewer || unitVisible(unitOf(unitId))) {
        return cloneEvent(event);
      }
      return null;
    }

    case 'round_resolved': {
      const cloned = cloneEvent(event);
      if (!viewer) {
        return {
          ...cloned,
          payload: {
            roundNumber: cloned.payload.roundNumber,
            ...(cloned.payload.gameOver !== undefined ? { gameOver: cloned.payload.gameOver } : {}),
          },
        };
      }
      const results = cloned.payload.results;
      const own = results && typeof results === 'object'
        ? (results as Record<string, unknown>)[viewer]
        : undefined;
      const ownOutcomes = Array.isArray(own) ? own : [];
      // 只保留本人结果；隐藏条目丢弃，steps 只反映本人队列。
      cloned.payload.results = { [viewer]: ownOutcomes };
      cloned.payload.steps = ownOutcomes.length;
      return cloned;
    }

    case 'game_start': {
      return projectGameStart(game, event, viewer);
    }

    default:
      return null;
  }
}

function clonedOwner(payload: Record<string, unknown>): PlayerId | null {
  const owner = payload.owner;
  return typeof owner === 'string' ? owner as PlayerId : null;
}
