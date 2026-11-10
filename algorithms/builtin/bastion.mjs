// algorithms/builtin/bastion.mjs
//
// 大逃杀模式（royale）原创算法：堡垒算法。
// 用逐行动点的束搜索（beam search over action sequences）规划整轮：状态含己方单位
// HP/位置/攻次/移次、敌军 HP、补给与投影地形；评估 = 存活位置价值 + 击杀/伤害收益
// − 敌方「下一拍」可达威胁场暴露 − 缩圈炮火风险，按行动点折价比较序列。
//
// 独立设计边界：只依据大逃杀规则与公开投影推导，不读取、不导入、不调用仓库内其他
// 算法或策略辅助实现；现有算法仅作黑盒对手。
//
// 合法性口径：候选生成与校验在「坐标空间」进行，与引擎 planning.ts 的
// planningReachableCells / coveredCellsFor / checkDeploy / checkDemolish 一致；
// 不依赖索引镜像（会合并 terrain override 的重复坐标格导致错位）。

const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const CELL_COST = 0.35;   // 行动点折价指数（序列越长，效用折价越重）
const CAPTURE_BONUS = 40; // 本轮可占领据点的位置奖励
const POINT_HOLD = 6;     // 已持有可部署据点的续持奖励
const BEAM_WIDTH = 10;    // 束宽：每层保留的候选序列数（时间预算允许更宽）
const TIME_BUDGET_MS = 85; // 单次 decide 的软时间预算（含安全余量，硬上限 100ms）
const MIN_GAIN = 0.5;     // 低于此效用宁可不排队（提交计划）

const key = ({ q, r }) => `${q},${r}`;
const hex = (a, b) => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.q + a.r - b.q - b.r));

export default {
  name: 'bastion',
  description: '大逃杀：逐行动点束搜索，存活价值与击杀收益权衡威胁场暴露与缩圈炮火的整轮规划',

  async decide(game, _utils, ctx) {
    if (game.config?.mode !== 'royale' || game.phase !== 'active' || !ctx?.owner) return null;
    if (game.players?.[ctx.owner]?.status !== 'active') return null;
    const plan = game.plan;
    if (!plan || (plan.committed ?? []).includes(ctx.owner)) return null;
    // 己方队列两种接口：优先按座位查 queues[owner]，未提供时回退 myQueue。
    // （真实引擎结算后会清空 myQueue，故 queues[owner] 是更可靠的来源。）
    const queue = plan.queues?.[ctx.owner] ?? plan.myQueue ?? [];
    const ap = game.config.balance?.actionsPerTurn ?? 5;
    if (queue.length >= ap) return null;

    const C = buildContext(game, ctx.owner, queue);
    if (!C) return null;
    const seq = search(game, C);
    const first = seq && seq.actions[0];
    if (!first) return null;

    const at = p => ({ q: p.q, r: p.r });
    switch (first.type) {
      case 'attack': return { type: 'attack', payload: { attackerId: first.unitId, ...at(first.to) } };
      case 'move': return { type: 'move', payload: { unitId: first.unitId, ...at(first.to) } };
      case 'heal': return { type: 'heal', payload: { supportId: first.unitId, ...at(first.to) } };
      case 'demolish': return { type: 'demolish', payload: { unitId: first.unitId, ...at(first.to) } };
      case 'deploy': return { type: 'deploy', payload: { unitType: first.unitType, fromId: first.fromId, ...at(first.to) } };
      default: return null;
    }
  },
};

/**
 * 决策上下文：坐标空间模型 + 敌方威胁场 + 己方队列投影。
 * 只读公开快照与自己的队列；不修改传入状态。
 */
