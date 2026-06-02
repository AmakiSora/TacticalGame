// tests/engine/units.test.ts
import { describe, it, expect } from 'vitest';
import { moveUnit } from '../../src/engine/units.js';
import { createInitialGame } from '../../src/state/store.js';
import { EventBus } from '../../src/events/bus.js';
import { randomUUID } from 'node:crypto';

function setupWithUnit() {
  const game = createInitialGame('g1');
  game.phase = 'waiting_command';
  game.turn.phase = 'waiting_command';
  const unit = {
    id: randomUUID(), owner: 'player_a' as const, type: 'infantry' as const,
    x: 5, y: 15, hp: 100, maxHp: 100, attack: 20, defense: 8,
    moveRange: 3, attackRange: 1, alive: true, hasMoved: false, hasAttacked: false,
  };
  game.units.push(unit);
  return { game, bus: new EventBus(), unit };
}

describe('moveUnit', () => {
  it('moves unit within range', () => {
    const { game, bus, unit } = setupWithUnit();
    const result = moveUnit(game, bus, 'player_a', unit.id, 7, 15);
    expect(result.ok).toBe(true);
    expect(unit.x).toBe(7);
    expect(unit.y).toBe(15);
    expect(unit.hasMoved).toBe(true);
  });

  it('emits move event', () => {
    const { game, bus, unit } = setupWithUnit();
    moveUnit(game, bus, 'player_a', unit.id, 7, 15);
    const ev = game.events.find(e => e.type === 'move');
    expect(ev).toBeDefined();
    expect(ev?.payload).toMatchObject({ unitId: unit.id, fromX: 5, fromY: 15, toX: 7, toY: 15 });
  });

  it('fails when unit not owned by player', () => {
    const { game, bus, unit } = setupWithUnit();
    const result = moveUnit(game, bus, 'player_b', unit.id, 7, 15);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('unit_not_found');
  });

  it('fails when out of move range', () => {
    const { game, bus, unit } = setupWithUnit();
    const result = moveUnit(game, bus, 'player_a', unit.id, 10, 15);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('invalid_move');
  });

  it('fails when target cell is occupied', () => {
    const { game, bus, unit } = setupWithUnit();
    const result = moveUnit(game, bus, 'player_a', unit.id, 4, 15);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('cell_occupied');
  });

  it('fails when already moved this turn', () => {
    const { game, bus, unit } = setupWithUnit();
    unit.hasMoved = true;
    const result = moveUnit(game, bus, 'player_a', unit.id, 7, 15);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('invalid_move');
  });

  it('fails when out of bounds', () => {
    const { game, bus, unit } = setupWithUnit();
    unit.x = 0;
    const result = moveUnit(game, bus, 'player_a', unit.id, -1, 0);
    expect(result.ok).toBe(false);
  });

  it('fails when target is same cell', () => {
    const { game, bus, unit } = setupWithUnit();
    const result = moveUnit(game, bus, 'player_a', unit.id, 5, 15);
    expect(result.ok).toBe(false);
  });
});
