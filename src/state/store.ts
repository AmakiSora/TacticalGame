// src/state/store.ts
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GameState, Headquarters, MapCell, PlayerId, Unit, UnitType } from '../types.js';
import { getMapConfig } from '../config/loader.js';
import type { MapConfig, UnitSpec } from '../config/loader.js';
import { isValidHex } from '../engine/hex.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');
const PERSISTENCE_SCHEMA_VERSION = 1;

interface GameStoreOptions {
  persistenceFile?: string | null;
}

interface PersistedGamesFile {
  schemaVersion: number;
  savedAt: string;
  games: GameState[];
}

function defaultPersistenceFile(): string | null {
  if (process.env.TACTICAL_GAME_STATE_FILE) return process.env.TACTICAL_GAME_STATE_FILE;
  if (process.env.VITEST) return null;
  return join(PROJECT_ROOT, 'runtime', 'games.json');
}

export function generateToken(): string {
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
    actionSpent: false,
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
    turn: { turnNumber: 1, currentOwner: 'player_a', phase: 'waiting_for_player', actionsUsed: 0 },
    events: [],
    winner: null,
    result: null,
  };
}

export class GameStore {
  private games: Map<string, GameState> = new Map();
  private persistenceFileOverride: string | null | undefined;

  constructor(options: GameStoreOptions = {}) {
    if ('persistenceFile' in options) this.persistenceFileOverride = options.persistenceFile;
  }

  save(game: GameState): void {
    this.games.set(game.id, game);
    this.flush();
  }

  get(id: string): GameState | undefined {
    return this.games.get(id);
  }

  list(): string[] {
    return [...this.games.keys()];
  }

  delete(id: string): void {
    this.games.delete(id);
    this.flush();
  }

  persist(game: GameState): void {
    this.games.set(game.id, game);
    this.flush();
  }

  loadFromDisk(): void {
    const file = this.persistenceFile();
    if (!file) return;
    if (!existsSync(file)) {
      this.games.clear();
      return;
    }

    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<PersistedGamesFile>;
      if (parsed.schemaVersion !== PERSISTENCE_SCHEMA_VERSION || !Array.isArray(parsed.games)) {
        throw new Error('invalid persisted games file');
      }
      this.games.clear();
      for (const game of parsed.games) {
        if (game && typeof game.id === 'string') this.games.set(game.id, game);
      }
      console.log(`[game:persist] loaded ${this.games.size} games from ${file}`);
    } catch (err) {
      this.games.clear();
      console.error(`[game:persist] failed to load ${file}:`, err);
    }
  }

  flush(): void {
    const file = this.persistenceFile();
    if (!file) return;
    const dir = dirname(file);
    mkdirSync(dir, { recursive: true });
    const payload: PersistedGamesFile = {
      schemaVersion: PERSISTENCE_SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      games: [...this.games.values()],
    };
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`);
    renameSync(tmp, file);
  }

  private persistenceFile(): string | null {
    if (this.persistenceFileOverride !== undefined) return this.persistenceFileOverride;
    return defaultPersistenceFile();
  }
}

export const globalStore = new GameStore();
