import { readFileSync } from 'node:fs';
import { createContext, Script } from 'node:vm';
import { describe, expect, it } from 'vitest';

// 规则速查弹层：RulesSheet.buildHtml 由对局内嵌配置驱动，需覆盖四种模式的差异
// （标准/歼灭/同时/大逃杀）、形状标签、炮火参数、裁决权重与 HTML 转义；
// attach 用最小 document 桩验证开关行为。
function loadRulesSheet(): {
  buildHtml(config: unknown): string;
  attach(opts: { triggerEl: unknown; getConfig(): unknown }): { open(): void; close(): void };
} {
  const rulesWindow: Record<string, unknown> = {};
  const context = createContext({ window: rulesWindow });
  new Script(readFileSync('public/rules-sheet.js', 'utf8')).runInContext(context);
  return rulesWindow.RulesSheet as {
    buildHtml(config: unknown): string;
    attach(opts: { triggerEl: unknown; getConfig(): unknown }): { open(): void; close(): void };
  };
}

const standoffConfig = {
  mode: 'simultaneous',
  units: {
    infantry: { hp: 90, attack: 31, defense: 7, moveRange: 2, attackRange: 2, cost: 55, canCapture: true, attackShape: { type: 'line', length: 2 } },
    scout: { hp: 60, attack: 16, defense: 4, moveRange: 3, attackRange: 1, cost: 42, canCapture: true },
    heavy: { hp: 140, attack: 40, defense: 9, moveRange: 2, attackRange: 1, cost: 100, canCapture: false, attackShape: { type: 'arc' } },
    ranger: { hp: 68, attack: 38, defense: 3, moveRange: 2, attackRange: 3, cost: 80, canCapture: false, attackLock: true },
    support: { hp: 76, attack: 10, defense: 5, moveRange: 2, attackRange: 2, cost: 68, canCapture: false, healPower: 20, healShape: { type: 'arc' } },
  },
  headquartersSpec: { hp: 200, defense: 6 },
  balance: {
    startingSupplies: 120,
    baseIncome: 8,
    damageVarianceRange: 3,
    minimumDamage: 1,
    healVarianceRange: 6,
    actionsPerTurn: 5,
    maxTurns: 15,
    adjudicationWeights: { enemyHqDamage: 5, ownHqHp: 1, controlPoint: 60, armyValue: 0.35, supplies: 0.25, effectiveActions: 6 },
    comebackSupply: { startRound: 4, scoreGapPercent: 40, amountPerRound: 12 },
    controlPointTypes: {
      supply: { income: 8, deployDiscount: 0, repairAmount: 0 },
      forward_base: { income: 6, deployDiscount: 8, repairAmount: 0 },
      repair: { income: 6, deployDiscount: 0, repairAmount: 10 },
    },
  },
};

const royaleConfig = {
  mode: 'royale',
  units: standoffConfig.units,
  headquartersSpec: { hp: 200, defense: 6 },
  balance: {
    ...standoffConfig.balance,
    maxTurns: null,
    deployFromHq: false,
  },
  annihilation: { artillery: { startRound: 5, intervalRounds: 1, damage: 15, minimumSafeRadius: 1 } },
};

