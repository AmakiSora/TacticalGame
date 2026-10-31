/**
 * Scan arena/matches.jsonl (produced by rl/evaluation/round_robin.py),
 * aggregate gameplay stats & participant profiles, write public/data/arena-stats.json.
 * 与 generateArenaLeaderboard.mjs 配套：榜单管「谁强」，本脚本管「怎么打」。
 *
 * Usage:
 *   node script/generateArenaStats.mjs
 *   node script/generateArenaStats.mjs --stats-file arena/matches.jsonl --out public/data/arena-stats.json
 *
 * 口径与排行榜一致：
 *   - 玩法统计按地图 mode 分模式聚合，页面切换模式后才读取对应 gameplay；
 *   - 作废模型（RETIRED_VERSIONS）不参与：对局整局丢弃并计数；
 *   - EXCLUDED_VERSIONS（v1.0.0，512 动作旧格式）不进玩法统计，对局按 formatDropped 计数；
 *   - 参与者档案（RL 模型 + 内置算法）的评分/胜率合并自 public/data/arena-leaderboard.json
 *     （先跑榜单脚本再跑本脚本）；
 *   - 模型档案文案解析自 rl/docs/MODELS_NOTES.md 的状态总表与作废表（markdown 表格，格式变化时
 *     只留 warning 不炸脚本，对应模型的说明字段留空）；算法档案文案来自 algorithms/registry.mjs。
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  collectRegistry,
  parseModelFile,
  shortName,
  STATUS_NOTES,
  EXCLUDED_VERSIONS,
  GAME_MODES,
  DEFAULT_MAPS_DIR,
  loadMapModes,
} from './generateArenaLeaderboard.mjs';
import { MODEL_STATUS_BY_VERSION, RETIRED_VERSIONS } from './modelStatus.mjs';
import { round2, round4 } from './generateStats.mjs';

export const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const PROJECT_DIR = dirname(SCRIPT_DIR);

export const DEFAULT_STATS_FILE = join(PROJECT_DIR, 'arena', 'matches.jsonl');
export const DEFAULT_OUT = join(PROJECT_DIR, 'public', 'data', 'arena-stats.json');
export const DEFAULT_NOTES_FILE = join(PROJECT_DIR, 'rl', 'docs', 'MODELS_NOTES.md');
export const DEFAULT_LEADERBOARD_FILE = join(PROJECT_DIR, 'public', 'data', 'arena-leaderboard.json');

export function parseArgs(argv) {
  const opts = {
    statsFile: DEFAULT_STATS_FILE,
    out: DEFAULT_OUT,
    notesFile: DEFAULT_NOTES_FILE,
    leaderboardFile: DEFAULT_LEADERBOARD_FILE,
    mapsDir: DEFAULT_MAPS_DIR,
    // 默认从本地 detail 补玩法明细（裁决分项 / 动作分布 / 控制点易手）；--no-details 跳过。
    details: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--stats-file') opts.statsFile = resolve(argv[++i]);
    else if (a === '--out') opts.out = resolve(argv[++i]);
    else if (a === '--notes') opts.notesFile = resolve(argv[++i]);
    else if (a === '--leaderboard') opts.leaderboardFile = resolve(argv[++i]);
    else if (a === '--models-dir') opts.modelsDir = resolve(argv[++i]);
    else if (a === '--maps-dir') opts.mapsDir = resolve(argv[++i]);
    else if (a === '--no-details') opts.details = false;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node script/generateArenaStats.mjs [--stats-file f] [--out f] [--notes f] [--leaderboard f] [--models-dir d] [--maps-dir d] [--no-details]');
      process.exit(0);
    }
  }
  return opts;
}

/**
 * 读 JSONL 并保留玩法统计所需字段（derived/scores/actions/durationSec/endReason）。
 * 过滤规则与 generateArenaLeaderboard.loadMatches 一致：作废模型整局丢弃（retiredDropped），
 * 玩家不在注册表/同模型对局的行记入 warnings；另把 EXCLUDED_VERSIONS 参与的对局按
 * formatDropped 丢弃（旧格式模型的打法与现役协议不可比）。
 */
