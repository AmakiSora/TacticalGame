#!/usr/bin/env node
// scripts/tempo_benchmark.mjs
//
// 无服务器基准：真实 TS 引擎进程内驱动算法对打（与 rl/training/local-worker.ts
// 的 decide 通道同口径——每步只暴露该座位自己的 myQueue、携带 adjudication 快照、
// 由引擎 queue*Action 做计划期校验、commitAndMaybeResolve 结算）。
//
// 用法：
//   node scripts/tempo_benchmark.mjs [每对每图局数=20] [matchups=all|tempo|control]
// 输出：每 (对局组合 × 地图) 的 胜/负/和、胜率、平均轮数、非法动作数、决策耗时；
// 明细 JSON 落在 temp/tempo-bench/<时间戳>.json（temp/ 已 gitignore）。

import { EventBus } from '../dist/events/bus.js';
import { startGame, buildAdjudicationSnapshot } from '../dist/engine/engine.js';
import { commitAndMaybeResolve } from '../dist/engine/simultaneous.js';
import {
  queueAttackAction, queueDeployAction, queueDemolishAction, queueHealAction,
  queueMoveAction, queueWaitAction,
} from '../dist/engine/planning.js';
import { createLobby, addLobbyPlayer } from '../dist/state/store.js';
import { loadMaps } from '../dist/config/loader.js';
import { isSimultaneousMode } from '../dist/types.js';
// @ts-expect-error 算法模块为 ESM .mjs
import { pathToFileURL } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import { loadAlgorithm } from '../algorithms/registry.mjs';
// @ts-expect-error 同上
import * as utils from '../algorithms/lib/game-utils.mjs';

const GAMES = Number(process.argv[2] ?? 20);
const WHICH = process.argv[3] ?? 'all';
const MAPS = (process.env.TEMPO_MAPS ?? 'standoff,molten-throne').split(',').map(s => s.trim()).filter(Boolean);

const MATCHUPS = {
  tempo: [
    ['tempo', 'dest-prob'],
    ['tempo', 'kriegspiel'],
    ['tempo', 'matrix-eq'],
    ['tempo', 'random-sim'],
  ],
  control: [
    ['dest-prob', 'random-sim'],
    ['kriegspiel', 'random-sim'],
  ],
  all: null,
};
MATCHUPS.all = [...MATCHUPS.tempo, ...MATCHUPS.control];
const PAIRS = process.env.TEMPO_PAIRS
  ? process.env.TEMPO_PAIRS.split(',').map(spec => spec.split(':').map(s => s.trim()))
  : (WHICH === 'all' ? MATCHUPS.all : (MATCHUPS[WHICH] ?? MATCHUPS.tempo));

/** 支持算法名或 .mjs 文件路径（A/B 对照版本用）。 */
async function loadAny(name) {
  if (name.includes('/') || name.endsWith('.mjs')) {
    const mod = await import(pathToFileURL(resolvePath(name)).href);
    return mod.default;
  }
  return loadAlgorithm(name);
}

loadMaps();

const MAX_PLAN_ACTIONS = 15;
const MAX_REJECTIONS = 20;
const MAX_ROUNDS = 40;

/** mulberry32：与引擎/自博弈脚本同族，保证可复现。 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 与 local-worker / REST 同口径的座位视图：隐藏对手队列、剥离 token 与 rngState。 */
function snapshotFor(game, viewer) {
  const { tokens: _t, hostToken: _h, rngState: _r, events, ...rest } = game;
  const body = structuredClone({
    ...rest,
    events: events.slice(-80),
    adjudication: buildAdjudicationSnapshot(game),
  });
  if (isSimultaneousMode(game.config.mode) && body.plan) {
    const myQueue = game.plan?.queues?.[viewer] ? structuredClone(game.plan.queues[viewer]) : [];
    body.plan = {
      ...body.plan,
      queues: myQueue.length > 0 ? { [viewer]: myQueue } : {},
      myQueue,
    };
  }
  return body;
}

function applyPlanned(game, seat, action) {
  const p = action.payload ?? {};
  switch (action.type) {
    case 'move': return queueMoveAction(game, seat, p.unitId, p.q, p.r);
    case 'attack': return queueAttackAction(game, seat, p.attackerId, p.q, p.r);
    case 'heal': return queueHealAction(game, seat, p.supportId, p.q, p.r);
    case 'deploy': return queueDeployAction(game, seat, p.unitType, p.fromId, p.q, p.r);
    case 'demolish': return queueDemolishAction(game, seat, p.unitId, p.q, p.r);
    case 'wait': return queueWaitAction(game, seat);
    default: return { ok: false, code: 'unknown_action', message: `unknown action ${action.type}` };
  }
}

/** 一个座位的计划阶段：decide 逐条入队，被拒动作记住后重问（interfaces.mjs 语义）。 */
async function planFor(game, bus, seat, algo, stats) {
  let actions = 0;
  let rejections = 0;
  const rejected = new Set();
  while (actions < MAX_PLAN_ACTIONS && rejections < MAX_REJECTIONS) {
    const view = snapshotFor(game, seat);
    const t0 = process.hrtime.bigint();
    let action;
    try {
      action = await algo.decide(view, utils, { owner: seat });
    } catch (err) {
      stats.errors.push(`${algo.name ?? seat}: ${err.message}`);
      break;
    } finally {
      stats.decideMs += Number(process.hrtime.bigint() - t0) / 1e6;
      stats.decides += 1;
    }
    if (!action) break;
    const key = JSON.stringify({ type: action.type, payload: action.payload ?? {} });
    if (rejected.has(key)) { rejections += 1; continue; }
    const result = applyPlanned(game, seat, action);
    if (!result?.ok) {
      rejected.add(key);
      rejections += 1;
      stats.illegal += 1;
      if (stats.illegalSamples.length < 5) {
        stats.illegalSamples.push(`${action.type} ${JSON.stringify(action.payload)}: ${result?.code ?? '?'} ${result?.message ?? ''}`);
      }
      continue;
    }
    actions += 1;
  }
  if (rejections >= MAX_REJECTIONS) stats.rejectionCap += 1;
  commitAndMaybeResolve(game, bus, seat);
}

