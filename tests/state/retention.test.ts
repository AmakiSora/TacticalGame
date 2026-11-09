import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  it('archives and removes an inactive lobby but keeps active games', async () => {
    const file = tempFile();
    const store = new GameStore({ persistenceFile: file });
    const lobby = createInitialGame('old-lobby');
    lobby.phase = 'lobby';
    await store.save(lobby);
    const active = createInitialGame('active-game');
    await store.save(active);

    lobby.lastActivityAt = 0;
    active.lastActivityAt = 0;
    const removed = await store.pruneInactive({ lobbyTtlMs: 1, gameOverTtlMs: 1, now: Date.now() });

    expect(removed).toEqual(['old-lobby']);
    expect(store.get('old-lobby')).toBeUndefined();
    expect(store.get('active-game')).toBeDefined();
    expect(existsSync(join(tempDir!, 'archive', 'old-lobby.json'))).toBe(true);
  });

  it('keeps pruned games in memory when the consistency flush fails', async () => {
    const file = tempFile();
    const store = new GameStore({ persistenceFile: file });
    const lobby = createInitialGame('prune-flush-failure');
    lobby.phase = 'lobby';
    await store.save(lobby);
    lobby.lastActivityAt = 0;
    const flush = vi.spyOn(store as unknown as { writeFullState(json: string): Promise<void> }, 'writeFullState')
      .mockRejectedValue(new Error('disk full'));
    try {
      await expect(store.pruneInactive({ lobbyTtlMs: 1, gameOverTtlMs: 1, now: Date.now() })).rejects.toThrow('disk full');
      expect(store.get('prune-flush-failure')).toBeDefined();
    } finally {
      flush.mockRestore();
    }
  });

  it('keeps a game when snapshot removal fails during delete', async () => {
    const file = tempFile();
    const store = new GameStore({ persistenceFile: file });
    const game = createInitialGame('delete-snapshot-failure');
    await store.save(game);
    const remove = vi.spyOn(store as unknown as { removeSnapshot: (id: string) => Promise<boolean> }, 'removeSnapshot')
      .mockResolvedValue(false);
    try {
      await expect(store.delete('delete-snapshot-failure')).rejects.toThrow(/failed to remove snapshot/);
      expect(store.get('delete-snapshot-failure')).toBeDefined();
    } finally {
      remove.mockRestore();
    }
  });

  it.each([false, true])('handles an export queued during archival (reactivated=%s)', async reactivated => {
    const file = tempFile();
    const store = new GameStore({ persistenceFile: file });
    const game = createInitialGame('archiving');
    game.phase = 'lobby';
    await store.save(game);
    game.lastActivityAt = 0;
    const entered = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<boolean>();
    const archive = vi.spyOn(store as unknown as { archiveGame(): Promise<boolean> }, 'archiveGame')
      .mockImplementationOnce(() => { entered.resolve(); return gate.promise; });
    const pruned = store.pruneInactive({ lobbyTtlMs: 1, gameOverTtlMs: 1 });
    await entered.promise;
    const persisted = reactivated ? store.persist(game) : Promise.resolve();
    const exported = store.flushNow();
    try {
      gate.resolve(true);
      expect(await pruned).toEqual(reactivated ? [] : [game.id]);
      await Promise.all([persisted, exported]);
      const restored = new GameStore({ persistenceFile: file });
      await restored.loadFromDisk();
      expect(restored.list()).toEqual(reactivated ? [game.id] : []);
    } finally {
      gate.resolve(true);
      await store.drain();
      archive.mockRestore();
    }
  });

  it('refreshes lastActivityAt only on writes', async () => {
    const file = tempFile();
    const store = new GameStore({ persistenceFile: file });
    const game = createInitialGame('activity');
    await store.save(game);
    game.lastActivityAt = 0;
    await store.persist(game);
    expect(game.lastActivityAt).toBeGreaterThan(0);
  });
});
