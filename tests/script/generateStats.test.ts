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

  it('canonicalizes the Space Bunny codename to MiniMaxM3.1Flash', () => {
    expect(canonicalizeModel('sp-WB')).toBe('minimaxm3.1flash');
    expect(canonicalizeModel('spacebunny')).toBe('minimaxm3.1flash');
    expect(canonicalizeModel('space-bunny')).toBe('minimaxm3.1flash');
    expect(canonicalizeModel('MiniMaxM3.1Flash-WB')).toBe('minimaxm3.1flash');
    expect(parseReviewFileName('tg_0189_lose_WB@minimaxm3.1flash.md')).toMatchObject({
      agent: 'WB',
      model: 'minimaxm3.1flash',
    });
  });

  it('keeps Hy4 official distinct from Hy4preview', () => {
    expect(canonicalizeModel('hy4')).toBe('Hy4');
    expect(canonicalizeModel('Hy4-WB')).toBe('Hy4');
    expect(parseReviewFileName('tg_0230_win_WB@hy4.md')).toMatchObject({
      agent: 'WB',
      model: 'Hy4',
    });
    expect(canonicalizeModel('hy4preview')).toBe('Hy4preview');
    expect(canonicalizeModel('Hy4Preview-DSH')).toBe('Hy4preview');
    expect(parseReviewFileName('tg_0225_lose_DSH@hy4preview.md')).toMatchObject({
      agent: 'DSH',
      model: 'Hy4preview',
    });
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
    expect(AGENT_NAMES.get('WEB')).toBe('WebAgent');
    expect(AGENT_NAMES.get('TE')).toBe('Trae');
    expect(AGENT_NAMES.get('OC')).toBe('OpenCode');
    for (const agent of ['TC', 'TW', 'DSH', 'TE', 'OC']) expect(KNOWN_AGENTS.has(agent)).toBe(true);

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

describe('fog mode replays', () => {
  function fogScore(overrides: Record<string, unknown> = {}) {
    return {
      headquartersDamage: 0, ownHqHp: 200, controlPoints: 0, controlHold: 0,
      armyValue: 152, supplies: 120, killValue: 0, total: 253.2, ...overrides,
    };
  }

  function writeFogReplay(dir: string, fileName: string, opts: {
    mapId: string;
    names: Record<string, string>;
    seats: string[];
    winner: string | null;
    reason: string;
    rankings: Array<{ playerId: string; rank: number; status: string; score: Record<string, unknown> }>;
    extraEvents?: Array<Record<string, unknown>>;
  }) {
    const { mapId, names, seats, winner, reason, rankings, extraEvents = [] } = opts;
    const scores = Object.fromEntries(seats.map(s => [s, fogScore()]));
    const gameStart = {
      mapId, mode: 'fog',
      map: { id: mapId, grid: 'hex', orientation: 'pointy', radius: 8, terrainCells: [], cells: [] },
      players: Object.fromEntries(seats.map(s => [s, { name: names[s], status: 'active' }])),
      turnOrder: seats,
      controlPoints: [{ id: 'cp_center', q: 0, r: 0, owner: null }],
      headquarters: Object.fromEntries(seats.map(s => [s, { hp: 200, maxHp: 200 }])),
      units: seats.map((s, i) => ({ id: `u-${s}`, owner: s, type: 'scout', q: i, r: 0, hp: 70 })),
      resources: Object.fromEntries(seats.map(s => [s, { supplies: 120 }])),
      artillery: null,
      firstPlayer: seats[0],
      playerNames: names,
      config: {
        mode: 'fog', units: {}, headquartersSpec: { hp: 200 }, balance: {}, annihilation: null,
        fog: { vision: { scout: 4, ranger: 3, infantry: 2, support: 2, heavy: 1 }, revealFromRound: null },
      },
      roundNumber: 0,
    };
    const events = [
      ...seats.map(s => ({ type: 'player_joined', timestamp: 1000, payload: { playerId: s, name: names[s] } })),
      { type: 'game_start', timestamp: 1000, payload: gameStart },
      { type: 'round_start', timestamp: 1001, payload: { roundNumber: 1, players: seats, committed: [] } },
      ...seats.map(s => ({ type: 'plan_committed', timestamp: 1002, payload: { playerId: s, roundNumber: 1, committed: seats } })),
      { type: 'round_resolved', timestamp: 1003, payload: { roundNumber: 1, gameOver: false, results: [], steps: 3 } },
      { type: 'deploy', timestamp: 1004, payload: { unitId: `d-${seats[0]}`, owner: seats[0], unitType: 'scout', q: 1, r: 0, cost: 42 } },
      { type: 'move', timestamp: 1005, payload: { unitId: `u-${seats[0]}`, owner: seats[0], fromQ: 0, fromR: 0, toQ: 1, toR: 0, roundNumber: 1 } },
      { type: 'attack', timestamp: 1006, payload: { owner: seats[0], attackerId: `u-${seats[0]}`, hit: false, aimQ: 3, aimR: 0, shape: 'line', targetId: null, targetKind: null, damage: 0, actualDamage: 0, roundNumber: 1 } },
      { type: 'attack', timestamp: 1007, payload: { owner: seats[0], attackerId: `u-${seats[0]}`, hit: true, targetId: `u-${seats[1]}`, targetKind: 'unit', actualDamage: 16, targetHp: 54, roundNumber: 1 } },
      { type: 'control_point_captured', timestamp: 1008, payload: { pointId: 'cp_center', owner: seats[1], previousOwner: null, q: 0, r: 0, roundNumber: 1 } },
      { type: 'income', timestamp: 1009, payload: { owner: seats[0], amount: 8, roundNumber: 2 } },
      { type: 'round_end', timestamp: 1010, payload: { roundNumber: 1, gameOver: false, controlHoldCounted: true, steps: 3 } },
      ...extraEvents,
      { type: 'game_over', timestamp: 2000, payload: { winner, reason, scores, rankings, roundNumber: 2 } },
    ];
    const filePath = join(dir, fileName);
    writeFileSync(filePath, JSON.stringify({
      format: 'hex-v2-replay', schemaVersion: '4.0.3', gameId: `fog-${mapId}`,
      mapId, playerNames: names, exportedAt: '2026-11-26T00:00:00.000Z',
      eventCount: events.length, finalResult: { winner, reason, scores }, events,
    }), 'utf8');
    return filePath;
  }

  it('parses a fog-harbor duel replay with blind-shot misses and HQ elimination', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tg-fog-stats-'));
    const fileName = 'tg_9001_20261126.json';
    try {
      const filePath = writeFogReplay(dir, fileName, {
        mapId: 'fog-harbor',
        names: { player_a: 'hy4-WB', player_b: 'glm5.3-OMP' },
        seats: ['player_a', 'player_b'],
        winner: 'player_a', reason: 'headquarters_destroyed',
        rankings: [
          { playerId: 'player_a', rank: 1, status: 'active', score: fogScore({ headquartersDamage: 200, total: 453.2 }) },
          { playerId: 'player_b', rank: 2, status: 'eliminated', score: fogScore({ ownHqHp: 0, total: 200 }) },
        ],
        extraEvents: [
          { type: 'unit_death', timestamp: 1500, payload: { unitId: 'u-player_b', owner: 'player_b', type: 'scout', cause: 'attack', roundNumber: 2 } },
          { type: 'headquarters_destroyed', timestamp: 1501, payload: { owner: 'player_b', attackerId: 'u-player_a', roundNumber: 2 } },
          { type: 'player_eliminated', timestamp: 1502, payload: { playerId: 'player_b', reason: 'headquarters_destroyed', eliminatedBy: 'player_a' } },
        ],
      });

      const m = extractMatch(filePath, 'V3', fileName, new Map());
      expect(m).toMatchObject({ mode: 'fog', mapId: 'fog-harbor', completed: true, reason: 'headquarters_destroyed', playerCount: 2 });
      expect(m?.participants.find(p => p.playerId === 'player_a')).toMatchObject({ model: 'Hy4', agent: 'WB', rank: 1, isWinner: true });
      expect(m?.participants.find(p => p.playerId === 'player_b')).toMatchObject({ model: 'glm5.3', agent: 'OMP', rank: 2, isWinner: false });
      expect(m?.participants.find(p => p.playerId === 'player_a')?.score?.total).toBe(453.2);
      expect(m?.eventStats).toMatchObject({ attacks: 2, attackMisses: 1, captures: 1, deploys: 1, unitDeaths: 1, artilleryDamage: 0, artilleryHits: 0 });
      expect(m?.eliminations).toEqual([{ playerId: 'player_b', eliminatedBy: 'player_a', reason: 'headquarters_destroyed' }]);
      expect(m?.hqKills).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('counts fog duels and three-player games in the mode distribution and leaderboard', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tg-fog-stats-'));
    try {
      const harborPath = writeFogReplay(dir, 'tg_9001_20261126.json', {
        mapId: 'fog-harbor',
        names: { player_a: 'hy4-WB', player_b: 'glm5.3-OMP' },
        seats: ['player_a', 'player_b'],
        winner: 'player_a', reason: 'headquarters_destroyed',
        rankings: [
          { playerId: 'player_a', rank: 1, status: 'active', score: fogScore({ total: 453.2 }) },
          { playerId: 'player_b', rank: 2, status: 'eliminated', score: fogScore({ ownHqHp: 0, total: 200 }) },
        ],
      });
      const crossingPath = writeFogReplay(dir, 'tg_9002_20261126.json', {
        mapId: 'fog-crossing',
        names: { player_a: 'hy4-WB', player_b: 'glm5.3-OMP', player_c: 'kimik3-PI' },
        seats: ['player_a', 'player_b', 'player_c'],
        winner: 'player_a', reason: 'turn_limit_score',
        rankings: [
          { playerId: 'player_a', rank: 1, status: 'active', score: fogScore({ controlPoints: 2, controlHold: 1.5, total: 400 }) },
          { playerId: 'player_b', rank: 2, status: 'active', score: fogScore({ total: 300 }) },
          { playerId: 'player_c', rank: 3, status: 'active', score: fogScore({ total: 200 }) },
        ],
      });

      const harbor = extractMatch(harborPath, 'V3', 'tg_9001_20261126.json', new Map());
      const crossing = extractMatch(crossingPath, 'V3', 'tg_9002_20261126.json', new Map());
      const agg = aggregate([harbor!, crossing!]);

      expect(agg.overview.modeDist).toEqual({ fog: 2 });
      expect(agg.overview).toMatchObject({ matchCount: 2, completedCount: 2 });
      expect(agg.modelLeaderboard.find(r => r.model === 'Hy4')).toMatchObject({ games: 2, duelGames: 1, multiGames: 1, wins: 2 });
      expect(agg.modelLeaderboard.find(r => r.model === 'kimik3')).toMatchObject({ games: 1, duelGames: 0, multiGames: 1, multiPlacement: 0 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
