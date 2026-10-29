import { describe, expect, it } from 'vitest';
import { getMapConfig, listMaps, loadMaps, type MapConfig } from '../../src/config/loader.js';
import { createRadiusPlayableCells } from '../../src/config/geometry.js';
import { EventBus } from '../../src/events/bus.js';
import { artilleryStateForRound } from '../../src/engine/artillery.js';
import { attackTarget, computeDamage, healTarget } from '../../src/engine/combat.js';
import { demolishTerrain } from '../../src/engine/demolition.js';
import { deployUnit } from '../../src/engine/deployment.js';
import { buildAdjudicationSnapshot, endTurn, startGame } from '../../src/engine/engine.js';
import { invalidateGameIndex } from '../../src/engine/gameIndex.js';
import { nextGameRandom } from '../../src/engine/random.js';
import type { Result } from '../../src/engine/result.js';
import { moveUnit } from '../../src/engine/units.js';
import { findReachableCells, getTerrain, hexDistance } from '../../src/engine/validation.js';
import {
  addLobbyPlayer, createLobby, createLobbyWithConfig, createUnitFromConfig, setSeatPlan,
} from '../../src/state/store.js';
import { PLAYER_IDS, type GameState, type PlayerId, type Unit, type UnitType } from '../../src/types.js';
// @ts-ignore Native JavaScript algorithms do not publish TypeScript declarations.
import sovereign, { damageDistribution } from '../../algorithms/builtin/sovereign.mjs';
import { algorithmModes, algorithmSupportsMode, getAlgorithmMeta, loadAlgorithm } from '../../algorithms/registry.mjs';

// Use only the new bot and authoritative engine, never other bots or strategy utilities.
loadMaps();
const annihilationMaps = listMaps().filter(map => map.preview.mode === 'annihilation');
const baseMapId = annihilationMaps[0]!.id;

type Choice =
  | { type: 'move'; payload: { unitId: string; q: number; r: number } }
  | { type: 'attack'; payload: { attackerId: string; targetId: string } }
  | { type: 'heal'; payload: { supportId: string; targetId: string } }
  | { type: 'demolish'; payload: { unitId: string; q: number; r: number } }
  | { type: 'deploy'; payload: { unitType: UnitType; fromId: string; q: number; r: number } };

interface Fixture { game: GameState; bus: EventBus }

function startFixture(mapId = baseMapId, players = 2, config?: MapConfig): Fixture {
  const options = { maxPlayers: players, playerName: 'Sovereign A' };
  const game = config
    ? createLobbyWithConfig('sovereign-regression', mapId, structuredClone(config), options)
    : createLobby('sovereign-regression', mapId, options);
  // createLobby uses the cached map configuration; never mutate that shared copy.
  game.config = structuredClone(game.config);
  for (let seat = 1; seat < players; seat++) expect(addLobbyPlayer(game)).not.toBeNull();
  setSeatPlan(game, PLAYER_IDS.slice(0, players), 0);
  const bus = new EventBus();
  expect(startGame(game, bus, () => 0.371)).toEqual({ ok: true });
  return { game, bus };
}

function scenario(): Fixture {
  const fixture = startFixture();
  const { game } = fixture;
  game.map.radius = game.config.radius = 6;
  game.config.playableCells = createRadiusPlayableCells(6);
  game.cells = game.config.playableCells.map(cell => ({ ...cell, terrain: 'plain' }));
  game.map.terrainCells = [];
  game.config.terrainCells = [];
  game.config.controlPoints = [];
  game.controlPoints = [];
  game.units = [];
  game.config.annihilation!.artillery.startRound = 50;
  game.artillery = artilleryStateForRound(game, 1);
  for (const resources of Object.values(game.resources)) resources.supplies = 0;
  game.events = [];
  return fixture;
}

function unit(
  game: GameState, owner: PlayerId, type: UnitType, q: number, r: number,
  overrides: Partial<Unit> = {},
): Unit {
  const created = Object.assign(createUnitFromConfig(game.config, owner, type, q, r), overrides);
  game.units.push(created);
  invalidateGameIndex(game);
  return created;
}

