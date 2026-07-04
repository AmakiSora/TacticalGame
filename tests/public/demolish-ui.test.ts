import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('demolish player UI wiring', () => {
  const source = readFileSync('public/play.js', 'utf-8');

  it('handles demolish replay events and exposes a heavy-only demolish action', () => {
    expect(source).toContain("case 'demolish'");
    expect(source).toContain("action: 'demolish'");
    expect(source).toContain('/demolish');
    expect(source).toContain("'爆破'");
  });

  it('applies demolish replay terrain changes to the active state argument', () => {
    expect(source).toContain('function setCellTerrain(targetState, q, r, terrain)');
    expect(source).toContain('targetState.cells.find');
    expect(source).toContain("setCellTerrain(s, p.q, p.r, p.toTerrain || 'plain')");
  });
});
