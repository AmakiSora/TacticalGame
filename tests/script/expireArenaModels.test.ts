import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findCandidates, rankPerMap, resolveModelFile } from '../../script/expireArenaModels.mjs';

let tempDir: string | null = null;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

const model = (version: string, rating: number, games = 96) => ({
  id: `hex_ppo_${version}_20260918_random_selfplay_1000000.zip`,
  rating, games,
});

/**
 * 4 名模型参与者 × 2 张图：
 *   m1: A 1800 > B 1700 > C 1600 > D 1500
 *   m2: C 1900 > A 1800 > B 1700 > D 1500
 * ⇒ D 两张图都垫底且无突出图（候选）；C 在 m2 第 1 名（偏科，不算过期）；
 *   B 在 m1 排第 2，不属于「后半段」。
 */
function fakeLeaderboard() {
  const A = model('v9.0.0', 1900);
  const B = model('v9.0.1', 1750);
  const C = model('v9.0.2', 1700);
  const D = model('v9.0.3', 1400);
  const league = rows => ({ models: rows });
  return {
    registry: Object.fromEntries([A, B, C, D].map(m => [m.id, {
      kind: 'model', version: m.id.match(/_(v\d+\.\d+\.\d+)_/)[1], short: m.id.match(/_(v\d+\.\d+\.\d+)_/)[1],
    }])),
    maps: {
      all: league([A, B, C, D]),
      m1: league([A, B, C, D].map(m => ({ ...m, rating: { [A.id]: 1800, [B.id]: 1700, [C.id]: 1600, [D.id]: 1500 }[m.id] }))),
      m2: league([A, B, C, D].map(m => ({ ...m, rating: { [A.id]: 1800, [B.id]: 1700, [C.id]: 1900, [D.id]: 1500 }[m.id] }))),
    },
  };
}

describe('rankPerMap', () => {
  it('每张图按评分降序给出 rank/n，排除未参评（games=0）的参与者', () => {
    const lb = fakeLeaderboard();
    lb.maps.m1.models.push({ id: 'hex_ppo_v9.0.4_20260918_random_selfplay_1000000.zip', rating: 9999, games: 0 });
    const { maps, rankByMap } = rankPerMap(lb);
    expect(maps).toEqual(['m1', 'm2']);
    const d1 = rankByMap.get('m1');
    expect(d1.size).toBe(4); // games=0 的没进榜
    expect([...d1.values()].map(v => v.rank)).toEqual([1, 2, 3, 4]);
    expect(d1.get([...d1.keys()][0]).n).toBe(4);
  });
});

describe('findCandidates', () => {
  it('只挑「每张图都在后半段且无任何突出图」的模型', () => {
    const { candidates, skipped, maps } = findCandidates(fakeLeaderboard());
    expect(maps).toEqual(['m1', 'm2']);
    expect(candidates.map(c => c.version)).toEqual(['v9.0.3']);
    expect(candidates[0].ranks.m1).toMatchObject({ rank: 4, n: 4 });
    expect(candidates[0].ranks.m2).toMatchObject({ rank: 4, n: 4 });
    expect(candidates[0].meanPos).toBe(1);

    const reasons = Object.fromEntries(skipped.map(s => [s.version, s.reason]));
    expect(reasons['v9.0.2']).toMatch(/有突出图（m2 1\/4）/);
    expect(reasons['v9.0.1']).toMatch(/并非每张图都在后半段（m1 2\/4）/);
    expect(reasons['v9.0.0']).toMatch(/有突出图（m1 1\/4）/);
  });

  it('用 exclude 跳过已过期的模型，避免重复入选', () => {
    const lb = fakeLeaderboard();
    const dId = Object.keys(lb.registry)[3];
    const { candidates } = findCandidates(lb, { exclude: new Set([dId]) });
    expect(candidates).toHaveLength(0);
  });

  it('有多条候选取「平均名次位置」最差的在前', () => {
    const lb = fakeLeaderboard();
    // 再加一个两张图都垫得更彻底的模型 E（1000），D 与 E 都是候选，E 应排在前面。
    const E = { id: 'hex_ppo_v9.0.5_20260918_random_selfplay_1000000.zip', rating: 1000, games: 96 };
    lb.registry[E.id] = { kind: 'model', version: 'v9.0.5', short: 'v9.0.5' };
    lb.maps.all.models.push(E);
    for (const map of ['m1', 'm2']) lb.maps[map].models.push(E);

    const { candidates } = findCandidates(lb);
    expect(candidates.map(c => c.version)).toEqual(['v9.0.5', 'v9.0.3']);
    expect(candidates[0].meanPos).toBe(1);
    expect(candidates[1].meanPos).toBeCloseTo(0.8, 6);
  });
});

describe('resolveModelFile', () => {
  it('按版本在模型目录里找回交付 zip', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'rl-expire-'));
    writeFileSync(join(tempDir, 'hex_ppo_v2.5.0_20260830_random_selfplay_2000000.zip'), 'zip');
    writeFileSync(join(tempDir, 'hex_ppo_v2.6.0_20260831_random_selfplay_4000000.zip'), 'zip');
    expect(resolveModelFile(tempDir, 'v2.5.0')).toBe('hex_ppo_v2.5.0_20260830_random_selfplay_2000000.zip');
    expect(() => resolveModelFile(tempDir, 'v9.9.9')).toThrow(/没有 v9\.9\.9/);
  });
});
