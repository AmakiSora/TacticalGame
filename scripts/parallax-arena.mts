#!/usr/bin/env -S npx tsx
// Independent standard-mode black-box evaluator. No GameStore.save or official arena writes.
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { loadMaps, getMapConfig, listMaps, validateGeneratedMap } from '../src/config/loader.js';
import type { MapConfig } from '../src/config/loader.js';
import { generateRandomMapConfig, RANDOM_MAP_GENERATOR_VERSION } from '../src/config/randomMap.js';
import type { RandomMapOptions, RandomParamValues } from '../src/config/randomMap.js';
import { createLobbyWithConfig, addLobbyPlayer } from '../src/state/store.js';
import { startGame, endTurn, forceAdjudication, buildAdjudicationScores } from '../src/engine/engine.js';
import { moveUnit } from '../src/engine/units.js';
import { attackTarget, healTarget } from '../src/engine/combat.js';
import { deployUnit } from '../src/engine/deployment.js';
import { demolishTerrain } from '../src/engine/demolition.js';
import { sanitizeGameForResponse } from '../src/api/auth.js';
import { EventBus } from '../src/events/bus.js';
import { PLAYER_IDS } from '../src/types.js';
import type { GameState, PlayerId, Position, SeatPlan, UnitType } from '../src/types.js';
// @ts-ignore -- Untyped plugin boundary; only registry interfaces are used.
import { listAlgorithms, algorithmSupportsMode, algorithmVersion, loadAlgorithm } from '../algorithms/registry.mjs';
// @ts-ignore -- Passed through to black-box opponents without inspecting implementations.
import * as utils from '../algorithms/lib/game-utils.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMP = join(ROOT, 'temp');
const PARALLAX = 'parallax';
const TIMEOUT_MS = 120_000;
const PUBLIC_EPOCH = 1_700_000_000_000;
const HELP = `Usage: npx tsx scripts/parallax-arena.mts [options]
  --opponents LIST       Comma-separated registry names (default: all standard except parallax)
  --maps LIST            Comma-separated static standard map IDs; may include random
                         Default: all static standard maps supporting --players
  --games N              Even games per map/opponent (default: 2); adjacent games form a pair
  --players N            2, 3, 6 or 8 (default: 2); explicit unsupported maps are errors
  --seed-base N          Unsigned 32-bit base seed (default: 1)
  --max-rounds N         Cap ONLY unlimited maps after N complete rounds (default: 80)
  --random-preset NAME   standard / challenge, or 标准 / 挑战 (default: standard)
  --out PATH            JSON strictly beneath project temp/ (default: temp/parallax-arena/results.json)
  --help                 Show this help without loading algorithm implementations

One parallax vs N-1 independent copies of each opponent (free-for-all, not teams).
A pair shares the entire map, engine RNG seed, seatPlan and firstSeat; only two
algorithm assignments are exchanged. Pair index rotates tested seats. Seats are zero-based.
Challenge random maps vary size, terrain, unit stats, economy and two cropped outlines.
Capped adjudications are reported separately, NEVER as normal wins/losses/draws.
Illegal actions, exceptions, action guards or unfinished games cause exit code 1.
Decisions have a 120s watchdog. Each seat has a fresh worker and seeded Math.random;
public UUIDs/timestamps are canonicalized. Wall-time-budgeted algorithms may still vary.
Decision timing excludes state projection, worker startup and message transport.
A JSON checkpoint is written after every game; no official arena/store data is touched.
`;

export interface Options {
  opponents?: string[];
  maps?: string[];
  games: number;
  players: number;
  seedBase: number;
  maxRounds: number;
  randomPreset: 'standard' | 'challenge';
  out: string;
}

