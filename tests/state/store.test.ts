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

  it('restores cumulative action points for legacy persisted games', () => {
    const file = tempFile();
    const store = new GameStore({ persistenceFile: file });
    const game = createInitialGame('legacy-actions');
    delete (game.players.player_a!.stats as Partial<typeof game.players.player_a.stats>).actionPointsUsed;
    delete (game.players.player_b!.stats as Partial<typeof game.players.player_b.stats>).actionPointsUsed;
    game.events = [
      { seq: 1, type: 'game_start', timestamp: 1, payload: { units: [
        { id: 'unit-a', owner: 'player_a' }, { id: 'unit-b', owner: 'player_b' },
      ] } },
      { seq: 2, type: 'move', timestamp: 2, payload: { unitId: 'unit-a', owner: 'player_a', actionsUsed: 1 } },
      { seq: 3, type: 'attack', timestamp: 3, payload: { attackerId: 'unit-a', actionsUsed: 1 } },
      { seq: 4, type: 'deploy', timestamp: 4, payload: { unitId: 'unit-c', owner: 'player_a', actionsUsed: 2 } },
      { seq: 5, type: 'turn_end', timestamp: 5, payload: {} },
      { seq: 6, type: 'move', timestamp: 6, payload: { unitId: 'unit-b', owner: 'player_b', actionsUsed: 1 } },
    ];
    store.save(game);

    const restored = new GameStore({ persistenceFile: file });
    restored.loadFromDisk();

    expect(restored.get('legacy-actions')!.players.player_a!.stats.actionPointsUsed).toBe(2);
    expect(restored.get('legacy-actions')!.players.player_b!.stats.actionPointsUsed).toBe(1);
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
