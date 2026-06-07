// src/engine/mining.ts
import type { GameState, PlayerId } from '../types.js';
import type { EventBus } from '../events/bus.js';
import { getMinerIncome, getBaseIncome } from './specs.js';
import { appendEvent } from './events.js';

export function collectBaseIncome(
  game: GameState,
  bus: EventBus,
  owner: PlayerId,
): void {
  const amount = getBaseIncome();
  game.resources[owner].gold += amount;
  appendEvent(game, bus, 'base_income', { owner, amount });
}

export function collectMiningIncome(
  game: GameState,
  bus: EventBus,
  owner: PlayerId,
): number {
  const income = getMinerIncome();
  let total = 0;
  for (const b of game.buildings) {
    if (b.owner !== owner) continue;
    if (b.type !== 'miner') continue;
    if (!b.alive || b.isBuilding) continue;
    game.resources[owner].gold += income;
    total += income;
    appendEvent(game, bus, 'mine', {
      buildingId: b.id, owner, amount: income, x: b.x, y: b.y,
    });
  }
  return total;
}
