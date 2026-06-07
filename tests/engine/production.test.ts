import { describe, it, expect } from 'vitest';
import { startProduction, tickProduction } from '../../src/engine/production.js';
import { createInitialGame } from '../../src/state/store.js';
import { EventBus } from '../../src/events/bus.js';

function setup() {
  const game = createInitialGame('g1');
  game.phase = 'waiting_command';
  game.turn.phase = 'waiting_command';
  // Add a barracks for testing
  const barracks = {
    id: 'b1', owner: 'player_a', type: 'barracks' as const,
    x: 4, y: 7, hp: 100, maxHp: 100, alive: true,
    buildProgress: 0, isBuilding: false, production: null,
  };
  game.buildings.push(barracks);
  return { game, bus: new EventBus() };
}

describe('startProduction', () => {
  it('queues infantry at barracks and deducts gold', () => {
    const { game, bus } = setup();
    const barracks = game.buildings.find(b => b.type === 'barracks')!;
    const result = startProduction(game, bus, 'player_a', barracks.id, 'infantry');
    expect(result.ok).toBe(true);
    expect(game.resources.player_a.gold).toBe(60);
    expect(barracks.production).toEqual({ type: 'infantry', turnsRemaining: 1 });
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
    const barracks = game.buildings.find(b => b.type === 'barracks')!;
    barracks.isBuilding = true;
    barracks.buildProgress = 2;
    const result = startProduction(game, bus, 'player_a', barracks.id, 'infantry');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('building_not_ready');
  });

  it('fails when headquarters tries to produce any unit', () => {
    const { game, bus } = setup();
    const hq = game.buildings.find(b => b.type === 'headquarters')!;
    const result = startProduction(game, bus, 'player_a', hq.id, 'infantry');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('cannot_produce');
  });

  it('fails when production slot is busy', () => {
    const { game, bus } = setup();
    const barracks = game.buildings.find(b => b.type === 'barracks')!;
    startProduction(game, bus, 'player_a', barracks.id, 'infantry');
    const result = startProduction(game, bus, 'player_a', barracks.id, 'infantry');
    expect(result.ok).toBe(false);
  });

  it('fails when insufficient gold', () => {
    const { game, bus } = setup();
    const barracks = game.buildings.find(b => b.type === 'barracks')!;
    game.resources.player_a.gold = 10;
    const result = startProduction(game, bus, 'player_a', barracks.id, 'infantry');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('insufficient_gold');
  });

  it('emits produce event on success', () => {
    const { game, bus } = setup();
    const barracks = game.buildings.find(b => b.type === 'barracks')!;
    startProduction(game, bus, 'player_a', barracks.id, 'infantry');
    expect(game.events.some(e => e.type === 'produce')).toBe(true);
  });
});

describe('tickProduction', () => {
  it('decrements production progress', () => {
    const { game, bus } = setup();
    const barracks = game.buildings.find(b => b.type === 'barracks')!;
    startProduction(game, bus, 'player_a', barracks.id, 'infantry');
    const before = game.events.length;
    tickProduction(game, bus, 'player_a');
    expect(barracks.production).toBeNull();
    expect(game.events.length).toBe(before + 1); // produce_complete event emitted
  });

  it('completes production and creates unit', () => {
    const { game, bus } = setup();
    const barracks = game.buildings.find(b => b.type === 'barracks')!;
    startProduction(game, bus, 'player_a', barracks.id, 'infantry');
    tickProduction(game, bus, 'player_a');
    expect(barracks.production).toBeNull();
    expect(game.units.some(u => u.owner === 'player_a' && u.type === 'infantry')).toBe(true);
    expect(game.events.some(e => e.type === 'produce_complete')).toBe(true);
  });
});
