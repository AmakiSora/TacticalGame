// src/engine/combat.ts
import type { GameState, Headquarters, PlayerId, Unit } from '../types.js';
import type { EventBus } from '../events/bus.js';
import type { Result } from './result.js';
import { hexDistance } from './hex.js';
import { appendEvent } from './events.js';

type Target =
  | { kind: 'unit'; entity: Unit }
  | { kind: 'headquarters'; entity: Headquarters };

function rollVariance(range: number): number {
  return Math.floor(Math.random() * (2 * range + 1)) - range;
}

function rollHeal(game: GameState, support: Unit): number {
  const base = support.healPower ?? 0;
  return base + Math.floor(Math.random() * (game.config.balance.healVarianceRange + 1));
}

function targetPosition(target: Target): { q: number; r: number } {
  return { q: target.entity.q, r: target.entity.r };
}

function findTarget(game: GameState, targetId: string): Target | null {
  const unit = game.units.find(u => u.id === targetId && u.alive);
  if (unit) return { kind: 'unit', entity: unit };
  const hq = Object.values(game.headquarters).find(h => h.id === targetId && h.alive);
  return hq ? { kind: 'headquarters', entity: hq } : null;
}

function computeDamage(game: GameState, attack: number, defense: number): number {
  return Math.max(
    game.config.balance.minimumDamage,
    attack - defense + rollVariance(game.config.balance.damageVarianceRange),
  );
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
  if (!attacker) return { ok: false, code: 'unit_not_found', message: 'attacker not found' };
  if (attacker.hasActed) return { ok: false, code: 'invalid_attack', message: 'already acted this turn' };

  const target = findTarget(game, targetId);
  if (!target) return { ok: false, code: 'target_not_found', message: 'target not found' };
  if (target.entity.owner === owner) return { ok: false, code: 'invalid_attack', message: 'cannot attack friendly target' };

  const distance = hexDistance(attacker, targetPosition(target));
  if (distance > attacker.attackRange) {
    return { ok: false, code: 'invalid_attack', message: `out of range (${distance} > ${attacker.attackRange})` };
  }

  const damage = computeDamage(game, attacker.attack, target.entity.defense);
  target.entity.hp = Math.max(0, target.entity.hp - damage);
  attacker.hasActed = true;
  appendEvent(game, bus, 'attack', {
    attackerId,
    targetId,
    damage,
    targetHp: target.entity.hp,
    targetKind: target.kind,
  });

  if (target.entity.hp === 0) {
    target.entity.alive = false;
    if (target.kind === 'headquarters') {
      appendEvent(game, bus, 'headquarters_destroyed', {
        headquartersId: target.entity.id, owner: target.entity.owner, q: target.entity.q, r: target.entity.r,
      });
      endGame(game, bus, owner);
    } else {
      appendEvent(game, bus, 'unit_death', {
        unitId: target.entity.id,
        owner: target.entity.owner,
        type: target.entity.type,
        q: target.entity.q,
        r: target.entity.r,
      });
    }
  }

  return { ok: true };
}

export function healTarget(
  game: GameState,
  bus: EventBus,
  owner: PlayerId,
  supportId: string,
  targetId: string,
): Result {
  const support = game.units.find(u => u.id === supportId && u.owner === owner && u.alive);
  if (!support) return { ok: false, code: 'unit_not_found', message: 'support not found' };
  if (support.type !== 'support') return { ok: false, code: 'invalid_heal', message: 'unit is not support' };
  if (support.hasActed) return { ok: false, code: 'invalid_heal', message: 'already acted this turn' };

  const target = game.units.find(u => u.id === targetId && u.owner === owner && u.alive);
  if (!target) return { ok: false, code: 'invalid_heal', message: 'target is not a friendly unit' };
  const distance = hexDistance(support, target);
  if (distance > support.attackRange) return { ok: false, code: 'invalid_heal', message: 'target out of range' };

  const amount = rollHeal(game, support);
  const healed = Math.min(target.maxHp - target.hp, amount);
  target.hp += healed;
  support.hasActed = true;
  appendEvent(game, bus, 'heal', { supportId, targetId, amount: healed, targetHp: target.hp });
  return { ok: true };
}
