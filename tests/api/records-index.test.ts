import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../src/server.js';

let tempDir: string | null = null;
const previousIndex = process.env.TACTICAL_GAME_RECORDS_INDEX_FILE;

afterEach(() => {
  if (previousIndex === undefined) delete process.env.TACTICAL_GAME_RECORDS_INDEX_FILE;
  else process.env.TACTICAL_GAME_RECORDS_INDEX_FILE = previousIndex;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe('records index', () => {
  it('writes an index on first start and serves from it on the next start', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'tg-records-index-'));
    const indexFile = join(tempDir, 'records-index.json');
    process.env.TACTICAL_GAME_RECORDS_INDEX_FILE = indexFile;

    const first = await buildServer();
    const firstList = await first.inject({ method: 'GET', url: '/api/records' });
    expect(firstList.statusCode).toBe(200);
    expect(firstList.json().total).toBeGreaterThan(0);
    await first.close();

    expect(existsSync(indexFile)).toBe(true);
    const index = JSON.parse(readFileSync(indexFile, 'utf8')) as { version: number; records: unknown[] };
    expect(index.version).toBe(1);
    expect(index.records.length).toBe(firstList.json().total);

    const second = await buildServer();
    try {
      const secondList = await second.inject({ method: 'GET', url: '/api/records' });
      expect(secondList.statusCode).toBe(200);
      expect(secondList.json().total).toBe(firstList.json().total);
      // 缓存条目不应把内部 mtime/size 暴露给前端。
      expect(secondList.json().records[0].mtimeMs).toBeUndefined();
      expect(secondList.json().records[0].size).toBeUndefined();
    } finally {
      await second.close();
    }
  });
});
