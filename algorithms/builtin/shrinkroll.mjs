// algorithms/builtin/shrinkroll.mjs
//
// 缩圈推演算法（shrinkroll = shrink 缩圈 + rollout 推演，注册名 shrinkroll）——歼灭模式的强算法。
//
// 设计来源：`temp/` 下的开发规格（历史文件名沿用旧算法名，未改名）。核心是三层：
//   1. 规则镜像（±§2）：BFS 可达、AP 记在单位激活、伤害/治疗的期望值、部署折扣、
//      爆破改地形、回合结束的占领/收入/维修、轮界炮火与淘汰、裁决分公式。
//      镜像只做决策与预检，不做状态回放；与引擎的一致性由 tests/algorithms/shrinkroll-mirror 对拍。
//   2. 回合内束搜索（§4）：候选 = 攻击 / 移动 / 移动+攻击 / 治疗 / 爆破 / 部署 / 结束回合，
//      每单位按上限剪枝；动作按引擎顺序施加，AP 预算门控（新激活才扣 AP，已激活单位免费跟进）。
//   3. 评估（§5）：用本局 adjudicationWeights 的裁决分（军力按存活率折价）算「我 - 最强对手」，
//      再扣炮火期望损失、暴露风险与空过回合罚项；跨回合对决赛圈做对手贪心 rollout。
//
// 合法性保险（§3.3）：返回动作前用同一套镜像再跑 assertLegal，失败顺位下一候选，全失败返回 null。
// 确定性：不调用 Math.random；候选排序全部用显式 tie-break（不会随对象遍历顺序漂移）。
// 环境变量（ACE_*）只用于离线消融/调参：默认值即规格实现；ACE_ABLATE 只削弱评估/搜索，不影响合法性。

const HEX_DIRS = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

function envRaw(name) {
  return typeof process !== 'undefined' ? process.env?.[name] : undefined;
}

function envNumber(name, fallback) {
  const raw = envRaw(name);
  const value = raw === undefined || raw === '' ? Number.NaN : Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

const ACE = {
  beam: Math.max(1, Math.floor(envNumber('ACE_BEAM', 6))),
  rolloutH: Math.max(0, Math.floor(envNumber('ACE_ROLLOUT_H', 1))),
  attackCands: Math.max(1, Math.floor(envNumber('ACE_ATTACK_CANDS', 4))),
  moveCands: Math.max(1, Math.floor(envNumber('ACE_MOVE_CANDS', 5))),
  moveAttackCands: Math.max(0, Math.floor(envNumber('ACE_MOVE_ATTACK_CANDS', 3))),
  deployCands: Math.max(1, Math.floor(envNumber('ACE_DEPLOY_CANDS', 4))),
  healCands: Math.max(1, Math.floor(envNumber('ACE_HEAL_CANDS', 2))),
  tau: Math.max(1, envNumber('ACE_TAU', 150)),
  /** 对手回合风险系数 β（§5.2 的 β_risk）：风险按「被打死的概率 × 单位价值」离散计价。风险项的口径是
   *  「对手一个回合内打死它」（`multiHitKillProbability`，`actionsPerTurn` 刀），不是单刀——所以系数比
   *  连续折价式的规格值 0.6 小一个量级。两人局按 0.1 标定。 */
  betaRisk: Math.max(0, envNumber('ACE_BETA', 0.1)),
  /** 3 人以上的风险系数：多人局每个对手各算一次「回合内打死」、再按 `1−Π(1−p)` 合成，同一个系数的
   *  边际惩罚随对手数放大（实测同样 0.1 时两人局 100%/99.2%、3 人局只有 81.7%），所以另起一档。 */
  betaFfa: Math.max(0, envNumber('ACE_BETA_FFA', 0.2)),
  /** 补给影子价（裁决权重 w_sup 在歼灭图恒为 0，会让"部署换军力"变成免费收益）。 */
  supplyShadow: Math.max(0, envNumber('ACE_SUPPLY_SHADOW', 1.6)),
  /** 3 人以上局里「次席」在对手项里的权重（0 = 只看领先者；两人局恒等价）。 */
  ffaRival: Math.max(0, envNumber('ACE_FFA_RIVAL', 0.5)),
  /** 炮火前瞻轮数 K：投影未来 K 轮的安全半径，计"接下来会挨几轮 tick"（0 = 关闭，回退到只看当前圈）。 */
  artHorizon: Math.max(0, Math.floor(envNumber('ACE_ART_K', 3))),
  /** 前瞻罚项的权重：1 = 把未来每轮 tick 全额计价（会导致提前抢圈、放掉输出机会）。 */
  artWeight: Math.max(0, envNumber('ACE_ART_W', 0.4)),
  /** 终局安全半径 ≤1 时，"站在最终安全格上"的显式正向项系数（0 = 关闭）。 */
  artFinalBonus: Math.max(0, envNumber('ACE_ART_FINAL', 0.25)),
  /** 裁决投影视界：离回合上限不足这么多轮时，据点流量与裁决分按当前趋势投影。 */
  adjudicationHorizon: Math.max(0, Math.floor(envNumber('ACE_ADJ_H', 3))),
  /** 是否建模"打到回合上限按裁决收场"（0 = 回退到 v2 行为：搜索看不见裁决终局）。 */
  turnLimit: envNumber('ACE_TURN_LIMIT', 1) > 0,
};

const ABLATE = new Set(
  String(envRaw('ACE_ABLATE') ?? '')
    .split(',')
    .map(part => part.trim())
    .filter(Boolean),
);
const ablated = flag => ABLATE.has(flag);

const keyOf = (q, r) => `${q},${r}`;
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
/** 候选 tie-break：按 UTF-16 码元比较。localeCompare 会随 ICU/locale 漂，破坏"内容确定"。 */
const compareTie = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function hexDistance(a, b) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(-a.q - a.r - (-b.q - b.r)));
}

function neighbors(q, r) {
  return HEX_DIRS.map(d => ({ q: q + d.q, r: r + d.r }));
}

// ---------------------------------------------------------------- 期望值

function expDamage(state, attack, defense) {
  const balance = state.config.balance;
  const range = Math.max(0, Math.floor(balance.damageVarianceRange ?? 0));
  const minimum = balance.minimumDamage ?? 0;
  let sum = 0;
  for (let roll = -range; roll <= range; roll++) {
    sum += Math.max(minimum, attack - defense + roll);
  }
  return sum / (2 * range + 1);
}

/**
 * P(**一次**攻击打死 hp 血目标)：单刀口径，闭式 O(2R+1)。
 *
 * 这里必须是一刀的概率：调用方问的是「对手这一刀/我这一刀能不能打死它」
 * （`deathRiskPenalty` 的 P_expose、攻击与移动攻击候选的斩杀价值）。
 *
 * 历史实现用逐点伤害 DP 叠了最多 8 刀，且**每轮丢掉吸收态**（`dp[maxHp]` 的已击杀质量不再续传），
 * 于是返回的是「恰好第 g 刀打死」而不是「一刀打死」：22 血的目标一刀砍死概率真实 0.571，旧实现给 0.000；
 * 26 血一刀砍不死（真实 0.000），旧实现叠 8 刀给 1.000。方向正好相反——死亡风险项在「一刀就死」的
 * 残血区间完全不罚、在满血反而罚满，与 §5.2 的语义相反。
 */
function killProbability(state, attack, defense, hp) {
  const balance = state.config.balance;
  const range = Math.max(0, Math.floor(balance.damageVarianceRange ?? 0));
  const minimum = balance.minimumDamage ?? 0;
  const threshold = Math.ceil(hp);
  if (threshold <= 0) return 1;
  let hits = 0;
  for (let roll = -range; roll <= range; roll++) {
    if (Math.max(minimum, attack - defense + roll) >= threshold) hits += 1;
  }
  return hits / (2 * range + 1);
}

/**
 * P(在 `attacks` 次攻击内打死 hp 血目标)：吸收态 DP，O(attacks·hp·(2R+1))。
 *
 * 这是「对手一个回合能打几刀」的口径，只给 `deathRiskPenalty` 用（`killProbability` 仍是严格单刀）。
 * 与 §5.2 的差别要分清：**单刀概率**决定「这一刀能不能收割」，**回合内概率**才决定「残血单位敢不敢留在
 * 敌人射程里」。曾经用一个"最多 8 刀但每轮丢掉吸收态"的 DP 同时算这两件事，两个口径都错
 * （见 `killProbability` 的注释），而 3 人局的对手风险项正是命门（`ACE_BETA=0` 时第一名率崩到 51.7%）。
 */
