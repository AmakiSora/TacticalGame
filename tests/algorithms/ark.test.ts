import { beforeAll, describe, expect, it } from 'vitest';
import { sanitizeGameForResponse } from '../../src/api/auth.js';
import { EventBus } from '../../src/events/bus.js';
import { artilleryStateForRound } from '../../src/engine/artillery.js';
import { startGame } from '../../src/engine/engine.js';
import { invalidateGameIndex } from '../../src/engine/gameIndex.js';
import { hexDistance, hexKey, hexNeighbors, hexRange, isValidHex } from '../../src/engine/hex.js';
import {
  coveredCellsFor, projectPlanQueue, queueAttackAction, queueDemolishAction,
  queueDeployAction, queueHealAction, queueMoveAction, queueWaitAction,
} from '../../src/engine/planning.js';
import { commitAndMaybeResolve } from '../../src/engine/simultaneous.js';
import { addLobbyPlayer, createLobby, createUnitFromConfig } from '../../src/state/store.js';
import type {
  AdjudicationSnapshot, GameState, MapCell, PendingAction, PlayerId,
  PlayerRecord, Position, Unit, UnitType,
} from '../../src/types.js';

const OWNER: PlayerId = 'player_a';
const ENEMY: PlayerId = 'player_b';
const utils = Object.freeze({ hexDistance, hexKey, hexNeighbors, hexRange, isValidHex });

type Action =
  | { type: 'deploy'; payload: Position & { unitType: UnitType; fromId: string } }
  | { type: 'move' | 'demolish'; payload: Position & { unitId: string } }
  | { type: 'attack'; payload: Position & { attackerId: string } }
  | { type: 'heal'; payload: Position & { supportId: string } }
  | { type: 'wait'; payload: Record<string, never> };

type PublicGame = Omit<GameState, 'tokens' | 'hostToken' | 'rngState' | 'idempotency' | 'plan'> & {
  lastEventSeq: number;
  adjudication: AdjudicationSnapshot;
  plan: {
    queues?: PlayerRecord<PendingAction[]>;
    myQueue?: PendingAction[];
    committed: PlayerId[];
  } | null;
};

type QueueView = 'both' | 'myQueue' | 'owner';
interface Algorithm {
  name: string;
  decide(game: PublicGame, utilities: typeof utils, context: { owner?: PlayerId }): Action | null;
}
let ark: Algorithm;

beforeAll(async () => {
  const moduleUrl = new URL('../../algorithms/builtin/ark.mjs', import.meta.url).href;
  const loaded: { default: Algorithm } = await import(moduleUrl);
  ark = loaded.default;
});

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
      if ('value' in descriptor) freeze(descriptor.value);
    }
    Object.freeze(value);
  }
  return value;
}

function forbidRead(target: object, key: string): void {
  Object.defineProperty(target, key, {
    enumerable: true,
    get(): never { throw new Error(`Private field read: ${key}`); },
  });
}

function publicView(game: GameState, owner = OWNER, queueView: QueueView = 'both'): PublicGame {
  invalidateGameIndex(game);
  const view = sanitizeGameForResponse(game, owner) as PublicGame;
  expect(view).not.toHaveProperty('rngState');
  expect(view).not.toHaveProperty('tokens');
  expect(view).not.toHaveProperty('hostToken');
  for (const key of ['rngState', 'tokens', 'hostToken']) forbidRead(view, key);
  if (view.plan) {
    if (queueView === 'myQueue') delete view.plan.queues;
    if (queueView === 'owner') delete view.plan.myQueue;
    if (view.plan.queues) {
      for (const id of Object.keys(game.players)) {
        if (id !== owner) forbidRead(view.plan.queues, id);
      }
    }
  }
  return freeze(view);
}

function decide(game: GameState, owner = OWNER, queueView: QueueView = 'both'): Action | null {
  const action = ark.decide(publicView(game, owner, queueView), utils, Object.freeze({ owner }));
  expect(action).not.toBeInstanceOf(Promise);
  expect(action === null || (typeof action === 'object' && typeof action.type === 'string')).toBe(true);
  return action;
}

