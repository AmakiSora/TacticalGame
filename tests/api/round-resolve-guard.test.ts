// tests/api/round-resolve-guard.test.ts
// #7：回合结算的轮次守卫。同一轮不能结算两次（补给/收入会多发一份）；
// 任何新输入（入队 / 提交）解锁下一轮；skip-turn 用「同轮同玩家不重复跳」的独立守卫。
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestServer } from '../helpers.js';
import { globalStore, GameStore, createInitialGame, gameSnapshotPath } from '../../src/state/store.js';
import { queueWaitAction } from '../../src/engine/planning.js';
import { skipTurn } from '../../src/engine/engine.js';
import { commitAndMaybeResolve } from '../../src/engine/simultaneous.js';
import { EventBus } from '../../src/events/bus.js';
import { startGame } from '../../src/engine/engine.js';
import { addLobbyPlayer, createLobby } from '../../src/state/store.js';
import { renderMetrics, resetMetrics } from '../../src/utils/metrics.js';

const servers: FastifyInstance[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  while (servers.length > 0) await servers.pop()!.close().catch(() => {});
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function server(): Promise<FastifyInstance> {
  const app = await startTestServer();
  servers.push(app);
  return app;
}

async function simultaneousGame(app: FastifyInstance) {
  const createRes = await app.inject({
    method: 'POST', url: '/api/games',
    payload: { mapId: 'standoff', maxPlayers: 2, participate: true, playerName: 'A' },
  });
  const created = createRes.json() as {
    gameId: string;
    hostToken: string;
    player: { id: string; token: string };
  };
  const joinRes = await app.inject({ method: 'POST', url: `/api/games/${created.gameId}/join`, payload: { name: 'B' } });
  const joined = joinRes.json() as { player: { id: string; token: string } };
  const startRes = await app.inject({
    method: 'POST', url: `/api/games/${created.gameId}/start`,
    headers: { 'X-Host-Token': created.hostToken },
  });
  expect(startRes.statusCode).toBe(200);
  return {
    gameId: created.gameId,
    hostToken: created.hostToken,
    tokens: {
      [created.player.id]: created.player.token,
      [joined.player.id]: joined.player.token,
    } as Record<string, string>,
  };
}

function counts(app: FastifyInstance, gameId: string, type: string): number {
  const game = globalStore.get(gameId)!;
  return game.events.filter(event => event.type === type).length;
}

const REPEAT_METRIC = 'tactical_round_force_repeat_total';

/** 从 Prometheus 文本里读计数器的当前值（无标签，一行一个 series；缺失按 0）。 */
function metricValue(name: string): number {
  let total = 0;
  for (const line of renderMetrics().split('\n')) {
    if (!line.startsWith(`${name} `)) continue;
    total += Number(line.slice(name.length + 1));
  }
  return total;
}

describe('simultaneous: the same round cannot be resolved twice', () => {
  it('rejects a second force-resolve with 409 round_already_resolved', async () => {
    const app = await server();
    const { gameId, hostToken } = await simultaneousGame(app);
    const game = globalStore.get(gameId)!;
    expect(game.turn.roundNumber).toBe(1);

    const first = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/host/force-resolve`,
      headers: { 'X-Host-Token': hostToken },
    });
    expect(first.statusCode).toBe(200);
    expect(game.turn.roundNumber).toBe(2);
    expect(counts(app, gameId, 'round_resolved')).toBe(1);
    expect(counts(app, gameId, 'round_start')).toBe(1);

    const second = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/host/force-resolve`,
      headers: { 'X-Host-Token': hostToken },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ code: 'round_already_resolved' });
    // 轮号只 +1，结算与补给都只发生一次。
    expect(game.turn.roundNumber).toBe(2);
    expect(counts(app, gameId, 'round_resolved')).toBe(1);
    expect(counts(app, gameId, 'round_start')).toBe(1);
  });

  it('unlocks again as soon as someone makes a new input', async () => {
    const app = await server();
    const { gameId, hostToken } = await simultaneousGame(app);
    const game = globalStore.get(gameId)!;

    await app.inject({
      method: 'POST', url: `/api/games/${gameId}/host/force-resolve`,
      headers: { 'X-Host-Token': hostToken },
    });
    expect(game.turn.resolvedRound).toBe(game.turn.roundNumber);

    // 新的输入（排队一手 wait）解锁本轮。
    expect(queueWaitAction(game, 'player_a').ok).toBe(true);
    expect(game.turn.resolvedRound).toBeNull();

    const again = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/host/force-resolve`,
      headers: { 'X-Host-Token': hostToken },
    });
    expect(again.statusCode).toBe(200);
    expect(game.turn.roundNumber).toBe(3);
  });

  it('guards the auto-resolve path too (all players committed)', async () => {
    const app = await server();
    const { gameId, hostToken } = await simultaneousGame(app);
    const game = globalStore.get(gameId)!;
    // 两家都提交 → 自动结算一次（引擎路径，与玩家动作接口同一条链路）。
    for (const player of ['player_a', 'player_b'] as const) {
      expect(commitAndMaybeResolve(game, new EventBus(), player).ok).toBe(true);
    }
    expect(game.turn.roundNumber).toBe(2);
    const resolvedAfterAuto = counts(app, gameId, 'round_resolved');

    const forced = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/host/force-resolve`,
      headers: { 'X-Host-Token': hostToken },
    });
    expect(forced.statusCode).toBe(409);
    expect(forced.json()).toMatchObject({ code: 'round_already_resolved' });
    expect(game.turn.roundNumber).toBe(2);
    expect(counts(app, gameId, 'round_resolved')).toBe(resolvedAfterAuto);
  });

  it('replays the first response for the same Idempotency-Key instead of resolving twice', async () => {
    const app = await server();
    const { gameId, hostToken } = await simultaneousGame(app);
    const game = globalStore.get(gameId)!;
    const send = () => app.inject({
      method: 'POST', url: `/api/games/${gameId}/host/force-resolve`,
      headers: { 'X-Host-Token': hostToken, 'Idempotency-Key': 'resolve-once' },
    });
    const first = await send();
    expect(first.statusCode).toBe(200);
    const second = await send();
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect(game.turn.roundNumber).toBe(2);
    expect(counts(app, gameId, 'round_resolved')).toBe(1);
  });

  it('does not leak the guard fields to clients or the replay payload', async () => {
    const app = await server();
    const { gameId, tokens } = await simultaneousGame(app);
    const game = globalStore.get(gameId)!;
    expect(game.turn.resolvedRound).toBeNull();
    const [playerId, token] = Object.entries(tokens)[0]!;
    const res = await app.inject({
      method: 'GET', url: `/api/games/${gameId}`,
      headers: { 'X-Player-Token': token },
    });
    expect(res.statusCode, playerId).toBe(200);
    const body = res.json() as { turn: Record<string, unknown>; events: Array<{ type: string; payload: Record<string, unknown> }> };
    expect(body.turn).not.toHaveProperty('resolvedRound');
    expect(body.turn).not.toHaveProperty('skipGuard');
    // 回放（事件流）里没有 turn 快照，开局事件也不带这两个字段。
    const start = body.events.find(event => event.type === 'game_start')!;
    expect(start.payload).not.toHaveProperty('turn');
    expect(JSON.stringify(start.payload)).not.toContain('resolvedRound');
    expect(JSON.stringify(body.events)).not.toContain('resolvedRound');
  });
});

