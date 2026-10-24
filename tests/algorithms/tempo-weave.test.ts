import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createLobby, addLobbyPlayer, createUnitFromConfig } from '../../src/state/store.js';
import { startGame } from '../../src/engine/engine.js';
import { resolveRoundSteps } from '../../src/engine/simultaneousResolve.js';
import { nextGameRandom } from '../../src/engine/random.js';
import { coveredCellsFor, projectPlanQueue } from '../../src/engine/planning.js';
import { sanitizeGameForResponse } from '../../src/api/auth.js';
import { EventBus } from '../../src/events/bus.js';
import { enqueue, seeded } from '../../scripts/tempo-weave-arena.mts';
// @ts-expect-error 单文件 ESM 策略
import algorithm, { tempoWeaveInternals as internals } from '../../algorithms/builtin/tempo-weave.mjs';
import { getAlgorithmMeta } from '../../algorithms/registry.mjs';

let counter = 0;
function setup(map = 'standoff', seats = 2) {
  const game = createLobby(`tw-unit-${counter++}`, map, { maxPlayers: seats, participate: true });
  for (let i = 1; i < seats; i++) addLobbyPlayer(game, `Seat ${i}`);
  expect(startGame(game, new EventBus(), seeded(737)).ok).toBe(true);
  game.config = structuredClone(game.config);
  game.config.balance.damageVarianceRange = 0;
  game.config.balance.healVarianceRange = 0;
  return game as any;
}
function view(game: any, owner = 'player_a') { return sanitizeGameForResponse(game, owner as any) as any; }
function unit(game: any, owner: string, type: any, q: number, r: number, hp?: number) {
  const u = createUnitFromConfig(game.config, owner as any, type, q, r);
  if (hp !== undefined) u.hp = hp;
  game.units.push(u); return u;
}
const action = (type: string, payload: any = {}) => ({ type, payload });
function digest(b: any) {
  return {
    units: b.units.map((u: any) => [u.owner, u.type, u.q, u.r, u.hp, u.alive]).sort((a: any, b: any) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    hq: Object.values(b.headquarters).map((h: any) => [h.owner, h.hp, h.alive]),
    points: b.controlPoints.map((p: any) => [p.id, p.owner]),
    terrain: b.cells.map((c: any) => [c.q, c.r, c.terrain]),
    supplies: b.resources,
    players: Object.entries(b.players).map(([id, p]: any) => [id, p.status, p.stats.headquartersDamage, p.stats.killValue ?? 0]),
  };
}
function compare(game: any, orders: Record<string, any[]>) {
  for (const [owner, list] of Object.entries(orders)) for (const a of list) expect(enqueue(game, owner, a), JSON.stringify(a)).toMatchObject({ ok: true });
  const queues = new Map(game.turn.turnOrder.map((owner: string) => [owner, game.plan.queues[owner] ?? []]));
  // 随机源只注入测试中的镜像，不把私有状态交给策略 decide。
  const dice = structuredClone(game);
  const mirror = internals.resolveSteps(view(game), Object.fromEntries(queues), () => nextGameRandom(dice));
  const real = resolveRoundSteps(game, new EventBus(), game.turn.turnOrder, queues as any);
  expect(digest(mirror.board)).toEqual(digest(game));
  const normalize = (rows: any[]) => rows.map(r => [r.owner, r.step, r.type, r.status, r.reason ?? null]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  expect(normalize(mirror.outcomes)).toEqual(normalize(Object.values(real.outcomes).flat()));
  expect(mirror.steps).toBe(real.steps);
  return mirror;
}

describe('经纬：接口、信息边界与缓存', () => {
  it('仅注册 simultaneous v1，独立单文件且没有另一种运行接口', () => {
    expect(algorithm.name).toBe('tempo-weave'); expect(algorithm.playTurn).toBeUndefined();
    expect(getAlgorithmMeta('tempo-weave')).toMatchObject({ modes: ['simultaneous'], version: 'v1' });
    const source = readFileSync('algorithms/builtin/tempo-weave.mjs', 'utf8');
    expect(source).not.toMatch(/\bimport\b|standoff|molten|mapId|map\.name/);
  });
  it('缺席位、错误模式、提交、满队列或淘汰时返回 null', () => {
    const g = view(setup());
    expect(algorithm.decide(g, {}, {})).toBeNull();
    for (const mode of ['standard', 'royale', 'annihilation']) expect(algorithm.decide({ ...g, config: { ...g.config, mode } }, {}, { owner: 'player_a' })).toBeNull();
    expect(algorithm.decide({ ...g, plan: { ...g.plan, committed: ['player_a'] } }, {}, { owner: 'player_a' })).toBeNull();
    expect(algorithm.decide({ ...g, plan: { myQueue: Array(g.config.balance.actionsPerTurn).fill({ type: 'wait' }) } }, {}, { owner: 'player_a' })).toBeNull();
    g.players.player_a.status = 'eliminated'; expect(algorithm.decide(g, {}, { owner: 'player_a' })).toBeNull();
  });
  it('不读取私有队列、随机状态或地图元数据；输入不被改写', () => {
    const g = view(setup()), before = JSON.stringify(g);
    const poison = () => { throw new Error('禁止访问'); };
    const guarded = { ...g, plan: { ...g.plan } };
    for (const field of ['rngState', 'mapId', 'map']) Object.defineProperty(guarded, field, { get: poison });
    Object.defineProperty(guarded.plan, 'queues', { get: poison });
    const a = algorithm.decide(guarded, {}, { owner: 'player_a' });
    expect(a).not.toBeNull(); expect(JSON.stringify(g)).toBe(before);
  });
  it('重复读取返回相同动作；改变有序前缀、配置和座位后重新合法规划', () => {
    const game = setup(), g = view(game);
    const first = algorithm.decide(g, {}, { owner: 'player_a' });
    expect(algorithm.decide(g, {}, { owner: 'player_a' })).toEqual(first);
    expect(enqueue(game, 'player_a', action('wait')).ok).toBe(true);
    expect(enqueue(game, 'player_a', action('wait')).ok).toBe(true);
    const after = algorithm.decide(view(game), {}, { owner: 'player_a' });
    if (after) expect(enqueue(game, 'player_a', after).ok).toBe(true);
    game.config.balance.actionsPerTurn = 2;
    expect(algorithm.decide(view(game), {}, { owner: 'player_a' })).toBeNull();
    const other = algorithm.decide(view(game, 'player_b'), {}, { owner: 'player_b' });
    if (other) expect(enqueue(game, 'player_b', other).ok).toBe(true);
  });
  it('攻击次数来自配置；投影移动可连续跨越多个行动点', () => {
    const g = setup(); g.units = []; const u = unit(g, 'player_a', 'scout', 0, 0);
    const queue = [action('move', { unitId: u.id, q: 1, r: 0 }), action('move', { unitId: u.id, q: 2, r: 0 }), action('attack', { attackerId: u.id, q: 3, r: 0 })];
    expect(internals.legalPlan(view(g), 'player_a', queue)).toBe(true);
    queue.push(queue.at(-1)!);
    expect(internals.legalPlan(view(g), 'player_a', queue)).toBe(false);
    g.config.balance.attacksPerUnit = 2;
    expect(internals.legalPlan(view(g), 'player_a', queue)).toBe(true);
  });
  it('无回合上限时按有限滚动视野规划，空军队仍可以部署', () => {
    const game = setup(); game.config.balance.maxTurns = null; game.units = [];
    const a = algorithm.decide(view(game), {}, { owner: 'player_a' });
    expect(a?.type).toBe('deploy'); expect(enqueue(game, 'player_a', a).ok).toBe(true);
  });
  it('第三方已能快速摧毁本部时，优先处理其火力而非继续远端攻城', () => {
    const game = setup('standoff', 3); game.units = [];
    Object.assign(game.headquarters.player_a, { q: 0, r: 0, hp: 50 });
    Object.assign(game.headquarters.player_b, { q: 5, r: 0 });
    Object.assign(game.headquarters.player_c, { q: -5, r: 5 });
    unit(game, 'player_a', 'ranger', 3, 0);
    unit(game, 'player_a', 'ranger', 0, 1);
    unit(game, 'player_c', 'ranger', 2, 0, 50);
    const a = algorithm.decide(view(game), {}, { owner: 'player_a' });
    expect(a).toMatchObject({ type: 'attack', payload: { q: 2, r: 0 } });
    expect(enqueue(game, 'player_a', a).ok).toBe(true);
  });
});

describe('经纬：与 3.8.2 权威结算器逐点对拍', () => {
  it('single / line / arc 的覆盖、射程和自疗边界与 planning.ts 一致', () => {
    const g = setup();
    for (const shape of [undefined, { type: 'line', length: 4 }, { type: 'arc' }]) for (const kind of ['attackShape', 'healShape'] as const) {
      const spec = { [kind]: shape };
      for (const range of [1, 2, 4]) for (const p of g.cells) {
        const result = coveredCellsFor({ q: 0, r: 0 }, spec as any, kind, p, range);
        expect(internals.footprint({ q: 0, r: 0 }, spec, kind, p, range)).toEqual(result?.cells ?? null);
      }
    }
  });
  it('同一步交换位置、目的格冲突、失败连锁与落空不连锁', () => {
    for (const collision of [false, true]) {
      const g = setup(); g.units = [];
      const a = unit(g, 'player_a', 'scout', -1, 0), b = unit(g, 'player_b', 'scout', 1, 0);
      compare(g, {
        player_a: [action('move', { unitId: a.id, q: collision ? 0 : 1, r: 0 }), action('attack', { attackerId: a.id, q: collision ? 1 : 0, r: 0 }), action('move', { unitId: a.id, q: 0, r: 1 })],
        player_b: [action('move', { unitId: b.id, q: collision ? 0 : -1, r: 0 })],
      });
    }
  });
  it('部署失败不扣补给，成功的新单位能在同一步被攻击', () => {
    const g = setup(); g.units = [];
    g.headquarters.player_a.q = -2; g.headquarters.player_a.r = 0;
    const b = unit(g, 'player_b', 'ranger', 1, 0);
    compare(g, {
      player_a: [action('deploy', { unitType: 'scout', fromId: g.headquarters.player_a.id, q: -1, r: 0 }), action('deploy', { unitType: 'scout', fromId: g.headquarters.player_a.id, q: -1, r: 0 })],
      player_b: [action('attack', { attackerId: b.id, q: -1, r: 0 })],
    });
  });
  it('锁定按轮初位置识别目标，目标出射程才逃脱', () => {
    for (const escape of [false, true]) {
      const g = setup(); g.units = [];
      const a = unit(g, 'player_a', 'ranger', 0, 0), b = unit(g, 'player_b', 'scout', 1, 0);
      compare(g, { player_a: [action('attack', { attackerId: a.id, q: 1, r: 0 })], player_b: [action('move', { unitId: b.id, q: escape ? 4 : 2, r: 0 })] });
    }
  });
  it('同一步治疗先封顶再扣伤，阵亡攻击者仍开火', () => {
    const g = setup(); g.units = [];
    const a = unit(g, 'player_a', 'support', -1, 0), ally = unit(g, 'player_a', 'scout', 0, 0, 4), b = unit(g, 'player_b', 'ranger', 1, 0, 8);
    compare(g, { player_a: [action('heal', { supportId: a.id, q: 0, r: 0 }), action('attack', { attackerId: a.id, q: 1, r: 0 })], player_b: [action('attack', { attackerId: b.id, q: 0, r: 0 })] });
    const h = setup(); h.units = [];
    const x = unit(h, 'player_a', 'ranger', 0, 0, 1), y = unit(h, 'player_b', 'ranger', 1, 0, 1);
    compare(h, { player_a: [action('attack', { attackerId: x.id, q: 1, r: 0 })], player_b: [action('attack', { attackerId: y.id, q: 0, r: 0 })] });
    expect(h.units.every((u: any) => !u.alive)).toBe(true);
    expect(ally.id).toBeTruthy();
  });
  it('爆破后的地形从下一步才可移动；同一步重复爆破触发失败', () => {
    const g = setup(); g.units = [];
    const cell = g.cells.find((c: any) => c.q === 0 && c.r === 0); cell.terrain = 'blocker';
    g.map.terrainCells.push({ q: 0, r: 0, terrain: 'blocker' });
    const a = unit(g, 'player_a', 'heavy', -1, 0), b = unit(g, 'player_b', 'heavy', 1, 0);
    compare(g, { player_a: [action('demolish', { unitId: a.id, q: 0, r: 0 }), action('move', { unitId: a.id, q: 0, r: 0 })], player_b: [action('demolish', { unitId: b.id, q: 0, r: 0 }), action('wait')] });
  });
  it('多席位总部互毁后正确清场，淘汰方后续长队列不增加结算步数', () => {
    const g = setup('standoff', 3); g.units = [];
    const a = unit(g, 'player_a', 'ranger', 0, 0), hq = g.headquarters.player_b;
    hq.q = 1; hq.r = 0; hq.hp = 1;
    const mirror = compare(g, { player_a: [action('attack', { attackerId: a.id, q: 1, r: 0 })], player_b: [action('wait'), action('wait'), action('wait')] });
    expect(mirror.steps).toBe(1); expect(g.players.player_b.status).toBe('eliminated');
  });
  it.each(Array.from({ length: 20 }, (_, i) => i))('有伤害/治疗随机方差的多目标交火对拍 %i', seed => {
    const g = setup('standoff', 3); g.units = []; g.rngState = seed * 9173 + 701;
    g.config.balance.damageVarianceRange = 7; g.config.balance.healVarianceRange = 9;
    const a = unit(g, 'player_a', 'infantry', -1, 0, 25), support = unit(g, 'player_a', 'support', -1, 1);
    const b = unit(g, 'player_b', 'scout', 0, 0, 10 + seed), c = unit(g, 'player_c', 'ranger', 1, 0, 20 + seed);
    compare(g, {
      player_a: [action('heal', { supportId: support.id, q: 0, r: 0 }), action('attack', { attackerId: a.id, q: 0, r: 0 })],
      player_b: [action('wait'), action('attack', { attackerId: b.id, q: -1, r: 0 })],
      player_c: [action('attack', { attackerId: c.id, q: -1, r: 0 }), action('wait')],
    });
  });
  it.each(Array.from({ length: 40 }, (_, i) => i))('随机合法计划对拍样本 %i', seed => {
    const g = setup(seed % 2 ? 'standoff' : 'molten-throne', seed % 2 && seed % 5 === 0 ? 3 : 2), rng = seeded(1201 + seed);
    for (const u of g.units) u.hp = Math.max(1, Math.floor(u.hp * (.15 + rng() * .85)));
    for (const owner of g.turn.turnOrder) for (let i = 0; i < g.config.balance.actionsPerTurn; i++) {
      let accepted = false;
      for (let attempt = 0; attempt < 80 && !accepted; attempt++) {
        const units = g.units.filter((u: any) => u.owner === owner), u = units[Math.floor(rng() * units.length)];
        const projection = projectPlanQueue(g, owner), pos = projection.positions.get(u.id) ?? u;
        const candidates = g.cells.filter((p: any) => p.terrain === 'plain' && Math.max(Math.abs(p.q - pos.q), Math.abs(p.r - pos.r), Math.abs(p.q + p.r - pos.q - pos.r)) <= 3);
        const p = candidates[Math.floor(rng() * candidates.length)], type = ['move', 'attack', 'heal', 'deploy'][Math.floor(rng() * 4)];
        const a = action(type!, { unitId: u.id, attackerId: u.id, supportId: u.id, unitType: 'scout', fromId: g.headquarters[owner].id, q: p.q, r: p.r });
        accepted = enqueue(g, owner, a).ok;
      }
      if (!accepted) enqueue(g, owner, action('wait'));
    }
    compare(g, {});
  });
});