function multiHitKillProbability(state, attack, defense, hp, attacks) {
  const balance = state.config.balance;
  const range = Math.max(0, Math.floor(balance.damageVarianceRange ?? 0));
  const minimum = balance.minimumDamage ?? 0;
  const maxHp = Math.ceil(hp);
  if (maxHp <= 0) return 1;
  const budget = Math.max(0, Math.floor(attacks));
  if (budget <= 0) return 0;
  const denom = 2 * range + 1;
  const lowest = Math.max(minimum, attack - defense - range);
  const highest = Math.max(minimum, attack - defense) + range;
  // 全中最高伤害也打不死 → 0；全中最低伤害也够打死 → 1（便宜的先判掉，避免为显然的事跑 DP）。
  if (highest * budget < maxHp) return 0;
  if (lowest * budget >= maxHp) return 1;
  const damage = [];
  for (let roll = -range; roll <= range; roll++) damage.push(Math.max(minimum, attack - defense + roll));
  let dp = new Float64Array(maxHp + 1);
  dp[0] = 1;
  for (let guard = 0; guard < budget; guard++) {
    const next = new Float64Array(maxHp + 1);
    // 吸收态：已经打死的质量必须续传，否则算出来是「恰好第 g 刀打死」而不是「g 刀内打死」。
    next[maxHp] = dp[maxHp];
    for (let done = 0; done < maxHp; done++) {
      const p = dp[done];
      if (p <= 0) continue;
      for (const dmg of damage) {
        const total = done + dmg;
        if (total >= maxHp) next[maxHp] += p / denom;
        else next[total] += p / denom;
      }
    }
    dp = next;
    if (dp[maxHp] >= 0.999999) break;
  }
  return clamp(dp[maxHp], 0, 1);
}

function expHeal(state, support) {
  const base = support.healPower ?? 0;
  const variance = Math.max(0, Math.floor(state.config.balance.healVarianceRange ?? 0));
  return base + variance / 2;
}

// ---------------------------------------------------------------- 状态构建

function buildState(game, owner) {
  if (!game || game.phase !== 'active') return null;
  const config = game.config;
  if (!config?.units || !config.balance) return null;
  const cells = new Map();
  for (const cell of game.cells || []) {
    cells.set(keyOf(cell.q, cell.r), { q: cell.q, r: cell.r, terrain: cell.terrain });
  }
  for (const cell of game.map?.terrainCells || []) {
    const entry = cells.get(keyOf(cell.q, cell.r));
    if (entry) entry.terrain = cell.terrain;
    else cells.set(keyOf(cell.q, cell.r), { q: cell.q, r: cell.r, terrain: cell.terrain });
  }
  const units = (game.units || [])
    .filter(unit => unit.alive !== false)
    .map(unit => ({
      id: unit.id, owner: unit.owner, type: unit.type,
      q: unit.q, r: unit.r, hp: unit.hp, maxHp: unit.maxHp,
      attack: unit.attack, defense: unit.defense,
      moveRange: unit.moveRange, attackRange: unit.attackRange,
      canCapture: Boolean(unit.canCapture), healPower: unit.healPower,
      cost: unit.cost ?? config.units[unit.type]?.cost ?? 0,
      hasMoved: Boolean(unit.hasMoved), hasActed: Boolean(unit.hasActed),
      actionSpent: Boolean(unit.actionSpent), alive: true,
    }));
  const status = {};
  const killValue = {};
  for (const [id, player] of Object.entries(game.players || {})) {
    status[id] = player?.status ?? 'active';
    killValue[id] = player?.stats?.killValue ?? 0;
  }
  const supplies = {};
  for (const [id, res] of Object.entries(game.resources || {})) supplies[id] = res?.supplies ?? 0;
  const cps = (game.controlPoints || []).map(cp => ({
    id: cp.id, q: cp.q, r: cp.r, kind: cp.kind, owner: cp.owner ?? null,
  }));
  const turn = game.turn || {};
  const order = Array.isArray(turn.turnOrder) ? [...turn.turnOrder] : Object.keys(game.players || {});
  // 据点持有（流量口径）：引擎在每次轮界把「当轮持有数」累加进 stats.controlHold/controlHoldRounds，
  // 裁决分用两者的比值。镜像必须照抄这一对累加器，否则在 controlPoint 权重非 0 的图上等于蒙眼。
  const controlHold = {};
  const holdRounds = {};
  for (const [id, player] of Object.entries(game.players || {})) {
    controlHold[id] = player?.stats?.controlHold ?? 0;
    holdRounds[id] = player?.stats?.controlHoldRounds ?? 0;
  }
  const state = {
    me: owner,
    cells,
    units,
    cps,
    supplies,
    killValue,
    controlHold,
    holdRounds,
    status,
    order,
    current: turn.currentPlayerId ?? owner,
    acted: new Set(turn.actedThisRound ?? []),
    round: turn.roundNumber ?? 1,
    actionsUsed: turn.actionsUsed ?? 0,
    config,
    radius: Number(config.radius ?? game.map?.radius ?? 0),
    artillery: config.annihilation?.artillery ?? null,
    over: false,
    winner: null,
  };
  if (state.current !== owner) return null;
  state.danger = dangerSet(state, state.round);
  state.warning = warningSet(state, state.round);
  return state;
}

function cloneState(state) {
  return {
    ...state,
    cells: state.cells,
    units: state.units.map(unit => ({ ...unit })),
    cps: state.cps.map(cp => ({ ...cp })),
    supplies: { ...state.supplies },
    killValue: { ...state.killValue },
    controlHold: { ...state.controlHold },
    holdRounds: { ...state.holdRounds },
    status: { ...state.status },
    acted: new Set(state.acted),
    danger: state.danger,
    warning: state.warning,
  };
}

function activeSeats(state) {
  return state.order.filter(id => state.status[id] === 'active');
}

function livingUnits(state, owner) {
  return state.units.filter(unit => unit.alive && unit.owner === owner);
}

function occupantMap(state) {
  const map = new Map();
  for (const unit of state.units) {
    if (unit.alive) map.set(keyOf(unit.q, unit.r), unit);
  }
  return map;
}

function unitById(state, id) {
  return state.units.find(unit => unit.id === id && unit.alive) ?? null;
}

/**
 * 候选排序的稳定 tie-break 键：单位 id 是 UUID（每局不同），拿它排序会让「同 seed 两局」
 * 的动作序列分叉。改用「座位 + 兵种 + 坐标 + 创建序号」的 FNV-1a 哈希——同内容同顺序，
 * 但不像字典序那样永远固定偏向某个兵种（固定顺序实测会掉 20pp）。
 */
function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

function unitKeyOf(state, unit) {
  const index = state.units.indexOf(unit);
  return fnv1a(`${unit.owner}:${unit.type}:${unit.q},${unit.r}:${index}`);
}

function targetKeyOf(state, target) {
  return fnv1a(`${target.owner}:${target.type}:${target.q},${target.r}`);
}

function cellAt(state, q, r) {
  return state.cells.get(keyOf(q, r)) ?? null;
}

function isPlain(state, q, r) {
  return cellAt(state, q, r)?.terrain === 'plain';
}

function isInBounds(state, q, r) {
  return state.cells.has(keyOf(q, r));
}

// ---------------------------------------------------------------- 炮火

function shrinkCountFor(artillery, round) {
  if (round < artillery.startRound) return 0;
  return Math.floor((round - artillery.startRound) / Math.max(1, artillery.intervalRounds)) + 1;
}

function safeRadiusFor(state, round) {
  const artillery = state.artillery;
  if (!artillery) return null;
  const shrink = shrinkCountFor(artillery, round);
  return Math.max(artillery.minimumSafeRadius, state.radius - shrink);
}

function dangerSet(state, round) {
  const artillery = state.artillery;
  const set = new Set();
  if (!artillery) return set;
  const safe = safeRadiusFor(state, round);
  for (const cell of state.cells.values()) {
    if (hexDistance(cell, { q: 0, r: 0 }) > safe) set.add(keyOf(cell.q, cell.r));
  }
  return set;
}

function warningSet(state, round) {
  const artillery = state.artillery;
  const set = new Set();
  if (!artillery) return set;
  const safe = safeRadiusFor(state, round);
  const artillerySpec = artillery;
  const nextShrink = safe <= artillerySpec.minimumSafeRadius
    ? null
    : shrinkCountFor(artillerySpec, round) === 0
      ? artillerySpec.startRound
      : artillerySpec.startRound + shrinkCountFor(artillerySpec, round) * Math.max(1, artillerySpec.intervalRounds);
  if (nextShrink === null || nextShrink - round !== 1) return set;
  const inner = Math.max(artillerySpec.minimumSafeRadius, safe - 1);
  for (const cell of state.cells.values()) {
    const distance = hexDistance(cell, { q: 0, r: 0 });
    if (distance > inner && distance <= safe) set.add(keyOf(cell.q, cell.r));
  }
  return set;
}

// ---------------------------------------------------------------- 镜像：合法性

function reachableCells(state, unit) {
  const occupants = occupantMap(state);
  const visited = new Set([keyOf(unit.q, unit.r)]);
  const result = [];
  const queue = [{ q: unit.q, r: unit.r, distance: 0 }];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    if (current.distance >= unit.moveRange) continue;
    for (const next of neighbors(current.q, current.r)) {
      const key = keyOf(next.q, next.r);
      if (visited.has(key)) continue;
      visited.add(key);
      const cell = state.cells.get(key);
      if (!cell || cell.terrain !== 'plain') continue;
      if (occupants.has(key)) continue;
      result.push(next);
      queue.push({ q: next.q, r: next.r, distance: current.distance + 1 });
    }
  }
  return result;
}