export function parseArgs(args: string[]): Options {
  const options: Options = {
    games: 2, players: 2, seedBase: 1, maxRounds: 80,
    randomPreset: 'standard', out: join(TEMP, 'parallax-arena', 'results.json'),
  };
  const seen = new Set<string>();
  const integer = (text: string, min: number, max = Number.MAX_SAFE_INTEGER): number => {
    if (!/^\d+$/.test(text)) throw new Error(`Expected an integer, got ${text}`);
    const n = Number(text);
    if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`Integer out of range: ${text}`);
    return n;
  };
  const list = (text: string): string[] => {
    const values = text.split(',').map(value => value.trim());
    if (values.some(value => !value) || new Set(values).size !== values.length) {
      throw new Error('Lists must contain nonempty, distinct names');
    }
    return values;
  };
  for (let i = 0; i < args.length; i++) {
    const [flag, ...inline] = args[i]!.split('=');
    if (seen.has(flag!)) throw new Error(`Duplicate option: ${flag}`);
    seen.add(flag!);
    const value = inline.length ? inline.join('=') : args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    switch (flag) {
      case '--opponents': options.opponents = list(value); break;
      case '--maps': options.maps = list(value); break;
      case '--games': options.games = integer(value, 2); break;
      case '--players': options.players = integer(value, 2, 8); break;
      case '--seed-base': options.seedBase = integer(value, 0, 0xffffffff); break;
      case '--max-rounds': options.maxRounds = integer(value, 1); break;
      case '--out': options.out = resolve(ROOT, value); break;
      case '--random-preset':
        if (value === 'standard' || value === '标准') options.randomPreset = 'standard';
        else if (value === 'challenge' || value === '挑战') options.randomPreset = 'challenge';
        else throw new Error(`Unknown random preset: ${value}`);
        break;
      default: throw new Error(`Unknown option: ${flag}`);
    }
  }
  if (options.games % 2) throw new Error('--games must be even');
  if (![2, 3, 6, 8].includes(options.players)) throw new Error('--players must be 2, 3, 6 or 8');
  validateOutput(options.out);
  return options;
}

