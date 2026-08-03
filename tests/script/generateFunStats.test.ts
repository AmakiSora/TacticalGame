import { describe, expect, it } from 'vitest';
import {
  MAX_DURATION_SEC,
  buildEconomy,
  buildEliminations,
  buildExtremes,
  buildMapStage,
  buildModelDebut,
  buildModelProfiles,
  buildMonthlyTrend,
  buildOverview,
  buildTimeline,
  durationSec,
} from '../../script/generateFunStats.mjs';

function eventStats(overrides: Record<string, unknown> = {}) {
  return {
    moves: 0,
    attacks: 0,
    deploys: 0,
    heals: 0,
    demolishes: 0,
    captures: 0,
    unitDeaths: 0,
    rounds: 0,
    ...overrides,
  };
}

function participant(model: string, events: Record<string, unknown>) {
  return {
    playerId: `player-${model}`,
    displayName: model,
    model,
    rank: 1,
    isWinner: true,
    events: eventStats(events),
  };
}

function match(recordId: string, duration: number, participants: unknown[] = []) {
  return {
    recordId,
    date: '20260730',
    mapId: 'default',
    playerCount: participants.length,
    completed: true,
    eventCount: 1,
    eventStats: eventStats({ rounds: 1 }),
    participants,
    timestamps: { start: 1_000, end: 1_000 + duration * 1_000 },
  };
}

