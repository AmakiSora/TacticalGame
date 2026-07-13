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

  it('renders adjudication scores as a leaderboard without a separate lead summary', () => {
    for (const file of ['public/app.js', 'public/play.js']) {
      const source = read(file);
      expect(source).toContain('<h3>分数排行榜</h3>');
      expect(source).toContain('score-rank');
      expect(source).not.toContain('score-leader');
      expect(source).not.toContain('领先');
    }
  });

  it('supports typed control point display and repair replay events', () => {
    for (const file of ['public/app.js', 'public/play.js']) {
      const source = read(file);
      expect(source).toContain('control_point_repair');
      expect(source).toContain('controlPointLabel');
      expect(source).toContain('controlPointStats');
    }
  });

  it('uses configured max turns in front-end adjudication labels', () => {
    for (const file of ['public/app.js', 'public/play.js']) {
      const source = read(file);
      expect(source).toContain('function maxTurnsLabel');
      expect(source).toContain('gameConfig?.balance?.maxTurns');
      expect(source).not.toContain('15回合裁决');
    }
  });

  it('renders spectator scores and resources for every joined player', () => {
    const source = read('public/app.js');

    expect(source).toContain('const PLAYER_IDS = [');
    expect(source).toContain('function joinedPlayerIds()');
    expect(source).toContain('function ownerClass(owner)');
    expect(source).toContain('function ownerColor(owner)');
    expect(source).toContain('Object.fromEntries(players.map(owner => [owner, playerScore(owner)]))');
    expect(source).toContain('Object.entries(state.resources || {})');
    expect(source).toContain("state.players?.[owner]?.stats?.headquartersDamage");
    expect(source).not.toContain("const enemy = owner === 'player_a' ? 'player_b' : 'player_a';");
    expect(source).not.toContain('state.resources.player_a.supplies');
    expect(source).not.toContain('state.resources.player_b.supplies');
  });

  it('sends spectator rename requests to the host rename endpoint with the control token', () => {
    const source = read('public/app.js');
    const renameBody = source.slice(source.indexOf('async function renamePlayer'), source.indexOf('function downloadFile'));

    expect(renameBody).toContain("localStorage.getItem('autoControlToken')");
    expect(renameBody).toContain("headers['x-control-token'] = controlToken");
    expect(renameBody).toContain('/rename');
    expect(renameBody).toContain('playerId, name');
  });
});