function enqueue(game: GameState, owner: PlayerId, action: Action): PendingAction {
  invalidateGameIndex(game);
  const result = (() => {
    switch (action.type) {
      case 'deploy': {
        const { unitType, fromId, q, r } = action.payload;
        return queueDeployAction(game, owner, unitType, fromId, q, r);
      }
      case 'move': {
        const { unitId, q, r } = action.payload;
        return queueMoveAction(game, owner, unitId, q, r);
      }
      case 'attack': {
        const { attackerId, q, r } = action.payload;
        return queueAttackAction(game, owner, attackerId, q, r);
      }
      case 'heal': {
        const { supportId, q, r } = action.payload;
        return queueHealAction(game, owner, supportId, q, r);
      }
      case 'demolish': {
        const { unitId, q, r } = action.payload;
        return queueDemolishAction(game, owner, unitId, q, r);
      }
      case 'wait': return queueWaitAction(game, owner);
      default: throw new Error(`Unexpected action: ${JSON.stringify(action)}`);
    }
  })();
  expect(result, JSON.stringify({ round: game.turn.roundNumber, owner, action })).toMatchObject({ ok: true });
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  if (!result.data) throw new Error('Successful enqueue did not return a pending action');
  return result.data;
}

function legalDecision(game: GameState, owner = OWNER, queueView: QueueView = 'both'): Action | null {
  const action = decide(game, owner, queueView);
  if (action !== null) enqueue(game, owner, action);
  return action;
}

function requiredDecision(game: GameState): Action {
  const action = decide(game);
  expect(action).not.toBeNull();
  if (!action) throw new Error('Expected an action in the single-purpose position');
  return action;
}

function newGame(mapId = 'snowflake', playerCount = 2): GameState {
  const game = createLobby('ark-rules-test', mapId, {
    maxPlayers: playerCount, participate: true, playerName: 'Seat A',
  });
  game.config = structuredClone(game.config);
  for (let index = 1; index < playerCount; index++) {
    expect(addLobbyPlayer(game, `Seat ${index + 1}`)).not.toBeNull();
  }
  expect(startGame(game, new EventBus(), () => 0.25)).toMatchObject({ ok: true });
  game.units.forEach((unit, index) => { unit.id = `unit-${index}`; });
  invalidateGameIndex(game);
  return game;
}

function board(game: GameState, cells: MapCell[]): void {
  game.cells = structuredClone(cells);
  game.map.radius = 4;
  game.map.terrainCells = [];
  game.config.radius = 4;
  game.config.playableCells = cells.map(({ q, r }) => ({ q, r }));
  game.config.terrainCells = [];
  game.artillery = { safeRadius: 4, dangerCells: [], warningCells: [], nextShrinkRound: 6 };
  invalidateGameIndex(game);
}

function plain(q: number, r: number): MapCell { return { q, r, terrain: 'plain' }; }

function unit(game: GameState, type: UnitType, q: number, r: number, owner = OWNER): Unit {
  const created = createUnitFromConfig(game.config, owner, type, q, r);
  created.id = `${owner}-${type}-${game.units.length}`;
  game.units.push(created);
  invalidateGameIndex(game);
  return created;
}

function tactical(): GameState {
  const game = newGame();
  board(game, hexRange({ q: 0, r: 0 }, 4).map(pos => plain(pos.q, pos.r)));
  game.units = [];
  game.controlPoints = [];
  game.config.controlPoints = [];
  game.resources[OWNER]!.supplies = 0;
  game.resources[ENEMY]!.supplies = 0;
  game.config.balance.actionsPerTurn = 5;
  game.config.balance.healVarianceRange = 0;
  game.config.balance.damageVarianceRange = 0;
  const enemy = unit(game, 'infantry', -4, 0, ENEMY);
  enemy.moveRange = 0;
  enemy.attackRange = 0;
  return game;
}

