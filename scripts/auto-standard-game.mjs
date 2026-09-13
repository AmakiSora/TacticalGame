#!/usr/bin/env node
// 标准模式（game.config.mode === "standard"）自动游玩脚本。
//
// 目标：把 skill/SKILL.md + skill/standard.md 里描述的决策顺序，落地成一个
// 单进程可以直接跑起来的自动游玩脚本。默认开一局 2 人 default 地图对局，
// 由脚本分别扮演 player_a 与 player_b 自动打完（"人机 vs 人机"演示）；
// 也支持 --human-side 把其中一席交给真人（"人机 1v1"）。
//
// 用法（Node >= 24，纯 ESM，无第三方依赖）：
//   node scripts/auto-standard-game.mjs --url http://localhost:3100
//   node scripts/auto-standard-game.mjs --url http://localhost:3100 --map desert --players 2 --human-side a
//   node scripts/auto-standard-game.mjs --url http://localhost:3100 --game <gameId> --side b --token <token>
//
// 与 skill/ai-player.mjs 的差异：
//   * 单进程驱动多个席位，无需开多个终端。
//   * 严格只在 mode === "standard" 下运行；歼灭/同时回合需读对应 skill 文件。
//   * 内建 rate_limit 退避（429 会等待而不是立刻重试）。

import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const DEFAULT_URL = process.env.TACTICAL_GAME_URL || '';
const PLAYER_IDS = ['player_a', 'player_b', 'player_c', 'player_d', 'player_e', 'player_f', 'player_g', 'player_h'];
const HEX_DIRS = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

function parseArgs(argv) {
  const args = {
    url: DEFAULT_URL,
    map: 'default',
    players: 2,
    humanSide: '',          // 空字符串 = 全 AI；'a'..'h' = 那一席交给真人
    namePrefix: 'Auto',
    maxTurns: 120,          // 每个席位最多处理的回合数
    delayMs: 250,           // 主循环轮询间隔毫秒
    actionGapMs: 60,        // 同一回合内动作之间的间隔毫秒（避免 429）
    rateLimitRetryMs: 1500, // 遇到 429 时的基础退避
    game: '',
    side: '',
    token: '',
    hostToken: '',
    quiet: false,
  };
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    const val = () => argv[++i];
    if (arg === '--url') args.url = val();
    else if (arg === '--map') args.map = val();
    else if (arg === '--players') args.players = Number(val());
    else if (arg === '--human-side') args.humanSide = val();
    else if (arg === '--name-prefix') args.namePrefix = val();
    else if (arg === '--max-turns') args.maxTurns = Number(val());
    else if (arg === '--delay-ms') args.delayMs = Number(val());
    else if (arg === '--action-gap-ms') args.actionGapMs = Number(val());
    else if (arg === '--rate-limit-retry-ms') args.rateLimitRetryMs = Number(val());
    else if (arg === '--game') args.game = val();
    else if (arg === '--side') args.side = val();
    else if (arg === '--token') args.token = val();
    else if (arg === '--host-token') args.hostToken = val();
    else if (arg === '--quiet') args.quiet = true;
    else if (arg === '--help' || arg === '-h') { printHelp(); process.exit(0); }
    else throw new Error(`Unknown argument: ${arg}`);
    i++;
  }
  if (!args.url) throw new Error('--url is required (or set TACTICAL_GAME_URL)');
  args.url = args.url.replace(/\/+$/, '');
  if (!Number.isInteger(args.players) || args.players < 2 || args.players > 8) {
    throw new Error('--players must be an integer between 2 and 8');
  }
  if (!Number.isFinite(args.maxTurns) || args.maxTurns < 1) throw new Error('--max-turns must be >= 1');
  if (!Number.isFinite(args.delayMs) || args.delayMs < 0) throw new Error('--delay-ms must be >= 0');
  if (args.humanSide) args.humanSide = normalizeSeat(args.humanSide);
  if (args.side) args.side = normalizeSeat(args.side);
  return args;
}

