import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { startTestServer } from '../helpers.js';

const runner = await import('../../script/pi-match-runner.mjs');

describe('pi match runner helpers', () => {
  it('parses shorthand model flags and defaults', () => {
    const args = runner.parseArgs([
      '--url', 'http://127.0.0.1:3100/',
      '--a-model', 'openai/gpt-4o',
      '--b-provider', 'deepseek',
      '--b-model', 'deepseek-chat',
      '--a-name', 'GPT',
      '--b-name', 'DeepSeek',
    ]);

    expect(args.url).toBe('http://127.0.0.1:3100');
    expect(args.map).toBe('default');
    expect(args.aModel).toBe('openai/gpt-4o');
    expect(args.bProvider).toBe('deepseek');
    expect(args.bModel).toBe('deepseek-chat');
    expect(args.aName).toBe('GPT');
    expect(args.bName).toBe('DeepSeek');
    expect(args.maxCallsPerTurn).toBe(3);
  });

  it('builds deterministic restart-safe session ids', () => {
    expect(runner.defaultSessionId('game_123', 'player_a')).toBe('hexv2-game_123-player_a');
    expect(runner.defaultSessionId('game_123', 'player_b')).toBe('hexv2-game_123-player_b');
  });

  it('rejects resume without both tokens', () => {
    expect(() => runner.parseArgs(['--game', 'g1', '--a-token', 'ta'])).toThrow('--game resume requires --a-token and --b-token');
  });
});

describe('pi command and messages', () => {
  it('constructs shorthand pi commands with persistent session ids', () => {
    const args = runner.parseArgs([
      '--a-provider', 'openai',
      '--a-model', 'gpt-4o',
      '--session-dir', '.pi-match-sessions',
    ]);
    const command = runner.buildPiCommand(args, 'player_a', 'game_123', '到你了');

    expect(command.command).toBe('pi');
    expect(command.args).toEqual([
      '--provider', 'openai',
      '--model', 'gpt-4o',
      '--session-dir', '.pi-match-sessions',
      '--session-id', 'hexv2-game_123-player_a',
      '-p',
      '到你了',
    ]);
  });

  it('uses explicit session ids when provided', () => {
    const args = runner.parseArgs(['--a-session-id', 'manual-a']);
    const command = runner.buildPiCommand(args, 'player_a', 'game_123', '到你了');
    expect(command.args).toContain('manual-a');
  });

  it('builds first prompt with token and short trigger contract', () => {
    const prompt = runner.buildFirstPrompt({
      baseUrl: 'http://127.0.0.1:3100',
      gameId: 'game_123',
      player: 'player_b',
      token: 'secret-token',
    });

    expect(prompt).toContain('game_123');
    expect(prompt).toContain('player_b');
    expect(prompt).toContain('secret-token');
    expect(prompt).toContain('X-Player-Token');
    expect(prompt).toContain('到你了');
    expect(prompt).toContain('继续');
    expect(prompt).toContain('/api/games/:id/end-turn');
    expect(prompt).toContain('不要使用 V1');
  });

  it('chooses the correct message for first, normal, and continuation calls', () => {
    const first = runner.messageForCall({ firstCall: true, continuation: false, firstPrompt: 'FULL' });
    const next = runner.messageForCall({ firstCall: false, continuation: false, firstPrompt: 'FULL' });
    const cont = runner.messageForCall({ firstCall: false, continuation: true, firstPrompt: 'FULL' });

    expect(first).toBe('FULL');
    expect(next).toBe('到你了');
    expect(cont).toBe('继续');
  });
});

describe('pi match runner smoke', () => {
  it('keeps invoking persistent player commands until the max round limit', async () => {
    const app = await startTestServer();
    await app.listen({ port: 0, host: '127.0.0.1' });
    try {
      const address = app.server.address();
      if (!address || typeof address === 'string') throw new Error('server did not bind');
      const dir = join(tmpdir(), `pi-runner-${Date.now()}`);
      await mkdir(dir, { recursive: true });
      const stub = join(dir, 'stub-pi.mjs');
      await writeFile(stub, `
const prompt = process.argv.at(-1);
const url = prompt.match(/API base URL: (.*)/)?.[1] || process.env.BASE_URL;
const gameId = prompt.match(/gameId: (.*)/)?.[1] || process.env.GAME_ID;
const token = prompt.match(/X-Player-Token: (.*)/)?.[1] || process.env.PLAYER_TOKEN;
if (prompt.includes('到你了') || prompt.includes('继续') || prompt.includes('连接信息')) {
  await fetch(url + '/api/games/' + gameId + '/end-turn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Player-Token': token },
    body: '{}',
  });
}
`, 'utf8');
      if (process.platform !== 'win32') await chmod(stub, 0o755);

      const baseUrl = `http://127.0.0.1:${address.port}`;
      const result = await runner.runMain([
        '--url', baseUrl,
        '--a-pi', `"${process.execPath}" "${stub}"`,
        '--b-pi', `"${process.execPath}" "${stub}"`,
        '--max-rounds', '1',
        '--delay-ms', '1',
        '--log-dir', join(dir, 'logs'),
      ]);

      expect(result.reason).toBe('max_rounds');
      expect(result.gameId).toBeTruthy();
      expect(result.turnsPlayed.player_a).toBe(1);
      expect(result.turnsPlayed.player_b).toBe(1);
    } finally {
      await app.close();
    }
  }, 15000);
});
