#!/usr/bin/env -S npx tsx
// Local, opaque-bot annihilation evaluation. No HTTP, persistence, or arena history.
import { randomUUID } from 'node:crypto';
import { closeSync, lstatSync, mkdirSync, openSync, readdirSync, writeSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { getMapConfig, loadMaps, type MapConfig } from '../src/config/loader.js';
import { generateRandomMapConfig, RANDOM_MAP_GENERATOR_VERSION } from '../src/config/randomMap.js';
import { addLobbyPlayer, createLobby, createLobbyWithConfig, setSeatPlan } from '../src/state/store.js';
import { buildAdjudicationSnapshot, endTurn, startGame } from '../src/engine/engine.js';
import { seedGameRandom } from '../src/engine/random.js';
import { moveUnit } from '../src/engine/units.js';
import { attackTarget, healTarget } from '../src/engine/combat.js';
import { deployUnit } from '../src/engine/deployment.js';
import { demolishTerrain } from '../src/engine/demolition.js';
import { EventBus } from '../src/events/bus.js';
import { PLAYER_IDS, type EventType, type GameEvent, type GameState, type PlayerId, type UnitType } from '../src/types.js';
import { algorithmSupportsMode, algorithmVersion, listAlgorithms, loadAlgorithm } from '../algorithms/registry.mjs';
// @ts-ignore Opaque public utility namespace; do not duplicate tactical helpers here.
import * as utils from '../algorithms/lib/game-utils.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMP = join(ROOT, 'temp');
const SOVEREIGN = 'sovereign';
const RECENT_EVENTS = 64;
const MAX_DECISIONS = 50_000;
const MAX_ROUNDS = 2_000;

const HELP = `Usage: npx tsx scripts/sovereign-arena.mts [options]
  --opponents A,B   Registered annihilation bots (default: all except sovereign)
  --maps A,B        Static annihilation map IDs (default: all compatible maps)
  --games N         Games per opponent/map, positive EVEN integer (default: 2)
  --seed N          Unsigned 32-bit base seed (default: 1000)
  --players N       2-8 players; other seats all use the opponent (default: 2)
  --random-maps N   Add N seeded generated annihilation maps (default: 0)
  --trace PATH      Optional public-action and round-state JSONL, under temp/
  --output PATH     Optional final JSON report, under temp/
  --help, -h        Show help without loading or running any bot

Paths are relative to the repository root, or absolute inside its temp/.
Output files must not already exist. No files are written without these flags.
Default maps incompatible with --players are reported as skipped; explicit ones fail.
Adjacent games share a combat seed and swap sovereign between two spawn seats.
First seat is shared within each pair and rotates across pairs. Seat numbers are 0-based.
Progress/matchup summaries go to stderr; the final JSON report goes to stdout.
Any illegal action, bot error, engine error, or unfinished game causes exit code 1.
Guards: ${MAX_DECISIONS} decisions and ${MAX_ROUNDS} rounds per game (never force-adjudicated).
Example: npx tsx scripts/sovereign-arena.mts --games 4 --seed 42 --output temp/sovereign.json`;

type Options = {
  opponents?: string[];
  maps?: string[];
  games: number;
  seed: number;
  players: number;
  randomMaps: number;
  trace?: string;
  output?: string;
};
type Algorithm = { decide(state: Record<string, unknown>, tools: typeof utils, ctx: { owner: PlayerId }): unknown | Promise<unknown> };
type MapCase = { id: string; config: MapConfig; generatedSeed?: number };
type Counts = { wins: number; draws: number; losses: number; unfinished: number };
type ActionKind = 'move' | 'attack' | 'heal' | 'deploy' | 'demolish' | 'end_turn';
type Action = { type: ActionKind; payload: Record<string, string | number> };
const ACTION_FIELDS: Record<ActionKind, string[]> = {
  move: ['unitId', 'q', 'r'], attack: ['attackerId', 'targetId'], heal: ['supportId', 'targetId'],
  deploy: ['unitType', 'fromId', 'q', 'r'], demolish: ['unitId', 'q', 'r'], end_turn: [],
};
type Metrics = {
  decisions: number;
  latencies: number[];
  attempted: Record<string, number>;
  accepted: Record<string, number>;
  invalid: number;
  errors: number;
};
type Problem = { kind: string; algorithm?: string; owner?: PlayerId; round: number; step: number; message: string; action?: unknown };
type Seat = { seat: number; playerId: PlayerId; algorithm: string; spawnSlotId: string };
type GameReport = {
  gameId: string;
  map: string;
  opponent: string;
  index: number;
  pair: number;
  leg: number;
  seed: number;
  generatedMapSeed?: number;
  firstSeat: number;
  sovereignSeat: number;
  seats: Seat[];
  turnOrder: PlayerId[];
  finished: boolean;
  outcome: 'win' | 'draw' | 'loss' | 'unfinished';
  winner: PlayerId | null;
  reason: string | null;
  rank: number | null;
  rounds: number;
  decisions: number;
  durationMs: number;
  scores: ReturnType<typeof buildAdjudicationSnapshot>['scores'];
  rankings: ReturnType<typeof buildAdjudicationSnapshot>['rankings'];
  algorithms: Record<string, ReturnType<typeof summarizeMetrics>>;
  problems: Problem[];
};

export function parseArgs(argv: string[]): Options | null {
  if (argv.includes('--help') || argv.includes('-h')) return null;
  const options: Options = { games: 2, seed: 1000, players: 2, randomMaps: 0 };
  const seen = new Set<string>();
  const numeric: Record<string, keyof Pick<Options, 'games' | 'seed' | 'players' | 'randomMaps'>> = {
    '--games': 'games', '--seed': 'seed', '--players': 'players', '--random-maps': 'randomMaps',
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!['--opponents', '--maps', '--trace', '--output', ...Object.keys(numeric)].includes(flag)) {
      throw new Error(`Unknown option: ${flag}`);
    }
    if (seen.has(flag)) throw new Error(`Duplicate option: ${flag}`);
    seen.add(flag);
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    if (Object.hasOwn(numeric, flag)) {
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error(`${flag} requires an integer`);
      options[numeric[flag]] = Number(value);
    } else if (flag === '--opponents' || flag === '--maps') {
      const values = value.split(',').map(item => item.trim());
      if (values.some(item => !/^[a-zA-Z0-9_-]+$/.test(item)) || new Set(values).size !== values.length) {
        throw new Error(`${flag} requires a nonempty, unique comma-list of registry/map IDs`);
      }
      options[flag === '--maps' ? 'maps' : 'opponents'] = values;
    } else {
      options[flag === '--trace' ? 'trace' : 'output'] = validateOutputPath(value);
    }
  }
  if (options.games < 2 || options.games % 2) throw new Error('--games must be a positive even integer for complete mirrored pairs');
  if (options.players < 2 || options.players > 8) throw new Error('--players must be 2-8');
  if (options.seed > 0xffffffff) throw new Error('--seed must be 0-4294967295');
  if (options.trace && options.output && pathKey(options.trace) === pathKey(options.output)) {
    throw new Error('--trace and --output must be different files');
  }
  return options;
}

