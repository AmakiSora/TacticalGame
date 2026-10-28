import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../src/events/bus.js';
import { startGame } from '../../src/engine/engine.js';
import { artilleryStateForRound } from '../../src/engine/artillery.js';
import { computeDamage } from '../../src/engine/combat.js';
import { invalidateGameIndex } from '../../src/engine/gameIndex.js';
import { hexNeighbors } from '../../src/engine/hex.js';
import { coveredCellsFor, queueAttackAction, queueDemolishAction, queueDeployAction, queueHealAction, queueMoveAction, queueWaitAction } from '../../src/engine/planning.js';
import { resolveRound } from '../../src/engine/simultaneous.js';
import { resolveRoundSteps } from '../../src/engine/simultaneousResolve.js';
import * as random from '../../src/engine/random.js';
import { addLobbyPlayer, createLobby, createUnitFromConfig } from '../../src/state/store.js';
import type { GameState, PendingAction, PlayerId, UnitType } from '../../src/types.js';
// @ts-expect-error Native ESM model intentionally has no TypeScript dependency.
import { createModel, cloneState, distances, cover, aims, safeRadius, damage, advance, finishRound, __internals } from '../../algorithms/lib/royale-model.mjs';

type Action = { type: 'move' | 'attack' | 'heal' | 'demolish'; u: number; c: number }
  | { type: 'deploy'; unitType: UnitType; fromId: string; c: number } | { type: 'wait' };

function fixture(map = 'snowflake', count: 2 | 3 | 6 = 2, open = true) {
  const game = createLobby(`royale-model-${map}`, map, { maxPlayers: count, participate: true });
  for (let i = 1; i < count; i++) addLobbyPlayer(game);
  expect(startGame(game, new EventBus(), () => 0).ok).toBe(true);
  game.config = structuredClone(game.config);
  game.config.balance.damageVarianceRange = 0;
  game.config.balance.healVarianceRange = 0;
  delete game.config.balance.comebackSupply;
  if (open) {
    game.units = [];
    game.map.terrainCells = [];
    game.cells.forEach(cell => { cell.terrain = 'plain'; });
  }
  return game;
}

function add(game: GameState, s: number, type: UnitType, q: number, r: number, extra = {}) {
  const unit = createUnitFromConfig(game.config, game.turn.turnOrder[s], type, q, r);
  Object.assign(unit, extra);
  game.units.push(unit);
  return game.units.length - 1;
}

function cell(game: GameState, q: number, r: number) {
  const c = game.cells.findIndex(cell => cell.q === q && cell.r === r);
  expect(c).toBeGreaterThanOrEqual(0);
  return c;
}

function act(game: GameState, type: 'move' | 'attack' | 'heal' | 'demolish', u: number, q: number, r: number): Action {
  return { type, u, c: cell(game, q, r) };
}

function deploy(game: GameState, s: number, type: UnitType, q?: number, r?: number): Action {
  const point = game.controlPoints.find(point => point.owner === game.turn.turnOrder[s])!;
  const M = createModel(game);
  const c = q === undefined ? M.neighbors[M.index.get(`${point.q},${point.r}`)]
    .find((c: number) => M.initial.terrain[c] === 'plain' && !M.initial.units.some((u: any) => u.c === c)) : cell(game, q, r!);
  return { type: 'deploy', unitType: type, fromId: point.id, c };
}

function setRound(game: GameState, round: number) {
  game.turn.roundNumber = game.turn.turnNumber = round;
  game.artillery = artilleryStateForRound(game, round);
  invalidateGameIndex(game);
}

function queue(game: GameState, M: any, s: number, action: Action, validate: boolean) {
  const owner: PlayerId = M.seats[s], target = 'c' in action ? M.cells[action.c] : undefined;
  const id = 'u' in action ? M.initial.units[action.u]?.id : undefined;
  if (!validate) {
    const pending: PendingAction = { id: `step-${s}-${game.plan!.queues[owner]?.length ?? 0}`, type: action.type };
    if (target) Object.assign(pending, { q: target.q, r: target.r });
    if (action.type === 'deploy') Object.assign(pending, { fromId: action.fromId, unitType: action.unitType });
    else if (action.type === 'attack') pending.attackerId = id;
    else if (action.type === 'heal') pending.supportId = id;
    else if (action.type !== 'wait') pending.unitId = id;
    (game.plan!.queues[owner] ??= []).push(pending);
    return;
  }
  let result;
  switch (action.type) {
    case 'move': result = queueMoveAction(game, owner, id, target.q, target.r); break;
    case 'attack': result = queueAttackAction(game, owner, id, target.q, target.r); break;
    case 'heal': result = queueHealAction(game, owner, id, target.q, target.r); break;
    case 'demolish': result = queueDemolishAction(game, owner, id, target.q, target.r); break;
    case 'deploy': result = queueDeployAction(game, owner, action.unitType, action.fromId, target.q, target.r); break;
    case 'wait': result = queueWaitAction(game, owner); break;
  }
  expect(result, `${owner} ${JSON.stringify(action)}`).toMatchObject({ ok: true });
}

