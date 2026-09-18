// tests/algorithms/verdict.test.ts
// 裁决线算法（algorithms/builtin/verdict.mjs）核心行为单元测试：
// 裁决账本（打总部 vs 打单位）、三条裁决线的判定与姿态（斩首/磨平/守成）、
// 交换裁决（够本就不怕死）、攻城排程的期限与推进、行动点预算门控、
// 装备补员、治疗、占点、拆墙正反例。
import { describe, expect, it } from 'vitest';
// @ts-expect-error 算法模块为 ESM .mjs，无类型声明
import verdict from '../../algorithms/builtin/verdict.mjs';
// @ts-expect-error 工具库为 ESM .mjs，无类型声明
import * as utils from '../../algorithms/lib/game-utils.mjs';

type UnitOverrides = Partial<{
  hp: number;
  hasMoved: boolean;
  hasActed: boolean;
  actionSpent: boolean;
  moveRange: number;
}>;

interface CpSpec { id: string; q: number; r: number; owner: string | null; kind: string }

interface BlockerSpec { q: number; r: number; terrain: string }

const UNIT_SPECS: Record<string, Record<string, number | boolean>> = {
  infantry: { hp: 100, attack: 30, defense: 8, moveRange: 3, attackRange: 1, cost: 45, canCapture: true },
  scout: { hp: 65, attack: 16, defense: 4, moveRange: 5, attackRange: 1, cost: 38, canCapture: true },
  heavy: { hp: 150, attack: 38, defense: 13, moveRange: 2, attackRange: 1, cost: 92, canCapture: false },
  ranger: { hp: 72, attack: 44, defense: 3, moveRange: 2, attackRange: 3, cost: 78, canCapture: false },
  support: { hp: 82, attack: 10, defense: 5, moveRange: 3, attackRange: 1, cost: 60, canCapture: false, healPower: 22 },
};

let unitSeq = 0;

function makeUnit(owner: string, type: string, q: number, r: number, overrides: UnitOverrides = {}) {
  const spec = UNIT_SPECS[type];
  unitSeq += 1;
  return {
    id: `u${unitSeq}_${owner}_${type}`,
    owner,
    type,
    q,
    r,
    hp: spec.hp as number,
    maxHp: spec.hp as number,
    attack: spec.attack as number,
    defense: spec.defense as number,
    moveRange: spec.moveRange as number,
    attackRange: spec.attackRange as number,
    cost: spec.cost as number,
    canCapture: spec.canCapture as boolean,
    healPower: spec.healPower as number | undefined,
    alive: true,
    hasMoved: false,
    hasActed: false,
    actionSpent: false,
    ...overrides,
  };
}

interface GameOptions {
  suppliesA?: number;
  turnNumber?: number;
  actionsUsed?: number;
  controlPoints?: CpSpec[];
  blockers?: BlockerSpec[];
  cells?: Array<{ q: number; r: number; terrain: string }>;
  maxTurns?: number;
  /** 棋盘半径（默认 3）。总部默认放在两角。 */
  radius?: number;
  /** 己方总部血量（默认 100）。 */
  ownHqHp?: number;
  /** 敌方总部血量（默认 100）。 */
  enemyHqHp?: number;
  /** 敌方总部坐标（默认右上角）。 */
  enemyHqAt?: { q: number; r: number };
}

function makeGame(units: ReturnType<typeof makeUnit>[], options: GameOptions = {}) {
  const radius = options.radius ?? 3;
  const cells: Array<{ q: number; r: number; terrain: string }> = options.cells ?? [];
  if (cells.length === 0) {
    for (let q = -radius; q <= radius; q++) {
      for (let r = -radius; r <= radius; r++) {
        cells.push({ q, r, terrain: 'plain' });
      }
    }
  }
  const enemyHq = options.enemyHqAt ?? { q: radius, r: radius };
  const enemyHqHp = options.enemyHqHp ?? 100;
  const ownHqHp = options.ownHqHp ?? 100;
  return {
    id: 'g_verdict_test',
    phase: 'active',
    winner: null,
    cells,
    map: { terrainCells: options.blockers || [] },
    units,
    headquarters: {
      player_a: { id: 'hq_a', owner: 'player_a', q: -radius, r: -radius, hp: ownHqHp, maxHp: 100, defense: 6, alive: true },
      player_b: { id: 'hq_b', owner: 'player_b', q: enemyHq.q, r: enemyHq.r, hp: enemyHqHp, maxHp: enemyHqHp, defense: 6, alive: true },
    },
    controlPoints: options.controlPoints ?? [],
    players: { player_a: { status: 'active' }, player_b: { status: 'active' } },
    playerNames: { player_a: '甲', player_b: '乙' },
    resources: { player_a: { supplies: options.suppliesA ?? 20 }, player_b: { supplies: 20 } },
    turn: {
      currentPlayerId: 'player_a', turnNumber: options.turnNumber ?? 1,
      actionsUsed: options.actionsUsed ?? 0,
    },
    config: {
      mode: 'standard',
      units: UNIT_SPECS,
      balance: {
        actionsPerTurn: 5,
        damageVarianceRange: 3,
        minimumDamage: 1,
        healVarianceRange: 6,
        controlPointIncome: 12,
        maxTurns: options.maxTurns ?? 15,
        // 与 maps/default.json 同档：敌总伤 5 / 己总血 2 / 据点 90 / 兵力 2 / 补给 1
        adjudicationWeights: {
          enemyHqDamage: 5, ownHqHp: 2, controlPoint: 90, armyValue: 2, supplies: 1,
        },
      },
    },
  };
}

