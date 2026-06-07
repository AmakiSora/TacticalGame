// src/state/store.ts
import { randomBytes, randomUUID } from 'node:crypto';
import type { GameState, Building, PlayerId } from '../types.js';
import { getMapConfig } from '../config/loader.js';
import type { MapConfig } from '../config/loader.js';

function generateToken(): string {
  return randomBytes(16).toString('hex');
}

function createHQ(owner: PlayerId, config: MapConfig): Building {
  const pos = config.map.headquartersPositions[owner];
  const spec = config.buildings['headquarters'];
  return {
    id: randomUUID(),
    owner,
    type: 'headquarters',
    x: pos.x,
    y: pos.y,
    hp: spec.hp,
    maxHp: spec.hp,
    alive: true,
    buildProgress: 0,
    isBuilding: false,
    production: null,
  };
}

export function createInitialGame(id: string, mapId?: string): GameState {
  const resolvedMapId = mapId || 'default';
  const config = getMapConfig(resolvedMapId);
  return {
    id,
    mapId: resolvedMapId,
    config,
    phase: 'waiting_for_player',
    mapWidth: config.map.width,
    mapHeight: config.map.height,
    miningPoints: config.map.miningPoints.map(p => ({ ...p })),
    terrain: config.map.terrain.map(row => [...row]),
    buildings: [createHQ('player_a', config), createHQ('player_b', config)],
    units: [],
    resources: {
      player_a: { gold: config.economy.startingGold },
      player_b: { gold: config.economy.startingGold },
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
