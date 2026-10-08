import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildServer } from '../../src/server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const RECORDS_DIR = join(REPO_ROOT, 'records');

// 取一条真实归档做样本，期望值全部从盘上现读，改文件不会让断言失真。
function firstRecord(version: string): { id: string; fileName: string; path: string } {
  const fileName = readdirSync(join(RECORDS_DIR, version)).filter(f => f.endsWith('.json')).sort()[0];
  return { id: `${version}/${fileName}`, fileName, path: join(RECORDS_DIR, version, fileName) };
}

describe('records routes', () => {
  it('lists archived replays with metadata and serves the raw JSON', async () => {
    const app = await buildServer();
    const sample = firstRecord('V3');
    const raw = readFileSync(sample.path);

    const list = await app.inject({ method: 'GET', url: '/api/records' });
    expect(list.statusCode).toBe(200);
    const body = list.json();
    expect(Array.isArray(body.records)).toBe(true);
    expect(body.total).toBe(body.records.length);

    const entry = body.records.find((r: any) => r.id === sample.id);
    expect(entry, `list missing ${sample.id}`).toBeDefined();
    expect(entry.version).toBe('V3');
    expect(entry.fileName).toBe(sample.fileName);
    expect(entry.sha256).toBe(createHash('sha256').update(raw).digest('hex'));
    expect(entry.bytes).toBe(raw.length);
    expect(entry.mode).toBeTruthy();
    expect(entry.gameId).toBeTruthy();
    // 顺序号取自文件名（tg_0031_… → "0031"）。
    expect(entry.seq).toBe(/^tg_(\d+)_/.exec(sample.fileName)?.[1] ?? null);
    // 胜者解析为玩家显示名：有胜负时 winnerName 必须落在参战玩家列表里。
    if (entry.winner) {
      expect(entry.winner).toMatch(/^player_/);
      expect(entry.players).toContain(entry.winnerName);
    }
    // 列出的条目不含正文，避免把 50KB/条 的事件流塞进列表响应。
    expect(entry.content).toBeUndefined();

    // 最新在前：主序为对局顺序号（跨版本连续），无序号兑底，同序号按日期倒序。
    const seqs = body.records.map((r: any) => (r.seq ? Number(r.seq) : -1));
    expect([...seqs].sort((x: number, y: number) => y - x)).toEqual(seqs);

    const detail = await app.inject({ method: 'GET', url: `/api/records/${sample.id}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.headers['content-type']).toContain('application/json');
    expect(detail.headers['cache-control']).toBe('no-cache');
    expect(detail.headers.etag).toBe(`"${entry.sha256}"`);
    expect(detail.body).toBe(raw.toString('utf8'));

    await app.close();
  });

  it('also lists V2 archives', async () => {
    const app = await buildServer();
    const sample = firstRecord('V2');

    const list = await app.inject({ method: 'GET', url: '/api/records' });
    const entry = list.json().records.find((r: any) => r.id === sample.id);
    expect(entry, `list missing ${sample.id}`).toBeDefined();
    expect(entry.version).toBe('V2');
    expect(entry.seq).toBe(/^tg_(\d+)_/.exec(sample.fileName)?.[1] ?? null);
    // V2 老回放无 finalResult，胜者从末尾的 game_over 事件回取。
    if (entry.winner) expect(entry.players).toContain(entry.winnerName);

    await app.close();
  });

  it('returns 304 when If-None-Match matches the record hash', async () => {
    const app = await buildServer();
    const sample = firstRecord('V3');
    const hash = createHash('sha256').update(readFileSync(sample.path)).digest('hex');

    const res = await app.inject({
      method: 'GET',
      url: `/api/records/${sample.id}`,
      headers: { 'if-none-match': `"${hash}"` },
    });

    expect(res.statusCode).toBe(304);
    await app.close();
  });

  it('rejects unknown records and path traversal attempts', async () => {
    const app = await buildServer();
    for (const id of ['V3/nope.json', 'V3/..%2F..%2Fpackage.json', '..%2F..%2Fpackage.json', 'V3/%2e%2e%2f.env']) {
      const res = await app.inject({ method: 'GET', url: `/api/records/${id}` });
      expect(res.statusCode, `expected 404 for ${id}`).toBe(404);
      expect(res.body).not.toContain('"name": "tactical-game"');
    }
    await app.close();
  });
});
