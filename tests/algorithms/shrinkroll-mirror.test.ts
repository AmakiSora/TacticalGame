// tests/algorithms/shrinkroll-mirror.test.ts
//
// 镜像对拍：shrinkroll 的规则镜像 vs 真引擎（不抄第二份自证）。
// 同一条动作分别交给算法镜像（__mirror.assertLegal）与引擎函数，比较「是否合法 + 结果状态」。
// 伤害/治疗方差置 0，让期望值退化为确定值，才能逐字段比较。
import { describe, expect, it } from 'vitest';
// @ts-expect-error 算法模块为 ESM .mjs，无类型声明
import { __mirror } from '../../algorithms/builtin/shrinkroll.mjs';
import { createLobby, createUnitFromConfig, addLobbyPlayer } from '../../src/state/store.js';
import { startGame, endTurn } from '../../src/engine/engine.js';
import { moveUnit } from '../../src/engine/units.js';
import { attackTarget, healTarget } from '../../src/engine/combat.js';
import { deployUnit } from '../../src/engine/deployment.js';
import { demolishTerrain } from '../../src/engine/demolition.js';
import { findReachableCells } from '../../src/engine/validation.js';
import { artilleryStateForRound } from '../../src/engine/artillery.js';
import { globalEventBus } from '../../src/events/bus.js';
import { loadMaps } from '../../src/config/loader.js';
import type { GameState, PlayerId } from '../../src/types.js';

loadMaps();

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 与线上快照同口径的视图（去密、去事件）。 */
function viewOf(game: GameState) {
  const { tokens: _t, hostToken: _h, rngState: _r, events: _e, ...rest } = game as unknown as Record<string, unknown>;
  return structuredClone({ ...rest, events: [] });
}

function mirrorState(game: GameState, owner: PlayerId) {
  return __mirror.buildState(viewOf(game), owner);
}

function newGame(mapId = 'artillery-zone', seed = 11): GameState {
  const game = createLobby(`mirror_${mapId}_${seed}`, mapId, { maxPlayers: 2, participate: false });
  addLobbyPlayer(game, 'ACE');
  addLobbyPlayer(game, 'OPP');
  startGame(game, globalEventBus, mulberry32(seed));
  // 让对拍从 A 的回合开始（先手由开局 seed 决定，测试不关心座位偏置）。
  game.turn.currentPlayerId = 'player_a';
  game.turn.currentOwner = 'player_a';
  game.turn.actionsUsed = 0;
  game.turn.actedThisRound = [];
  // 期望值与确定值一致，镜像/引擎才能逐字段比。
  game.config.balance.damageVarianceRange = 0;
  game.config.balance.healVarianceRange = 0;
  return game;
}

function tryEngine(game: GameState, owner: PlayerId, apply: (clone: GameState) => { ok: boolean; code?: string }) {
  const clone = structuredClone(game);
  const result = apply(clone);
  return { ok: result.ok, code: result.ok ? null : result.code ?? null, after: clone };
}

function key(q: number, r: number) {
  return `${q},${r}`;
}

/** 改轮次时同步引擎的炮火快照（引擎按 game.artillery 判危险区；镜像按轮次现算）。 */
function setRound(game: GameState, round: number) {
  game.turn.roundNumber = round;
  game.turn.turnNumber = round;
  game.artillery = artilleryStateForRound(game, round);
}

function setKey(set: Set<string>) {
  return [...set].sort();
}

describe('shrinkroll mirror: reachable & move', () => {
  it('BFS reachable set is byte-identical to the engine', () => {
    const game = newGame();
    const state = mirrorState(game, 'player_a');
    const myUnits = game.units.filter(unit => unit.owner === 'player_a');
    expect(myUnits.length).toBeGreaterThan(0);
    for (const unit of myUnits) {
      const engineCells = findReachableCells(game, unit).map(cell => key(cell.q, cell.r)).sort();
      const mirrorCells = __mirror.reachableCells(state, unit)
        .map((cell: { q: number; r: number }) => key(cell.q, cell.r))
        .sort();
      expect(mirrorCells, unit.id).toEqual(engineCells);
    }
  });

  it('move legality matches for reachable / occupied / out-of-range / same-cell targets', () => {
    const game = newGame();
    const owner: PlayerId = 'player_a';
    const unit = game.units.find(candidate => candidate.owner === owner)!;
    const reachable = findReachableCells(game, unit);
    const spot = reachable[0]!;
    const occupied = game.units.find(candidate => candidate.q === unit.q && candidate.r === unit.r && candidate.id !== unit.id);
    const far = { q: unit.q + unit.moveRange + 3, r: unit.r };
    const cases = [
      { q: spot.q, r: spot.r },
      { q: unit.q, r: unit.r },
      { q: far.q, r: far.r },
    ];
    for (const target of cases) {
      const action = { type: 'move', payload: { unitId: unit.id, q: target.q, r: target.r } };
      const mirrored = __mirror.assertLegal(mirrorState(game, owner), action);
      const engine = tryEngine(game, owner, clone => moveUnit(clone, globalEventBus, owner, unit.id, target.q, target.r));
      expect(Boolean(mirrored), `${target.q},${target.r}`).toBe(engine.ok);
      if (engine.ok) {
        const moved = mirrored.units.find((candidate: { id: string }) => candidate.id === unit.id);
        expect([moved.q, moved.r]).toEqual([target.q, target.r]);
        expect(mirrored.actionsUsed).toBe(engine.after.turn.actionsUsed);
        expect(moved.hasMoved).toBe(true);
      }
    }
    // 目标被友军/敌军占着时双方都非法。
    if (occupied) {
      const action = { type: 'move', payload: { unitId: unit.id, q: occupied.q, r: occupied.r } };
      expect(__mirror.assertLegal(mirrorState(game, owner), action)).toBeNull();
      expect(tryEngine(game, owner, clone => moveUnit(clone, globalEventBus, owner, unit.id, occupied.q, occupied.r)).ok).toBe(false);
    }
  });
});

