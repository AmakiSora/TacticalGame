// tests/engine/simultaneous-steps.test.ts
// 同时回合模式"按行动点分步结算"的核心行为测试。
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/events/bus.js';
import { startGame } from '../../src/engine/engine.js';
import {
  queueAttackAction, queueDemolishAction, queueDeployAction, queueMoveAction, queueWaitAction,
} from '../../src/engine/planning.js';
import { commitAndMaybeResolve } from '../../src/engine/simultaneous.js';
import { getTerrain } from '../../src/engine/validation.js';
import { addLobbyPlayer, createLobby } from '../../src/state/store.js';
import type { GameState, PlayerId, Unit } from '../../src/types.js';

function createStandoffGame(): { game: GameState; bus: EventBus } {
  const bus = new EventBus();
  const game = createLobby(`standoff-steps-${Math.random().toString(36).slice(2, 8)}`, 'standoff', {
    maxPlayers: 2,
    participate: true,
    playerName: 'A',
  });
  expect(addLobbyPlayer(game, 'B')).not.toBeNull();
  expect(startGame(game, bus, () => 0).ok).toBe(true);
  return { game, bus };
}

function place(unit: Unit, q: number, r: number): void {
  unit.q = q;
  unit.r = r;
}

function unitOf(game: GameState, owner: PlayerId, type: Unit['type']): Unit {
  const unit = game.units.find(u => u.owner === owner && u.type === type && u.alive);
  expect(unit).toBeTruthy();
  return unit!;
}

function commitAll(game: GameState, bus: EventBus, players: PlayerId[]): void {
  for (const player of players) {
    expect(commitAndMaybeResolve(game, bus, player).ok).toBe(true);
  }
}

function events(game: GameState, type: string) {
  return game.events.filter(e => e.type === type);
}

function outcomes(game: GameState) {
  const resolved = events(game, 'round_resolved')[0]!;
  return resolved.payload.results as Record<string, Array<{
    actionId: string;
    type: string;
    step: number;
    status: string;
    reason?: string;
    unitId?: string;
  }>>;
}

