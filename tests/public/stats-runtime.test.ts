import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

class StubElement {
  innerHTML = '';
  textContent = '';
  value = '';
  disabled = false;
  options: string[] = [];
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

/** 在 node:vm 中用桩 DOM 执行 stats.js，喂入真实 stats.json。 */
async function loadPage() {
  const elements = new Map<string, StubElement>();
  const getEl = (id: string) => {
    if (!elements.has(id)) elements.set(id, new StubElement());
    return elements.get(id)!;
  };
  const data = JSON.parse(readFileSync('public/data/stats.json', 'utf8'));
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
  vm.runInContext(readFileSync('public/stats.js', 'utf8'), context);
  await new Promise((r) => setTimeout(r, 0));
  return { elements, data };
}

describe('stats dashboard runtime', () => {
  it('renders all panels from stats.json', async () => {
    const { elements } = await loadPage();

    expect(elements.get('load-status')?.textContent).toBe('已加载');
    expect(elements.get('kpi-grid')?.innerHTML).toContain('kpi-card');
    expect(elements.get('kpi-grid')?.innerHTML).toContain('平均耗时');
    expect(elements.get('model-table')?.children.get('tbody')?.innerHTML).toContain('data-label="双人评分"');
    expect(elements.get('match-table')?.children.get('tbody')?.innerHTML).toContain('tg_');
    expect(elements.get('map-bars')?.innerHTML).toContain('bar-row');
    expect(elements.get('reason-bars')?.innerHTML).toContain('bar-row');
  }, 15000);
});