/** Reject both lexical escapes and existing symlink/junction ancestors, including the output. */
export function validateOutput(output: string): void {
  const rel = relative(TEMP, output);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel) || !rel.endsWith('.json')) {
    throw new Error('--out must be a .json file strictly below the project temp/ directory');
  }
  const parts = rel.split(sep);
  if (parts.some(part => /[:*?"<>|\x00-\x1f]/.test(part) || /[. ]$/.test(part))) {
    throw new Error('Invalid output path component');
  }
  let cursor = TEMP;
  for (const part of ['', ...parts]) {
    if (part) cursor = join(cursor, part);
    // lstat also catches dangling links (existsSync alone would not).
    let stat;
    try { stat = lstatSync(cursor); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error(`Output path must not traverse a symlink/junction: ${cursor}`);
    if (cursor !== output && !stat.isDirectory()) throw new Error(`Not a directory: ${cursor}`);
    if (cursor === output && !stat.isFile()) throw new Error(`Not a regular output file: ${cursor}`);
  }
  if (existsSync(TEMP) && realpathSync(TEMP) !== join(realpathSync(ROOT), 'temp')) {
    throw new Error('Project temp/ resolves outside its expected location');
  }
}

function seed(...parts: (string | number)[]): number {
  return createHash('sha256').update(JSON.stringify(parts)).digest().readUInt32LE(0);
}

function rng(initial: number): () => number {
  let state = initial >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

const key = (p: Position): string => `${p.q},${p.r}`;
const NEIGHBORS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]] as const;

function connected(cells: Map<string, Position>, blocked: Set<string>): boolean {
  const walkable = [...cells.keys()].filter(id => !blocked.has(id));
  if (!walkable.length) return false;
  const visited = new Set([walkable[0]!]);
  const queue = [cells.get(walkable[0]!)!];
  for (let i = 0; i < queue.length; i++) {
    const cell = queue[i]!;
    for (const [q, r] of NEIGHBORS) {
      const id = `${cell.q + q},${cell.r + r}`;
      if (cells.has(id) && !blocked.has(id) && !visited.has(id)) {
        visited.add(id);
        queue.push(cells.get(id)!);
      }
    }
  }
  return visited.size === walkable.length;
}

/** The generator has no outline option. Only remove edge cells, never fixed objects or paths. */
function cropChallenge(config: MapConfig, shapeSeed: number, pairIndex: number) {
  const random = rng(shapeSeed);
  const shape = pairIndex % 2 === 0 ? 'clipped-hex' : 'notched-hex';
  const axis = Math.floor(random() * 3);
  const depth = 1 + Math.floor(random() * 2);
  const cells = new Map(config.playableCells.map(cell => [key(cell), cell]));
  const protectedCells = new Set([
    ...config.controlPoints, ...Object.values(config.headquarters), ...config.startingUnits,
    ...config.spawnSlots.flatMap(slot => [slot.headquarters, ...slot.startingUnits]),
  ].map(key));
  const blocked = new Set(config.terrainCells.filter(cell => cell.terrain !== 'plain').map(key));
  if (!connected(cells, blocked)) throw new Error('Generated map has disconnected passable cells');
  const candidates = config.playableCells.filter(cell => {
    const axes = [cell.q, cell.r, -cell.q - cell.r];
    const major = Math.abs(axes[axis]!);
    const minor = Math.abs(axes[(axis + 1) % 3]!);
    return !protectedCells.has(key(cell)) && major > config.radius - depth
      && (shape === 'clipped-hex' || minor <= Math.ceil(config.radius / 2));
  }).sort((a, b) => Math.max(Math.abs(b.q), Math.abs(b.r), Math.abs(b.q + b.r))
    - Math.max(Math.abs(a.q), Math.abs(a.r), Math.abs(a.q + a.r)));
  let removedCells = 0;
  for (const cell of candidates) {
    cells.delete(key(cell));
    if (connected(cells, blocked)) removedCells++;
    else cells.set(key(cell), cell);
  }
  if (!removedCells) throw new Error('Challenge outline did not remove any cells');
  config.playableCells = config.playableCells.filter(cell => cells.has(key(cell)));
  config.terrainCells = config.terrainCells.filter(cell => cells.has(key(cell)));
  config.name = `随机挑战 · ${shape}`;
  config.description += ` · ${shape} axis=${axis} depth=${depth}`;
  validateGeneratedMap(config, 'random-challenge');
  return { shape, axis, depth, removedCells, shapeSeed, transformVersion: 1 };
}

export function makeScenario(options: Options, mapId: string, pairIndex: number) {
  const mapSeed = seed(options.seedBase, mapId, options.players, pairIndex, 'map');
  const engineSeed = seed(options.seedBase, mapId, options.players, pairIndex, 'engine');
  const decisionSeedBase = seed(options.seedBase, mapId, options.players, pairIndex, 'decisions');
  let randomOptions: RandomMapOptions | null = null;
  const resolvedParameters: RandomParamValues = {};
  let config: MapConfig;
  let outline: ReturnType<typeof cropChallenge> | { shape: 'hex' | 'static' };
  if (mapId === 'random') {
    randomOptions = { seed: mapSeed, mode: 'standard', symmetric: true };
    if (options.randomPreset === 'challenge') {
      Object.assign(randomOptions, {
        radius: [7, 12], waterDensity: [0.06, 0.2], wallDensity: [0.08, 0.24],
        controlPointCount: [6, 20], actionsPerTurn: [3, 10], maxTurns: [30, 60],
        unitStatVariation: [0.2, 0.5], startingSupplies: [30, 180], baseIncome: [5, 25],
        headquartersHp: [65, 200], headquartersDefense: [2, 12], startingUnitCount: [1, 6],
        startingWeightInfantry: [1, 4], startingWeightScout: [1, 4],
        startingWeightHeavy: [1, 4], startingWeightRanger: [1, 4],
        damageVarianceRange: [0, 8], healVarianceRange: [0, 10],
        supplyIncome: [8, 24], forwardBaseDeployDiscount: [0, 16], repairPointRepairAmount: [5, 25],
      } satisfies RandomMapOptions);
    }
    config = generateRandomMapConfig(randomOptions, options.players, resolvedParameters);
    outline = options.randomPreset === 'challenge'
      ? cropChallenge(config, seed(mapSeed, 'outline'), pairIndex) : { shape: 'hex' };
  } else {
    config = structuredClone(getMapConfig(mapId));
    outline = { shape: 'static' };
  }
  if (config.mode !== 'standard' || !config.supportedPlayerCounts.includes(options.players)) {
    throw new Error(`${mapId} does not support standard/${options.players} players`);
  }
  const first = pairIndex % options.players;
  const second = (first + Math.floor(options.players / 2)) % options.players;
  return {
    id: `${mapId}:${options.players}:${pairIndex}`, mapId, pairIndex,
    seeds: { seedBase: options.seedBase, mapSeed, engineSeed, decisionSeedBase },
    mapParameters: {
      preset: mapId === 'random' ? options.randomPreset : null,
      generatorVersion: mapId === 'random' ? RANDOM_MAP_GENERATOR_VERSION : null,
      randomOptions, resolvedParameters, outline,
    },
    configHash: createHash('sha256').update(JSON.stringify(config)).digest('hex'),
    config,
    seatPlan: { order: [...PLAYER_IDS.slice(0, options.players)], firstSeat: first } satisfies SeatPlan,
    swapSeats: [first, second] as [number, number],
  };
}
type Scenario = ReturnType<typeof makeScenario>;

type Algorithm = { decide(state: unknown, helpers: unknown, ctx: { owner: PlayerId }): unknown };
type Reply = { action?: unknown; durationMs?: number; error?: string };
const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 2000);

