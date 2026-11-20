// tests/engine/fog-vision.test.ts
// 迷雾引擎验收：各兵种半径、blocker/水/地图外遮挡、共享视野、总部/据点视野、
// 1 轮残影过期、终局/揭雾轮揭晓、淘汰清空、旧档 normalize 幂等。
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/events/bus.js';
import { addLobbyPlayer, createLobby, createLobbyWithConfig } from '../../src/state/store.js';
import { loadMaps } from '../../src/config/loader.js';
import { startGame, eliminatePlayer, endGame } from '../../src/engine/engine.js';
import {
  FOG_VISION_DEFAULTS, createFogState, fogProjectionFor, isCellVisible, isFogRevealed,
  normalizeFogState, recordFogContact, unitsForViewer, updateFogMemory, visibleCellsFor, visionRadius,
} from '../../src/engine/fog.js';
import { hexRange } from '../../src/engine/hex.js';
import type { GameState, MapConfig, PlayerId, SpawnSlotConfig, Unit, UnitType } from '../../src/types.js';
import type { MapConfig as LoaderMapConfig, UnitSpec } from '../../src/config/loader.js';

const UNIT_SPECS: Record<UnitType, UnitSpec> = {
  infantry: { hp: 90, attack: 30, defense: 5, moveRange: 2, attackRange: 2, cost: 50, canCapture: true },
  scout: { hp: 60, attack: 15, defense: 4, moveRange: 3, attackRange: 1, cost: 40, canCapture: true },
  heavy: { hp: 140, attack: 40, defense: 8, moveRange: 2, attackRange: 1, cost: 100, canCapture: false },
  ranger: { hp: 68, attack: 38, defense: 3, moveRange: 2, attackRange: 3, cost: 80, canCapture: false },
  support: { hp: 76, attack: 10, defense: 5, moveRange: 2, attackRange: 2, cost: 68, canCapture: false, healPower: 20, healRange: 2 },
};

type ConfigOverrides = Partial<LoaderMapConfig> & { playableCells?: { q: number; r: number }[] };

function testConfig(overrides: ConfigOverrides = {}): LoaderMapConfig {
  const radius = 6;
  const slots: SpawnSlotConfig[] = [
    { id: 's1', headquarters: { q: 5, r: 0 }, startingUnits: [{ type: 'scout', q: 4, r: 0 }] },
    { id: 's2', headquarters: { q: -5, r: 0 }, startingUnits: [{ type: 'scout', q: -4, r: 0 }] },
    { id: 's3', headquarters: { q: 0, r: 5 }, startingUnits: [{ type: 'scout', q: 0, r: 4 }] },
  ];
  return {
    mode: 'fog',
    name: 'Fog Test',
    description: 'fog test map',
    grid: 'hex',
    orientation: 'pointy',
    radius,
    playableCells: hexRange({ q: 0, r: 0 }, radius),
    terrainCells: [],
    controlPoints: [],
    headquarters: { player_a: { q: 5, r: 0 }, player_b: { q: -5, r: 0 } },
    startingUnits: [],
    spawnSlots: slots,
    layouts: { 2: ['s1', 's2'], 3: ['s1', 's2', 's3'] },
    supportedPlayerCounts: [2, 3],
    units: structuredClone(UNIT_SPECS),
    headquartersSpec: { hp: 100, defense: 0 },
    fog: { vision: { ...FOG_VISION_DEFAULTS }, revealFromRound: null },
    modelEval: false,
    balance: {
      startingSupplies: 300,
      baseIncome: 10,
      damageVarianceRange: 0,
      minimumDamage: 1,
      healVarianceRange: 0,
      actionsPerTurn: 6,
      attacksPerUnit: 1,
      maxTurns: 10,
      adjudicationWeights: {
        enemyHqDamage: 0, ownHqHp: 0, controlPoint: 0, armyValue: 0, supplies: 0,
      },
      controlPointTypes: {
        supply: { income: 0, deployDiscount: 0, repairAmount: 0 },
        forward_base: { income: 0, deployDiscount: 0, repairAmount: 0 },
        repair: { income: 0, deployDiscount: 0, repairAmount: 0 },
      },
    },
    ...overrides,
  } as LoaderMapConfig;
}

