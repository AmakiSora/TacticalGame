import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AGENT_NAMES,
  aggregate,
  bradleyTerryRatings,
  btElo,
  canonicalizeModel,
  extractMatch,
  isDrawMatch,
  isRankedMatch,
  KNOWN_AGENTS,
  parseDisplayName,
  parseReviewFileName,
  placementScore,
  wilsonLower,
} from '../../script/generateStats.mjs';

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
    schemaVersion: '3.1.4',
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
  it('normalizes an agent suffix repeated in a review model name', () => {
    expect(canonicalizeModel('doubaoseed2.1pro-PI')).toBe('doubaoseed2.1pro');
    expect(parseReviewFileName('tg_0061_rank03_PI@doubaoseed2.1pro-PI.md')).toMatchObject({
      agent: 'PI',
      model: 'doubaoseed2.1pro',
      rank: 3,
    });
  });

  it('merges DeepseekV4Pro into its preview', () => {
    expect(canonicalizeModel('DeepseekV4Pro-OMP')).toBe('DeepseekV4ProPreview');
    expect(canonicalizeModel('DeepseekV4Pro')).toBe('DeepseekV4ProPreview');
    expect(canonicalizeModel('DeepseekV4ProPreview-PI')).toBe('DeepseekV4ProPreview');
    expect(canonicalizeModel('DeepseekV4proPreview')).toBe('DeepseekV4ProPreview');
    expect(parseReviewFileName('tg_0082_lose_OMP@DeepseekV4ProPreview.md')).toMatchObject({
      agent: 'OMP',
      model: 'DeepseekV4ProPreview',
    });
  });

  it('canonicalizes newly added model names and the truncated display name', () => {
    expect(canonicalizeModel('agnes2.5flash-OMP')).toBe('agnes2.5flash');
    expect(canonicalizeModel('gemini3.5flash-PI')).toBe('gemini3.5flash');
    expect(canonicalizeModel('gptoss120b-PI')).toBe('gptoss120b');
    expect(canonicalizeModel('GPT5.6luna-OMP')).toBe('gpt5.6luna');
    expect(canonicalizeModel('SenseNova6.8FLP-OMP')).toBe('sensenova6.8flp');
    expect(canonicalizeModel('Ring2.6-OMP')).toBe('ring2.6');
    expect(canonicalizeModel('DeepseekV4FlashPrevi')).toBe('DeepseekV4FlashPreview');
  });

  it('splits a known CP agent suffix off the model name', () => {
    expect(canonicalizeModel('LongCat2.0-CP')).toBe('longcat2.0');
    expect(parseReviewFileName('tg_0083_lose_CP@longcat2.0.md')).toMatchObject({
      agent: 'CP',
      model: 'longcat2.0',
    });
  });

  it('maps agent shorthand to full names and recognizes newly added agents', () => {
    expect(AGENT_NAMES.get('TC')).toBe('TraeCode');
    expect(AGENT_NAMES.get('TW')).toBe('TraeWork');
    expect(AGENT_NAMES.get('DSH')).toBe('DeepSeek Harness');
    expect(AGENT_NAMES.get('WB')).toBe('WorkBuddy');
    for (const agent of ['TC', 'TW', 'DSH']) expect(KNOWN_AGENTS.has(agent)).toBe(true);

    expect(parseReviewFileName('tg_0155_rank02_TC@Dsv4Pro0813.md')).toMatchObject({
      agent: 'TC',
      model: 'dsv4pro0813',
    });
    expect(parseDisplayName('Qwen3.8MaxPreview-TW')).toMatchObject({
      agent: 'TW',
      model: 'Qwen3.8MaxPreview',
    });
  });

  it('exposes the agent full name on the agent leaderboard', () => {
    const tc = { ...participant('player_a', 'model-a', 1, true), agent: 'TC' };
    const result = aggregate([match({ participants: [tc] })]);

    expect(result.agentLeaderboard.find(row => row.agent === 'TC')).toMatchObject({
      agentName: 'TraeCode',
    });
  });

  it('attributes an ownerless attack to its attacker exactly once', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tg-stats-'));
    const fileName = 'tg_9999_20260730.json';
    const filePath = join(dir, fileName);
    writeFileSync(filePath, JSON.stringify({
      playerNames: { player_a: 'ModelA-PI', player_b: 'ModelB-WB' },
      events: [
        {
          type: 'game_start',
          payload: {
            units: [{ id: 'unit-a', owner: 'player_a' }],
          },
        },
        {
          type: 'attack',
          payload: { attackerId: 'unit-a', targetId: 'unit-b', damage: 10 },
        },
        {
          type: 'game_over',
          payload: { winner: 'player_a', reason: 'headquarters_destroyed' },
        },
      ],
    }), 'utf8');

    try {
      const result = extractMatch(filePath, 'V3', fileName, new Map());
      expect(result?.eventStats.attacks).toBe(1);
      expect(result?.participants.find(p => p.playerId === 'player_a')?.events.attacks).toBe(1);
      expect(result?.participants.find(p => p.playerId === 'player_b')?.events.attacks).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

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

  it('counts a duel draw as half a success without mixing it into multiplayer rating', () => {
    const draw = match({
      reason: 'turn_limit_draw',
      participants: [
        participant('player_a', 'model-a', 1),
        participant('player_b', 'model-b', 1),
      ],
    });

    const row = aggregate([draw]).modelLeaderboard.find(item => item.model === 'model-a');

    expect(row?.duelRating).toBeCloseTo(wilsonLower(0.5, 1), 4);
    expect(row).toMatchObject({
      duelGames: 1,
      duelWins: 0,
      duelLosses: 0,
      duelDraws: 1,
      multiGames: 0,
      multiRating: null,
    });
  });

  it('scores multiplayer placements independently across player counts', () => {
    expect(placementScore(1, 3)).toBe(1);
    expect(placementScore(2, 3)).toBe(0.5);
    expect(placementScore(3, 3)).toBe(0);
    expect(placementScore(2, 4)).toBeCloseTo(2 / 3);
    expect(placementScore(4, 6)).toBe(0.4);

    const multiplayer = match({
      participants: [
        participant('player_a', 'model-a', 1, true),
        participant('player_b', 'model-b', 2),
        participant('player_c', 'model-c', 3),
      ],
      winner: 'player_a',
    });
    const row = aggregate([multiplayer]).modelLeaderboard.find(item => item.model === 'model-b');

    expect(row).toMatchObject({ duelGames: 0, duelRating: null, multiGames: 1, multiPlacement: 0.5 });
    expect(row?.multiRating).toBeCloseTo(wilsonLower(0.5, 1), 4);
  });

  it('orders a transitive duel chain with bradleyTerryRatings anchored around 1', () => {
    const ratings = bradleyTerryRatings([
      { a: 'model-a', b: 'model-b', games: 4, winsA: 4, winsB: 0 },
      { a: 'model-b', b: 'model-c', games: 4, winsA: 4, winsB: 0 },
    ]);

    expect(ratings.get('model-a')!).toBeGreaterThan(ratings.get('model-b')!);
    expect(ratings.get('model-b')!).toBeGreaterThan(ratings.get('model-c')!);
    expect(ratings.get('model-b')!).toBeCloseTo(1, 6);
    expect(ratings.get('model-a')! * ratings.get('model-c')!).toBeCloseTo(1, 6);
    expect(btElo(ratings.get('model-a')!)).toBeGreaterThan(1000);
    expect(btElo(ratings.get('model-c')!)).toBeLessThan(1000);
  });

  it('shrinks a single duel toward the prior mean instead of an extreme rating', () => {
    const ratings = bradleyTerryRatings([
      { a: 'model-a', b: 'model-b', games: 1, winsA: 1, winsB: 0 },
    ]);

    expect(btElo(ratings.get('model-a')!)).toBeCloseTo(1059.0, 1);
    expect(btElo(ratings.get('model-b')!)).toBeCloseTo(941.0, 1);
  });

  it('fits BT duel ratings from aggregate() and sorts the leaderboard by them', () => {
    const duel = (recordId: string, winner: string, loser: string) =>
      match({
        recordId,
        participants: [
          participant('player_a', winner, 1, true),
          participant('player_b', loser, 2),
        ],
      });
    const games = [
      duel('tg_bt1', 'model-a', 'model-b'),
      duel('tg_bt2', 'model-a', 'model-b'),
      duel('tg_bt3', 'model-b', 'model-c'),
    ];

    const board = aggregate(games).modelLeaderboard;

    expect(board.map(row => row.model)).toEqual(['model-a', 'model-b', 'model-c']);
    expect(board[0].duelBtRating).toBeGreaterThan(1000);
    expect(board[2].duelBtRating).toBeLessThan(1000);
    expect(board[0].duelRating).toBeCloseTo(wilsonLower(2, 2), 4);
  });

  it('excludes mirror duels from the BT fit but keeps them in duel totals', () => {
    const mirror = match({
      participants: [
        participant('player_a', 'model-a', 1, true),
        participant('player_b', 'model-a', 2),
      ],
    });

    const row = aggregate([mirror]).modelLeaderboard.find(item => item.model === 'model-a');

    expect(row).toMatchObject({ games: 2, duelGames: 2, duelWins: 1, duelLosses: 1 });
    expect(row?.duelRating).not.toBeNull();
    expect(row?.duelBtRating).toBeNull();
  });

  it('sinks models without cross-model duels below BT-rated ones', () => {
    const duel = (recordId: string, winner: string, loser: string) =>
      match({
        recordId,
        participants: [
          participant('player_a', winner, 1, true),
          participant('player_b', loser, 2),
        ],
      });
    const multiplayer = match({
      recordId: 'tg_mp',
      participants: [
        participant('player_a', 'model-z', 1, true),
        participant('player_b', 'model-y', 2),
        participant('player_c', 'model-x', 3),
      ],
      winner: 'player_a',
    });

    const board = aggregate([
      duel('tg_bt1', 'model-a', 'model-b'),
      duel('tg_bt2', 'model-b', 'model-c'),
      multiplayer,
    ]).modelLeaderboard;

    expect(board.map(row => row.model)).toEqual([
      'model-a',
      'model-b',
      'model-c',
      'model-z',
      'model-y',
      'model-x',
    ]);
  });
});
