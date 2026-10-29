import { describe, expect, it, vi } from 'vitest';
import parallax, {
  applySearchAction, createSearchState, damageProfile, finishSearchTurn, reachablePositions,
} from '../../algorithms/builtin/parallax.mjs';
import { sanitizeGameForResponse } from '../../src/api/auth.js';
import { createInitialGame, createPlayer, createUnitFromConfig } from '../../src/state/store.js';
import { EventBus } from '../../src/events/bus.js';
import { attackTarget, computeDamage, healTarget } from '../../src/engine/combat.js';
import { deployUnit } from '../../src/engine/deployment.js';
import { demolishTerrain } from '../../src/engine/demolition.js';
import { buildAdjudicationScores, endTurn } from '../../src/engine/engine.js';
import { invalidateGameIndex } from '../../src/engine/gameIndex.js';
import { hexDistance, hexKey, hexNeighbors } from '../../src/engine/hex.js';
import { moveUnit } from '../../src/engine/units.js';
import { findReachableCells, getTerrain, isDeployable } from '../../src/engine/validation.js';
import type { Result } from '../../src/engine/result.js';
import type { GameState, PlayerId, Unit, UnitType } from '../../src/types.js';

type View = Omit<GameState, 'rngState' | 'tokens' | 'hostToken' | 'idempotency'>;
type Model = ReturnType<typeof createSearchState>;
type Action =
  | { type: 'move' | 'demolish'; payload: { unitId: string; q: number; r: number } }
  | { type: 'attack'; payload: { attackerId: string; targetId: string } }
  | { type: 'heal'; payload: { supportId: string; targetId: string } }
  | { type: 'deploy'; payload: { unitType: UnitType; fromId: string; q: number; r: number; id?: string } };

const A = 'player_a';
const B = 'player_b';
const C = 'player_c';
const noUtils = new Proxy({}, {
  get(_target, property) { throw new Error(`Unexpected strategy utility access: ${String(property)}`); },
});

function viewOf(game: GameState): View {
  return sanitizeGameForResponse(game) as View;
}

function gameOn(mapId = 'default') {
  // The map loader caches configuration; never mutate its shared objects.
  const game = structuredClone(createInitialGame(`parallax-test-${mapId}`, mapId));
  expect(game.config.mode).toBe('standard');
  game.rngState = 123456789;
  game.units.forEach((unit, index) => { unit.id = `initial-${index}`; });
  Object.values(game.headquarters).forEach(hq => { hq.id = `hq-${hq.owner}`; });
  return { game, bus: new EventBus() };
}

function arena() {
  const setup = gameOn();
  const { game } = setup;
  game.cells = game.cells.filter(p => hexDistance(p, { q: 0, r: 0 }) <= 4)
    .map(p => ({ q: p.q, r: p.r, terrain: 'plain' }));
  game.map.radius = game.config.radius = 4;
  game.map.terrainCells = [];
  game.config.terrainCells = [];
  game.config.playableCells = game.cells.map(({ q, r }) => ({ q, r }));
  game.units = [];
  game.controlPoints = [];
  Object.assign(game.headquarters[A]!, { q: -4, r: 0 });
  Object.assign(game.headquarters[B]!, { q: 4, r: 0 });
  game.resources[A]!.supplies = game.resources[B]!.supplies = 0;
  Object.assign(game.config.balance, {
    baseIncome: 0, actionsPerTurn: 2, damageVarianceRange: 0, healVarianceRange: 0, maxTurns: 6,
  });
  delete game.config.balance.comebackSupply;
  game.config.balance.controlPointTypes = {
    supply: { income: 13, deployDiscount: 0, repairAmount: 0 },
    forward_base: { income: 4, deployDiscount: 8, repairAmount: 0 },
    repair: { income: 6, deployDiscount: 0, repairAmount: 10 },
  };
  invalidateGameIndex(game);
  return setup;
}

function addUnit(game: GameState, id: string, overrides: Partial<Unit> = {}): Unit {
  const unit = Object.assign(createUnitFromConfig(
    game.config, overrides.owner ?? A, overrides.type ?? 'infantry', overrides.q ?? 0, overrides.r ?? 0,
  ), { id }, overrides);
  game.units.push(unit);
  invalidateGameIndex(game);
  return unit;
}

function decide(game: GameState): Action | null {
  return parallax.decide(viewOf(game), noUtils, { owner: game.turn.currentPlayerId }) as Action | null;
}

function execute(game: GameState, bus: EventBus, action: Action | null): Unit | undefined {
  const owner = game.turn.currentPlayerId!;
  expect(game.phase).toBe('active');
  expect(game.players[owner]?.status).toBe('active');
  let result: Result | Result<Unit>;
  if (action === null) result = endTurn(game, bus, owner);
  else switch (action.type) {
    case 'move':
      result = moveUnit(game, bus, owner, action.payload.unitId, action.payload.q, action.payload.r);
      break;
    case 'attack':
      result = attackTarget(game, bus, owner, action.payload.attackerId, action.payload.targetId);
      break;
    case 'heal':
      result = healTarget(game, bus, owner, action.payload.supportId, action.payload.targetId);
      break;
    case 'demolish':
      result = demolishTerrain(game, bus, owner, action.payload.unitId, action.payload.q, action.payload.r);
      break;
    case 'deploy':
      result = deployUnit(game, bus, owner, action.payload.unitType, action.payload.fromId, action.payload.q, action.payload.r);
      break;
    default: throw new Error(`Unknown action: ${JSON.stringify(action)}`);
  }
  expect(result, `round=${game.turn.roundNumber}, owner=${owner}, action=${JSON.stringify(action)}`).toMatchObject({ ok: true });
  return result.ok && result.data ? result.data : undefined;
}

