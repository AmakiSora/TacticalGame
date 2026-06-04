// src/engine/mining.ts
import type { GameState, PlayerId } from '../types.js';
import type { EventBus } from '../events/bus.js';
import { MINER_INCOME, BASE_INCOME } from './specs.js';
import { appendEvent } from './events.js';

export function collectBaseIncome(
  game: GameState,
  bus: EventBus,
  owner: PlayerId,
): void {
  game.resources[owner].gold += BASE_INCOME;
  appendEvent(game, bus, 'base_income', { owner, amount: BASE_INCOME });
}

export function collectMiningIncome(
  game: GameState,
  bus: EventBus,
  owner: PlayerId,
): number {
  let total = 0;
  for (const b of game.buildings) {
    if (b.owner !== owner) continue;
    if (b.type !== 'miner') continue;
    if (!b.alive || b.isBuilding) continue;
    game.resources[owner].gold += MINER_INCOME;
    total += MINER_INCOME;
    appendEvent(game, bus, 'mine', {
      buildingId: b.id, owner, amount: MINER_INCOME, x: b.x, y: b.y,
    });
  }
  return total;
}
