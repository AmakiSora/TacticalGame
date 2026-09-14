#!/usr/bin/env node
// scripts/algorithm-arena.mjs
//
// 算法竞技场：headless 自博弈评测工具（不启 HTTP 服务，直接驱动引擎）
//
// 用途：算法 AI 的强度标定与合法性回归 —— decide() 返回被引擎拒绝的动作不是日志噪音，
// 线上 runner 遇错会 break 掉整个回合、作废剩余行动点，所以"零非法动作"是硬指标。
//
// 用法（需要 tsx，随 devDependencies 提供）：
//   npx tsx scripts/algorithm-arena.mjs --a threat --b greedy --games 40 --map default
//   npx tsx scripts/algorithm-arena.mjs --a threat --b greedy --games 12 --map multiplayer-ring --players 4
//   npx tsx scripts/algorithm-arena.mjs --a threat --b greedy --map random --games 20 --strict   # 随机地图
//   npx tsx scripts/algorithm-arena.mjs --a threat --b greedy --games 1 --map danger-close --trace 24
//
// 参数：
//   --a / --b     算法名（内置 greedy/random/mcts/threat，或 builtin 目录下的模块名）
//   --games N     局数，逐局交换席位（默认 20）
//   --map ID      地图 ID；`random` 表示按种子生成随机地图（默认 default）
//   --players 2-8 席位数量（默认 2）；--b 之外的一律用 --b 填充
//   --seed-base   起始种子（默认 1000，同种子同地图可完全复现）
//   --trace N     打印前 N 次决策的候选效用（诊断用）
//   --strict      出现任何非法动作即以退出码 1 结束（适合 CI）
import { pathToFileURL } from 'node:url';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadMaps } from '../src/config/loader.js';
import { generateRandomMapConfig } from '../src/config/randomMap.js';
import { createLobby, createLobbyWithConfig, addLobbyPlayer } from '../src/state/store.js';
import { startGame, endTurn, buildAdjudicationScores } from '../src/engine/engine.js';
import { moveUnit } from '../src/engine/units.js';
import { attackTarget, healTarget } from '../src/engine/combat.js';
import { deployUnit } from '../src/engine/deployment.js';
import { demolishTerrain } from '../src/engine/demolition.js';
import { globalEventBus } from '../src/events/bus.js';
import { ALGORITHMS } from '../algorithms/registry.mjs';
import * as utils from '../algorithms/lib/game-utils.mjs';

loadMaps();

// ─── 参数 ───
function parseArgs(argv) {
  const args = { a: 'threat', b: 'greedy', games: 20, map: 'default', players: 2, seedBase: 1000, trace: 0, strict: false };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const val = () => argv[++i];
    if (key === '--a') args.a = val();
    else if (key === '--b') args.b = val();
    else if (key === '--games') args.games = Number(val());
    else if (key === '--map') args.map = val();
    else if (key === '--players') args.players = Number(val());
    else if (key === '--seed-base') args.seedBase = Number(val());
    else if (key === '--trace') args.trace = Number(val());
    else if (key === '--a-file') args.aFile = val();
    else if (key === '--b-file') args.bFile = val();
    else if (key === '--strict') args.strict = true;
    else if (key === '--help' || key === '-h') {
      console.log('见文件头部注释');
      process.exit(0);
    } else throw new Error(`未知参数: ${key}`);
  }
  if (!Number.isInteger(args.players) || args.players < 2 || args.players > 8) throw new Error('--players 需在 2-8');
  return args;
}

const args = parseArgs(process.argv.slice(2));

async function loadAlgorithm(name) {
  const here = dirname(fileURLToPath(import.meta.url));
  const relative = ALGORITHMS[name];
  const file = relative
    ? resolve(here, '..', 'algorithms', relative)
    : resolve(here, '..', 'algorithms', 'builtin', `${name}.mjs`);
  const mod = await import(pathToFileURL(file).href);
  if (!mod.default) throw new Error(`算法 ${name} 缺少 default 导出`);
  return mod.default;
}

/** 与引擎掷骰同款的确定性随机源（用于地图生成与开局播种）。 */
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