/** 该坐标到指定点的六边形距离（断言走位方向用）。 */
const distTo = (a: { q: number; r: number }, b: { q: number; r: number }) => utils.hexDistance(a, b);

describe('verdict 算法 decide()', () => {
  it('按裁决分计价：射程内同时有敌方总部和敌军时优先打总部', async () => {
    // 账本是本算法的核心主张：default 图打总部 1 点伤害 5 分，打单位 1 点血 = 2×45/100 = 0.9 分
    const ranger = makeUnit('player_a', 'ranger', 2, 2);
    const enemyInfantry = makeUnit('player_b', 'infantry', 2, 3);
    const game = makeGame([ranger, enemyInfantry], { enemyHqAt: { q: 3, r: 3 } });

    // 先确认两个目标都在射程内
    const [hq, unit] = [game.headquarters.player_b, enemyInfantry];
    expect(distTo(ranger, hq)).toBeLessThanOrEqual(3);
    expect(distTo(ranger, unit)).toBeLessThanOrEqual(3);

    const action = await verdict.decide(game, utils);

    expect(action).not.toBeNull();
    expect(action.type).toBe('attack');
    expect(action.payload.attackerId).toBe(ranger.id);
    expect(action.payload.targetId).toBe('hq_b');
  });

  it('稳杀集火：能斩杀的残血单位优先于只能磨血的满血单位', async () => {
    // 大图上开局：敌方总部很远（推进梯度可以忽略），两个敌方侦察兵都在射程内。
    // 斩杀 18 血的那个既拿走它的全部血量，也让它下回合不再开枪。
    const ranger = makeUnit('player_a', 'ranger', 0, 0);
    const wounded = makeUnit('player_b', 'scout', 1, 0, { hp: 18 });
    const healthy = makeUnit('player_b', 'scout', 2, 0);
    const game = makeGame([ranger, wounded, healthy], { radius: 8 });

    const action = await verdict.decide(game, utils);

    expect(action).not.toBeNull();
    expect(action.type).toBe('attack');
    expect(action.payload.attackerId).toBe(ranger.id);
    expect(action.payload.targetId).toBe(wounded.id);
  });

  it('斩首线：攻城排程可行时全军向敌方总部收束（不是停在原地）', async () => {
    const ranger = makeUnit('player_a', 'ranger', 0, 0);
    const game = makeGame([ranger], { enemyHqAt: { q: 3, r: 3 } });

    const action = await verdict.decide(game, utils);

    expect(action).not.toBeNull();
    expect(action.type).toBe('move');
    expect(action.payload.unitId).toBe(ranger.id);
    expect(distTo({ q: action.payload.q, r: action.payload.r }, game.headquarters.player_b))
      .toBeLessThan(distTo(ranger, game.headquarters.player_b));
  });

  it('斩首线：排在攻城序列里的单位即使一步只推进一格也不会提前结束回合', async () => {
    // decide 返回 null 的语义是"结束整个回合"，推进门槛必须远小于一格的收益
    const scout = makeUnit('player_a', 'scout', -3, 0);
    const game = makeGame([scout]);

    const action = await verdict.decide(game, utils);

    expect(action).not.toBeNull();
    expect(action.type).toBe('move');
  });

  it('磨平线交换裁决：够本时明知会被打死也照打总部', async () => {
    // 斩首不可达（总部血量远超排程上限）+ 当前分落后 → 磨平线，姿态 trade
    // 残血步兵贴脸敌方总部：打击分 24×5=120 ≥ 单位价值 90×0.8=72 → 无视致命风险
    const infantry = makeUnit('player_a', 'infantry', 2, 2, { hp: 40 });
    const enemyInfantry = makeUnit('player_b', 'infantry', 1, 2);
    const enemyHeavy = makeUnit('player_b', 'heavy', 2, 3);
    const farAway = makeUnit('player_b', 'ranger', -3, 0);
    const game = makeGame([infantry, enemyInfantry, enemyHeavy, farAway], {
      enemyHqAt: { q: 2, r: 3 },
      enemyHqHp: 5000,
      // 敌方已握住多个据点 → 我方分差深度落后
      controlPoints: [
        { id: 'cp1', q: -3, r: 1, owner: 'player_b', kind: 'supply' },
        { id: 'cp2', q: -3, r: 2, owner: 'player_b', kind: 'supply' },
        { id: 'cp3', q: -3, r: 3, owner: 'player_b', kind: 'supply' },
        { id: 'cp4', q: -2, r: 3, owner: 'player_b', kind: 'supply' },
      ],
    });

    const action = await verdict.decide(game, utils);

    expect(action).not.toBeNull();
    expect(action.type).toBe('attack');
    expect(action.payload.attackerId).toBe(infantry.id);
    expect(action.payload.targetId).toBe('hq_b');
  });

  it('守成线：敌方排程即将拿下我方总部时，非占领单位回防', async () => {
    // 己方总部只剩 20 血，敌方游侠射程内一次齐射就能打掉 → 敌杀排程 ≤ 3 → fortress
    const infantry = makeUnit('player_a', 'infantry', 1, 1);
    const enemyRanger = makeUnit('player_b', 'ranger', 0, -2);
    const game = makeGame([infantry, enemyRanger], { ownHqHp: 20, enemyHqAt: { q: 3, r: 3 } });

    const before = distTo(infantry, game.headquarters.player_a);
    const action = await verdict.decide(game, utils);

    expect(action).not.toBeNull();
    expect(action.payload.unitId).toBe(infantry.id);
    expect(action.type).toBe('move');
    expect(distTo({ q: action.payload.q, r: action.payload.r }, game.headquarters.player_a))
      .toBeLessThan(before);
  });

  it('治疗：支援兵给最需要治疗的队友补血', async () => {
    const support = makeUnit('player_a', 'support', 0, 0);
    // 让受伤的步兵先行动完，把本回合的决策权让给支援兵
    const wounded = makeUnit('player_a', 'infantry', 0, 1, {
      hp: 20, hasMoved: true, hasActed: true,
    });
    const game = makeGame([support, wounded], { ownHqHp: 20 });

    const action = await verdict.decide(game, utils);

    expect(action).not.toBeNull();
    expect(action.type).toBe('heal');
    expect(action.payload.supportId).toBe(support.id);
    expect(action.payload.targetId).toBe(wounded.id);
  });

  it('部署：最优动作不如"多一支部队"时补员', async () => {
    const infantry = makeUnit('player_a', 'infantry', -2, -2, { hasMoved: true, hasActed: true });
    const game = makeGame([infantry], { suppliesA: 200 });

    const action = await verdict.decide(game, utils);

    expect(action).not.toBeNull();
    expect(action.type).toBe('deploy');
    expect(action.payload.fromId).toBe('hq_a');
  });

  it('被全歼时仍然补员，而不是交空回合', async () => {
    const enemy = makeUnit('player_b', 'infantry', 2, 0);
    const game = makeGame([enemy], { suppliesA: 200 });

    const action = await verdict.decide(game, utils);

    expect(action).not.toBeNull();
    expect(action.type).toBe('deploy');
  });

  it('行动点耗尽后不得再返回任何耗行动点的动作', async () => {
    const infantry = makeUnit('player_a', 'infantry', 2, 2);
    const enemy = makeUnit('player_b', 'scout', 2, 3);
    const game = makeGame([infantry, enemy], { actionsUsed: 5, enemyHqAt: { q: 3, r: 3 } });

    const action = await verdict.decide(game, utils);

    expect(action).toBeNull();
  });

  it('已用掉移动的单位不得再返回移动动作', async () => {
    const moved = makeUnit('player_a', 'scout', -3, 0, { hasMoved: true });
    const fresh = makeUnit('player_a', 'infantry', -3, 1);
    const game = makeGame([moved, fresh]);

    const action = await verdict.decide(game, utils);

    expect(action).not.toBeNull();
    expect(action.payload.unitId).not.toBe(moved.id);
  });

  it('拆墙：只拆比脚下更接近任务目标的墙', async () => {
    const heavy = makeUnit('player_a', 'heavy', 0, 0);
    // 朝向目标方向的墙（更近）与背离目标方向的墙（更远）各一堵，都贴在重装身边
    const game = makeGame([heavy], {
      enemyHqAt: { q: 3, r: 3 },
      blockers: [
        { q: 1, r: 0, terrain: 'blocker' },
        { q: -1, r: 0, terrain: 'blocker' },
      ],
      turnNumber: 5,
    });

    const action = await verdict.decide(game, utils);

    expect(action).not.toBeNull();
    expect(action.type).toBe('demolish');
    expect(action.payload.unitId).toBe(heavy.id);
    // 拆的是朝向敌方总部那一侧的墙
    expect(distTo({ q: action.payload.q, r: action.payload.r }, game.headquarters.player_b))
      .toBeLessThan(distTo(heavy, game.headquarters.player_b));
  });
});
