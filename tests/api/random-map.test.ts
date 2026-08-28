import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestServer } from '../helpers.js';
import { globalStore } from '../../src/state/store.js';

describe('random map game creation API', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    for (const id of globalStore.list()) globalStore.delete(id);
    if (app) await app.close();
  });

  it('creates a lobby on a server-generated random map', async () => {
    app = await startTestServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mapId: 'random', maxPlayers: 2, playerName: 'A', random: { seed: 'api-test' } },
    });
    expect(res.statusCode).toBe(200);
    const created = res.json() as { gameId: string; lobby: { mapId: string; mode: string; supportedPlayerCounts: number[] } };
    expect(created.lobby.mapId).toBe('random');
    expect(created.lobby.mode).toBe('standard');
    expect(created.lobby.supportedPlayerCounts).toEqual([2]);

    // 随机地图不进入静态地图列表。
    const mapsRes = await app.inject({ method: 'GET', url: '/api/maps' });
    const mapIds = mapsRes.json().maps.map((map: { id: string }) => map.id);
    expect(mapIds).not.toContain('random');
  });

  it('produces identical maps for identical seeds and starts playable games', async () => {
    app = await startTestServer();
    const create = async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/games',
        payload: { mapId: 'random', maxPlayers: 2, random: { seed: 'replay-me', maxTurns: 18 } },
      });
      expect(res.statusCode).toBe(200);
      return res.json() as { gameId: string; hostToken: string; player: { token: string } };
    };
    const first = await create();
    const second = await create();
    const configOf = (id: string) => JSON.stringify(globalStore.get(id)!.config.terrainCells)
      + JSON.stringify(globalStore.get(id)!.config.spawnSlots);
    expect(configOf(second.gameId)).toBe(configOf(first.gameId));
    expect(globalStore.get(first.gameId)!.config.balance.maxTurns).toBe(18);

    // 第二个玩家加入并开局，验证随机地图完整可玩。
    const joinRes = await app.inject({
      method: 'POST', url: `/api/games/${first.gameId}/join`, payload: { name: 'B' },
    });
    expect(joinRes.statusCode).toBe(200);
    const startRes = await app.inject({
      method: 'POST',
      url: `/api/games/${first.gameId}/start`,
      headers: { 'X-Host-Token': first.hostToken },
    });
    expect(startRes.statusCode).toBe(200);
    const game = globalStore.get(first.gameId)!;
    expect(game.phase).toBe('active');
    expect(game.units.length).toBeGreaterThan(0);
    expect(Object.keys(game.headquarters)).toHaveLength(2);
  });

  it('supports 2-8 player random maps', async () => {
    app = await startTestServer();
    for (const maxPlayers of [3, 6, 8]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/games',
        payload: { mapId: 'random', maxPlayers, random: { seed: `p${maxPlayers}` } },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().lobby.supportedPlayerCounts).toEqual([maxPlayers]);
    }
  });

  it('rejects invalid player counts and malformed random options', async () => {
    app = await startTestServer();
    const badCount = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mapId: 'random', maxPlayers: 9 },
    });
    expect(badCount.statusCode).toBe(400);
    expect(badCount.json().code).toBe('unsupported_player_count');

    const badOptions = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mapId: 'random', maxPlayers: 2, random: { maxTurns: 'many' } },
    });
    expect(badOptions.statusCode).toBe(400);
    expect(badOptions.json().error).toContain('maxTurns');

    const badShape = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mapId: 'random', maxPlayers: 2, random: 'not-an-object' },
    });
    expect(badShape.statusCode).toBe(400);
  });

  it('keeps static maps working unchanged', async () => {
    app = await startTestServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mapId: 'default', maxPlayers: 2 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().lobby.mapId).toBe('default');
  });
});

describe('random map preview API', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    for (const id of globalStore.list()) globalStore.delete(id);
    if (app) await app.close();
  });

  it('returns the same preview shape as static map listings', async () => {
    app = await startTestServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/maps/random/preview',
      payload: { maxPlayers: 2, random: { seed: 'preview-a' } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { seed: string; preview: any };
    expect(body.seed).toBe('preview-a');
    expect(body.preview.mode).toBe('standard');
    expect(body.preview.cells.length).toBeGreaterThan(0);
    expect(body.preview.spawnSlots).toHaveLength(2);
    expect(body.preview.controlPoints.length).toBeGreaterThan(0);
    expect(body.preview.supportedPlayerCounts).toEqual([2]);

    // 预览与同种子实际创建的对局配置一致（所见即所得）。
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mapId: 'random', maxPlayers: 2, random: { seed: 'preview-a' } },
    });
    const game = globalStore.get(createRes.json().gameId)!;
    expect(JSON.stringify(game.config.terrainCells)).toBe(JSON.stringify(body.preview.terrainCells));
    expect(JSON.stringify(game.config.spawnSlots)).toBe(JSON.stringify(body.preview.spawnSlots));
  });

  it('assigns a seed when omitted and matches previews for the same seed', async () => {
    app = await startTestServer();
    const first = await app.inject({
      method: 'POST',
      url: '/api/maps/random/preview',
      payload: { maxPlayers: 4, random: {} },
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json() as { seed: string; preview: any };
    expect(typeof firstBody.seed).toBe('string');
    expect(firstBody.seed.length).toBeGreaterThan(0);
    expect(firstBody.preview.spawnSlots).toHaveLength(4);

    // 用返回的种子再预览一次，结果完全一致；代抽种子每次不同。
    const pinned = await app.inject({
      method: 'POST',
      url: '/api/maps/random/preview',
      payload: { maxPlayers: 4, random: { seed: firstBody.seed } },
    });
    expect(JSON.stringify(pinned.json().preview)).toBe(JSON.stringify(firstBody.preview));

    const second = await app.inject({
      method: 'POST',
      url: '/api/maps/random/preview',
      payload: { maxPlayers: 4 },
    });
    expect(second.json().seed).not.toBe(firstBody.seed);
  });

  it('rejects malformed preview options', async () => {
    app = await startTestServer();
    const bad = await app.inject({
      method: 'POST',
      url: '/api/maps/random/preview',
      payload: { maxPlayers: 2, random: { radius: 'huge' } },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toContain('radius');

    const badCount = await app.inject({
      method: 'POST',
      url: '/api/maps/random/preview',
      payload: { maxPlayers: 99 },
    });
    expect(badCount.statusCode).toBe(400);
  });
});
