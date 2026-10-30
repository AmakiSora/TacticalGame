/**
 * AI 竞技场排行榜评分：扫描 arena/matches.jsonl（由 rl/evaluation/round_robin.py 产出，
 * 含 RL 模型与内置算法 AI 的混合对战），Bradley-Terry 评分并写 public/data/arena-leaderboard.json。
 *
 * Usage:
 *   node script/generateArenaLeaderboard.mjs
 *   node script/generateArenaLeaderboard.mjs --stats-file arena/matches.jsonl --out public/data/arena-leaderboard.json
 *
 * 评分口径：
 *   - 参评者两类：RL 模型（id = 模型 zip 文件名，版本内嵌）与内置算法 AI
 *     （id = algo_<注册名>@<版本>，注册表来自 algorithms/registry.mjs，与线上 bot /
 *     评估控制台同源，但带版本以便算法升版后历史战绩仍归属旧版本 id）；
 *   - **按玩法模式隔离评分**：地图的 `mode` 决定对局模式（standard / annihilation /
 *     simultaneous / royale），不同模式玩法不同，绝不进入同一个 BT 池。每个模式内
 *     再池化该模式全部地图，并另按每张图独立评分（局数少，CI 更宽）；
 *   - 作废模型（MODEL_STATUS_BY_VERSION 中 status=retired 的版本）不参评：注册表跳过、
 *     历史对局不计分，跳过局数记入 source.retiredMatchesDropped；
 *   - Bradley-Terry MLE（MM 迭代），平局记 0.5 胜；每对交手过的参与者对附加 1 局虚拟
 *     平局作先验，防全败参与者评分发散并让稀疏对向均值收缩；
 *   - rating = 1500 + 400/ln(10) × ln p（Elo 刻度）；
 *   - 95% CI 用按（参与者对, 地图）分层的有放回 bootstrap，随机数固定种子，输出可复现；
 *   - 分座位（先手/后手）只做展示统计，不进评分。
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { wilsonLower, round2, round4 } from './generateStats.mjs';
import { listAlgorithmInfo, algorithmVersionedId } from '../algorithms/registry.mjs';
import { MODEL_STATUS_BY_VERSION, RETIRED_VERSIONS } from './modelStatus.mjs';

export const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const PROJECT_DIR = dirname(SCRIPT_DIR);

export const DEFAULT_STATS_FILE = join(PROJECT_DIR, 'arena', 'matches.jsonl');
export const DEFAULT_OUT = join(PROJECT_DIR, 'public', 'data', 'arena-leaderboard.json');
export const DEFAULT_MAPS_DIR = join(PROJECT_DIR, 'maps');

/**
 * 竞技场按玩法模式分榜。顺序即前端模式切换条的顺序；不同模式的规则、动作空间与
 * 胜负条件都不同，评分只在同一模式内比较。
 */
export const GAME_MODES = [
  { id: 'standard', label: '标准模式' },
  { id: 'annihilation', label: '歼灭模式' },
  { id: 'simultaneous', label: '同时回合' },
  { id: 'royale', label: '大逃杀' },
];

export const MODE_LABELS = Object.fromEntries(GAME_MODES.map(mode => [mode.id, mode.label]));

/**
 * 读 maps/*.json 的 mode 字段。地图文件名即 mapId；未声明 mode 的地图按 standard
 * 处理（与 src/config/loader.ts 的归一化规则一致）。随机图固定为标准模式，不需要
 * 静态地图文件。
 */
export function loadMapModes(mapsDir = DEFAULT_MAPS_DIR) {
  const modes = new Map([['random', 'standard']]);
  try {
    for (const file of readdirSync(mapsDir)) {
      if (!file.endsWith('.json')) continue;
      const id = file.replace(/\.json$/i, '');
      try {
        const config = JSON.parse(readFileSync(join(mapsDir, file), 'utf8'));
        modes.set(id, typeof config?.mode === 'string' ? config.mode : 'standard');
      } catch {
        // 单张地图损坏不应让整份榜单失败；loadMaps 在服务启动时会单独报错。
        modes.set(id, 'standard');
      }
    }
  } catch {
    // 地图目录不可读时仍可用默认 standard；没有地图信息时所有未知 mapId 按标准模式归类。
  }
  return modes;
}

