// src/engine/engine.ts
import { randomBytes } from 'node:crypto';
import type { GameState, PlayerId } from '../types.js';
import type { EventBus } from '../events/bus.js';
import type { Result } from './building.js';
import { tickBuildProgress } from './building.js';
import { tickProduction } from './production.js';
import { collectMiningIncome, collectBaseIncome } from './mining.js';
import { appendEvent } from './events.js';

function generateToken(): string {
  return randomBytes(16).toString('hex');
}

function otherPlayer(p: PlayerId): PlayerId {
  return p === 'player_a' ? 'player_b' : 'player_a';
}

export function joinGame(game: GameState, bus: EventBus, playerName?: string): Result {
  if (game.tokens.player_b !== '') {
    return { ok: false, code: 'game_already_full', message: 'game already has 2 players' };
  }
  game.tokens.player_b = generateToken();
  game.playerNames.player_b = playerName || '玩家 B';
  game.phase = 'waiting_command';
  game.turn.phase = 'waiting_command';
  appendEvent(game, bus, 'game_start', {
    mapId: game.mapId,
    mapWidth: game.mapWidth, mapHeight: game.mapHeight,
    miningPoints: game.miningPoints,
    terrain: game.terrain,
    firstPlayer: game.turn.currentOwner,
    playerNames: { ...game.playerNames },
    buildings: game.buildings.map(b => ({
      id: b.id, owner: b.owner, type: b.type,
      x: b.x, y: b.y, hp: b.hp, maxHp: b.maxHp,
      alive: b.alive, isBuilding: b.isBuilding,
    })),
    config: {
      units: game.config.units,
      buildings: game.config.buildings,
      canProduce: game.config.canProduce,
      economy: game.config.economy,
      map: { buildRange: game.config.map.buildRange, headquartersPositions: game.config.map.headquartersPositions },
    },
  });
  return { ok: true };
}

export function endTurn(game: GameState, bus: EventBus, owner: PlayerId): Result {
  if (game.phase === 'game_over') {
    return { ok: false, code: 'game_over', message: 'game has ended' };
  }
  if (game.phase !== 'waiting_command') {
    return { ok: false, code: 'game_not_started', message: 'game not in play' };
  }
  if (game.turn.currentOwner !== owner) {
    return { ok: false, code: 'not_your_turn', message: 'not your turn' };
  }

  tickBuildProgress(game, bus, owner);
  tickProduction(game, bus, owner);

  for (const u of game.units) {
    if (u.owner === owner) {
      u.hasMoved = false;
      u.hasAttacked = false;
    }
  }
  for (const b of game.buildings) {
    if (b.owner === owner && b.alive && !b.isBuilding && b.attacksLeft != null) {
      const spec = game.config.buildings[b.type];
      b.attacksLeft = spec.attacksPerTurn ?? 0;
    }
  }
  appendEvent(game, bus, 'reset_actions', { owner });

  const next = otherPlayer(owner);
  if (next === 'player_a') {
    game.turn.turnNumber += 1;
  }
  game.turn.currentOwner = next;

  collectBaseIncome(game, bus, next);
  collectMiningIncome(game, bus, next);

  appendEvent(game, bus, 'turn_end', {
    previousOwner: owner, nextOwner: next, turnNumber: game.turn.turnNumber,
  });
  return { ok: true };
}