function printHelp() {
  console.log(`TacticalGame 标准模式自动游玩脚本

用法：
  node scripts/auto-standard-game.mjs --url <serverUrl> [选项]

常用示例：
  # 双 AI 打完整局 default 地图
  node scripts/auto-standard-game.mjs --url http://localhost:3100

  # 一席真人（浏览器手动）+ 脚本扮演对手
  node scripts/auto-standard-game.mjs --url http://localhost:3100 --human-side a

  # 连入既有对局、只扮演某一席
  node scripts/auto-standard-game.mjs --url http://localhost:3100 \\
    --game <gameId> --side b --token <playerToken>

选项：
  --url <url>                  API 基地址，必需（或设置 TACTICAL_GAME_URL）
  --map <mapId>                新建对局的地图，默认 default
  --players <n>                新建对局的房间人数 2-8，默认 2
  --human-side <a-h>           把那一席交给真人操作（脚本扮演其余席位）
  --name-prefix <s>            AI 名字前缀，默认 Auto
  --max-turns <n>              每席位最多处理多少个己方回合，默认 120
  --delay-ms <n>               主循环轮询间隔毫秒，默认 250
  --action-gap-ms <n>          同一回合内动作间隔毫秒，默认 60
  --rate-limit-retry-ms <n>    遇到 429 的退避基数，默认 1500
  --game <id>                  加入既有对局（与 --side --token 一起用）
  --side <a-h|player_x>        席位身份
  --token <token>              席位 token
  --host-token <token>         房主 token（用于自动 /start）
  --quiet                      少打印日志
`);
}

