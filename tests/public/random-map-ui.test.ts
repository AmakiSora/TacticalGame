import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function loadUI() {
  const context: Record<string, unknown> = { console, window: {} };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(read('public/random-map-ui.js'), context);
  return (context.window as { RandomMapUI: any }).RandomMapUI;
}

describe('random map creation UI', () => {
  it('exposes a shared RandomMapUI module with all configurable parameters', () => {
    const ui = loadUI();
    expect(ui.RANDOM_MAP_ID).toBe('random');
    const keys = ui.PARAMS.map((param: { key: string }) => param.key);
    for (const key of [
      'radius', 'terrainDensity', 'controlPointCount', 'maxTurns', 'actionsPerTurn',
      'unitStatVariation', 'startingSupplies', 'baseIncome', 'controlPointIncome',
      'headquartersHp', 'headquartersDefense',
    ]) {
      expect(keys).toContain(key);
    }
    expect(typeof ui.collectRandomOptions).toBe('function');
    expect(typeof ui.renderRandomMapCard).toBe('function');
    expect(typeof ui.setPreviewRenderer).toBe('function');
    expect(typeof ui.refreshPreview).toBe('function');
    expect(typeof ui.schedulePreview).toBe('function');
    const card = ui.renderRandomMapCard(true);
    expect(card).toContain('data-map-id="random"');
    expect(card).toContain('selected-map');
    expect(card).toContain('随机地图');
  });

  it('builds a preview panel that fetches server-side generated previews', () => {
    const source = read('public/random-map-ui.js');
    expect(source).toContain('id="rmo-preview-canvas"');
    expect(source).toContain('id="rmo-preview-refresh"');
    expect(source).toContain("'/api/maps/random/preview'");
    // 未填种子时回填服务端代抽的种子，保证预览即所得。
    expect(source).toContain('seedInput.value = data.seed');
  });

  it('wires the random map panel into the desktop play page', () => {
    const html = read('public/play.html');
    const source = read('public/play.js');

    expect(html).toContain('id="random-map-options"');
    expect(html).toContain('<option value="random">随机地图</option>');
    expect(html).toContain('<script src="/random-map-ui.js?v=3.4.9"></script>');
    expect(source).toContain('window.RandomMapUI?.renderRandomMapCard');
    expect(source).toContain('window.RandomMapUI.collectRandomOptions()');
    expect(source).toContain("els.mapSelect.value === 'random'");
    expect(source).toContain("selected === 'random'");
    expect(source).toContain('window.RandomMapUI?.setPreviewRenderer(renderMapPreview)');
  });

  it('wires the random map panel into the mobile play page', () => {
    const html = read('public/play-m.html');
    const source = read('public/play-m.js');

    expect(html).toContain('id="random-map-options"');
    expect(html).toContain('<option value="random">随机地图</option>');
    expect(html).toContain('<script src="/random-map-ui.js?v=3.4.9"></script>');
    expect(source).toContain('window.RandomMapUI?.renderRandomMapCard');
    expect(source).toContain('window.RandomMapUI.collectRandomOptions()');
    expect(source).toContain("els.mapSelect.value === 'random'");
    expect(source).toContain("selected === 'random'");
    expect(source).toContain('window.RandomMapUI?.setPreviewRenderer(renderMapPreview)');
  });
});
