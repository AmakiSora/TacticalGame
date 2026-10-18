import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

type FakeElement = {
  getAttribute: (name: string) => string | null;
  closest: () => FakeElement | null;
  getBoundingClientRect: () => { top: number; left: number; width: number; height: number; bottom: number; right: number };
  isConnected: boolean;
};

// 浏览器里 preview-tooltip.js 是挂在 window 上的 IIFE，依赖 document / window / Element；
// 这里用 vm + 假 DOM 跑同一份源码，直接断言它生成的卡片内容与定位结果。
function loadTooltip() {
  const listeners: Record<string, Record<string, Array<(event: any) => void>>> = { document: {}, window: {} };
  const created: any[] = [];
  let Element: new () => FakeElement;

  function makeNode() {
    const classes = new Set<string>();
    return {
      className: '',
      innerHTML: '',
      dataset: {} as Record<string, string>,
      style: {} as Record<string, string>,
      classList: {
        add: (name: string) => classes.add(name),
        remove: (name: string) => classes.delete(name),
        contains: (name: string) => classes.has(name),
      },
      setAttribute() {},
      appendChild() {},
      offsetWidth: 190,
      offsetHeight: 138,
    };
  }

  Element = class {} as unknown as new () => FakeElement;
  const documentStub = {
    addEventListener: (type: string, fn: (event: any) => void) => {
      (listeners.document[type] ||= []).push(fn);
    },
    createElement: () => {
      const node = makeNode();
      created.push(node);
      return node;
    },
    body: { appendChild() {} },
    elementFromPoint: () => null,
  };
  const windowStub = {
    addEventListener: (type: string, fn: (event: any) => void) => {
      (listeners.window[type] ||= []).push(fn);
    },
    innerWidth: 1200,
    innerHeight: 800,
  };
  const context: any = { window: windowStub, document: documentStub, Element, setTimeout, clearTimeout };
  vm.createContext(context);
  vm.runInContext(read('public/preview-tooltip.js'), context);

  function element(attrs: Record<string, string>, rect = { top: 100, left: 120, width: 10, height: 10 }): FakeElement {
    const el = new Element() as FakeElement;
    el.getAttribute = (name: string) => attrs[name] ?? null;
    el.closest = () => el;
    el.getBoundingClientRect = () => ({ ...rect, bottom: rect.top + rect.height, right: rect.left + rect.width });
    el.isConnected = true;
    return el;
  }

  function fire(type: string, event: Record<string, unknown>): void {
    for (const fn of listeners.document[type] || []) fn(event);
  }

  return {
    tip: () => created[0],
    element,
    hover: (el: FakeElement) => fire('pointerover', { pointerType: 'mouse', target: el, relatedTarget: null }),
    leave: (el: FakeElement, related: unknown = null) => fire('pointerout', { pointerType: 'mouse', target: el, relatedTarget: related }),
  };
}

const UNIT_ATTRS: Record<string, string> = {
  'data-marker-kind': 'unit',
  'data-marker-token': 'scout',
  'data-marker-title': '侦察兵',
  'data-marker-sub': '初始单位 · 出生位 1',
  'data-marker-trait': '可占点',
  'data-stat-hp': '65',
  'data-stat-attack': '16',
  'data-stat-defense': '4',
  'data-stat-move': '5',
  'data-stat-range': '1',
  'data-stat-cost': '38',
};

const CONTROL_POINT_ATTRS: Record<string, string> = {
  'data-marker-kind': 'control-point',
  'data-marker-token': 'supply',
  'data-marker-title': '中央阵地',
  'data-marker-sub': '补给站',
  'data-stat-income': '+3',
  'data-stat-discount': '-5',
  'data-stat-repair': '+5',
  'data-stat-deploy': '可用',
};

const HEADQUARTERS_ATTRS: Record<string, string> = {
  'data-marker-kind': 'headquarters',
  'data-marker-token': 'headquarters',
  'data-marker-title': '总部',
  'data-marker-sub': '出生位 1',
  'data-stat-hp': '200',
  'data-stat-defense': '5',
  'data-stat-deploy': '不可部署',
};