let unique = 0;
function makeGame(overrides: ConfigOverrides = {}, players: 2 | 3 = 2): { game: GameState; config: LoaderMapConfig } {
  const config = testConfig(overrides);
  const id = `fog-vision-${unique++}`;
  const game = createLobbyWithConfig(id, 'fog-test', config as MapConfig, {
    maxPlayers: players, participate: true, playerName: 'A',
  });
  for (let i = 1; i < players; i++) addLobbyPlayer(game, `P${i}`);
  const started = startGame(game, new EventBus(), () => 0.42);
  expect(started.ok).toBe(true);
  normalizeFogState(game);
  return { game, config };
}

function bump(game: GameState): void {
  game.stateVersion = (game.stateVersion ?? 0) + 1;
}

function unitOf(game: GameState, owner: PlayerId): Unit {
  const unit = game.units.find(candidate => candidate.owner === owner && candidate.alive);
  expect(unit).toBeTruthy();
  return unit!;
}

/** 把每个玩家的首个单位摆到指定格，然后统一失效索引/视野缓存。 */
function placeUnits(game: GameState, positions: Array<[PlayerId, number, number]>): void {
  for (const [owner, q, r] of positions) {
    const unit = unitOf(game, owner);
    unit.q = q;
    unit.r = r;
  }
  bump(game);
}

function setRound(game: GameState, round: number): void {
  game.turn.roundNumber = round;
  game.turn.turnNumber = round;
  bump(game);
}

describe('fog vision radii', () => {
  it('uses the default radii table', () => {
    expect(FOG_VISION_DEFAULTS).toEqual({ scout: 4, ranger: 3, infantry: 2, support: 2, heavy: 1 });
    const { game } = makeGame();
    expect(visionRadius(game, { kind: 'unit', type: 'scout' })).toBe(4);
    expect(visionRadius(game, { kind: 'unit', type: 'ranger' })).toBe(3);
    expect(visionRadius(game, { kind: 'unit', type: 'infantry' })).toBe(2);
    expect(visionRadius(game, { kind: 'unit', type: 'support' })).toBe(2);
    expect(visionRadius(game, { kind: 'unit', type: 'heavy' })).toBe(1);
    expect(visionRadius(game, { kind: 'headquarters' })).toBe(1);
    expect(visionRadius(game, { kind: 'controlPoint' })).toBe(1);
  });

  it('applies per-map vision overrides', () => {
    const { game } = makeGame({ fog: { vision: { ...FOG_VISION_DEFAULTS, scout: 0 }, revealFromRound: null } });
    const scout = unitOf(game, 'player_a');
    placeUnits(game, [['player_a', 0, 0]]);
    expect(visionRadius(game, { kind: 'unit', type: scout.type })).toBe(0);
    // 0 半径：自身所在格仍可见，相邻格不可见。
    expect(isCellVisible(game, 'player_a', 0, 0)).toBe(true);
    expect(isCellVisible(game, 'player_a', 0, 1)).toBe(false);
  });

  it.each([
    ['scout', 4],
    ['ranger', 3],
    ['infantry', 2],
    ['support', 2],
    ['heavy', 1],
  ] as Array<[UnitType, number]>)('%s sees up to %i cells away', (type, radius) => {
    const { game } = makeGame();
    const unit = unitOf(game, 'player_a');
    unit.type = type;
    placeUnits(game, [['player_a', 0, 0]]);
    expect(isCellVisible(game, 'player_a', 0, radius)).toBe(true);
    expect(isCellVisible(game, 'player_a', 0, radius + 1)).toBe(false);
  });
});