describe('shrinkroll mirror: attack & AP', () => {
  it('attack range boundary and post-hit state match the engine', () => {
    const game = newGame();
    const owner: PlayerId = 'player_a';
    const attacker = game.units.find(candidate => candidate.owner === owner)!;
    const target = game.units.find(candidate => candidate.owner === 'player_b')!;
    // 把目标摆到射程边界上。
    target.q = attacker.q + attacker.attackRange;
    target.r = attacker.r;
    const action = { type: 'attack', payload: { attackerId: attacker.id, targetId: target.id } };
    const mirrored = __mirror.assertLegal(mirrorState(game, owner), action);
    const engine = tryEngine(game, owner, clone => attackTarget(clone, globalEventBus, owner, attacker.id, target.id));
    expect(engine.ok).toBe(true);
    expect(mirrored).not.toBeNull();
    const hit = mirrored.units.find((candidate: { id: string }) => candidate.id === target.id);
    const engineHit = engine.after.units.find(candidate => candidate.id === target.id)!;
    expect(hit.hp).toBe(engineHit.hp);
    expect(mirrored.actionsUsed).toBe(engine.after.turn.actionsUsed);

    // 距离 +1 双方都非法。
    target.q = attacker.q + attacker.attackRange + 1;
    target.r = attacker.r;
    const farAction = { type: 'attack', payload: { attackerId: attacker.id, targetId: target.id } };
    expect(__mirror.assertLegal(mirrorState(game, owner), farAction)).toBeNull();
    expect(tryEngine(game, owner, clone => attackTarget(clone, globalEventBus, owner, attacker.id, target.id)).ok).toBe(false);
  });

  it('kill accounting matches the engine (killValue / destroyed unit)', () => {
    const game = newGame();
    const owner: PlayerId = 'player_a';
    const attacker = game.units.find(candidate => candidate.owner === owner)!;
    const target = game.units.find(candidate => candidate.owner === 'player_b')!;
    target.hp = 1;
    target.q = attacker.q + 1;
    target.r = attacker.r;
    // 先清掉 B 的其他单位，保证只有这一个目标（避免淘汰影响口径）。
    game.units = game.units.filter(unit => unit.owner !== 'player_b' || unit.id === target.id);
    game.players.player_b!.status = 'active';

    const action = { type: 'attack', payload: { attackerId: attacker.id, targetId: target.id } };
    const mirrored = __mirror.assertLegal(mirrorState(game, owner), action)!;
    const engine = tryEngine(game, owner, clone => attackTarget(clone, globalEventBus, owner, attacker.id, target.id));
    expect(engine.ok).toBe(true);
    expect(mirrored.killValue.player_a).toBe(engine.after.players.player_a!.stats.killValue);
    expect(mirrored.units.some((unit: { id: string }) => unit.id === target.id)).toBe(false);
    // 此时 B 已无单位 → 淘汰 + 终局，与引擎一致。
    expect(mirrored.status.player_b).toBe(engine.after.players.player_b!.status);
    expect(mirrored.over).toBe(engine.after.phase === 'game_over');
  });

  it('AP: the next activation is rejected at the limit, already-activated units follow up for free', () => {
    const game = newGame();
    const owner: PlayerId = 'player_a';
    game.turn.actionsUsed = game.config.balance.actionsPerTurn;
    const state = mirrorState(game, owner);
    const units = game.units.filter(unit => unit.owner === owner);
    const fresh = units.find(unit => !unit.actionSpent)!;
    const target = game.units.find(unit => unit.owner === 'player_b')!;
    target.q = fresh.q + 1;
    target.r = fresh.r;
    const blocked = { type: 'attack', payload: { attackerId: fresh.id, targetId: target.id } };
    expect(__mirror.assertLegal(state, blocked)).toBeNull();
    const engineBlocked = tryEngine(game, owner, clone => attackTarget(clone, globalEventBus, owner, fresh.id, target.id));
    expect(engineBlocked.ok).toBe(false);
    expect(engineBlocked.code).toBe('action_limit_reached');

    // 已激活单位（actionSpent）在 AP 用尽后仍可免费行动：先让它移动一次。
    const spentUnit = units.find(unit => unit.id !== fresh.id)!;
    spentUnit.actionSpent = true;
    spentUnit.hasMoved = false;
    spentUnit.hasActed = false;
    const spot = findReachableCells(game, spentUnit)[0]!;
    const followUp = { type: 'move', payload: { unitId: spentUnit.id, q: spot.q, r: spot.r } };
    expect(__mirror.assertLegal(mirrorState(game, owner), followUp)).not.toBeNull();
    const engineFollow = tryEngine(game, owner, clone => moveUnit(clone, globalEventBus, owner, spentUnit.id, spot.q, spot.r));
    expect(engineFollow.ok).toBe(true);
    expect(engineFollow.after.turn.actionsUsed).toBe(game.config.balance.actionsPerTurn);
  });
});

