// src/engine/deployment.ts
import type { GameState, PlayerId, Position, Unit, UnitType } from '../types.js';
import type { EventBus } from '../events/bus.js';
import type { Result } from './result.js';
import { hexDistance } from './hex.js';
import { isDeployable, actionsRemaining, deployOriginFor } from './validation.js';
import { appendEvent } from './events.js';
import { createUnitFromConfig } from '../state/store.js';
import { deployDiscountForOrigin } from './controlPoints.js';
import { isArtilleryDanger } from './artillery.js';

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
  if (!spec) return { ok: false, code: 'invalid_deploy', message: '未知兵种' };
  const origin = deployOriginFor(game, owner, fromId);
  if (!origin) return { ok: false, code: 'invalid_deploy', message: '部署起点无效' };
  if (isArtilleryDanger(game, origin) || isArtilleryDanger(game, { q, r })) {
    return { ok: false, code: 'invalid_deploy', message: '炮火区内无法部署' };
  }

  // Deploy always consumes one action point (the new unit is freshly activated).
  // Checked early so an exhausted player cannot probe deploy targets.
  const limit = game.config.balance.actionsPerTurn;
  if (game.turn.actionsUsed >= limit) {
    return { ok: false, code: 'action_limit_reached', message: `每回合最多行动 ${limit} 次` };
  }

  if (hexDistance(origin, { q, r }) !== 1) {
    return { ok: false, code: 'out_of_deploy_range', message: '部署目标必须相邻' };
  }
  if (!isDeployable(game, q, r)) {
    return { ok: false, code: 'invalid_terrain', message: '部署目标必须是空的平原地形' };
  }
  const discount = Math.min(spec.cost, deployDiscountForOrigin(game, owner, fromId));
  const actualCost = spec.cost - discount;
  const resources = game.resources[owner];
  if (!resources) return { ok: false, code: 'player_eliminated', message: '资源不足' };
  if (resources.supplies < actualCost) {
    return { ok: false, code: 'insufficient_supplies', message: `需要 ${actualCost} 补给` };
  }

  game.turn.actionsUsed += 1;
  const stats = game.players[owner]?.stats;
  if (stats) stats.actionPointsUsed = (stats.actionPointsUsed ?? 0) + 1;

  resources.supplies -= actualCost;
  const unit = createUnitFromConfig(game.config, owner, unitType, q, r);
  unit.hasMoved = true;
  unit.hasActed = false;
  unit.actionSpent = true;
  game.units.push(unit);
  appendEvent(game, bus, 'deploy', {
    unitId: unit.id, owner, unitType, fromId, q, r, cost: actualCost, unitCost: spec.cost, discount,
    hp: unit.hp, attack: unit.attack, defense: unit.defense,
    moveRange: unit.moveRange, attackRange: unit.attackRange,
    canCapture: unit.canCapture, healPower: unit.healPower,
    actionsUsed: game.turn.actionsUsed, actionsRemaining: actionsRemaining(game),
  });
  return { ok: true, data: unit };
}
