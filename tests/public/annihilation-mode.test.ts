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

  it('computes leaderboard scores without headquarters in annihilation mode', () => {
    for (const file of replayClients) {
      const source = read(file);
      expect(source).toContain("if (!ownHq && gameConfig?.mode !== 'annihilation') return null;");
      expect(source).toContain('const ownHqHp = ownHq ? Math.max(0, ownHq.hp || 0) : 0;');
      expect(source).toContain("gameConfig?.balance?.adjudicationWeights?.effectiveActions");
      expect(source).toContain("gameConfig?.mode === 'annihilation' ? 10 : 2");
      expect(source).toContain("stats?.actionMerit ?? 0");
      expect(source).toContain('function recordActionMerit');
      expect(source).toContain("const preserved = state.players?.[owner]?.status === 'eliminated'");
      expect(source).toContain('行动分 ${score.actionScore ?? 0}');
    }
  });
});