function buildContext(game, owner, queue) {
  const balance = game.config.balance;
  const specs = game.config.units;
  const radius = game.map.radius;

  // 坐标 -> 地形（terrainCells 覆盖优先）；越界判定用「坐标在实际格子集合内」——
  // 与引擎 getTerrain/getGameIndex 一致（不存在的坐标按 blocker，半径内可能有空洞）。
  const terrain = new Map();
  const cellKeys = new Set();
  for (const cell of game.cells) { terrain.set(key(cell), cell.terrain); cellKeys.add(key(cell)); }
  for (const cell of game.map.terrainCells ?? []) terrain.set(key(cell), cell.terrain);
  const inBounds = (q, r) => cellKeys.has(key({ q, r }));
  const terrAt = (q, r) => terrain.get(key({ q, r })) ?? 'blocker';

  const mine = game.units.filter(u => u.alive && u.owner === owner);
  const supplies0 = game.resources?.[owner]?.supplies ?? 0;

  // 己方队列投影：移动更新坐标、爆破更新地形、部署扣补给并追加新单位、攻击计次。
  const pos = new Map(mine.map(u => [u.id, { q: u.q, r: u.r }]));
  const vt = new Map();
  const movesUsed = new Map(), attacksUsed = new Map();
  let supplies = supplies0;
  const extra = [];
  for (const action of queue) {
    const uid = action.unitId ?? action.attackerId ?? action.supportId;
    if (action.type === 'move' && uid) {
      pos.set(uid, { q: action.q, r: action.r });
      movesUsed.set(uid, (movesUsed.get(uid) ?? 0) + 1);
    } else if (action.type === 'demolish') {
      vt.set(key({ q: action.q, r: action.r }), 'plain');
    } else if (action.type === 'attack' && uid) {
      attacksUsed.set(uid, (attacksUsed.get(uid) ?? 0) + 1);
    } else if (action.type === 'deploy') {
      const origin = game.controlPoints.find(p => p.id === action.fromId);
      const discount = cpDiscount(balance, origin);
      supplies -= specs[action.unitType].cost - discount;
      const spec = specs[action.unitType];
      extra.push({ id: `__dep${extra.length}`, owner, type: action.unitType, q: action.q, r: action.r, hp: spec.hp, maxHp: spec.hp, defense: spec.defense, cost: spec.cost, moveRange: spec.moveRange, attackRange: spec.attackRange, canCapture: spec.canCapture, fresh: true });
    }
  }
  if (supplies < 0) return null;

  const terrProj = (q, r) => vt.get(key({ q, r })) ?? terrAt(q, r);
  const myUnits = mine.map(u => ({ ...u, q: pos.get(u.id).q, r: pos.get(u.id).r }));
  for (const e of extra) myUnits.push(e);

  // 攻击锁定：锁定兵种只能打「开局就在该格」的初始敌军——记录初始敌位。
  const lockByCell = new Map();
  for (const u of game.units) {
    if (u.alive && u.owner !== owner && !lockByCell.has(key(u))) lockByCell.set(key(u), u);
  }

  // 落点占用：友军「本轮稳在其格」才拦路。引擎逐步结算、先离场后进场：已排移动的单位
  // （moved=true）原格腾出、新格视为它的落脚点；未排移动的初始友军按 movingOut 判断是否
  // 已被队列排走。敌军始终拦路（规划期不预测敌移）。
  const movingOut = new Set(queue.filter(a => a.type === 'move').map(a => key({ q: a.q, r: a.r })));
  const blockedDest = (p, selfId, units) => {
    for (const other of units ?? myUnits) {
      if (other.id === selfId || other.hp <= 0) continue;
      if (other.q === p.q && other.r === p.r) {
        if (other.fresh) return true;                       // 本轮新部署，落定占位
        if (other.moved) return true;                       // 搜索中已排移动，新格落脚占位
        if (!movingOut.has(key(p))) return true;            // 初始友军且队列未排走，稳占原格
      }
    }
    for (const e of game.units) {
      if (e.alive && e.owner !== owner && e.q === p.q && e.r === p.r) return true;
    }
    return false;
  };

  const curRadius = safeRadiusOf(game, game.turn.roundNumber);
  // 威胁权重随缩圈阶段上升：建造期（第一拍未至）几乎不规避、鼓励接敌抢击杀；
  // 首缩后逐步抬升，最终圈逼命阶段全力保命（存活价值在大逃杀结算里最重）。
  let threatWeight = 0.22;
  const startRound = game.config.annihilation?.artillery?.startRound;
  if (typeof startRound === 'number' && game.turn.roundNumber >= startRound) {
    const shrinkCount = Math.floor((game.turn.roundNumber - startRound) / (game.config.annihilation?.artillery?.intervalRounds || 1)) + 1;
    threatWeight = Math.min(1.1, 0.45 + shrinkCount * 0.22);
  }
  // 逼近激励与威胁权重互补：建造期强逼近（抢中线/接敌），缩圈后期转为保命为主。
  const approachGain = Math.max(1.2, 9 - threatWeight * 7);
  // 接敌驱动力按地图半径自适应：开阔大图（半径大、走廊分散）全力追击，紧凑小图（单格
  // 咽喉）收敛以防过度深入。半径 6→0.35，半径 ≥9→1.0。
  const approachDrive = Math.max(0.35, Math.min(1, (radius - 5) / 4));
  const C = {
    game, owner, balance, specs, inBounds, terrProj, radius,
    myUnits, movesUsed, attacksUsed, supplies, attackLimit: balance.attacksPerUnit ?? 1,
    lockByCell, blockedDest,
    round: game.turn.roundNumber,
    futureRadius: safeRadiusOf(game, game.turn.roundNumber + 1),
    curRadius,
    threatWeight,
    approachGain,
    approachDrive,
    // 初始敌军快照（位置/防御/HP），供位置估值计算「本格可威胁的敌军战力」。
    enemies: game.units.filter(u => u.alive && u.owner !== owner).map(u => ({ q: u.q, r: u.r, hp: u.hp, defense: u.defense })),
    threat: computeThreat(game, owner, specs, inBounds, terrAt),
    pointValue: (game.controlPoints ?? []).map(p => balance.controlPointTypes?.[p.kind]?.income ?? 4),
  };
  return C;
}

