import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { EventBus } from '../../src/events/bus.js';
import { loadMaps, listMaps, getMapConfig } from '../../src/config/loader.js';
import { generateRandomMapConfig, sanitizeRandomOptions } from '../../src/config/randomMap.js';
import { createInitialGameWithConfig } from '../../src/state/store.js';
import { attackTarget, healTarget } from '../../src/engine/combat.js';
import { moveUnit } from '../../src/engine/units.js';
import { deployUnit } from '../../src/engine/deployment.js';
import { demolishTerrain } from '../../src/engine/demolition.js';
import { endTurn, buildAdjudicationSnapshot } from '../../src/engine/engine.js';
import { findReachableCells, isDeployable, hexDistance } from '../../src/engine/validation.js';
import { hexNeighbors } from '../../src/engine/hex.js';
import { deployDiscountForOrigin } from '../../src/engine/controlPoints.js';
import type { GameState, PlayerId, UnitType } from '../../src/types.js';
import { loadAlgorithm, listAlgorithmInfo } from '../../algorithms/registry.mjs';
import * as utils from '../../algorithms/lib/game-utils.mjs';

type Action = Record<string, any>;
loadMaps();
let real: GameState | undefined;
const algorithms = new Map<string, any>();

function assertStandard(g: GameState): void {
  if (g.config.mode !== 'standard' || g.maxPlayers !== 2) throw new Error('v5 supports two-player standard only');
}

export function view(g: GameState): any {
  const { tokens: _t, hostToken: _h, rngState: _r, ...rest } = g;
  return structuredClone({ ...rest, events: g.events.slice(-80), adjudication: buildAdjudicationSnapshot(g) });
}

export function legalActions(g: GameState): Action[] {
  assertStandard(g);
  if (g.phase !== 'active') return [];
  const owner = g.turn.currentPlayerId!;
  const free = g.turn.actionsUsed < g.config.balance.actionsPerTurn;
  const out: Action[] = [{ type: 'end_turn' }];
  const alive = g.units.filter(u => u.alive);
  for (const u of alive.filter(u => u.owner === owner && (free || u.actionSpent))) {
    if (!u.hasMoved) for (const p of findReachableCells(g, u)) out.push({ type: 'move', unitId: u.id, ...p });
    if (u.hasActed) continue;
    for (const target of [...alive, ...Object.values(g.headquarters).filter(h => h.alive)]) {
      if (target.owner !== owner && hexDistance(u, target) <= u.attackRange) {
        out.push({ type: 'attack', attackerId: u.id, targetId: target.id });
      }
    }
    if (u.type === 'support') for (const target of alive) {
      if (target.owner === owner && hexDistance(u, target) <= (g.config.units.support.healRange ?? u.attackRange)) {
        out.push({ type: 'heal', supportId: u.id, targetId: target.id });
      }
    }
    if (u.type === 'heavy') for (const p of hexNeighbors(u)) {
      if (g.cells.some(c => c.q === p.q && c.r === p.r && c.terrain === 'blocker') &&
          !alive.some(t => t.q === p.q && t.r === p.r) &&
          !Object.values(g.headquarters).some(h => h.alive && h.q === p.q && h.r === p.r)) {
        out.push({ type: 'demolish', unitId: u.id, ...p });
      }
    }
  }
  if (free) {
    const hq = g.headquarters[owner];
    const origins = [...g.controlPoints.filter(p => p.owner === owner),
      ...(hq?.alive && g.config.balance.deployFromHq !== false ? [hq] : [])];
    for (const from of origins) for (const [type, spec] of Object.entries(g.config.units)) {
      const cost = Math.max(0, spec.cost - deployDiscountForOrigin(g, owner, from.id));
      if ((g.resources[owner]?.supplies ?? 0) < cost) continue;
      for (const p of hexNeighbors(from)) if (isDeployable(g, p.q, p.r)) {
        out.push({ type: 'deploy', unitType: type, fromId: from.id, ...p });
      }
    }
  }
  return out;
}

