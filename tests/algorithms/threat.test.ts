// tests/algorithms/threat.test.ts
// 威胁感知算法（algorithms/builtin/threat.mjs）核心行为单元测试：
// 稳杀集火、补刀、残血避险、治疗、抢点、部署先行、无动作收尾。
import { describe, expect, it } from 'vitest';
// @ts-expect-error 算法模块为 ESM .mjs，无类型声明
import threat from '../../algorithms/builtin/threat.mjs';
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
  cpTypes?: Record<string, { income: number; deployDiscount: number; repairAmount: number }>;
}

function makeGame(units: ReturnType<typeof makeUnit>[], options: GameOptions = {}) {
  const cells: Array<{ q: number; r: number; terrain: string }> = [];
  for (let q = -3; q <= 3; q++) {
    for (let r = -3; r <= 3; r++) {
      cells.push({ q, r, terrain: 'plain' });
    }
  }
  return {
    id: 'g_test',
    phase: 'active',
    winner: null,
    cells,
    map: { terrainCells: options.blockers || [] },
    units,
    headquarters: {
      player_a: { id: 'hq_a', owner: 'player_a', q: -3, r: 0, hp: 100, maxHp: 100, alive: true },
      player_b: { id: 'hq_b', owner: 'player_b', q: 3, r: 0, hp: 100, maxHp: 100, alive: true },
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
        controlPointTypes: options.cpTypes,
        maxTurns: 15,
      },
    },
  };
}

describe('threat algorithm decide()', () => {
  it('prefers a guaranteed kill over chip damage and a capture move', async () => {
    const ranger = makeUnit('player_a', 'ranger', 0, 0);
    const infantry = makeUnit('player_a', 'infantry', 0, 1);
    const myScout = makeUnit('player_a', 'scout', -1, 1);
    const wounded = makeUnit('player_b', 'scout', 2, 0, { hp: 20 });
    const enemyInfantry = makeUnit('player_b', 'infantry', -2, 0);
    const game = makeGame([ranger, infantry, myScout, wounded, enemyInfantry], {
      suppliesA: 20,
      controlPoints: [{ id: 'cp1', q: 0, r: 2, owner: null, kind: 'outpost' }],
    });

    const action = await threat.decide(game, utils);

    expect(action).not.toBeNull();
    expect(action.type).toBe('attack');
    expect(action.payload.attackerId).toBe(ranger.id);
    expect(action.payload.targetId).toBe(wounded.id);
  });

  it('focuses fire: the follow-up decide finishes the wounded target', async () => {
    const attacker = makeUnit('player_a', 'ranger', -3, 1);
    const spotter = makeUnit('player_a', 'ranger', -2, 2);
    const myScout = makeUnit('player_a', 'scout', 0, 1);
    const enemy = makeUnit('player_b', 'ranger', -2, 0, { hp: 50 });
    const game = makeGame([attacker, spotter, myScout, enemy], { suppliesA: 20 });

    const first = await threat.decide(game, utils);
    expect(first.type).toBe('attack');
    expect(first.payload.targetId).toBe(enemy.id);

    // 第一刀命中（均值 41），第二刀应直接补刀收割
    enemy.hp -= 41;
    const second = await threat.decide(game, utils);
    expect(second.type).toBe('attack');
    expect(second.payload.targetId).toBe(enemy.id);
  });

  it('retreats a lethal-wounded unit out of enemy reach', async () => {
    const scout = makeUnit('player_a', 'scout', 0, 1, { hp: 20 });
    const support = makeUnit('player_a', 'support', -3, -1);
    const heavy = makeUnit('player_a', 'heavy', -3, -2);
    const enemy1 = makeUnit('player_b', 'infantry', 0, 0);
    const enemy2 = makeUnit('player_b', 'infantry', 1, 0);
    const game = makeGame([scout, support, heavy, enemy1, enemy2], { suppliesA: 20 });

    const action = await threat.decide(game, utils);

    expect(action).not.toBeNull();
    expect(action.type).toBe('move');
    expect(action.payload.unitId).toBe(scout.id);
    // 落点必须脱离两个敌人的当前打击范围（不再贴脸站桩）
    for (const enemy of [enemy1, enemy2]) {
      const dist = utils.hexDistance(enemy, { q: action.payload.q, r: action.payload.r });
      expect(dist).toBeGreaterThan(enemy.attackRange);
    }
  });

  it('heals the most wounded ally when no better action exists', async () => {
    const support = makeUnit('player_a', 'support', 0, 0);
    const wounded = makeUnit('player_a', 'infantry', 1, 0, { hp: 40 });
    const game = makeGame([support, wounded], { suppliesA: 20 });

    const action = await threat.decide(game, utils);

    expect(action).not.toBeNull();
    expect(action.type).toBe('heal');
    expect(action.payload.supportId).toBe(support.id);
    expect(action.payload.targetId).toBe(wounded.id);
  });

  it('moves a capturing unit onto a neutral control point', async () => {
    const scout = makeUnit('player_a', 'scout', 0, 0);
    const game = makeGame([scout], {
      suppliesA: 20,
      controlPoints: [{ id: 'cp1', q: 1, r: 0, owner: null, kind: 'outpost' }],
    });

    const action = await threat.decide(game, utils);

    expect(action).not.toBeNull();
    expect(action.type).toBe('move');
    expect(action.payload.unitId).toBe(scout.id);
    expect(action.payload.q).toBe(1);
    expect(action.payload.r).toBe(0);
  });

  it('deploys first when supplies are plentiful', async () => {
    const myScout = makeUnit('player_a', 'scout', -2, 0);
    const enemy = makeUnit('player_b', 'infantry', 2, 0);
    const game = makeGame([myScout, enemy], { suppliesA: 100 });

    const action = await threat.decide(game, utils);

    expect(action).not.toBeNull();
    expect(action.type).toBe('deploy');
    expect(action.payload.unitType).toBe('scout');
    expect(action.payload.fromId).toBe('hq_a');
  });

  it('returns null when nothing worthwhile remains', async () => {
    const ranger = makeUnit('player_a', 'ranger', -3, 0, { hasMoved: true });
    const enemy = makeUnit('player_b', 'infantry', 3, 0);
    const game = makeGame([ranger, enemy], { suppliesA: 20 });

    const action = await threat.decide(game, utils);

    expect(action).toBeNull();
  });
});

