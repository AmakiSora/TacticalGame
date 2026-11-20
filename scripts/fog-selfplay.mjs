#!/usr/bin/env node
// scripts/fog-selfplay.mjs
//
// 迷雾模式（fog）headless 自对局跑批：不启 HTTP 服务，直接驱动真实引擎。
//
// 用途：验证 `fog-scout` 基线在两张首批迷雾图上的合法性与完整对局能力。
// - 2 人 `fog-harbor`（雾港，全程迷雾，20 轮）
// - 3 人 `fog-crossing`（雾渡，最后 3 轮揭雾，24 轮）
//
// 每个决策都只拿到「服务端玩家投影」：units = unitsForViewer（己方 + 视野内敌军）、
// fog = fogProjectionFor（visibleCells + lastSeen 残影）、plan.myQueue 只含自己的队列。
// 这样脚本同时是保密口径的回归：算法无法从完整状态里偷看隐藏单位。
//
// 动作入队走引擎 planning.ts 的 queueXxxAction（与 HTTP 入队校验同一实现），
// 任何被拒动作都计入 illegal（线上 runner 遇拒会空耗重问配额，所以硬指标是 0）。
//
// 用法：
//   node scripts/fog-selfplay.mjs --games 1
//   node scripts/fog-selfplay.mjs --games 4 --seed 1000 --json
//   node scripts/fog-selfplay.mjs --map fog-harbor --games 2 --trace
//   node scripts/fog-selfplay.mjs --games 60 --detail --out temp/fog-mind/baseline.json
//   node scripts/fog-selfplay.mjs --map fog-harbor --games 24 --set balance.adjudicationWeights.controlPoint=40
//
// 参数：
//   --games N       每张图的对局数（默认 1；每局固定换新种子）
//   --seed N        起始种子（默认 20261120，同种子完全可复现）
//   --map ID        只跑指定地图（fog-harbor / fog-crossing；默认两张都跑）
//   --trace         打印每个座位的入队动作（诊断合法性用）
//   --json          结束时额外输出一行完整 JSON（CI / 存档用）
//   --detail        额外采集逐轮时间线（据点归属/HQ 血量/残留兵力/攻击目标分类）
//   --out PATH      把完整报告（含 summary）写入文件；目录不存在会自动创建
//   --config PATH   叠加一份地图配置补丁（JSON，深合并；需配合 --map）；只影响本次跑批，
//                    不写 maps/**，用于参数标定实验（如 CP 权重、揭雾轮次、HQ 血量）
//   --help, -h      显示帮助
//
// 退出码：0 = 全部对局完成且 0 非法动作；1 = 有非法动作 / 未完赛 / 参数错误。
//
// 本脚本用 .mjs 写成，但引擎是 TS 源码（src/**/*.ts，内部 import 带 .js 后缀）。
// 直接 `node` 无法解析 .js → .ts，因此入口先以 `node --import tsx` 重新执行自己；
// tsx 是 devDependencies 依赖，无需额外安装，也不改调用方式。

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const TSX_SENTINEL = 'FOG_SELFPLAY_UNDER_TSX';

const underTsx = process.env[TSX_SENTINEL] === '1'
  || process.execArgv.some(arg => arg.includes('tsx'));
if (!underTsx) {
  const child = spawnSync(
    process.execPath,
    ['--import', 'tsx', SELF, ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, [TSX_SENTINEL]: '1' } },
  );
  process.exit(child.status ?? 1);
}

const MAP_POOL = [
  { mapId: 'fog-harbor', players: 2 },
  { mapId: 'fog-crossing', players: 3 },
];
const DEFAULT_SEED = 20261120;
const MAX_PASSES = 20000;

function parseArgs(argv) {
  const args = {
    games: 1, seed: DEFAULT_SEED, map: null, trace: false, json: false,
    detail: false, out: null, sets: [], config: null, algo: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const value = () => argv[++i];
    if (key === '--games') args.games = Number(value());
    else if (key === '--seed') args.seed = Number(value());
    else if (key === '--map') args.map = value();
    else if (key === '--trace') args.trace = true;
    else if (key === '--json') args.json = true;
    else if (key === '--detail') args.detail = true;
    else if (key === '--out') args.out = value();
    else if (key === '--set') args.sets.push(value());
    else if (key === '--config') args.config = value();
    else if (key === '--algo') args.algo = value();
    else if (key === '--help' || key === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`未知参数: ${key}`);
    }
  }
  if (!Number.isInteger(args.games) || args.games < 1) throw new Error('--games 必须是 >=1 的整数');
  if (!Number.isInteger(args.seed) || args.seed < 0) throw new Error('--seed 必须是 >=0 的整数');
  if (args.map && !MAP_POOL.some(entry => entry.mapId === args.map)) {
    throw new Error(`--map 只能是 ${MAP_POOL.map(entry => entry.mapId).join(' / ')}`);
  }
  if (args.config && !args.map) throw new Error('--config 需要同时指定 --map');
  return args;
}

