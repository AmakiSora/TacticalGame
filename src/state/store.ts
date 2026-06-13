// src/state/store.ts
import { randomBytes, randomUUID } from 'node:crypto';
import type { GameState, Headquarters, MapCell, PlayerId, Unit, UnitType } from '../types.js';
import { getMapConfig } from '../config/loader.js';
import type { MapConfig, UnitSpec } from '../config/loader.js';
import { isValidHex } from '../engine/hex.js';

function generateToken(): string {
  return randomBytes(16).toString('hex');
}

function createUnit(owner: PlayerId, type: UnitType, q: number, r: number, spec: UnitSpec): Unit {
  return {
    id: randomUUID(),
    owner,
    type,
    q,
    r,
    hp: spec.hp,
    maxHp: spec.hp,
    attack: spec.attack,
    defense: spec.defense,
    moveRange: spec.moveRange,
    attackRange: spec.attackRange,
    cost: spec.cost,
    alive: true,
    hasMoved: false,
    hasActed: false,
    canCapture: spec.canCapture,
    healPower: spec.healPower,
  };
}

export function createUnitFromConfig(config: MapConfig, owner: PlayerId, type: UnitType, q: number, r: number): Unit {
  return createUnit(owner, type, q, r, config.units[type]);
}

function createHQ(owner: PlayerId, config: MapConfig): Headquarters {
  const pos = config.headquarters[owner];
  return {
    id: randomUUID(),
    owner,
    q: pos.q,
    r: pos.r,
    hp: config.headquartersSpec.hp,
    maxHp: config.headquartersSpec.hp,
    defense: config.headquartersSpec.defense,
    alive: true,
  };
}

function createCells(config: MapConfig): MapCell[] {
  const terrain = new Map(config.terrainCells.map(c => [`${c.q},${c.r}`, c.terrain]));
  const cells: MapCell[] = [];
  const radius = config.radius;
  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      if (!isValidHex({ q, r }, radius)) continue;
      cells.push({ q, r, terrain: terrain.get(`${q},${r}`) ?? 'plain' });
    }
  }
  return cells;
}

export function createInitialGame(id: string, mapId?: string): GameState {
  const resolvedMapId = mapId || 'default';
  const config = getMapConfig(resolvedMapId);
  return {
    id,
    mapId: resolvedMapId,
    config,
    phase: 'waiting_for_player',
    map: {
      grid: 'hex',
      orientation: 'pointy',
      radius: config.radius,
      terrainCells: config.terrainCells.map(c => ({ ...c })),
    },
    cells: createCells(config),
    controlPoints: config.controlPoints.map(p => ({ ...p, owner: null })),
    headquarters: {
      player_a: createHQ('player_a', config),
      player_b: createHQ('player_b', config),
    },
    units: config.startingUnits.map(u => createUnitFromConfig(config, u.owner, u.type, u.q, u.r)),
    resources: {
      player_a: { supplies: config.balance.startingSupplies },
      player_b: { supplies: config.balance.startingSupplies },
    },
    tokens: {
      player_a: generateToken(),
      player_b: '',
    },
    playerNames: {
      player_a: '',
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
