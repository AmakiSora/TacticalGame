import type { GameState, PlayerId, Unit, Building } from '../types.js';
import type { EventBus } from '../events/bus.js';
import type { Result } from './building.js';
import { manhattanDistance } from './validation.js';
import { appendEvent } from './events.js';
import { getConfig } from '../config/loader.js';

function rollDamageVariance(): number {
  const range = getConfig().combat.damageVarianceRange;
  return Math.floor(Math.random() * (2 * range + 1)) - range;
}

export function rollHealAmount(): number {
  const cfg = getConfig().combat;
  return cfg.healBase + Math.floor(Math.random() * (cfg.healVarianceRange + 1));
}

function findTarget(game: GameState, targetId: string): Unit | Building | null {
  const u = game.units.find(x => x.id === targetId && x.alive);
  if (u) return u;
  const b = game.buildings.find(x => x.id === targetId && x.alive);
  if (b) return b;
  return null;
}

function targetPos(t: Unit | Building): { x: number; y: number } {
  return { x: t.x, y: t.y };
}

function computeDamage(attack: number, defense: number): number {
  const base = attack - defense + rollDamageVariance();
  return Math.max(getConfig().combat.minimumDamage, base);
}

function endGame(game: GameState, bus: EventBus, winner: PlayerId): void {
  game.phase = 'game_over';
  game.turn.phase = 'game_over';
  game.winner = winner;
  appendEvent(game, bus, 'game_over', { winner });
}

export function attackTarget(
  game: GameState,
  bus: EventBus,
  owner: PlayerId,
  attackerId: string,
  targetId: string,
): Result {
  const attacker = game.units.find(u => u.id === attackerId && u.owner === owner && u.alive);
  if (!attacker) {
    return { ok: false, code: 'unit_not_found', message: 'attacker not found' };
  }
  if (attacker.hasAttacked) {
    return { ok: false, code: 'invalid_attack', message: 'already attacked this turn' };
  }
  const target = findTarget(game, targetId);
  if (!target) {
    return { ok: false, code: 'target_not_found', message: 'target not found' };
  }
  if (target.owner === owner) {
    return { ok: false, code: 'invalid_attack', message: 'cannot attack friendly target' };
  }
  const dist = manhattanDistance({ x: attacker.x, y: attacker.y }, targetPos(target));
  if (dist > attacker.attackRange) {
    return { ok: false, code: 'invalid_attack', message: `out of range (${dist} > ${attacker.attackRange})` };
  }

  const defense = 'defense' in target ? target.defense : 0;
  const damage = computeDamage(attacker.attack, defense);
  target.hp = Math.max(0, target.hp - damage);
  attacker.hasAttacked = true;
  appendEvent(game, bus, 'attack', {
    attackerId, targetId, damage, targetHp: target.hp,
  });

  if (target.hp === 0) {
    target.alive = false;
    if ('attack' in target) {
      appendEvent(game, bus, 'unit_death', {
        unitId: target.id, owner: target.owner, x: target.x, y: target.y,
      });
    } else {
      const isHQ = target.type === 'headquarters';
      appendEvent(game, bus, 'base_destroyed', {
        buildingId: target.id, owner: target.owner,
        type: target.type, x: target.x, y: target.y,
      });
      if (isHQ) {
        endGame(game, bus, owner);
      }
    }
  }
  return { ok: true };
}

export function healTarget(
  game: GameState,
  bus: EventBus,
  owner: PlayerId,
  medicId: string,
  targetId: string,
): Result {
  const medic = game.units.find(u => u.id === medicId && u.owner === owner && u.alive);
  if (!medic) {
    return { ok: false, code: 'unit_not_found', message: 'medic not found' };
  }
  if (medic.type !== 'medic') {
    return { ok: false, code: 'invalid_heal', message: 'caster is not a medic' };
  }
  if (medic.hasAttacked) {
    return { ok: false, code: 'invalid_heal', message: 'already acted this turn' };
  }
  const target = game.units.find(u => u.id === targetId && u.alive);
  if (!target) {
    return { ok: false, code: 'invalid_heal', message: 'target is not a unit' };
  }
  if (target.owner !== owner) {
    return { ok: false, code: 'invalid_heal', message: 'cannot heal enemy' };
  }
  const dist = manhattanDistance({ x: medic.x, y: medic.y }, { x: target.x, y: target.y });
  if (dist > getConfig().combat.healRange) {
    return { ok: false, code: 'invalid_heal', message: 'target not adjacent' };
  }

  const amount = rollHealAmount();
  const healed = Math.min(target.maxHp - target.hp, amount);
  target.hp += healed;
  medic.hasAttacked = true;
  appendEvent(game, bus, 'heal', {
    medicId, targetId, amount: healed, targetHp: target.hp,
  });
  return { ok: true };
}