async function runGame(mapId, seatA, seatB, algos, seed) {
  const game = createLobby(`bench-${seed}`, mapId, { maxPlayers: 2, participate: true, playerName: 'A' });
  addLobbyPlayer(game, 'B');
  const bus = new EventBus();
  const started = startGame(game, bus, mulberry32(seed));
  if (!started.ok) throw new Error(`startGame failed: ${started.code}`);
  const stats = { decideMs: 0, decides: 0, illegal: 0, illegalSamples: [], errors: [], rejectionCap: 0 };
  let rounds = 0;
  while (game.phase === 'active' && rounds < MAX_ROUNDS) {
    await planFor(game, bus, 'player_a', algos[seatA], stats);
    if (game.phase !== 'active') break;
    await planFor(game, bus, 'player_b', algos[seatB], stats);
    rounds += 1;
  }
  return { game, stats, rounds };
}

function pct(w, n) {
  return n > 0 ? `${((w / n) * 100).toFixed(1)}%` : '-';
}

const results = [];
for (const [nameA, nameB] of PAIRS) {
  const algos = { [nameA]: await loadAny(nameA), [nameB]: await loadAny(nameB) };
  for (const mapId of MAPS) {
    const row = {
      map: mapId, pair: `${nameA} vs ${nameB}`,
      games: 0, aWins: 0, bWins: 0, draws: 0,
      rounds: 0, illegal: 0, errors: 0, rejectionCaps: 0, decideMs: 0, decides: 0,
      samples: [], durationMs: 0,
    };
    const t0 = Date.now();
    for (let i = 0; i < GAMES; i++) {
      const seed = (0x9e3779b1 ^ (i * 2654435761) ^ [...`${nameA}${nameB}${mapId}`].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) >>> 0;
      // 交替座位：偶数局 A 坐 player_a，奇数局 A 坐 player_b。
      const aSeat = i % 2 === 0 ? 'player_a' : 'player_b';
      const bSeat = aSeat === 'player_a' ? 'player_b' : 'player_a';
      const { game, stats, rounds } = await runGame(
        mapId,
        aSeat === 'player_a' ? nameA : nameB,
        bSeat === 'player_a' ? nameA : nameB,
        { ...algos },
        seed + i,
      );
      row.games += 1;
      row.rounds += rounds;
      row.illegal += stats.illegal;
      row.errors += stats.errors.length;
      row.rejectionCaps += stats.rejectionCap;
      row.decideMs += stats.decideMs;
      row.decides += stats.decides;
      for (const s of stats.illegalSamples) if (row.samples.length < 6) row.samples.push(`${mapId}#${i} ${s}`);
      for (const s of stats.errors) if (row.samples.length < 6) row.samples.push(`${mapId}#${i} ${s}`);
      const winner = game.winner;
      if (!winner) row.draws += 1;
      else if (winner === aSeat) row.aWins += 1;
      else row.bWins += 1;
    }
    row.durationMs = Date.now() - t0;
    results.push(row);
    console.log(
      `${row.pair.padEnd(26)} ${mapId.padEnd(14)} ` +
      `${row.games}局 A胜${row.aWins} 负${row.bWins} 和${row.draws} A胜率${pct(row.aWins, row.games)} ` +
      `| 均${(row.rounds / row.games).toFixed(1)}轮 非法${row.illegal} 拒绝上限${row.rejectionCaps} 错${row.errors} ` +
      `| decide ${(row.decideMs / Math.max(1, row.decides)).toFixed(1)}ms (${(row.durationMs / 1000).toFixed(0)}s)`,
    );
    for (const s of row.samples) console.log(`    ! ${s}`);
  }
}

// 汇总：按对手合并两张图。
const summary = new Map();
for (const row of results) {
  if (!summary.has(row.pair)) summary.set(row.pair, { games: 0, aWins: 0, bWins: 0, draws: 0 });
  const s = summary.get(row.pair);
  s.games += row.games; s.aWins += row.aWins; s.bWins += row.bWins; s.draws += row.draws;
}
console.log('\n== 汇总（两图合并）==');
for (const [pair, s] of summary) {
  console.log(`${pair.padEnd(26)} ${s.games}局  A ${s.aWins} / B ${s.bWins} / 和 ${s.draws}  → A 胜率 ${pct(s.aWins, s.games)}`);
}

const outDir = new URL('../temp/tempo-bench/', import.meta.url);
const { mkdirSync, writeFileSync } = await import('node:fs');
mkdirSync(outDir, { recursive: true });
const file = new URL(`bench-${Date.now()}.json`, outDir);
writeFileSync(file, JSON.stringify({ games: GAMES, maps: MAPS, results, summary: [...summary] }, null, 2));
console.log(`\n明细已写入 ${file.pathname}`);