/** 据点部署折扣。 */
function cpDiscount(balance, point) {
  return balance.controlPointTypes?.[point?.kind]?.deployDiscount ?? 0;
}

/** 单位性价比：每点费用的存活输出/机动综合值，用于部署选型（避免全爆昂贵重装被风筝）。 */
function unitEfficiency(spec) {
  const dmg = Math.max(1, spec.attack - (spec.defense ?? 0) * 0.5);
  const reach = (spec.attackRange ?? 1) + (spec.moveRange ?? 1) * 0.4;
  const hp = spec.hp ?? 1;
  return ((dmg * reach + hp * 0.3) / Math.max(1, spec.cost)) * (spec.canCapture ? 1.1 : 1);
}

/** 与引擎 safeRadius 一致的安全半径。 */
function safeRadiusOf(game, round) {
  const art = game.config.annihilation?.artillery;
  if (!art || !['royale', 'annihilation'].includes(game.config.mode)) return Infinity;
  const shrinks = round < art.startRound ? 0 : Math.floor((round - art.startRound) / art.intervalRounds) + 1;
  return Math.max(art.minimumSafeRadius, game.map.radius - shrinks);
}

/** 距最近存活敌人的六角距离（无敌人返回 0，使逼近激励失效）。 */
function nearestEnemyDist(enemies, p) {
  let best = Infinity;
  for (const e of enemies) {
    if (e.hp <= 0) continue;
    const d = hex(p, { q: e.ref.q, r: e.ref.r });
    if (d < best) best = d;
  }
  return best === Infinity ? 0 : best;
}

/** 单位限步数内可到达的坐标集（引擎 planningReachableCells 口径）。 */
function reachable(C, from, range) {
  const result = new Map();
  if (range <= 0) return result;
  const queue = [{ q: from.q, r: from.r, d: 0 }];
  result.set(key(from), { q: from.q, r: from.r, d: 0 });
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    if (cur.d >= range) continue;
    for (const [dq, dr] of DIRS) {
      const q = cur.q + dq, r = cur.r + dr;
      const k = key({ q, r });
      if (result.has(k)) continue;
      if (!C.inBounds(q, r)) continue;
      if (C.terrProj(q, r) !== 'plain') continue;
      const node = { q, r, d: cur.d + 1 };
      result.set(k, node);
      queue.push(node);
    }
  }
  return result;
}

/**
 * 敌方威胁场：每格累计敌方「下一拍」可达攻击的原始火力（按移动+射程真实可达范围、
 * 锁定权重）。位置无关（敌人位置在本方规划期不变），评估时按受击方实际防御折算。
 */
function computeThreat(game, owner, specs, inBounds, terrAt) {
  const threat = new Map();
  const add = (q, r, v) => { const k = key({ q, r }); threat.set(k, (threat.get(k) ?? 0) + v); };
  for (const unit of game.units) {
    if (!unit.alive || unit.owner === owner) continue;
    const spec = specs[unit.type];
    const weight = spec?.attackLock ? 0.95 : 0.7;
    const shape = spec?.attackShape;
    const reach = reachCoords(game, unit, inBounds, terrAt);
    for (const c of reach) {
      const cells = [];
      if (shape?.type === 'arc') {
        for (const [dq, dr] of DIRS) cells.push({ q: c.q + dq, r: c.r + dr });
      } else if (shape?.type === 'line') {
        const length = Math.min(shape.length ?? 2, unit.attackRange);
        for (const [dq, dr] of DIRS) {
          for (let n = 1; n <= length; n++) cells.push({ q: c.q + dq * n, r: c.r + dr * n });
        }
      } else {
        for (const [dq, dr] of DIRS) cells.push({ q: c.q + dq, r: c.r + dr });
        if (unit.attackRange > 1) {
          for (let dq = -unit.attackRange; dq <= unit.attackRange; dq++) {
            for (let dr = -unit.attackRange; dr <= unit.attackRange; dr++) {
              const q = c.q + dq, r = c.r + dr;
              if (hex({ q: c.q, r: c.r }, { q, r }) <= unit.attackRange && (dq || dr)) cells.push({ q, r });
            }
          }
        }
      }
      for (const t of cells) if (inBounds(t.q, t.r)) add(t.q, t.r, unit.attack * weight);
    }
  }
  return threat;
}

