import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('demolish spectator replay wiring', () => {
  const source = readFileSync('public/app.js', 'utf-8');

  it('applies demolish events when replaying terrain changes', () => {
    expect(source).toContain("case 'demolish'");
    expect(source).toContain('toTerrain');
    expect(source).toContain('爆破');
  });

  it('applies terrain changes to the replay state being rebuilt', () => {
    expect(source).toContain('function setCellTerrain(targetState, q, r, terrain)');
    expect(source).toContain('targetState.cells.find');
    expect(source).toContain("setCellTerrain(s, p.q, p.r, p.toTerrain || 'plain')");
  });

  it('clones the initial map before replay terrain mutations', () => {
    expect(source).toContain('function cloneMapPayload(map = {})');
    expect(source).toContain('cells: (map.cells || []).map(cell => ({ ...cell }))');
    expect(source).toContain('terrainCells: (map.terrainCells || []).map(cell => ({ ...cell }))');
    expect(source).toContain('s.map = cloneMapPayload(p.map)');
    expect(source).toContain('s.cells = s.map.cells || []');
  });
});
