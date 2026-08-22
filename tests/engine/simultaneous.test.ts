// tests/engine/simultaneous.test.ts
// simultaneous 模式（对峙之地 standoff 地图）的计划阶段与严格同时结算器测试。
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/events/bus.js';
import { eliminatePlayer, startGame } from '../../src/engine/engine.js';
import {
  clearPlanActions, queueAttackAction, queueDemolishAction, queueDeployAction,
  queueHealAction, queueMoveAction, revokePlanAction,
} from '../../src/engine/planning.js';
import {
  commitAndMaybeResolve, eliminateFromPlanAndMaybeResolve, forceResolveRound,
} from '../../src/engine/simultaneous.js';
import { getTerrain } from '../../src/engine/validation.js';
import { addLobbyPlayer, createLobby } from '../../src/state/store.js';
import type { GameState, PlayerId, Unit } from '../../src/types.js';

function createStandoffGame(count: 2 | 3 | 6 = 2): { game: GameState; bus: EventBus } {
  const bus = new EventBus();
  const game = createLobby(`standoff-${count}-${Math.random().toString(36).slice(2, 8)}`, 'standoff', {
    maxPlayers: count,
    participate: true,
    playerName: 'A',
  });
  for (let extra = 1; extra < count; extra++) {
    expect(addLobbyPlayer(game, `P${extra}`)).not.toBeNull();
  }
  expect(startGame(game, bus, () => 0).ok).toBe(true);
  return { game, bus };
}

function unitAt(game: GameState, owner: PlayerId, q: number, r: number): Unit {
  const unit = game.units.find(u => u.owner === owner && u.q === q && u.r === r && u.alive);
  expect(unit).toBeTruthy();
  return unit!;
}

/** 直接摆放单位（测试专用），并确保不与其他单位重叠。 */
function place(unit: Unit, q: number, r: number): void {
  unit.q = q;
  unit.r = r;
}

function commitAll(game: GameState, bus: EventBus, players: PlayerId[]): void {
  for (const player of players) {
    const result = commitAndMaybeResolve(game, bus, player);
    expect(result.ok).toBe(true);
  }
}

function events(game: GameState, type: string) {
  return game.events.filter(e => e.type === type);
}

describe('simultaneous mode setup', () => {
  it('starts a standoff game with no current player and an empty plan', () => {
    const { game } = createStandoffGame(2);
    expect(game.config.mode).toBe('simultaneous');
    expect(game.phase).toBe('active');
    expect(game.turn.currentPlayerId).toBeNull();
    expect(game.turn.currentOwner).toBeNull();
    expect(game.plan).toEqual({ queues: {}, committed: [] });
    expect(Object.keys(game.headquarters)).toHaveLength(2);
    expect(game.units).toHaveLength(8);
    const start = game.events.find(e => e.type === 'game_start')!;
    expect(start.payload.mode).toBe('simultaneous');
    expect(start.payload.firstPlayer).toBeNull();
  });

  it('supports the 6-player symmetric layout', () => {
    const { game } = createStandoffGame(6);
    expect(game.turn.turnOrder).toHaveLength(6);
    expect(Object.keys(game.headquarters)).toHaveLength(6);
    expect(game.units).toHaveLength(24);
  });

  it('leaves sequential-mode games untouched and rejects plan actions there', () => {
    const bus = new EventBus();
    const game = createLobby('seq-check', 'default', { maxPlayers: 2, participate: true, playerName: 'A' });
    addLobbyPlayer(game, 'B');
    startGame(game, bus, () => 0);
    expect(game.config.mode).toBe('standard');
    expect(game.plan).toBeNull();
    const infantry = game.units.find(u => u.owner === 'player_a')!;
    const target = { q: infantry.q, r: infantry.r + 1 };
    expect(queueMoveAction(game, 'player_a', infantry.id, target.q, target.r))
      .toMatchObject({ ok: false, code: 'not_simultaneous_game' });
  });
});