function pathKey(path: string): string { return process.platform === 'win32' ? path.toLowerCase() : path; }

export function validateOutputPath(input: string): string {
  const target = resolve(ROOT, input);
  const rel = relative(TEMP, target);
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) {
    throw new Error(`Output must be a file under ${TEMP}: ${input}`);
  }
  // Reject Windows device/alternate-stream aliases as well as symlinks and junctions.
  for (const part of rel.split(sep)) {
    if (/[<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) {
      throw new Error(`Invalid output path component: ${part}`);
    }
  }
  let cursor = TEMP;
  for (const part of ['', ...rel.split(sep)]) {
    if (part) cursor = join(cursor, part);
    const stat = lstatSync(cursor, { throwIfNoEntry: false });
    if (!stat) continue;
    if (stat.isSymbolicLink() || (cursor !== target && !stat.isDirectory())) {
      throw new Error(`Output path cannot traverse a symlink or non-directory: ${cursor}`);
    }
    if (cursor === target) throw new Error(`Output already exists: ${target}`);
  }
  return target;
}

function openOutput(path: string): number {
  validateOutputPath(path);
  mkdirSync(dirname(path), { recursive: true });
  validateOutputPath(path);
  return openSync(path, 'wx');
}

function writeText(fd: number, text: string): void {
  const bytes = Buffer.from(text);
  let offset = 0;
  while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset);
}

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
  };
}