/** 客户端视角快照：只给算法它在 API 上看得见的字段。 */
function snapshot(game) {
  return {
    id: game.id, phase: game.phase, winner: game.winner,
    cells: game.cells, map: { terrainCells: game.map.terrainCells },
    units: game.units.map(u => ({ ...u })),
    headquarters: Object.fromEntries(Object.entries(game.headquarters).map(([k, h]) => [k, { ...h }])),
    controlPoints: (game.controlPoints || []).map(p => ({ ...p })),
    players: Object.fromEntries(Object.entries(game.players).map(([k, p]) => [k, { status: p.status }])),
    playerNames: game.playerNames,
    resources: structuredClone(game.resources),
    turn: { ...game.turn },
    config: game.config,
  };
}

function applyAction(game, owner, action) {
  const p = action.payload || {};
  switch (action.type) {
    case 'move': return moveUnit(game, globalEventBus, owner, p.unitId, p.q, p.r);
    case 'attack': return attackTarget(game, globalEventBus, owner, p.attackerId, p.targetId);
    case 'heal': return healTarget(game, globalEventBus, owner, p.supportId, p.targetId);
    case 'deploy': return deployUnit(game, globalEventBus, owner, p.unitType, p.fromId, p.q, p.r);
    case 'demolish': return demolishTerrain(game, globalEventBus, owner, p.unitId, p.q, p.r);
    default: return { ok: false, code: 'unknown_action', message: action.type };
  }
}

const load = async (name, file) => (file ? (await import(pathToFileURL(resolve(process.cwd(), file)).href)).default : await loadAlgorithm(name));
const loadSeat = async (name, file) => {
  const mod = file
    ? (await import(pathToFileURL(resolve(process.cwd(), file)).href)).default
    : await loadAlgorithm(name);
  return { key: mod.name || name, mod };
};
const seatA = await loadSeat(args.a, args.aFile);
const seatB = await loadSeat(args.b, args.bFile);
const algos = { [seatA.key]: seatA.mod, [seatB.key]: seatB.mod };
args.a = seatA.key;
args.b = seatB.key;
const stat = name => ({
  name, wins: 0, games: 0, score: 0, hqDamage: 0, ownHq: 0, cps: 0, army: 0, supplies: 0, merit: 0,
  illegal: {}, mix: {}, turns: 0, turnsWithApLeft: 0, firsts: 0, firstWins: 0,
});
const table = new Map();
const times = [];
let totalIllegal = 0;