describe('sequence mode: skip-turn guard', () => {
  it('skips different players in the same round but refuses to skip the same one twice', async () => {
    const bus = new EventBus();
    // 3 人局：连跳两人仍在同一轮，能干净地构造「同轮同玩家重试」。
    const game = createLobby(`skip-guard-${Math.random().toString(36).slice(2, 8)}`, 'multiplayer-ring', {
      maxPlayers: 3, participate: true, playerName: 'A',
    });
    expect(addLobbyPlayer(game, 'B')).not.toBeNull();
    expect(addLobbyPlayer(game, 'C')).not.toBeNull();
    expect(startGame(game, bus, () => 0).ok).toBe(true);

    const round = game.turn.roundNumber;
    const first = game.turn.currentPlayerId!;
    expect(skipTurn(game, bus).ok).toBe(true);
    expect(game.turn.currentPlayerId).not.toBe(first);
    // 连跳下一个人是合法的（顺序模式本来就要能连跳）。
    expect(skipTurn(game, bus).ok).toBe(true);
    expect(game.turn.roundNumber).toBe(round);

    // 把当前玩家改回本轮已经跳过的人，模拟一次重试 → 必须被拒。
    game.turn.currentPlayerId = first;
    game.turn.currentOwner = first;
    const retry = skipTurn(game, bus);
    expect(retry.ok).toBe(false);
    expect(retry.ok ? null : retry.code).toBe('round_already_resolved');
  });
});