function comparable(unit: any) {
  const { id, c, s, ...fields } = unit;
  return fields;
}

function compare(M: any, S: any, engine: GameState) {
  expect(S.active).toEqual(M.seats.map((id: PlayerId) => engine.players[id]?.status === 'active'));
  expect(S.supplies).toEqual(M.seats.map((id: PlayerId) => engine.resources[id]?.supplies ?? 0));
  expect(S.cpOwners).toEqual(engine.controlPoints.map(point => M.seats.indexOf(point.owner)));
  expect(S.terrain).toEqual(createModel(engine).initial.terrain);
  expect(S.units.filter((unit: any) => unit.alive).map(comparable)).toEqual(engine.units.filter(unit => unit.alive).map(comparable));
  for (const unit of S.units) {
    expect(M.cells[unit.c]).toMatchObject({ q: unit.q, r: unit.r });
    if (unit.id !== null) {
      const real = engine.units.find(candidate => candidate.id === unit.id);
      if (real) expect(comparable(unit)).toEqual(comparable(real));
      else expect(unit).toMatchObject({ hp: 0, alive: false });
    }
  }
  expect(S.kills).toEqual(M.seats.map((id: PlayerId) => (engine.players[id]?.stats.killValue ?? 0) - (M.game.players[id]?.stats.killValue ?? 0)));
}

function mirror(game: GameState, plans: Action[][], boundary = false, validate = true) {
  const M = createModel(game), S = cloneState(M.initial);
  const context = { failed: new Set<number>(), attacks: new Map<number, number>() };
  const planned = structuredClone(game);
  planned.plan = { queues: {}, committed: [] };
  plans.forEach((actions, s) => actions.forEach(action => queue(planned, M, s, action, validate)));
  let engine = structuredClone(planned);
  let result: ReturnType<typeof resolveRoundSteps> | undefined;
  const steps = Math.max(0, ...plans.map(actions => actions.length));
  for (let step = 0; step < steps; step++) {
    advance(M, S, M.seats.map((_: string, s: number) => plans[s]?.[step] ?? null), context);
    engine = structuredClone(planned);
    result = resolveRoundSteps(engine, new EventBus(), [...M.seats], new Map(M.seats.map((id: PlayerId) => [id, (planned.plan!.queues[id] ?? []).slice(0, step + 1)])));
    compare(M, S, engine);
    expect(S.ended).toBe(Boolean(result.ending));
    if (S.ended) break;
  }
  if (boundary) {
    finishRound(M, S);
    engine = structuredClone(planned);
    resolveRound(engine, new EventBus());
    compare(M, S, engine);
    expect(S.round).toBe(engine.turn.roundNumber);
    expect(S.ended).toBe(engine.phase === 'game_over');
  }
  return { M, S, context, engine, result };
}

