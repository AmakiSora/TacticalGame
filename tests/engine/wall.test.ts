import { describe, it, expect } from 'vitest';
import { startBuild, sellBuilding, tickBuildProgress } from '../../src/engine/building.js';
import { attackTarget } from '../../src/engine/combat.js';
import { moveUnit } from '../../src/engine/units.js';
import { createInitialGame } from '../../src/state/store.js';
import { EventBus } from '../../src/events/bus.js';
import { randomUUID } from 'node:crypto';

function setup() {
  const game = createInitialGame('g1');
  game.phase = 'waiting_command';
  game.turn.phase = 'waiting_command';
  return { game, bus: new EventBus() };
}

describe('wall building', () => {
  it('builds wall within wallBuildRange (4) at distance 4 from HQ', () => {
    const { game, bus } = setup();
    // Player A HQ is at (3, 10). Distance 4 = (7, 10)
    const before = game.resources.player_a.gold;
    const result = startBuild(game, bus, 'player_a', 'wall', 7, 10);
    expect(result.ok).toBe(true);
    expect(game.resources.player_a.gold).toBe(before - 20);
    const wall = game.buildings.find(b => b.x === 7 && b.y === 10 && b.type === 'wall');
    expect(wall).toBeDefined();
    expect(wall!.hp).toBe(50);
    expect(wall!.defense).toBe(5);
    expect(wall!.isBuilding).toBe(true);
    expect(wall!.buildProgress).toBe(1);
  });

  it('wall has defense but no attack stats', () => {
    const { game, bus } = setup();
    startBuild(game, bus, 'player_a', 'wall', 5, 10);
    const wall = game.buildings.find(b => b.type === 'wall')!;
    expect(wall.attack).toBeUndefined();
    expect(wall.attackRange).toBeUndefined();
    expect(wall.attacksLeft).toBeUndefined();
    expect(wall.defense).toBe(5);
  });

  it('fails when building wall beyond wallBuildRange (distance 5)', () => {
    const { game, bus } = setup();
    // Player A HQ at (3, 10). Distance 5 = (8, 10)
    const result = startBuild(game, bus, 'player_a', 'wall', 8, 10);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('out_of_build_range');
  });

  it('wall completes after 1 turn', () => {
    const { game, bus } = setup();
    startBuild(game, bus, 'player_a', 'wall', 5, 10);
    tickBuildProgress(game, bus, 'player_a');
    const wall = game.buildings.find(b => b.type === 'wall')!;
    expect(wall.isBuilding).toBe(false);
    expect(wall.buildProgress).toBe(0);
    expect(game.events.some(e => e.type === 'build_complete')).toBe(true);
  });

  it('fails when building wall on occupied cell', () => {
    const { game, bus } = setup();
    const result = startBuild(game, bus, 'player_a', 'wall', 3, 10);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('cell_occupied');
  });

  it('fails when building wall with insufficient gold', () => {
    const { game, bus } = setup();
    game.resources.player_a.gold = 10;
    const result = startBuild(game, bus, 'player_a', 'wall', 5, 10);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('insufficient_gold');
  });

  it('wall uses wallBuildRange=4 not buildRange=2', () => {
    const { game, bus } = setup();
    // distance 3 from HQ — fails for normal buildings, succeeds for wall
    const normalResult = startBuild(game, bus, 'player_a', 'barracks', 6, 10);
    expect(normalResult.ok).toBe(false);
    expect(normalResult.code).toBe('out_of_build_range');
    const wallResult = startBuild(game, bus, 'player_a', 'wall', 6, 10);
    expect(wallResult.ok).toBe(true);
  });
});

