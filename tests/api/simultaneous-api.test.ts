// tests/api/simultaneous-api.test.ts
// simultaneous 模式（standoff 地图）的 HTTP 端到端流程，以及顺序模式的行为回归。
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../src/server.js';
import { globalStore } from '../../src/state/store.js';
import type { FastifyInstance } from 'fastify';

const oldStateFile = process.env.TACTICAL_GAME_STATE_FILE;

interface Seat { id: string; token: string }

async function createSimultaneousGame(playerCount: 2 | 3 = 2): Promise<{
  app: FastifyInstance;
  gameId: string;
  hostToken: string;
  seats: Seat[];
}> {
  const app = await buildServer();
  const createRes = await app.inject({
    method: 'POST',
    url: '/api/games',
    payload: { mapId: 'standoff', maxPlayers: playerCount, playerName: 'A' },
  });
  expect(createRes.statusCode).toBe(200);
  const created = createRes.json() as { gameId: string; hostToken: string; player: Seat };
  const seats: Seat[] = [created.player];
  for (let i = 1; i < playerCount; i++) {
    const joinRes = await app.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/join`,
      payload: { name: `P${i}` },
    });
    expect(joinRes.statusCode).toBe(200);
    seats.push((joinRes.json() as { player: Seat }).player);
  }
  const startRes = await app.inject({
    method: 'POST',
    url: `/api/games/${created.gameId}/start`,
    headers: { 'x-host-token': created.hostToken },
  });
  expect(startRes.statusCode).toBe(200);
  return { app, gameId: created.gameId, hostToken: created.hostToken, seats };
}

interface GameStateView {
  turn: { roundNumber: number; currentPlayerId: string | null };
  plan: { queues: Record<string, unknown[]>; committed: string[]; myQueue: unknown[] };
  units: { id: string; owner: string; type: string; q: number; r: number; hp: number }[];
  headquarters: Record<string, { id: string; q: number; r: number }>;
  cells: { q: number; r: number; terrain: string }[];
  config: { mode: string };
}

async function getState(app: FastifyInstance, gameId: string, token: string): Promise<GameStateView> {
  const res = await app.inject({
    method: 'GET',
    url: `/api/games/${gameId}`,
    headers: { 'x-player-token': token },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as GameStateView;
}

function hexDistance(a: { q: number; r: number }, b: { q: number; r: number }): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(-a.q - a.r + b.q + b.r));
}

function emptyNeighbor(state: GameStateView, pos: { q: number; r: number }): { q: number; r: number } | null {
  const dirs = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  const occupied = new Set(state.units.map(u => `${u.q},${u.r}`));
  const hqCells = new Set(Object.values(state.headquarters).map(h => `${h.q},${h.r}`));
  for (const [dq, dr] of dirs) {
    const q = pos.q + dq!;
    const r = pos.r + dr!;
    const cell = state.cells.find(c => c.q === q && c.r === r);
    if (!cell || cell.terrain !== 'plain') continue;
    if (occupied.has(`${q},${r}`) || hqCells.has(`${q},${r}`)) continue;
    return { q, r };
  }
  return null;
}

function firstInfantryNearHq(state: GameStateView, seatId: string): { unitId: string; hq: { id: string; q: number; r: number } } {
  const hq = state.headquarters[seatId]!;
  const unit = state.units.find(u => u.owner === seatId && u.type === 'infantry'
    && hexDistance(u, hq) <= 2)!;
  return { unitId: unit.id, hq };
}

afterEach(() => {
  if (oldStateFile === undefined) delete process.env.TACTICAL_GAME_STATE_FILE;
  else process.env.TACTICAL_GAME_STATE_FILE = oldStateFile;
  for (const id of globalStore.list()) globalStore.delete(id);
});

describe('simultaneous mode API', () => {
  it('creates, starts and exposes the plan state on standoff', async () => {
    const { app, gameId, seats } = await createSimultaneousGame();
    try {
      const state = await getState(app, gameId, seats[0]!.token);
      expect(state.config.mode).toBe('simultaneous');
      expect(state.turn.currentPlayerId).toBeNull();
      expect(state.plan).toEqual({ queues: {}, committed: [], myQueue: [] });
      const lobby = await app.inject({ method: 'GET', url: `/api/games/${gameId}/lobby` });
      expect(lobby.json().mode).toBe('simultaneous');
    } finally {
      await app.close();
    }
  });

  it('queues actions via existing endpoints and echoes the queue', async () => {
    const { app, gameId, seats } = await createSimultaneousGame();
    try {
      // 当前 standoff 出生布局占满总部的所有相邻格（首回合无处部署）：
      // 先花一回合把踩在部署位上的步兵挪开，第二轮再验证 /deploy 的排队与撤回。
      let state = await getState(app, gameId, seats[0]!.token);
      const { unitId } = firstInfantryNearHq(state, seats[0]!.id);
      const mover = state.units.find(u => u.id === unitId)!;
      const moveTarget = emptyNeighbor(state, mover);
      expect(moveTarget).not.toBeNull();
      const move = await app.inject({
        method: 'POST',
        url: `/api/games/${gameId}/move`,
        headers: { 'x-player-token': seats[0]!.token },
        payload: { unitId, q: moveTarget!.q, r: moveTarget!.r },
      });
      expect(move.statusCode).toBe(200);
      for (const seat of seats) {
        const commit = await app.inject({
          method: 'POST',
          url: `/api/games/${gameId}/end-turn`,
          headers: { 'x-player-token': seat.token },
          payload: {},
        });
        expect(commit.statusCode).toBe(200);
      }
      state = await getState(app, gameId, seats[0]!.token);
      expect(state.turn.roundNumber).toBe(2);

      const hq = state.headquarters[seats[0]!.id]!;
      const target = emptyNeighbor(state, hq);
      const deploy = await app.inject({
        method: 'POST',
        url: `/api/games/${gameId}/deploy`,
        headers: { 'x-player-token': seats[0]!.token },
        payload: { unitType: 'infantry', fromId: hq.id, q: target!.q, r: target!.r },
      });
      expect(deploy.statusCode).toBe(200);
      const body = deploy.json();
      expect(body.ok).toBe(true);
      expect(body.queue).toHaveLength(1);
      expect(body.queue[0].type).toBe('deploy');

      // 撤回与清空。
      const revoke = await app.inject({
        method: 'POST',
        url: `/api/games/${gameId}/plan/revoke`,
        headers: { 'x-player-token': seats[0]!.token },
        payload: { actionId: body.queue[0].id },
      });
      expect(revoke.statusCode).toBe(200);
      expect(revoke.json().queue).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('hides other players pending queues but exposes the committed list', async () => {
    const { app, gameId, seats } = await createSimultaneousGame();
    try {
      const stateA = await getState(app, gameId, seats[0]!.token);
      const { unitId } = firstInfantryNearHq(stateA, seats[0]!.id);
      const target = emptyNeighbor(stateA, stateA.units.find(u => u.id === unitId)!);
      expect(target).not.toBeNull();
      const queued = await app.inject({
        method: 'POST',
        url: `/api/games/${gameId}/move`,
        headers: { 'x-player-token': seats[0]!.token },
        payload: { unitId, q: target!.q, r: target!.r },
      });
      expect(queued.statusCode).toBe(200);

      const viewB = await getState(app, gameId, seats[1]!.token);
      expect(viewB.plan.queues).toEqual({});
      expect(viewB.plan.myQueue).toEqual([]);
      const viewA = await getState(app, gameId, seats[0]!.token);
      expect(viewA.plan.myQueue).toHaveLength(1);
      expect(viewA.plan.queues[seats[0]!.id]).toHaveLength(1);
      // 其他玩家的队列内容不可见，committed 名单公开。
      expect(viewA.plan.committed).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('commits via end-turn and auto-resolves when all players committed', async () => {
    const { app, gameId, seats } = await createSimultaneousGame();
    try {
      const stateA = await getState(app, gameId, seats[0]!.token);
      const { unitId } = firstInfantryNearHq(stateA, seats[0]!.id);
      const unit = stateA.units.find(u => u.id === unitId)!;
      const target = emptyNeighbor(stateA, unit);
      const move = await app.inject({
        method: 'POST',
        url: `/api/games/${gameId}/move`,
        headers: { 'x-player-token': seats[0]!.token },
        payload: { unitId, q: target!.q, r: target!.r },
      });
      expect(move.statusCode).toBe(200);

      const commitA = await app.inject({
        method: 'POST',
        url: `/api/games/${gameId}/end-turn`,
        headers: { 'x-player-token': seats[0]!.token },
        payload: {},
      });
      expect(commitA.statusCode).toBe(200);
      expect(commitA.json()).toMatchObject({ ok: true, committed: true, resolved: false });

      // 已确认后继续排队 / 重复确认都会被拒绝。
      const lateMove = await app.inject({
        method: 'POST',
        url: `/api/games/${gameId}/move`,
        headers: { 'x-player-token': seats[0]!.token },
        payload: { unitId, q: unit.q, r: unit.r },
      });
      expect(lateMove.statusCode).toBe(403);
      expect(lateMove.json().code).toBe('not_your_turn');
      const doubleCommit = await app.inject({
        method: 'POST',
        url: `/api/games/${gameId}/end-turn`,
        headers: { 'x-player-token': seats[0]!.token },
        payload: {},
      });
      expect(doubleCommit.statusCode).toBe(409);
      expect(doubleCommit.json().code).toBe('already_committed');

      const commitB = await app.inject({
        method: 'POST',
        url: `/api/games/${gameId}/end-turn`,
        headers: { 'x-player-token': seats[1]!.token },
        payload: {},
      });
      expect(commitB.statusCode).toBe(200);
      expect(commitB.json()).toMatchObject({ committed: true, resolved: true });

      const after = await getState(app, gameId, seats[0]!.token);
      expect(after.turn.roundNumber).toBe(2);
      expect(after.plan).toEqual({ queues: {}, committed: [], myQueue: [] });
      const movedUnit = after.units.find(u => u.id === unitId)!;
      expect(movedUnit.q).toBe(target!.q);
      expect(movedUnit.r).toBe(target!.r);

      const eventsRes = await app.inject({ method: 'GET', url: `/api/games/${gameId}/events` });
      const types = (eventsRes.json().events as { type: string }[]).map(e => e.type);
      expect(types.filter(t => t === 'plan_committed')).toHaveLength(2);
      expect(types).toContain('move');
      expect(types).toContain('round_end');
      expect(types).toContain('round_resolved');
      expect(types).toContain('round_start');
      expect(types).toContain('income');
    } finally {
      await app.close();
    }
  });

  it('resolves cell attacks that miss with hit:false events', async () => {
    const { app, gameId, seats } = await createSimultaneousGame();
    try {
      const stateA = await getState(app, gameId, seats[0]!.token);
      const { unitId } = firstInfantryNearHq(stateA, seats[0]!.id);
      const unit = stateA.units.find(u => u.id === unitId)!;
      const target = emptyNeighbor(stateA, unit);
      const attack = await app.inject({
        method: 'POST',
        url: `/api/games/${gameId}/attack`,
        headers: { 'x-player-token': seats[0]!.token },
        // simultaneous 模式攻击指定格子，不需要 targetId。
        payload: { attackerId: unitId, q: target!.q, r: target!.r },
      });
      expect(attack.statusCode).toBe(200);
      for (const seat of seats) {
        const commit = await app.inject({
          method: 'POST',
          url: `/api/games/${gameId}/end-turn`,
          headers: { 'x-player-token': seat.token },
          payload: {},
        });
        expect(commit.statusCode).toBe(200);
      }
      const eventsRes = await app.inject({ method: 'GET', url: `/api/games/${gameId}/events` });
      const attackEvents = (eventsRes.json().events as { type: string; payload: Record<string, unknown> }[])
        .filter(e => e.type === 'attack');
      expect(attackEvents).toHaveLength(1);
      expect(attackEvents[0]!.payload.hit).toBe(false);
      expect(attackEvents[0]!.payload.actualDamage).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('lets the host force-resolve a stuck planning round', async () => {
    const { app, gameId, seats, hostToken } = await createSimultaneousGame();
    try {
      const forced = await app.inject({
        method: 'POST',
        url: `/api/games/${gameId}/host/force-resolve`,
        headers: { 'x-host-token': hostToken },
      });
      expect(forced.statusCode).toBe(200);
      expect(forced.json()).toMatchObject({ ok: true, resolved: true });
      const state = await getState(app, gameId, seats[0]!.token);
      expect(state.turn.roundNumber).toBe(2);
      expect(state.plan.committed).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('supports the three-player layout end to end', async () => {
    const { app, gameId, seats } = await createSimultaneousGame(3);
    try {
      for (const seat of seats) {
        const commit = await app.inject({
          method: 'POST',
          url: `/api/games/${gameId}/end-turn`,
          headers: { 'x-player-token': seat.token },
          payload: {},
        });
        expect(commit.json().committed).toBe(true);
      }
      const state = await getState(app, gameId, seats[0]!.token);
      expect(state.turn.roundNumber).toBe(2);
      const incomeCount = (await app.inject({ method: 'GET', url: `/api/games/${gameId}/events` }))
        .json().events.filter((e: { type: string }) => e.type === 'income');
      expect(incomeCount).toHaveLength(3);
    } finally {
      await app.close();
    }
  });

  it('persists pending plan queues and mode across a server restart', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'tg-simul-persist-'));
    process.env.TACTICAL_GAME_STATE_FILE = join(tempDir, 'games.json');
    try {
      const { app, gameId, seats } = await createSimultaneousGame();
      const stateA = await getState(app, gameId, seats[0]!.token);
      const { unitId } = firstInfantryNearHq(stateA, seats[0]!.id);
      const target = emptyNeighbor(stateA, stateA.units.find(u => u.id === unitId)!);
      await app.inject({
        method: 'POST',
        url: `/api/games/${gameId}/move`,
        headers: { 'x-player-token': seats[0]!.token },
        payload: { unitId, q: target!.q, r: target!.r },
      });
      await app.inject({
        method: 'POST',
        url: `/api/games/${gameId}/end-turn`,
        headers: { 'x-player-token': seats[0]!.token },
        payload: {},
      });
      await app.close();

      const persisted = JSON.parse(readFileSync(process.env.TACTICAL_GAME_STATE_FILE!, 'utf8')) as { games: any[] };
      const saved = persisted.games.find(g => g.id === gameId);
      expect(saved.config.mode).toBe('simultaneous');
      expect(saved.plan.committed).toHaveLength(1);
      expect(saved.plan.queues[seats[0]!.id]).toHaveLength(1);

      const restoredApp = await buildServer();
      try {
        const view = await getState(restoredApp, gameId, seats[0]!.token);
        expect(view.plan.myQueue).toHaveLength(1);
        expect(view.plan.committed).toEqual([seats[0]!.id]);
        // 重启后其余玩家确认仍可触发结算。
        const commitB = await restoredApp.inject({
          method: 'POST',
          url: `/api/games/${gameId}/end-turn`,
          headers: { 'x-player-token': seats[1]!.token },
          payload: {},
        });
        expect(commitB.json()).toMatchObject({ resolved: true });
        const after = await getState(restoredApp, gameId, seats[0]!.token);
        expect(after.turn.roundNumber).toBe(2);
        expect(after.units.find(u => u.id === unitId)!.q).toBe(target!.q);
      } finally {
        await restoredApp.close();
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('sequential mode regression', () => {
  it('keeps attack targetId semantics and rejects plan endpoints on standard maps', async () => {
    const app = await buildServer();
    try {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/games',
        payload: { mapId: 'default', maxPlayers: 2, playerName: 'A' },
      });
      const created = createRes.json() as { gameId: string; hostToken: string; player: Seat };
      const joinRes = await app.inject({
        method: 'POST',
        url: `/api/games/${created.gameId}/join`,
        payload: { name: 'B' },
      });
      const joined = joinRes.json() as { player: Seat };
      await app.inject({
        method: 'POST',
        url: `/api/games/${created.gameId}/start`,
        headers: { 'x-host-token': created.hostToken },
      });
      const gameId = created.gameId;

      // 顺序模式 attack 仍要求 targetId；q/r 形态应被拒绝。
      // 开局先手是随机的，用实际当前玩家的座位发起请求。
      const state = await getState(app, gameId, created.player.token);
      const current = state.turn.currentPlayerId ?? state.turn.currentOwner;
      const attackerToken = current === created.player.id ? created.player.token : joined.player.token;
      const unitId = state.units.find(u => u.owner === current)!.id;
      const badAttack = await app.inject({
        method: 'POST',
        url: `/api/games/${gameId}/attack`,
        headers: { 'x-player-token': attackerToken },
        payload: { attackerId: unitId, q: 0, r: 0 },
      });
      expect(badAttack.statusCode).toBe(400);

      const revoke = await app.inject({
        method: 'POST',
        url: `/api/games/${gameId}/plan/revoke`,
        headers: { 'x-player-token': created.player.token },
        payload: { actionId: 'whatever' },
      });
      expect(revoke.statusCode).toBe(400);
      expect(revoke.json().code).toBe('not_simultaneous_game');

      const forceResolve = await app.inject({
        method: 'POST',
        url: `/api/games/${gameId}/host/force-resolve`,
        headers: { 'x-host-token': created.hostToken },
      });
      expect(forceResolve.statusCode).toBe(400);
      expect(forceResolve.json().code).toBe('not_simultaneous_game');
      void joined;
    } finally {
      await app.close();
    }
  });
});
