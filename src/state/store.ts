// src/state/store.ts
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  GameState, Headquarters, MapCell, PlayerId, PlayerState, Unit, UnitType,
} from '../types.js';
import { PLAYER_IDS } from '../types.js';
import { getMapConfig } from '../config/loader.js';
import type { MapConfig, SpawnSlotConfig, UnitSpec } from '../config/loader.js';
import { isValidHex } from '../engine/hex.js';

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

export function generateToken(): string {
  return randomBytes(16).toString('hex');
}

export function createPlayer(id: PlayerId, name?: string): PlayerState {
  return {
    id,
    name: name?.trim().slice(0, 20) || `玩家 ${id.slice(-1).toUpperCase()}`,
    joinedAt: Date.now(),
    status: 'lobby',
    spawnSlotId: null,
    turnOrder: null,
    eliminatedAt: null,
    eliminatedBy: null,
    stats: { headquartersDamage: 0, unitsDestroyed: 0, playersEliminated: 0 },
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
  const terrain = new Map(config.terrainCells.map(c => [`${c.q},${c.r}`, c.terrain]));
  const cells: MapCell[] = [];
  for (let q = -config.radius; q <= config.radius; q++) {
    for (let r = -config.radius; r <= config.radius; r++) {
      if (!isValidHex({ q, r }, config.radius)) continue;
      cells.push({ q, r, terrain: terrain.get(`${q},${r}`) ?? 'plain' });
    }
  }
  return cells;
}

export function createLobby(id: string, mapId = 'default', options: CreateLobbyOptions): GameState {
  const config = getMapConfig(mapId);
  const maxPlayers = Math.max(2, Math.min(8, Math.trunc(options.maxPlayers)));
  const game: GameState = {
    id, mapId, config, phase: 'lobby', maxPlayers, hostToken: generateToken(),
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
    events: [], winner: null, result: null,
  };
  if (options.participate !== false) addLobbyPlayer(game, options.playerName);
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
  game.tokens[id] = token;
  game.playerNames[id] = player.name;
  return { id, token };
}

export function removeLobbyPlayer(game: GameState, playerId: PlayerId): boolean {
  if (game.phase !== 'lobby' || !game.players[playerId]) return false;
  delete game.players[playerId];
  delete game.tokens[playerId];
  delete game.playerNames[playerId];
  return true;
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
  if (!layoutIds) throw new Error('unsupported player count');
  const slots = layoutIds.map(id => game.config.spawnSlots.find(slot => slot.id === id)!);
  const assignedPlayers = shuffle(playerIds, random);

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
    game.headquarters[owner] = createHQ(owner, game.config, slot);
    game.resources[owner] = { supplies: game.config.balance.startingSupplies };
    game.units.push(...slot.startingUnits.map(unit =>
      createUnitFromConfig(game.config, owner, unit.type, unit.q, unit.r)));
  }

  const startIndex = Math.floor(random() * assignedPlayers.length);
  const turnOrder = [...assignedPlayers.slice(startIndex), ...assignedPlayers.slice(0, startIndex)];
  turnOrder.forEach((id, index) => { game.players[id]!.turnOrder = index; });
  game.phase = 'active';
  game.turn = {
    roundNumber: 1,
    currentPlayerId: turnOrder[0],
    turnOrder,
    actedThisRound: [],
    phase: 'active',
    actionsUsed: 0,
    turnNumber: 1,
    currentOwner: turnOrder[0],
  };
}

// 旧的引擎测试仍通过该构造器创建一局双人战场。
export function createInitialGame(id: string, mapId = 'default'): GameState {
  const game = createLobby(id, mapId, { maxPlayers: 2, participate: true });
  addLobbyPlayer(game);
  const config = game.config;
  const slots = config.layouts['2'].map(slotId => config.spawnSlots.find(slot => slot.id === slotId)!);
  for (const [index, owner] of (['player_a', 'player_b'] as PlayerId[]).entries()) {
    const player = game.players[owner]!;
    player.status = 'active';
    player.spawnSlotId = slots[index].id;
    player.turnOrder = index;
    const slot = slots[index];
    game.headquarters[owner] = createHQ(owner, config, slot);
    game.resources[owner] = { supplies: config.balance.startingSupplies };
    game.units.push(...slot.startingUnits.map(unit => createUnitFromConfig(config, owner, unit.type, unit.q, unit.r)));
  }
  game.phase = 'active';
  game.turn.phase = 'active';
  game.turn.turnOrder = ['player_a', 'player_b'];
  game.turn.currentPlayerId = 'player_a';
  game.turn.currentOwner = 'player_a';
  return game;
}

export class GameStore {
  private games: Map<string, GameState> = new Map();
  private persistenceFileOverride: string | null | undefined;

  constructor(options: GameStoreOptions = {}) {
    if ('persistenceFile' in options) this.persistenceFileOverride = options.persistenceFile;
  }

  save(game: GameState): void { this.games.set(game.id, game); this.flush(); }
  get(id: string): GameState | undefined { return this.games.get(id); }
  list(): string[] { return [...this.games.keys()]; }
  delete(id: string): void { this.games.delete(id); this.flush(); }
  persist(game: GameState): void { this.games.set(game.id, game); this.flush(); }

  loadFromDisk(): void {
    const file = this.persistenceFile();
    if (!file) return;
    if (!existsSync(file)) { this.games.clear(); return; }
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<PersistedGamesFile>;
      if (parsed.schemaVersion !== PERSISTENCE_SCHEMA_VERSION || !Array.isArray(parsed.games)) {
        const archived = `${file}.schema-${parsed.schemaVersion ?? 'unknown'}-${Date.now()}.bak`;
        renameSync(file, archived);
        console.warn(`[game:persist] 已归档不兼容状态文件 ${archived}`);
        this.games.clear();
        return;
      }
      this.games.clear();
      for (const game of parsed.games) if (game && typeof game.id === 'string') this.games.set(game.id, game);
      console.log(`[game:persist] loaded ${this.games.size} games from ${file}`);
    } catch (err) {
      this.games.clear();
      console.error(`[game:persist] failed to load ${file}:`, err);
    }
  }

  flush(): void {
    const file = this.persistenceFile();
    if (!file) return;
    mkdirSync(dirname(file), { recursive: true });
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
