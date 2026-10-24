// 实际引擎与实际公开序列化器，不用策略内部镜像担任裁判。
import { describe, expect, it } from 'vitest';
import { playMatch } from '../../scripts/tempo-weave-arena.mts';

describe('经纬：完整对局与公开配置泛化', () => {
  it.each([
    ['standoff', 2], ['molten-throne', 2], ['standoff', 3], ['standoff', 6],
  ] as const)('%s / %i 席位完整自博弈零拒绝并正常结束', async (map, seats) => {
    const result = await playMatch({ map, names: Array(seats).fill('tempo-weave'), seed: 87123 });
    expect(result.phase).toBe('game_over');
    expect(result.rounds).toBeGreaterThan(1);
    for (const metrics of Object.values(result.metrics)) {
      expect(metrics.rejected).toEqual([]);
      expect(Object.values(metrics.actions).reduce((a: number, b: any) => a + b, 0)).toBeGreaterThan(0);
    }
  }, 120000);

  it('坐标平移、异形缺格、数值与行动点改变后仍能完赛', async () => {
    const result = await playMatch({
      map: 'standoff', names: ['tempo-weave', 'tempo-weave', 'tempo-weave'], seed: 97125,
      transform(game: any) {
        game.config = structuredClone(game.config);
        game.config.balance.actionsPerTurn = 3;
        game.config.balance.attacksPerUnit = 2;
        game.config.balance.maxTurns = 9;
        game.config.balance.deployFromHq = false;
        game.config.balance.adjudicationWeights.controlPoint = 37;
        game.config.units.infantry.attackShape = { type: 'arc' };
        for (const u of game.units) { u.moveRange = 1; u.attackRange = 2; }
        const occupied = new Set([...game.units, ...Object.values(game.headquarters), ...game.controlPoints].map((p: any) => `${p.q},${p.r}`));
        const removed = game.cells.find((p: any) => p.terrain === 'plain' && !occupied.has(`${p.q},${p.r}`));
        game.cells = game.cells.filter((p: any) => p !== removed);
        for (const p of [...game.cells, ...game.units, ...Object.values(game.headquarters), ...game.controlPoints, ...game.map.terrainCells]) { p.q += 17; p.r -= 23; }
      },
    });
    expect(result.phase).toBe('game_over');
    for (const m of Object.values(result.metrics)) expect(m.rejected).toEqual([]);
  }, 120000);
});