describe('loaded snapshots: conservative default for resolvedRound', () => {
  it('treats a legacy snapshot (no resolvedRound) as already resolved this round', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tg-guard-'));
    tempDirs.push(dir);
    const file = join(dir, 'games.json');
    const game = createInitialGame('legacy-guard');
    game.turn.roundNumber = 4;
    delete (game.turn as { resolvedRound?: number | null }).resolvedRound;
    const store = new GameStore({ persistenceFile: file });
    store.save(game);
    // 手写一份不含该字段的快照（模拟 3.8.8 的旧档）。
    const snapshotPath = gameSnapshotPath(file, 'legacy-guard');
    const payload = JSON.parse(readFileSync(snapshotPath, 'utf8')) as {
      game: { turn: Record<string, unknown> };
    };
    delete payload.game.turn.resolvedRound;
    delete payload.game.turn.skipGuard;
    writeFileSync(snapshotPath, JSON.stringify(payload));

    const reloaded = new GameStore({ persistenceFile: file });
    reloaded.loadFromDisk();
    const loaded = reloaded.get('legacy-guard')!;
    // 保守：视为本轮已结算（= 当前轮号），否则重启后还能把这一轮再推一次。
    expect(loaded.turn.resolvedRound).toBe(loaded.turn.roundNumber);
    expect(loaded.turn.skipGuard).toBeNull();
  });
});


