// tests/api/fog-spectator.test.ts
// 观战令牌：建房只在迷雾局下发、落盘只存哈希；令牌只读；旧档补齐 fog 状态。
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestServer, createGameAndJoin } from '../helpers.js';
import {
  createLobbyWithConfig, gameSnapshotPath, GameStore, getRawSpectatorToken, globalStore,
} from '../../src/state/store.js';
import { getMapConfig } from '../../src/config/loader.js';
import { createFogGame, FOG_TEST_MAP, installFogMap, restoreMaps } from './fog-fixtures.js';

beforeAll(() => installFogMap());
afterAll(() => restoreMaps());

let app: FastifyInstance;

afterEach(async () => {
  for (const id of globalStore.list()) await globalStore.delete(id);
  if (app) await app.close();
});

describe('fog spectator token', () => {
  it('is returned once for fog games and never for non-fog games', async () => {
    app = await startTestServer();
    const fog = await createFogGame(app);
    expect(fog.spectatorToken).toMatch(/^[0-9a-f]{32}$/);
    const game = globalStore.get(fog.gameId)!;
    expect(game.spectatorTokenHash).toMatch(/^v1:[0-9a-f]+$/);
    expect(game.spectatorTokenHash).not.toBe(fog.spectatorToken);

    // 状态响应（任何观者）都不回传哈希或明文。
    for (const headers of [
      { 'x-player-token': fog.seats[0]!.token },
      { 'x-spectator-token': fog.spectatorToken },
      {},
    ]) {
      const res = await app.inject({ method: 'GET', url: `/api/games/${fog.gameId}`, headers });
      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain('spectatorTokenHash');
      expect(res.body).not.toContain(fog.spectatorToken);
    }
  });

  it('non-fog create response keeps an empty spectatorToken and no hash', async () => {
    app = await startTestServer();
    const { gameId } = await createGameAndJoin(app);
    const game = globalStore.get(gameId)!;
    expect(game.spectatorTokenHash).toBeUndefined();
    expect(getRawSpectatorToken(game)).toBeNull();

    const create = await app.inject({
      method: 'POST', url: '/api/games', payload: { mapId: 'standoff', maxPlayers: 2 },
    });
    expect(create.statusCode).toBe(200);
    expect((create.json() as { spectatorToken: string }).spectatorToken).toBe('');
  });

  it('cannot be used to write: spectator credential is not a player credential', async () => {
    app = await startTestServer();
    const fog = await createFogGame(app);
    const write = await app.inject({
      method: 'POST',
      url: `/api/games/${fog.gameId}/end-turn`,
      headers: { 'x-spectator-token': fog.spectatorToken },
      payload: {},
    });
    expect(write.statusCode).toBe(401);
    expect(write.json().code).toBe('invalid_token');

    // 把观战令牌塞进玩家参数也不生效。
    const asPlayer = await app.inject({
      method: 'POST',
      url: `/api/games/${fog.gameId}/end-turn`,
      headers: { 'x-player-token': fog.spectatorToken },
      payload: {},
    });
    expect(asPlayer.statusCode).toBe(401);
  });

  it('persists only the hash in the per-game snapshot', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tactical-fog-store-'));
    const file = join(dir, 'games.json');
    try {
      installFogMap();
      // buildServer 已在别的用例里加载真实地图；这里直接取夹具配置。
      const store = new GameStore({ persistenceFile: file, immediateFlush: true });
      const lobby = createLobbyWithConfig(
        'persist-fog', FOG_TEST_MAP, getMapConfig(FOG_TEST_MAP), { maxPlayers: 2, participate: true },
      );
      const token = getRawSpectatorToken(lobby);
      expect(token).toMatch(/^[0-9a-f]{32}$/);
      await store.save(lobby);

      const snapshot = readFileSync(gameSnapshotPath(file, 'persist-fog'), 'utf8');
      expect(snapshot).toContain('spectatorTokenHash');
      expect(snapshot).not.toContain(token!);
      const parsed = JSON.parse(snapshot) as { game: { fog?: { lastSeen: Record<string, unknown> }; spectatorTokenHash?: string } };
      expect(parsed.game.spectatorTokenHash).toBe(lobby.spectatorTokenHash);
      expect(parsed.game.fog?.lastSeen).toBeTruthy();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('normalizes an old fog snapshot without fog state (idempotent)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tactical-fog-legacy-'));
    const file = join(dir, 'games.json');
    try {
      installFogMap();
      const lobby = createLobbyWithConfig(
        'legacy-fog', FOG_TEST_MAP, getMapConfig(FOG_TEST_MAP), { maxPlayers: 2, participate: true },
      );
      // 模拟上线前置存档：没有 fog、没有观战哈希。
      delete (lobby as { fog?: unknown }).fog;
      delete (lobby as { spectatorTokenHash?: unknown }).spectatorTokenHash;
      const snapshotFile = gameSnapshotPath(file, 'legacy-fog');
      mkdirSync(dirname(snapshotFile), { recursive: true });
      writeFileSync(snapshotFile, JSON.stringify({
        schemaVersion: 2, savedAt: new Date().toISOString(), game: lobby,
      }));

      const store = new GameStore({ persistenceFile: file, immediateFlush: true });
      await store.loadFromDisk();
      const loaded = store.get('legacy-fog')!;
      expect(loaded.fog).toBeTruthy();
      expect(loaded.fog!.lastSeen.player_a).toEqual({});
      expect(loaded.spectatorTokenHash).toBeUndefined();

      // 幂等：再规范化一次不改变内容。
      const before = JSON.stringify(loaded.fog);
      const { normalizeFogState } = await import('../../src/engine/fog.js');
      normalizeFogState(loaded);
      expect(JSON.stringify(loaded.fog)).toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
