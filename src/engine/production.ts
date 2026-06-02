// src/engine/production.ts
import { randomUUID } from 'node:crypto';
import type { GameState, PlayerId, UnitType, Unit } from '../types.js';
import type { EventBus } from '../events/bus.js';
import { UNIT_SPECS, CAN_PRODUCE } from './specs.js';
import { findAdjacentFreeCell } from './validation.js';
import { appendEvent } from './events.js';
import type { Result } from './building.js';

export function startProduction(
  game: GameState,
  bus: EventBus,
  owner: PlayerId,
  buildingId: string,
  unitType: UnitType,
): Result {
  const building = game.buildings.find(b => b.id === buildingId && b.owner === owner && b.alive);
  if (!building) {
    return { ok: false, code: 'building_not_found', message: 'building not found' };
  }
  if (building.isBuilding) {
    return { ok: false, code: 'building_not_ready', message: 'building under construction' };
  }
  if (!CAN_PRODUCE[building.type].includes(unitType)) {
    return { ok: false, code: 'cannot_produce', message: `${building.type} cannot produce ${unitType}` };
  }
  if (building.production !== null) {
    return { ok: false, code: 'cannot_produce', message: 'production slot busy' };
  }
  const spec = UNIT_SPECS[unitType];
  if (game.resources[owner].gold < spec.cost) {
    return { ok: false, code: 'insufficient_gold', message: `need ${spec.cost} gold` };
  }

  game.resources[owner].gold -= spec.cost;
  building.production = { type: unitType, turnsRemaining: spec.productionTime };
  appendEvent(game, bus, 'produce', {
    buildingId: building.id, owner, unitType, productionTime: spec.productionTime,
  });
  return { ok: true };
}

function spawnUnit(
  game: GameState,
  bus: EventBus,
  owner: PlayerId,
  type: UnitType,
  x: number,
  y: number,
): Unit {
  const spec = UNIT_SPECS[type];
  const unit: Unit = {
    id: randomUUID(),
    owner, type, x, y,
    hp: spec.hp, maxHp: spec.hp,
    attack: spec.attack, defense: spec.defense,
    moveRange: spec.moveRange, attackRange: spec.attackRange,
    alive: true, hasMoved: false, hasAttacked: false,
  };
  game.units.push(unit);
  appendEvent(game, bus, 'produce_complete', {
    unitId: unit.id, owner, type, x, y,
  });
  return unit;
}

export function tickProduction(game: GameState, bus: EventBus, owner: PlayerId): void {
  for (const b of game.buildings) {
    if (b.owner !== owner || !b.alive || b.isBuilding || b.production === null) continue;
    b.production.turnsRemaining -= 1;
    if (b.production.turnsRemaining <= 0) {
      const cell = findAdjacentFreeCell(game, b.x, b.y);
      if (cell === null) {
        b.production.turnsRemaining = 0;
        continue;
      }
      const type = b.production.type;
      b.production = null;
      spawnUnit(game, bus, owner, type, cell.x, cell.y);
    }
  }
}