function printHelp() {
  console.log(`迷雾模式自对局跑批（fog-scout vs fog-scout）

用法：
  node scripts/fog-selfplay.mjs [--games N] [--seed N] [--map ID] [--trace] [--json]
                              [--detail] [--out PATH] [--set PATH=JSON] [--config PATH]
                              [--algo PATH]

默认：fog-harbor（2 人）与 fog-crossing（3 人）各 1 局，种子 ${DEFAULT_SEED}。
退出码：0 = 全部完赛且 0 非法动作；1 = 有非法动作 / 未完赛 / 参数错误。`);
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

/** `--set path.to.field=value` → 深拷贝后的地图配置；不触碰 maps/** 文件。 */
function cloneMapWithOverrides(base, sets) {
  const config = structuredClone(base);
  for (const spec of sets) {
    const eq = spec.indexOf('=');
    if (eq <= 0) throw new Error(`--set 需要 path=value 格式：${spec}`);
    const path = spec.slice(0, eq).split('.');
    if (path.some(segment => segment.length === 0)) throw new Error(`--set 路径非法：${spec}`);
    const raw = spec.slice(eq + 1);
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      value = raw;
    }
    let cursor = config;
    for (const segment of path.slice(0, -1)) {
      if (cursor === null || typeof cursor !== 'object' || !(segment in cursor)) {
        throw new Error(`--set 路径不存在：${spec}`);
      }
      cursor = cursor[segment];
    }
    cursor[path[path.length - 1]] = value;
  }
  return config;
}

function deepMerge(base, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return structuredClone(patch);
  const target = base && typeof base === 'object' && !Array.isArray(base) ? base : {};
  const out = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    out[key] = value !== null && typeof value === 'object' && !Array.isArray(value)
      ? deepMerge(target[key], value)
      : structuredClone(value);
  }
  return out;
}

/** 该格上的攻击目标分类：hq / unit / sighting / empty（用于区分"没人打 HQ"与"打不动"）。 */
function classifyAttackCell(game, owner, q, r) {
  const isCell = entity => entity && entity.q === q && entity.r === r;
  const hq = Object.entries(game.headquarters ?? {})
    .some(([id, entity]) => id !== owner && entity?.alive !== false && (entity?.hp ?? 0) > 0 && isCell(entity));
  if (hq) return 'hq';
  const unit = (game.units ?? [])
    .some(entity => entity.alive !== false && entity.owner !== owner && isCell(entity));
  if (unit) return 'unit';
  const sightings = Object.values(game.fog?.lastSeen?.[owner] ?? {});
  if (sightings.some(isCell)) return 'sighting';
  return 'empty';
}

/**
 * 玩家视角快照：与 src/api/auth.ts sanitizeGameForResponse 的 fog 玩家分支一致。
 * 不包含 tokens / rngState / idempotency / 其他玩家的计划队列 / 全量 events。
 */
function fogView(deps, game, owner) {
  const { unitsForViewer, fogProjectionFor } = deps;
  const turn = { ...game.turn };
  delete turn.resolvedRound;
  delete turn.skipGuard;
  const myQueue = (game.plan?.queues?.[owner] ?? []).map(action => ({ ...action }));

  return {
    id: game.id,
    mapId: game.mapId,
    phase: game.phase,
    winner: game.winner,
    map: {
      grid: game.map.grid,
      orientation: game.map.orientation,
      radius: game.map.radius,
      terrainCells: game.map.terrainCells.map(cell => ({ ...cell })),
      cells: game.cells.map(cell => ({ ...cell })),
      id: game.mapId,
    },
    cells: game.cells.map(cell => ({ ...cell })),
    units: unitsForViewer(game, owner).map(unit => ({ ...unit })),
    headquarters: Object.fromEntries(
      Object.entries(game.headquarters ?? {}).map(([id, hq]) => [id, { ...hq }]),
    ),
    controlPoints: (game.controlPoints ?? []).map(point => ({ ...point })),
    players: Object.fromEntries(
      Object.entries(game.players ?? {}).map(([id, player]) => [id, {
        status: player.status,
        name: player.name,
        turnOrder: player.turnOrder,
      }]),
    ),
    playerNames: { ...game.playerNames },
    resources: structuredClone(game.resources),
    turn,
    config: game.config,
    plan: {
      queues: myQueue.length > 0 ? { [owner]: myQueue } : {},
      myQueue,
      committed: [...(game.plan?.committed ?? [])],
    },
    fog: fogProjectionFor(game, owner),
    artillery: null,
  };
}

/** 与 HTTP 入队端点同源的规划函数；返回 Result。 */
function enqueue(deps, game, owner, action) {
  const { planning } = deps;
  const payload = action.payload ?? {};
  switch (action.type) {
    case 'attack':
      return planning.queueAttackAction(game, owner, payload.attackerId, payload.q, payload.r);
    case 'heal':
      return planning.queueHealAction(game, owner, payload.supportId, payload.q, payload.r);
    case 'move':
      return planning.queueMoveAction(game, owner, payload.unitId, payload.q, payload.r);
    case 'deploy':
      return planning.queueDeployAction(game, owner, payload.unitType, payload.fromId, payload.q, payload.r);
    case 'demolish':
      return planning.queueDemolishAction(game, owner, payload.unitId, payload.q, payload.r);
    case 'wait':
      return planning.queueWaitAction(game, owner);
    default:
      return { ok: false, code: 'unknown_action', message: `未知动作类型 ${action.type}` };
  }
}

function hexDistance(a, b) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(a.q + a.r - b.q - b.r));
}

const SIX_DIRS = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

