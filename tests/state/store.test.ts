import * as fs from 'node:fs/promises';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addLobbyPlayer, createInitialGame, createLobby, GameStore, gameSnapshotPath } from '../../src/state/store.js';
import { renderMetrics, resetMetrics } from '../../src/utils/metrics.js';

vi.mock('node:fs/promises', async (importOriginal) => ({ ...await importOriginal<typeof import('node:fs/promises')>() }));

async function spyOnHandle(method: 'sync') {
  const handle = await fs.open(join(tempDir!, 'handle-probe'), 'w');
  const prototype = Object.getPrototypeOf(handle);
  await handle.close();
  const original = prototype[method];
  return vi.spyOn(prototype, method).mockImplementation(original);
}

let tempDir: string | null = null;

function tempFile(): string {
  tempDir = mkdtempSync(join(tmpdir(), 'tg-store-'));
  return join(tempDir, 'games.json');
}

afterEach(() => {
  vi.restoreAllMocks();
  resetMetrics();
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

  it('saves and restores games from a persistence file', async () => {
    const file = tempFile();
    const store = new GameStore({ persistenceFile: file });
    const game = createInitialGame('persist-1');
    game.playerNames.player_a = 'A';
    game.playerNames.player_b = 'B';
    game.turn.turnNumber = 3;
    game.events.push({ seq: 1, type: 'game_start', timestamp: 100, payload: { ok: true } });

    await store.save(game);

    const restored = new GameStore({ persistenceFile: file });
    await restored.loadFromDisk();
    const loaded = restored.get('persist-1')!;
    expect(loaded.tokens.player_a).toBe(game.tokens.player_a);
    expect(loaded.playerNames).toEqual({ player_a: 'A', player_b: 'B' });
    expect(loaded.turn.turnNumber).toBe(3);
    expect(loaded.events).toHaveLength(1);
  });

  it('durably persists compact UTF-8 snapshots and records snapshot-only metrics', async () => {
    const file = tempFile();
    const store = new GameStore({ persistenceFile: file, immediateFlush: false });
    const game = createInitialGame('compact-snapshot');
    game.playerNames.player_a = '测试玩家';
    game.events.push({ seq: 1, type: 'game_start', timestamp: 100, payload: { text: '中文事件\n第二行' } });
    const sync = await spyOnHandle('sync');
    const rename = vi.spyOn(fs, 'rename');
    resetMetrics();

    await store.persist(game);

    const snapshot = gameSnapshotPath(file, game.id);
    const json = readFileSync(snapshot, 'utf8');
    const payload = JSON.parse(json);
    expect(payload.game).toEqual(JSON.parse(JSON.stringify(game)));
    expect(json).toBe(`${JSON.stringify(payload)}\n`);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync.mock.invocationCallOrder[0]).toBeLessThan(rename.mock.invocationCallOrder[0]!);
    expect(existsSync(`${snapshot}.tmp`)).toBe(false);
    expect(store.flushScheduled).toBe(false);
    expect(store.flushCount).toBe(0);

    const bytes = Buffer.byteLength(json, 'utf8');
    expect(bytes).toBe(statSync(snapshot).size);
    expect(bytes).toBeGreaterThan(json.length);
    const metrics = renderMetrics();
    expect(metrics).toContain('tactical_snapshot_total{result="ok"} 1\n');
    expect(metrics).toContain('tactical_snapshot_duration_ms_count 1\n');
    expect(metrics).toContain(`tactical_snapshot_bytes_sum ${bytes}\n`);
    expect(metrics).toContain('tactical_snapshot_bytes_count 1\n');
    expect(metrics).not.toContain(game.id);
    expect(metrics).not.toContain('tactical_persist_total');

    const restored = new GameStore({ persistenceFile: file });
    await restored.loadFromDisk();
    expect(restored.get(game.id)?.events).toEqual(game.events);
    expect(restored.get(game.id)?.playerNames).toEqual(game.playerNames);
    expect(restored.get(game.id)?.units).toEqual(game.units);
  });

  it('rotates the previous compact snapshot only after syncing the new one', async () => {
    const file = tempFile();
    const store = new GameStore({ persistenceFile: file });
    const game = createInitialGame('snapshot-rotation');
    await store.persist(game);
    const snapshot = gameSnapshotPath(file, game.id);
    const previous = readFileSync(snapshot, 'utf8');
    const sync = await spyOnHandle('sync');
    const rename = vi.spyOn(fs, 'rename');
    game.turn.turnNumber += 1;

    await store.persist(game);

    expect(readFileSync(`${snapshot}.prev`, 'utf8')).toBe(previous);
    expect(JSON.parse(readFileSync(snapshot, 'utf8')).game.turn.turnNumber).toBe(game.turn.turnNumber);
    expect(rename.mock.calls).toEqual([[snapshot, `${snapshot}.prev`], [`${snapshot}.tmp`, snapshot]]);
    expect(sync.mock.invocationCallOrder[0]).toBeLessThan(rename.mock.invocationCallOrder[0]!);
  });

  it.each(['mkdir', 'open', 'writeFile', 'sync', 'rename'] as const)(
    'reports and propagates snapshot %s failures without replacing the last valid state', async (operation) => {
      const file = tempFile();
      const store = new GameStore({ persistenceFile: file });
      const game = createInitialGame('snapshot-failure');
      await store.persist(game);
      const snapshot = gameSnapshotPath(file, game.id);
      const previous = readFileSync(snapshot, 'utf8');
      const failure = new Error(`injected ${operation} failure`);
      const closed = vi.fn();
      if (operation === 'writeFile' || operation === 'sync') {
        const originalOpen = fs.open;
        vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
          const handle = await originalOpen(...args);
          const close = handle.close.bind(handle);
          vi.spyOn(handle, operation).mockRejectedValue(failure);
          vi.spyOn(handle, 'close').mockImplementation(async () => { await close(); closed(); });
          return handle;
        });
      } else vi.spyOn(fs, operation).mockRejectedValue(failure);
      resetMetrics();
      game.turn.turnNumber += 1;

      await expect(store.persist(game)).rejects.toThrow(failure);

      expect(readFileSync(snapshot, 'utf8')).toBe(previous);
      if (operation === 'writeFile' || operation === 'sync') expect(closed).toHaveBeenCalledTimes(1);
      const metrics = renderMetrics();
      expect(metrics).toContain('tactical_snapshot_total{result="error"} 1\n');
      expect(metrics).toContain('tactical_snapshot_duration_ms_count 1\n');
      expect(metrics).not.toContain('result="ok"');
      expect(metrics).not.toContain('tactical_snapshot_bytes');
    },
  );

  it('reports serialization failures and skips snapshot metrics when persistence is disabled', async () => {
    const file = tempFile();
    const game = createInitialGame('circular-snapshot');
    game.events.push({ seq: 1, type: 'game_start', timestamp: 100, payload: { circular: game } });
    resetMetrics();
    await new GameStore({ persistenceFile: null }).persist(game);
    expect(renderMetrics()).toBe('\n');

    const store = new GameStore({ persistenceFile: file });
    await expect(store.persist(game)).rejects.toThrow(/circular/i);
    expect(renderMetrics()).toContain('tactical_snapshot_total{result="error"} 1\n');
    expect(renderMetrics()).toContain('tactical_snapshot_serialize_duration_ms_count 1\n');
    expect(existsSync(gameSnapshotPath(file, game.id))).toBe(false);
  });

  it('yields during fsync, waits for durability and snapshots each queued version', async () => {
    const file = tempFile();
    const store = new GameStore({ persistenceFile: file });
    const game = createInitialGame('queued-versions');
    const gate = Promise.withResolvers<void>();
    const syncing = Promise.withResolvers<void>();
    const sync = await spyOnHandle('sync');
    const original = sync.getMockImplementation()!;
    sync.mockImplementationOnce(async function (this: fs.FileHandle) {
      syncing.resolve();
      await gate.promise;
      await original.call(this);
    });
    let completed = false;
    game.turn.turnNumber = 3;
    const first = store.persist(game).then(() => { completed = true; });
    game.turn.turnNumber = 4;
    const second = store.persist(game);
    game.turn.turnNumber = 5;
    try {
      await syncing.promise;
      await new Promise(resolve => setImmediate(resolve));
      expect(completed).toBe(false);
      expect(existsSync(gameSnapshotPath(file, game.id))).toBe(false);
      gate.resolve();
      await Promise.all([first, second]);
      const path = gameSnapshotPath(file, game.id);
      expect(JSON.parse(readFileSync(`${path}.prev`, 'utf8')).game.turn.turnNumber).toBe(3);
      expect(JSON.parse(readFileSync(path, 'utf8')).game.turn.turnNumber).toBe(4);
    } finally {
      gate.resolve();
      await store.drain();
    }
  });

  it('continues after a failed write and never revives a game deleted behind queued writes', async () => {
    const file = tempFile();
    const store = new GameStore({ persistenceFile: file });
    const game = createInitialGame('queued-delete');
    vi.spyOn(fs, 'open').mockRejectedValueOnce(new Error('disk full'));
    const failed = expect(store.persist(game)).rejects.toThrow('disk full');
    game.turn.turnNumber = 7;
    const retried = store.persist(game);
    const deleted = store.delete(game.id);
    const exported = store.flushNow();
    await Promise.all([failed, retried, deleted, exported]);
    expect(existsSync(gameSnapshotPath(file, game.id))).toBe(false);
    const restored = new GameStore({ persistenceFile: file });
    await restored.loadFromDisk();
    expect(restored.list()).toEqual([]);
  });

  it('removes deleted games from the persistence file', async () => {
    const file = tempFile();
    const store = new GameStore({ persistenceFile: file });
    await store.save(createInitialGame('delete-me'));

    await store.delete('delete-me');

    const persisted = JSON.parse(readFileSync(file, 'utf8')) as { games: unknown[] };
    expect(persisted.games).toEqual([]);
  });

  it('restores action points and effective contribution for legacy persisted games', async () => {
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
    await store.save(game);

    const restored = new GameStore({ persistenceFile: file });
    await restored.loadFromDisk();

    expect(restored.get('legacy-actions')!.players.player_a!.stats.actionPointsUsed).toBe(2);
    expect(restored.get('legacy-actions')!.players.player_b!.stats.actionPointsUsed).toBe(1);
    expect(restored.get('legacy-actions')!.players.player_a!.stats.actionMerit).toBe(3);
    expect(restored.get('legacy-actions')!.players.player_b!.stats.actionMerit).toBe(2);
  });

  it('restores simultaneous AP without overcounting phase-reordered actions', async () => {
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
    await store.save(game);

    const restored = new GameStore({ persistenceFile: file });
    await restored.loadFromDisk();

    expect(restored.get('simultaneous-reordered-actions')!.players.player_a!.stats.actionPointsUsed).toBe(3);
  });

  it('restores killValue for the first killing blow when saved events overkill', async () => {
    const file = tempFile();
    const store = new GameStore({ persistenceFile: file });
    const game = createLobby('overkill-restore', 'standoff', { maxPlayers: 3, participate: true, playerName: 'A' });
    expect(addLobbyPlayer(game, 'B')).not.toBeNull();
    expect(addLobbyPlayer(game, 'C')).not.toBeNull();
    game.events = [
      { seq: 1, type: 'game_start', timestamp: 1, payload: { units: [], controlPoints: [] } },
      // 同时结算下单位要到死亡阶段才 alive=false，所以先清零者之后还有人把同一具尸体打到 0 血。
      // 重建必须与引擎同口径：击杀只归第一个清零的人，过量击杀不重复入账。
      { seq: 2, type: 'attack', timestamp: 2, payload: { owner: 'player_a', targetKind: 'unit', targetId: 'unit-x', targetHp: 0 } },
      { seq: 3, type: 'attack', timestamp: 3, payload: { owner: 'player_b', targetKind: 'unit', targetId: 'unit-x', targetHp: 0 } },
      { seq: 4, type: 'unit_death', timestamp: 4, payload: { unitId: 'unit-x', owner: 'player_c', type: 'infantry', cause: 'attack' } },
    ];
    await store.save(game);

    const restored = new GameStore({ persistenceFile: file });
    await restored.loadFromDisk();

    const loaded = restored.get('overkill-restore')!;
    expect(loaded.players.player_a!.stats.killValue).toBe(loaded.config.units.infantry.cost);
    expect(loaded.players.player_b!.stats.killValue).toBe(0);
    expect(loaded.players.player_c!.stats.killValue).toBe(0);
  });

  it('restores royale games with planning state, control-point spawns and artillery', async () => {
    const file = tempFile();
    const store = new GameStore({ persistenceFile: file });
    await store.save(createInitialGame('royale-restore', 'snowflake'));

    const restored = new GameStore({ persistenceFile: file });
    await restored.loadFromDisk();

    const game = restored.get('royale-restore')!;
    expect(game.config.mode).toBe('royale');
    expect(game.plan).toEqual({ queues: {}, committed: [] });
    expect(game.headquarters).toEqual({});
    expect(game.turn.currentPlayerId).toBeNull();
    expect(game.artillery).toMatchObject({ safeRadius: 9, nextShrinkRound: 6 });
    expect(game.controlPoints.filter(point => point.owner !== null)).toHaveLength(2);
  });

  it('coerces illegal saved maxTurns while preserving the unlimited sentinel', async () => {
    const file = tempFile();
    const store = new GameStore({ persistenceFile: file });
    const ids = ['saved-null', 'saved-zero', 'saved-string', 'saved-missing', 'saved-finite'];
    for (const id of ids) await store.save(createInitialGame(id, id === 'saved-null' ? 'whirlpool' : 'default'));

    const payload = JSON.parse(readFileSync(file, 'utf8')) as { games: Array<{ id: string; config: any }> };
    const overrides: Record<string, unknown> = {
      'saved-null': null,
      'saved-zero': 0,
      'saved-string': '15',
      'saved-missing': undefined,
      'saved-finite': 12,
    };
    for (const game of payload.games) {
      const value = overrides[game.id];
      if (value === undefined) delete game.config.balance.maxTurns;
      else game.config.balance.maxTurns = value;
    }
    writeFileSync(file, JSON.stringify(payload));
    // 这个用例验证旧版单文件迁移；删除新快照，强制走 legacy 导入路径。
    rmSync(join(tempDir!, 'store'), { recursive: true, force: true });

    const restored = new GameStore({ persistenceFile: file });
    await restored.loadFromDisk();

    // null 是合法的「无回合上限」；非法值必须回落成有限默认，否则会在下一个回合边界误裁定。
    expect(restored.get('saved-null')!.config.balance.maxTurns).toBeNull();
    expect(restored.get('saved-zero')!.config.balance.maxTurns).toBe(15);
    expect(restored.get('saved-string')!.config.balance.maxTurns).toBe(15);
    expect(restored.get('saved-missing')!.config.balance.maxTurns).toBe(15);
    expect(restored.get('saved-finite')!.config.balance.maxTurns).toBe(12);
  });

  it('keeps the store empty when the persistence file is invalid', async () => {
    const file = tempFile();
    writeFileSync(file, '{ bad json');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = new GameStore({ persistenceFile: file });

    await expect(store.loadFromDisk()).resolves.toBeUndefined();
    expect(store.list()).toEqual([]);

    error.mockRestore();
  });
});