const sortedIds = (entities: { id: string }[]) => entities.map(e => e.id).sort();

function expectEquivalent(model: Model, game: GameState) {
  expect(model.owner).toBe(game.turn.currentPlayerId);
  expect(model.round).toBe(game.turn.roundNumber);
  expect(model.ap).toBe(game.turn.actionsUsed);
  expect(model.acted).toEqual(game.turn.actedThisRound);
  expect(model.terminal).toBe(game.phase !== 'active');
  expect(model.winner).toBe(game.winner);
  expect(model.active).toEqual(game.turn.turnOrder.filter(id => game.players[id]?.status === 'active'));
  const liveUnits = game.units.filter(u => u.alive);
  expect(sortedIds(model.units)).toEqual(sortedIds(liveUnits));
  for (const unit of liveUnits) {
    const actual = model.units.find((u: Unit) => u.id === unit.id)!;
    const { healPower, ...required } = unit;
    expect(actual).toMatchObject(required);
    expect(actual.healPower).toBe(healPower); // Absent optional fields and undefined are equivalent.
    expect(model.geo.cells[actual.p]).toMatchObject({ q: unit.q, r: unit.r });
  }
  const liveHqs = Object.values(game.headquarters).filter(h => h.alive);
  expect(sortedIds(model.hqs)).toEqual(sortedIds(liveHqs));
  for (const hq of liveHqs) {
    const actual = model.hqs.find((h: { id: string }) => h.id === hq.id)!;
    expect(actual).toMatchObject(hq);
    expect(model.geo.cells[actual.p]).toMatchObject({ q: hq.q, r: hq.r });
  }
  expect(model.points).toHaveLength(game.controlPoints.length);
  for (const point of game.controlPoints) {
    expect(model.points.find((p: { id: string }) => p.id === point.id)).toMatchObject(point);
  }
  for (const id of game.turn.turnOrder) {
    expect(model.supplies[id]).toBe(game.resources[id]!.supplies);
    // Search need not retain event/audit counters; these four stats affect adjudication.
    for (const stat of ['headquartersDamage', 'killValue', 'controlHold', 'controlHoldRounds'] as const) {
      expect(model.stats[id][stat]).toBeCloseTo(game.players[id]!.stats[stat], 9);
    }
  }
  game.cells.forEach((cell, index) => {
    expect(model.geo.terrain[index]).toBe(getTerrain(game, cell.q, cell.r));
  });
}

function applyBoth(game: GameState, bus: EventBus, model: Model, action: Action | null) {
  const deployed = execute(game, bus, action);
  if (action === null) finishSearchTurn(model);
  else {
    // The engine allocates UUIDs; bind that ID only in the differential model.
    const modeled = action.type === 'deploy'
      ? { ...action, payload: { ...action.payload, id: deployed!.id } } : action;
    applySearchAction(model, modeled);
  }
  expectEquivalent(model, game);
  return deployed;
}

function expectReachable(model: Model, game: GameState, unit: Unit) {
  const searchUnit = model.units.find((u: Unit) => u.id === unit.id)!;
  const indices: number[] = reachablePositions(model, searchUnit);
  expect(new Set(indices).size).toBe(indices.length);
  expect(indices.every(index => Number.isInteger(index) && index >= 0 && index < game.cells.length)).toBe(true);
  const actual = indices.map(index => hexKey(model.geo.cells[index])).sort();
  expect(actual).toEqual(findReachableCells(game, unit).map(hexKey).sort());
  expect(actual).not.toContain(hexKey(unit));
  return actual;
}

function freezeDeep(value: unknown): void {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
  Object.values(value).forEach(freezeDeep);
  Object.freeze(value);
}

function onlyWeight(game: GameState, weights: Partial<GameState['config']['balance']['adjudicationWeights']>) {
  game.config.balance.adjudicationWeights = {
    enemyHqDamage: 0, ownHqHp: 0, controlPoint: 0, armyValue: 0, supplies: 0, killValue: 0,
    controlPointFlowRatio: 0.7, ...weights,
  };
}

function finalPlayer(game: GameState, round = 2) {
  game.config.balance.maxTurns = round;
  game.turn.roundNumber = game.turn.turnNumber = round;
  game.turn.currentOwner = game.turn.currentPlayerId = B;
  game.turn.actedThisRound = [A];
}

describe('parallax search geometry: differential against the rule engine', () => {
  it.each(['default', 'dual-lanes', 'breach', 'whirlpool'])('matches reachable sets on standard map %s', mapId => {
    const { game } = gameOn(mapId);
    const open = game.cells.filter(c => isDeployable(game, c.q, c.r));
    for (let index = 0; index < 4; index++) {
      const pos = open[Math.floor(index * (open.length - 1) / 3)];
      addUnit(game, `probe-${index}`, { ...pos, moveRange: index + 1 });
    }
    const model = createSearchState(viewOf(game));
    for (const unit of game.units.filter(u => u.alive)) expectReachable(model, game, unit);
  });

  it.each([0, 1, 2, 4, 8])('handles holes, last terrain override, units and HQ blockers at range %i', moveRange => {
    const { game } = arena();
    const mover = addUnit(game, 'mover', { moveRange });
    addUnit(game, 'friendly', { q: 1, r: 0 });
    addUnit(game, 'enemy', { owner: B, q: 0, r: 1 });
    addUnit(game, 'dead', { owner: B, q: -1, r: 1, hp: 0, alive: false });
    Object.assign(game.headquarters[A]!, { q: -1, r: 0 });
    Object.assign(game.headquarters[B]!, { q: 0, r: -1, alive: false, hp: 0 });
    game.cells = game.cells.filter(p => !(p.q === 2 && p.r === -1));
    game.cells.find(p => p.q === 1 && p.r === -1)!.terrain = 'water';
    game.map.terrainCells = [
      { q: 1, r: -1, terrain: 'blocker' }, { q: 1, r: -1, terrain: 'plain' },
      { q: 2, r: 0, terrain: 'water' }, { q: 0, r: -2, terrain: 'blocker' },
      { q: 2, r: -1, terrain: 'plain' }, // An override must not fill a map hole.
    ];
    invalidateGameIndex(game);
    const model = createSearchState(viewOf(game));
    const reachable = expectReachable(model, game, mover);
    for (const key of ['1,0', '0,1', '-1,0', '2,-1', '2,0', '0,-2']) expect(reachable).not.toContain(key);
    if (moveRange > 0) for (const key of ['-1,1', '0,-1', '1,-1']) expect(reachable).toContain(key);
  });

  it('cannot jump a hole or occupied chokepoint despite being within hex distance', () => {
    const { game } = arena();
    game.cells = [-4, -3, -2, -1, 0, 2, 3, 4].map(q => ({ q, r: 0, terrain: 'plain' as const }));
    const mover = addUnit(game, 'mover', { q: -2, moveRange: 8 });
    addUnit(game, 'chokepoint', { q: -1, owner: B });
    const reachable = expectReachable(createSearchState(viewOf(game)), game, mover);
    expect(reachable).toEqual(['-3,0']);
  });
});

