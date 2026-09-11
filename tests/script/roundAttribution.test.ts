import { describe, expect, it } from 'vitest';
import {
  attributeRounds,
  tallyByRound,
  attributionCoverage,
} from '../../script/lib/roundAttribution.mjs';

/** 构造一条最小事件。 */
function ev(type: string, payload: Record<string, unknown> = {}, seq?: number) {
  return { seq, type, payload };
}

describe('attributeRounds', () => {
  it('returns empty array for non-array input', () => {
    expect(attributeRounds(null as unknown as [])).toEqual([]);
    expect(attributeRounds(undefined as unknown as [])).toEqual([]);
  });

  it('attributes events with explicit roundNumber from payload', () => {
    const events = [
      ev('attack', { roundNumber: 3, damage: 10 }),
      ev('move', { roundNumber: 3 }),
    ];
    const result = attributeRounds(events);
    expect(result[0].round).toBe(3);
    expect(result[0].source).toBe('payload');
    expect(result[1].round).toBe(3);
  });

  it('carries round forward for events without roundNumber after an anchor', () => {
    const events = [
      ev('round_end', { roundNumber: 1 }),
      ev('income', {}),           // 无 roundNumber，应归入 R2
      ev('attack', { damage: 5 }), // 无 roundNumber，应归入 R2
    ];
    const result = attributeRounds(events);
    expect(result[0].round).toBe(1);
    expect(result[1].round).toBe(2);
    expect(result[1].source).toBe('carry');
    expect(result[2].round).toBe(2);
  });

  it('increments currentRound after each round_end', () => {
    const events = [
      ev('attack', {}),                    // R1 (无锚点，归 R1)
      ev('round_end', { roundNumber: 1 }), // R1 → 之后 currentRound=2
      ev('attack', {}),                    // R2
      ev('round_end', { roundNumber: 2 }), // R2 → 之后 currentRound=3
      ev('attack', {}),                    // R3
    ];
    const result = attributeRounds(events);
    expect(result.map(r => r.round)).toEqual([1, 1, 2, 2, 3]);
  });

  it('does not let round_resolved pull currentRound backward', () => {
    // simultaneous 模式：round_end(R1) → round_resolved(R1) → income(无 roundNumber)
    const events = [
      ev('round_end', { roundNumber: 1 }),
      ev('round_resolved', { roundNumber: 1 }),
      ev('income', {}), // 应归入 R2，不被 round_resolved 拉回 R1
    ];
    const result = attributeRounds(events);
    expect(result[0].round).toBe(1);
    expect(result[1].round).toBe(1); // round_resolved 自带 roundNumber=1
    expect(result[2].round).toBe(2); // income 顺推 currentRound=2
  });

  it('handles round_start as an anchor that sets currentRound', () => {
    const events = [
      ev('round_end', { roundNumber: 1 }),
      ev('round_start', { roundNumber: 2 }),
      ev('attack', {}), // 应归入 R2
    ];
    const result = attributeRounds(events);
    expect(result[2].round).toBe(2);
  });

  it('attributes pre-anchor events to round 1 with source=none', () => {
    const events = [
      ev('game_start', {}),
      ev('deploy', {}),
      ev('attack', {}),
    ];
    const result = attributeRounds(events);
    expect(result.every(r => r.round === 1)).toBe(true);
    expect(result.every(r => r.source === 'none')).toBe(true);
  });

  it('handles comeback_supply with old roundNumber without regressing', () => {
    // standard 模式：round_end(R1) → comeback_supply(R1) → income(无) → turn_end(R2)
    const events = [
      ev('round_end', { roundNumber: 1 }),
      ev('comeback_supply', { roundNumber: 1, amount: 10 }),
      ev('income', {}),
      ev('turn_end', { roundNumber: 2 }),
    ];
    const result = attributeRounds(events);
    expect(result[0].round).toBe(1); // round_end 归 R1
    expect(result[1].round).toBe(1); // comeback_supply 自带 R1
    expect(result[2].round).toBe(2); // income 顺推 currentRound=2
    expect(result[3].round).toBe(2); // turn_end 自带 R2
  });

  it('preserves original seq or assigns incremental seq', () => {
    const events = [
      ev('attack', {}, 42),
      ev('move', {}),
    ];
    const result = attributeRounds(events);
    expect(result[0].seq).toBe(42);
    expect(result[1].seq).toBe(2); // 无 seq 时按索引 +1
  });
});

describe('tallyByRound', () => {
  it('groups event counts by attributed round', () => {
    const events = [
      ev('attack', { roundNumber: 1 }),
      ev('attack', { roundNumber: 1 }),
      ev('move', { roundNumber: 1 }),
      ev('round_end', { roundNumber: 1 }),
      ev('attack', {}),            // R2
      ev('deploy', {}),            // R2
    ];
    const tally = tallyByRound(events);
    expect(tally.get(1)?.total).toBe(4); // 2 attack + 1 move + 1 round_end
    expect(tally.get(1)?.byType.get('attack')).toBe(2);
    expect(tally.get(2)?.total).toBe(2);
    expect(tally.get(2)?.byType.get('attack')).toBe(1);
    expect(tally.get(2)?.byType.get('deploy')).toBe(1);
  });

  it('reproduces the C3 scenario: legacy standard-mode attacks land in correct rounds', () => {
    // 模拟 V2 老回放：攻击事件无 roundNumber，仅 round_end 有
    const events = [
      ev('game_start', {}),
      ev('deploy', {}),
      ev('attack', {}),   // R1
      ev('attack', {}),   // R1
      ev('round_end', { roundNumber: 1 }),
      ev('income', {}),   // R2
      ev('attack', {}),   // R2
      ev('round_end', { roundNumber: 2 }),
      ev('attack', {}),   // R3
    ];
    const tally = tallyByRound(events);
    expect(tally.get(1)?.byType.get('attack')).toBe(2);
    expect(tally.get(2)?.byType.get('attack')).toBe(1);
    expect(tally.get(3)?.byType.get('attack')).toBe(1);
    // 关键断言：不再有 R0 堆积
    expect(tally.has(0)).toBe(false);
  });
});

describe('attributionCoverage', () => {
  it('reports zero unattributed when all events have roundNumber', () => {
    const events = [
      ev('attack', { roundNumber: 1 }),
      ev('move', { roundNumber: 1 }),
    ];
    const cov = attributionCoverage(events);
    expect(cov.unattributed).toBe(0);
    expect(cov.ratio).toBe(0);
  });

  it('counts pre-anchor events as unattributed', () => {
    const events = [
      ev('game_start', {}),
      ev('deploy', {}),
      ev('round_end', { roundNumber: 1 }),
      ev('attack', {}),
    ];
    const cov = attributionCoverage(events);
    expect(cov.total).toBe(4);
    expect(cov.unattributed).toBe(2); // game_start + deploy
    expect(cov.ratio).toBeCloseTo(0.5);
  });
});
