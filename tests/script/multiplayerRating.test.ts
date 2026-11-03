import { describe, expect, it } from 'vitest';
import {
  buildMultiplayerLeague,
  completeSuperblocks,
  solveTieAwarePL,
} from '../../script/multiplayerRating.mjs';

const A = 'strong';
const B = 'middle';
const C = 'weak';
const IDS = [A, B, C];
const SEATS = ['player_a', 'player_b', 'player_c'] as const;

function plGame(rankGroups: string[][]) {
  return { playerCount: 3, rankGroups };
}

function makeGame(direction: 'forward' | 'reverse', rotation: 0 | 1 | 2, overrides: any = {}) {
  const forward = [A, B, C];
  const reverse = [A, C, B];
  const base = direction === 'forward' ? forward : reverse;
  const players = Object.fromEntries(SEATS.map((seat, index) => [seat, base[(index + rotation) % 3]]));
  const rankGroups = overrides.rankGroups ?? [[A], [B], [C]];
  const decisionSec = Object.fromEntries(SEATS.map(seat => [seat,
    players[seat] === A ? 0.6 : players[seat] === B ? 0.2 : null]));
  const decisionCount = Object.fromEntries(SEATS.map(seat => [seat,
    players[seat] === A ? 30 : players[seat] === B ? 20 : null]));
  return {
    map: 'default',
    players,
    playerCount: 3,
    rulesVersion: 'rules-v1',
    winner: rankGroups.length > 1 && rankGroups[0].length === 1 ? rankGroups[0][0] : null,
    rankGroups,
    rounds: 12,
    decisionSec,
    decisionCount,
    seed: 'seed-1',
    ...overrides,
    schedule: {
      manifestHash: 'manifest-1',
      lineupId: 'lineup-1',
      superblockId: 'superblock-1',
      blockId: `superblock-1-${direction}-${rotation}`,
      direction,
      rotation,
      ...overrides.schedule,
    },
  };
}

function makeBlock(rankGroups?: string[][][], overrides: any = {}) {
  const games = [];
  for (const direction of ['forward', 'reverse'] as const) {
    for (const rotation of [0, 1, 2] as const) {
      const index = games.length;
      games.push(makeGame(direction, rotation, {
        ...overrides,
        rankGroups: rankGroups?.[index] ?? overrides.rankGroups ?? [[A], [B], [C]],
        schedule: { ...overrides.schedule },
      }));
    }
  }
  return games;
}

function mulberry32(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6D2B79F5) | 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('solveTieAwarePL', () => {
  it('强弱合成排名得到有序且零均值的强度', () => {
    const games = Array.from({ length: 12 }, () => plGame([[A], [B], [C]]));
    const beta = solveTieAwarePL(games, IDS);
    expect(beta[0]).toBeGreaterThan(beta[1]);
    expect(beta[1]).toBeGreaterThan(beta[2]);
    expect(beta.reduce((sum, value) => sum + value, 0)).toBeCloseTo(0, 10);
    expect(beta.every(Number.isFinite)).toBe(true);
  });

  it('全并列不贡献信息，加入全并列局不改变拟合', () => {
    const informative = [
      plGame([[A], [B], [C]]),
      plGame([[A, B], [C]]),
      plGame([[B], [A], [C]]),
    ];
    const before = solveTieAwarePL(informative, IDS);
    const after = solveTieAwarePL([...informative, plGame([[A, B, C]]), plGame([[A, B, C]])], IDS);
    expect(after).toEqual(before);
    expect(solveTieAwarePL([plGame([[A, B, C]])], IDS)).toEqual([0, 0, 0]);
  });

  it('同分并列不被人为破平', () => {
    const games = Array.from({ length: 8 }, () => plGame([[A, B], [C]]));
    const beta = solveTieAwarePL(games, IDS);
    expect(beta[0]).toBeCloseTo(beta[1], 8);
    expect(beta[0]).toBeGreaterThan(beta[2]);
  });

  it('小样本全败评分有限', () => {
    const games = [plGame([[A], [B], [C]])];
    const beta = solveTieAwarePL(games, IDS);
    expect(beta.every(Number.isFinite)).toBe(true);
    expect(beta[2]).toBeLessThan(0);
    expect(Math.abs(beta[2])).toBeLessThan(100);
  });

  it('正式规模的 2520 局不会在浮点平台上空转到 maxIter', () => {
    const games = Array.from({ length: 2520 }, (_, index) => plGame([
      [A], index % 3 === 0 ? [B] : [C], index % 3 === 0 ? [C] : [B],
    ]));
    const started = performance.now();
    const beta = solveTieAwarePL(games, IDS);
    expect(performance.now() - started).toBeLessThan(5000);
    expect(beta.every(Number.isFinite)).toBe(true);
    expect(beta[0]).toBeGreaterThan(beta[1]);
    expect(beta[0]).toBeGreaterThan(beta[2]);
  });

  it('warm start 与冷启动收敛到同一最优解', () => {
    const games = Array.from({ length: 36 }, (_, index) => plGame(index % 4 === 0
      ? [[A, B], [C]] : [[A], [B], [C]]));
    const cold = solveTieAwarePL(games, IDS);
    const warm = solveTieAwarePL(games, IDS, { initial: cold });
    for (let i = 0; i < IDS.length; i++) expect(warm[i]).toBeCloseTo(cold[i], 6);
  });
});

