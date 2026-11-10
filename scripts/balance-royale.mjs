#!/usr/bin/env node
// scripts/balance-royale.mjs
//
// 大逃杀（royale）/歼灭（annihilation）地图的 headless 数值平衡评测。
// 不启 HTTP 服务，直接驱动 src/engine，算法看到的快照与线上
// sanitizeGameForResponse 完全一致；逐局固定种子 + 交换席位，可复现。
//
// 用法：
//   npx tsx scripts/balance-royale.mjs --map mirror-lake --games 40 --a apex --b apex --label baseline
//   npx tsx scripts/balance-royale.mjs --map mirror-lake --games 40 --a apex --b apex --label v1 \
//       --patch '{"annihilation":{"artillery":{"startRound":8}}}' --out temp/balance/v1.json
//   npx tsx scripts/balance-royale.mjs --map mirror-lake --games 40 --label v1 --patch @temp/balance/v1.patch.json
//
// 参数：
//   --a / --b      两个席位的算法（默认 apex / apex，同算法镜像局用于测地图偏差）
//   --games N      局数（默认 20），奇数局交换两个算法所在席位
//   --map ID       地图 ID（默认 mirror-lake）
//   --seed-base N  起始种子（默认 1000；同种子 + 同配置完全复现）
//   --patch JSON   深合并到地图配置的改动；`@path` 表示从文件读 JSON
//   --label        本次运行标签，写进结果
//   --out PATH     把逐局明细 + 汇总写成 JSON
//   --max-rounds N 单局轮数上限，超出记为 timeout_guard（默认 60）
//   --quiet        不打印逐局日志
//
// 输出指标：席位/出生点/结算首位/算法胜率、终局原因分布、轮数分布、双方
// 兵力值与补给结余、部署与动作构成、被拒动作、炮火致死占比、中心维修点控制轮数。
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

import { loadMaps, getMapConfig } from '../src/config/loader.js';
import { createLobbyWithConfig, addLobbyPlayer } from '../src/state/store.js';
import { startGame, buildAdjudicationScores } from '../src/engine/engine.js';
import { sanitizeGameForResponse } from '../src/api/auth.js';
import { commitAndMaybeResolve, forceResolveRound } from '../src/engine/simultaneous.js';
import {
  queueDeployAction, queueMoveAction, queueAttackAction, queueHealAction,
  queueDemolishAction, queueWaitAction,
} from '../src/engine/planning.js';
import { globalEventBus } from '../src/events/bus.js';
import { ALGORITHMS } from '../algorithms/registry.mjs';
import * as utils from '../algorithms/lib/game-utils.mjs';

loadMaps();
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

function parseArgs(argv) {
  const args = {
    a: 'apex', b: 'apex', games: 20, map: 'mirror-lake', seedBase: 1000,
    patch: null, label: '', out: null, maxRounds: 60, quiet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => argv[++i];
    if (k === '--a') args.a = v();
    else if (k === '--b') args.b = v();
    else if (k === '--games') args.games = Number(v());
    else if (k === '--map') args.map = v();
    else if (k === '--seed-base') args.seedBase = Number(v());
    else if (k === '--patch') args.patch = v();
    else if (k === '--label') args.label = v();
    else if (k === '--out') args.out = v();
    else if (k === '--max-rounds') args.maxRounds = Number(v());
    else if (k === '--quiet') args.quiet = true;
    else throw new Error(`未知参数: ${k}`);
  }
  return args;
}

function deepMerge(base, patch) {
  if (Array.isArray(patch)) return structuredClone(patch);
  if (patch === null || typeof patch !== 'object') return patch;
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base?.[k] && typeof base[k] === 'object'
      ? deepMerge(base[k], v)
      : structuredClone(v);
  }
  return out;
}

