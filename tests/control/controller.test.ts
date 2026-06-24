import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AutoControlController, parseCommandLine, resolveCommandInvocation } from '../../src/control/controller.js';
import type { GameEvent } from '../../src/types.js';
import { globalStore } from '../../src/state/store.js';

function tempRuntime(): string {
  return mkdtempSync(join(tmpdir(), 'auto-control-'));
}

function cleanup(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

describe('auto-control command parsing', () => {
  it('parses quoted command lines without using a shell', () => {
    expect(parseCommandLine('pi --provider "new-api" -p "hello world"')).toEqual({
      command: 'pi',
      args: ['--provider', 'new-api', '-p', 'hello world'],
    });
  });

  it('keeps Windows path backslashes in quoted arguments', () => {
    expect(parseCommandLine('pi --session "C:\\Users\\A\\.pi\\session.jsonl"').args).toEqual([
      '--session',
      'C:\\Users\\A\\.pi\\session.jsonl',
    ]);
  });

  it('resolves pi invocations to the node CLI when an npm install path is available', () => {
    const resolved = resolveCommandInvocation(
      { command: 'pi', args: ['-p', 'go'] },
      'C:/Users/A/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent/dist/cli.js',
    );

    expect(resolved.command).toBe(process.execPath);
    expect(resolved.args.at(-1)).toBe('go');
  });
});

describe('AutoControlController', () => {
  it('persists config and reloads it for a new controller', async () => {
    const runtimeDir = tempRuntime();
    try {
      const controller = new AutoControlController({ runtimeDir });
      await controller.updateConfig({ gameId: 'game-1', players: { player_a: { model: 'm-a' } } });

      const restored = new AutoControlController({ runtimeDir });
      expect(restored.getConfig().gameId).toBe('game-1');
      expect(restored.getConfig().players.player_a.model).toBe('m-a');
    } finally {
      cleanup(runtimeDir);
    }
  });

  it('bootstraps by creating the game server-side and sending role prompts with tokens', async () => {
    const runtimeDir = tempRuntime();
    const calls: { command: string; args: string[] }[] = [];
    try {
      for (const id of globalStore.list()) globalStore.delete(id);
      const controller = new AutoControlController({
        runtimeDir,
        runner: async invocation => {
          calls.push(invocation);
          return { code: 0, output: '' };
        },
      });
      await controller.updateConfig({
        bootstrap: true,
        players: {
          player_a: { session: 'a.jsonl', name: 'A Bot', startPrompt: 'you are {side} {gameId} {token}', prompt: 'go-a' },
          player_b: { session: 'b.jsonl', name: 'B Bot', startPrompt: 'you are {side} {gameId} {token}' },
        },
      });

      const result = await controller.start();
      const game = globalStore.get(result.gameId!)!;

      expect(game.playerNames).toEqual({ player_a: 'A Bot', player_b: 'B Bot' });
      expect(calls).toHaveLength(2);
      expect(calls[0].args.at(-1)).toContain(`you are player_a ${result.gameId} ${game.tokens.player_a}`);
      expect(calls[1].args.at(-1)).toContain(`you are player_b ${result.gameId} ${game.tokens.player_b}`);
      expect(controller.getStatus().status).toBe('running');
    } finally {
      cleanup(runtimeDir);
    }
  });

  it('does not allow starting while already running', async () => {
    const runtimeDir = tempRuntime();
    try {
      const controller = new AutoControlController({
        runtimeDir,
        runner: async () => ({ code: 0, output: '' }),
      });
      await controller.updateConfig({ gameId: 'game-1', bootstrap: false });
      await controller.start();

      await expect(controller.start()).rejects.toThrow('already running');
    } finally {
      cleanup(runtimeDir);
    }
  });

  it('does not auto-trigger while paused, then triggers after resume', async () => {
    const runtimeDir = tempRuntime();
    const calls: string[] = [];
    try {
      const controller = new AutoControlController({
        runtimeDir,
        runner: async invocation => {
          calls.push(String(invocation.args.at(-1)));
          return { code: 0, output: '' };
        },
      });
      await controller.updateConfig({
        gameId: 'game-1',
        bootstrap: false,
        players: {
          player_a: { prompt: 'go-a' },
          player_b: { prompt: 'go-b' },
        },
      });
      await controller.start();
      await controller.pause();
      await controller.handleGameEvent({ seq: 1, type: 'turn_end', timestamp: Date.now(), payload: { previousOwner: 'player_b', nextOwner: 'player_a', turnNumber: 1 } });
      expect(calls).toEqual([]);

      await controller.resume();
      await controller.handleGameEvent({ seq: 2, type: 'turn_end', timestamp: Date.now(), payload: { previousOwner: 'player_b', nextOwner: 'player_a', turnNumber: 2 } });
      expect(calls).toEqual(['go-a']);
    } finally {
      cleanup(runtimeDir);
    }
  });

  it('renders game and token placeholders for automatic turn prompts', async () => {
    const runtimeDir = tempRuntime();
    const calls: string[] = [];
    try {
      for (const id of globalStore.list()) globalStore.delete(id);
      const controller = new AutoControlController({
        runtimeDir,
        runner: async invocation => {
          calls.push(String(invocation.args.at(-1)));
          return { code: 0, output: '' };
        },
      });
      await controller.updateConfig({
        bootstrap: true,
        players: {
          player_a: { prompt: 'turn {side} {gameId} {token}', startPrompt: 'start {side} {token}' },
          player_b: { startPrompt: 'start {side} {token}' },
        },
      });

      const { gameId } = await controller.start();
      const tokenA = globalStore.get(gameId!)!.tokens.player_a;
      await controller.handleGameEvent({
        seq: 9,
        type: 'turn_end',
        timestamp: Date.now(),
        payload: { previousOwner: 'player_b', nextOwner: 'player_a', turnNumber: 2 },
      });

      expect(calls.at(-1)).toBe(`turn player_a ${gameId} ${tokenA}`);
    } finally {
      cleanup(runtimeDir);
    }
  });

  it('sends manual prompts to the selected side', async () => {
    const runtimeDir = tempRuntime();
    const calls: string[] = [];
    try {
      const controller = new AutoControlController({
        runtimeDir,
        runner: async invocation => {
          calls.push(invocation.args.join(' '));
          return { code: 0, output: '' };
        },
      });

      await controller.manual('player_b', 'manual command');

      expect(calls[0]).toContain('--session .pi/session/player-b.jsonl');
      expect(calls[0]).toContain('-p manual command');
    } finally {
      cleanup(runtimeDir);
    }
  });

  it('subscribes to the active game event source on start and unsubscribes on stop', async () => {
    const runtimeDir = tempRuntime();
    let handler: ((event: GameEvent) => void) | null = null;
    let unsubscribed = false;
    const calls: string[] = [];
    try {
      const controller = new AutoControlController({
        runtimeDir,
        runner: async invocation => {
          calls.push(String(invocation.args.at(-1)));
          return { code: 0, output: '' };
        },
        eventBus: {
          subscribe(gameId, cb) {
            expect(gameId).toBe('game-1');
            handler = cb;
            return () => { unsubscribed = true; };
          },
        },
      });
      await controller.updateConfig({ gameId: 'game-1', bootstrap: false, players: { player_a: { prompt: 'go-a' } } });

      await controller.start();
      handler?.({ seq: 3, type: 'turn_end', timestamp: Date.now(), payload: { previousOwner: 'player_b', nextOwner: 'player_a', turnNumber: 1 } });
      await Promise.resolve();
      await controller.stop();

      expect(calls).toEqual(['go-a']);
      expect(unsubscribed).toBe(true);
    } finally {
      cleanup(runtimeDir);
    }
  });
});