function deployOrigin(state, owner, fromId) {
  const point = state.cps.find(cp => cp.id === fromId && cp.owner === owner);
  if (!point) return null;
  const spec = state.config.balance.controlPointTypes?.[point.kind];
  if (spec && spec.canDeploy === false) return null;
  return point;
}

function deployDiscount(state, owner, fromId) {
  const point = state.cps.find(cp => cp.id === fromId && cp.owner === owner);
  if (!point) return 0;
  return state.config.balance.controlPointTypes?.[point.kind]?.deployDiscount ?? 0;
}

function consumeAction(state, unit) {
  if (unit.actionSpent) return true;
  if (state.actionsUsed >= state.config.balance.actionsPerTurn) return false;
  state.actionsUsed += 1;
  unit.actionSpent = true;
  return true;
}

function removeUnit(state, unit) {
  unit.alive = false;
  unit.hp = 0;
}

function markEliminated(state, seat) {
  if (state.status[seat] !== 'active') return;
  state.status[seat] = 'eliminated';
  for (const unit of state.units) {
    if (unit.owner === seat && unit.alive) removeUnit(state, unit);
  }
  state.units = state.units.filter(unit => unit.owner !== seat);
  for (const cp of state.cps) if (cp.owner === seat) cp.owner = null;
  if (activeSeats(state).length <= 1) {
    state.over = true;
    state.winner = activeSeats(state)[0] ?? null;
  }
}

function wipeCheck(state) {
  for (const seat of activeSeats(state)) {
    if (!state.units.some(unit => unit.owner === seat && unit.alive)) markEliminated(state, seat);
  }
}

// 每个动作都返回新的 state；非法返回 null。
function applyMove(state, unitId, q, r) {
  const unit = unitById(state, unitId);
  if (!unit || unit.owner !== state.me || unit.hasMoved) return null;
  if (unit.q === q && unit.r === r) return null;
  const next = cloneState(state);
  const moving = unitById(next, unitId);
  if (!reachableCells(next, moving).some(cell => cell.q === q && cell.r === r)) return null;
  if (!consumeAction(next, moving)) return null;
  moving.q = q;
  moving.r = r;
  moving.hasMoved = true;
  return next;
}

function applyAttack(state, attackerId, targetId) {
  const attacker = unitById(state, attackerId);
  if (!attacker || attacker.owner !== state.me || attacker.hasActed) return null;
  const target = unitById(state, targetId);
  if (!target || target.owner === state.me) return null;
  if (hexDistance(attacker, target) > attacker.attackRange) return null;
  const next = cloneState(state);
  const me = unitById(next, attackerId);
  const victim = unitById(next, targetId);
  if (!consumeAction(next, me)) return null;
  victim.hp = Math.max(0, victim.hp - expDamage(next, me.attack, victim.defense));
  me.hasActed = true;
  if (victim.hp <= 0) {
    removeUnit(next, victim);
    next.killValue[me.owner] = (next.killValue[me.owner] ?? 0) + victim.cost;
    if (!next.units.some(unit => unit.alive && unit.owner === victim.owner)) markEliminated(next, victim.owner);
  }
  return next;
}

function applyHeal(state, supportId, targetId) {
  const support = unitById(state, supportId);
  if (!support || support.owner !== state.me || support.type !== 'support' || support.hasActed) return null;
  const target = unitById(state, targetId);
  if (!target || target.owner !== state.me || target.hp >= target.maxHp) return null;
  const danger = state.danger ?? new Set();
  if (danger.has(keyOf(support.q, support.r)) || danger.has(keyOf(target.q, target.r))) return null;
  const range = state.config.units[support.type]?.healRange ?? support.attackRange;
  if (hexDistance(support, target) > range) return null;
  const next = cloneState(state);
  const healer = unitById(next, supportId);
  const healed = unitById(next, targetId);
  if (!consumeAction(next, healer)) return null;
  healed.hp = Math.min(healed.maxHp, healed.hp + expHeal(next, healer));
  healer.hasActed = true;
  return next;
}

function applyDeploy(state, unitType, fromId, q, r) {
  const spec = state.config.units?.[unitType];
  if (!spec) return null;
  const origin = deployOrigin(state, state.me, fromId);
  if (!origin) return null;
  const danger = state.danger ?? new Set();
  if (danger.has(keyOf(origin.q, origin.r)) || danger.has(keyOf(q, r))) return null;
  if (state.actionsUsed >= state.config.balance.actionsPerTurn) return null;
  if (hexDistance(origin, { q, r }) !== 1) return null;
  if (!isPlain(state, q, r)) return null;
  if (occupantMap(state).has(keyOf(q, r))) return null;
  const discount = Math.min(spec.cost, deployDiscount(state, state.me, fromId));
  const cost = spec.cost - discount;
  if ((state.supplies[state.me] ?? 0) < cost) return null;
  const next = cloneState(state);
  next.actionsUsed += 1;
  next.supplies[state.me] -= cost;
  next.units.push({
    id: `ace_new_${next.units.length}_${keyOf(q, r)}`,
    owner: state.me, type: unitType, q, r, hp: spec.hp, maxHp: spec.hp,
    attack: spec.attack, defense: spec.defense,
    moveRange: spec.moveRange, attackRange: spec.attackRange,
    canCapture: Boolean(spec.canCapture), healPower: spec.healPower,
    cost: spec.cost, hasMoved: true, hasActed: false, actionSpent: true, alive: true,
  });
  return next;
}

function applyDemolish(state, unitId, q, r) {
  const unit = unitById(state, unitId);
  if (!unit || unit.owner !== state.me || unit.type !== 'heavy' || unit.hasActed) return null;
  if (hexDistance(unit, { q, r }) > 1) return null;
  if (!isInBounds(state, q, r)) return null;
  if (cellAt(state, q, r)?.terrain !== 'blocker') return null;
  if (occupantMap(state).has(keyOf(q, r))) return null;
  const next = cloneState(state);
  const heavy = unitById(next, unitId);
  if (!consumeAction(next, heavy)) return null;
  const cells = new Map(next.cells);
  cells.set(keyOf(q, r), { q, r, terrain: 'plain' });
  next.cells = cells;
  heavy.hasActed = true;
  return next;
}

// ---------------------------------------------------------------- 回合/轮界

function captureControlPoints(state, owner) {
  for (const cp of state.cps) {
    if (cp.owner === owner) continue;
    const capturer = state.units.find(unit =>
      unit.alive && unit.owner === owner && unit.canCapture && unit.q === cp.q && unit.r === cp.r);
    if (capturer) cp.owner = owner;
  }
}

function collectIncome(state, owner) {
  if (state.status[owner] !== 'active') return;
  const base = state.config.balance.baseIncome ?? 0;
  let control = 0;
  for (const cp of state.cps) {
    if (cp.owner !== owner) continue;
    const spec = state.config.balance.controlPointTypes?.[cp.kind];
    control += spec?.income ?? state.config.balance.controlPointIncome ?? 0;
  }
  state.supplies[owner] = (state.supplies[owner] ?? 0) + base + control;
}

function repairFromControlPoints(state, owner) {
  const repaired = new Set();
  for (const cp of state.cps) {
    if (cp.owner !== owner) continue;
    if (state.danger?.has(keyOf(cp.q, cp.r))) continue;
    const amount = state.config.balance.controlPointTypes?.[cp.kind]?.repairAmount ?? 0;
    if (amount <= 0) continue;
    for (const unit of state.units) {
      if (!unit.alive || unit.owner !== owner || unit.hp >= unit.maxHp || repaired.has(unit.id)) continue;
      if (state.danger?.has(keyOf(unit.q, unit.r))) continue;
      if (hexDistance(cp, unit) > 1) continue;
      const healed = Math.min(amount, unit.maxHp - unit.hp);
      if (healed <= 0) continue;
      unit.hp += healed;
      repaired.add(unit.id);
    }
  }
}

function applyArtilleryTick(state) {
  const artillery = state.artillery;
  if (!artillery) return;
  state.danger = dangerSet(state, state.round);
  for (const unit of state.units) {
    if (!unit.alive) continue;
    if (!state.danger.has(keyOf(unit.q, unit.r))) continue;
    unit.hp = Math.max(0, unit.hp - artillery.damage);
    if (unit.hp <= 0) removeUnit(state, unit);
  }
  wipeCheck(state);
}

// ---------------------------------------------------------------- 裁决（回合上限）

/** 引擎 accumulateControlHold：整轮结束时按「当轮持有数」累加，并记一轮（只算存活席位）。 */
function accumulateControlHold(state) {
  for (const seat of activeSeats(state)) {
    const held = state.cps.filter(cp => cp.owner === seat).length;
    state.controlHold[seat] = (state.controlHold[seat] ?? 0) + held;
    state.holdRounds[seat] = (state.holdRounds[seat] ?? 0) + 1;
  }
}