for (let i = 0; i < args.games; i++) {
  const seed = args.seedBase + i * 7919;
  const random = mulberry32(seed);
  const seats = [];
  for (let s = 0; s < args.players; s++) seats.push(s === 0 ? args.a : args.b);
  // 逐局交换：A 席位在奇数局挪到最后一位，消先手优势
  if (i % 2 === 1) seats.unshift(seats.pop());

  const lobbyOptions = { maxPlayers: args.players, participate: false };
  const game = args.map === 'random'
    ? createLobbyWithConfig(`arena_${seed}`, 'random', generateRandomMapConfig({ seed }, args.players), lobbyOptions)
    : createLobby(`arena_${seed}`, args.map, lobbyOptions);
  const seatAlgo = {};
  ['player_a', 'player_b', 'player_c', 'player_d', 'player_e', 'player_f', 'player_g', 'player_h'].slice(0, args.players)
    .forEach((seatId, idx) => {
      addLobbyPlayer(game, seats[idx]);
      seatAlgo[seatId] = seats[idx];
      (table.get(seats[idx]) ?? table.set(seats[idx], stat(seats[idx])).get(seats[idx])).games++;
    });

  const started = startGame(game, globalEventBus, random);
  if (!started.ok) throw new Error(`开局失败 (${args.map}/${args.players}人): ${JSON.stringify(started)}`);

  let guard = 0;
  let traceLeft = args.trace;
  while (game.phase === 'active' && guard++ < 20000) {
    const owner = game.turn.currentPlayerId;
    if (!owner) break;
    const name = seatAlgo[owner];
    const row = table.get(name);
    const state = snapshot(game);
    const t0 = performance.now();
    let action = null;
    try {
      action = await algos[name].decide(state, utils);
    } catch (err) {
      row.illegal[`decide 抛异常: ${err.message}`] = (row.illegal[`decide 抛异常: ${err.message}`] || 0) + 1;
      totalIllegal++;
      endTurn(game, globalEventBus, owner);
      continue;
    }
    times.push(performance.now() - t0);

    if (traceLeft > 0) {
      traceLeft--;
      console.log(`  [trace] 回合${game.turn.turnNumber} ${owner}(${name}) 行动点${game.turn.actionsUsed} → ` +
        (action ? `${action.type} ${JSON.stringify(action.payload)}` : 'null（结束回合）'));
    }
    if (!action) {
      const apLeft = Math.max(0, (game.config.balance.actionsPerTurn ?? 5) - game.turn.actionsUsed);
      row.turns++;
      if (apLeft > 0) row.turnsWithApLeft++;
      const ended = endTurn(game, globalEventBus, owner);
      if (!ended.ok) break;
      continue;
    }
    const result = applyAction(game, owner, action);
    if (!result.ok) {
      const key = `${action.type}: ${result.code}`;
      row.illegal[key] = (row.illegal[key] || 0) + 1;
      totalIllegal++;
      endTurn(game, globalEventBus, owner);   // 与真实 runner 一致：动作失败即结束本回合
    } else {
      row.mix[action.type] = (row.mix[action.type] || 0) + 1;
    }
  }

  const scores = buildAdjudicationScores(game);
  const winner = game.winner;
  for (const [seatId, name] of Object.entries(seatAlgo)) {
    const row = table.get(name);
    const s = scores[seatId] ?? {};
    row.score += s.total ?? 0;
    row.hqDamage += s.headquartersDamage ?? 0;
    row.ownHq += s.ownHqHp ?? 0;
    row.cps += (game.controlPoints || []).filter(cp => cp.owner === seatId).length;
    row.army += s.armyValue ?? 0;
    row.supplies += s.supplies ?? 0;
    row.merit += game.players[seatId]?.stats?.actionMerit ?? 0;
    if (seatId === 'player_a') { row.firsts++; if (winner === seatId) row.firstWins++; }
    if (winner === seatId) row.wins++;
  }
  const label = winner ? `${seatAlgo[winner]}（${winner}）` : '无人胜出';
  const illegalKeys = [...table.values()].flatMap(r => Object.keys(r.illegal));
  const scoreNote = Object.entries(seatAlgo)
    .map(([seatId, name]) => `${name}[${seatId}]=${scores[seatId]?.total ?? 0}`).join(' ');
  console.log(`#${i + 1} ${args.map} ${args.players}p winner=${label} reason=${game.result?.reason ?? '-'}` +
    ` 轮数=${game.turn.roundNumber} ${scoreNote}` +
    (illegalKeys.length ? ' | 非法动作见下方汇总' : ''));
}

const pct = p => {
  if (!times.length) return 0;
  const sorted = [...times].sort((x, y) => x - y);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
};

console.log(`\n===== 竞技场：${args.a} vs ${args.b}｜地图 ${args.map}｜${args.players} 席位｜${args.games} 局 =====`);
for (const row of table.values()) {
  const g = Math.max(1, row.games);
  console.log(`${row.name.padEnd(10)} 胜 ${row.wins}/${row.games} 席位局（${(100 * row.wins / row.games).toFixed(0)}%）` +
    ` 均分 ${(row.score / g).toFixed(0)}` +
    ` 先手胜 ${row.firstWins}/${row.firsts}` +
    `｜磨HQ ${(row.hqDamage / g).toFixed(0)} 自HQ ${(row.ownHq / g).toFixed(0)} 据点 ${(row.cps / g).toFixed(1)}` +
    ` 兵力 ${(row.army / g).toFixed(0)} 补给 ${(row.supplies / g).toFixed(0)}` +
    `｜动作/局 ${Object.entries(row.mix).map(([k, v]) => `${k}:${(v / g).toFixed(1)}`).join(' ') || '无'}` +
    `｜带AP交回合 ${row.turnsWithApLeft}/${row.turns}`);
  for (const [key, count] of Object.entries(row.illegal)) {
    console.log(`    !! ${row.name} 非法动作 ${key} ×${count}`);
  }
}
console.log(`决策耗时 n=${times.length} p50=${pct(0.5).toFixed(2)}ms p95=${pct(0.95).toFixed(2)}ms ` +
  `p99=${pct(0.99).toFixed(2)}ms max=${pct(1).toFixed(1)}ms`);
console.log(totalIllegal === 0 ? '合法性：全部动作均被引擎接受 ✅' : `合法性：共 ${totalIllegal} 次非法动作 ❌`);
if (args.strict && totalIllegal > 0) process.exitCode = 1;
