// tests/algorithms/field.test.ts
// 势场算法（algorithms/builtin/field.mjs）核心行为单元测试：
// 稳杀集火、补刀、残血避险、治疗、抢点、风筝走位、部署先行、
// 行动点预算门控、回合收尾、拆墙。
import { describe, expect, it } from 'vitest';
// @ts-expect-error 算法模块为 ESM .mjs，无类型声明
import field from '../../algorithms/builtin/field.mjs';
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
  maxTurns?: number | null;
  cpIncome?: number;
  /** 棋盘半径（默认 3）。总部默认放在两角，避免测试单位的射程够到敌方总部。 */
  radius?: number;
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
  return {
    id: 'g_field_test',
    phase: 'active',
    winner: null,
    cells,
    map: { terrainCells: options.blockers || [] },
    units,
    headquarters: {
      // 总部放两角：距离中心等于 2×radius，游侠（射程 3）在半径 ≤3 的测试盘上够不到
      player_a: { id: 'hq_a', owner: 'player_a', q: -radius, r: -radius, hp: 100, maxHp: 100, alive: true },
      player_b: { id: 'hq_b', owner: 'player_b', q: radius, r: radius, hp: 100, maxHp: 100, alive: true },
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
        controlPointIncome: options.cpIncome ?? 12,
        maxTurns: options.maxTurns === undefined ? 15 : options.maxTurns,
      },
    },
  };
}

describe('field algorithm decide()', () => {
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

    const action = await field.decide(game, utils);

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

    const first = await field.decide(game, utils);
    expect(first.type).toBe('attack');
    expect(first.payload.targetId).toBe(enemy.id);

    // 第一刀命中（均值 41），第二刀应直接补刀收割
    enemy.hp -= 41;
    const second = await field.decide(game, utils);
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

    const action = await field.decide(game, utils);

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

    const action = await field.decide(game, utils);

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

    const action = await field.decide(game, utils);

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

    const action = await field.decide(game, utils);

    expect(action).not.toBeNull();
    expect(action.type).toBe('deploy');
    expect(action.payload.unitType).toBe('scout');
    expect(action.payload.fromId).toBe('hq_a');
  });

  it('returns null when nothing worthwhile remains', async () => {
    const ranger = makeUnit('player_a', 'ranger', -3, 0, { hasMoved: true });
    const enemy = makeUnit('player_b', 'infantry', 3, 0);
    const game = makeGame([ranger, enemy], { suppliesA: 20 });

    const action = await field.decide(game, utils);

    expect(action).toBeNull();
  });
});

