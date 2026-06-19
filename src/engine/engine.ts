// src/engine/engine.ts
import { randomBytes } from 'node:crypto';
import type { AdjudicationScore, GameOverReason, GameState, PlayerId } from '../types.js';
import type { EventBus } from '../events/bus.js';
import type { Result } from './result.js';
import { appendEvent } from './events.js';

function generateToken(): string {
  return randomBytes(16).toString('hex');
}

function otherPlayer(p: PlayerId): PlayerId {
  return p === 'player_a' ? 'player_b' : 'player_a';
}

function mapPayload(game: GameState) {
  return {
    id: game.mapId,
    name: game.config.name,
    description: game.config.description,
    grid: game.map.grid,
    orientation: game.map.orientation,
    radius: game.map.radius,
    terrainCells: game.map.terrainCells.map(c => ({ ...c })),
    cells: game.cells.map(c => ({ ...c })),
  };
}

function fullReplayPayload(game: GameState) {
  return {
    mapId: game.mapId,
    map: mapPayload(game),
    controlPoints: game.controlPoints.map(p => ({ ...p })),
    headquarters: {
      player_a: { ...game.headquarters.player_a },
      player_b: { ...game.headquarters.player_b },
    },
    units: game.units.map(u => ({ ...u })),
    resources: {
      player_a: { ...game.resources.player_a },
      player_b: { ...game.resources.player_b },
    },
    firstPlayer: game.turn.currentOwner,
    playerNames: { ...game.playerNames },
    config: {
      units: structuredClone(game.config.units),
      headquartersSpec: { ...game.config.headquartersSpec },
      balance: { ...game.config.balance },
    },
  };
}

export function joinGame(game: GameState, bus: EventBus, playerName?: string): Result {
  if (game.tokens.player_b !== '') {
    return { ok: false, code: 'game_already_full', message: 'game already has 2 players' };
  }
  game.tokens.player_b = generateToken();
  game.playerNames.player_b = playerName || '玩家 B';
  game.phase = 'waiting_command';
  game.turn.phase = 'waiting_command';
  appendEvent(game, bus, 'game_start', fullReplayPayload(game));
  return { ok: true };
}

function captureControlPoints(game: GameState, bus: EventBus, owner: PlayerId): void {
  for (const point of game.controlPoints) {
    const capturer = game.units.find(u =>
      u.owner === owner && u.alive && (u.type === 'infantry' || u.type === 'scout') && u.q === point.q && u.r === point.r);
    if (!capturer || point.owner === owner) continue;
    const previousOwner = point.owner;
    point.owner = owner;
    appendEvent(game, bus, 'control_point_captured', {
      pointId: point.id, name: point.name, owner, previousOwner, unitId: capturer.id, q: point.q, r: point.r,
    });
  }
}

function resetActions(game: GameState, owner: PlayerId): void {
  for (const unit of game.units) {
    if (unit.owner === owner && unit.alive) {
      unit.hasMoved = false;
      unit.hasActed = false;
      unit.actionSpent = false;
    }
  }
}

function collectIncome(game: GameState, bus: EventBus, owner: PlayerId): void {
  const base = game.config.balance.baseIncome;
  const points = game.controlPoints.filter(p => p.owner === owner).length;
  const control = points * game.config.balance.controlPointIncome;
  const amount = base + control;
  game.resources[owner].supplies += amount;
  appendEvent(game, bus, 'income', { owner, base, control, controlPoints: points, amount });
}

function armyValue(game: GameState, owner: PlayerId): number {
  return game.units
    .filter(u => u.owner === owner && u.alive)
    .reduce((sum, unit) => sum + Math.round(unit.cost * (unit.hp / unit.maxHp)), 0);
}

function scorePlayer(game: GameState, owner: PlayerId): AdjudicationScore {
  const enemy = otherPlayer(owner);
  const weights = game.config.balance.adjudicationWeights;
  const enemyHqDamage = game.headquarters[enemy].maxHp - game.headquarters[enemy].hp;
  const ownHqHp = game.headquarters[owner].hp;
  const controlPoints = game.controlPoints.filter(p => p.owner === owner).length;
  const army = armyValue(game, owner);
  const supplies = game.resources[owner].supplies;
  return {
    enemyHqDamage,
    ownHqHp,
    controlPoints,
    armyValue: army,
    supplies,
    total:
      enemyHqDamage * weights.enemyHqDamage +
      ownHqHp * weights.ownHqHp +
      controlPoints * weights.controlPoint +
      army * weights.armyValue +
      supplies * weights.supplies,
  };
}

export function buildAdjudicationScores(game: GameState): Record<PlayerId, AdjudicationScore> {
  return {
    player_a: scorePlayer(game, 'player_a'),
    player_b: scorePlayer(game, 'player_b'),
  };
}

export function endGame(
  game: GameState,
  bus: EventBus,
  winner: PlayerId | null,
  reason: GameOverReason,
  scores?: Record<PlayerId, AdjudicationScore>,
): void {
  game.phase = 'game_over';
  game.turn.phase = 'game_over';
  game.winner = winner;
  game.result = scores ? { winner, reason, scores } : { winner, reason };
  appendEvent(game, bus, 'game_over', { winner, reason, ...(scores ? { scores } : {}) });
}

function maybeAdjudicate(game: GameState, bus: EventBus, endedOwner: PlayerId): boolean {
  if (endedOwner !== 'player_b') return false;
  if (game.turn.turnNumber < game.config.balance.maxTurns) return false;

  const scores = buildAdjudicationScores(game);
  const a = scores.player_a.total;
  const b = scores.player_b.total;
  const winner = a === b ? null : a > b ? 'player_a' : 'player_b';
  endGame(game, bus, winner, winner === null ? 'turn_limit_draw' : 'turn_limit_score', scores);
  return true;
}

export function endTurn(game: GameState, bus: EventBus, owner: PlayerId): Result {
  if (game.phase === 'game_over') return { ok: false, code: 'game_over', message: 'game has ended' };
  if (game.phase !== 'waiting_command') return { ok: false, code: 'game_not_started', message: 'game not in play' };
  if (game.turn.currentOwner !== owner) return { ok: false, code: 'not_your_turn', message: 'not your turn' };

  captureControlPoints(game, bus, owner);
  resetActions(game, owner);
  appendEvent(game, bus, 'reset_actions', { owner, actionsUsed: 0 });
  if (maybeAdjudicate(game, bus, owner)) return { ok: true };

  const next = otherPlayer(owner);
  if (next === 'player_a') game.turn.turnNumber += 1;
  game.turn.currentOwner = next;
  game.turn.actionsUsed = 0;
  collectIncome(game, bus, next);
  appendEvent(game, bus, 'turn_end', { previousOwner: owner, nextOwner: next, turnNumber: game.turn.turnNumber });
  return { ok: true };
}