function deploymentPosition(): GameState {
  const game = tactical();
  board(game, [plain(0, 0), plain(1, 0), plain(-4, 0)]);
  game.controlPoints = [{ id: 'origin', name: 'Origin', kind: 'forward_base', q: 0, r: 0, owner: OWNER }];
  game.config.controlPoints = [{ id: 'origin', name: 'Origin', kind: 'forward_base', q: 0, r: 0 }];
  game.config.balance.controlPointTypes = {
    supply: { income: 0, deployDiscount: 0, repairAmount: 0 },
    forward_base: { income: 0, deployDiscount: 0, repairAmount: 0 },
    repair: { income: 0, deployDiscount: 0, repairAmount: 0 },
  };
  for (const spec of Object.values(game.config.units)) spec.cost = 1_000;
  game.config.units.infantry.cost = 55;
  game.resources[OWNER]!.supplies = 55;
  return game;
}

function combatPosition(): { game: GameState; attacker: Unit; target: Unit } {
  const game = tactical();
  game.config.units.infantry.attackShape = { type: 'single' };
  const attacker = unit(game, 'infantry', 0, 0);
  attacker.moveRange = 0;
  attacker.attackRange = 1;
  const target = game.units.find(candidate => candidate.owner === ENEMY)!;
  target.q = 1;
  target.r = 0;
  target.hp = target.maxHp = 1_000;
  invalidateGameIndex(game);
  return { game, attacker, target };
}

function healingPosition(): { game: GameState; support: Unit; wounded: Unit } {
  const game = tactical();
  game.config.units.support.healShape = { type: 'single' };
  game.config.units.support.healRange = 1;
  const support = unit(game, 'support', 0, 0);
  support.moveRange = 0;
  support.attackRange = 0;
  support.healPower = 20;
  const wounded = unit(game, 'infantry', 1, 0);
  wounded.moveRange = 0;
  wounded.attackRange = 0;
  wounded.maxHp = 100;
  wounded.hp = 20;
  return { game, support, wounded };
}

function commitAll(game: GameState): void {
  const bus = new EventBus();
  for (const owner of [...game.turn.turnOrder]) {
    if (game.phase !== 'active') break;
    if (game.players[owner]?.status !== 'active' || game.plan!.committed.includes(owner)) continue;
    expect(commitAndMaybeResolve(game, bus, owner)).toMatchObject({ ok: true });
  }
}

