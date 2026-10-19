import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestServer } from '../helpers.js';
import { globalStore } from '../../src/state/store.js';

interface ListedGame {
  gameId: string;
  mapId: string;
  mapName: string;
  hostName: string;
  createdAt: number | null;
}

describe('available games list map label', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    for (const id of globalStore.list()) globalStore.delete(id);
    if (app) await app.close();
  });

  async function listGames(): Promise<ListedGame[]> {
    const res = await app.inject({ method: 'GET', url: '/api/games' });
    expect(res.statusCode).toBe(200);
    return res.json().games as ListedGame[];
  }

  it('returns the Chinese map name next to mapId for static lobbies', async () => {
    app = await startTestServer();
    const created = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mapId: 'artillery-zone', maxPlayers: 2, participate: false, playerName: 'Host' },
    });
    expect(created.statusCode).toBe(200);

    const [game] = await listGames();
    expect(game.mapId).toBe('artillery-zone');
    // 大厅列表的标题以中文名为主、mapId 作英文辅名，服务端直接把配置名带上。
    expect(game.mapName).toBe('炮火禁区');
    expect(game.hostName).toBe('Host');
  });

  it('labels random lobbies with the generated map name', async () => {
    app = await startTestServer();
    const created = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mapId: 'random', maxPlayers: 2, participate: false, random: { seed: 'lobby-label' } },
    });
    expect(created.statusCode).toBe(200);

    const [game] = await listGames();
    expect(game.mapId).toBe('random');
    expect(game.mapName).toBe('随机战场');
    expect(game.hostName).toBe('');
  });

  it('uses the seat default name when a participating host leaves the name empty', async () => {
    app = await startTestServer();
    const created = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mapId: 'artillery-zone', maxPlayers: 2, participate: true },
    });
    expect(created.statusCode).toBe(200);
    expect((await listGames())[0].hostName).toBe('玩家 A');
  });

  it('follows the host seat name when the host joins and renames', async () => {
    app = await startTestServer();
    const created = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { mapId: 'multiplayer-ring', maxPlayers: 3, participate: false, playerName: '房东' },
    });
    expect(created.statusCode).toBe(200);
    const { gameId, hostToken } = created.json() as { gameId: string; hostToken: string };
    expect((await listGames())[0].hostName).toBe('房东');

    // 带房主凭证加入战斗：房主名跟随席位名。
    const joined = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/join`,
      headers: { 'X-Host-Token': hostToken },
      payload: { name: '参战房主' },
    });
    expect(joined.statusCode).toBe(200);
    expect((await listGames())[0].hostName).toBe('参战房主');

    // 房主在房间内改名（带房主凭证）同步到列表。
    const seat = joined.json().player as { id: string; token: string };
    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/games/${gameId}/player`,
      headers: { 'X-Player-Token': seat.token, 'X-Host-Token': hostToken },
      payload: { name: '改名后的房主' },
    });
    expect(renamed.statusCode).toBe(200);
    expect((await listGames())[0].hostName).toBe('改名后的房主');
  });

  it('keeps empty lobbies time-stamped so new rooms stay on top', async () => {
    app = await startTestServer();
    const create = async (name: string) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/games',
        payload: { mapId: 'multiplayer-ring', maxPlayers: 2, participate: false, playerName: name },
      });
      expect(res.statusCode).toBe(200);
      return res.json().gameId as string;
    };
    const older = await create('Old');
    await new Promise(resolve => setTimeout(resolve, 15));
    const newer = await create('New');

    const games = await listGames();
    // 空房间（房主未参战）原来拿不到时间戳，列表里既不显示创建于、又会被排到最后。
    expect(typeof games[0].createdAt).toBe('number');
    const order = games.map(game => game.gameId);
    expect(order.indexOf(newer)).toBeLessThan(order.indexOf(older));
  });
});
