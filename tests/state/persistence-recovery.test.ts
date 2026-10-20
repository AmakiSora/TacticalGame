import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createInitialGame, GameStore } from '../../src/state/store.js';

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
  it('archives a corrupt main file and restores the .bak snapshot', () => {
    const file = tempFile();
    const game = createInitialGame('recovered');
    game.playerNames.player_a = 'A';
    writeFileSync(file, '{ half json');
    writeFileSync(`${file}.bak`, persisted(game));

    const store = new GameStore({ persistenceFile: file });
    store.loadFromDisk();

    expect(store.get('recovered')?.playerNames.player_a).toBe('A');
    expect(existsSync(file)).toBe(false);
    expect(readdirSync(tempDir!).some(name => name.startsWith('games.json.corrupt-'))).toBe(true);
  });

  it('never silently clears an archive without preserving the corrupt file', () => {
    const file = tempFile();
    writeFileSync(file, 'not json at all');

    const store = new GameStore({ persistenceFile: file });
    store.loadFromDisk();

    expect(store.list()).toEqual([]);
    const archived = readdirSync(tempDir!).filter(name => name.startsWith('games.json.corrupt-'));
    expect(archived).toHaveLength(1);
    expect(readFileSync(join(tempDir!, archived[0]!)).toString()).toContain('not json');
  });

  it('loads the backup when the main file is missing', () => {
    const file = tempFile();
    const game = createInitialGame('from-backup');
    writeFileSync(`${file}.bak`, persisted(game));

    const store = new GameStore({ persistenceFile: file });
    store.loadFromDisk();

    expect(store.get('from-backup')).toBeDefined();
  });
});
