import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('stats dashboard', () => {
  it('escapes replay-derived bar labels and applies shared outcome rules', () => {
    const source = readFileSync('public/stats.js', 'utf8');

    expect(source).toContain('title="${escapeAttr(name)}">${escapeHtml(label)}');
    expect(source).toContain('if (!isRankedMatch(m)) continue;');
    expect(source).toContain('if (!isDraw && (p.isWinner || p.rank === 1)) ag.wins += 1;');
  });

  it('does not publish the generator machine path', () => {
    const stats = JSON.parse(readFileSync('public/data/stats.json', 'utf8'));

    expect(stats.source.recordsDir).toBeUndefined();
  });
});
