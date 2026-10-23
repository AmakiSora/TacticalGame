// tests/algorithms/matrix-eq-simulator.test.ts
// matrix-eq 模拟器/计划队列回归：把 3.8.1 的修复用固定场景钉住，
// 防止后续改动引入回退。simRng=null → 确定性（期望）伤害。
// 覆盖：
//  A. 同一步互换后第三人立即攻击（占用表在移动循环中不能丢失单位）。
//  B. 部署动作结算为 executed，detail 含 unitType/fromId/q/r；锁定兵种
//     （attackLock）锁定计划时刻站在瞄准格上的敌军，目标逃出射程时 target_escaped。
//  B2. 计划时刻不存在的新部署单位不可被锁定，但会被普通形状覆盖命中。
//  C. HQ 伤害入账按实际扣血截断（actual = min(hp, dmg)），残血 HQ 补刀不超额入账。
//  D. 连续 wait 按出现次数逐条吐出，不被同指纹 Set/Map 吞掉。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error 算法模块为 ESM .mjs，无类型声明
import { matrixEqInternals as I } from '../../algorithms/builtin/matrix-eq.mjs';

const map = JSON.parse(readFileSync(new URL('../../maps/standoff.json', import.meta.url), 'utf8'));

const BAL = map.balance;
const makeUnit = (owner: string, type: string, q: number, r: number, hpOverride?: number) => {
  const s = map.units[type];
  return {
    id: `${type}:${owner}:${q},${r}`, owner, type, q, r,
    hp: hpOverride ?? s.hp, maxHp: s.hp, attack: s.attack, defense: s.defense,
    moveRange: s.moveRange, attackRange: s.attackRange,
    canCapture: s.canCapture ?? false, attackLock: s.attackLock ?? false,
    healPower: s.healPower ?? 0, cost: s.cost, alive: true,
  };
};

/** 合成同时回合制 standoff 状态：A(slot_1 口径) × B(slot_4 口径)。 */
function baseState(hpB: number) {
  const cells = [] as { q: number; r: number; terrain: string }[];
  for (let q = -5; q <= 5; q++)
    for (let r = Math.max(-5, -q - 5); r <= Math.min(5, -q + 5); r++)
      cells.push({ q, r, terrain: 'plain' });
  for (const t of map.terrainCells) {
    const c = cells.find((c) => c.q === t.q && c.r === t.r);
    if (c) c.terrain = t.terrain;
  }
  return {
    id: 'matrix-eq-simulator-regression', mode: 'simultaneous',
    cells, map: { terrainCells: map.terrainCells },
    units: [makeUnit('A', 'scout', 1, 0), makeUnit('B', 'scout', 2, 0)],
    headquarters: {
      A: { id: 'hq_A', owner: 'A', q: 5, r: 0, hp: 200, maxHp: 200, defense: 6, alive: true },
      B: { id: 'hq_B', owner: 'B', q: -5, r: 0, hp: hpB, maxHp: 200, defense: 6, alive: true },
    },
    controlPoints: [] as unknown[],
    resources: { A: { supplies: BAL.startingSupplies }, B: { supplies: BAL.startingSupplies } },
    players: {
      A: { status: 'active', stats: { headquartersDamage: 0, killValue: 0, controlHold: 0, controlHoldRounds: 0 } },
      B: { status: 'active', stats: { headquartersDamage: 0, killValue: 0, controlHold: 0, controlHoldRounds: 0 } },
    },
    turn: { roundNumber: 1, turnOrder: ['A', 'B'], actionsUsed: 0 },
    plan: { queues: { A: [], B: [] }, committed: [], myQueue: [] as unknown[] },
    config: { units: map.units, headquartersSpec: map.headquartersSpec, balance: BAL, mode: 'simultaneous' },
    events: [] as unknown[],
  };
}

/** line[2] 形状覆盖：点击目标必须落在 6 射线方向上、距离 1..min(length, range)。 */
function lineCovered(from: { q: number; r: number }, target: { q: number; r: number },
  shape: { length: number }, range: number) {
  const dirs = [{ q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 }, { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }];
  const dist = (a: { q: number; r: number }, b: { q: number; r: number }) =>
    Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(-a.q - a.r - (-b.q - b.r)));
  if (dist(from, target) === 0) return false;
  return dirs.some((d) => {
    for (let step = 1; step <= Math.min(shape.length, range); step++) {
      if (from.q + d.q * step === target.q && from.r + d.r * step === target.r) return true;
    }
    return false;
  });
}