/** 引擎 isTurnLimitReached：maxTurns 为 null 表示无上限。判定发生在轮界（轮号还没 +1 时）。 */
function reachedTurnLimit(state) {
  if (!ACE.turnLimit) return false;
  const maxTurns = state.config.balance.maxTurns;
  if (maxTurns === null || maxTurns === undefined) return false;
  return state.round >= maxTurns;
}

/** 引擎 adjudicateAtTurnLimit：按裁决总分定胜负（并列 = 无胜者）。 */
function finishByAdjudication(state) {
  const active = activeSeats(state);
  let best = -Infinity;
  let winners = [];
  for (const seat of active) {
    const score = adjudicationTotal(state, seat);
    if (score > best + 1e-9) { best = score; winners = [seat]; }
    else if (Math.abs(score - best) <= 1e-9) winners.push(seat);
  }
  state.over = true;
  state.winner = winners.length === 1 ? winners[0] : null;
}

function nextActive(state, from) {
  const order = state.order;
  const start = Math.max(0, order.indexOf(from));
  for (let offset = 1; offset <= order.length; offset++) {
    const candidate = order[(start + offset) % order.length];
    if (state.status[candidate] === 'active') return candidate;
  }
  return null;
}

function applyEndTurn(state) {
  const owner = state.current;
  if (state.over) return null;
  const next = cloneState(state);
  captureControlPoints(next, owner);
  for (const unit of next.units) {
    if (unit.owner === owner && unit.alive) {
      unit.hasMoved = false;
      unit.hasActed = false;
      unit.actionSpent = false;
    }
  }
  next.acted.add(owner);
  const active = activeSeats(next);
  if (active.length <= 1) {
    next.over = true;
    next.winner = active[0] ?? null;
    return next;
  }
  const remaining = active.filter(id => !next.acted.has(id));
  let nextSeat = null;
  if (remaining.length > 0) {
    const start = Math.max(0, next.order.indexOf(owner));
    for (let offset = 1; offset <= next.order.length; offset++) {
      const candidate = next.order[(start + offset) % next.order.length];
      if (remaining.includes(candidate)) { nextSeat = candidate; break; }
    }
  } else {
    next.acted = new Set();
    // 轮界：先按引擎顺序累积据点持有（accumulateControlHold），再看是否触发回合上限裁决。
    accumulateControlHold(next);
    if (reachedTurnLimit(next)) {
      finishByAdjudication(next);
      return next;
    }
    next.round += 1;
    applyArtilleryTick(next);
    if (next.over) return next;
    nextSeat = nextActive(next, owner);
  }
  if (!nextSeat) {
    next.over = true;
    return next;
  }
  next.current = nextSeat;
  next.actionsUsed = 0;
  next.danger = dangerSet(next, next.round);
  next.warning = warningSet(next, next.round);
  collectIncome(next, nextSeat);
  repairFromControlPoints(next, nextSeat);
  return next;
}

// 动作 → 引擎 payload
function toAction(type, payload) {
  return { type, payload };
}

function candidateAction(candidate) {
  switch (candidate.type) {
    case 'move': return toAction('move', { unitId: candidate.unitId, q: candidate.q, r: candidate.r });
    case 'attack': return toAction('attack', { attackerId: candidate.attackerId, targetId: candidate.targetId });
    case 'heal': return toAction('heal', { supportId: candidate.supportId, targetId: candidate.targetId });
    case 'deploy': return toAction('deploy', { unitType: candidate.unitType, fromId: candidate.fromId, q: candidate.q, r: candidate.r });
    case 'demolish': return toAction('demolish', { unitId: candidate.unitId, q: candidate.q, r: candidate.r });
    // 组合候选（移动+攻击）在搜索里是一条边，但 runner 一次只吃一个动作：
    // 先交移动，下一拍重新决策自然会把攻击补上（否则整回合返回 null 白丢行动点）。
    case 'moveAttack': return toAction('move', { unitId: candidate.unitId, q: candidate.q, r: candidate.r });
    // 集火宏同理：先交第一刀，后续几刀由下一拍补（目标掉血后斩杀概率更高，搜索自然会继续打）。
    case 'focus': return toAction('attack', { attackerId: candidate.shooterIds[0], targetId: candidate.targetId });
    default: return null;
  }
}

/** 集火宏：依次让若干单位攻击同一目标，直到目标死亡或某个攻击失败。 */
function applyFocus(state, targetId, shooterIds) {
  let next = state;
  for (const shooterId of shooterIds) {
    const target = unitById(next, targetId);
    if (!target || target.owner === next.me) break;
    const shooter = unitById(next, shooterId);
    if (!shooter || shooter.hasActed) break;
    const applied = applyAttack(next, shooterId, targetId);
    if (!applied) break;
    next = applied;
  }
  return next === state ? null : next;
}

function applyCandidate(state, candidate) {
  switch (candidate.type) {
    case 'move': return applyMove(state, candidate.unitId, candidate.q, candidate.r);
    case 'attack': return applyAttack(state, candidate.attackerId, candidate.targetId);
    case 'heal': return applyHeal(state, candidate.supportId, candidate.targetId);
    case 'deploy': return applyDeploy(state, candidate.unitType, candidate.fromId, candidate.q, candidate.r);
    case 'demolish': return applyDemolish(state, candidate.unitId, candidate.q, candidate.r);
    case 'focus': return applyFocus(state, candidate.targetId, candidate.shooterIds);
    default: return null;
  }
}

/** 预检闸：用同一套镜像判断动作是否合法（返回其后状态，非法 null）。 */
function assertLegal(state, action) {
  if (!action) return null;
  const payload = action.payload ?? {};
  switch (action.type) {
    case 'move': return applyMove(state, String(payload.unitId), Number(payload.q), Number(payload.r));
    case 'attack': return applyAttack(state, String(payload.attackerId), String(payload.targetId));
    case 'heal': return applyHeal(state, String(payload.supportId), String(payload.targetId));
    case 'deploy': return applyDeploy(state, String(payload.unitType), String(payload.fromId), Number(payload.q), Number(payload.r));
    case 'demolish': return applyDemolish(state, String(payload.unitId), Number(payload.q), Number(payload.r));
    default: return null;
  }
}

// ---------------------------------------------------------------- 评估

/**
 * 席位裁决分（§5.1 的 A(s,seat)）：军力 = Σ cost × hp/maxHp。
 *
 * 军力里**不做**"被瞄准程度"的连续折价（旧实现：`× Π surv`）：那条折价会让"靠近敌人"整体判负，
 * 长廊图上表现为一味后撤、把中央让给对手（对所有候选都生效，等于全局减分，却压掉了进攻的边际收益）。
 * 对手回合的风险改用离散的「被打死概率」计价，见 deathRiskPenalty。
 */
function seatScore(state, seat, weights) {
  let army = 0;
  for (const unit of state.units) {
    if (!unit.alive || unit.owner !== seat) continue;
    army += (unit.cost ?? 0) * (unit.hp / Math.max(1, unit.maxHp));
  }
  const kill = state.killValue[seat] ?? 0;
  const cps = state.cps.filter(cp => cp.owner === seat).length;
  const supplies = state.supplies[seat] ?? 0;
  return (weights.armyValue ?? 0) * army
    + (weights.killValue ?? 0) * kill
    + controlScore(state, seat, weights, cps)
    + (weights.supplies ?? 0) * supplies
    // 补给影子价：歼灭图的 adjudicationWeights.supplies 恒为 0，若直接照抄裁决口径，
    // 「花 45 补给换 90 分军力」就是零成本，部署会把攻击挤出候选（实测 depth1 下 98% → 53%）。
    // **只对我方座位计价**：影子价是"我的资源该值多少"的决策辅助，不是裁决项；若对对手也加，
    // 对手回合收入会变成我的相对亏损（income×1.6≈13–19 分），搜索就会为了不"亏分"而塞零收益动作、
    // 拒绝结束回合（实测这一条直接把 trench-run 从 96.7% 拉到 75%）。
    + (seat === state.me ? ACE.supplyShadow * supplies : 0);
}

const DEFAULT_CONTROL_FLOW_RATIO = 0.7;

/**
 * 据点项：与引擎 `scorePlayer` 同式——
 * `w_cp * (flowRatio * controlHold + (1 - flowRatio) * controlPoints)`，
 * 其中 `controlHold` = 整轮累加的持有数 / 已计轮数（流量口径，不是"当前持有数"）。
 * 老实现只数当前持有数：在 `controlPoint` 权重被随机放大（实测某局 38 vs armyValue 2）的随机图上，
 * 等于完全看不懂"占着点每轮都在挣分"。
 *
 * 末段投影：离回合上限不足 `ACE.adjudicationHorizon` 轮时，把当前持有数按剩余轮数续上再取均值，
 * 否则搜索会低估"现在占点"的终值（引擎在轮界按同一口径结账）。
 */
