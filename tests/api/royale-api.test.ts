// tests/api/royale-api.test.ts
// royale 模式（terminus 地图）的 HTTP 端到端流程：计划入队 → 全员确认同时结算，
// 轮界炮火收缩事件随事件流下发。
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../src/server.js';
import { globalStore } from '../../src/state/store.js';
import type { FastifyInstance } from 'fastify';

const oldStateFile = process.env.TACTICAL_GAME_STATE_FILE;

interface Seat { id: string; token: string }

async function createRoyaleGame(playerCount = 2): Promise<{
  app: FastifyInstance;
  gameId: string;
  hostToken: string;
  seats: Seat[];
}> {
  const app = await buildServer();
  const createRes = await app.inject({
    method: 'POST',
    url: '/api/games',
    payload: { mapId: 'terminus', maxPlayers: playerCount, playerName: 'A' },
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
  headquarters: Record<string, unknown>;
  config: { mode: string };
  artillery: { safeRadius: number; dangerCells: { q: number; r: number }[]; nextShrinkRound: number | null } | null;
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

async function commitAll(app: FastifyInstance, gameId: string, seats: Seat[]): Promise<void> {
  for (const seat of seats) {
    const res = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/end-turn`,
      headers: { 'x-player-token': seat.token },
    });
    expect(res.statusCode).toBe(200);
  }
}

async function listEvents(app: FastifyInstance, gameId: string): Promise<{ type: string; roundNumber?: number; payload?: Record<string, unknown> }[]> {
  const res = await app.inject({
    method: 'GET',
    url: `/api/games/${gameId}/events`,
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { events: { type: string; roundNumber?: number; payload?: Record<string, unknown> }[] }).events;
}

afterEach(() => {
  if (oldStateFile === undefined) delete process.env.TACTICAL_GAME_STATE_FILE;
  else process.env.TACTICAL_GAME_STATE_FILE = oldStateFile;
  for (const id of globalStore.list()) globalStore.delete(id);
});

describe('royale mode API', () => {
  it('creates and starts a terminus game with plan state and no headquarters', async () => {
    const { app, gameId, seats } = await createRoyaleGame();
    try {
      const state = await getState(app, gameId, seats[0]!.token);
      expect(state.config.mode).toBe('royale');
      expect(state.turn.currentPlayerId).toBeNull();
      expect(state.plan).toEqual({ queues: {}, committed: [], myQueue: [] });
      expect(state.headquarters).toEqual({});
      expect(state.artillery).toMatchObject({ safeRadius: 7, nextShrinkRound: 6 });

      const lobby = await app.inject({ method: 'GET', url: `/api/games/${gameId}/lobby` });
      expect(lobby.json().mode).toBe('royale');
    } finally {
      await app.close();
    }
  });

  it('queues plan actions, resolves simultaneously on full commit and advances the round', async () => {
    const { app, gameId, seats } = await createRoyaleGame();
    try {
      const state = await getState(app, gameId, seats[0]!.token);
      const unit = state.units.find(candidate => candidate.owner === seats[0]!.id)!;
      const dirs = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
      const occupied = new Set(state.units.map(candidate => `${candidate.q},${candidate.r}`));
      const target = dirs
        .map(([dq, dr]) => ({ q: unit.q + dq!, r: unit.r + dr! }))
        .find(pos => !occupied.has(`${pos.q},${pos.r}`))!;

      const moveRes = await app.inject({
        method: 'POST',
        url: `/api/games/${gameId}/move`,
        headers: { 'x-player-token': seats[0]!.token },
        payload: { unitId: unit.id, q: target.q, r: target.r },
      });
      expect(moveRes.statusCode).toBe(200);
      expect(moveRes.json()).toMatchObject({ ok: true, queued: expect.objectContaining({ type: 'move' }) });

      const afterQueue = await getState(app, gameId, seats[0]!.token);
      expect(afterQueue.plan.myQueue).toHaveLength(1);

      await commitAll(app, gameId, seats);

      const resolved = await getState(app, gameId, seats[0]!.token);
      expect(resolved.turn.roundNumber).toBe(2);
      expect(resolved.plan.committed).toEqual([]);
      const moved = resolved.units.find(candidate => candidate.id === unit.id)!;
      expect(moved.q).toBe(target.q);
      expect(moved.r).toBe(target.r);
    } finally {
      await app.close();
    }
  });

  it('rejects plan actions after the player has committed for the round', async () => {
    const { app, gameId, seats } = await createRoyaleGame();
    try {
      const state = await getState(app, gameId, seats[0]!.token);
      const unit = state.units.find(candidate => candidate.owner === seats[0]!.id)!;
      const commitRes = await app.inject({
        method: 'POST',
        url: `/api/games/${gameId}/end-turn`,
        headers: { 'x-player-token': seats[0]!.token },
      });
      expect(commitRes.statusCode).toBe(200);

      const moveRes = await app.inject({
        method: 'POST',
        url: `/api/games/${gameId}/move`,
        headers: { 'x-player-token': seats[0]!.token },
        payload: { unitId: unit.id, q: unit.q, r: unit.r + 1 },
      });
      expect(moveRes.statusCode).toBe(403);
      expect(moveRes.json()).toMatchObject({ code: 'not_your_turn' });
    } finally {
      await app.close();
    }
  });

  it('emits artillery warning and shrink events on the shared event feed', async () => {
    const { app, gameId, seats } = await createRoyaleGame();
    try {
      // 每轮全员 commit 推进一回合：5 次后进入第 6 回合（首次缩圈 + 伤害）。
      for (let round = 1; round <= 5; round += 1) {
        const before = await getState(app, gameId, seats[0]!.token);
        expect(before.turn.roundNumber).toBe(round);
        await commitAll(app, gameId, seats);
      }

      const state = await getState(app, gameId, seats[0]!.token);
      expect(state.turn.roundNumber).toBeGreaterThanOrEqual(6);
      expect(state.artillery).toMatchObject({ safeRadius: 6 });

      const events = await listEvents(app, gameId);
      const warning = events.find(event => event.type === 'artillery_warning');
      const shrunk = events.find(event => event.type === 'artillery_shrunk');
      expect(warning).toBeDefined();
      expect(shrunk).toBeDefined();
      expect(events.some(event => event.type === 'artillery_damage')).toBe(true);
      expect(events.some(event => event.type === 'round_resolved')).toBe(true);
    } finally {
      await app.close();
    }
  });
});
