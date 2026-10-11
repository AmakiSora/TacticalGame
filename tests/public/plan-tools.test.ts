import { readFileSync } from 'node:fs';
import { createContext, Script } from 'node:vm';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

const PLAYER_CLIENTS = ['public/play.js', 'public/play-m.js'];

// 计划面板脚本依赖 DOM 全局，无法整体加载；切出真实的 planActionRequest 函数源码执行。
function loadPlanActionRequest(file: string): (action: Record<string, unknown>) => { path: string; body: Record<string, unknown> } | null {
  const source = read(file);
  const start = source.indexOf('function planActionRequest');
  expect(start, `${file} 应包含 planActionRequest`).toBeGreaterThan(-1);
  const end = source.indexOf('\n}', start);
  expect(end, `${file} 中 planActionRequest 缺少收尾括号`).toBeGreaterThan(start);
  const fnSource = source.slice(start, end + 2);
  const context = createContext({});
  return new Script(`(${fnSource})`).runInContext(context) as (action: Record<string, unknown>) => { path: string; body: Record<string, unknown> } | null;
}

describe('simultaneous plan panel tools', () => {
  it('rebuilds re-enqueue requests for all five plan action types', () => {
    for (const file of PLAYER_CLIENTS) {
      const build = loadPlanActionRequest(file);
      expect(build({ type: 'move', unitId: 'u1', q: 2, r: -1 })).toEqual({ path: 'move', body: { unitId: 'u1', q: 2, r: -1 } });
      expect(build({ type: 'attack', attackerId: 'u2', q: 1, r: 0 })).toEqual({ path: 'attack', body: { attackerId: 'u2', q: 1, r: 0 } });
      expect(build({ type: 'heal', supportId: 'u3', q: 0, r: 1 })).toEqual({ path: 'heal', body: { supportId: 'u3', q: 0, r: 1 } });
      expect(build({ type: 'deploy', unitType: 'infantry', fromId: 'cp1', q: 3, r: -1 })).toEqual({ path: 'deploy', body: { unitType: 'infantry', fromId: 'cp1', q: 3, r: -1 } });
      expect(build({ type: 'demolish', unitId: 'u4', q: 1, r: 1 })).toEqual({ path: 'demolish', body: { unitId: 'u4', q: 1, r: 1 } });
      expect(build({ type: 'unknown' })).toBeNull();
      expect(build(null)).toBeNull();
    }
  });

  it('wires clear-all and reorder controls in both player clients', () => {
    for (const file of PLAYER_CLIENTS) {
      const source = read(file);
      // 全部撤销走服务器 plan/clear；重排 = 清空后按新顺序重放入队。
      expect(source, `${file} 应调用 plan/clear`).toContain('/plan/clear');
      expect(source, `${file} 应提供全部撤销按钮`).toContain('plan-clear-all');
      expect(source, `${file} 应提供上移/下移按钮`).toContain('plan-order-btn');
      expect(source, `${file} 重排应走 reorderPlan`).toContain('reorderPlan');
      expect(source, `${file} 重排重放应使用 planActionRequest`).toContain('planActionRequest');
      // 已确认计划后不允许再改：按钮仅在未确认时渲染。
      expect(source).toContain('iCommitted()');
    }
  });

  it('reorder replays actions in the new order after clearing the queue', () => {
    for (const file of PLAYER_CLIENTS) {
      const source = read(file);
      const start = source.indexOf('async function reorderPlan');
      expect(start, `${file} 应包含 reorderPlan`).toBeGreaterThan(-1);
      const end = source.indexOf('\n}', start);
      const body = source.slice(start, end + 2);
      // 先清空、再逐条重放、最后刷新裁决与界面。
      expect(body.indexOf('plan/clear')).toBeLessThan(body.indexOf('planActionRequest(a)'));
      expect(body).toContain('refreshAdjudication()');
      // 越界与同位移动直接短路，不发请求。
      expect(body).toContain('fromIndex === toIndex');
      expect(body).toContain('planReordering');
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