describe('fog line of sight', () => {
  it('blockers block sight, water does not', () => {
    const { game } = makeGame({
      terrainCells: [{ q: 0, r: 1, terrain: 'blocker' }, { q: 0, r: -1, terrain: 'water' }],
    });
    const unit = unitOf(game, 'player_a');
    unit.type = 'scout';
    placeUnits(game, [['player_a', 0, 0]]);
    // blocker 在视线中间 → 后方不可见
    expect(isCellVisible(game, 'player_a', 0, 2)).toBe(false);
    // 水不挡视线 → 后方仍可见
    expect(isCellVisible(game, 'player_a', 0, -2)).toBe(true);
  });

  it('treats unavailable cells (holes) as blocking', () => {
    const playable = hexRange({ q: 0, r: 0 }, 6).filter(cell => !(cell.q === 0 && cell.r === 1));
    const { game } = makeGame({ playableCells: playable });
    const unit = unitOf(game, 'player_a');
    unit.type = 'scout';
    placeUnits(game, [['player_a', 0, 0]]);
    expect(isCellVisible(game, 'player_a', 0, 1)).toBe(false);
    expect(isCellVisible(game, 'player_a', 0, 2)).toBe(false);
  });

  it('shares vision across all own sources', () => {
    const { game } = makeGame();
    const a = unitOf(game, 'player_a');
    a.type = 'heavy';
    placeUnits(game, [['player_a', 0, 0], ['player_b', -5, 5]]);
    const hq = game.headquarters.player_a!;
    const inward = hq.q > 0 ? -1 : 1;
    // 总部提供 1 格：其相邻格可见（排除己方单位视野）。
    expect(isCellVisible(game, 'player_a', hq.q + inward, hq.r)).toBe(true);
    expect(isCellVisible(game, 'player_a', hq.q, hq.r + 1)).toBe(true);
    // 重装自身只照 1 格。
    expect(isCellVisible(game, 'player_a', 0, 1)).toBe(true);
    expect(isCellVisible(game, 'player_a', 0, 2)).toBe(false);
  });

  it('gives owned control points 1-cell vision', () => {
    const { game } = makeGame({
      controlPoints: [{ id: 'cp', name: 'CP', kind: 'supply', q: 0, r: 0 }],
    });
    // 把 A 的单位挪远，避免单位视野干扰据点断言。
    placeUnits(game, [['player_a', 5, -1], ['player_b', -5, 5]]);
    game.controlPoints[0]!.owner = 'player_a';
    bump(game);
    expect(isCellVisible(game, 'player_a', 0, 1)).toBe(true);
    expect(isCellVisible(game, 'player_a', 0, 2)).toBe(false);
  });

  it('keeps own units visible even outside every vision source', () => {
    const { game } = makeGame({ fog: { vision: { ...FOG_VISION_DEFAULTS, scout: 0 }, revealFromRound: null } });
    placeUnits(game, [['player_a', 0, 0]]);
    const own = unitsForViewer(game, 'player_a').filter(unit => unit.owner === 'player_a');
    expect(own).toHaveLength(1);
    expect(own[0]!.q).toBe(0);
  });

  it('hides enemy units outside vision and shows them inside', () => {
    const { game } = makeGame();
    const scout = unitOf(game, 'player_a');
    scout.type = 'infantry'; // 2 格
    placeUnits(game, [['player_a', 0, 0], ['player_b', 0, 3]]);
    expect(unitsForViewer(game, 'player_a').some(unit => unit.owner === 'player_b')).toBe(false);
    placeUnits(game, [['player_b', 0, 2]]);
    expect(unitsForViewer(game, 'player_a').some(unit => unit.owner === 'player_b')).toBe(true);
    expect(visibleCellsFor(game, 'player_a').has('0,2')).toBe(true);
  });
});

