import { describe, expect, it } from 'vitest';
import { deployOrigins } from '../../algorithms/lib/game-utils.mjs';

describe('game-utils deployOrigins', () => {
  const game = (deployFromHq?: boolean) => ({
    config: { balance: deployFromHq === undefined ? {} : { deployFromHq } },
    headquarters: { player_a: { id: 'hq_a', alive: true }, player_b: { id: 'hq_b', alive: true } },
    controlPoints: [
      { id: 'cp_own', owner: 'player_a' },
      { id: 'cp_enemy', owner: 'player_b' },
      { id: 'cp_neutral', owner: null },
    ],
  });

  it('includes the own HQ and owned control points by default', () => {
    expect(deployOrigins(game(), 'player_a').map(o => o.id)).toEqual(['hq_a', 'cp_own']);
  });

  it('excludes the HQ when the map sets balance.deployFromHq to false', () => {
    expect(deployOrigins(game(false), 'player_a').map(o => o.id)).toEqual(['cp_own']);
  });
});
