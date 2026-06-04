// tests/api/smoke.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { startTestServer, createGameAndJoin } from '../helpers.js';
import type { FastifyInstance } from 'fastify';
import { globalStore } from '../../src/state/store.js';

describe('End-to-end gameplay', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    for (const id of globalStore.list()) globalStore.delete(id);
    app = await startTestServer();
  });

  it('plays out a complete game ending in victory', async () => {
    const { gameId, tokenA, tokenB } = await createGameAndJoin(app);
    const game = globalStore.get(gameId)!;
    const hqB = game.buildings.find(b => b.owner === 'player_b')!;

    game.units.push({
      id: 'champion', owner: 'player_a', type: 'tank',
      x: hqB.x - 1, y: hqB.y, hp: 150, maxHp: 150, attack: 25, defense: 15,
      moveRange: 2, attackRange: 1, alive: true, hasMoved: false, hasAttacked: false,
    });

    hqB.hp = 30;

    const atkRes = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/attack`,
      headers: { 'x-player-token': tokenA },
      payload: { attackerId: 'champion', targetId: hqB.id },
    });
    expect(atkRes.statusCode).toBe(200);

    let safety = 0;
    while (hqB.alive && safety++ < 10) {
      await app.inject({
        method: 'POST', url: `/api/games/${gameId}/end-turn`,
        headers: { 'x-player-token': tokenA },
      });
      await app.inject({
        method: 'POST', url: `/api/games/${gameId}/end-turn`,
        headers: { 'x-player-token': tokenB },
      });
      await app.inject({
        method: 'POST', url: `/api/games/${gameId}/attack`,
        headers: { 'x-player-token': tokenA },
        payload: { attackerId: 'champion', targetId: hqB.id },
      });
    }

    expect(hqB.alive).toBe(false);
    expect(game.phase).toBe('game_over');
    expect(game.winner).toBe('player_a');
    expect(game.events.some(e => e.type === 'game_over')).toBe(true);
  });

  it('full economic loop: build miner, end turn, collect gold, produce unit', async () => {
    const { gameId, tokenA, tokenB } = await createGameAndJoin(app);
    const game = globalStore.get(gameId)!;
    const hqA = game.buildings.find(b => b.owner === 'player_a')!;

    hqA.x = 10; hqA.y = 14;

    const buildRes = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/build`,
      headers: { 'x-player-token': tokenA },
      payload: { type: 'miner', x: 10, y: 15 },
    });
    expect(buildRes.statusCode).toBe(200);
    expect(game.resources.player_a.gold).toBe(70);

    await app.inject({
      method: 'POST', url: `/api/games/${gameId}/end-turn`,
      headers: { 'x-player-token': tokenA },
    });
    await app.inject({
      method: 'POST', url: `/api/games/${gameId}/end-turn`,
      headers: { 'x-player-token': tokenB },
    });

    expect(game.resources.player_a.gold).toBe(85);

    const produceRes = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/produce`,
      headers: { 'x-player-token': tokenA },
      payload: { buildingId: hqA.id, unitType: 'infantry' },
    });
    expect(produceRes.statusCode).toBe(200);
    expect(game.resources.player_a.gold).toBe(45);

    await app.inject({
      method: 'POST', url: `/api/games/${gameId}/end-turn`,
      headers: { 'x-player-token': tokenA },
    });
    expect(game.units.some(u => u.owner === 'player_a' && u.type === 'infantry')).toBe(true);
  });
});
