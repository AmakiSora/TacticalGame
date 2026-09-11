/**
 * Scan rl/leaderboard/matches.jsonl (produced by rl/round_robin.py),
 * compute Bradley-Terry ratings and write public/data/rl-leaderboard.json.
 *
 * Usage:
 *   node script/generateRlLeaderboard.mjs
 *   node script/generateRlLeaderboard.mjs --stats-file rl/leaderboard/matches.jsonl --out public/data/rl-leaderboard.json
 *
 * 评分口径：
 *   - 作废模型（MODEL_STATUS_BY_VERSION 中 status=retired 的版本）不参评：注册表跳过、
 *     历史对局不计分，跳过局数记入 source.retiredMatchesDropped；
 *   - Bradley-Terry MLE（MM 迭代），平局记 0.5 胜；每对交手过的模型对附加 1 局虚拟
 *     平局作先验，防全败模型评分发散并让稀疏对向均值收缩；
 *   - rating = 1500 + 400/ln(10) × ln p（Elo 刻度）；
 *   - 95% CI 用按（模型对, 地图）分层的有放回 bootstrap，随机数固定种子，输出可复现；
 *   - 全局评分池化全部地图，另按每张图独立评分（局数少，CI 更宽）；
 *   - 分座位（先手/后手）只做展示统计，不进评分。
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { wilsonLower, round2, round4 } from './generateStats.mjs';

export const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const PROJECT_DIR = dirname(SCRIPT_DIR);

export const DEFAULT_STATS_FILE = join(PROJECT_DIR, 'rl', 'leaderboard', 'matches.jsonl');
export const DEFAULT_OUT = join(PROJECT_DIR, 'public', 'data', 'rl-leaderboard.json');

export const MODEL_FILE_RE = /^hex_ppo_(v\d+\.\d+\.\d+)_(\d{8})_([a-z0-9-]+)_(.+)_(\d+|best)\.zip$/i;
export const EXCLUDED_VERSIONS = new Set(['v1.0.0']);

/** 镜像 rl/MODELS_NOTES.md「模型状态总表」，两处需人工同步维护。 */
export const MODEL_STATUS_BY_VERSION = {
  'v2.7.0': 'recommended',
  'v2.1.1': 'retired',
  'v2.1.4': 'retired',
  'v2.1.5': 'retired',
  'v2.1.6': 'retired',
  'v2.1.8': 'retired',
};
/** 作废模型不进排行榜：注册表跳过（也不进「未参评」区），历史对局不计分，只按计数留痕。 */
export const RETIRED_VERSIONS = new Set(
  Object.entries(MODEL_STATUS_BY_VERSION)
    .filter(([, status]) => status === 'retired')
    .map(([version]) => version),
);
/** 评估协议已知限制：v2.0.0 观测固定 player_a 视角，坐 player_b 属分布外。 */
export const STATUS_NOTES = {
  'v2.0.0': 'player_b 座位观测失真，成绩仅供参考',
};

export function parseArgs(argv) {
  const opts = {
    statsFile: DEFAULT_STATS_FILE,
    out: DEFAULT_OUT,
    targetGamesPerPair: 24,
    bootstrap: 1000,
    bootstrapPerMap: 300,
    bootstrapSeed: 20260901,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--stats-file') opts.statsFile = resolve(argv[++i]);
    else if (a === '--out') opts.out = resolve(argv[++i]);
    else if (a === '--target-games') opts.targetGamesPerPair = Number(argv[++i]);
    else if (a === '--bootstrap') opts.bootstrap = Number(argv[++i]);
    else if (a === '--bootstrap-per-map') opts.bootstrapPerMap = Number(argv[++i]);
    else if (a === '--seed') opts.bootstrapSeed = Number(argv[++i]);
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node script/generateRlLeaderboard.mjs [--stats-file f] [--out f] [--target-games n] [--bootstrap n] [--bootstrap-per-map n] [--seed n]');
      process.exit(0);
    }
  }
  return opts;
}