function loadPatch(spec) {
  if (!spec) return {};
  const text = spec.startsWith('@') ? readFileSync(resolve(ROOT, spec.slice(1)), 'utf8') : spec;
  return JSON.parse(text);
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function loadAlgorithm(name) {
  const relative = ALGORITHMS[name] ?? `./builtin/${name}.mjs`;
  const file = resolve(ROOT, 'algorithms', relative);
  const mod = await import(pathToFileURL(file).href);
  if (!mod.default?.decide) throw new Error(`算法 ${name} 没有 decide() 接口`);
  return mod.default;
}

/** 与线上 GET /api/games/:id 完全同构的客户端视角快照。 */
function snapshot(game, viewer) {
  return sanitizeGameForResponse(game, viewer);
}

function queueAction(game, owner, action) {
  const p = action.payload ?? {};
  const unitAt = id => game.units.find(u => u.id === id);
  const targetCell = () => {
    if (typeof p.q === 'number' && typeof p.r === 'number') return [p.q, p.r];
    const target = unitAt(p.targetId);
    return target ? [target.q, target.r] : [undefined, undefined];
  };
  switch (action.type) {
    case 'move': return queueMoveAction(game, owner, p.unitId, p.q, p.r);
    case 'attack': {
      const [q, r] = targetCell();
      return queueAttackAction(game, owner, p.attackerId, q, r);
    }
    case 'heal': {
      const [q, r] = targetCell();
      return queueHealAction(game, owner, p.supportId, q, r);
    }
    case 'deploy': return queueDeployAction(game, owner, p.unitType, p.fromId, p.q, p.r);
    case 'demolish': return queueDemolishAction(game, owner, p.unitId, p.q, p.r);
    case 'wait': return queueWaitAction(game, owner);
    default: return { ok: false, code: 'unknown_action', message: action.type };
  }
}

function armyValue(game, owner) {
  return game.units.filter(u => u.owner === owner && u.alive)
    .reduce((sum, u) => sum + Math.round(u.cost * (u.hp / u.maxHp)), 0);
}

async function playOneGame({ seed, config, mapId, algoBySeat, maxRounds }) {
  const random = mulberry32(seed);
  const game = createLobbyWithConfig(`balance_${seed}`, mapId, config, { maxPlayers: 2, participate: false });
  const seatIds = ['player_a', 'player_b'];
  for (const seatId of seatIds) {
    const added = addLobbyPlayer(game, seatId);
    if (!added || added.id !== seatId) throw new Error('席位分配异常');
  }
  const started = startGame(game, globalEventBus, random);
  if (!started.ok) throw new Error(`开局失败: ${JSON.stringify(started)}`);

  const seatSlot = Object.fromEntries(seatIds.map(id => [id, game.players[id].spawnSlotId]));
  const turnOrder = [...game.turn.turnOrder];
  const rejectCounts = { player_a: 0, player_b: 0 };
  const actionMix = { player_a: {}, player_b: {} };
  const queuedCounts = { player_a: 0, player_b: 0 };
  const roundLog = [];
  let guard = 0;

  while (game.phase === 'active' && guard++ < maxRounds) {
    const roundBefore = game.turn.roundNumber;
    const active = turnOrder.filter(id => game.players[id]?.status === 'active');

    // 计划期：逐个 decide → 入队；每次重新取快照，让算法看到自己已排的队列。
    for (const owner of active) {
      const algo = algoBySeat[owner];
      const rejected = new Set();
      let rejects = 0;
      let steps = 0;
      const budget = config.balance.actionsPerTurn ?? 5;
      while (steps < budget + 4 && rejects < 20) {
        const view = snapshot(game, owner);
        const action = await algo.decide(view, utils, { owner });
        if (!action) break;
        const key = JSON.stringify(action);
        if (rejected.has(key)) { rejects++; continue; }
        const res = queueAction(game, owner, action);
        if (!res.ok) {
          rejected.add(key);
          rejects++;
          rejectCounts[owner]++;
          continue;
        }
        actionMix[owner][action.type] = (actionMix[owner][action.type] ?? 0) + 1;
        queuedCounts[owner]++;
        steps++;
      }
    }

    // 提交：最后一人确认触发同步结算；若只有一名存活玩家则房主强制结算。
    let resolved = false;
    for (const owner of active) {
      if (game.phase !== 'active') break;
      const res = commitAndMaybeResolve(game, globalEventBus, owner);
      if (!res.ok) throw new Error(`提交失败 ${owner}: ${JSON.stringify(res)}`);
      if (game.turn.roundNumber > roundBefore) resolved = true;
    }
    if (!resolved && game.phase === 'active') {
      const res = forceResolveRound(game, globalEventBus);
      if (!res.ok) throw new Error(`强制结算失败: ${JSON.stringify(res)}`);
    }

    const center = game.controlPoints.find(cp => cp.kind === 'repair' || cp.id === 'cp_isle');
    roundLog.push({
      round: roundBefore,
      safeRadius: game.artillery?.safeRadius ?? null,
      alive: Object.fromEntries(seatIds.map(id => [id, game.units.filter(u => u.owner === id && u.alive).length])),
      army: Object.fromEntries(seatIds.map(id => [id, armyValue(game, id)])),
      supplies: Object.fromEntries(seatIds.map(id => [id, game.resources[id]?.supplies ?? 0])),
      centerOwner: center?.owner ?? null,
    });
  }

  const deaths = game.events.filter(e => e.type === 'unit_death');
  const deathCauses = {};
  for (const e of deaths) {
    const cause = e.payload?.cause ?? e.data?.cause ?? 'unknown';
    deathCauses[cause] = (deathCauses[cause] ?? 0) + 1;
  }
  const income = { player_a: 0, player_b: 0 };
  for (const e of game.events) {
    if (e.type !== 'income') continue;
    const owner = e.payload?.owner ?? e.data?.owner;
    const amount = e.payload?.amount ?? e.data?.amount ?? 0;
    if (owner in income) income[owner] += amount;
  }
  const scores = buildAdjudicationScores(game);
  const timedOut = game.phase === 'active';
  const center = game.controlPoints.find(cp => cp.kind === 'repair' || cp.id === 'cp_isle');

  return {
    seed,
    winner: timedOut ? null : game.winner,
    reason: timedOut ? 'timeout_guard' : (game.result?.reason ?? null),
    rounds: game.turn.roundNumber,
    seatSlot, turnOrder, firstResolver: turnOrder[0],
    algoBySeat,
    army: Object.fromEntries(seatIds.map(id => [id, armyValue(game, id)])),
    alive: Object.fromEntries(seatIds.map(id => [id, game.units.filter(u => u.owner === id && u.alive).length])),
    supplies: Object.fromEntries(seatIds.map(id => [id, game.resources[id]?.supplies ?? 0])),
    income,
    killValue: Object.fromEntries(seatIds.map(id => [id, game.players[id]?.stats?.killValue ?? 0])),
    score: Object.fromEntries(seatIds.map(id => [id, scores[id]?.total ?? 0])),
    deaths, deathCauses,
    centerOwnerRounds: Object.fromEntries(seatIds.map(id => [
      id, roundLog.filter(r => r.centerOwner === id).length,
    ])),
    centerFinalOwner: center?.owner ?? null,
    rejectCounts, queuedCounts, actionMix,
    totalUnitsCreated: game.units.length,
    roundLog,
  };
}

function summarize(games, args, patch) {
  const n = games.length;
  const count = fn => games.filter(fn).length;
  const bySeat = { player_a: 0, player_b: 0, draw: 0 };
  const bySlot = {}, byAlgo = {}, byReason = {}, byFirst = { yes: 0, no: 0 };
  const roundsArr = [];
  let sumArmyDiff = 0, sumSupplies = 0, sumIncome = 0, sumRejects = 0, sumQueued = 0;
  let artilleryDeaths = 0, combatDeaths = 0, centerRoundsTotal = 0;
  for (const g of games) {
    if (!g.winner) bySeat.draw++;
    else bySeat[g.winner]++;
    if (g.winner) {
      const slot = g.seatSlot[g.winner];
      bySlot[slot] = (bySlot[slot] ?? 0) + 1;
      const algo = g.algoBySeat[g.winner];
      byAlgo[algo] = (byAlgo[algo] ?? 0) + 1;
      byFirst[g.winner === g.firstResolver ? 'yes' : 'no']++;
    }
    byReason[g.reason] = (byReason[g.reason] ?? 0) + 1;
    roundsArr.push(g.rounds);
    const loser = g.winner === 'player_a' ? 'player_b' : 'player_a';
    sumArmyDiff += Math.abs((g.army.player_a ?? 0) - (g.army.player_b ?? 0));
    sumSupplies += (g.supplies[g.winner ?? loser] ?? 0);
    sumIncome += (g.income.player_a ?? 0) + (g.income.player_b ?? 0);
    sumRejects += g.rejectCounts.player_a + g.rejectCounts.player_b;
    sumQueued += g.queuedCounts.player_a + g.queuedCounts.player_b;
    artilleryDeaths += g.deathCauses.artillery ?? 0;
    combatDeaths += Object.entries(g.deathCauses)
      .filter(([k]) => k !== 'artillery' && k !== 'unknown').reduce((s, [, v]) => s + v, 0);
    centerRoundsTotal += g.centerOwnerRounds.player_a + g.centerOwnerRounds.player_b;
  }
  roundsArr.sort((a, b) => a - b);
  const mean = a => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
  return {
    label: args.label || 'run', map: args.map, algorithms: [args.a, args.b], games: n,
    seedBase: args.seedBase, patch,
    winBySeat: bySeat, winBySlot: bySlot, winByAlgorithm: byAlgo, winByFirstResolver: byFirst,
    reasonDistribution: byReason,
    rounds: {
      min: roundsArr[0], p50: roundsArr[Math.floor(n / 2)], mean: +mean(roundsArr).toFixed(2),
      max: roundsArr[n - 1],
    },
    avgArmyGapAtEnd: +(sumArmyDiff / n).toFixed(1),
    avgWinnerSuppliesLeft: +(sumSupplies / n).toFixed(1),
    avgIncomePerGame: +(sumIncome / n).toFixed(1),
    avgRejectedActionsPerGame: +(sumRejects / n).toFixed(2),
    avgQueuedActionsPerGame: +(sumQueued / n).toFixed(1),
    artilleryDeaths, combatDeaths,
    artilleryDeathShare: +((artilleryDeaths / Math.max(1, artilleryDeaths + combatDeaths)) * 100).toFixed(1),
    centerHeldRoundsTotal: centerRoundsTotal,
    timeoutGames: count(g => g.reason === 'timeout_guard'),
  };
}

const args = parseArgs(process.argv.slice(2));
const patch = loadPatch(args.patch);
const baseConfig = getMapConfig(args.map);
const config = deepMerge(baseConfig, patch);
const algoA = await loadAlgorithm(args.a);
const algoB = await loadAlgorithm(args.b);
const games = [];

for (let i = 0; i < args.games; i++) {
  const seed = args.seedBase + i * 7919;
  const swapped = i % 2 === 1;
  const algoBySeat = swapped
    ? { player_a: args.b, player_b: args.a }
    : { player_a: args.a, player_b: args.b };
  const resolved = {
    player_a: swapped ? algoB : algoA,
    player_b: swapped ? algoA : algoB,
  };
  const g = await playOneGame({ seed, config, mapId: args.map, algoBySeat: resolved, maxRounds: args.maxRounds });
  g.algoBySeat = algoBySeat;
  games.push(g);
  if (!args.quiet) {
    const w = g.winner ? `${g.winner}(${g.seatSlot[g.winner]}/${g.algoBySeat[g.winner]})` : 'draw';
    console.log(`#${i + 1} seed=${seed} winner=${w} reason=${g.reason} rounds=${g.rounds}` +
      ` army=${g.army.player_a}/${g.army.player_b} rejected=${g.rejectCounts.player_a + g.rejectCounts.player_b}`);
  }
}

const summary = summarize(games, args, patch);
console.log('\n===== 平衡评测汇总 =====');
console.log(JSON.stringify(summary, null, 2));
if (args.out) {
  const out = resolve(ROOT, args.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ summary, games }, null, 2));
  console.log(`\n明细已写入 ${out}`);
}