function derivedSeed(seed: number, label: string): number {
  let hash = (2166136261 ^ seed) >>> 0;
  for (const char of label) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash;
}

const EVENT_FIELDS: Partial<Record<EventType, string[]>> = {
  game_start: ['mapId', 'mode', 'map', 'players', 'turnOrder', 'controlPoints', 'headquarters', 'units', 'resources', 'artillery', 'firstPlayer', 'playerNames', 'config'],
  move: ['unitId', 'owner', 'fromQ', 'fromR', 'toQ', 'toR', 'actionsUsed', 'actionsRemaining'],
  attack: ['owner', 'attackerId', 'targetId', 'damage', 'actualDamage', 'targetHp', 'targetKind', 'actionsUsed', 'actionsRemaining'],
  heal: ['owner', 'supportId', 'targetId', 'amount', 'targetHp', 'actionsUsed', 'actionsRemaining'],
  deploy: ['unitId', 'owner', 'unitType', 'fromId', 'q', 'r', 'cost', 'unitCost', 'discount', 'hp', 'attack', 'defense', 'moveRange', 'attackRange', 'canCapture', 'healPower', 'actionsUsed', 'actionsRemaining'],
  demolish: ['unitId', 'owner', 'q', 'r', 'fromTerrain', 'toTerrain', 'actionsUsed', 'actionsRemaining'],
  unit_death: ['unitId', 'owner', 'type', 'q', 'r', 'cause'],
  control_point_captured: ['pointId', 'name', 'owner', 'previousOwner', 'unitId', 'q', 'r'],
  control_point_neutralized: ['pointId', 'previousOwner'],
  control_point_repair: ['owner', 'pointId', 'pointName', 'unitId', 'amount', 'unitHp'],
  income: ['owner', 'base', 'control', 'controlPoints', 'amount', 'breakdown'],
  comeback_supply: ['owner', 'amount', 'leaderScore', 'playerScore', 'scoreGap', 'scoreGapPercent'],
  artillery_warning: ['safeRadius', 'warningCells', 'nextShrinkRound'],
  artillery_shrunk: ['safeRadius', 'dangerCells', 'warningCells', 'nextShrinkRound'],
  artillery_damage: ['unitId', 'owner', 'damage', 'unitHp', 'q', 'r'],
  reset_actions: ['owner', 'actionsUsed'],
  turn_end: ['previousOwner', 'nextOwner', 'previousPlayerId', 'nextPlayerId', 'turnNumber'],
  round_end: ['controlHoldCounted'],
  headquarters_destroyed: ['headquartersId', 'owner', 'q', 'r'],
  player_eliminated: ['playerId', 'reason', 'eliminatedBy', 'removedUnitIds', 'neutralizedPointIds', 'score'],
  game_over: ['winner', 'reason', 'scores', 'rankings'],
};

function scrubClone<T>(value: T): T {
  const copy = structuredClone(value);
  const visit = (item: unknown): void => {
    if (!item || typeof item !== 'object') return;
    for (const key of Object.keys(item)) {
      const normalized = key.toLowerCase().replace(/[_-]/g, '');
      if (/token/i.test(key) || ['rngstate', 'idempotency', 'resolvedround', 'skipguard', 'proto', 'constructor', 'prototype'].includes(normalized)) {
        delete (item as Record<string, unknown>)[key];
      } else visit((item as Record<string, unknown>)[key]);
    }
  };
  visit(copy);
  return copy;
}