describe('entertainment stats rules', () => {
  it('only assigns style tags for rates above the participation mean', () => {
    const profiles = buildModelProfiles([
      match('tg_low', 10, [participant('low', { attacks: 1, moves: 1 })]),
      match('tg_high', 10, [participant('high', { attacks: 9, moves: 9 })]),
    ]);

    expect(profiles.find(p => p.model === 'low')?.styleTags).toEqual([]);
    expect(profiles.find(p => p.model === 'high')?.styleTags).toEqual(['攻击型', '机动型']);
  });

  it('uses the same duration validity rule for averages and extremes', () => {
    const valid = match('tg_valid', 10);
    const invalid = match('tg_invalid', MAX_DURATION_SEC + 1);

    expect(durationSec(valid)).toBe(10);
    expect(durationSec(invalid)).toBeNull();
    expect(durationSec({ timestamps: { start: null, end: null } })).toBeNull();
    expect(buildOverview([valid, invalid])).toMatchObject({
      avgDurationSec: 10,
      totalDurationSec: 10,
    });
    expect(buildExtremes([valid, invalid]).longestDuration).toMatchObject({
      recordId: 'tg_valid',
      durationSec: 10,
    });
  });

  it('tallies economy per model and sorts by deploy spend', () => {
    const economy = buildEconomy([
      match('tg_a', 10, [participant('A', { deployCost: 100, income: 200 }), participant('B', { deployCost: 50, income: 100 })]),
    ]);
    expect(economy[0]).toMatchObject({ model: 'A', deployCost: 100, income: 200, spendRate: 0.5 });
    expect(economy[1]).toMatchObject({ model: 'B', deployCost: 50, spendRate: 0.5 });
  });

  it('builds elimination board and mutual rivalries from player_eliminated payloads', () => {
    const mk = (recordId, players, eliminations) => ({
      ...match(recordId, 10, players),
      eliminations,
    });
    const players = [
      { playerId: 'player_a', model: 'A' },
      { playerId: 'player_b', model: 'B' },
    ];
    const eliminations = buildEliminations([
      mk('tg_x', players, [
        { playerId: 'player_a', eliminatedBy: 'player_b' },
        { playerId: 'player_b', eliminatedBy: 'player_a' },
      ]),
      mk('tg_y', players, [{ playerId: 'player_b', eliminatedBy: 'player_a' }]),
    ]);
    expect(eliminations.killerBoard).toContainEqual({ model: 'A', kills: 2, deaths: 1, net: 1 });
    expect(eliminations.killerBoard).toContainEqual({ model: 'B', kills: 1, deaths: 2, net: -1 });
    expect(eliminations.rivalries).toEqual([
      { a: 'A', b: 'B', aKillsB: 2, bKillsA: 1, total: 3 },
    ]);
  });

  it('only averages map rounds over matches that carry round records', () => {
    const noRounds = match('tg_v2', 10);
    noRounds.eventStats = eventStats({ rounds: 0, captures: 2 });
    const withRounds = match('tg_v3', 10);
    withRounds.mapId = 'default';
    withRounds.eventStats = eventStats({ rounds: 12, captures: 6 });

    const stage = buildMapStage([noRounds, withRounds, withRounds]);
    const defaultMap = stage.find((s) => s.mapId === 'default');
    expect(defaultMap).toMatchObject({ games: 3, avgRounds: 12, roundsSampled: 2, capturesPerGame: 4.67 });
    expect(stage[0].mapId).toBe('default');
  });

  it('reports the busiest match by actions per round and the biggest spender', () => {
    const busy = match('tg_busy', 10);
    busy.eventStats = eventStats({ rounds: 2, moves: 10, attacks: 6, deploys: 2 });
    const calm = match('tg_calm', 10);
    calm.eventStats = eventStats({ rounds: 2, moves: 1, attacks: 1 });

    const extremes = buildExtremes([busy, calm, match('tg_norounds', 10)]);
    expect(extremes.mostActionsPerRound).toMatchObject({ recordId: 'tg_busy', value: 9 });

    const spender = buildExtremes([
      match('tg_spend', 10, [participant('Rich', { deployCost: 300, income: 300 })]),
      match('tg_cheap', 10, [participant('Poor', { deployCost: 5, income: 300 })]),
    ]);
    expect(spender.biggestSpender).toMatchObject({ recordId: 'tg_spend', value: 300, model: 'Rich' });
  });

  it('builds a day-wise timeline with cumulative totals', () => {
    const first = match('tg_a', 10);
    first.date = '20260701';
    first.eventStats = eventStats({ moves: 5, attacks: 3 });
    const later = match('tg_b', 10);
    later.date = '20260702';
    later.eventStats = eventStats({ moves: 1, attacks: 1, deploys: 2 });

    const timeline = buildTimeline([later, first]);
    expect(timeline).toHaveLength(2);
    expect(timeline[0]).toMatchObject({ date: '2026-07-01', matches: 1, totalActions: 8, cumulativeMatches: 1, cumulativeActions: 8 });
    expect(timeline[1]).toMatchObject({ matches: 1, totalActions: 4, cumulativeMatches: 2, cumulativeActions: 12 });
  });

  it('groups matches by calendar month and counts the active model pool', () => {
    const june = match('tg_j1', 10, [participant('A', {}), participant('B', {})]);
    june.date = '20260630';
    const july = match('tg_j2', 10, [participant('A', {}), participant('C', {})]);
    july.date = '20260701';

    const monthly = buildMonthlyTrend([june, july]);
    expect(monthly.map((m) => m.month)).toEqual(['2026.06', '2026.07']);
    expect(monthly[0]).toMatchObject({ matches: 1, activeModels: 2 });
    expect(monthly[1]).toMatchObject({ matches: 1, activeModels: 2 });
  });

  it('records debut/latest windows and sorted by debut date', () => {
    const players = [
      { playerId: 'player_a', model: 'Old' },
      { playerId: 'player_b', model: 'New' },
    ];
    const early = match('tg_old', 10, players);
    early.date = '20260601';
    const late = match('tg_new', 10, [players[0]]);
    late.date = '20260715';

    const debut = buildModelDebut([late, early]);
    expect(debut[0]).toMatchObject({ model: 'New', debutDate: '2026-06-01', latestDate: '2026-06-01', games: 1 });
    expect(debut[1]).toMatchObject({ model: 'Old', debutDate: '2026-06-01', latestDate: '2026-07-15', games: 2 });
  });
});