describe('parallax damage distributions and exact action effects', () => {
  it.each([
    { attack: 20, defense: 5, variance: 2, minimum: 1, hp: 14, kill: 4 / 5 },
    { attack: 7, defense: 5, variance: 3, minimum: 2, hp: 3, kill: 3 / 7 },
    { attack: 1, defense: 20, variance: 3, minimum: 4, hp: 3, kill: 1 },
    { attack: 30, defense: 8, variance: 4, minimum: 1, hp: 100, kill: 0 },
    { attack: 28, defense: 6, variance: 0, minimum: 1, hp: 22, kill: 1 },
  ])('enumerates discrete damage, clipping and kill probability: $attack/$defense/$variance/$hp', scenario => {
    const { game } = arena();
    Object.assign(game.config.balance, { damageVarianceRange: scenario.variance, minimumDamage: scenario.minimum });
    const attacker = addUnit(game, 'attacker', { attack: scenario.attack });
    const target = addUnit(game, 'target', { q: 1, owner: B, defense: scenario.defense, hp: scenario.hp });
    const model = createSearchState(viewOf(game));
    const profile = damageProfile(model, model.units[0], model.units[1]);
    // Enumerate every offset through the authoritative damage function, with variance zero.
    // RNG is only advanced inside the engine; the algorithm receives no seed or state.
    game.config.balance.damageVarianceRange = 0;
    const outcomes = Array.from({ length: scenario.variance * 2 + 1 }, (_, i) =>
      computeDamage(game, attacker.attack + i - scenario.variance, target.defense));
    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(profile.mean).toBeCloseTo(mean(outcomes), 10);
    expect(profile.actual).toBeCloseTo(mean(outcomes.map(damage => Math.min(target.hp, damage))), 10);
    expect(profile.kill).toBeCloseTo(scenario.kill, 10);
    expect(profile.low).toBe(Math.min(...outcomes));
    expect(profile.high).toBe(Math.max(...outcomes));
  });

  it.each(['low', 'mean', 'high'] as const)('applies the %s damage branch from its public distribution', roll => {
    const { game } = arena();
    game.config.balance.damageVarianceRange = 3;
    addUnit(game, 'attacker', { attack: 19 });
    addUnit(game, 'target', { q: 1, owner: B, defense: 5, hp: 70 });
    const model = createSearchState(viewOf(game));
    const profile = damageProfile(model, model.units[0], model.units[1]);
    applySearchAction(model, { type: 'attack', payload: { attackerId: 'attacker', targetId: 'target' } }, roll);
    expect(model.units[1].hp).toBeCloseTo(70 - profile[roll], 10);
    expect(model.ap).toBe(1);
    expect(model.units[0]).toMatchObject({ actionSpent: true, hasActed: true });
  });

  it.each(['move-first', 'attack-first'])('charges one activation for both actions: %s', order => {
    const { game, bus } = arena();
    game.config.balance.actionsPerTurn = 1;
    addUnit(game, 'actor', { attack: 29, attackRange: 2 });
    addUnit(game, 'enemy', { q: 1, r: 0, owner: B, defense: 7, hp: 90 });
    const model = createSearchState(viewOf(game));
    const move: Action = { type: 'move', payload: { unitId: 'actor', q: 0, r: 1 } };
    const attack: Action = { type: 'attack', payload: { attackerId: 'actor', targetId: 'enemy' } };
    for (const action of order === 'move-first' ? [move, attack] : [attack, move]) applyBoth(game, bus, model, action);
    expect(model.ap).toBe(1);
    expect(model.units.find((u: Unit) => u.id === 'enemy').hp).toBe(68);
    applyBoth(game, bus, model, null);
    expect(model.units.find((u: Unit) => u.id === 'actor')).toMatchObject({ hasMoved: false, hasActed: false, actionSpent: false });
  });

  it.each([0, 8, 1000])('deployment discount %i preserves unit value and permits a free attack, not movement', discount => {
    const { game, bus } = arena();
    game.config.balance.actionsPerTurn = 1;
    game.config.balance.controlPointTypes!.forward_base.deployDiscount = discount;
    game.controlPoints = [{ id: 'base', name: 'base', q: 0, r: 0, owner: A, kind: 'forward_base' }];
    const cost = game.config.units.scout.cost;
    game.resources[A]!.supplies = Math.max(0, cost - discount);
    addUnit(game, 'enemy', { owner: B, q: 2, hp: 100 });
    const model = createSearchState(viewOf(game));
    const deployed = applyBoth(game, bus, model, {
      type: 'deploy', payload: { unitType: 'scout', fromId: 'base', q: 1, r: 0 },
    })!;
    expect(deployed).toMatchObject({ cost, hasMoved: true, hasActed: false, actionSpent: true });
    expect(model.supplies[A]).toBe(0);
    expect(moveUnit(game, bus, A, deployed.id, 1, -1)).toMatchObject({ ok: false, code: 'invalid_move' });
    expectEquivalent(model, game);
    applyBoth(game, bus, model, { type: 'attack', payload: { attackerId: deployed.id, targetId: 'enemy' } });
    expect(model.ap).toBe(1);
  });

  it.each([
    { label: 'self', self: true, hp: 20, q: 0, healRange: 0 },
    { label: 'independent range', self: false, hp: 20, q: 2, healRange: 3 },
    { label: 'maxHp clipping', self: false, hp: 97, q: 1, healRange: 2 },
  ])('heals $label exactly with an exhausted AP budget', scenario => {
    const { game, bus } = arena();
    game.config.units.support.healRange = scenario.healRange;
    const support = addUnit(game, 'support', {
      type: 'support', hp: scenario.self ? scenario.hp : 100, maxHp: 100, attackRange: 1,
      healPower: 28, hasMoved: true, actionSpent: true,
    });
    const target = scenario.self ? support : addUnit(game, 'patient', { q: scenario.q, hp: scenario.hp, maxHp: 100 });
    game.turn.actionsUsed = game.config.balance.actionsPerTurn;
    const model = createSearchState(viewOf(game));
    applyBoth(game, bus, model, { type: 'heal', payload: { supportId: support.id, targetId: target.id } });
    expect(target.hp).toBe(Math.min(100, scenario.hp + 28));
    expect(model.ap).toBe(game.config.balance.actionsPerTurn);
  });

  it('records only the killed unit cost and clears its occupied cell on an overkill', () => {
    const { game, bus } = arena();
    const attacker = addUnit(game, 'attacker', { attack: 50, moveRange: 2 });
    addUnit(game, 'victim', { q: 1, owner: B, hp: 3, defense: 10, cost: 77 });
    const model = createSearchState(viewOf(game));
    applyBoth(game, bus, model, { type: 'attack', payload: { attackerId: 'attacker', targetId: 'victim' } });
    expect(model.stats[A].killValue).toBe(77);
    expect(model.stats[A].headquartersDamage).toBe(0);
    expect(expectReachable(model, game, attacker)).toContain('1,0');
    applyBoth(game, bus, model, { type: 'move', payload: { unitId: 'attacker', q: 1, r: 0 } });
  });

  it('demolishes an overlay blocker and then moves through it without another activation', () => {
    const { game, bus } = arena();
    const heavy = addUnit(game, 'heavy', { type: 'heavy', moveRange: 2 });
    game.map.terrainCells = [{ q: 1, r: 0, terrain: 'blocker' }];
    invalidateGameIndex(game);
    const model = createSearchState(viewOf(game));
    expect(expectReachable(model, game, heavy)).not.toContain('1,0');
    applyBoth(game, bus, model, { type: 'demolish', payload: { unitId: 'heavy', q: 1, r: 0 } });
    expect(expectReachable(model, game, heavy)).toContain('1,0');
    applyBoth(game, bus, model, { type: 'move', payload: { unitId: 'heavy', q: 1, r: 0 } });
    expect(model.ap).toBe(1);
  });
});

