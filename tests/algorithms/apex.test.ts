import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadMaps } from '../../src/config/loader.js';
import { addLobbyPlayer, createLobby, createUnitFromConfig } from '../../src/state/store.js';
import { startGame } from '../../src/engine/engine.js';
import { artilleryStateForRound } from '../../src/engine/artillery.js';
import { EventBus } from '../../src/events/bus.js';
import { commitAndMaybeResolve } from '../../src/engine/simultaneous.js';
import {
  queueAttackAction, queueDemolishAction, queueDeployAction, queueHealAction, queueMoveAction, queueWaitAction, reorderPlanActions,
} from '../../src/engine/planning.js';
// @ts-expect-error Native ESM algorithm.
import apex, { __internals as A } from '../../algorithms/builtin/apex.mjs';
import { getAlgorithmMeta, algorithmSupportsMode } from '../../algorithms/registry.mjs';

loadMaps();
const previousBudget = process.env.APEX_TIME_MS;
const previousNodes = process.env.APEX_NODES;
beforeEach(() => {
  A.cache.clear();
  process.env.APEX_TIME_MS = '150';
  process.env.APEX_NODES = '80';
});
afterEach(() => {
  if (previousBudget === undefined) delete process.env.APEX_TIME_MS;
  else process.env.APEX_TIME_MS = previousBudget;
  if (previousNodes === undefined) delete process.env.APEX_NODES;
  else process.env.APEX_NODES = previousNodes;
});

function makeGame(map = 'narrow-road', players = 2) {
  const game: any = createLobby('apex-regression', map, { maxPlayers: players, participate: true, playerName: 'A' });
  for (let i = 1; i < players; i++) expect(addLobbyPlayer(game, `P${i}`)).not.toBeNull();
  expect(startGame(game, new EventBus(), () => 0.5).ok).toBe(true);
  return game;
}

function view(game: any, seat: string) {
  const { tokens, hostToken, rngState, plan, ...rest } = game;
  return { ...structuredClone(rest), plan: { myQueue: structuredClone(plan.queues[seat] ?? []), committed: [...plan.committed] } };
}

function enqueue(game: any, seat: any, action: any) {
  const p = action.payload;
  switch (action.type) {
    case 'move': return queueMoveAction(game, seat, p.unitId, p.q, p.r);
    case 'attack': return queueAttackAction(game, seat, p.attackerId, p.q, p.r);
    case 'heal': return queueHealAction(game, seat, p.supportId, p.q, p.r);
    case 'deploy': return queueDeployAction(game, seat, p.unitType, p.fromId, p.q, p.r);
    case 'demolish': return queueDemolishAction(game, seat, p.unitId, p.q, p.r);
    case 'wait': return queueWaitAction(game, seat);
    default: throw new Error(action.type);
  }
}

async function queueRound(game: any, seat: string) {
  const actions = [];
  for (let i = 0; i <= game.config.balance.actionsPerTurn; i++) {
    const action = await apex.decide(view(game, seat), {}, { owner: seat });
    if (!action) return actions;
    expect(enqueue(game, seat, action), JSON.stringify(action)).toMatchObject({ ok: true });
    actions.push(action);
  }
  throw new Error('Exceeded action budget');
}

function duel() {
  const game = makeGame();
  game.units = [
    createUnitFromConfig(game.config, 'player_a', 'ranger', -1, 0),
    createUnitFromConfig(game.config, 'player_b', 'infantry', 1, 0),
  ];
  game.resources.player_a.supplies = 0;
  game.resources.player_b.supplies = 0;
  game.controlPoints = [];
  return game;
}

