import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createInitialGame, GameStore } from '../../src/state/store.js';

let tempDir: string | null = null;

function tempFile(): string {
  tempDir = mkdtempSync(join(tmpdir(), 'tg-retention-'));
  return join(tempDir, 'games.json');
}

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe('game retention', () => {
  it('archives and removes an inactive lobby but keeps active games', () => {
    const file = tempFile();
    const store = new GameStore({ persistenceFile: file });
    const lobby = createInitialGame('old-lobby');
    lobby.phase = 'lobby';
    store.save(lobby);
    const active = createInitialGame('active-game');
    store.save(active);

    lobby.lastActivityAt = 0;
    active.lastActivityAt = 0;
    const removed = store.pruneInactive({ lobbyTtlMs: 1, gameOverTtlMs: 1, now: Date.now() });

    expect(removed).toEqual(['old-lobby']);
    expect(store.get('old-lobby')).toBeUndefined();
    expect(store.get('active-game')).toBeDefined();
    expect(existsSync(join(tempDir!, 'archive', 'old-lobby.json'))).toBe(true);
  });

  it('refreshes lastActivityAt only on writes', () => {
    const file = tempFile();
    const store = new GameStore({ persistenceFile: file });
    const game = createInitialGame('activity');
    store.save(game);
    game.lastActivityAt = 0;
    store.persist(game);
    expect(game.lastActivityAt).toBeGreaterThan(0);
  });
});
