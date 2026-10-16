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

/** 带最小 DOM 桩加载模块，用于真跑 applyModeVisibility / collectRandomOptions。 */
function loadUIWithDom(mode: string, keys: string[]) {
  const hint = { textContent: '' };
  const rows = keys.map(key => {
    const row: {
      dataset: { key: string };
      hidden: boolean;
      classList: { toggle: (name: string, on: boolean) => void };
      querySelector: (selector: string) => unknown;
    } = {
      dataset: { key },
      hidden: false,
      classList: { toggle: (name, on) => { if (name === 'hidden') row.hidden = on; } },
      querySelector: selector => ({
        '.rmo-mode': { value: 'random' },
        '.rmo-min': { value: '4' },
        '.rmo-max': { value: '6' },
        '.rmo-value': { value: '' },
      } as Record<string, unknown>)[selector] ?? null,
    };
    return row;
  });
  const container = { querySelectorAll: (selector: string) => (selector === '.rmo-param' ? rows : []) };
  const elements: Record<string, unknown> = {
    'rmo-symmetric': { checked: true },
    'rmo-seed': { value: '' },
    'rmo-game-mode': { value: mode },
    'rmo-mode-hint': hint,
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
  const hiddenOf = (key: string) => rows.find(row => row.dataset.key === key)?.hidden;
  return { ui, container, hint, hiddenOf };
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
    // 规则：标准 / 同时回合有总部、无炮火；歼灭 / 大逃杀（不建总部）有炮火、无总部；留空＝标准。
    const ui = loadUI();
    for (const mode of ['', 'standard', 'simultaneous']) {
      const visible = ui.paramsForMode(mode);
      for (const key of ARTILLERY_KEYS) expect(visible, `${mode || '空'} 不应有 ${key}`).not.toContain(key);
      for (const key of HEADQUARTERS_KEYS) expect(visible, `${mode || '空'} 应有 ${key}`).toContain(key);
    }
    for (const mode of ['annihilation', 'royale']) {
      const visible = ui.paramsForMode(mode);
      for (const key of ARTILLERY_KEYS) expect(visible, `${mode} 应有 ${key}`).toContain(key);
      for (const key of HEADQUARTERS_KEYS) expect(visible, `${mode} 不应有 ${key}`).not.toContain(key);
    }

    // 显隐：标准模式藏炮火、显总部；歼灭模式反之；两种模式都给出说明文案。
    const allKeys = ui.PARAMS.map((param: { key: string }) => param.key);
    const expectations: Array<[string, string[], string[]]> = [
      ['standard', ARTILLERY_KEYS, HEADQUARTERS_KEYS],
      ['annihilation', HEADQUARTERS_KEYS, ARTILLERY_KEYS],
      ['royale', HEADQUARTERS_KEYS, ARTILLERY_KEYS],
      ['simultaneous', ARTILLERY_KEYS, HEADQUARTERS_KEYS],
    ];
    for (const [mode, hidden, shown] of expectations) {
      const scoped = loadUIWithDom(mode, allKeys);
      scoped.ui.applyModeVisibility(scoped.container);
      for (const key of hidden) expect(scoped.hiddenOf(key), `${mode} 应隐藏 ${key}`).toBe(true);
      for (const key of shown) expect(scoped.hiddenOf(key), `${mode} 应显示 ${key}`).toBe(false);
      expect(scoped.hint.textContent.length, `${mode} 缺模式说明`).toBeGreaterThan(0);
    }

    // 提交：与当前模式无关的参数不写进 random 字段（隐藏了也不该被带出去）。
    const standard = loadUIWithDom('standard', allKeys);
    const standardOptions = standard.ui.collectRandomOptions();
    for (const key of ARTILLERY_KEYS) expect(standardOptions, `标准模式不应提交 ${key}`).not.toHaveProperty(key);
    for (const key of HEADQUARTERS_KEYS) expect(standardOptions).toHaveProperty(key);
    expect(standardOptions).toHaveProperty('waterDensity');
    expect(standardOptions.mode).toBe('standard');

    const annihilation = loadUIWithDom('annihilation', allKeys);
    const annihilationOptions = annihilation.ui.collectRandomOptions();
    for (const key of HEADQUARTERS_KEYS) expect(annihilationOptions, `歼灭模式不应提交 ${key}`).not.toHaveProperty(key);
    expect(annihilationOptions).toHaveProperty('artilleryDamage');

    // 模式留空＝标准：不提交 mode 字段，同样不带炮火。
    const defaultMode = loadUIWithDom('', allKeys);
    const defaultOptions = defaultMode.ui.collectRandomOptions();
    expect(defaultOptions).not.toHaveProperty('mode');
    for (const key of ARTILLERY_KEYS) expect(defaultOptions).not.toHaveProperty(key);
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
