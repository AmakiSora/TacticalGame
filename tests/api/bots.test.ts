// tests/api/bots.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestServer } from '../helpers.js';
import { globalStore } from '../../src/state/store.js';
interface CreatedGame {
  gameId: string;
  hostToken: string;
  player: { id: string; token: string };
}

async function createTwoPlayerLobby(
  app: FastifyInstance,
  payload: Record<string, unknown> = {},
): Promise<CreatedGame> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/games',
    payload: { maxPlayers: 2, participate: true, playerName: 'Host', ...payload },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as CreatedGame;
}

describe('RL bot endpoints', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await startTestServer();
  });

  afterEach(async () => {
    for (const id of globalStore.list()) globalStore.delete(id);
    if (app) await app.close();
  });

  it('lists rl model files with python resolution', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/rl/models' });
    expect(res.statusCode).toBe(200);
    const data = res.json() as { models: Array<{ file: string; mtimeMs: number }>; python: string };
    expect(Array.isArray(data.models)).toBe(true);
    for (const model of data.models) {
      expect(model.file.endsWith('.zip')).toBe(true);
      expect(typeof model.mtimeMs).toBe('number');
    }
    // newest first
    const times = data.models.map(model => model.mtimeMs);
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(typeof data.python).toBe('string');
  });

  it('rejects bot creation without host token', async () => {
    const created = await createTwoPlayerLobby(app);
    const res = await app.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/bots`,
      payload: { name: 'Bot', model: 'whatever.zip' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('invalid_host_token');
  });

  it('rejects unknown models', async () => {
    const created = await createTwoPlayerLobby(app);
    const res = await app.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/bots`,
      headers: { 'X-Host-Token': created.hostToken },
      payload: { name: 'Bot', model: 'definitely-not-on-disk.zip' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('model_not_found');
  });

  it('adds a bot seat to the lobby without leaking its token', async () => {
    const created = await createTwoPlayerLobby(app);
    const listRes = await app.inject({ method: 'GET', url: '/api/rl/models' });
    const models = (listRes.json() as { models: Array<{ file: string }> }).models;
    if (!models.length) return; // nothing to add on machines without weights

    const res = await app.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/bots`,
      headers: { 'X-Host-Token': created.hostToken },
      payload: { name: '强化AI', model: models[0]!.file },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      ok: boolean;
      bot: { id: string; name: string; model: string };
      lobby: { players: Array<{ id: string; name: string }> };
    };
    expect(body.ok).toBe(true);
    expect(body.bot.model).toBe(models[0]!.file);
    expect(body.lobby.players.some(player => player.name === '强化AI')).toBe(true);

    // The seat token must never appear in any response.
    const game = globalStore.get(created.gameId)!;
    const serialized = JSON.stringify(body);
    for (const [playerId, token] of Object.entries(game.tokens)) {
      if (playerId === created.player.id) continue;
      expect(serialized).not.toContain(token as string);
    }
  });

  it('rejects bots on simultaneous maps and multi-player lobbies', async () => {
    const standoff = await createTwoPlayerLobby(app, { mapId: 'standoff' });
    const listRes = await app.inject({ method: 'GET', url: '/api/rl/models' });
    const modelFile = (listRes.json() as { models: Array<{ file: string }> }).models[0]?.file ?? 'x.zip';
    const simRes = await app.inject({
      method: 'POST',
      url: `/api/games/${standoff.gameId}/bots`,
      headers: { 'X-Host-Token': standoff.hostToken },
      payload: { model: modelFile },
    });
    expect(simRes.statusCode).toBe(400);
    expect(simRes.json().code).toBe('bot_not_supported');

    // 4-player lobbies are only possible on maps that support them; the runner
    // is 2-seat-only either way, so any maxPlayers !== 2 lobby must be refused.
    const fourPlayers = await createTwoPlayerLobby(app, { mapId: 'multiplayer-ring', maxPlayers: 3 });
    const fourRes = await app.inject({
      method: 'POST',
      url: `/api/games/${fourPlayers.gameId}/bots`,
      headers: { 'X-Host-Token': fourPlayers.hostToken },
      payload: { model: modelFile },
    });
    expect(fourRes.statusCode).toBe(400);
    expect(fourRes.json().code).toBe('bot_not_supported');
  });

  it('rejects bots once the game has started', async () => {
    const created = await createTwoPlayerLobby(app);
    await app.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/join`,
      payload: { name: 'B' },
    });
    const startRes = await app.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/start`,
      headers: { 'X-Host-Token': created.hostToken },
    });
    expect(startRes.statusCode).toBe(200);

    const listRes = await app.inject({ method: 'GET', url: '/api/rl/models' });
    const modelFile = (listRes.json() as { models: Array<{ file: string }> }).models[0]?.file ?? 'x.zip';
    const res = await app.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/bots`,
      headers: { 'X-Host-Token': created.hostToken },
      payload: { model: modelFile },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('game_already_started');
  });

  it('allows re-adding a bot after the previous one was kicked', async () => {
    const created = await createTwoPlayerLobby(app);
    const listRes = await app.inject({ method: 'GET', url: '/api/rl/models' });
    const models = (listRes.json() as { models: Array<{ file: string }> }).models;
    if (!models.length) return;

    const add = async () => app.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/bots`,
      headers: { 'X-Host-Token': created.hostToken },
      payload: { model: models[0]!.file },
    });
    const first = await add();
    expect(first.statusCode).toBe(200);
    const botId = (first.json() as { bot: { id: string } }).bot.id;

    const kick = await app.inject({
      method: 'DELETE',
      url: `/api/games/${created.gameId}/players/${botId}`,
      headers: { 'X-Host-Token': created.hostToken },
    });
    expect(kick.statusCode).toBe(200);

    const second = await add();
    expect(second.statusCode).toBe(200);
  });
});

describe('RL bot legacy model support', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await startTestServer();
  });

  afterEach(async () => {
    for (const id of globalStore.list()) globalStore.delete(id);
    if (app) await app.close();
  });

  it('exposes per-model runner routing and supported action spaces', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/rl/models' });
    expect(res.statusCode).toBe(200);
    const data = res.json() as {
      models: Array<{ file: string; actionSpace: number | null; runner: string; label: string; supported: boolean }>;
      supportedActionSpaces: number[];
    };
    expect(data.supportedActionSpaces).toEqual(expect.arrayContaining([54, 38]));
    for (const model of data.models) {
      expect(typeof model.runner).toBe('string');
      expect(model.supported).toBe(model.actionSpace === 54 || model.actionSpace === 38 || model.actionSpace === 512);
      // 每个动作空间都走训练时期对应的快照运行器。
      // 54 动作有四个观测世代：v2.6+（5974 维，回退）走当前运行器，
      // v2.5（6024 维）走 env_v25 快照运行器，v2.3/v2.4（5974 维）走 env_v24，
      // v2.1/v2.2（3922 维）走 env_v22 快照运行器。
      if (model.actionSpace === 54) {
        const versionMatch = /v(\d+)\.(\d+)\./.exec(model.file);
        const major = versionMatch !== null ? Number(versionMatch[1]) : 0;
        const minor = versionMatch !== null ? Number(versionMatch[2]) : 0;
        const atLeast = (m: number) => versionMatch !== null && (major > 2 || (major === 2 && minor >= m));
        if (atLeast(6)) {
          expect(model.runner.endsWith('run_model.py')).toBe(true);
          expect(model.label).toBe('v2.6');
        } else if (atLeast(5)) {
          expect(model.runner.endsWith('run_model_v25.py')).toBe(true);
          expect(model.label).toBe('v2.5');
        } else if (atLeast(3)) {
          expect(model.runner.endsWith('run_model_v24.py')).toBe(true);
          expect(model.label).toBe('v2.3');
        } else {
          expect(model.runner.endsWith('run_model_v22.py')).toBe(true);
          expect(model.label).toBe('v2.2');
        }
      }
      if (model.actionSpace === 38) expect(model.runner.endsWith('run_model_v200.py')).toBe(true);
      if (model.actionSpace === 512) {
        expect(model.runner.endsWith('run_model_v100.py')).toBe(true);
        expect(model.supported).toBe(true);
      }
    }
  });

  it('accepts adding a legacy v2.0 model as a bot', async () => {
    const created = await createTwoPlayerLobby(app);
    const listRes = await app.inject({ method: 'GET', url: '/api/rl/models' });
    const models = (listRes.json() as { models: Array<{ file: string }> }).models;
    const legacy = models.find(model => /v2\.0\./.test(model.file));
    if (!legacy) return; // nothing to verify on machines without legacy weights

    const res = await app.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/bots`,
      headers: { 'X-Host-Token': created.hostToken },
      payload: { name: '旧版AI', model: legacy.file },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { bot: { model: string } }).bot.model).toBe(legacy.file);
  });

  it('accepts the original 512-action random-opponent models', async () => {
    const created = await createTwoPlayerLobby(app);
    const listRes = await app.inject({ method: 'GET', url: '/api/rl/models' });
    const models = (listRes.json() as { models: Array<{ file: string; actionSpace: number | null }> }).models;
    const legacy = models.find(model => /random_opponent/.test(model.file));
    if (!legacy) return;
    expect(legacy.actionSpace).toBe(512);

    const res = await app.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/bots`,
      headers: { 'X-Host-Token': created.hostToken },
      payload: { name: '早期AI', model: legacy.file },
    });
    expect(res.statusCode).toBe(200);
  });
});
