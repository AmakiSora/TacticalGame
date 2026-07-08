import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialGame, GameStore } from '../../src/state/store.js';

let tempDir: string | null = null;

function tempFile(): string {
  tempDir = mkdtempSync(join(tmpdir(), 'tg-store-'));
  return join(tempDir, 'games.json');
}

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe('GameStore persistence', () => {
  it('saves and restores games from a persistence file', () => {
    const file = tempFile();
    const store = new GameStore({ persistenceFile: file });
    const game = createInitialGame('persist-1');
    game.playerNames.player_a = 'A';
    game.playerNames.player_b = 'B';
    game.turn.turnNumber = 3;
    game.events.push({ seq: 1, type: 'game_start', timestamp: 100, payload: { ok: true } });

    store.save(game);

    const restored = new GameStore({ persistenceFile: file });
    restored.loadFromDisk();
    const loaded = restored.get('persist-1')!;
    expect(loaded.tokens.player_a).toBe(game.tokens.player_a);
    expect(loaded.playerNames).toEqual({ player_a: 'A', player_b: 'B' });
    expect(loaded.turn.turnNumber).toBe(3);
    expect(loaded.events).toHaveLength(1);
  });

  it('removes deleted games from the persistence file', () => {
    const file = tempFile();
    const store = new GameStore({ persistenceFile: file });
    store.save(createInitialGame('delete-me'));

    store.delete('delete-me');

    const persisted = JSON.parse(readFileSync(file, 'utf8')) as { games: unknown[] };
    expect(persisted.games).toEqual([]);
  });

  it('keeps the store empty when the persistence file is invalid', () => {
    const file = tempFile();
    writeFileSync(file, '{ bad json');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = new GameStore({ persistenceFile: file });

    expect(() => store.loadFromDisk()).not.toThrow();
    expect(store.list()).toEqual([]);

    error.mockRestore();
  });
});