describe('simultaneous: host can explicitly override the round guard with repeat', () => {
  it('rejects twice, then lets the host force one more resolve with repeat=true', async () => {
    const app = await server();
    const { gameId, hostToken } = await simultaneousGame(app);
    const game = globalStore.get(gameId)!;

    const first = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/host/force-resolve`,
      headers: { 'X-Host-Token': hostToken },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ repeated: false });
    expect(game.turn.roundNumber).toBe(2);

    // 默认仍然防误触：不带 repeat 第二次 409。
    const blocked = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/host/force-resolve`,
      headers: { 'X-Host-Token': hostToken },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ code: 'round_already_resolved' });
    expect(game.turn.roundNumber).toBe(2);

    // 房主显式 repeat：这一下放行，且只放行这一次。
    const repeated = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/host/force-resolve`,
      headers: { 'X-Host-Token': hostToken },
      payload: { repeat: true },
    });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json()).toMatchObject({ repeated: true, roundNumber: 2 });
    expect(game.turn.roundNumber).toBe(3);

    // repeat 不是常开开关：紧接着再来一次又被守卫拦住。
    const blockedAgain = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/host/force-resolve`,
      headers: { 'X-Host-Token': hostToken },
    });
    expect(blockedAgain.statusCode).toBe(409);
    // 带 repeat 的请求与不带的不能被同一个幂等键混用。
    expect(counts(app, gameId, 'round_resolved')).toBe(2);
  });

  it('counts exactly one income round in supplies, and the blocked retry adds nothing', async () => {
    const app = await server();
    const { gameId, hostToken } = await simultaneousGame(app);
    const game = globalStore.get(gameId)!;
    const players = Object.keys(game.resources) as Array<'player_a' | 'player_b'>;
    const before = Object.fromEntries(players.map(id => [id, game.resources[id]!.supplies])) as Record<string, number>;

    const first = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/host/force-resolve`,
      headers: { 'X-Host-Token': hostToken },
    });
    expect(first.statusCode).toBe(200);
    const income = game.config.balance.baseIncome;
    for (const id of players) {
      // 一轮收入 = baseIncome（standoff 没有据点收益、总部满血不维修）。
      expect(game.resources[id]!.supplies - before[id]!, id).toBe(income);
    }

    // 被守卫拦下的那次不能再发一份补给。
    const blocked = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/host/force-resolve`,
      headers: { 'X-Host-Token': hostToken },
    });
    expect(blocked.statusCode).toBe(409);
    for (const id of players) expect(game.resources[id]!.supplies - before[id]!, id).toBe(income);

    // repeat 放行的那一次才再发一份。
    const repeated = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/host/force-resolve`,
      headers: { 'X-Host-Token': hostToken },
      payload: { repeat: true },
    });
    expect(repeated.statusCode).toBe(200);
    for (const id of players) expect(game.resources[id]!.supplies - before[id]!, id).toBe(income * 2);
  });
});

describe('host force-resolve: repeat + Idempotency-Key', () => {
  // 带 body 的请求必须显式声明 JSON，否则 Fastify 不解析（注入时 payload 是对象也要给头）。
  function resolveReq(
    app: FastifyInstance,
    gameId: string,
    hostToken: string,
    key?: string,
    payload?: Record<string, unknown>,
  ) {
    return app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/host/force-resolve`,
      headers: {
        'X-Host-Token': hostToken,
        ...(key ? { 'Idempotency-Key': key } : {}),
        ...(payload ? { 'content-type': 'application/json' } : {}),
      },
      ...(payload ? { payload } : {}),
    });
  }

  it('同一个 key 先 repeat:true 后 {}：409 idempotency_conflict，且不推进轮次', async () => {
    const app = await server();
    const { gameId, hostToken } = await simultaneousGame(app);
    const game = globalStore.get(gameId)!;

    const first = await resolveReq(app, gameId, hostToken, 'mix-repeat-first', { repeat: true });
    expect(first.statusCode).toBe(200);
    expect(game.turn.roundNumber).toBe(2);
    expect(counts(app, gameId, 'round_resolved')).toBe(1);

    const conflict = await resolveReq(app, gameId, hostToken, 'mix-repeat-first', {});
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ code: 'idempotency_conflict' });
    // 冲突请求既不结算也不推进。
    expect(game.turn.roundNumber).toBe(2);
    expect(counts(app, gameId, 'round_resolved')).toBe(1);
  });

  it('同一个 key 先 {} 后 repeat:true：同样 409 idempotency_conflict', async () => {
    const app = await server();
    const { gameId, hostToken } = await simultaneousGame(app);
    const game = globalStore.get(gameId)!;

    const first = await resolveReq(app, gameId, hostToken, 'mix-plain-first', {});
    expect(first.statusCode).toBe(200);
    expect(game.turn.roundNumber).toBe(2);

    const conflict = await resolveReq(app, gameId, hostToken, 'mix-plain-first', { repeat: true });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ code: 'idempotency_conflict' });
    expect(game.turn.roundNumber).toBe(2);
    expect(counts(app, gameId, 'round_resolved')).toBe(1);
  });

  it('同一个 key + 同一个 body（repeat:true）重放：回放首次响应，轮号不再推进', async () => {
    const app = await server();
    const { gameId, hostToken } = await simultaneousGame(app);
    const game = globalStore.get(gameId)!;

    // 先把第 1 轮正常结算掉，让 repeat 那次真的跳过守卫（repeated=true）。
    const normal = await resolveReq(app, gameId, hostToken);
    expect(normal.statusCode).toBe(200);
    expect(game.turn.roundNumber).toBe(2);

    const first = await resolveReq(app, gameId, hostToken, 'replay-repeat', { repeat: true });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ repeated: true, roundNumber: 2 });
    expect(game.turn.roundNumber).toBe(3);
    expect(counts(app, gameId, 'round_resolved')).toBe(2);

    const replay = await resolveReq(app, gameId, hostToken, 'replay-repeat', { repeat: true });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());
    expect(game.turn.roundNumber).toBe(3);
    expect(counts(app, gameId, 'round_resolved')).toBe(2);
  });
});