/** 解析模型文件名：hex_ppo_<版本>_<日期>_<地图>_<对手>_<步数|best>.zip。地图名用连字符，对手类型可含下划线。 */
export function parseModelFile(fileName) {
  const m = fileName.match(MODEL_FILE_RE);
  if (!m) return null;
  const [, version, trainDate, trainMap, opponentType, stepsRaw] = m;
  const steps = /^\d+$/.test(stepsRaw) ? Number(stepsRaw) : null;
  return { id: fileName, version, trainDate, trainMap, opponentType, steps };
}

export function shortName(meta) {
  if (!meta) return null;
  if (meta.steps == null) return meta.version;
  return meta.steps >= 1_000_000
    ? `${meta.version}@${Number((meta.steps / 1_000_000).toFixed(1))}M`
    : `${meta.version}@${Math.round(meta.steps / 1000)}K`;
}

/**
 * 注册 rl/models/*.zip 作为合法玩家名与"未参评"清单来源。作废版本（RETIRED_VERSIONS）
 * 直接跳过：不注册、不进"未参评"区（排行榜任何区域都不展示），其历史对局由 loadMatches 单独过滤。
 */
export function collectRegistry(modelsDir) {
  const registry = new Map();
  const excluded = [];
  let files = [];
  try {
    files = readdirSync(modelsDir);
  } catch {
    return { registry, excluded, warning: `cannot read ${modelsDir}` };
  }
  for (const f of files) {
    if (!f.endsWith('.zip')) continue;
    const meta = parseModelFile(f);
    if (!meta) continue;
    if (RETIRED_VERSIONS.has(meta.version)) continue;
    registry.set(meta.id, meta);
    if (EXCLUDED_VERSIONS.has(meta.version)) {
      excluded.push({ id: meta.id, version: meta.version, reason: '512 动作旧格式，评估脚本不支持进程内互打' });
    }
  }
  excluded.sort((a, b) => a.id.localeCompare(b.id));
  return { registry, excluded, warning: null };
}

