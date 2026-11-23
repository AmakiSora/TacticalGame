// tests/engine/fog-event-frozen.test.ts
// 4.0.1 迷雾事件披露：发生时刻固化、区域攻击/治疗逐目标、落空只给攻击者、
// 淘汰者身份只给本人与击杀者、观者序号连续、旧存档回落与非 fog 零变化。
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/events/bus.js';
import { addLobbyPlayer, createLobbyWithConfig } from '../../src/state/store.js';
import { eliminatePlayer, startGame } from '../../src/engine/engine.js';
import { appendEvent } from '../../src/engine/events.js';
import { resolveRoundSteps } from '../../src/engine/simultaneousResolve.js';
import {
  FOG_VISION_DEFAULTS, fogLastVisibleSeq, fogViewerSeqOf, normalizeFogState,
  projectEventForViewer, projectFogHistoryForViewer, visibleCellsFor,
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
    name: 'Fog Frozen Event Test',
    description: 'fog frozen event test map',
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
  const game = createLobbyWithConfig(`fog-frozen-${unique++}`, 'fog-test', config, {
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

function setRound(game: GameState, round: number): void {
  game.turn.roundNumber = round;
  game.turn.turnNumber = round;
  bump(game);
}

function queuesFor(
  game: GameState,
  actions: Partial<Record<PlayerId, PendingAction[]>>,
): Map<PlayerId, PendingAction[]> {
  return new Map(game.turn.turnOrder.map(id => [id, actions[id] ?? []]));
}

function eventWithTarget(game: GameState, type: GameEvent['type'], targetId: string): GameEvent {
  const event = [...game.events].reverse().find(candidate =>
    candidate.type === type && candidate.payload.targetId === targetId);
  expect(event).toBeTruthy();
  return event!;
}

/** 断言某个 payload 完全不含这些键（隐藏目标不得留任何痕迹）。 */
function expectKeysAbsent(payload: Record<string, unknown>, keys: string[]): void {
  for (const key of keys) expect(key in payload).toBe(false);
}

describe('frozen disclosure', () => {
  it('keeps a historical hidden event hidden after the viewer later sees that cell', () => {
    const game = makeGame();
    const bus = new EventBus();
    const a = unitOf(game, 'player_a');
    const b = unitOf(game, 'player_b');
    retype(game, a, 'scout');
    retype(game, b, 'heavy');
    placeUnits(game, [['player_a', 0, 0], ['player_b', 5, -5]]);
    bump(game);

    // B 在 A 视野外部署新单位：发生时刻对 A 隐藏并固化。
    const event = appendEvent(game, bus, 'deploy', {
      owner: 'player_b', unitType: 'infantry', unitId: 'b-hidden', q: 5, r: -4,
      fromId: game.headquarters.player_b!.id,
    });
    expect(projectEventForViewer(game, event, 'player_a')).toBeNull();
    expect(fogViewerSeqOf(game, event, 'player_a')).toBeNull();
    expect(projectFogHistoryForViewer(game, 'player_a').some(item => item.type === 'deploy')).toBe(false);

    // A 的侦察兵随后走到能看见 (5,-4) 的位置：历史事件仍按发生时刻披露。
    a.q = 4;
    a.r = -4;
    bump(game);
    expect(visibleCellsFor(game, 'player_a').has('5,-4')).toBe(true);
    expect(projectEventForViewer(game, event, 'player_a')).toBeNull();
    expect(projectFogHistoryForViewer(game, 'player_a').some(item => item.type === 'deploy')).toBe(false);
    // 部署者本人始终能看到自己的事件。
    expect(projectEventForViewer(game, event, 'player_b')).not.toBeNull();
  });

  it('does not backfill frozen history when the fog is revealed', () => {
    const game = makeGame({ fog: { vision: { ...FOG_VISION_DEFAULTS }, revealFromRound: 3 } });
    const bus = new EventBus();
    const a = unitOf(game, 'player_a');
    const b = unitOf(game, 'player_b');
    retype(game, a, 'scout');
    retype(game, b, 'heavy');
    placeUnits(game, [['player_a', 0, 0], ['player_b', 5, -5]]);
    bump(game);

    // 揭雾前发生的隐藏移动：固化 null。
    const oldMove = appendEvent(game, bus, 'move', {
      owner: 'player_b', unitId: b.id, fromQ: 5, fromR: -5, toQ: 5, toR: -4,
    });
    expect(projectEventForViewer(game, oldMove, 'player_a')).toBeNull();

    // 进入揭雾轮：新事件全量，但历史保持原披露。
    setRound(game, 3);
    const newMove = appendEvent(game, bus, 'move', {
      owner: 'player_b', unitId: b.id, fromQ: 5, fromR: -4, toQ: 5, toR: -3,
    });
    expect(projectEventForViewer(game, newMove, 'player_a')).not.toBeNull();
    expect(projectEventForViewer(game, oldMove, 'player_a')).toBeNull();
    const history = projectFogHistoryForViewer(game, 'player_a');
    expect(history.some(item => item.type === 'move' && item.payload.toR === -4)).toBe(false);
    expect(history.some(item => item.type === 'move' && item.payload.toR === -3)).toBe(true);
  });

  it('records frozen views but never returns them to clients', () => {
    const game = makeGame({}, 3);
    const bus = new EventBus();
    const event = appendEvent(game, bus, 'round_start', { roundNumber: 2 });
    expect(event.fogViews).toBeTruthy();
    expect(event.fogSeqs).toBeTruthy();
    for (const viewer of ['player_a', 'player_b', 'player_c', null] as const) {
      const projected = projectEventForViewer(game, event, viewer);
      expect(projected).not.toBeNull();
      expect(projected!.fogViews).toBeUndefined();
      expect(projected!.fogSeqs).toBeUndefined();
    }
    const history = projectFogHistoryForViewer(game, 'player_a');
    for (const item of history) {
      expect(item.fogViews).toBeUndefined();
      expect(item.fogSeqs).toBeUndefined();
    }
  });
});

describe('area attack disclosure', () => {
  it('drops a hidden splash hit for third parties but keeps visible own hits', () => {
    const units = structuredClone(UNIT_SPECS);
    units.ranger.attackShape = { type: 'arc' };
    const game = makeGame({
      units,
      // C 的重装视野 0：只看得见自己所在格，落在 (1,-1) 的 B 对 C 隐藏。
      fog: { vision: { ...FOG_VISION_DEFAULTS, heavy: 0 }, revealFromRound: null },
    }, 3);
    const bus = new EventBus();
    const a = unitOf(game, 'player_a');
    const b = unitOf(game, 'player_b');
    const c = unitOf(game, 'player_c');
    retype(game, a, 'ranger');
    retype(game, b, 'heavy');
    retype(game, c, 'heavy');
    placeUnits(game, [['player_a', 0, 0], ['player_b', 1, -1], ['player_c', 1, 0]]);
    bump(game);
    // 扇形覆盖 (0,1)/(1,0)/(1,-1)：C 只看得到自己的 (1,0)，看不到 B 的 (1,-1)。
    expect(visibleCellsFor(game, 'player_c').has('1,0')).toBe(true);
    expect(visibleCellsFor(game, 'player_c').has('1,-1')).toBe(false);

    const attack: PendingAction = { id: 'a1', type: 'attack', attackerId: a.id, q: 1, r: 0 };
    resolveRoundSteps(game, bus, game.turn.turnOrder, queuesFor(game, { player_a: [attack] }));

    const hitB = eventWithTarget(game, 'attack', b.id);
    const hitC = eventWithTarget(game, 'attack', c.id);
    expect(hitB.payload.hit).toBe(true);
    expect(hitC.payload.hit).toBe(true);
    // 第三方 C：隐藏命中整条丢弃；自己挨的那一下完整保留（目标 owner 快照规则）。
    expect(projectEventForViewer(game, hitB, 'player_c')).toBeNull();
    expect(fogViewerSeqOf(game, hitB, 'player_c')).toBeNull();
    const ownView = projectEventForViewer(game, hitC, 'player_c')!;
    expect(ownView.payload.attackerId).toBe(a.id);
    expect(ownView.payload.targetId).toBe(c.id);
    // C 的事件历史里只有自己的那次命中，且不含 B 的 unitId。
    const cAttacks = projectFogHistoryForViewer(game, 'player_c').filter(item => item.type === 'attack');
    expect(cAttacks).toHaveLength(1);
    expect(JSON.stringify(cAttacks)).not.toContain(b.id);
    // 被击中但隐藏的 B 不会以任何伤害字段出现在 C 的投影里。
    expect(JSON.stringify(projectFogHistoryForViewer(game, 'player_c'))).not.toContain('"1,-1"');
  });

  it('hides attacker identity and aim geometry on a visible hit', () => {
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
    bump(game);
    expect(visibleCellsFor(game, 'player_c').has('0,0')).toBe(true);

    const attack: PendingAction = { id: 'a1', type: 'attack', attackerId: a.id, q: 0, r: 0 };
    resolveRoundSteps(game, bus, game.turn.turnOrder, queuesFor(game, { player_a: [attack] }));
    const hit = eventWithTarget(game, 'attack', b.id);
    expect(hit.payload.hit).toBe(true);
    expect(hit.payload.aimQ).toBe(0);

    const thirdParty = projectEventForViewer(game, hit, 'player_c')!;
    // 攻击者不可见：身份 + 瞄准几何全部脱敏，只留可见命中格与伤害/血量。
    expectKeysAbsent(thirdParty.payload, ['attackerId', 'owner', 'aimQ', 'aimR', 'shape']);
    expect(thirdParty.payload.targetId).toBe(b.id);
    expect(thirdParty.payload.q).toBe(0);
    expect(thirdParty.payload.r).toBe(0);
    expect(typeof thirdParty.payload.damage).toBe('number');
    expect(typeof thirdParty.payload.actualDamage).toBe('number');
    expect(typeof thirdParty.payload.targetHp).toBe('number');
    // 被命中者本人照旧拿到攻击者身份。
    expect(projectEventForViewer(game, hit, 'player_b')!.payload.attackerId).toBe(a.id);
  });

  it('gives a miss (including a locked miss) only to the attacker', () => {
    const game = makeGame({}, 3);
    const bus = new EventBus();
    const a = unitOf(game, 'player_a');
    const b = unitOf(game, 'player_b');
    retype(game, a, 'ranger');
    retype(game, b, 'heavy');
    placeUnits(game, [['player_a', 0, 0], ['player_b', 0, 2], ['player_c', 5, -5]]);
    bump(game);

    const miss: PendingAction = { id: 'a1', type: 'attack', attackerId: a.id, q: 0, r: 1 };
    resolveRoundSteps(game, bus, game.turn.turnOrder, queuesFor(game, { player_a: [miss] }));
    const event = [...game.events].reverse().find(item => item.type === 'attack')!;
    expect(event.payload).toMatchObject({ hit: false, q: 0, r: 1 });
    expect(projectEventForViewer(game, event, 'player_a')).not.toBeNull();
    // B 看得见落点格 (0,1)，但落空信息只属于攻击者。
    expect(visibleCellsFor(game, 'player_b').has('0,1')).toBe(true);
    expect(projectEventForViewer(game, event, 'player_b')).toBeNull();
    expect(projectEventForViewer(game, event, 'player_c')).toBeNull();
    expect(projectEventForViewer(game, event, null)).toBeNull();

    // 锁定落空：旧存档回落路径同样只给攻击者（即使目标 owner 就是 B）。
    const synthetic: GameEvent = {
      seq: 900, type: 'attack', timestamp: 0,
      payload: {
        owner: 'player_a', attackerId: a.id, q: 0, r: 1, hit: false, locked: true,
        aimQ: 0, aimR: 1, targetId: b.id, targetKind: 'unit', damage: 0, actualDamage: 0,
      },
    };
    expect(projectEventForViewer(game, synthetic, 'player_a')).not.toBeNull();
    expect(projectEventForViewer(game, synthetic, 'player_b')).toBeNull();
  });
});

describe('area heal disclosure', () => {
  it('hides a healed friendly unit that the third party cannot see', () => {
    const units = structuredClone(UNIT_SPECS);
    units.support.healShape = { type: 'arc' };
    const game = makeGame({ units }, 3);
    const bus = new EventBus();
    const support = unitOf(game, 'player_a');
    const b = unitOf(game, 'player_b');
    const c = unitOf(game, 'player_c');
    retype(game, support, 'support');
    retype(game, b, 'heavy');
    retype(game, c, 'heavy');
    placeUnits(game, [['player_a', 0, 0], ['player_b', 5, -5], ['player_c', 1, 1]]);

    // A 的两个友军在扇形覆盖格上：一个 C 看得见（1,0），一个看不见（1,-1）。
    const allyVisible: Unit = { ...support, id: 'ally-visible', owner: 'player_a', q: 1, r: 0, hp: 30, maxHp: 90 };
    const allyHidden: Unit = { ...support, id: 'ally-hidden', owner: 'player_a', q: 1, r: -1, hp: 30, maxHp: 90 };
    game.units.push(allyVisible, allyHidden);
    bump(game);
    expect(visibleCellsFor(game, 'player_c').has('1,0')).toBe(true);
    expect(visibleCellsFor(game, 'player_c').has('1,-1')).toBe(false);
    expect(visibleCellsFor(game, 'player_c').has('0,0')).toBe(false);

    const heal: PendingAction = { id: 'h1', type: 'heal', supportId: support.id, q: 1, r: 0 };
    resolveRoundSteps(game, bus, game.turn.turnOrder, queuesFor(game, { player_a: [heal] }));

    const visibleHeal = eventWithTarget(game, 'heal', 'ally-visible');
    const hiddenHeal = eventWithTarget(game, 'heal', 'ally-hidden');
    // 隐藏目标整条 null；可见目标保留治疗量，但隐藏施法者的身份与施法格被抹掉。
    expect(projectEventForViewer(game, hiddenHeal, 'player_c')).toBeNull();
    const thirdParty = projectEventForViewer(game, visibleHeal, 'player_c')!;
    expect(thirdParty.payload.targetId).toBe('ally-visible');
    expect(typeof thirdParty.payload.amount).toBe('number');
    expect(typeof thirdParty.payload.targetHp).toBe('number');
    expectKeysAbsent(thirdParty.payload, ['supportId', 'owner', 'q', 'r']);
    // C 的历史里没有任何 ally-hidden 的痕迹。
    const cHeals = projectFogHistoryForViewer(game, 'player_c').filter(item => item.type === 'heal');
    expect(cHeals).toHaveLength(1);
    expect(JSON.stringify(cHeals)).not.toContain('ally-hidden');
    // 施法者本人全量。
    expect(projectEventForViewer(game, hiddenHeal, 'player_a')!.payload.targetId).toBe('ally-hidden');
  });
});

describe('eliminated player identity', () => {
  it('reveals eliminatedBy only to the eliminated player and the killer', () => {
    const game = makeGame({}, 3);
    const bus = new EventBus();
    expect(eliminatePlayer(game, bus, 'player_b', 'headquarters_destroyed', 'player_a').ok).toBe(true);
    const event = [...game.events].reverse().find(item => item.type === 'player_eliminated')!;
    expect(event.payload.eliminatedBy).toBe('player_a');
    // 固化表内部保留原始身份，但对外投影按观者裁剪。
    expect(event.fogViews!.player_b!.eliminatedBy).toBe('player_a');
    expect(event.fogViews!.player_a!.eliminatedBy).toBe('player_a');
    expect('eliminatedBy' in event.fogViews!.player_c!).toBe(false);
    expect('eliminatedBy' in event.fogViews!.public!).toBe(false);

    const selfView = projectEventForViewer(game, event, 'player_b')!;
    expect(selfView.payload.eliminatedBy).toBe('player_a');
    const killerView = projectEventForViewer(game, event, 'player_a')!;
    expect(killerView.payload.eliminatedBy).toBe('player_a');
    const thirdParty = projectEventForViewer(game, event, 'player_c')!;
    expect('eliminatedBy' in thirdParty.payload).toBe(false);
    const publicView = projectEventForViewer(game, event, null)!;
    expect('eliminatedBy' in publicView.payload).toBe(false);
    // removedUnitIds / score 仍按 4.0.0 规则：只有本人保留 unitId，score 走裁决投影。
    expect(Array.isArray(selfView.payload.removedUnitIds)).toBe(true);
    expect('removedUnitIds' in thirdParty.payload).toBe(false);
    expect(thirdParty.payload.score).toMatchObject({ hidden: true });
  });
});

describe('viewer sequence', () => {
  it('numbers each viewer stream 1..n and matches fogLastVisibleSeq', () => {
    const game = makeGame({}, 3);
    const bus = new EventBus();
    const a = unitOf(game, 'player_a');
    const b = unitOf(game, 'player_b');
    retype(game, a, 'scout');
    retype(game, b, 'heavy');
    placeUnits(game, [['player_a', 0, 0], ['player_b', 5, -5], ['player_c', 0, 4]]);
    bump(game);

    const hiddenMove = appendEvent(game, bus, 'move', {
      owner: 'player_b', unitId: b.id, fromQ: 5, fromR: -5, toQ: 5, toR: -4,
    });
    appendEvent(game, bus, 'round_start', { roundNumber: 2 });

    for (const viewer of ['player_a', 'player_b', 'player_c', null] as const) {
      const history = projectFogHistoryForViewer(game, viewer);
      expect(history.map(item => item.seq)).toEqual(history.map((_, index) => index + 1));
      expect(fogLastVisibleSeq(game, viewer)).toBe(history.length);
      const last = game.events.at(-1)!;
      expect(fogViewerSeqOf(game, last, viewer)).toBe(history.length);
    }

    // 隐藏事件不占 A 的序号，但在 B 的流里有自己的号。
    expect(fogViewerSeqOf(game, hiddenMove, 'player_a')).toBeNull();
    const bSeq = fogViewerSeqOf(game, hiddenMove, 'player_b');
    expect(typeof bSeq).toBe('number');
    expect(projectFogHistoryForViewer(game, 'player_a').some(item => item.type === 'move')).toBe(false);
    expect(projectFogHistoryForViewer(game, 'player_b').find(item => item.type === 'move')!.seq).toBe(bSeq);
    // after 按观者序号过滤。
    const afterOne = projectFogHistoryForViewer(game, 'player_a', 1);
    expect(afterOne[0]?.seq).toBe(2);
    expect(afterOne.every(item => item.seq > 1)).toBe(true);
  });

  it('falls back for legacy saves without frozen data and keeps numbering afterwards', () => {
    const game = makeGame({}, 2);
    const bus = new EventBus();
    const b = unitOf(game, 'player_b');
    placeUnits(game, [['player_a', 0, 0], ['player_b', 5, -5]]);
    appendEvent(game, bus, 'move', {
      owner: 'player_b', unitId: b.id, fromQ: 5, fromR: -5, toQ: 5, toR: -4,
    });
    appendEvent(game, bus, 'round_start', { roundNumber: 2 });

    // 模拟 4.0.0 旧存档：事件没有固化表，fog 状态没有游标。
    for (const event of game.events) {
      delete event.fogViews;
      delete event.fogSeqs;
    }
    delete game.fog!.viewSeq;

    const before = projectFogHistoryForViewer(game, 'player_a');
    expect(before.length).toBeGreaterThan(0);
    expect(before.map(item => item.seq)).toEqual(before.map((_, index) => index + 1));
    expect(fogLastVisibleSeq(game, 'player_a')).toBe(before.length);

    // 旧档继续跑：新事件从推导出的游标继续编号，历史仍连续。
    const next = appendEvent(game, bus, 'round_start', { roundNumber: 3 });
    expect(next.fogSeqs!.player_a).toBe(before.length + 1);
    const after = projectFogHistoryForViewer(game, 'player_a');
    expect(after.map(item => item.seq)).toEqual(after.map((_, index) => index + 1));
    expect(after.at(-1)!.seq).toBe(before.length + 1);
    expect(fogLastVisibleSeq(game, 'player_a')).toBe(after.length);
  });
});

describe('non-fog games', () => {
  it('adds no frozen fields and keeps projection/history semantics', () => {
    const plainConfig = testConfig() as unknown as Record<string, unknown>;
    plainConfig.mode = 'simultaneous';
    delete plainConfig.fog;
    const game = createLobbyWithConfig(`fog-frozen-plain-${unique++}`, 'fog-test', plainConfig as unknown as MapConfig, {
      maxPlayers: 2, participate: true, playerName: 'A',
    });
    addLobbyPlayer(game, 'P1');
    expect(startGame(game, new EventBus(), () => 0.42).ok).toBe(true);
    const bus = new EventBus();
    const event = appendEvent(game, bus, 'round_start', { roundNumber: 2 });

    expect(event.fogViews).toBeUndefined();
    expect(event.fogSeqs).toBeUndefined();
    expect(projectEventForViewer(game, event, 'player_a')).toBeNull();
    const history = projectFogHistoryForViewer(game, 'player_a');
    expect(history.map(item => item.seq)).toEqual(game.events.map(item => item.seq));
    expect(history[0]!.fogViews).toBeUndefined();
    expect(fogViewerSeqOf(game, event, null)).toBe(event.seq);
    expect(fogLastVisibleSeq(game, null)).toBe(event.seq);
  });
});
