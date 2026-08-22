// tests/skill/wait-turn.test.ts
// wait-turn.mjs 的 classifyState 在顺序与同时两种模式下的判定。
import { describe, expect, it } from 'vitest';
import { classifyState, EXIT } from '../../skill/wait-turn.mjs';

function baseGame(overrides = {}) {
  return {
    winner: null,
    phase: 'active',
    config: { mode: 'standard' },
    turn: { roundNumber: 3, currentPlayerId: 'player_b', currentOwner: 'player_b' },
    players: { player_a: { status: 'active' }, player_b: { status: 'active' } },
    ...overrides,
  };
}

function simultaneousGame(overrides = {}) {
  return baseGame({
    config: { mode: 'simultaneous' },
    turn: { roundNumber: 3, currentPlayerId: null, currentOwner: null },
    plan: { committed: [], myQueue: [] },
    ...overrides,
  });
}

describe('wait-turn classifyState', () => {
  it('keeps the sequential contract unchanged', () => {
    expect(classifyState(baseGame(), 'player_b')).toMatchObject({ result: 'my_turn', exit: EXIT.MY_TURN });
    expect(classifyState(baseGame(), 'player_a')).toBeNull();
    expect(classifyState(baseGame({ phase: 'game_over', winner: 'player_a' }), 'player_b'))
      .toMatchObject({ result: 'game_over', exit: EXIT.GAME_OVER });
    expect(classifyState(baseGame({ players: { player_a: { status: 'active' }, player_b: { status: 'eliminated' } } }), 'player_b'))
      .toMatchObject({ result: 'eliminated', exit: EXIT.ELIMINATED });
  });

  it('treats an open planning window as my_turn in simultaneous mode', () => {
    expect(classifyState(simultaneousGame(), 'player_a')).toMatchObject({ result: 'my_turn', round: 3, exit: EXIT.MY_TURN });
    // 已确认 → 继续等待其他人/结算。
    expect(classifyState(simultaneousGame({ plan: { committed: ['player_a'] } }), 'player_a')).toBeNull();
    // 对手确认与否与自己无关。
    expect(classifyState(simultaneousGame({ plan: { committed: ['player_b'] } }), 'player_a'))
      .toMatchObject({ result: 'my_turn', exit: EXIT.MY_TURN });
  });

  it('still reports game over and elimination in simultaneous mode', () => {
    expect(classifyState(simultaneousGame({ phase: 'game_over', winner: 'player_b' }), 'player_a'))
      .toMatchObject({ result: 'game_over', winner: 'player_b', exit: EXIT.GAME_OVER });
    expect(classifyState(
      simultaneousGame({ players: { player_a: { status: 'eliminated' }, player_b: { status: 'active' } } }),
      'player_a',
    )).toMatchObject({ result: 'eliminated', exit: EXIT.ELIMINATED });
  });

  it('handles a missing plan object defensively', () => {
    const game = simultaneousGame();
    delete game.plan;
    expect(classifyState(game, 'player_a')).toMatchObject({ result: 'my_turn', exit: EXIT.MY_TURN });
  });
});