describe('ark public royale contract', () => {
  it('exports ark and returns a synchronous action through the public contract', () => {
    expect(ark.name).toBe('ark');
    const game = deploymentPosition();
    enqueue(game, OWNER, requiredDecision(game));
  });

  it.each(['standard', 'annihilation', 'simultaneous'] as const)('does not play %s', mode => {
    const game = newGame();
    game.config.mode = mode;
    expect(decide(game)).toBeNull();
  });

  it.each(['lobby', 'game_over'] as const)('does not act during %s', phase => {
    const game = newGame();
    game.phase = game.turn.phase = phase;
    expect(decide(game)).toBeNull();
  });

  it('does not act for an eliminated player', () => {
    const game = newGame();
    game.players[OWNER]!.status = 'eliminated';
    expect(decide(game)).toBeNull();
  });

  it('requires an explicit existing owner instead of inferring a seat', () => {
    const game = newGame();
    game.turn.currentPlayerId = game.turn.currentOwner = OWNER;
    expect(ark.decide(publicView(game), utils, Object.freeze({}))).toBeNull();
    expect(decide(game, 'player_h')).toBeNull();
  });

  it('does not append actions after the owner has committed', () => {
    const game = newGame();
    game.plan!.committed.push(OWNER);
    expect(decide(game)).toBeNull();
  });

  it('uses the owner queue length for AP limits in either public queue interface', () => {
    const game = newGame();
    for (let i = 0; i < game.config.balance.actionsPerTurn; i++) {
      expect(queueWaitAction(game, OWNER)).toMatchObject({ ok: true });
    }
    for (const view of ['both', 'myQueue', 'owner'] as const) expect(decide(game, OWNER, view)).toBeNull();
    game.plan!.queues[OWNER] = [];
    game.config.balance.actionsPerTurn = 0;
    expect(decide(game)).toBeNull();
  });

  it('accepts complete frozen projections without reading secrets or opponent queues', () => {
    const game = newGame('snowflake', 6);
    for (const owner of game.turn.turnOrder) {
      if (owner !== OWNER) expect(queueWaitAction(game, owner)).toMatchObject({ ok: true });
    }
    const before = structuredClone(game);
    const view = publicView(game);
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view.config.units)).toBe(true);
    expect(Object.isFrozen(view.units[0])).toBe(true);
    const action = ark.decide(view, utils, Object.freeze({ owner: OWNER }));
    expect(action).not.toBeInstanceOf(Promise);
    expect(game).toEqual(before);
    if (action) enqueue(game, OWNER, action);
  });

  it('treats myQueue-only and owner-keyed queues identically with a nonempty plan', () => {
    const game = tactical();
    const ranger = unit(game, 'ranger', 0, 0);
    ranger.attackRange = 1;
    game.config.units.ranger.attackShape = { type: 'single' };
    expect(queueMoveAction(game, OWNER, ranger.id, 1, 0)).toMatchObject({ ok: true });
    expect(queueAttackAction(game, OWNER, ranger.id, 2, 0)).toMatchObject({ ok: true });
    expect(queueWaitAction(game, OWNER)).toMatchObject({ ok: true });
    const expected = decide(game);
    expect(decide(game, OWNER, 'myQueue')).toEqual(expected);
    expect(decide(game, OWNER, 'owner')).toEqual(expected);
    if (expected) enqueue(game, OWNER, expected);
  });

  it('does not branch on the map identifier or display name', () => {
    const game = newGame();
    const expected = decide(game);
    game.mapId = 'unseen-map-with-identical-rules';
    game.config.name = 'Renamed geometry';
    game.config.description = 'Display text only';
    expect(decide(game)).toEqual(expected);
  });

  it('does not branch on opponent names', () => {
    const game = newGame('snowflake', 3);
    const expected = decide(game);
    for (const player of Object.values(game.players)) {
      if (player.id === OWNER) continue;
      player.name = `Renamed ${player.id}`;
      game.playerNames[player.id] = player.name;
    }
    expect(decide(game)).toEqual(expected);
  });
});

