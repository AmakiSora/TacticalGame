// src/types.ts
import type { MapConfig } from './config/loader.js';

export type PlayerId = 'player_a' | 'player_b';

export type UnitType = 'infantry' | 'scout' | 'heavy' | 'ranger' | 'support';

export type GamePhase = 'waiting_for_player' | 'waiting_command' | 'game_over';

export type TerrainType = 'plain' | 'water' | 'blocker';

export interface Position {
  q: number;
  r: number;
}

export interface Resources {
  supplies: number;
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
  | 'deploy'
  | 'control_point_captured'
  | 'income'
  | 'reset_actions'
  | 'turn_end'
  | 'headquarters_destroyed'
  | 'game_over'
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
  map: HexMapState;
  cells: MapCell[];
  controlPoints: ControlPoint[];
  headquarters: Record<PlayerId, Headquarters>;
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
  | 'game_not_found'
  | 'game_already_full'
  | 'game_not_started'
  | 'game_over';