export function loadMatchDetails(statsFile, registry, mapModes = new Map()) {
  const matches = [];
  const warnings = [];
  let retiredDropped = 0;
  let formatDropped = 0;
  if (!existsSync(statsFile)) {
    warnings.push(`stats file not found: ${statsFile}`);
    return { matches, warnings, retiredDropped, formatDropped };
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
    if ([a, b].some(name => RETIRED_VERSIONS.has(parseModelFile(name)?.version))) {
      retiredDropped += 1;
      continue;
    }
    if (!registry.has(a) || !registry.has(b)) {
      warnings.push(`line ${idx + 1}: unknown model name(s): ${[a, b].filter(n => !registry.has(n)).join(', ')}`);
      continue;
    }
    if (a === b) {
      warnings.push(`line ${idx + 1}: same model on both seats`);
      continue;
    }
    if ([a, b].some(name => EXCLUDED_VERSIONS.has(registry.get(name)?.version))) {
      formatDropped += 1;
      continue;
    }
    const seat = side => {
      const d = record?.derived?.[side] ?? null;
      const sec = record?.decisionSec?.[side];
      const count = record?.decisionCount?.[side];
      const sb = record?.scoreBreakdown?.[side];
      const ap = record?.actionProfile?.[side];
      const ps = record?.policyStats?.[side];
      return {
        score: Number.isFinite(record?.scores?.[side]) ? record.scores[side] : null,
        actions: Number.isFinite(record?.actions?.[side]) ? record.actions[side] : null,
        // 决策耗时 2026-10-25 起随 evaluate_cross 写入；旧记录为 null，聚合时跳过。
        decisionSec: Number.isFinite(sec) ? sec : null,
        decisionCount: Number.isFinite(count) ? count : null,
        derived: d && typeof d === 'object' ? d : null,
        // 2026-10-30 起采集的汇总结论；旧记录缺失时记 null，聚合端跳过。
        // 逐动作 / 逐点序列等明细只在 arena/details/（gitignored），不进摘要行。
        scoreBreakdown: sb && typeof sb === 'object' ? sb : null,
        actionProfile: ap && typeof ap === 'object' ? ap : null,
        policyStats: ps && typeof ps === 'object' ? ps : null,
      };
    };
    const map = typeof record.map === 'string' ? record.map : 'unknown';
    const cps = record?.controlPoints;
    matches.push({
      ts: record.ts ?? null,
      map,
      mode: mapModes.get(map) ?? 'standard',
      playerA: a,
      playerB: b,
      winner: record.winner === 'draw' || registry.has(record.winner) ? record.winner : null,
      rounds: Number.isFinite(record.rounds) ? record.rounds : null,
      endReason: typeof record.endReason === 'string' ? record.endReason : 'unknown',
      durationSec: Number.isFinite(record.durationSec) ? record.durationSec : null,
      seatA: seat('player_a'),
      seatB: seat('player_b'),
      // 明细文件定位键：matches.jsonl 不存玩法明细，靠它从本地 detail 派生。
      // 静态图 mapSeed 为 null，故以批内 gameIndex 为主键、seed 兜底。
      detailFile: typeof record.detailFile === 'string' ? record.detailFile : null,
      gameIndex: Number.isFinite(record.gameIndex) ? record.gameIndex : null,
      seed: typeof record.seed === 'string' ? record.seed : null,
      // 控制点易手历史（2026-10-30 起采集）；旧记录 null。
      controlPoints: cps && typeof cps === 'object' ? cps : null,
    });
  }
  return { matches, warnings, retiredDropped, formatDropped };
}

/**
 * 从单局 detail（arena/details/*.jsonl 的一行）派生玩法明细。与旧版 evaluate_cross
 * 直接写进 matches.jsonl 的口径一致，但改为聚合时按需提取：
 *   - scoreBreakdown：final.scores 去掉 total（scores 已存总分）；
 *   - actionProfile：actions 汇总（类型分布 / 被拒 / 强制结束）。`fallback` 是 runner
 *     补偿的 end_turn，没有对应决策，不计动作次数、只让 rejected 加一；
 *   - controlPoints：events 里 control_point_captured 的总易手 / 总占领；
 *   - policyStats：actions 的 value/entropy 均值与标准差（仅 --policy-stats 批次有样本）。
 */
export function deriveDetailStats(detail) {
  const seats = ['player_a', 'player_b'];
  const scoreBreakdown = {};
  for (const seat of seats) {
    const raw = detail?.final?.scores?.[seat] ?? {};
    scoreBreakdown[seat] = Object.fromEntries(Object.entries(raw).filter(([k]) => k !== 'total'));
  }
  const actionProfile = {};
  const policySamples = {};
  for (const seat of seats) {
    actionProfile[seat] = { byType: {}, total: 0 };
    policySamples[seat] = [];
  }
  for (const entry of detail?.actions ?? []) {
    const p = actionProfile[entry.seat];
    if (!p) continue;
    if (!entry.fallback) {
      p.total += 1;
      const type = entry.action?.type;
      if (type) p.byType[type] = (p.byType[type] ?? 0) + 1;
    }
    if (entry.failed || entry.error) p.rejected = (p.rejected ?? 0) + 1;
    if (entry.forced) p.forcedEndTurn = (p.forcedEndTurn ?? 0) + 1;
    if (Number.isFinite(entry.value) && Number.isFinite(entry.entropy)) {
      policySamples[entry.seat]?.push([entry.value, entry.entropy]);
    }
  }
  let flips = 0, captures = 0;
  for (const event of detail?.events ?? []) {
    if (event.type !== 'control_point_captured') continue;
    const payload = event.payload ?? {};
    if (!payload.owner) continue;
    captures += 1;
    if (payload.previousOwner && payload.previousOwner !== payload.owner) flips += 1;
  }
  const policyStats = {};
  for (const seat of seats) {
    const pairs = policySamples[seat];
    if (!pairs.length) { policyStats[seat] = null; continue; }
    const n = pairs.length;
    const vMean = pairs.reduce((s, x) => s + x[0], 0) / n;
    const eMean = pairs.reduce((s, x) => s + x[1], 0) / n;
    const vStd = Math.sqrt(pairs.reduce((s, x) => s + (x[0] - vMean) ** 2, 0) / n);
    const eStd = Math.sqrt(pairs.reduce((s, x) => s + (x[1] - eMean) ** 2, 0) / n);
    policyStats[seat] = {
      samples: n,
      valueMean: round4(vMean), valueStd: round4(vStd),
      entropyMean: round4(eMean), entropyStd: round4(eStd),
    };
  }
  return {
    scoreBreakdown,
    actionProfile,
    controlPoints: { totalFlips: flips, totalCaptures: captures },
    policyStats: Object.values(policyStats).some(Boolean) ? policyStats : null,
  };
}

/**
 * 明细定位键：优先批内 gameIndex（静态图 mapSeed 为 null 时唯一可用），seed 兜底。
 * matches.jsonl 与 detail 两侧用同一套键。
 */
function detailKeyOf(file, gameIndex, seed) {
  if (!file) return null;
  if (gameIndex != null) return `${file}|#${gameIndex}`;
  if (seed) return `${file}|${seed}`;
  return null;
}

/**
 * 按 (detailFile, gameIndex) 从本地明细目录批量派生玩法明细。
 * detail 是 gitignored 的本地文件：缺失（换机器 / CI / 已清理）时静默跳过，
 * 对应对局的玩法统计降级为 null——arena-stats.json 一旦生成即入 git，不受影响。
 */
