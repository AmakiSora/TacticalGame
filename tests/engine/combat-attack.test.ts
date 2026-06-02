import { describe, it, expect } from 'vitest';
import { attackTarget } from '../../src/engine/combat.js';
import { createInitialGame } from '../../src/state/store.js';
import { EventBus } from '../../src/events/bus.js';
import { randomUUID } from 'node:crypto';

function setupBattle() {
  const game = createInitialGame('g1');
  game.phase = 'waiting_command';
  game.turn.phase = 'waiting_command';
  const attacker = {
    id: randomUUID(), owner: 'player_a' as const, type: 'infantry' as const,
    x: 10, y: 10, hp: 100, maxHp: 100, attack: 20, defense: 8,
    moveRange: 3, attackRange: 1, alive: true, hasMoved: false, hasAttacked: false,
  };
  const defender = {
    id: randomUUID(), owner: 'player_b' as const, type: 'infantry' as const,
    x: 11, y: 10, hp: 100, maxHp: 100, attack: 20, defense: 8,
    moveRange: 3, attackRange: 1, alive: true, hasMoved: false, hasAttacked: false,
  };
  game.units.push(attacker, defender);
  return { game, bus: new EventBus(), attacker, defender };
}

describe('attackTarget', () => {
  it('attacks adjacent enemy and reduces hp', () => {
    const { game, bus, attacker, defender } = setupBattle();
    const result = attackTarget(game, bus, 'player_a', attacker.id, defender.id);
    expect(result.ok).toBe(true);
    expect(defender.hp).toBeLessThan(100);
    expect(attacker.hasAttacked).toBe(true);
  });

  it('emits attack event with damage in payload', () => {
    const { game, bus, attacker, defender } = setupBattle();
    attackTarget(game, bus, 'player_a', attacker.id, defender.id);
    const ev = game.events.find(e => e.type === 'attack');
    expect(ev).toBeDefined();
    expect(typeof ev?.payload.damage).toBe('number');
  });

  it('fails when attacker is out of range', () => {
    const { game, bus, attacker, defender } = setupBattle();
    defender.x = 15; defender.y = 15;
    const result = attackTarget(game, bus, 'player_a', attacker.id, defender.id);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('invalid_attack');
  });

  it('fails when already attacked this turn', () => {
    const { game, bus, attacker, defender } = setupBattle();
    attacker.hasAttacked = true;
    const result = attackTarget(game, bus, 'player_a', attacker.id, defender.id);
    expect(result.ok).toBe(false);
  });

  it('fails when target is friendly', () => {
    const { game, bus, attacker, defender } = setupBattle();
    defender.owner = 'player_a';
    const result = attackTarget(game, bus, 'player_a', attacker.id, defender.id);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('invalid_attack');
  });

  it('marks unit as dead and emits unit_death when hp drops to 0', () => {
    const { game, bus, attacker, defender } = setupBattle();
    defender.hp = 5;
    attackTarget(game, bus, 'player_a', attacker.id, defender.id);
    expect(defender.alive).toBe(false);
    expect(game.events.some(e => e.type === 'unit_death')).toBe(true);
  });

  it('can attack enemy building', () => {
    const { game, bus, attacker } = setupBattle();
    const hqB = game.buildings.find(b => b.owner === 'player_b')!;
    attacker.x = hqB.x - 1; attacker.y = hqB.y;
    attacker.attackRange = 1;
    const before = hqB.hp;
    attackTarget(game, bus, 'player_a', attacker.id, hqB.id);
    expect(hqB.hp).toBeLessThan(before);
  });

  it('destroys building when hp drops to 0', () => {
    const { game, bus, attacker } = setupBattle();
    const hqB = game.buildings.find(b => b.owner === 'player_b')!;
    attacker.x = hqB.x - 1; attacker.y = hqB.y;
    hqB.hp = 5;
    attackTarget(game, bus, 'player_a', attacker.id, hqB.id);
    expect(hqB.alive).toBe(false);
    expect(game.events.some(e => e.type === 'base_destroyed')).toBe(true);
    expect(game.events.some(e => e.type === 'game_over')).toBe(true);
    expect(game.phase).toBe('game_over');
    expect(game.winner).toBe('player_a');
  });

  it('non-HQ building destruction does not end game', () => {
    const { game, bus, attacker } = setupBattle();
    const barracks = {
      id: randomUUID(), owner: 'player_b' as const, type: 'barracks' as const,
      x: 11, y: 11, hp: 5, maxHp: 100, alive: true,
      buildProgress: 0, isBuilding: false, production: null,
    };
    game.buildings.push(barracks);
    attacker.x = 11; attacker.y = 10;
    attackTarget(game, bus, 'player_a', attacker.id, barracks.id);
    expect(barracks.alive).toBe(false);
    expect(game.phase).not.toBe('game_over');
  });

  it('minimum damage is 1', () => {
    const { game, bus, attacker, defender } = setupBattle();
    defender.defense = 1000;
    attackTarget(game, bus, 'player_a', attacker.id, defender.id);
    expect(defender.hp).toBeLessThanOrEqual(99);
  });
});