function normalizeSeat(side) {
  if (PLAYER_IDS.includes(side)) return side;
  if (/^[a-h]$/.test(side)) return `player_${side}`;
  throw new Error(`--side/--human-side must be a-h or player_a..player_h, got "${side}"`);
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
const sleep = ms => new Promise(r => setTimeout(r, ms));
let logQuiet = false;
const log = (...a) => { if (!logQuiet) console.log(...a); };
const logErr = (...a) => console.error(...a);

async function request(baseUrl, method, path, body, playerToken, hostToken, opts = {}) {
  const { rateLimitRetryMs = 1500, retries = 3 } = opts;
  for (let attempt = 0; ; attempt++) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (playerToken) headers['X-Player-Token'] = playerToken;
    if (hostToken) headers['X-Host-Token'] = hostToken;
    const res = await fetch(`${baseUrl}${path}`, {
      method, headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (res.ok) return data;
    if (res.status === 429 && attempt < retries) {
      const wait = rateLimitRetryMs * (attempt + 1);
      log(`  rate_limit, wait ${wait}ms`);
      await sleep(wait);
      continue;
    }
    const err = new Error(
      `${method} ${path} -> ${res.status}${data?.code ? ` ${data.code}` : ''}${data?.error ? `: ${data.error}` : ''}`
    );
    err.status = res.status;
    err.code = data?.code;
    err.data = data;
    throw err;
  }
}

const api = {
  ready: (u) => request(u, 'GET', '/readyz'),
  maps: (u) => request(u, 'GET', '/api/maps'),
  createGame: (u, b) => request(u, 'POST', '/api/games', b),
  joinGame: (u, g, b) => request(u, 'POST', `/api/games/${g}/join`, b),
  lobby: (u, g) => request(u, 'GET', `/api/games/${g}/lobby`),
  start: (u, g, ht) => request(u, 'POST', `/api/games/${g}/start`, {}, undefined, ht),
  state: (u, g, t) => request(u, 'GET', `/api/games/${g}`, undefined, t),
  deploy: (u, g, b, t) => request(u, 'POST', `/api/games/${g}/deploy`, b, t),
  move: (u, g, b, t) => request(u, 'POST', `/api/games/${g}/move`, b, t),
  attack: (u, g, b, t) => request(u, 'POST', `/api/games/${g}/attack`, b, t),
  heal: (u, g, b, t) => request(u, 'POST', `/api/games/${g}/heal`, b, t),
  demolish: (u, g, b, t) => request(u, 'POST', `/api/games/${g}/demolish`, b, t),
  endTurn: (u, g, t) => request(u, 'POST', `/api/games/${g}/end-turn`, {}, t),
};

// ---------------------------------------------------------------------------
// 几何
// ---------------------------------------------------------------------------
const key = p => `${p.q},${p.r}`;
function hexDistance(a, b) {
  const dq = a.q - b.q, dr = a.r - b.r;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(-a.q - a.r - (-b.q - b.r)));
}
function neighbors(p) { return HEX_DIRS.map(d => ({ q: p.q + d.q, r: p.r + d.r })); }
function isPlayable(game, p) { return game.cells.some(c => c.q === p.q && c.r === p.r); }
function terrainAt(game, p) {
  const override = game.map.terrainCells.find(c => c.q === p.q && c.r === p.r);
  if (override) return override.terrain;
  return game.cells.find(c => c.q === p.q && c.r === p.r)?.terrain || 'blocker';
}
function occupantAt(game, p) {
  const u = game.units.find(x => x.alive && x.q === p.q && x.r === p.r);
  if (u) return { kind: 'unit', entity: u };
  const hq = Object.values(game.headquarters || {}).find(h => h.alive && h.q === p.q && h.r === p.r);
  if (hq) return { kind: 'headquarters', entity: hq };
  return null;
}
const isEmptyPlain = (game, p) => isPlayable(game, p) && terrainAt(game, p) === 'plain' && occupantAt(game, p) === null;

function reachableCells(game, unit) {
  const visited = new Set([key(unit)]);
  const out = [];
  const queue = [{ p: { q: unit.q, r: unit.r }, d: 0 }];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    if (cur.d >= unit.moveRange) continue;
    for (const n of neighbors(cur.p)) {
      const k = key(n);
      if (visited.has(k)) continue;
      visited.add(k);
      if (!isEmptyPlain(game, n)) continue;
      out.push(n);
      queue.push({ p: n, d: cur.d + 1 });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 局内状态
// ---------------------------------------------------------------------------
function livingUnits(game, owner) { return game.units.filter(u => u.alive && u.owner === owner); }
function activeSeats(game) {
  if (game.players) return PLAYER_IDS.filter(id => game.players[id]?.status === 'active');
  return Object.keys(game.headquarters || {}).filter(id => game.headquarters[id]?.alive !== false);
}
function enemySeats(game, owner) { return activeSeats(game).filter(id => id !== owner); }
function actionsPerTurn(game) { return game.config?.balance?.actionsPerTurn ?? 5; }
function actionsRemaining(game) { return Math.max(0, actionsPerTurn(game) - (game.turn?.actionsUsed ?? 0)); }
function cpKindEffect(game, point) {
  if (!point?.kind) return null;
  return game.config?.balance?.controlPointTypes?.[point.kind] || null;
}
function effectiveDeployCost(game, type, origin) {
  const base = game.config.units[type].cost;
  return Math.max(0, base - (cpKindEffect(game, origin)?.deployDiscount || 0));
}
function deployOrigins(game, owner) {
  const ownHq = game.headquarters?.[owner];
  const cps = (game.controlPoints || []).filter(cp => cp.owner === owner);
  return [ownHq, ...cps].filter(o => o && o.alive !== false);
}

// ---------------------------------------------------------------------------
// 打分（简化自 skill/standard.md 决策顺序）
// ---------------------------------------------------------------------------
const UNIT_VALUE = { support: 500, ranger: 420, scout: 350, infantry: 320, heavy: 180 };

function scoreTarget(target) {
  if (target.kind === 'headquarters') return 10000 - target.entity.hp;
  const u = target.entity;
  const heavyPenalty = u.type === 'heavy' && u.hp > 80 ? 180 : 0;
  return (UNIT_VALUE[u.type] || 0) + (u.maxHp - u.hp) * 4 - u.hp - heavyPenalty;
}
function enemyTargets(game, owner) {
  const enemies = enemySeats(game, owner);
  return [
    ...game.units.filter(u => u.alive && enemies.includes(u.owner)).map(u => ({ kind: 'unit', entity: u })),
    ...enemies.map(id => ({ kind: 'headquarters', entity: game.headquarters[id] })).filter(t => t.entity?.alive),
  ];
}
function bestAttackTarget(game, owner, unit) {
  return enemyTargets(game, owner)
    .filter(t => hexDistance(unit, t.entity) <= unit.attackRange)
    .sort((a, b) => scoreTarget(b) - scoreTarget(a))[0];
}
function nearestEnemyHeadquarters(game, owner, from) {
  return enemySeats(game, owner)
    .map(id => game.headquarters[id]).filter(Boolean)
    .sort((a, b) => hexDistance(from, a) - hexDistance(from, b))[0] || null;
}
function controlPriority(game, cp) {
  const effect = cpKindEffect(game, cp);
  if (!effect) return 8;
  if (cp.kind === 'supply') return 16;
  if (cp.kind === 'forward_base') return 13;
  if (cp.kind === 'repair') return 11;
  return effect.income || 8;
}

function movementGoal(game, owner, unit) {
  const ownedCps = (game.controlPoints || []).filter(cp => cp.owner === owner).length;
  const turnNo = game.turn?.turnNumber ?? 1;
  const enemyHq = nearestEnemyHeadquarters(game, owner, unit);

  // 晚期：直接压最近敌方 HQ（scout/ranger/infantry）
  if (enemyHq && (turnNo >= 8 || ownedCps >= 3) && ['scout', 'ranger', 'infantry'].includes(unit.type)) {
    return enemyHq;
  }
  // 中期：先补据点
  if (unit.canCapture) {
    const cp = (game.controlPoints || [])
      .filter(cp => cp.owner !== owner)
      .sort((a, b) => (controlPriority(game, b) - hexDistance(unit, b)) - (controlPriority(game, a) - hexDistance(unit, a)))[0];
    if (cp) return cp;
  }
  if (unit.type === 'ranger' && (unit.attackRange ?? 0) > 1) {
    const enemies = enemySeats(game, owner);
    const target = game.units.filter(u => u.alive && enemies.includes(u.owner))
      .sort((a, b) => scoreTarget({ kind: 'unit', entity: b }) - scoreTarget({ kind: 'unit', entity: a }))[0];
    if (target) return target;
  }
  return enemyHq || { q: 0, r: 0 };
}

function shouldDeploy(game, owner) {
  if (actionsRemaining(game) <= 0) return false;
  const ownedCps = (game.controlPoints || []).filter(cp => cp.owner === owner).length;
  const myArmy = livingUnits(game, owner).length;
  const enemyArmy = enemySeats(game, owner).reduce((s, id) => s + livingUnits(game, id).length, 0);
  const supplies = game.resources?.[owner]?.supplies ?? 0;
  return supplies >= 90 || myArmy <= enemyArmy || ownedCps >= 2 || (game.turn?.turnNumber ?? 0) >= 8;
}
function pickDeployType(game, owner, origins) {
  const supplies = game.resources?.[owner]?.supplies ?? 0;
  const friendly = livingUnits(game, owner);
  const counts = {};
  for (const u of friendly) counts[u.type] = (counts[u.type] || 0) + 1;
  const damaged = friendly.filter(u => u.hp < u.maxHp * 0.65).length;
  const order = [];
  if (damaged >= 2 && (counts.support || 0) < 2) order.push('support');
  if ((game.turn?.turnNumber ?? 1) <= 3) order.push('scout', 'infantry');
  order.push('ranger', 'heavy', 'infantry', 'scout', 'support');
  return order.find(type =>
    game.config.units[type] && origins.some(origin => supplies >= effectiveDeployCost(game, type, origin))
  ) || null;
}

// ---------------------------------------------------------------------------
// 单个动作（每次调用最多发一次请求，且刷新 game）
// ---------------------------------------------------------------------------
const ACTION_RESULT = { ACTED: 'acted', SKIPPED: 'skipped', FAIL: 'fail' };

async function refresh(seat) {
  return api.state(seat.url, seat.gameId, seat.token);
}
async function emit(seat, label) {
  if (seat.args.actionGapMs > 0) await sleep(seat.args.actionGapMs);
  log(label);
}

async function tryAttack(game, seat) {
  const owner = seat.owner;
  for (const unit of livingUnits(game, owner)) {
    if (unit.hasActed) continue;
    const target = bestAttackTarget(game, owner, unit);
    if (!target) continue;
    await api.attack(seat.url, seat.gameId, { attackerId: unit.id, targetId: target.entity.id }, seat.token);
    emit(seat, `  [${owner}] ${target.kind === 'headquarters' ? 'attack HQ' : 'attack ' + target.entity.type} (${unit.type}#${unit.id} -> ${target.entity.id})`);
    return { game: await refresh(seat), result: ACTION_RESULT.ACTED };
  }
  return { game, result: ACTION_RESULT.SKIPPED };
}

async function tryHeal(game, seat) {
  const owner = seat.owner;
  for (const support of livingUnits(game, owner).filter(u => u.type === 'support' && !u.hasActed)) {
    const wounded = livingUnits(game, owner)
      .filter(u => u.id !== support.id && u.hp < u.maxHp && hexDistance(support, u) <= support.attackRange)
      .sort((a, b) => (b.maxHp - b.hp) - (a.maxHp - a.hp))[0];
    if (!wounded) continue;
    await api.heal(seat.url, seat.gameId, { supportId: support.id, targetId: wounded.id }, seat.token);
    emit(seat, `  [${owner}] heal (${support.id} -> ${wounded.id})`);
    return { game: await refresh(seat), result: ACTION_RESULT.ACTED };
  }
  return { game, result: ACTION_RESULT.SKIPPED };
}

async function tryDemolish(game, seat) {
  const owner = seat.owner;
  if ((game.turn?.turnNumber ?? 1) < 6) return { game, result: ACTION_RESULT.SKIPPED };
  for (const heavy of livingUnits(game, owner).filter(u => u.type === 'heavy' && !u.hasActed)) {
    const target = neighbors(heavy).find(p =>
      isPlayable(game, p) && terrainAt(game, p) === 'blocker' && occupantAt(game, p) === null);
    if (!target) continue;
    await api.demolish(seat.url, seat.gameId, { unitId: heavy.id, q: target.q, r: target.r }, seat.token);
    emit(seat, `  [${owner}] demolish at ${target.q},${target.r} (${heavy.id})`);
    return { game: await refresh(seat), result: ACTION_RESULT.ACTED };
  }
  return { game, result: ACTION_RESULT.SKIPPED };
}

async function tryDeploy(game, seat) {
  if (!shouldDeploy(game, seat.owner)) return { game, result: ACTION_RESULT.SKIPPED };
  const origins = deployOrigins(game, seat.owner);
  if (!origins.length) return { game, result: ACTION_RESULT.SKIPPED };
  const type = pickDeployType(game, seat.owner, origins);
  if (!type) return { game, result: ACTION_RESULT.SKIPPED };
  const supplies = game.resources?.[seat.owner]?.supplies ?? 0;
  const enemyHq = nearestEnemyHeadquarters(game, seat.owner, origins[0]) || { q: 0, r: 0 };
  const candidates = [];
  for (const origin of origins) {
    const cost = effectiveDeployCost(game, type, origin);
    if (supplies < cost) continue;
    for (const p of neighbors(origin)) {
      if (!isEmptyPlain(game, p)) continue;
      candidates.push({ origin, p, d: hexDistance(p, enemyHq), cost });
    }
  }
  candidates.sort((a, b) => a.d - b.d || a.cost - b.cost);
  const pick = candidates[0];
  if (!pick) return { game, result: ACTION_RESULT.SKIPPED };
  await api.deploy(seat.url, seat.gameId, { unitType: type, fromId: pick.origin.id, q: pick.p.q, r: pick.p.r }, seat.token);
  emit(seat, `  [${seat.owner}] deploy ${type} at ${pick.p.q},${pick.p.r} (cost ${pick.cost})`);
  return { game: await refresh(seat), result: ACTION_RESULT.ACTED };
}

async function tryMove(game, seat) {
  const owner = seat.owner;
  const budget = actionsRemaining(game);
  const activatedCount = livingUnits(game, owner).filter(u => u.actionSpent).length;
  // 每个已激活的单位（含新部署的）都可以免费移动；未激活的单位需消耗 1 AP。
  const movable = livingUnits(game, owner)
    .filter(u => !u.hasMoved)
    .filter(u => u.actionSpent || budget > 0);
  // 已激活（actionSpent）的单位先动，它们不需要再花 AP。
  movable.sort((a, b) => Number(b.actionSpent) - Number(a.actionSpent));
  const taken = new Set(livingUnits(game, owner).map(u => key(u)));
  for (const unit of movable) {
    const reachable = reachableCells(game, unit).filter(p => !taken.has(key(p)));
    if (!reachable.length) continue;
    const goal = movementGoal(game, owner, unit);
    const before = hexDistance(unit, goal);
    // 优先走到能立刻站上中立/敌方据点的格子
    const cpReach = unit.canCapture
      ? reachable.find(p => (game.controlPoints || []).some(cp => cp.q === p.q && cp.r === p.r && cp.owner !== owner))
      : null;
    const stepPos = cpReach || (reachable
      .map(p => ({ p, d: hexDistance(p, goal) }))
      .sort((a, b) => a.d - b.d)[0]?.p);
    if (!stepPos) continue;
    if (!cpReach) {
      const dAfter = hexDistance(stepPos, goal);
      if (dAfter >= before) continue;
    }
    taken.delete(key(unit));
    taken.add(key(stepPos));
    await api.move(seat.url, seat.gameId, { unitId: unit.id, q: stepPos.q, r: stepPos.r }, seat.token);
    emit(seat, `  [${owner}] move ${unit.type}#${unit.id} -> ${stepPos.q},${stepPos.r}${cpReach ? ' (capturing CP)' : ''}`);
    return { game: await refresh(seat), result: ACTION_RESULT.ACTED };
  }
  return { game, result: ACTION_RESULT.SKIPPED };
}

// ---------------------------------------------------------------------------
// 单回合
// ---------------------------------------------------------------------------
async function playOneTurn(initial, seat) {
  const turnNo = gameTurnNumber(initial);
  let game = initial;
  let worked = false;
  const attempts = [];
  // 阶段 1：攻击/治疗/爆破优先（这些不会带来纯移动，先做）
  // 阶段 2：策略部署
  // 阶段 3：剩余单位推进
  const order = [
    ['attack', tryAttack],
    ['heal', tryHeal],
    ['demolish', tryDemolish],
    ['deploy', tryDeploy],
    ['move', tryMove],
  ];
  for (let guard = 0; guard < 40; guard++) {
    if (game.winner || game.phase === 'game_over') return game;
    let acted = false;
    for (const [name, fn] of order) {
      if (attempts.includes(name) && (attempts[name] || 0) >= 2 && name !== 'move') {
        // 允许同一阶段重跑两次，避免一次失败就把整回合锁死
      }
      attempts[name] = (attempts[name] || 0) + 1;
      try {
        const res = await fn(game, seat);
        game = res.game;
        if (res.result === ACTION_RESULT.ACTED) { worked = acted = true; break; }
      } catch (err) {
        logErr(`  action ${name} failed: ${err.message}`);
      }
    }
    if (!acted) break;
  }
  if (!game.winner && game.phase !== 'game_over') {
    await api.endTurn(seat.url, seat.gameId, seat.token);
    log(`[${seat.owner}] end-turn (R${turnNo}${worked ? '' : ', no useful action'})`);
  }
  return game;
}

function gameTurnNumber(game) { return game.turn?.turnNumber ?? game.turn?.roundNumber ?? 1; }

// ---------------------------------------------------------------------------
// 席位创建 / 恢复
// ---------------------------------------------------------------------------
function seatName(prefix, seat) {
  const idx = PLAYER_IDS.indexOf(seat);
  return `${prefix} ${String.fromCharCode(65 + (idx < 0 ? 0 : idx))}`;
}

async function createLobbyAndJoin(args) {
  const { maps } = await api.maps(args.url);
  const map = maps.find(m => m.id === args.map || m.mapId === args.map);
  if (!map) throw new Error(`Map "${args.map}" not found on ${args.url}`);
  const mapMode = map.preview?.mode || map.mode || 'standard';
  if (mapMode !== 'standard') {
    throw new Error(`Map "${args.map}" is mode="${mapMode}", this script only runs standard`);
  }

  const created = await api.createGame(args.url, {
    mapId: args.map,
    maxPlayers: args.players,
    participate: true,
    playerName: args.humanSide === 'player_a' ? 'Human A' : seatName(args.namePrefix, 'player_a'),
  });
  if (!created.gameId || !created.hostToken || !created.player) throw new Error('createGame failed');
  const seats = [{
    owner: created.player.id, token: created.player.token,
    gameId: created.gameId, url: args.url, args,
  }];

  const human = args.humanSide;
  for (let i = 1; i < args.players; i++) {
    const seat = PLAYER_IDS[i];
    if (human === seat) continue;
    const name = seatName(args.namePrefix, seat);
    const joined = await api.joinGame(args.url, created.gameId, { name });
    if (!joined.player?.token) throw new Error(`join failed for ${seat}`);
    seats.push({ owner: joined.player.id, token: joined.player.token, gameId: created.gameId, url: args.url, args });
    log(`Joined ${joined.player.id} as "${name}"`);
  }
  if (human) {
    log(`Seat ${human} reserved for human; script acts only on: ${seats.map(s => s.owner).join(', ')}`);
  }
  return { gameId: created.gameId, hostToken: created.hostToken, seats, url: args.url };
}

async function loadExisting(args) {
  if (!args.game || !args.side || !args.token) throw new Error('--game/--side/--token required in --game mode');
  const game = await api.state(args.url, args.game, args.token);
  if (game.config?.mode && game.config.mode !== 'standard') {
    throw new Error(`Existing game is mode="${game.config.mode}", this script only runs standard`);
  }
  return {
    gameId: args.game, hostToken: args.hostToken || '',
    seats: [{ owner: args.side, token: args.token, gameId: args.game, url: args.url, args }],
    url: args.url,
  };
}

async function startWhenReady(args, { gameId, hostToken, seats }) {
  const human = args.humanSide;
  let empty = 0;
  while (true) {
    const lobby = await api.lobby(args.url, gameId);
    if (lobby.phase !== 'lobby') return true;
    const count = lobby.playerCount ?? seats.length;
    if (count >= args.players) {
      try {
        await api.start(args.url, gameId, hostToken);
        log(`Started game ${gameId} with ${count} players`);
        return true;
      } catch (err) {
        if (err.code === 'game_already_started') return true;
        logErr(`start failed: ${err.message}`);
      }
    } else {
      empty++;
      if (empty % 20 === 0) {
        log(`Waiting for players: ${count}/${args.players}${human ? ` (human=${human})` : ''}`);
      }
      await sleep(Math.max(args.delayMs * 4, 500));
    }
  }
}

// ---------------------------------------------------------------------------
// 主循环
// ---------------------------------------------------------------------------
async function run(args, world) {
  const counters = new Map(world.seats.map(s => [s.owner, 0]));
  let idleRounds = 0;
  while (idleRounds < 300) {
    let anyAction = false;
    for (const seat of world.seats) {
      if ((counters.get(seat.owner) || 0) >= args.maxTurns) continue;
      let game;
      try {
        game = await api.state(args.url, seat.gameId, seat.token);
      } catch (err) {
        logErr(`state fetch failed for ${seat.owner}: ${err.message}`);
        break;
      }
      if (game.winner || game.phase === 'game_over') {
        log(`Game over. Winner: ${game.winner ?? '(draw)'}`);
        return summarize(game);
      }
      if (game.phase !== 'active') continue;
      const self = game.players?.[seat.owner];
      if (self?.status && self.status !== 'active') {
        log(`Seat ${seat.owner} eliminated (status=${self.status})`);
        continue;
      }
      const current = game.turn?.currentPlayerId ?? game.turn?.currentOwner;
      if (current !== seat.owner) continue;
      try {
        await playOneTurn(game, seat);
        counters.set(seat.owner, (counters.get(seat.owner) || 0) + 1);
        anyAction = true;
      } catch (err) {
        logErr(`Turn failed for ${seat.owner}: ${err.message}`);
      }
    }
    if (!anyAction) {
      idleRounds++;
      await sleep(Math.max(args.delayMs, 200));
    } else {
      idleRounds = 0;
      await sleep(args.delayMs);
    }
  }
  log('Stopped after long idle.');
  return null;
}

function summarize(game) {
  const w = game.winner || 'draw';
  const adj = game.adjudication?.scores || {};
  log(`\n--- Final ---`);
  log(`winner=${w}  phase=${game.phase}`);
  for (const [id, s] of Object.entries(adj)) {
    if (!s) continue;
    log(`  ${id}: total=${s.total}  cp=${s.controlPoints}  hqHp=${s.ownHqHp}  dmg=${s.headquartersDamage}  army=${s.armyValue}  supplies=${s.supplies}  action=${s.actionScore}`);
  }
  return { winner: w, scores: adj };
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  logQuiet = args.quiet;
  await api.ready(args.url);
  log(`TacticalGame 标准模式自动游玩 · ${args.url}`);

  const world = args.game ? await loadExisting(args) : await createLobbyAndJoin(args);
  log(`Game ${world.gameId} (map=${args.map}, seats=${world.seats.length}${args.humanSide ? `, human=${args.humanSide}` : ''})`);

  if (!args.game && args.players > 1) await startWhenReady(args, world);

  const outcome = await run(args, world);
  log(outcome ? `Result: ${JSON.stringify(outcome)}` : 'Stopped without a definitive result.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}
