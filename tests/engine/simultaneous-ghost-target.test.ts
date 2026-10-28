// tests/engine/simultaneous-ghost-target.test.ts
// #6：同时回合里，被淘汰玩家的单位必须被标记 alive=false 并退出索引；
// 锁定射击拿的是「计划时的快照」，同一回合内先被淘汰的目标不能在后续步骤里再被击杀。
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/events/bus.js';
import { startGame } from '../../src/engine/engine.js';
import { queueAttackAction, queueWaitAction } from '../../src/engine/planning.js';
import { commitAndMaybeResolve } from '../../src/engine/simultaneous.js';
import { addLobbyPlayer, createLobby } from '../../src/state/store.js';
import type { GameState, PlayerId, Unit } from '../../src/types.js';

function createStandoffGame(): { game: GameState; bus: EventBus } {
  const bus = new EventBus();
  const game = createLobby(`standoff-ghost-${Math.random().toString(36).slice(2, 8)}`, 'standoff', {
    maxPlayers: 3,
    participate: true,
    playerName: 'A',
  });
  expect(addLobbyPlayer(game, 'B')).not.toBeNull();
  expect(addLobbyPlayer(game, 'C')).not.toBeNull();
  expect(startGame(game, bus, () => 0).ok).toBe(true);
  return { game, bus };
}

function unitOf(game: GameState, owner: PlayerId, type: Unit['type']): Unit {
  const unit = game.units.find(u => u.owner === owner && u.type === type && u.alive);
  expect(unit, `${owner} 的 ${type}`).toBeTruthy();
  return unit!;
}

function place(unit: Unit, q: number, r: number): void {
  unit.q = q;
  unit.r = r;
}

function commitAll(game: GameState, bus: EventBus, players: PlayerId[]): void {
  for (const player of players) expect(commitAndMaybeResolve(game, bus, player).ok).toBe(true);
}

function unitDeaths(game: GameState) {
  return game.events.filter(event => event.type === 'unit_death');
}

describe('simultaneous: eliminated units cannot be shot by a stale lock', () => {
  it('skips a locked target whose owner was eliminated earlier in the same round', () => {
    const { game, bus } = createStandoffGame();
    // standoff 3 人的开局顺序是 b → c → a；这里固定用 a 进攻、c 被淘汰、b 陪跑。
    const attacker: PlayerId = 'player_a';
    const victim: PlayerId = 'player_c';
    const bystander: PlayerId = 'player_b';

    // C 的总部只剩 1 点血：被 A 的一支游侠一击摧毁 → C 本回合就被淘汰。
    const hqC = game.headquarters[victim]!;
    hqC.hp = 1;
    hqC.defense = 0;
    const aInfantry = game.units.filter(u => u.owner === attacker && u.type === 'infantry');
    expect(aInfantry.length).toBeGreaterThanOrEqual(2);
    const gunnerA = aInfantry[0]!;
    const rangerA = aInfantry[1]!;
    const cInfantry = game.units.filter(u => u.owner === victim && u.type === 'infantry');
    expect(cInfantry.length).toBeGreaterThanOrEqual(2);

    // 总部在 (-5,5)：游侠 3 格单格射击，站在 (-4,3)（距离 2）即可直射总部。
    gunnerA.type = 'ranger';
    gunnerA.attack = 50;
    place(gunnerA, -4, 3);

    // 幽灵目标：C 的另一支步兵，挪到地图中央、离总部很远（不会被同一步误伤）。
    const ghost = cInfantry[1]!;
    place(ghost, 0, 0);

    // A 的第二支部队同样是游侠（attackLock），第 2 步锁定幽灵单位。
    rangerA.type = 'ranger';
    rangerA.attack = 999;
    place(rangerA, 0, 2);

    expect(queueAttackAction(game, attacker, gunnerA.id, hqC.q, hqC.r).ok).toBe(true);
    expect(queueAttackAction(game, attacker, rangerA.id, 0, 0).ok).toBe(true);
    expect(queueWaitAction(game, bystander, unitOf(game, bystander, 'infantry').id).ok).toBe(true);

    commitAll(game, bus, [attacker, victim, bystander]);

    // C 已被淘汰，单位被移除、且不再存于索引里。
    expect(game.players[victim]!.status).toBe('eliminated');
    expect(game.units.some(unit => unit.id === ghost.id)).toBe(false);
    // 关键修复点：被移除的单位必须显式 alive=false，否则快照引用看起来仍「活着」。
    expect(ghost.alive).toBe(false);
    // 幽灵目标不会被补刀：没有它的 unit_death，也不给 A 记击杀。
    expect(unitDeaths(game).filter(event => event.payload.unitId === ghost.id)).toHaveLength(0);
    expect(game.players[attacker]!.stats.unitsDestroyed).toBe(0);
    expect(game.players[attacker]!.stats.killValue).toBe(0);
  });

  it('still lets an attacker fire in the step it dies (sequential-death is not the rule)', () => {
    // 回归：同一步内先死后射——攻击者本步阵亡，它的攻击照样结算。
    const { game, bus } = createStandoffGame();
    const attacker: PlayerId = 'player_a';
    const defender: PlayerId = 'player_b';
    const bystander: PlayerId = 'player_c';

    const targetB = unitOf(game, defender, 'infantry');
    place(targetB, 0, 0);
    targetB.hp = 1;
    targetB.defense = 0;

    const attackerA = game.units.filter(u => u.owner === attacker && u.type === 'infantry')[0]!;
    place(attackerA, 0, 1);
    attackerA.attack = 50;
    attackerA.hp = 1;
    attackerA.defense = 0;

    const killerB = unitOf(game, defender, 'scout');
    place(killerB, 0, 2);
    killerB.attack = 50;

    expect(queueAttackAction(game, attacker, attackerA.id, 0, 0).ok).toBe(true);
    expect(queueAttackAction(game, defender, killerB.id, 0, 1).ok).toBe(true);
    expect(queueWaitAction(game, bystander, unitOf(game, bystander, 'infantry').id).ok).toBe(true);

    commitAll(game, bus, [attacker, defender, bystander]);

    // 双方都在同一步开火：目标死了，攻击者也死了。
    expect(targetB.alive).toBe(false);
    expect(attackerA.alive).toBe(false);
    expect(unitDeaths(game).map(event => event.payload.unitId)).toEqual(
      expect.arrayContaining([targetB.id, attackerA.id]),
    );
  });
});