describe('royale model geometry and expectations', () => {
  it('preserves native fields, initial alive ordering, active seats and branch isolation', () => {
    const game = fixture();
    add(game, 0, 'heavy', 0, 0);
    add(game, 0, 'scout', 1, 0, { alive: false });
    add(game, 1, 'support', 2, 0);
    const M = createModel(game), S = cloneState(M.initial);
    expect(M.specs).toBe(game.config.units);
    expect(M.A).toBe(game.config.balance.actionsPerTurn);
    expect(M.initial.units.map((u: any) => u.id)).toEqual([game.units[0].id, game.units[2].id]);
    expect(M.initial.units[0]).toMatchObject({ ...game.units[0], c: cell(game, 0, 0), s: 0 });
    S.units[0].hp = 1; S.supplies[0] = 0; S.cpOwners[0] = -1;
    S.terrain[0] = 'water'; S.active[0] = false; S.kills[0] = 999;
    expect(M.initial.units[0].hp).toBe(game.units[0].hp);
    expect(M.initial.supplies[0]).not.toBe(0);
    expect(M.initial.active).toEqual([true, true]);
    expect(M.initial.kills).toEqual([0, 0]);
    expect(game.cells[0].terrain).toBe('plain');
    game.players[game.turn.turnOrder[1]]!.status = 'eliminated';
    expect(createModel(game).seats).toEqual([game.turn.turnOrder[0]]);
  });

  it.each(['snowflake', 'narrow-road'])('matches every shape/click and terrain BFS on %s', map => {
    const game = fixture(map, 2, false), M = createModel(game);
    const S = cloneState(M.initial);
    for (const type of Object.keys(M.specs)) {
      for (const from of [0, Math.floor(M.cells.length / 2), M.cells.length - 1]) {
        const unit = { type, c: from, attackRange: M.specs[type].attackRange };
        for (const kind of ['attackShape', 'healShape']) {
          const options = aims(M, unit, kind);
          for (let c = 0; c < M.cells.length; c++) {
            const range = kind === 'healShape' ? M.specs[type].healRange ?? unit.attackRange : unit.attackRange;
            const expected = coveredCellsFor(M.cells[from], M.specs[type], kind as 'attackShape' | 'healShape', M.cells[c], range);
            const covered = expected?.cells.map(p => M.index.get(`${p.q},${p.r}`)).filter(c => c !== undefined) ?? null;
            expect(cover(M, unit, c, kind)).toEqual(covered);
            expect(options.find((aim: any) => aim.c === c)?.cover ?? null).toEqual(covered);
          }
        }
      }
    }
    for (let from = 0; from < M.cells.length; from++) {
      const actual = distances(M, S, from);
      const seen = new Map([[`${M.cells[from].q},${M.cells[from].r}`, 0]]), pending = [M.cells[from]];
      for (const position of pending) {
        for (const next of hexNeighbors(position)) {
          const k = `${next.q},${next.r}`, c = M.index.get(k);
          if (seen.has(k) || c === undefined || S.terrain[c] !== 'plain') continue;
          seen.set(k, seen.get(`${position.q},${position.r}`)! + 1); pending.push(next);
        }
      }
      expect(actual).toEqual(M.cells.map((p: any) => seen.get(`${p.q},${p.r}`) ?? Infinity));
    }
  });

  it('reads healRange, caps line length, preserves distinct lock clicks and ignores walls for attacks', () => {
    const game = fixture();
    game.config.units.ranger.attackShape = { type: 'line', length: 7 };
    game.config.units.support.healRange = 3;
    game.config.units.support.healShape = { type: 'single' };
    add(game, 0, 'ranger', 0, 0, { attackRange: 2 });
    add(game, 1, 'scout', 1, 0);
    add(game, 1, 'scout', 2, 0);
    const support = add(game, 0, 'support', 0, 1, { attackRange: 1 });
    game.map.terrainCells.push({ q: 1, r: 0, terrain: 'blocker' });
    const M = createModel(game), ranger = M.initial.units[0];
    const first = cell(game, 1, 0), second = cell(game, 2, 0);
    expect(cover(M, ranger, first)).toEqual([first, second]);
    expect(aims(M, ranger).filter((aim: any) => [first, second].includes(aim.c))).toHaveLength(2);
    expect(cover(M, ranger, cell(game, 3, 0))).toBeNull();
    expect(cover(M, ranger, cell(game, 1, 1))).toBeNull();
    expect(cover(M, M.initial.units[support], cell(game, 3, 1), 'healShape')).toEqual([cell(game, 3, 1)]);
  });

  it('averages every discrete damage roll after minimumDamage and every capped heal roll', () => {
    const game = fixture();
    const rng = vi.spyOn(random, 'nextGameRandom');
    try {
      for (const variance of [0, 1, 2, 5]) for (const minimum of [1, 3, 7]) {
        game.config.balance.damageVarianceRange = variance;
        game.config.balance.minimumDamage = minimum;
        const M = createModel(game);
        for (const attack of [0, 5, 12]) for (const defense of [0, 6, 20]) {
          const values = Array.from({ length: 2 * variance + 1 }, (_, i) => {
            rng.mockReturnValue((i + 0.5) / (2 * variance + 1));
            return computeDamage(game, attack, defense);
          });
          expect(damage(M, { attack }, { defense })).toBeCloseTo(values.reduce((a, b) => a + b, 0) / values.length, 12);
        }
      }
      game.config.balance.healVarianceRange = 4;
      const M = createModel(game);
      expect(__internals.healAmount(M, { healPower: 2 }, { hp: 7, maxHp: 10 })).toBe(2.8);
    } finally { rng.mockRestore(); }
  });

  it('weights fractional variance endpoints like the real damage and healing rolls', () => {
    const game = fixture();
    const rng = vi.spyOn(random, 'nextGameRandom');
    try {
      for (const variance of [0.25, 0.5, 1.25]) for (const defense of [0, 10]) {
        game.config.balance.damageVarianceRange = variance;
        const samples = Array.from({ length: 42 }, (_, i) => {
          rng.mockReturnValue((i + 0.5) / 42);
          return computeDamage(game, 10, defense);
        });
        expect(damage(createModel(game), { attack: 10 }, { defense }))
          .toBeCloseTo(samples.reduce((a, b) => a + b, 0) / samples.length, 12);
      }
      game.config.units.support.healShape = { type: 'single' };
      const support = add(game, 0, 'support', 0, 0, { healPower: 2, maxHp: 10, hp: 1 });
      add(game, 1, 'scout', 5, 0);
      const owner = game.units[support].owner;
      expect(queueHealAction(game, owner, game.units[support].id, 0, 0).ok).toBe(true);
      for (const variance of [0.25, 0.5, 1.5]) for (const hp of [1, 7]) {
        game.config.balance.healVarianceRange = variance;
        game.units[support].hp = hp;
        const samples = Array.from({ length: 30 }, (_, i) => {
          rng.mockReturnValue((i + 0.5) / 30);
          const engine = structuredClone(game);
          resolveRoundSteps(engine, new EventBus(), [...engine.turn.turnOrder], new Map([[owner, engine.plan!.queues[owner]!]]));
          return engine.units[support].hp - hp;
        });
        expect(__internals.healAmount(createModel(game), game.units[support], game.units[support]))
          .toBeCloseTo(samples.reduce((a, b) => a + b, 0) / samples.length, 12);
      }
    } finally { rng.mockRestore(); }
  });
});

