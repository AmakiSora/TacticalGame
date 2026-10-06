import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

const SPECTATOR_CLIENTS = ['public/app.js', 'public/spectator-m.js'];
const PLAYER_CLIENTS = ['public/play.js', 'public/play-m.js'];
const ALL_CLIENTS = [...SPECTATOR_CLIENTS, ...PLAYER_CLIENTS];

// 资源卡片脚本依赖 DOM 全局，无法整体加载；切出真实的 nextTurnIncomeFor 函数源码，
// 注入受控的 state / gameConfig 后执行，断言下回合收入预测的实际数值。
function loadNextTurnIncome(
  file: string,
  state: {
    players: Record<string, { status: string }>;
    controlPoints: Array<{ id: string; owner: string | null; kind?: string }>;
  },
  gameConfig: { balance: Record<string, unknown> } | null,
): (owner: string) => number | null {
  const source = read(file);
  const start = source.indexOf('function nextTurnIncomeFor');
  expect(start, `${file} 应包含 nextTurnIncomeFor`).toBeGreaterThan(-1);
  // CRLF/LF 均按「行首 }」定位函数收尾，end+2 把换行与闭括号一并纳入切片。
  const end = source.indexOf('\n}', start);
  expect(end, `${file} 中 nextTurnIncomeFor 缺少收尾括号`).toBeGreaterThan(start);
  const fnSource = source.slice(start, end + 2);
  const context: Record<string, unknown> = {
    state: {
      players: state.players,
      controlPoints: new Map(state.controlPoints.map(point => [point.id, { ...point }])),
    },
    gameConfig,
  };
  context.globalThis = context;
  vm.createContext(context);
  return vm.runInContext(`(${fnSource})`, context) as (owner: string) => number | null;
}

describe('resource card next-turn income forecast', () => {
  it('mirrors engine collectIncome: base income plus per-point income with legacy fallbacks', () => {
    for (const file of ALL_CLIENTS) {
      const forecast = loadNextTurnIncome(
        file,
        {
          players: { player_a: { status: 'active' }, player_b: { status: 'eliminated' } },
          controlPoints: [
            // player_a 名下四类据点：按类型 income、类型无 income 字段回退、未知类型回退、无类型回退。
            { id: 'cp1', owner: 'player_a', kind: 'supply' },
            { id: 'cp2', owner: 'player_a', kind: 'forward_base' },
            { id: 'cp3', owner: 'player_a', kind: 'repair' },
            { id: 'cp4', owner: 'player_a' },
            // 敌方与中立据点不计入。
            { id: 'cp5', owner: 'player_b', kind: 'supply' },
            { id: 'cp6', owner: null, kind: 'supply' },
          ],
        },
        {
          balance: {
            baseIncome: 8,
            controlPointIncome: 3,
            controlPointTypes: {
              supply: { income: 6 },
              forward_base: { income: 4 },
              repair: { repairAmount: 10 },
            },
          },
        },
      );
      // 8 + 6 + 4 + 3（repair 无 income 字段回退）+ 3（无类型回退）= 24。
      expect(forecast('player_a')).toBe(24);
      // 非活跃玩家不发放（引擎 collectIncome 的 status 门控）。
      expect(forecast('player_b')).toBeNull();
      expect(forecast('player_c')).toBeNull();
    }
  });

  it('falls back to controlPointIncome for every point without controlPointTypes', () => {
    for (const file of ALL_CLIENTS) {
      const legacy = loadNextTurnIncome(
        file,
        {
          players: { player_a: { status: 'active' } },
          controlPoints: [
            { id: 'cp1', owner: 'player_a', kind: 'supply' },
            { id: 'cp2', owner: 'player_a' },
          ],
        },
        { balance: { baseIncome: 7, controlPointIncome: 5 } },
      );
      expect(legacy('player_a')).toBe(17);

      // 完全没有 controlPointIncome 的配置：无类型据点按 0 兜底，不产生 NaN。
      const bare = loadNextTurnIncome(
        file,
        {
          players: { player_a: { status: 'active' } },
          controlPoints: [{ id: 'cp1', owner: 'player_a' }],
        },
        { balance: { baseIncome: 6, controlPointTypes: { supply: { income: 6 } } } },
      );
      expect(bare('player_a')).toBe(6);
    }
  });

  it('renders the forecast on every client with per-kind styles in all stylesheets', () => {
    const badge = '<em class="resource-next" title="下回合补给收入" aria-label="下回合补给收入 +${nextIncome}">+${nextIncome}</em>';
    for (const file of SPECTATOR_CLIENTS) {
      const source = read(file);
      expect(source).toContain(badge);
      // 两行结构：头行「改名按钮 + 收入徽标」，次行「补给量 + 标签」。
      expect(source).toContain('<div class="resource-head">${playerNameControl(owner)}${nextIncomeHtml}</div><div class="resource-amount"><strong>${resource.supplies ?? 0}</strong><em>补给</em></div>');
      // 补给量按位数缩字号（7 位起），大数字不破版。
      expect(source).toContain('Math.min(digitCount, 9)');
    }
    for (const file of PLAYER_CLIENTS) {
      const source = read(file);
      expect(source).toContain(badge);
      // 胶囊两行结构：头行「名字（含（你）/已确认后缀）+ 收入徽标」，次行补给量。
      expect(source).toContain('<div class="resource-head"><span>${esc(playerName(id))}');
      expect(source).toContain(`</span>\${nextIncomeHtml}</div><strong>\${supplies}</strong>`);
      expect(source).toContain('Math.min(digitCount, 9)');
    }
    for (const file of ['public/style.css', 'public/spectator-m.css']) {
      const css = read(file);
      expect(css).toContain('.resource-head .player-name');
      expect(css).toContain('.resource-card.len-7 strong');
      expect(css).toContain('.resource-card .resource-next');
      // 名字省略号截断来自存量 .player-name 规则（overflow + ellipsis）。
      expect(css).toContain('text-overflow: ellipsis');
    }
    for (const file of ['public/play.css', 'public/play-m.css']) {
      const css = read(file);
      expect(css).toContain('.resource-pill .resource-head span');
      expect(css).toContain('.resource-pill.len-7 strong');
      const next = css.slice(css.indexOf('.resource-pill .resource-next'));
      // 徽标固定宽不参与挤压、不换行，圆角胶囊样式。
      expect(next).toContain('flex: none');
      expect(next).toContain('border-radius: 8px');
      expect(next).toContain('white-space: nowrap');
    }
  });
});