describe('matrix-eq 模拟器回归（3.8.1 修复钉住）', () => {
  it('场景 A：同一步互换后第三人立即攻击 —— 占用表不能丢失单位', () => {
    const st = baseState(200);
    // 第三人 C 在同一步从 (3,0) 攻击 A 换位后的 (2,0)。
    (st.players as any).C = {
      status: 'active',
      stats: { headquartersDamage: 0, killValue: 0, controlHold: 0, controlHoldRounds: 0 },
    };
    (st.resources as any).C = { supplies: BAL.startingSupplies };
    st.turn.turnOrder.push('C');
    st.units.push(makeUnit('C', 'scout', 3, 0));
    const qA = [{ type: 'move', unitId: 'scout:A:1,0', q: 2, r: 0 }];
    const qB = [{ type: 'move', unitId: 'scout:B:2,0', q: 1, r: 0 }];
    const qC = [{ type: 'attack', attackerId: 'scout:C:3,0', q: 2, r: 0 }];
    const { board, outcomes } = I.simulateRound(
      I.cloneBoard(st),
      new Map([['A', qA], ['B', qB], ['C', qC]]),
      null,
    );

    expect(outcomes.A[0]).toMatchObject({ type: 'move', status: 'executed', q: 2, r: 0 });
    expect(outcomes.B[0]).toMatchObject({ type: 'move', status: 'executed', q: 1, r: 0 });
    expect(outcomes.C[0]).toMatchObject({ type: 'attack', status: 'executed', q: 2, r: 0 });
    const dmg = Math.max(BAL.minimumDamage, map.units.scout.attack - map.units.scout.defense); // 16-4=12
    const a = board.units.find((u: any) => u.owner === 'A')!;
    const b = board.units.find((u: any) => u.owner === 'B')!;
    const c = board.units.find((u: any) => u.owner === 'C')!;
    expect(a.q).toBe(2); expect(a.r).toBe(0); // 换位后 A 在 (2,0)
    expect(b.q).toBe(1); expect(b.r).toBe(0); // 换位后 B 在 (1,0)
    expect(a.hp).toBe(map.units.scout.hp - dmg);
    expect(b.hp).toBe(map.units.scout.hp);
    expect(c.hp).toBe(map.units.scout.hp);
  });

  it('场景 B：部署 executed + detail 齐全；锁定游骑兵对逃逸目标 target_escaped', () => {
    const st = baseState(200);
    const qA = [
      { type: 'deploy', unitType: 'ranger', fromId: 'hq_A', q: 4, r: 0 },
      // 第 2 步：锁定 B 侦察兵的计划时刻位置 (2,0)。
      { type: 'attack', attackerId: 'ranger:4,0:sim', q: 2, r: 0 },
    ];
    const qB = [
      // 第 1 步：B 侦察兵逃出射程 3（(4,0)→(0,1) 距离 4）。
      { type: 'move', unitId: 'scout:B:2,0', q: 0, r: 1 },
    ];
    const { board, outcomes } = I.simulateRound(I.cloneBoard(st), new Map([['A', qA], ['B', qB]]), null);

    const dep = outcomes.A.find((o: any) => o.type === 'deploy');
    expect(dep?.status).toBe('executed');
    expect(dep?.detail).toMatchObject({ unitType: 'ranger', fromId: 'hq_A', q: 4, r: 0 });
    expect(dep?.detail.unitId).toBe('ranger:4,0:sim');
    expect(dep?.detail.cost).toBe(map.units.ranger.cost);
    expect(board.supplies.A).toBe(BAL.startingSupplies - map.units.ranger.cost); // 120-80=40
    const ranger = board.units.find((u: any) => u.type === 'ranger')!;
    expect([ranger.q, ranger.r]).toEqual([4, 0]);
    expect(ranger.hp).toBe(map.units.ranger.hp); // 新部署满血 68
    expect(outcomes.B[0]).toMatchObject({ type: 'move', status: 'executed', q: 0, r: 1 });
    const atk = outcomes.A.find((o: any) => o.type === 'attack');
    expect(atk?.status).toBe('missed');
    expect(atk?.reason).toBe('target_escaped'); // 目标已逃出射程
    const scoutB = board.units.find((u: any) => u.id === 'scout:B:2,0')!;
    expect(scoutB.hp).toBe(map.units.scout.hp); // miss 不掉血
  });

  it('场景 B2：计划时刻不存在的新部署单位不可被锁定，但可被普通覆盖命中', () => {
    const st = baseState(200);
    st.units = [makeUnit('B', 'ranger', 2, 0)]; // B 游骑兵与部署格 (4,0) 距离 2 ≤ 射程 3
    const qA = [{ type: 'deploy', unitType: 'ranger', fromId: 'hq_A', q: 4, r: 0 }];
    // B 游骑兵瞄准 (4,0)：计划时刻该格为空，锁不到计划时刻敌军；
    // 本步部署到该格的 A 游骑兵不能作为锁定目标，但仍会被普通单格射程覆盖。
    const qB = [{ type: 'attack', attackerId: 'ranger:B:2,0', q: 4, r: 0 }];
    const { board, outcomes } = I.simulateRound(I.cloneBoard(st), new Map([['A', qA], ['B', qB]]), null);

    expect(outcomes.A[0]).toMatchObject({ type: 'deploy', status: 'executed' });
    const atk = outcomes.B.find((o: any) => o.type === 'attack');
    expect(atk?.status).toBe('executed');
    expect(atk?.reason).toBeUndefined();
    const ranger = board.units.find((u: any) => u.type === 'ranger' && u.owner === 'A')!;
    const dmg = Math.max(BAL.minimumDamage, map.units.ranger.attack - map.units.ranger.defense); // 38-3=35
    expect(ranger.hp).toBe(map.units.ranger.hp - dmg); // 68-35=33
  });

  it('场景 C：HQ 伤害入账截断 —— 满血 25/25，残血 10 入账 10', () => {
    // C1 满血 HQ：infantry(31) vs HQ(def 6) → 25 伤，全额入账。
    const st1 = baseState(200);
    st1.units.push(makeUnit('A', 'infantry', -3, 0));
    const qC1 = [{ type: 'attack', attackerId: 'infantry:A:-3,0', q: -5, r: 0 }];
    // line[2] 合法性自检：(-3,0) 沿 {-1,0} 方向 2 步恰好覆盖 (-4,0)(-5,0)。
    expect(lineCovered({ q: -3, r: 0 }, { q: -5, r: 0 },
      map.units.infantry.attackShape, map.units.infantry.attackRange)).toBe(true);
    const r1 = I.simulateRound(I.cloneBoard(st1), new Map([['A', qC1], ['B', []]]), null);
    const dmg = Math.max(BAL.minimumDamage, map.units.infantry.attack - map.headquartersSpec.defense); // 25
    expect(r1.board.hqs.B.hp).toBe(200 - dmg);
    expect(r1.board.hqs.B.alive).toBe(true);
    expect(r1.board.players.A.stats.headquartersDamage).toBe(dmg);
    const oa1 = r1.outcomes.A.find((o: any) => o.type === 'attack');
    expect(oa1?.status).toBe('executed');
    expect(oa1).toMatchObject({ q: -5, r: 0 });

    // C2 残血 HQ(10)：扣 25 → 击毁，入账截断为 10（而非 25）。
    const st2 = baseState(10);
    st2.units.push(makeUnit('A', 'infantry', -3, 0));
    const qC2 = [{ type: 'attack', attackerId: 'infantry:A:-3,0', q: -5, r: 0 }];
    const r2 = I.simulateRound(I.cloneBoard(st2), new Map([['A', qC2], ['B', []]]), null);
    expect(r2.board.hqs.B.hp).toBe(0);
    expect(r2.board.hqs.B.alive).toBe(false);
    expect(r2.board.players.B.status).toBe('eliminated');
    expect(r2.board.players.A.stats.headquartersDamage).toBe(10); // actual = min(10, 25)
    expect(r2.board.units.every((u: any) => u.owner !== 'B')).toBe(true); // B 全军移除
  });

  it('场景 D：连续 wait 必须按出现次数逐条吐出', () => {
    const st = baseState(200);
    st.plan.myQueue = [];
    const key = `${st.id}:A`;
    I.planCache.set(key, {
      round: 1,
      plan: [{ type: 'wait' }, { type: 'wait' }],
      rejected: new Map(),
      emitted: new Map(),
    });
    try {
      const first = I.decideImpl(st, {}, { owner: 'A' });
      expect(first).toEqual({ type: 'wait', payload: {} });

      st.plan.myQueue.push({ id: 'wait-1', type: 'wait' });
      const second = I.decideImpl(st, {}, { owner: 'A' });
      expect(second).toEqual({ type: 'wait', payload: {} });
    } finally {
      I.planCache.delete(key);
    }
  });
});
