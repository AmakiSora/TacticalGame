// tests/state/store-flush.test.ts
// #4：每局快照同步原子写（请求返回时必须在盘上），全量 games.json 改成去抖合并；
// 删除 / 归档 / 进程退出这些「必须落定」的路径走 flushNow()。
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

describe('full-state flush is debounced, per-game snapshots stay synchronous', () => {
  it('writes the per-game snapshot immediately and coalesces the full flush', async () => {
    const file = tempFile();
    const store = new GameStore({ persistenceFile: file, synchronousFlush: false });
    store.save(createInitialGame('a'));
    // 每局快照同步写：save 返回时已经在盘上。
    expect(existsSync(gameSnapshotPath(file, 'a'))).toBe(true);
    // 全量导出的还没写（去抖窗口内）。
    expect(store.flushCount).toBe(0);
    expect(store.flushScheduled).toBe(true);

    store.save(createInitialGame('b'));
    store.save(createInitialGame('c'));
    await vi.advanceTimersByTimeAsync(250);

    // 三次变更只写一次全量。
    expect(store.flushCount).toBe(1);
    expect(readGames(file).games.map(game => game.id).sort()).toEqual(['a', 'b', 'c']);
    expect(existsSync(gameSnapshotPath(file, 'b'))).toBe(true);
    expect(existsSync(gameSnapshotPath(file, 'c'))).toBe(true);
  });

  it('force-writes at most every 2s even under continuous activity', async () => {
    const file = tempFile();
    const store = new GameStore({ persistenceFile: file, synchronousFlush: false });
    // 每 200ms 一次变更、持续 2.4s：不会因为一直在变而永不落盘。
    for (let tick = 0; tick < 12; tick += 1) {
      store.save(createInitialGame(`g${tick}`));
      await vi.advanceTimersByTimeAsync(200);
    }
    // 持续活动下由 maxWait 兜底：2.4s 内落定一次（2s 那一刻），不会被饿死。
    expect(store.flushCount).toBe(1);
    expect(readGames(file).games.length).toBeGreaterThan(0);
  });

  it('flushNow() settles immediately and cancels the pending timer', async () => {
    const file = tempFile();
    const store = new GameStore({ persistenceFile: file, synchronousFlush: false });
    store.save(createInitialGame('d'));
    expect(store.flushScheduled).toBe(true);
    store.flushNow();
    expect(store.flushCount).toBe(1);
    expect(readGames(file).games.map(game => game.id)).toEqual(['d']);
    // flushNow 之后再推进定时器不会重复写（定时器已被去抖窗口消费）。
    await vi.advanceTimersByTimeAsync(500);
    expect(store.flushCount).toBe(1);
  });

  it('delete() settles synchronously so a removed game cannot come back after a crash', () => {
    const file = tempFile();
    const store = new GameStore({ persistenceFile: file, synchronousFlush: false });
    store.save(createInitialGame('keep'));
    store.save(createInitialGame('drop'));
    store.flushNow();
    expect(readGames(file).games.map(game => game.id).sort()).toEqual(['drop', 'keep']);

    store.delete('drop');
    // 删除必须已经落到全量文件里，而不是待在去抖队列中。
    expect(readGames(file).games.map(game => game.id)).toEqual(['keep']);
    expect(existsSync(gameSnapshotPath(file, 'drop'))).toBe(false);
    expect(store.flushScheduled).toBe(false);
  });

  it('pruneInactive() settles synchronously after archiving', () => {
    const file = tempFile();
    const store = new GameStore({ persistenceFile: file, synchronousFlush: false });
    const stale = createInitialGame('stale');
    store.save(stale);
    store.flushNow();
    // save() 会把 lastActivityAt 刷成现在，所以「变陈旧」要在落盘之后再改；
    // createInitialGame 默认是 active 态（不会被 TTL 回收），这里改回 lobby。
    stale.phase = 'lobby';
    stale.turn.phase = 'lobby';
    stale.lastActivityAt = Date.now() - 10 * 3_600_000;

    const removed = store.pruneInactive({ lobbyTtlMs: 3_600_000, gameOverTtlMs: 0 });
    expect(removed).toEqual(['stale']);
    expect(readGames(file).games).toHaveLength(0);
  });

  it('keeps the synchronous behaviour used by the test suite by default', () => {
    const file = tempFile();
    // VITEST 下默认 synchronousFlush=true：save 后全量已经写好，用例不需要 sleep。
    const store = new GameStore({ persistenceFile: file });
    store.save(createInitialGame('sync'));
    expect(store.flushCount).toBe(1);
    expect(readGames(file).games.map(game => game.id)).toEqual(['sync']);
  });
});


