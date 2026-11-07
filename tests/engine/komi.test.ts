import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/events/bus.js';
import { endTurn, komiSupplies, startGame } from '../../src/engine/engine.js';
import { getMapConfig } from '../../src/config/loader.js';
import { addLobbyPlayer, createInitialGameWithConfig, createLobbyWithConfig } from '../../src/state/store.js';
import type { GameState } from '../../src/types.js';

// 先手贴目（komi）：顺序局里先手第 1 回合不结算收入，其余每个座位在第一次行动前
// 直接拿到 balance.komi.supplies 点补给（代替该回合收入）。没写 komi 的老图走历史口径：
// 按一次开局收入结算，与 3.9.5 之前完全一致。
function trenchDuel(komi?: { supplies: number } | null): { game: GameState; bus: EventBus } {
  // 地图配置在注册表里是共享对象：克隆一份再改，避免把贴目写回全局配置。
  const config = structuredClone(getMapConfig('trench-run'));
  if (komi === null) delete config.balance.komi;
  else if (komi) config.balance.komi = komi;
  const game = createInitialGameWithConfig('komi-2p', config, 'trench-run');
  const bus = new EventBus();
  return { game, bus };
}

/** 多人顺序局：走真正的大厅流程，先手由确定性的 random 决定。 */
function seqTable(mapId: string, players: number, komi?: { supplies: number } | null): { game: GameState; bus: EventBus } {
  const config = structuredClone(getMapConfig(mapId));
  if (komi === null) delete config.balance.komi;
  else if (komi) config.balance.komi = komi;
  const game = createLobbyWithConfig(`komi-${players}p`, mapId, config, {
    maxPlayers: players,
    participate: true,
    playerName: 'P1',
  });
  for (let seat = 2; seat <= players; seat += 1) {
    expect(addLobbyPlayer(game, `P${seat}`)).not.toBeNull();
  }
  const bus = new EventBus();
  expect(startGame(game, bus, () => 0).ok).toBe(true);
  return { game, bus };
}

function incomeEvents(game: GameState) {
  return game.events.filter(event => event.type === 'income');
}

describe('seq-komi (first-seat compensation in supplies)', () => {
  it('pays the configured flat komi to the second seat before its first action', () => {
    const { game, bus } = trenchDuel();
    expect(komiSupplies(game)).toBe(12);
    const beforeA = game.resources.player_a.supplies;
    const beforeB = game.resources.player_b.supplies;

    expect(endTurn(game, bus, 'player_a').ok).toBe(true);

    const incomes = incomeEvents(game);
    expect(incomes).toHaveLength(1);
    expect(incomes[0]!.payload).toMatchObject({
      owner: 'player_b',
      base: 12,
      control: 0,
      controlPoints: 0,
      amount: 12,
      breakdown: [],
      komi: true,
    });
    // 先手第 1 回合没有收入，后手拿的是固定金币而不是「按据点算出来的那一跳」。
    expect(game.resources.player_a.supplies).toBe(beforeA);
    expect(game.resources.player_b.supplies).toBe(beforeB + 12);
  });

  it('komi=0 leaves both seats without income on their first turn', () => {
    const { game, bus } = trenchDuel({ supplies: 0 });
    expect(komiSupplies(game)).toBe(0);

    expect(endTurn(game, bus, 'player_a').ok).toBe(true);
    expect(incomeEvents(game)).toHaveLength(0);

    // 后手第一回合结束：先手在其第 2 回合拿到第一次收入（正常结算，不再是贴目）。
    expect(endTurn(game, bus, 'player_b').ok).toBe(true);
    const incomes = incomeEvents(game);
    expect(incomes).toHaveLength(1);
    expect(incomes[0]!.payload).toMatchObject({ owner: 'player_a', amount: 12 });
    expect(incomes[0]!.payload.komi).toBeUndefined();
  });

  it('komi is a flat amount, independent of the map economy', () => {
    const { game, bus } = trenchDuel({ supplies: 20 });
    const before = game.resources.player_b.supplies;

    expect(endTurn(game, bus, 'player_a').ok).toBe(true);

    expect(incomeEvents(game)[0]!.payload).toMatchObject({ amount: 20, base: 20, control: 0, komi: true });
    expect(game.resources.player_b.supplies).toBe(before + 20);
  });

  it('falls back to the historical one-tick income when the map has no komi field', () => {
    const { game, bus } = trenchDuel(null);
    expect(komiSupplies(game)).toBeNull();

    expect(endTurn(game, bus, 'player_a').ok).toBe(true);

    const incomes = incomeEvents(game);
    expect(incomes).toHaveLength(1);
    // 旧口径：基础 8 + 出生前哨 4，按据点收入结算。
    expect(incomes[0]!.payload).toMatchObject({ owner: 'player_b', base: 8, control: 4, amount: 12, komi: true });
  });

  it('stops paying after the opening turn', () => {
    const { game, bus } = trenchDuel();
    expect(endTurn(game, bus, 'player_a').ok).toBe(true); // 贴目
    expect(endTurn(game, bus, 'player_b').ok).toBe(true); // 先手第 2 回合
    expect(endTurn(game, bus, 'player_a').ok).toBe(true); // 后手第 2 回合

    const incomes = incomeEvents(game);
    expect(incomes).toHaveLength(3);
    expect(incomes.filter(event => event.payload.komi === true)).toHaveLength(1);
    expect(incomes[2]!.payload).toMatchObject({ owner: 'player_b' });
    expect(incomes[2]!.payload.komi).toBeUndefined();
  });

  it('pays every seat after the first in 3-player sequential games', () => {
    const { game, bus } = seqTable('multiplayer-ring', 3);
    const [first, second, third] = game.turn.turnOrder;
    expect(komiSupplies(game)).toBe(6);

    expect(endTurn(game, bus, first!).ok).toBe(true);
    expect(endTurn(game, bus, second!).ok).toBe(true);

    const incomes = incomeEvents(game);
    expect(incomes).toHaveLength(2);
    expect(incomes.map(event => event.payload.owner)).toEqual([second, third]);
    for (const income of incomes) {
      expect(income.payload).toMatchObject({ komi: true, amount: 6, control: 0 });
    }

    // 第 2 回合起不再标记：第 3 位结束回合后进入先手的第 2 回合。
    expect(endTurn(game, bus, third!).ok).toBe(true);
    const later = incomeEvents(game).slice(2);
    expect(later.length).toBeGreaterThan(0);
    expect(later.every(event => event.payload.komi !== true)).toBe(true);
  });

  it('komi=0 gives a symmetric opening at every table size', () => {
    const { game, bus } = seqTable('multiplayer-ring', 3, { supplies: 0 });
    const [first, second, third] = game.turn.turnOrder;

    expect(endTurn(game, bus, first!).ok).toBe(true);
    expect(endTurn(game, bus, second!).ok).toBe(true);
    expect(endTurn(game, bus, third!).ok).toBe(true);

    // 整个第 1 回合没有任何收入：唯一的收入来自第 2 回合先手的回合开始。
    const incomes = incomeEvents(game);
    expect(incomes).toHaveLength(1);
    expect(incomes[0]!.payload).toMatchObject({ owner: first });
    expect(incomes[0]!.payload.komi).toBeUndefined();
  });
});
