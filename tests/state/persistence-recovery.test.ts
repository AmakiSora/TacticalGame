import { existsSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createInitialGame, GameStore, gameSnapshotPath } from '../../src/state/store.js';
import { verifyToken } from '../../src/state/tokens.js';

let tempDir: string | null = null;

function tempFile(): string {
  tempDir = mkdtempSync(join(tmpdir(), 'tg-recovery-'));
  return join(tempDir, 'games.json');
}

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

function persisted(game: ReturnType<typeof createInitialGame>): string {
  return JSON.stringify({ schemaVersion: 2, savedAt: new Date().toISOString(), games: [game] });
}

describe('persistence recovery', () => {
  it('archives a corrupt main file and restores the .bak snapshot', async () => {
    const file = tempFile();
    const game = createInitialGame('recovered');
    game.playerNames.player_a = 'A';
    writeFileSync(file, '{ half json');
    writeFileSync(`${file}.bak`, persisted(game));

    const store = new GameStore({ persistenceFile: file });
    await store.loadFromDisk();

    expect(store.get('recovered')?.playerNames.player_a).toBe('A');
    expect(existsSync(file)).toBe(false);
    expect(readdirSync(tempDir!).some(name => name.startsWith('games.json.corrupt-'))).toBe(true);
  });

  it('never silently clears an archive without preserving the corrupt file', async () => {
    const file = tempFile();
    writeFileSync(file, 'not json at all');

    const store = new GameStore({ persistenceFile: file });
    await store.loadFromDisk();

    expect(store.list()).toEqual([]);
    const archived = readdirSync(tempDir!).filter(name => name.startsWith('games.json.corrupt-'));
    expect(archived).toHaveLength(1);
    expect(readFileSync(join(tempDir!, archived[0]!)).toString()).toContain('not json');
  });

  it('loads the backup when the main file is missing', async () => {
    const file = tempFile();
    const game = createInitialGame('from-backup');
    writeFileSync(`${file}.bak`, persisted(game));

    const store = new GameStore({ persistenceFile: file });
    await store.loadFromDisk();

    expect(store.get('from-backup')).toBeDefined();
  });

  it('does not restore the last deleted game from a stale legacy backup', async () => {
    const file = tempFile();
    const store = new GameStore({ persistenceFile: file, immediateFlush: false });
    await store.save(createInitialGame('last-deleted'));
    await store.flushNow();
    await store.delete('last-deleted');

    expect(JSON.parse(readFileSync(file, 'utf8')).games).toEqual([]);
    expect(JSON.parse(readFileSync(`${file}.bak`, 'utf8')).games).toHaveLength(1);
    const restored = new GameStore({ persistenceFile: file });
    await restored.loadFromDisk();

    expect(restored.list()).toEqual([]);
    expect(existsSync(gameSnapshotPath(file, 'last-deleted'))).toBe(false);
  });

  it('does not restore the last archived game from a stale legacy backup', async () => {
    const file = tempFile();
    const store = new GameStore({ persistenceFile: file, immediateFlush: false });
    const game = createInitialGame('last-archived');
    game.phase = 'lobby';
    await store.save(game);
    await store.flushNow();
    game.lastActivityAt = 0;

    expect(await store.pruneInactive({ lobbyTtlMs: 1, gameOverTtlMs: 1 })).toEqual(['last-archived']);
    expect(existsSync(join(tempDir!, 'archive', 'last-archived.json'))).toBe(true);
    expect(JSON.parse(readFileSync(`${file}.bak`, 'utf8')).games).toHaveLength(1);
    const restored = new GameStore({ persistenceFile: file });
    await restored.loadFromDisk();

    expect(restored.list()).toEqual([]);
    expect(existsSync(gameSnapshotPath(file, 'last-archived'))).toBe(false);
  });

  it('does not merge a valid nonempty legacy main file with its older backup', async () => {
    const file = tempFile();
    writeFileSync(file, persisted(createInitialGame('current')));
    const backup = persisted(createInitialGame('obsolete'));
    writeFileSync(`${file}.bak`, backup);

    const store = new GameStore({ persistenceFile: file });
    await store.loadFromDisk();

    expect(store.list()).toEqual(['current']);
    expect(existsSync(gameSnapshotPath(file, 'obsolete'))).toBe(false);
    expect(readFileSync(`${file}.bak`, 'utf8')).toBe(backup);
  });

  it('restores the backup when the main file uses an unsupported schema', async () => {
    const file = tempFile();
    writeFileSync(file, JSON.stringify({ schemaVersion: 999, games: [] }));
    writeFileSync(`${file}.bak`, persisted(createInitialGame('supported-backup')));

    const store = new GameStore({ persistenceFile: file });
    await store.loadFromDisk();

    expect(store.list()).toEqual(['supported-backup']);
    expect(readdirSync(tempDir!).some(name => name.startsWith('games.json.schema-999-'))).toBe(true);
  });

  it('recovers a per-game snapshot from .prev when the main snapshot is missing', async () => {
    const file = tempFile();
    const game = createInitialGame('snapshot-prev');
    const store = new GameStore({ persistenceFile: file });
    await store.save(game);
    const main = gameSnapshotPath(file, 'snapshot-prev');
    renameSync(main, `${main}.prev`);
    unlinkSync(file);

    const restored = new GameStore({ persistenceFile: file });
    await restored.loadFromDisk();

    expect(restored.get('snapshot-prev')).toBeDefined();
  });

  it('recovers a per-game snapshot from .prev when the main snapshot is corrupt', async () => {
    const file = tempFile();
    const game = createInitialGame('snapshot-prev-corrupt');
    const store = new GameStore({ persistenceFile: file });
    await store.save(game);
    const main = gameSnapshotPath(file, 'snapshot-prev-corrupt');
    renameSync(main, `${main}.prev`);
    writeFileSync(main, '{ bad snapshot json');
    unlinkSync(file);

    const restored = new GameStore({ persistenceFile: file });
    await restored.loadFromDisk();

    expect(restored.get('snapshot-prev-corrupt')).toBeDefined();
  });

  it('migrates legacy plaintext tokens to hashes on load', async () => {
    const file = tempFile();
    const game = createInitialGame('legacy-tokens');
    game.hostToken = 'plain-host-token';
    game.tokens.player_a = 'plain-player-a';
    game.tokens.player_b = 'plain-player-b';
    writeFileSync(file, persisted(game));

    const store = new GameStore({ persistenceFile: file });
    await store.loadFromDisk();
    const loaded = store.get('legacy-tokens')!;

    expect(loaded.hostToken).toMatch(/^v1:/);
    expect(loaded.tokens.player_a).toMatch(/^v1:/);
    expect(loaded.tokens.player_b).toMatch(/^v1:/);
    expect(verifyToken('plain-host-token', loaded.hostToken)).toBe(true);
    expect(verifyToken('plain-player-a', loaded.tokens.player_a)).toBe(true);
    expect(verifyToken('plain-player-b', loaded.tokens.player_b)).toBe(true);
    expect(verifyToken('wrong-token', loaded.tokens.player_a)).toBe(false);
  });
});
