// tests/api/lobby-capacity.test.ts
// #4：活跃大厅上限（TACTICAL_GAME_MAX_LOBBIES）+ 每局快照在响应返回时已落盘。
import { existsSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestServer } from '../helpers.js';
import { globalStore, gameSnapshotPath } from '../../src/state/store.js';

const servers: FastifyInstance[] = [];
const tempDirs: string[] = [];
const originalEnv = {
  TACTICAL_GAME_MAX_LOBBIES: process.env.TACTICAL_GAME_MAX_LOBBIES,
  TACTICAL_GAME_STATE_FILE: process.env.TACTICAL_GAME_STATE_FILE,
};

afterEach(async () => {
  while (servers.length > 0) await servers.pop()!.close().catch(() => {});
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function server(): Promise<FastifyInstance> {
  const app = await startTestServer();
  servers.push(app);
  return app;
}

function create(app: FastifyInstance) {
  return app.inject({
    method: 'POST', url: '/api/games',
    payload: { playerName: 'A', maxPlayers: 2 },
  });
}

describe('lobby capacity guard', () => {
  it('rejects the creation that would exceed TACTICAL_GAME_MAX_LOBBIES with 503', async () => {
    const app = await server();
    // 以当前存量大厅为基线，只给「+1」的余量。
    process.env.TACTICAL_GAME_MAX_LOBBIES = String(globalStore.lobbyCount() + 1);
    const first = await create(app);
    expect(first.statusCode).toBe(200);
    const second = await create(app);
    expect(second.statusCode).toBe(503);
    expect(second.json()).toMatchObject({ code: 'lobby_capacity' });
  });

  it('still allows creation while below the limit', async () => {
    const app = await server();
    process.env.TACTICAL_GAME_MAX_LOBBIES = String(globalStore.lobbyCount() + 5);
    const res = await create(app);
    expect(res.statusCode).toBe(200);
  });
});

describe('per-game snapshot is on disk when the response returns', () => {
  it('writes runtime/store/<gameId>.json synchronously during POST /api/games', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tg-snapshot-'));
    tempDirs.push(dir);
    const stateFile = join(dir, 'games.json');
    process.env.TACTICAL_GAME_STATE_FILE = stateFile;
    const app = await server();

    const res = await create(app);
    expect(res.statusCode).toBe(200);
    const { gameId } = res.json() as { gameId: string };
    // 响应返回时这一局的快照已经存在（重启不会丢刚建的大厅）。
    expect(existsSync(gameSnapshotPath(stateFile, gameId))).toBe(true);
  });
});
