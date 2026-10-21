// src/engine/combat.ts
import type { GameState, Headquarters, PlayerId, Unit } from '../types.js';
import { isAnnihilationMode } from '../types.js';
import type { EventBus } from '../events/bus.js';
import type { Result } from './result.js';
import { hexDistance } from './hex.js';
import { consumeAction, actionsRemaining } from './validation.js';
import { getGameIndex } from './gameIndex.js';
import { appendEvent } from './events.js';
import { eliminatePlayer, creditKill } from './engine.js';
import { isArtilleryDanger } from './artillery.js';
import { nextGameRandom } from './random.js';

type Target =
  | { kind: 'unit'; entity: Unit }
  | { kind: 'headquarters'; entity: Headquarters };

function rollVariance(game: GameState, range: number): number {
  return Math.floor(nextGameRandom(game) * (2 * range + 1)) - range;
}

function rollHeal(game: GameState, support: Unit): number {
  const base = support.healPower ?? 0;
  return base + Math.floor(nextGameRandom(game) * (game.config.balance.healVarianceRange + 1));
}

function targetPosition(target: Target): { q: number; r: number } {
  return { q: target.entity.q, r: target.entity.r };
}

function findTarget(game: GameState, targetId: string): Target | null {
  const index = getGameIndex(game);
  const unit = index.unitById.get(targetId);
  if (unit?.alive) return { kind: 'unit', entity: unit };
  const hq = index.hqById.get(targetId);
  return hq?.alive ? { kind: 'headquarters', entity: hq } : null;
}

export function computeDamage(game: GameState, attack: number, defense: number): number {
  return Math.max(
    game.config.balance.minimumDamage,
    attack - defense + rollVariance(game, game.config.balance.damageVarianceRange),
  );
}

export function attackTarget(
  game: GameState,
  bus: EventBus,
  owner: PlayerId,
  attackerId: string,
  targetId: string,
): Result {
  const attacker = getGameIndex(game).unitById.get(attackerId);
  if (!attacker || attacker.owner !== owner || !attacker.alive) {
    return { ok: false, code: 'unit_not_found', message: '找不到攻击方单位' };
  }
  if (attacker.hasActed) return { ok: false, code: 'invalid_attack', message: '该单位本回合已经行动过' };

  const target = findTarget(game, targetId);
  if (!target) return { ok: false, code: 'target_not_found', message: '找不到目标' };
  if (target.entity.owner === owner) return { ok: false, code: 'invalid_attack', message: '不能攻击友方目标' };

  const distance = hexDistance(attacker, targetPosition(target));
  if (distance > attacker.attackRange) {
    return { ok: false, code: 'invalid_attack', message: `超出射程（${distance} > ${attacker.attackRange}）` };
  }

  const spent = consumeAction(game, attacker);
  if (!spent.ok) return spent;

  const damage = computeDamage(game, attacker.attack, target.entity.defense);
  const actualDamage = Math.min(target.entity.hp, damage);
  target.entity.hp = Math.max(0, target.entity.hp - damage);
  if (target.kind === 'headquarters' && game.players[owner]) {
    game.players[owner]!.stats.headquartersDamage += actualDamage;
  }
  attacker.hasActed = true;
  appendEvent(game, bus, 'attack', {
    owner,
    attackerId,
    targetId,
    damage,
    actualDamage,
    targetHp: target.entity.hp,
    targetKind: target.kind,
    actionsUsed: game.turn.actionsUsed,
    actionsRemaining: actionsRemaining(game),
  });

  if (target.entity.hp === 0) {
    target.entity.alive = false;
    if (target.kind === 'headquarters') {
      appendEvent(game, bus, 'headquarters_destroyed', {
        headquartersId: target.entity.id, owner: target.entity.owner, q: target.entity.q, r: target.entity.r,
      });
      eliminatePlayer(game, bus, target.entity.owner, 'headquarters_destroyed', owner);
    } else {
      if (game.players[owner]) game.players[owner]!.stats.unitsDestroyed += 1;
      creditKill(game, owner, target.entity);
      appendEvent(game, bus, 'unit_death', {
        unitId: target.entity.id,
        owner: target.entity.owner,
        type: target.entity.type,
        q: target.entity.q,
        r: target.entity.r,
        cause: 'attack',
      });
      if (
        isAnnihilationMode(game.config.mode) &&
        !game.units.some(unit => unit.owner === target.entity.owner && unit.alive)
      ) {
        eliminatePlayer(game, bus, target.entity.owner, 'army_destroyed', owner);
      }
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
  const support = getGameIndex(game).unitById.get(supportId);
  if (!support || support.owner !== owner || !support.alive) {
    return { ok: false, code: 'unit_not_found', message: '找不到支援单位' };
  }
  if (support.type !== 'support') return { ok: false, code: 'invalid_heal', message: '该单位不是支援兵' };
  if (support.hasActed) return { ok: false, code: 'invalid_heal', message: '该单位本回合已经行动过' };

  const target = getGameIndex(game).unitById.get(targetId);
  if (!target || target.owner !== owner || !target.alive) {
    return { ok: false, code: 'invalid_heal', message: '目标不是友方单位' };
  }
  if (target.hp >= target.maxHp) {
    return { ok: false, code: 'invalid_heal', message: '目标已满血' };
  }
  if (isArtilleryDanger(game, support) || isArtilleryDanger(game, target)) {
    return { ok: false, code: 'invalid_heal', message: '炮火区内无法治疗' };
  }
  const distance = hexDistance(support, target);
  const healRange = game.config.units[support.type]?.healRange ?? support.attackRange;
  if (distance > healRange) return { ok: false, code: 'invalid_heal', message: '目标超出射程' };

  const spent = consumeAction(game, support);
  if (!spent.ok) return spent;

  const amount = rollHeal(game, support);
  const healed = Math.min(target.maxHp - target.hp, amount);
  target.hp += healed;
  support.hasActed = true;
  appendEvent(game, bus, 'heal', {
    owner, supportId, targetId, amount: healed, targetHp: target.hp,
    actionsUsed: game.turn.actionsUsed, actionsRemaining: actionsRemaining(game),
  });
  return { ok: true };
}
