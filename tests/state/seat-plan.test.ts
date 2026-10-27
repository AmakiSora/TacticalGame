import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addLobbyPlayer, clearSeatPlan, createLobby, GameStore, initializeLobbyGame, isSeatOrderValid,
  removeLobbyPlayer, setSeatPlan,
} from '../../src/state/store.js';
import type { GameState, PlayerId } from '../../src/types.js';

function lobby3(): GameState {
  // multiplayer-ring 支持 2/3 人，layouts['3'] 是 [slot_1, slot_3, slot_5]。
  const game = createLobby('seat-plan', 'multiplayer-ring', { maxPlayers: 3, participate: true, playerName: 'A' });
  addLobbyPlayer(game, 'B');
  addLobbyPlayer(game, 'C');
  return game;
}

/** 返回固定序列的 random，并记录被消费的次数。 */
function countingRandom(seed = 0.42): { random: () => number; calls: () => number } {
  let calls = 0;
  const random = () => {
    calls += 1;
    // 变一点但保持确定性，避免洗牌结果恒等导致断言空转。
    return (seed + calls * 0.37) % 1;
  };
  return { random, calls: () => calls };
}

describe('lobby seat plan', () => {
  it('pairs seats to spawn slots and turn order when the host arranged them', () => {
    const game = lobby3();
    const slots = game.config.layouts['3'];
    expect(slots).toEqual(['slot_1', 'slot_3', 'slot_5']);

    setSeatPlan(game, ['player_c', 'player_a', 'player_b'], 0);
    initializeLobbyGame(game, () => 0.5);

    expect(game.players.player_c!.spawnSlotId).toBe(slots[0]);
    expect(game.players.player_a!.spawnSlotId).toBe(slots[1]);
    expect(game.players.player_b!.spawnSlotId).toBe(slots[2]);
    expect(game.turn.turnOrder).toEqual(['player_c', 'player_a', 'player_b']);
    expect(game.players.player_c!.turnOrder).toBe(0);
    expect(game.turn.currentPlayerId).toBe('player_c');
  });

  it('keeps spawn pairing but rotates the turn order when firstSeat is given', () => {
    const game = lobby3();
    const slots = game.config.layouts['3'];
    setSeatPlan(game, ['player_c', 'player_a', 'player_b'], 2);
    initializeLobbyGame(game, () => 0.5);

    // 出生点仍按座位号配对。
    expect(game.players.player_c!.spawnSlotId).toBe(slots[0]);
    expect(game.players.player_b!.spawnSlotId).toBe(slots[2]);
    // 先手 = 2 号座位（player_b），turnOrder 循环展开。
    expect(game.turn.turnOrder).toEqual(['player_b', 'player_c', 'player_a']);
    expect(game.turn.currentPlayerId).toBe('player_b');
    expect(game.players.player_a!.turnOrder).toBe(2);
  });

  it('normalizes firstSeat to 0 for simultaneous maps so turnOrder equals order', () => {
    // standoff = simultaneous：没有先手，座位序 = 出生点 + 同一步内的结算处理顺序。
    const game = createLobby('seat-plan-sim', 'standoff', { maxPlayers: 2, participate: true, playerName: 'A' });
    addLobbyPlayer(game, 'B');
    const slots = game.config.layouts['2'];
    setSeatPlan(game, ['player_b', 'player_a'], 1);
    initializeLobbyGame(game, () => 0.5);

    expect(game.players.player_b!.spawnSlotId).toBe(slots[0]);
    // 旧存档 / 脏数据里的非 0 firstSeat 也不得旋转结算处理顺序。
    expect(game.turn.turnOrder).toEqual(['player_b', 'player_a']);
    expect(game.players.player_b!.turnOrder).toBe(0);
    expect(game.players.player_a!.turnOrder).toBe(1);
    expect(game.turn.currentPlayerId).toBeNull();
  });

  it('normalizes firstSeat to 0 for royale maps too', () => {
    // snowflake = royale：与 simultaneous 同口径（差别只在歼灭规则）。
    const game = createLobby('seat-plan-royale', 'snowflake', { maxPlayers: 2, participate: true, playerName: 'A' });
    addLobbyPlayer(game, 'B');
    setSeatPlan(game, ['player_a', 'player_b'], 1);
    initializeLobbyGame(game, () => 0.5);

    expect(game.turn.turnOrder).toEqual(['player_a', 'player_b']);
    expect(game.turn.currentPlayerId).toBeNull();
    expect(game.headquarters).toEqual({});
  });

  it('consumes the same number of random() calls with and without a seat plan', () => {    const randomGame = lobby3();
    const randomSource = countingRandom();
    initializeLobbyGame(randomGame, randomSource.random);

    const plannedGame = lobby3();
    setSeatPlan(plannedGame, ['player_b', 'player_c', 'player_a'], 1);
    const plannedSource = countingRandom();
    initializeLobbyGame(plannedGame, plannedSource.random);

    // shuffle 的 n-1 次 + 先手 1 次 + 播种 1 次，两条路径必须一致，
    // 否则同一 seed 的对局会因是否编排座位而在后续掷骰序列上漂移。
    expect(plannedSource.calls()).toBe(randomSource.calls());
    expect(plannedGame.rngState).toBe(randomGame.rngState);
  });

  it('keeps the legacy random path untouched when nothing is arranged', () => {
    const game = lobby3();
    expect(game.seatPlan ?? null).toBeNull();
    const slots = game.config.layouts['3'];
    initializeLobbyGame(game, () => 0);

    // 注入 () => 0 时 shuffle 仍按「i 与 0 交换」得到 [b, c, a]，起点取 floor(0*3)=0；
    // 这就是 3.8.7 的既有随机路径，本需求不许改变它。
    expect(game.turn.turnOrder).toEqual(['player_b', 'player_c', 'player_a']);
    expect(game.players.player_b!.spawnSlotId).toBe(slots[0]);
    expect(game.turn.currentPlayerId).toBe('player_b');
  });

  it('degrades to the random path instead of failing when the plan is stale', () => {
    const game = lobby3();
    setSeatPlan(game, ['player_c', 'player_a', 'player_b'], 0);
    // 模拟脏数据：座位表里多了一个不在场的席位 / 少了一个在场的席位。
    game.seatPlan = { order: ['player_c', 'player_a'] as PlayerId[], firstSeat: 0 };

    expect(() => initializeLobbyGame(game, () => 0)).not.toThrow();
    expect(game.phase).toBe('active');
    expect(game.seatPlan).toBeNull();
    expect(game.turn.turnOrder).toHaveLength(3);
  });

  it('also degrades when firstSeat is out of range', () => {
    const game = lobby3();
    setSeatPlan(game, ['player_c', 'player_a', 'player_b'], 0);
    game.seatPlan = { order: ['player_c', 'player_a', 'player_b'], firstSeat: 3 };
    initializeLobbyGame(game, () => 0);
    expect(game.seatPlan).toBeNull();
    expect(game.turn.turnOrder).toHaveLength(3);
  });

  it('appends late joiners to the end of the arranged seats', () => {
    const game = createLobby('seat-join', 'multiplayer-ring', { maxPlayers: 4, participate: true, playerName: 'A' });
    addLobbyPlayer(game, 'B');
    setSeatPlan(game, ['player_b', 'player_a'], 0);
    const version = game.seatVersion;

    const joined = addLobbyPlayer(game, 'C');
    expect(joined?.id).toBe('player_c');
    expect(game.seatPlan!.order).toEqual(['player_b', 'player_a', 'player_c']);
    expect(game.seatVersion).toBe(version! + 1);
  });

  it('removes kicked players and shifts the remaining seats forward', () => {
    const game = lobby3();
    setSeatPlan(game, ['player_a', 'player_b', 'player_c'], 1);

    removeLobbyPlayer(game, 'player_a');
    expect(game.seatPlan!.order).toEqual(['player_b', 'player_c']);
    // 先手原本是 player_b（座位 2），它前移后仍应是先手。
    expect(game.seatPlan!.firstSeat).toBe(0);

    removeLobbyPlayer(game, 'player_b');
    expect(game.seatPlan!.order).toEqual(['player_c']);
    expect(game.seatPlan!.firstSeat).toBe(0);
  });

  it('clears the plan when the last member leaves', () => {
    const game = lobby3();
    setSeatPlan(game, ['player_a', 'player_b', 'player_c'], 0);
    for (const id of ['player_a', 'player_b', 'player_c'] as PlayerId[]) removeLobbyPlayer(game, id);
    expect(game.seatPlan).toBeNull();
  });

  it('clearSeatPlan returns to the random path and bumps the version', () => {
    const game = lobby3();
    setSeatPlan(game, ['player_c', 'player_a', 'player_b'], 0);
    const version = game.seatVersion!;
    clearSeatPlan(game);
    expect(game.seatPlan).toBeNull();
    expect(game.seatVersion).toBe(version + 1);
  });

  it('validates that a seat order is a permutation of the joined players', () => {
    const joined: PlayerId[] = ['player_a', 'player_b', 'player_c'];
    expect(isSeatOrderValid(['player_c', 'player_a', 'player_b'], joined)).toBe(true);
    // 重复
    expect(isSeatOrderValid(['player_a', 'player_a', 'player_b'], joined)).toBe(false);
    // 缺人
    expect(isSeatOrderValid(['player_a', 'player_b'], joined)).toBe(false);
    // 陌生人
    expect(isSeatOrderValid(['player_a', 'player_b', 'player_d'], joined)).toBe(false);
    // 非数组 / 元素非字符串
    expect(isSeatOrderValid(null, joined)).toBe(false);
    expect(isSeatOrderValid(['player_a', 'player_b', 3], joined)).toBe(false);
  });

  it('loads a 3.8.7 snapshot without the seat fields and still starts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tg-seat-legacy-'));
    const file = join(dir, 'games.json');
    try {
      // 模拟旧存档：完全没有 seatPlan / seatVersion 两个字段。
      const legacy = lobby3();
      legacy.id = 'legacy-seat';
      delete legacy.seatPlan;
      delete legacy.seatVersion;
      writeFileSync(file, JSON.stringify({ schemaVersion: 2, savedAt: new Date().toISOString(), games: [legacy] }));

      const store = new GameStore({ persistenceFile: file });
      store.loadFromDisk();
      const loaded = store.get('legacy-seat')!;
      expect(loaded.seatPlan).toBeNull();
      expect(loaded.seatVersion).toBe(0);

      // 缺省 = 未编排，开局照旧随机，不因新字段失败。
      initializeLobbyGame(loaded, () => 0);
      expect(loaded.phase).toBe('active');
      expect(loaded.turn.turnOrder).toHaveLength(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
