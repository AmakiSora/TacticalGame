// scripts/crucible-arena.mts — crucible 本地真实引擎换座标定（不写竞技场历史）
// 用法: npx tsx scripts/crucible-arena.mts --opp vortex --games 10 --maps artillery-zone,trench-run --random 6
import { EventBus } from '../src/events/bus.js';
import { loadMaps, getMapConfig } from '../src/config/loader.js';
import { generateRandomMapConfig } from '../src/config/randomMap.js';
import { createLobbyWithConfig, addLobbyPlayer } from '../src/state/store.js';
import { startGame, endTurn } from '../src/engine/engine.js';
import { moveUnit } from '../src/engine/units.js';
import { attackTarget, healTarget } from '../src/engine/combat.js';
import { deployUnit } from '../src/engine/deployment.js';
import { demolishTerrain } from '../src/engine/demolition.js';
import { loadAlgorithm } from '../algorithms/registry.mjs';
import * as utils from '../algorithms/lib/game-utils.mjs';
import type { GameState, PlayerId } from '../src/types.js';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Args { opp: string; games: number; maps: string[]; random: number; seed: number; maxRounds: number; }
function parseArgs(): Args {
  const a: Args = { opp: 'random-annihilation', games: 10, maps: ['artillery-zone', 'trench-run'], random: 0, seed: 20261029, maxRounds: 300 };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--opp') a.opp = argv[++i];
    else if (argv[i] === '--games') a.games = parseInt(argv[++i], 10);
    else if (argv[i] === '--maps') a.maps = argv[++i].split(',');
    else if (argv[i] === '--random') a.random = parseInt(argv[++i], 10);
    else if (argv[i] === '--seed') a.seed = parseInt(argv[++i], 10);
    else if (argv[i] === '--max-rounds') a.maxRounds = parseInt(argv[++i], 10);
  }
  return a;
}

function applyAction(game: GameState, bus: EventBus, who: PlayerId, action: any): { ok: boolean; code?: string } {
  const p = action.payload ?? {};
  let r: any;
  switch (action.type) {
    case 'move': r = moveUnit(game, bus, who, p.unitId, p.q, p.r); break;
    case 'attack': r = attackTarget(game, bus, who, p.attackerId, p.targetId); break;
    case 'heal': r = healTarget(game, bus, who, p.supportId, p.targetId); break;
    case 'deploy': r = deployUnit(game, bus, who, p.unitType, p.fromId, p.q, p.r); break;
    case 'demolish': r = demolishTerrain(game, bus, who, p.unitId, p.q, p.r); break;
    default: return { ok: false, code: 'unknown_type' };
  }
  return r.ok ? { ok: true } : { ok: false, code: r.code };
}

async function playGame(config: any, mapId: string, algoA: any, algoB: any, seed: number, maxRounds: number, swap: boolean) {
  const bus = new EventBus();
  const game = createLobbyWithConfig(`pk_${seed}_${swap ? 1 : 0}`, mapId, config, { maxPlayers: 2, participate: false, playerName: 'pk' });
  addLobbyPlayer(game, 'A');
  addLobbyPlayer(game, 'B');
  const start = startGame(game, bus, mulberry32(seed));
  if (!start.ok) throw new Error(`start failed: ${start.code}`);
  const seatAlgo: Record<string, any> = swap
    ? { player_a: algoB, player_b: algoA }
    : { player_a: algoA, player_b: algoB };
  const rejects: Record<string, number> = { crucible: 0, [algoB.name]: 0 };
  const t0 = Date.now();
  let actions = 0;
  while (game.phase === 'active' && game.turn.roundNumber <= maxRounds) {
    const who = game.turn.currentPlayerId!;
    const algo = seatAlgo[who];
    let n = 0;
    while (n++ < 80) {
      const action = await algo.decide(game, utils, { owner: who });
      if (!action) break;
      const r = applyAction(game, bus, who, action);
      actions++;
      if (!r.ok) {
        rejects[algo.name] = (rejects[algo.name] ?? 0) + 1;
        if (algo.name === 'crucible') console.error(`  [reject] ${action.type} ${r.code} r${game.turn.roundNumber} ${JSON.stringify(action.payload)}`);
        break;
      }
      if (game.phase !== 'active') break;
    }
    if (game.phase !== 'active') break;
    endTurn(game, bus, who);
  }
  const ms = Date.now() - t0;
  const winner = game.winner;
  const crucibleSeat = swap ? 'player_b' : 'player_a';
  const result = winner === crucibleSeat ? 'win' : winner === null ? 'draw' : 'loss';
  return { result, rounds: game.turn.roundNumber, reason: game.result?.reason ?? 'round_cap', ms, actions, rejects, winner };
}

async function main() {
  const args = parseArgs();
  loadMaps();
  const crucible = await loadAlgorithm('crucible');
  const opp = await loadAlgorithm(args.opp);
  const suites: { label: string; config: any; mapId: string }[] = [];
  for (const m of args.maps) suites.push({ label: m, config: getMapConfig(m), mapId: m });
  for (let i = 0; i < args.random; i++) {
    const seed = args.seed + i * 7919;
    const config = generateRandomMapConfig({ seed, mode: 'annihilation' }, 2);
    suites.push({ label: `random#${seed}`, config, mapId: `random#${seed}` });
  }
  const perSuite = Math.max(1, Math.floor(args.games / suites.length));
  const totals = { win: 0, loss: 0, draw: 0 };
  const rejTotals: Record<string, number> = {};
  let totalMs = 0, totalGames = 0;
  for (const suite of suites) {
    const s = { win: 0, loss: 0, draw: 0 };
    for (let g = 0; g < perSuite; g++) {
      for (const swap of [false, true]) {
        const seed = args.seed + g * 104729 + (swap ? 1 : 0);
        const r = await playGame(suite.config, suite.mapId, crucible, opp, seed, args.maxRounds, swap);
        s[r.result]++;
        totals[r.result]++;
        totalMs += r.ms; totalGames++;
        for (const [k, v] of Object.entries(r.rejects)) rejTotals[k] = (rejTotals[k] ?? 0) + v;
        if (r.result !== 'win') console.log(`  [${suite.label} g${g} swap=${swap}] ${r.result} r${r.rounds} ${r.reason} winner=${r.winner}`);
      }
    }
    console.log(`${suite.label}: crucible ${s.win}胜 ${s.loss}负 ${s.draw}平 (vs ${args.opp})`);
  }
  console.log(`\n总计 crucible vs ${args.opp}: ${totals.win}胜 ${totals.loss}负 ${totals.draw}平 / ${totalGames} 局`);
  console.log(`拒绝动作: ${JSON.stringify(rejTotals)}  平均耗时 ${Math.round(totalMs / totalGames)}ms/局`);
}

main().catch((e) => { console.error(e); process.exit(1); });