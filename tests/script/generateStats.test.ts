import { describe, expect, it } from 'vitest';
import { aggregate, isDrawMatch, isRankedMatch } from '../../script/generateStats.mjs';

function participant(playerId: string, model: string, rank: number | null, isWinner = false) {
  return {
    playerId,
    model,
    agent: 'OMP',
    rank,
    isWinner,
    score: null,
  };
}

function match(overrides: Record<string, unknown>) {
  return {
    recordId: 'tg_test',
    version: 'V3',
    date: '20260724',
    fileName: 'tg_test_20260724.json',
    gameId: 'game-test',
    mapId: 'default',
    schemaVersion: '3.1.3',
    completed: true,
    eventCount: 0,
    eventStats: { rounds: 0 },
    participants: [],
    winner: null,
    reason: 'turn_limit_score',
    reviewFlags: { deadlock: false, terminated: false },
    ...overrides,
  };
}

describe('stats aggregation', () => {
  it('keeps incomplete matches out of competitive rankings', () => {
    const completed = match({
      participants: [
        participant('player_a', 'model-a', 1, true),
        participant('player_b', 'model-b', 2),
      ],
      winner: 'player_a',
    });
    const incomplete = match({
      recordId: 'tg_incomplete',
      completed: false,
      reason: 'incomplete',
      participants: [
        participant('player_a', 'model-a', null),
        participant('player_b', 'model-c', null),
      ],
    });

    const result = aggregate([completed, incomplete]);

    expect(result.overview).toMatchObject({ matchCount: 2, completedCount: 1, incompleteCount: 1 });
    expect(result.modelLeaderboard.find(row => row.model === 'model-a')).toMatchObject({
      games: 1,
      wins: 1,
      losses: 0,
      draws: 0,
    });
    expect(result.modelLeaderboard.some(row => row.model === 'model-c')).toBe(false);
  });

  it('uses the same draw semantics for model and agent wins', () => {
    const deadlock = match({
      winner: 'player_a',
      reviewFlags: { deadlock: true, terminated: false },
      participants: [
        participant('player_a', 'model-a', 1, true),
        participant('player_b', 'model-b', 2),
      ],
    });

    const result = aggregate([deadlock]);

    expect(isDrawMatch(deadlock)).toBe(true);
    expect(isRankedMatch(deadlock)).toBe(true);
    expect(result.modelLeaderboard.find(row => row.model === 'model-a')).toMatchObject({
      games: 1,
      wins: 0,
      draws: 1,
    });
    expect(result.agentLeaderboard.find(row => row.agent === 'OMP')).toMatchObject({
      games: 2,
      wins: 0,
    });
  });
});