describe('shrinkroll mirror: deploy / heal / demolish', () => {
  it('deploy matches the engine (cost, flags) and rejects danger / foreign origins', () => {
    const game = newGame();
    const owner: PlayerId = 'player_a';
    game.resources.player_a!.supplies = 200;
    setRound(game, 5); // 第 5 轮：radius 6 → safe 5，环 6 是危险区
    const origin = game.controlPoints.find(point => point.owner === owner)!;
    const dest = game.units.find(unit => unit.owner === owner)!;
    // 找一个相邻的空 plain 作为落点。
    const neighbors = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]
      .map(([dq, dr]) => ({ q: origin.q + dq, r: origin.r + dr }))
      .find(cell => !game.units.some(unit => unit.q === cell.q && unit.r === cell.r));
    expect(neighbors).toBeDefined();
    const action = { type: 'deploy', payload: { unitType: 'infantry', fromId: origin.id, q: neighbors!.q, r: neighbors!.r } };
    const mirrored = __mirror.assertLegal(mirrorState(game, owner), action)!;
    const engine = tryEngine(game, owner, clone => deployUnit(clone, globalEventBus, owner, 'infantry', origin.id, neighbors!.q, neighbors!.r));
    expect(engine.ok).toBe(true);
    expect(mirrored).not.toBeNull();
    const newMirror = mirrored.units.find((unit: { id: string }) => !game.units.some(old => old.id === unit.id))!;
    const newEngine = engine.after.units.find(unit => !game.units.some(old => old.id === unit.id))!;
    expect(newMirror.hasMoved).toBe(true);
    expect(newMirror.hasActed).toBe(false);
    expect(newMirror.actionSpent).toBe(true);
    expect(newMirror.hp).toBe(newEngine.hp);
    expect(mirrored.supplies.player_a).toBe(engine.after.resources.player_a!.supplies);
    expect(mirrored.actionsUsed).toBe(engine.after.turn.actionsUsed);
    void dest;

    // 危险区落点：环 6（radius 6、safe 5）。
    const dangerCell = { q: 6, r: 0 };
    const dangerAction = { type: 'deploy', payload: { unitType: 'infantry', fromId: origin.id, q: dangerCell.q, r: dangerCell.r } };
    // 该格未必与起点相邻；用「起点在环 6、落点在环 6」构造：把据点搬到环 6 边上。
    origin.q = 5;
    origin.r = 0;
    const edgeDest = { q: 6, r: 0 };
    const edgeAction = { type: 'deploy', payload: { unitType: 'infantry', fromId: origin.id, q: edgeDest.q, r: edgeDest.r } };
    expect(__mirror.assertLegal(mirrorState(game, owner), edgeAction)).toBeNull();
    expect(tryEngine(game, owner, clone => deployUnit(clone, globalEventBus, owner, 'infantry', origin.id, edgeDest.q, edgeDest.r)).ok).toBe(false);
    void dangerAction;

    // 非己方据点。
    origin.owner = null;
    expect(__mirror.assertLegal(mirrorState(game, owner), edgeAction)).toBeNull();
    expect(tryEngine(game, owner, clone => deployUnit(clone, globalEventBus, owner, 'infantry', origin.id, edgeDest.q, edgeDest.r)).ok).toBe(false);
  });

  it('rejects a control point whose kind has canDeploy: false (mirror and engine agree)', () => {
    const game = newGame();
    const owner: PlayerId = 'player_a';
    game.resources.player_a!.supplies = 200;
    // artillery-zone 的据点类型都可部署：临时挂一个 canDeploy:false 的类型，
    // 覆盖「据点类型禁用部署」这条分支（引擎走 kindAllowsDeploy，镜像走 deployOrigin）。
    game.config.balance.controlPointTypes!.blocked = { income: 0, deployDiscount: 0, repairAmount: 0, canDeploy: false };
    const origin = game.controlPoints.find(point => point.owner === owner)!;
    origin.kind = 'blocked' as never;
    // 落点取一个真正合法（相邻、空、plain、不在危险区）的格子，确保唯一拒绝理由是起点类型。
    const spot = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]
      .map(([dq, dr]) => ({ q: origin.q + dq, r: origin.r + dr }))
      .find(cell => {
        const boardCell = game.cells.find(c => c.q === cell.q && c.r === cell.r);
        return boardCell?.terrain === 'plain' && !game.units.some(unit => unit.q === cell.q && unit.r === cell.r);
      });
    expect(spot).toBeDefined();
    const action = { type: 'deploy', payload: { unitType: 'infantry', fromId: origin.id, q: spot!.q, r: spot!.r } };

    // 双拒：镜像与引擎都必须拒绝，且引擎的错误码是 invalid_deploy（起点无效，而不是地形/补给）。
    expect(__mirror.assertLegal(mirrorState(game, owner), action)).toBeNull();
    const engine = tryEngine(game, owner, clone => deployUnit(clone, globalEventBus, owner, 'infantry', origin.id, spot!.q, spot!.r));
    expect(engine.ok).toBe(false);
    expect(engine.code).toBe('invalid_deploy');

    // 反证：把类型换回可部署的 forward_base，同一条动作立刻变成合法。
    origin.kind = 'forward_base';
    expect(__mirror.assertLegal(mirrorState(game, owner), action)).not.toBeNull();
    expect(tryEngine(game, owner, clone => deployUnit(clone, globalEventBus, owner, 'infantry', origin.id, spot!.q, spot!.r)).ok).toBe(true);
  });

  it('heal matches the engine, rejects full-hp targets and danger cells', () => {
    const game = newGame();
    const owner: PlayerId = 'player_a';
    const wounded = game.units.find(unit => unit.owner === owner)!;
    wounded.hp = 40;
    const support = createUnitFromConfig(game.config, owner, 'support', wounded.q, wounded.r + 1);
    game.units.push(support);
    const action = { type: 'heal', payload: { supportId: support.id, targetId: wounded.id } };
    const mirrored = __mirror.assertLegal(mirrorState(game, owner), action)!;
    const engine = tryEngine(game, owner, clone => healTarget(clone, globalEventBus, owner, support.id, wounded.id));
    expect(engine.ok).toBe(true);
    expect(mirrored.units.find((unit: { id: string }) => unit.id === wounded.id).hp)
      .toBe(engine.after.units.find(unit => unit.id === wounded.id)!.hp);

    // 满血目标双方都非法。
    wounded.hp = wounded.maxHp;
    expect(__mirror.assertLegal(mirrorState(game, owner), action)).toBeNull();
    expect(tryEngine(game, owner, clone => healTarget(clone, globalEventBus, owner, support.id, wounded.id)).ok).toBe(false);

    // 危险区（环 6）治疗双方都非法。
    wounded.hp = 10;
    setRound(game, 5);
    wounded.q = 6;
    wounded.r = 0;
    support.q = 5;
    support.r = 0;
    expect(__mirror.assertLegal(mirrorState(game, owner), action)).toBeNull();
    expect(tryEngine(game, owner, clone => healTarget(clone, globalEventBus, owner, support.id, wounded.id)).ok).toBe(false);
  });

  it('demolish matches the engine and only heavy units may clear blockers', () => {
    const game = newGame();
    const owner: PlayerId = 'player_a';
    const heavy = game.units.find(unit => unit.owner === owner && unit.type === 'heavy')!;
    const blocker = { q: heavy.q + 1, r: heavy.r };
    // 在地图上造一块障碍（cells 与 map.terrainCells 同步，与引擎 demolish 的写入口径一致）。
    const cell = game.cells.find(candidate => candidate.q === blocker.q && candidate.r === blocker.r);
    expect(cell).toBeDefined();
    cell!.terrain = 'blocker';
    game.map.terrainCells.push({ q: blocker.q, r: blocker.r, terrain: 'blocker' });
    game.units = game.units.filter(unit => !(unit.q === blocker.q && unit.r === blocker.r));

    const action = { type: 'demolish', payload: { unitId: heavy.id, q: blocker.q, r: blocker.r } };
    const mirrored = __mirror.assertLegal(mirrorState(game, owner), action)!;
    const engine = tryEngine(game, owner, clone => demolishTerrain(clone, globalEventBus, owner, heavy.id, blocker.q, blocker.r));
    expect(engine.ok).toBe(true);
    expect(mirrored).not.toBeNull();
    expect(mirrored.cells.get(key(blocker.q, blocker.r)).terrain).toBe('plain');
    expect(engine.after.cells.find(candidate => candidate.q === blocker.q && candidate.r === blocker.r)!.terrain).toBe('plain');

    // 非重装（步兵）双方都非法。
    const infantry = game.units.find(unit => unit.owner === owner && unit.type === 'infantry')!;
    infantry.q = heavy.q;
    infantry.r = heavy.r - 1;
    const infantryNearby = { q: heavy.q + 1, r: heavy.r };
    const badAction = { type: 'demolish', payload: { unitId: infantry.id, q: infantryNearby.q, r: infantryNearby.r } };
    expect(__mirror.assertLegal(mirrorState(game, owner), badAction)).toBeNull();
  });
});