describe('threat 行动点预算合法性（回归：非法动作会让 runner 提前结束整个回合）', () => {
  it('行动点耗尽后不再返回需要行动点的动作', async () => {
    // 未激活的步兵能打到残血敌人，但本回合 5 个行动点已用光
    const shooter = makeUnit('player_a', 'infantry', 0, 0);
    const victim = makeUnit('player_b', 'scout', 1, 0, { hp: 10 });
    const game = makeGame([shooter, victim], { suppliesA: 0, actionsUsed: 5 });

    const action = await threat.decide(game, utils);

    expect(action === null || ['move'].includes(action.type as string)).toBe(true);
    expect(action).toBeNull();
  });

  it('行动点耗尽后，已激活的单位仍可白给移动（不受预算限制）', async () => {
    const scout = makeUnit('player_a', 'scout', 0, 1, { hp: 20, hasActed: true, actionSpent: true });
    const support = makeUnit('player_a', 'support', -3, -1);
    const heavy = makeUnit('player_a', 'heavy', -3, -2);
    const enemy1 = makeUnit('player_b', 'infantry', 0, 0);
    const enemy2 = makeUnit('player_b', 'infantry', 1, 0);
    const game = makeGame([scout, support, heavy, enemy1, enemy2], { suppliesA: 0, actionsUsed: 5 });

    const action = await threat.decide(game, utils);

    expect(action).not.toBeNull();
    expect(action!.type).toBe('move');
    expect(action!.payload.unitId).toBe(scout.id);
  });

  it('治疗者没有行动点时不会返回非法 heal', async () => {
    const support = makeUnit('player_a', 'support', 0, 0);
    const wounded = makeUnit('player_a', 'infantry', 1, 0, { hp: 40 });
    const game = makeGame([support, wounded], { suppliesA: 0, actionsUsed: 5 });

    const action = await threat.decide(game, utils);

    expect(action).toBeNull();
  });
});