function controlScore(state, seat, weights, cps) {
  const weight = weights.controlPoint ?? 0;
  if (weight === 0) return 0;
  const flowRatio = weights.controlPointFlowRatio ?? DEFAULT_CONTROL_FLOW_RATIO;
  const rounds = Math.max(1, state.holdRounds[seat] ?? 0);
  let hold = (state.controlHold[seat] ?? 0) / rounds;
  const maxTurns = state.config.balance.maxTurns;
  if (maxTurns !== null && maxTurns !== undefined && ACE.adjudicationHorizon > 0) {
    const remaining = Math.max(0, maxTurns - state.round);
    if (remaining > 0 && remaining <= ACE.adjudicationHorizon) {
      hold = ((state.controlHold[seat] ?? 0) + cps * remaining) / (rounds + remaining);
    }
  }
  const rounded = Math.round(hold * 100) / 100;
  return weight * (flowRatio * rounded + (1 - flowRatio) * cps);
}

/** 裁决总分（引擎 scorePlayer 的 total 口径；HQ 两项在歼灭图恒为 0，仍按配置读）。 */
function adjudicationTotal(state, seat) {
  const weights = state.config.balance.adjudicationWeights ?? {};
  let army = 0;
  for (const unit of state.units) {
    if (!unit.alive || unit.owner !== seat) continue;
    army += (unit.cost ?? 0) * (unit.hp / Math.max(1, unit.maxHp));
  }
  const cps = state.cps.filter(cp => cp.owner === seat).length;
  return (weights.armyValue ?? 0) * army
    + (weights.killValue ?? 0) * (state.killValue[seat] ?? 0)
    + controlScore(state, seat, weights, cps)
    + (weights.supplies ?? 0) * (state.supplies[seat] ?? 0);
}

function artilleryPenalty(state, weights) {
  if (ablated('art')) return 0;
  const artillery = state.artillery;
  if (!artillery) return 0;
  const danger = state.danger ?? new Set();
  const warning = state.warning ?? new Set();
  const damage = artillery.damage ?? 0;
  let penalty = 0;
  for (const unit of state.units) {
    if (!unit.alive || unit.owner !== state.me) continue;
    const key = keyOf(unit.q, unit.r);
    const ratio = 1 / Math.max(1, unit.maxHp);
    if (danger.has(key)) {
      const lost = Math.min(unit.hp, damage);
      penalty += (weights.armyValue ?? 0) * (unit.cost ?? 0) * ratio * lost;
      if (lost >= unit.hp) penalty += (weights.killValue ?? 0) * (unit.cost ?? 0) * 0.5;
    } else if (warning.has(key)) {
      // 预警圈：下一轮可能收进来，按半个 tick 计价。
      penalty += 0.5 * (weights.armyValue ?? 0) * (unit.cost ?? 0) * ratio * Math.min(unit.hp, damage);
    }
  }
  return penalty + artilleryForwardPenalty(state, weights);
}

/**
 * 炮火**前瞻**（v3）：当前 danger/warning 只描述"这一轮"，而缩圈是确定的未来——
 * 站在第 14 轮的安全区里可能第 16 轮就被推到危险区。这里按本局 `annihilation.artillery`
 * 与 `radius` 投影未来 K 轮的安全半径，对每个单位数"接下来会挨几轮 tick"，按期望损失计价。
 *
 * 终点项：当投影到最后的安全半径 ≤ 1（圆心一格）时，"站在最终安全格上"给一个显式正向项——
 * 那时活下来的唯一方式就是占住圆心，线性 tick 期望不足以表达这个悬崖。
 */
function artilleryForwardPenalty(state, weights) {
  const artillery = state.artillery;
  if (!artillery || ACE.artHorizon <= 0) return 0;
  // 门控：只有当缩圈最终会盖满全图（`minimumSafeRadius <= 0`，最后只剩圆心一格）时前瞻才有意义——
  // 那时"再打两轮就会被推到圈外"是终局的主要死因（长廊图实测输局全落在 16–19 轮、且兵力还领先）。
  // 若缩圈最终仍留出安全区（如 artillery-zone 的 minSafe=1，末段还有 7 格），当前圈 + 预警圈已经够用：
  // 再往前看只会让单位提前抢圈、放掉输出（实测 az 96.7% → 90%、3 人局 86.7% → 71.7%）。
  if ((artillery.minimumSafeRadius ?? 0) > 0) return 0;
  const damage = artillery.damage ?? 0;
  const armyWeight = weights.armyValue ?? 0;
  const killWeight = weights.killValue ?? 0;
  // 投影不能越过回合上限：引擎在 `maxTurns` 的轮界就裁决收场（`isTurnLimitReached`），之后再没有 tick。
  // 不夹的话，trench-run 第 20 轮会去投影 21/22/23 轮——第 23 轮的炮火在规则里根本不存在，
  // 单位会为一个不会发生的 tick 提前让出位置。`maxTurns` 为 null 时不限。
  const maxTurns = state.config.balance.maxTurns;
  const lastRound = maxTurns === null || maxTurns === undefined ? Infinity : maxTurns;
  const horizonEnd = Math.min(state.round + ACE.artHorizon, lastRound);
  const finalRadius = Math.max(artillery.minimumSafeRadius ?? 0, safeRadiusFor(state, horizonEnd) ?? 0);
  let penalty = 0;
  for (const unit of state.units) {
    if (!unit.alive || unit.owner !== state.me) continue;
    const distance = hexDistance(unit, { q: 0, r: 0 });
    const ratio = 1 / Math.max(1, unit.maxHp);
    // 未来 K 轮（不含本轮：本轮已由 danger/warning 计价），同样不越过回合上限。
    let ticks = 0;
    for (let k = 1; k <= ACE.artHorizon; k++) {
      const round = state.round + k;
      if (round > lastRound) break;
      const radius = safeRadiusFor(state, round);
      if (radius === null) break;
      if (distance > radius) ticks += 1;
    }
    if (ticks > 0) {
      const lost = Math.min(unit.hp, ticks * damage);
      penalty += ACE.artWeight * armyWeight * (unit.cost ?? 0) * ratio * lost;
      if (lost >= unit.hp && ticks >= 2) penalty += killWeight * (unit.cost ?? 0) * 0.5;
    }
    // 终点项：终局安全半径 ≤ 1 时，站在最终安全格上是"能活着结算"的前提。
    if (finalRadius <= 1 && distance <= finalRadius && ticks === 0) {
      penalty -= ACE.artFinalBonus * armyWeight * (unit.cost ?? 0) * ratio * Math.min(unit.hp, damage * ACE.artHorizon);
    }
  }
  return penalty;
}

/**
 * 对手回合风险（§5.2 的 P_expose）：用**离散斩杀概率**而不是"被瞄准的期望伤害"计价。
 *
 * - 口径是「对手**一个回合**内打死它」（`multiHitKillProbability`，`actionsPerTurn` 刀），
 *   不是「一刀打死」：满血重装挨四刀也死不了，风险自然接近 0；20 血的残血单位几乎必死。
 *   这样既不会让算法一味后撤，又能真正劝退"把残血单位留在敌人射程里"。
 * - 只在叶节点算一次（每次 evaluate 一次），不随搜索深度累积。
 * - 3 人以上对每个对手都算，单位按**最危险的单个对手**计价（一个回合只有一个对手能行动）。
 *
 * `ACE_ABLATE=opp` 关掉的**只有这一项**（即 `P_expose`）。v1 里 `opp` 还包含 `surv≡1`
 * （把连续的军力折价也去掉），v2 起连续折价已整体删除，所以没有 `surv≡1` 这一半；
 * 拿 v1 时代的 `opp` 数字和现在比是跨语义比较，不可直接对照。
 */
function deathRiskPenalty(state, weights) {
  if (ablated('opp')) return 0;
  const me = state.me;
  const opponents = activeSeats(state).filter(id => id !== me);
  if (opponents.length === 0) return 0;
  // 每个对手在它自己的回合里有 `actionsPerTurn` 次攻击（歼灭图 4 次）：风险按「一回合内被打死」计，
  // 不是「一刀打死」——残血 20 血的单位挨一刀未必死，但留在敌人射程里挨四刀基本必死。
  const attacksPerTurn = Math.max(1, state.config.balance.actionsPerTurn ?? 1);
  let risk = 0;
  for (const unit of state.units) {
    if (!unit.alive || unit.owner !== me) continue;
    // 每个对手各自有一个回合：先取该对手最优的「回合内打死概率」，再按
    // P(被打死) = 1 − Π(1 − p_对手) 合成（两人局退化成单回合，三人局自动变强——被围确实更危险）。
    let surviveAll = 1;
    for (const owner of opponents) {
      let best = 0;
      for (const foe of state.units) {
        if (!foe.alive || foe.owner !== owner) continue;
        if (hexDistance(foe, unit) > foe.attackRange) continue;
        const probability = multiHitKillProbability(state, foe.attack, unit.defense, unit.hp, attacksPerTurn);
        if (probability > best) best = probability;
      }
      surviveAll *= 1 - best;
    }
    const dead = 1 - surviveAll;
    if (dead <= 0) continue;
    const value = (weights.armyValue ?? 0) * (unit.cost ?? 0) * (unit.hp / Math.max(1, unit.maxHp))
      + (weights.killValue ?? 0) * (unit.cost ?? 0);
    risk += dead * value;
  }
  // 多人局另起系数：合成式 `1−Π(1−p)` 随对手数放大，同一个 β 在 3 人局会被罚过头（过度避险）。
  return (state.order.length >= 3 ? ACE.betaFfa : ACE.betaRisk) * risk;
}

