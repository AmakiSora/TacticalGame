import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/events/bus.js';
import { isArtilleryDanger } from '../../src/engine/artillery.js';
import { adjudicateAtTurnLimit, forceAdjudication, startGame } from '../../src/engine/engine.js';
import { commitAndMaybeResolve } from '../../src/engine/simultaneous.js';
import { queueAttackAction, queueDeployAction, queueHealAction } from '../../src/engine/planning.js';
import { createUnitFromConfig, addLobbyPlayer, createLobby } from '../../src/state/store.js';

function createRoyaleGame(playerCount = 2) {
  const bus = new EventBus();
  const game = createLobby('royale-test', 'snowflake', {
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

/** royale 回合推进：所有存活玩家确认计划后触发统一结算（动作为空队列亦可）。 */
function commitAll({ game, bus }: ReturnType<typeof createRoyaleGame>): void {
  for (const id of game.turn.turnOrder) {
    if (game.phase !== 'active') break;
    const player = game.players[id];
    if (player?.status !== 'active' || game.plan!.committed.includes(id)) continue;
    expect(commitAndMaybeResolve(game, bus, id)).toMatchObject({ ok: true });
  }
}

function advanceToRounds(context: ReturnType<typeof createRoyaleGame>, roundNumber: number): void {
  let guard = 0;
  while (context.game.phase === 'active' && context.game.turn.roundNumber < roundNumber) {
    commitAll(context);
    if (++guard > 100) throw new Error(`round ${roundNumber} not reached`);
  }
}

describe('royale mode', () => {
  it.each([2, 3, 6])('starts a %i-player snowflake game without headquarters and with plan state', playerCount => {
    const { game } = createRoyaleGame(playerCount);
    const activePlayers = Object.values(game.players).filter(player => player?.status === 'active');

    expect(game.config.mode).toBe('royale');
    expect(game.turn.turnOrder).toHaveLength(playerCount);
    expect(game.turn.currentPlayerId).toBeNull();
    expect(game.plan).toEqual({ queues: {}, committed: [] });
    expect(Object.keys(game.headquarters)).toHaveLength(0);
    expect(game.units).toHaveLength(playerCount * 3);
    expect(game.controlPoints.filter(point => point.owner !== null)).toHaveLength(playerCount);
    for (const player of activePlayers) {
      expect(game.units.filter(unit => unit.owner === player!.id)).toHaveLength(3);
      expect(game.controlPoints.filter(point => point.owner === player!.id)).toHaveLength(1);
    }
    expect(game.artillery).toMatchObject({ safeRadius: 9, nextShrinkRound: 6 });

    const start = game.events.find(event => event.type === 'game_start')!;
    expect(start.payload.mode).toBe('royale');
    expect(start.payload.headquarters).toEqual({});
    expect(start.payload.artillery).toMatchObject({ safeRadius: 9, nextShrinkRound: 6 });
  });

  it('deploys from the owned spawn point during the plan phase and resolves on commit', () => {
    const { game, bus } = createRoyaleGame();
    const point = game.controlPoints.find(candidate => candidate.owner === 'player_a')!;
    const occupied = new Set(game.units.map(unit => `${unit.q},${unit.r}`));
    const dirs = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
    const target = dirs
      .map(([dq, dr]) => ({ q: point.q + dq!, r: point.r + dr! }))
      .find(pos => game.cells.some(cell => cell.q === pos.q && cell.r === pos.r)
        && !occupied.has(`${pos.q},${pos.r}`))!;
    const suppliesBefore = game.resources['player_a']!.supplies;

    const queued = queueDeployAction(game, 'player_a', 'infantry', point.id, target.q, target.r);
    expect(queued).toMatchObject({ ok: true });
    expect(game.plan!.queues['player_a']).toHaveLength(1);

    expect(queueDeployAction(game, 'player_b', 'infantry', point.id, target.q, target.r))
      .toMatchObject({ ok: false, code: 'invalid_deploy' });

    commitAll({ game, bus });
    const deploy = game.events.find(event => event.type === 'deploy');
    expect(deploy?.payload).toMatchObject({ owner: 'player_a', fromId: point.id, cost: 55, discount: 0 });
    // 结算后进入第 2 回合：扣部署费 55（本图无部署折扣），轮界收入 base 20 + 据点 20。
    expect(game.resources['player_a']!.supplies).toBe(suppliesBefore - 55 + 40);
  });

  it('warns in round 5 and shrinks with artillery damage from round 6 on', () => {
    const { game, bus } = createRoyaleGame();
    const exposed = game.units.find(unit => unit.owner === 'player_a' && unit.type === 'heavy')!;
    expect(isArtilleryDanger(game, { q: exposed.q, r: exposed.r })).toBe(false);

    advanceToRounds({ game, bus }, 5);
    expect(game.turn.roundNumber).toBe(5);
    expect(game.artillery).toMatchObject({ safeRadius: 9, nextShrinkRound: 6 });
    expect(game.artillery!.warningCells.length).toBeGreaterThan(0);
    expect(game.events.some(event => event.type === 'artillery_warning')).toBe(true);
    expect(game.events.some(event => event.type === 'artillery_damage')).toBe(false);
    expect(exposed.hp).toBe(exposed.maxHp);

    advanceToRounds({ game, bus }, 6);
    expect(game.artillery).toMatchObject({ safeRadius: 8 });
    expect(game.events.some(event => event.type === 'artillery_shrunk')).toBe(true);
    expect(exposed.hp).toBe(exposed.maxHp - 25);
    expect(game.events.some(event => event.type === 'artillery_damage' && event.payload.owner === exposed.owner))
      .toBe(true);

    advanceToRounds({ game, bus }, 8);
    expect(game.artillery).toMatchObject({ safeRadius: 6 });
    expect(exposed.alive).toBe(true);
    expect(exposed.hp).toBe(exposed.maxHp - 75);
  });

  it('blocks plan-phase deploys from spawn points once the ring swallows them', () => {
    const { game, bus } = createRoyaleGame();
    const point = game.controlPoints.find(candidate => candidate.owner === 'player_a')!;

    advanceToRounds({ game, bus }, 7);
    expect(isArtilleryDanger(game, point)).toBe(true);
    expect(queueDeployAction(game, 'player_a', 'infantry', point.id, point.q, point.r + 1))
      .toMatchObject({ ok: false, code: 'invalid_deploy' });
  });

  it('blocks plan-phase heals aimed into the artillery zone', () => {
    const { game, bus } = createRoyaleGame();
    const owner = 'player_a';
    // player_a 的第二台重装在 (-8,-1)（第 7 回合起处于危险区）；占着内侧相邻
    // 安全格 (-7,0) 的侦察兵先挪进内圈，给支援兵腾出这个第 7 回合唯一的邻接安全格。
    const wounded = game.units.find(unit => unit.owner === owner && unit.type === 'heavy' && unit.q === -8)!;
    const scout = game.units.find(unit => unit.owner === owner && unit.type === 'scout')!;
    scout.q = -1;
    scout.r = 0;
    const support = createUnitFromConfig(game.config, owner, 'support', wounded.q + 1, wounded.r + 1);
    game.units.push(support);

    advanceToRounds({ game, bus }, 7);
    expect(isArtilleryDanger(game, support)).toBe(false);
    expect(isArtilleryDanger(game, wounded)).toBe(true);
    expect(queueHealAction(game, owner, support.id, wounded.q, wounded.r))
      .toMatchObject({ ok: false, code: 'invalid_heal' });
  });

  it('eliminates the wiped player by artillery and crowns the last player standing', () => {
    const { game, bus } = createRoyaleGame();
    const victim = 'player_b';
    const survivor = game.turn.turnOrder.find(owner => owner !== victim)!;
    const dangerCells: { q: number; r: number }[] = [{ q: 9, r: 0 }, { q: 0, r: -9 }, { q: -9, r: 9 }];
    const victimUnits = game.units.filter(unit => unit.owner === victim);
    const survivorUnits = game.units.filter(unit => unit.owner === survivor);
    dangerCells.forEach((cell, index) => {
      victimUnits[index]!.q = cell.q;
      victimUnits[index]!.r = cell.r;
    });
    survivorUnits.forEach((unit, index) => {
      const safe = [{ q: 1, r: 0 }, { q: 0, r: 1 }, { q: -1, r: 0 }][index]!;
      unit.q = safe.q;
      unit.r = safe.r;
    });

    let guard = 0;
    while (game.phase === 'active' && guard < 30) {
      commitAll({ game, bus });
      guard += 1;
    }

    expect(game.phase).toBe('game_over');
    expect(game.players[victim]?.status).toBe('eliminated');
    expect(game.players[survivor]?.status).toBe('active');
    expect(game.winner).toBe(survivor);
    expect(game.result?.reason).toBe('last_player_standing');
    expect(game.events.find(event => event.type === 'player_eliminated')?.payload)
      .toMatchObject({ playerId: victim, reason: 'artillery_destroyed' });
  });

  it('collapses into mutual annihilation once the ring closes to the innermost cells', () => {
    const { game, bus } = createRoyaleGame();

    let guard = 0;
    while (game.phase === 'active' && guard < 40) {
      commitAll({ game, bus });
      guard += 1;
    }

    expect(game.phase).toBe('game_over');
    expect(game.winner).toBeNull();
    expect(game.result?.reason).toBe('mutual_annihilation');
    expect(Object.values(game.players).every(player => player?.status === 'eliminated')).toBe(true);
  });

  it('eliminates both players as army_destroyed when a simultaneous exchange wipes both armies', () => {
    const { game, bus } = createRoyaleGame();
    const duelist = game.units.find(unit => unit.owner === 'player_a' && unit.type === 'heavy')!;
    const target = game.units.find(unit => unit.owner === 'player_b' && unit.type === 'heavy')!;
    game.units = [duelist, target];
    // (1,0) 与 (1,-1) 都是雪花图内圈平原格，重装 arc 形状以相邻格定向扫三格。
    duelist.q = 1;
    duelist.r = 0;
    target.q = 1;
    target.r = -1;
    duelist.hp = 1;
    target.hp = 1;

    expect(queueAttackAction(game, 'player_a', duelist.id, 1, -1)).toMatchObject({ ok: true });
    expect(queueAttackAction(game, 'player_b', target.id, 1, 0)).toMatchObject({ ok: true });
    commitAll({ game, bus });

    expect(game.phase).toBe('game_over');
    expect(game.winner).toBeNull();
    expect(game.result?.reason).toBe('mutual_annihilation');
    const eliminations = game.events.filter(event => event.type === 'player_eliminated');
    expect(eliminations.map(event => event.payload.reason)).toEqual(['army_destroyed', 'army_destroyed']);
    expect(eliminations.map(event => event.payload.playerId).sort()).toEqual(['player_a', 'player_b']);
  });

  it('attributes army_destroyed elimination to the killer when only one side is wiped', () => {
    const { game, bus } = createRoyaleGame();
    const killer = game.units.find(unit => unit.owner === 'player_a' && unit.type === 'heavy')!;
    const victimUnit = game.units.find(unit => unit.owner === 'player_b' && unit.type === 'heavy')!;
    game.units = [killer, victimUnit];
    killer.q = 1;
    killer.r = 0;
    victimUnit.q = 1;
    victimUnit.r = -1;
    victimUnit.hp = 1;

    expect(queueAttackAction(game, 'player_a', killer.id, 1, -1)).toMatchObject({ ok: true });
    commitAll({ game, bus });

    expect(game.phase).toBe('game_over');
    expect(game.players['player_b']?.status).toBe('eliminated');
    expect(game.players['player_a']?.status).toBe('active');
    expect(game.winner).toBe('player_a');
    expect(game.result?.reason).toBe('last_player_standing');
    expect(game.events.find(event => event.type === 'player_eliminated')?.payload)
      .toMatchObject({ playerId: 'player_b', reason: 'army_destroyed', eliminatedBy: 'player_a' });
  });

  it('never adjudicates at a turn limit but still supports forced adjudication', () => {
    const { game, bus } = createRoyaleGame();
    expect(game.config.balance.maxTurns).toBeNull();
    expect(adjudicateAtTurnLimit(game, bus)).toBe(false);

    expect(forceAdjudication(game, bus)).toMatchObject({ ok: true });
    expect(game.phase).toBe('game_over');
    expect(['forced_adjudication_score', 'forced_adjudication_draw']).toContain(game.result?.reason);
  });

  it('pays round-boundary income to every active player like simultaneous mode', () => {
    const { game, bus } = createRoyaleGame();
    const suppliesA = game.resources['player_a']!.supplies;
    const suppliesB = game.resources['player_b']!.supplies;

    commitAll({ game, bus });

    expect(game.turn.roundNumber).toBe(2);
    const incomeEvents = game.events.filter(event => event.type === 'income');
    expect(incomeEvents).toHaveLength(2);
    expect(incomeEvents[0]!.payload).toMatchObject({ base: 20, control: 20 });
    expect(game.resources['player_a']!.supplies).toBe(suppliesA + 40);
    expect(game.resources['player_b']!.supplies).toBe(suppliesB + 40);
  });
});