function publicEvents(events: GameEvent[]): GameEvent[] {
  return events.flatMap(event => {
    if (!Object.hasOwn(EVENT_FIELDS, event.type)) return [];
    const payload: Record<string, unknown> = {};
    for (const key of ['roundNumber', ...EVENT_FIELDS[event.type]!]) {
      if (Object.hasOwn(event.payload, key)) payload[key] = event.payload[key];
    }
    return [{ seq: event.seq, type: event.type, timestamp: event.timestamp, payload }];
  });
}

export function publicSnapshot(game: GameState): Record<string, unknown> {
  // Allowlist top-level public fields BEFORE cloning. In particular, never clone history.
  return scrubClone({
    id: game.id, mapId: game.mapId, createdAt: game.createdAt, lastActivityAt: game.lastActivityAt,
    hostName: game.hostName, phase: game.phase, maxPlayers: game.maxPlayers,
    map: game.map, cells: game.cells, config: game.config, units: game.units,
    headquarters: game.headquarters, controlPoints: game.controlPoints, players: game.players,
    playerNames: game.playerNames, resources: game.resources, turn: game.turn,
    artillery: game.artillery, winner: game.winner, result: game.result,
    seatPlan: game.seatPlan, seatVersion: game.seatVersion, stateVersion: game.stateVersion,
    plan: null, adjudication: buildAdjudicationSnapshot(game),
    lastEventSeq: game.events.at(-1)?.seq ?? 0,
    events: publicEvents(game.events.slice(-RECENT_EVENTS)),
  });
}

export function mirroredSeats(players: number, pair: number, leg: number): { order: PlayerId[]; firstSeat: number; sovereignSeat: number } {
  const order: PlayerId[] = PLAYER_IDS.slice(0, players);
  const first = (2 * pair) % players;
  [order[0], order[first]] = [order[first], order[0]];
  const second = (first + 1) % players;
  if (leg === 1) [order[first], order[second]] = [order[second], order[first]];
  return { order, firstSeat: pair % players, sovereignSeat: leg === 0 ? first : second };
}

function discoverMaps(options: Options): { maps: MapCase[]; skipped: string[] } {
  const mapsDir = join(ROOT, 'maps');
  loadMaps(mapsDir);
  const available = readdirSync(mapsDir).filter(file => file.endsWith('.json')).map(file => file.slice(0, -5)).sort();
  const ids = options.maps ?? available.filter(id => getMapConfig(id).mode === 'annihilation');
  const maps: MapCase[] = [];
  const skipped: string[] = [];
  for (const id of ids) {
    if (!available.includes(id)) throw new Error(`Unknown static map: ${id}`);
    const config = getMapConfig(id);
    if (config.mode !== 'annihilation') throw new Error(`Map ${id} is not annihilation`);
    if (!config.supportedPlayerCounts.includes(options.players)) {
      if (options.maps) throw new Error(`Map ${id} does not support ${options.players} players`);
      skipped.push(id);
    } else maps.push({ id, config });
  }
  for (let i = 0; i < options.randomMaps; i++) {
    const seed = derivedSeed(options.seed, `generated-map:${i}`);
    maps.push({
      id: `generated-annihilation-${i + 1}`,
      generatedSeed: seed,
      config: generateRandomMapConfig({ seed, mode: 'annihilation' }, options.players),
    });
  }
  if (!maps.length) throw new Error('No compatible annihilation maps; use --random-maps or a supported --players count');
  return { maps, skipped };
}

