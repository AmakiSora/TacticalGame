import { describe, it, expect } from 'vitest';
import { healTarget } from '../../src/engine/combat.js';
import { createInitialGame } from '../../src/state/store.js';
import { EventBus } from '../../src/events/bus.js';
import { randomUUID } from 'node:crypto';

function setupHeal() {
  const game = createInitialGame('g1');
  game.phase = 'waiting_command';
  game.turn.phase = 'waiting_command';
  const medic = {
    id: randomUUID(), owner: 'player_a' as const, type: 'medic' as const,
    x: 10, y: 10, hp: 70, maxHp: 70, attack: 5, defense: 5,
    moveRange: 3, attackRange: 1, alive: true, hasMoved: false, hasAttacked: false,
  };
  const wounded = {
    id: randomUUID(), owner: 'player_a' as const, type: 'infantry' as const,
    x: 11, y: 10, hp: 30, maxHp: 100, attack: 20, defense: 8,
    moveRange: 3, attackRange: 1, alive: true, hasMoved: false, hasAttacked: false,
  };
  game.units.push(medic, wounded);
  return { game, bus: new EventBus(), medic, wounded };
}

describe('healTarget', () => {
  it('heals adjacent friendly unit', () => {
    const { game, bus, medic, wounded } = setupHeal();
    const before = wounded.hp;
    const result = healTarget(game, bus, 'player_a', medic.id, wounded.id);
    expect(result.ok).toBe(true);
    expect(wounded.hp).toBeGreaterThan(before);
    expect(medic.hasAttacked).toBe(true);
  });

  it('does not exceed maxHp', () => {
    const { game, bus, medic, wounded } = setupHeal();
    wounded.hp = wounded.maxHp - 5;
    healTarget(game, bus, 'player_a', medic.id, wounded.id);
    expect(wounded.hp).toBe(wounded.maxHp);
  });

  it('emits heal event', () => {
    const { game, bus, medic, wounded } = setupHeal();
    healTarget(game, bus, 'player_a', medic.id, wounded.id);
    const ev = game.events.find(e => e.type === 'heal');
    expect(ev).toBeDefined();
    expect(typeof ev?.payload.amount).toBe('number');
  });

  it('fails when caster is not a medic', () => {
    const { game, bus, wounded } = setupHeal();
    const caster = {
      id: randomUUID(), owner: 'player_a' as const, type: 'infantry' as const,
      x: 9, y: 10, hp: 100, maxHp: 100, attack: 20, defense: 8,
      moveRange: 3, attackRange: 1, alive: true, hasMoved: false, hasAttacked: false,
    };
    game.units.push(caster);
    const result = healTarget(game, bus, 'player_a', caster.id, wounded.id);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('invalid_heal');
  });

  it('fails when target is not adjacent', () => {
    const { game, bus, medic, wounded } = setupHeal();
    wounded.x = 15; wounded.y = 15;
    const result = healTarget(game, bus, 'player_a', medic.id, wounded.id);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('invalid_heal');
  });

  it('fails when target is enemy', () => {
    const { game, bus, medic, wounded } = setupHeal();
    wounded.owner = 'player_b';
    const result = healTarget(game, bus, 'player_a', medic.id, wounded.id);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('invalid_heal');
  });

  it('fails when medic already acted this turn', () => {
    const { game, bus, medic, wounded } = setupHeal();
    medic.hasAttacked = true;
    const result = healTarget(game, bus, 'player_a', medic.id, wounded.id);
    expect(result.ok).toBe(false);
  });

  it('fails when target is a building', () => {
    const { game, bus, medic } = setupHeal();
    const hq = game.buildings.find(b => b.owner === 'player_a')!;
    medic.x = hq.x + 1; medic.y = hq.y;
    const result = healTarget(game, bus, 'player_a', medic.id, hq.id);
    expect(result.ok).toBe(false);
  });
});