describe('simultaneous planning phase', () => {
  it('queues and revokes actions without executing them', () => {
    const { game } = createStandoffGame();
    const a = game.turn.turnOrder[0]!;
    const infantry = unitAt(game, a, 4, 0);
    const queued = queueMoveAction(game, a, infantry.id, 3, 0);
    expect(queued.ok).toBe(true);
    expect(infantry.q).toBe(4);
    expect(game.plan!.queues[a]).toHaveLength(1);
    const revoked = revokePlanAction(game, a, queued.data!.id);
    expect(revoked.ok).toBe(true);
    expect(game.plan!.queues[a]).toHaveLength(0);
    expect(clearPlanActions(game, a).ok).toBe(true);
  });

  it('enforces one action per unit per round', () => {
    const { game } = createStandoffGame();
    const a = game.turn.turnOrder[0]!;
    const infantry = unitAt(game, a, 4, 0);
    expect(queueMoveAction(game, a, infantry.id, 3, 0).ok).toBe(true);
    expect(queueAttackAction(game, a, infantry.id, 4, 1))
      .toMatchObject({ ok: false, code: 'invalid_attack' });
  });

  it('caps the queue at actionsPerTurn and charges nothing on failure', () => {
    const { game } = createStandoffGame();
    const a = game.turn.turnOrder[0]!;
    const units = game.units.filter(u => u.owner === a);
    expect(units).toHaveLength(4);
    // 先把出生单位挪离总部周边，腾出部署位；移动目标各不相同且均为平地。
    place(units[0]!, 1, 0);
    place(units[1]!, -1, 0);
    place(units[2]!, 1, 2);
    place(units[3]!, 2, -2);
    const hq = game.headquarters[a]!;
    // AP=5：4 个单位动作 + 1 次部署。
    expect(queueMoveAction(game, a, units[0]!.id, 2, 0).ok).toBe(true);
    expect(queueMoveAction(game, a, units[1]!.id, 0, 0).ok).toBe(true);
    expect(queueMoveAction(game, a, units[2]!.id, 2, 2).ok).toBe(true);
    expect(queueMoveAction(game, a, units[3]!.id, 3, -2).ok).toBe(true);
    expect(queueDeployAction(game, a, 'infantry', hq.id, 4, 0).ok).toBe(true);
    expect(queueDeployAction(game, a, 'infantry', hq.id, 5, -1))
      .toMatchObject({ ok: false, code: 'action_limit_reached' });
  });

  it('checks deploy supply accounting across the whole queue', () => {
    const { game } = createStandoffGame();
    const a = game.turn.turnOrder[0]!;
    for (const unit of game.units.filter(u => u.owner === a)) place(unit, 1, 3);
    // 让 a 暂时持有 cp_1 (3,0)，用它的六个邻格作为部署位。
    game.controlPoints.find(point => point.id === 'cp_1')!.owner = a;
    // 补给 150，步兵 45：第 4 次部署（累计 180）必须被拒绝。
    expect(queueDeployAction(game, a, 'infantry', 'cp_1', 4, 0).ok).toBe(true);
    expect(queueDeployAction(game, a, 'infantry', 'cp_1', 4, -1).ok).toBe(true);
    expect(queueDeployAction(game, a, 'infantry', 'cp_1', 3, -1).ok).toBe(true);
    expect(queueDeployAction(game, a, 'infantry', 'cp_1', 2, 0))
      .toMatchObject({ ok: false, code: 'insufficient_supplies' });
  });

  it('rejects own-queue destination conflicts at queue time', () => {
    const { game } = createStandoffGame();
    const a = game.turn.turnOrder[0]!;
    const first = unitAt(game, a, 4, 0);
    const second = unitAt(game, a, 4, -1);
    expect(queueMoveAction(game, a, first.id, 3, 0).ok).toBe(true);
    expect(queueMoveAction(game, a, second.id, 3, 0))
      .toMatchObject({ ok: false, code: 'cell_occupied' });
  });

  it('rejects out-of-range attack cells but allows empty in-range cells', () => {
    const { game } = createStandoffGame();
    const a = game.turn.turnOrder[0]!;
    const infantry = unitAt(game, a, 4, 0);
    expect(queueAttackAction(game, a, infantry.id, 6, 0))
      .toMatchObject({ ok: false, code: 'invalid_attack' });
    expect(queueAttackAction(game, a, infantry.id, 4, 1).ok).toBe(true);
  });

  it('blocks queueing after committing and rejects double commits', () => {
    const { game, bus } = createStandoffGame();
    const [a, b] = game.turn.turnOrder as [PlayerId, PlayerId];
    expect(commitAndMaybeResolve(game, bus, a).ok).toBe(true);
    const infantry = unitAt(game, a, 4, 0);
    expect(queueMoveAction(game, a, infantry.id, 3, 0))
      .toMatchObject({ ok: false, code: 'not_your_turn' });
    expect(commitAndMaybeResolve(game, bus, a))
      .toMatchObject({ ok: false, code: 'already_committed' });
    expect(game.phase).toBe('active');
    expect(game.turn.roundNumber).toBe(1);
    // 只有第二个玩家确认后才结算。
    void b;
  });
});

