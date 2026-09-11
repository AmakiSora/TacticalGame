// tests/engine/events.test.ts
import { describe, it, expect, vi } from 'vitest';
import { appendEvent } from '../../src/engine/events.js';
import { createInitialGame, createLobby, addLobbyPlayer } from '../../src/state/store.js';
import { startGame } from '../../src/engine/engine.js';
import { EventBus } from '../../src/events/bus.js';

describe('appendEvent', () => {
  it('appends event with sequential seq starting at 1', () => {
    const game = createInitialGame('g1');
    const bus = new EventBus();
    const ev1 = appendEvent(game, bus, 'move', { foo: 1 });
    const ev2 = appendEvent(game, bus, 'attack', { bar: 2 });
    expect(ev1.seq).toBe(1);
    expect(ev2.seq).toBe(2);
    expect(game.events).toHaveLength(2);
  });

  it('stores payload and timestamp on the event', () => {
    const game = createInitialGame('g1');
    const bus = new EventBus();
    const ev = appendEvent(game, bus, 'move', { gold: 15 });
    expect(ev.payload).toMatchObject({ gold: 15 });
    expect(typeof ev.timestamp).toBe('number');
  });

  it('emits event through bus to subscribers', () => {
    const game = createInitialGame('g1');
    const bus = new EventBus();
    const handler = vi.fn();
    bus.subscribe('g1', handler);
    appendEvent(game, bus, 'turn_end', {});
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].type).toBe('turn_end');
  });
});

describe('appendEvent roundNumber auto-injection', () => {
  it('injects roundNumber for active-game events that omit it', () => {
    const game = createInitialGame('g1');
    const bus = new EventBus();
    game.turn.roundNumber = 3;
    const ev = appendEvent(game, bus, 'attack', { attackerId: 'u1', damage: 10 });
    expect(ev.payload.roundNumber).toBe(3);
  });

  it('does not override an explicit roundNumber', () => {
    const game = createInitialGame('g1');
    const bus = new EventBus();
    game.turn.roundNumber = 5;
    const ev = appendEvent(game, bus, 'round_end', { roundNumber: 4, gameOver: false });
    expect(ev.payload.roundNumber).toBe(4);
  });

  it('skips injection for lobby-phase events', () => {
    const game = createLobby('g-lobby', 'default', { maxPlayers: 2, participate: true });
    const bus = new EventBus();
    const ev = appendEvent(game, bus, 'player_joined', { playerId: 'player_a' });
    expect(ev.payload.roundNumber).toBeUndefined();
  });

  it('injects roundNumber=1 for game_start (phase already active)', () => {
    const game = createLobby('g-start', 'default', { maxPlayers: 2, participate: true });
    addLobbyPlayer(game);
    const bus = new EventBus();
    startGame(game, bus, () => 0);
    const start = game.events.find(e => e.type === 'game_start');
    expect(start?.payload.roundNumber).toBe(1);
  });

  it('tracks roundNumber increments across round boundaries', () => {
    const game = createInitialGame('g1');
    const bus = new EventBus();
    game.turn.roundNumber = 1;
    const ev1 = appendEvent(game, bus, 'move', { unitId: 'u1' });
    game.turn.roundNumber = 2;
    const ev2 = appendEvent(game, bus, 'move', { unitId: 'u2' });
    expect(ev1.payload.roundNumber).toBe(1);
    expect(ev2.payload.roundNumber).toBe(2);
  });
});
