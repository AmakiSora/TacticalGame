/**
 * Scan rl/leaderboard/matches.jsonl (produced by rl/round_robin.py),
 * aggregate gameplay stats & model profiles, write public/data/rl-stats.json.
 * 与 generateRlLeaderboard.mjs 配套：榜单管「谁强」，本脚本管「怎么打」。
 *
 * Usage:
 *   node script/generateRlStats.mjs
 *   node script/generateRlStats.mjs --stats-file rl/leaderboard/matches.jsonl --out public/data/rl-stats.json
 *
 * 口径与排行榜一致：
 *   - 作废模型（RETIRED_VERSIONS）不参与：对局整局丢弃并计数；
 *   - EXCLUDED_VERSIONS（v1.0.0，512 动作旧格式）不进玩法统计，对局按 formatDropped 计数；
 *   - 模型档案的评分/胜率合并自 public/data/rl-leaderboard.json（先跑榜单脚本再跑本脚本）；
 *   - 档案文案解析自 rl/docs/MODELS_NOTES.md 的状态总表与作废表（markdown 表格，格式变化时
 *     只留 warning 不炸脚本，对应模型的说明字段留空）。
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  collectRegistry,
  parseModelFile,
  shortName,
  MODEL_STATUS_BY_VERSION,
  STATUS_NOTES,
  EXCLUDED_VERSIONS,
  RETIRED_VERSIONS,
} from './generateRlLeaderboard.mjs';
import { round2, round4 } from './generateStats.mjs';

export const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const PROJECT_DIR = dirname(SCRIPT_DIR);

export const DEFAULT_STATS_FILE = join(PROJECT_DIR, 'rl', 'leaderboard', 'matches.jsonl');
export const DEFAULT_OUT = join(PROJECT_DIR, 'public', 'data', 'rl-stats.json');
export const DEFAULT_NOTES_FILE = join(PROJECT_DIR, 'rl', 'docs', 'MODELS_NOTES.md');
export const DEFAULT_LEADERBOARD_FILE = join(PROJECT_DIR, 'public', 'data', 'rl-leaderboard.json');

export function parseArgs(argv) {
  const opts = {
    statsFile: DEFAULT_STATS_FILE,
    out: DEFAULT_OUT,
    notesFile: DEFAULT_NOTES_FILE,
    leaderboardFile: DEFAULT_LEADERBOARD_FILE,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--stats-file') opts.statsFile = resolve(argv[++i]);
    else if (a === '--out') opts.out = resolve(argv[++i]);
    else if (a === '--notes') opts.notesFile = resolve(argv[++i]);
    else if (a === '--leaderboard') opts.leaderboardFile = resolve(argv[++i]);
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node script/generateRlStats.mjs [--stats-file f] [--out f] [--notes f] [--leaderboard f]');
      process.exit(0);
    }
  }
  return opts;
}

/**
 * 读 JSONL 并保留玩法统计所需字段（derived/scores/actions/durationSec/endReason）。
 * 过滤规则与 generateRlLeaderboard.loadMatches 一致：作废模型整局丢弃（retiredDropped），
 * 玩家不在注册表/同模型对局的行记入 warnings；另把 EXCLUDED_VERSIONS 参与的对局按
 * formatDropped 丢弃（旧格式模型的打法与现役协议不可比）。
 */
