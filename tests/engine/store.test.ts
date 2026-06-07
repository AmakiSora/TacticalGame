// tests/engine/store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { GameStore, createInitialGame } from '../../src/state/store.js';

describe('GameStore', () => {
  let store: GameStore;

  beforeEach(() => { store = new GameStore(); });

  it('createInitialGame creates game with HQ for both players', () => {
    const game = createInitialGame('g1');
    expect(game.buildings).toHaveLength(2);
    expect(game.buildings.find(b => b.owner === 'player_a')?.type).toBe('headquarters');
    expect(game.buildings.find(b => b.owner === 'player_b')?.type).toBe('headquarters');
  });

  it('initial game has 100 gold per player', () => {
    const game = createInitialGame('g1');
    expect(game.resources.player_a.gold).toBe(100);
    expect(game.resources.player_b.gold).toBe(100);
  });

  it('initial game has 4 mining points', () => {
    const game = createInitialGame('g1');
    expect(game.miningPoints).toHaveLength(4);
  });

  it('initial game has no units and waiting_for_player phase', () => {
    const game = createInitialGame('g1');
    expect(game.units).toEqual([]);
    expect(game.phase).toBe('waiting_for_player');
    expect(game.turn.currentOwner).toBe('player_a');
    expect(game.turn.turnNumber).toBe(1);
  });

  it('initial game generates unique token for player_a only', () => {
    const game = createInitialGame('g1');
    expect(game.tokens.player_a).toMatch(/^[a-f0-9]{32}$/);
    expect(game.tokens.player_b).toBe('');
  });

  it('store can save and retrieve games', () => {
    const game = createInitialGame('g1');
    store.save(game);
    expect(store.get('g1')?.id).toBe('g1');
  });

  it('store returns undefined for missing games', () => {
    expect(store.get('nope')).toBeUndefined();
  });

  it('store can list all game ids', () => {
    store.save(createInitialGame('g1'));
    store.save(createInitialGame('g2'));
    expect(store.list().sort()).toEqual(['g1', 'g2']);
  });
});