describe('completeSuperblocks', () => {
  it('接受双向三轮换且每人每座位两次的六局块', () => {
    const result = completeSuperblocks(makeBlock());
    expect(result.complete.size).toBe(1);
    expect(result.complete.values().next().value).toHaveLength(6);
    expect(result.quarantined).toBe(0);
  });

  it('隔离残块，buildMultiplayerLeague 只使用完整块', () => {
    const partial = makeBlock(undefined, {
      schedule: { superblockId: 'partial' },
    }).slice(0, 5).map((game, index) => ({
      ...game,
      schedule: { ...game.schedule, blockId: `partial-${index}` },
    }));
    const games = [...makeBlock(), ...partial];
    const result = completeSuperblocks(games);
    expect(result.complete.size).toBe(1);
    expect(result.quarantined).toBe(1);
    const league = buildMultiplayerLeague(games, IDS);
    expect(league.overview).toMatchObject({
      games: 6,
      superblockCount: 1,
      quarantinedSuperblocks: 1,
    });
  });

  it('接受同一个三局块共用一个 blockId（执行器真实输出形状）', () => {
    const games = makeBlock().map(game => ({
      ...game,
      schedule: {
        ...game.schedule,
        blockId: `${game.schedule.superblockId}:${game.schedule.direction}`,
      },
    }));
    const result = completeSuperblocks(games);
    expect(result.complete.size).toBe(1);
    expect(result.quarantined).toBe(0);
  });

  it('地图不一致、重复局和座位不均衡都使整个块隔离', () => {
    const wrongMap = makeBlock();
    wrongMap[2] = { ...wrongMap[2], map: 'other' };
    const duplicate = makeBlock();
    duplicate[1] = { ...duplicate[0], rankGroups: [[C], [B], [A]] };
    const wrongSeats = makeBlock();
    wrongSeats[0] = {
      ...wrongSeats[0],
      players: { player_a: A, player_b: B, player_c: A },
    };
    expect(completeSuperblocks(wrongMap)).toEqual({ complete: new Map(), quarantined: 1 });
    expect(completeSuperblocks(duplicate)).toEqual({ complete: new Map(), quarantined: 1 });
    expect(completeSuperblocks(wrongSeats)).toEqual({ complete: new Map(), quarantined: 1 });
  });
});

