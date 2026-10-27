// src/state/store.ts
import { randomUUID } from 'node:crypto';
import {
  accessSync, closeSync, constants, existsSync, fsyncSync, mkdirSync, openSync, readFileSync,
  readdirSync, renameSync, unlinkSync, writeFileSync, writeSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  GameState, Headquarters, MapCell, PlayerId, PlayerState, SeatPlan, Unit, UnitType,
} from '../types.js';
import { isAnnihilationMode, isPlayerId, isSimultaneousMode, normalizePlayerName, PLAYER_IDS } from '../types.js';
import { getMapConfig } from '../config/loader.js';
import type { MapConfig, SpawnSlotConfig, UnitSpec } from '../config/loader.js';
import { createMapCells } from '../config/geometry.js';
import { artilleryStateForRound } from '../engine/artillery.js';
import { actionMeritForEvent } from '../engine/actionScore.js';
import { seedGameRandom } from '../engine/random.js';
import { logger } from '../utils/logger.js';
import { inc, observe } from '../utils/metrics.js';
import { generateToken, hashToken, migrateToken } from './tokens.js';

export { generateToken } from './tokens.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');
const PERSISTENCE_SCHEMA_VERSION = 2;

interface GameStoreOptions {
  persistenceFile?: string | null;
}

interface PersistedGamesFile {
  schemaVersion: number;
  savedAt: string;
  games: GameState[];
}

function safeGameId(id: string): string {
  return id.replace(/[^\w.-]/g, '_');
}

/** 测试/运维可见的每局快照路径；与 GameStore 内部布局保持一致。 */
export function gameSnapshotPath(persistenceFile: string, gameId: string): string {
  return join(dirname(persistenceFile), 'store', `${safeGameId(gameId)}.json`);
}

interface PersistedGameSnapshot {
  schemaVersion: number;
  savedAt: string;
  game: GameState;
}

interface RawSecrets {
  hostToken: string;
  tokens: Partial<Record<PlayerId, string>>;
}

// 原始 token 只在创建/加入响应里返回一次；不写进 GameState，避免落盘。
const rawSecrets = new WeakMap<GameState, RawSecrets>();

export function getRawHostToken(game: GameState): string | null {
  return rawSecrets.get(game)?.hostToken ?? null;
}

export function getRawPlayerToken(game: GameState, playerId: PlayerId): string | null {
  return rawSecrets.get(game)?.tokens[playerId] ?? null;
}

export interface CreateLobbyOptions {
  maxPlayers: number;
  participate?: boolean;
  playerName?: string;
}

function defaultPersistenceFile(): string | null {
  if (process.env.TACTICAL_GAME_STATE_FILE) return process.env.TACTICAL_GAME_STATE_FILE;
  if (process.env.VITEST) return null;
  return join(PROJECT_ROOT, 'runtime', 'games.json');
}

export function createPlayer(id: PlayerId, name?: unknown): PlayerState {
  const normalizedName = normalizePlayerName(name);
  return {
    id,
    name: normalizedName || `玩家 ${id.slice(-1).toUpperCase()}`,
    joinedAt: Date.now(),
    status: 'lobby',
    spawnSlotId: null,
    turnOrder: null,
    eliminatedAt: null,
    eliminatedBy: null,
    stats: {
      headquartersDamage: 0, unitsDestroyed: 0, playersEliminated: 0, actionPointsUsed: 0,
      actionMerit: 0, killValue: 0, controlHold: 0, controlHoldRounds: 0,
    },
  };
}

function createUnit(owner: PlayerId, type: UnitType, q: number, r: number, spec: UnitSpec): Unit {
  return {
    id: randomUUID(), owner, type, q, r,
    hp: spec.hp, maxHp: spec.hp, attack: spec.attack, defense: spec.defense,
    moveRange: spec.moveRange, attackRange: spec.attackRange, cost: spec.cost,
    alive: true, hasMoved: false, hasActed: false, actionSpent: false,
    canCapture: spec.canCapture, healPower: spec.healPower,
  };
}

export function createUnitFromConfig(config: MapConfig, owner: PlayerId, type: UnitType, q: number, r: number): Unit {
  return createUnit(owner, type, q, r, config.units[type]);
}

function createHQ(owner: PlayerId, config: MapConfig, slot: SpawnSlotConfig): Headquarters {
  return {
    id: randomUUID(), owner, q: slot.headquarters.q, r: slot.headquarters.r,
    hp: config.headquartersSpec.hp, maxHp: config.headquartersSpec.hp,
    defense: config.headquartersSpec.defense, alive: true,
  };
}

function createCells(config: MapConfig): MapCell[] {
  return createMapCells(config.playableCells, config.terrainCells);
}

export function createLobby(id: string, mapId = 'default', options: CreateLobbyOptions): GameState {
  return createLobbyWithConfig(id, mapId, getMapConfig(mapId), options);
}

