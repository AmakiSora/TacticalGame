import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('annihilation mode UI', () => {
  const replayClients = [
    'public/play.js',
    'public/play-m.js',
    'public/app.js',
    'public/spectator-m.js',
    'public/spectator2.html',
  ];

  it('replays artillery warnings, shrinking, and damage on every board', () => {
    for (const file of replayClients) {
      const source = read(file);
      expect(source).toContain("case 'artillery_warning'");
      expect(source).toContain("case 'artillery_shrunk'");
      expect(source).toContain("case 'artillery_damage'");
      expect(source).toContain('state.artillery?.warningCells');
      expect(source).toContain('state.artillery?.dangerCells');
      expect(source).toContain("p.reason === 'mutual_annihilation'");
    }
  });

  it('hides headquarters markers and labels annihilation in map previews', () => {
    for (const file of ['public/play.js', 'public/play-m.js']) {
      const source = read(file);
      expect(source).toContain("preview.mode === 'annihilation' ? []");
      expect(source).toContain("map.preview?.mode === 'annihilation' ? '歼灭' : '标准'");
      expect(source).toContain('isArtilleryDangerCell');
    }
  });
});
