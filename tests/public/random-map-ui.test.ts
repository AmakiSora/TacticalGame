import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

// 页面模块头部是 ESM import（版本号 / 错误文案转换），VM Script 模式不支持，执行前剥离。
function loadSource(): string {
  return read('public/random-map-ui.js').replace(/^import\s+'[^']+';\s*$/gm, '');
}

function loadUI() {
  const context: Record<string, unknown> = { console, window: {} };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(loadSource(), context);
  return (context.window as { RandomMapUI: any }).RandomMapUI;
}

interface RowSpec {
  key: string;
  mode?: 'random' | 'fixed';
  /** data-default-mode：重置时回到哪一挡（缺省 random）。 */
  defaultMode?: 'random' | 'fixed';
  min?: string;
  max?: string;
  value?: string;
  /** 护栏提示文案（真实面板只给「建议固定」参数渲染该元素）。 */
  warn?: string;
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
    getAttribute: (name: string) => element.attrs[name] ?? null,
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

/** 按参数行的真实 DOM 层级造桩：head 里是取值方式滑动开关 + 区间/固定两组数字输入。 */
function makeRowStub(spec: RowSpec) {
  const rangeGroup = stubElement({ tagName: 'SPAN' });
  const fixedGroup = stubElement({ tagName: 'SPAN' });
  fixedGroup.classList.add('hidden');
  // 开关内的两半档位文字（随机/固定），is-active 跟随当前档。
  const optionRandom = stubElement({ tagName: 'SPAN', dataset: { value: 'random' } });
  const optionFixed = stubElement({ tagName: 'SPAN', dataset: { value: 'fixed' } });
  const toggle = stubElement({
    tagName: 'SPAN',
    dataset: { value: spec.mode ?? 'random' },
    querySelectorAll: (selector: string) =>
      selector === '.rmo-mode-option' ? [optionRandom, optionFixed] : [],
  });
  toggle.setAttribute('aria-checked', spec.mode === 'fixed' ? 'true' : 'false');
  if (spec.mode === 'fixed') optionFixed.classList.add('is-active');
  else optionRandom.classList.add('is-active');
  const inputs: Record<string, ReturnType<typeof stubElement>> = {
    '.rmo-mode-toggle': toggle,
    '.rmo-min': stubElement({ tagName: 'INPUT', type: 'number', value: spec.min ?? '' }),
    '.rmo-max': stubElement({ tagName: 'INPUT', type: 'number', value: spec.max ?? '' }),
    '.rmo-value': stubElement({ tagName: 'INPUT', type: 'number', value: spec.value ?? '' }),
    '.rmo-range-inputs': rangeGroup,
    '.rmo-fixed-input': fixedGroup,
    // 「建议固定」参数的护栏提示：固定挡隐藏、随机挡显示（与真实渲染同口径）。
    '.rmo-warn': stubElement({ tagName: 'SPAN' }),
    // 参数行内的「现值 X」回显位：服务端回传取值后由 applyPreviewValues 写入。
    '[data-param-value]': stubElement({ tagName: 'SPAN', hidden: true }),
  };
  // 真实输入框带 rmo-min / rmo-max 类：只填一端时按类名判断补哪一边。
  inputs['.rmo-min'].classList.add('rmo-min');
  inputs['.rmo-max'].classList.add('rmo-max');
  if (spec.mode === 'fixed' || !spec.warn) inputs['.rmo-warn'].classList.add('hidden');
  const row = stubElement({
    dataset: { key: spec.key, defaultMode: spec.defaultMode ?? 'random' },
    querySelector: (selector: string) => inputs[selector] ?? null,
  });
  // 行内元素都能沿 closest('.rmo-param') 找到所属行，与真实 DOM 语义保持一致。
  const toRow = (selector: string) => (selector === '.rmo-param' ? row : null);
  for (const element of Object.values(inputs)) element.closest = toRow;
  return { row, inputs, rangeGroup, fixedGroup, optionRandom, optionFixed };
}

/** 带 DOM 桩加载模块并跑 init，用于真跑 applyModeVisibility / collectRandomOptions / 事件接线。 */
function loadUIWithDom(mode: string, specs: RowSpec[]) {
  const hint = stubElement();
  const built = specs.map(makeRowStub);
  const rows = built.map(item => item.row);
  const allInputs = built.flatMap(item => Object.values(item.inputs));
  // 先用同一份源码取分组定义，再按组造 section 桩（head 可点、body 记录展开态的 hidden）。
  const bootstrap = loadUI();
  const groupStubs = (bootstrap.GROUPS as Array<{ key: string; defaultOpen?: boolean }>).map(group => {
    const expanded = group.defaultOpen !== false;
    const head = stubElement({ tagName: 'BUTTON', dataset: { group: group.key } });
    head.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    const body = stubElement({ tagName: 'DIV' });
    if (!expanded) body.classList.add('hidden');
    const section = stubElement({
      dataset: { group: group.key },
      querySelector: (selector: string) =>
        selector === '.rmo-group-head' ? head : selector === '.rmo-group-body' ? body : null,
    });
    return { group, section, head, body };
  });
  const sections = groupStubs.map(item => item.section);
  const toggleStubs = (bootstrap.TOGGLES as Array<{ key: string; default: boolean }>).map(toggle => {
    const input = stubElement({
      tagName: 'INPUT',
      type: 'checkbox',
      checked: toggle.default,
      dataset: { toggle: toggle.key, default: String(toggle.default) },
    });
    return { toggle, input };
  });
  const groupsToggle = stubElement({ tagName: 'BUTTON', textContent: '全部展开' });
  const container = stubElement({
    innerHTML: '',
    querySelectorAll: (selector: string) => {
      if (selector === '.rmo-param') return rows;
      if (selector === '.rmo-group') return sections;
      if (selector === '.rmo-group-head') return groupStubs.map(item => item.head);
      // 与真实 DOM 口径一致：input, select 只命中表单元素，开关 SPAN 不在内。
      if (selector === 'input, select') {
        return allInputs.filter(el => el.tagName === 'INPUT' || el.tagName === 'SELECT');
      }
      return [];
    },
  });
  const elements: Record<string, unknown> = {
    'rmo-symmetric': stubElement({ checked: true }),
    'rmo-seed': stubElement({ value: '' }),
    'rmo-seed-lock': stubElement({ tagName: 'BUTTON', textContent: '锁定' }),
    'rmo-preview-refresh': stubElement({ tagName: 'BUTTON', textContent: '换一张' }),
    'rmo-reset': stubElement({ tagName: 'BUTTON', textContent: '重置' }),
    'rmo-game-mode': stubElement({ value: mode }),
    'rmo-mode-hint': hint,
    'rmo-groups-toggle': groupsToggle,
    'random-map-options': container,
  };
  const documentStub = {
    getElementById: (id: string) => elements[id] ?? null,
    querySelectorAll: (selector: string) => {
      if (selector === '.rmo-param') return rows;
      if (selector === 'input[data-toggle]') return toggleStubs.map(item => item.input);
      return [];
    },
  };
  // applyPreviewValues 的换值高亮用定时器清类名：VM 里给个不排队的最小实现即可。
  const timers: Array<() => void> = [];
  const context: Record<string, unknown> = {
    console,
    window: {},
    document: documentStub,
    setTimeout: (fn: () => void) => { timers.push(fn); return timers.length; },
    clearTimeout: () => {},
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(loadSource(), context);
  const ui = (context.window as { RandomMapUI: any }).RandomMapUI;
  // 真跑一次 init：事件接线（折叠块、模式切换、数字输入变化）都在这里挂上。
  ui.init(container);
  const byKey = (key: string) => built.find(item => item.row.dataset.key === key)!;
  const hiddenOf = (key: string) => byKey(key).row.classList.contains('hidden');
  const groupOf = (key: string) => groupStubs.find(item => item.group.key === key)!;
  const byToggle = (key: string) => toggleStubs.find(item => item.toggle.key === key)!;
  const seedInput = elements['rmo-seed'] as ReturnType<typeof stubElement>;
  const seedLock = elements['rmo-seed-lock'] as ReturnType<typeof stubElement>;
  const panelRefresh = elements['rmo-preview-refresh'] as ReturnType<typeof stubElement>;
  const resetButton = elements['rmo-reset'] as ReturnType<typeof stubElement>;
  return {
    ui, container, hint, rows, byKey, hiddenOf, groupOf, allGroups: groupStubs, groupsToggle, byToggle,
    seedInput, seedLock, panelRefresh, resetButton, timers,
  };
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
  vm.runInContext(loadSource(), context);
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
      'supplyIncome', 'forwardBaseIncome', 'repairIncome',
      'forwardBaseDeployDiscount', 'repairPointRepairAmount',
      'comebackStartRound', 'comebackScoreGapPercent', 'comebackAmountPerRound',
      'startingUnitCount', 'startingWeightInfantry', 'startingWeightScout', 'startingWeightHeavy', 'startingWeightRanger',
      'infantryHp', 'infantryAttack', 'infantryDefense', 'infantryMoveRange', 'infantryAttackRange', 'infantryCost',
      'scoutHp', 'scoutAttack', 'scoutDefense', 'scoutMoveRange', 'scoutAttackRange', 'scoutCost',
      'heavyHp', 'heavyAttack', 'heavyDefense', 'heavyMoveRange', 'heavyAttackRange', 'heavyCost',
      'rangerHp', 'rangerAttack', 'rangerDefense', 'rangerMoveRange', 'rangerAttackRange', 'rangerCost',
      'supportHp', 'supportAttack', 'supportDefense', 'supportMoveRange', 'supportAttackRange', 'supportCost', 'supportHealPower', 'supportHealRange',
      'damageVarianceRange', 'healVarianceRange', 'minimumDamage',
      'adjudicationArmyValue', 'adjudicationKillValue', 'adjudicationControlPointFlowRatio',
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

  it('groups every parameter into collapsible sections', () => {
    const ui = loadUI();
    const groups = ui.GROUPS as Array<{ key: string; label: string; defaultOpen?: boolean }>;
    expect(groups.map(group => group.key)).toEqual([
      'map', 'economy', 'army', 'stats', 'combat', 'headquarters', 'artillery',
    ]);
    // 每项参数恰好属于一组（不重不漏）：66 个数字参数 + 5 个布尔开关。
    const members: Array<{ key: string; group?: string }> = [
      ...(ui.PARAMS as Array<{ key: string; group?: string }>),
      ...(ui.TOGGLES as Array<{ key: string; group?: string }>),
    ];
    expect(members).toHaveLength(71);
    const membership = new Map<string, string>();
    for (const param of members) {
      expect(param.group, `${param.key} 缺分组`).toBeTruthy();
      expect(membership.has(param.key), `${param.key} 重复参数`).toBe(false);
      membership.set(param.key, param.group as string);
    }
    expect(new Set(membership.values())).toEqual(new Set(groups.map(group => group.key)));
    const counts: Record<string, number> = {};
    for (const group of groups) {
      counts[group.key] = members.filter(param => param.group === group.key).length;
    }
    expect(counts).toEqual({ map: 4, economy: 17, army: 5, stats: 33, combat: 6, headquarters: 2, artillery: 4 });

    // 面板 HTML：每组一个折叠块，块头带 aria 属性与项数，参数行都渲染在自己组内。
    const html = capturePanelHtml('standard');
    const sections = html.split('<section class="rmo-group"');
    for (const group of groups) {
      expect(html, `${group.key} 缺分组块`).toContain(`class="rmo-group" data-group="${group.key}"`);
      expect(html, `${group.key} 缺 aria-controls`).toContain(`aria-controls="rmo-group-${group.key}"`);
      const block = sections.find(part => part.startsWith(` data-group="${group.key}"`)) ?? '';
      for (const param of (ui.PARAMS as Array<{ key: string; group: string }>)
        .filter(item => item.group === group.key)) {
        expect(block, `${param.key} 不在 ${group.key} 组内`).toContain(`data-key="${param.key}"`);
      }
    }
    expect(html).toContain('id="rmo-groups-toggle"');
    // 只有 32 项的「兵种属性」默认收起，其余组默认展开。
    expect(html).toContain('class="rmo-group-body rmo-grid hidden" id="rmo-group-stats"');
    expect(html).toContain('aria-expanded="true" aria-controls="rmo-group-map"');
    expect(html).toContain('aria-expanded="false" aria-controls="rmo-group-stats"');
    // 兵种属性组内按兵种分小标题。
    for (const label of ['步兵', '侦察兵', '重装', '远程兵', '辅助']) {
      expect(html, `缺 ${label} 小标题`).toContain(`class="rmo-subgroup-label" data-subgroup="${label}"`);
    }
  });

  it('renders boolean toggles that submit only when flipped from the default', () => {
    const ui = loadUI();
    const toggles = ui.TOGGLES as Array<{ key: string; label: string; group: string; default: boolean }>;
    expect(toggles.map(toggle => toggle.key)).toEqual([
      'deployFromHq', 'supplyCanDeploy', 'forwardBaseCanDeploy', 'repairCanDeploy', 'noTurnLimit',
    ]);
    for (const toggle of toggles) expect(toggle.label, `${toggle.key} 缺标签`).toBeTruthy();
    const html = capturePanelHtml('standard');
    for (const toggle of toggles) {
      expect(html, `${toggle.key} 缺开关行`).toContain(`class="rmo-param rmo-param-toggle" data-key="${toggle.key}"`);
      expect(html, `${toggle.key} 缺开关输入`).toContain(`data-toggle="${toggle.key}"`);
    }
    expect(html).toContain('data-default="true"');
    expect(html).toContain('data-default="false"');
    // 默认态（允许总部部署 / 有回合上限）不写入 random 字段；翻动后只提交翻动的那一项。
    const scoped = loadUIWithDom('standard', []);
    expect(scoped.ui.collectRandomOptions()).toEqual({ mode: 'standard' });
    scoped.byToggle('deployFromHq').input.checked = false;
    expect(scoped.ui.collectRandomOptions()).toEqual({ mode: 'standard', deployFromHq: false });
    scoped.byToggle('noTurnLimit').input.checked = true;
    scoped.byToggle('supplyCanDeploy').input.checked = false;
    scoped.byToggle('repairCanDeploy').input.checked = false;
    expect(scoped.ui.collectRandomOptions()).toEqual({
      mode: 'standard', deployFromHq: false, noTurnLimit: true,
      supplyCanDeploy: false, repairCanDeploy: false,
    });
  });

  it('opens playability-critical rows in fixed mode and warns on random ranges', () => {
    const ui = loadUI();
    const fixedKeys = (ui.PARAMS as Array<{ key: string; defaultMode?: string }>)
      .filter(param => param.defaultMode === 'fixed')
      .map(param => param.key);
    expect(fixedKeys).toEqual([
      'forwardBaseDeployDiscount', 'repairPointRepairAmount',
      'startingWeightInfantry', 'startingWeightScout', 'startingWeightHeavy', 'startingWeightRanger',
      'damageVarianceRange', 'healVarianceRange', 'minimumDamage',
    ]);
    const html = capturePanelHtml('standard');
    for (const key of fixedKeys) {
      expect(html, `${key} 未默认固定挡`).toContain(`data-key="${key}" data-default-mode="fixed"`);
    }
    expect(html, '默认随机参数不该被改成固定挡').toContain('data-key="radius" data-default-mode="random"');
    // 三个战斗参数带随机挡护栏提示（默认固定挡下隐藏）。
    expect(html).toContain('class="rmo-warn hidden"');
    expect(html).toContain('随机区间会抹平兵种攻击差');
    expect(html).toContain('随机区间会盖过兵种攻击差');
    // 切挡：固定→随机时提示亮出，随机→固定时收起。
    const scoped = loadUIWithDom('standard', [
      { key: 'minimumDamage', mode: 'fixed', warn: '随机区间会抹平兵种攻击差，建议保持固定' },
    ]);
    const item = scoped.byKey('minimumDamage');
    const warn = item.inputs['.rmo-warn'];
    expect(warn.classList.contains('hidden')).toBe(true);
    item.inputs['.rmo-mode-toggle'].fire('click');
    expect(item.inputs['.rmo-mode-toggle'].dataset.value).toBe('random');
    expect(warn.classList.contains('hidden')).toBe(false);
    item.inputs['.rmo-mode-toggle'].fire('click');
    expect(warn.classList.contains('hidden')).toBe(true);
  });

  it('collapses and expands parameter groups without dropping their values', () => {
    const scoped = loadUIWithDom('standard', [
      { key: 'radius', min: '6', max: '9' },
      { key: 'damageVarianceRange', mode: 'fixed', value: '5' },
    ]);
    const stats = scoped.groupOf('stats');
    // 兵种属性默认收起；点组头展开，再点一次收起。
    expect(stats.head.getAttribute('aria-expanded')).toBe('false');
    expect(stats.body.classList.contains('hidden')).toBe(true);
    expect(stats.head.fire('click'), '组标题没挂 click 监听').toBeGreaterThan(0);
    expect(stats.head.getAttribute('aria-expanded')).toBe('true');
    expect(stats.body.classList.contains('hidden')).toBe(false);
    stats.head.fire('click');
    expect(stats.head.getAttribute('aria-expanded')).toBe('false');
    // 收起只是视图状态：组内参数照常提交。
    expect(scoped.ui.collectRandomOptions().damageVarianceRange).toBe(5);
    // 「全部展开 / 全部收起」：按钮文案跟随状态，所有组同步切换。
    expect(scoped.groupsToggle.textContent).toBe('全部展开');
    expect(scoped.groupsToggle.fire('click'), '全部展开按钮没挂 click 监听').toBeGreaterThan(0);
    for (const item of scoped.allGroups) {
      expect(item.head.getAttribute('aria-expanded'), `${item.group.key} 未展开`).toBe('true');
      expect(item.body.classList.contains('hidden'), `${item.group.key} 仍收起`).toBe(false);
    }
    expect(scoped.groupsToggle.textContent).toBe('全部收起');
    scoped.groupsToggle.fire('click');
    expect(scoped.groupsToggle.textContent).toBe('全部展开');
    for (const item of scoped.allGroups) {
      expect(item.head.getAttribute('aria-expanded'), `${item.group.key} 未收起`).toBe('false');
    }
  });

  it('hides whole mode-specific groups instead of leaving empty headers', () => {
    const groupHidden = (scoped: ReturnType<typeof loadUIWithDom>, key: string) =>
      scoped.groupOf(key).section.classList.contains('hidden');
    const standard = loadUIWithDom('standard', []);
    expect(groupHidden(standard, 'artillery'), '标准模式不应出现炮火组').toBe(true);
    expect(groupHidden(standard, 'headquarters')).toBe(false);
    expect(groupHidden(standard, 'stats')).toBe(false);
    const annihilation = loadUIWithDom('annihilation', []);
    expect(groupHidden(annihilation, 'artillery')).toBe(false);
    expect(groupHidden(annihilation, 'headquarters'), '歼灭模式不应出现总部组').toBe(true);
    expect(groupHidden(annihilation, 'map')).toBe(false);
  });

  it('renders number inputs that show the server bounds on every parameter', async () => {
    const { RANDOM_PARAM_BOUNDS } = await import('../../src/config/randomMap.js');
    const ui = loadUI();
    const html = capturePanelHtml('standard');
    for (const param of ui.PARAMS as Array<{ key: string; min: number; max: number; step: number }>) {
      // 每个参数一行数字输入，量程/步长＝服务端硬边界。
      expect(html, `${param.key} 缺参数行`).toContain(`class="rmo-param" data-key="${param.key}"`);
      expect(html, `${param.key} 量程与服务端不一致`).toContain(`min="${param.min}" max="${param.max}" step="${param.step}"`);
      const bound = RANDOM_PARAM_BOUNDS[param.key];
      expect(bound, `${param.key} 服务端无此参数边界`).toBeDefined();
      expect({ min: param.min, max: param.max, integer: param.step >= 1 })
        .toEqual({ min: bound.min, max: bound.max, integer: bound.integer });
      // 可选上下限作为输入框灰字（placeholder）直接可见，不再单独占一列「范围」。
      expect(html, `${param.key} 缺下限灰字`).toContain(`placeholder="≥${param.min}"`);
      expect(html, `${param.key} 缺上限灰字`).toContain(`placeholder="≤${param.max}"`);
      // 固定挡的单个输入框灰字显示整段可选范围。
      expect(html, `${param.key} 固定值缺范围灰字`).toContain(`placeholder="范围 ${param.min}–${param.max}"`);
    }
    // 独立的「范围」标签已移除：上下限只以输入框灰字呈现。
    expect(html).not.toContain('class="rmo-bounds"');
    // 兼容入口保留：滑块移除后 refreshSliders 仍是可调用的空操作。
    expect(typeof ui.refreshSliders).toBe('function');
    // 滑块彻底退场：源码里不能再有滑块实现或 type="range" 残留。
    const source = read('public/random-map-ui.js');
    expect(source).not.toContain('rmo-slider');
    expect(source).not.toContain('type="range"');
    expect(source).not.toContain('syncSlider');
  });

  it('collects the submitted range from the numeric inputs alone', () => {
    // 区间模式：min/max 成对提交；只填一端时另一端按默认范围补上（仍是区间，不会变成固定值）；
    // 两端都留空＝不提交、由服务端按默认范围随机。
    const ranged = loadUIWithDom('standard', [{ key: 'radius', min: '6', max: '9' }]);
    expect(ranged.ui.collectRandomOptions().radius).toEqual([6, 9]);
    const onlyMin = loadUIWithDom('standard', [{ key: 'radius', min: '6', max: '' }]);
    expect(onlyMin.ui.collectRandomOptions().radius).toEqual([6, 10]); // 10 = 默认范围上界
    const onlyMax = loadUIWithDom('standard', [{ key: 'radius', min: '', max: '8' }]);
    expect(onlyMax.ui.collectRandomOptions().radius).toEqual([5, 8]); // 5 = 默认范围下界
    const empty = loadUIWithDom('standard', [{ key: 'radius' }]);
    expect(empty.ui.collectRandomOptions()).not.toHaveProperty('radius');

    // 只填一端后失焦：另一端自动填进输入框，用户看得见这段区间。
    const fillSibling = loadUIWithDom('standard', [{ key: 'radius', min: '6', max: '' }]);
    const radiusItem = fillSibling.byKey('radius');
    radiusItem.inputs['.rmo-min'].fire('change');
    expect(radiusItem.inputs['.rmo-max'].value).toBe('10');
    expect(fillSibling.ui.collectRandomOptions().radius).toEqual([6, 10]);

    // 固定模式：只读 .rmo-value，区间输入即使仍挂着值也不参与提交。
    const fixed = loadUIWithDom('standard', [{ key: 'radius', mode: 'fixed', min: '6', max: '9', value: '7' }]);
    expect(fixed.ui.collectRandomOptions().radius).toBe(7);

    // 数字输入直接排程预览：change 与 input 都已接线（不再经过滑块同步）。
    const item = ranged.byKey('radius');
    expect(item.inputs['.rmo-min'].fire('change'), '数字输入没挂 change 监听').toBeGreaterThan(0);
    expect(item.inputs['.rmo-min'].fire('input'), '数字输入没挂 input 监听').toBeGreaterThan(0);
    // 兼容入口仍可安全调用（无副作用）。
    expect(() => ranged.ui.refreshSliders()).not.toThrow();
  });

  it('switches between range inputs and the fixed input through the sliding toggle', () => {
    const scoped = loadUIWithDom('standard', [{ key: 'radius', min: '6', max: '9' }]);
    const item = scoped.byKey('radius');
    const toggle = item.inputs['.rmo-mode-toggle'];
    // 默认随机档：区间输入可见、固定输入隐藏，滑块停在左半。
    expect(item.rangeGroup.classList.contains('hidden')).toBe(false);
    expect(item.fixedGroup.classList.contains('hidden')).toBe(true);
    expect(toggle.dataset.value).toBe('random');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(item.optionRandom.classList.contains('is-active')).toBe(true);
    expect(item.optionFixed.classList.contains('is-active')).toBe(false);
    // 点一下滑到固定：区间输入隐藏、固定输入显示，收集走 .rmo-value。
    expect(toggle.fire('click'), '取值方式开关没挂 click 监听').toBeGreaterThan(0);
    expect(toggle.dataset.value).toBe('fixed');
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(item.optionFixed.classList.contains('is-active')).toBe(true);
    expect(item.optionRandom.classList.contains('is-active')).toBe(false);
    expect(item.rangeGroup.classList.contains('hidden')).toBe(true);
    expect(item.fixedGroup.classList.contains('hidden')).toBe(false);
    // 再点一下滑回随机：两组显隐还原。
    toggle.fire('click');
    expect(toggle.dataset.value).toBe('random');
    expect(item.rangeGroup.classList.contains('hidden')).toBe(false);
    expect(item.fixedGroup.classList.contains('hidden')).toBe(true);
    // 键盘同样可切换（role="switch" 的可达性要求）。
    toggle.fire('keydown', { key: 'Enter' });
    expect(toggle.dataset.value).toBe('fixed');
    expect(item.fixedGroup.classList.contains('hidden')).toBe(false);
    toggle.fire('keydown', { key: ' ' });
    expect(toggle.dataset.value).toBe('random');
    expect(item.fixedGroup.classList.contains('hidden')).toBe(true);
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
    // 初始军队：数量按整数取整，权重允许 0.5 步长的小数、越界钳回 0-10。
    const count = loadUIWithDom('standard', [{ key: 'startingUnitCount', mode: 'fixed', value: '2.6' }]);
    expect(count.ui.collectRandomOptions().startingUnitCount).toBe(3);
    const weight = loadUIWithDom('standard', [{ key: 'startingWeightHeavy', mode: 'fixed', value: '1.5' }]);
    expect(weight.ui.collectRandomOptions().startingWeightHeavy).toBe(1.5);
    const weightClamped = loadUIWithDom('standard', [{ key: 'startingWeightHeavy', mode: 'fixed', value: '99' }]);
    expect(weightClamped.ui.collectRandomOptions().startingWeightHeavy).toBe(10);
    // 3.6.2 新增参数同样提交前钳位（战斗波动 / 据点收入 / 兵种属性）。
    const variance = loadUIWithDom('standard', [{ key: 'damageVarianceRange', mode: 'fixed', value: '999' }]);
    expect(variance.ui.collectRandomOptions().damageVarianceRange).toBe(8);
    const income = loadUIWithDom('standard', [{ key: 'supplyIncome', min: '5', max: '999' }]);
    expect(income.ui.collectRandomOptions().supplyIncome).toEqual([5, 40]);
    const attack = loadUIWithDom('standard', [{ key: 'infantryAttack', mode: 'fixed', value: '0' }]);
    expect(attack.ui.collectRandomOptions().infantryAttack).toBe(1);
  });

  it('submits starting army count and per-type weights together', () => {
    // 初始单位数是首次暴露的面板行；兵种权重 4 行与其同组，全部模式可见。
    const specs: RowSpec[] = [
      { key: 'startingUnitCount', min: '3', max: '' },
      { key: 'startingWeightInfantry', min: '4', max: '8' },
      { key: 'startingWeightScout', mode: 'fixed', value: '2' },
      { key: 'startingWeightHeavy', mode: 'fixed', value: '0' },
      { key: 'startingWeightRanger', min: '', max: '' },
    ];
    for (const mode of ['standard', 'annihilation', 'simultaneous', 'royale']) {
      const scoped = loadUIWithDom(mode, specs);
      const options = scoped.ui.collectRandomOptions();
      expect(options.startingUnitCount, `${mode} 数量区间（上限按默认范围补 4）`).toEqual([3, 4]);
      expect(options.startingWeightInfantry, `${mode} 步兵区间`).toEqual([4, 8]);
      expect(options.startingWeightScout, `${mode} 侦察兵标量`).toBe(2);
      expect(options.startingWeightHeavy, `${mode} 重装标量`).toBe(0);
      expect(options, `${mode} 全空的远程兵权重不提交`).not.toHaveProperty('startingWeightRanger');
    }
  });

  it('submits the new tuning rows in every game mode', () => {
    // 战斗波动 / 裁决权重 / 据点收入 / 兵种属性都不限模式：四种模式下都可见、都按取值方式提交。
    const specs: RowSpec[] = [
      { key: 'damageVarianceRange', mode: 'fixed', value: '5' },
      { key: 'healVarianceRange', min: '2', max: '8' },
      { key: 'adjudicationArmyValue', mode: 'fixed', value: '3' },
      { key: 'supplyIncome', min: '10', max: '20' },
      { key: 'forwardBaseIncome', mode: 'fixed', value: '4' },
      { key: 'repairIncome', mode: 'fixed', value: '0' },
      { key: 'infantryAttack', mode: 'fixed', value: '45' },
      { key: 'heavyMoveRange', min: '2', max: '3' },
    ];
    for (const mode of ['standard', 'annihilation', 'simultaneous', 'royale']) {
      const scoped = loadUIWithDom(mode, specs);
      const options = scoped.ui.collectRandomOptions();
      expect(options.damageVarianceRange, `${mode} 伤害波动`).toBe(5);
      expect(options.healVarianceRange, `${mode} 治疗波动`).toEqual([2, 8]);
      expect(options.adjudicationArmyValue, `${mode} 裁决权重`).toBe(3);
      expect(options.supplyIncome, `${mode} 补给站收入`).toEqual([10, 20]);
      expect(options.forwardBaseIncome, `${mode} 前哨收入`).toBe(4);
      expect(options.repairIncome, `${mode} 维修收入`).toBe(0);
      expect(options.infantryAttack, `${mode} 步兵攻击`).toBe(45);
      expect(options.heavyMoveRange, `${mode} 重装移动力`).toEqual([2, 3]);
    }
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

  it('echoes every parameter’s resolved value inside its own row', () => {
    const html = capturePanelHtml('standard');
    // 参数行里有「现值 X」回显位，种子行里有锁定按钮。
    expect(html).toContain('data-param-value');
    expect(html).toContain('class="rmo-param-name"');
    expect(html).toContain('id="rmo-seed-lock"');
    expect(html).toContain('id="rmo-reset"');

    const scoped = loadUIWithDom('standard', [
      { key: 'radius', min: '6', max: '9' },
      { key: 'waterDensity' },
      { key: 'maxTurns' },
      { key: 'unitStatVariation' },
      { key: 'infantryHp' },
      { key: 'supplyIncome' },
      { key: 'startingWeightHeavy', mode: 'fixed', value: '1.5' },
      { key: 'artilleryDamage' },
      { key: 'comebackStartRound' },
      { key: 'scoutDefense' },
    ]);
    const slotOf = (key: string) => scoped.byKey(key).inputs['[data-param-value]'];
    expect(slotOf('radius').hidden).toBe(true);

    scoped.ui.applyPreviewValues({
      radius: 8,
      waterDensity: 0.0625,
      maxTurns: null,
      unitStatVariation: 0.183,
      infantryHp: 118,
      supplyIncome: 12,
      startingWeightHeavy: 1.5,
      artilleryDamage: null,
      comebackStartRound: null,
    });
    // 整数取整、小数一律四位（与服务端同精度），显示值就是地图实际用的值。
    expect(slotOf('radius').textContent).toBe('现值 8');
    expect(slotOf('waterDensity').textContent).toBe('现值 0.0625');
    expect(slotOf('unitStatVariation').textContent).toBe('现值 0.183');
    expect(slotOf('infantryHp').textContent).toBe('现值 118');
    expect(slotOf('supplyIncome').textContent).toBe('现值 12');
    expect(slotOf('startingWeightHeavy').textContent).toBe('现值 1.5');
    // 无回合上限＝∞；未注入的追赶补给 / 当前模式没有的炮火＝未启用。
    expect(slotOf('maxTurns').textContent).toBe('现值 ∞');
    expect(slotOf('comebackStartRound').textContent).toBe('现值 未启用');
    expect(slotOf('artilleryDamage').textContent).toBe('现值 未启用');
    // 服务端没回传取值的行保持隐藏，不编造数字。
    expect(slotOf('scoutDefense').hidden).toBe(true);
    expect(slotOf('radius').hidden).toBe(false);
    expect(slotOf('radius').title).toContain('地图半径');

    // 换一张后变化过的值闪一下，没变的行不动。
    scoped.ui.applyPreviewValues({
      radius: 9,
      waterDensity: 0.0625,
      maxTurns: null,
      unitStatVariation: 0.183,
      infantryHp: 118,
      supplyIncome: 12,
      startingWeightHeavy: 1.5,
      artilleryDamage: null,
      comebackStartRound: null,
    });
    expect(slotOf('radius').classList.contains('is-changed')).toBe(true);
    expect(slotOf('infantryHp').classList.contains('is-changed')).toBe(false);
    expect(slotOf('radius').textContent).toBe('现值 9');
  });

  it('locks the seed so 换一张 stops reshuffling a reproducible map', () => {
    const scoped = loadUIWithDom('standard', [{ key: 'radius' }]);
    // 还没生成过预览：没有可锁的种子，锁按钮不可用。
    expect(scoped.seedLock.disabled).toBe(true);
    scoped.ui.lastSeed = 'abc123';
    scoped.ui.syncSeedLockState();
    expect(scoped.seedLock.disabled).toBe(false);
    expect(scoped.seedLock.getAttribute('aria-pressed')).toBe('false');

    // 锁定：种子回填进输入框并转只读，换一张按钮禁用。
    expect(scoped.seedLock.fire('click'), '种子锁没挂 click 监听').toBeGreaterThan(0);
    expect(scoped.ui.seedLocked).toBe(true);
    expect(scoped.seedInput.value).toBe('abc123');
    expect(scoped.seedInput.readOnly).toBe(true);
    expect(scoped.seedLock.getAttribute('aria-pressed')).toBe('true');
    expect(scoped.seedLock.textContent).toBe('已锁定');
    expect(scoped.panelRefresh.disabled).toBe(true);
    expect(scoped.seedLock.title).toContain('解锁');

    // 锁定时「换一张」被挡住：种子保持不动，这张图仍可复现。
    expect(scoped.ui.reroll()).toBe(false);
    expect(scoped.seedInput.value).toBe('abc123');

    // 解锁后恢复原行为：换一张清空种子重新抽。
    scoped.seedLock.fire('click');
    expect(scoped.ui.seedLocked).toBe(false);
    expect(scoped.seedInput.readOnly).toBe(false);
    expect(scoped.panelRefresh.disabled).toBe(false);
    expect(scoped.ui.reroll()).toBe(true);
    expect(scoped.seedInput.value).toBe('');
  });

  it('backfills the current value when a row is switched to 固定, so it really locks', () => {
    const scoped = loadUIWithDom('standard', [
      { key: 'infantryHp', min: '80', max: '120' },
      { key: 'waterDensity' },
      { key: 'comebackStartRound' },
      { key: 'damageVarianceRange', mode: 'fixed', value: '5' },
    ]);
    scoped.ui.applyPreviewValues({
      infantryHp: 118,
      waterDensity: 0.0241697,
      comebackStartRound: null,
      damageVarianceRange: 3,
    });
    // 默认固定挡、用户已经填过的值不被覆盖。
    expect(scoped.byKey('damageVarianceRange').inputs['.rmo-value'].value).toBe('5');

    // 随机 → 固定：把当前现值填进固定输入框，这一行才会真的作为常量提交。
    const hp = scoped.byKey('infantryHp');
    expect(scoped.ui.collectRandomOptions().infantryHp).toEqual([80, 120]);
    hp.inputs['.rmo-mode-toggle'].fire('click');
    expect(hp.inputs['.rmo-mode-toggle'].dataset.value).toBe('fixed');
    expect(hp.inputs['.rmo-value'].value).toBe('118');
    expect(scoped.ui.collectRandomOptions().infantryHp).toBe(118);

    // 小数参数按服务端钳位精度回填（四位小数），回填值就是提交值。
    const water = scoped.byKey('waterDensity');
    water.inputs['.rmo-mode-toggle'].fire('click');
    expect(water.inputs['.rmo-value'].value).toBe('0.0242');
    expect(scoped.ui.collectRandomOptions().waterDensity).toBe(0.0242);

    // 本图没有这一项（未启用）时没有可回填的数值，保持留空。
    const comeback = scoped.byKey('comebackStartRound');
    comeback.inputs['.rmo-mode-toggle'].fire('click');
    expect(comeback.inputs['.rmo-value'].value).toBe('');
    expect(scoped.ui.collectRandomOptions()).not.toHaveProperty('comebackStartRound');

    // 用户手动填过的值优先：切挡不会把它改成新掷出来的数。
    const typed = loadUIWithDom('standard', [{ key: 'infantryHp' }]);
    typed.ui.applyPreviewValues({ infantryHp: 118 });
    typed.byKey('infantryHp').inputs['.rmo-value'].value = '90';
    typed.byKey('infantryHp').inputs['.rmo-mode-toggle'].fire('click');
    expect(typed.byKey('infantryHp').inputs['.rmo-value'].value).toBe('90');
    expect(typed.ui.collectRandomOptions().infantryHp).toBe(90);
  });

  it('resets every parameter back to its default empty state in one click', () => {
    const scoped = loadUIWithDom('standard', [
      { key: 'radius', min: '6', max: '9' },
      { key: 'infantryHp', min: '90', max: '130' },
      { key: 'damageVarianceRange', mode: 'random', defaultMode: 'fixed', value: '5', warn: '随机区间会抹平兵种攻击差，建议保持固定' },
    ]);
    scoped.ui.applyPreviewValues({ radius: 8, infantryHp: 100, damageVarianceRange: 3 });
    const radius = scoped.byKey('radius');
    const variance = scoped.byKey('damageVarianceRange');
    expect(variance.inputs['.rmo-warn'].classList.contains('hidden')).toBe(false);
    scoped.byToggle('deployFromHq').input.checked = false;
    scoped.byToggle('noTurnLimit').input.checked = true;

    expect(scoped.resetButton.fire('click'), '重置按钮没挂 click 监听').toBeGreaterThan(0);
    // 所有输入清空、现值收起。
    expect(radius.inputs['.rmo-min'].value).toBe('');
    expect(radius.inputs['.rmo-max'].value).toBe('');
    expect(radius.inputs['.rmo-value'].value).toBe('');
    expect(radius.inputs['[data-param-value]'].hidden).toBe(true);
    expect(radius.inputs['[data-param-value]'].textContent).toBe('');
    // 取值方式回到各自的默认挡，对应的输入组 / 护栏提示一起归位。
    expect(variance.inputs['.rmo-mode-toggle'].dataset.value).toBe('fixed');
    expect(variance.inputs['.rmo-range-inputs'].classList.contains('hidden')).toBe(true);
    expect(variance.inputs['.rmo-fixed-input'].classList.contains('hidden')).toBe(false);
    expect(variance.inputs['.rmo-warn'].classList.contains('hidden')).toBe(true);
    // 布尔开关回到默认值。
    expect(scoped.byToggle('deployFromHq').input.checked).toBe(true);
    expect(scoped.byToggle('noTurnLimit').input.checked).toBe(false);
    // 全部回到「留空＝默认」：提交的 random 字段只剩模式。
    expect(scoped.ui.collectRandomOptions()).toEqual({ mode: 'standard' });
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
      // 分组折叠块与兵种小标题两端都要有样式，否则其中一端会退化成一条长列表。
      expect(css, `${path} 缺 .rmo-group 样式`).toContain('.rmo-group');
      expect(css, `${path} 缺 .rmo-subgroup-label 样式`).toContain('.rmo-subgroup-label');
      // 参数行固定单行网格（名称 / 开关 / 输入框），输入框等宽、上下限收进灰字；
      // 防止回退成两行或 flex 换行的参差布局，也防止「范围」列重新长出来。
      expect(css, `${path} 缺参数行单行网格布局`).toContain('grid-template-columns: 88px auto minmax(0, 1fr)');
      expect(css, `${path} 不应再有独立范围列样式`).not.toContain('.rmo-bounds');
      // 「本图 X」回显与种子锁：桌面/手机两端样式表都要有，否则其中一端会退化成隐形数字。
      expect(css, `${path} 缺本图取值样式`).toContain('.rmo-param-value');
      expect(css, `${path} 缺换值高亮样式`).toContain('.rmo-param-value.is-changed');
      expect(css, `${path} 缺种子锁样式`).toContain('.rmo-seed-lock');
      expect(css, `${path} 缺重置按钮样式`).toContain('.rmo-reset');
      expect(css, `${path} 缺换一张禁用样式`).toContain('.rmo-preview-refresh:disabled');
      // 窄屏档：压缩名称列与间距，保证四位数上限（≤9999）的灰字在 360px 下完整可见。
      expect(css, `${path} 缺窄屏压缩档`).toContain('@media (max-width: 420px)');
      expect(css, `${path} 缺窄屏名称列压缩`).toContain('grid-template-columns: 68px auto minmax(0, 1fr)');
    }
  });

  it('wires the random map panel into the desktop play page', () => {
    const html = read('public/play.html');
    const source = read('public/play.js');

    expect(html).toContain('id="random-map-options"');
    expect(html).toContain('<option value="random">随机地图</option>');
    // 弹层右侧的「换一张」也走模块入口（种子锁定时同步禁用）。
    expect(html).toContain('data-random-refresh');
    expect(source).toContain('window.RandomMapUI?.reroll(true)');
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
    // 弹层右侧的「换一张」也走模块入口（种子锁定时同步禁用）。
    expect(html).toContain('data-random-refresh');
    expect(source).toContain('window.RandomMapUI?.reroll(true)');
    // random-map-ui 由客户端入口以 ESM import 引入（不再直接以 script 标签加载）。
    expect(source).toContain("import './random-map-ui.js';");
    expect(source).toContain('window.RandomMapUI?.renderRandomMapCard');
    expect(source).toContain('window.RandomMapUI.collectRandomOptions()');
    expect(source).toContain("els.mapSelect.value === 'random'");
    expect(source).toContain("selected === 'random'");
    expect(source).toContain('window.RandomMapUI?.setPreviewRenderer(renderMapPreview)');
  });
});
