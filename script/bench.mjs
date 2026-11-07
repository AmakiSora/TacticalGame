#!/usr/bin/env node
// 轻量基准：同步单局/全量持久化、完整/投影响应、引擎、随机地图、纯回放解析。
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { GameStore, createInitialGame, gameSnapshotPath } from '../src/state/store.ts';
import { sanitizeGameForResponse } from '../src/api/auth.ts';
import { findReachableCells } from '../src/engine/validation.ts';
import { generateRandomMapConfig } from '../src/config/randomMap.ts';
import { loadMaps } from '../src/config/loader.ts';

const PROJECT_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const SAMPLE_COUNT = 64;
const WARMUP_COUNT = 8;

function percentile(samples, p) {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Number(sorted[index].toFixed(3));
}

function summary(name, samples, extra = {}) {
  const total = samples.reduce((sum, value) => sum + value, 0);
  return {
    name,
    samples: samples.length,
    warmup: WARMUP_COUNT,
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    mean: Number((total / Math.max(1, samples.length)).toFixed(3)),
    max: Number(Math.max(...samples, 0).toFixed(3)),
    ...extra,
  };
}

function measure(fn, count = SAMPLE_COUNT) {
  for (let i = 0; i < WARMUP_COUNT; i++) fn(i);
  const samples = [];
  let value;
  for (let i = 0; i < count; i++) {
    const started = performance.now();
    value = fn(i);
    samples.push(performance.now() - started);
  }
  return { samples, value };
}

export function runBenchmarks({
  benchDir = join(PROJECT_DIR, 'temp', 'perf'),
  recordsDir = join(PROJECT_DIR, 'records', 'V3'),
} = {}) {
  loadMaps();
  mkdirSync(benchDir, { recursive: true });
  const scratchDir = mkdtempSync(join(tmpdir(), 'tg-bench-'));
  const stateFile = join(scratchDir, 'games.json');
  const store = new GameStore({ persistenceFile: stateFile, synchronousFlush: false });
  try {
    const results = [];
    const games = [];
    for (let i = 0; i < 8; i++) {
      const game = createInitialGame(`bench-${i}`, 'default');
      for (let seq = 1; seq <= 500; seq++) {
        game.events.push({
          seq,
          type: 'move',
          timestamp: game.createdAt + seq,
          payload: { owner: 'player_a', unitId: 'u', toQ: 0, toR: 0, actionsUsed: seq % 30 },
        });
      }
      games.push(game);
      store.persist(game);
    }

    const snapshots = measure(i => store.persist(games[i % games.length]));
    results.push(summary('persist.snapshot (1 game x 500 events)', snapshots.samples, {
      bytes: statSync(gameSnapshotPath(stateFile, games[0].id)).size,
    }));
    const flushes = measure(() => store.flushNow());
    results.push(summary('persist.flushNow (8 games x 500 events)', flushes.samples, {
      bytes: statSync(stateFile).size,
    }));

    for (const [name, projection] of [
      ['full', {}],
      ['projected', { events: false, config: false, adjudication: false }],
    ]) {
      const response = measure(i => JSON.stringify(sanitizeGameForResponse(
        games[i % games.length], undefined, projection,
      )));
      results.push(summary(`state.sanitize+serialize (${name})`, response.samples, {
        responseBytes: Buffer.byteLength(response.value, 'utf8'),
      }));
    }

    const engineGame = games[0];
    const unit = engineGame.units.find(candidate => candidate.alive);
    if (unit) {
      const reachable = measure(() => findReachableCells(engineGame, unit), 1000);
      results.push(summary('engine.reachable (warm)', reachable.samples, { cells: reachable.value.length }));
    }

    const random = measure(() => generateRandomMapConfig({ seed: 'bench-seed' }, 8));
    results.push(summary('randomMap.generate (8p, same seed)', random.samples));

    let largest = null;
    try {
      for (const file of readdirSync(recordsDir).sort()) {
        if (!file.endsWith('.json')) continue;
        const full = join(recordsDir, file);
        const stat = statSync(full);
        if (stat.isFile() && (!largest || stat.size > largest.size)) largest = { full, size: stat.size };
      }
    } catch {
      // records 缺失时跳过。
    }
    if (largest) {
      const replayJson = readFileSync(largest.full, 'utf8');
      const replay = measure(() => JSON.parse(replayJson));
      results.push(summary('replay.JSON.parse (largest)', replay.samples, {
        bytes: Buffer.byteLength(replayJson, 'utf8'),
      }));
    }

    const payload = { generatedAt: new Date().toISOString(), node: process.version, results };
    const out = join(benchDir, `bench-${payload.generatedAt.replace(/[:.]/g, '-')}.json`);
    const report = `${JSON.stringify(payload, null, 2)}\n`;
    writeFileSync(out, report);
    writeFileSync(join(benchDir, 'latest.json'), report);

    console.log('Benchmark summary (ms)');
    for (const row of results) {
      console.log(
        `  ${row.name.padEnd(44)} n=${String(row.samples).padStart(4)} p50=${String(row.p50).padStart(8)} p95=${String(row.p95).padStart(8)} max=${String(row.max).padStart(8)}`
        + (row.responseBytes || row.bytes ? ` bytes=${row.responseBytes ?? row.bytes}` : '')
        + (row.cells ? ` cells=${row.cells}` : ''),
      );
    }
    console.log(`\nWrote ${out}`);
    return payload;
  } finally {
    store.cancelScheduledFlush();
    rmSync(scratchDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runBenchmarks();
}