/** 敌单位本轮可达坐标（忽略占位，只按地形）。 */
function reachCoords(game, unit, inBounds, terrAt) {
  const inB = (q, r) => Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= game.map.radius && inBounds(q, r);
  const ok = new Map([[key(unit), { q: unit.q, r: unit.r, d: 0 }]]);
  const queue = [{ q: unit.q, r: unit.r, d: 0 }];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    if (cur.d >= unit.moveRange) continue;
    for (const [dq, dr] of DIRS) {
      const q = cur.q + dq, r = cur.r + dr, k = key({ q, r });
      if (ok.has(k)) continue;
      if (!inB(q, r)) continue;
      if (terrAt(q, r) !== 'plain') continue;
      const node = { q, r, d: cur.d + 1 };
      ok.set(k, node);
      queue.push(node);
    }
  }
  return [...ok.values()].map(v => ({ q: v.q, r: v.r }));
}

/** 单位位于某坐标的位置贡献：存活价值 − 炮火风险 − 威胁暴露 + 占点前景。 */
function unitValueAt(C, unit, p, hp) {
  const frac = Math.max(0, Math.min(1, hp / unit.maxHp));
  let value = unit.cost * (0.4 + 0.6 * frac);
  if (hex(p, { q: 0, r: 0 }) > C.curRadius) value -= unit.cost * 0.95;
  else if (hex(p, { q: 0, r: 0 }) > C.futureRadius) value -= unit.cost * 0.22;
  // 威胁暴露：按实际防御折算期望伤害、集火上限到 HP。大逃杀以存活为纲，避免走进
  // 会被集火的格子；致死暴露（打到剩余 HP 很低）额外重罚，强化残存单位保命走位。
  const raw = C.threat.get(key(p)) ?? 0;
  const variance = C.balance.damageVarianceRange ?? 0;
  const minD = C.balance.minimumDamage ?? 1;
  const incoming = Math.min(hp, Math.max(minD, raw - unit.defense - variance));
  const exposure = incoming / Math.max(1, hp);
  value -= C.threatWeight * Math.min(unit.cost * 0.9, incoming * frac * 0.8);
  value -= unit.cost * 0.5 * C.threatWeight * exposure * exposure;
  // 进攻覆盖奖励：本格能威胁到的敌军战力折算为正向价值。只罚「被威胁」不奖「威胁人」
  // 会让贴脸输出净亏分、永远停在敌方射程外沿；这一项须明显盖过威胁惩罚，搜索才敢推进到
  // 攻击位（重装/步兵需贴脸 range1-2）并真正发起攻击。
  if (unit.attack > 0) {
    const range = unit.attackRange ?? 1;
    for (const e of C.enemies) {
      if (e.hp <= 0) continue;
      const d = hex(p, { q: e.q, r: e.r });
      if (d >= 1 && d <= range) {
        const dmg = Math.max(1, unit.attack - e.defense - variance);
        value += Math.min(e.hp, dmg) * 2.0;
        // 攻击位硬奖励：占据能打到敌人的格子本身就值一份成本比例分，确保「敢推进到攻击位」
        // 压过威胁规避的保守倾向（否则单位永远停在敌方射程外沿、全程零攻击）。
        value += unit.cost * 0.6;
        break;
      }
    }
  }
  if (unit.canCapture) {
    for (const cp of C.game.controlPoints ?? []) {
      if (cp.owner === C.owner) continue;
      const d = hex(p, cp);
      if (d === 0) value += CAPTURE_BONUS + C.pointValue[C.game.controlPoints.indexOf(cp)];
      else if (d <= unit.moveRange) value += 6;
    }
  }
  // 抱团协同：靠近友军加分（集中火力、互相掩护），孤立无援则罚分。避免单兵突进被逐个
  // 点掉——大逃杀里落单的单位是对方集火的首选目标。
  let allies = 0;
  for (const a of C.myUnits) {
    if (a.id === unit.id || a.hp <= 0) continue;
    const d = hex(p, { q: a.q, r: a.r });
    if (d === 1) allies += 1;
    else if (d === 2) allies += 0.5;
  }
  value += Math.min(allies, 2) * unit.cost * 0.04;
  if (allies === 0) value -= unit.cost * 0.1;
  // 接敌梯度：靠近最近敌人给单调奖励，让近战单位（range1-2）在抵达攻击位之前就有持续
  // 向前的动力，否则会在敌方射程外沿徘徊不前（尤其大地图长走廊）。
  let nearest = Infinity;
  for (const e of C.enemies) {
    if (e.hp <= 0) continue;
    const d = hex(p, { q: e.q, r: e.r });
    if (d < nearest) nearest = d;
  }
  if (nearest < Infinity) {
    // 接敌梯度按地图尺寸自适应：开阔大图（走廊分散）需强梯度追击远程风筝；紧凑小图
    // （单格咽喉）饱和，避免怂恿单位越过攻击位扎进敌方火力中心被集火。
    const drive = C.approachDrive;
    if (drive >= 1) value += unit.cost * 0.12 * Math.max(0, 8 - nearest);
    else {
      const reach = (unit.attackRange ?? 1) + (unit.moveRange ?? 1);
      value += unit.cost * 0.12 * Math.max(0, 8 - nearest) * Math.min(1, Math.max(0, nearest - (unit.attackRange ?? 1)) / Math.max(1, reach)) * drive + unit.cost * 0.05 * Math.max(0, 8 - nearest) * (1 - drive);
    }
  }
  return value;
}