/** 镜像 planning.ts 的瞄准形状校验：这一枪能不能打到该格。 */
function canAimAt(from, target, spec, range) {
  const distance = hexDistance(from, target);
  if (distance > range) return false;
  const shape = spec?.attackShape;
  if (shape?.type === 'line') {
    const length = Math.min(shape.length ?? 2, range);
    const dq = target.q - from.q;
    const dr = target.r - from.r;
    for (const dir of SIX_DIRS) {
      const k = dir.q !== 0 ? dq / dir.q : dr / dir.r;
      if (!Number.isInteger(k) || k < 1 || k > length) continue;
      if (dir.q * k !== dq || dir.r * k !== dr) continue;
      return true;
    }
    return false;
  }
  if (shape?.type === 'arc') return distance === 1;
  return distance >= 1;
}

/** 本轮有多少己方单位已经可以瞄准敌方总部（⇔ HQ 伤害为 0 是无人打，不是够不到）。 */
function hqAttackOpportunities(game, owner) {
  const own = (game.units ?? []).filter(unit => unit.alive !== false && unit.owner === owner);
  const spec = type => game.config?.units?.[type] ?? {};
  const hqs = Object.entries(game.headquarters ?? {})
    .filter(([id, hq]) => id !== owner && hq?.alive !== false && (hq?.hp ?? 0) > 0)
    .map(([, hq]) => hq);
  let count = 0;
  for (const unit of own) {
    const range = unit.attackRange ?? spec(unit.type).attackRange ?? 0;
    if (!(range > 0)) continue;
    if (hqs.some(hq => canAimAt(unit, hq, spec(unit.type), range))) count++;
  }
  return count;
}

/** 每个座位到最近敌方总部的距离（诊断：HQ 伤害为 0 到底是“没打到”还是“够不到”）。 */
function minDistanceToEnemyHq(game, owner) {
  const own = (game.units ?? []).filter(unit => unit.alive !== false && unit.owner === owner);
  const hqs = Object.entries(game.headquarters ?? {})
    .filter(([id, hq]) => id !== owner && hq?.alive !== false && (hq?.hp ?? 0) > 0)
    .map(([, hq]) => hq);
  let best = null;
  for (const unit of own) {
    for (const hq of hqs) {
      const distance = hexDistance(unit, hq);
      if (best === null || distance < best) best = distance;
    }
  }
  return best;
}

/** 轮末盘面快照（公开信息 + 己方统计），用于逐轮曲线与雪球判定。 */
function boardSnapshot(game) {
  const slot = id => game.players?.[id]?.spawnSlotId ?? id;
  const seats = {};
  for (const [id, player] of Object.entries(game.players ?? {})) {
    seats[slot(id)] = {
      player: id,
      status: player.status,
      units: (game.units ?? []).filter(unit => unit.alive !== false && unit.owner === id).length,
      hqHp: game.headquarters?.[id]?.hp ?? 0,
      hqAlive: game.headquarters?.[id]?.alive ?? false,
      supplies: game.resources?.[id]?.supplies ?? 0,
      kills: player.stats?.unitsDestroyed ?? 0,
      hqDamage: player.stats?.headquartersDamage ?? 0,
      cps: (game.controlPoints ?? []).filter(point => point.owner === id).length,
      minEnemyHqDist: minDistanceToEnemyHq(game, id),
      hqInRange: hqAttackOpportunities(game, id),
    };
  }
  return {
    round: game.turn?.roundNumber ?? 0,
    phase: game.phase,
    revealed: game.config?.fog?.revealFromRound != null
      && (game.turn?.roundNumber ?? 0) >= game.config.fog.revealFromRound,
    seats,
    cp: (game.controlPoints ?? []).map(point => ({
      id: point.id, kind: point.kind ?? null, owner: point.owner ? slot(point.owner) : null,
    })),
  };
}

