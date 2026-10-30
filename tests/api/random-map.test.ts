import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestServer } from '../helpers.js';
import { globalStore } from '../../src/state/store.js';
import { RANDOM_PARAM_BOUNDS } from '../../src/config/randomMap.js';

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

  it('passes game mode and artillery options through to the lobby', async () => {
    app = await startTestServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: {
        mapId: 'random',
        maxPlayers: 2,
        playerName: 'A',
        random: {
          seed: 'api-mode',
          mode: 'royale',
          artilleryStartRound: 4,
          artilleryIntervalRounds: 2,
          artilleryDamage: 15,
          artilleryMinimumSafeRadius: 1,
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const created = res.json() as { lobby: { mode: string } };
    expect(created.lobby.mode).toBe('royale');
    const config = globalStore.list()
      .map(id => globalStore.get(id)!)
      .find(game => game.config.mode === 'royale');
    expect(config).toBeDefined();
    expect(config!.config.annihilation).toMatchObject({
      artillery: {
        startRound: 4,
        intervalRounds: 2,
        damage: 15,
        minimumSafeRadius: 1,
      },
    });
    // 歼灭/大逃杀出生位按序绑定唯一据点。
    const boundIds = config!.config.spawnSlots.map((slot: { controlPointId?: string }) => slot.controlPointId);
    expect(new Set(boundIds).size).toBe(config!.config.spawnSlots.length);
  });

  // 评估批次的随机图 id 不是建房地图：必须给出可执行的替代写法，而不是笼统的「找不到地图」。
  it('rejects evaluation-only random map ids with actionable guidance', async () => {
    app = await startTestServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mapId: 'random-annihilation', maxPlayers: 2 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('invalid_move');
    expect(res.json().error).toContain('random-annihilation');
    expect(res.json().error).toContain('mapId=random');
    expect(res.json().error).toContain('random.mode');
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

  it('returns the resolved value of every random parameter', async () => {
    app = await startTestServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/maps/random/preview',
      payload: {
        maxPlayers: 3,
        random: { seed: 'preview-values', radius: [6, 9], infantryHp: [90, 130] },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      seed: string;
      preview: any;
      values: Record<string, number | null>;
    };
    // 每个可调参数都要带实际取值：参数行内的「本图 X」全靠这份回传。
    for (const key of Object.keys(RANDOM_PARAM_BOUNDS)) {
      if (key === 'terrainDensity') continue; // 已废弃别名，不参与生成
      expect(body.values, `${key} 缺实际取值`).toHaveProperty(key);
    }
    expect(body.values.radius).toBeGreaterThanOrEqual(6);
    expect(body.values.radius).toBeLessThanOrEqual(9);
    expect(body.values.radius).toBe(body.preview.radius);
    expect(body.values.controlPointCount).toBe(body.preview.controlPoints.length);
    expect(body.values.maxTurns).toBe(body.preview.maxTurns);
    expect(body.values.actionsPerTurn).toBe(body.preview.actionsPerTurn);
    expect(body.values.infantryHp).toBe(body.preview.units.infantry.hp);
    // 未注入的追赶补给用 null 表示「本图没有这一项」。
    expect(body.values.comebackStartRound).toBeNull();
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