/** 己方全体位置价值 + 据点续持（终局评估）。 */
function positionValue(C, myState) {
  let value = 0;
  for (const u of myState) {
    if (u.hp <= 0) continue;
    value += unitValueAt(C, u, { q: u.q, r: u.r }, u.hp);
  }
  for (const cp of C.game.controlPoints ?? []) {
    if (cp.owner !== C.owner) continue;
    if (C.balance.controlPointTypes?.[cp.kind]?.canDeploy !== false) value += POINT_HOLD;
    value += C.pointValue[C.game.controlPoints.indexOf(cp)] * 0.6;
  }
  return value;
}

/** 期望伤害（离散均匀分布均值，含最低伤害与防御）。 */
function expectedDamage(C, unit, targetDefense) {
  const variance = C.balance.damageVarianceRange ?? 0;
  const minD = C.balance.minimumDamage ?? 1;
  const width = 2 * variance + 1;
  let sum = 0;
  for (let roll = 0; roll < width; roll++) {
    sum += Math.max(minD, unit.attack - targetDefense + roll - variance);
  }
  return sum / width;
}

/** 形状覆盖格（single/line/arc），与引擎 coveredCellsFor 同口径。 */
function coverShape(C, from, unit, target, distance) {
  const shape = C.specs[unit.type]?.attackShape;
  if (!shape || !['line', 'arc'].includes(shape.type)) return distance === 0 ? [] : [target];
  if (shape.type === 'arc') {
    if (distance !== 1) return [];
    const dq = target.q - from.q, dr = target.r - from.r;
    const dir = DIRS.findIndex(([q, r]) => q * distance === dq && r * distance === dr);
    if (dir < 0) return [];
    return [(dir + 5) % 6, dir, (dir + 1) % 6].map(d => ({ q: from.q + DIRS[d][0], r: from.r + DIRS[d][1] }));
  }
  const length = Math.min(shape.length ?? 2, unit.attackRange);
  if (distance > length) return [];
  const dq = target.q - from.q, dr = target.r - from.r;
  const dir = DIRS.findIndex(([q, r]) => q * distance === dq && r * distance === dr);
  if (dir < 0) return [];
  const result = [];
  for (let n = 1; n <= length; n++) result.push({ q: from.q + DIRS[dir][0] * n, r: from.r + DIRS[dir][1] * n });
  return result;
}

/**
 * 束搜索：逐行动点扩展动作序列，每层保留 BEAM_WIDTH 条最优。
 * 状态：己方单位（HP/位置/移次/攻次）、敌军 HP、补给、累计收益、投影地形覆盖。
 */
function search(game, C) {
  const t0 = Date.now();
  const ap = C.balance.actionsPerTurn ?? 5;
  const enemies0 = game.units.filter(u => u.alive && u.owner !== C.owner).map(u => ({ ref: u, hp: u.hp }));

  let beam = [{
    units: C.myUnits.map(u => ({ ...u, moves: C.movesUsed.get(u.id) ?? 0, attacks: C.attacksUsed.get(u.id) ?? 0 })),
    enemies: enemies0,
    supplies: C.supplies,
    vt: new Map(),
    gain: 0,
    actions: [],
  }];

  for (let depth = 0; depth < ap; depth++) {
    if (Date.now() - t0 > TIME_BUDGET_MS) break;
    const candidates = [];
    for (const node of beam) {
      expand(game, C, node, candidates, t0);
      if (Date.now() - t0 > TIME_BUDGET_MS) break;
    }
    if (!candidates.length) break;
    candidates.sort((a, b) => b.score - a.score);
    beam = candidates.slice(0, BEAM_WIDTH);
  }

  // 终局评估：累计收益 + 收官位置价值。束内每个候选的动作数相同（同一层），
  // 直接比较总量即可；跨层由逐层扩展的 score（累计收益）保证单调不减。
  let best = null;
  for (const node of beam) {
    const total = node.gain + positionValue(C, node.units);
    if (!best || total > best.total) best = { total, actions: node.actions };
  }
  if (!best || !best.actions.length) return null;
  best.actions = sanitizeActions(game, C, best.actions);
  return best.actions.length ? best : null;
}

/**
 * 逐步合法性重放：引擎按行动点（步）结算，每步「先离场后进场」，同一步两个落点冲突则
 * 双双失败，且某单位某步硬失败后其后续动作作废。束搜索按「整轮终局」判占位，会把「前一步
 * 已腾出的格」误判为占用而排出 destination_occupied。这里按步原子解析，剔除非法/冲突动作。
 */
