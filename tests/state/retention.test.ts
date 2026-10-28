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

  it('keeps pruned games in memory when the consistency flush fails', () => {
    const file = tempFile();
    const store = new GameStore({ persistenceFile: file });
    const lobby = createInitialGame('prune-flush-failure');
    lobby.phase = 'lobby';
    store.save(lobby);
    lobby.lastActivityAt = 0;
    // 归档删除走的是同步 flushNow（3.8.9 起 flush 变成去抖调度，不再抛写盘错误）。
    const flush = vi.spyOn(store, 'flushNow').mockImplementation(() => {
      throw new Error('disk full');
    });
    try {
      expect(() => store.pruneInactive({ lobbyTtlMs: 1, gameOverTtlMs: 1, now: Date.now() })).toThrow();
      expect(store.get('prune-flush-failure')).toBeDefined();
    } finally {
      flush.mockRestore();
    }
  });

  it('keeps a game when snapshot removal fails during delete', () => {
    const file = tempFile();
    const store = new GameStore({ persistenceFile: file });
    const game = createInitialGame('delete-snapshot-failure');
    store.save(game);
    const remove = vi.spyOn(store as unknown as { removeSnapshot: (id: string) => boolean }, 'removeSnapshot')
      .mockReturnValue(false);
    try {
      expect(() => store.delete('delete-snapshot-failure')).toThrow(/failed to remove snapshot/);
      expect(store.get('delete-snapshot-failure')).toBeDefined();
    } finally {
      remove.mockRestore();
    }
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
