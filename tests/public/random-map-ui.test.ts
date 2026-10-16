import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function loadUI() {
  const context: Record<string, unknown> = { console, window: {} };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(read('public/random-map-ui.js'), context);
  return (context.window as { RandomMapUI: any }).RandomMapUI;
}

interface RowSpec {
  key: string;
  mode?: 'random' | 'fixed';
  min?: string;
  max?: string;
  value?: string;
}

/** 可触发事件的元素桩：虚拟 DOM 够用即可，重点是把 addEventListener 真的记下来。 */
function stubElement(extra: Record<string, unknown> = {}) {
  const listeners: Record<string, Array<(event?: any) => void>> = {};
  const classes = new Set<string>();
  const element = {
    value: '',
    textContent: '',
    title: '',
    checked: true,
    dataset: {} as Record<string, string>,
    style: {} as Record<string, string>,
    attrs: {} as Record<string, string>,
    setAttribute: (name: string, value: string) => { element.attrs[name] = value; },
    classList: {
      toggle: (name: string, on?: boolean) => { if (on) classes.add(name); else classes.delete(name); },
      contains: (name: string) => classes.has(name),
      add: (name: string) => { classes.add(name); },
      remove: (name: string) => { classes.delete(name); },
    },
    addEventListener: (type: string, fn: (event?: any) => void) => {
      (listeners[type] ??= []).push(fn);
    },
    /** 测试用：派发一次事件，返回处理器数量。 */
    fire: (type: string, event?: unknown) => {
      const handlers = listeners[type] ?? [];
      handlers.forEach(handler => handler(event ?? { target: element }));
      return handlers.length;
    },
    querySelector: (_selector: string): unknown => null,
    closest: (_selector: string): unknown => null,
    ...extra,
  };
  return element;
}

/** 按参数行的真实 DOM 层级造桩：head（取值方式 + 数字输入）+ slider（轨道 + 双手柄）。 */
function makeRowStub(spec: RowSpec) {
  const rail = stubElement({ tagName: 'SPAN', getBoundingClientRect: () => ({ left: 0, width: 100, top: 0, height: 4 }) });
  const fill = stubElement({ tagName: 'SPAN' });
  const thumbLo = stubElement({ tagName: 'INPUT', type: 'range', value: spec.min ?? '' });
  const thumbHi = stubElement({ tagName: 'INPUT', type: 'range', value: spec.max ?? '' });
  const slider = stubElement({
    dataset: { key: spec.key },
    querySelector: (selector: string) => ({
      '.rmo-thumb-lo': thumbLo,
      '.rmo-thumb-hi': thumbHi,
      '.rmo-slider-fill': fill,
      '.rmo-slider-rail': rail,
    } as Record<string, unknown>)[selector] ?? null,
  });
  const rangeGroup = stubElement({ tagName: 'SPAN' });
  const fixedGroup = stubElement({ tagName: 'SPAN' });
  fixedGroup.classList.add('hidden');
  const inputs: Record<string, ReturnType<typeof stubElement>> = {
    '.rmo-mode': stubElement({ tagName: 'SELECT', value: spec.mode ?? 'random' }),
    '.rmo-min': stubElement({ tagName: 'INPUT', type: 'number', value: spec.min ?? '' }),
    '.rmo-max': stubElement({ tagName: 'INPUT', type: 'number', value: spec.max ?? '' }),
    '.rmo-value': stubElement({ tagName: 'INPUT', type: 'number', value: spec.value ?? '' }),
    '.rmo-range-inputs': rangeGroup,
    '.rmo-fixed-input': fixedGroup,
  };
  const row = stubElement({
    dataset: { key: spec.key },
    querySelector: (selector: string) => (selector === '.rmo-slider' ? slider : (inputs[selector] ?? null)),
  });
  row.closest = (selector: string) => (selector === '.rmo-param' ? row : null);
  // 行内元素都能沿 closest('.rmo-param') 找到所属行（数字输入回写滑块时要用）；
  // 两个手柄额外命中 .rmo-thumb，对应用户按在手柄上时不该触发"点轨道跳转"。
  const toRow = (selector: string) => (selector === '.rmo-param' ? row : null);
  for (const element of [...Object.values(inputs), fill, rail, slider]) element.closest = toRow;
  thumbLo.closest = (selector: string) => (selector === '.rmo-thumb' ? thumbLo : toRow(selector));
  thumbHi.closest = (selector: string) => (selector === '.rmo-thumb' ? thumbHi : toRow(selector));
  return { row, slider, rail, thumbLo, thumbHi, fill, inputs, rangeGroup, fixedGroup };
}