async function playOne(deps, algo, utils, mapId, players, seed, trace, options = {}) {
  const {
    createLobby, createLobbyWithConfig, addLobbyPlayer, startGame, commitAndMaybeResolve, EventBus,
  } = deps;
  const config = options.config ?? null;
  const detail = Boolean(options.detail);
  const lobbyOptions = { maxPlayers: players, participate: true, playerName: 'A' };
  const game = config
    ? createLobbyWithConfig(`fog-selfplay-${mapId}-${seed}`, mapId, structuredClone(config), lobbyOptions)
    : createLobby(`fog-selfplay-${mapId}-${seed}`, mapId, lobbyOptions);
  for (let index = 1; index < players; index++) {
    const added = addLobbyPlayer(game, `P${index}`);
    if (!added) throw new Error(`${mapId}: 加入第 ${index + 1} 名玩家失败`);
  }
  const bus = new EventBus();
  const started = startGame(game, bus, mulberry32(seed));
  if (!started.ok) throw new Error(`${mapId}: 开局失败 ${JSON.stringify(started)}`);

  const illegal = [];
  const mix = {};
  const seatMix = {};
  const attackTargets = { hq: 0, unit: 0, sighting: 0, empty: 0 };
  const seatAttackTargets = {};
  const nearHq = {};
  const hqOpportunities = {};
  let decisions = 0;
  let actions = 0;
  let passes = 0;
  const startedAt = performance.now();
  const ap = game.config.balance?.actionsPerTurn ?? 5;
  const timeline = detail ? [] : [];
  const cpFlips = [];
  const previousCp = new Map();
  const recordSnapshot = roundLabel => {
    if (!detail) return;
    const snapshot = boardSnapshot(game);
    // 标签 = 刚结算完的轮号；终局限同轮与结算后的末快照去重（两者是同一盘面）。
    snapshot.round = roundLabel;
    const last = timeline[timeline.length - 1];
    if (last && last.round === roundLabel) timeline[timeline.length - 1] = snapshot;
    else timeline.push(snapshot);
    const flipRound = roundLabel;
    for (const point of snapshot.cp) {
      const before = previousCp.get(point.id) ?? null;
      if (before !== point.owner) {
        cpFlips.push({ round: flipRound, pointId: point.id, from: before, to: point.owner });
        previousCp.set(point.id, point.owner);
      }
    }
    for (const [slot, row] of Object.entries(snapshot.seats)) {
      if (row.minEnemyHqDist !== null) {
        nearHq[slot] = nearHq[slot] === undefined ? row.minEnemyHqDist : Math.min(nearHq[slot], row.minEnemyHqDist);
      }
      hqOpportunities[slot] = (hqOpportunities[slot] ?? 0) + (row.hqInRange ?? 0);
    }
  };

  while (game.phase === 'active' && passes++ < MAX_PASSES) {
    // 1) 每个尚未提交的座位：连续 decide 直到 null 或行动点用尽。
    for (const seat of game.turn.turnOrder) {
      if (game.phase !== 'active') break;
      if (game.players[seat]?.status !== 'active') continue;
      if ((game.plan?.committed ?? []).includes(seat)) continue;

      for (let step = 0; step < ap + 2; step++) {
        if (game.phase !== 'active') break;
        if ((game.plan?.committed ?? []).includes(seat)) break;
        const action = await algo.decide(fogView(deps, game, seat), utils, { owner: seat });
        decisions++;
        if (!action) break;

        const result = enqueue(deps, game, seat, action);
        if (!result.ok) {
          illegal.push(`${seat}:${action.type}:${result.code ?? 'unknown'}`);
          if (trace) {
            console.log(`  [illegal] ${seat} ${action.type} ${JSON.stringify(action.payload)} → ${result.code}`);
          }
          break;
        }
        actions++;
        mix[action.type] = (mix[action.type] ?? 0) + 1;
        (seatMix[seat] ??= {})[action.type] = (seatMix[seat][action.type] ?? 0) + 1;
        if (action.type === 'attack') {
          const kind = classifyAttackCell(game, seat, action.payload?.q, action.payload?.r);
          attackTargets[kind] = (attackTargets[kind] ?? 0) + 1;
          (seatAttackTargets[seat] ??= { hq: 0, unit: 0, sighting: 0, empty: 0 })[kind]++;
        }
        if (trace) {
          console.log(`  [queued] r${game.turn.roundNumber} ${seat} ${action.type} ${JSON.stringify(action.payload)}`);
        }
      }
    }

    if (game.phase !== 'active') break;

    // 2) 全员提交；最后一位提交时引擎自动结算本轮。
    const roundBefore = game.turn.roundNumber;
    for (const seat of game.turn.turnOrder) {
      if (game.phase !== 'active') break;
      if (game.players[seat]?.status !== 'active') continue;
      if ((game.plan?.committed ?? []).includes(seat)) continue;
      const committed = commitAndMaybeResolve(game, bus, seat);
      if (!committed.ok) {
        illegal.push(`${seat}:commit:${committed.code ?? 'unknown'}`);
        break;
      }
      if (game.turn.roundNumber !== roundBefore) break;
    }

    if (detail) recordSnapshot(roundBefore);
  }

  if (detail) recordSnapshot(game.turn.roundNumber);

  const elapsedMs = Math.round(performance.now() - startedAt);
  const finished = game.phase === 'game_over';
  const winner = game.winner ?? null;
  const reason = finished ? (game.result?.reason ?? 'unknown') : 'unfinished';
  const rounds = game.turn.roundNumber;
  const hqLeft = Object.values(game.headquarters ?? {})
    .filter(hq => hq.alive).length;
  const seatStats = Object.fromEntries(
    Object.entries(game.players ?? {}).map(([id, player]) => [id, {
      slot: player.spawnSlotId ?? null,
      kills: player.stats?.unitsDestroyed ?? 0,
      hqDamage: player.stats?.headquartersDamage ?? 0,
      cps: (game.controlPoints ?? []).filter(cp => cp.owner === id).length,
      supplies: game.resources?.[id]?.supplies ?? 0,
    }]),
  );
  const kills = Object.values(seatStats).reduce((sum, row) => sum + row.kills, 0);
  const hqDamage = Object.values(seatStats).reduce((sum, row) => sum + row.hqDamage, 0);
  const slotOf = id => seatStats[id]?.slot ?? id;
  const cpOwners = (game.controlPoints ?? []).map(cp => (cp.owner ? slotOf(cp.owner) : 'neutral'));

  if (passes >= MAX_PASSES) illegal.push('loop_guard:exceeded');

  return {
    mapId, players, seed, finished, winner, reason, rounds,
    decisions, actions, illegal, mix, elapsedMs,
    hqLeft,
    unitsLeft: game.units.filter(unit => unit.alive).length,
    kills, hqDamage, cpOwners, seatStats,
    winnerSlot: winner ? (seatStats[winner]?.slot ?? winner) : null,
    winnerPlayer: winner,
    ...(detail ? {
      slots: Object.fromEntries(Object.entries(game.players ?? {}).map(([id, player]) => [id, player.spawnSlotId ?? null])),
      turnOrder: [...(game.turn?.turnOrder ?? [])],
      turnOrderSlots: (game.turn?.turnOrder ?? []).map(id => game.players?.[id]?.spawnSlotId ?? id),
      seatMix,
      attackTargets,
      seatAttackTargets,
      nearHq,
      hqOpportunities,
      timeline,
      cpFlips,
      scores: finished ? (() => {
        const weights = game.config?.balance?.adjudicationWeights ?? {};
        return Object.fromEntries(Object.entries(game.result?.scores ?? {}).map(([id, score]) => {
          const hqDamageScore = (score.headquartersDamage ?? 0) * (weights.enemyHqDamage ?? 0);
          const ownHqHpScore = (score.ownHqHp ?? 0) * (weights.ownHqHp ?? 0);
          const armyScore = (score.armyValue ?? 0) * (weights.armyValue ?? 0);
          const killScore = (score.killValue ?? 0) * (weights.killValue ?? 0);
          const suppliesScore = (score.supplies ?? 0) * (weights.supplies ?? 0);
          const cpScore = score.total - hqDamageScore - ownHqHpScore - armyScore - killScore - suppliesScore;
          return [seatStats[id]?.slot ?? id, {
            total: Math.round(score.total),
            hqDamage: score.headquartersDamage ?? 0,
            cpScore: Math.round(cpScore),
            hqDamageScore: Math.round(hqDamageScore),
            ownHqHpScore: Math.round(ownHqHpScore),
            armyScore: Math.round(armyScore),
            killScore: Math.round(killScore),
            suppliesScore: Math.round(suppliesScore),
          }];
        }));
      })() : null,
      margin: finished
        ? (() => {
          const totals = Object.values(game.result?.scores ?? {}).map(score => score.total).sort((a, b) => b - a);
          return totals.length > 1 ? Math.round(totals[0] - totals[1]) : null;
        })()
        : null,
    } : {}),
  };
}

