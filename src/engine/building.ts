// src/engine/building.ts
import { randomUUID } from 'node:crypto';
import type { GameState, PlayerId, BuildingType, Building, ApiErrorCode } from '../types.js';
import type { EventBus } from '../events/bus.js';
import { getBuildingSpec } from './specs.js';
import {
  isInBounds, getCellOccupant, isInBuildRange, isMiningPoint,
} from './validation.js';
import { appendEvent } from './events.js';

export type Result<T = void> =
  | { ok: true; data?: T }
  | { ok: false; code: ApiErrorCode; message: string };

export function startBuild(
  game: GameState,
  bus: EventBus,
  owner: PlayerId,
  type: BuildingType,
  x: number,
  y: number,
): Result<Building> {
  if (type === 'headquarters') {
    return { ok: false, code: 'cannot_produce', message: 'headquarters cannot be built' };
  }
  if (!isInBounds(x, y, game.mapWidth, game.mapHeight)) {
    return { ok: false, code: 'invalid_move', message: 'out of bounds' };
  }
  const spec = getBuildingSpec(type);
  if (game.resources[owner].gold < spec.cost) {
    return { ok: false, code: 'insufficient_gold', message: `need ${spec.cost} gold` };
  }
  if (!isInBuildRange(game, owner, x, y)) {
    return { ok: false, code: 'out_of_build_range', message: 'no friendly object within 2 cells' };
  }
  if (getCellOccupant(game, x, y) !== null) {
    return { ok: false, code: 'cell_occupied', message: 'cell occupied' };
  }
  if (type === 'miner' && !isMiningPoint(game, x, y)) {
    return { ok: false, code: 'not_mining_point', message: 'miner must be on a mining point' };
  }

  game.resources[owner].gold -= spec.cost;
  const building: Building = {
    id: randomUUID(),
    owner,
    type,
    x,
    y,
    hp: spec.hp,
    maxHp: spec.hp,
    alive: true,
    buildProgress: spec.buildTime,
    isBuilding: spec.buildTime > 0,
    production: null,
  };
  game.buildings.push(building);
  appendEvent(game, bus, 'build', {
    buildingId: building.id, owner, type, x, y, buildTime: spec.buildTime, cost: spec.cost,
  });
  return { ok: true, data: building };
}

export function tickBuildProgress(game: GameState, bus: EventBus, owner: PlayerId): void {
  for (const b of game.buildings) {
    if (b.owner !== owner || !b.isBuilding || !b.alive) continue;
    b.buildProgress -= 1;
    if (b.buildProgress <= 0) {
      b.buildProgress = 0;
      b.isBuilding = false;
      appendEvent(game, bus, 'build_complete', {
        buildingId: b.id, owner, type: b.type, x: b.x, y: b.y,
      });
    }
  }
}
