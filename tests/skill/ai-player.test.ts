import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { createGameAndJoin, startTestServer } from '../helpers.js';
import { globalStore } from '../../src/state/store.js';

function runAi(args: string[]): Promise<{ code: number | null; output: string }> {
  const { promise, resolve } = Promise.withResolvers<{ code: number | null; output: string }>();
  const child = spawn(process.execPath, ['skill/ai-player.mjs', ...args], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', data => { output += data.toString(); });
  child.stderr.on('data', data => { output += data.toString(); });
  child.on('exit', code => resolve({ code, output }));
  return promise;
}

describe('AI player setup', () => {
  it('reports the original join failure instead of continuing without a token', async () => {
    const app = await startTestServer();
    await app.listen({ port: 0, host: '127.0.0.1' });
    try {
      const address = app.server.address();
      if (!address || typeof address === 'string') throw new Error('server did not bind to a TCP port');

      const createRes = await app.inject({ method: 'POST', url: '/api/games' });
      const { gameId } = createRes.json() as { gameId: string };
      await app.inject({ method: 'POST', url: `/api/games/${gameId}/join` });

      const result = await runAi([
        '--url', `http://127.0.0.1:${address.port}`,
        '--side', 'b',
        '--game', gameId,
      ]);

      expect(result.code).toBe(1);
      expect(result.output).toContain('Failed to join game');
      expect(result.output).toContain('game_already_full');
      expect(result.output).not.toContain('missing token');
      expect(result.output).not.toContain('Cannot read properties');
    } finally {
      await app.close();
    }
  });

  it('rejects joining when the server assigns a different player id than requested', async () => {
    const app = await startTestServer();
    await app.listen({ port: 0, host: '127.0.0.1' });
    try {
      const address = app.server.address();
      if (!address || typeof address === 'string') throw new Error('server did not bind to a TCP port');

      const createRes = await app.inject({ method: 'POST', url: '/api/games' });
      const { gameId } = createRes.json() as { gameId: string };

      const result = await runAi([
        '--url', `http://127.0.0.1:${address.port}`,
        '--side', 'a',
        '--game', gameId,
      ]);

      expect(result.code).toBe(1);
      expect(result.output).toContain('joined as player_b, expected player_a');
    } finally {
      await app.close();
    }
  });

  it('exits when an existing seat token is invalid', async () => {
    const app = await startTestServer();
    await app.listen({ port: 0, host: '127.0.0.1' });
    try {
      const address = app.server.address();
      if (!address || typeof address === 'string') throw new Error('server did not bind to a TCP port');
      const createRes = await app.inject({ method: 'POST', url: '/api/games' });
      const { gameId } = createRes.json() as { gameId: string };

      const result = await runAi([
        '--url', `http://127.0.0.1:${address.port}`,
        '--side', 'a',
        '--game', gameId,
        '--token', 'invalid-token',
        '--once',
        '--delay-ms', '0',
      ]);

      expect(result.code).toBe(1);
      expect(result.output).toContain('GET');
      expect(result.output).toContain('invalid_token');
    } finally {
      await app.close();
    }
  });

  it('does not use host controls to force another player to lose a turn', async () => {
    const source = await readFile('skill/ai-player.mjs', 'utf8');
    expect(source).not.toContain('/host/skip-turn');
  });

  it('auto-starts a full lobby when the host seat holds a host token', async () => {
    const app = await startTestServer();
    await app.listen({ port: 0, host: '127.0.0.1' });
    try {
      const address = app.server.address();
      if (!address || typeof address === 'string') throw new Error('server did not bind to a TCP port');
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/games',
        payload: { mapId: 'default', maxPlayers: 2, playerName: 'AI-A' },
      });
      const created = createRes.json() as {
        gameId: string;
        hostToken: string;
        player: { id: string; token: string };
      };
      await app.inject({
        method: 'POST',
        url: `/api/games/${created.gameId}/join`,
        payload: { name: 'AI-B' },
      });

      // 固定 player_a 为先手，测试不依赖房主跳过其他玩家回合。
      const random = vi.spyOn(Math, 'random')
        .mockReturnValueOnce(0.999)
        .mockReturnValueOnce(0)
        .mockReturnValue(0);
      const result = await runAi([
        '--url', baseUrl,
        '--side', 'a',
        '--game', created.gameId,
        '--token', created.player.token,
        '--host-token', created.hostToken,
        '--once',
        '--delay-ms', '0',
        '--max-turns', '1',
      ]);
      random.mockRestore();

      expect(result.code).toBe(0);
      expect(result.output).toContain(`Started game ${created.gameId}`);
      expect(result.output).toMatch(/End turn|Game over/);
      const game = globalStore.get(created.gameId)!;
      expect(game.phase).not.toBe('lobby');
      expect(game.events.some(event => event.type === 'turn_skipped')).toBe(false);
    } finally {
      vi.restoreAllMocks();
      await app.close();
    }
  });
});