function printSummary(rows) {
  console.log('\n[fog-selfplay] 汇总');
  console.log('地图          人数  局数  完赛  非法  平均轮数  平均耗时  动作分布');
  for (const group of rows) {
    const total = group.games.length;
    const finished = group.games.filter(game => game.finished).length;
    const illegal = group.games.reduce((sum, game) => sum + game.illegal.length, 0);
    const avgRounds = total ? group.games.reduce((sum, game) => sum + game.rounds, 0) / total : 0;
    const avgMs = total ? group.games.reduce((sum, game) => sum + game.elapsedMs, 0) / total : 0;
    const mix = {};
    for (const game of group.games) {
      for (const [type, count] of Object.entries(game.mix)) mix[type] = (mix[type] ?? 0) + count;
    }
    const mixText = Object.entries(mix).sort((a, b) => b[1] - a[1]).map(([type, count]) => `${type}:${count}`).join(' ');
    console.log(
      `${group.mapId.padEnd(13)} ${String(group.players).padStart(4)} ${String(total).padStart(5)}`
      + ` ${String(finished).padStart(5)} ${String(illegal).padStart(5)}`
      + ` ${avgRounds.toFixed(2).padStart(9)} ${(avgMs / 1000).toFixed(2).padStart(8)}s  ${mixText}`,
    );
  }
}

function average(rows, pick) {
  return rows.length ? rows.reduce((sum, row) => sum + pick(row), 0) / rows.length : 0;
}

