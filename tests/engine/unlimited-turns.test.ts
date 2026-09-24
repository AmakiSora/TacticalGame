// tests/engine/unlimited-turns.test.ts
// 无回合上限地图（balance.maxTurns === null）：回合边界永不裁定，终局只剩淘汰与房主强制裁决。
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/events/bus.js';
import {
  adjudicateAtTurnLimit, buildAdjudicationSnapshot, endTurn, forceAdjudication, joinGame,
} from '../../src/engine/engine.js';
import { createInitialGame } from '../../src/state/store.js';
import type { GameState } from '../../src/types.js';

function setup(id: string): { game: GameState; bus: EventBus } {
  const game = createInitialGame(id, 'marathon');
  const bus = new EventBus();
  joinGame(game, bus, 'B');
  return { game, bus };
}

/** 把回合推到旧上限之外，并停在「本整轮只剩 player_b 未出手」的边界上。 */
function atRound99(game: GameState): void {
  game.turn.roundNumber = 99;
  game.turn.turnNumber = 99;
  game.turn.currentOwner = 'player_b';
  game.turn.currentPlayerId = 'player_b';
  game.turn.actedThisRound = ['player_a'];
}

function finishRound(game: GameState, bus: EventBus): void {
  const turns = game.turn.turnOrder.filter(id => game.players[id]?.status === 'active').length;
  for (let i = 0; i < turns; i++) {
    expect(endTurn(game, bus, game.turn.currentPlayerId!).ok).toBe(true);
  }
}

describe('unlimited rounds (maxTurns: null)', () => {
  it('advances the round past the old cap without adjudicating', () => {
    const { game, bus } = setup('unlimited-past-cap');
    atRound99(game);

    expect(endTurn(game, bus, 'player_b').ok).toBe(true);

    expect(game.phase).toBe('active');
    expect(game.result).toBeNull();
    expect(game.winner).toBeNull();
    expect(game.turn.roundNumber).toBe(100);
    expect(game.events.some(event => event.type === 'game_over')).toBe(false);
    expect(adjudicateAtTurnLimit(game, bus)).toBe(false);
  });

  it('publishes null maxTurns on the live adjudication snapshot', () => {
    const { game } = setup('unlimited-snapshot');

    expect(buildAdjudicationSnapshot(game).maxTurns).toBeNull();
  });

  it('still lets the host end the match by forced adjudication', () => {
    const { game, bus } = setup('unlimited-forced');
    atRound99(game);
    finishRound(game, bus);

    expect(forceAdjudication(game, bus)).toMatchObject({ ok: true });

    expect(game.phase).toBe('game_over');
    expect(['forced_adjudication_score', 'forced_adjudication_draw']).toContain(game.result!.reason);
    expect(game.events.at(-1)).toMatchObject({
      type: 'game_over',
      payload: expect.objectContaining({ reason: game.result!.reason }),
    });
  });

  it('keeps granting comeback supplies on late rounds instead of ending first', () => {
    const { game, bus } = setup('unlimited-comeback');
    // 隔离全局地图缓存中的配置，避免污染其他用同一地图的对局。
    game.config = structuredClone(game.config);
    game.config.balance.comebackSupply = { startRound: 99, scoreGapPercent: 40, amountPerRound: 20 };
    game.resources.player_a.supplies = 0;
    game.resources.player_b.supplies = 5000;
    atRound99(game);
    game.turn.actedThisRound = [];
    game.turn.currentOwner = 'player_a';
    game.turn.currentPlayerId = 'player_a';

    finishRound(game, bus);

    expect(game.phase).toBe('active');
    expect(game.turn.roundNumber).toBe(100);
    expect(game.events.some(event => event.type === 'comeback_supply')).toBe(true);
  });
});