describe('apex contract and information isolation', () => {
  it('registers an independent royale-only strategy', () => {
    expect(getAlgorithmMeta('apex')).toMatchObject({ displayName: '绝境算法', version: 'v1', modes: ['royale'] });
    expect(algorithmSupportsMode('apex', 'simultaneous')).toBe(false);
    expect(apex.name).toBe('apex');
  });

  it('short-circuits absent owner, other modes, full queues and committed players', async () => {
    const game = view(makeGame(), 'player_a');
    expect(await apex.decide(game, {}, {})).toBeNull();
    for (const mode of ['standard', 'annihilation', 'simultaneous']) {
      expect(await apex.decide({ ...game, config: { ...game.config, mode } }, {}, { owner: 'player_a' })).toBeNull();
    }
    expect(await apex.decide({ ...game, phase: 'game_over' }, {}, { owner: 'player_a' })).toBeNull();
    game.plan.committed = ['player_a'];
    expect(await apex.decide(game, {}, { owner: 'player_a' })).toBeNull();
    game.plan.committed = [];
    game.plan.myQueue = Array.from({ length: game.config.balance.actionsPerTurn }, () => ({ type: 'wait' }));
    expect(await apex.decide(game, {}, { owner: 'player_a' })).toBeNull();
  });

  it('does not inspect hidden queues, RNG or player tokens and leaves the snapshot unchanged', async () => {
    const game = view(makeGame(), 'player_a');
    const before = JSON.stringify(game);
    Object.defineProperty(game.plan, 'queues', { get() { throw new Error('hidden queue'); } });
    for (const key of ['rngState', 'tokens', 'hostToken']) {
      Object.defineProperty(game, key, { get() { throw new Error(`private ${key}`); } });
    }
    expect(await apex.decide(game, {}, { owner: 'player_a' })).not.toBeNull();
    expect(JSON.stringify(game)).toBe(before);
  });

  it('replans rejected actions instead of repeating them', async () => {
    const game = view(makeGame(), 'player_a');
    const first = await apex.decide(game, {}, { owner: 'player_a' });
    const retry = await apex.decide(game, {}, { owner: 'player_a' });
    expect(retry).not.toEqual(first);
  });

  it('does not mistake an equal-length queue reorder for a rejected action', async () => {
    const game = duel();
    game.config.balance.actionsPerTurn = 3;
    game.units[1].hp = 3;
    game.units[1].moveRange = 0;
    expect(queueWaitAction(game, 'player_a').ok).toBe(true);
    expect(queueMoveAction(game, 'player_a', game.units[0].id, 0, 0).ok).toBe(true);
    const shot = await apex.decide(view(game, 'player_a'), {}, { owner: 'player_a' });
    expect(shot?.type).toBe('attack');
    const reordered = game.plan.queues.player_a.map((a: any) => a.id).reverse();
    expect(reorderPlanActions(game, 'player_a', reordered).ok).toBe(true);
    const next = await apex.decide(view(game, 'player_a'), {}, { owner: 'player_a' });
    expect(next).toEqual(shot);
    expect(enqueue(game, 'player_a', next)).toMatchObject({ ok: true });
  });

  it('accepts an externally inserted prefix and invalidates a changed board', async () => {
    const game = makeGame();
    await apex.decide(view(game, 'player_a'), {}, { owner: 'player_a' });
    expect(queueWaitAction(game, 'player_a').ok).toBe(true);
    await queueRound(game, 'player_a');
    game.plan.queues.player_a = [];
    game.resources.player_a.supplies = 4;
    const action = await apex.decide(view(game, 'player_a'), {}, { owner: 'player_a' });
    expect(action?.type).toBe('deploy');
    expect(enqueue(game, 'player_a', action)).toMatchObject({ ok: true });
  });
});

