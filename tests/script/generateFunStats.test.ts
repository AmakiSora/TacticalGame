import { describe, expect, it } from 'vitest';
import {
  MAX_DURATION_SEC,
  buildExtremes,
  buildModelProfiles,
  buildOverview,
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
});
