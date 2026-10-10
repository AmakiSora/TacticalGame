// src/types.ts
import type { MapConfig } from './config/loader.js';

export const PLAYER_IDS = [
  'player_a', 'player_b', 'player_c', 'player_d',
  'player_e', 'player_f', 'player_g', 'player_h',
] as const;

export type PlayerId = typeof PLAYER_IDS[number];
export type PlayerRecord<T> = Partial<Record<PlayerId, T>>;

/** 玩家名称最大长度；后端入口与前端输入框（public/*.html 的 maxlength）统一使用。 */
export const MAX_PLAYER_NAME_LEN = 50;

export function isPlayerId(value: unknown): value is PlayerId {
  return typeof value === 'string' && (PLAYER_IDS as readonly string[]).includes(value);
}

export type UnitType = 'infantry' | 'scout' | 'heavy' | 'ranger' | 'support';
export type GameMode = 'standard' | 'annihilation' | 'simultaneous' | 'royale';

/** 回合机制轴：这些模式下全员并行计划、统一同时结算（plan 队列语义）。 */
export function isSimultaneousMode(mode: GameMode): boolean {
  return mode === 'simultaneous' || mode === 'royale';
}

/** 歼灭规则轴：这些模式下无总部、出生绑据点、炮火缩圈、打光即淘汰。 */
export function isAnnihilationMode(mode: GameMode): boolean {
  return mode === 'annihilation' || mode === 'royale';
}
export type GamePhase = 'lobby' | 'active' | 'game_over';
export type PlayerStatus = 'lobby' | 'active' | 'eliminated';
export type GameOverReason =
  | 'last_player_standing'
  | 'turn_limit_score'
  | 'turn_limit_draw'
  | 'mutual_annihilation'
  | 'forced_adjudication_score'
  | 'forced_adjudication_draw';
export type EliminationReason = 'headquarters_destroyed' | 'army_destroyed' | 'artillery_destroyed' | 'host_eliminated';
export type TerrainType = 'plain' | 'water' | 'blocker';
export type ControlPointKind = 'supply' | 'forward_base' | 'repair';

export interface Position {
  q: number;
  r: number;
}

export interface Resources {
  supplies: number;
}

export interface PlayerStats {
  headquartersDamage: number;
  unitsDestroyed: number;
  playersEliminated: number;
  actionPointsUsed: number;
  /** @deprecated 3.6.0 起行动功绩不再产生也不再计分，仅为兼容旧回放/旧存档保留。 */
  actionMerit: number;
  /** 累计击杀敌军单位的造价（按最后一击归属；炮火/环境击杀无归属）。 */
  killValue: number;
  /** 每个整轮结束时持有据点数的累计（流量口径）。 */
  controlHold: number;
  /** controlHold 已累计的整轮数。 */
  controlHoldRounds: number;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  joinedAt: number;
  status: PlayerStatus;
  spawnSlotId: string | null;
  turnOrder: number | null;
  eliminatedAt: number | null;
  eliminatedBy: PlayerId | null;
  stats: PlayerStats;
  /** Final score captured before this player's army is removed. */
  adjudicationScore?: AdjudicationScore;
}

export interface Unit {
  id: string;
  owner: PlayerId;
  type: UnitType;
  q: number;
  r: number;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  moveRange: number;
  attackRange: number;
  cost: number;
  alive: boolean;
  hasMoved: boolean;
  hasActed: boolean;
  actionSpent: boolean;
  canCapture: boolean;
  healPower?: number;
}

export interface Headquarters {
  id: string;
  owner: PlayerId;
  q: number;
  r: number;
  hp: number;
  maxHp: number;
  defense: number;
  alive: boolean;
}

export interface ControlPoint {
  id: string;
  name: string;
  kind?: ControlPointKind;
  q: number;
  r: number;
  owner: PlayerId | null;
}

export interface MapCell extends Position {
  terrain: TerrainType;
}

export interface ArtilleryState {
  safeRadius: number;
  dangerCells: Position[];
  warningCells: Position[];
  nextShrinkRound: number | null;
}

export interface HexMapState {
  grid: 'hex';
  orientation: 'pointy';
  radius: number;
  terrainCells: MapCell[];
}

export interface TurnState {
  roundNumber: number;
  currentPlayerId: PlayerId | null;
  turnOrder: PlayerId[];
  actedThisRound: PlayerId[];
  phase: GamePhase;
  actionsUsed: number;
  // 旧页面和旧回放仍读取这两个字段，运行时始终与新字段同步。
  turnNumber: number;
  currentOwner: PlayerId | null;
}

/** simultaneous 模式下玩家在计划阶段提交的待结算动作。 */
export interface PendingAction {
  id: string;
  type: 'deploy' | 'move' | 'attack' | 'heal' | 'demolish';
  /** deploy */
  unitType?: UnitType;
  fromId?: string;
  /** move / demolish */
  unitId?: string;
  /** attack */
  attackerId?: string;
  /** heal */
  supportId?: string;
  /** deploy / move / attack / heal / demolish 的目标格 */
  q?: number;
  r?: number;
  /** attack / heal 的覆盖形状方向（0-5，正六方向；single 形状为 0） */
  direction?: number;
}