export function loadDetailDerived(matches) {
  const byKey = new Map();
  const needed = new Map(); // detailFile -> Set(定位键)
  for (const m of matches) {
    const key = detailKeyOf(m.detailFile, m.gameIndex, m.seed);
    if (!key) continue;
    if (!needed.has(m.detailFile)) needed.set(m.detailFile, new Set());
    needed.get(m.detailFile).add(key);
  }
  let filesRead = 0, gamesMatched = 0;
  for (const [file, keys] of needed) {
    let text;
    try {
      text = readFileSync(join(PROJECT_DIR, file), 'utf8');
    } catch {
      continue;
    }
    filesRead += 1;
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let detail;
      try { detail = JSON.parse(line); } catch { continue; }
      // detail 侧同时登记 gameIndex 与 seed 两种键：旧 matches 只有 seed、
      // 新版有 gameIndex，按各自具备的键都能命中同一局。
      const gKey = detail?.meta?.gameIndex != null ? `${file}|#${detail.meta.gameIndex}` : null;
      const sKey = detail?.meta?.mapSeed ? `${file}|${detail.meta.mapSeed}` : null;
      const hitG = gKey && keys.has(gKey);
      const hitS = sKey && keys.has(sKey);
      if (!hitG && !hitS) continue;
      const stats = deriveDetailStats(detail);
      if (hitG) byKey.set(gKey, stats);
      if (hitS) byKey.set(sKey, stats);
      gamesMatched += 1;
    }
  }
  return { byKey, filesRead, gamesMatched };
}

/** 把 detail 派生的玩法明细补进 matches（原地）。已带同名字段的记录不覆盖。 */
export function enrichWithDetails(matches) {
  const { byKey, filesRead, gamesMatched } = loadDetailDerived(matches);
  let enriched = 0;
  for (const g of matches) {
    const key = detailKeyOf(g.detailFile, g.gameIndex, g.seed);
    if (!key) continue;
    const d = byKey.get(key);
    if (!d) continue;
    if (!g.seatA.scoreBreakdown) g.seatA.scoreBreakdown = d.scoreBreakdown.player_a;
    if (!g.seatB.scoreBreakdown) g.seatB.scoreBreakdown = d.scoreBreakdown.player_b;
    if (!g.seatA.actionProfile) g.seatA.actionProfile = d.actionProfile.player_a;
    if (!g.seatB.actionProfile) g.seatB.actionProfile = d.actionProfile.player_b;
    if (!g.seatA.policyStats) g.seatA.policyStats = d.policyStats?.player_a ?? null;
    if (!g.seatB.policyStats) g.seatB.policyStats = d.policyStats?.player_b ?? null;
    if (!g.controlPoints) g.controlPoints = d.controlPoints;
    enriched += 1;
  }
  return { filesRead, gamesMatched, enriched };
}

const ROUNDS_BUCKETS = [
  { label: '≤9', min: -Infinity, max: 9 },
  { label: '10–14', min: 10, max: 14 },
  { label: '15–19', min: 15, max: 19 },
  { label: '20–24', min: 20, max: 24 },
  { label: '25–29', min: 25, max: 29 },
  { label: '30（打满）', min: 30, max: Infinity },
];

const DURATION_BUCKETS = [
  { label: '<1s', min: -Infinity, max: 1 },
  { label: '1–2s', min: 1, max: 2 },
  { label: '2–3s', min: 2, max: 3 },
  { label: '3–5s', min: 3, max: 5 },
  { label: '5–10s', min: 5, max: 10 },
  { label: '≥10s', min: 10, max: Infinity },
];

// 决策单步耗时分布（毫秒）：区分计算型（MCTS/搜索类，随局面复杂度涨）与
// 查表型（随机/贪心，恒定毫秒级），均值会把这两类抹平。
const DECISION_MS_BUCKETS = [
  { label: '<1ms', min: -Infinity, max: 1 },
  { label: '1–5ms', min: 1, max: 5 },
  { label: '5–20ms', min: 5, max: 20 },
  { label: '20–100ms', min: 20, max: 100 },
  { label: '100ms–1s', min: 100, max: 1000 },
  { label: '≥1s', min: 1000, max: Infinity },
];

// 裁决分项的 7 个构成键（不含 total，total 由 scoreSum 单独聚合）：
// 推 HQ / 保 HQ / 控点 / 控点持有 / 军队价值 / 补给 / 击杀价值。
const SCORE_BREAKDOWN_KEYS = ['headquartersDamage', 'ownHqHp', 'controlPoints', 'controlHold', 'armyValue', 'supplies', 'killValue'];

/**
 * 桶为左闭右开 [min, max)，末桶闭区间兜底——相邻桶在边界值上只归一侧，
 * 避免 1.0s 同时落在 '<1s' 与 '1–2s' 两个标签的范围内。
 */
function histogram(values, defs) {
  const counts = defs.map(() => 0);
  let matched = 0;
  for (const v of values) {
    const i = defs.findIndex((b, idx) =>
      v >= b.min && (idx === defs.length - 1 ? v <= b.max : v < b.max));
    if (i >= 0) { counts[i] += 1; matched += 1; }
  }
  return defs.map((b, i) => ({
    bucket: b.label,
    count: counts[i],
    pct: matched > 0 ? round4(counts[i] / matched) : null,
  }));
}

/** 裁决 7 分项累计 → 均值对象；无样本返回 null（旧数据整批缺失时出 null 而非 0）。 */
function scoreBreakdownMeans(sb, count) {
  if (!count) return null;
  const out = {};
  for (const key of SCORE_BREAKDOWN_KEYS) out[key] = round2((sb[key] ?? 0) / count);
  return out;
}

/** 动作类型计数 → 占比对象（分母为动作总数）；无样本返回 null。 */
function actionMixShare(byType, total) {
  if (!total) return null;
  return Object.fromEntries(
    Object.entries(byType ?? {}).map(([type, count]) => [type, round4(count / total)]),
  );
}

