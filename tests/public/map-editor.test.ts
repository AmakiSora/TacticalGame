import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

type EditorCore = {
  createDefaultMapConfig: () => any;
  normalizeImportedMap: (data: any) => any;
  serializeMapConfig: (config: any) => any;
  validateMapConfig: (config: any, id?: string) => string[];
  formatValidationError: (error: string) => string;
  resizeMapRadius: (config: any, radius: number, confirmRemoval: boolean) => { config: any; removed: number; requiresConfirmation: boolean };
};

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function loadCore(): EditorCore {
  const source = read('public/map-editor.js');
  const context: any = { console, window: {}, navigator: { clipboard: null }, Blob: class Blob {}, URL: { createObjectURL: () => '', revokeObjectURL: () => {} } };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.MapEditorCore;
}

describe('map editor page', () => {
  it('exposes a standalone editor page with import and export controls', () => {
    const html = read('public/map-editor.html');

    expect(html).toContain('<link rel="stylesheet" href="/map-editor.css" />');
    expect(html).toContain('id="map-canvas"');
    expect(html).toContain('id="btn-import"');
    expect(html).toContain('id="btn-export"');
    expect(html).toContain('id="zoom-label"');
    expect(html).not.toContain('id="zoom-input"');
    expect(html).toContain('id="btn-zoom-out"');
    expect(html).toContain('id="btn-zoom-in"');
    expect(html).toContain('id="btn-zoom-reset"');
    expect(html).toContain('id="validation-panel"');
    expect(html).toContain('<script src="/map-editor.js"></script>');
  });

  it('supports toolbar zoom buttons without hijacking wheel scroll', () => {
    const source = read('public/map-editor.js');

    expect(source).toContain('let zoom = 1');
    expect(source).toContain('function setZoom');
    expect(source).toContain("document.getElementById('zoom-label')");
    expect(source).not.toContain("document.getElementById('zoom-input')");
    expect(source).toContain("document.getElementById('btn-zoom-in')");
    expect(source).toContain("document.getElementById('btn-zoom-out')");
    expect(source).toContain("document.getElementById('btn-zoom-reset')");
    expect(source).not.toContain("els.canvas.addEventListener('wheel'");
  });

  it('draws canvas entities with glyphs matching spectator and player pages', () => {
    const source = read('public/map-editor.js');

    // Glyph helpers exist (same shape vocabulary as app.js / play.js)
    expect(source).toContain('function drawUnitGlyph(type, x, y)');
    expect(source).toContain('function drawControlPointGlyph(kind, x, y)');

    // Unit: circular piece + glyph (not text labels)
    expect(source).toContain('HEX_SIZE * 0.42');
    expect(source).not.toMatch(/UNIT_LABELS/);
    expect(source).not.toMatch(/CONTROL_POINT_LABELS/);

    // HQ: hex-filled with building glyph (not square with "HQ" text)
    expect(source).not.toMatch(/fillRect.*HQ/);
    expect(source).not.toContain("'A HQ'");
    expect(source).not.toContain("'B HQ'");
    expect(source).toMatch(/pathHex\(hq\.q, hq\.r, 5\)/);

    // Control points: hex outline + glyph (not circular token with text)
    expect(source).not.toMatch(/drawToken/);
    expect(source).toMatch(/pathHex\(point\.q, point\.r, 6\)/);
  });

  it('shows a token-icon in the selection panel matching spectator page style', () => {
    const html = read('public/map-editor.html');
    const css = read('public/map-editor.css');

    expect(html).toContain('id="selection-icon"');
    expect(html).toContain('class="token-icon');
    expect(html).toContain('id="selection-title-text"');

    // Token icon CSS classes present for all entity types
    expect(css).toContain('.token-icon.infantry');
    expect(css).toContain('.token-icon.scout');
    expect(css).toContain('.token-icon.heavy');
    expect(css).toContain('.token-icon.ranger');
    expect(css).toContain('.token-icon.support');
    expect(css).toContain('.token-icon.headquarters');
    expect(css).toContain('.token-icon.supply');
    expect(css).toContain('.token-icon.forward_base');
    expect(css).toContain('.token-icon.repair');
  });

  it('exports legacy maps without forcing typed control points', () => {
    const core = loadCore();
    const legacy = JSON.parse(read('maps/default.json'));

    const normalized = core.normalizeImportedMap(legacy);
    const serialized = core.serializeMapConfig(normalized);

    expect(serialized.controlPoints.every((point: any) => !('kind' in point))).toBe(true);
    expect(serialized.balance.controlPointTypes).toBeUndefined();
    expect(core.validateMapConfig(serialized, 'default')).toEqual([]);
  });

  it('preserves typed control point configuration during import and export', () => {
    const core = loadCore();
    const typed = JSON.parse(read('maps/dual-lanes.json'));

    const serialized = core.serializeMapConfig(core.normalizeImportedMap(typed));

    expect(serialized.controlPoints.map((point: any) => point.kind)).toEqual([
      'supply', 'repair', 'supply', 'forward_base', 'repair', 'forward_base',
    ]);
    expect(serialized.balance.controlPointTypes.forward_base.deployDiscount).toBe(8);
    expect(core.validateMapConfig(serialized, 'dual-lanes')).toEqual([]);
  });

  it('preserves optional comeback supply configuration and omits it when disabled', () => {
    const core = loadCore();
    const multiplayer = JSON.parse(read('maps/multiplayer-ring.json'));

    const serialized = core.serializeMapConfig(core.normalizeImportedMap(multiplayer));
    expect(serialized.balance.comebackSupply).toEqual({
      startRound: 3,
      scoreGapPercent: 40,
      amountPerRound: 20,
    });

    const defaults = core.serializeMapConfig(core.createDefaultMapConfig());
    expect(defaults.balance.comebackSupply).toBeUndefined();
  });

  it('validates comeback supply integer and percentage ranges', () => {
    const core = loadCore();
    const config = core.createDefaultMapConfig();
    config.balance.comebackSupply = { startRound: 2.5, scoreGapPercent: 101, amountPerRound: 0 };

    const errors = core.validateMapConfig(config, 'broken');
    expect(errors).toContain('Map "broken".balance.comebackSupply.startRound must be an integer');
    expect(errors).toContain('Map "broken".balance.comebackSupply.scoreGapPercent must be <= 100');
    expect(errors).toContain('Map "broken".balance.comebackSupply.amountPerRound must be a number >= 1');
  });

  it('rejects comeback startRound above maxTurns and formats the message', () => {
    const core = loadCore();
    const config = core.createDefaultMapConfig();
    config.balance.maxTurns = 10;
    config.balance.comebackSupply = { startRound: 12, scoreGapPercent: 40, amountPerRound: 20 };

    const errors = core.validateMapConfig(config, 'broken');
    expect(errors).toContain('Map "broken".balance.comebackSupply.startRound must be <= balance.maxTurns');
    expect(core.formatValidationError(errors[0])).toBe('追赶补给配置的开始轮次不能大于最大回合。');
  });

  it('clamps bound number inputs with min and max', () => {
    const source = read('public/map-editor.js');
    expect(source).toContain('function clampBoundNumber');
    expect(source).toContain('clampBoundNumber(input.value, input.min, input.max)');
    expect(source).toContain('comebackSupplyDraft');
  });

  it('validates positions, overlap, typed point consistency, and numeric ranges', () => {
    const core = loadCore();
    const config = core.createDefaultMapConfig();
    config.controlPoints = [
      { id: 'cp_a', name: 'A', kind: 'supply', q: 0, r: 0 },
      { id: 'cp_b', name: 'B', q: 1, r: 0 },
    ];
    config.headquarters.player_a = { q: 0, r: 0 };
    config.startingUnits = [{ owner: 'player_a', type: 'infantry', q: 10, r: 0 }];
    config.balance.startingSupplies = -1;

    const errors = core.validateMapConfig(config, 'broken');

    expect(errors).toContain('controlPoints[0] overlaps another fixed map object at 0,0');
    expect(errors).toContain('startingUnits[0] (10,0) is outside radius 8');
    expect(errors).toContain('Map "broken".controlPoints must all define kind when any control point is typed');
    expect(errors).toContain('Map "broken".balance.startingSupplies must be a number >= 0');
  });

  it('formats validation errors in Chinese for display', () => {
    const core = loadCore();

    expect(core.formatValidationError('Map "editor".controlPoints must be a non-empty array')).toBe('地图必须至少有 1 个据点。');
    expect(core.formatValidationError('startingUnits[0] (10,0) is outside radius 8')).toBe('初始单位 1 的坐标 (10,0) 超出地图半径 8。');
    expect(core.formatValidationError('controlPoints[0] overlaps another fixed map object at 0,0')).toBe('据点 1 与另一个固定对象重叠，位置为 0,0。');
    expect(core.formatValidationError('Map "editor".controlPoints must all define kind when any control point is typed')).toBe('如果任意据点设置了类型，所有据点都必须设置类型。');
    expect(core.formatValidationError('Map "editor".balance.startingSupplies must be a number >= 0')).toBe('平衡设置的初始金币必须是大于等于 0 的数字。');
  });

  it('requires confirmation before radius shrink removes outside objects', () => {
    const core = loadCore();
    const config = core.createDefaultMapConfig();
    config.headquarters.player_a = { q: -6, r: 0 };
    config.headquarters.player_b = { q: 6, r: 0 };
    config.terrainCells.push({ q: 8, r: 0, terrain: 'water' });
    config.controlPoints.push({ id: 'edge', name: 'Edge', q: 7, r: 0 });

    const preview = core.resizeMapRadius(config, 6, false);
    expect(preview.requiresConfirmation).toBe(true);
    expect(preview.removed).toBe(2);

    const applied = core.resizeMapRadius(config, 6, true);
    expect(applied.config.radius).toBe(6);
    expect(applied.config.terrainCells.some((cell: any) => cell.q === 8 && cell.r === 0)).toBe(false);
    expect(applied.config.controlPoints.some((point: any) => point.id === 'edge')).toBe(false);
  });
});
