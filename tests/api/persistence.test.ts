import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../../src/server.js';
import { globalStore, gameSnapshotPath } from '../../src/state/store.js';

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
    payload: { playerName: 'A' },
  });
  const created = createRes.json() as {
    gameId: string;
    hostToken: string;
    player: { id: 'player_a'; token: string };
  };
  const joinRes = await app.inject({
    method: 'POST',
    url: `/api/games/${created.gameId}/join`,
    payload: { name: 'B' },
  });
  const joined = joinRes.json() as { player: { id: 'player_b'; token: string } };
  await app.inject({
    method: 'POST',
    url: `/api/games/${created.gameId}/start`,
    headers: { 'x-host-token': created.hostToken },
  });
  const game = globalStore.get(created.gameId);
  if (game) {
    game.turn.currentPlayerId = 'player_a';
    game.turn.currentOwner = 'player_a';
    game.turn.actionsUsed = 0;
  }
  return {
    gameId: created.gameId,
    hostToken: created.hostToken,
    playerAToken: created.player.token,
    playerBToken: joined.player.token,
  };
}

afterEach(async () => {
  restoreEnv('TACTICAL_GAME_STATE_FILE', oldStateFile);
  restoreEnv('AUTO_CONTROL_TOKEN', oldControlToken);
  for (const id of globalStore.list()) await globalStore.delete(id);
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

    const persisted = JSON.parse(readFileSync(gameSnapshotPath(file, gameId), 'utf8')) as { game: any };
    expect(persisted.game.turn.currentOwner).toBe('player_b');
    await app.close();

    const restoredApp = await buildServer();
    try {
      const list = await restoredApp.inject({ method: 'GET', url: '/api/games' });
      expect(list.json().games.some((g: any) => g.gameId === gameId)).toBe(true);

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

  it('holds readiness and successful responses until fsync completes, then drains before closing', async () => {
    const file = tempStateFile();
    process.env.TACTICAL_GAME_STATE_FILE = file;
    const handle = await fs.open(join(tempDir!, 'startup-fsync'), 'w');
    const prototype = Object.getPrototypeOf(handle) as fs.FileHandle;
    const original = prototype.sync;
    // armed 之后的第一次 fsync 会阻塞在 gate 上，并通过 reached 通知测试。
    let armed = false;
    const gate = Promise.withResolvers<void>();
    const reached = Promise.withResolvers<void>();
    const sync = vi.spyOn(prototype, 'sync').mockImplementation(async function (this: fs.FileHandle) {
      if (armed) { reached.resolve(); await gate.promise; }
      await original.call(this);
    });
    await handle.close();
    const app = await buildServer();
    let closed = false;
    try {
      const { gameId, playerAToken } = await createAndJoin(app);
      // createAndJoin 的写入已全部落盘，此时无待写，readyz 就绪。
      expect((await app.inject({ method: 'GET', url: '/readyz' })).json()).toEqual({ status: 'ready' });

      const snapshot = gameSnapshotPath(file, gameId);
      // 开局先手是随机抽的，这里只比较写入前后的字节，不假设具体座位。
      const beforeWrite = existsSync(snapshot) ? readFileSync(snapshot, 'utf8') : null;

      armed = true;
      const end = app.inject({
        method: 'POST', url: `/api/games/${gameId}/end-turn`,
        headers: { 'x-player-token': playerAToken }, payload: {},
      });
      // 等到 end-turn 的快照写入确实卡在 fsync 上。
      await reached.promise;
      // 内存已推进，但磁盘快照尚未反映，readyz 因待写而降级。
      expect(globalStore.get(gameId)!.turn.currentPlayerId).toBe('player_b');
      expect(existsSync(snapshot) ? readFileSync(snapshot, 'utf8') : null).toBe(beforeWrite);
      expect((await app.inject({ method: 'GET', url: '/readyz' })).statusCode).toBe(503);

      // fsync 放行后，响应才返回，快照落盘，readyz 恢复就绪。
      gate.resolve();
      expect((await end).statusCode).toBe(200);
      expect((JSON.parse(readFileSync(snapshot, 'utf8')) as { game: any }).game.turn.currentPlayerId).toBe('player_b');
      expect((await app.inject({ method: 'GET', url: '/readyz' })).json()).toEqual({ status: 'ready' });

      // 关闭前修改内存，close 必须 drain 并做最终全量导出，落盘为最新状态。
      globalStore.get(gameId)!.turn.turnNumber = 99;
      await app.close();
      closed = true;
      const exported = JSON.parse(readFileSync(file, 'utf8')) as { games: any[] };
      expect(exported.games.some(game => game.id === gameId)).toBe(true);
      expect(exported.games.find(game => game.id === gameId).turn.turnNumber).toBe(99);
    } finally {
      gate.resolve();
      sync.mockRestore();
      if (!closed) await app.close();
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