function sanitizeActions(game, C, actions) {
  // 单位当前位置（己方含队列投影起点；敌军按当前快照，规划期不动）。
  const pos = new Map();
  for (const u of C.myUnits) pos.set(u.id, { q: u.q, r: u.r });
  for (const e of game.units) {
    if (e.alive && e.owner !== C.owner) pos.set(e.id, { q: e.q, r: e.r });
  }
  const dead = new Set();      // 本轮硬失败的单位，其后动作作废
  const out = [];
  // 敌军 HP 跟踪：集火时前序攻击若已击杀目标，后续攻击会落空（unit_gone）浪费行动点，
  // 这里按期望伤害扣减 HP，剔除攻击已死目标的动作。
  const enemyHp = new Map();
  for (const e of game.units) {
    if (e.alive && e.owner !== C.owner) enemyHp.set(key(e), e.hp);
  }

  // 队列顺序即行动步：每个 action 是一步，逐步结算（先离场后进场）。
  for (const a of actions) {
    const uid = a.unitId;
    if (uid && dead.has(uid)) continue;
    if (a.type === 'move') {
      const k = key(a.to);
      // 目标格被其他单位占据（敌军或未离场的友军）→ 硬失败，该单位后续动作作废。
      const blocked = [...pos.entries()].some(([id, at]) => id !== uid && at.q === a.to.q && at.r === a.to.r);
      if (blocked) { if (uid) dead.add(uid); continue; }
      out.push(a);
      pos.set(uid, { q: a.to.q, r: a.to.r });
    } else if (a.type === 'deploy') {
      const k = key(a.to);
      if ([...pos.values()].some(at => at.q === a.to.q && at.r === a.to.r)) continue;
      out.push(a);
      pos.set(`__dep_${out.length}`, { q: a.to.q, r: a.to.r });
    } else if (a.type === 'attack') {
      // 目标格敌军若已被己方前序攻击打死，本攻击落空，剔除（不连坐单位，攻击不改变占位）。
      const tk = key(a.to);
      if (enemyHp.has(tk)) {
        if ((enemyHp.get(tk) ?? 0) <= 0) continue;
        const attacker = C.myUnits.find(u => u.id === uid);
        if (attacker) {
          const target = game.units.find(e => e.alive && e.owner !== C.owner && e.q === a.to.q && e.r === a.to.r);
          if (target) enemyHp.set(tk, (enemyHp.get(tk) ?? 0) - expectedDamage(C, attacker, target.defense));
        }
      }
      out.push(a);
    } else {
      // heal/demolish 不改变占位，直接保留。
      out.push(a);
    }
  }
  return out;
}