describe('wall combat', () => {
  it('can attack wall and reduce hp', () => {
    const { game, bus } = setup();
    startBuild(game, bus, 'player_b', 'wall', 15, 10);
    tickBuildProgress(game, bus, 'player_b');
    const wall = game.buildings.find(b => b.type === 'wall')!;
    const attacker = {
      id: randomUUID(), owner: 'player_a' as const, type: 'infantry' as const,
      x: 14, y: 10, hp: 100, maxHp: 100, attack: 20, defense: 8,
      moveRange: 3, attackRange: 1, alive: true, hasMoved: false, hasAttacked: false,
    };
    game.units.push(attacker);
    const result = attackTarget(game, bus, 'player_a', attacker.id, wall.id);
    expect(result.ok).toBe(true);
    expect(wall.hp).toBeLessThan(50);
  });

  it('wall defense reduces incoming damage', () => {
    const { game, bus } = setup();
    startBuild(game, bus, 'player_b', 'wall', 15, 10);
    tickBuildProgress(game, bus, 'player_b');
    const wall = game.buildings.find(b => b.type === 'wall')!;
    const attacker = {
      id: randomUUID(), owner: 'player_a' as const, type: 'infantry' as const,
      x: 14, y: 10, hp: 100, maxHp: 100, attack: 20, defense: 8,
      moveRange: 3, attackRange: 1, alive: true, hasMoved: false, hasAttacked: false,
    };
    game.units.push(attacker);
    attackTarget(game, bus, 'player_a', attacker.id, wall.id);
    // damage = max(1, 20 - 5 + variance(-3..3)) = max(1, 12..18)
    // wall hp went from 50 to somewhere between 32 and 38
    expect(wall.hp).toBeGreaterThanOrEqual(32);
    expect(wall.hp).toBeLessThanOrEqual(38);
  });

  it('wall destroyed emits base_destroyed event', () => {
    const { game, bus } = setup();
    startBuild(game, bus, 'player_b', 'wall', 15, 10);
    tickBuildProgress(game, bus, 'player_b');
    const wall = game.buildings.find(b => b.type === 'wall')!;
    wall.hp = 5;
    const attacker = {
      id: randomUUID(), owner: 'player_a' as const, type: 'infantry' as const,
      x: 14, y: 10, hp: 100, maxHp: 100, attack: 20, defense: 8,
      moveRange: 3, attackRange: 1, alive: true, hasMoved: false, hasAttacked: false,
    };
    game.units.push(attacker);
    attackTarget(game, bus, 'player_a', attacker.id, wall.id);
    expect(wall.alive).toBe(false);
    expect(game.events.some(e => e.type === 'base_destroyed')).toBe(true);
  });

  it('wall destruction does not end game', () => {
    const { game, bus } = setup();
    startBuild(game, bus, 'player_b', 'wall', 15, 10);
    tickBuildProgress(game, bus, 'player_b');
    const wall = game.buildings.find(b => b.type === 'wall')!;
    wall.hp = 5;
    const attacker = {
      id: randomUUID(), owner: 'player_a' as const, type: 'infantry' as const,
      x: 14, y: 10, hp: 100, maxHp: 100, attack: 20, defense: 8,
      moveRange: 3, attackRange: 1, alive: true, hasMoved: false, hasAttacked: false,
    };
    game.units.push(attacker);
    attackTarget(game, bus, 'player_a', attacker.id, wall.id);
    expect(game.phase).not.toBe('game_over');
  });
});

describe('wall selling', () => {
  it('sells completed wall for 80% refund (16 gold)', () => {
    const { game, bus } = setup();
    startBuild(game, bus, 'player_a', 'wall', 5, 10);
    tickBuildProgress(game, bus, 'player_a');
    const wall = game.buildings.find(b => b.type === 'wall')!;
    const before = game.resources.player_a.gold;
    const result = sellBuilding(game, bus, 'player_a', wall.id);
    expect(result.ok).toBe(true);
    expect(game.resources.player_a.gold).toBe(before + 16);
    expect(wall.alive).toBe(false);
  });

  it('cannot sell wall under construction', () => {
    const { game, bus } = setup();
    startBuild(game, bus, 'player_a', 'wall', 5, 10);
    const wall = game.buildings.find(b => b.type === 'wall')!;
    const result = sellBuilding(game, bus, 'player_a', wall.id);
    expect(result.ok).toBe(false);
  });
});

describe('wall blocks movement', () => {
  it('unit cannot move onto wall cell', () => {
    const { game, bus } = setup();
    startBuild(game, bus, 'player_a', 'wall', 5, 10);
    tickBuildProgress(game, bus, 'player_a');
    const unit = {
      id: randomUUID(), owner: 'player_a' as const, type: 'infantry' as const,
      x: 4, y: 10, hp: 100, maxHp: 100, attack: 20, defense: 8,
      moveRange: 3, attackRange: 1, alive: true, hasMoved: false, hasAttacked: false,
    };
    game.units.push(unit);
    const result = moveUnit(game, bus, 'player_a', unit.id, 5, 10);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('cell_occupied');
  });
});
