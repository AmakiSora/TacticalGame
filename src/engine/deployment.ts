// src/engine/deployment.ts
import type { GameState, PlayerId, Position, Unit, UnitType } from '../types.js';
import type { EventBus } from '../events/bus.js';
import type { Result } from './result.js';
import { hexDistance } from './hex.js';
import { isDeployable } from './validation.js';
import { appendEvent } from './events.js';
import { createUnitFromConfig } from '../state/store.js';

function deployOrigin(game: GameState, owner: PlayerId, fromId: string): Position | null {
  const hq = game.headquarters[owner];
  if (hq.id === fromId && hq.alive) return hq;
  const point = game.controlPoints.find(p => p.id === fromId && p.owner === owner);
  return point ?? null;
}

export function deployUnit(
  game: GameState,
  bus: EventBus,
  owner: PlayerId,
  unitType: UnitType,
  fromId: string,
  q: number,
  r: number,
): Result<Unit> {
  const spec = game.config.units[unitType];
  if (!spec) return { ok: false, code: 'invalid_deploy', message: 'unknown unit type' };
  const origin = deployOrigin(game, owner, fromId);
  if (!origin) return { ok: false, code: 'invalid_deploy', message: 'invalid deploy origin' };
  if (hexDistance(origin, { q, r }) !== 1) {
    return { ok: false, code: 'out_of_deploy_range', message: 'deploy target must be adjacent' };
  }
  if (!isDeployable(game, q, r)) {
    return { ok: false, code: 'invalid_terrain', message: 'deploy target is not empty plain terrain' };
  }
  if (game.resources[owner].supplies < spec.cost) {
    return { ok: false, code: 'insufficient_supplies', message: `need ${spec.cost} supplies` };
  }

  game.resources[owner].supplies -= spec.cost;
  const unit = createUnitFromConfig(game.config, owner, unitType, q, r);
  unit.hasMoved = true;
  unit.hasActed = false;
  game.units.push(unit);
  appendEvent(game, bus, 'deploy', {
    unitId: unit.id, owner, unitType, fromId, q, r, cost: spec.cost,
    hp: unit.hp, attack: unit.attack, defense: unit.defense,
    moveRange: unit.moveRange, attackRange: unit.attackRange,
    canCapture: unit.canCapture, healPower: unit.healPower,
  });
  return { ok: true, data: unit };
}