describe('royale model synchronous steps', () => {
  it('deploys immediately from zero units, but eliminates a waiting player before their later deploy', () => {
    const game = fixture('narrow-road', 2, false);
    const both = mirror(game, [[deploy(game, 0, 'heavy')], [deploy(game, 1, 'heavy')]], true);
    expect(both.S.active).toEqual([true, true]);
    expect(both.S.units.map((u: any) => u.id)).toEqual([null, null]);
    const late = mirror(game, [[{ type: 'wait' }, deploy(game, 0, 'heavy')], [deploy(game, 1, 'heavy')]], true);
    expect(late.S.active).toEqual([false, true]);
    expect(late.S.units).toHaveLength(1);
    expect(late.S.round).toBe(1);
    const empty = mirror(game, [[{ type: 'wait' }], [{ type: 'wait' }]], true);
    expect(empty.S.active).toEqual([false, false]);
    expect(empty.S.cpOwners).toEqual([-1, -1]);
    expect(empty.engine.result?.reason).toBe('mutual_annihilation');
  });

  it('distinguishes an absent step from waits, including an entirely empty first round', () => {
    const game = fixture('narrow-road', 2, false), M = createModel(game), S = cloneState(M.initial);
    advance(M, S, [null, null], { failed: new Set(), attacks: new Map() });
    expect(S.active).toEqual([true, true]);
    const result = mirror(game, [[], []], true);
    expect(result.S.active).toEqual([false, false]);
    expect(result.S.round).toBe(2);
  });

  it('settles mutual kills before elimination and stops without terminal artillery or income', () => {
    const game = fixture();
    add(game, 0, 'scout', 8, 0, { attack: 999, hp: 1 });
    add(game, 1, 'scout', 7, 0, { attack: 999, hp: 1 });
    setRound(game, 5);
    const { S } = mirror(game, [[act(game, 'attack', 0, 7, 0)], [act(game, 'attack', 1, 8, 0)]], true);
    expect(S.units).toHaveLength(2);
    expect(S.units.every((u: any) => !u.alive)).toBe(true);
    expect(S.kills).toEqual([game.units[1].cost, game.units[0].cost]);
    expect(S.round).toBe(5);
    expect(S.supplies).toEqual([500, 500]);
  });

  it('keeps the winner alive even if next-round artillery would kill them', () => {
    const game = fixture();
    add(game, 0, 'ranger', 9, 0, { attack: 999, hp: 1 });
    add(game, 1, 'scout', 8, 0, { hp: 1 });
    setRound(game, 5);
    const { S } = mirror(game, [[act(game, 'attack', 0, 8, 0)], []], true);
    expect(S.active).toEqual([true, false]);
    expect(S.units[0].hp).toBe(1);
    expect(S.round).toBe(5);
  });

  it('supports swaps and chains, then attacks the final occupancy', () => {
    const game = fixture('snowflake', 3);
    add(game, 0, 'scout', 0, 0);
    add(game, 1, 'scout', 1, 0);
    add(game, 2, 'ranger', 3, 0);
    mirror(game, [[act(game, 'move', 0, 1, 0)], [act(game, 'move', 1, 0, 0)], [act(game, 'attack', 2, 1, 0)]]);
    mirror(game, [[act(game, 'move', 0, 1, 0)], [act(game, 'move', 1, 2, 0)], [act(game, 'move', 2, 0, 0)]]);
  });

  it('cascades destination conflicts through arrival dependencies and later unit actions', () => {
    const game = fixture('snowflake', 3);
    add(game, 0, 'scout', -1, 0);
    add(game, 1, 'scout', 0, 0);
    add(game, 2, 'scout', 2, 0);
    const { S, context } = mirror(game, [
      [act(game, 'move', 0, 0, 0), act(game, 'attack', 0, 1, 0)],
      [act(game, 'move', 1, 1, 0), act(game, 'move', 1, 1, -1)],
      [act(game, 'move', 2, 1, 0)],
    ]);
    expect([...context.failed].sort()).toEqual([0, 1, 2]);
    expect(context.attacks.size).toBe(0);
    expect(S.units.map((u: any) => [u.q, u.r])).toEqual([[-1, 0], [0, 0], [2, 0]]);
  });

  it('does not cascade attack misses or heal fizzles, but counts missed attacks against the cap', () => {
    const game = fixture();
    game.config.balance.attacksPerUnit = 2;
    game.config.units.support.healShape = { type: 'single' };
    add(game, 0, 'support', 0, 0);
    add(game, 1, 'scout', 5, 0);
    const { context, S } = mirror(game, [[
      act(game, 'heal', 0, 1, 0), act(game, 'attack', 0, 1, 0), act(game, 'attack', 0, 1, 0),
      act(game, 'attack', 0, 1, 0), act(game, 'move', 0, 1, 0),
    ], []], false, false);
    expect(context.attacks.get(0)).toBe(2);
    expect(context.failed.has(0)).toBe(true);
    expect(S.units[0].q).toBe(0);
  });

  it('hard-fails an out-of-range attack and skips a dead unit without consuming an attack', () => {
    const game = fixture();
    add(game, 0, 'scout', 0, 0);
    add(game, 0, 'scout', 1, 0, { hp: 1 });
    add(game, 1, 'ranger', 3, 0, { attack: 999 });
    const { context } = mirror(game, [[
      act(game, 'attack', 0, 7, 0), act(game, 'move', 0, 1, -1), act(game, 'attack', 1, 2, 0),
    ], [act(game, 'attack', 2, 1, 0)]], false, false);
    expect([...context.failed].sort()).toEqual([0, 1]);
    expect(context.attacks.get(0)).toBe(1);
    expect(context.attacks.has(1)).toBe(false);
  });

  it.each([2, 4])('locks the initial enemy after movement to distance %i', destination => {
    const game = fixture();
    add(game, 0, 'ranger', 0, 0);
    add(game, 1, 'scout', 1, 0);
    const { S } = mirror(game, [[act(game, 'attack', 0, 1, 0)], [act(game, 'move', 1, destination, 0)]]);
    expect(S.units[1].hp < game.units[1].hp).toBe(destination <= 3);
  });

  it('locks round-start positions even for later steps, then falls back after the locked target dies', () => {
    const game = fixture();
    add(game, 0, 'ranger', 0, 0, { attack: 999 });
    add(game, 0, 'ranger', 0, 1, { attack: 999 });
    add(game, 1, 'scout', 1, 0);
    add(game, 1, 'scout', 2, -1);
    add(game, 1, 'scout', 5, 0);
    const { S } = mirror(game, [[
      { type: 'wait' }, act(game, 'attack', 0, 1, 0), act(game, 'attack', 1, 1, 0),
    ], [act(game, 'move', 2, 2, 0), { type: 'wait' }, act(game, 'move', 3, 1, 0)]]);
    expect(S.units[2].alive).toBe(false);
    expect(S.units[3].alive).toBe(false);
    expect(S.kills[0]).toBe(game.units[2].cost + game.units[3].cost);
  });

  it('neutralizes eliminated owners and does not lock their removed corpses again', () => {
    const game = fixture('snowflake', 3);
    add(game, 0, 'ranger', 0, 0, { attack: 999 });
    add(game, 1, 'scout', 1, 0);
    add(game, 2, 'ranger', 2, 0, { attack: 999 });
    const { S } = mirror(game, [[act(game, 'attack', 0, 1, 0)], [], [{ type: 'wait' }, act(game, 'attack', 2, 1, 0)]]);
    expect(S.active).toEqual([true, false, true]);
    expect(S.kills).toEqual([game.units[1].cost, 0, 0]);
    expect(S.cpOwners).not.toContain(1);
  });

  it.each(['line', 'arc'] as const)('applies %s damage to every covered enemy, once per killing blow', shape => {
    const game = fixture('snowflake', 3);
    game.config.units.heavy.attackShape = { type: shape, length: 2 };
    add(game, 0, 'heavy', 0, 0, { attackRange: 2, attack: 999 });
    add(game, 1, 'scout', 1, 0);
    add(game, 1, 'scout', shape === 'line' ? 2 : 1, shape === 'line' ? 0 : -1);
    add(game, 1, 'scout', 0, 1);
    add(game, 2, 'ranger', 3, 0, { attack: 999 });
    const { S } = mirror(game, [[act(game, 'attack', 0, 1, 0)], [], [act(game, 'attack', 4, 1, 0)]]);
    expect(S.kills).toEqual([(shape === 'line' ? 2 : 3) * game.units[1].cost, 0, 0]);
  });

  it('uses healRange and heals before lethal damage, with maxHp capping', () => {
    const game = fixture();
    game.config.units.support.healRange = 3;
    game.config.units.support.healShape = { type: 'single' };
    add(game, 0, 'support', -2, 0, { attackRange: 1, healPower: 20 });
    add(game, 0, 'scout', 1, 0, { hp: 1, maxHp: 15, defense: 0 });
    add(game, 1, 'ranger', 2, 0, { attack: 10 });
    const { S } = mirror(game, [[act(game, 'heal', 0, 1, 0)], [act(game, 'attack', 2, 1, 0)]]);
    expect(S.units[1].hp).toBe(5);
  });

  it('fizzles a whole heal shape if any in-map covered cell or the caster is in danger', () => {
    const game = fixture();
    add(game, 0, 'support', 8, 0, { healPower: 50, hp: 20 });
    add(game, 0, 'scout', 8, 1, { hp: 1 });
    add(game, 0, 'scout', 7, 1, { hp: 1 });
    add(game, 1, 'scout', 0, 0);
    setRound(game, 6);
    const { S, context } = mirror(game, [[act(game, 'heal', 0, 8, 1), act(game, 'move', 0, 7, 0)]], false);
    expect(S.units[1].hp).toBe(1);
    expect(S.units[2].hp).toBe(1);
    expect(context.failed.size).toBe(0);
    game.config.units.support.healShape = { type: 'single' };
    game.units[0].q = 9;
    mirror(game, [[act(game, 'heal', 0, 8, 1)]], false);
  });

  it('allows demolish then movement, while same-step arrivals see the old terrain', () => {
    const game = fixture();
    add(game, 0, 'heavy', 0, 0);
    add(game, 1, 'scout', 2, 0);
    game.map.terrainCells.push({ q: 1, r: 0, terrain: 'blocker' });
    const initial = createModel(game);
    expect(distances(initial, initial.initial, cell(game, 0, 0))[cell(game, 1, 0)]).toBe(Infinity);
    const { S, M } = mirror(game, [[act(game, 'demolish', 0, 1, 0), act(game, 'move', 0, 1, 0)], []]);
    expect(distances(M, S, cell(game, 0, 0))[cell(game, 1, 0)]).toBe(1);
    const blocked = mirror(game, [[act(game, 'demolish', 0, 1, 0)], [act(game, 'move', 1, 1, 0)]], false, false);
    expect(blocked.context.failed.has(1)).toBe(true);
    expect(blocked.S.terrain[cell(game, 1, 0)]).toBe('plain');
  });

  it('makes the later duplicate demolish fail and cascade', () => {
    const game = fixture();
    add(game, 0, 'heavy', 0, 0);
    add(game, 1, 'heavy', 2, 0);
    game.map.terrainCells.push({ q: 1, r: 0, terrain: 'blocker' });
    const { context } = mirror(game, [[act(game, 'demolish', 0, 1, 0)], [act(game, 'demolish', 1, 1, 0), act(game, 'move', 1, 2, 1)]]);
    expect(context.failed).toEqual(new Set([1]));
  });

  it('charges discounted deploy costs, allows same-step vacating, and hits newly deployed units', () => {
    const game = fixture('narrow-road');
    game.config.balance.controlPointTypes!.forward_base.deployDiscount = 3;
    const point = game.controlPoints.find(p => p.owner === game.turn.turnOrder[0])!;
    point.q = 0; point.r = 0;
    add(game, 0, 'scout', -1, 0);
    add(game, 1, 'ranger', 1, 0);
    game.config.units.ranger.attackLock = true;
    const first = deploy(game, 0, 'heavy', 1, 0);
    const { S } = mirror(game, [[first, deploy(game, 0, 'infantry', 0, 1)], [act(game, 'move', 1, 2, 0), act(game, 'attack', 1, 0, 1)]]);
    expect(S.supplies[0]).toBe(20 - 7 - 2);
    expect(S.units[2].id).toBeNull();
    expect(S.units[3].hp).toBe(2);
    expect(S.units[3].alive).toBe(true);
  });

  it('caps discount at cost and refuses insufficient supplies without a unit failure cascade', () => {
    const game = fixture('narrow-road');
    add(game, 0, 'scout', 0, 0); add(game, 1, 'scout', 3, 0);
    game.resources[game.turn.turnOrder[0]]!.supplies = 0;
    game.config.balance.controlPointTypes!.forward_base.deployDiscount = 50;
    const free = mirror(game, [[deploy(game, 0, 'heavy')], []]);
    expect(free.S.supplies[0]).toBe(0);
    expect(free.S.units).toHaveLength(3);
    game.config.balance.controlPointTypes!.forward_base.deployDiscount = 0;
    const failed = mirror(game, [[deploy(game, 0, 'heavy'), act(game, 'move', 0, 1, 0)], []], false, false);
    expect(failed.S.units[0].q).toBe(1);
    expect(failed.context.failed.size).toBe(0);
  });

  it('rejects deployment with a lost/disabled origin or dangerous origin/destination', () => {
    for (const reason of ['owner', 'disabled', 'origin-danger', 'target-danger']) {
      const game = fixture('narrow-road');
      add(game, 0, 'scout', 0, 0); add(game, 1, 'scout', 2, 0);
      const point = game.controlPoints.find(p => p.owner === game.turn.turnOrder[0])!;
      point.q = -5; point.r = 0;
      const action = deploy(game, 0, 'heavy', reason === 'target-danger' ? -6 : -4, 0);
      if (reason === 'owner') point.owner = game.turn.turnOrder[1];
      if (reason === 'disabled') game.config.balance.controlPointTypes!.forward_base.canDeploy = false;
      if (reason === 'origin-danger') setRound(game, 11);
      if (reason === 'target-danger') setRound(game, 10);
      const M = createModel(game), S = cloneState(M.initial);
      expect(queueDeployAction(game, M.seats[0], 'heavy', point.id, M.cells[(action as any).c].q, 0).ok).toBe(false);
      advance(M, S, [action, null], { failed: new Set(), attacks: new Map() });
      expect(S.units).toHaveLength(2);
      expect(S.supplies[0]).toBe(20);
    }
  });
});

