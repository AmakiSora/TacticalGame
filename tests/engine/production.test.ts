import { describe, it, expect } from 'vitest';
import { startProduction, tickProduction } from '../../src/engine/production.js';
import { createInitialGame } from '../../src/state/store.js';
import { EventBus } from '../../src/events/bus.js';

function setup() {
  const game = createInitialGame('g1');
  game.phase = 'waiting_command';
  game.turn.phase = 'waiting_command';
  return { game, bus: new EventBus() };
}

describe('startProduction', () => {
  it('queues infantry at HQ and deducts gold', () => {
    const { game, bus } = setup();
    const hq = game.buildings.find(b => b.owner === 'player_a')!;
    const result = startProduction(game, bus, 'player_a', hq.id, 'infantry');
    expect(result.ok).toBe(true);
    expect(game.resources.player_a.gold).toBe(60);
    expect(hq.production).toEqual({ type: 'infantry', turnsRemaining: 1 });
  });

  it('fails when building belongs to other player', () => {
    const { game, bus } = setup();
    const hqB = game.buildings.find(b => b.owner === 'player_b')!;
    const result = startProduction(game, bus, 'player_a', hqB.id, 'infantry');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('building_not_found');
  });

  it('fails when building is still under construction', () => {
    const { game, bus } = setup();
    const hq = game.buildings.find(b => b.owner === 'player_a')!;
    hq.isBuilding = true;
    hq.buildProgress = 2;
    const result = startProduction(game, bus, 'player_a', hq.id, 'infantry');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('building_not_ready');
  });

  it('fails when HQ tries to produce a tank', () => {
    const { game, bus } = setup();
    const hq = game.buildings.find(b => b.owner === 'player_a')!;
    const result = startProduction(game, bus, 'player_a', hq.id, 'tank');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('cannot_produce');
  });

  it('fails when production slot is busy', () => {
    const { game, bus } = setup();
    const hq = game.buildings.find(b => b.owner === 'player_a')!;
    startProduction(game, bus, 'player_a', hq.id, 'infantry');
    const result = startProduction(game, bus, 'player_a', hq.id, 'infantry');
    expect(result.ok).toBe(false);
  });

  it('fails when insufficient gold', () => {
    const { game, bus } = setup();
    const hq = game.buildings.find(b => b.owner === 'player_a')!;
    game.resources.player_a.gold = 10;
    const result = startProduction(game, bus, 'player_a', hq.id, 'infantry');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('insufficient_gold');
  });

  it('emits produce event on success', () => {
    const { game, bus } = setup();
    const hq = game.buildings.find(b => b.owner === 'player_a')!;
    startProduction(game, bus, 'player_a', hq.id, 'infantry');
    expect(game.events.some(e => e.type === 'produce')).toBe(true);
  });
});

describe('tickProduction', () => {
  it('decrements turnsRemaining', () => {
    const { game, bus } = setup();
    const hq = game.buildings.find(b => b.owner === 'player_a')!;
    hq.production = { type: 'tank', turnsRemaining: 3 };
    tickProduction(game, bus, 'player_a');
    expect(hq.production?.turnsRemaining).toBe(2);
  });

  it('spawns unit when complete', () => {
    const { game, bus } = setup();
    const hq = game.buildings.find(b => b.owner === 'player_a')!;
    hq.production = { type: 'infantry', turnsRemaining: 1 };
    tickProduction(game, bus, 'player_a');
    expect(hq.production).toBeNull();
    expect(game.units).toHaveLength(1);
    expect(game.units[0].type).toBe('infantry');
    expect(game.units[0].owner).toBe('player_a');
    expect(game.events.some(e => e.type === 'produce_complete')).toBe(true);
  });

  it('does not affect other player production', () => {
    const { game, bus } = setup();
    const hqB = game.buildings.find(b => b.owner === 'player_b')!;
    hqB.production = { type: 'infantry', turnsRemaining: 1 };
    tickProduction(game, bus, 'player_a');
    expect(hqB.production?.turnsRemaining).toBe(1);
  });

  it('skips production if no free adjacent cell', () => {
    const { game, bus } = setup();
    const hq = game.buildings.find(b => b.owner === 'player_a')!;
    hq.x = 0; hq.y = 0;
    game.units.push({
      id: 'block1', owner: 'player_a', type: 'infantry',
      x: 1, y: 0, hp: 100, maxHp: 100, attack: 20, defense: 8,
      moveRange: 3, attackRange: 1, alive: true, hasMoved: false, hasAttacked: false,
    });
    game.units.push({
      id: 'block2', owner: 'player_a', type: 'infantry',
      x: 0, y: 1, hp: 100, maxHp: 100, attack: 20, defense: 8,
      moveRange: 3, attackRange: 1, alive: true, hasMoved: false, hasAttacked: false,
    });
    hq.production = { type: 'infantry', turnsRemaining: 1 };
    tickProduction(game, bus, 'player_a');
    expect(hq.production).not.toBeNull();
    expect(hq.production?.turnsRemaining).toBe(0);
    expect(game.units.filter(u => u.type === 'infantry' && u.owner === 'player_a' && u.id !== 'block1' && u.id !== 'block2')).toHaveLength(0);
  });
});
