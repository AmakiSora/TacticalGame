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
  it('initializes simultaneous games with headquarters and a planning state', () => {
    const game = createInitialGame('simultaneous-initialization', 'standoff');

    expect(game.config.mode).toBe('simultaneous');
    expect(Object.keys(game.headquarters)).toEqual(['player_a', 'player_b']);
    expect(game.plan).toEqual({ queues: {}, committed: [] });
    expect(game.turn.currentPlayerId).toBeNull();
    expect(game.turn.currentOwner).toBeNull();
  });

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

  it('restores action points and effective contribution for legacy persisted games', () => {
    const file = tempFile();
    const store = new GameStore({ persistenceFile: file });
    const game = createInitialGame('legacy-actions');
    delete (game.players.player_a!.stats as Partial<typeof game.players.player_a.stats>).actionPointsUsed;
    delete (game.players.player_b!.stats as Partial<typeof game.players.player_b.stats>).actionPointsUsed;
    delete (game.players.player_a!.stats as Partial<typeof game.players.player_a.stats>).actionMerit;
    delete (game.players.player_b!.stats as Partial<typeof game.players.player_b.stats>).actionMerit;
    game.events = [
      { seq: 1, type: 'game_start', timestamp: 1, payload: { units: [
        { id: 'unit-a', owner: 'player_a' }, { id: 'unit-b', owner: 'player_b' },
      ] } },
      { seq: 2, type: 'move', timestamp: 2, payload: { unitId: 'unit-a', owner: 'player_a', actionsUsed: 1 } },
      { seq: 3, type: 'attack', timestamp: 3, payload: { attackerId: 'unit-a', damage: 30, actionsUsed: 1 } },
      { seq: 4, type: 'deploy', timestamp: 4, payload: { unitId: 'unit-c', owner: 'player_a', actionsUsed: 2 } },
      { seq: 5, type: 'turn_end', timestamp: 5, payload: {} },
      { seq: 6, type: 'move', timestamp: 6, payload: { unitId: 'unit-b', owner: 'player_b', actionsUsed: 1 } },
      { seq: 7, type: 'control_point_captured', timestamp: 7, payload: { owner: 'player_b', pointId: 'cp' } },
    ];
    store.save(game);

    const restored = new GameStore({ persistenceFile: file });
    restored.loadFromDisk();

    expect(restored.get('legacy-actions')!.players.player_a!.stats.actionPointsUsed).toBe(2);
    expect(restored.get('legacy-actions')!.players.player_b!.stats.actionPointsUsed).toBe(1);
    expect(restored.get('legacy-actions')!.players.player_a!.stats.actionMerit).toBe(3);
    expect(restored.get('legacy-actions')!.players.player_b!.stats.actionMerit).toBe(2);
  });

  it('restores simultaneous AP without overcounting phase-reordered actions', () => {
    const file = tempFile();
    const store = new GameStore({ persistenceFile: file });
    const game = createInitialGame('simultaneous-reordered-actions', 'standoff');
    game.events = [
      { seq: 1, type: 'game_start', timestamp: 1, payload: { units: [] } },
      // Planned queue positions are 1/2/3, but resolution emits move, demolish,
      // attack in phase order: 3 -> 1 -> 2.
      { seq: 2, type: 'move', timestamp: 2, payload: { owner: 'player_a', actionsUsed: 3 } },
      { seq: 3, type: 'demolish', timestamp: 3, payload: { owner: 'player_a', actionsUsed: 1 } },
      { seq: 4, type: 'attack', timestamp: 4, payload: { owner: 'player_a', actionsUsed: 2 } },
      { seq: 5, type: 'round_resolved', timestamp: 5, payload: { roundNumber: 1 } },
    ];
    store.save(game);

    const restored = new GameStore({ persistenceFile: file });
    restored.loadFromDisk();

    expect(restored.get('simultaneous-reordered-actions')!.players.player_a!.stats.actionPointsUsed).toBe(3);
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