export function apply(g: GameState, action: Action): void {
  assertStandard(g);
  if (g.phase !== 'active') throw new Error('game is not active');
  const owner = g.turn.currentPlayerId as PlayerId;
  const bus = new EventBus();
  let result;
  switch (action.type) {
    case 'end_turn': result = endTurn(g, bus, owner); break;
    case 'move': result = moveUnit(g, bus, owner, action.unitId, action.q, action.r); break;
    case 'attack': result = attackTarget(g, bus, owner, action.attackerId, action.targetId); break;
    case 'heal': result = healTarget(g, bus, owner, action.supportId, action.targetId); break;
    case 'demolish': result = demolishTerrain(g, bus, owner, action.unitId, action.q, action.r); break;
    case 'deploy': {
      result = deployUnit(g, bus, owner, action.unitType as UnitType, action.fromId, action.q, action.r);
      if (result.ok && result.data) {
        // Same deterministic identity convention in actual local games and simulations.
        const unit = result.data;
        const id = `v5:${owner}:${g.turn.roundNumber}:${g.units.length}:${unit.q}:${unit.r}`;
        for (const e of g.events) if (e.payload.unitId === unit.id) e.payload.unitId = id;
        unit.id = id;
      }
      break;
    }
    default: throw new Error(`unknown action ${action.type}`);
  }
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  g.events = g.events.slice(-80);
}

function importView(state: any, seed: number): GameState {
  const g = structuredClone(state) as GameState;
  assertStandard(g);
  // Never restore the real game's hidden random state, even if a caller supplies it.
  g.rngState = seed >>> 0;
  g.tokens = {};
  g.hostToken = '';
  g.events ??= [];
  return g;
}

export async function handleCommand(c: any): Promise<any> {
  if (c.cmd === 'manifest') return {
    maps: listMaps().filter(m => m.preview.mode === 'standard' && m.preview.supportedPlayerCounts.includes(2))
      .map(m => ({ id: m.id, hash: createHash('sha256').update(JSON.stringify(getMapConfig(m.id))).digest('hex') })),
    algorithms: listAlgorithmInfo(),
  };
  if (c.cmd === 'reset') {
    const id = c.mapId ?? 'default';
    const config = id === 'random' ? generateRandomMapConfig(sanitizeRandomOptions({ ...c.random, seed: String(c.mapSeed ?? 0) }), 2) : getMapConfig(id);
    real = createInitialGameWithConfig('v5-local', structuredClone(config), id);
    assertStandard(real);
    real.rngState = Number(c.combatSeed ?? 0) >>> 0;
    real.units.forEach((u, i) => { u.id = `initial:${i}`; });
    Object.values(real.headquarters).forEach(h => { h.id = `hq:${h.owner}`; });
    return view(real);
  }
  if (c.cmd === 'simulate' || c.cmd === 'legal') {
    const g = importView(c.state, Number(c.seed ?? 0));
    if (c.cmd === 'legal') return legalActions(g);
    apply(g, c.action);
    return view(g);
  }
  if (!real) throw new Error('reset required');
  if (c.cmd === 'state') return view(real);
  if (c.cmd === 'apply') {
    if (c.owner && c.owner !== real.turn.currentPlayerId) throw new Error('wrong player');
    // Transactional apply: a rejected action cannot corrupt the real state.
    const next = structuredClone(real);
    apply(next, c.action);
    real = next;
    return view(real);
  }
  if (c.cmd === 'decide') {
    if (c.owner && c.owner !== real.turn.currentPlayerId) throw new Error('wrong player');
    const name = String(c.algorithm);
    let algorithm = algorithms.get(name);
    if (!algorithm) { algorithm = await loadAlgorithm(name); algorithms.set(name, algorithm); }
    if (typeof algorithm.decide !== 'function') throw new Error('algorithm requires decide()');
    // Make stochastic built-in algorithms reproducible without exposing combat RNG.
    const original = Math.random;
    let seed = Number(c.seed ?? 0) >>> 0;
    Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    try {
      const action = await algorithm.decide(view(real), utils);
      return action ? { type: action.type, ...action.payload } : { type: 'end_turn' };
    } finally { Math.random = original; }
  }
  throw new Error(`unknown command ${c.cmd}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let pending = Promise.resolve();
  createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', line => {
    pending = pending.then(async () => {
      try { process.stdout.write(JSON.stringify({ ok: true, state: await handleCommand(JSON.parse(line)) }) + '\n'); }
      catch (e) { process.stdout.write(JSON.stringify({ ok: false, error: String(e) }) + '\n'); }
    });
  });
}
