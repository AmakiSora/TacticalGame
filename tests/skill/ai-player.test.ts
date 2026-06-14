import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { startTestServer } from '../helpers.js';

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
