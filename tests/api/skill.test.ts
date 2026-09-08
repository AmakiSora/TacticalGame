import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildServer } from '../../src/server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const SKILL_DIR = join(REPO_ROOT, 'skill');

function sha256Of(name: string): string {
  return createHash('sha256').update(readFileSync(join(SKILL_DIR, name))).digest('hex');
}

describe('skill routes', () => {
  it('serves SKILL.md at /api/skill with caching headers', async () => {
    const app = await buildServer();
    const res = await app.inject({ method: 'GET', url: '/api/skill' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/markdown');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.headers.etag).toBe(`"${sha256Of('SKILL.md')}"`);
    expect(res.body).toContain('name: play-hex-api-game');
    expect(res.body).toBe(readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8'));
    await app.close();
  });

  it('returns 304 when If-None-Match matches the file hash', async () => {
    const app = await buildServer();
    const res = await app.inject({
      method: 'GET',
      url: '/api/skill',
      headers: { 'if-none-match': `"${sha256Of('SKILL.md')}"` },
    });

    expect(res.statusCode).toBe(304);
    await app.close();
  });

  it('serves a manifest whose hashes match the files on disk', async () => {
    const app = await buildServer();
    const res = await app.inject({ method: 'GET', url: '/api/skill/manifest' });

    expect(res.statusCode).toBe(200);
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
    const body = res.json();
    expect(body.appVersion).toBe(pkg.version);

    const byName = new Map(body.files.map((f: any) => [f.name, f]));
    for (const name of ['SKILL.md', 'standard.md', 'annihilation.md', 'simultaneous.md', 'wait-turn.mjs', 'ai-player.mjs', 'example-game.sh']) {
      const entry = byName.get(name) as any;
      expect(entry, `manifest missing ${name}`).toBeDefined();
      expect(entry.sha256).toBe(sha256Of(name));
      expect(entry.bytes).toBe(readFileSync(join(SKILL_DIR, name)).length);
    }
    await app.close();
  });

  it('serves individual files under /api/skill/files/', async () => {
    const app = await buildServer();
    const res = await app.inject({ method: 'GET', url: '/api/skill/files/wait-turn.mjs' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/javascript');
    expect(res.body).toBe(readFileSync(join(SKILL_DIR, 'wait-turn.mjs'), 'utf8'));
    await app.close();
  });

  it('rejects unknown files and path traversal attempts', async () => {
    const app = await buildServer();
    for (const name of ['nope.md', '..%2Fpackage.json', '..%2F..%2Fpackage.json', '%2e%2e%2f.env']) {
      const res = await app.inject({ method: 'GET', url: `/api/skill/files/${name}` });
      expect([400, 404], `expected 400/404 for ${name}`).toContain(res.statusCode);
      expect(res.body).not.toContain('"name": "tactical-game"');
    }
    await app.close();
  });
});
