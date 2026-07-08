import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../../src/server.js';
import { globalStore } from '../../src/state/store.js';

const oldStateFile = process.env.TACTICAL_GAME_STATE_FILE;
const oldControlToken = process.env.AUTO_CONTROL_TOKEN;
let tempDir: string | null = null;

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function tempStateFile(): string {
  tempDir = mkdtempSync(join(tmpdir(), 'tg-api-persist-'));
  return join(tempDir, 'games.json');
}

async function createAndJoin(app: Awaited<ReturnType<typeof buildServer>>) {
  const createRes = await app.inject({
    method: 'POST',
    url: '/api/games',
    payload: { name: 'A' },
  });
  const created = createRes.json() as { gameId: string; playerAToken: string };
  const joinRes = await app.inject({
    method: 'POST',
    url: `/api/games/${created.gameId}/join`,
    payload: { name: 'B' },
  });
  return { ...created, playerBToken: (joinRes.json() as { playerBToken: string }).playerBToken };
}

afterEach(() => {
  restoreEnv('TACTICAL_GAME_STATE_FILE', oldStateFile);
  restoreEnv('AUTO_CONTROL_TOKEN', oldControlToken);
  for (const id of globalStore.list()) globalStore.delete(id);
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe('game persistence API', () => {
  it('persists successful game changes and restores them on server build', async () => {
    const file = tempStateFile();
    process.env.TACTICAL_GAME_STATE_FILE = file;
    const app = await buildServer();

    const { gameId, playerAToken } = await createAndJoin(app);
    const end = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/end-turn`,
      headers: { 'x-player-token': playerAToken },
      payload: {},
    });
    expect(end.statusCode).toBe(200);

    const persisted = JSON.parse(readFileSync(file, 'utf8')) as { games: any[] };
    expect(persisted.games.find(g => g.id === gameId).turn.currentOwner).toBe('player_b');
    await app.close();

    const restoredApp = await buildServer();
    try {
      const list = await restoredApp.inject({ method: 'GET', url: '/api/games' });
      expect(list.json().games.some((g: any) => g.id === gameId)).toBe(true);

      const detail = await restoredApp.inject({
        method: 'GET',
        url: `/api/games/${gameId}`,
        headers: { 'x-player-token': playerAToken },
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json().turn.currentOwner).toBe('player_b');
    } finally {
      await restoredApp.close();
    }
  });

  it('requires control authorization to delete games and removes them from persistence', async () => {
    const file = tempStateFile();
    process.env.TACTICAL_GAME_STATE_FILE = file;
    process.env.AUTO_CONTROL_TOKEN = 'secret';
    const app = await buildServer();
    try {
      const { gameId, playerAToken } = await createAndJoin(app);

      const rejected = await app.inject({ method: 'DELETE', url: `/api/games/${gameId}` });
      expect(rejected.statusCode).toBe(401);

      const deleted = await app.inject({
        method: 'DELETE',
        url: `/api/games/${gameId}`,
        headers: { 'x-control-token': 'secret' },
      });
      expect(deleted.statusCode).toBe(200);
      expect(deleted.json()).toEqual({ ok: true });

      const detail = await app.inject({
        method: 'GET',
        url: `/api/games/${gameId}`,
        headers: { 'x-player-token': playerAToken },
      });
      expect(detail.statusCode).toBe(404);

      const events = await app.inject({ method: 'GET', url: `/api/games/${gameId}/events` });
      expect(events.statusCode).toBe(404);

      const persisted = JSON.parse(readFileSync(file, 'utf8')) as { games: any[] };
      expect(persisted.games.some(g => g.id === gameId)).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('starts with an empty store when the persistence file is invalid', async () => {
    const file = tempStateFile();
    process.env.TACTICAL_GAME_STATE_FILE = file;
    writeFileSync(file, '{ bad json');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const app = await buildServer();
    try {
      const list = await app.inject({ method: 'GET', url: '/api/games' });
      expect(list.statusCode).toBe(200);
      expect(list.json().games).toEqual([]);
    } finally {
      error.mockRestore();
      await app.close();
    }
  });
});