/** 用完整地图配置建大厅；随机地图等运行时生成的配置不注册进全局地图表，直接传入。 */
export function createLobbyWithConfig(id: string, mapId: string, config: MapConfig, options: CreateLobbyOptions): GameState {
  const maxPlayers = Math.max(2, Math.min(8, Math.trunc(options.maxPlayers)));
  const hostToken = generateToken();
  const game: GameState = {
    id, mapId, config, createdAt: Date.now(), phase: 'lobby', maxPlayers, hostToken: hashToken(hostToken),
    players: {},
    map: {
      grid: 'hex', orientation: 'pointy', radius: config.radius,
      terrainCells: config.terrainCells.map(c => ({ ...c })),
    },
    cells: createCells(config),
    controlPoints: config.controlPoints.map(point => ({ ...point, owner: null })),
    headquarters: {}, units: [], resources: {}, tokens: {}, playerNames: {},
    turn: {
      roundNumber: 1, currentPlayerId: null, turnOrder: [], actedThisRound: [],
      phase: 'lobby', actionsUsed: 0, turnNumber: 1, currentOwner: null,
    },
    plan: null,
    events: [], winner: null, result: null,
    artillery: null,
  };
  rawSecrets.set(game, { hostToken, tokens: {} });
  game.artillery = artilleryStateForRound(game, 1);
  // 大厅列表要显示房主名：参战时取房主席位名（留空由服务端分配默认名），
  // 未参战时用创建表单填的名字（可能为空，界面会只显示「房主」）。
  const hostNameInput = normalizePlayerName(options.playerName);
  let hostName = hostNameInput;
  if (options.participate !== false) {
    const joined = addLobbyPlayer(game, hostNameInput);
    if (joined) hostName = game.players[joined.id]!.name;
  }
  game.hostName = hostName;
  return game;
}

export function addLobbyPlayer(game: GameState, name?: string): { id: PlayerId; token: string } | null {
  if (game.phase !== 'lobby') return null;
  const joined = PLAYER_IDS.filter(id => game.players[id]).length;
  if (joined >= game.maxPlayers) return null;
  const id = PLAYER_IDS.find(candidate => !game.players[candidate]);
  if (!id) return null;
  const player = createPlayer(id, name);
  const token = generateToken();
  game.players[id] = player;
  game.tokens[id] = hashToken(token);
  game.playerNames[id] = player.name;
  const secrets = rawSecrets.get(game) ?? { hostToken: '', tokens: {} };
  secrets.tokens[id] = token;
  rawSecrets.set(game, secrets);
  // 已编排座位时，新加入者顺次坐到最后一个座位后面（不预留空位、不重排既有座位）。
  appendSeatForJoin(game, id);
  return { id, token };
}

export function removeLobbyPlayer(game: GameState, playerId: PlayerId): boolean {
  if (game.phase !== 'lobby' || !game.players[playerId]) return false;
  delete game.players[playerId];
  delete game.tokens[playerId];
  delete game.playerNames[playerId];
  const secrets = rawSecrets.get(game);
  if (secrets) delete secrets.tokens[playerId];
  removeSeatForLeave(game, playerId);
  return true;
}

/**
 * 校验一个座位表是否是「当前已加入玩家集合的一个排列」：
 * 长度相等、元素都是已知席位、无重复、无陌生人。
 */
export function isSeatOrderValid(order: unknown, joined: PlayerId[]): order is PlayerId[] {
  if (!Array.isArray(order) || order.length !== joined.length) return false;
  const seen = new Set<string>();
  for (const id of order) {
    if (!isPlayerId(id) || seen.has(id) || !joined.includes(id)) return false;
    seen.add(id);
  }
  return true;
}

/** 房主保存座位表（全量替换）；版本 +1。调用方须先校验载荷。 */
export function setSeatPlan(game: GameState, order: PlayerId[], firstSeat: number): void {
  game.seatPlan = { order: [...order], firstSeat };
  game.seatVersion = (game.seatVersion ?? 0) + 1;
}

/** 房主取消编排：回到服务端随机配对 + 随机先手（仅顺序模式；同时模式本就无先手）。 */
export function clearSeatPlan(game: GameState): void {
  game.seatPlan = null;
  game.seatVersion = (game.seatVersion ?? 0) + 1;
}

/**
 * 成员变动时对座位表做跟随性维护：只追加到末尾 / 删除后前移。
 * 版本无条件 +1：成员进出会改变座位表长度，前端草稿必须据此失效，
 * 否则旧草稿会带着合法的 ifVersion 提交非法排列（400），提示难懂。
 */
function appendSeatForJoin(game: GameState, id: PlayerId): void {
  const plan = game.seatPlan;
  if (plan) plan.order.push(id);
  game.seatVersion = (game.seatVersion ?? 0) + 1;
}