/** 带 DOM 桩加载模块并跑 init，用于真跑 applyModeVisibility / refreshSliders / collectRandomOptions / 事件接线。 */
function loadUIWithDom(mode: string, specs: RowSpec[]) {
  const hint = stubElement();
  const built = specs.map(makeRowStub);
  const rows = built.map(item => item.row);
  const allInputs = built.flatMap(item => [
    item.row, item.slider, item.rail, item.thumbLo, item.thumbHi, item.fill, ...Object.values(item.inputs),
  ]);
  const container = stubElement({
    innerHTML: '',
    querySelectorAll: (selector: string) => {
      if (selector === '.rmo-param') return rows;
      if (selector === 'input, select') return allInputs;
      return [];
    },
  });
  const elements: Record<string, unknown> = {
    'rmo-symmetric': stubElement({ checked: true }),
    'rmo-seed': stubElement({ value: '' }),
    'rmo-game-mode': stubElement({ value: mode }),
    'rmo-mode-hint': hint,
    'random-map-options': container,
  };
  const documentStub = {
    getElementById: (id: string) => elements[id] ?? null,
    querySelectorAll: (selector: string) => (selector === '.rmo-param' ? rows : []),
  };
  const context: Record<string, unknown> = { console, window: {}, document: documentStub };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(read('public/random-map-ui.js'), context);
  const ui = (context.window as { RandomMapUI: any }).RandomMapUI;
  // 真跑一次 init：事件接线（拖动、模式切换、轨道点击、数字回写）都在这里挂上。
  ui.init(container);
  const byKey = (key: string) => built.find(item => item.row.dataset.key === key)!;
  const hiddenOf = (key: string) => byKey(key).row.classList.contains('hidden');
  return { ui, container, hint, rows, byKey, hiddenOf };
}