function evaluate(state, weights, options = {}) {
  const me = state.me;
  const mine = seatScore(state, me, weights);
  let leader = -Infinity;
  let total = 0;
  for (const seat of activeSeats(state)) {
    if (seat === me) continue;
    const score = seatScore(state, seat, weights);
    leader = Math.max(leader, score);
    total += score;
  }
  if (!Number.isFinite(leader)) leader = 0;
  // 3 人以上：除领先者外，其余席位按 FFA 权重计入（两人局 total === leader，公式自动退化）。
  // 只看领先者时，对「次席」的伤害在评估里完全不计分，等于放任第三方收人头。
  const rival = leader + ACE.ffaRival * (total - leader);
  let value = mine - rival;
  value -= artilleryPenalty(state, weights);
  value -= deathRiskPenalty(state, weights);
  if (options.idlePenalty) value -= options.idlePenalty;
  if (options.deployBonus) value += options.deployBonus;
  return value;
}

function averageUnitValue(state) {
  const units = state.units.filter(unit => unit.alive && unit.owner === state.me);
  if (units.length === 0) return 0;
  const weights = state.config.balance.adjudicationWeights ?? {};
  return units.reduce((sum, unit) => sum + (unit.cost ?? 0), 0) / units.length * (weights.armyValue ?? 0);
}

// ---------------------------------------------------------------- 候选生成

function focusEnemy(state, unit) {
  let best = null;
  let bestDistance = Infinity;
  for (const enemy of state.units) {
    if (!enemy.alive || enemy.owner === unit.owner) continue;
    const distance = hexDistance(unit, enemy);
    if (distance < bestDistance) { bestDistance = distance; best = enemy; }
  }
  return best;
}

function enemyUnits(state, owner) {
  return state.units.filter(unit => unit.alive && unit.owner !== owner);
}

function generateCandidates(state, params) {
  const me = state.me;
  const weights = state.config.balance.adjudicationWeights ?? {};
  const balance = state.config.balance;
  const apLeft = balance.actionsPerTurn - state.actionsUsed;
  const units = livingUnits(state, me);
  const enemies = enemyUnits(state, me);
  const danger = state.danger ?? new Set();
  const candidates = [];

  // 攻击：按「斩杀概率 + 伤害价值」排序，每单位取上限。
  const attackCands = [];
  for (const unit of units) {
    if (!unit.alive || unit.hasActed) continue;
    if (!unit.actionSpent && apLeft <= 0) continue;
    for (const target of enemies) {
      if (hexDistance(unit, target) > unit.attackRange) continue;
      const p = killProbability(state, unit.attack, target.defense, target.hp);
      const damage = Math.min(target.hp, expDamage(state, unit.attack, target.defense));
      const score = p * ((weights.killValue ?? 0) * (target.cost ?? 0) + (weights.armyValue ?? 0) * (target.cost ?? 0) * 0.4)
        + (weights.armyValue ?? 0) * (target.cost ?? 0) * (damage / Math.max(1, target.maxHp)) * 0.6;
      attackCands.push({
        type: 'attack', attackerId: unit.id, targetId: target.id, score, unitId: unit.id,
        tie: `${unitKeyOf(state, unit)}>${targetKeyOf(state, target)}`,
      });
    }
  }
  attackCands.sort((a, b) => b.score - a.score || compareTie(a.tie, b.tie));
  const perUnit = new Map();
  for (const cand of attackCands) {
    const used = perUnit.get(cand.attackerId) ?? 0;
    if (used >= params.attackCands) continue;
    perUnit.set(cand.attackerId, used + 1);
    candidates.push(cand);
  }

  // 集火宏：把「2–3 次攻击打死同一个目标」打包成一条候选。
  // 束搜索的每一层只按"单动作后的叶值"排序，同一个目标的第二、三次攻击在中间步看起来
  // 只是"重复削血"，很容易被位置/炮火项更高的节点挤出 beam，集火线就断了。打包成宏以后
  // 整条线作为一条边参与排序，搜索才能把「两刀砍死一个重装」和「砍两刀不同目标」区分开。
  const focusCands = [];
  for (const target of enemies) {
    const shooters = units
      .filter(unit => unit.alive && !unit.hasActed && hexDistance(unit, target) <= unit.attackRange)
      .sort((a, b) => expDamage(state, b.attack, target.defense) - expDamage(state, a.attack, target.defense)
        || compareTie(unitKeyOf(state, a), unitKeyOf(state, b)));
    if (shooters.length < 2) continue;
    let hp = target.hp;
    let activations = 0;
    const picked = [];
    for (const shooter of shooters) {
      if (!shooter.actionSpent) {
        if (activations >= apLeft) continue; // 没 AP 激活它，换下一个（可能已激活的免费跟进）
        activations += 1;
      }
      picked.push(shooter);
      hp -= expDamage(state, shooter.attack, target.defense);
      if (hp <= 0 || picked.length >= 3) break;
    }
    if (hp > 0 || picked.length < 2) continue;
    const score = 2 * (weights.killValue ?? 0) * (target.cost ?? 0)
      + (weights.armyValue ?? 0) * (target.cost ?? 0)
      - 0.2 * (weights.armyValue ?? 0) * (target.cost ?? 0) * (picked.length - 1);
    focusCands.push({
      type: 'focus', targetId: target.id, shooterIds: picked.map(unit => unit.id), score,
      tie: `${targetKeyOf(state, target)}>${picked.map(unit => unitKeyOf(state, unit)).join('+')}`,
    });
  }
  focusCands.sort((a, b) => b.score - a.score || compareTie(a.tie, b.tie));
  candidates.push(...focusCands.slice(0, params.focusCands ?? 2));

  // 移动 + 攻击（先落点后开火）：只有尚未移动、尚未攻击的单位能做。
  const moveAttackCands = [];
  for (const unit of units) {
    if (!unit.alive || unit.hasMoved || unit.hasActed) continue;
    if (!unit.actionSpent && apLeft <= 0) continue;
    const reachable = reachableCells(state, unit);
    if (reachable.length === 0) continue;
    const focus = focusEnemy(state, unit);
    const rankedMoves = reachable
      .map(cell => {
        const distance = focus ? hexDistance(cell, focus) : hexDistance(cell, { q: 0, r: 0 });
        const dangerous = danger.has(keyOf(cell.q, cell.r)) ? 1 : state.warning?.has(keyOf(cell.q, cell.r)) ? 0.4 : 0;
        const cpBonus = unit.canCapture && state.cps.some(cp => cp.owner !== me && cp.q === cell.q && cp.r === cell.r) ? 2 : 0;
        // 能打到焦点敌的落点优先（M3：先把"这一刀砍得到"的位置排到前面，
        // 距离项只作次要区分，否则"再靠近一格"会压过"现在就能开火"）。
        const canHitFocus = focus && hexDistance(cell, focus) <= unit.attackRange ? 120 : 0;
        return { cell, score: canHitFocus - distance * 10 - dangerous * 14 + cpBonus * 3 };
      })
      .sort((a, b) => b.score - a.score || a.cell.q - b.cell.q || a.cell.r - b.cell.r)
      .slice(0, params.moveCands);
    for (const move of rankedMoves) {
      const probe = cloneState(state);
      const moved = unitById(probe, unit.id);
      moved.q = move.cell.q;
      moved.r = move.cell.r;
      for (const target of enemyUnits(probe, me)) {
        if (hexDistance(move.cell, target) > unit.attackRange) continue;
        const p = killProbability(probe, unit.attack, target.defense, target.hp);
        const score = p * ((weights.killValue ?? 0) * (target.cost ?? 0) + (weights.armyValue ?? 0) * (target.cost ?? 0) * 0.4)
          + (weights.armyValue ?? 0) * (target.cost ?? 0) * 0.3 + move.score;
        moveAttackCands.push({
          type: 'moveAttack', unitId: unit.id, q: move.cell.q, r: move.cell.r, targetId: target.id, score,
          tie: `${unitKeyOf(state, unit)}>${keyOf(move.cell.q, move.cell.r)}>${targetKeyOf(probe, target)}`,
        });
      }
    }
  }
  moveAttackCands.sort((a, b) => b.score - a.score || compareTie(a.tie, b.tie));
  for (const cand of moveAttackCands.slice(0, params.moveAttackCands * Math.max(1, units.length))) candidates.push(cand);

  // 纯移动：每单位取前 M 个。
  const moveCands = [];
  for (const unit of units) {
    if (!unit.alive || unit.hasMoved) continue;
    if (!unit.actionSpent && apLeft <= 0) continue;
    const reachable = reachableCells(state, unit);
    if (reachable.length === 0) continue;
    const focus = focusEnemy(state, unit);
    for (const cell of reachable) {
      const distance = focus ? hexDistance(cell, focus) : hexDistance(cell, { q: 0, r: 0 });
      const dangerous = danger.has(keyOf(cell.q, cell.r)) ? 1 : state.warning?.has(keyOf(cell.q, cell.r)) ? 0.4 : 0;
      const cpBonus = (unit.canCapture && state.cps.some(cp => cp.owner !== me && cp.q === cell.q && cp.r === cell.r)) ? 2 : 0;
      moveCands.push({
        type: 'move', unitId: unit.id, q: cell.q, r: cell.r,
        score: -distance * 10 - dangerous * 14 + cpBonus * 3,
        tie: `${unitKeyOf(state, unit)}>${keyOf(cell.q, cell.r)}`,
      });
    }
  }
  moveCands.sort((a, b) => b.score - a.score || compareTie(a.tie, b.tie));
  const movePerUnit = new Map();
  for (const cand of moveCands) {
    const used = movePerUnit.get(cand.unitId) ?? 0;
    if (used >= params.moveCands) continue;
    movePerUnit.set(cand.unitId, used + 1);
    candidates.push(cand);
  }

  // 治疗：support 对未满血友军，避开危险区。
  const healCands = [];
  for (const unit of units) {
    if (!unit.alive || unit.type !== 'support' || unit.hasActed) continue;
    if (!unit.actionSpent && apLeft <= 0) continue;
    if (danger.has(keyOf(unit.q, unit.r))) continue;
    const range = state.config.units.support?.healRange ?? unit.attackRange;
    for (const ally of units) {
      if (ally.id === unit.id || ally.hp >= ally.maxHp) continue;
      if (danger.has(keyOf(ally.q, ally.r))) continue;
      if (hexDistance(unit, ally) > range) continue;
      const missing = ally.maxHp - ally.hp;
      healCands.push({
        type: 'heal', supportId: unit.id, targetId: ally.id, score: missing * (weights.armyValue ?? 0),
        tie: `${unitKeyOf(state, unit)}>${unitKeyOf(state, ally)}`,
      });
    }
  }
  healCands.sort((a, b) => b.score - a.score || compareTie(a.tie, b.tie));
  candidates.push(...healCands.slice(0, params.healCands * Math.max(1, units.length)));

  // 爆破：仅重装、相邻 blocker，打通的收益粗略按「通往焦点的距离」计。
  if (params.demolish) {
    for (const unit of units) {
      if (!unit.alive || unit.type !== 'heavy' || unit.hasActed) continue;
      if (!unit.actionSpent && apLeft <= 0) continue;
      const focus = focusEnemy(state, unit);
      for (const next of neighbors(unit.q, unit.r)) {
        if (cellAt(state, next.q, next.r)?.terrain !== 'blocker') continue;
        if (occupantMap(state).has(keyOf(next.q, next.r))) continue;
        const score = focus ? -hexDistance(next, focus) * 0.1 : 0;
        candidates.push({ type: 'demolish', unitId: unit.id, q: next.q, r: next.r, score });
      }
    }
  }

  // 部署：己方可部署据点 × 相邻空 plain，按是否有仗可打/安全程度排序。
  if (apLeft > 0) {
    const deployCands = [];
    const origins = state.cps.filter(cp => cp.owner === me && (state.config.balance.controlPointTypes?.[cp.kind]?.canDeploy !== false));
    for (const origin of origins) {
      if (danger.has(keyOf(origin.q, origin.r))) continue;
      for (const next of neighbors(origin.q, origin.r)) {
        if (!isPlain(state, next.q, next.r)) continue;
        if (occupantMap(state).has(keyOf(next.q, next.r))) continue;
        if (danger.has(keyOf(next.q, next.r))) continue;
        const spots = next;
        for (const type of Object.keys(state.config.units)) {
          const spec = state.config.units[type];
          const cost = Math.max(0, spec.cost - Math.min(spec.cost, deployDiscount(state, me, origin.id)));
          if ((state.supplies[me] ?? 0) < cost) continue;
          const canHit = enemies.some(enemy => hexDistance(spots, enemy) <= spec.attackRange);
          const value = canHit ? 12 : 6;
          deployCands.push({
            type: 'deploy', unitType: type, fromId: origin.id, q: next.q, r: next.r,
            score: value + (weights.armyValue ?? 0) * 0.1,
            tie: `${origin.id}:${type}:${next.q},${next.r}`,
          });
        }
      }
    }
    deployCands.sort((a, b) => b.score - a.score || compareTie(a.tie, b.tie));
    candidates.push(...deployCands.slice(0, params.deployCands));
  }

  return candidates;
}

