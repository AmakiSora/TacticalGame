// tests/engine/mining.test.ts
import { describe, it, expect } from 'vitest';
import { collectMiningIncome } from '../../src/engine/mining.js';
import { createInitialGame } from '../../src/state/store.js';
import { EventBus } from '../../src/events/bus.js';
import { randomUUID } from 'node:crypto';

function setup() {
  const game = createInitialGame('g1');
  game.phase = 'waiting_command';
  return { game, bus: new EventBus() };
}

function addMiner(game: ReturnType<typeof setup>['game'], owner: 'player_a' | 'player_b', x: number, y: number, isBuilding = false) {
  game.buildings.push({
    id: randomUUID(), owner, type: 'miner',
    x, y, hp: 60, maxHp: 60, alive: true,
    buildProgress: isBuilding ? 1 : 0,
    isBuilding,
    production: null,
  });
}

describe('collectMiningIncome', () => {
  it('grants 15 gold per completed miner', () => {
    const { game, bus } = setup();
    addMiner(game, 'player_a', 10, 5);
    addMiner(game, 'player_a', 10, 15);
    const before = game.resources.player_a.gold;
    collectMiningIncome(game, bus, 'player_a');
    expect(game.resources.player_a.gold).toBe(before + 30);
  });

  it('does not grant gold for in-construction miners', () => {
    const { game, bus } = setup();
    addMiner(game, 'player_a', 10, 5, true);
    const before = game.resources.player_a.gold;
    collectMiningIncome(game, bus, 'player_a');
    expect(game.resources.player_a.gold).toBe(before);
  });

  it('does not grant gold to other player miners', () => {
    const { game, bus } = setup();
    addMiner(game, 'player_b', 19, 5);
    const before = game.resources.player_a.gold;
    collectMiningIncome(game, bus, 'player_a');
    expect(game.resources.player_a.gold).toBe(before);
  });

  it('emits mine event per miner', () => {
    const { game, bus } = setup();
    addMiner(game, 'player_a', 10, 5);
    addMiner(game, 'player_a', 10, 15);
    collectMiningIncome(game, bus, 'player_a');
    const mineEvents = game.events.filter(e => e.type === 'mine');
    expect(mineEvents).toHaveLength(2);
    expect(mineEvents[0].payload.amount).toBe(15);
  });

  it('does not count destroyed miners', () => {
    const { game, bus } = setup();
    addMiner(game, 'player_a', 10, 5);
    game.buildings.at(-1)!.alive = false;
    const before = game.resources.player_a.gold;
    collectMiningIncome(game, bus, 'player_a');
    expect(game.resources.player_a.gold).toBe(before);
  });
});