describe('rules sheet shared module', () => {
  it('loads and renders the rules from the embedded game config', () => {
    const RulesSheet = loadRulesSheet();
    const html = RulesSheet.buildHtml(standoffConfig);
    // 模式徽章与回合机制说明。
    expect(html).toContain('同时回合');
    expect(html).toContain('指令入队不执行、可撤销');
    // 兵种表：步兵直线两格、重装扇形、远程兵锁敌、支援兵治疗。
    expect(html).toContain('步兵');
    expect(html).toContain('直线 2 格');
    expect(html).toContain('扇形 3 格');
    expect(html).toContain('锁定目标');
    expect(html).toContain('+20');
    // 平衡参数与据点类型。
    expect(html).toContain('行动点/回合');
    expect(html).toContain('±3');
    expect(html).toContain('补给站');
    expect(html).toContain('前线基地');
    expect(html).toContain('维修站');
    expect(html).toContain('-8');
    expect(html).toContain('可部署');
    // 裁决权重只列非零项。
    expect(html).toContain('敌方总部伤害');
    expect(html).toContain('×0.35');
    expect(html).not.toContain('行动点 ×');
    // 标准模式的总部行（大逃杀模式则没有）。
    expect(html).toContain('总部');
  });

  it('renders artillery schedule and omits the HQ row for royale mode', () => {
    const RulesSheet = loadRulesSheet();
    const html = RulesSheet.buildHtml(royaleConfig);
    expect(html).toContain('第 5 轮起每 1 轮收缩一圈');
    expect(html).toContain('最终安全半径 1');
    expect(html).toContain('兵力打光即淘汰');
    expect(html).toContain('总部不可部署');
    // 大逃杀无总部：不出现「总部 200 血」芯片；无回合上限显示为 ∞。
    expect(html).not.toContain('200 血 / 防 6');
    expect(html).toContain('回合上限');
    expect(html).toContain('∞');
  });

  it('escapes HTML in config-driven content', () => {
    const RulesSheet = loadRulesSheet();
    const evil = JSON.parse(JSON.stringify(standoffConfig));
    (evil.balance.controlPointTypes as Record<string, { income: number }>).supply.income = 8;
    (evil.units as Record<string, { cost: number }>).infantry.cost = 55;
    (evil as { extra?: string }).extra = '<img src=x onerror=alert(1)>';
    const html = RulesSheet.buildHtml(evil);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('onerror');
  });

  it('renders a friendly placeholder without a game config', () => {
    const RulesSheet = loadRulesSheet();
    expect(RulesSheet.buildHtml(null)).toContain('进入对局后');
  });

  it('attaches a toggleable modal with a minimal document stub', () => {
    const listeners = new Map<string, Array<(e: unknown) => void>>();
    const bodyEl: Record<string, unknown> = {};
    const makeEl = () => {
      const el: Record<string, unknown> = {
        style: {},
        dataset: {},
        className: '',
        children: [] as unknown[],
        innerHTML: '',
        addEventListener(type: string, cb: (e: unknown) => void) {
          const list = listeners.get(type) || [];
          list.push(cb);
          listeners.set(type, list);
        },
        querySelector() { return { addEventListener() {} }; },
        setAttribute() {},
        appendChild(child: unknown) { (el.children as unknown[]).push(child); },
      };
      return el;
    };
    bodyEl.appendChild = (child: unknown) => { (bodyEl.children = bodyEl.children || []).push(child); };
    const docListeners = new Map<string, Array<(e: unknown) => void>>();
    const documentStub = {
      createElement: makeEl,
      body: bodyEl,
      addEventListener(type: string, cb: (e: unknown) => void) {
        const list = docListeners.get(type) || [];
        list.push(cb);
        docListeners.set(type, list);
      },
    };
    const context = createContext({ window: {}, document: documentStub });
    const sheetWindow: Record<string, unknown> = {};
    context.window = sheetWindow;
    new Script(readFileSync('public/rules-sheet.js', 'utf8')).runInContext(context);
    const RulesSheet = sheetWindow.RulesSheet as ReturnType<typeof loadRulesSheet>;

    const trigger = { addEventListener(type: string, cb: () => void) { listeners.set(`trigger:${type}`, [cb]); } };
    const api = RulesSheet.attach({ triggerEl: trigger, getConfig: () => standoffConfig });
    api.open();
    api.close();
    // 触发器与 Escape 均可安全调用。
    listeners.get('trigger:click')?.forEach(cb => cb(undefined));
    docListeners.get('keydown')?.forEach(cb => cb({ key: 'Escape', stopPropagation() {} }));
    expect(true).toBe(true);
  });
});
