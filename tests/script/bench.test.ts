import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as auth from '../../src/api/auth.js';
import { GameStore } from '../../src/state/store.js';
import { resetMetrics } from '../../src/utils/metrics.js';
import { runBenchmarks } from '../../script/bench.mjs';

vi.mock('node:fs', async (importOriginal) => ({ ...await importOriginal<typeof import('node:fs')>() }));

let tempDir: string | null = null;

function fixture() {
  tempDir = fs.mkdtempSync(join(tmpdir(), 'tg-bench-test-'));
  const benchDir = join(tempDir, 'perf');
  const recordsDir = join(tempDir, 'records');
  fs.mkdirSync(join(benchDir, 'store'), { recursive: true });
  fs.mkdirSync(recordsDir);
  const preserved = [
    join(benchDir, 'bench-state.json'),
    join(benchDir, 'bench-state.json.bak'),
    join(benchDir, 'store', 'bench-0.json'),
    join(tempDir, 'configured-state.json'),
  ];
  for (const file of preserved) fs.writeFileSync(file, 'untouched');
  vi.stubEnv('TACTICAL_GAME_STATE_FILE', preserved[3]!);
  vi.useFakeTimers();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  return { benchDir, recordsDir, preserved };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  resetMetrics();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe('benchmark measurement and isolation', () => {
  it('times the actual operations, reports UTF-8 bytes, and removes only its own snapshots', () => {
    const { benchDir, recordsDir, preserved } = fixture();
    const replayJson = JSON.stringify({ events: [{ text: '测试回放' }] });
    const replayFile = join(recordsDir, 'largest.json');
    fs.writeFileSync(replayFile, replayJson);
    fs.writeFileSync(join(recordsDir, 'small.json'), '{}');
    const scratch = vi.spyOn(fs, 'mkdtempSync');
    const save = vi.spyOn(GameStore.prototype, 'save');
    const persist = vi.spyOn(GameStore.prototype, 'persist');
    const flush = vi.spyOn(GameStore.prototype, 'flushNow');
    const sanitize = auth.sanitizeGameForResponse;
    const read = fs.readFileSync;
    const stringify = JSON.stringify;
    const parse = JSON.parse;
    const responses = new Map<string, string>();
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    vi.spyOn(auth, 'sanitizeGameForResponse').mockImplementation((...args) => {
      clock += 10;
      return sanitize(...args);
    });
    vi.spyOn(JSON, 'stringify').mockImplementation((value, replacer, space) => {
      const json = stringify(value, replacer as never, space);
      if (value?.id?.startsWith('bench-') && !value.tokens) {
        clock += 1;
        responses.set(value.events ? 'full' : 'projected', json);
      }
      return json;
    });
    const reads = vi.spyOn(fs, 'readFileSync').mockImplementation((path, options) => {
      if (path === replayFile) clock += 1000;
      return read(path, options);
    });
    vi.spyOn(JSON, 'parse').mockImplementation((text, reviver) => {
      if (text === replayJson) clock += 2;
      return parse(text, reviver);
    });

    const payload = runBenchmarks({ benchDir, recordsDir });

    expect(payload.results).toHaveLength(7);
    for (const name of ['full', 'projected']) {
      const row = payload.results.find(result => result.name === `state.sanitize+serialize (${name})`)!;
      expect(row).toMatchObject({ samples: 64, warmup: 8, p50: 11, p95: 11 });
      const json = responses.get(name)!;
      expect(row.responseBytes).toBe(Buffer.byteLength(json, 'utf8'));
      expect(row.responseBytes).toBeGreaterThan(json.length);
    }
    expect(parse(responses.get('full')!).events).toHaveLength(500);
    const projected = parse(responses.get('projected')!);
    for (const key of ['events', 'config', 'adjudication', 'tokens', 'hostToken']) {
      expect(projected).not.toHaveProperty(key);
    }
    expect(payload.results.find(result => result.name.startsWith('replay.'))).toMatchObject({
      samples: 64, warmup: 8, p50: 2, p95: 2, bytes: Buffer.byteLength(replayJson, 'utf8'),
    });
    expect(reads.mock.calls.filter(([path]) => path === replayFile)).toHaveLength(1);
    expect(reads.mock.calls.some(([path]) => preserved.includes(String(path)))).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(persist).toHaveBeenCalledTimes(8 + 8 + 64);
    expect(flush).toHaveBeenCalledTimes(8 + 64);
    for (const instance of flush.mock.instances) {
      expect((instance as GameStore).size()).toBe(8);
      expect((instance as GameStore).flushScheduled).toBe(false);
    }
    expect(scratch).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(scratch.mock.results[0]!.value)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    for (const file of preserved) expect(read(file, 'utf8')).toBe('untouched');
    expect(process.env.TACTICAL_GAME_STATE_FILE).toBe(preserved[3]);
    expect(parse(read(join(benchDir, 'latest.json'), 'utf8'))).toEqual(payload);
    expect(fs.readdirSync(benchDir).filter(name => /^bench-\d.*\.json$/.test(name))).toHaveLength(1);
  });

  it('cleans snapshots and scheduled timers even when a benchmark fails', () => {
    const { benchDir, recordsDir, preserved } = fixture();
    const scratch = vi.spyOn(fs, 'mkdtempSync');
    const persist = GameStore.prototype.persist;
    const failure = new Error('injected benchmark failure');
    vi.spyOn(GameStore.prototype, 'persist').mockImplementation(function (this: GameStore, game) {
      persist.call(this, game);
      this.flush();
      expect(this.flushScheduled).toBe(true);
      throw failure;
    });

    expect(() => runBenchmarks({ benchDir, recordsDir })).toThrow(failure);

    expect(scratch).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(scratch.mock.results[0]!.value)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(fs.existsSync(join(benchDir, 'latest.json'))).toBe(false);
    for (const file of preserved) expect(fs.readFileSync(file, 'utf8')).toBe('untouched');
    expect(process.env.TACTICAL_GAME_STATE_FILE).toBe(preserved[3]);
  });
});
