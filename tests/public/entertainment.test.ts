import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

class StubElement {
  innerHTML = '';
  textContent = '';
  value = '';
  disabled = false;
  dataset: Record<string, string> = {};
  children = new Map<string, StubElement>();
  classList = {
    add() {}, remove() {}, toggle() {}, contains() { return false; },
  };
  addEventListener() {}
  setAttribute() {}
  querySelector(sel: string): StubElement {
    if (!this.children.has(sel)) this.children.set(sel, new StubElement());
    return this.children.get(sel)!;
  }
  querySelectorAll(): StubElement[] { return []; }
}

/** 在 node:vm 中用桩 DOM 执行 entertainment.js，喂入真实 fun-stats.json。 */
async function loadPage() {
  const elements = new Map<string, StubElement>();
  const getEl = (id: string) => {
    if (!elements.has(id)) elements.set(id, new StubElement());
    return elements.get(id)!;
  };
  const data = JSON.parse(readFileSync('public/data/fun-stats.json', 'utf8'));
  const context: Record<string, unknown> = {
    console,
    setTimeout,
    document: {
      getElementById: getEl,
      querySelectorAll: () => [],
    },
    fetch: async () => ({ ok: true, json: async () => data }),
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(readFileSync('public/entertainment.js', 'utf8'), context);
  // loadData 是 async：等一个宏任务让 fetch/render 链跑完
  await new Promise((r) => setTimeout(r, 0));
  return { elements, data };
}

describe('entertainment page', () => {
  it('renders every section from fun-stats.json without a DOM', async () => {
    const { elements, data } = await loadPage();
    const html = (id: string) => elements.get(id)?.innerHTML ?? '';

    expect(elements.get('load-status')?.textContent).toBe('已加载');
    expect(elements.get('lead-title')?.textContent).not.toBe('正在整理战报…');
    expect(html('lead-chips')).toContain('lead-chip');
    expect(html('kpi-grid')).toContain('kpi-card');
    expect(html('action-mix')).toContain('mix-segment');
    expect(html('pace-chart')).toContain('<svg');
    expect(elements.get('pace-note')?.textContent).toContain('回合');
    expect(html('momentum-grid')).toContain('momentum-card');
    expect(
      elements.get('combat-table')?.children.get('tbody')?.innerHTML ?? '',
    ).toContain('data-label="场均伤害"');
    expect(html('story-grid')).toContain('story-card');
    expect(html('fact-list')).toContain('<li>');
    expect(html('records-list')).toContain('record-row');
    expect(html('growth-chart')).toContain('<svg');
    expect(html('debut-list')).toContain('debut-row');
    expect(html('monthly-grid')).toContain('month-card');
    expect(html('version-list')).toContain('version-chip');
    expect(html('map-stage')).toContain('map-row');
    expect(html('economy-grid')).toContain('econ-item');
    expect(html('spender-list')).toContain('spender-row');
    expect(html('unit-bars')).toContain('unit-row');
    expect(html('model-identity')).toContain('model-name');
    expect(html('model-benchmarks')).toContain('benchmark-row');
    expect(data.pace.byRound.length).toBeGreaterThan(0);
  }, 15000);

  it('keeps the stats design-system wiring in the html shell', () => {
    const html = readFileSync('public/entertainment.html', 'utf8');
    expect(html).toContain('href="/stats.css"');
    expect(html).toContain('href="/entertainment.css"');
    expect(html).toContain('class="stats-shell entertainment-shell"');
    expect(html).toContain('href="/entertainment.html" class="active"');
    for (const id of [
      'kpi-grid', 'action-mix', 'pace-chart', 'momentum-grid', 'combat-table',
      'unit-bars', 'fact-list', 'economy-grid', 'spender-list', 'rivalry-list',
      'story-grid', 'records-list', 'model-select', 'model-identity', 'model-benchmarks',
      'growth-chart', 'debut-list', 'monthly-grid', 'version-list', 'map-stage',
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
  });
});