describe('field 势场特有行为', () => {
  it('风筝走位：远程单位沿场梯度停在射程边缘，不贴脸站桩', async () => {
    // 游侠（射程 3、moveRange 2）距敌重装 5 格：本回合可进入射程。
    // 期望落点停在射程外沿（距敌 = 3），而不是越近越好。
    const ranger = makeUnit('player_a', 'ranger', 0, 0);
    const enemy = makeUnit('player_b', 'heavy', 0, 5);
    const game = makeGame([ranger, enemy], { suppliesA: 0, radius: 6 });

    const action = await field.decide(game, utils);

    expect(action).not.toBeNull();
    expect(action.type).toBe('move');
    expect(action.payload.unitId).toBe(ranger.id);
    const dist = utils.hexDistance({ q: action.payload.q, r: action.payload.r }, enemy);
    // 进入射程（能开火）但保持距离（不贴身）
    expect(dist).toBeLessThanOrEqual(ranger.attackRange);
    expect(dist).toBeGreaterThanOrEqual(2);
  });

  it('风筝回撤：已开火的远程单位从贴脸位撤出敌方打击范围', async () => {
    const ranger = makeUnit('player_a', 'ranger', 0, 2, { hasActed: true, actionSpent: true });
    const heavy = makeUnit('player_b', 'heavy', 0, 3);
    const game = makeGame([ranger, heavy], { suppliesA: 0, radius: 4 });

    const action = await field.decide(game, utils);

    expect(action).not.toBeNull();
    expect(action.type).toBe('move');
    expect(action.payload.unitId).toBe(ranger.id);
    const dist = utils.hexDistance({ q: action.payload.q, r: action.payload.r }, heavy);
    // 撤出敌方当前打击范围，且不再贴身
    expect(dist).toBeGreaterThan(heavy.attackRange);
    expect(dist).toBeGreaterThanOrEqual(2);
  });

  it('分头抢点：两个等距据点时先拿最近的（此处 cp1 为唯一目标）', async () => {
    // 对称布局：待决策步兵在 (0,3)，cp1 在 (0,0)、cp2 在 (3,3)；无认领者。
    const mover = makeUnit('player_a', 'infantry', 0, 3);
    const game = makeGame([mover], {
      suppliesA: 0,
      radius: 6,
      controlPoints: [
        { id: 'cp1', q: 0, r: 0, owner: null, kind: 'outpost' },
        { id: 'cp2', q: 3, r: 3, owner: null, kind: 'outpost' },
      ],
    });

    const action = await field.decide(game, utils);

    expect(action).not.toBeNull();
    expect(action.type).toBe('move');
    const landing = { q: action.payload.q, r: action.payload.r };
    expect(utils.hexDistance(landing, { q: 0, r: 0 }))
      .toBeLessThan(utils.hexDistance(landing, { q: 3, r: 3 }));
  });

  it('认领衰减：友军已占住近处的点后，后续单位转向无人认领的点', async () => {
    // 同上对称布局，但 cp1 周围有两名友军认领：井深 × 0.6² = 0.36，
    // 引力被摊薄，待决策步兵应改道未认领的 cp2。
    const claimerA = makeUnit('player_a', 'scout', 0, 1);
    const claimerB = makeUnit('player_a', 'scout', 1, 0);
    const mover = makeUnit('player_a', 'infantry', 0, 3);
    const game = makeGame([claimerA, claimerB, mover], {
      suppliesA: 0,
      radius: 6,
      controlPoints: [
        { id: 'cp1', q: 0, r: 0, owner: null, kind: 'outpost' },
        { id: 'cp2', q: 3, r: 3, owner: null, kind: 'outpost' },
      ],
    });

    const action = await field.decide(game, utils);

    expect(action).not.toBeNull();
    expect(action.type).toBe('move');
    expect(action.payload.unitId).toBe(mover.id);
    const landing = { q: action.payload.q, r: action.payload.r };
    expect(utils.hexDistance(landing, { q: 3, r: 3 }))
      .toBeLessThan(utils.hexDistance(landing, { q: 0, r: 0 }));
  });
});

describe('field 行动点预算合法性（回归：非法动作会让 runner 提前结束整个回合）', () => {
  it('行动点耗尽后不再返回需要行动点的动作', async () => {
    const shooter = makeUnit('player_a', 'infantry', 0, 0);
    const victim = makeUnit('player_b', 'scout', 1, 0, { hp: 10 });
    const game = makeGame([shooter, victim], { suppliesA: 0, actionsUsed: 5 });

    const action = await field.decide(game, utils);

    expect(action).toBeNull();
  });

  it('行动点耗尽后，已激活的单位仍可白给移动（不受预算限制）', async () => {
    const scout = makeUnit('player_a', 'scout', 0, 1, { hp: 20, hasActed: true, actionSpent: true });
    const support = makeUnit('player_a', 'support', -3, -1);
    const heavy = makeUnit('player_a', 'heavy', -3, -2);
    const enemy1 = makeUnit('player_b', 'infantry', 0, 0);
    const enemy2 = makeUnit('player_b', 'infantry', 1, 0);
    const game = makeGame([scout, support, heavy, enemy1, enemy2], { suppliesA: 0, actionsUsed: 5 });

    const action = await field.decide(game, utils);

    expect(action).not.toBeNull();
    expect(action!.type).toBe('move');
    expect(action!.payload.unitId).toBe(scout.id);
  });

  it('治疗者没有行动点时不会返回非法 heal', async () => {
    const support = makeUnit('player_a', 'support', 0, 0);
    const wounded = makeUnit('player_a', 'infantry', 1, 0, { hp: 40 });
    const game = makeGame([support, wounded], { suppliesA: 0, actionsUsed: 5 });

    const action = await field.decide(game, utils);

    expect(action).toBeNull();
  });
});

