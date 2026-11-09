// tests/state/store-flush.test.ts
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameStore, createInitialGame, gameSnapshotPath } from '../../src/state/store.js';

let dir: string | null = null;

function tempFile(): string {
  dir = mkdtempSync(join(tmpdir(), 'tg-flush-'));
  return join(dir, 'games.json');
}

function readGames(file: string): { games: Array<{ id: string }> } {
  return JSON.parse(readFileSync(file, 'utf8')) as { games: Array<{ id: string }> };
}

beforeEach(() => { vi.useFakeTimers(); });

afterEach(() => {
  vi.useRealTimers();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe('full-state flush is debounced, per-game snapshots remain durable', () => {
  it('writes the per-game snapshot immediately and coalesces the full flush', async () => {
    const file = tempFile();
    const store = new GameStore({ persistenceFile: file, immediateFlush: false });
    await store.save(createInitialGame('a'));
    // save 完成时，每局快照已经在盘上。
    expect(existsSync(gameSnapshotPath(file, 'a'))).toBe(true);
    // 全量导出的还没写（去抖窗口内）。
    expect(store.flushCount).toBe(0);
    expect(store.flushScheduled).toBe(true);

    await store.save(createInitialGame('b'));
    await store.save(createInitialGame('c'));
    await vi.advanceTimersByTimeAsync(250);
    await store.drain();

    // 三次变更只写一次全量。
    expect(store.flushCount).toBe(1);
    expect(readGames(file).games.map(game => game.id).sort()).toEqual(['a', 'b', 'c']);
    expect(existsSync(gameSnapshotPath(file, 'b'))).toBe(true);
    expect(existsSync(gameSnapshotPath(file, 'c'))).toBe(true);
  });

  it('force-writes at most every 2s even under continuous activity', async () => {
    const file = tempFile();
    const store = new GameStore({ persistenceFile: file, immediateFlush: false });
    // 每 200ms 一次变更、持续 2.4s：不会因为一直在变而永不落盘。
    for (let tick = 0; tick < 12; tick += 1) {
      await store.save(createInitialGame(`g${tick}`));
      await vi.advanceTimersByTimeAsync(200);
      await store.drain();
    }
    // 持续活动下由 maxWait 兜底：2.4s 内落定一次（2s 那一刻），不会被饿死。
    expect(store.flushCount).toBe(1);
    expect(readGames(file).games.length).toBeGreaterThan(0);
  });

  it('flushNow() settles immediately and cancels the pending timer', async () => {
    const file = tempFile();
    const store = new GameStore({ persistenceFile: file, immediateFlush: false });
    await store.save(createInitialGame('d'));
    expect(store.flushScheduled).toBe(true);
    await store.flushNow();
    expect(store.flushCount).toBe(1);
    expect(readGames(file).games.map(game => game.id)).toEqual(['d']);
    // flushNow 之后再推进定时器不会重复写（定时器已被去抖窗口消费）。
    await vi.advanceTimersByTimeAsync(500);
    expect(store.flushCount).toBe(1);
  });

  it('delete() settles before resolving so a removed game cannot come back after a crash', async () => {
    const file = tempFile();
    const store = new GameStore({ persistenceFile: file, immediateFlush: false });
    await store.save(createInitialGame('keep'));
    await store.save(createInitialGame('drop'));
    await store.flushNow();
    expect(readGames(file).games.map(game => game.id).sort()).toEqual(['drop', 'keep']);

    await store.delete('drop');
    // 删除必须已经落到全量文件里，而不是待在去抖队列中。
    expect(readGames(file).games.map(game => game.id)).toEqual(['keep']);
    expect(existsSync(gameSnapshotPath(file, 'drop'))).toBe(false);
    expect(store.flushScheduled).toBe(false);
  });

  it('pruneInactive() settles before resolving after archiving', async () => {
    const file = tempFile();
    const store = new GameStore({ persistenceFile: file, immediateFlush: false });
    const stale = createInitialGame('stale');
    await store.save(stale);
    await store.flushNow();
    // save() 会把 lastActivityAt 刷成现在，所以「变陈旧」要在落盘之后再改；
    // createInitialGame 默认是 active 态（不会被 TTL 回收），这里改回 lobby。
    stale.phase = 'lobby';
    stale.turn.phase = 'lobby';
    stale.lastActivityAt = Date.now() - 10 * 3_600_000;

    const removed = await store.pruneInactive({ lobbyTtlMs: 3_600_000, gameOverTtlMs: 0 });
    expect(removed).toEqual(['stale']);
    expect(readGames(file).games).toHaveLength(0);
  });

  it('awaits the full export by default in tests', async () => {
    const file = tempFile();
    // VITEST 下默认 immediateFlush=true：save 后全量已经写好，用例不需要 sleep。
    const store = new GameStore({ persistenceFile: file });
    await store.save(createInitialGame('sync'));
    expect(store.flushCount).toBe(1);
    expect(readGames(file).games.map(game => game.id)).toEqual(['sync']);
  });
});


