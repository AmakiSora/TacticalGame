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
      // 过量击杀：同一轮内打在尸体上的第二发 targetHp 仍是 0，只有把活单位打到 0 血才算凶手。
      expect(source).toContain('previousHp > 0 && p.targetHp === 0');
      // 旧回放（含 actionScore 快照）仍走兼容分支展示「有效行动」。
      expect(source).toContain("score.actionScore !== undefined && score.killValue === undefined");
      expect(source).toContain("const preserved = state.players?.[owner]?.status === 'eliminated'");
    }
  });

  // 回放口径由文件自带的 schemaVersion 决定：[3.2.4, 3.6.0) 记行动功绩，3.6.0 起改击杀 + 流量。
  it('renders pre-3.6.0 replays with the scoring era they were recorded in', () => {
    for (const file of ['public/app.js', 'public/spectator-m.js']) {
      const source = read(file);
      expect(source).toContain("const MERIT_ADJUDICATION_SCHEMA_VERSION = '3.2.4';");
      expect(source).toContain("const LEGACY_ADJUDICATION_SCHEMA_VERSION = '3.6.0';");
      expect(source).toContain('function scoringEraFromVersion(version)');
      // 最早期导出没写版本戳，退回按存档结算分的形态判口径。
      expect(source).toContain('function scoringEraFromScores(events)');
      expect(source).toContain("scoringEra: replay.hasSchemaVersion");
      // 功绩镜像只在功绩时代累计，且攻击桶宽照当时服务器（同时回合 3.3.4 起 10HP）。
      expect(source).toContain("if (replayScoringEra() !== 'merit') return;");
      expect(source).toContain("const SIMULTANEOUS_MERIT_SCHEMA_VERSION = '3.3.4';");
      // 旧口径回放不吃击杀分项，也不累计据点流量。
      expect(source).toContain('if (!usesLegacyAdjudication() && target && previousHp > 0');
      expect(source).toContain('if (p.gameOver !== true && !usesLegacyAdjudication()) {');
      // 重导出旧回放必须沿用旧版本戳，否则会被误判成新规则对局。
      expect(source).toContain('function replayExportStamp()');
    }
    // 玩家页只服务实时对局，不存在旧口径回放，因此不应带任何功绩镜像。
    for (const file of ['public/play.js', 'public/play-m.js']) {
      const source = read(file);
      expect(source).not.toContain('recordActionMerit');
      expect(source).not.toContain('replayScoringEra');
    }
  });
});