describe('buildMultiplayerLeague', () => {
  it('输出胜负、名次、placement、计时、分座位和审计辅助指标', () => {
    const ranks = [
      [[A], [B], [C]],
      [[A, B], [C]],
      [[A, B, C]],
      [[C], [A], [B]],
      [[B], [C], [A]],
      [[A], [C], [B]],
    ];
    const games = makeBlock(ranks).map((game, index) => ({ ...game, rounds: 10 + index }));
    const league = buildMultiplayerLeague(games, [...IDS, 'unused']);
    expect(league.overview).toEqual({
      games: 6,
      superblockCount: 1,
      quarantinedSuperblocks: 0,
      draws: 1,
      drawRate: 0.1667,
      avgRounds: 12.5,
      uniqueWinRate: 0.6667,
    });
    const strong = league.models.find(model => model.id === A);
    expect(strong).toMatchObject({
      games: 6,
      uniqueWins: 2,
      topGroupCount: 4,
      uniqueWinRate: 0.3333,
      topGroupRate: 0.6667,
      averageRank: 1.75,
      placementScore: 0.625,
      avgRounds: 12.5,
      avgDecisionMs: 20,
      provisional: true,
      wilson: 0.2698,
    });
    expect(strong.wilson).toBeLessThan(strong.placementScore);
    expect(strong.perMap.default.games).toBe(6);
    for (const seat of SEATS) expect(strong.perSeat[seat].games).toBe(2);
    expect(league.models.find(model => model.id === B).avgDecisionMs).toBe(10);
    expect(league.models.find(model => model.id === C).avgDecisionMs).toBeNull();
    expect(league.models.find(model => model.id === 'unused')).toMatchObject({
      rating: null,
      ratingLo: null,
      ratingHi: null,
      games: 0,
      uniqueWinRate: null,
      placementScore: null,
      provisional: true,
    });
    expect(league.audit.encounterMatrix[A][B]).toBe(6);
    expect(league.audit.encounterMatrix[A][A]).toBe(0);
    expect(league.audit.leaveOneLineupOut[A]).toBeNull();
    for (const seat of SEATS) expect(league.audit.seatPlacementScore[seat]).not.toBeNull();
  });

  it('按地图与阵容分层 bootstrap 可复现并输出 percentile CI', () => {
    const second = makeBlock([
      [[C], [B], [A]], [[C], [A], [B]], [[B], [C], [A]],
      [[C], [B], [A]], [[B], [C], [A]], [[C], [A], [B]],
    ], {
      map: 'other',
      seed: 'seed-2',
      schedule: { superblockId: 'superblock-2', lineupId: 'lineup-2' },
    }).map((game, index) => ({
      ...game,
      schedule: { ...game.schedule, blockId: `superblock-2-${index}` },
    }));
    const third = makeBlock(undefined, {
      schedule: { superblockId: 'superblock-3' },
    }).map((game, index) => ({
      ...game,
      schedule: { ...game.schedule, blockId: `superblock-3-${index}` },
    }));
    const games = [...makeBlock(), ...second, ...third];
    const options = { bootstrapN: 24, rngFactory: () => mulberry32(42) };
    const first = buildMultiplayerLeague(games, IDS, options);
    const replay = buildMultiplayerLeague(games, IDS, options);
    expect(replay).toEqual(first);
    for (const model of first.models) {
      expect(model.ratingLo).not.toBeNull();
      expect(model.ratingHi).not.toBeNull();
      expect(model.ratingLo).toBeLessThanOrEqual(model.ratingHi);
    }
    expect(first.audit.leaveOneLineupOut[A]).not.toBeNull();
  });

  it('所有座位同步轮换时评分和总体名次指标不变', () => {
    const games = makeBlock([
      [[A], [B], [C]], [[A, B], [C]], [[C], [A], [B]],
      [[A], [C], [B]], [[B], [A], [C]], [[A], [B], [C]],
    ]);
    const rotated = games.map(game => ({
      ...game,
      players: {
        player_a: game.players.player_c,
        player_b: game.players.player_a,
        player_c: game.players.player_b,
      },
    }));
    const before = buildMultiplayerLeague(games, IDS);
    const after = buildMultiplayerLeague(rotated, IDS);
    expect(after.models.map(model => [
      model.id, model.rating, model.uniqueWins, model.topGroupCount,
      model.averageRank, model.placementScore,
    ])).toEqual(before.models.map(model => [
      model.id, model.rating, model.uniqueWins, model.topGroupCount,
      model.averageRank, model.placementScore,
    ]));
  });
});
