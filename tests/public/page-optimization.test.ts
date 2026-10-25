import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf-8');
}

describe('spectator and player page optimization', () => {
  it('adds structured page shells for spectator and player views', () => {
    const spectator = read('public/spectator.html');
    const play = read('public/play.html');

    expect(spectator).toContain('class="spectator-shell"');
    expect(spectator).toContain('class="game-actions"');
    expect(spectator).toContain('class="ga-actions"');
    expect(play).toContain('class="player-shell"');
    expect(play).toContain('class="board-panel"');
  });

  it('anchors the spectator cell hover label to the canvas instead of the replay bar', () => {
    const html = read('public/spectator.html');
    const css = read('public/style.css');

    // #board-wrap 同时包裹画布和回放条；cell-info 若直接挂在它下面（bottom:8px），
    // 会落在时间轴上。画布单独放进定位层后，悬停信息才贴在棋盘右下角。
    expect(html).toContain('<div id="board-canvas">');
    expect(html).toMatch(/<div id="board-canvas">[\s\S]*?<canvas id="board"[\s\S]*?id="cell-info"[\s\S]*?<\/div>\s*<div id="replay-controls">/);
    expect(css).toMatch(/#board-canvas\s*\{[^}]*position:\s*relative/);
  });

  it('collapses the spectator picker into one card with merged game / replay tabs', () => {
    const html = read('public/spectator.html');
    const source = read('public/app.js');

    expect(html).toContain('id="picker-panel"');
    expect(html).toContain('id="tab-games"');
    expect(html).toContain('id="tab-records"');
    expect(source).toContain('function setPickerTab');
    expect(source).toContain('function syncPickerCurrent');
    // 回放页签下删除按钮灰掉，避免误删当前载入的在线对局。
    expect(source).toContain('deleteGameBtn.disabled = isRecordTab()');
  });

  it('renders spectator status sections with optimized card classes', () => {
    const source = read('public/app.js');

    expect(source).toContain('resource-grid');
    expect(source).toContain('turn-card');
    expect(source).not.toContain('cp-strip');
  });

  it('shows turn progress as current/max with player name on the right', () => {
    for (const file of ['public/app.js', 'public/play.js']) {
      const source = read(file);
      expect(source).toContain('function turnProgressLabel');
      expect(source).toContain('turn-count');
      expect(source).toContain('turn-player');
      expect(source).not.toContain('第 ${state.turn.turnNumber} 回合');
    }
    expect(read('public/play.js')).not.toContain('回合 ${state.turn.roundNumber || state.turn.turnNumber}');
  });

  it('renders player turn resources as stable status cards', () => {
    const source = read('public/play.js');

    expect(source).toContain('status-grid');
    expect(source).toContain('status-card active-turn');
    expect(source).toContain('resource-pill');
  });

  it('renders attack range as board cells and distinguishes enemy targets from radius', () => {
    const source = read('public/play.js');

    expect(source).toContain('function attackRangeCells(unit)');
    expect(source).toContain("type: isEnemy ? 'attack' : 'attack-radius'");
    expect(source).toContain("hit?.type === 'attack'");
    expect(source).toContain('target.owner !== myPlayer');
    expect(source).toContain("'attack-radius' ? 'rgba(255,80,80,.08)'");
    expect(source).not.toContain('[...state.units.values(), ...state.headquarters.values()].filter(e => e.owner !== myPlayer && e.alive && hexDistance(unit, e) <= unit.attackRange)');
  });

  it('uses map cards instead of a visible select when creating a game', () => {
    const html = read('public/play.html');
    const css = read('public/play.css');
    const source = read('public/play.js');

    expect(html).toContain('id="map-picker"');
    expect(html).toContain('class="map-picker"');
    expect(html).toContain('id="map-select" hidden');
    expect(css).toContain('.map-card');
    expect(css).toContain('.map-preview');
    expect(source).toContain('function renderMapPicker');
    expect(source).toContain('function renderMapPreview');
    expect(source).toContain('data-map-id');
    expect(source).toContain('selected-map');
    expect(source).toContain('preview.controlPoints');
    expect(source).toContain('preview.headquarters');
    expect(source).toContain('preview?.maxTurns');
    expect(source).toContain('回合');
  });

  it('marks spawn points on annihilation / royale map previews', () => {
    // 回归：预览渲染曾按模式把出生位列表清空（`... ? [] : ...`），理由是「歼灭系没有总部」，
    // 结果歼灭 / 大逃杀（含静态 artillery-zone / narrow-road / snowflake）看不到任何出生点。
    for (const path of ['public/play.js', 'public/play-m.js']) {
      const source = read(path);
      expect(source, `${path} 不应按模式清空出生位`)
        .not.toContain("preview.mode === 'annihilation' || preview.mode === 'royale' ? []");
      expect(source, `${path} 缺歼灭系出生点标记`).toContain('preview-marker spawn spawn-slot-');
      expect(source, `${path} 出生点未标出起始据点`).toContain('起始据点');
      // 总部方块仍保留给标准 / 同时回合。
      expect(source, `${path} 缺总部方块标记`).toContain('preview-marker hq hq-slot-');
      expect(source, `${path} 缺旧版出生位兜底`).toContain('preview.headquarters');
    }
    for (const path of ['public/play.css', 'public/play-m.css']) {
      const css = read(path);
      for (let slot = 1; slot <= 8; slot++) {
        expect(css, `${path} 缺 spawn-slot-${slot} 配色`).toContain(`.preview-marker.spawn-slot-${slot}`);
        expect(css, `${path} 缺 hq-slot-${slot} 配色`).toContain(`.preview-marker.hq-slot-${slot}`);
      }
    }
  });

  it('renders initial units on map previews', () => {
    // 回归：预览数据一直带着 spawnSlots[].startingUnits（type/q/r），但渲染器从未画出来，
    // 看地图预览时不知道初始单位落在哪里。小圆点标在单位实际落格（总部邻格）上，按兵种配色。
    for (const path of ['public/play.js', 'public/play-m.js']) {
      const source = read(path);
      // spawnSlots 组装要携带 startingUnits（`...slot.headquarters` 会覆盖同名键，单位数据必须先展开进去）。
      expect(source, `${path} 未携带初始单位数据`).toContain('startingUnits: slot.startingUnits');
      expect(source, `${path} 缺初始单位标记`).toContain('preview-marker unit unit-');
      expect(source, `${path} 初始单位未标兵种`).toContain('初始单位');
      // 兵种列表完全跟着 spawnSlots[].startingUnits 走，不做兵种过滤
      // （雾杉疏林等图支援兵也是初始单位），渲染按 unit.type 动态配色。
      expect(source, `${path} 初始单位未按兵种动态渲染`).toContain('preview-marker unit unit-${unit.type}');
    }
    for (const path of ['public/play.css', 'public/play-m.css']) {
      const css = read(path);
      for (const unitType of ['infantry', 'scout', 'heavy', 'ranger', 'support']) {
        expect(css, `${path} 缺 unit-${unitType} 配色`).toContain(`.preview-marker.unit-${unitType}`);
      }
    }
  });

  it('stacks create name above full-width map selection', () => {
    const html = read('public/play.html');
    const css = read('public/play.css');

    expect(html).toContain('class="create-setup"');
    expect(html).toContain('class="field name-field"');
    expect(css).toContain('.create-setup');
    expect(css).toContain('flex-direction: column');
    expect(css).toContain('.name-field');
    expect(css).toContain('width: 100%');
  });

  it('renders visual entity markers instead of abbreviation-only board labels', () => {
    const spectator = read('public/app.js');
    const player = read('public/play.js');
    const spectatorCss = read('public/style.css');
    const playerCss = read('public/play.css');

    for (const source of [spectator, player]) {
      expect(source).toContain('function drawUnitGlyph');
      expect(source).toContain('function drawControlPointGlyph');
      expect(source).toContain('function drawUnitMarker');
      expect(source).toContain('function drawHeadquartersMarker');
      expect(source).toContain('function drawControlPointMarker');
      expect(source).toContain('function entityTokenMarkup');
      expect(source).toContain('function entityShortName');
      expect(source).toContain('function entityTokenClass');
    }

    for (const css of [spectatorCss, playerCss]) {
      expect(css).toContain('.visual-token');
      expect(css).toContain('.token-icon');
      expect(css).toContain('.token-label');
      expect(css).toContain('.token-icon.infantry');
      expect(css).toContain('.token-icon.scout');
      expect(css).toContain('.token-icon.heavy');
      expect(css).toContain('.token-icon.ranger');
      expect(css).toContain('.token-icon.support');
      expect(css).toContain('.token-icon.headquarters');
      expect(css).toContain('.token-icon.supply');
      expect(css).toContain('.token-icon.forward_base');
      expect(css).toContain('.token-icon.repair');
    }
  });
});