/** 带最小 DOM 桩加载模块并渲染面板，返回面板 HTML。 */
function capturePanelHtml(mode: string) {
  let html = '';
  const element = (extra: Record<string, unknown> = {}) => ({ addEventListener: () => {}, ...extra });
  const container = {
    set innerHTML(value: string) { html = value; },
    get innerHTML() { return html; },
    querySelectorAll: () => [],
  };
  const elements: Record<string, unknown> = {
    'rmo-symmetric': element({ checked: true }),
    'rmo-seed': element({ value: '' }),
    'rmo-game-mode': element({ value: mode }),
    'rmo-mode-hint': element({ textContent: '' }),
    'random-map-options': container,
  };
  const context: Record<string, unknown> = {
    console,
    window: {},
    document: { getElementById: (id: string) => elements[id] ?? null, querySelectorAll: () => [] },
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(read('public/random-map-ui.js'), context);
  return html;
}

const ARTILLERY_KEYS = [
  'artilleryStartRound', 'artilleryIntervalRounds', 'artilleryDamage', 'artilleryMinimumSafeRadius',
];
const HEADQUARTERS_KEYS = ['headquartersHp', 'headquartersDefense'];

describe('random map creation UI', () => {
  it('exposes a shared RandomMapUI module with all configurable parameters', () => {
    const ui = loadUI();
    expect(ui.RANDOM_MAP_ID).toBe('random');
    const keys = ui.PARAMS.map((param: { key: string }) => param.key);
    for (const key of [
      'radius', 'waterDensity', 'wallDensity', 'controlPointCount', 'maxTurns', 'actionsPerTurn',
      'unitStatVariation', 'startingSupplies', 'baseIncome',
      'headquartersHp', 'headquartersDefense',
      'artilleryStartRound', 'artilleryIntervalRounds', 'artilleryDamage', 'artilleryMinimumSafeRadius',
    ]) {
      expect(keys).toContain(key);
    }
    // 游戏模式下拉：标准/歼灭/同时回合/大逃杀，留空即默认标准。
    const source = read('public/random-map-ui.js');
    expect(source).toContain('id="rmo-game-mode"');
    for (const mode of ['standard', 'annihilation', 'simultaneous', 'royale']) {
      expect(source).toContain(`value: '${mode}'`);
    }
    expect(typeof ui.collectRandomOptions).toBe('function');
    expect(typeof ui.renderRandomMapCard).toBe('function');
    expect(typeof ui.setPreviewRenderer).toBe('function');
    expect(typeof ui.refreshPreview).toBe('function');
    expect(typeof ui.schedulePreview).toBe('function');
    expect(typeof ui.paramsForMode).toBe('function');
    expect(typeof ui.applyModeVisibility).toBe('function');
    // 面板内含模式说明行，随模式切换更新文案。
    expect(read('public/random-map-ui.js')).toContain('id="rmo-mode-hint"');
    const card = ui.renderRandomMapCard(true);
    expect(card).toContain('data-map-id="random"');
    expect(card).toContain('selected-map');
    expect(card).toContain('随机地图');
  });

  it('adapts visible parameters to the selected game mode', () => {
    // 规则：标准 / 同时回合有总部、无炮火；歼灭 / 大逃杀（不建总部）有炮火、无总部。
    const ui = loadUI();
    for (const mode of ['standard', 'simultaneous']) {
      const visible = ui.paramsForMode(mode);
      for (const key of ARTILLERY_KEYS) expect(visible, `${mode} 不应有 ${key}`).not.toContain(key);
      for (const key of HEADQUARTERS_KEYS) expect(visible, `${mode} 应有 ${key}`).toContain(key);
    }
    for (const mode of ['annihilation', 'royale']) {
      const visible = ui.paramsForMode(mode);
      for (const key of ARTILLERY_KEYS) expect(visible, `${mode} 应有 ${key}`).toContain(key);
      for (const key of HEADQUARTERS_KEYS) expect(visible, `${mode} 不应有 ${key}`).not.toContain(key);
    }
    // 模式下拉缺失（读到空值）时回落标准，不能把炮火当成可用参数。
    for (const key of ARTILLERY_KEYS) expect(ui.paramsForMode(''), `缺下拉时不应有 ${key}`).not.toContain(key);

    // 下拉里每个模式只能出现一次：曾同时存在「标准（默认）」(value '') 与「标准」('standard')
    // 两条等价项，用户会以为两者有区别。
    const modeValues = ui.GAME_MODES.map((mode: { value: string }) => mode.value);
    const modeLabels = ui.GAME_MODES.map((mode: { label: string }) => mode.label);
    expect(modeValues).toEqual(['standard', 'annihilation', 'simultaneous', 'royale']);
    expect(new Set(modeValues).size, '模式取值重复').toBe(modeValues.length);
    expect(new Set(modeLabels).size, '模式标签重复').toBe(modeLabels.length);

    // 显隐：标准模式藏炮火、显总部；歼灭模式反之；两种模式都给出说明文案。
    const allRows = ui.PARAMS.map((param: { key: string }) => ({ key: param.key, min: '4', max: '6' }));
    const expectations: Array<[string, string[], string[]]> = [
      ['standard', ARTILLERY_KEYS, HEADQUARTERS_KEYS],
      ['annihilation', HEADQUARTERS_KEYS, ARTILLERY_KEYS],
      ['royale', HEADQUARTERS_KEYS, ARTILLERY_KEYS],
      ['simultaneous', ARTILLERY_KEYS, HEADQUARTERS_KEYS],
    ];
    for (const [mode, hidden, shown] of expectations) {
      const scoped = loadUIWithDom(mode, allRows);
      scoped.ui.applyModeVisibility(scoped.container);
      for (const key of hidden) expect(scoped.hiddenOf(key), `${mode} 应隐藏 ${key}`).toBe(true);
      for (const key of shown) expect(scoped.hiddenOf(key), `${mode} 应显示 ${key}`).toBe(false);
      expect(scoped.hint.textContent.length, `${mode} 缺模式说明`).toBeGreaterThan(0);
    }

    // 提交：与当前模式无关的参数不写进 random 字段（隐藏了也不该被带出去）。
    const standard = loadUIWithDom('standard', allRows);
    const standardOptions = standard.ui.collectRandomOptions();
    for (const key of ARTILLERY_KEYS) expect(standardOptions, `标准模式不应提交 ${key}`).not.toHaveProperty(key);
    for (const key of HEADQUARTERS_KEYS) expect(standardOptions).toHaveProperty(key);
    expect(standardOptions).toHaveProperty('waterDensity');
    expect(standardOptions.mode).toBe('standard');

    const annihilation = loadUIWithDom('annihilation', allRows);
    const annihilationOptions = annihilation.ui.collectRandomOptions();
    for (const key of HEADQUARTERS_KEYS) expect(annihilationOptions, `歼灭模式不应提交 ${key}`).not.toHaveProperty(key);
    expect(annihilationOptions).toHaveProperty('artilleryDamage');

    // 选标准时显式提交 mode=standard（不再是「不发 mode 靠服务端兜底」），同样不带炮火。
    const simultaneous = loadUIWithDom('simultaneous', allRows);
    const simultaneousOptions = simultaneous.ui.collectRandomOptions();
    expect(simultaneousOptions.mode).toBe('simultaneous');
    for (const key of ARTILLERY_KEYS) expect(simultaneousOptions).not.toHaveProperty(key);
  });

  it('drives every parameter with a slider that shares the server bounds', async () => {
    const { RANDOM_PARAM_BOUNDS } = await import('../../src/config/randomMap.js');
    const ui = loadUI();
    const html = capturePanelHtml('standard');
    for (const param of ui.PARAMS as Array<{ key: string; min: number; max: number; step: number }>) {
      // 每个参数都有滑块，量程/步长＝服务端硬边界，且数字输入带上同样的 min/max 约束。
      expect(html, `${param.key} 缺滑块`).toContain(`class="rmo-slider" data-key="${param.key}"`);
      expect(html, `${param.key} 量程与服务端不一致`).toContain(`min="${param.min}" max="${param.max}" step="${param.step}"`);
      const bound = RANDOM_PARAM_BOUNDS[param.key];
      expect(bound, `${param.key} 服务端无此参数边界`).toBeDefined();
      expect({ min: param.min, max: param.max, integer: param.step >= 1 })
        .toEqual({ min: bound.min, max: bound.max, integer: bound.integer });
    }
    // 滑块带下限与上限两个手柄（区间模式）。
    expect(html).toContain('rmo-thumb rmo-thumb-lo');
    expect(html).toContain('rmo-thumb rmo-thumb-hi');
    expect(typeof ui.refreshSliders).toBe('function');
  });

  it('keeps the slider and the number inputs in sync both ways', () => {
    const ui = loadUI();
    const radius = ui.PARAMS.find((param: { key: string }) => param.key === 'radius');
    const span = radius.max - radius.min;
    const built = loadUIWithDom('standard', [{ key: 'radius', min: '6', max: '9' }]);
    built.ui.refreshSliders(built.container);
    const item = built.byKey('radius');
    // 数字 → 滑块：手柄落在显式值上，区间带覆盖 6–9，且不再是默认态。
    expect(item.thumbLo.value).toBe('6');
    expect(item.thumbHi.value).toBe('9');
    expect(item.slider.classList.contains('is-default')).toBe(false);
    expect(item.fill.style.left).toBe(`${((6 - radius.min) / span) * 100}%`);
    expect(item.fill.style.width).toBe(`${((9 - 6) / span) * 100}%`);

    // 清空数字 → 滑块回到服务端默认区间并标为默认态（滑块不会假装用户填过）。
    item.inputs['.rmo-min'].value = '';
    item.inputs['.rmo-max'].value = '';
    built.ui.refreshSliders(built.container);
    expect(item.thumbLo.value).toBe(String(radius.defMin));
    expect(item.thumbHi.value).toBe(String(radius.defMax));
    expect(item.slider.classList.contains('is-default')).toBe(true);

    // 固定模式：只留一个手柄，填充画成进度条（0 → 当前值）。
    const fixedRow = loadUIWithDom('standard', [{ key: 'radius', mode: 'fixed', value: '8' }]);
    fixedRow.ui.refreshSliders(fixedRow.container);
    const fixedItem = fixedRow.byKey('radius');
    expect(fixedItem.slider.classList.contains('is-fixed')).toBe(true);
    expect(fixedItem.thumbLo.value).toBe('8');
    expect(fixedItem.fill.style.left).toBe('0%');
    expect(fixedItem.fill.style.width).toBe(`${((8 - radius.min) / span) * 100}%`);
  });

  it('wires dragging, mode switching and track clicks to the number inputs', () => {
    const ui = loadUI();
    const radius = ui.PARAMS.find((param: { key: string }) => param.key === 'radius');
    const span = radius.max - radius.min;

    // 拖动下限：写 .rmo-min，并把空着的 .rmo-max 落实为服务端默认上限（不留半默认态）。
    const drag = loadUIWithDom('standard', [{ key: 'radius' }]);
    const item = drag.byKey('radius');
    item.thumbLo.value = '7';
    expect(item.thumbLo.fire('input'), '下限手柄没挂 input 监听').toBeGreaterThan(0);
    expect(item.inputs['.rmo-min'].value).toBe('7');
    expect(item.inputs['.rmo-max'].value).toBe(String(radius.defMax));
    expect(item.fill.style.width).toBe(`${((radius.defMax - 7) / span) * 100}%`);
    expect(item.slider.classList.contains('is-default')).toBe(false);
    expect(item.thumbLo.attrs['aria-label']).toBe('地图半径下限');

    // 上限被拖到下限之下：下限一起顶走，min ≤ max 恒成立。
    item.thumbHi.value = '4';
    item.thumbHi.fire('input');
    expect(item.inputs['.rmo-min'].value).toBe('4');
    expect(item.inputs['.rmo-max'].value).toBe('4');
    expect(drag.ui.collectRandomOptions().radius).toEqual([4, 4]);

    // 数字输入 → 滑块跟随（走 init 里挂的通用 input 监听）。
    item.inputs['.rmo-min'].value = '9';
    item.inputs['.rmo-min'].fire('input');
    expect(item.thumbLo.value).toBe('9');

    // 点击轨道：更近的手柄跳过去（轨道 0–100 → clientX=50 对应 8，离上限 10 更近）。
    const click = loadUIWithDom('standard', [{ key: 'radius', min: '5', max: '10' }]);
    const clickItem = click.byKey('radius');
    clickItem.slider.fire('pointerdown', { target: clickItem.slider, clientX: 50 });
    expect(clickItem.inputs['.rmo-max'].value).toBe('8');
    expect(clickItem.inputs['.rmo-min'].value).toBe('5');
    // 按在手柄上时不抢原生拖动。
    clickItem.slider.fire('pointerdown', { target: clickItem.thumbHi, clientX: 0 });
    expect(clickItem.inputs['.rmo-max'].value).toBe('8');

    // 切到固定模式：区间输入隐藏、固定输入显示，滑块转进度条，拖手柄改写 .rmo-value。
    const fixed = loadUIWithDom('standard', [{ key: 'radius', min: '6', max: '9' }]);
    const fixedItem = fixed.byKey('radius');
    fixedItem.inputs['.rmo-mode'].value = 'fixed';
    expect(fixedItem.inputs['.rmo-mode'].fire('change'), '取值方式没挂 change 监听').toBeGreaterThan(0);
    expect(fixedItem.rangeGroup.classList.contains('hidden')).toBe(true);
    expect(fixedItem.fixedGroup.classList.contains('hidden')).toBe(false);
    expect(fixedItem.slider.classList.contains('is-fixed')).toBe(true);
    expect(fixedItem.thumbLo.attrs['aria-label']).toBe('地图半径固定值');
    fixedItem.thumbLo.value = '7';
    fixedItem.thumbLo.fire('input');
    expect(fixedItem.inputs['.rmo-value'].value).toBe('7');
    expect(fixed.ui.collectRandomOptions().radius).toBe(7);
    expect(fixedItem.fill.style.left).toBe('0%');
    expect(fixedItem.fill.style.width).toBe(`${((7 - radius.min) / span) * 100}%`);
  });

  it('clamps panel values to the server bounds before submitting', () => {
    // 此前前端不设 min/max，越界值照发、服务端静默钳位——用户以为生效了其实没有。
    const outOfRange = loadUIWithDom('standard', [{ key: 'radius', min: '999', max: '0' }]);
    expect(outOfRange.ui.collectRandomOptions().radius).toEqual([4, 12]);
    const tooHigh = loadUIWithDom('standard', [{ key: 'radius', mode: 'fixed', value: '999' }]);
    expect(tooHigh.ui.collectRandomOptions().radius).toBe(12);
    const tooLow = loadUIWithDom('standard', [{ key: 'radius', mode: 'fixed', value: '-9' }]);
    expect(tooLow.ui.collectRandomOptions().radius).toBe(4);
    // 小数参数的钳位与取整（waterDensity 边界 0–0.4）。
    const density = loadUIWithDom('standard', [{ key: 'waterDensity', mode: 'fixed', value: '9' }]);
    expect(density.ui.collectRandomOptions().waterDensity).toBe(0.4);
  });

  it('renders exactly one option per game mode', () => {
    // 回归：模式下拉曾同时有「标准（默认）」(value '') 与「标准」('standard') 两条等价项。
    const html = capturePanelHtml('standard');
    const knownValues = ['standard', 'annihilation', 'simultaneous', 'royale', ''];
    const modeOptions = [...html.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)]
      .map(match => ({ value: match[1], label: match[2] }))
      .filter(option => knownValues.includes(option.value));
    expect(modeOptions.map(option => option.value))
      .toEqual(['standard', 'annihilation', 'simultaneous', 'royale']);
    expect(new Set(modeOptions.map(option => option.label)).size).toBe(4);
    // 默认选中第一个（标准）。
    expect(html).toContain('<option value="standard" selected>标准</option>');
  });

  it('builds a preview panel that fetches server-side generated previews', () => {
    const source = read('public/random-map-ui.js');
    expect(source).toContain('id="rmo-preview-canvas"');
    expect(source).toContain('id="rmo-preview-refresh"');
    expect(source).toContain("'/api/maps/random/preview'");
    // 未填种子时回填服务端代抽的种子，保证预览即所得。
    expect(source).toContain('seedInput.value = data.seed');
  });

  it('styles the mode hint and hidden utility in both play stylesheets', () => {
    // 参数行靠 .hidden 显隐、模式说明靠 .rmo-mode-hint，两端样式表都要有，否则其一端会失效。
    for (const path of ['public/play.css', 'public/play-m.css']) {
      const css = read(path);
      expect(css, `${path} 缺 .rmo-mode-hint 样式`).toContain('.rmo-mode-hint');
      expect(css, `${path} 缺 .hidden 工具类`).toContain('.hidden');
    }
  });

  it('wires the random map panel into the desktop play page', () => {
    const html = read('public/play.html');
    const source = read('public/play.js');

    expect(html).toContain('id="random-map-options"');
    expect(html).toContain('<option value="random">随机地图</option>');
    // random-map-ui 由客户端入口以 ESM import 引入（不再直接以 script 标签加载）。
    expect(source).toContain("import './random-map-ui.js';");
    expect(source).toContain('window.RandomMapUI?.renderRandomMapCard');
    expect(source).toContain('window.RandomMapUI.collectRandomOptions()');
    expect(source).toContain("els.mapSelect.value === 'random'");
    expect(source).toContain("selected === 'random'");
    expect(source).toContain('window.RandomMapUI?.setPreviewRenderer(renderMapPreview)');
  });

  it('wires the random map panel into the mobile play page', () => {
    const html = read('public/play-m.html');
    const source = read('public/play-m.js');

    expect(html).toContain('id="random-map-options"');
    expect(html).toContain('<option value="random">随机地图</option>');
    // random-map-ui 由客户端入口以 ESM import 引入（不再直接以 script 标签加载）。
    expect(source).toContain("import './random-map-ui.js';");
    expect(source).toContain('window.RandomMapUI?.renderRandomMapCard');
    expect(source).toContain('window.RandomMapUI.collectRandomOptions()');
    expect(source).toContain("els.mapSelect.value === 'random'");
    expect(source).toContain("selected === 'random'");
    expect(source).toContain('window.RandomMapUI?.setPreviewRenderer(renderMapPreview)');
  });
});
