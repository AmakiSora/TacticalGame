import type { EventType, GameState, PlayerId } from '../types.js';

export const ACTION_MERIT = {
  deploy: 1,
  demolish: 1,
  capture: 2,
  hpPerPoint: 20,
} as const;

export function effectActionMerit(amount: unknown): number {
  return typeof amount === 'number' && Number.isFinite(amount) && amount > 0
    ? Math.ceil(amount / ACTION_MERIT.hpPerPoint)
    : 0;
}

export function actionMeritForEvent(type: EventType, payload: Record<string, unknown>): number {
  switch (type) {
    case 'deploy': return ACTION_MERIT.deploy;
    case 'attack': return effectActionMerit(payload.actualDamage ?? payload.damage);
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