/**
 * 模型文件名：`hex_ppo_<版本>_<日期>_<步数>.zip`（三段式，2026-09-24 起）。
 *
 * 步数段是**简化写法**（`120K` / `8.8M`，与排行榜展示名 `v2.3.2@340K` 同源同格式），
 * 取自 zip 内 `num_timesteps`（实际交付断点），不是训练目标步数——这样文件名、展示名、
 * zip 内步数三者恒等，`MODEL_DELIVERED_STEPS` 镜像表随之退休。
 *
 * **旧四段式**（`hex_ppo_<版本>_<日期>_<地图>_<对手>_<步数>`）已全面停用；地图/对手两个
 * 字段改由 `MODEL_META_BY_VERSION` 提供（见下），因为它们是**按版本恒定的历史事实**，
 * 放进每个文件名只会让重命名牵连历史数据。
 */
export const MODEL_FILE_RE = /^hex_ppo_(v\d+\.\d+\.\d+)_(\d{8})_(\d+(?:\.\d+)?[KM])\.zip$/i;
export const EXCLUDED_VERSIONS = new Set(['v1.0.0']);

/**
 * 训练地图 / 训练对手：新命名不再携带，改为按版本查表。
 * 数据来源 = 旧四段式文件名（2026-09-24 重命名前逐个记录），是历史事实不是派生量。
 * 未登记的版本（未来新增）两个字段为 null，UI 会显示为空而不是崩溃。
 */
export const MODEL_META_BY_VERSION = {
  'v1.0.0': { trainMap: 'default', opponentType: 'random_opponent' },
  'v2.0.0': { trainMap: 'default', opponentType: 'rule' },
  'v2.1.1': { trainMap: 'default', opponentType: 'rule_mixed' },
  'v2.1.3': { trainMap: 'default', opponentType: 'rule_defensive' },
  'v2.1.4': { trainMap: 'default', opponentType: 'modelmix' },
  'v2.1.5': { trainMap: 'default', opponentType: 'modelmix' },
  'v2.1.6': { trainMap: 'default', opponentType: 'modelmix' },
  'v2.1.8': { trainMap: 'default', opponentType: 'modelmix' },
  'v2.2.0': { trainMap: 'default', opponentType: 'modelmix' },
  'v2.3.1': { trainMap: 'random', opponentType: 'modelmix' },
  'v2.3.2': { trainMap: 'random', opponentType: 'selfplay' },
  'v2.3.3': { trainMap: 'random', opponentType: 'selfplay' },
  'v2.4.0': { trainMap: 'random', opponentType: 'selfplay' },
  'v2.5.0': { trainMap: 'random', opponentType: 'selfplay' },
  'v2.6.0': { trainMap: 'random', opponentType: 'selfplay' },
  'v2.7.0': { trainMap: 'random', opponentType: 'selfplay' },
  'v2.8.0': { trainMap: 'random', opponentType: 'selfplay' },
  'v3.0.0': { trainMap: 'random', opponentType: 'selfplay' },
  'v3.0.1': { trainMap: 'random', opponentType: 'selfplay' },
  'v3.0.2': { trainMap: 'random', opponentType: 'selfplay' },
  'v3.0.3': { trainMap: 'random', opponentType: 'selfplay' },
  'v3.0.4': { trainMap: 'random', opponentType: 'selfplay' },
  'v3.1.0': { trainMap: 'random', opponentType: 'selfplay' },
  'v3.1.1': { trainMap: 'random', opponentType: 'selfplay' },
  'v3.2.0': { trainMap: 'random', opponentType: 'selfplay' },
  'v3.3.0': { trainMap: 'random', opponentType: 'selfplay' },
};

// 作废（retired）名单 MODEL_STATUS_BY_VERSION / RETIRED_VERSIONS 在 script/modelStatus.mjs；
// 本文件只消费。

/** 评估协议已知限制：v2.0.0 观测固定 player_a 视角，坐 player_b 属分布外。 */
export const STATUS_NOTES = {
  'v2.0.0': 'player_b 座位观测失真，成绩仅供参考',
  'v2.3.2': '交付期评估早于 --swap-sides 座位 bug 修复，历史 7:1 成绩属小样本噪声',
};