describe('ark rule-derived deployments', () => {
  it('deploys on step one to keep a zero-army seat alive, regardless of sequential actionsUsed', () => {
    const game = deploymentPosition();
    game.turn.actionsUsed = game.config.balance.actionsPerTurn;
    const action = requiredDecision(game);
    expect(action.type).toBe('deploy');
    enqueue(game, OWNER, action);
    commitAll(game);
    expect(game.players[OWNER]!.status).toBe('active');
    expect(game.units.some(candidate => candidate.owner === OWNER && candidate.alive)).toBe(true);
    expect(game.events.find(event => event.type === 'deploy')?.payload).toMatchObject({ owner: OWNER, step: 1 });
  });

  it('does not deploy from a dangerous control point into a safe cell', () => {
    const game = deploymentPosition();
    game.artillery!.dangerCells = [{ q: 0, r: 0 }];
    expect(legalDecision(game)?.type).not.toBe('deploy');
  });

  it('does not deploy from a safe control point into a dangerous cell', () => {
    const game = deploymentPosition();
    game.artillery!.dangerCells = [{ q: 1, r: 0 }];
    expect(legalDecision(game)?.type).not.toBe('deploy');
  });

  it('respects the control point kind canDeploy:false flag', () => {
    const game = deploymentPosition();
    game.config.balance.controlPointTypes!.forward_base.canDeploy = false;
    expect(legalDecision(game)?.type).not.toBe('deploy');
  });

  it('can save a zero-army seat when only the discounted cost is affordable', () => {
    const game = deploymentPosition();
    game.config.balance.controlPointTypes!.forward_base.deployDiscount = 15;
    game.resources[OWNER]!.supplies = 40;
    const action = requiredDecision(game);
    expect(action.type).toBe('deploy');
    enqueue(game, OWNER, action);
    commitAll(game);
    expect(game.events.find(event => event.type === 'deploy')?.payload).toMatchObject({ cost: 40, discount: 15 });
  });

  it('caps deployment discounts at the unit cost and permits zero-cost survival', () => {
    const game = deploymentPosition();
    game.config.balance.controlPointTypes!.forward_base.deployDiscount = 100;
    game.resources[OWNER]!.supplies = 0;
    const action = requiredDecision(game);
    expect(action.type).toBe('deploy');
    enqueue(game, OWNER, action);
    commitAll(game);
    expect(game.events.find(event => event.type === 'deploy')?.payload).toMatchObject({ cost: 0, discount: 55 });
  });

  it('reserves the discounted supplies already spent by planned deployments', () => {
    const game = deploymentPosition();
    game.cells.push(plain(0, 1));
    game.config.playableCells.push({ q: 0, r: 1 });
    game.config.balance.controlPointTypes!.forward_base.deployDiscount = 15;
    game.resources[OWNER]!.supplies = 79;
    invalidateGameIndex(game);
    expect(queueDeployAction(game, OWNER, 'infantry', 'origin', 1, 0)).toMatchObject({ ok: true });
    expect(legalDecision(game, OWNER, 'myQueue')?.type).not.toBe('deploy');
  });
});

