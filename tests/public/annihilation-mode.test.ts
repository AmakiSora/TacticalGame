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
      expect(source).toContain("preview.mode === 'annihilation' || preview.mode === 'royale' ? []");
      expect(source).toContain("const modeLabel = map.preview?.mode === 'simultaneous' ? '同时'");
      expect(source).toContain("map.preview?.mode === 'annihilation' ? '歼灭'");
      expect(source).toContain("? '大逃杀' : '标准';");
      expect(source).toContain('isArtilleryDangerCell');
    }
  });

  it('computes leaderboard scores without headquarters in annihilation mode', () => {
    for (const file of replayClients) {
      const source = read(file);
      expect(source).toContain("if (!ownHq && !isAnnihilationRules()) return null;");
      expect(source).toContain('const ownHqHp = ownHq ? Math.max(0, ownHq.hp || 0) : 0;');
      // 3.6.0 起记分改为击杀价值 + 据点持有流量混合，行动功绩彻底移除。
      expect(source).toContain('const killValue = state.players?.[owner]?.stats?.killValue ?? 0;');
      expect(source).toContain('const flowRatio = Number(weights.controlPointFlowRatio ?? 0.7);');
      expect(source).toContain("label: '击杀价值'");
      expect(source).not.toContain('function recordActionMerit');
      // 旧回放（含 actionScore 快照）仍走兼容分支展示「有效行动」。
      expect(source).toContain("score.actionScore !== undefined && score.killValue === undefined");
      expect(source).toContain("const preserved = state.players?.[owner]?.status === 'eliminated'");
    }
  });
});
