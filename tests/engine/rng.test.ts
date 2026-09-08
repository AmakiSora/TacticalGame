import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/events/bus.js';
import { attackTarget } from '../../src/engine/combat.js';
import { startGame } from '../../src/engine/engine.js';
import { nextGameRandom, seedGameRandom } from '../../src/engine/random.js';
import { sanitizeGameForResponse } from '../../src/api/auth.js';
import { addLobbyPlayer, createInitialGame, createLobby } from '../../src/state/store.js';
import type { GameState } from '../../src/types.js';

// 与 engine/random.ts 同款 mulberry32，仅用于给 startGame 注入可复现的种子。
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function startedGame(id: string, seed: number): { game: GameState; bus: EventBus } {
  const bus = new EventBus();
  const game = createLobby(id, 'default', { maxPlayers: 2, participate: true, playerName: 'A' });
  expect(addLobbyPlayer(game, 'B')).not.toBeNull();
  expect(startGame(game, bus, seededRandom(seed)).ok).toBe(true);
  return { game, bus };
}

// 当前行动方找一个单位贴脸攻击一个敌方单位，返回 attack 事件的数值载荷。
// 每次调用前把相关状态复位，让连续多次攻击从相同局面出发、只推进掷骰序列。
function attackOnce(game: GameState, bus: EventBus): { damage: number; actualDamage: number; targetHp: number } {
  const owner = game.turn.currentPlayerId!;
  const attacker = game.units.find(u => u.owner === owner && u.alive)!;
  const target = game.units.find(u => u.owner !== owner && u.alive)!;
  attacker.q = 0; attacker.r = 0;
  attacker.hasActed = false; attacker.actionSpent = false;
  target.q = 1; target.r = 0; target.hp = target.maxHp;
  game.turn.actionsUsed = 0;
  expect(attackTarget(game, bus, owner, attacker.id, target.id).ok).toBe(true);
  const event = game.events.filter(e => e.type === 'attack').at(-1)!;
  const { damage, actualDamage, targetHp } = event.payload as { damage: number; actualDamage: number; targetHp: number };
  return { damage, actualDamage, targetHp };
}

describe('injectable game RNG', () => {
  it('produces a deterministic in-range sequence from the default state', () => {
    const a = createInitialGame('rng-seq-a');
    const b = createInitialGame('rng-seq-b');
    const seqA = Array.from({ length: 16 }, () => nextGameRandom(a));
    const seqB = Array.from({ length: 16 }, () => nextGameRandom(b));
    expect(seqA).toEqual(seqB);
    expect(seqA.every(v => v >= 0 && v < 1)).toBe(true);
  });

  it('diverges across seeds', () => {
    const a = createInitialGame('rng-div-a');
    const b = createInitialGame('rng-div-b');
    seedGameRandom(a, seededRandom(1));
    seedGameRandom(b, seededRandom(2));
    const seqA = Array.from({ length: 8 }, () => nextGameRandom(a));
    const seqB = Array.from({ length: 8 }, () => nextGameRandom(b));
    expect(seqA).not.toEqual(seqB);
  });

  it('replays identical attack damage for the same startGame seed', () => {
    const first = startedGame('rng-replay-1', 42);
    const second = startedGame('rng-replay-2', 42);
    // 同种子 → 出生点洗牌与起始玩家一致，掷骰序列同步。
    expect(first.game.turn.turnOrder).toEqual(second.game.turn.turnOrder);
    for (let i = 0; i < 5; i++) {
      expect(attackOnce(first.game, first.bus)).toEqual(attackOnce(second.game, second.bus));
    }
  });

  it('keeps the sequence across JSON persistence round-trips', () => {
    const game = createInitialGame('rng-persist');
    nextGameRandom(game);
    nextGameRandom(game);
    const restored = JSON.parse(JSON.stringify(game)) as GameState;
    expect(nextGameRandom(restored)).toBe(nextGameRandom(game));
  });

  it('hides rngState from client responses', () => {
    const { game } = startedGame('rng-hide', 7);
    expect(game.rngState).toBeTypeOf('number');
    const body = sanitizeGameForResponse(game) as Record<string, unknown>;
    expect('rngState' in body).toBe(false);
  });
});