const SPAWN_ATTRS: Record<string, string> = {
  'data-marker-kind': 'spawn',
  'data-marker-token': 'spawn',
  'data-marker-title': '出生点',
  'data-marker-sub': '出生位 1 · 西侧补给站',
  'data-stat-units': '3',
};

describe('map preview hover card', () => {
  it('shows the unit name on top and icon + number rows underneath', () => {
    const tooltip = loadTooltip();
    tooltip.hover(tooltip.element(UNIT_ATTRS, { top: 400, left: 120, width: 10, height: 10 }));
    const node = tooltip.tip();

    expect(node.className).toBe('preview-tip unit-scout');
    expect(node.classList.contains('open')).toBe(true);
    expect(node.style.display).toBe('block');

    const html: string = node.innerHTML;
    // 顶部：兵种名 + 副标题（出生位）
    expect(html).toContain('preview-tip-name">侦察兵<');
    expect(html).toContain('初始单位 · 出生位 1');
    // 生命：图标 + 数值 + 血条
    expect(html).toContain('preview-tip-hp');
    expect(html).toContain('65 / 65');
    // 数值行：图标 + 中文名 + 数字，且按兵种配置出现
    for (const [key, label, value] of [
      ['attack', '攻击', '16'],
      ['defense', '防御', '4'],
      ['move', '移动', '5'],
      ['range', '射程', '1'],
      ['cost', '费用', '38'],
    ]) {
      expect(html, `缺 ${label} 行`).toContain(`preview-tip-cell ${key}`);
      expect(html, `缺 ${label} 名称`).toContain(`<i>${label}</i><b>${value}</b>`);
    }
    // 初始兵种没有治疗数值，就不该凭空多一行
    expect(html).not.toContain('preview-tip-cell heal');
    // 特性单独一行
    expect(html).toContain('preview-tip-traits">可占点<');
    // 卡片浮在标记上方并水平居中（标记中心 125 - 190/2 = 30）
    expect(node.dataset.side).toBe('top');
    expect(node.style.left).toBe('30px');
    expect(node.style.top).toBe('252px');
  });

  it('adds the heal row for support and hides again on pointer leave', () => {
    const tooltip = loadTooltip();
    const infantry = tooltip.element({ ...UNIT_ATTRS, 'data-marker-token': 'infantry', 'data-marker-title': '步兵' });
    tooltip.hover(infantry);
    expect(tooltip.tip().innerHTML).not.toContain('preview-tip-cell heal');

    const support = tooltip.element({
      ...UNIT_ATTRS,
      'data-marker-token': 'support',
      'data-marker-title': '支援兵',
      'data-stat-heal': '22',
    });
    tooltip.hover(support);
    const node = tooltip.tip();
    expect(node.className).toBe('preview-tip unit-support');
    expect(node.innerHTML).toContain('<i>治疗</i><b>22</b>');

    tooltip.leave(support);
    expect(node.classList.contains('open')).toBe(false);
    expect(node.style.display).toBe('none');
  });

  it('describes control points with income, deploy discount, repair and deployability', () => {
    const tooltip = loadTooltip();
    tooltip.hover(tooltip.element(CONTROL_POINT_ATTRS));
    const node = tooltip.tip();
    const html: string = node.innerHTML;

    expect(node.className).toBe('preview-tip marker-control-point');
    expect(html).toContain('preview-tip-name">中央阵地<');
    expect(html).toContain('preview-tip-sub">补给站<');
    for (const [key, label, value] of [
      ['income', '收入', '+3'],
      ['discount', '部署折扣', '-5'],
      ['repair', '维修', '+5'],
      ['deploy', '部署', '可用'],
    ]) {
      expect(html, `据点缺 ${label} 行`).toContain(`preview-tip-cell ${key}`);
      expect(html, `据点缺 ${label} 数值`).toContain(`<i>${label}</i><b>${value}</b>`);
    }
    // 据点没有生命条
    expect(html).not.toContain('preview-tip-hp');
  });

  it('describes headquarters with hp, defense and deployability', () => {
    const tooltip = loadTooltip();
    tooltip.hover(tooltip.element(HEADQUARTERS_ATTRS));
    const node = tooltip.tip();
    const html: string = node.innerHTML;

    expect(node.className).toBe('preview-tip marker-headquarters');
    expect(html).toContain('preview-tip-name">总部<');
    expect(html).toContain('出生位 1');
    expect(html).toContain('200 / 200');
    expect(html).toContain('<i>防御</i><b>5</b>');
    expect(html).toContain('<i>部署</i><b>不可部署</b>');
  });

  it('describes annihilation spawn points with their initial army size', () => {
    const tooltip = loadTooltip();
    tooltip.hover(tooltip.element(SPAWN_ATTRS));
    const node = tooltip.tip();
    const html: string = node.innerHTML;

    expect(node.className).toBe('preview-tip marker-spawn');
    expect(html).toContain('preview-tip-name">出生点<');
    expect(html).toContain('出生位 1 · 西侧补给站');
    expect(html).toContain('<i>初始单位</i><b>3</b>');
    expect(html).not.toContain('preview-tip-hp');
  });

  it('keeps the card inside the viewport when the marker hugs a corner', () => {
    const tooltip = loadTooltip();
    const corner = tooltip.element(UNIT_ATTRS, { top: 2, left: 1196, width: 8, height: 8 });
    tooltip.hover(corner);
    const node = tooltip.tip();

    expect(node.dataset.side).toBe('bottom');
    expect(parseInt(node.style.left, 10)).toBeLessThanOrEqual(1200 - 190 - 8);
    expect(parseInt(node.style.top, 10)).toBeGreaterThan(2);
  });

  it('is wired into both player pages and every preview renderer', () => {
    for (const page of ['public/play.js', 'public/play-m.js']) {
      const source = read(page);
      expect(source, `${page} 未引入悬停详单`).toContain("import './preview-tooltip.js';");
      expect(source, `${page} 初始单位缺悬停标记`).toContain('data-preview-marker');
      expect(source, `${page} 缺对象类型`).toContain('data-marker-kind');
      expect(source, `${page} 初始单位未带兵种数值`).toContain('data-stat-');
      expect(source, `${page} 据点未接入详单`).toContain('data-marker-kind="control-point"');
      expect(source, `${page} 总部未接入详单`).toContain('data-marker-kind="headquarters"');
      expect(source, `${page} 出生点未接入详单`).toContain('data-marker-kind="spawn"');
      expect(source, `${page} 缺整格命中区`).toContain('preview-marker-hit');
    }
    for (const page of ['public/play.html', 'public/play-m.html']) {
      expect(read(page), `${page} 未加载详单样式`).toContain('href="/preview-tooltip.css"');
    }
  });

  it('styles the card in the shared panel language', () => {
    const css = read('public/preview-tooltip.css');
    expect(css).toContain('.preview-tip {');
    expect(css).toContain('position: fixed');
    expect(css).toContain('background: #141c26');
    expect(css).toContain('.preview-tip-cell.attack');
    expect(css).toContain('.preview-tip-cell.income');
    expect(css).toContain('.preview-tip.unit-scout');
    expect(css).toContain('.preview-tip.marker-control-point');
    expect(css).toContain('.preview-tip.marker-headquarters');
    expect(read('public/play.css')).toContain('.preview-marker-hit { fill: rgba(0, 0, 0, 0); }');
    expect(read('public/play-m.css')).toContain('.preview-marker-hit { fill: rgba(0, 0, 0, 0); }');
    expect(read('public/play.css')).toContain('.token-icon.spawn');
    expect(read('public/play-m.css')).toContain('.token-icon.spawn');
  });
});