async function decisionWorker(): Promise<void> {
  const port = parentPort!;
  const data = workerData as { name: string; seed: number };
  Math.random = rng(data.seed);
  // Do NOT freeze Date.now/performance.now: black-box algorithms may use either for search budgets.
  // Only timestamps in the public state are canonicalized; wall-time search is explicitly best-effort.
  try {
    const algorithm = await loadAlgorithm(data.name) as Algorithm;
    if (typeof algorithm?.decide !== 'function') throw new Error(`${data.name} must expose decide(state, utils, ctx)`);
    port.on('message', async ({ state, owner }: { state: unknown; owner: PlayerId }) => {
      const started = performance.now();
      try {
        const action = await algorithm.decide(state, utils, { owner });
        port.postMessage({ action, durationMs: performance.now() - started } satisfies Reply);
      } catch (error) {
        port.postMessage({ error: messageOf(error), durationMs: performance.now() - started } satisfies Reply);
      }
    });
    port.postMessage({ ready: true });
  } catch (error) {
    port.postMessage({ error: messageOf(error) });
    port.close();
  }
}

/** Fresh module globals and RNG for every seat/game. Main-thread engine state never enters a worker. */
export class DecisionClient {
  private worker: Worker;
  private dead: Error | null = null;
  private pending: { resolve: (reply: Reply) => void; reject: (error: Error) => void; timer: NodeJS.Timeout } | null = null;
  private ready: Promise<Reply>;

