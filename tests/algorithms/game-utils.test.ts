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

  it('excludes owned control points whose type disables deployment (canDeploy: false)', () => {
    // 与引擎 deployOriginFor 同口径：canDeploy 显式为 false 的类型禁止部署，
    // 缺省/其他类型不受影响（molten-throne 仅前线基地可部署）。
    const g = {
      config: {
        balance: {
          controlPointTypes: {
            supply: { income: 8 },
            repair: { income: 6, canDeploy: false },
          },
        },
      },
      headquarters: { player_a: { id: 'hq_a', alive: true } },
      controlPoints: [
        { id: 'cp_supply', owner: 'player_a', kind: 'supply' },
        { id: 'cp_repair', owner: 'player_a', kind: 'repair' },
        { id: 'cp_untyped', owner: 'player_a' },
      ],
    };
    expect(deployOrigins(g, 'player_a').map((o: { id: string }) => o.id))
      .toEqual(['hq_a', 'cp_supply', 'cp_untyped']);
  });
});
