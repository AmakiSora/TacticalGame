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
    expect(spectator).toContain('class="toolbar-group primary-tools"');
    expect(spectator).toContain('class="toolbar-group file-tools"');
    expect(play).toContain('class="player-shell"');
    expect(play).toContain('class="board-panel"');
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