/** 扩展一个节点的所有合法后继动作。 */
function expand(game, C, node, out, t0) {
  const basePos = positionValue(C, node.units);
  for (const unit of node.units) {
    if (unit.hp <= 0) continue;
    const from = { q: unit.q, r: unit.r };
    const before = unitValueAt(C, unit, from, unit.hp);

    // 攻击
    if (!unit.fresh && unit.attacks < C.attackLimit) {
      for (const e of node.enemies) {
        if (e.hp <= 0) continue;
        const target = { q: e.ref.q, r: e.ref.r };
        const distance = hex(from, target);
        if (distance > unit.attackRange || distance === 0 && unit.attackRange === 0) continue;
        // 锁定兵种只能打初始在该格的敌军
        if (C.specs[unit.type]?.attackLock) {
          const initial = C.lockByCell.get(key(target));
          if (!initial || initial.id !== e.ref.id) continue;
        }
        const covered = coverShape(C, from, unit, target, distance);
        if (!covered.length) continue;
        const targets = covered.some(c => c.q === target.q && c.r === target.r) ? [e] : [];
        // 非锁定形状可能覆盖到其他敌军
        for (const other of node.enemies) {
          if (other === e || other.hp <= 0) continue;
          if (covered.some(c => c.q === other.ref.q && c.r === other.ref.r)) targets.push(other);
        }
        if (!targets.length) continue;
        let gain = 0, anyAlive = false;
        for (const t of targets) {
          const dmg = expectedDamage(C, unit, t.ref.defense);
          if (t.hp - dmg <= 0) gain += t.ref.cost * 1.4 + dmg * 0.5;
          else {
            // 集火斩杀：目标已残血（再吃 1-2 下即死）时额外加权，鼓励集中火力收人头，
            // 而非把伤害平摊给满血单位（收割者银行全额成本，是真正的胜负手）。
            const wounded = 1 - t.hp / t.ref.maxHp;
            gain += dmg * 0.5 + dmg * wounded * 1.2;
            anyAlive = true;
          }
        }
        // 还击惩罚：非全灭时攻击方原地会吃到敌方下一拍火力（按阶段威胁权重折算）
        if (anyAlive) {
          const variance = C.balance.damageVarianceRange ?? 0;
          const minD = C.balance.minimumDamage ?? 1;
          const raw = C.threat.get(key(from)) ?? 0;
          gain -= C.threatWeight * Math.min(unit.hp, Math.max(minD, raw - unit.defense - variance)) * 0.6;
        }
        if (gain <= 0.5) continue;
        const nu = node.units.map(x => x === unit ? { ...x, attacks: x.attacks + 1 } : x);
        const ne = node.enemies.map(x => {
          if (x.hp <= 0) return x;
          const hit = targets.find(t => t === x);
          if (!hit) return x;
          return { ...x, hp: Math.max(0, x.hp - expectedDamage(C, unit, x.ref.defense)) };
        });
        out.push({
          units: nu, enemies: ne, supplies: node.supplies, vt: node.vt,
          gain: node.gain + gain, actions: [...node.actions, { type: 'attack', unitId: unit.id, to: target }],
          score: node.gain + gain + basePos - before,
        });
      }
    }

    // 移动
    if (!unit.fresh && unit.moves < unit.moveRange) {
      const reach = reachable(C, from, unit.moveRange - unit.moves);
      for (const node2 of reach.values()) {
        if (node2.q === from.q && node2.r === from.r) continue;
        const to = { q: node2.q, r: node2.r };
        if (C.blockedDest(to, unit.id, node.units)) continue;
        const posDelta = unitValueAt(C, unit, to, unit.hp) - before;
        // 逼近激励：靠近最近敌人给正向奖励，抵消威胁规避的保守倾向，驱动主动接敌。
        const before2 = nearestEnemyDist(node.enemies, from);
        const after2 = nearestEnemyDist(node.enemies, to);
        const approach = (before2 - after2) * C.approachGain;
        const gain = posDelta + approach + captureDelta(C, unit, from, to);
        if (gain <= 0.2 && node.gain <= 0) continue;
        const nu = node.units.map(x => x === unit ? { ...x, q: to.q, r: to.r, moves: x.moves + 1, moved: true } : x);
        out.push({
          units: nu, enemies: node.enemies, supplies: node.supplies, vt: node.vt,
          gain: node.gain + gain, actions: [...node.actions, { type: 'move', unitId: unit.id, to }],
          score: node.gain + gain + basePos,
        });
      }
    }

    // 治疗（支援）
    if (!unit.fresh && unit.type === 'support' && (C.specs.support?.healPower ?? 0) > 0) {
      const power = C.specs.support.healPower;
      for (const ally of node.units) {
        if (ally.hp <= 0 || ally.fresh || ally.hp >= ally.maxHp) continue;
        const target = { q: ally.q, r: ally.r };
        const heal = healAmount(C, unit, from, target, node.units);
        if (heal <= 0) continue;
        const healed = node.units.map(x => x === ally ? { ...x, hp: Math.min(x.maxHp, x.hp + heal) } : x);
        const gain = heal * 0.35;
        out.push({
          units: healed, enemies: node.enemies, supplies: node.supplies, vt: node.vt,
          gain: node.gain + gain, actions: [...node.actions, { type: 'heal', unitId: unit.id, to: target }],
          score: node.gain + gain + positionValue(C, healed) - basePos,
        });
      }
    }

    // 爆破（重装，计划期只校验重装+相邻+障碍地形）
    if (!unit.fresh && unit.type === 'heavy') {
      for (const [dq, dr] of DIRS) {
        const q = from.q + dq, r = from.r + dr;
        if (!C.inBounds(q, r)) continue;
        if (C.terrProj(q, r) !== 'blocker') continue;
        if (node.vt.get(key({ q, r })) === 'plain') continue;
        const vt = new Map(node.vt); vt.set(key({ q, r }), 'plain');
        out.push({
          units: node.units, enemies: node.enemies, supplies: node.supplies, vt,
          gain: node.gain + 6, actions: [...node.actions, { type: 'demolish', unitId: unit.id, to: { q, r } }],
          score: node.gain + 6 + basePos,
        });
      }
    }
  }

  // 部署
  deployExpand(game, C, node, out, basePos);
}