describe('ark queue projections and tactical legality', () => {
  it('does not spend three attacks on one immobile one-HP target', () => {
    const { game, attacker, target } = combatPosition();
    game.config.balance.attacksPerUnit = 3;
    game.config.units.infantry.attackLock = true;
    target.hp = 1;
    target.moveRange = 0;
    unit(game, 'heavy', -4, 0, ENEMY);
    const first = legalDecision(game);
    expect(first).toMatchObject({ type: 'attack', payload: { attackerId: attacker.id } });
    expect(decide(game)?.type).not.toBe('attack');
  });

  it('still values minimum-damage attacks when every configured attack is zero', () => {
    const { game, attacker, target } = combatPosition();
    for (const spec of Object.values(game.config.units)) spec.attack = 0;
    attacker.attack = 0;
    target.hp = game.config.balance.minimumDamage;
    expect(legalDecision(game)?.type).toBe('attack');
  });

  it.each([0.25, 10_000_000_000_000_000, Number.MAX_VALUE])('bounds arithmetic for damage variance %s', variance => {
    const { game } = combatPosition();
    game.config.balance.damageVarianceRange = variance;
    expect(legalDecision(game)?.type).toBe('attack');
  });

  it.each([undefined, 2])('respects attacksPerUnit=%s across a whole round', limit => {
    const { game, attacker } = combatPosition();
    game.config.balance.attacksPerUnit = limit;
    const effectiveLimit = limit ?? 1;
    const first = legalDecision(game);
    expect(first?.type).toBe('attack');
    for (let used = 1; used < effectiveLimit; used++) {
      expect(queueAttackAction(game, OWNER, attacker.id, 1, 0)).toMatchObject({ ok: true });
    }
    for (let index = effectiveLimit; index < game.config.balance.actionsPerTurn; index++) {
      const next = legalDecision(game, OWNER, 'owner');
      expect(next?.type).not.toBe('attack');
      if (next === null) break;
    }
    const attacks = game.plan!.queues[OWNER]!.filter(action => action.type === 'attack' && action.attackerId === attacker.id);
    expect(attacks).toHaveLength(effectiveLimit);
  });

  it('validates attacks from a previously queued move rather than the original position', () => {
    const { game, attacker, target } = combatPosition();
    target.q = -1;
    attacker.moveRange = 1;
    invalidateGameIndex(game);
    expect(queueMoveAction(game, OWNER, attacker.id, 1, 0)).toMatchObject({ ok: true });
    const action = legalDecision(game, OWNER, 'myQueue');
    if (action?.type === 'attack') {
      expect(hexDistance({ q: 1, r: 0 }, action.payload)).toBeLessThanOrEqual(attacker.attackRange);
    }
  });

  it('uses the projected origin for consecutive moves', () => {
    const game = tactical();
    board(game, [plain(0, 0), plain(1, 0), plain(2, 0), plain(-4, 0)]);
    const scout = unit(game, 'scout', 0, 0);
    scout.moveRange = 1;
    scout.attackRange = 0;
    game.artillery!.dangerCells = [{ q: 0, r: 0 }, { q: 1, r: 0 }];
    expect(queueMoveAction(game, OWNER, scout.id, 1, 0)).toMatchObject({ ok: true });
    const action = legalDecision(game);
    if (action?.type === 'move') {
      expect(hexDistance({ q: 1, r: 0 }, action.payload)).toBe(1);
    }
  });

  it.each(['source', 'target', 'line fringe', 'arc fringe'] as const)('avoids a heal invalidated by artillery at its %s', location => {
    const { game, support, wounded } = healingPosition();
    if (location === 'source') game.artillery!.dangerCells = [{ q: 0, r: 0 }];
    if (location === 'target') game.artillery!.dangerCells = [{ q: 1, r: 0 }];
    if (location === 'line fringe') {
      game.config.units.support.healRange = 2;
      game.config.units.support.healShape = { type: 'line', length: 2 };
      game.artillery!.dangerCells = [{ q: 2, r: 0 }];
    }
    if (location === 'arc fringe') {
      game.config.units.support.healShape = { type: 'arc' };
      game.artillery!.dangerCells = hexNeighbors({ q: 0, r: 0 }).filter(pos => pos.q !== 1 || pos.r !== 0);
    }
    const probe = structuredClone(game);
    expect(queueHealAction(probe, OWNER, support.id, wounded.q, wounded.r)).toMatchObject({ ok: true });
    commitAll(probe);
    expect(probe.events.find(event => event.type === 'action_failed' && event.payload.type === 'heal')?.payload)
      .toMatchObject({ reason: 'artillery_zone' });
    expect(legalDecision(game)?.type).not.toBe('heal');
  });

  it('does not heal an entirely healthy coverage area', () => {
    const { game, wounded } = healingPosition();
    wounded.hp = wounded.maxHp;
    expect(legalDecision(game)?.type).not.toBe('heal');
  });

  it('does not repeat a sufficient planned heal while another target remains wounded', () => {
    const { game, support, wounded } = healingPosition();
    wounded.hp = wounded.maxHp - 1;
    const other = unit(game, 'infantry', 0, 1);
    other.moveRange = other.attackRange = 0;
    other.hp = 1;
    expect(queueHealAction(game, OWNER, support.id, wounded.q, wounded.r)).toMatchObject({ ok: true });
    const action = requiredDecision(game);
    expect(action.type).toBe('heal');
    if (action.type !== 'heal') throw new Error('Only the second wounded target needs an action');
    const aim = coveredCellsFor(support, game.config.units.support, 'healShape', action.payload, 1);
    expect(aim?.cells).toContainEqual({ q: other.q, r: other.r });
    expect(aim?.cells).not.toContainEqual({ q: wounded.q, r: wounded.r });
    enqueue(game, OWNER, action);
    commitAll(game);
    expect(game.events.filter(event => event.type === 'heal').map(event => event.payload.targetId))
      .toEqual([wounded.id, other.id]);
  });

  it('uses projected support positions and the configured healRange', () => {
    const { game, support, wounded } = healingPosition();
    support.moveRange = 1;
    game.config.units.support.healRange = 2;
    wounded.q = 3;
    invalidateGameIndex(game);
    expect(queueMoveAction(game, OWNER, support.id, 1, 0)).toMatchObject({ ok: true });
    const action = legalDecision(game);
    if (action?.type === 'heal') {
      expect(coveredCellsFor({ q: 1, r: 0 }, game.config.units.support, 'healShape', action.payload, 2)).not.toBeNull();
    }
  });

  it('honors map terrain overrides over base cell terrain', () => {
    const game = deploymentPosition();
    game.map.terrainCells = [{ q: 1, r: 0, terrain: 'water' }];
    expect(legalDecision(game)?.type).not.toBe('deploy');
    game.map.terrainCells = [{ q: 1, r: 0, terrain: 'plain' }];
    game.cells.find(cell => cell.q === 1 && cell.r === 0)!.terrain = 'blocker';
    game.plan!.queues[OWNER] = [];
    const action = requiredDecision(game);
    expect(action.type).toBe('deploy');
    enqueue(game, OWNER, action);
  });

  it('does not fill map holes just because an in-radius terrain override exists', () => {
    const game = deploymentPosition();
    game.cells = game.cells.filter(cell => cell.q !== 1 || cell.r !== 0);
    game.config.playableCells = game.cells.map(({ q, r }) => ({ q, r }));
    game.map.terrainCells = [{ q: 1, r: 0, terrain: 'plain' }];
    expect(isValidHex({ q: 1, r: 0 }, game.map.radius)).toBe(true);
    expect(legalDecision(game)?.type).not.toBe('deploy');
  });

  it('does not demolish terrain already cleared by its own queued action', () => {
    const game = tactical();
    board(game, [plain(0, 0), { q: 1, r: 0, terrain: 'blocker' }, plain(2, 0), plain(-4, 0)]);
    const heavy = unit(game, 'heavy', 0, 0);
    heavy.attackRange = 0;
    heavy.moveRange = 2;
    game.artillery!.dangerCells = [{ q: 0, r: 0 }];
    expect(queueDemolishAction(game, OWNER, heavy.id, 1, 0)).toMatchObject({ ok: true });
    expect(projectPlanQueue(game, OWNER).terrain.get('1,0')).toBe('plain');
    const action = legalDecision(game);
    expect(action?.type).not.toBe('demolish');
  });
});

