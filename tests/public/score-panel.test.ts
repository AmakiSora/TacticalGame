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
    expect(read('public/spectator.html')).toContain('<h1>战棋对战观战 <span class="version-badge">v2.1.1</span></h1>');
    expect(read('public/play.html')).toContain('<h1>六边形战棋 <span class="sub">玩家控制台</span> <span class="version-badge">v2.1.1</span></h1>');
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
