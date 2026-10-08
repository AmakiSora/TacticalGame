import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('stats dashboard', () => {
  it('escapes replay-derived bar labels and applies shared outcome rules', () => {
    const source = readFileSync('public/stats.js', 'utf8');

    expect(source).toContain('title="${escapeAttr(name)}">${escapeHtml(label)}');
    expect(source).toContain('if (!isRankedMatch(m)) continue;');
    expect(source).toContain('if (!isDraw && (p.isWinner || p.rank === 1)) ag.wins += 1;');
    expect(source).toContain("let modelSort = { key: 'duelBtRating', dir: 'desc' };");
    expect(source).toContain('multiRating: b.multiGames > 0');
    expect(source).toContain('function bradleyTerryRatings');
    expect(source).toContain('data-label="BT评分"');
    expect(source).toContain("simultaneous: '同时'");
    expect(source).toContain('function modeSummary(modeDist)');
    expect(source).toContain('modeClass(m.mode)');
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
    expect(html).toContain('<option value="duelBtRating">BT评分</option>');
    expect(html).toContain('data-sort="duelBtRating"');
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
    expect(html).toContain('.mode-simul');
  });

  it('binds each filter to a single event so one selection renders once', () => {
    const source = readFileSync('public/stats.js', 'utf8');

    // select 的每次选择会同时触发 input 与 change；两者都绑会让整套聚合与两张表重绘两遍。
    const selectKeys = ['el.filterVersion', 'el.filterMap', 'el.filterPlayers', 'el.filterMode', 'el.filterModel'];
    for (const key of selectKeys) {
      expect(source, `${key} 应绑定 change`).toContain(`addEventListener('change', () => applyAndRender());`);
    }
    // 搜索框没有 change 语义（失焦才触发），只能绑 input。
    expect(source).toContain("el.filterSearch.addEventListener('input', () => applyAndRender());");
    // 回归守卫：不允许再出现「同一节点同时绑 input 与 change」的循环写法。
    expect(source).not.toContain("node.addEventListener('input', () => applyAndRender());");
    // 且搜索框不得再混进 select 循环里（否则会同时吃到 change 与 input）。
    const loopStart = source.indexOf('for (const node of [');
    const loopEnd = source.indexOf(']) {', loopStart);
    expect(loopStart, '应保留筛选控件的循环绑定').toBeGreaterThan(-1);
    expect(loopEnd).toBeGreaterThan(loopStart);
    expect(source.slice(loopStart, loopEnd)).not.toContain('el.filterSearch');
  });
});
