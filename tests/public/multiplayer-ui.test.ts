import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('multiplayer UI wiring', () => {
  it('spectator applyEvent handles elimination and multiplayer game_start fields', () => {
    const source = read('public/app.js');
    expect(source).toContain("case 'player_eliminated'");
    expect(source).toContain("case 'control_point_neutralized'");
    expect(source).toContain('s.players = JSON.parse(JSON.stringify(p.players || {}))');
    expect(source).toContain('s.turn.turnOrder = [...(p.turnOrder || [])]');
    expect(source).toContain('p.firstPlayer');
    expect(source).toContain('removedUnitIds');
    expect(source).toContain('neutralizedPointIds');
    expect(source).toContain('if (hq.owner === p.playerId)');
    expect(source).toContain('hq.alive = false');
  });

  it('spectator score uses tracked headquartersDamage when available', () => {
    const source = read('public/app.js');
    expect(source).toContain("state.players?.[owner]?.stats?.headquartersDamage");
    expect(source).toContain('player.stats.headquartersDamage += actualDamage');
  });

  it('uses server rankings for the final multiplayer leaderboard', () => {
    const source = read('public/app.js');
    expect(source).toContain("state?.result?.rankings");
    expect(source).toContain('resultRanks.get(owner)');
    expect(source).toContain('rankA - rankB');
  });

  it('control page supports playerCount and dynamic multi-seat fields', () => {
    const html = read('public/control.html');
    const source = read('public/control.js');

    expect(html).toContain('id="player-count"');
    expect(html).toContain('id="player-fields"');
    expect(source).toContain('playerCount');
    expect(source).toContain('ensurePlayerFields');
    expect(source).toContain("PLAYER_IDS = ['player_a'");
    expect(source).toContain('playerConfigCache');
    // Must not hard-wipe to only A/B on save.
    expect(source).not.toContain("player_a: readPlayer('player_a')");
    expect(source).not.toContain("player_b: readPlayer('player_b')");
  });
});