describe('parallax turn boundaries, economics and victory', () => {
  it('captures only at finishTurn, cannot deploy early, and earns income on its next turn', () => {
    const { game, bus } = arena();
    game.config.balance.deployFromHq = false;
    game.resources[A]!.supplies = 100;
    game.controlPoints = [{ id: 'new-base', name: 'new base', kind: 'forward_base', q: 1, r: 0, owner: null }];
    addUnit(game, 'capturer', { hasActed: true, actionSpent: true });
    game.turn.actionsUsed = 1;
    const model = createSearchState(viewOf(game));
    applyBoth(game, bus, model, { type: 'move', payload: { unitId: 'capturer', q: 1, r: 0 } });
    expect(model.points[0].owner).toBeNull();
    expect(deployUnit(game, bus, A, 'scout', 'new-base', 2, 0)).toMatchObject({ ok: false, code: 'invalid_deploy' });
    expect(decide(game)).toBeNull();
    applyBoth(game, bus, model, null);
    expect(model.points[0].owner).toBe(A);
    expect(model.supplies[A]).toBe(100);
    applyBoth(game, bus, model, null);
    expect(model.supplies[A]).toBe(104);
    expect(model.stats[A]).toMatchObject({ controlHold: 1, controlHoldRounds: 1 });
    applyBoth(game, bus, model, { type: 'deploy', payload: { unitType: 'scout', fromId: 'new-base', q: 2, r: 0 } });
  });

  it.each(['cannot-capture', 'dead', 'other-owner'])('does not capture with a %s occupant', situation => {
    const { game, bus } = arena();
    game.controlPoints = [{ id: 'point', name: 'point', q: 0, r: 0, owner: null }];
    addUnit(game, 'occupant', {
      canCapture: situation !== 'cannot-capture', alive: situation !== 'dead',
      hp: situation === 'dead' ? 0 : 100, owner: situation === 'other-owner' ? B : A,
    });
    const model = createSearchState(viewOf(game));
    applyBoth(game, bus, model, null);
    expect(model.points[0].owner).toBeNull();
  });

  it('pays typed and fallback income; repairs only the incoming owner once, capped at maxHp', () => {
    const { game, bus } = arena();
    game.config.balance.baseIncome = 7;
    game.config.balance.controlPointIncome = 9;
    game.controlPoints = [
      { id: 'repair-1', name: 'repair 1', kind: 'repair', q: 0, r: 0, owner: B },
      { id: 'repair-2', name: 'repair 2', kind: 'repair', q: 1, r: 0, owner: B },
      { id: 'supply', name: 'supply', kind: 'supply', q: -2, r: 0, owner: B },
      { id: 'legacy', name: 'legacy', q: 2, r: -2, owner: B },
    ];
    addUnit(game, 'damaged', { q: 0, r: 1, owner: B, hp: 40, maxHp: 100 });
    addUnit(game, 'almost-full', { q: 1, r: -1, owner: B, hp: 97, maxHp: 100 });
    addUnit(game, 'outside', { q: 3, r: -1, owner: B, hp: 40, maxHp: 100 });
    addUnit(game, 'wrong-owner', { q: -1, r: 1, hp: 40, maxHp: 100 });
    const model = createSearchState(viewOf(game));
    applyBoth(game, bus, model, null);
    expect(model.supplies[B]).toBe(7 + 6 + 6 + 13 + 9);
    expect(game.units.map(u => u.hp)).toEqual([50, 100, 40, 40]);
    expect(model.stats[B].controlHoldRounds).toBe(0);
  });

  it('waits for the final player, captures and counts flow before adjudication, and pays no final income', () => {
    const { game, bus } = arena();
    onlyWeight(game, { controlPoint: 100 });
    game.config.balance.baseIncome = 11;
    game.config.balance.maxTurns = game.turn.roundNumber = game.turn.turnNumber = 2;
    game.controlPoints = [{ id: 'last', name: 'last', q: 0, r: 0, owner: null }];
    addUnit(game, 'capturer', { owner: B });
    const model = createSearchState(viewOf(game));
    applyBoth(game, bus, model, null);
    expect(model.terminal).toBe(false);
    const supplies = { ...model.supplies };
    applyBoth(game, bus, model, null);
    expect(model.points[0].owner).toBe(B);
    expect(model.stats[B]).toMatchObject({ controlHold: 1, controlHoldRounds: 1 });
    expect(model.supplies).toEqual(supplies);
    expect(model.winner).toBe(B);
    expect(game.result?.reason).toBe('turn_limit_score');
  });

  it('lets historical control flow outweigh a last-round capture', () => {
    const { game, bus } = arena();
    onlyWeight(game, { controlPoint: 100, controlPointFlowRatio: 0.75 });
    finalPlayer(game);
    game.players[A]!.stats.controlHold = 4;
    game.players[A]!.stats.controlHoldRounds = game.players[B]!.stats.controlHoldRounds = 1;
    game.controlPoints = [0, 1, 2, 3].map(q => ({ id: `p${q}`, name: `p${q}`, q, r: 0, owner: null }));
    addUnit(game, 'last-capturer', { owner: B });
    const model = createSearchState(viewOf(game));
    applyBoth(game, bus, model, null);
    const scores = buildAdjudicationScores(game);
    expect(scores[A]!.total).toBe(150);
    expect(scores[B]!.total).toBe(62.5);
    expect(model.winner).toBe(A);
  });

  it('uses rounded wounded army value, kill credit, supplies and HQ statistics in final scoring', () => {
    const { game, bus } = arena();
    finalPlayer(game);
    onlyWeight(game, { armyValue: 1, killValue: 2, supplies: 1, enemyHqDamage: 3, ownHqHp: 0.5 });
    addUnit(game, 'wounded', { cost: 45, hp: 49, maxHp: 100 });
    game.players[A]!.stats.killValue = 23;
    game.players[B]!.stats.headquartersDamage = 20;
    game.resources[B]!.supplies = 5;
    game.headquarters[A]!.hp = game.headquarters[B]!.hp = 100;
    const model = createSearchState(viewOf(game));
    applyBoth(game, bus, model, null);
    expect(game.result!.scores[A]!.total).toBe(118);
    expect(game.result!.scores[B]!.total).toBe(115);
    expect(model.winner).toBe(A);
  });

  it('returns a draw for tied final scores', () => {
    const { game, bus } = arena();
    finalPlayer(game);
    onlyWeight(game, {});
    const model = createSearchState(viewOf(game));
    applyBoth(game, bus, model, null);
    expect(model.terminal).toBe(true);
    expect(model.winner).toBeNull();
    expect(game.result?.reason).toBe('turn_limit_draw');
  });

  it('keeps unlimited games active beyond the usual turn cap', () => {
    const { game, bus } = arena();
    finalPlayer(game, 1000);
    game.config.balance.maxTurns = null;
    const model = createSearchState(viewOf(game));
    applyBoth(game, bus, model, null);
    expect(model.terminal).toBe(false);
    expect(model.round).toBe(1001);
  });

  it.each([1, 2])('matches comeback supply timing and inclusive gap threshold in round %i', round => {
    const { game, bus } = arena();
    finalPlayer(game, round);
    game.config.balance.maxTurns = 6;
    game.config.balance.comebackSupply = { startRound: 2, scoreGapPercent: 50, amountPerRound: 17 };
    onlyWeight(game, { ownHqHp: 1 });
    game.headquarters[A]!.hp = 50;
    game.headquarters[B]!.hp = 100;
    const model = createSearchState(viewOf(game));
    applyBoth(game, bus, model, null);
    expect(model.supplies[A]).toBe(round === 2 ? 17 : 0);
    expect(model.supplies[B]).toBe(0);
  });

  it.each([2, 3])('HQ destruction eliminates units, neutralizes points and updates turn order for %i players', playerCount => {
    const { game, bus } = arena();
    if (playerCount === 3) {
      game.players[C] = { ...createPlayer(C), status: 'active' };
      game.resources[C] = { supplies: 0 };
      game.headquarters[C] = { ...game.headquarters[B]!, id: 'hq-c', owner: C, q: 0, r: -4 };
      game.turn.turnOrder.push(C);
    }
    const attacker = addUnit(game, 'hq-killer', { q: 3, attack: 999, moveRange: 2 });
    addUnit(game, 'removed-1', { owner: B, q: 1, hp: 80, cost: 70 });
    addUnit(game, 'removed-2', { owner: B, q: 2, hp: 10, cost: 80 });
    game.headquarters[B]!.hp = 9;
    game.controlPoints = [
      { id: 'enemy-point', name: 'enemy point', q: 1, r: 0, owner: B },
      { id: 'neutral', name: 'neutral', q: 0, r: 0, owner: null },
    ];
    invalidateGameIndex(game);
    const model = createSearchState(viewOf(game));
    applyBoth(game, bus, model, { type: 'attack', payload: { attackerId: attacker.id, targetId: game.headquarters[B]!.id } });
    expect(model.stats[A].headquartersDamage).toBe(9);
    expect(model.stats[A].killValue).toBe(0);
    expect(model.points.every((p: { owner: PlayerId | null }) => p.owner === null)).toBe(true);
    expect(expectReachable(model, game, attacker)).toContain('4,0');
    if (playerCount === 3) {
      applyBoth(game, bus, model, null);
      expect(model.owner).toBe(C);
      applyBoth(game, bus, model, null);
      expect(model.owner).toBe(A);
      expect(model.round).toBe(2);
    } else {
      expect(model.winner).toBe(A);
      const before = structuredClone(model);
      finishSearchTurn(model);
      expect(model).toEqual(before);
    }
  });
});

