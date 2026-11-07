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
    turn?: Record<string, unknown>;
  },
  gameConfig: { mode?: string; balance?: Record<string, unknown> } | null,
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
      turn: state.turn ?? {},
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

  it('mirrors the flat komi while a seat still has its opening grant pending', () => {
    const players = {
      player_a: { status: 'active' },
      player_b: { status: 'active' },
      player_c: { status: 'active' },
    };
    // 每人一个 supply 据点：普通收入 = 10 + 4 = 14；贴目是固定 20，与据点收入无关。
    const controlPoints = [
      { id: 'cp1', owner: 'player_b', kind: 'supply' },
      { id: 'cp2', owner: 'player_c', kind: 'supply' },
    ];
    const balance = {
      baseIncome: 10,
      controlPointIncome: 0,
      controlPointTypes: { supply: { income: 4 } },
      komi: { supplies: 20 },
    };

    for (const file of ALL_CLIENTS) {
      const at = (
        currentPlayerId: string | null,
        turnOverrides: Record<string, unknown> = {},
        config: { mode: string; balance: Record<string, unknown> } = { mode: 'annihilation', balance },
      ) => loadNextTurnIncome(file, {
        players,
        controlPoints,
        turn: { roundNumber: 1, turnOrder: ['player_a', 'player_b', 'player_c'], currentPlayerId, ...turnOverrides },
      }, config);

      // 先手自己第 1 回合不结算收入（且名下无据点，只有基础收入 10），
      // 其余两座的下一笔就是贴目：固定 20，不再按据点收入折算。
      let forecast = at('player_a');
      expect(forecast('player_a'), file).toBe(10);
      expect(forecast('player_b'), file).toBe(20);
      expect(forecast('player_c'), file).toBe(20);

      // 轮到后手：它自己的下一笔已是第 2 回合普通收入，尚未行动的第三位仍是贴目。
      forecast = at('player_b');
      expect(forecast('player_b'), file).toBe(14);
      expect(forecast('player_c'), file).toBe(20);

      // 第三位行动中：前两位本轮都已结算，没有人再拿贴目。
      forecast = at('player_c');
      expect(forecast('player_b'), file).toBe(14);
      expect(forecast('player_c'), file).toBe(14);

      // 第 2 回合起贴目不再参与预估。
      forecast = at('player_b', { roundNumber: 2 });
      expect(forecast('player_c'), file).toBe(14);

      // 未声明 komi = 旧口径（一次开局收入 = 14）；0 则第 1 回合没有预估收入。
      forecast = at('player_a', {}, { mode: 'standard', balance: { ...balance, komi: undefined } });
      expect(forecast('player_b'), file).toBe(14);
      forecast = at('player_a', {}, { mode: 'standard', balance: { ...balance, komi: { supplies: 0 } } });
      expect(forecast('player_b'), file).toBe(0);

      // 同时回合 / 大逃杀没有先手位置：恒按普通收入预估。
      forecast = at('player_a', {}, { mode: 'simultaneous', balance });
      expect(forecast('player_b'), file).toBe(14);
      forecast = at('player_a', {}, { mode: 'royale', balance });
      expect(forecast('player_b'), file).toBe(14);
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