export function loadMatchDetails(statsFile, registry) {
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
      return {
        score: Number.isFinite(record?.scores?.[side]) ? record.scores[side] : null,
        actions: Number.isFinite(record?.actions?.[side]) ? record.actions[side] : null,
        derived: d && typeof d === 'object' ? d : null,
      };
    };
    matches.push({
      ts: record.ts ?? null,
      map: typeof record.map === 'string' ? record.map : 'unknown',
      playerA: a,
      playerB: b,
      winner: record.winner === 'draw' || registry.has(record.winner) ? record.winner : null,
      rounds: Number.isFinite(record.rounds) ? record.rounds : null,
      endReason: typeof record.endReason === 'string' ? record.endReason : 'unknown',
      durationSec: Number.isFinite(record.durationSec) ? record.durationSec : null,
      seatA: seat('player_a'),
      seatB: seat('player_b'),
    });
  }
  return { matches, warnings, retiredDropped, formatDropped };
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
        deploysByType: {},
      };
      perModel.set(id, m);
    }
    return m;
  };
  const mapAgg = map => {
    let m = perMap.get(map);
    if (!m) {
      m = { games: 0, draws: 0, annihilations: 0, roundsSum: 0, roundsCount: 0, durationSum: 0, durationCount: 0, endReasons: new Map() };
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
    },
    endReasons: [...endReasonCount.entries()]
      .map(([reason, count]) => ({ reason, count, pct: matches.length > 0 ? round4(count / matches.length) : null }))
      .sort((a, b) => b.count - a.count),
    roundsDist: histogram(roundsValues, ROUNDS_BUCKETS),
    durationDist: histogram(durationValues, DURATION_BUCKETS),
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
 * 解析 rl/docs/MODELS_NOTES.md 的两张表：
 *   - 主表「| 模型文件 | 档案 | 状态 | 说明 |」→ profiles: Map<文件名, { docRef, docStatus, notes }>
 *   - 「### 已作废模型」后的「| 模型文件（已归档） | 档案 | 作废原因 |」→ deprecated: [{ file, docRef, reason }]
 * 表格是手工维护的 markdown，解析容错：列数不对/无 .zip 文件名的行直接跳过并计 warning。
 */
export function parseModelsNotes(mdText) {
  const profiles = new Map();
  const deprecated = [];
  const warnings = [];
  let inDeprecated = false;
  for (const line of String(mdText ?? '').split('\n')) {
    if (/^#{1,4}\s/.test(line.trim())) {
      inDeprecated = /^#{1,4}\s*已作废模型/.test(line.trim());
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
    } else {
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
  }
  deprecated.sort((a, b) => a.file.localeCompare(b.file));
  return { profiles, deprecated, warnings };
}

/**
 * 组装模型档案列表：registry 元数据 + 文件大小 + 榜单评分（可选）+ MODELS_NOTES 说明。
 * leaderboardJson 为 null 时评分字段留空（榜单未生成也能出档案）。
 */
export function buildModelProfiles({ registry, modelsDir, leaderboardJson, notesProfiles }) {
  const lbModels = new Map(
    (leaderboardJson?.maps?.all?.models ?? []).map(m => [m.id, m]),
  );
  const profiles = [...registry.entries()].map(([id, meta]) => {
    let sizeMB = null;
    try {
      sizeMB = round2(statSync(join(modelsDir, id)).size / 1_000_000);
    } catch { /* 文件可能在扫描后被移动 */ }
    const lb = lbModels.get(id);
    const notes = notesProfiles?.get(id) ?? null;
    return {
      id,
      short: shortName(meta),
      version: meta.version,
      trainDate: meta.trainDate,
      trainMap: meta.trainMap,
      opponentType: meta.opponentType,
      steps: meta.steps,
      status: MODEL_STATUS_BY_VERSION[meta.version] ?? 'legacy',
      statusNote: STATUS_NOTES[meta.version] ?? null,
      rated: !EXCLUDED_VERSIONS.has(meta.version),
      sizeMB,
      rating: lb?.rating ?? null,
      ratingLo: lb?.ratingLo ?? null,
      ratingHi: lb?.ratingHi ?? null,
      winRate: lb?.winRate ?? null,
      games: lb?.games ?? 0,
      docRef: notes?.docRef ?? null,
      docStatus: notes?.docStatus ?? null,
      notes: notes?.notes ?? null,
    };
  });
  // 评分降序（无评分/未参评排后），同分按文件名。
  profiles.sort((a, b) => (b.rating ?? -Infinity) - (a.rating ?? -Infinity) || a.id.localeCompare(b.id));
  return profiles;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const modelsDir = join(PROJECT_DIR, 'rl', 'models');
  const { registry, warning } = collectRegistry(modelsDir);
  const warnings = warning ? [warning] : [];
  const { matches, warnings: loadWarnings, retiredDropped, formatDropped } = loadMatchDetails(opts.statsFile, registry);
  warnings.push(...loadWarnings);

  const gameplay = aggregateGameplay(matches);

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

  const models = buildModelProfiles({ registry, modelsDir, leaderboardJson, notesProfiles: notesData.profiles });

  const tsList = matches.map(m => m.ts).filter(Boolean).sort();
  const payload = {
    generatedAt: new Date().toISOString(),
    source: {
      file: opts.statsFile,
      matchCount: matches.length,
      retiredMatchesDropped: retiredDropped,
      oldFormatMatchesDropped: formatDropped,
      mapDist: gameplay.perMap.map(m => [m.map, m.games]).reduce((o, [k, v]) => ({ ...o, [k]: v }), {}),
      dateMin: tsList[0] ?? null,
      dateMax: tsList[tsList.length - 1] ?? null,
    },
    gameplay,
    models,
    deprecated: notesData.deprecated,
    warnings,
  };

  mkdirSync(dirname(opts.out), { recursive: true });
  writeFileSync(opts.out, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`Wrote ${opts.out} — ${matches.length} matches, ${models.length} model profiles, ${notesData.deprecated.length} deprecated` +
    (retiredDropped > 0 ? `（跳过作废对局 ${retiredDropped}）` : '') +
    (formatDropped > 0 ? `（跳过旧格式对局 ${formatDropped}）` : ''));
  console.log(`Units: ${gameplay.units.map(u => `${u.type} ${(u.deployShare * 100).toFixed(0)}%`).join(' / ') || '—'}`);
  console.log(`EndReasons: ${gameplay.endReasons.map(e => `${e.reason} ${e.count}`).join(' / ') || '—'}`);
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
