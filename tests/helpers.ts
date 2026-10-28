// tests/helpers.ts
import { buildServer } from '../src/server.js';
import type { FastifyInstance } from 'fastify';
import { globalStore } from '../src/state/store.js';

export interface StartTestServerOptions {
  /** 覆盖 TRUST_PROXY（默认不动环境，保持既有行为）。 */
  trustProxy?: boolean;
  /** 覆盖 AUTO_CONTROL_TOKEN（默认不动环境）。 */
  autoControlToken?: string;
}

/**
 * 起一个测试服务。options 省略时行为与以前完全一致：
 * 不改任何环境变量，也不注册额外 hook。给了 options 才会临时改环境，
 * 并在 app.close() 时还原，避免污染同进程里的其它用例。
 */
export async function startTestServer(options: StartTestServerOptions = {}): Promise<FastifyInstance> {
  const touched: Array<[string, string | undefined]> = [];
  const apply = (name: string, value: string | undefined): void => {
    if (value === undefined) return;
    touched.push([name, process.env[name]]);
    process.env[name] = value;
  };
  apply('TRUST_PROXY', options.trustProxy === undefined ? undefined : String(options.trustProxy));
  apply('AUTO_CONTROL_TOKEN', options.autoControlToken);

  const restore = (): void => {
    for (const [name, value] of touched.splice(0).reverse()) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };

  let app: FastifyInstance;
  try {
    app = await buildServer();
    // 必须在 ready() 之前注册：ready 之后 Fastify 拒绝新增 hook。
    if (touched.length > 0) app.addHook('onClose', async () => { restore(); });
    await app.ready();
  } catch (err) {
    restore();
    throw err;
  }
  return app;
}

export async function createGameAndJoin(app: FastifyInstance) {
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
    method: 'POST', url: `/api/games/${created.gameId}/join`,
    payload: { name: 'B' },
  });
  const joined = joinRes.json() as { player: { id: 'player_b'; token: string } };

  await app.inject({
    method: 'POST',
    url: `/api/games/${created.gameId}/start`,
    headers: { 'X-Host-Token': created.hostToken },
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
    tokenA: created.player.token,
    tokenB: joined.player.token,
    playerAToken: created.player.token,
    playerBToken: joined.player.token,
  };
}
