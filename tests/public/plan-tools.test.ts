import { readFileSync } from 'node:fs';
import { createContext, Script } from 'node:vm';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

const PLAYER_CLIENTS = ['public/play.js', 'public/play-m.js'];

// apiAction 依赖 API / toast / state，切出真实源码后注入最小桩执行。
function loadApiAction(file: string, postResult: Record<string, unknown>, state: Record<string, unknown>) {
  const source = read(file);
  const start = source.indexOf('async function apiAction');
  expect(start, `${file} 应包含 apiAction`).toBeGreaterThan(-1);
  const end = source.indexOf('\n}', start);
  expect(end, `${file} 中 apiAction 缺少收尾括号`).toBeGreaterThan(start);
  const fnSource = source.slice(start, end + 2);
  const toasts: string[] = [];
  const context = createContext({
    API: { post: async () => postResult },
    toast: (message: string) => { toasts.push(message); },
    state,
  });
  const fn = new Script(`(${fnSource})`).runInContext(context) as (path: string, body: Record<string, unknown>) => Promise<boolean>;
  return { fn, toasts };
}

describe('simultaneous plan panel tools', () => {
  it('reorders through the atomic server endpoint without clearing the plan', () => {
    for (const file of PLAYER_CLIENTS) {
      const source = read(file);
      const start = source.indexOf('async function reorderPlan');
      expect(start, `${file} 应包含 reorderPlan`).toBeGreaterThan(-1);
      const end = source.indexOf('\n}', start);
      const body = source.slice(start, end + 2);
      expect(body).toContain('/plan/reorder');
      expect(body).toContain('actionIds: next.map(a => a.id)');
      expect(body).not.toContain('/plan/clear');
      expect(body).not.toContain('planActionRequest');
      expect(body).toContain('refreshAdjudication()');
      // 越界与同位移动直接短路，不发请求。
      expect(body).toContain('fromIndex === toIndex');
      expect(body).toContain('planReordering');
    }
  });

  it('applies the queue echoed by plan actions immediately', async () => {
    for (const file of PLAYER_CLIENTS) {
      const state = { plan: { committed: [] as string[], myQueue: [{ id: 'old', type: 'attack' }] } };
      const { fn, toasts } = loadApiAction(file, {
        ok: true,
        status: 200,
        data: { ok: true, queue: [{ id: 'new', type: 'move', unitId: 'u1', q: 1, r: 0 }] },
      }, state);
      await expect(fn('/api/games/g/move', {})).resolves.toBe(true);
      expect(state.plan.myQueue).toEqual([{ id: 'new', type: 'move', unitId: 'u1', q: 1, r: 0 }]);
      expect(toasts).toEqual([]);
    }
  });

  it('keeps the local queue untouched when a plan action is rejected', async () => {
    for (const file of PLAYER_CLIENTS) {
      const original = [{ id: 'old', type: 'attack' }];
      const state = { plan: { committed: [] as string[], myQueue: [...original] } };
      const { fn, toasts } = loadApiAction(file, {
        ok: false,
        status: 400,
        data: { error: '该单位本轮已有计划动作', code: 'invalid_move' },
      }, state);
      await expect(fn('/api/games/g/move', {})).resolves.toBe(false);
      expect(state.plan.myQueue).toEqual(original);
      expect(toasts).toEqual(['该单位本轮已有计划动作 (invalid_move)']);
    }
  });

  it('wires clear-all and reorder controls in both player clients', () => {
    for (const file of PLAYER_CLIENTS) {
      const source = read(file);
      // 全部撤销走服务器 plan/clear；重排走原子 plan/reorder，不再清空重放。
      expect(source, `${file} 应调用 plan/clear`).toContain('/plan/clear');
      expect(source, `${file} 应提供全部撤销按钮`).toContain('plan-clear-all');
      expect(source, `${file} 应提供上移/下移按钮`).toContain('plan-order-btn');
      expect(source, `${file} 重排应走 reorderPlan`).toContain('reorderPlan');
      expect(source, `${file} 重排应调用 plan/reorder`).toContain('/plan/reorder');
      // 已确认计划后不允许再改：按钮仅在未确认时渲染。
      expect(source).toContain('iCommitted()');
    }
  });

  it('keeps the original plan when a reorder is rejected', async () => {
    for (const file of PLAYER_CLIENTS) {
      const state = { plan: { committed: [] as string[], myQueue: [{ id: 'a', type: 'move' }, { id: 'b', type: 'wait' }] } };
      const { fn } = loadApiAction(file, {
        ok: false,
        status: 400,
        data: { error: '计划顺序无效', code: 'invalid_plan_order' },
      }, state);
      await expect(fn('/api/games/g/plan/reorder', { actionIds: ['b', 'a'] })).resolves.toBe(false);
      expect(state.plan.myQueue.map(action => action.id)).toEqual(['a', 'b']);
    }
  });
});

describe('rules sheet wiring across the four pages', () => {
  it('imports the shared modules in each page client entry', () => {
    const entries: Array<[string, string[]]> = [
      ['public/play.js', ['./version.js', './board-animation.js', './board-inspect.js', './rules-sheet.js']],
      ['public/play-m.js', ['./version.js', './board-animation.js', './board-inspect.js', './rules-sheet.js']],
      ['public/app.js', ['./version.js', './board-animation.js', './board-inspect.js', './rules-sheet.js']],
      ['public/spectator-m.js', ['./version.js', './board-animation.js', './board-inspect.js', './rules-sheet.js']],
    ];
    for (const [entry, deps] of entries) {
      const source = read(entry);
      let prevIndex = -1;
      for (const dep of deps) {
        const depIndex = source.indexOf(`import '${dep}'`);
        expect(depIndex, `${entry} 应 import ${dep}`).toBeGreaterThan(-1);
        expect(depIndex, `${entry} 中 ${dep} 的 import 应位于文件头部依赖区`).toBeGreaterThan(prevIndex);
        prevIndex = depIndex;
      }
      expect(source, `${entry} 应接线 RulesSheet.attach`).toContain('RulesSheet');
      expect(source).toContain('getConfig');
    }
    // 共享依赖与入口的接线页面侧由 import 静态保证；页面本身只需有规则速查按钮。
    const pages = ['public/play.html', 'public/play-m.html', 'public/spectator.html', 'public/spectator-m.html'];
    for (const page of pages) {
      expect(read(page), `${page} 应有规则速查按钮`).toContain('id="btn-rules"');
    }
  });
});