const sumInto = (target, src) => {
  for (const [k, v] of Object.entries(src ?? {})) {
    if (Number.isFinite(v)) target[k] = (target[k] ?? 0) + v;
  }
};
const sumValues = obj => Object.values(obj ?? {}).reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);

/** 聚合全部对局的玩法统计。matches 为 loadMatchDetails 的输出。 */
export function aggregateGameplay(matches) {
  const endReasonCount = new Map();
  const roundsValues = [];
  const durationValues = [];
  let draws = 0;
  let actionsSum = 0, actionsCount = 0;

  const unitsDeploys = {};
  const unitsLosses = {};

  // 经济体征按「模型-局」（每个座位一条）平均。
  let seatCount = 0;
  let incomeSum = 0, incomeControlSum = 0, deployCostSum = 0;
  let capturesSum = 0, stealsSum = 0;
  let firstCaptureSum = 0, firstCaptureCount = 0;
  let comebackSeats = 0;

  // 2026-10-30 起采集的新维度（旧数据缺失，逐项守卫）：
  // - 裁决 7 分项（全局累计）→ 每模式胜负主导因素
  // - 动作画像（类型分布/被拒/强制结束/意图）→ 打法风格
  // - 决策单步耗时分布 → 区分计算型 vs 查表型
  // - 控制点易手 → 地图争夺强度
  const globalSb = {}; let globalSbCount = 0;
  const globalActionTypes = {}; let globalActionTotal = 0, globalActionRejected = 0, globalActionForced = 0;
  const decisionMsValues = [];
  let globalFlipsSum = 0, globalFlipsCount = 0;

  const perModel = new Map();
  const perMap = new Map();

  const modelAgg = id => {
    let m = perModel.get(id);
    if (!m) {
      m = {
        games: 0, wins: 0, losses: 0, draws: 0,
        scoreSum: 0, scoreCount: 0,
        damageDealt: 0, damageTaken: 0, kills: 0, lossesByType: 0,
        captures: 0, steals: 0, income: 0,
        firstCaptureSum: 0, firstCaptureCount: 0,
        decisionSum: 0, decisionCount: 0,
        deploysByType: {},
        sb: {}, sbCount: 0,
        actionTypes: {}, actionTotal: 0, actionRejected: 0, actionForced: 0,
        policyValueSum: 0, policyValueCount: 0, policyEntropySum: 0, policyEntropyCount: 0,
      };
      perModel.set(id, m);
    }
    return m;
  };
  const mapAgg = map => {
    let m = perMap.get(map);
    if (!m) {
      m = { games: 0, draws: 0, annihilations: 0, roundsSum: 0, roundsCount: 0, durationSum: 0, durationCount: 0, endReasons: new Map(),
            firstSeatWins: 0, firstSeatGames: 0, flipsSum: 0, flipsCount: 0 };
      perMap.set(map, m);
    }
    return m;
  };

  for (const g of matches) {
    endReasonCount.set(g.endReason, (endReasonCount.get(g.endReason) ?? 0) + 1);
    const isDraw = g.winner === 'draw' || g.winner == null;
    if (isDraw) draws += 1;
    if (g.rounds != null) roundsValues.push(g.rounds);
    if (g.durationSec != null) durationValues.push(g.durationSec);
    if (g.seatA.actions != null && g.seatB.actions != null) {
      actionsSum += g.seatA.actions + g.seatB.actions;
      actionsCount += 1;
    }

    const mm = mapAgg(g.map);
    mm.games += 1;
    if (isDraw) mm.draws += 1;
    if (g.endReason === 'last_player_standing') mm.annihilations += 1;
    if (g.rounds != null) { mm.roundsSum += g.rounds; mm.roundsCount += 1; }
    if (g.durationSec != null) { mm.durationSum += g.durationSec; mm.durationCount += 1; }
    mm.endReasons.set(g.endReason, (mm.endReasons.get(g.endReason) ?? 0) + 1);
    // 先手（player_a 座）胜率：地图平衡第一指标。
    mm.firstSeatGames += 1;
    if (g.winner === g.playerA) mm.firstSeatWins += 1;
    // 控制点易手：地图争夺强度。
    if (Number.isFinite(g.controlPoints?.totalFlips)) {
      mm.flipsSum += g.controlPoints.totalFlips; mm.flipsCount += 1;
      globalFlipsSum += g.controlPoints.totalFlips; globalFlipsCount += 1;
    }
    // 决策单步耗时（两座合并按局均值计，供全局分桶）：区分计算型 vs 查表型。
    const dc = (g.seatA.decisionCount ?? 0) + (g.seatB.decisionCount ?? 0);
    if (dc > 0 && g.seatA.decisionSec != null && g.seatB.decisionSec != null) {
      decisionMsValues.push((g.seatA.decisionSec + g.seatB.decisionSec) / dc * 1000);
    }

    for (const [id, seat, won, lost] of [
      [g.playerA, g.seatA, g.winner === g.playerA, g.winner === g.playerB],
      [g.playerB, g.seatB, g.winner === g.playerB, g.winner === g.playerA],
    ]) {
      const m = modelAgg(id);
      m.games += 1;
      if (won) m.wins += 1;
      else if (lost) m.losses += 1;
      else m.draws += 1;
      if (seat.score != null) { m.scoreSum += seat.score; m.scoreCount += 1; }
      // 决策计时独立于 derived，先于 derived 缺失短路聚合。
      if (seat.decisionSec != null && seat.decisionCount != null && seat.decisionCount > 0) {
        m.decisionSum += seat.decisionSec;
        m.decisionCount += seat.decisionCount;
      }
      // 裁决 7 分项累计（终局快照；旧数据无此字段，逐项守卫）。
      if (seat.scoreBreakdown) {
        for (const key of SCORE_BREAKDOWN_KEYS) {
          const v = seat.scoreBreakdown[key];
          if (Number.isFinite(v)) {
            m.sb[key] = (m.sb[key] ?? 0) + v;
            globalSb[key] = (globalSb[key] ?? 0) + v;
          }
        }
        m.sbCount += 1; globalSbCount += 1;
      }
      // 动作画像累计（类型分布 / 被拒 / 强制结束 / 意图）。
      const ap = seat.actionProfile;
      if (ap) {
        sumInto(m.actionTypes, ap.byType);
        sumInto(globalActionTypes, ap.byType);
        m.actionTotal += Number.isFinite(ap.total) ? ap.total : 0;
        globalActionTotal += Number.isFinite(ap.total) ? ap.total : 0;
        m.actionRejected += Number.isFinite(ap.rejected) ? ap.rejected : 0;
        globalActionRejected += Number.isFinite(ap.rejected) ? ap.rejected : 0;
        m.actionForced += Number.isFinite(ap.forcedEndTurn) ? ap.forcedEndTurn : 0;
        globalActionForced += Number.isFinite(ap.forcedEndTurn) ? ap.forcedEndTurn : 0;
      }
      // policy 信号累计（价值估计 / 策略熵；仅 --policy-stats 有样本）。
      const ps = seat.policyStats;
      if (ps && Number.isFinite(ps.valueMean)) { m.policyValueSum += ps.valueMean; m.policyValueCount += 1; }
      if (ps && Number.isFinite(ps.entropyMean)) { m.policyEntropySum += ps.entropyMean; m.policyEntropyCount += 1; }
      const d = seat.derived;
      if (!d) continue;
      seatCount += 1;
      if (Number.isFinite(d.damageDealt)) m.damageDealt += d.damageDealt;
      if (Number.isFinite(d.damageTaken)) m.damageTaken += d.damageTaken;
      const kills = sumValues(d.killsByType);
      const lossesByType = sumValues(d.lossesByType);
      m.kills += kills;
      m.lossesByType += lossesByType;
      sumInto(unitsDeploys, d.deploysByType);
      sumInto(unitsLosses, d.lossesByType);
      sumInto(m.deploysByType, d.deploysByType);
      if (Number.isFinite(d.incomeTotal)) { m.income += d.incomeTotal; incomeSum += d.incomeTotal; }
      if (Number.isFinite(d.incomeControlTotal)) incomeControlSum += d.incomeControlTotal;
      if (Number.isFinite(d.deployCost)) deployCostSum += d.deployCost;
      if (Number.isFinite(d.captures)) { m.captures += d.captures; capturesSum += d.captures; }
      if (Number.isFinite(d.steals)) { m.steals += d.steals; stealsSum += d.steals; }
      if (Number.isFinite(d.firstCaptureRound)) {
        m.firstCaptureSum += d.firstCaptureRound;
        m.firstCaptureCount += 1;
        firstCaptureSum += d.firstCaptureRound;
        firstCaptureCount += 1;
      }
      if (Number.isFinite(d.comebackSupplies) && d.comebackSupplies > 0) comebackSeats += 1;
    }
  }

  const totalDeploys = sumValues(unitsDeploys);
  const totalUnitLosses = sumValues(unitsLosses);
  // killsByType 取对手 lossesByType（unit_death 不带击杀方），全局聚合后恒等于 losses，
  // 故全局兵种表只展示部署与阵亡；「谁的击杀多」只在 perModel 里有意义。
  const unitTypes = [...new Set([...Object.keys(unitsDeploys), ...Object.keys(unitsLosses)])].sort();
  const units = unitTypes.map(type => {
    const deploys = unitsDeploys[type] ?? 0;
    const losses = unitsLosses[type] ?? 0;
    return {
      type,
      deploys,
      deployShare: totalDeploys > 0 ? round4(deploys / totalDeploys) : null,
      losses,
      lossShare: totalUnitLosses > 0 ? round4(losses / totalUnitLosses) : null,
    };
  }).sort((x, y) => y.deploys - x.deploys);

  const perModelList = [...perModel.entries()].map(([id, m]) => ({
    id,
    games: m.games,
    wins: m.wins,
    losses: m.losses,
    draws: m.draws,
    winRate: m.games > 0 ? round4(m.wins / m.games) : null,
    avgScore: m.scoreCount > 0 ? Math.round(m.scoreSum / m.scoreCount) : null,
    avgDamageDealt: m.games > 0 ? Math.round(m.damageDealt / m.games) : null,
    avgDamageTaken: m.games > 0 ? Math.round(m.damageTaken / m.games) : null,
    avgKills: m.games > 0 ? round2(m.kills / m.games) : null,
    avgLosses: m.games > 0 ? round2(m.lossesByType / m.games) : null,
    avgCaptures: m.games > 0 ? round2(m.captures / m.games) : null,
    avgSteals: m.games > 0 ? round2(m.steals / m.games) : null,
    avgIncome: m.games > 0 ? Math.round(m.income / m.games) : null,
    avgFirstCaptureRound: m.firstCaptureCount > 0 ? round2(m.firstCaptureSum / m.firstCaptureCount) : null,
    avgDecisionMs: m.decisionCount > 0 ? round2(m.decisionSum / m.decisionCount * 1000) : null,
    // 裁决 7 分项均值：该参与者赢/输时靠哪几项得分，刻画打法风格。
    scoreBreakdown: scoreBreakdownMeans(m.sb, m.sbCount),
    // 动作画像：类型占比 / 被拒率 / 强制结束率。
    actionMix: m.actionTotal > 0 ? {
      byType: actionMixShare(m.actionTypes, m.actionTotal),
      rejectedRate: round4(m.actionRejected / m.actionTotal),
      forcedEndTurnRate: round4(m.actionForced / m.actionTotal),
    } : null,
    // policy 信号（仅 --policy-stats 批次有样本）：价值估计均值 = 自我评估，熵均值 = 犹豫度。
    policyValueMean: m.policyValueCount > 0 ? round4(m.policyValueSum / m.policyValueCount) : null,
    policyEntropyMean: m.policyEntropyCount > 0 ? round4(m.policyEntropySum / m.policyEntropyCount) : null,
    topDeploys: Object.entries(m.deploysByType).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([type, count]) => ({ type, count })),
  })).sort((a, b) => b.games - a.games || a.id.localeCompare(b.id));

  const perMapList = [...perMap.entries()].map(([map, m]) => ({
    map,
    games: m.games,
    drawRate: m.games > 0 ? round4(m.draws / m.games) : null,
    annihilationRate: m.games > 0 ? round4(m.annihilations / m.games) : null,
    avgRounds: m.roundsCount > 0 ? round2(m.roundsSum / m.roundsCount) : null,
    avgDurationSec: m.durationCount > 0 ? round2(m.durationSum / m.durationCount) : null,
    // 先手（player_a 座）胜率：地图平衡第一指标，偏离 0.5 越远先手优势越大。
    firstSeatWinRate: m.firstSeatGames > 0 ? round4(m.firstSeatWins / m.firstSeatGames) : null,
    // 每局平均控制点易手次数：地图争夺强度（易手越多拉锯越烈）。
    avgControlPointFlips: m.flipsCount > 0 ? round2(m.flipsSum / m.flipsCount) : null,
    topEndReason: [...m.endReasons.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
  })).sort((a, b) => b.games - a.games || a.map.localeCompare(b.map));

  return {
    overview: {
      games: matches.length,
      draws,
      drawRate: matches.length > 0 ? round4(draws / matches.length) : null,
      annihilationRate: matches.length > 0
        ? round4((endReasonCount.get('last_player_standing') ?? 0) / matches.length) : null,
      avgRounds: roundsValues.length > 0 ? round2(roundsValues.reduce((s, v) => s + v, 0) / roundsValues.length) : null,
      avgDurationSec: durationValues.length > 0 ? round2(durationValues.reduce((s, v) => s + v, 0) / durationValues.length) : null,
      avgActions: actionsCount > 0 ? Math.round(actionsSum / actionsCount) : null,
      // 全局裁决 7 分项均值：该模式整体「赢在哪」（推 HQ vs 控点 vs 杀兵）。
      scoreBreakdown: scoreBreakdownMeans(globalSb, globalSbCount),
      // 全局动作画像。
      actionMix: globalActionTotal > 0 ? {
        byType: actionMixShare(globalActionTypes, globalActionTotal),
        rejectedRate: round4(globalActionRejected / globalActionTotal),
        forcedEndTurnRate: round4(globalActionForced / globalActionTotal),
      } : null,
      // 全局控制点易手均值。
      avgControlPointFlips: globalFlipsCount > 0 ? round2(globalFlipsSum / globalFlipsCount) : null,
    },
    endReasons: [...endReasonCount.entries()]
      .map(([reason, count]) => ({ reason, count, pct: matches.length > 0 ? round4(count / matches.length) : null }))
      .sort((a, b) => b.count - a.count),
    roundsDist: histogram(roundsValues, ROUNDS_BUCKETS),
    durationDist: histogram(durationValues, DURATION_BUCKETS),
    decisionMsDist: histogram(decisionMsValues, DECISION_MS_BUCKETS),
    units,
    economy: {
      // 分母 seatCount 统计全部含 derived 的座席，各分子另有字段缺失守卫；
      // 当前 round_robin 数据字段恒在，若未来 schema 缺字段，均值会被静默
      // 稀释而非报错——需要更细口径时改为逐字段计数（参考 perModel.avgScore）。
      seatCount,
      avgIncomeTotal: seatCount > 0 ? Math.round(incomeSum / seatCount) : null,
      controlShare: incomeSum > 0 ? round4(incomeControlSum / incomeSum) : null,
      avgDeployCost: seatCount > 0 ? Math.round(deployCostSum / seatCount) : null,
      avgCaptures: seatCount > 0 ? round2(capturesSum / seatCount) : null,
      avgSteals: seatCount > 0 ? round2(stealsSum / seatCount) : null,
      avgFirstCaptureRound: firstCaptureCount > 0 ? round2(firstCaptureSum / firstCaptureCount) : null,
      comebackRate: seatCount > 0 ? round4(comebackSeats / seatCount) : null,
    },
    perModel: perModelList,
    perMap: perMapList,
  };
}