describe('parallax independent decision contract and tactical legality', () => {
  it('exports its identity and searches deterministically without mutating input or reading private state/utils', () => {
    const { game, bus } = arena();
    addUnit(game, 'attacker', { attack: 28, attackRange: 2, moveRange: 1 });
    addUnit(game, 'enemy', { owner: B, q: 2, hp: 12, moveRange: 1 });
    game.controlPoints = [{ id: 'point', name: 'point', q: 0, r: 1, owner: null }];
    const view = viewOf(game);
    for (const key of ['rngState', 'tokens', 'hostToken']) expect(view).not.toHaveProperty(key);
    const before = structuredClone(view);
    freezeDeep(view);
    const privateKeys = new Set(['rngState', 'tokens', 'token', 'hostToken', 'playerToken']);
    const guard = <T extends object>(value: T) => new Proxy(value, {
      get(target, key, receiver) {
        if (privateKeys.has(String(key))) throw new Error(`Private state read: ${String(key)}`);
        return Reflect.get(target, key, receiver);
      },
      has(target, key) {
        if (privateKeys.has(String(key))) throw new Error(`Private state probe: ${String(key)}`);
        return Reflect.has(target, key);
      },
    });
    expect(parallax).toMatchObject({ name: 'parallax', version: 'v1' });
    const random = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Decision used randomness'); });
    let first: Action | null;
    try {
      first = parallax.decide(guard(view), noUtils, guard(Object.freeze({ owner: A }))) as Action | null;
      for (let repeat = 0; repeat < 2; repeat++) {
        expect(parallax.decide(guard(view), noUtils, guard(Object.freeze({ owner: A })))).toEqual(first);
      }
    } finally { random.mockRestore(); }
    expect(view).toEqual(before);
    expect(viewOf(game)).toEqual(before);
    execute(game, bus, first!);
  });

  it('applies speculative actions and a turn boundary without modifying the frozen source view', () => {
    const { game } = arena();
    addUnit(game, 'mover');
    game.controlPoints = [{ id: 'point', name: 'point', q: 1, r: 0, owner: null }];
    const view = viewOf(game);
    const before = structuredClone(view);
    freezeDeep(view);
    const model = createSearchState(view);
    applySearchAction(model, { type: 'move', payload: { unitId: 'mover', q: 1, r: 0 } });
    finishSearchTurn(model);
    expect(model.points[0].owner).toBe(A);
    expect(view).toEqual(before);
  });

  it.each(['annihilation', 'simultaneous', 'royale'] as const)('declines mode %s', mode => {
    const { game } = arena();
    game.config.mode = mode;
    expect(parallax.decide(viewOf(game), noUtils, { owner: A })).toBeNull();
  });

  it.each(['lobby', 'game_over'] as const)('declines non-active phase %s', phase => {
    const { game } = arena();
    game.phase = phase;
    expect(parallax.decide(viewOf(game), noUtils, { owner: A })).toBeNull();
  });

  it.each([B, 'missing-player'])('declines the wrong context owner %s', owner => {
    const { game } = arena();
    expect(parallax.decide(viewOf(game), noUtils, { owner })).toBeNull();
  });

  it('declines an eliminated current player', () => {
    const { game } = arena();
    game.players[A]!.status = 'eliminated';
    expect(parallax.decide(viewOf(game), noUtils, { owner: A })).toBeNull();
  });

  it('still attacks with an activated unit when all AP are spent', () => {
    const { game, bus } = arena();
    addUnit(game, 'activated', { attack: 60, actionSpent: true, hasMoved: true });
    addUnit(game, 'victim', { owner: B, q: 1, hp: 1 });
    game.turn.actionsUsed = game.config.balance.actionsPerTurn;
    const action = decide(game);
    expect(action).toEqual({ type: 'attack', payload: { attackerId: 'activated', targetId: 'victim' } });
    execute(game, bus, action);
    expect(game.turn.actionsUsed).toBe(game.config.balance.actionsPerTurn);
  });

  it('takes an immediate lethal HQ shot', () => {
    const { game, bus } = arena();
    addUnit(game, 'attacker', { q: 3, attack: 100, hasMoved: true });
    game.headquarters[B]!.hp = 1;
    const action = decide(game);
    expect(action).toEqual({ type: 'attack', payload: { attackerId: 'attacker', targetId: game.headquarters[B]!.id } });
    execute(game, bus, action);
    expect(game.winner).toBe(A);
  });

  it('keeps decisions legal in a wounded-target cleanup without assuming an optimal ordering', () => {
    const { game, bus } = arena();
    addUnit(game, 'first', { q: -1, attack: 28, moveRange: 1, attackRange: 2 });
    addUnit(game, 'second', { q: 0, r: 1, attack: 35, moveRange: 1 });
    addUnit(game, 'wounded', { owner: B, q: 1, hp: 5 });
    addUnit(game, 'healthy', { owner: B, q: 2, hp: 100 });
    for (let step = 0; step < 7 && game.phase === 'active' && game.turn.currentPlayerId === A; step++) {
      const action = decide(game);
      const model = createSearchState(viewOf(game));
      applyBoth(game, bus, model, action);
    }
    expect(game.phase !== 'active' || game.turn.currentPlayerId !== A).toBe(true);
  });

  it.each(['full-health', 'outside-healRange'])('never issues a heal for %s despite a larger attackRange', condition => {
    const { game, bus } = arena();
    game.config.units.support.healRange = 1;
    addUnit(game, 'support', { type: 'support', hasMoved: true, actionSpent: true, attackRange: 3 });
    addUnit(game, 'patient', { q: condition === 'full-health' ? 1 : 2, hp: condition === 'full-health' ? 100 : 20, maxHp: 100 });
    game.turn.actionsUsed = game.config.balance.actionsPerTurn;
    expect(decide(game)).toBeNull();
    execute(game, bus, null);
  });

  it.each(['hq-disabled', 'point-disabled'])('does not deploy from a %s source', condition => {
    const { game, bus } = arena();
    game.resources[A]!.supplies = 100;
    game.config.balance.deployFromHq = false;
    if (condition === 'point-disabled') {
      game.config.balance.controlPointTypes!.supply.canDeploy = false;
      game.controlPoints = [{ id: 'disabled', name: 'disabled', q: 0, r: 0, owner: A, kind: 'supply' }];
    }
    expect(decide(game)).toBeNull();
    execute(game, bus, null);
  });

  it('ends rather than deploying onto water, blockers, holes, HQs or occupied cells', () => {
    const { game, bus } = arena();
    Object.assign(game.headquarters[A]!, { q: 0, r: 0 });
    Object.assign(game.headquarters[B]!, { q: 1, r: 0 });
    addUnit(game, 'enemy', { owner: B, q: 1, r: -1 });
    addUnit(game, 'finished', { q: 0, r: 1, hasActed: true, hasMoved: true, actionSpent: true });
    game.cells = game.cells.filter(p => !(p.q === -1 && p.r === 1));
    game.map.terrainCells = [{ q: 0, r: -1, terrain: 'water' }, { q: -1, r: 0, terrain: 'blocker' }];
    game.resources[A]!.supplies = 100;
    game.turn.actionsUsed = 1;
    invalidateGameIndex(game);
    expect(hexNeighbors(game.headquarters[A]!).filter(p => isDeployable(game, p.q, p.r))).toHaveLength(0);
    expect(decide(game)).toBeNull();
    execute(game, bus, null);
  });

  it('advances toward a reachable enemy thirty cells away in an unlimited game without deployment or points', () => {
    const { game, bus } = arena();
    game.cells = Array.from({ length: 41 }, (_, index) => ({ q: index - 20, r: 0, terrain: 'plain' as const }));
    game.map.radius = game.config.radius = 20;
    game.config.playableCells = game.cells.map(({ q, r }) => ({ q, r }));
    Object.assign(game.headquarters[A]!, { q: -20, r: 0 });
    Object.assign(game.headquarters[B]!, { q: 20, r: 0 });
    Object.assign(game.config.balance, { maxTurns: null, deployFromHq: false });
    const mover = addUnit(game, 'long-range-marcher', { q: -15, r: 0, moveRange: 1, attackRange: 1 });
    const enemy = addUnit(game, 'distant-enemy', { owner: B, q: 15, r: 0, moveRange: 1, attackRange: 1 });
    const distance = hexDistance(mover, enemy);
    expect(distance).toBe(30);
    expect(game.controlPoints).toHaveLength(0);
    expect(findReachableCells(game, mover).map(hexKey)).toContain('-14,0');

    const action = decide(game);
    expect(action).toEqual({ type: 'move', payload: { unitId: mover.id, q: -14, r: 0 } });
    execute(game, bus, action);
    expect(hexDistance(mover, enemy)).toBe(distance - 1);
  });
});

