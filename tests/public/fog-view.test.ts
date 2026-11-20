import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

// 迷雾前端共享纯函数：契约形状的投影 fixture，不依赖真实对局。
type FogView = {
  UNIT_TYPES: string[];
  DEFAULT_VISION: Record<string, number>;
  VISION_MAX: number;
  isFogMode: (mode?: string) => boolean;
  isSimultaneousMode: (mode?: string) => boolean;
  isAnnihilationMode: (mode?: string) => boolean;
  cellKey: (q: number, r: number) => string;
  normalizeVision: (vision: unknown) => Record<string, number>;
  normalizeFogConfig: (fog: unknown) => { vision: Record<string, number>; revealFromRound: number | null };
  normalizeProjection: (fog: any) => {
    enabled: boolean;
    revealed: boolean;
    visibleCells: string[];
    visibleSet: Set<string>;
    lastSeen: any[];
  } | null;
  isCellVisible: (projection: any, q: number, r: number) => boolean;
  cellHidden: (projection: any, q: number, r: number) => boolean;
  ghostsFor: (projection: any, units: any) => any[];
  ghostAt: (projection: any, units: any, q: number, r: number) => any | null;
  blindFireHint: (projection: any, hasVisibleUnit: boolean) => string | null;
};

function loadFogView(): FogView {
  const context: any = { window: {} };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(readFileSync('public/fog.js', 'utf8'), context);
  return context.window.FogView;
}

// 契约 §2 的玩家投影形状：visibleCells 是排好序的 "q,r"，lastSeen 由服务端裁掉过期项。
const FOG_PROJECTION = {
  enabled: true,
  revealed: false,
  visibleCells: ['-1,1', '0,0', '1,0'],
  lastSeen: [
    {
      unitId: 'enemy_stale',
      owner: 'player_b',
      type: 'ranger',
      q: 4,
      r: -2,
      hp: 40,
      maxHp: 72,
      seenRound: 3,
    },
    {
      unitId: 'own_scout',
      owner: 'player_a',
      type: 'scout',
      q: 0,
      r: 0,
      hp: 65,
      maxHp: 65,
      seenRound: 4,
    },
  ],
};

describe('fog mode predicates', () => {
  it('routes fog through the simultaneous axis but never the annihilation axis', () => {
    const fog = loadFogView();

    expect(fog.isFogMode('fog')).toBe(true);
    expect(fog.isFogMode('royale')).toBe(false);

    // 迷雾沿用同时回合骨架：计划队列、同轮结算、行动点规则都按同时轴走。
    expect(fog.isSimultaneousMode('fog')).toBe(true);
    expect(fog.isSimultaneousMode('simultaneous')).toBe(true);
    expect(fog.isSimultaneousMode('royale')).toBe(true);
    expect(fog.isSimultaneousMode('annihilation')).toBe(false);
    expect(fog.isSimultaneousMode('standard')).toBe(false);

    // 迷雾没有炮火缩圈：不能因为“同时”就把歼灭轴一起打开。
    expect(fog.isAnnihilationMode('fog')).toBe(false);
    expect(fog.isAnnihilationMode('annihilation')).toBe(true);
    expect(fog.isAnnihilationMode('royale')).toBe(true);
    expect(fog.isAnnihilationMode('simultaneous')).toBe(false);
  });
});

describe('fog projection normalization', () => {
  it('consumes the server projection as-is', () => {
    const fog = loadFogView();
    const projection = fog.normalizeProjection(FOG_PROJECTION)!;

    expect(projection.enabled).toBe(true);
    expect(projection.revealed).toBe(false);
    expect(projection.visibleCells).toEqual(['-1,1', '0,0', '1,0']);
    expect(projection.visibleSet.has(fog.cellKey(1, 0))).toBe(true);
    expect(projection.lastSeen).toHaveLength(2);
  });

  it('returns null for non-fog games and tolerates a malformed payload', () => {
    const fog = loadFogView();

    expect(fog.normalizeProjection(null)).toBeNull();
    expect(fog.normalizeProjection({ enabled: false })).toBeNull();

    const empty = fog.normalizeProjection({ enabled: true, visibleCells: 'nope', lastSeen: [null, 1] })!;
    expect(empty.visibleCells).toEqual([]);
    expect(empty.lastSeen).toEqual([]);
  });

  it('treats revealed fog as a fully visible board', () => {
    const fog = loadFogView();
    const revealed = fog.normalizeProjection({ ...FOG_PROJECTION, revealed: true, lastSeen: [] })!;

    expect(fog.isCellVisible(revealed, 9, -4)).toBe(true);
    expect(fog.cellHidden(revealed, 9, -4)).toBe(false);
    expect(fog.ghostsFor(revealed, [])).toEqual([]);
  });

  it('hides only cells absent from server visibleCells', () => {
    const fog = loadFogView();
    const projection = fog.normalizeProjection(FOG_PROJECTION)!;

    expect(fog.isCellVisible(projection, 0, 0)).toBe(true);
    expect(fog.isCellVisible(projection, -1, 1)).toBe(true);
    expect(fog.isCellVisible(projection, 4, -2)).toBe(false);
    expect(fog.cellHidden(projection, 4, -2)).toBe(true);

    // 没有迷雾投影时棋盘不做任何遮挡。
    expect(fog.isCellVisible(null, 4, -2)).toBe(true);
  });
});