function removeSeatForLeave(game: GameState, id: PlayerId): void {
  const plan = game.seatPlan;
  // 座位版本独立于 stateVersion：大厅期 stateVersion 保持不变是为了 ETag 条件请求，
  // 座位改动的去重/冲突只看 seatVersion。
  if (!plan) {
    game.seatVersion = (game.seatVersion ?? 0) + 1;
    return;
  }
  const index = plan.order.indexOf(id);
  if (index >= 0) plan.order.splice(index, 1);
  // 先手（仅顺序模式）被移出时顺位前一格，保住「还是同一个人先手」的直觉；随后再夹到合法范围。
  // 同时回合 / 大逃杀 firstSeat 恒 0，这段天然 no-op。
  if (index >= 0 && index < plan.firstSeat) plan.firstSeat -= 1;
  if (plan.order.length === 0) {
    game.seatPlan = null;
  } else if (plan.firstSeat > plan.order.length - 1) {
    plan.firstSeat = plan.order.length - 1;
  }
  game.seatVersion = (game.seatVersion ?? 0) + 1;
}

/**
 * 开局入口的一致性闸门：座位表必须恰好是当前在场玩家的一个排列，`firstSeat` 也必须合法。
 * 任何不一致都只降级为随机开局（记 warning），绝不让 startGame 因为座位表失败。
 */
function resolveSeatPlan(game: GameState, joined: PlayerId[]): SeatPlan | null {
  const plan = game.seatPlan;
  if (!plan) return null;
  // 同时回合 / 大逃杀没有先手：旧存档里可能残留非 0 的 firstSeat，这里按 0 处理（不降级、不改库），
  // 保证 turnOrder 严格等于 order，结算处理顺序从 1 号座位起算。
  const normalizedFirstSeat = isSimultaneousMode(game.config.mode) ? 0 : plan.firstSeat;
  const firstSeatOk = Number.isInteger(normalizedFirstSeat)
    && normalizedFirstSeat >= 0 && normalizedFirstSeat < joined.length;
  if (!firstSeatOk || !isSeatOrderValid(plan.order, joined)) {
    logger.warn(`对局 ${game.id} 的座位表与在场玩家不一致，已降级为随机开局`, { tag: 'game:seat' });
    game.seatPlan = null;
    game.seatVersion = (game.seatVersion ?? 0) + 1;
    return null;
  }
  return { order: [...plan.order], firstSeat: normalizedFirstSeat };
}