// ---------------------------------------------------------------- 搜索

function paramsForLadder(step) {
  return {
    attackCands: step.attackCands,
    moveCands: step.moveCands,
    moveAttackCands: step.moveAttackCands,
    deployCands: step.deployCands,
    healCands: step.healCands,
    demolish: step.demolish,
    // 集火宏条数必须跟着阶梯走：它是一条边打多刀，单步消融档里不能还留着它，
    // 否则 `ACE_ABLATE=search` 的「单步」基线名不副实（消融表就不可比了）。
    focusCands: step.focusCands ?? 2,
  };
}

function beamLadder() {
  if (ablated('search')) {
    return [{ beam: 1, depth: 1, rolloutH: 0, attackCands: 1, moveCands: 1, moveAttackCands: 0, deployCands: 0, healCands: 0, demolish: false, focusCands: 0 }];
  }
  const ladder = [
    { beam: 2, depth: 4, rolloutH: 0, attackCands: Math.min(2, ACE.attackCands), moveCands: 2, moveAttackCands: 1, deployCands: 2, healCands: 1, demolish: false, focusCands: 2 },
    { beam: ACE.beam, depth: 6, rolloutH: ablated('rollout') ? 0 : Math.min(1, ACE.rolloutH), attackCands: ACE.attackCands, moveCands: ACE.moveCands, moveAttackCands: ACE.moveAttackCands, deployCands: ACE.deployCands, healCands: ACE.healCands, demolish: true, focusCands: 2 },
    { beam: ACE.beam + 2, depth: 8, rolloutH: ablated('rollout') ? 0 : Math.min(2, ACE.rolloutH + 1), attackCands: ACE.attackCands, moveCands: ACE.moveCands, moveAttackCands: ACE.moveAttackCands, deployCands: ACE.deployCands, healCands: ACE.healCands, demolish: true, focusCands: 2 },
  ];
  return ladder;
}

function applySearchCandidate(state, candidate) {
  if (candidate.type === 'moveAttack') {
    const moved = applyMove(state, candidate.unitId, candidate.q, candidate.r);
    if (!moved) return null;
    return applyAttack(moved, candidate.unitId, candidate.targetId);
  }
  return applyCandidate(state, candidate);
}

/**
 * 回合内束搜索。工作量用**节点预算**封顶，而不是墙钟：同一局面在忙/闲机器上必须给出同一动作
 * （墙钟截断会让确定性用例在并行 CI 上分叉）。预算按单位数与 AP 缩放，量级约 2–4ms。
 */
