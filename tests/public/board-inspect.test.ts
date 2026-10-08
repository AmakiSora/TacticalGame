import { readFileSync } from 'node:fs';
import { createContext, Script } from 'node:vm';
import { describe, expect, it } from 'vitest';

// 悬停看射程的共享推导：四种形状（未配置单格回退、显式单格、直线、扇形）、
// 治疗射程回退与坐标排除，均与同时模式计划期 shapeAimFor 口径一致。
function loadBoardInspect() {
  const boardWindow: Record<string, unknown> = {};
  const context = createContext({ window: boardWindow });
  new Script(readFileSync('public/board-inspect.js', 'utf8')).runInContext(context);
  return boardWindow.BoardInspect as {
    rangeHintFor(unit: Record<string, unknown>, cells: Array<{ q: number; r: number }>, config: Record<string, unknown>): { kind: string; cells: Array<{ q: number; r: number }> } | null;
    aimableCells(unit: Record<string, unknown>, kind: 'attackShape' | 'healShape', cells: Array<{ q: number; r: number }>, spec: Record<string, unknown>): Array<{ q: number; r: number }>;
  };
}

// 半径 1 的小六边形棋盘（7 格）。
const CELLS = [
  { q: 0, r: 0 }, { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

describe('board inspect hover-range derivation', () => {
  it('falls back to all in-range cells for a legacy unit without shape config', () => {
    const inspect = loadBoardInspect();
    const unit = { type: 'ranger', q: 0, r: 0, attackRange: 2 };
    const hint = inspect.rangeHintFor(unit, CELLS, { units: { ranger: {} } });
    expect(hint?.kind).toBe('attack');
    // 距离 ≤2 的格都可选；本格（距离 0）不合法。
    expect(hint?.cells.length).toBe(6);
    expect(hint?.cells.some(c => c.q === 0 && c.r === 0)).toBe(false);
  });

  it('treats the support unit as a heal range hint using healShape', () => {
    const inspect = loadBoardInspect();
    const support = { type: 'support', q: 0, r: 0, attackRange: 2, healPower: 20 };
    const hint = inspect.rangeHintFor(support, CELLS, { units: { support: { healShape: { type: 'arc' } } } });
    expect(hint?.kind).toBe('heal');
    // arc：只能瞄准相邻六格。
    expect(hint?.cells.length).toBe(6);
  });

  it('derives line-shape aimable cells along the six ray directions', () => {
    const inspect = loadBoardInspect();
    const unit = { type: 'infantry', q: 0, r: 0, attackRange: 2 };
    const spec = { attackShape: { type: 'line', length: 2 } };
    const aims = inspect.aimableCells(unit, 'attackShape', CELLS, spec);
    // 半径 1 的棋盘上每个方向只有 1 格可选（第 2 格已出界）。
    expect(aims.length).toBe(6);
    // 非射线方向的格在半径 1 内不存在；加一格 (2,0) 验证射线推导成立。
    const far = [...CELLS, { q: 2, r: 0 }];
    const aims2 = inspect.aimableCells(unit, 'attackShape', far, spec);
    expect(aims2.some(c => c.q === 2 && c.r === 0)).toBe(true);
  });

  it('returns null for entities without an attack range (e.g. headquarters)', () => {
    const inspect = loadBoardInspect();
    expect(inspect.rangeHintFor({ q: 0, r: 0 }, CELLS, {})).toBeNull();
    expect(inspect.rangeHintFor(null, CELLS, {})).toBeNull();
  });

  it('respects healRange falling back to attackRange', () => {
    const inspect = loadBoardInspect();
    const support = { type: 'support', q: 0, r: 0, attackRange: 2, healPower: 20 };
    const far = [...CELLS, { q: 2, r: 0 }, { q: 3, r: 0 }];
    const specDefault = { healShape: { type: 'single' } };
    const cells = inspect.aimableCells(support, 'healShape', far, specDefault);
    // 未配置 healRange 时回退 attackRange=2，(3,0) 超出射程。
    expect(cells.some(c => c.q === 2 && c.r === 0)).toBe(true);
    expect(cells.some(c => c.q === 3 && c.r === 0)).toBe(false);
    const specWide = { healShape: { type: 'single' }, healRange: 3 };
    const cellsWide = inspect.aimableCells(support, 'healShape', far, specWide);
    expect(cellsWide.some(c => c.q === 3 && c.r === 0)).toBe(true);
  });
});