describe('royale model round boundary', () => {
  it.each(['snowflake', 'narrow-road'])('derives %s shrink boundaries from config using round+1', map => {
    const game = fixture(map, 2, false);
    if (!game.units.length) { add(game, 0, 'heavy', -6, 0); add(game, 1, 'heavy', 6, 0); }
    const config = game.config.annihilation!.artillery;
    for (const delta of [0, 2]) {
      config.startRound += delta; config.intervalRounds = delta + 1; config.minimumSafeRadius = delta;
      const M = createModel(game);
      for (let round = 1; round <= config.startRound + 30; round++) {
        expect(safeRadius(M, round)).toBe(artilleryStateForRound(game, round)!.safeRadius);
      }
      setRound(game, config.startRound - 1);
      const { S } = mirror(game, [[], []], true);
      expect(S.round).toBe(config.startRound);
      expect(S.units[0].hp).toBe(game.units[0].hp - config.damage);
    }
    delete game.config.annihilation;
    const M = createModel(game);
    expect(safeRadius(M, 999)).toBe(Infinity);
  });

  it('clears artillery-wiped players together and gives nobody environmental kill credit or terminal income', () => {
    const game = fixture();
    add(game, 0, 'scout', 9, 0, { hp: 1 });
    add(game, 1, 'scout', -9, 0, { hp: 1 });
    setRound(game, 5);
    const { S } = mirror(game, [[], []], true);
    expect(S.active).toEqual([false, false]);
    expect(S.cpOwners.every((owner: number) => owner === -1)).toBe(true);
    expect(S.kills).toEqual([0, 0]);
    expect(S.supplies).toEqual([500, 500]);
    expect(S.round).toBe(6);
  });

  it('captures only with canCapture, then applies income and at most one safe repair per unit', () => {
    const game = fixture();
    game.controlPoints = [
      { id: 'one', name: 'one', kind: 'repair', q: 0, r: 0, owner: game.turn.turnOrder[1] },
      { id: 'two', name: 'two', kind: 'repair', q: 1, r: 0, owner: game.turn.turnOrder[0] },
      { id: 'three', name: 'three', q: 4, r: 0, owner: game.turn.turnOrder[1] },
    ];
    game.config.balance.controlPointIncome = 17;
    game.config.balance.controlPointTypes!.repair = { income: 3, repairAmount: 11, deployDiscount: 0 };
    add(game, 0, 'scout', 0, 0, { hp: 10 });
    add(game, 0, 'heavy', 4, 0, { hp: 10 });
    add(game, 1, 'scout', -3, 0);
    const { S } = mirror(game, [[], []], true);
    expect(S.cpOwners).toEqual([0, 0, 1]);
    expect(S.units[0].hp).toBe(21);
    expect(S.units[1].hp).toBe(10);
    expect(S.supplies).toEqual([526, 537]);
  });

  it('blocks repairs from unsafe points and to unsafe units, but still collects point income', () => {
    const game = fixture();
    game.controlPoints = [
      { id: 'unsafe', name: 'unsafe', kind: 'repair', q: 9, r: 0, owner: game.turn.turnOrder[0] },
      { id: 'safe', name: 'safe', kind: 'repair', q: 8, r: 0, owner: game.turn.turnOrder[0] },
    ];
    game.config.balance.controlPointTypes!.repair = { income: 7, repairAmount: 20, deployDiscount: 0 };
    add(game, 0, 'heavy', 9, 0, { hp: 80 });
    add(game, 0, 'scout', 8, 1, { hp: 50 });
    add(game, 1, 'scout', 0, 0);
    setRound(game, 5);
    const { S } = mirror(game, [[], []], true);
    expect(S.units[0].hp).toBe(55);
    expect(S.units[1].hp).toBe(25);
    expect(S.supplies[0]).toBe(534);
  });

  it('ends at a configured turn limit after captures without advancing into artillery', () => {
    const game = fixture();
    add(game, 0, 'scout', 9, 0, { hp: 1 }); add(game, 1, 'scout', 0, 0);
    game.config.balance.maxTurns = 5;
    setRound(game, 5);
    const { S } = mirror(game, [[], []], true);
    expect(S.round).toBe(5);
    expect(S.units[0].hp).toBe(1);
    expect(S.ended).toBe(true);
  });

  it.each(['snowflake', 'narrow-road'])('matches multi-round actual-map play with perturbed specs on %s', map => {
    let seed = 12345;
    const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (const variant of [0, 1, 2]) {
      let game = fixture(map, map === 'snowflake' && variant === 2 ? 6 : 2, false);
      game.config.balance.actionsPerTurn = 4 + variant;
      game.config.balance.attacksPerUnit = 1 + variant;
      game.config.balance.minimumDamage = 1 + variant;
      game.config.balance.baseIncome += variant;
      game.config.balance.controlPointTypes!.forward_base.deployDiscount = variant;
      game.config.annihilation!.artillery.startRound = 3 + variant;
      game.config.annihilation!.artillery.intervalRounds = 1 + variant;
      game.config.annihilation!.artillery.damage += variant;
      for (const spec of Object.values(game.config.units)) {
        spec.attack += variant; spec.defense += variant; spec.moveRange = 1 + variant;
        spec.attackRange = 2 + variant;
      }
      game.config.units.support.healRange = 3;
      for (const unit of game.units) Object.assign(unit, {
        attack: game.config.units[unit.type].attack, defense: game.config.units[unit.type].defense,
        moveRange: game.config.units[unit.type].moveRange, attackRange: game.config.units[unit.type].attackRange,
      });
      for (let round = 0; round < 7 && game.phase !== 'game_over'; round++) {
        const M = createModel(game);
        const planning = structuredClone(game);
        planning.plan = { queues: {}, committed: [] };
        const plans: Action[][] = M.seats.map(() => []);
        for (let s = 0; s < M.seats.length; s++) {
          const projection = cloneState(M.initial);
          const counts = new Map<number, number>();
          for (let step = 0; step < M.A; step++) {
            const options: Action[] = [{ type: 'wait' }];
            projection.units.forEach((unit: any, u: number) => {
              if (unit.s !== s || unit.id === null || !unit.alive) return;
              const reachable = distances(M, projection, unit.c);
              reachable.forEach((d: number, c: number) => { if (d > 0 && d <= unit.moveRange) options.push({ type: 'move', u, c }); });
              if ((counts.get(u) ?? 0) < M.attackLimit) for (const aim of aims(M, unit)) options.push({ type: 'attack', u, c: aim.c });
              if (unit.type === 'heavy') for (const c of M.neighbors[unit.c]) {
                if (projection.terrain[c] === 'blocker') options.push({ type: 'demolish', u, c });
              }
              if (unit.type === 'support') for (const aim of aims(M, unit, 'healShape')) options.push({ type: 'heal', u, c: aim.c });
            });
            M.points.forEach((p: any, i: number) => {
              if (projection.cpOwners[i] !== s) return;
              for (const c of M.neighbors[p.c]) for (const unitType of Object.keys(M.specs) as UnitType[]) {
                const action: Action = { type: 'deploy', unitType, fromId: p.id, c };
                const cost = __internals.deployCost(M, projection, s, action);
                if (projection.terrain[c] === 'plain' && cost !== null && cost <= projection.supplies[s]) options.push(action);
              }
            });
            const pool = step === 0 && !projection.units.some((u: any) => u.s === s) ? options.filter(a => a.type === 'deploy') : options;
            const action = pool[Math.floor(next() * pool.length)] ?? { type: 'wait' };
            queue(planning, M, s, action, true);
            plans[s].push(action);
            if (action.type === 'move') projection.units[action.u].c = action.c;
            if (action.type === 'demolish') projection.terrain[action.c] = 'plain';
            if (action.type === 'attack') counts.set(action.u, (counts.get(action.u) ?? 0) + 1);
            if (action.type === 'deploy') projection.supplies[s] -= __internals.deployCost(M, projection, s, action);
          }
        }
        game = mirror(game, plans, true).engine;
      }
    }
  });
});
