import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectMatches } from '../../script/generateStats.mjs';

let tempDir: string | null = null;

function setupReplay(): { records: string; cache: string; file: string } {
  tempDir = mkdtempSync(join(tmpdir(), 'tg-stats-cache-'));
  const records = join(tempDir, 'records');
  mkdirSync(join(records, 'V2'), { recursive: true });
  const file = join(records, 'V2', 'tg_0001_20260101.json');
  writeFileSync(file, JSON.stringify({
    events: [
      { type: 'game_start', payload: { mapId: 'default', mode: 'standard', playerNames: { player_a: 'A', player_b: 'B' } } },
      { type: 'game_over', payload: { winner: 'player_a', reason: 'headquarters_destroyed' } },
    ],
  }));
  return { records, cache: join(tempDir, 'stats-cache.json'), file };
}

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe('stats match cache', () => {
  it('reuses unchanged matches and invalidates changed files', () => {
    const { records, cache, file } = setupReplay();
    const first = collectMatches({ records, versions: ['V2'], cacheFile: cache });
    expect(first.matches).toHaveLength(1);
    expect(first.matches[0]!.mapId).toBe('default');
    expect(existsSync(cache)).toBe(true);

    const second = collectMatches({ records, versions: ['V2'], cacheFile: cache });
    expect(second.matches).toEqual(first.matches);

    // 改变文件大小，确保 Windows 上 mtime 精度不足也能触发重建。
    writeFileSync(file, JSON.stringify({
      padding: 'x'.repeat(200),
      events: [
        { type: 'game_start', payload: { mapId: 'snowflake', mode: 'royale', playerNames: { player_a: 'A', player_b: 'B' } } },
        { type: 'game_over', payload: { winner: 'player_a', reason: 'last_player_standing' } },
      ],
    }));
    const third = collectMatches({ records, versions: ['V2'], cacheFile: cache });
    expect(third.matches[0]!.mapId).toBe('snowflake');
  });

  it('supports --full style bypass', () => {
    const { records, cache } = setupReplay();
    const result = collectMatches({ records, versions: ['V2'], cacheFile: cache, full: true });
    expect(result.matches).toHaveLength(1);
  });
});