describe('apex tactical and artillery decisions', () => {
  it('deploys immediately in a zero-army opening', async () => {
    const game = makeGame();
    const action = await apex.decide(view(game, 'player_a'), {}, { owner: 'player_a' });
    expect(action?.type).toBe('deploy');
    expect(enqueue(game, 'player_a', action)).toMatchObject({ ok: true });
  });

  it('takes a guaranteed army-wiping shot', async () => {
    const game = duel();
    game.units[1].hp = 3;
    game.units[1].moveRange = 0;
    const action = await apex.decide(view(game, 'player_a'), {}, { owner: 'player_a' });
    expect(action).toEqual({ type: 'attack', payload: { attackerId: game.units[0].id, q: 1, r: 0 } });
  });

  it('never values an exposed wounded enemy as a negative asset', () => {
    const game = duel();
    game.config.annihilation.artillery.startRound = 100;
    game.units[1].hp = 1;
    game.units.push(createUnitFromConfig(game.config, 'player_b', 'heavy', 4, 0));
    const M = A.prepare(view(game, 'player_a'));
    const seat = M.seats.indexOf('player_a');
    const after = structuredClone(M.initial);
    after.units[1].alive = false;
    after.units[1].hp = 0;
    after.kills[seat] += after.units[1].cost;
    expect(A.evaluate(M, after, seat)).toBeGreaterThan(A.evaluate(M, M.initial, seat));
  });

  it('escapes the next shrink rather than dying at the round boundary', async () => {
    const game = duel();
    game.turn.roundNumber = 13;
    game.artillery = artilleryStateForRound(game, 13);
    game.units[0].q = -2;
    game.units[0].hp = 3;
    game.units[1].q = 4;
    const actions = await queueRound(game, 'player_a');
    expect(actions.some(a => a.type === 'move' && Math.abs(a.payload.q) <= 1)).toBe(true);
  });

  it('uses terrain distance and configurable artillery timing', () => {
    const game = duel();
    game.turn.roundNumber = 3;
    game.config.annihilation.artillery = { startRound: 4, intervalRounds: 3, damage: 9, minimumSafeRadius: 0 };
    const M = A.prepare(view(game, 'player_a'));
    const S = M.initial;
    const u = S.units[0];
    const far = M.index.get('-6,0');
    const near = M.index.get('0,0');
    expect(A.evacuation(M, S, u, far)).toBeGreaterThan(A.evacuation(M, S, u, near));
  });

  it('opens a route through consecutive blockers without treating them as walkable', () => {
    const game = duel();
    game.map.radius = 4;
    game.cells = Array.from({ length: 9 }, (_, i) => ({ q: i - 4, r: 0, terrain: [-2, -1].includes(i - 4) ? 'blocker' : 'plain' }));
    game.map.terrainCells = game.cells.filter((c: any) => c.terrain === 'blocker');
    game.units = [
      createUnitFromConfig(game.config, 'player_a', 'heavy', -3, 0),
      createUnitFromConfig(game.config, 'player_b', 'ranger', 4, 0),
    ];
    game.config.annihilation.artillery.minimumSafeRadius = 0;
    const M = A.prepare(view(game, 'player_a'));
    const choices = A.candidateActions(M, M.seats.indexOf('player_a'), []);
    expect(choices.some(({ a, prior }: any) => a.type === 'demolish' && a.c === M.index.get('-2,0') && prior > 0)).toBe(true);
    expect(choices.some(({ a }: any) => a.type === 'move' && M.cells[a.c].q >= -2)).toBe(false);
  });

  it('uses repeated public collision outcomes to break a contested-cell stalemate', async () => {
    const game = makeGame('snowflake', 3);
    game.turn.roundNumber = 30;
    game.artillery = artilleryStateForRound(game, 30);
    game.controlPoints = [];
    game.units = [
      createUnitFromConfig(game.config, 'player_a', 'heavy', 1, 0),
      createUnitFromConfig(game.config, 'player_b', 'heavy', 0, -1),
      createUnitFromConfig(game.config, 'player_c', 'heavy', -1, 1),
    ];
    [61, 56, 19].forEach((hp, i) => { game.units[i].hp = hp; });
    for (const resource of Object.values(game.resources) as any[]) resource.supplies = 0;
    game.events = [28, 29].flatMap(roundNumber => game.units.slice(0, 2).map((u: any) => ({
      type: 'action_failed', payload: { type: 'move', owner: u.owner, unitId: u.id,
        reason: 'destination_conflict', roundNumber, step: 1,
        detail: { fromQ: u.q, fromR: u.r, q: 1, r: -1 } },
    })));
    expect(A.prepare(view(game, 'player_a')).repeatedArrivals).toHaveLength(2);
    expect(A.prepare({ ...view(game, 'player_a'), events: [] }).repeatedArrivals).toHaveLength(0);
    const stale = view(game, 'player_a');
    stale.turn.roundNumber++;
    expect(A.prepare(stale).repeatedArrivals).toHaveLength(0);
    const moved = view(game, 'player_a');
    moved.units[0].r = -1;
    expect(A.prepare(moved).repeatedArrivals).toHaveLength(1);
    const before = game.units.map((u: any) => [u.id, u.q, u.r, u.hp]);
    for (const seat of game.turn.turnOrder) await queueRound(game, seat);
    for (const seat of [...game.turn.turnOrder]) {
      if (game.phase !== 'active') break;
      expect(commitAndMaybeResolve(game, new EventBus(), seat)).toMatchObject({ ok: true });
    }
    expect(game.units.map((u: any) => [u.id, u.q, u.r, u.hp])).not.toEqual(before);
  }, 30000);

  it('respects configurable per-unit attack limits in projected queues', async () => {
    const game = duel();
    game.config.balance.attacksPerUnit = 2;
    game.units[1].hp = 100;
    game.units[1].maxHp = 100;
    game.units[1].attack = 0;
    const actions = await queueRound(game, 'player_a');
    expect(actions.filter(a => a.type === 'attack').length).toBeLessThanOrEqual(2);
    expect(actions.filter(a => a.type === 'attack').length).toBeGreaterThan(0);
  });
});

describe('apex real-engine multi-seat and unseen configurations', () => {
  it.each([['narrow-road', 2], ['snowflake', 2], ['snowflake', 3], ['snowflake', 6]] as const)(
    '%s %i seats enqueue and resolve without illegal actions', async (map, count) => {
      const game = makeGame(map, count);
      for (let round = 0; round < 2 && game.phase === 'active'; round++) {
        for (const seat of game.turn.turnOrder) await queueRound(game, seat);
        for (const seat of game.turn.turnOrder) {
          if (game.phase !== 'active') break;
          expect(commitAndMaybeResolve(game, new EventBus(), seat)).toMatchObject({ ok: true });
        }
      }
      expect(game.turn.roundNumber).toBeGreaterThan(1);
    }, 120000,
  );

  it('handles renamed maps, new stats, irregular terrain and a different AP budget', async () => {
    const game = makeGame('snowflake');
    game.map.id = 'unseen-generated-layout';
    game.config.balance.actionsPerTurn = 3;
    game.config.balance.attacksPerUnit = 2;
    game.config.units.ranger.cost = 37;
    game.config.units.ranger.attackRange = 2;
    game.config.units.support.healRange = 3;
    game.config.annihilation.artillery.intervalRounds = 2;
    game.cells = game.cells.filter((c: any) => c.q !== 0 || c.r !== 9);
    for (const seat of game.turn.turnOrder) await queueRound(game, seat);
    expect(game.plan.queues.player_a.length).toBeGreaterThan(0);
  }, 60000);
});
