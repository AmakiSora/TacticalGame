import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

type EditorCore = {
  createDefaultMapConfig: () => any;
  configureMapMode: (config: any, mode: string, annihilationDraft?: any) => any;
  defaultFog: () => any;
  normalizeFog: (fog: any) => any;
  isFogMode: (mode?: string) => boolean;
  isSimultaneousMode: (mode?: string) => boolean;
  normalizeImportedMap: (data: any) => any;
  serializeMapConfig: (config: any) => any;
  validateMapConfig: (config: any, id?: string) => string[];
  formatValidationError: (error: string) => string;
};

function loadCore(): EditorCore {
  const source = read('public/map-editor.js').replace(/^import\s+'[^']+';\s*$/gm, '');
  const context: any = { console, window: {}, navigator: { clipboard: null }, Blob: class Blob {}, URL: { createObjectURL: () => '', revokeObjectURL: () => {} } };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.MapEditorCore;
}

const FOG_DEFAULTS = { scout: 4, ranger: 3, infantry: 2, support: 2, heavy: 1 };

describe('map editor fog mode', () => {
  it('creates a fog draft with the simultaneous spawn skeleton and contract defaults', () => {
    const core = loadCore();
    const fog = core.configureMapMode(core.createDefaultMapConfig(), 'fog');

    expect(fog.mode).toBe('fog');
    expect(fog.spawnMode).toBe(true);
    expect(fog.spawnSlots).toHaveLength(2);
    expect(fog.fog).toEqual({ vision: FOG_DEFAULTS, revealFromRound: null });
    expect(fog.annihilation).toBeUndefined();
    expect(core.isFogMode('fog')).toBe(true);
    expect(core.isSimultaneousMode('fog')).toBe(true);

    const serialized = core.serializeMapConfig(fog);
    expect(serialized.mode).toBe('fog');
    expect(serialized.fog).toEqual({ vision: FOG_DEFAULTS, revealFromRound: null });
    expect(serialized.modelEval).toBe(false);
    expect(serialized).not.toHaveProperty('annihilation');
    expect(serialized.balance.komi).toBeUndefined();
    expect(core.validateMapConfig(serialized, 'new-fog')).toEqual([]);
  });

  it('round-trips both built-in fog maps without losing vision or reveal settings', () => {
    const core = loadCore();

    for (const file of ['fog-harbor.json', 'fog-crossing.json']) {
      const source = JSON.parse(read(`maps/${file}`));
      const normalized = core.normalizeImportedMap(source);
      const serialized = core.serializeMapConfig(normalized);

      expect(normalized.mode, file).toBe('fog');
      expect(normalized.spawnMode, file).toBe(true);
      expect(serialized.mode, file).toBe('fog');
      expect(serialized.fog, file).toEqual(source.fog);
      expect(serialized.fog.vision, file).toEqual(source.fog.vision);
      expect(serialized.spawnSlots, file).toHaveLength(source.spawnSlots.length);
      expect(serialized.layouts, file).toEqual(source.layouts);
      expect(serialized.modelEval, file).toBe(false);
      expect(core.validateMapConfig(serialized, file.replace('.json', '')), file).toEqual([]);
    }
  });

  it('fills missing vision types from defaults and preserves broken values for validation', () => {
    const core = loadCore();

    expect(core.normalizeFog({ vision: { scout: 0 } })).toEqual({
      vision: { ...FOG_DEFAULTS, scout: 0 },
      revealFromRound: null,
    });
    // 导入不静默夹取越界值：留给校验器报错，用户能在面板里看到并修正。
    expect(core.normalizeFog({ vision: { heavy: 9 }, revealFromRound: 0 })).toEqual({
      vision: { ...FOG_DEFAULTS, heavy: 9 },
      revealFromRound: 0,
    });
  });

  it('validates vision range, reveal round and maxTurns with readable Chinese errors', () => {
    const core = loadCore();
    const fogHarbor = JSON.parse(read('maps/fog-harbor.json'));
    const broken = core.normalizeImportedMap(fogHarbor);
    broken.fog.vision.scout = 9;
    broken.fog.revealFromRound = 0;
    const serialized = core.serializeMapConfig(broken);

    const errors = core.validateMapConfig(serialized, 'broken-fog');
    expect(errors).toContain('Map "broken-fog".fog.vision.scout must be an integer between 0 and 8');
    expect(errors).toContain('Map "broken-fog".fog.revealFromRound must be null or an integer >= 1');
    expect(core.formatValidationError(errors[0])).toBe('侦察兵的视野半径必须是 0–8 的整数。');
    expect(core.formatValidationError(errors[1])).toBe('揭雾轮次留空表示全程迷雾，否则必须是不小于 1 的整数。');

    broken.fog.vision.scout = 4;
    broken.fog.revealFromRound = fogHarbor.balance.maxTurns + 2;
    const late = core.validateMapConfig(core.serializeMapConfig(broken), 'late-fog');
    expect(late).toContain('Map "late-fog".fog.revealFromRound must be <= balance.maxTurns');
    expect(core.formatValidationError(late[0])).toBe('揭雾轮次不能大于最大回合。');

    // 未知兵种键只能出现在手写 JSON 里；导入会丢弃它，直接校验必须拒绝。
    const unknown = core.serializeMapConfig(core.normalizeImportedMap(fogHarbor));
    unknown.fog.vision.medic = 3;
    const unknownErrors = core.validateMapConfig(unknown, 'unknown-fog');
    expect(unknownErrors).toContain('Map "unknown-fog".fog.vision.medic is not a known unit type');
    expect(core.formatValidationError(unknownErrors[0])).toBe('视野配置包含未知兵种 medic。');
  });

  it('rejects fog config outside fog mode and annihilation/komi inside fog mode', () => {
    const core = loadCore();
    const fogHarbor = JSON.parse(read('maps/fog-harbor.json'));
    const fog = core.serializeMapConfig(core.normalizeImportedMap(fogHarbor));

    const standard = core.serializeMapConfig(core.createDefaultMapConfig());
    standard.fog = fogHarbor.fog;
    expect(core.validateMapConfig(standard, 'std-with-fog'))
      .toContain('Map "std-with-fog".fog is only valid in fog mode');
    expect(core.formatValidationError('Map "std-with-fog".fog is only valid in fog mode'))
      .toBe('只有迷雾模式可以配置视野迷雾。');

    const withAnnihilation = { ...fog, annihilation: core.defaultAnnihilation(fog.radius) };
    expect(core.validateMapConfig(withAnnihilation, 'fog-artillery').join('\n'))
      .toContain('annihilation is only valid in annihilation or royale mode');

    const withKomi = { ...fog, balance: { ...fog.balance, komi: { supplies: 10 } } };
    expect(core.validateMapConfig(withKomi, 'fog-komi').join('\n'))
      .toContain('balance.komi is only valid in sequential modes');
  });

  it('requires fog config and spawn slots in fog mode', () => {
    const core = loadCore();
    const fogHarbor = JSON.parse(read('maps/fog-harbor.json'));
    const fog = core.serializeMapConfig(core.normalizeImportedMap(fogHarbor));

    const missingFog = { ...fog };
    delete missingFog.fog;
    expect(core.validateMapConfig(missingFog, 'no-fog'))
      .toContain('Map "no-fog".fog is required in fog mode');
    expect(core.formatValidationError('Map "no-fog".fog is required in fog mode'))
      .toBe('迷雾模式必须配置视野迷雾。');

    const missingSpawn = { ...fog };
    delete missingSpawn.spawnSlots;
    expect(core.validateMapConfig(missingSpawn, 'no-spawn').join('\n'))
      .toContain('spawnSlots must contain 2-8 slots');
  });

  it('wires a fog mode button, vision panel and status copy into the editor UI', () => {
    const html = read('public/map-editor.html');
    const source = read('public/map-editor.js');
    const css = read('public/map-editor.css');

    expect(html).toContain('data-mode="fog"');
    expect(html).toContain('id="fog-panel"');
    expect(html).toContain('id="fog-vision-fields"');
    expect(html).toContain('id="fog-hint"');
    expect(source).toContain('function renderFogFields()');
    expect(source).toContain('renderFogFields();');
    expect(source).toContain('FOG_VISION_MAX');
    expect(source).toContain('揭雾轮次（空 = 终局）');
    expect(source).toContain("fog: '迷雾'");
    expect(source).toContain('已切换为迷雾模式，请配置出生布局与视野参数');
    expect(css).toContain('.fog-panel-hint');

    // 预览不做视野可视化：编辑器画布不消费 fog 投影。
    expect(source).not.toContain('visibleCells');
    expect(source).not.toContain('lastSeen');
  });
});
