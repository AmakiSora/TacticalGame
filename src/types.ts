// src/types.ts
import type { MapConfig } from './config/loader.js';

export type PlayerId = 'player_a' | 'player_b';

export type UnitType = 'infantry' | 'sniper' | 'tank' | 'medic';

export type BuildingType = 'headquarters' | 'barracks' | 'miner' | 'bunker';

export type GamePhase = 'waiting_for_player' | 'waiting_command' | 'executing' | 'game_over';

export type TerrainType = 0 | 1 | 2; // 0=empty, 1=wall, 2=water

export interface Position {
  x: number;
  y: number;
}

export interface Resources {
  gold: number;
}

export interface Unit {
  id: string;
  owner: PlayerId;
  type: UnitType;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  moveRange: number;
  attackRange: number;
  alive: boolean;
  hasMoved: boolean;
  hasAttacked: boolean;
}

export interface ProductionItem {
  type: UnitType;
  turnsRemaining: number;
}

export interface Building {
  id: string;
  owner: PlayerId;
  type: BuildingType;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  buildProgress: number;
  isBuilding: boolean;
  production: ProductionItem | null;
  attack?: number;
  defense?: number;
  attackRange?: number;
  attacksLeft?: number;
}

export interface TurnState {
  turnNumber: number;
  currentOwner: PlayerId;
  phase: GamePhase;
}

export type EventType =
  | 'game_start'
  | 'move'
  | 'attack'
  | 'heal'
  | 'unit_death'
  | 'build'
  | 'build_tick'
  | 'build_complete'
  | 'produce'
  | 'produce_complete'
  | 'mine'
  | 'base_income'
  | 'reset_actions'
  | 'base_destroyed'
  | 'turn_end'
  | 'game_over'
  | 'sell'
  | 'name_rename';

export interface GameEvent {
  seq: number;
  type: EventType;
  timestamp: number;
  payload: Record<string, unknown>;
}

export interface GameState {
  id: string;
  mapId: string;
  config: MapConfig;
  phase: GamePhase;
  mapWidth: number;
  mapHeight: number;
  miningPoints: Position[];
  terrain: number[][];
  buildings: Building[];
  units: Unit[];
  resources: Record<PlayerId, Resources>;
  tokens: Record<PlayerId, string>;
  playerNames: Record<PlayerId, string>;
  turn: TurnState;
  events: GameEvent[];
  winner: PlayerId | null;
}

export interface ApiError {
  error: string;
  code: ApiErrorCode;
}

export type ApiErrorCode =
  | 'not_your_turn'
  | 'insufficient_gold'
  | 'out_of_build_range'
  | 'cell_occupied'
  | 'not_mining_point'
  | 'building_not_ready'
  | 'cannot_produce'
  | 'unit_not_found'
  | 'building_not_found'
  | 'target_not_found'
  | 'invalid_move'
  | 'invalid_attack'
  | 'invalid_heal'
  | 'invalid_token'
  | 'game_not_found'
  | 'game_already_full'
  | 'game_not_started'
  | 'game_over';
