// src/state/store.ts
import { randomBytes, randomUUID } from 'node:crypto';
import type { GameState, Building, PlayerId } from '../types.js';
import {
  BUILDING_SPECS, HQ_POSITIONS, MINING_POINTS,
  MAP_WIDTH, MAP_HEIGHT, STARTING_GOLD,
} from '../engine/specs.js';

function generateToken(): string {
  return randomBytes(16).toString('hex');
}

function createHQ(owner: PlayerId): Building {
  const pos = HQ_POSITIONS[owner];
  return {
    id: randomUUID(),
    owner,
    type: 'headquarters',
    x: pos.x,
    y: pos.y,
    hp: BUILDING_SPECS.headquarters.hp,
    maxHp: BUILDING_SPECS.headquarters.hp,
    alive: true,
    buildProgress: 0,
    isBuilding: false,
    production: null,
  };
}

export function createInitialGame(id: string): GameState {
  return {
    id,
    phase: 'waiting_for_player',
    mapWidth: MAP_WIDTH,
    mapHeight: MAP_HEIGHT,
    miningPoints: MINING_POINTS.map(p => ({ ...p })),
    buildings: [createHQ('player_a'), createHQ('player_b')],
    units: [],
    resources: {
      player_a: { gold: STARTING_GOLD },
      player_b: { gold: STARTING_GOLD },
    },
    tokens: {
      player_a: generateToken(),
      player_b: '',
    },
    turn: { turnNumber: 1, currentOwner: 'player_a', phase: 'waiting_for_player' },
    events: [],
    winner: null,
  };
}

export class GameStore {
  private games: Map<string, GameState> = new Map();

  save(game: GameState): void {
    this.games.set(game.id, game);
  }

  get(id: string): GameState | undefined {
    return this.games.get(id);
  }

  list(): string[] {
    return [...this.games.keys()];
  }

  delete(id: string): void {
    this.games.delete(id);
  }
}

export const globalStore = new GameStore();
