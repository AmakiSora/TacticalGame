import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('stats dashboard', () => {
  it('escapes replay-derived bar labels and applies shared outcome rules', () => {
    const source = readFileSync('public/stats.js', 'utf8');

    expect(source).toContain('title="${escapeAttr(name)}">${escapeHtml(label)}');
    expect(source).toContain('if (!isRankedMatch(m)) continue;');
    expect(source).toContain('if (!isDraw && (p.isWinner || p.rank === 1)) ag.wins += 1;');
    expect(source).toContain("let modelSort = { key: 'duelRating', dir: 'desc' };");
    expect(source).toContain('multiRating: b.multiGames > 0');
  });

  it('does not publish the generator machine path', () => {
    const stats = JSON.parse(readFileSync('public/data/stats.json', 'utf8'));

    expect(stats.source.recordsDir).toBeUndefined();
  });

  it('provides card labels and touch sorting for narrow screens', () => {
    const html = readFileSync('public/stats.html', 'utf8');
    const source = readFileSync('public/stats.js', 'utf8');
    const css = readFileSync('public/stats.css', 'utf8');

    expect(html).toContain('id="model-sort-mobile"');
    expect(html).toContain('id="match-sort-mobile"');
    expect(html).toContain('id="model-sort-direction"');
    expect(html).toContain('id="match-sort-direction"');
    expect(source).toContain('data-label="模型"');
    expect(source).toContain('data-label="参赛模型"');
    expect(source).toContain('data-label="双人评分"');
    expect(source).toContain('data-label="多人评分"');
    expect(source).toContain('function syncMobileSortControls');
    expect(css).toContain('@media (max-width: 720px)');
    expect(css).toContain('content: attr(data-label)');
    expect(css).toContain('.mobile-sort');
    expect(html).toContain('/mobile-icons.css');
    expect(html).toContain('icon-arrow-down');
    expect(source).toContain("classList.toggle('icon-arrow-up'");
  });
});