/** simultaneous 模式的计划阶段状态；其他模式恒为 null。 */
export interface PlanState {
  queues: PlayerRecord<PendingAction[]>;
  committed: PlayerId[];
}

export type EventType =
  | 'player_joined'
  | 'player_left'
  | 'game_start'
  | 'move'
  | 'attack'
  | 'heal'
  | 'unit_death'
  | 'deploy'
  | 'demolish'
  | 'control_point_captured'
  | 'control_point_neutralized'
  | 'control_point_repair'
  | 'income'
  | 'comeback_supply'
  | 'artillery_warning'
  | 'artillery_shrunk'
  | 'artillery_damage'
  | 'reset_actions'
  | 'turn_skipped'
  | 'turn_end'
  | 'round_end'
  | 'round_start'
  | 'round_resolved'
  | 'plan_committed'
  | 'action_failed'
  | 'headquarters_destroyed'
  | 'player_eliminated'
  | 'game_over'
  | 'name_rename';

export interface GameEvent {
  seq: number;
  type: EventType;
  timestamp: number;
  payload: Record<string, unknown>;
}

export interface AdjudicationScore {
  headquartersDamage: number;
  ownHqHp: number;
  /** 期末当前持有据点数（存量口径）。 */
  controlPoints: number;
  /** 每整轮平均持有据点数（流量口径，= stats.controlHold / controlHoldRounds）。 */
  controlHold: number;
  armyValue: number;
  supplies: number;
  /** 累计击杀敌军单位的造价。 */
  killValue: number;
  total: number;
}

export interface GameRanking {
  playerId: PlayerId;
  rank: number;
  status: PlayerStatus;
  score: AdjudicationScore;
}

export interface GameResult {
  winner: PlayerId | null;
  reason: GameOverReason;
  scores: PlayerRecord<AdjudicationScore>;
  rankings: GameRanking[];
}

export interface AdjudicationWeights {
  enemyHqDamage: number;
  ownHqHp: number;
  controlPoint: number;
  armyValue: number;
  supplies: number;
  /** 每点击杀造价的分数；缺省 0（不计击杀分）。 */
  killValue?: number;
  /**
   * 据点分中"流量"（每轮平均持有）的占比，0..1，缺省 0.7；
   * 其余 (1 - ratio) 按期末当前持有计。
   */
  controlPointFlowRatio?: number;
  /** @deprecated 3.6.0 起不再参与计分（行动功绩已移除），仅为兼容旧地图配置保留。 */
  effectiveActions?: number;
  /** @deprecated effectiveActions 的旧别名，同样不再参与计分。 */
  actionPoints?: number;
}

/** Live adjudication snapshot attached to GET /api/games/:id responses. */
export interface AdjudicationSnapshot {
  /** null = 无回合上限，永不按回合裁定。 */
  maxTurns: number | null;
  weights: AdjudicationWeights;
  scores: PlayerRecord<AdjudicationScore>;
  rankings: GameRanking[];
  /** Highest-scoring living players; falls back to all joined seats in lobby. */
  leaders: PlayerId[];
  /** Score gap from rank-1 total to rank-2 total among the same contender pool. */
  margin: number;
}

export interface GameState {
  id: string;
  mapId: string;
  config: MapConfig;
  phase: GamePhase;
  maxPlayers: number;
  hostToken: string;
  players: PlayerRecord<PlayerState>;
  map: HexMapState;
  cells: MapCell[];
  controlPoints: ControlPoint[];
  headquarters: PlayerRecord<Headquarters>;
  units: Unit[];
  resources: PlayerRecord<Resources>;
  tokens: PlayerRecord<string>;
  playerNames: PlayerRecord<string>;
  turn: TurnState;
  plan: PlanState | null;
  events: GameEvent[];
  winner: PlayerId | null;
  result: GameResult | null;
  artillery: ArtilleryState | null;
  /**
   * 战斗伤害/治疗掷骰的 mulberry32 状态（32 位无符号整数，随每次掷骰步进）。
   * 可 JSON 序列化，重启恢复后掷骰序列延续；对客户端响应必须剥离，
   * 否则玩家可预测后续掷骰。startGame 时由注入的 random 播种；
   * 未走 startGame 的旧构造路径按固定种子惰性初始化（见 engine/random.ts）。
   */
  rngState?: number;
}

export interface ApiError {
  error: string;
  code: ApiErrorCode;
}

export type ApiErrorCode =
  | 'not_your_turn'
  | 'insufficient_supplies'
  | 'out_of_deploy_range'
  | 'cell_occupied'
  | 'invalid_terrain'
  | 'unit_not_found'
  | 'headquarters_not_found'
  | 'target_not_found'
  | 'invalid_move'
  | 'invalid_attack'
  | 'invalid_heal'
  | 'invalid_deploy'
  | 'invalid_token'
  | 'invalid_host_token'
  | 'game_not_found'
  | 'game_already_full'
  | 'game_already_started'
  | 'game_not_started'
  | 'game_over'
  | 'player_eliminated'
  | 'lobby_not_ready'
  | 'unsupported_player_count'
  | 'action_limit_reached'
  | 'invalid_demolish'
  | 'not_simultaneous_game'
  | 'already_committed'
  | 'bot_not_supported'
  | 'model_not_found';
