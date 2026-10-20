#!/usr/bin/env node
// 轻量基准：不引入 benchmark 依赖，输出 p50/p95 与原始样本，写到 temp/perf/。
// 覆盖：持久化全量写、状态响应序列化/克隆、引擎可达格、随机地图生成、回放 JSON 解析。
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { GameStore, createInitialGame } from '../src/state/store.js';
import { sanitizeGameForResponse } from '../src/api/auth.js';
import { findReachableCells } from '../src/engine/validation.js';
import { generateRandomMapConfig } from '../src/config/randomMap.js';
import { loadMaps } from '../src/config/loader.js';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = dirname(SCRIPT_DIR);
const PRESERVE_STATE = process.env.TACTICAL_GAME_STATE_FILE;
delete process.env.TACTICAL_GAME_STATE_FILE;
loadMaps();

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
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    mean: Number((total / Math.max(1, samples.length)).toFixed(3)),
    max: Number(Math.max(...samples, 0).toFixed(3)),
    ...extra,
  };
}

function time(fn) {
  const started = performance.now();
  const value = fn();
  return { ms: performance.now() - started, value };
}

const results = [];
const benchDir = join(PROJECT_DIR, 'temp', 'perf');
mkdirSync(benchDir, { recursive: true });
const stateFile = join(benchDir, 'bench-state.json');

// 1) 持久化：8 局 × 500 事件，测全量 flush。
const store = new GameStore({ persistenceFile: stateFile });
const games = [];
for (let i = 0; i < 8; i++) {
  const game = createInitialGame(`bench-${i}`, 'default');
  for (let seq = game.events.length + 1; seq <= 500; seq++) {
    game.events.push({
      seq,
      type: 'move',
      timestamp: Date.now(),
      payload: { owner: 'player_a', unitId: 'u', toQ: 0, toR: 0, actionsUsed: seq % 30 },
    });
  }
  games.push(game);
}
const saveSamples = [];
for (const game of games) {
  const { ms } = time(() => store.save(game));
  saveSamples.push(ms);
}
results.push(summary('persist.flush (8 games x 500 events)', saveSamples));

// 2) 状态响应：克隆 + 序列化（含全部 events，复现当前默认路径）。
const stateSamples = [];
let stateBytes = 0;
for (const game of games) {
  const { ms, value } = time(() => sanitizeGameForResponse(game));
  stateSamples.push(ms);
  stateBytes = JSON.stringify(value).length;
}
results.push(summary('state.sanitize+clone', stateSamples, { responseBytes: stateBytes }));

// 3) 引擎可达格：同一状态重复查询，命中索引/缓存后的路径。
const engineGame = games[0];
const unit = engineGame.units.find(candidate => candidate.alive);
const reachableSamples = [];
if (unit) {
  findReachableCells(engineGame, unit);
  for (let i = 0; i < 1000; i++) {
    reachableSamples.push(time(() => findReachableCells(engineGame, unit)).ms);
  }
  results.push(summary('engine.reachable (warm)', reachableSamples, { cells: findReachableCells(engineGame, unit).length }));
}

// 4) 随机地图：同一种子重复生成（不含 API 缓存层）。
const randomSamples = [];
for (let i = 0; i < 10; i++) {
  randomSamples.push(time(() => generateRandomMapConfig({ seed: 'bench-seed' }, 8)).ms);
}
results.push(summary('randomMap.generate (8p, same seed)', randomSamples));

// 5) 回放解析：取最大归档 JSON 的 JSON.parse 成本。
const recordsDir = join(PROJECT_DIR, 'records', 'V3');
let largest = null;
try {
  for (const file of readdirSync(recordsDir)) {
    if (!file.endsWith('.json')) continue;
    const full = join(recordsDir, file);
    const size = statSync(full).size;
    if (!largest || size > largest.size) largest = { full, size };
  }
} catch {
  // records 缺失时跳过。
}
if (largest) {
  const replaySamples = [];
  for (let i = 0; i < 20; i++) {
    replaySamples.push(time(() => JSON.parse(readFileSync(largest.full, 'utf8'))).ms);
  }
  results.push(summary('replay.JSON.parse (largest)', replaySamples, { bytes: largest.size }));
}

// 清理临时状态文件，避免 temp/perf 残留大文件。
try {
  if (PRESERVE_STATE) process.env.TACTICAL_GAME_STATE_FILE = PRESERVE_STATE;
  else delete process.env.TACTICAL_GAME_STATE_FILE;
} catch {
  // ignore
}

const payload = { generatedAt: new Date().toISOString(), node: process.version, results };
const out = join(benchDir, `bench-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
writeFileSync(join(benchDir, 'latest.json'), `${JSON.stringify(payload, null, 2)}\n`);

console.log('Benchmark summary (ms)');
for (const row of results) {
  console.log(
    `  ${row.name.padEnd(44)} n=${String(row.samples).padStart(4)} p50=${String(row.p50).padStart(8)} p95=${String(row.p95).padStart(8)} max=${String(row.max).padStart(8)}`
    + (row.responseBytes ? ` bytes=${row.responseBytes}` : '')
    + (row.cells ? ` cells=${row.cells}` : ''),
  );
}
console.log(`\nWrote ${out}`);
