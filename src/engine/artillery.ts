import type { ArtilleryState, GameState, Position } from '../types.js';
import { hexDistance } from './hex.js';

export function artilleryStateForRound(game: GameState, roundNumber: number): ArtilleryState | null {
  const config = game.config.annihilation?.artillery;
  if (game.config.mode !== 'annihilation' || !config) return null;

  const shrinkCount = roundNumber < config.startRound
    ? 0
    : Math.floor((roundNumber - config.startRound) / config.intervalRounds) + 1;
  const safeRadius = Math.max(config.minimumSafeRadius, game.map.radius - shrinkCount);
  const nextShrinkRound = safeRadius <= config.minimumSafeRadius
    ? null
    : shrinkCount === 0
      ? config.startRound
      : config.startRound + shrinkCount * config.intervalRounds;
  const dangerCells = game.cells
    .filter(cell => hexDistance(cell, { q: 0, r: 0 }) > safeRadius)
    .map(({ q, r }) => ({ q, r }));
  const warningCells: Position[] = nextShrinkRound !== null && nextShrinkRound - roundNumber === 1
    ? game.cells
      .filter(cell => {
        const distance = hexDistance(cell, { q: 0, r: 0 });
        return distance > Math.max(config.minimumSafeRadius, safeRadius - 1) && distance <= safeRadius;
      })
      .map(({ q, r }) => ({ q, r }))
    : [];

  return { safeRadius, dangerCells, warningCells, nextShrinkRound };
}

export function isArtilleryDanger(game: GameState, position: Position): boolean {
  return Boolean(game.artillery?.dangerCells.some(cell => cell.q === position.q && cell.r === position.r));
}
