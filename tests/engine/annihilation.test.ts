import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/events/bus.js';
import { attackTarget } from '../../src/engine/combat.js';
import { deployUnit } from '../../src/engine/deployment.js';
import { endTurn, startGame } from '../../src/engine/engine.js';
import { addLobbyPlayer, createLobby } from '../../src/state/store.js';

function createAnnihilationGame() {
  const bus = new EventBus();
  const game = createLobby('annihilation-test', 'annihilation', {
    maxPlayers: 2,
    participate: true,
    playerName: 'A',
  });
  expect(addLobbyPlayer(game, 'B')).not.toBeNull();
  expect(startGame(game, bus, () => 0).ok).toBe(true);
  return { game, bus };
}

function finishRound(game: ReturnType<typeof createAnnihilationGame>['game'], bus: EventBus) {
  for (let i = 0; i < 2 && game.phase === 'active'; i++) {
    expect(endTurn(game, bus, game.turn.currentPlayerId!).ok).toBe(true);
  }
}

describe('annihilation mode', () => {
  it('starts without headquarters and assigns one owned spawn point per player', () => {
    const { game } = createAnnihilationGame();

    expect(game.config.mode).toBe('annihilation');
    expect(Object.keys(game.headquarters)).toHaveLength(0);
    expect(game.units.filter(unit => unit.owner === 'player_a')).toHaveLength(3);
    expect(game.units.filter(unit => unit.owner === 'player_b')).toHaveLength(3);
    expect(game.controlPoints.filter(point => point.owner === 'player_a')).toHaveLength(1);
    expect(game.controlPoints.filter(point => point.owner === 'player_b')).toHaveLength(1);
    expect(game.artillery).toMatchObject({ safeRadius: 6, nextShrinkRound: 5 });
    const start = game.events.find(event => event.type === 'game_start')!;
    expect(start.payload.mode).toBe('annihilation');
    expect(start.payload.headquarters).toEqual({});
    expect(start.payload.artillery).toMatchObject({ safeRadius: 6, nextShrinkRound: 5 });
  });

  it('eliminates a player immediately when combat destroys their final unit', () => {
    const { game, bus } = createAnnihilationGame();
    const attackerOwner = game.turn.currentPlayerId!;
    const victimOwner = game.turn.turnOrder.find(owner => owner !== attackerOwner)!;
    const attacker = game.units.find(unit => unit.owner === attackerOwner)!;
    const victim = game.units.find(unit => unit.owner === victimOwner)!;
    game.units = [attacker, victim];
    attacker.attackRange = 20;
    attacker.attack = 200;
    victim.hp = 1;

    expect(attackTarget(game, bus, attackerOwner, attacker.id, victim.id).ok).toBe(true);
    expect(game.players[victimOwner]?.status).toBe('eliminated');
    expect(game.phase).toBe('game_over');
    expect(game.winner).toBe(attackerOwner);
    expect(game.result?.reason).toBe('last_player_standing');
    expect(game.events.find(event => event.type === 'player_eliminated')?.payload.reason).toBe('army_destroyed');
  });

  it('warns before shrinking, damages the full danger ring, and blocks deployment there', () => {
    const { game, bus } = createAnnihilationGame();
    const exposed = game.units.find(unit => unit.q === -5 && unit.r === 0)!;
    exposed.q = -6;
    exposed.r = 1;

    finishRound(game, bus); // enter round 2
    finishRound(game, bus); // enter round 3
    finishRound(game, bus); // enter round 4, warning
    expect(game.artillery?.safeRadius).toBe(6);
    expect(game.artillery?.warningCells.length).toBeGreaterThan(0);
    expect(game.events.some(event => event.type === 'artillery_warning')).toBe(true);

    finishRound(game, bus); // enter round 5, radius 5 becomes active
    expect(game.artillery?.safeRadius).toBe(5);
    expect(exposed.hp).toBe(exposed.maxHp - 24);
    expect(game.events.some(event => event.type === 'artillery_shrunk')).toBe(true);
    expect(game.events.some(event => event.type === 'artillery_damage')).toBe(true);

    while (game.phase === 'active' && game.turn.roundNumber < 9) finishRound(game, bus);
    expect(game.artillery?.safeRadius).toBe(3);
    const point = game.controlPoints.find(candidate => candidate.owner === game.turn.currentPlayerId)!;
    expect(deployUnit(game, bus, game.turn.currentPlayerId!, 'infantry', point.id, point.q + 1, point.r))
      .toMatchObject({ ok: false, code: 'invalid_deploy' });
  });

  it('declares a draw when artillery destroys every remaining army simultaneously', () => {
    const { game, bus } = createAnnihilationGame();

    while (game.phase === 'active') finishRound(game, bus);

    expect(game.winner).toBeNull();
    expect(game.result?.reason).toBe('mutual_annihilation');
    expect(Object.values(game.players).every(player => player?.status === 'eliminated')).toBe(true);
  });
});
