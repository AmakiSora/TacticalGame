import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(process.cwd(), 'public', 'play.js'), 'utf8');

describe('player SSE subscription', () => {
  it('does not expose the player token in EventSource URLs', () => {
    const subscriptionSource = source.slice(source.indexOf('function subscribeSse'), source.indexOf('function lobbySummaryMarkup'));
    expect(subscriptionSource).not.toContain('tokenQuery');
    expect(subscriptionSource).not.toContain('encodeURIComponent(myToken)');
    expect(subscriptionSource).toContain('new EventSource(`/api/games/${gameId}/events?after=${lastSeq}`)');
  });
});
