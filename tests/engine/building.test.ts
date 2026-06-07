// tests/engine/building.test.ts
import { describe, it, expect } from 'vitest';
import { startBuild, tickBuildProgress } from '../../src/engine/building.js';
import { createInitialGame } from '../../src/state/store.js';
import { EventBus } from '../../src/events/bus.js';

function setup() {
  const game = createInitialGame('g1');
  game.phase = 'waiting_command';
  game.turn.phase = 'waiting_command';
  return { game, bus: new EventBus() };
}

describe('startBuild', () => {
  it('barracks adjacent to HQ succeeds and deducts gold', () => {
    const { game, bus } = setup();
    const before = game.resources.player_a.gold;
    const result = startBuild(game, bus, 'player_a', 'barracks', 4, 10);
    expect(result.ok).toBe(true);
    expect(game.resources.player_a.gold).toBe(before - 50);
    expect(game.buildings.some(b => b.x === 4 && b.y === 10 && b.isBuilding)).toBe(true);
  });

  it('fails when player has insufficient gold', () => {
    const { game, bus } = setup();
    game.resources.player_a.gold = 10;
    const result = startBuild(game, bus, 'player_a', 'barracks', 4, 10);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('insufficient_gold');
  });

  it('fails when out of build range', () => {
    const { game, bus } = setup();
    const result = startBuild(game, bus, 'player_a', 'barracks', 10, 10);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('out_of_build_range');
  });

  it('fails when cell is occupied', () => {
    const { game, bus } = setup();
    const result = startBuild(game, bus, 'player_a', 'barracks', 3, 10);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('cell_occupied');
  });

  it('miner fails when not on a mining point', () => {
    const { game, bus } = setup();
    const result = startBuild(game, bus, 'player_a', 'miner', 4, 10);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('not_mining_point');
  });

  it('miner succeeds when on a mining point in range', () => {
    const { game, bus } = setup();
    const hq = game.buildings.find(b => b.owner === 'player_a')!;
    hq.x = 5; hq.y = 7;
    const result = startBuild(game, bus, 'player_a', 'miner', 6, 7);
    expect(result.ok).toBe(true);
  });

  it('headquarters cannot be built', () => {
    const { game, bus } = setup();
    const result = startBuild(game, bus, 'player_a', 'headquarters', 4, 10);
    expect(result.ok).toBe(false);
  });

  it('emits build event on success', () => {
    const { game, bus } = setup();
    startBuild(game, bus, 'player_a', 'barracks', 4, 10);
    expect(game.events.some(e => e.type === 'build')).toBe(true);
  });
});

describe('tickBuildProgress', () => {
  it('decrements buildProgress for in-construction buildings of player', () => {
    const { game, bus } = setup();
    startBuild(game, bus, 'player_a', 'barracks', 4, 10);
    const before = game.events.length;
    tickBuildProgress(game, bus, 'player_a');
    const b = game.buildings.find(x => x.x === 4 && x.y === 10)!;
    expect(b.buildProgress).toBe(1);
    expect(b.isBuilding).toBe(true);
    expect(game.events.length).toBe(before);
  });

  it('emits build_complete when buildProgress reaches 0', () => {
    const { game, bus } = setup();
    startBuild(game, bus, 'player_a', 'barracks', 4, 10);
    tickBuildProgress(game, bus, 'player_a');
    tickBuildProgress(game, bus, 'player_a');
    const b = game.buildings.find(x => x.x === 4 && x.y === 10)!;
    expect(b.isBuilding).toBe(false);
    expect(b.buildProgress).toBe(0);
    expect(game.events.some(e => e.type === 'build_complete')).toBe(true);
  });

  it('does not affect other player buildings', () => {
    const { game, bus } = setup();
    startBuild(game, bus, 'player_a', 'barracks', 4, 10);
    tickBuildProgress(game, bus, 'player_b');
    const b = game.buildings.find(x => x.x === 4 && x.y === 10)!;
    expect(b.buildProgress).toBe(2);
  });
});
