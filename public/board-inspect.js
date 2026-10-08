// 悬停看射程：把某单位的攻击/治疗覆盖推导成「可瞄准格集合」，与同时模式
// 计划期的瞄准口径一致（镜像服务端 planning.ts：single = 射程内全部格、line = 正六
// 方向射线格、arc = 相邻三格扇形）。玩家页与观战页共用，保证各端口径一致。
(() => {
  const HEX_DIRECTIONS = [
    { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
    { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
  ];

  function hexDistance(a, b) {
    return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs((-a.q - a.r) - (-b.q - b.r)));
  }

  function shapeSpecOf(spec, kind) {
    const shape = spec?.[kind];
    if (!shape) return { type: 'single', length: 1 };
    if (shape.type === 'line') return { type: 'line', length: shape.length ?? 2 };
    if (shape.type === 'arc') return { type: 'arc', length: 3 };
    return { type: 'single', length: 1 };
  }

  function rangeOf(unit, spec, kind) {
    return kind === 'healShape' ? (spec?.healRange ?? unit.attackRange) : unit.attackRange;
  }

  // 返回该单位可瞄准的全部格子（不做目标过滤）；旧图无形状配置 = 射程内全部格。
  function aimableCells(unit, kind, cells, spec) {
    const result = [];
    for (const cell of cells || []) {
      if (!coveredCellsFor(unit, spec, kind, cell, rangeOf(unit, spec, kind))) continue;
      result.push(cell);
    }
    return result;
  }

  // 由点击格推导形状方向与覆盖格；不可瞄准（超射程 / 不在射线 / 非相邻）返回 null。
  function coveredCellsFor(from, spec, kind, target, range) {
    const shape = shapeSpecOf(spec, kind);
    const dq = target.q - from.q;
    const dr = target.r - from.r;
    if (shape.type === 'single') {
      const distance = hexDistance(from, target);
      if (distance > range) return null;
      if (kind === 'attackShape' && distance === 0) return null;
      return [{ q: target.q, r: target.r }];
    }
    if (shape.type === 'arc') {
      if (hexDistance(from, target) !== 1) return null;
      const direction = HEX_DIRECTIONS.findIndex(d => d.q === dq && d.r === dr);
      if (direction < 0) return null;
      return [(direction + 5) % 6, direction, (direction + 1) % 6].map(index => ({
        q: from.q + HEX_DIRECTIONS[index].q,
        r: from.r + HEX_DIRECTIONS[index].r,
      }));
    }
    for (let direction = 0; direction < 6; direction++) {
      const d = HEX_DIRECTIONS[direction];
      const k = d.q !== 0 ? dq / d.q : dr / d.r;
      if (!Number.isInteger(k) || k < 1 || k > shape.length) continue;
      if (d.q * k !== dq || d.r * k !== dr) continue;
      const cells = [];
      for (let step = 1; step <= shape.length; step++) {
        cells.push({ q: from.q + d.q * step, r: from.r + d.r * step });
      }
      return cells;
    }
    return null;
  }

  // 悬停预览：返回 { kind: 'attack'|'heal', cells }；无覆盖范围（如总部）返回 null。
  function rangeHintFor(unit, cells, config) {
    if (!unit) return null;
    const spec = config?.units?.[unit.type];
    if (unit.type === 'support') {
      return { kind: 'heal', cells: aimableCells(unit, 'healShape', cells, spec) };
    }
    if (!(unit.attackRange > 0)) return null;
    return { kind: 'attack', cells: aimableCells(unit, 'attackShape', cells, spec) };
  }

  window.BoardInspect = { rangeHintFor, aimableCells, coveredCellsFor };
})();