describe('threat 回合收尾与补员（回归：提前 endTurn / 不补员会白白丢节奏）', () => {
  it('只能再推进一格时不应提前结束回合', async () => {
    // 门槛旧值 4 == PROGRESS_SCALE，这种回合会被直接掐掉
    const scout = makeUnit('player_a', 'scout', -2, 0, { moveRange: 1 });
    const enemy = makeUnit('player_b', 'heavy', 3, 0);
    const game = makeGame([scout, enemy], { suppliesA: 0 });

    const action = await threat.decide(game, utils);

    expect(action).not.toBeNull();
    expect(action!.type).toBe('move');
    expect(utils.hexDistance({ q: action!.payload.q, r: action!.payload.r }, { q: 3, r: 0 }))
      .toBeLessThan(utils.hexDistance(scout, { q: 3, r: 0 }));
  });

  it('部队被全歼后仍会用剩余行动点补员', async () => {
    const enemy = makeUnit('player_b', 'infantry', 2, 0);
    const game = makeGame([enemy], { suppliesA: 100 });

    const action = await threat.decide(game, utils);

    expect(action).not.toBeNull();
    expect(action!.type).toBe('deploy');
    expect(action!.payload.fromId).toBe('hq_a');
  });
});

describe('threat 威胁图与爆破', () => {
  it('超出敌方行动预算的军队不再持续抬高避险权重（火力密度不被线性高估）', async () => {
    const build = (attackers: number) => {
      const mine = makeUnit('player_a', 'infantry', 0, 1);
      const cp: CpSpec = { id: 'cp1', q: 0, r: 2, owner: null, kind: 'outpost' };
      const enemies = Array.from({ length: attackers }, (_, i) =>
        makeUnit('player_b', 'infantry', -1 + (i % 3), 3 + Math.floor(i / 3)));
      return makeGame([mine, ...enemies], { suppliesA: 0, controlPoints: [cp] });
    };

    const few = await threat.decide(build(6), utils);
    const many = await threat.decide(build(14), utils);

    expect(few).not.toBeNull();
    // 只比较决策本身（单位 id 含全局计数，不参与对比）
    expect({ type: many!.type, q: many!.payload.q, r: many!.payload.r })
      .toEqual({ type: few!.type, q: few!.payload.q, r: few!.payload.r });
    expect(many!.type).toBe('move');
  });

  it('拆掉确实挡路的墙', async () => {
    const heavy = makeUnit('player_a', 'heavy', 0, 0);
    const enemy = makeUnit('player_b', 'heavy', 3, 0);
    const game = makeGame([heavy, enemy], {
      suppliesA: 0,
      turnNumber: 6,
      blockers: [{ q: 1, r: 0, terrain: 'blocker' }],
    });

    const action = await threat.decide(game, utils);

    expect(action).not.toBeNull();
    expect(action!.type).toBe('demolish');
    expect(action!.payload).toEqual({ unitId: heavy.id, q: 1, r: 0 });
  });

  it('不炸侧后方、拆了也没用的墙', async () => {
    const heavy = makeUnit('player_a', 'heavy', 0, 0);
    const enemy = makeUnit('player_b', 'heavy', 3, 0);
    const game = makeGame([heavy, enemy], {
      suppliesA: 0,
      turnNumber: 6,
      blockers: [{ q: -1, r: 0, terrain: 'blocker' }],
    });

    const action = await threat.decide(game, utils);

    expect(action === null || action!.type !== 'demolish').toBe(true);
  });
});