describe('shrinkroll mirror: candidate generation / ablation ladder', () => {
  it('every ladder step carries focusCands, and 0 really disables the focus macro', () => {
    // 集火宏是一条边走多刀：单步消融档里必须关掉，否则 `ACE_ABLATE=search` 的「单步」基线名不副实。
    for (const step of __mirror.beamLadder()) {
      expect(Object.prototype.hasOwnProperty.call(step, 'focusCands'), JSON.stringify(step)).toBe(true);
      expect(step.focusCands).toBe(2);
    }
    const first = __mirror.beamLadder()[0];
    expect(__mirror.paramsForLadder({ ...first, focusCands: 0 }).focusCands).toBe(0);

    // 行为侧：同一局面下 focusCands=2 必须产出集火宏候选，=0 必须一条都没有。
    const game = newGame();
    const owner: PlayerId = 'player_a';
    const state = mirrorState(game, owner);
    const enemy = state.units.find((u: { owner: string; alive: boolean }) => u.owner === 'player_b' && u.alive);
    enemy.hp = 40; // 两个步兵各 22 点：一刀砍不死，两刀正好收走
    const infantry = state.units
      .filter((u: { owner: string; alive: boolean; type: string }) => u.owner === owner && u.alive && u.type === 'infantry')
      .slice(0, 2);
    expect(infantry).toHaveLength(2);
    infantry[0].q = enemy.q + 1;
    infantry[0].r = enemy.r;
    infantry[1].q = enemy.q - 1;
    infantry[1].r = enemy.r;
    const params = { attackCands: 4, moveCands: 5, moveAttackCands: 3, deployCands: 4, healCands: 2, demolish: false };
    const count = (focusCands: number) => __mirror
      .generateCandidates(state, { ...params, focusCands })
      .filter((candidate: { type: string }) => candidate.type === 'focus').length;
    expect(count(0)).toBe(0);
    expect(count(2)).toBeGreaterThan(0);
  });
});

