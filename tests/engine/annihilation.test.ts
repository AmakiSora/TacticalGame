import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/events/bus.js';
import { attackTarget } from '../../src/engine/combat.js';
import { deployUnit } from '../../src/engine/deployment.js';
import { endTurn, startGame } from '../../src/engine/engine.js';
import { isArtilleryDanger } from '../../src/engine/artillery.js';
import { findReachableCells } from '../../src/engine/validation.js';
import { addLobbyPlayer, createLobby } from '../../src/state/store.js';

function createAnnihilationGame(playerCount = 2) {
  const bus = new EventBus();
  const game = createLobby('annihilation-test', 'artillery-zone', {
    maxPlayers: playerCount,
    participate: true,
    playerName: 'A',
  });
  for (let index = 1; index < playerCount; index++) {
    expect(addLobbyPlayer(game, String.fromCharCode(65 + index))).not.toBeNull();
  }
  expect(startGame(game, bus, () => 0).ok).toBe(true);
  return { game, bus };
}

function finishRound(game: ReturnType<typeof createAnnihilationGame>['game'], bus: EventBus) {
  for (let i = 0; i < 2 && game.phase === 'active'; i++) {
    expect(endTurn(game, bus, game.turn.currentPlayerId!).ok).toBe(true);
  }
}

describe('annihilation mode', () => {
  it.each([2, 3, 6])('starts a %i-player artillery-zone game with symmetric armies and owned spawn points', playerCount => {
    const { game } = createAnnihilationGame(playerCount);
    const activePlayers = Object.values(game.players).filter(player => player?.status === 'active');

    expect(game.turn.turnOrder).toHaveLength(playerCount);
    expect(Object.keys(game.headquarters)).toHaveLength(0);
    expect(game.units).toHaveLength(playerCount * 3);
    expect(game.controlPoints.filter(point => point.owner !== null)).toHaveLength(playerCount);
    for (const player of activePlayers) {
      expect(game.units.filter(unit => unit.owner === player!.id)).toHaveLength(3);
      expect(game.controlPoints.filter(point => point.owner === player!.id)).toHaveLength(1);
    }
  });

  it.each([2, 3, 6])('limits every %i-player opening army to its own directional supply point', playerCount => {
    const { game } = createAnnihilationGame(playerCount);

    for (const owner of game.turn.turnOrder) {
      const direction = game.players[owner]!.spawnSlotId!.slice('slot_'.length);
      const matchingSupplyId = `supply_${direction}`;
      const reachable = new Set(game.units
        .filter(unit => unit.owner === owner && unit.canCapture)
        .flatMap(unit => findReachableCells(game, unit))
        .map(position => `${position.q},${position.r}`));
      const reachablePoints = game.controlPoints
        .filter(point => reachable.has(`${point.q},${point.r}`) && point.owner !== owner);

      expect(reachablePoints.map(point => point.id)).toEqual([matchingSupplyId]);
    }
  });

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

  it('raises turn income from 12 to 20 after capturing an inner supply point', () => {
    const { game, bus } = createAnnihilationGame();
    const current = game.turn.currentPlayerId!;
    const next = game.turn.turnOrder.find(owner => owner !== current)!;
    const supplyPoint = game.controlPoints.find(point => point.kind === 'supply')!;
    supplyPoint.owner = next;
    const suppliesBefore = game.resources[next]!.supplies;

    expect(endTurn(game, bus, current).ok).toBe(true);

    expect(game.resources[next]!.supplies - suppliesBefore).toBe(20);
    expect(game.events.find(event => event.type === 'income' && event.payload.owner === next)?.payload)
      .toMatchObject({ base: 8, control: 12, amount: 20 });
  });

  it('closes outer production in round 9 and inner production in round 11', () => {
    const { game, bus } = createAnnihilationGame();
    const outerPoint = game.controlPoints.find(point => point.kind === 'forward_base')!;
    const innerPoint = game.controlPoints.find(point => point.kind === 'supply')!;

    while (game.phase === 'active' && game.turn.roundNumber < 9) finishRound(game, bus);
    expect(game.artillery?.safeRadius).toBe(3);
    expect(isArtilleryDanger(game, outerPoint)).toBe(true);
    expect(isArtilleryDanger(game, innerPoint)).toBe(false);

    while (game.phase === 'active' && game.turn.roundNumber < 11) finishRound(game, bus);
    expect(game.artillery?.safeRadius).toBe(2);
    expect(isArtilleryDanger(game, outerPoint)).toBe(true);
    expect(isArtilleryDanger(game, innerPoint)).toBe(true);
    expect(game.config.balance.maxTurns).toBe(12);
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
    expect(exposed.hp).toBe(exposed.maxHp - 25);
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