describe('ark real-engine short games', () => {
  it.each([
    { mapId: 'snowflake', players: 2 },
    { mapId: 'narrow-road', players: 2 },
    { mapId: 'snowflake', players: 3 },
    { mapId: 'snowflake', players: 6 },
  ])('queues only legal actions on $mapId with $players seats for up to eight rounds', ({ mapId, players }) => {
    const game = newGame(mapId, players);
    let actions = 0;
    let rounds = 0;
    while (game.phase === 'active' && rounds < 8) {
      const round = game.turn.roundNumber;
      for (const owner of [...game.turn.turnOrder]) {
        if (game.players[owner]?.status !== 'active') continue;
        const limit = game.config.balance.actionsPerTurn;
        for (let slot = 0; slot < limit; slot++) {
          const action = legalDecision(game, owner, slot % 2 === 0 ? 'myQueue' : 'owner');
          if (action === null) break;
          actions++;
        }
        if (game.plan!.queues[owner]?.length === limit) expect(decide(game, owner)).toBeNull();
      }
      commitAll(game);
      rounds++;
      if (game.phase === 'active') expect(game.turn.roundNumber).toBe(round + 1);
    }
    expect(actions).toBeGreaterThan(0);
    expect(rounds).toBeGreaterThan(0);
    expect(game.events.some(event => event.type === 'round_resolved')).toBe(true);
    if (rounds === 8 && game.phase === 'active') {
      expect(game.turn.roundNumber).toBe(9);
      expect(game.artillery).toEqual(artilleryStateForRound(game, game.turn.roundNumber));
    }
  }, 90_000);
});
