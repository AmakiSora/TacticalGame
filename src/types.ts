// src/types.ts
import type { MapConfig } from './config/loader.js';

export const PLAYER_IDS = [
  'player_a', 'player_b', 'player_c', 'player_d',
  'player_e', 'player_f', 'player_g', 'player_h',
] as const;

export type PlayerId = typeof PLAYER_IDS[number];
export type PlayerRecord<T> = Partial<Record<PlayerId, T>>;

export function isPlayerId(value: unknown): value is PlayerId {
  return typeof value === 'string' && (PLAYER_IDS as readonly string[]).includes(value);
}

export type UnitType = 'infantry' | 'scout' | 'heavy' | 'ranger' | 'support';
export type GamePhase = 'lobby' | 'active' | 'game_over';
export type PlayerStatus = 'lobby' | 'active' | 'eliminated';
export type GameOverReason = 'last_player_standing' | 'turn_limit_score' | 'turn_limit_draw';
export type EliminationReason = 'headquarters_destroyed' | 'host_eliminated';
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
  | 'reset_actions'
  | 'turn_skipped'
  | 'turn_end'
  | 'round_end'
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
  controlPoints: number;
  armyValue: number;
  supplies: number;
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
  events: GameEvent[];
  winner: PlayerId | null;
  result: GameResult | null;
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
  | 'invalid_demolish';
