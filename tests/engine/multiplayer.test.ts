import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/events/bus.js';
import { attackTarget } from '../../src/engine/combat.js';
import { demolishTerrain } from '../../src/engine/demolition.js';
import { deployUnit } from '../../src/engine/deployment.js';
import { buildAdjudicationScores, endTurn, eliminatePlayer, startGame } from '../../src/engine/engine.js';
import { moveUnit } from '../../src/engine/units.js';
import { findReachableCells, isInBounds } from '../../src/engine/validation.js';
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

function createFourCornerGame(): { game: GameState; bus: EventBus } {
  const bus = new EventBus();
  const game = createLobby('mp-4-irregular', 'four-corners', {
    maxPlayers: 4,
    participate: true,
    playerName: 'A',
  });
  expect(addLobbyPlayer(game, 'B')).not.toBeNull();
  expect(addLobbyPlayer(game, 'C')).not.toBeNull();
  expect(addLobbyPlayer(game, 'D')).not.toBeNull();
  expect(startGame(game, bus, () => 0).ok).toBe(true);
  return { game, bus };
}

describe('multiplayer free-for-all engine', () => {
  it('starts four-corners with four symmetric spawns and authoritative irregular cells', () => {
    const { game } = createFourCornerGame();
    expect(game.cells).toHaveLength(163);
    expect(Object.keys(game.headquarters)).toHaveLength(4);
    expect(game.units).toHaveLength(8);
    expect(new Set(Object.values(game.players).map(player => player?.spawnSlotId)).size).toBe(4);
    expect(isInBounds(game, 9, 0)).toBe(false);
    expect(isInBounds(game, 9, -6)).toBe(true);
  });

  it('rejects movement, deployment and demolition into a radius-valid missing cell', () => {
    const { game, bus } = createFourCornerGame();
    const northWestHq = Object.values(game.headquarters).find(hq => hq.q === -3 && hq.r === -6)!;
    const scout = game.units.find(unit => unit.owner === northWestHq.owner && unit.q === -3 && unit.r === -5)!;
    const missing = { q: -4, r: -5 };

    expect(findReachableCells(game, scout)).not.toContainEqual(missing);
    expect(moveUnit(game, bus, scout.owner, scout.id, missing.q, missing.r)).toMatchObject({ ok: false, code: 'invalid_move' });
    expect(deployUnit(game, bus, northWestHq.owner, 'infantry', northWestHq.id, missing.q, missing.r))
      .toMatchObject({ ok: false, code: 'invalid_terrain' });
    scout.type = 'heavy';
    expect(demolishTerrain(game, bus, scout.owner, scout.id, missing.q, missing.r))
      .toMatchObject({ ok: false, code: 'invalid_demolish' });
    expect(game.turn.actionsUsed).toBe(0);
  });

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
    const scoreBeforeElimination = buildAdjudicationScores(game)[victim];

    const result = eliminatePlayer(game, bus, victim, 'host_eliminated', attacker);
    expect(result.ok).toBe(true);
    expect(game.phase).toBe('active');
    expect(game.players[victim]?.status).toBe('eliminated');
    expect(game.units.every(u => u.owner !== victim)).toBe(true);
    expect(point.owner).toBeNull();
    expect(game.events.some(e => e.type === 'player_eliminated')).toBe(true);
    expect(game.events.some(e => e.type === 'control_point_neutralized')).toBe(true);
    expect(game.players[victim]?.adjudicationScore).toEqual(scoreBeforeElimination);
    expect(buildAdjudicationScores(game)[victim]).toEqual(scoreBeforeElimination);
    expect(game.events.find(e => e.type === 'player_eliminated')?.payload.score).toEqual(scoreBeforeElimination);
    expect(game.winner).toBeNull();
  });

  it('adds the lower standard-mode action score for an action point spent', () => {
    const { game, bus } = createThreePlayerGame();
    const owner = game.turn.currentPlayerId!;
    const unit = game.units.find(candidate => candidate.owner === owner)!;
    const destination = findReachableCells(game, unit)[0]!;
    const before = buildAdjudicationScores(game)[owner]!;

    expect(moveUnit(game, bus, owner, unit.id, destination.q, destination.r)).toMatchObject({ ok: true });

    const after = buildAdjudicationScores(game)[owner]!;
    expect(game.players[owner]?.stats.actionPointsUsed).toBe(1);
    expect(after.actionScore).toBe(2);
    expect(after.total - before.total).toBe(2);
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
