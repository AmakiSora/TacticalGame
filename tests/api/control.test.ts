import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../src/server.js';
import { getAutoControlController, resetAutoControlController } from '../../src/control/singleton.js';

const oldToken = process.env.AUTO_CONTROL_TOKEN;
const oldRuntime = process.env.AUTO_CONTROL_RUNTIME_DIR;

function setRuntime(): string {
  const runtimeDir = mkdtempSync(join(tmpdir(), 'auto-control-api-'));
  process.env.AUTO_CONTROL_RUNTIME_DIR = runtimeDir;
  resetAutoControlController();
  return runtimeDir;
}

afterEach(() => {
  process.env.AUTO_CONTROL_TOKEN = oldToken;
  process.env.AUTO_CONTROL_RUNTIME_DIR = oldRuntime;
  resetAutoControlController();
});

describe('Control API access', () => {
  it('rejects requests without token when AUTO_CONTROL_TOKEN is set', async () => {
    const runtimeDir = setRuntime();
    process.env.AUTO_CONTROL_TOKEN = 'secret';
    const app = await buildServer();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/control/status' });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
      rmSync(runtimeDir, { recursive: true, force: true });
    }
  });

  it('allows localhost requests when token is not configured', async () => {
    const runtimeDir = setRuntime();
    delete process.env.AUTO_CONTROL_TOKEN;
    const app = await buildServer();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/control/status' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveProperty('status');
    } finally {
      await app.close();
      rmSync(runtimeDir, { recursive: true, force: true });
    }
  });
});

describe('Control API operations', () => {
  it('saves and returns config', async () => {
    const runtimeDir = setRuntime();
    process.env.AUTO_CONTROL_TOKEN = 'secret';
    const app = await buildServer();
    try {
      const save = await app.inject({
        method: 'PUT',
        url: '/api/control/config',
        headers: { 'x-control-token': 'secret' },
        payload: { gameId: 'game-1', players: { player_a: { model: 'm-a' } } },
      });
      expect(save.statusCode).toBe(200);

      const read = await app.inject({
        method: 'GET',
        url: '/api/control/config',
        headers: { 'x-control-token': 'secret' },
      });
      expect(read.json().gameId).toBe('game-1');
      expect(read.json().players.player_a.model).toBe('m-a');
    } finally {
      await app.close();
      rmSync(runtimeDir, { recursive: true, force: true });
    }
  });

  it('streams log entries as SSE', async () => {
    const runtimeDir = setRuntime();
    process.env.AUTO_CONTROL_TOKEN = 'secret';
    const app = await buildServer();
    try {
      getAutoControlController().log('info', 'hello');
      const res = await app.inject({
        method: 'GET',
        url: '/api/control/logs/stream?close=true&token=secret',
        headers: { accept: 'text/event-stream' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');
      expect(res.body).toContain('hello');
    } finally {
      await app.close();
      rmSync(runtimeDir, { recursive: true, force: true });
    }
  });
});
