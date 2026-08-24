import type { EventType, GameState, PlayerId } from '../types.js';

export const ACTION_MERIT = {
  deploy: 1,
  demolish: 1,
  capture: 2,
  hpPerPoint: 20,
  /** 同时模式用更细的命中伤害刻度，避免屯兵/存补给压过主动交战。 */
  simultaneousAttackHpPerPoint: 10,
} as const;

export function effectActionMerit(amount: unknown, hpPerPoint: number = ACTION_MERIT.hpPerPoint): number {
  return typeof amount === 'number' && Number.isFinite(amount) && amount > 0
    ? Math.ceil(amount / hpPerPoint)
    : 0;
}

export function attackActionMerit(game: GameState, amount: unknown): number {
  const hpPerPoint = game.config.mode === 'simultaneous'
    ? ACTION_MERIT.simultaneousAttackHpPerPoint
    : ACTION_MERIT.hpPerPoint;
  return effectActionMerit(amount, hpPerPoint);
}

export function actionMeritForEvent(
  type: EventType,
  payload: Record<string, unknown>,
  simultaneous = false,
): number {
  switch (type) {
    case 'deploy': return ACTION_MERIT.deploy;
    case 'attack': return effectActionMerit(
      payload.actualDamage ?? payload.damage,
      simultaneous ? ACTION_MERIT.simultaneousAttackHpPerPoint : ACTION_MERIT.hpPerPoint,
    );
    case 'heal': return effectActionMerit(payload.amount);
    case 'demolish': return ACTION_MERIT.demolish;
    case 'control_point_captured': return ACTION_MERIT.capture;
    default: return 0;
  }
}

export function addActionMerit(game: GameState, owner: PlayerId, amount: number): void {
  if (amount <= 0) return;
  const stats = game.players[owner]?.stats;
  if (stats) stats.actionMerit = (stats.actionMerit ?? 0) + amount;
}