/** 只推进注入的随机流，不产生结果；用于让 manual 分支与随机分支的取样次数一致。 */
function consumeRandom(random: () => number, count: number): void {
  for (let i = 0; i < count; i += 1) void random();
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function initializeLobbyGame(game: GameState, random: () => number = Math.random): void {
  const playerIds = PLAYER_IDS.filter(id => game.players[id]);
  const layoutIds = game.config.layouts[String(playerIds.length)];
  if (!layoutIds) throw new Error('不支持该玩家人数');
  const slots = layoutIds.map(id => game.config.spawnSlots.find(slot => slot.id === id)!);
  const seatPlan = resolveSeatPlan(game, playerIds);
  // 编排过的座位按房主的表确定性配对、不再洗牌；但仍消费与 shuffle() 相同次数（n-1）的随机数，
  // 否则同一 seed 的对局会因「房主是否编排过座位」在后续伤害/治疗掷骰序列上漂移（见 §3.3）。
  let assignedPlayers: PlayerId[];
  if (seatPlan) {
    consumeRandom(random, playerIds.length - 1);
    assignedPlayers = [...seatPlan.order];
  } else {
    assignedPlayers = shuffle(playerIds, random);
  }

  game.headquarters = {};
  game.units = [];
  game.resources = {};
  for (let index = 0; index < slots.length; index++) {
    const owner = assignedPlayers[index];
    const slot = slots[index];
    const player = game.players[owner]!;
    player.status = 'active';
    player.spawnSlotId = slot.id;
    player.turnOrder = index;
    // 歼灭系模式（annihilation/royale）不建总部，改为出生点控制点归属；其余模式按出生点建总部。
    if (!isAnnihilationMode(game.config.mode)) {
      game.headquarters[owner] = createHQ(owner, game.config, slot);
    } else {
      const point = game.controlPoints.find(candidate => candidate.id === slot.controlPointId);
      if (point) point.owner = owner;
    }
    game.resources[owner] = { supplies: game.config.balance.startingSupplies };
    game.units.push(...slot.startingUnits.map(unit =>
      createUnitFromConfig(game.config, owner, unit.type, unit.q, unit.r)));
  }

  // 先手（仅 standard / annihilation）：编排过就取 firstSeat，同样消费一次随机数与「随机起点」路径对齐。
  // 同时回合 / 大逃杀没有先手：startIndex 恒 0 → turnOrder 严格等于 order（座位序 = 出生点 + 结算处理顺序）。
  let startIndex: number;
  if (seatPlan) {
    consumeRandom(random, 1);
    startIndex = seatPlan.firstSeat;
  } else {
    startIndex = Math.floor(random() * assignedPlayers.length);
  }
  const turnOrder = [...assignedPlayers.slice(startIndex), ...assignedPlayers.slice(0, startIndex)];
  turnOrder.forEach((id, index) => { game.players[id]!.turnOrder = index; });
  game.phase = 'active';
  const simultaneous = isSimultaneousMode(game.config.mode);
  game.turn = {
    roundNumber: 1,
    // simultaneous 模式没有"当前玩家"：全员并行计划，结算顺序仍由 turnOrder 决定。
    currentPlayerId: simultaneous ? null : turnOrder[0],
    turnOrder,
    actedThisRound: [],
    phase: 'active',
    actionsUsed: 0,
    turnNumber: 1,
    currentOwner: simultaneous ? null : turnOrder[0],
  };
  game.plan = simultaneous ? { queues: {}, committed: [] } : null;
  game.artillery = artilleryStateForRound(game, 1);
  // 战斗/治疗掷骰序列的种子最后取：洗牌与起始玩家仍按原样消费注入的
  // random，调用方（如传 () => 0 的旧测试）观察到的开局行为不变。
  seedGameRandom(game, random);
}

// 旧的引擎测试仍通过该构造器创建一局双人战场。
export function createInitialGame(id: string, mapId = 'default'): GameState {
  return createInitialGameWithConfig(id, getMapConfig(mapId), mapId);
}

/** 用任意地图配置直接开一局双人战场；随机地图等运行时配置不经过全局地图表。 */
export function createInitialGameWithConfig(id: string, config: MapConfig, mapId = 'random'): GameState {
  const game = createLobbyWithConfig(id, mapId, config, { maxPlayers: 2, participate: true });
  addLobbyPlayer(game);
  const slots = config.layouts['2'].map(slotId => config.spawnSlots.find(slot => slot.id === slotId)!);
  for (const [index, owner] of (['player_a', 'player_b'] as PlayerId[]).entries()) {
    const player = game.players[owner]!;
    player.status = 'active';
    player.spawnSlotId = slots[index].id;
    player.turnOrder = index;
    const slot = slots[index];
    if (!isAnnihilationMode(config.mode)) {
      game.headquarters[owner] = createHQ(owner, config, slot);
    } else {
      const point = game.controlPoints.find(candidate => candidate.id === slot.controlPointId);
      if (point) point.owner = owner;
    }
    game.resources[owner] = { supplies: config.balance.startingSupplies };
    game.units.push(...slot.startingUnits.map(unit => createUnitFromConfig(config, owner, unit.type, unit.q, unit.r)));
  }
  game.phase = 'active';
  game.turn.phase = 'active';
  game.turn.turnOrder = ['player_a', 'player_b'];
  const simultaneous = isSimultaneousMode(config.mode);
  game.turn.currentPlayerId = simultaneous ? null : 'player_a';
  game.turn.currentOwner = simultaneous ? null : 'player_a';
  game.plan = simultaneous ? { queues: {}, committed: [] } : null;
  game.artillery = artilleryStateForRound(game, 1);
  return game;
}

function restoreActionStats(game: GameState): void {
  // simultaneous 对局的事件带每玩家独立的 actionsUsed（队列位置），需要按玩家分别累计；
  // 顺序模式沿用原有的全局计数器逻辑，保持与旧回放一致。
  const simultaneous = game.config ? isSimultaneousMode(game.config.mode) : false;
  const actionPointTotals = new Map<PlayerId, number>();
  const actionMeritTotals = new Map<PlayerId, number>();
  const unitOwners = new Map<string, PlayerId>();
  // 3.6.0 起新增：击杀入账与据点流量持有也从事件重建，保证重启/旧存档恢复后裁决分口径一致。
  const pointOwners = new Map<string, PlayerId | null>();
  const eliminated = new Set<PlayerId>();
  const killCreditByUnit = new Map<string, PlayerId>();
  const killValueTotals = new Map<PlayerId, number>();
  const controlHoldTotals = new Map<PlayerId, number>();
  const controlHoldRoundTotals = new Map<PlayerId, number>();
  let actionsUsed = 0;
  const ownerActionsUsed = new Map<PlayerId, number>();

  for (const event of game.events || []) {
    const payload = event.payload || {};
    if (event.type === 'game_start') {
      actionsUsed = 0;
      ownerActionsUsed.clear();
      pointOwners.clear();
      eliminated.clear();
      killCreditByUnit.clear();
      killValueTotals.clear();
      controlHoldTotals.clear();
      controlHoldRoundTotals.clear();
      const units = Array.isArray(payload.units) ? payload.units : [];
      for (const unit of units) {
        if (!unit || typeof unit !== 'object') continue;
        const row = unit as Record<string, unknown>;
        if (typeof row.id === 'string' && isPlayerId(row.owner)) unitOwners.set(row.id, row.owner);
      }
      const points = Array.isArray(payload.controlPoints) ? payload.controlPoints : [];
      for (const point of points) {
        if (!point || typeof point !== 'object') continue;
        const row = point as Record<string, unknown>;
        if (typeof row.id === 'string') {
          pointOwners.set(row.id, isPlayerId(row.owner) ? row.owner : null);
        }
      }
      continue;
    }
    if (simultaneous && (event.type === 'round_start' || event.type === 'round_resolved')) {
      ownerActionsUsed.clear();
      continue;
    }
    if (event.type === 'turn_end' || event.type === 'reset_actions') {
      actionsUsed = typeof payload.actionsUsed === 'number' ? payload.actionsUsed : 0;
      continue;
    }

    // 击杀入账重建：把目标打到 0 血的攻击者即凶手（与引擎"最后一击归属"同口径）；
    // 炮火（cause: 'artillery'）等环境击杀无归属。旧顺序模式事件的 unit_death 无 cause 字段，按攻击击杀处理。
    // 同时模式下单位要到死亡阶段才置 alive=false，同一轮内可能有多个攻击打出 targetHp:0（过量击杀），
    // 引擎只记第一个把血量清零的人（recordedDeaths），故此处首次入账即定，后续覆盖会让凶手漂移。
    if (event.type === 'attack' && payload.targetKind === 'unit' && payload.targetHp === 0
      && typeof payload.targetId === 'string' && isPlayerId(payload.owner)
      && !killCreditByUnit.has(payload.targetId)) {
      killCreditByUnit.set(payload.targetId, payload.owner);
    }
    if (event.type === 'unit_death' && typeof payload.unitId === 'string') {
      const killer = killCreditByUnit.get(payload.unitId);
      const unitType = typeof payload.type === 'string' ? payload.type : null;
      const cost = unitType ? (game.config?.units?.[unitType as UnitType]?.cost ?? 0) : 0;
      if (killer && payload.cause !== 'artillery' && cost > 0) {
        killValueTotals.set(killer, (killValueTotals.get(killer) ?? 0) + cost);
      }
      killCreditByUnit.delete(payload.unitId);
    }

    // 据点流量持有重建：与引擎 accumulateControlHold 同口径——每个继续进行的整轮结束时，
    // 按当时归属给未淘汰玩家累计持有数；淘汰者分数已冻结不再累计。
    if (event.type === 'control_point_captured' && typeof payload.pointId === 'string') {
      pointOwners.set(payload.pointId, isPlayerId(payload.owner) ? payload.owner : null);
    }
    if (event.type === 'control_point_neutralized' && typeof payload.pointId === 'string') {
      pointOwners.set(payload.pointId, null);
    }
    if (event.type === 'player_eliminated' && isPlayerId(payload.playerId)) {
      eliminated.add(payload.playerId);
    }
    if (event.type === 'round_end') {
      // 终局回合的 round_end 可能是「淘汰型」（结算前没有 accumulateControlHold）
      // 或「回合上限型」（先累计再写终局摘要）。旧存档没有 controlHoldCounted
      // 标记时，用 game.result 的回合上限原因兜底，避免重启后丢掉最后一轮流量。
      const turnLimitResult = game.result?.reason === 'turn_limit_score'
        || game.result?.reason === 'turn_limit_draw';
      if (payload.gameOver !== true || payload.controlHoldCounted === true || turnLimitResult) {
        for (const id of PLAYER_IDS) {
          if (!game.players[id] || eliminated.has(id)) continue;
          let held = 0;
          for (const pointOwner of pointOwners.values()) {
            if (pointOwner === id) held += 1;
          }
          controlHoldTotals.set(id, (controlHoldTotals.get(id) ?? 0) + held);
          controlHoldRoundTotals.set(id, (controlHoldRoundTotals.get(id) ?? 0) + 1);
        }
      }
      continue;
    }

    let owner = isPlayerId(payload.owner) ? payload.owner : null;
    if (event.type === 'deploy' && typeof payload.unitId === 'string' && owner) {
      unitOwners.set(payload.unitId, owner);
    }
    if (!owner) {
      const unitId = event.type === 'attack' ? payload.attackerId
        : event.type === 'heal' ? payload.supportId
          : event.type === 'action_failed' ? (payload.attackerId ?? payload.supportId ?? payload.unitId)
            : payload.unitId;
      if (typeof unitId === 'string') owner = unitOwners.get(unitId) ?? null;
    }
    if (owner) {
      const merit = actionMeritForEvent(event.type, payload, simultaneous);
      if (merit > 0) actionMeritTotals.set(owner, (actionMeritTotals.get(owner) ?? 0) + merit);
    }
    if (!['deploy', 'move', 'attack', 'heal', 'demolish', 'wait', 'action_failed'].includes(event.type)) continue;
    if (!owner || typeof payload.actionsUsed !== 'number') continue;
    if (simultaneous) {
      const last = ownerActionsUsed.get(owner) ?? 0;
      if (payload.actionsUsed > last) {
        actionPointTotals.set(owner, (actionPointTotals.get(owner) ?? 0) + payload.actionsUsed - last);
      }
      // 同时模式 3.8.0 起按行动点步序发事件，同一玩家的 actionsUsed 单调递增；
      // 用 Math.max 兜底旧回放/旧存档里的乱序事件，避免重复计入 AP。
      ownerActionsUsed.set(owner, Math.max(last, payload.actionsUsed));
      continue;
    }
    if (payload.actionsUsed > actionsUsed) {
      actionPointTotals.set(owner, (actionPointTotals.get(owner) ?? 0) + payload.actionsUsed - actionsUsed);
    }
    actionsUsed = payload.actionsUsed;
  }

  for (const id of PLAYER_IDS) {
    const stats = game.players[id]?.stats;
    if (stats) {
      stats.actionPointsUsed = actionPointTotals.get(id) ?? 0;
      stats.actionMerit = actionMeritTotals.get(id) ?? 0;
      stats.killValue = killValueTotals.get(id) ?? 0;
      stats.controlHold = controlHoldTotals.get(id) ?? 0;
      stats.controlHoldRounds = controlHoldRoundTotals.get(id) ?? 0;
    }
  }
}

function normalizeLoadedGame(game: GameState): void {
  // 旧版本持久化档案没有 plan 字段，统一补默认值。
  if (game.plan === undefined) game.plan = null;
  // 3.8.8 起大厅可编排座位：旧存档没有这两个字段，补默认（缺省 = 未编排 = 开局随机）。
  if (game.seatPlan === undefined) game.seatPlan = null;
  if (game.seatVersion === undefined) game.seatVersion = 0;
  // maxTurns 的 null 是合法的「无回合上限」；损坏或降级档案里的非法值回落有限默认，
  // 否则 `roundNumber < undefined` 恒 false，会在下一个回合边界把对局误裁定。
  const balance = game.config?.balance as { maxTurns?: unknown } | undefined;
  if (balance && balance.maxTurns !== null
    && (typeof balance.maxTurns !== 'number' || !Number.isFinite(balance.maxTurns) || balance.maxTurns < 1)) {
    logger.warn(`对局 ${game.id} 的 balance.maxTurns 非法（${String(balance.maxTurns)}），回落为有限默认 15`, { tag: 'game:persist' });
    balance.maxTurns = 15;
  }
  // 旧存档的明文 token 一次性迁移为 HMAC；原 token 仍可继续认证，无需用户重新加入。
  let migratedTokens = false;
  const migratedHost = migrateToken(game.hostToken);
  if (migratedHost && migratedHost !== game.hostToken) {
    game.hostToken = migratedHost;
    migratedTokens = true;
  }
  for (const id of PLAYER_IDS) {
    const migrated = migrateToken(game.tokens[id]);
    if (migrated && migrated !== game.tokens[id]) {
      game.tokens[id] = migrated;
      migratedTokens = true;
    }
  }
  if (migratedTokens) logger.info(`对局 ${game.id} 的凭证明文已迁移为哈希`, { tag: 'game:persist' });
  restoreActionStats(game);
}

export class GameStore {
  private games: Map<string, GameState> = new Map();
  private persistenceFileOverride: string | null | undefined;

  constructor(options: GameStoreOptions = {}) {
    if ('persistenceFile' in options) this.persistenceFileOverride = options.persistenceFile;
  }

  save(game: GameState): void {
    game.lastActivityAt = Date.now();
    this.games.set(game.id, game);
    this.writeSnapshot(game);
    this.flush();
  }
  get(id: string): GameState | undefined { return this.games.get(id); }
  list(): string[] { return [...this.games.keys()]; }
  delete(id: string): void {
    const game = this.games.get(id);
    if (!game) return;
    this.games.delete(id);
    const snapshotRemoved = this.removeSnapshot(id);
    try {
      this.flush();
    } catch (err) {
      // 导出旧格式失败时不要把内存条目丢掉；快照已删除则立即补写回去。
      this.games.set(id, game);
      if (snapshotRemoved) {
        try { this.writeSnapshot(game); } catch { /* 保留内存状态，等待下一次落盘 */ }
      }
      throw err;
    }
    if (!snapshotRemoved) {
      // 快照删除失败（Windows 文件占用/只读）不能静默成功，否则重启会复活。
      // 恢复内存并重写一份可用快照，让调用方收到失败而不是假成功。
      this.games.set(id, game);
      try { this.writeSnapshot(game); this.flush(); } catch { /* 保留内存状态 */ }
      throw new Error(`failed to remove snapshot for game ${id}`);
    }
  }
  persist(game: GameState): void {
    game.lastActivityAt = Date.now();
    this.games.set(game.id, game);
    // 每个动作只写这一局的快照，不再序列化全部对局；games.json 只作为导出/兼容格式。
    this.writeSnapshot(game);
  }

  loadFromDisk(): void {
    const file = this.persistenceFile();
    if (!file) return;
    const loaded = new Map<string, GameState>();
    const imported = new Set<string>();
    let sawValid = false;
    let sawSnapshot = false;

    // 1) 每局快照（新格式，优先）。主快照损坏/缺失时回退同目录的 .prev：
    //    写入流程先把旧文件轮转为 .prev，再原子替换主文件；若进程在两次 rename
    //    之间崩溃，主文件会暂时不存在，只有 .prev 是完整可用的。
    const dir = this.storeDir();
    if (dir && existsSync(dir)) {
      let names: string[] = [];
      try {
        names = readdirSync(dir).filter(name => name.endsWith('.json'));
      } catch (err) {
        logger.error(`无法读取状态目录 ${dir}`, err);
      }
      const loadSnapshot = (snapshotFile: string): GameState => {
        const parsed = JSON.parse(readFileSync(snapshotFile, 'utf8')) as Partial<PersistedGameSnapshot>;
        const game = parsed.game as GameState | undefined;
        if (!game || typeof game.id !== 'string') throw new Error('snapshot missing game');
        normalizeLoadedGame(game);
        return game;
      };
      const loadedPrev = new Set<string>();
      for (const name of names.sort()) {
        const snapshotFile = join(dir, name);
        try {
          const game = loadSnapshot(snapshotFile);
          if (loaded.has(game.id)) continue;
          loaded.set(game.id, game);
          sawValid = true;
          sawSnapshot = true;
        } catch (err) {
          this.archiveStateFile(snapshotFile, 'corrupt');
          logger.error(`failed to load snapshot ${snapshotFile}`, err);
          const previousFile = `${snapshotFile}.prev`;
          if (!existsSync(previousFile)) continue;
          try {
            const game = loadSnapshot(previousFile);
            loadedPrev.add(previousFile);
            if (loaded.has(game.id)) continue;
            loaded.set(game.id, game);
            sawValid = true;
            sawSnapshot = true;
            logger.warn(`主快照不可用，已从备份 ${previousFile} 恢复`, { tag: 'game:persist' });
          } catch (previousError) {
            this.archiveStateFile(previousFile, 'corrupt');
            logger.error(`failed to load snapshot backup ${previousFile}`, previousError);
          }
        }
      }
      // 主文件已完全缺失时，readdir 的 .json 列表不会包含它；单独扫描孤立的
      // .json.prev，覆盖「轮转完成后、替换主文件前崩溃」的场景。
      let orphanPrevNames: string[] = [];
      try {
        orphanPrevNames = readdirSync(dir).filter(name => name.endsWith('.json.prev'));
      } catch (err) {
        logger.error(`无法读取状态目录 ${dir}`, err);
      }
      for (const name of orphanPrevNames.sort()) {
        const previousFile = join(dir, name);
        if (loadedPrev.has(previousFile)) continue;
        const mainFile = previousFile.slice(0, -'.prev'.length);
        if (existsSync(mainFile)) continue;
        try {
          const game = loadSnapshot(previousFile);
          if (loaded.has(game.id)) continue;
          loaded.set(game.id, game);
          sawValid = true;
          sawSnapshot = true;
          logger.warn(`主快照缺失，已从备份 ${previousFile} 恢复`, { tag: 'game:persist' });
        } catch (err) {
          this.archiveStateFile(previousFile, 'corrupt');
          logger.error(`failed to load snapshot backup ${previousFile}`, err);
        }
      }
    }

    // 2) 旧版单文件：仅在没有新快照时导入，避免旧文件把已删除对局复活。
    if (!sawSnapshot) {
      for (const candidate of [file, `${file}.bak`]) {
        if (!existsSync(candidate)) continue;
        try {
          const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as Partial<PersistedGamesFile>;
          if (parsed.schemaVersion !== PERSISTENCE_SCHEMA_VERSION || !Array.isArray(parsed.games)) {
            this.archiveStateFile(candidate, `schema-${parsed.schemaVersion ?? 'unknown'}`);
            continue;
          }
          sawValid = true;
          for (const game of parsed.games) {
            if (!game || typeof game.id !== 'string' || loaded.has(game.id)) continue;
            normalizeLoadedGame(game);
            loaded.set(game.id, game);
            imported.add(game.id);
          }
          if (candidate !== file) {
            logger.warn(`主状态文件不可用，已从备份 ${candidate} 恢复`, { tag: 'game:persist' });
          }
        } catch (err) {
          this.archiveStateFile(candidate, 'corrupt');
          logger.error(`failed to load ${candidate}`, err);
        }
      }
    }

    if (!sawValid) return;
    this.games = loaded;
    // 旧格式导入的对局立刻落地为新快照，后续动作只写单局。
    for (const id of imported) {
      const game = loaded.get(id);
      if (!game) continue;
      try {
        this.writeSnapshot(game);
      } catch (err) {
        logger.error(`failed to migrate snapshot ${id}`, err);
      }
    }
    logger.info(`loaded ${this.games.size} games from snapshots/legacy state`, { tag: 'game:persist' });
  }

  private storeDir(): string | null {
    const file = this.persistenceFile();
    return file ? join(dirname(file), 'store') : null;
  }

  private snapshotPath(gameId: string): string | null {
    const file = this.persistenceFile();
    return file ? gameSnapshotPath(file, gameId) : null;
  }

  private writeSnapshot(game: GameState): void {
    const target = this.snapshotPath(game.id);
    if (!target) return;
    mkdirSync(dirname(target), { recursive: true });
    const payload: PersistedGameSnapshot = {
      schemaVersion: PERSISTENCE_SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      game,
    };
    const json = `${JSON.stringify(payload, null, 2)}\n`;
    const tmp = `${target}.tmp`;
    const fd = openSync(tmp, 'w');
    try {
      writeSync(fd, json);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    if (existsSync(target)) {
      try {
        renameSync(target, `${target}.prev`);
      } catch {
        // 快照轮转失败不阻塞主写入。
      }
    }
    renameSync(tmp, target);
  }

  private removeSnapshot(gameId: string): boolean {
    const target = this.snapshotPath(gameId);
    if (!target) return true;
    let removed = true;
    for (const path of [target, `${target}.prev`]) {
      try {
        unlinkSync(path);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          removed = false;
          logger.warn(`无法删除快照 ${path}`, { tag: 'game:persist' });
        }
      }
    }
    return removed;
  }

  /** 状态文件所在目录可写（/readyz 深检用）；未启用持久化时视为可写。 */
  isPersistenceWritable(): boolean {
    const file = this.persistenceFile();
    if (!file) return true;
    try {
      mkdirSync(dirname(file), { recursive: true });
      accessSync(dirname(file), constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  private archiveStateFile(file: string, reason: string): void {
    const archived = `${file}.${reason}-${Date.now()}.bak`;
    try {
      renameSync(file, archived);
      logger.warn(`已归档不可用状态文件 ${archived}`, { tag: 'game:persist' });
    } catch (err) {
      logger.error(`归档状态文件失败 ${file}`, err);
    }
  }

  flush(): void {
    const file = this.persistenceFile();
    if (!file) return;
    const started = Date.now();
    try {
      mkdirSync(dirname(file), { recursive: true });
      const payload: PersistedGamesFile = {
        schemaVersion: PERSISTENCE_SCHEMA_VERSION,
        savedAt: new Date().toISOString(),
        games: [...this.games.values()],
      };
      const json = `${JSON.stringify(payload, null, 2)}\n`;
      const tmp = `${file}.tmp`;
      // 先写临时文件并 fsync，再把上一份完整文件轮转为 .bak；任一步崩溃都能从
      // 主文件或 .bak 恢复。
      const fd = openSync(tmp, 'w');
      try {
        writeSync(fd, json);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      if (existsSync(file)) {
        try {
          renameSync(file, `${file}.bak`);
        } catch {
          // 备份轮转失败不阻塞主写入；主文件仍会被下面的 rename 原子替换。
        }
      }
      renameSync(tmp, file);
      inc('tactical_persist_total', { result: 'ok' });
    } catch (err) {
      inc('tactical_persist_total', { result: 'error' });
      throw err;
    } finally {
      observe('tactical_persist_duration_ms', Date.now() - started);
    }
  }

  /**
   * 归档并删除超期未活动的 lobby / 终局对局；active 对局永不自动删除。
   * 返回被删除的 id 列表；归档失败的对局保留并留给下一次重试。
   */
  pruneInactive(options: { lobbyTtlMs: number; gameOverTtlMs: number; now?: number }): string[] {
    const now = options.now ?? Date.now();
    const removed: string[] = [];
    const removedGames: GameState[] = [];
    for (const game of [...this.games.values()]) {
      const ttl = game.phase === 'lobby'
        ? options.lobbyTtlMs
        : game.phase === 'game_over'
          ? options.gameOverTtlMs
          : 0;
      if (!ttl || ttl <= 0) continue;
      const last = game.lastActivityAt ?? game.createdAt ?? 0;
      if (now - last < ttl) continue;
      if (!this.archiveGame(game)) continue;
      this.games.delete(game.id);
      removed.push(game.id);
      removedGames.push(game);
    }
    if (removed.length > 0) {
      // 先导出一致性 games.json，再删快照；flush 失败时把内存条目放回去，
      // 避免一次磁盘故障让对局从服务内存中消失（调用方会重试下一轮）。
      try {
        this.flush();
      } catch (err) {
        for (const game of removedGames) this.games.set(game.id, game);
        throw err;
      }
      const failed = removed.filter(id => !this.removeSnapshot(id));
      if (failed.length > 0) {
        // 快照删不掉就不算真正删除：恢复内存并重写快照，调用方下一轮再试。
        for (const id of failed) {
          const game = removedGames.find(candidate => candidate.id === id);
          if (!game) continue;
          this.games.set(id, game);
          try { this.writeSnapshot(game); } catch { /* 保留内存状态 */ }
        }
        try { this.flush(); } catch (err) { logger.error('恢复未删除对局的 games.json 失败', err); }
        return removed.filter(id => !failed.includes(id));
      }
    }
    return removed;
  }

  private archiveGame(game: GameState): boolean {
    const file = this.persistenceFile();
    if (!file) return false;
    const dir = join(dirname(file), 'archive');
    const safeId = game.id.replace(/[^\w.-]/g, '_');
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${safeId}.json`), `${JSON.stringify({
        archivedAt: new Date().toISOString(),
        game,
      }, null, 2)}\n`);
      return true;
    } catch (err) {
      logger.error(`归档对局失败 ${game.id}`, err);
      return false;
    }
  }

  private persistenceFile(): string | null {
    if (this.persistenceFileOverride !== undefined) return this.persistenceFileOverride;
    return defaultPersistenceFile();
  }
}

export const globalStore = new GameStore();