describe('fog memory (residuals)', () => {
  it('records sightings and expires them after one full planning round', () => {
    const { game } = makeGame();
    unitOf(game, 'player_a').type = 'scout';
    placeUnits(game, [['player_a', 0, 0], ['player_b', 0, 2]]);
    updateFogMemory(game);
    const first = fogProjectionFor(game, 'player_a');
    expect(first.lastSeen.map(s => s.unitId)).toContain(unitOf(game, 'player_b').id);
    expect(first.lastSeen[0]!.seenRound).toBe(1);

    // 第 2 轮：目标移出视野，残影仍返回旧位置。
    const oldQ = 0;
    const oldR = 2;
    placeUnits(game, [['player_b', 0, -5]]);
    setRound(game, 2);
    updateFogMemory(game);
    const second = fogProjectionFor(game, 'player_a');
    const sighting = second.lastSeen.find(s => s.owner === 'player_b');
    expect(sighting).toMatchObject({ q: oldQ, r: oldR, seenRound: 1 });

    // 第 3 轮：过期丢弃（即使不再调用 updateFogMemory，读取时也过滤）。
    setRound(game, 3);
    expect(fogProjectionFor(game, 'player_a').lastSeen).toHaveLength(0);
    updateFogMemory(game);
    expect(fogProjectionFor(game, 'player_a').lastSeen).toHaveLength(0);
  });

  it('recordFogContact writes a one-round snapshot without changing visibility', () => {
    const { game } = makeGame();
    placeUnits(game, [['player_a', 0, 0], ['player_b', 0, 5]]);
    const enemy = unitOf(game, 'player_b');
    recordFogContact(game, 'player_a', enemy);
    const projection = fogProjectionFor(game, 'player_a');
    expect(projection.lastSeen).toHaveLength(1);
    expect(projection.lastSeen[0]).toMatchObject({ unitId: enemy.id, q: 0, r: 5, seenRound: 1 });
    // 残影不等于可见：units 列表里仍然没有敌军。
    expect(unitsForViewer(game, 'player_a').some(unit => unit.owner === 'player_b')).toBe(false);
  });

  it('clears an eliminated player\'s own memory but keeps others\' residuals until expiry', () => {
    const { game } = makeGame({}, 3);
    const bus = new EventBus();
    unitOf(game, 'player_a').type = 'scout';
    placeUnits(game, [['player_a', 0, 0], ['player_b', 0, 2], ['player_c', 0, -4]]);
    updateFogMemory(game);
    expect(game.fog!.lastSeen.player_a).toBeTruthy();
    expect(fogProjectionFor(game, 'player_a').lastSeen.some(s => s.owner === 'player_b')).toBe(true);

    const eliminated = eliminatePlayer(game, bus, 'player_a', 'headquarters_destroyed', 'player_b');
    expect(eliminated.ok).toBe(true);
    expect(game.fog!.lastSeen.player_a).toBeUndefined();
    // 其他人对 A 的残影按自然过期保留（第 1 轮看见 → 第 2 轮仍在）。
    setRound(game, 2);
    const bSees = fogProjectionFor(game, 'player_b').lastSeen.some(s => s.owner === 'player_a');
    expect(bSees).toBe(true);
  });
});

describe('fog reveal', () => {
  it('reveals from revealFromRound', () => {
    const { game } = makeGame({ fog: { vision: { ...FOG_VISION_DEFAULTS }, revealFromRound: 3 } });
    placeUnits(game, [['player_a', 0, 0], ['player_b', 0, 5]]);
    expect(isFogRevealed(game)).toBe(false);
    setRound(game, 2);
    expect(isFogRevealed(game)).toBe(false);
    setRound(game, 3);
    expect(isFogRevealed(game)).toBe(true);
    expect(fogProjectionFor(game, 'player_a').revealed).toBe(true);
    expect(unitsForViewer(game, 'player_a').some(unit => unit.owner === 'player_b')).toBe(true);
    expect(fogProjectionFor(game, 'player_a').visibleCells).toHaveLength(game.cells.length);
  });

  it('reveals everything on game over', () => {
    const { game } = makeGame();
    placeUnits(game, [['player_a', 0, 0], ['player_b', 0, 5]]);
    expect(unitsForViewer(game, 'player_a').some(unit => unit.owner === 'player_b')).toBe(false);
    endGame(game, new EventBus(), 'player_a', 'last_player_standing');
    expect(isFogRevealed(game)).toBe(true);
    expect(unitsForViewer(game, 'player_a').some(unit => unit.owner === 'player_b')).toBe(true);
  });
});

