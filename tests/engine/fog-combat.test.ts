// tests/engine/fog-combat.test.ts
// 迷雾引擎验收：攻击揭示（双向/第三方不揭示）、盲射、踩位冲突互现、
// 部署冲突语义、击杀归属、事件投影（攻击/移动/死亡/结算/开局）。
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/events/bus.js';
import { addLobbyPlayer, createLobbyWithConfig } from '../../src/state/store.js';
import { startGame, eliminatePlayer } from '../../src/engine/engine.js';
import { resolveRoundSteps } from '../../src/engine/simultaneousResolve.js';
import {
  FOG_VISION_DEFAULTS, fogProjectionFor, normalizeFogState, projectEventForViewer,
  unitsForViewer, updateFogMemory,
} from '../../src/engine/fog.js';
import { hexRange } from '../../src/engine/hex.js';
import type {
  GameEvent, GameState, MapConfig, PendingAction, PlayerId, SpawnSlotConfig, Unit, UnitType,
} from '../../src/types.js';
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
  const slots: SpawnSlotConfig[] = [
    { id: 's1', headquarters: { q: 5, r: 0 }, startingUnits: [{ type: 'scout', q: 4, r: 0 }] },
    { id: 's2', headquarters: { q: -5, r: 0 }, startingUnits: [{ type: 'scout', q: -4, r: 0 }] },
    { id: 's3', headquarters: { q: 0, r: 5 }, startingUnits: [{ type: 'scout', q: 0, r: 4 }] },
  ];
  return {
    mode: 'fog',
    name: 'Fog Combat Test',
    description: 'fog combat test map',
    grid: 'hex',
    orientation: 'pointy',
    radius: 6,
    playableCells: hexRange({ q: 0, r: 0 }, 6),
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
      adjudicationWeights: { enemyHqDamage: 0, ownHqHp: 0, controlPoint: 0, armyValue: 0, supplies: 0 },
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
function makeGame(overrides: ConfigOverrides = {}, players: 2 | 3 = 2): GameState {
  const config = testConfig(overrides) as MapConfig;
  const game = createLobbyWithConfig(`fog-combat-${unique++}`, 'fog-test', config, {
    maxPlayers: players, participate: true, playerName: 'A',
  });
  for (let i = 1; i < players; i++) addLobbyPlayer(game, `P${i}`);
  const started = startGame(game, new EventBus(), () => 0.42);
  expect(started.ok).toBe(true);
  normalizeFogState(game);
  return game;
}

function bump(game: GameState): void {
  game.stateVersion = (game.stateVersion ?? 0) + 1;
}

function unitOf(game: GameState, owner: PlayerId): Unit {
  const unit = game.units.find(candidate => candidate.owner === owner && candidate.alive);
  expect(unit).toBeTruthy();
  return unit!;
}

/** 改兵种时同步单位数值（真实引擎里由 createUnitFromConfig 一次性写入）。 */
function retype(game: GameState, unit: Unit, type: UnitType): void {
  const spec = game.config.units[type]!;
  unit.type = type;
  unit.maxHp = spec.hp;
  unit.hp = spec.hp;
  unit.attack = spec.attack;
  unit.defense = spec.defense;
  unit.moveRange = spec.moveRange;
  unit.attackRange = spec.attackRange;
  unit.cost = spec.cost;
  unit.canCapture = spec.canCapture;
  if (spec.healPower !== undefined) unit.healPower = spec.healPower;
  else delete unit.healPower;
}

function placeUnits(game: GameState, positions: Array<[PlayerId, number, number]>): void {
  for (const [owner, q, r] of positions) {
    const unit = unitOf(game, owner);
    unit.q = q;
    unit.r = r;
  }
  bump(game);
}

/** 清掉开局路径留下的残影，再按摆位后的真实视野重算，避免出生点邻近造成干扰。 */
function clearMemory(game: GameState): void {
  for (const id of game.turn.turnOrder) {
    if (game.fog) game.fog.lastSeen[id] = {};
  }
  updateFogMemory(game);
}

function queuesFor(
  game: GameState,
  actions: Partial<Record<PlayerId, PendingAction[]>>,
): Map<PlayerId, PendingAction[]> {
  return new Map(game.turn.turnOrder.map(id => [id, actions[id] ?? []]));
}

function lastEvent(game: GameState, type: GameEvent['type']): GameEvent | undefined {
  return [...game.events].reverse().find(event => event.type === type);
}

function lastSeenFor(game: GameState, viewer: PlayerId): Record<string, { q: number; r: number; seenRound: number }> {
  return Object.fromEntries(fogProjectionFor(game, viewer).lastSeen.map(s => [s.unitId, s]));
}

describe('fog combat reveal', () => {
  it('reveals attacker and defender to each other on a hit, but not third parties', () => {
    const game = makeGame({
      terrainCells: [{ q: 0, r: 1, terrain: 'blocker' }],
    }, 3);
    const bus = new EventBus();
    const a = unitOf(game, 'player_a');
    const b = unitOf(game, 'player_b');
    const c = unitOf(game, 'player_c');
    retype(game, a, 'ranger');
    retype(game, b, 'heavy');
    b.hp = 5;
    placeUnits(game, [['player_a', 0, 0], ['player_b', 0, 2], ['player_c', 5, -5]]);
    clearMemory(game);

    // 开火前双方都看不见对方（blocker 挡视线），第三方也看不见。
    expect(unitsForViewer(game, 'player_a').some(u => u.owner === 'player_b')).toBe(false);
    expect(unitsForViewer(game, 'player_b').some(u => u.owner === 'player_a')).toBe(false);
    expect(fogProjectionFor(game, 'player_c').lastSeen).toHaveLength(0);

    const attack: PendingAction = { id: 'a1', type: 'attack', attackerId: a.id, q: 0, r: 2 };
    const resolution = resolveRoundSteps(game, bus, game.turn.turnOrder, queuesFor(game, {
      player_a: [attack],
    }));
    expect(resolution.outcomes.player_a![0]).toMatchObject({ type: 'attack', status: 'executed' });

    // 命中并击杀。
    const hit = lastEvent(game, 'attack')!;
    expect(hit.payload).toMatchObject({ hit: true, targetId: b.id, actualDamage: 5, targetHp: 0 });
    const death = lastEvent(game, 'unit_death')!;
    expect(death.payload).toMatchObject({ unitId: b.id, owner: 'player_b', killer: 'player_a' });

    // 双向残影（1 轮）。
    expect(lastSeenFor(game, 'player_a')[b.id]).toMatchObject({ q: 0, r: 2, seenRound: 1 });
    expect(lastSeenFor(game, 'player_b')[a.id]).toMatchObject({ q: 0, r: 0, seenRound: 1 });
    // 第三方不因交火获得任何信息。
    expect(fogProjectionFor(game, 'player_c').lastSeen).toHaveLength(0);

    // 事件投影：行动者 / 被攻击者保留完整；看不见的第三方丢弃。
    expect(projectEventForViewer(game, hit, 'player_a')).not.toBeNull();
    expect(projectEventForViewer(game, hit, 'player_b')!.payload.attackerId).toBe(a.id);
    expect(projectEventForViewer(game, hit, 'player_c')).toBeNull();
    expect(projectEventForViewer(game, hit, null)).toBeNull();
    expect(projectEventForViewer(game, death, 'player_a')).not.toBeNull();
    expect(projectEventForViewer(game, death, 'player_b')).not.toBeNull();
    expect(projectEventForViewer(game, death, 'player_c')).toBeNull();
  });

  it('reveals a hidden attacker to the headquarters owner when the HQ is hit', () => {
    const game = makeGame();
    const bus = new EventBus();
    const a = unitOf(game, 'player_a');
    const b = unitOf(game, 'player_b');
    retype(game, a, 'ranger');
    retype(game, b, 'heavy');
    const hqB = game.headquarters.player_b!;
    hqB.q = 0;
    hqB.r = 2;
    placeUnits(game, [['player_a', 0, 0], ['player_b', 5, -5]]);
    clearMemory(game);
    expect(fogProjectionFor(game, 'player_b').lastSeen).toHaveLength(0);

    const attack: PendingAction = { id: 'a1', type: 'attack', attackerId: a.id, q: 0, r: 2 };
    resolveRoundSteps(game, bus, game.turn.turnOrder, queuesFor(game, { player_a: [attack] }));
    const hit = lastEvent(game, 'attack')!;
    expect(hit.payload).toMatchObject({ hit: true, targetId: hqB.id, targetKind: 'headquarters' });
    expect(hqB.hp).toBeLessThan(hqB.maxHp);
    // 总部主人获得攻击者快照，并且事件对它完整保留（含攻击者身份）。
    expect(lastSeenFor(game, 'player_b')[a.id]).toMatchObject({ q: 0, r: 0, seenRound: 1 });
    const projected = projectEventForViewer(game, hit, 'player_b');
    expect(projected).not.toBeNull();
    expect(projected!.payload.attackerId).toBe(a.id);
  });

  it('keeps a hit on a hidden target resolvable and records no contact when nothing is hit', () => {
    const game = makeGame();
    const bus = new EventBus();
    const a = unitOf(game, 'player_a');
    retype(game, a, 'ranger');
    placeUnits(game, [['player_a', 0, 0], ['player_b', 5, -5]]);
    // 盲射空地：不产生残影。
    const miss: PendingAction = { id: 'a1', type: 'attack', attackerId: a.id, q: 0, r: 3 };
    const resolution = resolveRoundSteps(game, bus, game.turn.turnOrder, queuesFor(game, { player_a: [miss] }));
    expect(resolution.outcomes.player_a![0]).toMatchObject({ type: 'attack', status: 'missed' });
    expect(fogProjectionFor(game, 'player_a').lastSeen).toHaveLength(0);
  });

  it('reveals both sides when two hidden units step onto the same cell', () => {
    const game = makeGame();
    const bus = new EventBus();
    const a = unitOf(game, 'player_a');
    const b = unitOf(game, 'player_b');
    retype(game, a, 'heavy');
    retype(game, b, 'heavy');
    placeUnits(game, [['player_a', 2, 0], ['player_b', 0, 0]]);
    clearMemory(game);
    // 重装视野 1，互相看不见。
    expect(unitsForViewer(game, 'player_a').some(u => u.owner === 'player_b')).toBe(false);
    expect(unitsForViewer(game, 'player_b').some(u => u.owner === 'player_a')).toBe(false);

    const moveA: PendingAction = { id: 'ma', type: 'move', unitId: a.id, q: 1, r: 0 };
    const moveB: PendingAction = { id: 'mb', type: 'move', unitId: b.id, q: 1, r: 0 };
    const resolution = resolveRoundSteps(game, bus, game.turn.turnOrder, queuesFor(game, {
      player_a: [moveA], player_b: [moveB],
    }));
    expect(resolution.outcomes.player_a![0]).toMatchObject({ status: 'failed', reason: 'destination_conflict' });
    expect(resolution.outcomes.player_b![0]).toMatchObject({ status: 'failed', reason: 'destination_conflict' });
    // 位置不变，但互相写入 1 轮快照。
    expect([a.q, a.r]).toEqual([2, 0]);
    expect([b.q, b.r]).toEqual([0, 0]);
    expect(lastSeenFor(game, 'player_a')[b.id]).toMatchObject({ q: 0, r: 0, seenRound: 1 });
    expect(lastSeenFor(game, 'player_b')[a.id]).toMatchObject({ q: 2, r: 0, seenRound: 1 });
  });

  it('fails a deploy into an occupied cell and records the occupant for the deployer', () => {
    const game = makeGame();
    const bus = new EventBus();
    const a = unitOf(game, 'player_a');
    const b = unitOf(game, 'player_b');
    retype(game, a, 'scout');
    retype(game, b, 'heavy');
    const hq = game.headquarters.player_a!;
    hq.q = -2;
    hq.r = 1;
    placeUnits(game, [['player_a', 3, 0], ['player_b', -1, 1]]);
    clearMemory(game);

    const deploy: PendingAction = {
      id: 'd1', type: 'deploy', unitType: 'infantry', fromId: hq.id, q: -1, r: 1,
    };
    const resolution = resolveRoundSteps(game, bus, game.turn.turnOrder, queuesFor(game, { player_a: [deploy] }));
    expect(resolution.outcomes.player_a![0]).toMatchObject({ status: 'failed', reason: 'destination_occupied' });
    expect(game.units.filter(unit => unit.owner === 'player_a')).toHaveLength(1);
    expect(lastSeenFor(game, 'player_a')[b.id]).toMatchObject({ q: -1, r: 1, seenRound: 1 });
    // 部署失败时没有可暴露的单位，占位者不会凭空获得部署方单位快照。
    expect(Object.keys(fogProjectionFor(game, 'player_b').lastSeen)).not.toContain(a.id);
  });
});

describe('fog event projection', () => {
  it('hides a hidden attacker identity from a third party who can see the target cell', () => {
    const game = makeGame({
      terrainCells: [{ q: 2, r: -2, terrain: 'blocker' }],
    }, 3);
    const bus = new EventBus();
    const a = unitOf(game, 'player_a');
    const b = unitOf(game, 'player_b');
    const c = unitOf(game, 'player_c');
    retype(game, a, 'ranger');
    retype(game, b, 'heavy');
    retype(game, c, 'scout');
    placeUnits(game, [['player_a', 2, 0], ['player_b', 0, 0], ['player_c', 2, -4]]);
    clearMemory(game);
    // C 看得见 B（目标格可见），看不见 A（blocker 挡视线）。
    expect(unitsForViewer(game, 'player_c').some(u => u.owner === 'player_b')).toBe(true);
    expect(unitsForViewer(game, 'player_c').some(u => u.owner === 'player_a')).toBe(false);

    const attack: PendingAction = { id: 'a1', type: 'attack', attackerId: a.id, q: 0, r: 0 };
    resolveRoundSteps(game, bus, game.turn.turnOrder, queuesFor(game, { player_a: [attack] }));
    const hit = lastEvent(game, 'attack')!;
    expect(hit.payload.hit).toBe(true);

    const projected = projectEventForViewer(game, hit, 'player_c');
    expect(projected).not.toBeNull();
    expect(projected!.payload.attackerId).toBeUndefined();
    expect(projected!.payload.owner).toBeUndefined();
    expect(projected!.payload.targetId).toBe(b.id);
    // 被攻击者本人仍能看到攻击者。
    expect(projectEventForViewer(game, hit, 'player_b')!.payload.attackerId).toBe(a.id);
  });

  it('projects move events by destination visibility', () => {
    const game = makeGame();
    const b = unitOf(game, 'player_b');
    retype(game, unitOf(game, 'player_a'), 'ranger');
    placeUnits(game, [['player_a', 0, 0], ['player_b', 5, -5]]);
    const hiddenMove: GameEvent = {
      seq: 100, type: 'move', timestamp: 0,
      payload: { owner: 'player_b', unitId: b.id, fromQ: 5, fromR: -5, toQ: 0, toR: 5 },
    };
    expect(projectEventForViewer(game, hiddenMove, 'player_a')).toBeNull();
    const visibleMove: GameEvent = {
      seq: 101, type: 'move', timestamp: 0,
      payload: { owner: 'player_b', unitId: b.id, fromQ: 5, fromR: -5, toQ: 1, toR: 0 },
    };
    const projected = projectEventForViewer(game, visibleMove, 'player_a');
    expect(projected).not.toBeNull();
    expect(projected!.payload.fromQ).toBeUndefined();
    expect(projected!.payload.fromR).toBeUndefined();
    // 行动者本人保留全部字段。
    expect(projectEventForViewer(game, visibleMove, 'player_b')!.payload.fromQ).toBe(5);
    // 匿名公开视角不发送行动事件。
    expect(projectEventForViewer(game, visibleMove, null)).toBeNull();
  });

  it('strips steps from round_end for players and public, keeping it for the event itself', () => {
    const game = makeGame();
    const event: GameEvent = {
      seq: 201, type: 'round_end', timestamp: 0,
      payload: { roundNumber: 3, gameOver: false, steps: 4, controlHoldCounted: true },
    };
    const aView = projectEventForViewer(game, event, 'player_a')!;
    expect(aView.payload).not.toHaveProperty('steps');
    expect(aView.payload).toMatchObject({ roundNumber: 3, gameOver: false, controlHoldCounted: true });
    const publicView = projectEventForViewer(game, event, null)!;
    expect(publicView.payload).not.toHaveProperty('steps');
    // 投影副本不得修改原事件。
    expect(event.payload.steps).toBe(4);
  });

  it('projects round_resolved to own results only, anonymous gets the skeleton', () => {
    const game = makeGame();
    const event: GameEvent = {
      seq: 200, type: 'round_resolved', timestamp: 0,
      payload: {
        roundNumber: 3,
        gameOver: false,
        results: {
          player_a: [{ actionId: 'x', status: 'executed' }],
          player_b: [{ actionId: 'y', status: 'drawn' }],
        },
        steps: 2,
      },
    };
    const aView = projectEventForViewer(game, event, 'player_a')!;
    expect(aView.payload.results).toEqual({ player_a: [{ actionId: 'x', status: 'executed' }] });
    expect(aView.payload.steps).toBe(1);
    const publicView = projectEventForViewer(game, event, null)!;
    expect(publicView.payload).toEqual({ roundNumber: 3, gameOver: false });
  });

  it('adds fog to game_start config only for fog games', () => {
    const game = makeGame();
    const start = lastEvent(game, 'game_start')!;
    const config = start.payload.config as Record<string, unknown>;
    expect(config.fog).toEqual(game.config.fog);
    // 玩家视角的 game_start 也保留 fog 参数（单位另行投影）。
    expect((projectEventForViewer(game, start, 'player_a')!.payload.config as Record<string, unknown>).fog)
      .toEqual(game.config.fog);

    // 非 fog 局不追加 fog 键，game_start 载荷键集保持不变。
    const plainConfig = testConfig({ mode: 'simultaneous' } as ConfigOverrides) as unknown as Record<string, unknown>;
    delete plainConfig.fog;
    const plain = createLobbyWithConfig(`fog-combat-plain-${unique++}`, 'fog-test', plainConfig as unknown as MapConfig, {
      maxPlayers: 2, participate: true, playerName: 'A',
    });
    addLobbyPlayer(plain, 'P1');
    expect(startGame(plain, new EventBus(), () => 0.42).ok).toBe(true);
    const plainStart = plain.events.find(event => event.type === 'game_start')!;
    expect('fog' in (plainStart.payload.config as Record<string, unknown>)).toBe(false);
  });

  it('drops removedUnitIds of an eliminated player except from that player\'s own view', () => {
    const game = makeGame({}, 3);
    const bus = new EventBus();
    const bUnits = game.units.filter(unit => unit.owner === 'player_b').map(unit => unit.id);
    expect(bUnits.length).toBeGreaterThan(0);
    const eliminated = eliminatePlayer(game, bus, 'player_b', 'headquarters_destroyed', 'player_a');
    expect(eliminated.ok).toBe(true);
    const event = lastEvent(game, 'player_eliminated')!;
    expect(event.payload.playerId).toBe('player_b');
    expect(event.payload.removedUnitIds).toEqual(bUnits);
    const rawScore = event.payload.score as Record<string, unknown>;
    expect(typeof rawScore.total).toBe('number');

    // 淘汰者本人保留剩余单位 ID 与完整裁决分。
    const ownView = projectEventForViewer(game, event, 'player_b')!;
    expect(ownView.payload.removedUnitIds).toEqual(bUnits);
    expect(ownView.payload.score).toEqual(rawScore);
    // 其他玩家与匿名视角：删除隐藏单位 ID，score 按裁决投影只留总分。
    const otherView = projectEventForViewer(game, event, 'player_a')!;
    expect(otherView.payload.playerId).toBe('player_b');
    expect('removedUnitIds' in otherView.payload).toBe(false);
    expect(otherView.payload.score).toEqual({ total: rawScore.total, hidden: true });
    const publicView = projectEventForViewer(game, event, null)!;
    expect(publicView.payload.playerId).toBe('player_b');
    expect('removedUnitIds' in publicView.payload).toBe(false);
    expect(publicView.payload.score).toEqual({ total: rawScore.total });
  });

  it('projects game_start to own units and start-of-game vision only', () => {
    const game = makeGame();
    const start = lastEvent(game, 'game_start')!;
    expect(start).toBeTruthy();
    const aView = projectEventForViewer(game, start, 'player_a')!;
    const startUnits = aView.payload.units as Array<Record<string, unknown>>;
    expect(startUnits.length).toBeGreaterThan(0);
    expect(startUnits.every(unit => unit.owner === 'player_a')).toBe(true);
    const publicView = projectEventForViewer(game, start, null)!;
    expect(publicView.payload).toEqual({ roundNumber: 1 });
  });
});