describe('parallax bounded standard-map engine games', () => {
  it('matches engine army rounding before choosing a one-HP winning heal', () => {
    const { game, bus } = arena();
    onlyWeight(game, { armyValue: 1, supplies: 1 });
    finalPlayer(game, 1);
    game.config.balance.deployFromHq = false;
    game.resources[A]!.supplies = 31;
    const support = addUnit(game, 'rounding-support', {
      owner: B, type: 'support', hp: 70, maxHp: 100, cost: 45, healPower: 1,
      hasMoved: true, attackRange: 1,
    });
    expect(buildAdjudicationScores(game)[B]!.armyValue).toBe(31);
    const passed = structuredClone(game);
    const model = createSearchState(viewOf(game));
    applyBoth(passed, new EventBus(), model, null);
    expect(passed.winner).toBeNull();

    const action = decide(game);
    expect(action).toEqual({ type: 'heal', payload: { supportId: support.id, targetId: support.id } });
    execute(game, bus, action);
    execute(game, bus, null);
    expect(buildAdjudicationScores(game)[B]!.armyValue).toBe(32);
    expect(game.winner).toBe(B);
  });

  it('preserves a final-round multiplayer draw instead of breaking the leaders tie with a fallback shot', () => {
    const { game, bus } = arena();
    game.maxPlayers = 3;
    game.players[C] = { ...createPlayer(C), status: 'active' };
    game.resources[C] = { supplies: 0 };
    game.headquarters[C] = { ...game.headquarters[A]!, id: 'hq-c', owner: C, q: 0, r: -4 };
    game.turn.turnOrder = [A, C, B];
    finalPlayer(game, 1);
    game.turn.actedThisRound = [A, C];
    onlyWeight(game, { ownHqHp: 1, enemyHqDamage: 1 });
    Object.assign(game.headquarters[A]!, { hp: 100, defense: 0 });
    Object.assign(game.headquarters[B]!, { hp: 10, defense: 0 });
    Object.assign(game.headquarters[C]!, { hp: 100, defense: 0 });
    const unit = addUnit(game, 'draw-preserver', {
      owner: B, q: -3, r: 0, attack: 10, attackRange: 1, moveRange: 0, hasMoved: true,
    });
    const shot = structuredClone(game);
    execute(shot, new EventBus(), { type: 'attack', payload: { attackerId: unit.id, targetId: game.headquarters[A]!.id } });
    execute(shot, new EventBus(), null);
    expect(shot.winner).toBe(C);

    const action = decide(game);
    expect(action).toBeNull();
    execute(game, bus, action);
    expect(game.phase).toBe('game_over');
    expect(game.winner).toBeNull();
  });

  it('captures the winning point on the final seat before considering nonexistent future retaliation', () => {
    const { game, bus } = arena();
    game.cells = Array.from({ length: 41 }, (_, index) => ({ q: index - 20, r: 0, terrain: 'plain' as const }));
    game.map.radius = game.config.radius = 20;
    game.config.playableCells = game.cells.map(({ q, r }) => ({ q, r }));
    Object.assign(game.headquarters[A]!, { q: -20, r: 0 });
    Object.assign(game.headquarters[B]!, { q: 20, r: 0 });
    Object.assign(game.config.balance, { deployFromHq: false, baseIncome: 0, controlPointIncome: 0 });
    for (const pointType of Object.values(game.config.balance.controlPointTypes!)) {
      Object.assign(pointType, { income: 0, repairAmount: 0, canDeploy: false });
    }
    onlyWeight(game, { controlPoint: 5, controlPointFlowRatio: 0, armyValue: 1, supplies: 1 });
    finalPlayer(game, 1); // B is the last seat, with A already recorded as having acted.
    game.resources[A]!.supplies = 1;
    game.resources[B]!.supplies = 0;
    game.controlPoints = [{ id: 'winning-point', name: 'winning point', kind: 'supply', q: 1, r: 0, owner: null }];
    const capturer = addUnit(game, 'last-seat-capturer', {
      owner: B, q: 0, r: 0, hp: 100, maxHp: 100, cost: 100, moveRange: 1, attackRange: 1, canCapture: true,
    });
    addUnit(game, 'future-threat', {
      owner: A, q: 3, r: 0, hp: 100, maxHp: 100, cost: 100, attack: 100, moveRange: 1, attackRange: 1,
    });
    const scores = buildAdjudicationScores(game);
    expect(scores[A]!.total - scores[B]!.total).toBe(1);

    const action = decide(game);
    expect(action).not.toBeNull();
    expect(action).toEqual({ type: 'move', payload: { unitId: capturer.id, q: 1, r: 0 } });
    execute(game, bus, action);
    execute(game, bus, null);
    expect(game.controlPoints[0].owner).toBe(B);
    expect(game.phase).toBe('game_over');
    expect(game.result?.reason).toBe('turn_limit_score');
    expect(game.winner).toBe(B);
  });

  it.each([
    { mapId: 'default', opponent: 'endTurn' },
    { mapId: 'dual-lanes', opponent: 'endTurn' },
    { mapId: 'danger-close', opponent: 'self' },
  ])('validates every action on $mapId against $opponent for two rounds', ({ mapId, opponent }) => {
    const { game, bus } = gameOn(mapId);
    // Keep native map stats/AP and cap only match length; zero variance permits exact differential checks.
    game.config.balance.maxTurns = 2;
    game.config.balance.damageVarianceRange = game.config.balance.healVarianceRange = 0;
    const maxSteps = 4 * (2 * game.config.balance.actionsPerTurn + 1) + 4;
    let steps = 0;
    let algorithmActions = 0;
    while (game.phase === 'active' && steps < maxSteps) {
      const passive = opponent === 'endTurn' && game.turn.currentPlayerId === B;
      const action = passive ? null : decide(game);
      if (action !== null) algorithmActions++;
      const model = createSearchState(viewOf(game));
      applyBoth(game, bus, model, action);
      const live = game.units.filter(u => u.alive);
      expect(new Set(live.map(hexKey)).size).toBe(live.length);
      expect(Object.values(game.resources).every(r => r.supplies >= 0)).toBe(true);
      expect(game.turn.actionsUsed).toBeLessThanOrEqual(game.config.balance.actionsPerTurn);
      steps++;
    }
    expect(algorithmActions).toBeGreaterThan(0);
    expect(game.phase, `Failed to terminate after ${steps} engine actions`).toBe('game_over');
    expect(steps).toBeLessThanOrEqual(maxSteps);
    expect(game.turn.roundNumber).toBeLessThanOrEqual(2);
  }, 180_000);
});