describe('fog ghosts', () => {
  it('derives ghosts from server lastSeen and excludes live units', () => {
    const fog = loadFogView();
    const projection = fog.normalizeProjection(FOG_PROJECTION)!;
    const units = [
      { id: 'own_scout', owner: 'player_a', type: 'scout', q: 0, r: 0, hp: 65, maxHp: 65, alive: true },
    ];

    const ghosts = fog.ghostsFor(projection, units);
    expect(ghosts.map(ghost => ghost.unitId)).toEqual(['enemy_stale']);
    // 残影保留上次确认时的兵种、血量与位置，供棋盘以 40% 透明度绘制。
    expect(ghosts[0]).toMatchObject({ type: 'ranger', q: 4, r: -2, hp: 40, maxHp: 72, seenRound: 3 });
    expect(fog.ghostAt(projection, units, 4, -2)).toMatchObject({ unitId: 'enemy_stale' });
    expect(fog.ghostAt(projection, units, 0, 0)).toBeNull();
  });

  it('does not retain or expire ghosts on the client', () => {
    const fog = loadFogView();
    const projection = fog.normalizeProjection({
      ...FOG_PROJECTION,
      lastSeen: [{ ...FOG_PROJECTION.lastSeen[0], seenRound: 1 }],
    })!;

    // 服务端已裁剪过期残影；前端必须原样保留仍在下发的条目，不按轮次自行丢弃。
    expect(fog.ghostsFor(projection, [])).toHaveLength(1);
    const source = readFileSync('public/fog.js', 'utf8');
    expect(source).toContain('绝不在客户端重算视野范围，也不自行保留或过期残影');
    expect(source).not.toMatch(/seenRound\s*[<>=]/);
  });

  it('never synthesizes vision radii on the client', () => {
    const source = readFileSync('public/fog.js', 'utf8');

    // 默认视野只用于地图编辑器表单回显，不能被棋盘用来推导可见格。
    expect(source).toContain('DEFAULT_VISION');
    expect(source).not.toContain('visionRadius');
    expect(source).not.toMatch(/for \(let [dq]|hexDistance|distance/);
  });
});

describe('blind fire hint', () => {
  it('marks a hidden target cell as blind fire only when no visible unit is there', () => {
    const fog = loadFogView();
    const projection = fog.normalizeProjection(FOG_PROJECTION)!;

    expect(fog.blindFireHint(projection, false)).toBe('盲射');
    expect(fog.blindFireHint(projection, true)).toBeNull();
    expect(fog.blindFireHint(null, false)).toBeNull();
    expect(fog.blindFireHint({ ...projection, revealed: true }, false)).toBeNull();
  });
});

describe('fog config normalization', () => {
  it('falls back to contract defaults for missing or out-of-range vision', () => {
    const fog = loadFogView();

    expect(fog.normalizeVision({ scout: 0, heavy: 9, ranger: '3' })).toEqual({
      scout: 0,
      ranger: 3,
      infantry: 2,
      support: 2,
      heavy: 1,
    });
    expect(fog.normalizeFogConfig({ vision: { scout: 5 }, revealFromRound: 0 })).toEqual({
      vision: { scout: 5, ranger: 3, infantry: 2, support: 2, heavy: 1 },
      revealFromRound: null,
    });
    expect(fog.normalizeFogConfig({ revealFromRound: 18 }).revealFromRound).toBe(18);
  });
});
