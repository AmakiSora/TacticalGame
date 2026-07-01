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
    expect(source).toContain('cp-strip');
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
});