function search(state) {
  const weights = state.config.balance.adjudicationWeights ?? {};
  const allowedDepth = Math.max(1, Math.min(10, state.config.balance.actionsPerTurn * 2 + 2));
  const myUnits = livingUnits(state, state.me).length;
  const twoSeat = state.order.length === 2;
  // rollout 在 2–3 人局做（按**开局座位数**判定，而不是当前存活数：3 人局打到剩 2 家时
  // 若临时开启 rollout，单次 decide 会从 ~1ms 跳到几十毫秒，确定性也会随战况漂移）。
  const allowRollout = state.order.length <= 3;
  // 多人局节点更贵（候选与席位都多），原实现只给 50–100 节点，实际只够展开一层（≈静态贪心），
  // 实测 3 人局第一名率 68%；放开后单次 decide 仍在 3–4ms。
  const budgetCap = twoSeat ? 700 : 620;
  let budget = Math.min(
    budgetCap,
    Math.max(twoSeat ? 260 : 320, 18 + myUnits * 38 + state.config.balance.actionsPerTurn * 38),
  );
  let bestPlans = [];
  for (const step of beamLadder()) {
    if (budget <= 0) break;
    const params = paramsForLadder(step);
    let beam = [{ state, acts: [], value: evaluate(state, weights), kills: 0 }];
    let plans = [];
    for (let depth = 0; depth < Math.min(step.depth, allowedDepth); depth++) {
      if (budget <= 0) break;
      const nextBeam = [];
      for (const node of beam) {
        if (budget <= 0) break;
        // 结束回合之后（或局面已终局）不再展开：那已经是下一位的回合，
        // 继续用己方单位生成动作会产出 not_your_turn 的非法序列。
        if (node.state.over || node.state.current !== state.me) continue;
        const candidates = generateCandidates(node.state, params);
        for (const candidate of candidates) {
          if (budget-- <= 0) break;
          const next = applySearchCandidate(node.state, candidate);
          if (!next) continue;
          const acts = node.acts.concat([candidate]);
          // 记录本计划是否已经完成过斩杀（beam 斩杀保护槽用）。叶值本身已按裁决口径给击杀计过分，
          // 再叠一个"斩杀确认加成"实测是负收益（tr 93.3% → 85.8%/86.7%，加成 0.25/0.6），所以只保留保护槽。
          const killed = (next.killValue[state.me] ?? 0) > (node.state.killValue[state.me] ?? 0);
          const value = evaluate(next, weights);
          nextBeam.push({ state: next, acts, value, kills: node.kills + (killed ? 1 : 0) });
        }
        if (budget-- > 0) {
          const ended = applyEndTurn(node.state);
          if (ended) {
            // 空过回合罚项（§5.2 的 P_idle）：还剩 AP 却把回合交出去就罚，表达"让出先手"的代价。
            // 也试过收紧成"还有能打的攻击才罚"：tr 120 局 91.7% vs 93.3%，在噪声内，保留简单口径。
            let idle = 0;
            if (!ablated('idle') && state.config.balance.actionsPerTurn - node.state.actionsUsed > 0) {
              idle = 0.05 * averageUnitValue(node.state);
            }
            const acts = node.acts.concat([{ type: 'end' }]);
            const endValue = evaluate(ended, weights, { idlePenalty: idle });
            nextBeam.push({ state: ended, acts, value: endValue, kills: node.kills, complete: true });
          }
        }
      }
      if (nextBeam.length === 0) break;
      nextBeam.sort((a, b) => b.value - a.value || a.acts.length - b.acts.length);
      const slice = nextBeam.slice(0, step.beam);
      // 斩杀保护槽：本回合已经能完成斩杀的节点至少留一个，避免被"位置/炮火分"更高的
      // 中途节点整批挤掉（否则搜索会一直削血而收不到人头）。宽度 1 的消融档保持"只挑最优单步"语义。
      if (step.beam > 1 && !slice.some(node => node.kills > 0)) {
        const killer = nextBeam.slice(step.beam).find(node => node.kills > 0);
        if (killer) slice[slice.length - 1] = killer;
      }
      beam = slice;
      plans = plans.concat(beam.filter(node => node.acts.length > 0));
    }
    // rollout：只对决赛圈前两个节点做。它不占搜索预算（否则 Step2 一忙就永远轮不到 rollout），
    // 成本由「2 节点 × H 轮 × 对手数」确定性封顶。
    if (step.rolloutH > 0 && allowRollout) {
      // 3 人以上每多一个座位就多一轮对手贪心，深度压到 1 轮（单次 decide 实测多 ~1ms）。
      const rounds = twoSeat ? step.rolloutH : Math.min(1, step.rolloutH);
      for (const node of beam.slice(0, 2)) {
        node.value = rolloutValue(node.state, rounds, weights);
      }
    }
    plans = plans.concat(beam.filter(node => node.acts.length > 0));
    plans.sort((a, b) => b.value - a.value || a.acts.length - b.acts.length);
    bestPlans = plans;
  }
  return bestPlans;
}

/** 跨回合投影：让其余座位各走一个贪心回合，再轮到我，重复 H 轮。 */
function rolloutValue(state, rounds, weights) {
  const rootMe = state.me;
  let current = state;
  for (let step = 0; step < rounds; step++) {
    let guard = 0;
    while (!current.over && current.current !== rootMe && guard++ < current.order.length * 2) {
      const nextTurn = greedyTurn(current, weights);
      if (!nextTurn) return evaluate({ ...current, me: rootMe }, weights);
      current = nextTurn;
    }
    if (current.over) break;
    const mine = greedyTurn(current, weights);
    if (!mine) break;
    current = mine;
  }
  return evaluate({ ...current, me: rootMe }, weights);
}

function greedyTurn(state, weights) {
  // 以「当前行动席位」的身份生成/施加动作（generateCandidates/apply* 都按 state.me 校验）。
  let current = cloneState({ ...state, me: state.current });
  for (let step = 0; step < 2; step++) {
    const params = { attackCands: 3, moveCands: 2, moveAttackCands: 2, deployCands: 1, healCands: 1, demolish: false };
    const candidates = generateCandidates(current, params);
    if (candidates.length === 0) break;
    let best = null;
    let bestValue = -Infinity;
    for (const candidate of candidates.slice(0, 6)) {
      const next = applySearchCandidate(current, candidate);
      if (!next) continue;
      const value = evaluate(next, weights);
      if (value > bestValue) { bestValue = value; best = next; }
    }
    if (!best) break;
    current = best;
  }
  const ended = applyEndTurn(current);
  return ended ?? current;
}

// ---------------------------------------------------------------- 入口

async function decide(game, _utils, ctx) {
  try {
    const owner = ctx?.owner ?? game?.turn?.currentPlayerId;
    if (!owner) return null;
    if (game.phase !== 'active') return null;
    if (game.turn?.currentPlayerId && game.turn.currentPlayerId !== owner) return null;
    const state = buildState(game, owner);
    if (!state) return null;
    // 算法只声明歼灭模式（元数据 modes:['annihilation']）：标准 / 同时回合 / 大逃杀一律不接管。
    if (state.config.mode !== 'annihilation') return null;
    if (state.over) return null;

    const weights = state.config.balance.adjudicationWeights ?? {};

    let plans = [];
    try {
      plans = search(state);
    } catch {
      plans = [];
    }
    // 兜底：静态排序取最优单动作（攻击斩杀 > 撤离 > 部署 > 移动），仍然过预检。
    if (plans.length === 0) {
      const fallbackAction = staticBestAction(state, weights);
      if (fallbackAction) return fallbackAction;
      return null;
    }
    // 预检闸：按排序顺位尝试每份计划的首个动作；先验证再用。
    // 两人局优先「走完整回合」的计划：它们已经把这个回合的结果算清楚，首拍的后续收益是真实可拿的，
    // 而不是"首拍为一条可能走不完的链服务"。多人局不这么做——多人局里对手会插进来改局面，
    // 完整回合计划的假设更容易落空（实测 3 人局第一名率从 86.7% 掉到 81.7%）。
    const complete = state.order.length === 2 ? plans.filter(plan => plan.complete) : [];
    const pool = complete.length > 0 ? complete : plans;
    const tried = new Set();
    const ordered = pool.slice().sort((a, b) => b.value - a.value || a.acts.length - b.acts.length);
    for (const plan of ordered) {
      const first = plan.acts[0];
      // 以「结束回合」开头的计划意味着放弃本回合，不是可执行动作。
      if (!first || first.type === 'end') continue;
      const action = candidateAction(first);
      if (!action) continue;
      const signature = JSON.stringify(action);
      if (tried.has(signature)) continue;
      tried.add(signature);
      const verified = assertLegal(state, action);
      if (!verified) continue;
      return action;
    }
    const fallbackAction = staticBestAction(state, weights);
    if (fallbackAction && assertLegal(state, fallbackAction)) return fallbackAction;
    return null;
  } catch {
    return null;
  }
}

/** 最坏降级：静态排序取一个最像样的合法动作（不搜索）。 */
function staticBestAction(state) {
  const weights = state.config.balance.adjudicationWeights ?? {};
  const params = { attackCands: 2, moveCands: 3, moveAttackCands: 2, deployCands: 2, healCands: 1, demolish: false };
  let candidates;
  try {
    candidates = generateCandidates(state, params);
  } catch {
    candidates = [];
  }
  let best = null;
  let bestValue = -Infinity;
  for (const candidate of candidates) {
    const next = applySearchCandidate(state, candidate);
    if (!next) continue;
    const value = evaluate(next, weights);
    if (value > bestValue) { bestValue = value; best = candidate; }
  }
  if (!best) return null;
  const action = candidateAction(best);
  return action && assertLegal(state, action) ? action : null;
}

export default {
  name: 'shrinkroll',
  description: '歼灭：回合内束搜索 + 缩圈时间线推演 + 轮界裁决投影',
  decide,
};

// 仅供单测的镜像出口（运行时 decide 不依赖它）。
export const __mirror = {
  buildState,
  assertLegal,
  applyEndTurn,
  reachableCells,
  expDamage,
  killProbability,
  multiHitKillProbability,
  safeRadiusFor,
  dangerSet,
  warningSet,
  artilleryForwardPenalty,
  controlScore,
  adjudicationTotal,
  ACE,
  ABLATE,
  // 调试/标定用：与 decide 同一套搜索与评估（不改变运行时行为）。
  search,
  evaluate,
  generateCandidates,
  applySearchCandidate,
  candidateAction,
  // 消融口径：阶梯每一档必须自带 `focusCands`（单步档关掉集火宏，否则"单步"名不副实）。
  beamLadder,
  paramsForLadder,
};



