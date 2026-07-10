import { describe, expect, it } from 'vitest';
import { createInitialGame } from '../../src/state/store.js';
import { EventBus } from '../../src/events/bus.js';
import { findReachableCells } from '../../src/engine/validation.js';
import { moveUnit } from '../../src/engine/units.js';
import { attackTarget, healTarget } from '../../src/engine/combat.js';
import { deployUnit } from '../../src/engine/deployment.js';
import { buildAdjudicationScores, endTurn, joinGame } from '../../src/engine/engine.js';
import type { Unit } from '../../src/types.js';

function setup() {
  const game = createInitialGame('g1');
  const bus = new EventBus();
  joinGame(game, bus, 'B');
  return { game, bus };
}

function testUnit(overrides: Partial<Unit>): Unit {
  return {
    id: 'unit',
    owner: 'player_a',
    type: 'infantry',
    q: 0,
    r: 0,
    hp: 100,
    maxHp: 100,
    attack: 30,
    defense: 8,
    moveRange: 3,
    attackRange: 1,
    cost: 45,
    alive: true,
    hasMoved: false,
    hasActed: false,
    actionSpent: false,
    canCapture: true,
    ...overrides,
  };
}

describe('hex V2 rules', () => {
  it('creates a radius-8 hex game with HQs, units, control points and resources', () => {
    const game = createInitialGame('g1');
    expect(game.map.radius).toBe(8);
    expect(game.controlPoints).toHaveLength(5);
    expect(game.headquarters.player_a.q).toBe(-8);
    expect(game.headquarters.player_b.q).toBe(8);
    expect(game.units.filter(u => u.owner === 'player_a')).toHaveLength(3);
    expect(game.resources.player_a.supplies).toBe(80);
  });

  it('uses BFS movement and blocks paths through impassable terrain', () => {
    const { game, bus } = setup();
    game.map.terrainCells.push({ q: -6, r: 0, terrain: 'water' });
    const unit = game.units.find(u => u.owner === 'player_a' && u.type === 'scout')!;
    unit.q = -7; unit.r = 0; unit.moveRange = 2;

    const reachable = findReachableCells(game, unit);
    expect(reachable).not.toContainEqual({ q: -6, r: 0 });
    expect(moveUnit(game, bus, 'player_a', unit.id, -6, 0).ok).toBe(false);
  });

  it('captures control points at end turn and gives income to the next player', () => {
    const { game, bus } = setup();
    const unit = game.units.find(u => u.owner === 'player_a' && u.type === 'infantry')!;
    unit.q = -4; unit.r = 0;
    const beforeB = game.resources.player_b.supplies;

    const result = endTurn(game, bus, 'player_a');

    expect(result.ok).toBe(true);
    expect(game.controlPoints.find(p => p.q === -4 && p.r === 0)!.owner).toBe('player_a');
    expect(game.resources.player_b.supplies).toBe(beforeB + 10);
    expect(game.events.some(e => e.type === 'control_point_captured')).toBe(true);
    expect(game.events.some(e => e.type === 'income')).toBe(true);
  });

  it('uses typed control point income on typed maps while keeping score based on point count', () => {
    const game = createInitialGame('g1', 'dual-lanes');
    const bus = new EventBus();
    joinGame(game, bus, 'B');
    game.controlPoints.find(p => p.id === 'cp_nw')!.owner = 'player_b';
    game.controlPoints.find(p => p.id === 'cp_nc')!.owner = 'player_b';
    game.controlPoints.find(p => p.id === 'cp_ne')!.owner = 'player_b';
    game.turn.currentOwner = 'player_a';
    const beforeB = game.resources.player_b.supplies;

    const result = endTurn(game, bus, 'player_a');

    expect(result.ok).toBe(true);
    expect(game.resources.player_b.supplies).toBe(beforeB + 10 + 12 + 8 + 12);
    const income = game.events.find(e => e.type === 'income' && e.payload.owner === 'player_b')!;
    expect(income.payload).toMatchObject({
      base: 10,
      control: 32,
      controlPoints: 3,
      amount: 42,
    });
    expect(income.payload.breakdown).toEqual([
      expect.objectContaining({ pointId: 'cp_nw', kind: 'supply', amount: 12 }),
      expect.objectContaining({ pointId: 'cp_nc', kind: 'repair', amount: 8 }),
      expect.objectContaining({ pointId: 'cp_ne', kind: 'supply', amount: 12 }),
    ]);
    game.resources.player_a.supplies = 0;
    game.resources.player_b.supplies = 0;
    game.units = [];
    const scores = buildAdjudicationScores(game);
    expect(scores.player_b.controlPoints).toBe(3);
    expect(scores.player_b.total).toBe(180 * 2 + 3 * 90);
  });

  it('starts dual-lanes with no free units and enough supplies for player deployment choices', () => {
    const game = createInitialGame('g1', 'dual-lanes');

    expect(game.units).toHaveLength(0);
    expect(game.resources.player_a.supplies).toBe(208);
    expect(game.resources.player_b.supplies).toBe(208);
  });

  it('only units with canCapture flag can capture control points', () => {
    const { game, bus } = setup();
    const unit = game.units.find(u => u.owner === 'player_a' && u.type === 'infantry')!;
    unit.type = 'heavy';
    unit.canCapture = false;
    unit.q = -4; unit.r = 0;

    endTurn(game, bus, 'player_a');

    expect(game.controlPoints.find(p => p.q === -4 && p.r === 0)!.owner).toBeNull();
  });

  it('deploys from owned HQ or control point to an adjacent empty plain cell', () => {
    const { game, bus } = setup();
    const result = deployUnit(game, bus, 'player_a', 'scout', game.headquarters.player_a.id, -8, 1);

    expect(result.ok).toBe(true);
    expect(game.resources.player_a.supplies).toBe(42);
    const deployed = game.units.find(u => u.type === 'scout' && u.q === -8 && u.r === 1)!;
    expect(deployed.hasMoved).toBe(true);
    expect(deployed.hasActed).toBe(false);
    expect(deployed.actionSpent).toBe(true);
    expect(game.turn.actionsUsed).toBe(1);
    expect(game.events.at(-1)!.type).toBe('deploy');
  });

  it('discounts deployments from forward bases without changing unit army value', () => {
    const game = createInitialGame('g1', 'dual-lanes');
    const bus = new EventBus();
    joinGame(game, bus, 'B');
    const origin = game.controlPoints.find(p => p.id === 'cp_sw')!;
    origin.owner = 'player_a';
    game.resources.player_a.supplies = 38;

    const result = deployUnit(game, bus, 'player_a', 'scout', origin.id, -5, 4);

    expect(result.ok).toBe(true);
    expect(game.resources.player_a.supplies).toBe(8);
    expect(result.data?.cost).toBe(38);
    expect(game.events.at(-1)).toMatchObject({
      type: 'deploy',
      payload: expect.objectContaining({ cost: 30, unitCost: 38, discount: 8 }),
    });
  });

  it('repairs friendly units near owned repair points at the start of their turn', () => {
    const game = createInitialGame('g1', 'dual-lanes');
    const bus = new EventBus();
    joinGame(game, bus, 'B');
    game.controlPoints.find(p => p.id === 'cp_nc')!.owner = 'player_b';
    const friendly = testUnit({ id: 'friendly', owner: 'player_b', q: 2, r: -3, hp: 40 });
    const enemy = testUnit({ id: 'enemy', owner: 'player_a', q: 1, r: -4, hp: 40 });
    game.units.push(friendly, enemy);
    game.turn.currentOwner = 'player_a';

    const result = endTurn(game, bus, 'player_a');

    expect(result.ok).toBe(true);
    expect(friendly.hp).toBe(50);
    expect(enemy.hp).toBe(40);
    expect(game.events).toContainEqual(expect.objectContaining({
      type: 'control_point_repair',
      payload: expect.objectContaining({
        owner: 'player_b',
        pointId: 'cp_nc',
        unitId: friendly.id,
        amount: 10,
        unitHp: 50,
      }),
    }));
  });

  it('attacks by hex range and ends the game when HQ reaches zero hp', () => {
    const { game, bus } = setup();
    const ranger = game.units.find(u => u.owner === 'player_a' && u.type === 'infantry')!;
    ranger.type = 'ranger';
    ranger.attack = 500;
    ranger.attackRange = 3;
    ranger.q = 6; ranger.r = 0;

    const result = attackTarget(game, bus, 'player_a', ranger.id, game.headquarters.player_b.id);

    expect(result.ok).toBe(true);
    expect(game.phase).toBe('game_over');
    expect(game.winner).toBe('player_a');
    expect(game.result).toMatchObject({ winner: 'player_a', reason: 'last_player_standing' });
    expect(game.events.some(e => e.type === 'headquarters_destroyed')).toBe(true);
    expect(game.events.find(e => e.type === 'player_eliminated')!.payload.reason).toBe('headquarters_destroyed');
    expect(game.events.find(e => e.type === 'game_over')!.payload.reason).toBe('last_player_standing');
  });

  it('does not adjudicate after player_a ends turn 15', () => {
    const { game, bus } = setup();
    game.turn.turnNumber = 15;
    game.turn.currentOwner = 'player_a';

    const result = endTurn(game, bus, 'player_a');

    expect(result.ok).toBe(true);
    expect(game.phase).toBe('active');
    expect(game.turn.turnNumber).toBe(15);
    expect(game.turn.currentOwner).toBe('player_b');
    expect(game.result).toBeNull();
  });

  it('adjudicates by score after player_b ends turn 15 and captures first', () => {
    const { game, bus } = setup();
    game.turn.turnNumber = 15;
    game.turn.roundNumber = 15;
    game.turn.currentOwner = 'player_b';
    game.turn.currentPlayerId = 'player_b';
    game.turn.actedThisRound = ['player_a'];
    game.resources.player_a.supplies = 0;
    game.resources.player_b.supplies = 0;
    game.headquarters.player_a.hp = 200;
    game.headquarters.player_b.hp = 200;
    game.units = game.units.slice(0, 1);
    const unit = game.units[0];
    unit.owner = 'player_b';
    unit.type = 'infantry';
    unit.canCapture = true;
    unit.q = 0;
    unit.r = 0;

    const result = endTurn(game, bus, 'player_b');

    expect(result.ok).toBe(true);
    expect(game.phase).toBe('game_over');
    expect(game.turn.turnNumber).toBe(15);
    expect(game.turn.currentOwner).toBe('player_b');
    expect(game.winner).toBe('player_b');
    expect(game.result).toMatchObject({
      winner: 'player_b',
      reason: 'turn_limit_score',
      scores: {
        player_b: expect.objectContaining({ controlPoints: 1 }),
      },
    });
    expect(game.controlPoints.find(p => p.id === 'cp_c')!.owner).toBe('player_b');
    expect(game.events.at(-1)).toMatchObject({
      type: 'game_over',
      payload: expect.objectContaining({ winner: 'player_b', reason: 'turn_limit_score' }),
    });
  });

  it('records a draw when turn-limit adjudication scores are tied', () => {
    const { game, bus } = setup();
    game.turn.turnNumber = 15;
    game.turn.roundNumber = 15;
    game.turn.currentOwner = 'player_b';
    game.turn.currentPlayerId = 'player_b';
    game.turn.actedThisRound = ['player_a'];
    game.resources.player_a.supplies = 0;
    game.resources.player_b.supplies = 0;
    game.units = [];
    game.controlPoints.forEach(p => { p.owner = null; });
    game.headquarters.player_a.hp = 200;
    game.headquarters.player_b.hp = 200;

    const result = endTurn(game, bus, 'player_b');

    expect(result.ok).toBe(true);
    expect(game.phase).toBe('game_over');
    expect(game.turn.turnNumber).toBe(15);
    expect(game.turn.currentOwner).toBe('player_b');
    expect(game.winner).toBeNull();
    expect(game.result).toMatchObject({ winner: null, reason: 'turn_limit_draw' });
    expect(game.events.at(-1)).toMatchObject({
      type: 'game_over',
      payload: expect.objectContaining({ winner: null, reason: 'turn_limit_draw' }),
    });
  });

  it('support heals friendly units by supportId', () => {
    const { game, bus } = setup();
    const support = game.units.find(u => u.owner === 'player_a' && u.type === 'infantry')!;
    support.type = 'support';
    support.healPower = 28;
    support.q = -7; support.r = 0;
    const target = game.units.find(u => u.owner === 'player_a' && u.id !== support.id)!;
    target.q = -7; target.r = 1; target.hp = 50;

    const result = healTarget(game, bus, 'player_a', support.id, target.id);

    expect(result.ok).toBe(true);
    expect(target.hp).toBeGreaterThan(50);
    expect(support.hasActed).toBe(true);
  });

  it('limits the player to actionsPerTurn activations across deploy/move/attack', () => {
    const { game, bus } = setup();
    const limit = game.config.balance.actionsPerTurn;
    expect(limit).toBe(5);
    expect(game.turn.actionsUsed).toBe(0);

    // Stage 6 player_a infantry, each on its own plain cell with a distinct
    // adjacent free plain cell to step into. Cells are spread so no overlaps occur.
    game.units = game.units.filter(u => u.owner !== 'player_a');
    const pairs = [
      { from: { q: -4, r: -3 }, to: { q: -3, r: -3 } },
      { from: { q: -4, r: -2 }, to: { q: -3, r: -2 } },
      { from: { q: -4, r: -1 }, to: { q: -3, r: -1 } },
      { from: { q: 1, r: -3 }, to: { q: 2, r: -3 } },
      { from: { q: 1, r: -2 }, to: { q: 2, r: -2 } },
      { from: { q: 1, r: -1 }, to: { q: 2, r: -1 } },
    ];
    const movers = pairs.map((pair, i) => ({
      id: `m${i}`, owner: 'player_a' as const, type: 'infantry' as const,
      q: pair.from.q, r: pair.from.r, hp: 100, maxHp: 100, attack: 30, defense: 8,
      moveRange: 3, attackRange: 1, cost: 45, alive: true,
      hasMoved: false, hasActed: false, actionSpent: false, canCapture: true,
    }));
    game.units.push(...movers);

    for (let i = 0; i < limit; i++) {
      const res = moveUnit(game, bus, 'player_a', `m${i}`, pairs[i].to.q, pairs[i].to.r);
      expect(res.ok).toBe(true);
    }
    expect(game.turn.actionsUsed).toBe(limit);

    // A 6th fresh unit is rejected with the action-limit code.
    const blocked = moveUnit(game, bus, 'player_a', 'm5', pairs[5].to.q, pairs[5].to.r);
    expect(blocked.ok).toBe(false);
    expect(blocked.code).toBe('action_limit_reached');

    // An already-activated unit (moved this turn) can still attack for free.
    const attacker = movers[0];
    const enemy = game.units.find(u => u.owner === 'player_b' && u.alive)!;
    enemy.q = pairs[0].to.q; enemy.r = pairs[0].to.r + 1;
    const followUp = attackTarget(game, bus, 'player_a', attacker.id, enemy.id);
    expect(followUp.ok).toBe(true);
    expect(game.turn.actionsUsed).toBe(limit); // no extra point spent
  });

  it('resets actionsUsed and unit actionSpent at turn end', () => {
    const { game, bus } = setup();
    // Clear and place one infantry on an open plain next to an empty cell.
    game.units = game.units.filter(u => u.owner !== 'player_a');
    const unit = {
      id: 'u1', owner: 'player_a' as const, type: 'infantry' as const,
      q: -7, r: 0, hp: 100, maxHp: 100, attack: 30, defense: 8,
      moveRange: 3, attackRange: 1, cost: 45, alive: true,
      hasMoved: false, hasActed: false, actionSpent: false, canCapture: true,
    };
    game.units.push(unit);

    expect(moveUnit(game, bus, 'player_a', 'u1', -8, 1).ok).toBe(true);
    expect(game.turn.actionsUsed).toBe(1);
    expect(unit.actionSpent).toBe(true);

    endTurn(game, bus, 'player_a');

    expect(game.turn.actionsUsed).toBe(0);
    expect(game.turn.currentOwner).toBe('player_b');
    // the ending player's units are reset for their next turn
    expect(unit.actionSpent).toBe(false);
  });
});