/** 治疗量（支援 arc 形状，覆盖友军）。 */
function healAmount(C, unit, from, target, units) {
  const shape = C.specs.support?.healShape;
  const distance = hex(from, target);
  const range = C.specs.support?.healRange ?? unit.attackRange;
  if (distance > range) return 0;
  let covered;
  if (!shape || !['line', 'arc'].includes(shape.type)) covered = [target];
  else if (shape.type === 'arc') {
    if (distance !== 1) return 0;
    const dq = target.q - from.q, dr = target.r - from.r;
    const dir = DIRS.findIndex(([q, r]) => q * distance === dq && r * distance === dr);
    if (dir < 0) return 0;
    covered = [(dir + 5) % 6, dir, (dir + 1) % 6].map(d => ({ q: from.q + DIRS[d][0], r: from.r + DIRS[d][1] }));
  } else {
    const length = Math.min(shape.length ?? 2, range);
    if (distance > length) return 0;
    const dq = target.q - from.q, dr = target.r - from.r;
    const dir = DIRS.findIndex(([q, r]) => q * distance === dq && r * distance === dr);
    if (dir < 0) return 0;
    covered = [];
    for (let n = 1; n <= length; n++) covered.push({ q: from.q + DIRS[dir][0] * n, r: from.r + DIRS[dir][1] * n });
  }
  const power = C.specs.support?.healPower ?? 0;
  let heal = 0;
  for (const c of covered) {
    for (const u of units) {
      if (u.hp <= 0 || u.fresh) continue;
      if (u.q === c.q && u.r === c.r && u.hp < u.maxHp) heal += Math.min(u.maxHp - u.hp, power);
    }
  }
  return heal;
}

/** 移动前后的占点增量。 */
function captureDelta(C, unit, from, to) {
  if (!unit.canCapture) return 0;
  let delta = 0;
  for (const cp of C.game.controlPoints ?? []) {
    if (cp.owner === C.owner) continue;
    const w = CAPTURE_BONUS + C.pointValue[C.game.controlPoints.indexOf(cp)];
    const onTo = to.q === cp.q && to.r === cp.r;
    const onFrom = from.q === cp.q && from.r === cp.r;
    if (onTo && !onFrom) delta += w;
    else if (onFrom && !onTo) delta -= w;
  }
  return delta;
}

/** 部署扩展：零兵力生存优先，否则按增援价值减成本竞价（军队越大边际越低）。 */
function deployExpand(game, C, node, out, basePos) {
  // 现有作战兵力（不含本轮新部署）：军队越大，增援边际收益越低；并设相对敌人的规模上限。
  const army = node.units.filter(u => u.hp > 0 && !u.fresh).length;
  const enemyArmy = node.enemies.filter(u => u.hp > 0).length;
  const noArmy = army === 0;
  const capacity = 1 / (1 + 0.12 * army);
  const overCap = army >= enemyArmy + 3; // 兵力领先 3 个即停止扩张，转运营/进攻
  const maxEff = Math.max(...Object.values(C.specs).map(unitEfficiency));
  for (const cp of C.game.controlPoints ?? []) {
    if (cp.owner !== C.owner) continue;
    const spec0 = C.balance.controlPointTypes?.[cp.kind];
    if (spec0?.canDeploy === false) continue;
    if (hex(cp, { q: 0, r: 0 }) > C.curRadius) continue;
    const discount = cpDiscount(C.balance, cp);
    for (const unitType of Object.keys(C.specs)) {
      const spec = C.specs[unitType];
      const price = Math.max(0, spec.cost - discount);
      if (price > node.supplies) continue;
      for (const [dq, dr] of DIRS) {
        const q = cp.q + dq, r = cp.r + dr;
        if (!C.inBounds(q, r)) continue;
        if (C.terrProj(q, r) !== 'plain') continue;
        if (hex({ q, r }, { q: 0, r: 0 }) > C.curRadius) continue;
        // 落点不能被现有单位或本轮已部署新单位占据（否则结算 destination_occupied）。
        if (C.blockedDest({ q, r }, null, node.units)) continue;
        if (overCap) continue;
        const threat = C.threat.get(key({ q, r })) ?? 0;
        // 部署净值 = 本征单位价值 × 性价比因子 × 威胁折损 × 军队容量。性价比（放大）让部署
        // 强烈偏向每点费用战力更高的兵种（远程步兵/ranger），避免全爆昂贵近战重装被远程风筝；
        // 容量与威胁抑制无脑爆兵。
        const eff = unitEfficiency(spec) / maxEff;
        const intrinsic0 = spec.cost * (1 - Math.min(0.9, threat * 0.55 / spec.cost)) * Math.pow(eff, 3);
        let intrinsic = intrinsic0;
        if (hex({ q, r }, { q: 0, r: 0 }) > C.futureRadius) intrinsic -= spec.cost * 0.22;
        const net = noArmy ? intrinsic * 10 : intrinsic * capacity - price * 0.15;
        if (net <= 0.5) continue;
        const nu = [...node.units, { id: `__dep${node.units.length}`, owner: C.owner, type: unitType, q, r, hp: spec.hp, maxHp: spec.hp, defense: spec.defense, cost: spec.cost, moveRange: spec.moveRange, attackRange: spec.attackRange, canCapture: spec.canCapture, fresh: true, moves: 0, attacks: 0 }];
        out.push({
          units: nu, enemies: node.enemies, supplies: node.supplies - price, vt: node.vt,
          gain: node.gain + net, actions: [...node.actions, { type: 'deploy', unitType, fromId: cp.id, to: { q, r } }],
          score: node.gain + net + basePos,
        });
      }
    }
  }
}
