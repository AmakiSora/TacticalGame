import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { artilleryStateForRound } from '../../src/engine/artillery.js';

type EditorCore = {
  createDefaultMapConfig: () => any;
  configureMapMode: (config: any, mode: 'standard' | 'annihilation' | 'simultaneous' | 'royale', annihilationDraft?: any) => any;
  normalizeImportedMap: (data: any) => any;
  serializeMapConfig: (config: any) => any;
  validateMapConfig: (config: any, id?: string) => string[];
  formatValidationError: (error: string) => string;
  resizeMapRadius: (config: any, radius: number, confirmRemoval: boolean) => { config: any; removed: number; requiresConfirmation: boolean };
  updateSpawnControlPointReferences: (config: any, previousId: string, nextId?: string) => any;
  hexDistance: (a: { q: number; r: number }, b: { q: number; r: number }) => number;
  artilleryTimeline: (config: any) => {
    radius: number;
    startRound: number;
    intervalRounds: number;
    minRadius: number;
    shrinkRounds: number[];
    lastShrinkRound: number;
    maxRound: number;
  } | null;
  artilleryPreviewAt: (config: any, round: number) => {
    round: number;
    safeRadius: number;
    nextShrinkRound: number | null;
    settled: boolean;
    danger: Array<{ q: number; r: number }>;
    warning: Array<{ q: number; r: number }>;
  } | null;
  clampPreviewRound: (round: number | undefined, timeline: {
    startRound: number;
    maxRound: number;
    lastShrinkRound: number;
    intervalRounds: number;
  }) => number;
};

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function loadCore(): EditorCore {
  // 入口文件的 ESM import 头在 VM Script 模式下非法，执行前剥离。
  const source = read('public/map-editor.js').replace(/^import\s+'[^']+';\s*$/gm, '');
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
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1" />');
    expect(html).toContain('id="map-canvas"');
    expect(html).toContain('id="btn-import"');
    expect(html).toContain('id="btn-export"');
    expect(html).toContain('id="zoom-label"');
    expect(html).not.toContain('id="zoom-input"');
    expect(html).toContain('id="btn-zoom-out"');
    expect(html).toContain('id="btn-zoom-in"');
    expect(html).toContain('id="btn-zoom-reset"');
    expect(html).toContain('id="validation-panel"');
    expect(html).toContain('id="map-mode"');
    expect(html).toContain('data-mode="standard"');
    expect(html).toContain('data-mode="annihilation"');
    expect(html).toContain('data-mode="simultaneous"');
    expect(html).toContain('data-mode="royale"');
    expect(html).toContain('id="annihilation-panel"');
    expect(html).toContain('<script type="module" src="/map-editor.js"></script>');
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

  it('uses 100% zoom as the fit-to-view scale for the whole map', () => {
    const source = read('public/map-editor.js');
    const css = read('public/map-editor.css');

    // 100% 是“整图适配”的基准，而不是画布原始像素尺寸。
    expect(source).toContain('function computeFitScale');
    expect(source).toContain('let fitScale = 1');
    expect(source).toContain('fitScale = computeFitScale()');
    expect(source).toContain('const scale = fitScale * zoom');
    expect(source).toContain("window.addEventListener('resize', scheduleFitRefresh)");

    // 画布小于容器时居中，避免留白全挤在右侧。
    expect(css).toMatch(/\.board-wrap\s*\{[^}]*display:\s*flex/s);
    expect(css).toMatch(/#map-canvas\s*\{[^}]*margin:\s*auto/s);
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
    expect(css).toContain('.token-icon.spawn-point');
    expect(css).toContain('.token-icon.supply');
    expect(css).toContain('.token-icon.forward_base');
    expect(css).toContain('.token-icon.repair');
  });

  it('exports every map with typed control points now that plain CPs are gone', () => {
    const core = loadCore();
    const legacy = JSON.parse(read('maps/default.json'));

    const normalized = core.normalizeImportedMap(legacy);
    const serialized = core.serializeMapConfig(normalized);

    expect(serialized.controlPoints.every((point: any) => point.kind === 'supply')).toBe(true);
    expect(serialized.balance.controlPointTypes.supply).toMatchObject({ income: 12, deployDiscount: 0, repairAmount: 0 });
    expect(serialized.balance.controlPointIncome).toBeUndefined();
    expect(serialized.spawnSlots).toBeUndefined();
    expect(serialized.layouts).toBeUndefined();
    expect(core.validateMapConfig(serialized, 'default')).toEqual([]);
  });

  it('migrates legacy untyped map imports to supply control points and inherits their income', () => {
    const core = loadCore();
    const legacy = {
      name: 'Old Map',
      description: 'pre-typing export',
      grid: 'hex',
      orientation: 'pointy',
      radius: 2,
      terrainCells: [],
      controlPoints: [
        { id: 'cp_a', name: 'A', q: -2, r: 0 },
        { id: 'cp_b', name: 'B', q: 2, r: 0 },
      ],
      headquarters: { player_a: { q: -1, r: 0 }, player_b: { q: 1, r: 0 } },
      startingUnits: [],
      units: JSON.parse(read('maps/default.json')).units,
      headquartersSpec: { hp: 180, defense: 6 },
      balance: {
        startingSupplies: 80,
        baseIncome: 10,
        controlPointIncome: 9,
        damageVarianceRange: 3,
        minimumDamage: 1,
        healVarianceRange: 6,
        actionsPerTurn: 5,
        maxTurns: 15,
        adjudicationWeights: { enemyHqDamage: 4, ownHqHp: 2, controlPoint: 90, armyValue: 2, supplies: 1 },
      },
    };

    const normalized = core.normalizeImportedMap(legacy);
    expect(normalized.controlPoints.map((point: any) => point.kind)).toEqual(['supply', 'supply']);
    expect(normalized.balance.controlPointTypes.supply.income).toBe(9);
    expect(normalized.balance.controlPointIncome).toBeUndefined();

    const serialized = core.serializeMapConfig(normalized);
    expect(serialized.balance.controlPointTypes.supply.income).toBe(9);
    expect(core.validateMapConfig(serialized, 'old-map')).toEqual([]);
  });

  it('round-trips irregular cells and complete multiplayer spawn layouts', () => {
    const core = loadCore();
    const irregular = JSON.parse(read('maps/whirlpool.json'));

    const normalized = core.normalizeImportedMap(irregular);
    const serialized = core.serializeMapConfig(normalized);

    expect(serialized.playableCells).toHaveLength(217);
    expect(core.createCellsFromConfig(normalized)).toHaveLength(217);
    expect(serialized.spawnSlots).toHaveLength(6);
    expect(serialized.layouts).toEqual({
      2: ['slot_e', 'slot_w'],
      3: ['slot_e', 'slot_sw', 'slot_nw'],
      6: ['slot_e', 'slot_se', 'slot_sw', 'slot_w', 'slot_nw', 'slot_ne'],
    });
    expect(serialized).not.toHaveProperty('headquarters');
    expect(serialized).not.toHaveProperty('startingUnits');
    expect(core.validateMapConfig(serialized, 'whirlpool')).toEqual([]);
  });

  it('preserves annihilation mode, artillery settings, and spawn point ownership links', () => {
    const core = loadCore();
    const annihilation = JSON.parse(read('maps/artillery-zone.json'));

    const serialized = core.serializeMapConfig(core.normalizeImportedMap(annihilation));

    expect(serialized.mode).toBe('annihilation');
    expect(serialized.annihilation.artillery).toEqual({
      startRound: 5,
      intervalRounds: 2,
      damage: 25,
      minimumSafeRadius: 1,
    });
    expect(serialized.balance.maxTurns).toBe(20);
    expect(serialized.controlPoints.filter((point: any) => point.kind === 'supply')).toHaveLength(6);
    expect(serialized.spawnSlots.map((slot: any) => slot.controlPointId)).toEqual([
      'cp_east',
      'cp_northeast',
      'cp_northwest',
      'cp_west',
      'cp_southwest',
      'cp_southeast',
    ]);
    expect(serialized.layouts).toEqual({
      2: ['slot_east', 'slot_west'],
      3: ['slot_east', 'slot_northwest', 'slot_southwest'],
      6: ['slot_east', 'slot_northeast', 'slot_northwest', 'slot_west', 'slot_southwest', 'slot_southeast'],
    });
  });

  it('round-trips simultaneous mode and its multiplayer spawn layouts', () => {
    const core = loadCore();
    const simultaneous = JSON.parse(read('maps/standoff.json'));

    const normalized = core.normalizeImportedMap(simultaneous);
    const serialized = core.serializeMapConfig(normalized);

    expect(normalized.mode).toBe('simultaneous');
    expect(serialized.mode).toBe('simultaneous');
    expect(serialized.spawnSlots).toHaveLength(6);
    expect(serialized.layouts).toEqual(simultaneous.layouts);
    expect(serialized).not.toHaveProperty('annihilation');
    expect(core.validateMapConfig(serialized, 'standoff')).toEqual([]);
  });

  it('uses a three-zone workspace with tabbed inspector navigation', () => {
    const html = read('public/map-editor.html');
    const source = read('public/map-editor.js');

    expect(html).toContain('class="tool-rail"');
    expect(html).toContain('class="board-panel"');
    expect(html).toContain('class="inspector"');
    expect(html.match(/data-inspector-tab=/g)).toHaveLength(5);
    expect(html.match(/data-inspector-pane=/g)).toHaveLength(5);
    expect(source).toContain('function activateInspectorTab(tabId)');
    expect(source).toContain("activateInspectorTab('selection')");
    expect(source).toContain("activateInspectorTab('rules')");
  });

  it('creates a complete annihilation configuration and restores standard defaults when switching back', () => {
    const core = loadCore();
    const annihilation = core.configureMapMode(core.createDefaultMapConfig(), 'annihilation');
    annihilation.controlPoints = [
      { id: 'cp_a', name: 'A 出生点', kind: 'forward_base', q: -4, r: 0 },
      { id: 'cp_b', name: 'B 出生点', kind: 'forward_base', q: 4, r: 0 },
    ];
    annihilation.spawnSlots[0].controlPointId = 'cp_a';
    annihilation.spawnSlots[1].controlPointId = 'cp_b';

    const serialized = core.serializeMapConfig(annihilation);
    expect(serialized.mode).toBe('annihilation');
    expect(serialized.annihilation.artillery).toEqual({
      startRound: 5,
      intervalRounds: 2,
      damage: 25,
      minimumSafeRadius: 2,
    });
    expect(serialized.balance.adjudicationWeights.killValue).toBe(0.5);
    expect(serialized.spawnSlots.map((slot: any) => slot.controlPointId)).toEqual(['cp_a', 'cp_b']);
    expect(core.validateMapConfig(serialized, 'new-annihilation')).toEqual([]);

    const standard = core.configureMapMode(annihilation, 'standard');
    expect(standard.mode).toBe('standard');
    expect(standard.annihilation).toBeUndefined();
    expect(standard.balance.adjudicationWeights.killValue).toBe(0.5);
  });

  it('validates annihilation artillery and unique spawn point ownership links', () => {
    const core = loadCore();
    const config = core.configureMapMode(core.createDefaultMapConfig(), 'annihilation');
    config.controlPoints = [
      { id: 'cp_a', name: 'A', kind: 'supply', q: -4, r: 0 },
      { id: 'cp_b', name: 'B', kind: 'supply', q: 4, r: 0 },
    ];
    config.spawnSlots[0].controlPointId = 'cp_a';
    config.spawnSlots[1].controlPointId = 'cp_a';
    config.annihilation.artillery.damage = 0;
    config.annihilation.artillery.intervalRounds = 1.5;
    config.annihilation.artillery.minimumSafeRadius = config.radius;

    const errors = core.validateMapConfig(core.serializeMapConfig(config), 'broken-annihilation');
    expect(errors).toContain('Map "broken-annihilation".annihilation.artillery.damage must be a number >= 1');
    expect(errors).toContain('Map "broken-annihilation".annihilation.artillery.intervalRounds must be an integer');
    expect(errors).toContain('Map "broken-annihilation".annihilation.artillery.minimumSafeRadius must be smaller than radius');
    expect(errors).toContain('spawnSlots[1].controlPointId must be unique');

    config.spawnSlots[1].controlPointId = 'missing';
    expect(core.validateMapConfig(core.serializeMapConfig(config), 'broken-annihilation'))
      .toContain('spawnSlots[1].controlPointId must reference a control point');
  });

  it('accepts minimumSafeRadius 0 in royale maps and still rejects negatives', () => {
    const core = loadCore();
    const serialized = core.serializeMapConfig(core.normalizeImportedMap(JSON.parse(read('maps/snowflake.json'))));

    expect(serialized.mode).toBe('royale');
    expect(serialized.annihilation.artillery.minimumSafeRadius).toBe(1);
    expect(core.validateMapConfig(serialized, 'snowflake')).toEqual([]);

    serialized.annihilation.artillery.minimumSafeRadius = -1;
    expect(core.validateMapConfig(serialized, 'snowflake'))
      .toContain('Map "snowflake".annihilation.artillery.minimumSafeRadius must be a number >= 0');
  });

  it('keeps annihilation radius and spawn point references consistent during edits', () => {
    const core = loadCore();
    const config = core.configureMapMode(core.createDefaultMapConfig(), 'annihilation');
    config.spawnSlots[0].controlPointId = 'old_cp';
    config.spawnSlots[1].controlPointId = 'other_cp';

    core.updateSpawnControlPointReferences(config, 'old_cp', 'new_cp');
    expect(config.spawnSlots[0].controlPointId).toBe('new_cp');
    core.updateSpawnControlPointReferences(config, 'new_cp');
    expect(config.spawnSlots[0].controlPointId).toBeUndefined();

    config.annihilation.artillery.minimumSafeRadius = 2;
    const resized = core.resizeMapRadius(config, 1, true).config;
    expect(resized.radius).toBe(2);
    expect(resized.annihilation.artillery.minimumSafeRadius).toBe(1);
  });

  it('exposes irregular-boundary and 2-8 player layout editing controls', () => {
    const html = read('public/map-editor.html');
    const source = read('public/map-editor.js');

    expect(html).toContain('data-tool="add-cell"');
    expect(html).toContain('data-tool="remove-cell"');
    expect(html).toContain('id="spawn-layout-fields"');
    expect(source).toContain('function materializePlayableCells');
    expect(source).toContain('function removePlayableCell');
    expect(source).toContain('function renderSpawnLayouts');
    expect(source).toContain("Array.from({ length: 7 }, (_, offset) => offset + 2)");
  });

  it('preserves typed control point configuration during import and export', () => {
    const core = loadCore();
    const typed = JSON.parse(read('maps/dual-lanes.json'));

    const serialized = core.serializeMapConfig(core.normalizeImportedMap(typed));

    expect(serialized.controlPoints.map((point: any) => point.kind)).toEqual([
      'supply', 'repair', 'supply', 'forward_base', 'repair', 'forward_base',
    ]);
    expect(serialized.balance.controlPointTypes.forward_base.deployDiscount).toBe(8);
    // 缺省允许部署：canDeploy 为 true 时不落盘（与 deployFromHq 同口径）。
    expect(serialized.balance.controlPointTypes.supply.canDeploy).toBeUndefined();
    expect(core.validateMapConfig(serialized, 'dual-lanes')).toEqual([]);
  });

  it('serializes per-kind deploy switches and drops them when re-enabled', () => {
    const core = loadCore();
    const typed = JSON.parse(read('maps/dual-lanes.json'));

    const banned = core.normalizeImportedMap(typed);
    banned.balance.controlPointTypes.supply.canDeploy = false;
    const bannedSerialized = core.serializeMapConfig(banned);
    expect(bannedSerialized.balance.controlPointTypes.supply.canDeploy).toBe(false);
    expect(bannedSerialized.balance.controlPointTypes.forward_base.canDeploy).toBeUndefined();
    expect(core.validateMapConfig(bannedSerialized, 'dual-lanes')).toEqual([]);

    const reEnabled = core.normalizeImportedMap(bannedSerialized);
    reEnabled.balance.controlPointTypes.supply.canDeploy = true;
    const reEnabledSerialized = core.serializeMapConfig(reEnabled);
    expect(reEnabledSerialized.balance.controlPointTypes.supply.canDeploy).toBeUndefined();
  });

  it('preserves optional comeback supply configuration and omits it when disabled', () => {
    const core = loadCore();
    const multiplayer = JSON.parse(read('maps/multiplayer-ring.json'));

    const serialized = core.serializeMapConfig(core.normalizeImportedMap(multiplayer));
    expect(serialized.spawnSlots).toHaveLength(6);
    expect(serialized.layouts).toEqual(multiplayer.layouts);
    expect(core.validateMapConfig(serialized, 'multiplayer-ring')).toEqual([]);
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

  it('keeps maxTurns null through import, serialization and validation', () => {
    const core = loadCore();
    const whirlpool = JSON.parse(read('maps/whirlpool.json'));

    const normalized = core.normalizeImportedMap(whirlpool);
    expect(normalized.balance.maxTurns).toBeNull();

    const serialized = core.serializeMapConfig(normalized);
    expect(serialized.balance.maxTurns).toBeNull();
    expect(core.validateMapConfig(serialized, 'whirlpool').filter(error => error.includes('maxTurns'))).toEqual([]);
  });

  it('still rejects missing or zero maxTurns in the editor', () => {
    const core = loadCore();

    const missing = core.createDefaultMapConfig();
    delete missing.balance.maxTurns;
    expect(core.validateMapConfig(missing, 'broken')).toContain('Map "broken".balance.maxTurns is required');

    const zero = core.createDefaultMapConfig();
    zero.balance.maxTurns = 0;
    expect(core.validateMapConfig(zero, 'broken')).toContain('Map "broken".balance.maxTurns must be a number >= 1');
  });

  it('exposes an unlimited-turns toggle in the balance editor', () => {
    const source = read('public/map-editor.js');

    expect(source).toContain('unlimited-turns-enabled');
    expect(source).toContain('无回合上限');
    expect(source).toContain('maxTurnsDraft');
  });

  it('keeps deployFromHq false through serialization, import and validation', () => {
    const core = loadCore();
    const config = core.createDefaultMapConfig();
    config.balance.deployFromHq = false;

    const serialized = core.serializeMapConfig(config);
    expect(serialized.balance.deployFromHq).toBe(false);
    expect(core.validateMapConfig(serialized, 'hqlock').filter(error => error.includes('deployFromHq'))).toEqual([]);

    const normalized = core.normalizeImportedMap(serialized);
    expect(normalized.balance.deployFromHq).toBe(false);

    // 缺省地图不落该键，序列化/导入一圈后仍保持「未配置 = 允许」。
    const defaultSerialized = core.serializeMapConfig(core.createDefaultMapConfig());
    expect('deployFromHq' in defaultSerialized.balance).toBe(false);
    expect(core.normalizeImportedMap(defaultSerialized).balance.deployFromHq).toBeUndefined();
  });

  it('rejects non-boolean deployFromHq in the editor', () => {
    const core = loadCore();
    const config = core.createDefaultMapConfig();
    config.balance.deployFromHq = 'false';
    expect(core.validateMapConfig(config, 'broken')).toContain('Map "broken".balance.deployFromHq must be boolean');
  });

  it('clamps bound number inputs with min and max', () => {
    const source = read('public/map-editor.js');
    expect(source).toContain('function clampBoundNumber');
    expect(source).toContain('clampBoundNumber(input.value, input.min, input.max)');
    expect(source).toContain('comebackSupplyDraft');
  });

  it('validates positions, overlap, control point kinds, and numeric ranges', () => {
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
    expect(errors).toContain('controlPoints[1].kind is required');
    expect(errors).toContain('Map "broken".balance.startingSupplies must be a number >= 0');
  });

  it('formats validation errors in Chinese for display', () => {
    const core = loadCore();

    expect(core.formatValidationError('startingUnits[0] (10,0) is outside radius 8')).toBe('初始单位 1 的坐标 (10,0) 超出地图半径 8。');
    expect(core.formatValidationError('controlPoints[0] overlaps another fixed map object at 0,0')).toBe('据点 1 与另一个固定对象重叠，位置为 0,0。');
    expect(core.formatValidationError('controlPoints[1].kind is required')).toBe('据点 2 缺少类型。');
    expect(core.formatValidationError('Map "editor".balance.controlPointTypes is required')).toBe('必须配置补给站、前线基地、维修站三种据点类型的效果。');
    expect(core.formatValidationError('Map "editor".balance.startingSupplies must be a number >= 0')).toBe('平衡设置的初始金币必须是大于等于 0 的数字。');
  });

  it('labels spawn slot anchors as spawn points in annihilation mode', () => {
    const core = loadCore();
    const source = read('public/map-editor.js');
    const html = read('public/map-editor.html');

    // 标准模式默认配置下，出生槽锚点仍称总部
    expect(core.formatValidationError('spawnSlots[0].headquarters (6,-6) is outside radius 5')).toBe('出生槽 1 总部 的坐标 (6,-6) 超出地图半径 5。');

    // 歼灭模式：画布绘制与选中面板按模式分流为出生点
    expect(source).toContain("if (isAnnihilationMode(config.mode)) drawSpawnAnchor(slot.id, slot.headquarters, slotIndex);");
    expect(source).toContain('else drawHeadquarters(slot.id, slot.headquarters, slotIndex);');
    expect(source).toContain('function drawSpawnAnchor');
    expect(source).toContain('function hqTerm()');
    expect(source).toContain("isAnnihilationMode(config.mode) ? '出生点' : '总部'");
    expect(source).toContain("setSelectionIcon(isAnnihilationMode(config.mode) ? 'spawn-point' : 'headquarters'");

    // 工具按钮带动态标签挂载点，规则页歼灭模式隐藏总部规格
    expect(html).toContain('id="hq-tool-label"');
    expect(html).toContain('id="hq-tool-icon"');
    expect(source).toContain("...(isAnnihilationMode(config.mode)");
    expect(source).toContain("fieldHtml('hq:hp'");
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

// 炮火缩圈预览：纯函数口径必须与 src/engine/artillery.ts 一致（复刻 + 单测对拍，不 import 服务端模块）。
// 固定参数：radius 6、startRound 3、interval 2、minimumSafeRadius 2 → kMax 4，收缩轮 3/5/7/9，last 9，max 11。
function annihilationConfig(core: EditorCore, overrides: Record<string, number> = {}, radius = 6): any {
  const config = core.configureMapMode(core.createDefaultMapConfig(), 'annihilation');
  config.radius = radius;
  Object.assign(config.annihilation.artillery, {
    startRound: 3, intervalRounds: 2, damage: 25, minimumSafeRadius: 2,
  }, overrides);
  return config;
}

describe('artillery shrink preview (pure core)', () => {
  it('hexDistance matches the engine formula (center 0, known rings, symmetric)', () => {
    const core = loadCore();
    const center = { q: 0, r: 0 };
    expect(core.hexDistance(center, center)).toBe(0);
    // 已知环上的点：轴向三轴各取一端。
    expect(core.hexDistance(center, { q: 3, r: 0 })).toBe(3);
    expect(core.hexDistance(center, { q: 0, r: -3 })).toBe(3);
    expect(core.hexDistance(center, { q: -3, r: 3 })).toBe(3);
    expect(core.hexDistance(center, { q: 2, r: -2 })).toBe(2);
    expect(core.hexDistance({ q: -2, r: 2 }, { q: 2, r: -2 })).toBe(4);
    // 与引擎一致的对称性。
    expect(core.hexDistance({ q: 4, r: -1 }, { q: -1, r: 2 }))
      .toBe(core.hexDistance({ q: -1, r: 2 }, { q: 4, r: -1 }));
  });

  it('does not shrink before the start round', () => {
    const core = loadCore();
    const config = annihilationConfig(core);
    const view = core.artilleryPreviewAt(config, 2)!;
    expect(view.round).toBe(2);
    expect(view.safeRadius).toBe(6);
    expect(view.danger).toEqual([]);
    expect(view.nextShrinkRound).toBe(3);
    expect(view.settled).toBe(false);
  });

  it('shrinks exactly once on the start round', () => {
    const core = loadCore();
    const view = core.artilleryPreviewAt(annihilationConfig(core), 3)!;
    expect(view.safeRadius).toBe(5); // 6 - 1
    expect(view.nextShrinkRound).toBe(5);
    // 只收缩一圈：危险区就是刚被甩出去的第 6 环（36 格），内圈仍安全。
    expect(view.danger).toHaveLength(36);
    expect(view.danger.every(cell => core.hexDistance(cell, { q: 0, r: 0 }) === 6)).toBe(true);
  });

  it('shrinks every interval and stops at the minimum safe radius', () => {
    const core = loadCore();
    const config = annihilationConfig(core);
    const radiusByRound = [3, 5, 7, 9, 11].map(round => core.artilleryPreviewAt(config, round)!.safeRadius);
    // 3→5、5→4、7→3、9→2（到底）、11→仍是 2（滑块上界也不越过最小半径）。
    expect(radiusByRound).toEqual([5, 4, 3, 2, 2]);
    expect(core.artilleryPreviewAt(config, 9)!.settled).toBe(true);
    expect(core.artilleryPreviewAt(config, 11)!.settled).toBe(true);
    // 到底后危险区 = 可用格子中距离 > 2 的全部（127 - 19 个内圈）。
    expect(core.artilleryPreviewAt(config, 9)!.danger).toHaveLength(108);
  });

  it('reports nextShrinkRound in its three states (first / later / settled)', () => {
    const core = loadCore();
    const config = annihilationConfig(core);
    expect(core.artilleryPreviewAt(config, 2)!.nextShrinkRound).toBe(3); // 首次收缩 = startRound
    expect(core.artilleryPreviewAt(config, 5)!.nextShrinkRound).toBe(7); // start + k * interval
    expect(core.artilleryPreviewAt(config, 7)!.nextShrinkRound).toBe(9);
    expect(core.artilleryPreviewAt(config, 9)!.nextShrinkRound).toBeNull(); // 到底
  });

  it('warns only on the round right before a shrink, and never once settled', () => {
    const core = loadCore();
    const config = annihilationConfig(core);
    const center = { q: 0, r: 0 };
    // 第 2 轮：下一轮（第 3 轮）就收缩 → 预警圈 = 当前安全半径那一圈（距离 6）。
    const beforeStart = core.artilleryPreviewAt(config, 2)!;
    expect(beforeStart.warning).toHaveLength(36);
    expect(beforeStart.warning.every(cell => core.hexDistance(cell, center) === 6)).toBe(true);
    // 收缩当轮不再预警。
    expect(core.artilleryPreviewAt(config, 3)!.warning).toEqual([]);
    // 第 4 轮：下一轮（第 5 轮）收缩 → 预警距离 5 的那一圈。
    const beforeSecond = core.artilleryPreviewAt(config, 4)!;
    expect(beforeSecond.warning).toHaveLength(30);
    expect(beforeSecond.warning.every(cell => core.hexDistance(cell, center) === 5)).toBe(true);
    // 收到底后永远没有预警。
    expect(core.artilleryPreviewAt(config, 9)!.warning).toEqual([]);
    expect(core.artilleryPreviewAt(config, 11)!.warning).toEqual([]);
  });

  it('computes danger over playableCells only', () => {
    const core = loadCore();
    const config = annihilationConfig(core);
    const playable = [
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: 6, r: 0 },
      { q: -6, r: 0 },
    ];
    config.playableCells = playable;
    const view = core.artilleryPreviewAt(config, 9)!; // safeRadius 2
    expect(view.danger).toEqual([{ q: 6, r: 0 }, { q: -6, r: 0 }]);
    // 不在 playableCells 里的方向（如 (0, 6)）即使超出安全半径也不进来。
    expect(view.danger.some(cell => cell.q === 0 && cell.r === 6)).toBe(false);
    // 每个危险格都必须在可用集合内。
    const keys = new Set(playable.map(cell => `${cell.q},${cell.r}`));
    expect(view.danger.every(cell => keys.has(`${cell.q},${cell.r}`))).toBe(true);
  });

  it('derives the timeline: shrink rounds, last shrink and max round', () => {
    const core = loadCore();
    const timeline = core.artilleryTimeline(annihilationConfig(core))!;
    expect(timeline.radius).toBe(6);
    expect(timeline.startRound).toBe(3);
    expect(timeline.intervalRounds).toBe(2);
    expect(timeline.minRadius).toBe(2);
    expect(timeline.shrinkRounds).toEqual([3, 5, 7, 9]);
    expect(timeline.lastShrinkRound).toBe(9);
    expect(timeline.maxRound).toBe(11); // lastShrinkRound + intervalRounds
    expect(timeline.maxRound).toBe(timeline.lastShrinkRound + timeline.intervalRounds);
  });

  it('handles minimumSafeRadius = 0 (kMax = radius)', () => {
    const core = loadCore();
    const config = annihilationConfig(core, { minimumSafeRadius: 0 });
    const timeline = core.artilleryTimeline(config)!;
    expect(timeline.shrinkRounds).toEqual([3, 5, 7, 9, 11, 13]);
    expect(timeline.lastShrinkRound).toBe(13);
    expect(timeline.maxRound).toBe(15);
    const settled = core.artilleryPreviewAt(config, 15)!;
    expect(settled.safeRadius).toBe(0);
    expect(settled.settled).toBe(true);
  });

  it('handles a very large interval (few pictures, wide slider range)', () => {
    const core = loadCore();
    const config = annihilationConfig(core, { intervalRounds: 100 });
    const timeline = core.artilleryTimeline(config)!;
    expect(timeline.shrinkRounds).toEqual([3, 103, 203, 303]);
    expect(timeline.maxRound).toBe(403);
    // 第 50 轮仍在第一次收缩之后：半径 5，下次收缩第 103 轮。
    const view = core.artilleryPreviewAt(config, 50)!;
    expect(view.safeRadius).toBe(5);
    expect(view.nextShrinkRound).toBe(103);
  });

  it('falls back to kMax = 1 when radius is already at or below the minimum', () => {
    const core = loadCore();
    const config = annihilationConfig(core, {}, 2); // radius 2 == minimumSafeRadius 2
    const timeline = core.artilleryTimeline(config)!;
    expect(timeline.shrinkRounds).toEqual([3]);
    expect(timeline.lastShrinkRound).toBe(3);
    expect(timeline.maxRound).toBe(5);
    expect(core.artilleryPreviewAt(config, 1)!.safeRadius).toBe(2); // max(2, 2 - 0)
    expect(core.artilleryPreviewAt(config, 3)!.settled).toBe(true); // 收到 min 即到底
  });

  it('returns null for non-annihilation modes and for missing artillery config', () => {
    const core = loadCore();
    const standard = core.createDefaultMapConfig();
    expect(core.artilleryTimeline(standard)).toBeNull();
    expect(core.artilleryPreviewAt(standard, 5)).toBeNull();

    const simultaneous = core.configureMapMode(core.createDefaultMapConfig(), 'simultaneous');
    expect(core.artilleryTimeline(simultaneous)).toBeNull();

    const withoutArtillery = core.configureMapMode(core.createDefaultMapConfig(), 'annihilation');
    delete withoutArtillery.annihilation;
    expect(core.artilleryTimeline(withoutArtillery)).toBeNull();
    expect(core.artilleryPreviewAt(withoutArtillery, 5)).toBeNull();

    // 大逃杀与歼灭同分支（同一套缩圈规则）。
    const royale = core.configureMapMode(core.createDefaultMapConfig(), 'royale');
    expect(core.artilleryTimeline(royale)).not.toBeNull();
  });

  it('clamps out-of-range rounds to [1, maxRound]', () => {
    const core = loadCore();
    const config = annihilationConfig(core);
    expect(core.artilleryPreviewAt(config, 0)!.round).toBe(1);
    expect(core.artilleryPreviewAt(config, -5)!.round).toBe(1);
    expect(core.artilleryPreviewAt(config, 999)!.round).toBe(11);
    expect(core.artilleryPreviewAt(config, 999)!.settled).toBe(true);
  });

  // 真正的「锁一致」：直接拿引擎的 artilleryStateForRound 对拍，防止前端复刻随引擎漂移。
  it('matches the engine artilleryStateForRound round by round', () => {
    const core = loadCore();
    const config = annihilationConfig(core);
    const cells: Array<{ q: number; r: number }> = [];
    for (let q = -6; q <= 6; q++) {
      for (let r = -6; r <= 6; r++) {
        if (Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r)) <= 6) cells.push({ q, r });
      }
    }
    const game = {
      config: { mode: 'annihilation', annihilation: { artillery: { ...config.annihilation.artillery } } },
      map: { radius: 6 },
      cells,
    };
    const key = (pos: { q: number; r: number }) => `${pos.q},${pos.r}`;
    for (let round = 1; round <= 11; round++) {
      const ours = core.artilleryPreviewAt(config, round)!;
      const engine = artilleryStateForRound(game as any, round)!;
      expect(ours.safeRadius, `round ${round} safeRadius`).toBe(engine.safeRadius);
      expect(ours.nextShrinkRound, `round ${round} nextShrinkRound`).toBe(engine.nextShrinkRound);
      expect(ours.settled, `round ${round} settled`).toBe(engine.nextShrinkRound === null);
      expect(ours.danger.map(key).sort(), `round ${round} danger`).toEqual(engine.dangerCells.map(key).sort());
      expect(ours.warning.map(key).sort(), `round ${round} warning`).toEqual(engine.warningCells.map(key).sort());
    }
  });
});

describe('artillery preview round clamping (pure core)', () => {
  it('clamps out-of-range values into [1, maxRound]', () => {
    const core = loadCore();
    const timeline = core.artilleryTimeline(annihilationConfig(core))!;
    expect(core.clampPreviewRound(0, timeline)).toBe(1);
    expect(core.clampPreviewRound(-5, timeline)).toBe(1);
    expect(core.clampPreviewRound(999, timeline)).toBe(timeline.maxRound);
  });

  it('rounds to the nearest integer instead of truncating', () => {
    const core = loadCore();
    const timeline = core.artilleryTimeline(annihilationConfig(core))!;
    expect(core.clampPreviewRound(1.6, timeline)).toBe(2);
    expect(core.clampPreviewRound(5.5, timeline)).toBe(6);
    expect(core.clampPreviewRound(3.4, timeline)).toBe(3);
  });

  it('falls back to startRound for non-finite input', () => {
    const core = loadCore();
    const timeline = core.artilleryTimeline(annihilationConfig(core))!;
    expect(timeline.startRound).toBe(3);
    expect(core.clampPreviewRound(NaN, timeline)).toBe(3);
    expect(core.clampPreviewRound(undefined, timeline)).toBe(3);
    expect(core.clampPreviewRound(Infinity, timeline)).toBe(3);
    expect(core.clampPreviewRound(-Infinity, timeline)).toBe(3);
  });

  it('re-clamps the same round against a different (smaller) timeline', () => {
    const core = loadCore();
    // radius 6、start 3 → [3,5,7,9]，maxRound 11。
    const t6 = core.artilleryTimeline(annihilationConfig(core))!;
    // radius 4、start 5 → [5,7]，maxRound 9；同一个 11 必须被压回 9。
    const t4 = core.artilleryTimeline(annihilationConfig(core, { startRound: 5 }, 4))!;
    expect(t6.shrinkRounds).toEqual([3, 5, 7, 9]);
    expect(t6.maxRound).toBe(11);
    expect(t4.shrinkRounds).toEqual([5, 7]);
    expect(t4.maxRound).toBe(9);
    const kept = core.clampPreviewRound(11, t6);
    expect(kept).toBe(11);
    expect(core.clampPreviewRound(kept, t4)).toBe(9);
  });

  it('treats timeline.maxRound as the only upper bound', () => {
    const core = loadCore();
    const timeline = core.artilleryTimeline(annihilationConfig(core))!;
    expect(core.clampPreviewRound(1e9, timeline)).toBe(timeline.maxRound);
    expect(timeline.maxRound).toBe(timeline.lastShrinkRound + timeline.intervalRounds);
  });
});

describe('artillery preview UI wiring', () => {
  it('puts the slider between the board context and the zoom controls, hidden by default', () => {
    const html = read('public/map-editor.html');
    expect(html).toContain('<div id="artillery-preview" class="artillery-preview" hidden>');
    expect(html).toContain('<input id="artillery-round" type="range" min="1" max="1" step="1" value="1" aria-label="炮火缩圈预览轮次" />');
    expect(html).toContain('<span id="artillery-preview-label" class="artillery-preview-label">…</span>');
    // 不新开一行：必须夹在 board-context 与 zoom-controls 之间。
    const context = html.indexOf('class="board-context"');
    const preview = html.indexOf('id="artillery-preview"');
    const zoom = html.indexOf('class="zoom-controls"');
    expect(context).toBeGreaterThan(-1);
    expect(preview).toBeGreaterThan(context);
    expect(zoom).toBeGreaterThan(preview);
    // 不加重置/跳转按钮或解释文案。
    const block = html.slice(preview, zoom);
    expect(block).not.toContain('<button');
    expect(block).not.toContain('拖动');
  });

  it('exposes the pure functions on MapEditorCore and keeps preview state out of config', () => {
    const core = loadCore();
    expect(typeof core.artilleryTimeline).toBe('function');
    expect(typeof core.artilleryPreviewAt).toBe('function');
    expect(typeof core.hexDistance).toBe('function');
    expect(typeof core.clampPreviewRound).toBe('function');

    const source = read('public/map-editor.js');
    expect(source).toContain('hexDistance,');
    expect(source).toContain('artilleryTimeline,');
    expect(source).toContain('clampPreviewRound,');
    expect(source).toContain('artilleryPreviewAt,');
    // syncArtilleryPreview 必须复用这个纯函数，夹取逻辑不许再内联一份。
    expect(source).toMatch(/clampPreviewRound\(previewRound, timeline\)/);
    // 覆盖层正确性依赖「改 config 必走 syncAll」的约定，声明处要有注释提醒。
    expect(source).toContain('任何修改 config 的路径都必须走 syncAll()');
    // 预览轮次只活在 DOM 侧模块变量里，绝不写进 config。
    expect(source).toContain('let previewRound = null;');
    expect(source).not.toContain('config.previewRound');
    expect(source).not.toContain('previewRound:');

    const config = annihilationConfig(core);
    config.previewRound = 7; // 即便有人塞进来，序列化白名单也不输出。
    config.artilleryPreviewView = { danger: [] };
    const serialized = core.serializeMapConfig(config);
    expect(Object.keys(serialized)).not.toContain('previewRound');
    expect(Object.keys(serialized)).not.toContain('artilleryPreviewView');
    expect(JSON.stringify(serialized)).not.toContain('previewRound');
    expect(JSON.stringify(serialized)).not.toContain('artilleryPreview');
  });

  it('syncs the slider in syncAll and redraws on input without re-running the inspector', () => {
    const source = read('public/map-editor.js');
    expect(source).toContain('function syncArtilleryPreview()');
    // 先算预览再画棋盘，否则会画到上一轮的覆盖层。
    expect(source).toMatch(/syncArtilleryPreview\(\);\s*drawBoard\(\);/);
    expect(source).toContain("els.artilleryRound?.addEventListener('input', onArtilleryRoundInput);");
    const handler = source.slice(source.indexOf('function onArtilleryRoundInput()'), source.indexOf('function drawBoard()'));
    expect(handler).toContain('drawBoard();');
    expect(handler).not.toContain('syncAll(');
    // 不引入 rAF 包装：现有绘制都是直接 drawBoard()。
    expect(source).not.toContain('scheduleDraw(');
    // 读数只有两种形态，不额外加解释文案。
    expect(source).toContain('轮 · 已收到底');
    expect(source).toContain('轮 · 半径 ');
    expect(source).toContain(' · 下次收缩 ');
  });

  it('draws the overlay with exactly the same colors as the live board', () => {
    const source = read('public/map-editor.js');
    const playSource = read('public/play.js');
    for (const color of [
      "'rgba(244, 177, 66, .22)'",
      "'rgba(255, 205, 105, .72)'",
      "'rgba(205, 55, 45, .34)'",
      "'rgba(255, 95, 75, .68)'",
    ]) {
      expect(playSource, `play.js 里没有 ${color}`).toContain(color);
      expect(source, `map-editor.js 里没有 ${color}`).toContain(color);
    }
    // 覆盖层插在地形循环之后、hover 之前；pathHex 的 inset 与实战一致。
    const terrainEnd = source.indexOf('ctx.strokeStyle = playable ?');
    const overlay = source.indexOf('artilleryPreviewView.warning');
    const hover = source.indexOf('if (hoverCell)', terrainEnd);
    expect(overlay).toBeGreaterThan(terrainEnd);
    expect(overlay).toBeLessThan(hover);
    const block = source.slice(overlay, hover);
    expect(block).toContain('pathHex(cell.q, cell.r, 2)');
    expect(block).toContain('ctx.lineWidth = 1.5');
    expect(block).toContain('artilleryPreviewView.danger');
  });

  it('styles the inline preview and lets the toolbar wrap on narrow screens', () => {
    const css = read('public/map-editor.css');
    expect(css).toContain('.artillery-preview {');
    expect(css).toContain('flex: 1 1 auto;');
    expect(css).toContain('max-width: 420px;');
    expect(css).toContain('.artillery-preview[hidden] { display: none; }');
    expect(css).toContain('.artillery-preview-label {');
    expect(css).toContain('font-size: 11px;');
    expect(css).toContain('white-space: nowrap;');
    // 回归：读数文案长短随轮次变化（「第 9 轮 · 半径 5 · 下次收缩 11」↔「第 17 轮 · 已收到底」），
    // 标签若宽度自由伸缩会吃掉剩余宽度、让滑块一长一短地跳；这里锁住「标签有固定最小宽度」这个前提。
    // （真实布局抖动由浏览器脚本另行断言，CSS 规则存在 ≠ 布局稳定。）
    const labelRule = css.match(/\.artillery-preview-label \{[^}]*\}/)?.[0] || '';
    const labelMinWidth = Number(labelRule.match(/min-width:\s*(\d+)px/)?.[1] ?? 0);
    expect(labelRule, '标签规则缺少固定最小宽度').toContain('min-width:');
    expect(labelMinWidth).toBeGreaterThanOrEqual(140);
    expect(css).toContain('@media (max-width: 900px)');
    expect(css).toContain('.board-toolbar { flex-wrap: wrap; }');
  });
});