// MODEL_DELIVERED_STEPS 已退休（2026-09-24）：文件名步数段改为直接写**交付断点**
// （取 zip 内 num_timesteps），文件名、展示名、zip 内步数三者恒等，不再需要镜像覆盖表。
// 历史映射：v2.3.1→70K、v2.3.2→340K、v2.3.3→770K、v2.6.0→3.6M、v2.8.0→4.7M、
// v3.0.0→50K、v3.1.0→100K、v3.1.1→8.8M、v3.2.0→9.8M（均已写入各自新文件名）。

export function parseArgs(argv) {
  const opts = {
    statsFile: DEFAULT_STATS_FILE,
    out: DEFAULT_OUT,
    targetGamesPerPair: 24,
    bootstrap: 1000,
    bootstrapPerMap: 300,
    bootstrapSeed: 20260901,
    mapsDir: DEFAULT_MAPS_DIR,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--stats-file') opts.statsFile = resolve(argv[++i]);
    else if (a === '--out') opts.out = resolve(argv[++i]);
    else if (a === '--target-games') opts.targetGamesPerPair = Number(argv[++i]);
    else if (a === '--bootstrap') opts.bootstrap = Number(argv[++i]);
    else if (a === '--bootstrap-per-map') opts.bootstrapPerMap = Number(argv[++i]);
    else if (a === '--seed') opts.bootstrapSeed = Number(argv[++i]);
    else if (a === '--models-dir') opts.modelsDir = resolve(argv[++i]);
    else if (a === '--maps-dir') opts.mapsDir = resolve(argv[++i]);
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node script/generateArenaLeaderboard.mjs [--stats-file f] [--out f] [--target-games n] [--bootstrap n] [--bootstrap-per-map n] [--seed n] [--models-dir d] [--maps-dir d]');
      process.exit(0);
    }
  }
  return opts;
}

/**
 * 文件名步数段的**权威解析**（`120K` → 120000、`8.8M` → 8800000）。
 * 与 `shortName` 的格式化公式互为逆运算，round-trip 由测试钉死。
 */
export function parseStepTag(raw) {
  if (typeof raw !== 'string') return null;
  const m = raw.match(/^(\d+(?:\.\d+)?)([KM])$/i);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * (m[2].toUpperCase() === 'M' ? 1_000_000 : 1_000));
}

/** 解析模型文件名：hex_ppo_<版本>_<日期>_<步数>.zip。地图/对手查 MODEL_META_BY_VERSION。 */
export function parseModelFile(fileName) {
  const m = fileName.match(MODEL_FILE_RE);
  if (!m) return null;
  const [, version, trainDate, stepsRaw] = m;
  const meta = MODEL_META_BY_VERSION[version] ?? { trainMap: null, opponentType: null };
  return {
    id: fileName,
    version,
    trainDate,
    trainMap: meta.trainMap,
    opponentType: meta.opponentType,
    // 现有 RL 训练环境只覆盖标准模式；未来若出现同时/歼灭模型，在 MODEL_META_BY_VERSION
    // 里显式加 modes 即可，历史对局仍按实际地图模式归档。
    modes: Array.isArray(meta.modes) && meta.modes.length ? meta.modes : ['standard'],
    steps: parseStepTag(stepsRaw),
  };
}

export function shortName(meta) {
  if (!meta) return null;
  const steps = meta.deliveredSteps ?? meta.steps;
  if (steps == null) return meta.version;
  return steps >= 1_000_000
    ? `${meta.version}@${Number((steps / 1_000_000).toFixed(1))}M`
    : `${meta.version}@${Math.round(steps / 1000)}K`;
}

/**
 * 注册合法玩家名与"未参评"清单来源：rl/models/*.zip（kind=model）+ 内置算法
 * （kind=algorithm，来自 algorithms/registry.mjs）。作废版本（RETIRED_VERSIONS）
 * 直接跳过：不注册、不进"未参评"区（排行榜任何区域都不展示），其历史对局由 loadMatches 单独过滤。
 */