describe('simultaneous resolution', () => {
  it('resolves the round only after every active player committed', () => {
    const { game, bus } = createStandoffGame();
    const [a, b] = game.turn.turnOrder as [PlayerId, PlayerId];
    const first = commitAndMaybeResolve(game, bus, a);
    expect(first.ok).toBe(true);
    expect(first.data!.resolved).toBe(false);
    expect(game.turn.roundNumber).toBe(1);
    const second = commitAndMaybeResolve(game, bus, b);
    expect(second.data!.resolved).toBe(true);
    expect(game.turn.roundNumber).toBe(2);
  });

  it('makes conflicting moves both fail without refunding the action point', () => {
    const { game, bus } = createStandoffGame();
    const [a, b] = game.turn.turnOrder as [PlayerId, PlayerId];
    const unitA = game.units.find(u => u.owner === a)!;
    const unitB = game.units.find(u => u.owner === b)!;
    place(unitA, 1, -1);
    place(unitB, 1, 1);
    expect(queueMoveAction(game, a, unitA.id, 0, 0).ok).toBe(true);
    expect(queueMoveAction(game, b, unitB.id, 0, 0).ok).toBe(true);
    commitAll(game, bus, [a, b]);
    expect(unitA.q === 1 && unitA.r === -1).toBe(true);
    expect(unitB.q === 1 && unitB.r === 1).toBe(true);
    expect(events(game, 'action_failed')).toHaveLength(2);
    expect(events(game, 'action_failed').every(e => e.payload.reason === 'destination_conflict')).toBe(true);
    expect(events(game, 'move')).toHaveLength(0);
    expect(game.players[a]!.stats.actionPointsUsed).toBe(1);
  });

  it('hits a stationary enemy with a cell attack', () => {
    const { game, bus } = createStandoffGame();
    const [a, b] = game.turn.turnOrder as [PlayerId, PlayerId];
    const attacker = game.units.find(u => u.owner === a && u.type === 'infantry')!;
    const target = game.units.find(u => u.owner === b && u.type === 'infantry')!;
    place(attacker, 1, 0);
    place(target, 0, 0);
    const hpBefore = target.hp;
    expect(queueAttackAction(game, a, attacker.id, 0, 0).ok).toBe(true);
    commitAll(game, bus, [a, b]);
    const attacks = events(game, 'attack');
    expect(attacks).toHaveLength(1);
    expect(attacks[0]!.payload.hit).toBe(true);
    expect(attacks[0]!.payload.targetId).toBe(target.id);
    expect(target.hp).toBeLessThan(hpBefore);
  });

  it('misses when the target moves away and hits a unit moving into the attacked cell', () => {
    const { game, bus } = createStandoffGame();
    const [a, b] = game.turn.turnOrder as [PlayerId, PlayerId];
    const attacker = game.units.find(u => u.owner === a && u.type === 'infantry')!;
    const walker = game.units.find(u => u.owner === b && u.type === 'scout')!;
    const sitter = game.units.find(u => u.owner === b && u.type === 'infantry')!;
    place(attacker, 1, 0);
    place(walker, 2, 0);
    place(sitter, -3, -3);
    // 步兵现在是 2 格直线攻击：射线 (1,0)->(2,0)->(3,0)。walker 侧移到 (2,1) 躲开整条射线。
    expect(queueAttackAction(game, a, attacker.id, 2, 0).ok).toBe(true);
    expect(queueMoveAction(game, b, walker.id, 2, 1).ok).toBe(true);
    commitAll(game, bus, [a, b]);
    const attacks = events(game, 'attack');
    expect(attacks).toHaveLength(1);
    expect(attacks[0]!.payload.hit).toBe(false);
    expect(attacks[0]!.payload.actualDamage).toBe(0);

    // 第二回合：攻击 walker 将要移入的格子。
    expect(game.turn.roundNumber).toBe(2);
    expect(queueAttackAction(game, a, attacker.id, 2, 0).ok).toBe(true);
    expect(queueMoveAction(game, b, walker.id, 2, 0).ok).toBe(true);
    commitAll(game, bus, [a, b]);
    const secondAttacks = events(game, 'attack');
    expect(secondAttacks).toHaveLength(2);
    expect(secondAttacks[1]!.payload.hit).toBe(true);
    expect(secondAttacks[1]!.payload.targetId).toBe(walker.id);
    expect(walker.hp).toBeLessThan(walker.maxHp);
  });

  it('lets simultaneous fire kill each other (mutual destruction)', () => {
    const { game, bus } = createStandoffGame();
    const [a, b] = game.turn.turnOrder as [PlayerId, PlayerId];
    const unitA = game.units.find(u => u.owner === a && u.type === 'infantry')!;
    const unitB = game.units.find(u => u.owner === b && u.type === 'infantry')!;
    place(unitA, 0, 0);
    place(unitB, 1, 0);
    unitA.attack = 999;
    unitB.attack = 999;
    expect(queueAttackAction(game, a, unitA.id, 1, 0).ok).toBe(true);
    expect(queueAttackAction(game, b, unitB.id, 0, 0).ok).toBe(true);
    commitAll(game, bus, [a, b]);
    expect(unitA.alive).toBe(false);
    expect(unitB.alive).toBe(false);
    expect(events(game, 'unit_death')).toHaveLength(2);
    expect(game.players[a]!.stats.unitsDestroyed).toBe(1);
    expect(game.players[b]!.stats.unitsDestroyed).toBe(1);
    // 双方总部健在，对局继续。
    expect(game.phase).toBe('active');
  });

  it('fires the shot of an attacker that dies in the same volley', () => {
    const { game, bus } = createStandoffGame();
    const [a, b] = game.turn.turnOrder as [PlayerId, PlayerId];
    const unitA = game.units.find(u => u.owner === a && u.type === 'infantry')!;
    const sniper = game.units.find(u => u.owner === b && u.type === 'ranger') ?? game.units.find(u => u.owner === b && u.type === 'scout')!;
    const victim = game.units.find(u => u.owner === b && u.type === 'infantry')!;
    place(unitA, 0, 0);
    place(victim, 1, 0);
    unitA.attack = 999;
    sniper.attack = 999;
    sniper.attackRange = 3;
    place(sniper, 3, 0);
    // A 攻击 victim 的格；sniper 同时击杀 A —— A 的炮弹仍然落地。
    expect(queueAttackAction(game, a, unitA.id, 1, 0).ok).toBe(true);
    expect(queueAttackAction(game, b, sniper.id, 0, 0).ok).toBe(true);
    commitAll(game, bus, [a, b]);
    expect(unitA.alive).toBe(false);
    expect(victim.alive).toBe(false);
  });

  it('destroys an enemy headquarters via cell attack and ends the game', () => {
    const { game, bus } = createStandoffGame();
    const [a, b] = game.turn.turnOrder as [PlayerId, PlayerId];
    const attacker = game.units.find(u => u.owner === a && u.type === 'infantry')!;
    const hqB = game.headquarters[b]!;
    place(attacker, hqB.q + 1, hqB.r);
    attacker.attack = 999;
    expect(queueAttackAction(game, a, attacker.id, hqB.q, hqB.r).ok).toBe(true);
    commitAll(game, bus, [a, b]);
    expect(events(game, 'headquarters_destroyed')).toHaveLength(1);
    expect(game.players[b]!.status).toBe('eliminated');
    expect(game.phase).toBe('game_over');
    expect(game.winner).toBe(a);
    expect(game.result!.reason).toBe('last_player_standing');
  });

  it('heals and damage settle as simultaneous net HP', () => {
    const { game, bus } = createStandoffGame();
    const [a, b] = game.turn.turnOrder as [PlayerId, PlayerId];
    const attacker = game.units.find(u => u.owner === a && u.type === 'infantry')!;
    const wounded = game.units.find(u => u.owner === b && u.type === 'infantry')!;
    const medic = game.units.find(u => u.owner === b && u.type === 'support');
    // standoff 无起始支援单位：现场把一个步兵改成支援。
    const support = medic ?? (() => { wounded.type = 'support'; wounded.healPower = 22; return wounded; })();
    const target = game.units.find(u => u.owner === b && u.type === 'infantry' && u.id !== support.id)
      ?? game.units.find(u => u.owner === b && u.type === 'scout')!;
    place(attacker, 1, 0);
    place(target, 0, 0);
    place(support, -1, 0);
    support.attackRange = 2;
    target.hp = 10;
    const hpBefore = target.hp;
    // 伤害 19..25，治疗 22..28：净血量必 > 0。
    expect(queueAttackAction(game, a, attacker.id, 0, 0).ok).toBe(true);
    // 区域治疗：点击目标所在格 (0,0)，支援的扇形覆盖该格。
    expect(queueHealAction(game, b, support.id, 0, 0).ok).toBe(true);
    commitAll(game, bus, [a, b]);
    expect(target.alive).toBe(true);
    expect(target.hp).toBeGreaterThan(hpBefore - 6);
    expect(events(game, 'heal')).toHaveLength(1);
    expect(events(game, 'attack')[0]!.payload.hit).toBe(true);
  });

  it('fizzles a heal whose target moved out of range', () => {
    const { game, bus } = createStandoffGame();
    const [a, b] = game.turn.turnOrder as [PlayerId, PlayerId];
    const walker = game.units.find(u => u.owner === b && u.type === 'infantry')!;
    walker.type = 'support';
    walker.healPower = 22;
    const mover = game.units.find(u => u.owner === b && u.type === 'scout')!;
    place(walker, 0, 0);
    place(mover, 1, 0);
    expect(queueHealAction(game, b, walker.id, 1, 0).ok).toBe(true);
    expect(queueMoveAction(game, b, mover.id, 3, 0).ok).toBe(true);
    commitAll(game, bus, [a, b]);
    const failed = events(game, 'action_failed');
    expect(failed.some(e => e.payload.type === 'heal' && e.payload.reason === 'out_of_range')).toBe(true);
    expect(events(game, 'heal')).toHaveLength(0);
  });

  it('demolishes blocker terrain after movement has settled', () => {
    const { game, bus } = createStandoffGame();
    const a = game.turn.turnOrder[0]!;
    const heavy = game.units.find(u => u.owner === a && u.type === 'heavy')!;
    place(heavy, 1, -1);
    // 地图阻挡格 (2,-1) 与 (1,-1) 相邻。
    expect(getTerrain(game, 2, -1)).toBe('blocker');
    expect(queueDemolishAction(game, a, heavy.id, 2, -1).ok).toBe(true);
    commitAll(game, bus, [a, game.turn.turnOrder[1]!]);
    expect(getTerrain(game, 2, -1)).toBe('plain');
    expect(events(game, 'demolish')).toHaveLength(1);
  });

  it('fails both conflicting deploys and refunds supplies', () => {
    const { game, bus } = createStandoffGame();
    const [a, b] = game.turn.turnOrder as [PlayerId, PlayerId];
    // 把两家的总部摆到同一空格 (3,0) 的两侧。
    const hqA = game.headquarters[a]!;
    const hqB = game.headquarters[b]!;
    hqA.q = 4; hqA.r = 0;
    hqB.q = 2; hqB.r = 0;
    for (const unit of game.units.filter(u => u.owner === a)) place(unit, -1, 3);
    for (const unit of game.units.filter(u => u.owner === b)) place(unit, -1, -3);
    const suppliesA = game.resources[a]!.supplies;
    const suppliesB = game.resources[b]!.supplies;
    expect(queueDeployAction(game, a, 'infantry', hqA.id, 3, 0).ok).toBe(true);
    expect(queueDeployAction(game, b, 'infantry', hqB.id, 3, 0).ok).toBe(true);
    commitAll(game, bus, [a, b]);
    const deploys = events(game, 'deploy');
    expect(deploys).toHaveLength(0);
    expect(events(game, 'action_failed').filter(e => e.payload.type === 'deploy')).toHaveLength(2);
    // 部署失败全额退还；回合边界仍发放收入（基础 15）。
    expect(game.resources[a]!.supplies).toBe(suppliesA + 15);
    expect(game.resources[b]!.supplies).toBe(suppliesB + 15);
    expect(game.units).toHaveLength(8);
  });

  it('captures control points after resolution and grants merit', () => {
    const { game, bus } = createStandoffGame();
    const [a, b] = game.turn.turnOrder as [PlayerId, PlayerId];
    const infantry = game.units.find(u => u.owner === a && u.type === 'infantry')!;
    place(infantry, 4, 0);
    expect(queueMoveAction(game, a, infantry.id, 3, 0).ok).toBe(true);
    commitAll(game, bus, [a, b]);
    const cp = game.controlPoints.find(point => point.q === 3 && point.r === 0)!;
    expect(cp.owner).toBe(a);
    expect(events(game, 'control_point_captured')).toHaveLength(1);
    expect(game.players[a]!.stats.actionMerit).toBeGreaterThanOrEqual(2);
  });

  it('advances the round boundary: reset flags, symmetric income, fresh plan', () => {
    const { game, bus } = createStandoffGame();
    const [a, b] = game.turn.turnOrder as [PlayerId, PlayerId];
    const startSupplies = game.resources[a]!.supplies;
    const unitA = game.units.find(u => u.owner === a && u.type === 'infantry')!;
    place(unitA, 4, 0);
    expect(queueMoveAction(game, a, unitA.id, 3, 0).ok).toBe(true);
    commitAll(game, bus, [a, b]);
    expect(game.turn.roundNumber).toBe(2);
    expect(unitA.hasMoved).toBe(false);
    expect(unitA.hasActed).toBe(false);
    expect(game.plan).toEqual({ queues: {}, committed: [] });
    // a 占领了 cp_1：收入 = 基础 15 + 控制点 10；b 只有基础收入。
    expect(game.resources[a]!.supplies).toBe(startSupplies + 25);
    expect(game.resources[b]!.supplies).toBe(startSupplies + 15);
    expect(events(game, 'round_end')).toHaveLength(1);
    expect(events(game, 'round_start')).toHaveLength(1);
    expect(events(game, 'round_resolved')).toHaveLength(1);
    const resolved = events(game, 'round_resolved')[0]!;
    const results = resolved.payload.results as Record<string, unknown[]>;
    expect(results[a]).toHaveLength(1);
    expect(results[b]).toHaveLength(0);
  });

  it('has no income during round 1 planning', () => {
    const { game } = createStandoffGame();
    expect(events(game, 'income')).toHaveLength(0);
    const [a] = game.turn.turnOrder as [PlayerId, PlayerId];
    expect(game.resources[a]!.supplies).toBe(150);
  });

  it('adjudicates at the turn limit after the final resolution', () => {
    const { game, bus } = createStandoffGame();
    game.config.balance.maxTurns = 1;
    const [a, b] = game.turn.turnOrder as [PlayerId, PlayerId];
    commitAll(game, bus, [a, b]);
    expect(game.phase).toBe('game_over');
    expect(['turn_limit_score', 'turn_limit_draw']).toContain(game.result!.reason);
    // 地图配置在所有对局间共享引用，测试结束必须还原。
    game.config.balance.maxTurns = 18;
  });

  it('force-resolves with only partially committed players', () => {
    const { game, bus } = createStandoffGame();
    const [a, b] = game.turn.turnOrder as [PlayerId, PlayerId];
    const unitB = game.units.find(u => u.owner === b && u.type === 'infantry')!;
    place(unitB, -4, -1);
    expect(queueMoveAction(game, b, unitB.id, -3, 0).ok).toBe(true);
    expect(commitAndMaybeResolve(game, bus, b).ok).toBe(true);
    expect(game.turn.roundNumber).toBe(1);
    const forced = forceResolveRound(game, bus);
    expect(forced.ok).toBe(true);
    expect(game.turn.roundNumber).toBe(2);
    expect(unitB.q).toBe(-3);
    expect(events(game, 'move')).toHaveLength(1);
    // 未确认的玩家 A 以空队列参与。
    expect(events(game, 'plan_committed')).toHaveLength(1);
  });

  it('auto-resolves after a planning-phase elimination unblocks the rest', () => {
    const { game, bus } = createStandoffGame(3);
    const order = game.turn.turnOrder as [PlayerId, PlayerId, PlayerId];
    const [a, b, c] = order;
    expect(commitAndMaybeResolve(game, bus, b).ok).toBe(true);
    expect(commitAndMaybeResolve(game, bus, c).ok).toBe(true);
    expect(game.turn.roundNumber).toBe(1);
    // 房主淘汰未确认的 a：剩余两家都已确认 → 立即结算。
    expect(eliminatePlayer(game, bus, a, 'host_eliminated', null).ok).toBe(true);
    eliminateFromPlanAndMaybeResolve(game, bus, a);
    expect(game.players[a]!.status).toBe('eliminated');
    expect(game.turn.roundNumber).toBe(2);
    expect(events(game, 'round_resolved')).toHaveLength(1);
    expect(game.plan!.committed).toEqual([]);
  });

  it('resolves an empty round without actions', () => {
    const { game, bus } = createStandoffGame();
    const [a, b] = game.turn.turnOrder as [PlayerId, PlayerId];
    commitAll(game, bus, [a, b]);
    expect(game.turn.roundNumber).toBe(2);
    expect(game.phase).toBe('active');
    expect(game.units).toHaveLength(8);
  });
});