function parseAction(value: unknown): Action {
  if (value == null) return { type: 'end_turn', payload: {} };
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('decide must return an action object or null');
  const raw = value as { type?: unknown; payload?: unknown };
  if (typeof raw.type !== 'string' || !Object.hasOwn(ACTION_FIELDS, raw.type)) throw new Error(`Unknown action type: ${String(raw.type)}`);
  const type = raw.type as ActionKind;
  const source = raw.payload ?? {};
  if (typeof source !== 'object' || Array.isArray(source)) throw new Error(`${type}.payload must be an object`);
  const payload: Action['payload'] = {};
  for (const key of ACTION_FIELDS[type]) {
    const item = (source as Record<string, unknown>)[key];
    if (key === 'q' || key === 'r') {
      if (typeof item !== 'number' || !Number.isSafeInteger(item)) throw new Error(`${type}.${key} must be an integer`);
    } else if (typeof item !== 'string' || !item) throw new Error(`${type}.${key} must be a nonempty string`);
    payload[key] = item as string | number;
  }
  return { type, payload };
}

function applyAction(game: GameState, bus: EventBus, owner: PlayerId, action: Action) {
  const p = action.payload;
  switch (action.type) {
    case 'move': return moveUnit(game, bus, owner, p.unitId as string, p.q as number, p.r as number);
    case 'attack': return attackTarget(game, bus, owner, p.attackerId as string, p.targetId as string);
    case 'heal': return healTarget(game, bus, owner, p.supportId as string, p.targetId as string);
    case 'deploy': return deployUnit(game, bus, owner, p.unitType as UnitType, p.fromId as string, p.q as number, p.r as number);
    case 'demolish': return demolishTerrain(game, bus, owner, p.unitId as string, p.q as number, p.r as number);
    case 'end_turn': return endTurn(game, bus, owner);
  }
}

function freshMetrics(): Metrics { return { decisions: 0, latencies: [], attempted: {}, accepted: {}, invalid: 0, errors: 0 }; }
function increment(record: Record<string, number>, key: string): void { record[key] = (record[key] ?? 0) + 1; }
function summarizeMetrics(metrics: Metrics) {
  const sorted = [...metrics.latencies].sort((a, b) => a - b);
  return {
    decisions: metrics.decisions, attempted: { ...metrics.attempted }, accepted: { ...metrics.accepted },
    invalidActions: metrics.invalid, botOrEngineErrors: metrics.errors,
    latencyMs: { samples: sorted.length, max: sorted.at(-1) ?? 0, p95: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0 },
  };
}
function mergeMetrics(target: Metrics, source: Metrics): void {
  target.decisions += source.decisions;
  target.invalid += source.invalid;
  target.errors += source.errors;
  for (const value of source.latencies) target.latencies.push(value);
  for (const key of ['attempted', 'accepted'] as const) {
    for (const [type, count] of Object.entries(source[key])) target[key][type] = (target[key][type] ?? 0) + count;
  }
}
function emptyCounts(): Counts { return { wins: 0, draws: 0, losses: 0, unfinished: 0 }; }
function countGame(counts: Counts, game: GameReport): void {
  if (!game.finished) counts.unfinished++;
  else if (game.outcome === 'win') counts.wins++;
  else if (game.outcome === 'draw') counts.draws++;
  else counts.losses++;
}
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

type Trace = ((record: unknown) => void) | undefined;
function roundTrace(trace: Trace, game: GameState, stage: string): void {
  if (!trace) return;
  trace({
    kind: 'round_state', gameId: game.id, stage, round: game.turn.roundNumber, phase: game.phase,
    lastEventSeq: game.events.at(-1)?.seq ?? 0, units: game.units, players: game.players,
    turn: game.turn, controlPoints: game.controlPoints, resources: game.resources,
    artillery: game.artillery, adjudication: buildAdjudicationSnapshot(game),
  });
}