export function collectRegistry(modelsDir, algorithms = listAlgorithmInfo()) {
  const registry = new Map();
  const excluded = [];
  let files = [];
  try {
    files = readdirSync(modelsDir);
  } catch {
    // 模型目录不可读只是少了模型参与者，算法照常注册（如纯算法环境的开发机）。
    registryAlgorithms(registry, algorithms);
    return { registry, excluded, warning: `cannot read ${modelsDir}` };
  }
  for (const f of files) {
    if (!f.endsWith('.zip')) continue;
    const meta = parseModelFile(f);
    if (!meta) continue;
    if (RETIRED_VERSIONS.has(meta.version)) continue;
    registry.set(meta.id, { ...meta, deliveredSteps: meta.steps, kind: 'model' });
    if (EXCLUDED_VERSIONS.has(meta.version)) {
      excluded.push({ id: meta.id, version: meta.version, reason: '512 动作旧格式，评估脚本不支持进程内互打' });
    }
  }
  registryAlgorithms(registry, algorithms);
  excluded.sort((a, b) => a.id.localeCompare(b.id));
  return { registry, excluded, warning: null };
}

function registryAlgorithms(registry, algorithms) {
  for (const info of algorithms) {
    // 参与者 id 带版本（algo_<name>@<v1>），算法升版后历史对局仍归属旧版本 id。
    const id = algorithmVersionedId(info.name);
    registry.set(id, {
      id, kind: 'algorithm', name: info.name, displayName: info.displayName,
      description: info.description, version: info.version,
      modes: Array.isArray(info.modes) && info.modes.length ? info.modes : ['standard'],
    });
  }
}

/** matches.jsonl 行的 per-seat 数值字段（decisionSec/decisionCount 等）→ 数值表；缺失记 null。 */
function numericSeatMap(value) {
  return ['player_a', 'player_b'].reduce((o, seat) => {
    const v = value?.[seat];
    o[seat] = Number.isFinite(v) ? v : null;
    return o;
  }, {});
}

/**
 * 读 JSONL，丢弃玩家名不在注册表/格式非法的行；作废模型（已归档）的对局不计分，
 * 按 retiredDropped 计数。mapModes 为 mapId → 玩法模式；未知地图按 standard 归类。
 */
export function loadMatches(statsFile, registry, mapModes = new Map()) {
  const matches = [];
  const warnings = [];
  let retiredDropped = 0;
  if (!existsSync(statsFile)) {
    warnings.push(`stats file not found: ${statsFile}`);
    return { matches, warnings, retiredDropped };
  }
  const lines = readFileSync(statsFile, 'utf8').split('\n');
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx].trim();
    if (!line) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      warnings.push(`line ${idx + 1}: invalid JSON`);
      continue;
    }
    const players = record?.players;
    if (!players || typeof players !== 'object' || Object.keys(players).length !== 2) {
      warnings.push(`line ${idx + 1}: players must have exactly 2 entries`);
      continue;
    }
    const a = players.player_a;
    const b = players.player_b;
    if (!a || !b) {
      warnings.push(`line ${idx + 1}: players must be player_a/player_b`);
      continue;
    }
    // 作废模型的文件已归档出 rl/models，正常不会出现在注册表；这里按文件名版本兜底过滤，
    // 避免 zip 被拷回主目录或历史 JSONL 恢复后作废对局重新计入评分。
    if ([a, b].some(name => RETIRED_VERSIONS.has(parseModelFile(name)?.version))) {
      retiredDropped += 1;
      continue;
    }
    if (!registry.has(a) || !registry.has(b)) {
      warnings.push(`line ${idx + 1}: unknown participant name(s): ${[a, b].filter(n => !registry.has(n)).join(', ')}`);
      continue;
    }
    if (a === b) {
      warnings.push(`line ${idx + 1}: same participant on both seats`);
      continue;
    }
    const map = typeof record.map === 'string' ? record.map : 'unknown';
    matches.push({
      ts: record.ts ?? null,
      map,
      // 历史 JSONL 没有 mode 字段；以地图配置为准，未知地图按 standard 兼容。
      mode: mapModes.get(map) ?? 'standard',
      playerA: a,
      playerB: b,
      winner: record.winner === 'draw' || registry.has(record.winner) ? record.winner : null,
      rounds: Number.isFinite(record.rounds) ? record.rounds : null,
      // 决策耗时 2026-10-25 起随 evaluate_cross 写入；旧记录为 null，聚合时跳过。
      decisionSec: numericSeatMap(record.decisionSec),
      decisionCount: numericSeatMap(record.decisionCount),
    });
  }
  return { matches, warnings, retiredDropped };
}

