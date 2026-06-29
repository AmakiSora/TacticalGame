import type { ControlPoint, GameState, PlayerId } from '../types.js';
import type { ControlPointTypeSpec } from '../config/loader.js';

export function controlPointTypeSpec(game: GameState, point: ControlPoint): ControlPointTypeSpec | null {
  if (!point.kind) return null;
  return game.config.balance.controlPointTypes?.[point.kind] ?? null;
}

export function controlPointIncome(game: GameState, point: ControlPoint): number {
  return controlPointTypeSpec(game, point)?.income ?? game.config.balance.controlPointIncome;
}

export function deployDiscountForOrigin(game: GameState, owner: PlayerId, fromId: string): number {
  const point = game.controlPoints.find(p => p.id === fromId && p.owner === owner);
  if (!point) return 0;
  return controlPointTypeSpec(game, point)?.deployDiscount ?? 0;
}