describe('simultaneous resolution internals', () => {
  it('drops the queue of an uncommitted player eliminated during planning', () => {
    const { game, bus } = createStandoffGame(3);
    const order = game.turn.turnOrder as [PlayerId, PlayerId, PlayerId];
    const [a, b, c] = order;
    const unitC = game.units.find(u => u.owner === c && u.type === 'infantry')!;
    expect(queueMoveAction(game, c, unitC.id, unitC.q, unitC.r + 1).ok).toBe(true);
    expect(commitAndMaybeResolve(game, bus, a).ok).toBe(true);
    expect(commitAndMaybeResolve(game, bus, b).ok).toBe(true);
    // c 未确认即被淘汰：其队列被丢弃，已确认的 a/b 立即结算。
    expect(eliminatePlayer(game, bus, c, 'host_eliminated', null).ok).toBe(true);
    eliminateFromPlanAndMaybeResolve(game, bus, c);
    expect(game.turn.roundNumber).toBe(2);
    // c 的单位已随淘汰移除，其排队的动作不可能执行。
    expect(game.units.some(u => u.owner === c)).toBe(false);
    expect(events(game, 'move')).toHaveLength(0);
  });
});

describe('unit shape overhaul (line / arc / lock / area heal)', () => {
  it('infantry line attack hits both enemies along the ray', () => {
    const { game, bus } = createStandoffGame();
    const [a, b] = game.turn.turnOrder as [PlayerId, PlayerId];
    const attacker = game.units.find(u => u.owner === a && u.type === 'infantry')!;
    const front = game.units.find(u => u.owner === b && u.type === 'infantry')!;
    const back = game.units.find(u => u.owner === b && u.type === 'scout')!;
    place(attacker, 1, 0);
    place(front, 2, 0);
    place(back, 3, 0);
    attacker.attack = 999;
    expect(queueAttackAction(game, a, attacker.id, 2, 0).ok).toBe(true);
    commitAll(game, bus, [a, b]);
    expect(front.alive).toBe(false);
    expect(back.alive).toBe(false);
    const attacks = events(game, 'attack');
    expect(attacks).toHaveLength(2);
    expect(attacks.every(e => e.payload.hit === true && e.payload.shape === 'line')).toBe(true);
    expect(game.players[a]!.stats.unitsDestroyed).toBe(2);
  });

  it('rejects line aims that are off-ray or beyond the shape length', () => {
    const { game } = createStandoffGame();
    const a = game.turn.turnOrder[0]!;
    const attacker = game.units.find(u => u.owner === a && u.type === 'infantry')!;
    place(attacker, 1, 0);
    // (2,1) 不在任何正六方向射线上；(4,0) 在射线上但距离 3 > 线长 2。
    expect(queueAttackAction(game, a, attacker.id, 2, 1))
      .toMatchObject({ ok: false, code: 'invalid_attack' });
    expect(queueAttackAction(game, a, attacker.id, 4, 0))
      .toMatchObject({ ok: false, code: 'invalid_attack' });
    expect(queueAttackAction(game, a, attacker.id, 3, 0).ok).toBe(true);
  });

  it('heavy arc attack sweeps the three adjacent cells around the aim direction', () => {
    const { game, bus } = createStandoffGame();
    const [a, b] = game.turn.turnOrder as [PlayerId, PlayerId];
    const heavy = game.units.find(u => u.owner === a && u.type === 'heavy')!;
    const enemies = game.units.filter(u => u.owner === b).slice(0, 3);
    place(heavy, 0, 0);
    // 朝 (1,0) 方向的扇形 = (0,1) (1,0) (1,-1)。
    place(enemies[0]!, 0, 1);
    place(enemies[1]!, 1, 0);
    place(enemies[2]!, 1, -1);
    heavy.attack = 999;
    expect(queueAttackAction(game, a, heavy.id, 1, 0).ok).toBe(true);
    commitAll(game, bus, [a, b]);
    expect(enemies.every(u => !u.alive)).toBe(true);
    const attacks = events(game, 'attack');
    expect(attacks).toHaveLength(3);
    expect(attacks.every(e => e.payload.hit === true && e.payload.shape === 'arc')).toBe(true);
  });

  it('ranger lock hits a target that moves within range, wherever it goes', () => {
    const { game, bus } = createStandoffGame();
    const [a, b] = game.turn.turnOrder as [PlayerId, PlayerId];
    // 现场把一个步兵改造成游侠（锁定能力来自配置 spec.attackLock）。
    const ranger = game.units.find(u => u.owner === a && u.type === 'infantry')!;
    ranger.type = 'ranger';
    ranger.attack = 999;
    ranger.attackRange = 3;
    const runner = game.units.find(u => u.owner === b && u.type === 'scout')!;
    place(ranger, 0, 0);
    place(runner, 1, 0);
    // 计划时敌人在 (1,0) → 锁定；runner 移到 (2,0) 仍在射程内 → 无论跑到哪都命中。
    expect(queueAttackAction(game, a, ranger.id, 1, 0).ok).toBe(true);
    expect(queueMoveAction(game, b, runner.id, 2, 0).ok).toBe(true);
    commitAll(game, bus, [a, b]);
    const attacks = events(game, 'attack');
    expect(attacks).toHaveLength(1);
    expect(attacks[0]!.payload.hit).toBe(true);
    expect(attacks[0]!.payload.locked).toBe(true);
    expect(attacks[0]!.payload.targetId).toBe(runner.id);
    expect(runner.alive).toBe(false);
  });

  it('ranger lock misses only when the target escapes the range bubble', () => {
    const { game, bus } = createStandoffGame();
    const [a, b] = game.turn.turnOrder as [PlayerId, PlayerId];
    const ranger = game.units.find(u => u.owner === a && u.type === 'infantry')!;
    ranger.type = 'ranger';
    ranger.attack = 999;
    ranger.attackRange = 3;
    const runner = game.units.find(u => u.owner === b && u.type === 'scout')!;
    place(ranger, 0, 0);
    place(runner, 3, 0);
    // 锁定射程边缘的目标；runner 全速逃离到距离 4 的 (3,-4) → 锁定失效。
    expect(queueAttackAction(game, a, ranger.id, 3, 0).ok).toBe(true);
    expect(queueMoveAction(game, b, runner.id, 3, -4).ok).toBe(true);
    commitAll(game, bus, [a, b]);
    const attacks = events(game, 'attack');
    expect(attacks).toHaveLength(1);
    expect(attacks[0]!.payload.hit).toBe(false);
    expect(attacks[0]!.payload.locked).toBe(true);
    expect(runner.alive).toBe(true);
    const resolved = events(game, 'round_resolved')[0]!;
    const results = resolved.payload.results as Record<string, { status: string; reason?: string }[]>;
    expect(results[a]![0]!.status).toBe('missed');
    expect(results[a]![0]!.reason).toBe('target_escaped');
  });

  it('area heal restores every wounded friendly in the covered cells', () => {
    const { game, bus } = createStandoffGame();
    const [a, b] = game.turn.turnOrder as [PlayerId, PlayerId];
    const medic = game.units.find(u => u.owner === b && u.type === 'infantry')!;
    medic.type = 'support';
    medic.healPower = 22;
    const wounded1 = game.units.find(u => u.owner === b && u.type === 'infantry')!;
    const wounded2 = game.units.find(u => u.owner === b && u.type === 'scout')!;
    place(medic, 0, 0);
    // 扇形朝 (1,0)：覆盖 (0,1) (1,0) (1,-1)。
    place(wounded1, 0, 1);
    place(wounded2, 1, -1);
    wounded1.hp = 10;
    wounded2.hp = 10;
    expect(queueHealAction(game, b, medic.id, 1, 0).ok).toBe(true);
    commitAll(game, bus, [a, b]);
    expect(wounded1.hp).toBeGreaterThan(10);
    expect(wounded2.hp).toBeGreaterThan(10);
    const heals = events(game, 'heal');
    expect(heals).toHaveLength(2);
  });

  it('rejects heal aims that do not match the configured shape', () => {
    const { game } = createStandoffGame();
    const b = game.turn.turnOrder[1]!;
    const medic = game.units.find(u => u.owner === b && u.type === 'infantry')!;
    medic.type = 'support';
    medic.healPower = 22;
    const friend = game.units.find(u => u.owner === b && u.type === 'infantry')!;
    place(medic, 0, 0);
    place(friend, 2, 0);
    // 扇形要求点击相邻格：(2,0) 距离 2 不可瞄准。
    expect(queueHealAction(game, b, medic.id, 2, 0))
      .toMatchObject({ ok: false, code: 'invalid_heal' });
    // 覆盖格内没有友军也不行。
    expect(queueHealAction(game, b, medic.id, 0, -1))
      .toMatchObject({ ok: false, code: 'invalid_heal' });
  });
});