describe('shrinkroll mirror: single-attack kill probability', () => {
  // QA 在 v3 增量审计里抓到的缺陷：旧实现是「最多 8 刀的逐点伤害 DP，且每轮丢掉吸收态」，
  // 返回的是「恰好第 g 刀打死」而不是「一刀打死」，方向完全错——22 血一刀砍死真实 0.571 给成 0，
  // 26 血一刀砍不死给成 1。五个点既是修复的自测，也是这个函数的语义契约（关掉 DP、改回叠刀必挂）。
  it('matches the closed-form single-shot probability on five calibration points', () => {
    const game = newGame();
    game.config.balance.damageVarianceRange = 3;
    const state = mirrorState(game, 'player_a');
    const rows: Array<[string, number, number, number, number]> = [
      ['infantry 30 vs def 8, hp 22', 30, 8, 22, 0.571],
      ['infantry 30 vs def 8, hp 25', 30, 8, 25, 0.143],
      ['infantry 30 vs def 8, hp 26 (max damage is 25)', 30, 8, 26, 0],
      ['heavy 38 vs def 8, hp 100', 38, 8, 100, 0],
      ['scout 16 vs def 4, hp 100', 16, 4, 100, 0],
    ];
    for (const [label, attack, defense, hp, truth] of rows) {
      expect(__mirror.killProbability(state, attack, defense, hp), label).toBeCloseTo(truth, 2);
    }
    // 边界：伤害下限/上限恰好等于血量时是 1 刀 / 只有最高点那一刀。
    expect(__mirror.killProbability(state, 30, 8, 19)).toBe(1);
    expect(__mirror.killProbability(state, 30, 8, 25)).toBeCloseTo(1 / 7, 6);
    // 血量已归零视为必死。
    expect(__mirror.killProbability(state, 30, 8, 0)).toBe(1);
  });

  // 回合内口径（只给 deathRiskPenalty 用）：吸收态必须续传，「g 刀内」随 g 单调不减；
  // 旧实现丢掉吸收态，算出来的是「恰好第 g 刀打死」，会随 g 抖动甚至回落。
  it('kill probability within n attacks is monotone and matches the single-shot form at n=1', () => {
    const game = newGame();
    game.config.balance.damageVarianceRange = 3;
    const state = mirrorState(game, 'player_a');
    // n=1 必须与严格单刀口径一致。
    expect(__mirror.multiHitKillProbability(state, 30, 8, 22, 1))
      .toBeCloseTo(__mirror.killProbability(state, 30, 8, 22), 12);
    expect(__mirror.multiHitKillProbability(state, 30, 8, 26, 1)).toBe(0);
    // 26 血挨两刀必死（19+19 > 26）：吸收态若丢掉，这里会算成「第 2 刀恰好打死」之外的 0。
    expect(__mirror.multiHitKillProbability(state, 30, 8, 26, 2)).toBeCloseTo(1, 6);
    // scout 16 vs def 4（伤害 9–15）打 100 血：单刀 0，回合内逐步上升且单调。
    let previous = 0;
    for (let attacks = 1; attacks <= 8; attacks++) {
      const p = __mirror.multiHitKillProbability(state, 16, 4, 100, attacks);
      expect(p).toBeGreaterThanOrEqual(previous);
      previous = p;
    }
    expect(__mirror.multiHitKillProbability(state, 16, 4, 100, 1)).toBe(0);
    expect(previous).toBeGreaterThan(0.2);
  });
});