describe('field 回合收尾与补员（回归：提前 endTurn / 不补员会白白丢节奏）', () => {
  it('只能再推进一格时不应提前结束回合', async () => {
    const scout = makeUnit('player_a', 'scout', -2, 0, { moveRange: 1 });
    const enemy = makeUnit('player_b', 'heavy', 3, 0);
    const game = makeGame([scout, enemy], { suppliesA: 0 });

    const action = await field.decide(game, utils);

    expect(action).not.toBeNull();
    expect(action!.type).toBe('move');
    expect(utils.hexDistance({ q: action!.payload.q, r: action!.payload.r }, { q: 3, r: 0 }))
      .toBeLessThan(utils.hexDistance(scout, { q: 3, r: 0 }));
  });

  it('部队被全歼后仍会用剩余行动点补员', async () => {
    const enemy = makeUnit('player_b', 'infantry', 2, 0);
    const game = makeGame([enemy], { suppliesA: 100 });

    const action = await field.decide(game, utils);

    expect(action).not.toBeNull();
    expect(action!.type).toBe('deploy');
    expect(action!.payload.fromId).toBe('hq_a');
  });
});

describe('field 斥力场与拆墙', () => {
  it('威胁井按火力上限截断，兵力翻倍不改变决策（火力密度不被线性高估）', async () => {
    const build = (attackers: number) => {
      const mine = makeUnit('player_a', 'infantry', 0, 1);
      const cp: CpSpec = { id: 'cp1', q: 0, r: 2, owner: null, kind: 'outpost' };
      const enemies = Array.from({ length: attackers }, (_, i) =>
        makeUnit('player_b', 'infantry', -1 + (i % 3), 3 + Math.floor(i / 3)));
      return makeGame([mine, ...enemies], { suppliesA: 0, controlPoints: [cp] });
    };

    const few = await field.decide(build(6), utils);
    const many = await field.decide(build(14), utils);

    expect(few).not.toBeNull();
    // 只比较决策本身（单位 id 含全局计数，不参与对比）
    expect({ type: many!.type, q: many!.payload.q, r: many!.payload.r })
      .toEqual({ type: few!.type, q: few!.payload.q, r: few!.payload.r });
  });

  it('拆掉确实挡路的墙', async () => {
    const heavy = makeUnit('player_a', 'heavy', 0, 0);
    const enemy = makeUnit('player_b', 'heavy', 3, 0);
    const game = makeGame([heavy, enemy], {
      suppliesA: 0,
      turnNumber: 6,
      blockers: [{ q: 1, r: 0, terrain: 'blocker' }],
    });

    const action = await field.decide(game, utils);

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

    const action = await field.decide(game, utils);

    expect(action === null || action!.type !== 'demolish').toBe(true);
  });

  it('把 maxTurns 的 null 读成无上限，而不是悄悄当成 15', async () => {
    const infantry = makeUnit('player_a', 'infantry', 0, -1);
    const enemy = makeUnit('player_b', 'heavy', 0, 0);
    const controlPoints = [{ id: 'cp1', q: 3, r: -3, owner: null, kind: 'outpost' }];
    const decideFor = (maxTurns: number | null) => field.decide(
      makeGame([infantry, enemy], { turnNumber: 10, controlPoints, cpIncome: 20, maxTurns }),
      utils,
    );

    const unlimited = await decideFor(null);

    // 无限视野 ≡ 极大有限上限；15 回合封顶会掐短据点井的深度并按假终局加深它
    expect(unlimited).not.toBeNull();
    expect(unlimited).toEqual(await decideFor(1000));
    expect(unlimited).not.toEqual(await decideFor(15));
  });
});