describe('host force-resolve: repeat metrics', () => {
  // metrics 是进程级全局状态：每个用例开头归零，只断相对差值；vitest 默认按文件隔离，
  // 本文件的 reset 不影响 arena-eval 等其它文件的计数。
  it('只有真正跳过守卫的 repeat 才 +1：普通结算与 409 都不计数', async () => {
    resetMetrics();
    const app = await server();
    const { gameId, hostToken } = await simultaneousGame(app);
    const game = globalStore.get(gameId)!;
    expect(metricValue(REPEAT_METRIC)).toBe(0);

    // 普通结算（守卫未触发）→ repeated=false，不计数。
    const first = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/host/force-resolve`,
      headers: { 'X-Host-Token': hostToken },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ repeated: false });
    expect(metricValue(REPEAT_METRIC)).toBe(0);

    // 被守卫拦下的 409（不带 repeat）→ 不计数。
    const blocked = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/host/force-resolve`,
      headers: { 'X-Host-Token': hostToken },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ code: 'round_already_resolved' });
    expect(metricValue(REPEAT_METRIC)).toBe(0);

    // 守卫真被跳过的一次 → 恰好 +1。
    const repeated = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/host/force-resolve`,
      headers: { 'X-Host-Token': hostToken, 'content-type': 'application/json' },
      payload: { repeat: true },
    });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json()).toMatchObject({ repeated: true });
    expect(game.turn.roundNumber).toBe(3);
    expect(metricValue(REPEAT_METRIC)).toBe(1);

    // 有新输入后 repeat 不再触发守卫（repeated=false）→ 仍停在 1。
    expect(queueWaitAction(game, 'player_a').ok).toBe(true);
    const unlocked = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/host/force-resolve`,
      headers: { 'X-Host-Token': hostToken, 'content-type': 'application/json' },
      payload: { repeat: true },
    });
    expect(unlocked.statusCode).toBe(200);
    expect(unlocked.json()).toMatchObject({ repeated: false });
    expect(metricValue(REPEAT_METRIC)).toBe(1);
  });

  it('repeat 可连续调用（没有硬上限）：两次都 200、轮号连推两轮、metric +2', async () => {
    resetMetrics();
    const app = await server();
    const { gameId, hostToken } = await simultaneousGame(app);
    const game = globalStore.get(gameId)!;

    const normal = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/host/force-resolve`,
      headers: { 'X-Host-Token': hostToken },
    });
    expect(normal.statusCode).toBe(200);
    expect(game.turn.roundNumber).toBe(2);
    expect(metricValue(REPEAT_METRIC)).toBe(0);

    for (const step of [1, 2]) {
      const repeated = await app.inject({
        method: 'POST', url: `/api/games/${gameId}/host/force-resolve`,
        headers: { 'X-Host-Token': hostToken, 'content-type': 'application/json' },
        payload: { repeat: true },
      });
      expect(repeated.statusCode, `第 ${step} 次 repeat`).toBe(200);
      expect(repeated.json()).toMatchObject({ repeated: true });
      expect(game.turn.roundNumber).toBe(2 + step);
      expect(metricValue(REPEAT_METRIC)).toBe(step);
    }

    // 这一语义是「房主明确要推」：没有每小时上限，将来若加限制必须改这里。
    expect(game.turn.roundNumber).toBe(4);
    expect(counts(app, gameId, 'round_resolved')).toBe(3);
  });
});

describe('host skip-turn: Idempotency-Key protects against HTTP retries', () => {
  /** 3 人标准局：multiplayer-ring（default 图不支持 3 人，开局会 404）。 */
  async function standardGame3(app: FastifyInstance) {
    const createRes = await app.inject({
      method: 'POST', url: '/api/games',
      payload: { mapId: 'multiplayer-ring', maxPlayers: 3, participate: true, playerName: 'A' },
    });
    expect(createRes.statusCode).toBe(200);
    const created = createRes.json() as { gameId: string; hostToken: string };
    for (const name of ['B', 'C']) {
      const joinRes = await app.inject({
        method: 'POST', url: `/api/games/${created.gameId}/join`, payload: { name },
      });
      expect(joinRes.statusCode, name).toBe(200);
    }
    const startRes = await app.inject({
      method: 'POST', url: `/api/games/${created.gameId}/start`,
      headers: { 'X-Host-Token': created.hostToken },
    });
    expect(startRes.statusCode).toBe(200);
    return { gameId: created.gameId, hostToken: created.hostToken };
  }

  function skipReq(app: FastifyInstance, gameId: string, hostToken: string, key?: string) {
    return app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/host/skip-turn`,
      headers: {
        'X-Host-Token': hostToken,
        'content-type': 'application/json',
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      payload: {},
    });
  }

  it('同一个 Idempotency-Key 连打两次：只跳一次，第二次回放首次响应', async () => {
    const app = await server();
    const { gameId, hostToken } = await standardGame3(app);
    const game = globalStore.get(gameId)!;
    const roundBefore = game.turn.roundNumber;
    const opening = game.turn.currentPlayerId!;

    const first = await skipReq(app, gameId, hostToken, 'skip-retry-once');
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ ok: true });
    const afterFirst = game.turn.currentPlayerId!;
    expect(afterFirst).not.toBe(opening);
    expect(counts(app, gameId, 'turn_skipped')).toBe(1);

    const second = await skipReq(app, gameId, hostToken, 'skip-retry-once');
    expect(second.statusCode).toBe(200);
    // 回放首次响应：当前玩家没有继续往后跳。
    expect(second.json()).toEqual(first.json());
    expect(game.turn.currentPlayerId).toBe(afterFirst);
    expect(counts(app, gameId, 'turn_skipped')).toBe(1);
    expect(game.turn.roundNumber).toBe(roundBefore);
  });

  it('不带幂等键连打两次：确实连跳两人（没有重试保护）', async () => {
    const app = await server();
    const { gameId, hostToken } = await standardGame3(app);
    const game = globalStore.get(gameId)!;
    const roundBefore = game.turn.roundNumber;
    const opening = game.turn.currentPlayerId!;

    const first = await skipReq(app, gameId, hostToken);
    expect(first.statusCode).toBe(200);
    const afterFirst = game.turn.currentPlayerId!;
    expect(afterFirst).not.toBe(opening);

    const second = await skipReq(app, gameId, hostToken);
    expect(second.statusCode).toBe(200);
    const afterSecond = game.turn.currentPlayerId!;
    // 两个人各自被跳过：第二次跳到的人既不是开局时的人，也不是第一次跳到的人。
    expect(afterSecond).not.toBe(opening);
    expect(afterSecond).not.toBe(afterFirst);
    expect(counts(app, gameId, 'turn_skipped')).toBe(2);
    expect(game.turn.roundNumber).toBe(roundBefore);
  });
});
