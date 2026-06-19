import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { startTestServer } from '../helpers.js';
import { globalStore } from '../../src/state/store.js';

function runAi(args: string[]): Promise<{ code: number | null; output: string }> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['skill/ai-player.mjs', ...args], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', data => { output += data.toString(); });
    child.stderr.on('data', data => { output += data.toString(); });
    child.on('exit', code => resolve({ code, output }));
  });
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

  it('requires a token when connecting player A to an existing game', async () => {
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
      expect(result.output).toContain('--game without --token can only join as --side b');
    } finally {
      await app.close();
    }
  });
});

describe('AI player skill documentation', () => {
  it('requires polling for future owned turns instead of waiting for human reminders', async () => {
    const skill = await readFile('skill/SKILL.md', 'utf8');

    expect(skill).toContain('## Mandatory Turn Loop');
    expect(skill).toContain('Do not stop after ending one owned turn');
    expect(skill).toContain('If `game.turn.currentOwner !== your owner`, sleep briefly and poll again');
    expect(skill).toContain('Do not ask the human to say "your turn"');
    expect(skill).toContain('After `POST /end-turn`, the correct next action is polling');
    expect(skill).toContain('Only use `--once` when the user explicitly asks to play exactly one turn');
  });
});

describe('AI player strategy', () => {
  it('deploys strategically before ordinary movement when supplies and actions remain', async () => {
    const app = await startTestServer();
    const { gameId } = (await app.inject({ method: 'POST', url: '/api/games' })).json() as { gameId: string };
    await app.inject({ method: 'POST', url: `/api/games/${gameId}/join` });
    const game = globalStore.get(gameId)! as any;
    game.resources.player_a.supplies = 120;

    const ai = await import('../../skill/ai-player.mjs');

    expect(ai.shouldStrategicDeploy(game, 'player_a')).toBe(true);
  });

  it('targets the enemy headquarters in endgame push mode after turn 8 with three control points', async () => {
    const app = await startTestServer();
    const { gameId } = (await app.inject({ method: 'POST', url: '/api/games' })).json() as { gameId: string };
    await app.inject({ method: 'POST', url: `/api/games/${gameId}/join` });
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
});