async function runGame(options: Options, map: MapCase, opponent: string, index: number, bots: Map<string, Algorithm>, totals: Map<string, Metrics>, trace: Trace): Promise<GameReport> {
  const pair = Math.floor(index / 2);
  const leg = index % 2;
  // No seed, registry identity, or matchup metadata is embedded in the public game ID.
  const seed = (options.seed + pair) >>> 0;
  const { order, firstSeat, sovereignSeat } = mirroredSeats(options.players, pair, leg);
  const gameId = randomUUID();
  const game = map.generatedSeed === undefined
    ? createLobby(gameId, map.id, { maxPlayers: options.players, participate: false })
    : createLobbyWithConfig(gameId, map.id, structuredClone(map.config), { maxPlayers: options.players, participate: false });
  // Static configs are shared by the loader, but every game gets its own mutable copy.
  game.config = structuredClone(game.config);
  const bus = new EventBus();
  const algorithms: Record<string, string> = {};
  const botRandom = new Map<PlayerId, () => number>();
  const metrics = new Map<string, Metrics>([SOVEREIGN, opponent].map(name => [name, freshMetrics()]));
  const problems: Problem[] = [];
  const startedAt = performance.now();
  let steps = 0;
  let stage = 'setup';
  let owner: PlayerId | undefined;
  let algorithm: string | undefined;
  let action: Action | undefined;
  let currentMetrics: Metrics | undefined;
  const seats: Seat[] = order.map((playerId, seat) => ({ seat, playerId, algorithm: playerId === 'player_a' ? SOVEREIGN : opponent, spawnSlotId: map.config.layouts[String(options.players)][seat] }));
  const initialTurnOrder = [...order.slice(firstSeat), ...order.slice(0, firstSeat)];

  try {
    for (const id of PLAYER_IDS.slice(0, options.players)) {
      const name = id === 'player_a' ? SOVEREIGN : opponent;
      // Names reveal no opponent identity; bot input is just the ordinary public state.
      const joined = addLobbyPlayer(game, id);
      if (!joined || joined.id !== id) throw new Error(`addLobbyPlayer failed for ${id}`);
      algorithms[id] = name;
      botRandom.set(id, rng(derivedSeed(seed, `bot:${name}:${id}`)));
    }
    setSeatPlan(game, order, firstSeat);
    const started = startGame(game, bus, rng(derivedSeed(seed, 'setup')));
    if (!started.ok) throw new Error(`startGame: ${started.code}: ${started.message}`);
    // Combat randomness is independent of setup and each algorithm's Math.random stream.
    seedGameRandom(game, () => seed / 0x100000000);
    if (game.turn.turnOrder.join(',') !== initialTurnOrder.join(',') || seats.some(seat => game.players[seat.playerId]?.spawnSlotId !== seat.spawnSlotId)) {
      throw new Error('Engine did not honor the mirrored seat plan');
    }
    trace?.({ kind: 'game_start', gameId, map: map.id, opponent, index, pair, leg, seed, firstSeat, sovereignSeat, seats, generatedMapSeed: map.generatedSeed, state: publicSnapshot(game) });
    roundTrace(trace, game, 'start');

    while (game.phase === 'active') {
      owner = undefined; algorithm = undefined; action = undefined; currentMetrics = undefined;
      stage = 'guard';
      if (steps >= MAX_DECISIONS || game.turn.roundNumber > MAX_ROUNDS) throw new Error('Unfinished game: decision/round guard reached');
      owner = game.turn.currentPlayerId ?? undefined;
      if (!owner || game.players[owner]?.status !== 'active' || !algorithms[owner]) throw new Error('Active game has no valid current player');
      algorithm = algorithms[owner];
      currentMetrics = metrics.get(algorithm)!;
      const round = game.turn.roundNumber;
      const eventOffset = game.events.length;
      const state = publicSnapshot(game);
      steps++;
      currentMetrics.decisions++;
      let raw: unknown;
      const previousRandom = Math.random;
      const t0 = performance.now();
      stage = 'bot_error';
      try {
        // Sequential calls only; restore the process random source even when decide throws.
        Math.random = botRandom.get(owner)!;
        raw = await bots.get(algorithm)!.decide(state, utils, { owner });
      } finally {
        Math.random = previousRandom;
        currentMetrics.latencies.push(performance.now() - t0);
      }
      stage = 'invalid_action';
      // Count malformed returns too, without copying arbitrary bot-private diagnostics.
      const candidate = raw == null ? 'end_turn' : typeof raw === 'object' ? (raw as { type?: unknown }).type : undefined;
      increment(currentMetrics.attempted, typeof candidate === 'string' && Object.hasOwn(ACTION_FIELDS, candidate) ? candidate : 'malformed');
      action = parseAction(raw);
      stage = 'engine_error';
      const result = applyAction(game, bus, owner, action);
      trace?.({ kind: 'action', gameId, step: steps, round, owner, algorithm, action, latencyMs: currentMetrics.latencies.at(-1), result: result.ok ? { ok: true } : result, events: publicEvents(game.events.slice(eventOffset)) });
      if (!result.ok) {
        stage = 'invalid_action';
        throw new Error(`${action.type}: ${result.code}: ${result.message}`);
      }
      increment(currentMetrics.accepted, action.type);
      stage = 'guard';
      if (game.events.length === eventOffset && game.phase === 'active') throw new Error('Engine accepted an action without progress');
      if (game.turn.roundNumber !== round) roundTrace(trace, game, 'start');
    }
    if (game.phase !== 'game_over' || !game.result) throw new Error('Game stopped before game_over with a result');
  } catch (error) {
    if (currentMetrics) {
      if (stage === 'invalid_action') currentMetrics.invalid++;
      else currentMetrics.errors++;
    }
    const problem: Problem = { kind: stage, algorithm, owner, round: game.turn.roundNumber, step: steps, message: errorMessage(error), action };
    problems.push(problem);
    console.error(`[${map.id} vs ${opponent} #${index + 1}] ${algorithm ?? 'harness'}: ${problem.message}`);
    trace?.({ ...problem, kind: 'failure', failureKind: problem.kind, gameId });
  } finally {
    bus.clear(game.id);
  }

  const scoreboard = buildAdjudicationSnapshot(game);
  const finished = problems.length === 0 && game.phase === 'game_over' && game.result !== null;
  const outcome = !finished ? 'unfinished' : game.winner === 'player_a' ? 'win' : game.winner === null ? 'draw' : 'loss';
  for (const [name, values] of metrics) mergeMetrics(totals.get(name)!, values);
  const report: GameReport = {
    gameId, map: map.id, opponent, index, pair, leg, seed, generatedMapSeed: map.generatedSeed,
    firstSeat, sovereignSeat, seats, turnOrder: initialTurnOrder, finished, outcome,
    winner: game.winner, reason: game.result?.reason ?? null,
    rank: finished ? game.result!.rankings.find(row => row.playerId === 'player_a')?.rank ?? null : null,
    rounds: game.turn.roundNumber, decisions: steps, durationMs: performance.now() - startedAt,
    scores: game.result?.scores ?? scoreboard.scores, rankings: game.result?.rankings ?? scoreboard.rankings,
    algorithms: Object.fromEntries([...metrics].map(([name, values]) => [name, summarizeMetrics(values)])), problems,
  };
  roundTrace(trace, game, finished ? 'final' : 'unfinished');
  trace?.({ kind: 'game_end', ...report });
  return report;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv);
  if (!options) { console.log(HELP); return; }
  const registered: string[] = listAlgorithms();
  const opponents = options.opponents ?? registered.filter(name => name !== SOVEREIGN && algorithmSupportsMode(name, 'annihilation'));
  if (!opponents.length) throw new Error('No registered annihilation opponents');
  for (const name of [SOVEREIGN, ...opponents]) {
    if (!registered.includes(name) || !algorithmSupportsMode(name, 'annihilation')) throw new Error(`Not a registered annihilation bot: ${name}`);
  }
  if (opponents.includes(SOVEREIGN)) throw new Error('--opponents must not include sovereign');
  const { maps, skipped } = discoverMaps(options);
  if (skipped.length) console.error(`Skipped maps incompatible with ${options.players} players: ${skipped.join(', ')}`);
  const bots = new Map<string, Algorithm>();
  for (const name of [SOVEREIGN, ...opponents]) {
    const bot = await loadAlgorithm(name) as Algorithm;
    if (!bot || typeof bot.decide !== 'function') throw new Error(`Algorithm ${name} has no decide(state, utils)`);
    bots.set(name, bot);
  }
  const totals = new Map<string, Metrics>([...bots.keys()].map(name => [name, freshMetrics()]));
  const games: GameReport[] = [];
  const matchups: Array<{ map: string; opponent: string; planned: number; played: number } & Counts> = [];
  const counts = emptyCounts();
  let traceFd: number | undefined;
  let outputFd: number | undefined;
  let fatalError: string | undefined;
  try {
    if (options.output) outputFd = openOutput(options.output);
    if (options.trace) traceFd = openOutput(options.trace);
    const trace: Trace = traceFd === undefined ? undefined : record => writeText(traceFd!, `${JSON.stringify(scrubClone(record))}\n`);
    trace?.({ kind: 'run_start', options, opponents, maps: maps.map(map => ({ id: map.id, generatedSeed: map.generatedSeed })), eventWindow: RECENT_EVENTS });
    for (const opponent of opponents) {
      for (const map of maps) {
        const matchup = { map: map.id, opponent, planned: options.games, played: 0, ...emptyCounts() };
        matchups.push(matchup);
        console.error(`[${map.id} vs ${opponent}] starting ${options.games} games, ${options.players} players`);
        for (let index = 0; index < options.games; index++) {
          const game = await runGame(options, map, opponent, index, bots, totals, trace);
          games.push(game);
          matchup.played++;
          countGame(matchup, game);
          countGame(counts, game);
          console.error(`[${map.id} vs ${opponent}] ${matchup.played}/${options.games} W/D/L=${matchup.wins}/${matchup.draws}/${matchup.losses} unfinished=${matchup.unfinished}; seed=${game.seed} seat=${game.sovereignSeat} first=${game.firstSeat} rank=${game.rank ?? '-'} rounds=${game.rounds}`);
        }
      }
    }
  } catch (error) {
    fatalError = errorMessage(error);
    console.error(`Harness failed: ${fatalError}`);
  } finally {
    const invalidActions = [...totals.values()].reduce((sum, value) => sum + value.invalid, 0);
    const expectedGames = opponents.length * maps.length * options.games;
    const ok = !fatalError && invalidActions === 0 && counts.unfinished === 0 && games.length === expectedGames;
    const report = {
      schemaVersion: 1, ok, options, opponents,
      versions: Object.fromEntries([...bots.keys()].map(name => [name, algorithmVersion(name)])),
      generatorVersion: RANDOM_MAP_GENERATOR_VERSION,
      maps: maps.map(map => ({ id: map.id, generatedSeed: map.generatedSeed, maxTurns: map.config.balance.maxTurns })),
      skippedMaps: skipped, expectedGames, playedGames: games.length, ...counts, invalidActions,
      rules: { seatBase: 0, eventWindow: RECENT_EVENTS, maxDecisions: MAX_DECISIONS, maxRounds: MAX_ROUNDS, outcomes: 'sovereign vs all opponent seats; null winner is a draw; unfinished excluded from W/D/L', rank: 'engine ranking (ties follow engine ordering)', combatSeeds: 'base seed + pair index, shared across matchups', botRandom: 'per-algorithm/per-player seeded Math.random; opaque bots may use other randomness' },
      algorithms: Object.fromEntries([...totals].map(([name, values]) => [name, summarizeMetrics(values)])),
      matchups, games, fatalError,
    };
    if (!ok) process.exitCode = 1;
    try {
      const json = `${JSON.stringify(report, null, 2)}\n`;
      if (outputFd !== undefined) writeText(outputFd, json);
      console.log(json.trimEnd());
    } finally {
      if (traceFd !== undefined) closeSync(traceFd);
      if (outputFd !== undefined) closeSync(outputFd);
    }
  }
}

if (process.argv[1] && pathKey(resolve(process.argv[1])) === pathKey(fileURLToPath(import.meta.url))) {
  main().catch(error => {
    console.error(errorMessage(error));
    console.log(JSON.stringify({ schemaVersion: 1, ok: false, fatalError: errorMessage(error) }));
    process.exitCode = 1;
  });
}
