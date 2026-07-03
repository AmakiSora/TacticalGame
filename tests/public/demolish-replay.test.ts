import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('demolish spectator replay wiring', () => {
  const source = readFileSync('public/app.js', 'utf-8');

  it('applies demolish events when replaying terrain changes', () => {
    expect(source).toContain("case 'demolish'");
    expect(source).toContain('toTerrain');
    expect(source).toContain('爆破');
  });
});