describe('AI player skill documentation', () => {
  it('teaches manual turn reasoning instead of delegating play to the script', async () => {
    const skill = await readFile('skill/SKILL.md', 'utf8');

    expect(skill).toContain('## Manual Turn Loop');
    expect(skill).toContain('Do not run `node skill/ai-player.mjs` to delegate the turn');
    expect(skill).toContain('Read the current game state before choosing each action');
    expect(skill).toContain('Explain the chosen legal action briefly, then call the matching REST endpoint');
    expect(skill).toContain('Refresh state after every successful action and reason again');
    expect(skill).toContain('End the turn only after available useful legal actions are exhausted');
  });

  it('is written for general agents instead of a Codex-specific client', async () => {
    const skill = await readFile('skill/SKILL.md', 'utf8');

    expect(skill).toContain('description: Use when an agent is asked');
    expect(skill).not.toMatch(/\bCodex\b/);
  });

  it('documents multiplayer lobby flow and host/player separation', async () => {
    const skill = await readFile('skill/SKILL.md', 'utf8');

    expect(skill).toContain('3.0.2');
    expect(skill).toContain('## Multiplayer Setup');
    expect(skill).toContain('player_a');
    expect(skill).toContain('player_h');
    expect(skill).toContain('maxPlayers');
    expect(skill).toContain('hostToken');
    expect(skill).toContain('X-Host-Token');
    expect(skill).toContain('POST /api/games/:id/start');
    expect(skill).toContain('GET /api/games/:id/lobby');
    expect(skill).toContain('POST /api/games/:id/leave');
    expect(skill).toContain('last_player_standing');
    expect(skill).toContain('multiplayer-ring');
    expect(skill).toContain('Never hardcode a single rival as `player_b`');
    expect(skill).not.toContain('Score only against living rivals');
  });

  it('explains typed control point strategy', async () => {
    const skill = await readFile('skill/SKILL.md', 'utf8');

    expect(skill).toContain('Typed control points');
    expect(skill).toContain('supply');
    expect(skill).toContain('forward_base');
    expect(skill).toContain('repair');
  });

  it('documents heavy terrain demolition controls and constraints', async () => {
    const skill = await readFile('skill/SKILL.md', 'utf8');

    expect(skill).toContain('POST /api/games/:id/demolish');
    expect(skill).toContain('{ "unitId": "...", "q": 0, "r": 0 }');
    expect(skill).toContain('Only heavy units can demolish terrain');
    expect(skill).toContain('adjacent blocker');
    expect(skill).toContain('demolish');
    expect(skill).toContain('action point');
  });
});

describe('AI player strategy', () => {
  it('deploys strategically before ordinary movement when supplies and actions remain', async () => {
    const app = await startTestServer();
    try {
      const { gameId } = await createGameAndJoin(app);
      const game = globalStore.get(gameId)! as any;
      game.resources.player_a.supplies = 120;

      const ai = await import('../../skill/ai-player.mjs');

      expect(ai.shouldStrategicDeploy(game, 'player_a')).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('targets the enemy headquarters in endgame push mode after turn 8 with three control points', async () => {
    const app = await startTestServer();
    const { gameId } = await createGameAndJoin(app);
    const game = globalStore.get(gameId)! as any;
    game.turn.turnNumber = 8;
    game.controlPoints[0].owner = 'player_a';
    game.controlPoints[1].owner = 'player_a';
    game.controlPoints[2].owner = 'player_a';
    const scout = game.units.find((u: any) => u.owner === 'player_a' && u.type === 'scout');

    const ai = await import('../../skill/ai-player.mjs');
    const goal = ai.movementGoal(game, 'player_a', scout);

    expect(goal.id).toBe(game.headquarters.player_b.id);
    await app.close();
  });

  it('moves damaged units toward owned repair points on typed maps', async () => {
    const app = await startTestServer();
    try {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/games',
        payload: { mapId: 'dual-lanes', playerName: 'A' },
      });
      const created = createRes.json() as { gameId: string; hostToken: string };
      const { gameId } = created;
      await app.inject({ method: 'POST', url: `/api/games/${gameId}/join`, payload: { name: 'B' } });
      await app.inject({
        method: 'POST',
        url: `/api/games/${gameId}/start`,
        headers: { 'X-Host-Token': created.hostToken },
      });
      const game = globalStore.get(gameId)! as any;
      const repair = game.controlPoints.find((point: any) => point.id === 'cp_nc');
      repair.owner = 'player_a';
      const damaged = {
        id: 'damaged',
        owner: 'player_a',
        type: 'infantry',
        q: -2,
        r: -4,
        hp: 40,
        maxHp: 100,
        attack: 30,
        defense: 8,
        moveRange: 3,
        attackRange: 1,
        cost: 45,
        alive: true,
        hasMoved: false,
        hasActed: false,
        actionSpent: false,
        canCapture: true,
      };
      game.units.push(damaged);

      const ai = await import('../../skill/ai-player.mjs');
      const goal = ai.movementGoal(game, 'player_a', damaged);

      expect(goal.id).toBe('cp_nc');
    } finally {
      await app.close();
    }
  });
});
