// 迷雾模式（fog）共享纯函数：模式判定、观者投影归一化、残影与盲射推导。
// 服务端是视野/残影的唯一权威：本模块只消费 fog.visibleCells / fog.lastSeen，
// 绝不在客户端重算视野范围，也不自行保留或过期残影。
(() => {
  const UNIT_TYPES = ['scout', 'ranger', 'infantry', 'support', 'heavy'];
  // 与服务端 FOG_VISION_DEFAULTS 同口径；地图配置缺省兵种时由服务端落默认值。
  const DEFAULT_VISION = { scout: 4, ranger: 3, infantry: 2, support: 2, heavy: 1 };
  const VISION_MAX = 8;

  function isFogMode(mode) { return mode === 'fog'; }
  function isSimultaneousMode(mode) { return mode === 'simultaneous' || mode === 'royale' || mode === 'fog'; }
  // 迷雾不含炮火缩圈：歼灭轴必须保持 annihilation | royale。
  function isAnnihilationMode(mode) { return mode === 'annihilation' || mode === 'royale'; }

  function cellKey(q, r) { return `${q},${r}`; }

  function normalizeVision(vision) {
    const result = { ...DEFAULT_VISION };
    if (!vision || typeof vision !== 'object') return result;
    for (const type of UNIT_TYPES) {
      const value = Number(vision[type]);
      if (Number.isInteger(value) && value >= 0 && value <= VISION_MAX) result[type] = value;
    }
    return result;
  }

  function normalizeFogConfig(fog) {
    const source = fog && typeof fog === 'object' ? fog : {};
    const round = Number(source.revealFromRound);
    return {
      vision: normalizeVision(source.vision),
      revealFromRound: Number.isInteger(round) && round >= 1 ? round : null,
    };
  }

  // 观者投影归一化：null 表示这局没有迷雾（或投影不可用）。
  // visibleSet 只作查询加速，内容完全来自服务端 visibleCells。
  function normalizeProjection(fog) {
    if (!fog || fog.enabled !== true) return null;
    const visibleCells = Array.isArray(fog.visibleCells)
      ? fog.visibleCells.filter(key => typeof key === 'string')
      : [];
    const lastSeen = Array.isArray(fog.lastSeen)
      ? fog.lastSeen.filter(item => item && typeof item === 'object' && item.unitId)
      : [];
    return {
      enabled: true,
      revealed: fog.revealed === true,
      visibleCells,
      visibleSet: new Set(visibleCells),
      lastSeen,
    };
  }

  // 没有投影（非迷雾）或已揭雾时，棋盘全部可见。
  function isCellVisible(projection, q, r) {
    if (!projection) return true;
    if (projection.revealed) return true;
    return projection.visibleSet.has(cellKey(q, r));
  }

  function cellHidden(projection, q, r) {
    return !isCellVisible(projection, q, r);
  }

  // 残影列表：服务端已做 seenRound 过期裁剪，前端不再自行保留/过期；
  // 只排除当前已能看见的存活单位（棋盘上画的是实体，避免重复）。
  function ghostsFor(projection, units) {
    if (!projection || projection.revealed) return [];
    const visibleIds = new Set();
    if (units) {
      const list = units instanceof Map ? [...units.values()] : Array.from(units);
      for (const unit of list) if (unit && unit.alive !== false) visibleIds.add(unit.id);
    }
    return projection.lastSeen.filter(ghost => ghost && ghost.unitId && !visibleIds.has(ghost.unitId));
  }

  function ghostAt(projection, units, q, r) {
    return ghostsFor(projection, units).find(ghost => ghost.q === q && ghost.r === r) || null;
  }

  // 盲射：迷雾下目标格没有可见单位时，攻击仍是合法的预测性射击。
  // hasVisibleUnit 由调用方按 state.units 判断；已揭雾或非迷雾不提示。
  function blindFireHint(projection, hasVisibleUnit) {
    if (!projection || projection.revealed) return null;
    if (hasVisibleUnit) return null;
    return '盲射';
  }

  window.FogView = {
    UNIT_TYPES,
    DEFAULT_VISION,
    VISION_MAX,
    isFogMode,
    isSimultaneousMode,
    isAnnihilationMode,
    cellKey,
    normalizeVision,
    normalizeFogConfig,
    normalizeProjection,
    isCellVisible,
    cellHidden,
    ghostsFor,
    ghostAt,
    blindFireHint,
  };
})();