/** 去 markdown 行内语法：链接留文字、粗体/代码去标记。 */
export function stripMd(text) {
  return String(text ?? '')
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 提取单元格里第一个链接的目标（没有链接返回 null）。 */
function linkTarget(cell) {
  const m = String(cell ?? '').match(/\]\(([^)]+)\)/);
  return m ? m[1].trim() : null;
}

/** 提取单元格里第一个反引号内容的 basename（没有返回 null）。 */
function fileToken(cell) {
  const m = String(cell ?? '').match(/`([^`]+\.zip)`/);
  return m ? basename(m[1].trim()) : null;
}

function splitTableRow(line) {
  const t = line.trim();
  if (!t.startsWith('|')) return null;
  const body = t.endsWith('|') ? t.slice(1, -1) : t.slice(1);
  return body.split('|').map(c => c.trim());
}

const isSeparatorRow = cells => cells.every(c => /^:?-{2,}:?$/.test(c));

/**
 * 解析 rl/docs/MODELS_NOTES.md 的两张表（其余含模型文件名的小节表格，如
 * 「文件名步数与交付断点」对照表，不参与档案匹配）：
 *   - 「## 模型状态总表」下主表「| 模型文件 | 档案 | 状态 | 说明 |」→ profiles: Map<文件名, { docRef, docStatus, notes }>
 *   - 「### 已作废模型」后的「| 模型文件（已归档） | 档案 | 作废原因 |」→ deprecated: [{ file, docRef, reason }]
 * 表格是手工维护的 markdown，解析容错：列数不对/无 .zip 文件名的行直接跳过并计 warning。
 */
export function parseModelsNotes(mdText) {
  const profiles = new Map();
  const deprecated = [];
  const warnings = [];
  let inDeprecated = false;
  let inMain = false;
  for (const line of String(mdText ?? '').split('\n')) {
    if (/^#{1,4}\s/.test(line.trim())) {
      inDeprecated = /^#{1,4}\s*已作废模型/.test(line.trim());
      inMain = /^#{1,4}\s*模型状态总表/.test(line.trim());
      continue;
    }
    const cells = splitTableRow(line);
    if (!cells || isSeparatorRow(cells)) continue;
    const file = fileToken(cells[0]);
    if (!file) continue; // 表头行与非模型表行
    // `_distilled` 等中间产物不符合交付文件名格式，永远不会进 registry，静默跳过。
    if (!parseModelFile(file)) continue;
    if (inDeprecated) {
      if (cells.length < 3) {
        warnings.push(`notes: 作废表行列数不足（${file}）`);
        continue;
      }
      deprecated.push({
        file,
        version: parseModelFile(file).version,
        docRef: linkTarget(cells[1]) ?? stripMd(cells[1]) ?? null,
        reason: stripMd(cells[2]),
      });
    } else if (inMain) {
      if (cells.length < 4) {
        warnings.push(`notes: 主表行列数不足（${file}）`);
        continue;
      }
      if (profiles.has(file)) {
        warnings.push(`notes: 模型 ${file} 在主表中出现多次，采用最后一次`);
      }
      profiles.set(file, {
        docRef: linkTarget(cells[1]) ?? stripMd(cells[1]) ?? null,
        docStatus: stripMd(cells[2]),
        notes: stripMd(cells[3]),
      });
    }
    // 「模型状态总表」与「已作废模型」之外的小节（如「文件名步数与交付断点」对照表）：
    // 行虽含模型文件名，但不承载档案信息，静默跳过。
  }
  deprecated.sort((a, b) => a.file.localeCompare(b.file));
  return { profiles, deprecated, warnings };
}

/**
 * 榜单里每个参与者的分模式评分。榜单按模式隔离，这里保留全部模式条目，档案页可按
 * 主要模式展示一个评分，同时不丢失其他模式的历史成绩。
 */
function leaderboardRatings(leaderboardJson) {
  const byId = new Map();
  const add = (row, mode, modeLabel) => {
    if (!row || !row.games) return;
    const list = byId.get(row.id) ?? [];
    list.push({
      mode, modeLabel,
      rating: row.rating ?? null,
      ratingLo: row.ratingLo ?? null,
      ratingHi: row.ratingHi ?? null,
      winRate: row.winRate ?? null,
      games: row.games,
      wins: row.wins ?? 0,
      losses: row.losses ?? 0,
      draws: row.draws ?? 0,
    });
    byId.set(row.id, list);
  };
  for (const mode of Array.isArray(leaderboardJson?.modes) ? leaderboardJson.modes : []) {
    for (const row of mode?.maps?.all?.models ?? []) add(row, mode.id, mode.label);
  }
  // 兼容旧版榜单文件（只有顶层 maps.all）：只在没有 modes 时使用，避免把跨模式旧数据
  // 伪装成某个模式的新成绩。
  if (byId.size === 0) {
    for (const row of leaderboardJson?.maps?.all?.models ?? []) add(row, 'all', '全部模式');
  }
  for (const list of byId.values()) list.sort((a, b) => b.games - a.games);
  return byId;
}

/**
 * 组装参与者档案列表：registry 元数据（模型 zip + 内置算法）+ 文件大小 + 榜单评分（可选）
 * + MODELS_NOTES/注册表说明。leaderboardJson 为 null 时评分字段留空（榜单未生成也能出档案）。
 */
export function buildModelProfiles({ registry, modelsDir, leaderboardJson, notesProfiles, playedIds = null }) {
  const ratingsById = leaderboardRatings(leaderboardJson);
  const profiles = [...registry.entries()].map(([id, meta]) => {
    // 历史算法版本只在确有对局时出档案：清空数据后不残留一行 0 局的旧版本。
    if (meta.kind === 'algorithm' && meta.historical && playedIds && !playedIds.has(id)) return null;
    const ratings = ratingsById.get(id) ?? [];
    const lb = ratings[0] ?? null;
    if (meta.kind === 'algorithm') {
      return {
        id,
        kind: 'algorithm',
        short: meta.displayName,
        version: meta.version,
        trainDate: null,
        trainMap: null,
        opponentType: null,
        steps: null,
        algorithm: meta.name,
        modes: meta.modes,
        status: 'builtin',
        statusNote: null,
        rated: true,
        sizeMB: null,
        rating: lb?.rating ?? null,
        ratingLo: lb?.ratingLo ?? null,
        ratingHi: lb?.ratingHi ?? null,
        winRate: lb?.winRate ?? null,
        games: lb?.games ?? 0,
        ratings,
        ratingMode: lb?.mode ?? null,
        ratingModeLabel: lb?.modeLabel ?? null,
        docRef: `algorithms/docs/algorithms/${meta.name}.md`,
        docStatus: '内置算法',
        notes: meta.description,
      };
    }
    let sizeMB = null;
    try {
      sizeMB = round2(statSync(join(modelsDir, id)).size / 1_000_000);
    } catch { /* 文件可能在扫描后被移动 */ }
    const notes = notesProfiles?.get(id) ?? null;
    return {
      id,
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
      rated: !EXCLUDED_VERSIONS.has(meta.version),
      sizeMB,
      rating: lb?.rating ?? null,
      ratingLo: lb?.ratingLo ?? null,
      ratingHi: lb?.ratingHi ?? null,
      winRate: lb?.winRate ?? null,
      games: lb?.games ?? 0,
      ratings,
      ratingMode: lb?.mode ?? null,
      ratingModeLabel: lb?.modeLabel ?? null,
      docRef: notes?.docRef ?? null,
      docStatus: notes?.docStatus ?? null,
      notes: notes?.notes ?? null,
    };
  }).filter(Boolean);
  // 评分降序（无评分/未参评排后），同分按文件名。
  profiles.sort((a, b) => (b.rating ?? -Infinity) - (a.rating ?? -Infinity) || a.id.localeCompare(b.id));
  return profiles;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const modelsDir = opts.modelsDir ?? join(PROJECT_DIR, 'rl', 'models');
  const { registry, warning } = collectRegistry(modelsDir);
  const warnings = warning ? [warning] : [];
  const mapModes = loadMapModes(opts.mapsDir);
  const { matches, warnings: loadWarnings, retiredDropped, formatDropped } = loadMatchDetails(opts.statsFile, registry, mapModes);
  warnings.push(...loadWarnings);
  // 玩法明细（裁决分项 / 动作分布 / 控制点易手）不在 matches.jsonl 里，从本地 detail 补。
  const detailInfo = opts.details
    ? enrichWithDetails(matches)
    : { filesRead: 0, gamesMatched: 0, enriched: 0 };
  if (opts.details && detailInfo.enriched < matches.length) {
    warnings.push(`detail 明细缺失：${matches.length - detailInfo.enriched}/${matches.length} 局无玩法明细（换机器或已清理本地明细时玩法统计会降级）`);
  }

  // 玩法统计同样按模式隔离：页面切换模式时只读该模式的聚合，不把不同规则体系混在一起。
  const modes = GAME_MODES.map(meta => {
    const modeMatches = matches.filter(m => m.mode === meta.id);
    return {
      id: meta.id,
      label: meta.label,
      games: modeMatches.length,
      gameplay: aggregateGameplay(modeMatches),
    };
  }).filter(mode => mode.games > 0);
  const gameplay = modes.find(mode => mode.id === 'standard')?.gameplay
    ?? modes[0]?.gameplay
    ?? aggregateGameplay([]);

  let notesData = { profiles: new Map(), deprecated: [], warnings: [] };
  if (existsSync(opts.notesFile)) {
    notesData = parseModelsNotes(readFileSync(opts.notesFile, 'utf8'));
    warnings.push(...notesData.warnings);
  } else {
    warnings.push(`notes file not found: ${opts.notesFile}`);
  }

  let leaderboardJson = null;
  if (existsSync(opts.leaderboardFile)) {
    try {
      leaderboardJson = JSON.parse(readFileSync(opts.leaderboardFile, 'utf8'));
    } catch {
      warnings.push(`leaderboard file unreadable: ${opts.leaderboardFile}`);
    }
  } else {
    warnings.push(`leaderboard file not found: ${opts.leaderboardFile}（档案评分字段留空）`);
  }

  const playedIds = new Set(matches.flatMap(m => [m.playerA, m.playerB]));
  const models = buildModelProfiles({
    registry, modelsDir, leaderboardJson, notesProfiles: notesData.profiles, playedIds,
  });

  const tsList = matches.map(m => m.ts).filter(Boolean).sort();
  const payload = {
    generatedAt: new Date().toISOString(),
    source: {
      file: opts.statsFile,
      matchCount: matches.length,
      retiredMatchesDropped: retiredDropped,
      oldFormatMatchesDropped: formatDropped,
      mapDist: matches.map(m => m.map).reduce((o, map) => ({ ...o, [map]: (o[map] ?? 0) + 1 }), {}),
      modeDist: Object.fromEntries(GAME_MODES.map(meta => [meta.id, matches.filter(m => m.mode === meta.id).length])),
      dateMin: tsList[0] ?? null,
      dateMax: tsList[tsList.length - 1] ?? null,
      // 从本地 detail 补到玩法明细的局数（matches.jsonl 不存这些字段）。
      detailDerived: detailInfo.enriched,
      detailFilesRead: detailInfo.filesRead,
    },
    // 顶层 gameplay 保留给旧客户端，语义固定为标准模式（没有标准数据时取第一个有数据的模式）。
    gameplay,
    modes,
    models,
    deprecated: notesData.deprecated,
    warnings,
  };

  mkdirSync(dirname(opts.out), { recursive: true });
  writeFileSync(opts.out, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`Wrote ${opts.out} — ${matches.length} matches, ${models.length} participant profiles, ${notesData.deprecated.length} deprecated` +
    (retiredDropped > 0 ? `（跳过作废对局 ${retiredDropped}）` : '') +
    (formatDropped > 0 ? `（跳过旧格式对局 ${formatDropped}）` : ''));
  for (const mode of modes) {
    const gp = mode.gameplay;
    console.log(`${mode.label}（${mode.games} 局）Units: ${gp.units.map(u => `${u.type} ${(u.deployShare * 100).toFixed(0)}%`).join(' / ') || '—'}`);
    console.log(`${mode.label}（${mode.games} 局）EndReasons: ${gp.endReasons.map(e => `${e.reason} ${e.count}`).join(' / ') || '—'}`);
  }
  const noNotes = models.filter(m => !m.notes);
  if (noNotes.length) console.log(`Models without notes: ${noNotes.map(m => m.short).join(', ')}`);
  if (warnings.length) {
    console.warn(`Warnings (${warnings.length}):`);
    for (const w of warnings.slice(0, 10)) console.warn(`  - ${w}`);
    if (warnings.length > 10) console.warn(`  ... and ${warnings.length - 10} more`);
  }
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) main();
