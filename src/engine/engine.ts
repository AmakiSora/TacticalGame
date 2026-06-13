// src/engine/engine.ts
import { randomBytes } from 'node:crypto';
import type { GameState, PlayerId } from '../types.js';
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
    terrainCells: game.map.terrainCells,
    cells: game.cells,
  };
}

function fullReplayPayload(game: GameState) {
  return {
    mapId: game.mapId,
    map: mapPayload(game),
    controlPoints: game.controlPoints,
    headquarters: game.headquarters,
    units: game.units,
    resources: game.resources,
    firstPlayer: game.turn.currentOwner,
    playerNames: { ...game.playerNames },
    config: {
      units: game.config.units,
      headquartersSpec: game.config.headquartersSpec,
      balance: game.config.balance,
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

export function endTurn(game: GameState, bus: EventBus, owner: PlayerId): Result {
  if (game.phase === 'game_over') return { ok: false, code: 'game_over', message: 'game has ended' };
  if (game.phase !== 'waiting_command') return { ok: false, code: 'game_not_started', message: 'game not in play' };
  if (game.turn.currentOwner !== owner) return { ok: false, code: 'not_your_turn', message: 'not your turn' };

  captureControlPoints(game, bus, owner);
  resetActions(game, owner);
  appendEvent(game, bus, 'reset_actions', { owner });

  const next = otherPlayer(owner);
  if (next === 'player_a') game.turn.turnNumber += 1;
  game.turn.currentOwner = next;
  collectIncome(game, bus, next);
  appendEvent(game, bus, 'turn_end', { previousOwner: owner, nextOwner: next, turnNumber: game.turn.turnNumber });
  return { ok: true };
}
