import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf-8');
}

describe('adjudication score panels', () => {
  it('mounts score panels on spectator and play pages', () => {
    expect(read('public/spectator.html')).toContain('id="score-panel"');
    expect(read('public/play.html')).toContain('id="score-panel"');
  });

  it('shows the application version on spectator and play pages', () => {
    const spectator = read('public/spectator.html');
    const play = read('public/play.html');

    expect(spectator).toContain('<script src="/version.js"></script>');
    expect(play).toContain('<script src="/version.js"></script>');
    expect(spectator).toContain('<span class="version-badge"></span>');
    expect(play).toContain('<span class="version-badge"></span>');
    expect(spectator).not.toMatch(/version-badge">v\d+\.\d+\.\d+/);
    expect(play).not.toMatch(/version-badge">v\d+\.\d+\.\d+/);
  });

  it('computes and renders live scores in both front-end bundles', () => {
    for (const file of ['public/app.js', 'public/play.js']) {
      const source = read(file);
      expect(source).toContain('function computeAdjudicationScores');
      expect(source).toContain('function renderScorePanel');
      expect(source).toContain('scorePanelEl.innerHTML');
    }
  });
});