describe('fog state normalization', () => {
  it('is idempotent and backfills player memories', () => {
    const { game } = makeGame();
    delete game.fog;
    normalizeFogState(game);
    expect(game.fog).toBeTruthy();
    expect(game.fog!.lastSeen.player_a).toEqual({});
    expect(game.fog!.lastSeen.player_b).toEqual({});
    const snapshot = structuredClone(game.fog);
    normalizeFogState(game);
    expect(game.fog).toEqual(snapshot);
  });

  it('creates the same empty shape via createFogState', () => {
    expect(createFogState()).toEqual({ lastSeen: {} });
  });

  it('does not add fog state to non-fog games', () => {
    const { game } = makeGame({ mode: 'standard' } as ConfigOverrides);
    delete game.fog;
    normalizeFogState(game);
    expect(game.fog).toBeUndefined();
  });
});

// 视线性在棋盘对称变换下必须等变：hex 线段光栅化若带固定方向的 tie-break，
// 严格镜像的两个座位会看到格数不同的视野（T3 标定定位的真实缺陷）。
// fog-harbor 是 180° 对称，fog-crossing 是三座 120° 旋转对称。
describe('fog line of sight symmetry', () => {
  const sorted = (cells: Iterable<string>): string[] => [...cells].sort();
  const mirror180Key = (key: string): string => {
    const [q, r] = key.split(',').map(Number) as [number, number];
    return `${0 - q},${0 - r}`;
  };
  const rot120Key = (key: string): string => {
    const [q, r] = key.split(',').map(Number) as [number, number];
    return `${0 - q - r},${q}`;
  };

  function startRealGame(mapId: string, players: 2 | 3): GameState {
    loadMaps();
    const game = createLobby(`fog-vision-sym-${unique++}`, mapId, {
      maxPlayers: players, participate: true, playerName: 'A',
    });
    for (let i = 1; i < players; i++) addLobbyPlayer(game, `P${i}`);
    const started = startGame(game, new EventBus(), () => 0.42);
    expect(started.ok).toBe(true);
    normalizeFogState(game);
    return game;
  }

  function ownerAt(game: GameState, q: number, r: number): PlayerId {
    const owner = game.turn.turnOrder.find(id => {
      const hq = game.headquarters[id];
      return hq?.q === q && hq?.r === r;
    });
    expect(owner).toBeTruthy();
    return owner!;
  }

  it('gives mirrored scouts identical (mirrored) vision on fog-harbor', () => {
    const game = startRealGame('fog-harbor', 2);
    const east = ownerAt(game, 8, 0);
    const west = ownerAt(game, -8, 0);
    // 每边只留一个侦察兵，位置严格 180° 镜像：(1,0) / (-1,0)。
    const templates = new Map<PlayerId, Unit>([
      [east, unitOf(game, east)],
      [west, unitOf(game, west)],
    ]);
    game.units = ([
      [east, 1, 0],
      [west, -1, 0],
    ] as Array<[PlayerId, number, number]>).map(([owner, q, r]) => {
      const template = templates.get(owner)!;
      return { ...template, id: `${owner}-mirror`, owner, q, r, alive: true, hp: template.maxHp };
    });
    bump(game);

    const eastCells = visibleCellsFor(game, east);
    const westCells = visibleCellsFor(game, west);
    expect(eastCells.size).toBe(westCells.size);
    expect(sorted(westCells)).toEqual(sorted([...eastCells].map(mirror180Key)));
  });

  it('rotates vision across the three seats on fog-crossing', () => {
    const game = startRealGame('fog-crossing', 3);
    const east = ownerAt(game, 8, 0);
    const northwest = ownerAt(game, -8, 8);
    const south = ownerAt(game, 0, -8);

    const eastCells = sorted(visibleCellsFor(game, east));
    const northwestCells = sorted(visibleCellsFor(game, northwest));
    const southCells = sorted(visibleCellsFor(game, south));

    // T: (q,r) → (-q-r, q) 把 east 座位转到 northwest，再转一次到 south。
    expect(northwestCells).toEqual(sorted(eastCells.map(rot120Key)));
    expect(southCells).toEqual(sorted(northwestCells.map(rot120Key)));
    expect(eastCells).toEqual(sorted(southCells.map(rot120Key)));
  });
});