/** 读 JSONL，丢弃玩家名不在注册表/格式非法的行；作废模型（已归档）的对局不计分，按 retiredDropped 计数。 */
export function loadMatches(statsFile, registry) {
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
      warnings.push(`line ${idx + 1}: unknown model name(s): ${[a, b].filter(n => !registry.has(n)).join(', ')}`);
      continue;
    }
    if (a === b) {
      warnings.push(`line ${idx + 1}: same model on both seats`);
      continue;
    }
    matches.push({
      ts: record.ts ?? null,
      map: typeof record.map === 'string' ? record.map : 'unknown',
      playerA: a,
      playerB: b,
      winner: record.winner === 'draw' || registry.has(record.winner) ? record.winner : null,
      rounds: Number.isFinite(record.rounds) ? record.rounds : null,
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
  const perModel = new Map(ids.map(id => [id, {
    games: 0, wins: 0, losses: 0, draws: 0,
    firstSeat: { games: 0, wins: 0 }, secondSeat: { games: 0, wins: 0 },
    roundsSum: 0, roundsCount: 0,
    vs: new Map(), perMap: new Map(),
  }]));

  for (const g of games) {
    const key = pairKey(g.playerA, g.playerB);
    let agg = pairAgg.get(key);
    if (!agg) {
      const [x, y] = key.split('|');
      agg = { x, y, aScore: 0, games: 0, aWins: 0, bWins: 0, draws: 0 };
      pairAgg.set(key, agg);
    }
    agg.games += 1;

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
  const lnP = solveBT(pairs, n);
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
    .map(p => ({ a: p.x, b: p.y, games: p.games, aWins: p.aWins, bWins: p.bWins, draws: p.draws }))
    .sort((x, y) => y.games - x.games || x.a.localeCompare(y.a));

  return {
    overview: {
      games: games.length,
      pairCount: pairAgg.size,
      draws,
      drawRate: games.length > 0 ? round4(draws / games.length) : null,
      avgRounds: roundsGames.length > 0 ? round2(totalRounds / roundsGames.length) : null,
    },
    models,
    h2h,
  };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { registry, excluded, warning } = collectRegistry(join(PROJECT_DIR, 'rl', 'models'));
  const warnings = warning ? [warning] : [];
  const { matches, warnings: loadWarnings, retiredDropped } = loadMatches(opts.statsFile, registry);
  warnings.push(...loadWarnings);

  const ids = [...registry.keys()]
    .filter(id => !EXCLUDED_VERSIONS.has(registry.get(id).version))
    .sort();
  const indexOf = new Map(ids.map((id, i) => [id, i]));
  const strata = buildStrata(matches);

  const maps = [...new Set(matches.map(m => m.map))].sort();
  const leagues = {
    all: buildLeague(matches, ids, indexOf, strata, opts.bootstrap, () => mulberry32(opts.bootstrapSeed)),
  };
  for (const map of maps) {
    leagues[map] = buildLeague(
      matches.filter(m => m.map === map), ids, indexOf, strata,
      opts.bootstrapPerMap, () => mulberry32(opts.bootstrapSeed),
    );
  }

  const registryMeta = Object.fromEntries([...registry.entries()].map(([id, meta]) => [id, {
    short: shortName(meta),
    version: meta.version,
    trainDate: meta.trainDate,
    trainMap: meta.trainMap,
    opponentType: meta.opponentType,
    steps: meta.steps,
    status: MODEL_STATUS_BY_VERSION[meta.version] ?? 'legacy',
    statusNote: STATUS_NOTES[meta.version] ?? null,
  }]));

  const tsList = matches.map(m => m.ts).filter(Boolean).sort();
  const payload = {
    generatedAt: new Date().toISOString(),
    ratingMethod: {
      model: 'Bradley-Terry MLE (MM iteration), draw = 0.5 win',
      prior: '1 virtual draw per played pair',
      scale: 'Elo: 1500 + 400/ln(10) * ln p',
      ci: `stratified bootstrap by (pair,map): ${opts.bootstrap} draws for all / ${opts.bootstrapPerMap} per map, seed ${opts.bootstrapSeed}`,
    },
    source: {
      file: opts.statsFile,
      matchCount: matches.length,
      retiredMatchesDropped: retiredDropped,
      mapDist: Object.fromEntries(maps.map(map => [map, matches.filter(m => m.map === map).length])),
      targetGamesPerPair: opts.targetGamesPerPair,
      dateMin: tsList[0] ?? null,
      dateMax: tsList[tsList.length - 1] ?? null,
    },
    registry: registryMeta,
    maps: leagues,
    excluded,
    warnings,
  };

  mkdirSync(dirname(opts.out), { recursive: true });
  writeFileSync(opts.out, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`Wrote ${opts.out} — ${matches.length} matches, ${ids.length} rated models, ${maps.length + 1} league(s)` +
    (retiredDropped > 0 ? `（另跳过作废模型对局 ${retiredDropped} 局）` : ''));

  const rows = leagues.all.models.filter(m => m.games > 0)
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  console.log('Top ratings (all maps):');
  rows.forEach((row, i) => {
    const short = registryMeta[row.id].short;
    const ci = row.ratingLo != null ? ` ±${Math.max(row.rating - row.ratingLo, row.ratingHi - row.rating)}` : '';
    console.log(`  #${i + 1} ${short.padEnd(14)} rating=${row.rating}${ci}  ${row.wins}W/${row.losses}L/${row.draws}D  games=${row.games}`);
  });
  if (warnings.length) {
    console.warn(`Warnings (${warnings.length}):`);
    for (const w of warnings.slice(0, 10)) console.warn(`  - ${w}`);
    if (warnings.length > 10) console.warn(`  ... and ${warnings.length - 10} more`);
  }
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) main();
