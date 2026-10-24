// 真实引擎审计入口：策略仅获得 sanitizeGameForResponse 产生的公开快照。
import { mkdirSync, appendFileSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { loadMaps } from '../src/config/loader.js';
import { createLobby, addLobbyPlayer } from '../src/state/store.js';
import { startGame, buildAdjudicationScores } from '../src/engine/engine.js';
import { commitAndMaybeResolve } from '../src/engine/simultaneous.js';
import * as planning from '../src/engine/planning.js';
import { sanitizeGameForResponse } from '../src/api/auth.js';
import { EventBus } from '../src/events/bus.js';
// @ts-expect-error 框架的原生 ESM 接口
import { loadAlgorithm, getAlgorithmMeta } from '../algorithms/registry.mjs';
// @ts-expect-error 框架工具无类型声明
import * as utils from '../algorithms/lib/game-utils.mjs';

export function seeded(seed: number) {
  let value = seed >>> 0;
  return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; };
}

export function enqueue(game: any, owner: any, action: any) {
  const p = action.payload ?? {};
  switch (action.type) {
    case 'move': return planning.queueMoveAction(game, owner, p.unitId, p.q, p.r);
    case 'attack': return planning.queueAttackAction(game, owner, p.attackerId, p.q, p.r);
    case 'heal': return planning.queueHealAction(game, owner, p.supportId, p.q, p.r);
    case 'deploy': return planning.queueDeployAction(game, owner, p.unitType, p.fromId, p.q, p.r);
    case 'demolish': return planning.queueDemolishAction(game, owner, p.unitId, p.q, p.r);
    case 'wait': return planning.queueWaitAction(game, owner);
    default: return { ok: false, code: 'unknown_action' };
  }
}

export async function playMatch(options: { map: string; names: string[]; seed: number; maxRounds?: number; trace?: string; transform?: (game: any) => void }) {
  loadMaps();
  const { map, names, seed } = options, bus = new EventBus();
  const game = createLobby(`tw-${map}-${names.join('-')}-${seed}`, map, { maxPlayers: names.length, participate: true, playerName: 'Seat 0' });
  for (let n = 1; n < names.length; n++) addLobbyPlayer(game, `Seat ${n}`);
  const start = startGame(game, bus, seeded(seed));
  if (!start.ok) throw new Error(JSON.stringify(start));
  game.rngState = seed >>> 0;
  options.transform?.(game);
  const seats = Object.keys(game.players), strategies = await Promise.all(names.map(loadAlgorithm));
  const metrics: Record<string, any> = {};
  const randomness = seats.map((_, i) => seeded(seed ^ ((i + 1) * 7117)));
  for (let n = 0; n < seats.length; n++) metrics[seats[n]!] = { name: names[n], rejected: [], calls: [], actions: {}, outcomes: {} };
  const started = performance.now(), oldRandom = Math.random;
  try {
    let guard = 0;
    while (game.phase === 'active' && guard++ < (options.maxRounds ?? 50)) {
      for (let n = 0; n < seats.length; n++) {
        const owner = seats[n] as any;
        if (game.players[owner]?.status !== 'active') continue;
        for (let step = 0; step <= game.config.balance.actionsPerTurn; step++) {
          Math.random = randomness[n]!;
          const view = sanitizeGameForResponse(game, owner), before = performance.now();
          const action = await strategies[n].decide(view, utils, { owner });
          metrics[owner].calls.push(performance.now() - before);
          if (!action) break;
          const result = enqueue(game, owner, action);
          if (!result.ok) { metrics[owner].rejected.push({ round: game.turn.roundNumber, action, result }); break; }
          metrics[owner].actions[action.type] = (metrics[owner].actions[action.type] ?? 0) + 1;
        }
      }
      for (const owner of seats as any[]) {
        if (game.phase !== 'active') break;
        if (game.players[owner]?.status === 'active') {
          const result = commitAndMaybeResolve(game, bus, owner);
          if (!result.ok) throw new Error(JSON.stringify(result));
        }
      }
    }
  } finally { Math.random = oldRandom; }
  for (const event of game.events) if (event.type === 'round_resolved') {
    for (const [owner, rows] of Object.entries((event.payload as any).results)) for (const row of rows as any[]) {
      const k = row.status === 'executed' ? 'executed' : `${row.status}:${row.reason ?? 'empty'}`;
      metrics[owner].outcomes[k] = (metrics[owner].outcomes[k] ?? 0) + 1;
    }
  }
  for (const m of Object.values(metrics)) {
    const samples = [...m.calls].sort((a: number, b: number) => a - b);
    m.timing = { calls: samples.length, mean: samples.reduce((a: number, b: number) => a + b, 0) / samples.length, p50: samples[Math.floor(samples.length * .5)], p95: samples[Math.floor(samples.length * .95)], max: samples.at(-1) };
    delete m.calls;
  }
  const result = {
    engineVersion: JSON.parse(readFileSync('package.json', 'utf8')).version, harness: 'verification/tempo-weave-arena.mts (real engine)',
    nodeVersion: process.version,
    implementations: Object.fromEntries([...new Set(names)].map(name => [name, {
      version: getAlgorithmMeta(name)?.version,
      sha256: createHash('sha256').update(readFileSync(`algorithms/builtin/${name}.mjs`)).digest('hex'),
    }])),
    date: new Date().toISOString(), map, seed, names, seats, phase: game.phase, rounds: game.turn.roundNumber,
    winner: game.winner, winnerName: game.winner ? metrics[game.winner].name : null,
    scores: buildAdjudicationScores(game), metrics, elapsedMs: performance.now() - started,
  };
  if (options.trace) writeFileSync(options.trace, JSON.stringify({ result, events: game.events }, null, 2));
  return result;
}

async function main() {
  const args = process.argv.slice(2), get = (k: string, fallback: string) => args.includes(k) ? args[args.indexOf(k) + 1]! : fallback;
  const map = get('--map', 'standoff'), opponent = get('--opponent', 'random-sim'), games = Number(get('--games', '2'));
  const output = get('--output', `temp/tempo-weave/${map}-${opponent}.jsonl`), base = Number(get('--seed', '242024'));
  mkdirSync(resolve(output, '..'), { recursive: true });
  for (let i = 0; i < games; i++) {
    const names = i % 2 ? [opponent, 'tempo-weave'] : ['tempo-weave', opponent];
    const result = await playMatch({ map, names, seed: base + Math.floor(i / 2) * 7919, trace: args.includes('--trace') ? `${output}.${i}.trace.json` : undefined });
    appendFileSync(output, JSON.stringify(result) + '\n');
    console.log(JSON.stringify({ game: i + 1, map, opponent, winner: result.winnerName, rounds: result.rounds, elapsedMs: Math.round(result.elapsedMs), own: Object.values(result.metrics).find((m: any) => m.name === 'tempo-weave') }));
    if (Object.values(result.metrics).some((m: any) => m.name === 'tempo-weave' && m.rejected.length)) throw new Error('新策略产生被拒动作');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