/**
 * Bradley-Terry MLE（MM 迭代）。pairs: [{i, j, wi, n}]，wi = i 的得分（胜 + 0.5·平，
 * 含先验），n = 交手局数（含先验）。返回每模型的 ln p（几何均值归一）。
 */
export function solveBT(pairs, nModels, maxIter = 200, tol = 1e-6) {
  const W = new Float64Array(nModels);
  for (const pr of pairs) {
    W[pr.i] += pr.wi;
    W[pr.j] += pr.n - pr.wi;
  }
  let lnP = new Float64Array(nModels);
  for (let iter = 0; iter < maxIter; iter++) {
    const denom = new Float64Array(nModels);
    for (const pr of pairs) {
      const d = pr.n / (Math.exp(lnP[pr.i]) + Math.exp(lnP[pr.j]));
      denom[pr.i] += d;
      denom[pr.j] += d;
    }
    const next = new Float64Array(nModels);
    let mean = 0;
    for (let m = 0; m < nModels; m++) {
      const p = denom[m] > 0 ? W[m] / denom[m] : 1;
      next[m] = Math.log(p);
      mean += next[m];
    }
    mean /= nModels;
    let delta = 0;
    for (let m = 0; m < nModels; m++) {
      next[m] -= mean;
      const d = Math.abs(next[m] - lnP[m]);
      if (d > delta) delta = d;
    }
    lnP = next;
    if (delta < tol) break;
  }
  return lnP;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** 把共享的 strata（(pair,map) → 结果名数组）建好，所有池的 bootstrap 复用。 */
export function buildStrata(matches) {
  const strata = new Map();
  for (const g of matches) {
    const key = `${pairKey(g.playerA, g.playerB)}|${g.map}`;
    let arr = strata.get(key);
    if (!arr) { arr = []; strata.set(key, arr); }
    arr.push(g.winner ?? 'draw');
  }
  return strata;
}

const EMPTY_TALLY = () => ({ games: 0, wins: 0, draws: 0 });

/**
 * 聚合一个地图池的对局并评分。games: 该池对局；ids/indexOf: 参评模型；
 * strata: 跨池共享的 bootstrap 分层。返回 { overview, models, h2h }。
 */
export function buildLeague(games, ids, indexOf, strata, bootstrapN, rngFactory) {
  const n = ids.length;
  const pairAgg = new Map();
  // 先手（player_a 座）胜率：地图平衡第一指标（2026-10-30 起输出）。
  let firstSeatWins = 0, firstSeatGames = 0;
  const perModel = new Map(ids.map(id => [id, {
    games: 0, wins: 0, losses: 0, draws: 0,
    firstSeat: { games: 0, wins: 0 }, secondSeat: { games: 0, wins: 0 },
    roundsSum: 0, roundsCount: 0,
    decisionSum: 0, decisionCount: 0,
    vs: new Map(), perMap: new Map(),
  }]));

  for (const g of games) {
    const key = pairKey(g.playerA, g.playerB);
    let agg = pairAgg.get(key);
    if (!agg) {
      const [x, y] = key.split('|');
      agg = { x, y, aScore: 0, games: 0, aWins: 0, bWins: 0, draws: 0,
              xFirstGames: 0, xFirstWins: 0, xSecondGames: 0, xSecondWins: 0 };
      pairAgg.set(key, agg);
    }
    agg.games += 1;
    // 先手胜率 + 同对子换座（x 坐先手/后手）表现：检测先手依赖与地图对称性。
    firstSeatGames += 1;
    if (g.winner === g.playerA) firstSeatWins += 1;
    if (g.playerA === agg.x) {
      agg.xFirstGames += 1;
      if (g.winner === agg.x) agg.xFirstWins += 1;
    } else {
      agg.xSecondGames += 1;
      if (g.winner === agg.x) agg.xSecondWins += 1;
    }

    const mA = perModel.get(g.playerA);
    const mB = perModel.get(g.playerB);
    for (const [model, oppId] of [[mA, g.playerB], [mB, g.playerA]]) {
      model.games += 1;
      let v = model.vs.get(oppId);
      if (!v) { v = EMPTY_TALLY(); model.vs.set(oppId, v); }
      v.games += 1;
      let pm = model.perMap.get(g.map);
      if (!pm) { pm = EMPTY_TALLY(); model.perMap.set(g.map, pm); }
      pm.games += 1;
      if (g.rounds != null) { model.roundsSum += g.rounds; model.roundsCount += 1; }
    }
    for (const [model, sec, count] of [
      [mA, g.decisionSec?.player_a, g.decisionCount?.player_a],
      [mB, g.decisionSec?.player_b, g.decisionCount?.player_b],
    ]) {
      if (sec != null && count != null && count > 0) {
        model.decisionSum += sec;
        model.decisionCount += count;
      }
    }
    mA.firstSeat.games += 1;
    mB.secondSeat.games += 1;

    if (g.winner === 'draw' || g.winner == null) {
      agg.draws += 1;
      agg.aScore += 0.5;
      mA.draws += 1; mB.draws += 1;
      mA.vs.get(g.playerB).draws += 1; mB.vs.get(g.playerA).draws += 1;
      mA.perMap.get(g.map).draws += 1; mB.perMap.get(g.map).draws += 1;
    } else {
      const winnerIsSeatA = g.winner === g.playerA;
      const winner = winnerIsSeatA ? mA : mB;
      const loser = winnerIsSeatA ? mB : mA;
      winner.wins += 1;
      loser.losses += 1;
      winner.vs.get(loser === mA ? g.playerA : g.playerB).wins += 1;
      winner.perMap.get(g.map).wins += 1;
      if (winnerIsSeatA) winner.firstSeat.wins += 1;
      else winner.secondSeat.wins += 1;
      if (g.winner === agg.x) { agg.aWins += 1; agg.aScore += 1; }
      else agg.bWins += 1;
    }
  }

  // 先验：每个真实交手对附加 1 局虚拟平局（双方各 +0.5 分）。
  const pairs = [...pairAgg.values()].map(p => ({
    i: indexOf.get(p.x), j: indexOf.get(p.y),
    wi: p.aScore + 0.5, n: p.games + 1,
  }));
  const lnP = n > 0 ? solveBT(pairs, n) : new Float64Array(0);
  const ratings = lnP.map(ln => 1500 + 400 / Math.LN10 * ln);

  // Bootstrap：按（对, 图）分层重采样该池的全部对局。
  const leagueStrataKeys = new Set(games.map(g => `${pairKey(g.playerA, g.playerB)}|${g.map}`));
  const strataList = [...leagueStrataKeys].map(key => ({ key, outcomes: strata.get(key) }));
  const bootstrap = ids.map(() => []);
  if (bootstrapN > 0 && strataList.length > 0) {
    const rng = rngFactory();
    for (let b = 0; b < bootstrapN; b++) {
      const pairsB = [];
      for (const { key, outcomes } of strataList) {
        const [x, y] = key.split('|');
        const len = outcomes.length;
        let aScore = 0;
        for (let s = 0; s < len; s++) {
          const outcome = outcomes[(rng() * len) | 0];
          if (outcome === x) aScore += 1;
          else if (outcome === 'draw') aScore += 0.5;
        }
        pairsB.push({ i: indexOf.get(x), j: indexOf.get(y), wi: aScore + 0.5, n: len + 1 });
      }
      const lnPB = solveBT(pairsB, n, 100, 1e-5);
      for (let m = 0; m < n; m++) bootstrap[m].push(1500 + 400 / Math.LN10 * lnPB[m]);
    }
    for (const samples of bootstrap) samples.sort((a, b) => a - b);
  }

  const draws = games.filter(g => g.winner === 'draw' || g.winner == null).length;
  const roundsGames = games.filter(g => g.rounds != null);
  const totalRounds = roundsGames.reduce((s, g) => s + g.rounds, 0);

  const models = ids.map((id, m) => {
    const s = perModel.get(id);
    const samples = bootstrap[m];
    return {
      id,
      rating: s.games > 0 ? Math.round(ratings[m]) : null,
      ratingLo: s.games > 0 && samples.length > 0 ? Math.round(quantile(samples, 0.025)) : null,
      ratingHi: s.games > 0 && samples.length > 0 ? Math.round(quantile(samples, 0.975)) : null,
      wilson: s.games > 0 ? round4(wilsonLower(s.wins + s.draws * 0.5, s.games)) : null,
      games: s.games,
      wins: s.wins,
      losses: s.losses,
      draws: s.draws,
      winRate: s.games > 0 ? round4(s.wins / s.games) : null,
      firstSeat: {
        games: s.firstSeat.games,
        winRate: s.firstSeat.games > 0 ? round4(s.firstSeat.wins / s.firstSeat.games) : null,
      },
      secondSeat: {
        games: s.secondSeat.games,
        winRate: s.secondSeat.games > 0 ? round4(s.secondSeat.wins / s.secondSeat.games) : null,
      },
      avgRounds: s.roundsCount > 0 ? round2(s.roundsSum / s.roundsCount) : null,
      avgDecisionMs: s.decisionCount > 0 ? round2(s.decisionSum / s.decisionCount * 1000) : null,
      vs: Object.fromEntries([...s.vs.entries()].map(([opp, v]) => [opp, {
        games: v.games, wins: v.wins, draws: v.draws,
        winRate: v.games > 0 ? round4((v.wins + v.draws * 0.5) / v.games) : null,
      }])),
      perMap: Object.fromEntries([...s.perMap.entries()].map(([map, v]) => [map, {
        games: v.games, wins: v.wins, draws: v.draws,
        winRate: v.games > 0 ? round4((v.wins + v.draws * 0.5) / v.games) : null,
      }])),
    };
  });

  const h2h = [...pairAgg.values()]
    .map(p => ({
      a: p.x, b: p.y, games: p.games, aWins: p.aWins, bWins: p.bWins, draws: p.draws,
      // 换座表现：a 坐先手/后手的胜率 + 换座胜率差（正 = 先手强，负 = 后手强）。
      aFirstWinRate: p.xFirstGames > 0 ? round4(p.xFirstWins / p.xFirstGames) : null,
      aSecondWinRate: p.xSecondGames > 0 ? round4(p.xSecondWins / p.xSecondGames) : null,
      aSeatSwing: p.xFirstGames > 0 && p.xSecondGames > 0
        ? round4(p.xFirstWins / p.xFirstGames - p.xSecondWins / p.xSecondGames) : null,
    }))
    .sort((x, y) => y.games - x.games || x.a.localeCompare(y.a));

  return {
    overview: {
      games: games.length,
      pairCount: pairAgg.size,
      draws,
      drawRate: games.length > 0 ? round4(draws / games.length) : null,
      avgRounds: roundsGames.length > 0 ? round2(totalRounds / roundsGames.length) : null,
      // 该池（模式或单图）的先手胜率：偏离 0.5 越远先手优势越大。
      firstSeatWinRate: firstSeatGames > 0 ? round4(firstSeatWins / firstSeatGames) : null,
    },
    models,
    h2h,
  };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { registry, excluded, warning } = collectRegistry(opts.modelsDir ?? join(PROJECT_DIR, 'rl', 'models'));
  const warnings = warning ? [warning] : [];
  const mapModes = loadMapModes(opts.mapsDir);
  const { matches, warnings: loadWarnings, retiredDropped } = loadMatches(opts.statsFile, registry, mapModes);
  warnings.push(...loadWarnings);

  const allIds = [...registry.keys()]
    .filter(id => !EXCLUDED_VERSIONS.has(registry.get(id).version))
    .sort();
  const strata = buildStrata(matches);

  const maps = [...new Set(matches.map(m => m.map))].sort();
  const modes = GAME_MODES.map(modeMeta => {
    const modeMatches = matches.filter(m => m.mode === modeMeta.id);
    const actualIds = new Set(modeMatches.flatMap(m => [m.playerA, m.playerB]));
    // 只让声明支持该模式的参与者进榜；历史对局里出现过的参与者即使元数据没标 modes
    // 也保留，避免旧数据因注册表升级而被静默丢出榜单。
    const ids = allIds.filter(id => {
      const meta = registry.get(id);
      return (Array.isArray(meta.modes) && meta.modes.includes(modeMeta.id)) || actualIds.has(id);
    });
    const indexOf = new Map(ids.map((id, i) => [id, i]));
    const modeMaps = [...new Set(modeMatches.map(m => m.map))].sort();
    const leagues = {
      all: buildLeague(modeMatches, ids, indexOf, strata, opts.bootstrap, () => mulberry32(opts.bootstrapSeed)),
    };
    for (const map of modeMaps) {
      leagues[map] = buildLeague(
        modeMatches.filter(m => m.map === map), ids, indexOf, strata,
        opts.bootstrapPerMap, () => mulberry32(opts.bootstrapSeed),
      );
    }
    return {
      id: modeMeta.id,
      label: modeMeta.label,
      games: modeMatches.length,
      maps: leagues,
    };
  // 只保留本批对局里真实出现过的模式：注册表声明了某模式、但一局都没打过的基线
  // （如刚接入歼灭/大逃杀、尚未跑批的 random）不应在页面上开一个 0 局的空榜。
  }).filter(mode => mode.games > 0);

  const registryMeta = Object.fromEntries([...registry.entries()].map(([id, meta]) => [id, meta.kind === 'algorithm' ? {
    kind: 'algorithm',
    short: meta.displayName,
    algorithm: meta.name,
    version: meta.version,
    description: meta.description,
    modes: meta.modes,
    status: 'builtin',
    statusNote: null,
  } : {
    kind: 'model',
    short: shortName(meta),
    version: meta.version,
    trainDate: meta.trainDate,
    trainMap: meta.trainMap,
    opponentType: meta.opponentType,
    modes: meta.modes,
    steps: meta.steps,
    deliveredSteps: meta.deliveredSteps ?? null,
    status: MODEL_STATUS_BY_VERSION[meta.version] ?? 'legacy',
    statusNote: STATUS_NOTES[meta.version] ?? null,
  }]));

  const tsList = matches.map(m => m.ts).filter(Boolean).sort();
  const payload = {
    generatedAt: new Date().toISOString(),
    ratingMethod: {
      model: 'Bradley-Terry MLE (MM iteration), draw = 0.5 win',
      scope: 'per game mode; modes are never pooled together',
      prior: '1 virtual draw per played pair',
      scale: 'Elo: 1500 + 400/ln(10) * ln p',
      ci: `stratified bootstrap by (pair,map) within each mode: ${opts.bootstrap} draws for mode / ${opts.bootstrapPerMap} per map, seed ${opts.bootstrapSeed}`,
    },
    source: {
      file: opts.statsFile,
      matchCount: matches.length,
      retiredMatchesDropped: retiredDropped,
      mapDist: Object.fromEntries(maps.map(map => [map, matches.filter(m => m.map === map).length])),
      modeDist: Object.fromEntries(GAME_MODES.map(meta => [meta.id, matches.filter(m => m.mode === meta.id).length])),
      targetGamesPerPair: opts.targetGamesPerPair,
      dateMin: tsList[0] ?? null,
      dateMax: tsList[tsList.length - 1] ?? null,
    },
    registry: registryMeta,
    modes,
    excluded,
    warnings,
  };

  mkdirSync(dirname(opts.out), { recursive: true });
  writeFileSync(opts.out, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`Wrote ${opts.out} — ${matches.length} matches, ${modes.length} mode league(s), ${allIds.length} registered participants` +
    (retiredDropped > 0 ? `（另跳过作废模型对局 ${retiredDropped} 局）` : ''));

  for (const mode of modes) {
    const rows = mode.maps.all.models.filter(m => m.games > 0)
      .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    console.log(`Top ratings (${mode.label}, all maps):`);
    if (!rows.length) {
      console.log('  （暂无该模式对局）');
      continue;
    }
    rows.forEach((row, i) => {
      const short = registryMeta[row.id].short;
      const ci = row.ratingLo != null ? ` ±${Math.max(row.rating - row.ratingLo, row.ratingHi - row.rating)}` : '';
      console.log(`  #${i + 1} ${short.padEnd(14)} rating=${row.rating}${ci}  ${row.wins}W/${row.losses}L/${row.draws}D  games=${row.games}`);
    });
  }
  if (warnings.length) {
    console.warn(`Warnings (${warnings.length}):`);
    for (const w of warnings.slice(0, 10)) console.warn(`  - ${w}`);
    if (warnings.length > 10) console.warn(`  ... and ${warnings.length - 10} more`);
  }
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) main();
