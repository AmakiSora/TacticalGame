import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/events/bus.js';
import { attackTarget } from '../../src/engine/combat.js';
import { deployUnit } from '../../src/engine/deployment.js';
import { buildAdjudicationScores, eliminatePlayer, endTurn, startGame } from '../../src/engine/engine.js';
import { isArtilleryDanger } from '../../src/engine/artillery.js';
import { moveUnit } from '../../src/engine/units.js';
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

  it('preserves a player score when annihilation removes their army', () => {
    const { game, bus } = createAnnihilationGame(3);
    const victim = 'player_b';
    const before = buildAdjudicationScores(game)[victim];

    expect(eliminatePlayer(game, bus, victim, 'host_eliminated', null)).toMatchObject({ ok: true });
    expect(game.players[victim]?.adjudicationScore).toEqual(before);
    expect(buildAdjudicationScores(game)[victim]).toEqual(before);
    expect(game.events.find(event => event.type === 'player_eliminated')?.payload).toMatchObject({ score: before });
  });

  it('does not award score for movement alone', () => {
    const { game, bus } = createAnnihilationGame();
    const owner = game.turn.currentPlayerId!;
    const unit = game.units.find(candidate => candidate.owner === owner)!;
    const destination = findReachableCells(game, unit)[0]!;
    const before = buildAdjudicationScores(game)[owner]!;

    expect(moveUnit(game, bus, owner, unit.id, destination.q, destination.r)).toMatchObject({ ok: true });

    const after = buildAdjudicationScores(game)[owner]!;
    expect(game.players[owner]?.stats.actionPointsUsed).toBe(1);
    expect(game.players[owner]?.stats.actionMerit).toBe(0);
    expect(after.killValue).toBe(0);
    expect(after.total - before.total).toBe(0);
  });

  it('does not score non-lethal combat damage directly, only via enemy army loss', () => {
    const { game, bus } = createAnnihilationGame();
    const owner = game.turn.currentPlayerId!;
    const enemy = game.turn.turnOrder.find(candidate => candidate !== owner)!;
    const attacker = game.units.find(candidate => candidate.owner === owner)!;
    const target = game.units.find(candidate => candidate.owner === enemy)!;
    attacker.attackRange = 20;
    attacker.attack = 40;
    target.defense = 0;
    target.hp = 100;
    const enemyArmyBefore = buildAdjudicationScores(game)[enemy]!.armyValue;

    expect(attackTarget(game, bus, owner, attacker.id, target.id)).toMatchObject({ ok: true });

    // 3.6.0 起伤害本身不再记功绩/得分；压血只体现在对方军力价值下降。
    expect(game.players[owner]?.stats.actionPointsUsed).toBe(1);
    expect(game.players[owner]?.stats.actionMerit).toBe(0);
    expect(game.players[owner]?.stats.killValue).toBe(0);
    expect(buildAdjudicationScores(game)[enemy]!.armyValue).toBeLessThan(enemyArmyBefore);
  });

  it('banks the killed unit cost as killValue for the killing blow', () => {
    const { game, bus } = createAnnihilationGame();
    const owner = game.turn.currentPlayerId!;
    const enemy = game.turn.turnOrder.find(candidate => candidate !== owner)!;
    const attacker = game.units.find(candidate => candidate.owner === owner)!;
    const target = game.units.find(candidate => candidate.owner === enemy)!;
    attacker.attackRange = 20;
    attacker.attack = 40;
    target.defense = 0;
    target.hp = 1;

    expect(attackTarget(game, bus, owner, attacker.id, target.id)).toMatchObject({ ok: true });

    expect(game.players[owner]?.stats.unitsDestroyed).toBe(1);
    expect(game.players[owner]?.stats.killValue).toBe(target.cost);
    expect(buildAdjudicationScores(game)[owner]?.killValue).toBe(target.cost);
  });

  it('credits no one when artillery destroys a unit', () => {
    const { game, bus } = createAnnihilationGame();
    const exposed = game.units.find(unit => unit.q === -5 && unit.r === 0)!;
    exposed.q = -6;
    exposed.r = 1;
    exposed.hp = 1;

    finishRound(game, bus); // enter round 2
    finishRound(game, bus); // enter round 3
    finishRound(game, bus); // enter round 4, warning
    finishRound(game, bus); // enter round 5, radius 5 danger ring activates

    // 环境伤害（炮火）击杀不归属任何玩家：无人获得击杀价值。
    expect(exposed.alive).toBe(false);
    const death = game.events.find(event => event.type === 'unit_death' && event.payload.unitId === exposed.id);
    expect(death?.payload.cause).toBe('artillery');
    for (const player of Object.values(game.players)) {
      expect(player?.stats.killValue ?? 0).toBe(0);
      expect(player?.stats.unitsDestroyed ?? 0).toBe(0);
    }
  });

  it('freezes killValue and controlHold into the eliminated player score', () => {
    const { game, bus } = createAnnihilationGame(3);
    const victim = 'player_b';
    game.players[victim]!.stats.killValue = 123;
    game.players[victim]!.stats.controlHold = 4;
    game.players[victim]!.stats.controlHoldRounds = 2;

    expect(eliminatePlayer(game, bus, victim, 'host_eliminated', null)).toMatchObject({ ok: true });

    const frozen = game.players[victim]!.adjudicationScore!;
    expect(frozen.killValue).toBe(123);
    expect(frozen.controlHold).toBe(2);
    // 冻结分含击杀价值贡献（artillery-zone 击杀权重 0.5），且之后不再随战局变化。
    const weights = game.config.balance.adjudicationWeights;
    expect(frozen.total).toBeCloseTo(frozen.armyValue * weights.armyValue + 123 * (weights.killValue ?? 0), 6);
    expect(buildAdjudicationScores(game)[victim]).toEqual(frozen);
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

  it('closes outer production in round 9, inner in round 11, and saturates at radius 1 in round 13', () => {
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
    expect(game.config.balance.maxTurns).toBe(20);

    // 原地不动的部队会在第 12 轮被炮火全灭，全员撤进花心才能观察到最终收缩
    for (const unit of game.units) {
      unit.q = 0;
      unit.r = 0;
    }
    while (game.phase === 'active' && game.turn.roundNumber < 13) finishRound(game, bus);
    expect(game.artillery?.safeRadius).toBe(1);
    expect(game.artillery?.nextShrinkRound).toBeNull();
    expect(game.phase).toBe('active');
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