  constructor(name: string, decisionSeed: number) {
    const require = createRequire(import.meta.url);
    const loader = pathToFileURL(require.resolve('tsx/esm/api')).href;
    const bootstrap = `import { register } from ${JSON.stringify(loader)}; register(); await import(${JSON.stringify(import.meta.url)});`;
    this.worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(bootstrap)}`), {
      workerData: { role: 'parallax-decision', name, seed: decisionSeed },
      stdout: true, stderr: true,
    });
    // Opponent diagnostics must not dump states or overwhelm batch progress output.
    this.worker.stdout?.resume();
    this.worker.stderr?.resume();
    this.ready = this.wait();
    this.worker.on('message', (reply: Reply) => {
      const pending = this.pending;
      if (!pending) return;
      this.pending = null;
      clearTimeout(pending.timer);
      pending.resolve(reply);
    });
    this.worker.on('error', error => this.fail(error));
    this.worker.on('exit', code => this.fail(new Error(`Decision worker exited (${code})`)));
  }

  private fail(error: Error): void {
    this.dead ??= error;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(this.dead);
      this.pending = null;
    }
  }

  private wait(): Promise<Reply> {
    if (this.dead) return Promise.reject(this.dead);
    return new Promise((resolveReply, reject) => {
      const timer = setTimeout(() => {
        this.fail(new Error(`Decision worker exceeded ${TIMEOUT_MS}ms watchdog`));
        void this.worker.terminate();
      }, TIMEOUT_MS);
      this.pending = { resolve: resolveReply, reject, timer };
    });
  }

  async start(): Promise<void> {
    const reply = await this.ready;
    if (reply.error !== undefined) throw new Error(reply.error);
  }

  async decide(state: unknown, owner: PlayerId): Promise<Reply> {
    if (this.dead) throw this.dead;
    const reply = this.wait();
    try { this.worker.postMessage({ state, owner }); }
    catch (error) { this.fail(new Error(messageOf(error))); }
    return reply;
  }

  async close(): Promise<void> { await this.worker.terminate(); }
}

/** Preserve the entire sanitize projection, replacing only nondeterministic identifiers/metadata. */
class PublicProjection {
  private publicIds = new Map<string, string>();
  private engineIds = new Map<string, string>();
  private nextUnitId = 0;

  private remember(raw: string, alias: string): void {
    if (this.publicIds.has(raw)) return;
    this.publicIds.set(raw, alias);
    this.engineIds.set(alias, raw);
  }

  state(game: GameState, owner: PlayerId): unknown {
    for (const hq of Object.values(game.headquarters)) this.remember(hq.id, `arena/hq/${hq.owner}`);
    for (const unit of game.units) {
      // Elimination removes array entries, so array indices cannot be reused as public IDs.
      if (!this.publicIds.has(unit.id)) this.remember(unit.id, `arena/unit/${this.nextUnitId++}`);
    }
    // No live config, resources, units, events or adjudication references cross this boundary.
    const view = structuredClone(sanitizeGameForResponse(game, owner)) as Record<string, unknown>;
    const replace = (value: unknown): unknown => {
      if (typeof value === 'string') return this.publicIds.get(value) ?? value;
      if (Array.isArray(value)) return value.map(replace);
      if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, replace(v)]));
      }
      return value;
    };
    const result = replace(view) as Record<string, unknown>;
    result.createdAt = PUBLIC_EPOCH;
    if ('lastActivityAt' in result) result.lastActivityAt = PUBLIC_EPOCH + game.events.length;
    for (const [index, player] of Object.values(result.players as Record<string, Record<string, unknown>>).entries()) {
      player.joinedAt = PUBLIC_EPOCH + index;
      if (player.eliminatedAt !== null) {
        const event = game.events.find(e => e.type === 'player_eliminated' && e.payload.playerId === player.id);
        player.eliminatedAt = PUBLIC_EPOCH + (event?.seq ?? 0);
      }
    }
    for (const event of result.events as Array<Record<string, unknown>>) event.timestamp = PUBLIC_EPOCH + Number(event.seq);
    // Also canonicalize metadata in embedded replay snapshots, without dropping any fields.
    const scrubTimes = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      for (const [k, v] of Object.entries(value)) {
        if ((k === 'joinedAt' || k === 'createdAt' || k === 'eliminatedAt') && typeof v === 'number' && v > PUBLIC_EPOCH) {
          (value as Record<string, unknown>)[k] = PUBLIC_EPOCH;
        } else scrubTimes(v);
      }
    };
    scrubTimes(result.events);
    return result;
  }

  id(alias: string): string { return this.engineIds.get(alias) ?? alias; }
}

class IllegalAction extends Error {}
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new IllegalAction(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function text(payload: Record<string, unknown>, field: string): string {
  const value = payload[field];
  if (typeof value !== 'string' || !value) throw new IllegalAction(`${field} must be a nonempty string`);
  return value;
}
function coordinate(payload: Record<string, unknown>, field: string): number {
  const value = payload[field];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new IllegalAction(`${field} must be an integer`);
  return value;
}

function applyAction(game: GameState, bus: EventBus, owner: PlayerId, action: unknown, projection: PublicProjection): void {
  const a = record(action, 'action');
  const p = record(a.payload ?? {}, 'payload');
  const id = (field: string): string => projection.id(text(p, field));
  const q = (): number => coordinate(p, 'q');
  const r = (): number => coordinate(p, 'r');
  let result: { ok: true } | { ok: false; code: string; message: string };
  switch (a.type) {
    case 'move': result = moveUnit(game, bus, owner, id('unitId'), q(), r()); break;
    case 'attack': result = attackTarget(game, bus, owner, id('attackerId'), id('targetId')); break;
    case 'heal': result = healTarget(game, bus, owner, id('supportId'), id('targetId')); break;
    case 'demolish': result = demolishTerrain(game, bus, owner, id('unitId'), q(), r()); break;
    case 'deploy': {
      const type = text(p, 'unitType');
      if (!['infantry', 'scout', 'heavy', 'ranger', 'support'].includes(type)) throw new IllegalAction(`Unknown unitType: ${type}`);
      result = deployUnit(game, bus, owner, type as UnitType, id('fromId'), q(), r());
      break;
    }
    default: throw new IllegalAction(`Unsupported standard action: ${String(a.type)} (return null to end turn)`);
  }
  if (!result.ok) throw new IllegalAction(`${result.code}: ${result.message}`);
}

export function timing(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (p: number): number | null => sorted.length ? sorted[Math.ceil(sorted.length * p) - 1]! : null;
  return { count: sorted.length, p50: percentile(0.5), p95: percentile(0.95), max: sorted.at(-1) ?? null };
}

interface Problem { kind: 'illegal' | 'exception' | 'guard' | 'unfinished'; algorithm: string | null; seat: number | null; round: number; message: string }
export interface DecisionController {
  start(): Promise<void>;
  decide(state: unknown, owner: PlayerId): Promise<Reply>;
  close(): Promise<void>;
}

export async function runGame(
  options: Options, scenario: Scenario, opponent: string, leg: number,
  controller: (name: string, decisionSeed: number) => DecisionController = (name, s) => new DecisionClient(name, s),
) {
  const { seatPlan, swapSeats } = scenario;
  const identities = seatPlan.order.map((_, seat) => seat);
  if (leg === 1) [identities[swapSeats[0]], identities[swapSeats[1]]] = [identities[swapSeats[1]]!, identities[swapSeats[0]]!];
  const seats = seatPlan.order.map((owner, seat) => {
    const identity = identities[seat]!;
    const algorithm = identity === swapSeats[0] ? PARALLAX : opponent;
    return { seat, owner, identity, algorithm, decisionSeed: seed(scenario.seeds.decisionSeedBase, algorithm, identity) };
  });
  const parallaxSeat = seats.find(seat => seat.algorithm === PARALLAX)!.seat;
  const gameId = `parallax-arena:${scenario.id}:${opponent}:${leg}`;
  const game = createLobbyWithConfig(gameId, scenario.mapId, structuredClone(scenario.config), {
    maxPlayers: options.players, participate: false, playerName: 'arena',
  });
  const bus = new EventBus();
  const projection = new PublicProjection();
  const problems: Problem[] = [];
  const illegal: Record<string, number> = { [PARALLAX]: 0, [opponent]: 0 };
  const samples: Record<string, number[]> = { [PARALLAX]: [], [opponent]: [] };
  const clients = new Map<PlayerId, DecisionController>();
  let capped = false;
  let rounds = 0;
  let completedRounds = 0;
  let turnCount = 0;
  const addProblem = (kind: Problem['kind'], message: string, owner: PlayerId | null = null): void => {
    const seat = seats.find(entry => entry.owner === owner);
    if (kind === 'illegal' && seat) illegal[seat.algorithm]!++;
    problems.push({ kind, algorithm: seat?.algorithm ?? null, seat: seat?.seat ?? null, round: game.turn.roundNumber, message });
  };
  const stopTurn = (owner: PlayerId): void => {
    if (game.phase !== 'active' || game.turn.currentPlayerId !== owner) return;
    const result = endTurn(game, bus, owner);
    if (!result.ok) throw new Error(`endTurn failed: ${result.code}: ${result.message}`);
  };
  const unsubscribe = bus.subscribe(gameId, event => {
    if (event.type === 'round_end') completedRounds = Math.max(completedRounds, Number(event.payload.roundNumber));
  });
  try {
    for (const seat of seats) {
      const joined = addLobbyPlayer(game, `seat-${seat.seat}`);
      if (joined?.id !== seat.owner) throw new Error('Lobby seat assignment mismatch');
    }
    game.seatPlan = structuredClone(seatPlan);
    // Manual seats consume startup draws but do not use them. The final draw sets exactly engineSeed.
    const started = startGame(game, bus, () => scenario.seeds.engineSeed / 0x100000000);
    if (!started.ok) throw new Error(`startGame: ${started.code}: ${started.message}`);
    for (const seat of seats) {
      if (game.players[seat.owner]?.spawnSlotId !== game.config.layouts[String(options.players)]![seat.seat]) {
        throw new Error('Engine did not honor requested birth seat');
      }
      const client = controller(seat.algorithm, seat.decisionSeed);
      clients.set(seat.owner, client);
      try { await client.start(); }
      catch (error) {
        addProblem('exception', `Algorithm initialization: ${messageOf(error)}`, seat.owner);
        throw new Error('Cannot start all algorithm seats');
      }
    }
    if (game.rngState !== scenario.seeds.engineSeed || game.turn.currentPlayerId !== seatPlan.order[seatPlan.firstSeat]) {
      throw new Error('Engine RNG/firstSeat initialization mismatch');
    }
    const maxTurns = game.config.balance.maxTurns;
    const turnGuard = options.players * (Math.ceil(maxTurns ?? options.maxRounds) + 1) + 8;
    while (game.phase === 'active') {
      if (maxTurns === null && completedRounds >= options.maxRounds) {
        capped = true;
        const result = forceAdjudication(game, bus);
        if (!result.ok) throw new Error(`forceAdjudication: ${result.code}: ${result.message}`);
        break;
      }
      if (++turnCount > turnGuard) {
        addProblem('guard', `Exceeded ${turnGuard} player turns`);
        break;
      }
      const owner: PlayerId | null = game.turn.currentPlayerId;
      if (!owner || game.players[owner]?.status !== 'active') throw new Error('Active game has no active current player');
      const seat = seats.find(entry => entry.owner === owner)!;
      const client = clients.get(owner)!;
      const round = game.turn.roundNumber;
      rounds = Math.max(rounds, round);
      const activated = game.units.filter(unit => unit.owner === owner && unit.alive && unit.actionSpent).length;
      const maxActions = Math.ceil(3 * game.config.balance.actionsPerTurn + 2 * activated + 10);
      let decisions = 0;
      while (game.phase === 'active' && game.turn.currentPlayerId === owner && game.turn.roundNumber === round) {
        if (decisions++ >= maxActions) {
          addProblem('guard', `Exceeded ${maxActions} decisions in one turn`, owner);
          stopTurn(owner);
          break;
        }
        let reply: Reply;
        try {
          reply = await client.decide(projection.state(game, owner), owner);
          if (typeof reply.durationMs === 'number' && Number.isFinite(reply.durationMs) && reply.durationMs >= 0) {
            samples[seat.algorithm]!.push(reply.durationMs);
          }
          if (reply.error !== undefined) throw new Error(reply.error);
        } catch (error) {
          addProblem('exception', `decide: ${messageOf(error)}`, owner);
          stopTurn(owner);
          // A dead/timed-out worker must not create hundreds of repeated turn failures.
          throw new Error(`Decision failed for ${seat.algorithm}`);
        }
        if (reply.action === null || reply.action === undefined) {
          stopTurn(owner);
          break;
        }
        try { applyAction(game, bus, owner, reply.action, projection); }
        catch (error) {
          addProblem(error instanceof IllegalAction ? 'illegal' : 'exception', messageOf(error), owner);
          stopTurn(owner);
          if (!(error instanceof IllegalAction)) throw new Error('Engine action exception');
          break;
        }
      }
    }
  } catch (error) {
    addProblem('exception', messageOf(error));
  } finally {
    const closed = await Promise.allSettled([...clients.values()].map(client => client.close()));
    for (const result of closed) if (result.status === 'rejected') addProblem('exception', `Worker cleanup: ${messageOf(result.reason)}`);
    unsubscribe();
    bus.clear(gameId);
  }
  const finished = game.phase === 'game_over' && game.result !== null;
  if (!finished) addProblem('unfinished', `Match stopped in phase ${game.phase}`);
  const winnerSeat = game.winner ? seats.find(seat => seat.owner === game.winner)?.seat ?? null : null;
  const winnerAlgorithm = winnerSeat === null ? null : seats[winnerSeat]!.algorithm;
  const normal = finished && !capped && problems.length === 0;
  const outcome = !normal ? null : winnerSeat === null ? 'draw' : winnerSeat === parallaxSeat ? 'win' : 'loss';
  return {
    result: {
      gameId, scenarioId: scenario.id, opponent, mapId: scenario.mapId, pairIndex: scenario.pairIndex, leg,
      players: options.players, seats, seatPlan, firstSeat: seatPlan.firstSeat, swapSeats,
      seeds: scenario.seeds, mapParameters: scenario.mapParameters, configHash: scenario.configHash,
      winnerSeat, parallaxSeat, winnerAlgorithm, rounds, completedRounds, turnCount,
      engineRoundNumber: game.turn.roundNumber, reason: game.result?.reason ?? 'unfinished',
      capped, finished, valid: problems.length === 0, normal, outcome, illegal,
      decisionTimingMs: Object.fromEntries(Object.entries(samples).map(([name, values]) => [name, timing(values)])),
      finalScores: structuredClone(game.result?.scores ?? buildAdjudicationScores(game)),
      errors: problems,
    },
    samples,
  };
}
type GameRecord = Awaited<ReturnType<typeof runGame>>['result'];

export function summarize(games: GameRecord[]) {
  const count = (matches: GameRecord[]) => ({
    games: matches.length,
    normal: {
      wins: matches.filter(game => game.outcome === 'win').length,
      losses: matches.filter(game => game.outcome === 'loss').length,
      draws: matches.filter(game => game.outcome === 'draw').length,
    },
    capped: matches.filter(game => game.capped).length,
    invalid: matches.filter(game => !game.valid).length,
    unfinished: matches.filter(game => !game.finished).length,
    illegal: Object.fromEntries([...new Set(matches.flatMap(game => Object.keys(game.illegal)))].map(name => [
      name, matches.reduce((sum, game) => sum + (game.illegal[name] ?? 0), 0),
    ])),
  });
  const group = (field: 'opponent' | 'mapId') => Object.fromEntries(
    [...new Set(games.map(game => game[field]))].map(value => [value, count(games.filter(game => game[field] === value))]),
  );
  const byOpponentAndMap = Object.fromEntries([...new Set(games.map(game => game.opponent))].map(opponent => [
    opponent, Object.fromEntries([...new Set(games.filter(game => game.opponent === opponent).map(game => game.mapId))]
      .map(mapId => [mapId, count(games.filter(game => game.opponent === opponent && game.mapId === mapId))])),
  ]));
  return { overall: count(games), byOpponent: group('opponent'), byMap: group('mapId'), byOpponentAndMap };
}

async function main(): Promise<void> {
  if (process.argv.slice(2).some(arg => arg === '--help' || arg === '-h')) { console.log(HELP); return; }
  const options = parseArgs(process.argv.slice(2));
  loadMaps();
  const names = listAlgorithms() as string[];
  const opponents = options.opponents ?? names.filter(name => name !== PARALLAX && algorithmSupportsMode(name, 'standard')).sort();
  if (!names.includes(PARALLAX)) throw new Error('parallax is not registered yet; register it before running matches');
  if (!algorithmSupportsMode(PARALLAX, 'standard')) throw new Error('parallax must support standard mode');
  if (!opponents.length) throw new Error('No standard opponents selected');
  for (const name of opponents) {
    if (name === PARALLAX || !names.includes(name) || !algorithmSupportsMode(name, 'standard')) {
      throw new Error(`Not a registered standard opponent: ${name}`);
    }
  }
  const maps = options.maps ?? listMaps()
    .filter(map => map.preview.mode === 'standard' && map.preview.supportedPlayerCounts.includes(options.players))
    .map(map => map.id).sort();
  if (!maps.length) throw new Error('No maps support the requested player count');
  for (const id of maps) {
    if (id === 'random') continue;
    const config = getMapConfig(id);
    if (config.mode !== 'standard' || !config.supportedPlayerCounts.includes(options.players)) {
      throw new Error(`Map ${id} does not support standard/${options.players}`);
    }
  }
  const expectedGames = maps.length * opponents.length * options.games;
  if (!Number.isSafeInteger(expectedGames)) throw new Error('Requested game count is too large');
  const games: GameRecord[] = [];
  const scenarios: Scenario[] = [];
  const samples: Record<string, number[]> = {};
  const startedAt = new Date().toISOString();
  let fatal: string | null = null;
  const checkpoint = (complete: boolean): void => {
    validateOutput(options.out);
    mkdirSync(dirname(options.out), { recursive: true });
    validateOutput(options.out);
    writeFileSync(options.out, `${JSON.stringify({
      schemaVersion: 1, evaluator: 'parallax-arena', startedAt, complete, expectedGames, fatal,
      options: { ...options, maps, opponents },
      algorithms: Object.fromEntries([PARALLAX, ...opponents].map(name => [name, { version: algorithmVersion(name) }])),
      conventions: {
        seats: 'zero-based physical layout indices; one parallax against N-1 independent opponent copies',
        pairs: 'identical config, engineSeed, seatPlan and firstSeat; swapSeats exchanges only algorithm identities',
        rounds: 'highest round in which a player turn was evaluated; completedRounds comes from round_end events',
        cap: 'unlimited maps only, after maxRounds complete rounds; forced score never counts as a normal result',
        normal: 'finished, uncapped and no illegal actions/exceptions/guards; invalid and capped counts may overlap',
        projection: 'complete sanitizeGameForResponse clone; public UUID/time canonicalization; no rngState or tokens',
        reproducibility: 'SHA256 seeds + mulberry32 decision RNG; fresh worker per seat/game; wall-clock-budgeted search may vary',
        timing: 'nearest-rank milliseconds across all decide calls, including null and thrown decisions; excludes IPC/projection',
        fullConfigs: 'scenarios[scenarioId].config (look up by id); per-game configHash and mapParameters identify the exact map',
        decisionWatchdogMs: TIMEOUT_MS,
      },
      scenarios, games, summary: summarize(games),
      decisionTimingMs: Object.fromEntries(Object.entries(samples).map(([name, values]) => [name, timing(values)])),
    }, null, 2)}\n`, 'utf8');
  };
  try {
    checkpoint(false);
    console.log(`parallax arena: ${expectedGames} games, ${options.players} players; output ${options.out}`);
    for (const mapId of maps) {
      for (let pairIndex = 0; pairIndex < options.games / 2; pairIndex++) {
        const scenario = makeScenario(options, mapId, pairIndex);
        scenarios.push(scenario);
        for (const opponent of opponents) {
          for (let leg = 0; leg < 2; leg++) {
            const played = await runGame(options, scenario, opponent, leg);
            games.push(played.result);
            for (const [name, values] of Object.entries(played.samples)) {
              const combined = samples[name] ??= [];
              for (const value of values) combined.push(value);
            }
            checkpoint(false);
            const game = played.result;
            console.log(`[${games.length}/${expectedGames}] ${mapId} vs ${opponent} pair=${pairIndex} leg=${leg} `
              + `parallaxSeat=${game.parallaxSeat} winner=${game.winnerAlgorithm ?? '-'}@${game.winnerSeat ?? '-'} `
              + `rounds=${game.rounds} ${game.reason} capped=${game.capped} `
              + `illegal=${JSON.stringify(game.illegal)} errors=${game.errors.length}`);
          }
        }
      }
    }
  } catch (error) {
    fatal = messageOf(error);
    process.exitCode = 1;
  } finally {
    checkpoint(fatal === null && games.length === expectedGames);
  }
  console.log(JSON.stringify(summarize(games)));
  if (fatal) console.error(fatal);
  if (games.some(game => !game.valid || !game.finished)) process.exitCode = 1;
}

if (!isMainThread && workerData?.role === 'parallax-decision') {
  await decisionWorker();
} else if (isMainThread && process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main().catch(error => { console.error(messageOf(error)); process.exitCode = 1; });
}