describe('shrinkroll mirror: turn boundary / artillery / elimination', () => {
  it('end-turn capture + income + repair match the engine', () => {
    const game = newGame();
    const owner: PlayerId = 'player_a';
    // 给 A 一个能占点的单位：放在中立据点上。
    const cp = game.controlPoints.find(point => point.owner === null)!;
    const capturer = game.units.find(unit => unit.owner === owner && unit.canCapture)!;
    capturer.q = cp.q;
    capturer.r = cp.r;
    // 回合开始收入：B 的据点 income 会进 B 的补给。
    const suppliesBefore = game.resources.player_b!.supplies;
    const expectedIncome = game.config.balance.baseIncome
      + game.controlPoints.filter(point => point.owner === 'player_b')
        .reduce((sum, point) => sum + (game.config.balance.controlPointTypes?.[point.kind]?.income ?? 0), 0);

    const mirrored = __mirror.applyEndTurn(mirrorState(game, owner))!;
    const engine = tryEngine(game, owner, clone => endTurn(clone, globalEventBus, owner));
    expect(engine.ok).toBe(true);
    expect(mirrored.cps.find((point: { id: string }) => point.id === cp.id).owner).toBe(owner);
    const engineCp = engine.after.controlPoints.find(point => point.id === cp.id)!;
    expect(engineCp.owner).toBe(owner);
    // 下一位（B）的回合开始：收入 + 据点维修。
    expect(mirrored.supplies.player_b).toBe(engine.after.resources.player_b!.supplies);
    expect(mirrored.supplies.player_b).toBe(suppliesBefore + expectedIncome);
    expect(mirrored.current).toBe(engine.after.turn.currentPlayerId);
    expect(mirrored.round).toBe(engine.after.turn.roundNumber);
  });

  it('round-boundary artillery damage, deaths and wipes match the engine', () => {
    const game = newGame('artillery-zone', 21);
    const owner: PlayerId = 'player_a';
    setRound(game, 4); // 第 5 轮安全半径 5 → 环 6 是危险区
    // 全员摆到环 6，B 只留一个 10 血单位（会被炮火打死 → 军队打光淘汰）。
    const cellsOnRing6 = game.cells.filter(cell => Math.max(Math.abs(cell.q), Math.abs(cell.r), Math.abs(-cell.q - cell.r)) === 6);
    expect(cellsOnRing6.length).toBeGreaterThan(6);
    game.units.forEach((unit, index) => {
      const cell = cellsOnRing6[index % cellsOnRing6.length]!;
      unit.q = cell.q;
      unit.r = cell.r;
    });
    const victim = game.units.find(unit => unit.owner === 'player_b')!;
    victim.hp = 10;
    game.units = game.units.filter(unit => unit.owner !== 'player_b' || unit.id === victim.id);
    game.turn.actedThisRound = ['player_a']; // B 收尾 → 触发轮界
    game.turn.currentPlayerId = 'player_b';
    game.turn.currentOwner = 'player_b';

    const mirrored = __mirror.applyEndTurn(mirrorState(game, 'player_b'))!;
    const engine = tryEngine(game, owner, clone => endTurn(clone, globalEventBus, 'player_b'));
    expect(engine.ok).toBe(true);
    expect(mirrored.round).toBe(engine.after.turn.roundNumber);
    expect(mirrored.units.filter((unit: { owner: string }) => unit.owner === 'player_b')).toHaveLength(0);
    expect(engine.after.units.filter(unit => unit.owner === 'player_b')).toHaveLength(0);
    expect(mirrored.status.player_b).toBe(engine.after.players.player_b!.status);
    expect(mirrored.over).toBe(engine.after.phase === 'game_over');
    expect(mirrored.winner).toBe(engine.after.winner ?? null);
  });

  it('killing the last enemy unit eliminates the seat and neutralizes its points', () => {
    const game = newGame();
    const owner: PlayerId = 'player_a';
    const attacker = game.units.find(unit => unit.owner === owner)!;
    const victim = game.units.find(unit => unit.owner === 'player_b')!;
    victim.hp = 1;
    victim.q = attacker.q + 1;
    victim.r = attacker.r;
    game.units = game.units.filter(unit => unit.owner !== 'player_b' || unit.id === victim.id);
    const enemyPoint = game.controlPoints.find(point => point.owner === 'player_b');
    if (enemyPoint) enemyPoint.owner = 'player_b';

    const action = { type: 'attack', payload: { attackerId: attacker.id, targetId: victim.id } };
    const mirrored = __mirror.assertLegal(mirrorState(game, owner), action)!;
    const engine = tryEngine(game, owner, clone => attackTarget(clone, globalEventBus, owner, attacker.id, victim.id));
    expect(engine.ok).toBe(true);
    expect(mirrored.status.player_b).toBe('eliminated');
    expect(engine.after.players.player_b!.status).toBe('eliminated');
    expect(mirrored.cps.filter((point: { owner: string | null }) => point.owner === 'player_b')).toHaveLength(0);
    expect(engine.after.controlPoints.filter(point => point.owner === 'player_b')).toHaveLength(0);
    expect(mirrored.winner).toBe(engine.after.winner);
  });

  it('controlHold accumulates at round boundaries exactly like the engine, never after the boundary tick', () => {
    // 顺序错（先 tick / 先裁决，后累积）在「当轮没人被淘汰」的局面上完全看不出来：两边都在场、
    // 持有数不变，任何顺序都得到同样数字。所以这里用 trench-run 的第 16→17 轮：
    // 半径 1 → 0，轮界 tick 会把圈外单位全打死并当场淘汰 B —— 一旦 tick 跑到累积之前，
    // 累积就再也不会发生（controlHold 停在 0、round 停在 16），用例必挂。
    const game = newGame('trench-run', 21);
    const owner: PlayerId = 'player_a';
    setRound(game, 15);
    const offCenter = game.cells.filter(cell => Math.max(Math.abs(cell.q), Math.abs(cell.r), Math.abs(-cell.q - cell.r)) > 0);
    expect(offCenter.length).toBeGreaterThan(6);
    game.units.forEach((unit, index) => {
      const cell = offCenter[index % offCenter.length]!;
      unit.q = cell.q;
      unit.r = cell.r;
      unit.hp = 100;
    });
    // 非对称持有：A 同时持有 fb_e + rep_e（2 格），B 持有 fb_w（1 格）。
    for (const point of game.controlPoints) {
      point.owner = point.id === 'fb_e' || point.id === 'rep_e' ? 'player_a' : point.id === 'fb_w' ? 'player_b' : null;
    }

    // 第一段 15 → 16：只累积，不淘汰。
    const engine = structuredClone(game);
    engine.turn.actedThisRound = ['player_a'];
    engine.turn.currentPlayerId = 'player_b';
    engine.turn.currentOwner = 'player_b';
    endTurn(engine, globalEventBus, 'player_b');
    const pre = structuredClone(game);
    pre.turn.currentPlayerId = 'player_b';
    pre.turn.currentOwner = 'player_b';
    pre.turn.actedThisRound = ['player_a'];
    let mirrored = __mirror.applyEndTurn(mirrorState(pre, 'player_b'))!;

    expect(engine.turn.roundNumber).toBe(16);
    expect(mirrored.round).toBe(16);
    expect(mirrored.controlHold.player_a).toBe(2);
    expect(mirrored.controlHold.player_b).toBe(1);
    expect(engine.players.player_a!.stats.controlHold).toBe(2);
    expect(engine.players.player_b!.stats.controlHold).toBe(1);

    // 第二段 16 → 17：A 只剩 fb_e，B 全队 20 血 → 轮界 tick 全灭 B。
    for (const point of engine.controlPoints) if (point.id === 'rep_e') point.owner = null;
    for (const unit of engine.units) if (unit.owner === 'player_b') unit.hp = 20;
    engine.turn.actedThisRound = ['player_a'];
    engine.turn.currentPlayerId = 'player_b';
    engine.turn.currentOwner = 'player_b';
    endTurn(engine, globalEventBus, 'player_b');

    for (const point of mirrored.cps) if (point.id === 'rep_e') point.owner = null;
    for (const unit of mirrored.units) if (unit.owner === 'player_b') unit.hp = 20;
    mirrored.acted = new Set(['player_a']);
    mirrored.current = 'player_b';
    mirrored = __mirror.applyEndTurn(mirrored)!;

    expect(engine.phase).toBe('game_over');
    expect(mirrored.over).toBe(true);
    expect(mirrored.round).toBe(engine.turn.roundNumber);
    expect(mirrored.winner).toBe(engine.winner);
    for (const seat of ['player_a', 'player_b'] as PlayerId[]) {
      const stats = engine.players[seat]!.stats;
      expect(mirrored.controlHold[seat]).toBe(stats.controlHold);
      expect(mirrored.holdRounds[seat]).toBe(stats.controlHoldRounds);
      expect(mirrored.status[seat]).toBe(engine.players[seat]!.status);
    }
    expect(mirrored.controlHold).toEqual({ player_a: 3, player_b: 2 });
    expect(mirrored.holdRounds).toEqual({ player_a: 2, player_b: 2 });

    // 评估项用引擎的流量口径：flowRatio 0.7 × 均值(3/2) + 0.3 × 当前持有 1 = 1.35 → ×10 = 13.5。
    // 若退回「只看当前持有数」（v2 之前的写法），这里会算成 10。
    const weights = { ...game.config.balance.adjudicationWeights, controlPoint: 10 } as Record<string, number>;
    expect(__mirror.controlScore(mirrored, 'player_a', weights, 1)).toBeCloseTo(13.5, 6);
  });

  it('artillery forward projection prices only whole-board shrinks, with pinned values and no projection past maxTurns', () => {
    // trench-run：minimumSafeRadius 0（最后只剩圆心），前瞻必须给出正的期望损失；
    // artillery-zone：minimumSafeRadius 1（末段还有 7 格安全区），前瞻必须门控为 0。
    const trench = newGame('trench-run', 21);
    setRound(trench, 13);
    const owner: PlayerId = 'player_a';
    const unit = trench.units.find(u => u.owner === owner)!;
    const weights = trench.config.balance.adjudicationWeights as Record<string, number>;
    const far = mirrorState(trench, owner);
    far.units.find((u: { id: string }) => u.id === unit.id).q = 5;
    far.units.find((u: { id: string }) => u.id === unit.id).r = 0;
    const center = mirrorState(trench, owner);
    center.units.find((u: { id: string }) => u.id === unit.id).q = 0;
    center.units.find((u: { id: string }) => u.id === unit.id).r = 0;
    // 钉死数值（不写成不等式）：第 13 轮未来三圈半径 2/2/1，环 5 的单位挨满 3 跳；
    // 圆心单位不再挨 tick。符号写反、K 改动、权重改动、关掉终点项都会离开这两个数。
    expect(__mirror.artilleryForwardPenalty(far, weights)).toBeCloseTo(72.64, 2);
    expect(__mirror.artilleryForwardPenalty(center, weights)).toBeCloseTo(37.54, 2);

    // 回合上限夹取：trench-run 的炮火在 22 轮轮界之后不存在（引擎先裁决收场），
    // 投影不能越过 maxTurns。第 14 轮的出手单位全在环 7–8，未来三圈半径 1/1/0 全在圈外：
    // maxTurns=22 记 3 跳，maxTurns=15 只能投影到第 15 轮（半径 1）→ 记 1 跳，正好 3 倍。
    const ringTwo = (maxTurns: number) => {
      const game = newGame('trench-run', 21);
      setRound(game, 14);
      game.config.balance.maxTurns = maxTurns;
      return __mirror.artilleryForwardPenalty(mirrorState(game, owner), weights);
    };
    const clamped = ringTwo(15);
    const unclamped = ringTwo(22);
    expect(unclamped / clamped).toBeCloseTo(3, 6);
    expect(clamped).toBeCloseTo(24.213333, 4);

    const zone = newGame('artillery-zone', 22);
    setRound(zone, 9);
    const zoneState = mirrorState(zone, owner);
    expect(zone.config.annihilation!.artillery.minimumSafeRadius).toBe(1);
    expect(__mirror.artilleryForwardPenalty(zoneState, weights)).toBe(0);
  });
});