function summarize(group) {
  const games = group.games;
  const total = games.length;
  const finishedGames = games.filter(game => game.finished);
  const cpIds = [...new Set(games.flatMap(game => (game.timeline?.[0]?.cp ?? []).map(point => point.id)))];
  const cpCount = cpIds.length;
  const slots = [...new Set(games.flatMap(game => Object.values(game.seatStats ?? {}).map(row => row.slot)))].filter(Boolean).sort();

  const countBy = (rows, pick) => rows.reduce((acc, row) => {
    const key = pick(row);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const winnerSlot = countBy(games.filter(game => game.winnerSlot), game => game.winnerSlot);
  const winnerPlayer = countBy(games.filter(game => game.winnerPlayer), game => game.winnerPlayer);
  const endReasons = countBy(games, game => game.reason);

  const perSlot = new Map(slots.map(slot => [slot, {
    slot, games: 0, wins: 0, kills: 0, hqDamage: 0, hqDamageZero: 0,
    finalCps: 0, cpRounds: 0, cpRoundsObserved: 0, nearHq: [], hqOpportunities: 0,
    scoreGames: 0, score: { total: 0, cpScore: 0, hqDamageScore: 0, armyScore: 0, killScore: 0, ownHqHpScore: 0 },
    attacks: { hq: 0, unit: 0, sighting: 0, empty: 0 },
  }]));
  for (const game of games) {
    for (const row of Object.values(game.seatStats ?? {})) {
      const acc = perSlot.get(row.slot);
      if (!acc) continue;
      acc.games++;
      if (game.winnerSlot === row.slot) acc.wins++;
      acc.hqOpportunities += game.hqOpportunities?.[row.slot] ?? 0;
      acc.kills += row.kills ?? 0;
      const score = game.scores?.[row.slot];
      if (score) {
        acc.score.total += score.total;
        acc.score.cpScore += score.cpScore;
        acc.score.hqDamageScore += score.hqDamageScore;
        acc.score.armyScore += score.armyScore;
        acc.score.killScore += score.killScore;
        acc.score.ownHqHpScore += score.ownHqHpScore;
        acc.scoreGames++;
      }
      acc.hqDamage += row.hqDamage ?? 0;
      if ((row.hqDamage ?? 0) === 0) acc.hqDamageZero++;
      acc.finalCps += row.cps ?? 0;
    }
    for (const [seat, mix] of Object.entries(game.seatAttackTargets ?? {})) {
      const slot = game.seatStats?.[seat]?.slot;
      const acc = perSlot.get(slot);
      if (!acc) continue;
      for (const [kind, count] of Object.entries(mix)) acc.attacks[kind] += count;
    }
    for (const [slot, distance] of Object.entries(game.nearHq ?? {})) {
      const acc = perSlot.get(slot);
      if (acc) acc.nearHq.push(distance);
    }
    if (game.timeline) {
      for (const snapshot of game.timeline) {
        for (const slot of slots) {
          const acc = perSlot.get(slot);
          if (!acc) continue;
          acc.cpRoundsObserved++;
          acc.cpRounds += snapshot.cp.filter(point => point.owner === slot).length;
        }
      }
    }
  }

  const hqBuckets = { '0': 0, '1-49': 0, '50-99': 0, '100-199': 0, '200+': 0 };
  for (const game of games) {
    const totalHq = Object.values(game.seatStats ?? {}).reduce((sum, row) => sum + (row.hqDamage ?? 0), 0);
    const key = totalHq === 0 ? '0'
      : totalHq < 50 ? '1-49'
        : totalHq < 100 ? '50-99'
          : totalHq < 200 ? '100-199'
            : '200+';
    hqBuckets[key]++;
  }

  const finalHistogram = {};
  for (const game of games) {
    const counts = slots
      .map(slot => Object.values(game.seatStats ?? {}).find(row => row.slot === slot)?.cps ?? 0)
      .sort((a, b) => b - a)
      .join('-');
    finalHistogram[counts] = (finalHistogram[counts] ?? 0) + 1;
  }

  const majority = Math.floor(cpCount / 2) + 1;
  const snowball = {
    majorityNeeded: majority,
    gamesWithMajority: 0,
    gamesWithMajorityAtLeast5: 0,
    gamesWithAllPoints: 0,
    majorityHolders: 0,
    majorityHolderWins: 0,
    longestRuns: [],
    leadChanges: [],
    firstMajorityRounds: [],
  };
  for (const game of games) {
    if (!game.timeline || game.timeline.length === 0) continue;
    let runSeat = null;
    let runLength = 0;
    let longest = 0;
    let lead = null;
    let leadChanges = 0;
    let firstMajority = null;
    let firstMajoritySeat = null;
    let allHeld = false;
    for (const snapshot of game.timeline) {
      const counts = {};
      for (const point of snapshot.cp) if (point.owner) counts[point.owner] = (counts[point.owner] ?? 0) + 1;
      const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      const uniqueLead = ranked.length > 0 && (ranked.length === 1 || ranked[1][1] < ranked[0][1])
        ? ranked[0][0] : null;
      if (uniqueLead) {
        if (lead !== null && lead !== uniqueLead) leadChanges++;
        lead = uniqueLead;
      }
      const over = ranked.find(([, count]) => count >= majority)?.[0] ?? null;
      if (over) {
        if (runSeat === over) runLength++;
        else { runSeat = over; runLength = 1; }
        if (runLength > longest) longest = runLength;
        if (firstMajority === null) { firstMajority = snapshot.round; firstMajoritySeat = over; }
      } else {
        runSeat = null;
        runLength = 0;
      }
      if ((ranked[0]?.[1] ?? 0) === cpCount) allHeld = true;
    }
    if (longest > 0) snowball.gamesWithMajority++;
    if (longest >= 5) snowball.gamesWithMajorityAtLeast5++;
    if (allHeld) snowball.gamesWithAllPoints++;
    if (firstMajoritySeat) {
      snowball.majorityHolders++;
      if (game.winnerSlot === firstMajoritySeat) snowball.majorityHolderWins++;
    }
    snowball.longestRuns.push(longest);
    snowball.leadChanges.push(leadChanges);
    if (firstMajority !== null) snowball.firstMajorityRounds.push(firstMajority);
  }

  return {
    mapId: group.mapId,
    players: group.players,
    games: total,
    finished: finishedGames.length,
    unfinished: total - finishedGames.length,
    illegal: games.reduce((sum, game) => sum + game.illegal.length, 0),
    avgRounds: average(games, game => game.rounds),
    avgElapsedMs: average(games, game => game.elapsedMs),
    endReasons,
    winnerSlot,
    winnerPlayer,
    seatWinRate: Object.fromEntries([...perSlot.values()].map(row => [row.slot, {
      games: row.games,
      wins: row.wins,
      rate: row.games ? Math.round((row.wins / row.games) * 1000) / 1000 : 0,
    }])),
    seatDetail: Object.fromEntries([...perSlot.values()].map(row => [row.slot, {
      appearances: row.games,
      wins: row.wins,
      winRate: row.games ? Math.round((row.wins / row.games) * 1000) / 1000 : 0,
      avgKills: row.games ? Math.round((row.kills / row.games) * 100) / 100 : 0,
      avgHqDamage: row.games ? Math.round((row.hqDamage / row.games) * 10) / 10 : 0,
      zeroHqDamageGames: row.hqDamageZero,
      avgFinalCps: row.games ? Math.round((row.finalCps / row.games) * 100) / 100 : 0,
      avgCpsHeld: row.cpRoundsObserved
        ? Math.round((row.cpRounds / row.cpRoundsObserved) * 100) / 100 : 0,
      cpRoundShare: row.cpRoundsObserved && cpCount
        ? Math.round((row.cpRounds / (row.cpRoundsObserved * cpCount)) * 1000) / 1000 : 0,
      nearestEnemyHqMin: row.nearHq.length ? Math.min(...row.nearHq) : null,
      hqAttackOpportunities: row.hqOpportunities,
      scoreAvg: row.scoreGames ? Object.fromEntries(Object.entries({
        total: row.score.total,
        cpScore: row.score.cpScore,
        hqDamageScore: row.score.hqDamageScore,
        armyScore: row.score.armyScore,
        killScore: row.score.killScore,
        ownHqHpScore: row.score.ownHqHpScore,
      }).map(([key, value]) => [key, Math.round((value / row.scoreGames) * 10) / 10])) : null,
      nearestEnemyHqAvg: row.nearHq.length
        ? Math.round((row.nearHq.reduce((sum, value) => sum + value, 0) / row.nearHq.length) * 100) / 100
        : null,
      attackTargets: row.attacks,
    }])),
    hq: {
      buckets: hqBuckets,
      zeroDamageGames: hqBuckets['0'],
      anyDamageGames: total - hqBuckets['0'],
      destroyedGames: games.filter(game => game.hqLeft < game.players).length,
    },
    kills: {
      total: games.reduce((sum, game) => sum + game.kills, 0),
      avg: average(games, game => game.kills),
      min: games.length ? Math.min(...games.map(game => game.kills)) : 0,
      max: games.length ? Math.max(...games.map(game => game.kills)) : 0,
      zeroGames: games.filter(game => game.kills === 0).length,
    },
    cp: {
      count: cpCount,
      finalHistogram,
      takeoversAvg: average(games, game => (game.cpFlips ?? []).filter(flip => flip.to !== null).length),
      flipsToNeutral: games.reduce((sum, game) =>
        sum + (game.cpFlips ?? []).filter(flip => flip.to === null).length, 0),
    },
    snowball: {
      ...snowball,
      avgLongestRun: average(snowball.longestRuns, value => value),
      maxLongestRun: snowball.longestRuns.length ? Math.max(...snowball.longestRuns) : 0,
      avgLeadChanges: average(snowball.leadChanges, value => value),
      avgFirstMajorityRound: average(snowball.firstMajorityRounds, value => value),
      majorityConversion: snowball.majorityHolders
        ? Math.round((snowball.majorityHolderWins / snowball.majorityHolders) * 1000) / 1000 : null,
      firstMajorityRoundMin: snowball.firstMajorityRounds.length
        ? Math.min(...snowball.firstMajorityRounds) : null,
      longestRuns: undefined,
      leadChanges: undefined,
      firstMajorityRounds: undefined,
    },
    attacks: games.reduce((acc, game) => {
      for (const [kind, count] of Object.entries(game.attackTargets ?? {})) {
        acc[kind] = (acc[kind] ?? 0) + count;
      }
      return acc;
    }, {}),
    actions: games.reduce((acc, game) => {
      for (const [type, count] of Object.entries(game.mix)) acc[type] = (acc[type] ?? 0) + count;
      return acc;
    }, {}),
    averageMargin: average(finishedGames.filter(game => game.margin !== null), game => game.margin),
    averageActions: average(games, game => game.actions),
    averageDecisions: average(games, game => game.decisions),
  };
}

function printDetailSummary(summary) {
  console.log(`\n[fog-selfplay] ${summary.mapId} 座位明细`);
  console.log('座位            出场  胜  胜率    场均击杀  场均HQ伤害  HQ零伤害  末据点  据点轮占比  最近敌HQ');
  for (const [slot, row] of Object.entries(summary.seatDetail)) {
    console.log(
      `${slot.padEnd(15)} ${String(row.appearances).padStart(4)} ${String(row.wins).padStart(3)}`
      + ` ${(row.winRate * 100).toFixed(1).padStart(6)}% ${row.avgKills.toFixed(2).padStart(9)}`
      + ` ${row.avgHqDamage.toFixed(1).padStart(10)} ${String(row.zeroHqDamageGames).padStart(9)}`
      + ` ${row.avgFinalCps.toFixed(2).padStart(7)} ${(row.cpRoundShare * 100).toFixed(1).padStart(10)}%`
      + ` ${String(row.nearestEnemyHqMin).padStart(9)}`,
    );
  }
  console.log(`  攻击目标：${Object.entries(summary.attacks).map(([kind, count]) => `${kind}:${count}`).join(' ')}`
    + `   HQ 伤害分布：${Object.entries(summary.hq.buckets).map(([bucket, count]) => `${bucket}:${count}`).join(' ')}`);
  console.log(`  总部开火机会（座位·轮）：${Object.entries(summary.seatDetail)
    .map(([slot, row]) => `${slot}:${row.hqAttackOpportunities}`).join(' ')}`);
  console.log(`  雪球：多数席位连任≥5轮的局 ${summary.snowball.gamesWithMajorityAtLeast5}/${summary.games}`
    + `，全占过 ${summary.snowball.gamesWithAllPoints}，平均领先易手 ${summary.snowball.avgLeadChanges.toFixed(2)} 次`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const deps = {
    ...(await import('../src/config/loader.js')),
    ...(await import('../src/state/store.js')),
    ...(await import('../src/engine/engine.js')),
    ...(await import('../src/engine/simultaneous.js')),
    planning: await import('../src/engine/planning.js'),
    ...(await import('../src/engine/fog.js')),
    ...(await import('../src/events/bus.js')),
  };
  const { loadAlgorithm } = await import('../algorithms/registry.mjs');
  const utils = await import('../algorithms/lib/game-utils.mjs');

  deps.loadMaps();
  let algorithm;
  if (args.algo) {
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    const modulePath = isAbsolute(args.algo) ? args.algo : resolvePath(projectRoot, args.algo);
    algorithm = (await import(pathToFileURL(modulePath).href)).default;
    if (typeof algorithm?.decide !== 'function') throw new Error(`--algo 模块缺少 decide(): ${modulePath}`);
    console.log(`[fog-selfplay] 使用算法 ${algorithm.name ?? modulePath}`);
  } else {
    algorithm = await loadAlgorithm('fog-scout');
    if (algorithm.name !== 'fog-scout' || typeof algorithm.decide !== 'function') {
      throw new Error('fog-scout 模块缺少 decide()');
    }
  }

  const pool = args.map ? MAP_POOL.filter(entry => entry.mapId === args.map) : MAP_POOL;
  const groups = [];
  let totalIllegal = 0;
  let totalUnfinished = 0;
  const configs = new Map();
  if (args.sets.length > 0 || args.config) {
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    let patch = null;
    if (args.config) {
      const configPath = isAbsolute(args.config) ? args.config : resolvePath(projectRoot, args.config);
      patch = JSON.parse(readFileSync(configPath, 'utf-8'));
    }
    for (const entry of pool) {
      let config = deps.getMapConfig(entry.mapId);
      if (patch) config = deepMerge(structuredClone(config), patch);
      if (args.sets.length > 0) config = cloneMapWithOverrides(config, args.sets);
      configs.set(entry.mapId, config);
    }
  }

  for (const entry of pool) {
    const games = [];
    console.log(`\n=== ${entry.mapId}（${entry.players} 人，种子基准 ${args.seed}） ===`);
    for (let index = 0; index < args.games; index++) {
      const seed = (args.seed + index * 7919) >>> 0;
      const result = await playOne(deps, algorithm, utils, entry.mapId, entry.players, seed, args.trace, {
        config: configs.get(entry.mapId) ?? null,
        detail: args.detail,
      });
      games.push(result);
      totalIllegal += result.illegal.length;
      if (!result.finished) totalUnfinished++;
      const winnerText = result.winner ? `${result.winner}@${result.winnerSlot}` : '无';
      console.log(
        `#${index + 1} ${entry.mapId} ${entry.players}p seed=${seed}`
        + ` 结果=${result.finished ? '完赛' : '未完赛'} 胜者=${winnerText}`
        + ` 原因=${result.reason} 轮数=${result.rounds}`
        + ` 决策=${result.decisions} 入队=${result.actions}`
        + ` 非法=${result.illegal.length} 耗时=${(result.elapsedMs / 1000).toFixed(2)}s`
        + ` 残存HQ=${result.hqLeft} 残存单位=${result.unitsLeft}`
        + ` 击杀=${result.kills} 总部伤害=${result.hqDamage}`
        + ` 据点=${result.cpOwners.join('/')}`
        + (result.illegal.length ? ` | ${result.illegal.join(', ')}` : ''),
      );
    }
    groups.push({ ...entry, games, summary: summarize({ ...entry, games }) });
  }

  printSummary(groups);
  if (args.detail) {
    for (const group of groups) printDetailSummary(group.summary);
  }
  console.log(`\n[fog-selfplay] 总计 ${groups.reduce((sum, group) => sum + group.games.length, 0)} 局，`
    + `非法动作 ${totalIllegal}，未完赛 ${totalUnfinished}。`);

  const report = {
    generatedAt: new Date().toISOString(),
    seed: args.seed,
    sets: args.sets,
    detail: args.detail,
    totalIllegal,
    totalUnfinished,
    groups,
  };

  if (args.out) {
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    const outPath = isAbsolute(args.out) ? args.out : resolvePath(projectRoot, args.out);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
    console.log(`[fog-selfplay] 报告已写入 ${outPath}`);
  }

  if (args.json) {
    console.log(JSON.stringify(report));
  }

  if (totalIllegal > 0 || totalUnfinished > 0) process.exitCode = 1;
}

main().catch(error => {
  console.error(`fog-selfplay 失败: ${error?.stack ?? error}`);
  process.exit(1);
});
