// tests/engine/engine.test.ts
import { describe, it, expect } from 'vitest';
import { joinGame, endTurn } from '../../src/engine/engine.js';
import { createInitialGame } from '../../src/state/store.js';
import { EventBus } from '../../src/events/bus.js';

function setup() {
  return { game: createInitialGame('g1'), bus: new EventBus() };
}

describe('joinGame', () => {
  it('sets player_b token and moves phase to waiting_command', () => {
    const { game, bus } = setup();
    const result = joinGame(game, bus);
    expect(result.ok).toBe(true);
    expect(game.tokens.player_b).toMatch(/^[a-f0-9]{32}$/);
    expect(game.phase).toBe('waiting_command');
    expect(game.turn.phase).toBe('waiting_command');
  });

  it('emits game_start event', () => {
    const { game, bus } = setup();
    joinGame(game, bus);
    expect(game.events.some(e => e.type === 'game_start')).toBe(true);
  });

  it('fails when game already has 2 players', () => {
    const { game, bus } = setup();
    joinGame(game, bus);
    const result = joinGame(game, bus);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('game_already_full');
  });
});

describe('endTurn', () => {
  it('switches currentOwner and increments turn number when wrapping', () => {
    const { game, bus } = setup();
    joinGame(game, bus);
    expect(game.turn.currentOwner).toBe('player_a');
    expect(game.turn.turnNumber).toBe(1);
    endTurn(game, bus, 'player_a');
    expect(game.turn.currentOwner).toBe('player_b');
    expect(game.turn.turnNumber).toBe(1);
    endTurn(game, bus, 'player_b');
    expect(game.turn.currentOwner).toBe('player_a');
    expect(game.turn.turnNumber).toBe(2);
  });

  it('fails when called by non-current player', () => {
    const { game, bus } = setup();
    joinGame(game, bus);
    const result = endTurn(game, bus, 'player_b');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('not_your_turn');
  });

  it('resets all unit action flags', () => {
    const { game, bus } = setup();
    joinGame(game, bus);
    game.units.push({
      id: 'u1', owner: 'player_a', type: 'infantry',
      x: 4, y: 10, hp: 100, maxHp: 100, attack: 20, defense: 8,
      moveRange: 3, attackRange: 1, alive: true, hasMoved: true, hasAttacked: true,
    });
    endTurn(game, bus, 'player_a');
    const u = game.units[0];
    expect(u.hasMoved).toBe(false);
    expect(u.hasAttacked).toBe(false);
  });

  it('ticks build progress on end of current player turn', () => {
    const { game, bus } = setup();
    joinGame(game, bus);
    game.buildings.push({
      id: 'b1', owner: 'player_a', type: 'barracks',
      x: 4, y: 10, hp: 100, maxHp: 100, alive: true,
      buildProgress: 1, isBuilding: true, production: null,
    });
    endTurn(game, bus, 'player_a');
    const b = game.buildings.find(x => x.id === 'b1')!;
    expect(b.isBuilding).toBe(false);
    expect(b.buildProgress).toBe(0);
  });

  it('ticks production on end of current player turn', () => {
    const { game, bus } = setup();
    joinGame(game, bus);
    const hq = game.buildings.find(b => b.owner === 'player_a')!;
    hq.production = { type: 'infantry', turnsRemaining: 1 };
    endTurn(game, bus, 'player_a');
    expect(game.units.some(u => u.owner === 'player_a' && u.type === 'infantry')).toBe(true);
  });

  it('emits turn_end event with new owner', () => {
    const { game, bus } = setup();
    joinGame(game, bus);
    endTurn(game, bus, 'player_a');
    const ev = game.events.find(e => e.type === 'turn_end');
    expect(ev).toBeDefined();
    expect(ev?.payload.nextOwner).toBe('player_b');
  });

  it('collects mining income for next player at start of their turn', () => {
    const { game, bus } = setup();
    joinGame(game, bus);
    game.buildings.push({
      id: 'm1', owner: 'player_b', type: 'miner',
      x: 6, y: 7, hp: 60, maxHp: 60, alive: true,
      buildProgress: 0, isBuilding: false, production: null,
    });
    const before = game.resources.player_b.gold;
    endTurn(game, bus, 'player_a');
    expect(game.resources.player_b.gold).toBe(before + 5 + 15);
  });

  it('fails when game is over', () => {
    const { game, bus } = setup();
    joinGame(game, bus);
    game.phase = 'game_over';
    const result = endTurn(game, bus, 'player_a');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('game_over');
  });
});
