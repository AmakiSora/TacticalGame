import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/events/bus.js';
import { attackTarget } from '../../src/engine/combat.js';
import { endTurn, eliminatePlayer, startGame } from '../../src/engine/engine.js';
import { addLobbyPlayer, createLobby } from '../../src/state/store.js';
import type { GameState, PlayerId } from '../../src/types.js';

function createThreePlayerGame(): { game: GameState; bus: EventBus } {
  const bus = new EventBus();
  const game = createLobby('mp-3', 'multiplayer-ring', {
    maxPlayers: 3,
    participate: true,
    playerName: 'A',
  });
  expect(addLobbyPlayer(game, 'B')).not.toBeNull();
  expect(addLobbyPlayer(game, 'C')).not.toBeNull();
  // Deterministic spawn / turn order for assertions.
  const result = startGame(game, bus, () => 0);
  expect(result.ok).toBe(true);
  return { game, bus };
}

describe('multiplayer free-for-all engine', () => {
  it('starts a 3-player lobby on multiplayer-ring with three active seats', () => {
    const { game } = createThreePlayerGame();
    expect(game.phase).toBe('active');
    expect(game.turn.turnOrder).toHaveLength(3);
    expect(Object.keys(game.players)).toHaveLength(3);
    expect(Object.keys(game.headquarters)).toHaveLength(3);
    expect(game.events.some(e => e.type === 'game_start')).toBe(true);
    const start = game.events.find(e => e.type === 'game_start')!;
    expect(start.payload.players).toBeTruthy();
    expect(start.payload.turnOrder).toEqual(game.turn.turnOrder);
    expect(start.payload.firstPlayer).toBe(game.turn.currentPlayerId);
  });

  it('eliminates one of three players without ending the match and neutralizes their CPs', () => {
    const { game, bus } = createThreePlayerGame();
    const victim = game.turn.turnOrder.find(id => id !== game.turn.currentPlayerId)! as PlayerId;
    const attacker = game.turn.currentPlayerId!;

    // Give victim a control point so neutralization is observable.
    const point = game.controlPoints[0];
    point.owner = victim;

    const result = eliminatePlayer(game, bus, victim, 'host_eliminated', attacker);
    expect(result.ok).toBe(true);
    expect(game.phase).toBe('active');
    expect(game.players[victim]?.status).toBe('eliminated');
    expect(game.units.every(u => u.owner !== victim)).toBe(true);
    expect(point.owner).toBeNull();
    expect(game.events.some(e => e.type === 'player_eliminated')).toBe(true);
    expect(game.events.some(e => e.type === 'control_point_neutralized')).toBe(true);
    expect(game.winner).toBeNull();
  });

  it('ends the match only when the second-to-last player is eliminated', () => {
    const { game, bus } = createThreePlayerGame();
    const [first, second, third] = game.turn.turnOrder as PlayerId[];

    expect(eliminatePlayer(game, bus, second, 'host_eliminated', first).ok).toBe(true);
    expect(game.phase).toBe('active');

    expect(eliminatePlayer(game, bus, third, 'host_eliminated', first).ok).toBe(true);
    expect(game.phase).toBe('game_over');
    expect(game.winner).toBe(first);
    expect(game.result?.reason).toBe('last_player_standing');
  });

  it('advances past an eliminated current player and continues the ring among survivors', () => {
    const { game, bus } = createThreePlayerGame();
    const current = game.turn.currentPlayerId!;
    const order = [...game.turn.turnOrder] as PlayerId[];
    const currentIndex = order.indexOf(current);
    const expectedNext = order[(currentIndex + 1) % order.length];

    expect(eliminatePlayer(game, bus, current, 'host_eliminated', expectedNext).ok).toBe(true);
    expect(game.phase).toBe('active');
    expect(game.turn.currentPlayerId).toBe(expectedNext);
    expect(game.turn.actedThisRound).toContain(current);
  });

  it('records headquartersDamage on the attacker stats when damaging an HQ', () => {
    const { game, bus } = createThreePlayerGame();
    const attacker = game.turn.currentPlayerId!;
    const victim = game.turn.turnOrder.find(id => id !== attacker)! as PlayerId;
    const hq = game.headquarters[victim]!;
    const unit = game.units.find(u => u.owner === attacker && u.alive)!;
    unit.attack = 40;
    unit.attackRange = 20;
    unit.q = hq.q;
    unit.r = hq.r;
    // Place attacker adjacent-ish by using huge range; target HQ directly.
    const before = hq.hp;
    const result = attackTarget(game, bus, attacker, unit.id, hq.id);
    expect(result.ok).toBe(true);
    expect(hq.hp).toBeLessThan(before);
    expect(game.players[attacker]!.stats.headquartersDamage).toBeGreaterThan(0);
    expect(game.players[attacker]!.stats.headquartersDamage).toBe(before - hq.hp);
  });

  it('rotates three active players through a full round before incrementing roundNumber', () => {
    const { game, bus } = createThreePlayerGame();
    const startRound = game.turn.roundNumber;
    const first = game.turn.currentPlayerId!;

    for (let i = 0; i < 3; i++) {
      const owner = game.turn.currentPlayerId!;
      expect(endTurn(game, bus, owner).ok).toBe(true);
    }

    expect(game.phase).toBe('active');
    expect(game.turn.roundNumber).toBe(startRound + 1);
    expect(game.turn.currentPlayerId).toBe(first);
    expect(game.events.some(e => e.type === 'round_end')).toBe(true);
  });
});
