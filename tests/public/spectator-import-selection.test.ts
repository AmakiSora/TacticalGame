import { readFileSync } from 'node:fs';
import { createContext, Script } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const FILES = ['app.js', 'spectator-m.js'] as const;
const read = (file: string) => readFileSync(new URL(`../../public/${file}`, import.meta.url), 'utf8');

// 这些用例只执行顶层函数本身；UI 与回放渲染依赖用桩替换，避免把整页脚本塞进 VM。
function fn(source: string, name: string) {
  const match = new RegExp(`^(?:async )?function ${name}\\(`, 'm').exec(source);
  if (!match) throw new Error(`Missing ${name}`);
  return source.slice(match.index, source.indexOf('\n}', match.index) + 2);
}

function loadReplayHarness(file: string) {
  const source = read(file);
  const sync = vi.fn();
  const gameSelect = { value: 'live-room' };
  const context = createContext({
    gameSelect,
    pausePlayback: vi.fn(),
    buildTimelineMarkers: vi.fn(),
    rebuildToStep: vi.fn(),
    createEmptyState: () => ({}),
    boardAnimation: { reset: vi.fn(), syncState: vi.fn() },
    drawBoard: vi.fn(),
    renderSidebar: vi.fn(),
    renderDetail: vi.fn(),
    updateControls: vi.fn(),
    defaultPlayerNames: () => ({}),
    scoringEraFromVersion: () => 'current',
    scoringEraFromScores: () => 'current',
    syncPickerCurrent: sync,
    syncGamePickerLabel: sync,
    clearFogLock: vi.fn(),
  });
  const run = (code: string) => new Script(code).runInContext(context);
  run(`
    let gameLoadVersion = 0;
    let activeRecordId = null;
    let importedReplayMeta = null;
    let allEvents = [];
    let pinnedReplayStep = true;
    let liveSse = null;
    let liveFogGame = false;
    let currentStep = -1;
    let state = {};
    let playerNames = {};
    ${fn(source, 'loadImportedReplay')}
  `);
  return { run, gameSelect, sync };
}

function renameHarness(file: string, importedReplay = true) {
  const source = read(file);
  const prompt = vi.fn(async () => '新名字');
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
  const statusEl = { textContent: '' };
  const gameSelect = { value: 'live-room' };
  const context = createContext({
    window: { EMBEDDED_EVENTS: false, UIDialog: { prompt } },
    gameSelect,
    statusEl,
    importedReplayMeta: importedReplay ? { gameId: 'imported-room' } : null,
    playerName: () => '旧名字',
    localStorage: { getItem: () => 'control-token' },
    fetch: fetchMock,
  });
  const run = (code: string) => new Script(code).runInContext(context);
  run(`let playerNames = {}; ${fn(source, 'renamePlayer')}`);
  return { run, prompt, fetchMock, statusEl };
}

for (const file of FILES) {
  describe(`${file} imported replay selection`, () => {
    it('clears a previously selected live game before showing the replay', () => {
      const h = loadReplayHarness(file);
      h.run(`loadImportedReplay(${JSON.stringify({
        gameId: 'imported-room',
        mapId: 'mistpine',
        playerNames: null,
        finalResult: null,
        hasSchemaVersion: true,
        schemaVersion: '3.9.11',
        events: [],
      })})`);

      expect(h.gameSelect.value).toBe('');
      expect(h.run('activeRecordId')).toBeNull();
      expect(h.run('importedReplayMeta.gameId')).toBe('imported-room');
      expect(h.sync).toHaveBeenCalledTimes(1);
    });

    it('does not PATCH an imported player name to a live game', async () => {
      const h = renameHarness(file);
      await h.run("renamePlayer('player_a')");

      expect(h.prompt).not.toHaveBeenCalled();
      expect(h.fetchMock).not.toHaveBeenCalled();
      expect(h.statusEl.textContent).toContain('回放');
    });

    it('keeps renaming available for a real live game', async () => {
      const h = renameHarness(file, false);
      await h.run("renamePlayer('player_a')");

      expect(h.prompt).toHaveBeenCalledTimes(1);
      expect(h.fetchMock).toHaveBeenCalledWith('/api/games/live-room/rename', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ playerId: 'player_a', name: '新名字' }),
      }));
    });
  });
}
