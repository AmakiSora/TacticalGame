import { describe, expect, it } from 'vitest';
import { createInitialGame } from '../../src/state/store.js';
import { EventBus } from '../../src/events/bus.js';
import { findReachableCells } from '../../src/engine/validation.js';
import { moveUnit } from '../../src/engine/units.js';
import { attackTarget, healTarget } from '../../src/engine/combat.js';
import { deployUnit } from '../../src/engine/deployment.js';
import { endTurn, joinGame } from '../../src/engine/engine.js';

function setup() {
  const game = createInitialGame('g1');
  const bus = new EventBus();
  joinGame(game, bus, 'B');
  return { game, bus };
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
    expect(game.resources.player_b.supplies).toBe(beforeB + 15);
    expect(game.events.some(e => e.type === 'control_point_captured')).toBe(true);
    expect(game.events.some(e => e.type === 'income')).toBe(true);
  });

  it('only infantry and scout can capture control points', () => {
    const { game, bus } = setup();
    const unit = game.units.find(u => u.owner === 'player_a' && u.type === 'infantry')!;
    unit.type = 'heavy';
    unit.q = -4; unit.r = 0;

    endTurn(game, bus, 'player_a');

    expect(game.controlPoints.find(p => p.q === -4 && p.r === 0)!.owner).toBeNull();
  });

  it('deploys from owned HQ or control point to an adjacent empty plain cell', () => {
    const { game, bus } = setup();
    const result = deployUnit(game, bus, 'player_a', 'scout', game.headquarters.player_a.id, -8, 1);

    expect(result.ok).toBe(true);
    expect(game.resources.player_a.supplies).toBe(45);
    const deployed = game.units.find(u => u.type === 'scout' && u.q === -8 && u.r === 1)!;
    expect(deployed.hasMoved).toBe(true);
    expect(deployed.hasActed).toBe(false);
    expect(game.events.at(-1)!.type).toBe('deploy');
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
    expect(game.events.some(e => e.type === 'headquarters_destroyed')).toBe(true);
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
});