describe('simultaneous step resolution', () => {
  it('resolves every player\'s step 1 before anyone\'s step 2', () => {
    const { game, bus } = createStandoffGame();
    const [a, b] = game.turn.turnOrder as [PlayerId, PlayerId];
    const units = game.units.filter(u => u.owner === a).slice(0, 2);
    const starts = [{ q: 0, r: 0 }, { q: 0, r: 1 }];
    const mid = [{ q: 1, r: 0 }, { q: 1, r: 1 }];
    const end = [{ q: 2, r: 0 }, { q: 2, r: 1 }];
    units.forEach((unit, index) => place(unit, starts[index]!.q, starts[index]!.r));
    // 队列顺序 = 行动点顺序：先两条第 1 步移动，再两条第 2 步移动。
    units.forEach((unit, index) => {
      expect(queueMoveAction(game, a, unit.id, mid[index]!.q, mid[index]!.r).ok).toBe(true);
    });
    units.forEach((unit, index) => {
      expect(queueMoveAction(game, a, unit.id, end[index]!.q, end[index]!.r).ok).toBe(true);
    });
    // 第 5 个行动点待命，B 用五个待命占住同样的步序，确保双方逐点推进。
    expect(queueWaitAction(game, a).ok).toBe(true);
    for (let i = 0; i < 5; i++) expect(queueWaitAction(game, b).ok).toBe(true);
    commitAll(game, bus, [a, b]);
    const moves = events(game, 'move');
    // 每名玩家每个行动点只能执行一条动作：A 的四条移动分别落在第 1-4 步，
    // B 的五个待命与之逐点对齐。
    expect(moves.map(event => event.payload.step)).toEqual([1, 2, 3, 4]);
    expect(moves.map(event => event.payload.actionsUsed)).toEqual([1, 2, 3, 4]);
    expect(events(game, 'wait').map(event => event.payload.step)).toEqual([1, 2, 3, 4, 5, 5]);
    for (const unit of units) {
      expect(end.some(cell => cell.q === unit.q && cell.r === unit.r)).toBe(true);
    }
  });

  it('fails a move onto a headquarters only at resolution (example 2)', () => {
    const { game, bus } = createStandoffGame();
    const [a, b] = game.turn.turnOrder as [PlayerId, PlayerId];
    const scout = unitOf(game, a, 'scout');
    const hq = game.headquarters[a]!;
    place(scout, hq.q - 1, hq.r);
    expect(queueMoveAction(game, a, scout.id, hq.q, hq.r).ok).toBe(true);
    commitAll(game, bus, [a, b]);
    const failed = events(game, 'action_failed').find(event => event.payload.unitId === scout.id)!;
    expect(failed.payload.reason).toBe('destination_occupied');
    expect(failed.payload.step).toBe(1);
    expect(scout.q).toBe(hq.q - 1);
    expect(game.players[a]!.stats.actionPointsUsed).toBe(1);
  });

  it('lets a second action move into a cell vacated at an earlier action point (example 3)', () => {
    const { game, bus } = createStandoffGame();
    const [a, b] = game.turn.turnOrder as [PlayerId, PlayerId];
    const first = unitOf(game, a, 'infantry');
    const second = game.units.find(unit => unit.owner === a && unit.id !== first.id && unit.alive)!;
    place(first, 0, 0);
    place(second, 1, 0);
    expect(queueMoveAction(game, a, first.id, -1, 0).ok).toBe(true);
    expect(queueMoveAction(game, a, second.id, 0, 0).ok).toBe(true);
    expect(queueWaitAction(game, a).ok).toBe(true);
    commitAll(game, bus, [a, b]);
    expect(first.q).toBe(-1);
    expect(first.r).toBe(0);
    expect(second.q).toBe(0);
    expect(second.r).toBe(0);
    expect(events(game, 'move').map(event => event.payload.step)).toEqual([1, 2]);
  });

  it('lets me enter a cell an enemy vacated at an earlier action point (example 4)', () => {
    const { game, bus } = createStandoffGame();
    const [a, b] = game.turn.turnOrder as [PlayerId, PlayerId];
    const enemy = unitOf(game, b, 'infantry');
    const mine = unitOf(game, a, 'scout');
    place(enemy, 0, 0);
    place(mine, 2, 0);
    expect(queueMoveAction(game, b, enemy.id, 1, 0).ok).toBe(true);
    expect(queueWaitAction(game, a).ok).toBe(true);
    expect(queueMoveAction(game, a, mine.id, 0, 0).ok).toBe(true);
    commitAll(game, bus, [a, b]);
    expect(enemy.q).toBe(1);
    expect(mine.q).toBe(0);
    expect(mine.r).toBe(0);
    expect(events(game, 'move').map(event => event.payload.step)).toEqual([1, 2]);
  });

  it('lets one unit move at step 1 and attack from its new position at step 2', () => {
    const { game, bus } = createStandoffGame();
    const [a, b] = game.turn.turnOrder as [PlayerId, PlayerId];
    const scout = unitOf(game, a, 'scout');
    const target = unitOf(game, b, 'infantry');
    place(scout, 4, 0);
    place(target, 2, 0);
    expect(queueMoveAction(game, a, scout.id, 3, 0).ok).toBe(true);
    expect(queueAttackAction(game, a, scout.id, 2, 0).ok).toBe(true);
    commitAll(game, bus, [a, b]);
    const result = outcomes(game)[a]!;
    expect(result.map(entry => entry.status)).toEqual(['executed', 'executed']);
    expect(result.map(entry => entry.step)).toEqual([1, 2]);
    expect(scout.q).toBe(3);
    expect(target.hp).toBeLessThan(target.maxHp);
  });

  it('voids later actions of a unit whose move failed (example 5)', () => {
    const { game, bus } = createStandoffGame();
    const [a, b] = game.turn.turnOrder as [PlayerId, PlayerId];
    const scout = unitOf(game, a, 'scout');
    const blocker = unitOf(game, b, 'infantry');
    const target = game.units.find(unit => unit.owner === b && unit.id !== blocker.id && unit.alive)!;
    place(scout, 4, 0);
    place(blocker, 3, 0);
    place(target, 2, 0);
    expect(queueMoveAction(game, a, scout.id, 3, 0).ok).toBe(true);
    expect(queueAttackAction(game, a, scout.id, 2, 0).ok).toBe(true);
    commitAll(game, bus, [a, b]);
    const result = outcomes(game)[a]!;
    expect(result.map(entry => entry.status)).toEqual(['failed', 'failed']);
    expect(result[0]!.reason).toBe('destination_occupied');
    expect(result[1]!.reason).toBe('previous_action_failed');
    expect(result.map(entry => entry.step)).toEqual([1, 2]);
    expect(game.players[a]!.stats.actionPointsUsed).toBe(2);
  });

  it('allows same-step vacate/fill and swaps', () => {
    const { game, bus } = createStandoffGame();
    const [a, b] = game.turn.turnOrder as [PlayerId, PlayerId];
    const first = unitOf(game, a, 'infantry');
    const second = unitOf(game, b, 'infantry');
    place(first, 0, 0);
    place(second, 1, 0);
    expect(queueMoveAction(game, a, first.id, 1, 0).ok).toBe(true);
    expect(queueMoveAction(game, b, second.id, 0, 0).ok).toBe(true);
    commitAll(game, bus, [a, b]);
    expect(first.q).toBe(1);
    expect(second.q).toBe(0);
    expect(events(game, 'action_failed')).toHaveLength(0);
    expect(events(game, 'move')).toHaveLength(2);
  });

  it('allows same-step vacate/fill into an emptied cell', () => {
    const { game, bus } = createStandoffGame();
    const [a, b] = game.turn.turnOrder as [PlayerId, PlayerId];
    const leaver = unitOf(game, a, 'infantry');
    const enterer = unitOf(game, b, 'infantry');
    place(leaver, 0, 0);
    place(enterer, 2, 0);
    expect(queueMoveAction(game, a, leaver.id, -1, 0).ok).toBe(true);
    expect(queueMoveAction(game, b, enterer.id, 0, 0).ok).toBe(true);
    commitAll(game, bus, [a, b]);
    expect(leaver.q).toBe(-1);
    expect(enterer.q).toBe(0);
    expect(enterer.r).toBe(0);
    expect(events(game, 'action_failed')).toHaveLength(0);
  });

  it('propagates a failed vacating move to the unit entering its cell', () => {
    const { game, bus } = createStandoffGame();
    const [a, b] = game.turn.turnOrder as [PlayerId, PlayerId];
    const mine = unitOf(game, a, 'infantry');
    const mover = unitOf(game, b, 'infantry');
    const blocker = game.units.find(unit => unit.owner === b && unit.id !== mover.id && unit.alive)!;
    place(mine, 0, 0);
    place(mover, 1, 0);
    place(blocker, 2, 0);
    expect(queueMoveAction(game, a, mine.id, 1, 0).ok).toBe(true);
    expect(queueMoveAction(game, b, mover.id, 2, 0).ok).toBe(true);
    commitAll(game, bus, [a, b]);
    const failed = events(game, 'action_failed');
    expect(failed).toHaveLength(2);
    expect(failed.every(event => event.payload.reason === 'destination_occupied')).toBe(true);
    expect(mine.q).toBe(0);
    expect(mover.q).toBe(1);
  });

  it('supports wait actions to align a later action point', () => {
    const { game, bus } = createStandoffGame();
    const [a, b] = game.turn.turnOrder as [PlayerId, PlayerId];
    const scout = unitOf(game, a, 'scout');
    place(scout, 0, 0);
    expect(queueWaitAction(game, a).ok).toBe(true);
    expect(queueWaitAction(game, a).ok).toBe(true);
    expect(queueMoveAction(game, a, scout.id, 1, 0).ok).toBe(true);
    commitAll(game, bus, [a, b]);
    const moves = events(game, 'move');
    expect(moves).toHaveLength(1);
    expect(moves[0]!.payload.step).toBe(3);
    expect(events(game, 'wait').map(event => event.payload.step)).toEqual([1, 2]);
    expect(scout.q).toBe(1);
    expect(game.players[a]!.stats.actionPointsUsed).toBe(3);
  });

  it('rejects a move beyond moveRange at queue time', () => {
    const { game } = createStandoffGame();
    const a = game.turn.turnOrder[0]!;
    const infantry = unitOf(game, a, 'infantry');
    place(infantry, 0, 0);
    expect(queueMoveAction(game, a, infantry.id, 3, 0))
      .toMatchObject({ ok: false, code: 'invalid_move' });
  });

  it('rejects a move onto blocker terrain at queue time', () => {
    const { game } = createStandoffGame();
    const a = game.turn.turnOrder[0]!;
    const heavy = unitOf(game, a, 'infantry');
    heavy.type = 'heavy';
    place(heavy, 3, 1);
    expect(getTerrain(game, 3, 2)).toBe('blocker');
    expect(queueMoveAction(game, a, heavy.id, 3, 2))
      .toMatchObject({ ok: false, code: 'invalid_move' });
  });

  it('lets a deploy fill a cell vacated at an earlier action point', () => {
    const { game, bus } = createStandoffGame();
    const [a, b] = game.turn.turnOrder as [PlayerId, PlayerId];
    const scout = unitOf(game, a, 'scout');
    const hq = game.headquarters[a]!;
    for (const unit of game.units.filter(unit => unit.owner === a && unit.id !== scout.id)) {
      place(unit, -3, 0);
    }
    place(scout, 4, 0);
    expect(queueMoveAction(game, a, scout.id, 4, 1).ok).toBe(true);
    expect(queueDeployAction(game, a, 'infantry', hq.id, 4, 0).ok).toBe(true);
    commitAll(game, bus, [a, b]);
    expect(events(game, 'deploy')).toHaveLength(1);
    expect(events(game, 'move')).toHaveLength(1);
    expect(game.units.some(unit => unit.owner === a && unit.type === 'infantry' && unit.q === 4 && unit.r === 0)).toBe(true);
    expect(scout.q).toBe(4);
    expect(scout.r).toBe(1);
  });

  it('lets a unit move into terrain demolished at an earlier action point', () => {
    const { game, bus } = createStandoffGame();
    const [a, b] = game.turn.turnOrder as [PlayerId, PlayerId];
    const heavy = unitOf(game, a, 'infantry');
    heavy.type = 'heavy';
    place(heavy, 3, 1);
    expect(getTerrain(game, 3, 2)).toBe('blocker');
    expect(queueDemolishAction(game, a, heavy.id, 3, 2).ok).toBe(true);
    expect(queueMoveAction(game, a, heavy.id, 3, 2).ok).toBe(true);
    commitAll(game, bus, [a, b]);
    expect(getTerrain(game, 3, 2)).toBe('plain');
    expect(events(game, 'demolish')).toHaveLength(1);
    expect(events(game, 'move')).toHaveLength(1);
    expect(heavy.q).toBe(3);
    expect(heavy.r).toBe(2);
  });

  it('voids a dead unit\'s later action with unit_gone', () => {
    const { game, bus } = createStandoffGame();
    const [a, b] = game.turn.turnOrder as [PlayerId, PlayerId];
    const attacker = unitOf(game, a, 'infantry');
    const victim = unitOf(game, b, 'scout');
    place(attacker, 1, 0);
    place(victim, 0, 0);
    attacker.attack = 999;
    expect(queueWaitAction(game, b).ok).toBe(true);
    expect(queueMoveAction(game, b, victim.id, -1, 0).ok).toBe(true);
    expect(queueAttackAction(game, a, attacker.id, 0, 0).ok).toBe(true);
    commitAll(game, bus, [a, b]);
    const result = outcomes(game)[b]!;
    expect(result[0]!.status).toBe('executed');
    expect(result[1]!.status).toBe('failed');
    expect(result[1]!.reason).toBe('unit_gone');
    expect(result[1]!.step).toBe(2);
    expect(victim.alive).toBe(false);
  });

  it('stops a round early when the last opponent is eliminated', () => {
    const { game, bus } = createStandoffGame();
    const [a, b] = game.turn.turnOrder as [PlayerId, PlayerId];
    const attacker = unitOf(game, a, 'infantry');
    const hqB = game.headquarters[b]!;
    place(attacker, hqB.q + 1, hqB.r);
    attacker.attack = 999;
    expect(queueAttackAction(game, a, attacker.id, hqB.q, hqB.r).ok).toBe(true);
    expect(queueWaitAction(game, b).ok).toBe(true);
    expect(queueWaitAction(game, b).ok).toBe(true);
    commitAll(game, bus, [a, b]);
    expect(game.phase).toBe('game_over');
    const resolved = events(game, 'round_resolved').at(-1)!;
    expect(resolved.payload.steps).toBe(1);
    expect(game.events.slice(-3).map(event => event.type)).toEqual(['round_end', 'round_resolved', 'game_over']);
  });
});
