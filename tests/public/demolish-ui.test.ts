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
});