function idleUnit(game: GameState, owner: PlayerId, q: number, r: number): Unit {
  return unit(game, owner, 'infantry', q, r, {
    attack: 0, moveRange: 0, hasMoved: true, hasActed: true, actionSpent: true,
  });
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

function publicSnapshot(game: GameState) {
  const {
    hostToken: _hostToken, tokens: _tokens, rngState: _rngState,
    idempotency: _idempotency, stateVersion: _stateVersion, ...snapshot
  } = structuredClone(game);
  return { ...snapshot, adjudication: buildAdjudicationSnapshot(game) };
}

async function choose(game: GameState, owner: PlayerId = game.turn.currentPlayerId!): Promise<Choice | null> {
  return sovereign.decide(freezeDeep(publicSnapshot(game)), undefined, { owner });
}

function apply(fixture: Fixture, choice: Choice, owner = fixture.game.turn.currentPlayerId!): Result<unknown> {
  const { game, bus } = fixture;
  switch (choice.type) {
    case 'move': return moveUnit(game, bus, owner, choice.payload.unitId, choice.payload.q, choice.payload.r);
    case 'attack': return attackTarget(game, bus, owner, choice.payload.attackerId, choice.payload.targetId);
    case 'heal': return healTarget(game, bus, owner, choice.payload.supportId, choice.payload.targetId);
    case 'demolish': return demolishTerrain(game, bus, owner, choice.payload.unitId, choice.payload.q, choice.payload.r);
    case 'deploy': return deployUnit(game, bus, owner, choice.payload.unitType, choice.payload.fromId, choice.payload.q, choice.payload.r);
    default: throw new Error(`Unexpected bot action: ${JSON.stringify(choice)}`);
  }
}

function accept(fixture: Fixture, choice: Choice | null): asserts choice is Choice {
  expect(choice, 'Expected an action, not a policy pass').not.toBeNull();
  const result = apply(fixture, choice!);
  expect(result, `Engine rejected ${JSON.stringify(choice)}`).toMatchObject({ ok: true });
}

function lethalFixture(): Fixture {
  const fixture = scenario();
  const { game } = fixture;
  unit(game, 'player_a', 'infantry', 0, 0, { hasMoved: true });
  unit(game, 'player_b', 'scout', 1, 0, { hp: 1 });
  return fixture;
}

function breachFixture(): Fixture {
  const fixture = scenario();
  const { game } = fixture;
  game.cells = [-6, -5, -4, -3, -2, -1, 0, 1].map(q => ({ q, r: 0, terrain: q === -3 ? 'blocker' : 'plain' }));
  game.config.playableCells = game.cells.map(({ q, r }) => ({ q, r }));
  game.config.balance.actionsPerTurn = 1;
  game.config.units.heavy.moveRange = 2;
  game.config.annihilation!.artillery = { startRound: 2, intervalRounds: 1, damage: 17, minimumSafeRadius: 0 };
  game.turn.roundNumber = game.turn.turnNumber = 3;
  game.artillery = artilleryStateForRound(game, 3);
  unit(game, 'player_a', 'heavy', -6, 0);
  idleUnit(game, 'player_b', 1, 0);
  return fixture;
}

function deploymentFixture(discount = 18, supplies = 23): Fixture {
  const fixture = scenario();
  const { game } = fixture;
  for (const spec of Object.values(game.config.units)) spec.cost = 300;
  game.config.units.scout.cost = 41;
  game.config.balance.controlPointTypes = {
    supply: { income: 0, deployDiscount: 300, repairAmount: 0, canDeploy: false },
    forward_base: { income: 0, deployDiscount: discount, repairAmount: 0, canDeploy: true },
    repair: { income: 0, deployDiscount: 0, repairAmount: 0, canDeploy: true },
  };
  game.controlPoints = [
    { id: 'owned-deployable', name: 'Owned base', kind: 'forward_base', q: 0, r: 0, owner: 'player_a' },
    { id: 'owned-not-deployable', name: 'Income only', kind: 'supply', q: -3, r: 0, owner: 'player_a' },
    { id: 'neutral-base', name: 'Neutral base', kind: 'forward_base', q: 0, r: 3, owner: null },
    { id: 'enemy-base', name: 'Enemy base', kind: 'forward_base', q: 3, r: 0, owner: 'player_b' },
  ];
  game.resources.player_a!.supplies = supplies;
  idleUnit(game, 'player_a', -4, 0);
  idleUnit(game, 'player_b', 4, 0);
  return fixture;
}

function renameStrings<T>(value: T, replacements: Map<string, string>): T {
  const visit = (item: unknown): unknown => {
    if (typeof item === 'string') return replacements.get(item) ?? item;
    if (Array.isArray(item)) return item.map(visit);
    if (item !== null && typeof item === 'object') {
      return Object.fromEntries(Object.entries(item).map(([key, child]) => [replacements.get(key) ?? key, visit(child)]));
    }
    return item;
  };
  return visit(value) as T;
}

async function selfplay(fixture: Fixture, maxRounds: number): Promise<void> {
  const { game, bus } = fixture;
  game.config.balance.maxTurns = maxRounds;
  const budget = maxRounds * game.turn.turnOrder.length * (2 * game.config.balance.actionsPerTurn + 2);
  const rejected: string[] = [];
  let chosenActions = 0;
  for (let step = 0; step < budget && game.phase === 'active'; step++) {
    const owner = game.turn.currentPlayerId!;
    const choice = await choose(game, owner);
    const context = `${game.mapId}, round ${game.turn.roundNumber}, ${owner}, ${JSON.stringify(choice)}`;
    const result = choice === null ? endTurn(game, bus, owner) : apply(fixture, choice, owner);
    if (choice !== null) chosenActions++;
    if (!result.ok) {
      rejected.push(`${context}: ${JSON.stringify(result)}`);
      break; // Never hide an illegal decision by passing or asking for another action.
    }
  }
  expect(rejected, 'Every chosen action must be accepted by the real engine').toEqual([]);
  expect(chosenActions).toBeGreaterThan(0);
  expect(game.phase, 'Bot must finish within the bounded activation/round budget').toBe('game_over');
  expect(game.turn.roundNumber).toBeLessThanOrEqual(maxRounds);
  expect(game.result).not.toBeNull();
  expect(game.events.some(event => event.type === 'action_failed')).toBe(false);
}

describe('sovereign registration and snapshot contract', () => {
  it('is registered exclusively for annihilation without fixing mutable display metadata', async () => {
    expect(getAlgorithmMeta('sovereign')).toMatchObject({ name: 'sovereign', path: './builtin/sovereign.mjs' });
    expect(algorithmModes('sovereign')).toEqual(['annihilation']);
    expect(algorithmSupportsMode('sovereign', 'annihilation')).toBe(true);
    for (const mode of ['standard', 'simultaneous', 'royale']) expect(algorithmSupportsMode('sovereign', mode)).toBe(false);
    expect(await loadAlgorithm('sovereign')).toBe(sovereign);
  });

  it.each(['standard', 'simultaneous', 'royale'] as const)('returns null for %s', async mode => {
    const { game } = lethalFixture();
    game.config.mode = mode;
    expect(await choose(game)).toBeNull();
  });

  it.each(['lobby', 'game_over'] as const)('returns null in phase %s', async phase => {
    const { game } = lethalFixture();
    game.phase = game.turn.phase = phase;
    expect(await choose(game)).toBeNull();
  });

  it.each(['player_b', 'player_h'] as const)('returns null for non-current seat %s', async owner => {
    const { game } = lethalFixture();
    expect(await choose(game, owner)).toBeNull();
  });

  it('returns null when there is no current seat or artillery state', async () => {
    const { game } = lethalFixture();
    game.turn.currentPlayerId = game.turn.currentOwner = null;
    expect(await sovereign.decide(freezeDeep(publicSnapshot(game)))).toBeNull();
    game.turn.currentPlayerId = game.turn.currentOwner = 'player_a';
    game.artillery = null;
    expect(await choose(game)).toBeNull();
  });

  it('accepts a deeply frozen public snapshot, needs no secrets, and mutates neither copy nor engine state', async () => {
    const fixture = startFixture();
    const { game } = fixture;
    const beforeGame = structuredClone(game);
    const snapshot = publicSnapshot(game);
    const beforeSnapshot = structuredClone(snapshot);
    for (const privateKey of ['rngState', 'tokens', 'hostToken', 'idempotency', 'stateVersion']) {
      expect(snapshot).not.toHaveProperty(privateKey);
    }
    freezeDeep(snapshot);
    const first: Choice | null = await sovereign.decide(snapshot);
    expect(first).not.toBeNull();
    for (let repeat = 0; repeat < 3; repeat++) {
      expect(await sovereign.decide(snapshot, undefined, { owner: 'player_a' })).toEqual(first);
    }
    expect(snapshot).toEqual(beforeSnapshot);
    expect(game).toEqual(beforeGame);
    accept(fixture, first);
  });

  it.each([
    ['opening', () => startFixture()],
    ['attack', lethalFixture],
    ['deployment', () => deploymentFixture()],
  ] as const)('does not depend on entity/game/map IDs or seat labels: %s', async (_label, makeFixture) => {
    const fixture = makeFixture();
    const snapshot = publicSnapshot(fixture.game);
    const first: Choice | null = await sovereign.decide(freezeDeep(snapshot), undefined, { owner: 'player_a' });
    expect(first).not.toBeNull();
    const ids = [snapshot.id, snapshot.mapId, ...snapshot.units.map(u => u.id), ...snapshot.controlPoints.map(p => p.id)];
    const replacements = new Map(ids.map((id, index) => [id, `unregistered-${ids.length - index}`]));
    replacements.set('player_a', 'player_b');
    replacements.set('player_b', 'player_a');
    const renamed = renameStrings(snapshot, replacements);
    const reverse = new Map([...replacements].map(([from, to]) => [to, from]));
    for (let repeat = 0; repeat < 3; repeat++) {
      const choice: Choice | null = await sovereign.decide(freezeDeep(structuredClone(renamed)), undefined, { owner: 'player_b' });
      expect(renameStrings(choice, reverse)).toEqual(first);
    }
    accept(fixture, first);
  });
});

describe('sovereign exact discrete damage distribution', () => {
  it.each([
    { attack: 30, defense: 8, variance: 3, minimum: 1 },
    { attack: 5, defense: 7, variance: 4, minimum: 2 },
    { attack: 0, defense: 100, variance: 9, minimum: 5 },
    { attack: 20, defense: 3, variance: 0, minimum: 0 },
    { attack: 8, defense: 7, variance: 1, minimum: 0 },
    { attack: 42.5, defense: 9.25, variance: 6, minimum: 3.5 },
  ])('matches computeDamage for every RNG bucket: $attack/$defense, variance $variance, floor $minimum', spec => {
    const { game } = scenario();
    game.config.balance.damageVarianceRange = spec.variance;
    game.config.balance.minimumDamage = spec.minimum;
    const bucketCount = 2 * spec.variance + 1;
    const seen = new Set<number>();
    const expected = new Map<number, number>();
    // Exhaust every equiprobable RNG bucket with one real engine seed, not Monte Carlo sampling.
    for (let seed = 0; seed < 10000 && seen.size < bucketCount; seed++) {
      const probe = { ...game, rngState: seed };
      const bucket = Math.floor(nextGameRandom(probe) * bucketCount);
      if (seen.has(bucket)) continue;
      seen.add(bucket);
      const damage = computeDamage({ ...game, rngState: seed }, spec.attack, spec.defense);
      expected.set(damage, (expected.get(damage) ?? 0) + 1 / bucketCount);
    }
    expect(seen.size).toBe(bucketCount);
    const actual = damageDistribution(spec.attack, spec.defense, spec.variance, spec.minimum) as [number, number][];
    expect(new Set(actual.map(([damage]) => damage)).size).toBe(actual.length);
    expect(actual.map(([damage]) => damage).sort((a, b) => a - b)).toEqual([...expected.keys()].sort((a, b) => a - b));
    expect(actual.reduce((total, [, probability]) => total + probability, 0)).toBeCloseTo(1, 14);
    for (const [damage, probability] of actual) expect(probability).toBeCloseTo(expected.get(damage)!, 14);
  });
});

describe('sovereign attacks and free activation follow-ups', () => {
  it('attacks a wounded enemy already in range when every damage outcome is lethal', async () => {
    const fixture = lethalFixture();
    const [attacker, target] = fixture.game.units;
    const { balance } = fixture.game.config;
    expect(Math.max(balance.minimumDamage, attacker.attack - target.defense - balance.damageVarianceRange)).toBeGreaterThanOrEqual(target.hp);
    const choice = await choose(fixture.game);
    expect(choice).toEqual({ type: 'attack', payload: { attackerId: attacker.id, targetId: target.id } });
    accept(fixture, choice);
    expect(target.alive).toBe(false);
  });

  it('uses the free attack after an engine-accepted move spent the last AP', async () => {
    const fixture = scenario();
    const { game, bus } = fixture;
    game.config.balance.actionsPerTurn = 1;
    const attacker = unit(game, 'player_a', 'infantry', 0, 0);
    const target = unit(game, 'player_b', 'scout', 2, 0, { hp: 1 });
    expect(moveUnit(game, bus, 'player_a', attacker.id, 1, 0)).toEqual({ ok: true });
    expect(game.turn.actionsUsed).toBe(1);
    const choice = await choose(game);
    expect(choice).toEqual({ type: 'attack', payload: { attackerId: attacker.id, targetId: target.id } });
    accept(fixture, choice);
    expect(game.turn.actionsUsed).toBe(1);
  });

  it('uses the free move after an engine-accepted attack spent the last AP', async () => {
    const fixture = scenario();
    const { game, bus } = fixture;
    game.config.balance.actionsPerTurn = 1;
    const mover = unit(game, 'player_a', 'scout', 0, 0);
    const target = unit(game, 'player_b', 'heavy', 1, 0, { attack: 0, moveRange: 0 });
    game.controlPoints = [{ id: 'capture', name: 'Capture', kind: 'supply', q: 2, r: -1, owner: null }];
    expect(attackTarget(game, bus, 'player_a', mover.id, target.id)).toEqual({ ok: true });
    const choice = await choose(game);
    expect(choice).toMatchObject({ type: 'move', payload: { unitId: mover.id } });
    accept(fixture, choice);
    expect(mover.hasMoved).toBe(true);
    expect(game.turn.actionsUsed).toBe(1);
  });

  it('does not activate a fresh unit when AP is exhausted', async () => {
    const { game } = lethalFixture();
    game.turn.actionsUsed = game.config.balance.actionsPerTurn;
    expect(game.units[0].actionSpent).toBe(false);
    expect(await choose(game)).toBeNull();
  });
});

describe('sovereign inward breaches and artillery transport', () => {
  it('approaches a useful nonadjacent blocker and demolishes it with the same last AP', async () => {
    const fixture = breachFixture();
    const { game } = fixture;
    const heavy = game.units[0];
    const blocker = { q: -3, r: 0 };
    expect(hexDistance(heavy, blocker)).toBeGreaterThan(1);
    expect(findReachableCells(game, heavy).some(cell => cell.q >= blocker.q)).toBe(false);
    const first = await choose(game);
    expect(first).toMatchObject({ type: 'move', payload: { unitId: heavy.id } });
    accept(fixture, first);
    expect(hexDistance(heavy, blocker)).toBe(1);
    expect(game.turn.actionsUsed).toBe(1);
    expect(heavy).toMatchObject({ hasMoved: true, hasActed: false, actionSpent: true });
    const second = await choose(game);
    expect(second).toEqual({ type: 'demolish', payload: { unitId: heavy.id, ...blocker } });
    accept(fixture, second);
    expect(game.turn.actionsUsed).toBe(1);
    expect(getTerrain(game, blocker.q, blocker.r)).toBe('plain');
    expect(findReachableCells(game, heavy)).toContainEqual({ q: -2, r: 0 });
  });

  it('demolishes an adjacent inward blocker for free after an engine move exhausted AP', async () => {
    const fixture = breachFixture();
    const { game, bus } = fixture;
    const heavy = game.units[0];
    expect(moveUnit(game, bus, 'player_a', heavy.id, -4, 0)).toEqual({ ok: true });
    expect(game.turn.actionsUsed).toBe(game.config.balance.actionsPerTurn);
    expect(findReachableCells(game, heavy)).not.toContainEqual({ q: -2, r: 0 });
    const choice = await choose(game);
    expect(choice).toEqual({ type: 'demolish', payload: { unitId: heavy.id, q: -3, r: 0 } });
    accept(fixture, choice);
    expect(heavy.hasActed).toBe(true);
    expect(game.turn.actionsUsed).toBe(1);
    expect(getTerrain(game, -3, 0)).toBe('plain');
    expect(findReachableCells(game, heavy)).toContainEqual({ q: -2, r: 0 });
  });

  it('yields the sole useful inward passage so a heavy can reach the breach', async () => {
    const fixture = breachFixture();
    const { game } = fixture;
    const heavy = game.units[0];
    const blocker = { q: -3, r: 0 };
    game.cells.push({ q: -4, r: -1, terrain: 'plain' });
    game.config.playableCells = game.cells.map(({ q, r }) => ({ q, r }));
    game.config.balance.actionsPerTurn = 2;
    game.turn.actionsUsed = 1;
    game.artillery = artilleryStateForRound(game, game.turn.roundNumber);
    heavy.q = -5;
    const ally = unit(game, 'player_a', 'infantry', -4, 0, { moveRange: 1, hasActed: true, actionSpent: true });
    expect(findReachableCells(game, heavy).some(cell => hexDistance(cell, blocker) === 1)).toBe(false);
    expect(findReachableCells(game, heavy).every(cell => hexDistance(cell, { q: 0, r: 0 }) >= 5)).toBe(true);
    const proof: Fixture = { game: structuredClone(game), bus: new EventBus() };
    accept(proof, { type: 'move', payload: { unitId: ally.id, q: -4, r: -1 } });
    accept(proof, { type: 'move', payload: { unitId: heavy.id, q: -4, r: 0 } });
    accept(proof, { type: 'demolish', payload: { unitId: heavy.id, ...blocker } });
    expect(proof.game.turn.actionsUsed).toBe(2);
    const yieldMove = await choose(game);
    expect(yieldMove, `Expected clearance before heavy activation: ${JSON.stringify(yieldMove)}`).toMatchObject({ type: 'move', payload: { unitId: ally.id } });
    accept(fixture, yieldMove);
    expect(game.turn.actionsUsed).toBe(1);
    expect(findReachableCells(game, heavy).some(cell => hexDistance(cell, blocker) === 1)).toBe(true);
    const advance = await choose(game);
    expect(advance).toMatchObject({ type: 'move', payload: { unitId: heavy.id } });
    accept(fixture, advance);
    expect(hexDistance(heavy, blocker)).toBe(1);
    expect(game.turn.actionsUsed).toBe(2);
  });

  it('retreats along the route with fewer repeated artillery ticks over six real rounds', async () => {
    const { game } = scenario();
    game.cells = [-6, 0, 1, 2, 3, 4, 5, 6].map(q => ({ q, r: 0, terrain: 'plain' }));
    game.config.playableCells = game.cells.map(({ q, r }) => ({ q, r }));
    game.config.balance.actionsPerTurn = 1;
    game.config.balance.maxTurns = 50;
    game.config.units.scout.moveRange = 1;
    game.config.annihilation!.artillery = { startRound: 2, intervalRounds: 1, damage: 13, minimumSafeRadius: 0 };
    game.turn.roundNumber = game.turn.turnNumber = 7;
    game.artillery = artilleryStateForRound(game, 7);
    const mover = unit(game, 'player_a', 'scout', 5, 0, { hp: 100, maxHp: 100 });
    unit(game, 'player_b', 'infantry', -6, 0, { hp: 1000, maxHp: 1000, attack: 0, moveRange: 0 });
    expect(game.artillery!.safeRadius).toBe(0);
    const reachable = findReachableCells(game, mover);
    expect(reachable).toHaveLength(2);
    for (const destination of reachable) expect(artilleryStateForRound(game, 8)!.dangerCells).toContainEqual(destination);
    const retreat = async (route?: number[]) => {
      const trial: Fixture = { game: structuredClone(game), bus: new EventBus() };
      const tracked = trial.game.units.find(candidate => candidate.id === mover.id)!;
      for (let step = 0; step < 6; step++) {
        const choice = route
          ? route[step] === tracked.q ? null : { type: 'move' as const, payload: { unitId: tracked.id, q: route[step], r: 0 } }
          : await choose(trial.game);
        if (choice !== null) {
          expect(choice).toMatchObject({ type: 'move', payload: { unitId: tracked.id } });
          accept(trial, choice);
        }
        expect(endTurn(trial.game, trial.bus, 'player_a')).toEqual({ ok: true });
        expect(endTurn(trial.game, trial.bus, 'player_b')).toEqual({ ok: true });
      }
      return {
        hp: tracked.hp,
        ticks: trial.game.events.filter(event => event.type === 'artillery_damage' && event.payload.unitId === tracked.id).length,
      };
    };
    // Both first moves take identical imminent damage; only later transport distinguishes the routes.
    const inward = await retreat([4, 3, 2, 1, 0, 0]);
    const outward = await retreat([6, 5, 4, 3, 2, 1]);
    expect(inward).toEqual({ hp: 48, ticks: 4 });
    expect(outward).toEqual({ hp: 22, ticks: 6 });
    expect(await retreat()).toEqual(inward);
  });
});

describe('sovereign support healing', () => {
  it('self-heals a wounded support even with healRange zero', async () => {
    const fixture = scenario();
    const { game } = fixture;
    game.config.units.support.healRange = 0;
    const support = unit(game, 'player_a', 'support', 0, 0, { hp: 10, hasMoved: true });
    idleUnit(game, 'player_b', 6, 0);
    const choice = await choose(game);
    expect(choice).toEqual({ type: 'heal', payload: { supportId: support.id, targetId: support.id } });
    accept(fixture, choice);
    expect(support.hp).toBeGreaterThan(10);
  });

  it.each([
    { healRange: 3, attackRange: 1, distance: 3, heals: true },
    { healRange: 0, attackRange: 3, distance: 1, heals: false },
    { healRange: undefined, attackRange: 2, distance: 2, heals: true },
  ])('uses configured healRange (or its engine fallback): $healRange/$attackRange', async spec => {
    const fixture = scenario();
    const { game } = fixture;
    game.config.units.support.healRange = spec.healRange;
    game.config.units.support.attackRange = spec.attackRange;
    const support = unit(game, 'player_a', 'support', 0, 0, { hasMoved: true });
    const target = idleUnit(game, 'player_a', spec.distance, 0);
    target.hp = 1;
    idleUnit(game, 'player_b', -6, 0);
    const choice = await choose(game);
    if (!spec.heals) {
      expect(choice).toBeNull();
      return;
    }
    expect(choice).toEqual({ type: 'heal', payload: { supportId: support.id, targetId: target.id } });
    accept(fixture, choice);
    expect(target.hp).toBeGreaterThan(1);
  });

  it.each(['support', 'target'] as const)('does not heal when the %s is in artillery danger', async danger => {
    const fixture = scenario();
    const { game } = fixture;
    game.config.annihilation!.artillery = { startRound: 2, intervalRounds: 1, damage: 17, minimumSafeRadius: 0 };
    game.turn.roundNumber = game.turn.turnNumber = 3;
    game.artillery = artilleryStateForRound(game, 3);
    unit(game, 'player_a', 'support', danger === 'support' ? 5 : 4, 0, { hasMoved: true });
    const target = idleUnit(game, 'player_a', danger === 'target' ? 5 : 4, 0);
    target.hp = 1;
    idleUnit(game, 'player_b', -6, 0);
    expect(game.artillery!.safeRadius).toBe(4);
    expect(await choose(game)).toBeNull();
  });
});

describe('sovereign movement uses authoritative topology', () => {
  it.each(['blocker override', 'water override', 'hole', 'friendly occupant', 'enemy occupant'] as const)(
    'cannot traverse a %s, even toward a valuable unreachable point', async obstruction => {
      const fixture = scenario();
      const { game } = fixture;
      game.cells = Array.from({ length: 8 }, (_, index) => ({ q: index - 3, r: 0, terrain: 'plain' as const }));
      const mover = unit(game, 'player_a', 'scout', -3, 0, { attack: 0, moveRange: 6, hasActed: true, actionSpent: true });
      idleUnit(game, 'player_b', 4, 0);
      game.controlPoints = [
        { id: 'reachable', name: 'Reachable', kind: 'repair', q: -2, r: 0, owner: null },
        { id: 'unreachable', name: 'Unreachable', kind: 'supply', q: 2, r: 0, owner: null },
      ];
      game.config.balance.controlPointTypes!.supply.income = 1000;
      game.config.balance.controlPointTypes!.repair.income = 1;
      if (obstruction === 'hole') {
        game.cells = game.cells.filter(cell => cell.q !== -1);
        game.map.terrainCells = [{ q: -1, r: 0, terrain: 'plain' }]; // An overlay must not create a playable cell.
      } else if (obstruction.endsWith('override')) {
        game.map.terrainCells = [{ q: -1, r: 0, terrain: obstruction.startsWith('water') ? 'water' : 'blocker' }];
      } else {
        idleUnit(game, obstruction === 'friendly occupant' ? 'player_a' : 'player_b', -1, 0);
      }
      invalidateGameIndex(game);
      expect(findReachableCells(game, mover)).toEqual([{ q: -2, r: 0 }]);
      const choice = await choose(game);
      expect(choice).toMatchObject({ type: 'move', payload: { unitId: mover.id } });
      if (choice?.type !== 'move') return;
      expect(findReachableCells(game, mover)).toContainEqual({ q: choice.payload.q, r: choice.payload.r });
      accept(fixture, choice);
    },
  );

  it('can traverse a plain terrainCells override of a stale blocker cell', async () => {
    const fixture = scenario();
    const { game } = fixture;
    game.cells = [-3, -2, -1, 0, 1, 2, 3].map(q => ({ q, r: 0, terrain: q === -1 ? 'blocker' : 'plain' }));
    game.map.terrainCells = [{ q: -1, r: 0, terrain: 'plain' }];
    const mover = unit(game, 'player_a', 'scout', -3, 0, { attack: 0, moveRange: 5, hasActed: true, actionSpent: true });
    idleUnit(game, 'player_b', 3, 0);
    game.controlPoints = [{ id: 'across-opening', name: 'Across opening', kind: 'supply', q: 2, r: 0, owner: null }];
    expect(getTerrain(game, -1, 0)).toBe('plain');
    const choice = await choose(game);
    expect(choice).toMatchObject({ type: 'move', payload: { unitId: mover.id } });
    accept(fixture, choice);
    expect(mover.q).toBeGreaterThanOrEqual(-1);
  });
});

describe('sovereign deployment', () => {
  it.each([
    { discount: 18, supplies: 23, expectedCost: 23 },
    { discount: 99, supplies: 0, expectedCost: 0 },
  ])('deploys only from owned deployable CPs and charges the clamped discount: $discount', async spec => {
    const fixture = deploymentFixture(spec.discount, spec.supplies);
    const { game } = fixture;
    const choice = await choose(game);
    expect(choice).toMatchObject({ type: 'deploy', payload: { unitType: 'scout', fromId: 'owned-deployable' } });
    if (choice?.type !== 'deploy') return;
    const origin = game.controlPoints.find(point => point.id === choice.payload.fromId)!;
    expect(hexDistance(origin, choice.payload)).toBe(1);
    expect(game.units.some(u => u.alive && u.q === choice.payload.q && u.r === choice.payload.r)).toBe(false);
    accept(fixture, choice);
    expect(game.resources.player_a!.supplies).toBe(spec.supplies - spec.expectedCost);
    expect(game.events.findLast(event => event.type === 'deploy')!.payload.cost).toBe(spec.expectedCost);
  });

  it.each(['unaffordable', 'not owned', 'not deployable'] as const)('does not deploy when the only eligible base is %s', async reason => {
    const { game } = deploymentFixture();
    if (reason === 'unaffordable') game.resources.player_a!.supplies = 22;
    if (reason === 'not owned') game.controlPoints[0].owner = null;
    if (reason === 'not deployable') game.config.balance.controlPointTypes!.forward_base.canDeploy = false;
    expect(await choose(game)).toBeNull();
  });

  it('does not veto a useful endangered reinforcement when the sole existing unit survives', async () => {
    const fixture = deploymentFixture(99, 0);
    const { game } = fixture;
    game.cells = [-1, 0, 3, 4, 5].map(q => ({ q, r: 0, terrain: 'plain' }));
    game.config.playableCells = game.cells.map(({ q, r }) => ({ q, r }));
    game.controlPoints = [{ ...game.controlPoints[0], q: 3, r: 0 }];
    game.config.balance.actionsPerTurn = 1;
    game.config.units.scout.hp = 17;
    game.config.units.scout.attackRange = 1;
    game.config.annihilation!.artillery = { startRound: 2, intervalRounds: 1, damage: 17, minimumSafeRadius: 0 };
    game.turn.roundNumber = game.turn.turnNumber = 3;
    game.artillery = artilleryStateForRound(game, 3);
    const [survivor, target] = game.units;
    survivor.q = 0;
    Object.assign(target, { q: 5, hp: 1, defense: 0 });
    idleUnit(game, 'player_b', -1, 0);
    const deploy: Choice = { type: 'deploy', payload: { unitType: 'scout', fromId: game.controlPoints[0].id, q: 4, r: 0 } };
    expect(game.units.filter(candidate => candidate.alive && candidate.owner === 'player_a')).toHaveLength(1);
    expect(game.artillery!.dangerCells).not.toContainEqual({ q: 4, r: 0 });
    expect(artilleryStateForRound(game, 4)!.dangerCells).toContainEqual({ q: 4, r: 0 });
    // Prove the free reinforcement earns a kill without risking elimination before checking policy.
    const proof: Fixture = { game: structuredClone(game), bus: new EventBus() };
    accept(proof, deploy);
    const reinforcement = proof.game.units.at(-1)!;
    accept(proof, { type: 'attack', payload: { attackerId: reinforcement.id, targetId: target.id } });
    expect(proof.game.units.find(candidate => candidate.id === target.id)!.alive).toBe(false);
    expect(proof.game.turn.actionsUsed).toBe(1);
    expect(endTurn(proof.game, proof.bus, 'player_a')).toEqual({ ok: true });
    expect(endTurn(proof.game, proof.bus, 'player_b')).toEqual({ ok: true });
    expect(reinforcement.alive).toBe(false);
    expect(proof.game.units.find(candidate => candidate.id === survivor.id)).toMatchObject({ alive: true, hp: survivor.hp });
    expect(proof.game.players.player_a!.status).toBe('active');
    const choice = await choose(game);
    expect(choice).toEqual(deploy);
    accept(fixture, choice);
    expect(game.resources.player_a!.supplies).toBe(0);
  });

  it('attacks with a newly deployed unit even when deployment consumes the last AP', async () => {
    const fixture = deploymentFixture();
    const { game } = fixture;
    game.config.balance.actionsPerTurn = 1;
    const target = game.units.find(u => u.owner === 'player_b')!;
    target.q = 2;
    target.hp = 1;
    invalidateGameIndex(game);
    const first = await choose(game);
    expect(first).toMatchObject({ type: 'deploy', payload: { unitType: 'scout', fromId: 'owned-deployable' } });
    accept(fixture, first);
    const deployed = game.units.at(-1)!;
    expect(deployed).toMatchObject({ hasMoved: true, hasActed: false, actionSpent: true });
    expect(game.turn.actionsUsed).toBe(1);
    const second = await choose(game);
    expect(second).toEqual({ type: 'attack', payload: { attackerId: deployed.id, targetId: target.id } });
    accept(fixture, second);
    expect(game.turn.actionsUsed).toBe(1);
    expect(target.alive).toBe(false);
  });
});

describe('sovereign future configuration and real-engine selfplay', () => {
  it.each(['scout', 'ranger', 'support'] as const)('uses altered %s attack/range/defense/HP, not a hard-coded unit table', async type => {
    const fixture = scenario();
    const { game } = fixture;
    game.mapId = 'future-unregistered-map';
    Object.assign(game.config.units[type], { hp: 213, attack: 71, defense: 19, attackRange: 4, moveRange: 0, cost: 137 });
    const attacker = unit(game, 'player_a', type, 0, 0);
    const target = unit(game, 'player_b', 'heavy', 4, 0, { hp: 32, defense: 23, attack: 0, moveRange: 0 });
    game.config.balance.damageVarianceRange = 11;
    game.config.balance.minimumDamage = 7;
    const choice = await choose(game);
    expect(choice).toEqual({ type: 'attack', payload: { attackerId: attacker.id, targetId: target.id } });
    accept(fixture, choice);
    expect(target.alive).toBe(false);
  });

  it('honors a shortened attack range instead of assuming the default ranger range', async () => {
    const fixture = scenario();
    const { game } = fixture;
    game.config.units.ranger.attackRange = 0;
    game.config.units.ranger.moveRange = 0;
    unit(game, 'player_a', 'ranger', 0, 0);
    unit(game, 'player_b', 'scout', 1, 0, { hp: 1, attack: 0, moveRange: 0 });
    expect(await choose(game)).toBeNull();
  });

  it.each([1, 2, 3])('accepts all decisions under independent future stat configuration %i', async variant => {
    const config = structuredClone(getMapConfig(baseMapId));
    config.name = `Future configuration ${variant}`;
    Object.values(config.units).forEach((spec, index) => {
      Object.assign(spec, {
        hp: 37 + index * 17 + variant * 11,
        attack: (index * 13 + variant * 7) % 59,
        defense: (index * 7 + variant * 3) % 23,
        moveRange: (index + variant) % 5,
        attackRange: (index * 2 + variant) % 5,
        cost: 9 + index * 19 + variant * 3,
        canCapture: (index + variant) % 2 === 0,
      });
    });
    config.units.support.healPower = 13 + variant * 7;
    config.units.support.healRange = variant + 1;
    config.balance.actionsPerTurn = variant;
    config.balance.damageVarianceRange = variant * 2;
    config.balance.minimumDamage = variant * 3;
    config.balance.healVarianceRange = variant;
    config.balance.startingSupplies = 89;
    config.balance.baseIncome = variant * 5;
    config.balance.adjudicationWeights = {
      enemyHqDamage: 0, ownHqHp: 0, controlPoint: variant * 3,
      armyValue: variant / 2, supplies: 0.3, killValue: variant / 3,
    };
    config.balance.controlPointTypes!.forward_base.deployDiscount = variant * 7;
    config.balance.controlPointTypes!.supply.canDeploy = variant !== 2;
    config.annihilation!.artillery = { startRound: 2, intervalRounds: variant, damage: 11 + variant * 9, minimumSafeRadius: 0 };
    await selfplay(startFixture(`future-sovereign-${variant}`, 2, config), 4);
  }, 60000);

  const mapSeats = annihilationMaps.flatMap(map => map.preview.supportedPlayerCounts.map(players => ({ mapId: map.id, players })));
  it('discovers at least one annihilation map for the smoke matrix', () => {
    expect(mapSeats.length).toBeGreaterThan(0);
  });

  it.each(mapSeats)('finishes bounded selfplay with zero rejected choices: $mapId / $players players', async ({ mapId, players }) => {
    // Six rounds cover ordinary turns and the first shrink, not a strength benchmark.
    await selfplay(startFixture(mapId, players), 6);
  }, 120000);
});
