/**
 * Scan records/V2 + records/V3 replay JSON (reusing the parsing layer from
 * generateStats.mjs) and write an "entertainment"-oriented aggregate to
 * public/data/fun-stats.json.
 *
 * Focus: action totals + per-model behavior profiles, unit/type stats,
 * extreme records & fun facts, timeline trends.
 *
 * Usage:
 *   node script/generateFunStats.mjs
 *   node script/generateFunStats.mjs --out public/data/fun-stats.json
 *   node script/generateFunStats.mjs --records records
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  collectMatches,
  parseArgs,
  round1,
  round2,
  round4,
  fmtDate,
  fmtDuration,
  durationSec,
} from './generateStats.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = dirname(SCRIPT_DIR);

// 共享层常量/工具转发导出，保持旧调用方（测试）导入路径不变
export { MAX_DURATION_SEC, durationSec } from './generateStats.mjs';

function emptyActionTotals() {
  return {
    moves: 0,
    attacks: 0,
    deploys: 0,
    heals: 0,
    demolishes: 0,
    captures: 0,
    unitDeaths: 0,
    rounds: 0,
    income: 0,
    deployCost: 0,
    comebackSupply: 0,
  };
}

function actionTotalsFromMatch(m) {
  const es = m.eventStats || {};
  return {
    moves: es.moves || 0,
    attacks: es.attacks || 0,
    deploys: es.deploys || 0,
    heals: es.heals || 0,
    demolishes: es.demolishes || 0,
    captures: es.captures || 0,
    unitDeaths: es.unitDeaths || 0,
    rounds: es.rounds || 0,
    income: es.income || 0,
    deployCost: es.deployCost || 0,
    comebackSupply: es.comebackSupply || 0,
  };
}

function emptyModelBucket(model) {
  return {
    model,
    games: 0,
    ...emptyActionTotals(),
    unitDeathsLost: 0,
    deploysByType: {},
  };
}

export function buildOverview(matches) {
  const overview = {
    matchCount: 0,
    completedCount: 0,
    totalActions: emptyActionTotals(),
    totalEvents: 0,
    avgRounds: 0,
    avgDurationSec: null,
    totalDurationSec: 0,
    dateMin: null,
    dateMax: null,
  };
  let roundsSum = 0;
  let durSum = 0;
  let durCount = 0;
  let roundActionsSum = 0;
  let roundCountSum = 0;
  for (const m of matches) {
    if (m.error) continue;
    overview.matchCount += 1;
    if (m.completed) overview.completedCount += 1;
    overview.totalEvents += m.eventCount || 0;
    roundsSum += m.eventStats?.rounds || 0;
    const rounds = m.eventStats?.rounds || 0;
    if (rounds > 0) {
      const at = actionTotalsFromMatch(m);
      roundActionsSum += at.moves + at.attacks + at.deploys + at.heals + at.demolishes + at.captures;
      roundCountSum += rounds;
    }
    const at = actionTotalsFromMatch(m);
    for (const k of Object.keys(overview.totalActions)) {
      overview.totalActions[k] += at[k];
    }
    if (m.date) {
      if (!overview.dateMin || m.date < overview.dateMin) overview.dateMin = m.date;
      if (!overview.dateMax || m.date > overview.dateMax) overview.dateMax = m.date;
    }
    const dur = durationSec(m);
    if (dur != null) {
      durSum += dur;
      durCount += 1;
      overview.totalDurationSec += dur;
    }
  }
  overview.avgRounds = overview.matchCount > 0 ? round2(roundsSum / overview.matchCount) : 0;
  overview.avgActionsPerRound = roundCountSum > 0 ? round2(roundActionsSum / roundCountSum) : 0;
  overview.avgDurationSec = durCount > 0 ? round1(durSum / durCount) : null;
  overview.avgIncomePerMatch = overview.matchCount > 0 ? round1(overview.totalActions.income / overview.matchCount) : 0;
  overview.avgDeployCostPerMatch = overview.matchCount > 0 ? round1(overview.totalActions.deployCost / overview.matchCount) : 0;
  overview.spendRate = overview.totalActions.income > 0 ? round4(overview.totalActions.deployCost / overview.totalActions.income) : 0;
  return overview;
}

/**
 * Per-model behavior profile.
 *   - aggregate raw action counts across that model's participations
 *   - per-game normalized rates
 *   - styleTags: top-2 dimensions where the model's per-game rate beats the
 *     all-model mean rate by the largest relative margin
 */
export function buildModelProfiles(matches) {
  const models = new Map();
  // global per-game rates (averaged over participations) to compare against
  const globalSum = { moves: 0, attacks: 0, heals: 0, deploys: 0, captures: 0, demolishes: 0 };
  let globalParticipations = 0;

  for (const m of matches) {
    if (m.error || !m.participants) continue;
    for (const p of m.participants) {
      const b = models.get(p.model) || emptyModelBucket(p.model);
      b.games += 1;
      const ev = p.events || {};
      b.moves += ev.moves || 0;
      b.attacks += ev.attacks || 0;
      b.deploys += ev.deploys || 0;
      b.heals += ev.heals || 0;
      b.demolishes += ev.demolishes || 0;
      b.captures += ev.captures || 0;
      b.unitDeaths += ev.unitDeaths || 0;
      b.unitDeathsLost += ev.unitDeaths || 0;
      const dbt = ev.deploysByType || {};
      for (const [ut, n] of Object.entries(dbt)) {
        b.deploysByType[ut] = (b.deploysByType[ut] || 0) + n;
      }
      globalSum.moves += ev.moves || 0;
      globalSum.attacks += ev.attacks || 0;
      globalSum.heals += ev.heals || 0;
      globalSum.deploys += ev.deploys || 0;
      globalSum.captures += ev.captures || 0;
      globalSum.demolishes += ev.demolishes || 0;
      globalParticipations += 1;
      models.set(p.model, b);
    }
  }

  const DIM_LABEL = [
    ['attacks', '攻击型'],
    ['heals', '治疗型'],
    ['captures', '扩张型'],
    ['deploys', '爆兵型'],
    ['moves', '机动型'],
    ['demolishes', '拆迁型'],
  ];
  const globalAvg = {};
  for (const [k] of DIM_LABEL) {
    globalAvg[k] = globalParticipations > 0 ? globalSum[k] / globalParticipations : 0;
  }

  const profiles = [...models.values()].map((b) => {
    const perGame = {
      attacks: round2(b.attacks / b.games),
      heals: round2(b.heals / b.games),
      deploys: round2(b.deploys / b.games),
      captures: round2(b.captures / b.games),
      moves: round2(b.moves / b.games),
      demolishes: round2(b.demolishes / b.games),
    };
    // relative edge over global mean per-game rate
    const edges = DIM_LABEL.map(([k, label]) => {
      const mine = b.games > 0 ? b[k] / b.games : 0;
      const g = globalAvg[k] || 0;
      const edge = g > 0 ? (mine - g) / g : (mine > 0 ? 1 : 0);
      return { k, label, edge, mine };
    });
    const styleTags = edges
      .filter((e) => e.mine > 0 && e.edge > 0)
      .sort((a, b2) => b2.edge - a.edge)
      .slice(0, 2)
      .map((e) => e.label);
    return {
      model: b.model,
      games: b.games,
      moves: b.moves,
      attacks: b.attacks,
      deploys: b.deploys,
      heals: b.heals,
      captures: b.captures,
      demolishes: b.demolishes,
      unitDeathsLost: b.unitDeathsLost,
      perGame,
      deploysByType: b.deploysByType,
      styleTags,
    };
  });
  profiles.sort((a, b) => b.games - a.games || a.model.localeCompare(b.model));
  return profiles;
}

function buildUnitStats(matches) {
  const totals = {};
  const byModel = {};
  for (const m of matches) {
    if (m.error || !m.participants) continue;
    for (const p of m.participants) {
      const dbt = p.events?.deploysByType || {};
      for (const [ut, n] of Object.entries(dbt)) {
        totals[ut] = (totals[ut] || 0) + n;
        if (!byModel[ut]) byModel[ut] = {};
        byModel[ut][p.model] = (byModel[ut][p.model] || 0) + n;
      }
    }
  }
  const totalDeploys = Object.values(totals).reduce((s, n) => s + n, 0);
  const order = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  return order.map(([unitType, deploys]) => {
    const byM = byModel[unitType] || {};
    const sorted = Object.entries(byM).sort((a, b) => b[1] - a[1]);
    return {
      unitType,
      deploys,
      share: totalDeploys > 0 ? round4(deploys / totalDeploys) : 0,
      byModel: Object.fromEntries(sorted),
    };
  });
}

/**
 * Per-model economy ledger: income received vs supplies spent on deploys,
 * plus the spend rate (deploy cost / income).
 */
export function buildEconomy(matches) {
  const perModel = new Map();
  for (const m of matches) {
    if (m.error || !m.participants) continue;
    for (const p of m.participants) {
      const ev = p.events || {};
      const b = perModel.get(p.model) || { model: p.model, games: 0, income: 0, deployCost: 0, comebackSupply: 0 };
      b.games += 1;
      b.income += ev.income || 0;
      b.deployCost += ev.deployCost || 0;
      b.comebackSupply += ev.comebackSupply || 0;
      perModel.set(p.model, b);
    }
  }
  return [...perModel.values()]
    .map((b) => ({
      model: b.model,
      games: b.games,
      income: b.income,
      deployCost: b.deployCost,
      comebackSupply: b.comebackSupply,
      avgIncome: round1(b.income / b.games),
      avgDeployCost: round1(b.deployCost / b.games),
      spendRate: b.income > 0 ? round4(b.deployCost / b.income) : 0,
    }))
    .sort((a, b) => b.deployCost - a.deployCost || b.income - a.income || a.model.localeCompare(b.model));
}

/**
 * Elimination ledger: per-model kills (as eliminatedBy), deaths, mutual
 * rivalry pairs where both sides have eliminated the other at least once.
 */
export function buildEliminations(matches) {
  const perModel = new Map();
  const pairs = new Map();
  const bucket = (model) => ({ model, kills: 0, deaths: 0, eliminated: {}, killedBy: {} });

  for (const m of matches) {
    if (m.error || !Array.isArray(m.eliminations)) continue;
    const modelById = new Map((m.participants || []).map((p) => [p.playerId, p.model]));
    for (const el of m.eliminations) {
      const killed = modelById.get(el.playerId);
      const killer = el.eliminatedBy ? modelById.get(el.eliminatedBy) : null;
      if (killed) {
        const b = perModel.get(killed) || bucket(killed);
        b.deaths += 1;
        if (killer && killer !== killed) b.killedBy[killer] = (b.killedBy[killer] || 0) + 1;
        perModel.set(killed, b);
      }
      if (killer) {
        const b = perModel.get(killer) || bucket(killer);
        b.kills += 1;
        if (killed && killer !== killed) b.eliminated[killed] = (b.eliminated[killed] || 0) + 1;
        perModel.set(killer, b);
      }
      if (killer && killed && killer !== killed) {
        const [a, b] = [killer, killed].sort();
        const key = `${a}|${b}`;
        const pair = pairs.get(key) || { a, b, aKillsB: 0, bKillsA: 0 };
        if (killer === a) pair.aKillsB += 1;
        else pair.bKillsA += 1;
        pairs.set(key, pair);
      }
    }
  }

  const killerBoard = [...perModel.values()]
    .map((b) => ({ model: b.model, kills: b.kills, deaths: b.deaths, net: b.kills - b.deaths }))
    .filter((b) => b.kills > 0)
    .sort((a, b) => b.kills - a.kills || b.net - a.net || a.model.localeCompare(b.model));

  const rivalries = [...pairs.values()]
    .filter((p) => p.aKillsB > 0 && p.bKillsA > 0)
    .map((p) => ({ a: p.a, b: p.b, aKillsB: p.aKillsB, bKillsA: p.bKillsA, total: p.aKillsB + p.bKillsA }))
    .sort((x, y) => y.total - x.total || y.aKillsB - x.aKillsB);

  return { killerBoard, rivalries };
}

/** Per-map stage summary: games, pace, capture intensity and dominant winners. */
export function buildMapStage(matches) {
  const byMap = new Map();
  for (const m of matches) {
    if (m.error) continue;
    const b = byMap.get(m.mapId) || { mapId: m.mapId, games: 0, roundsSum: 0, roundsCount: 0, captures: 0, durSum: 0, durCount: 0, wins: {} };
    b.games += 1;
    const rounds = m.eventStats?.rounds || 0;
    if (rounds > 0) {
      b.roundsSum += rounds;
      b.roundsCount += 1;
    }
    b.captures += m.eventStats?.captures || 0;
    const dur = durationSec(m);
    if (dur != null && dur > 0) {
      b.durSum += dur;
      b.durCount += 1;
    }
    const winnerP = (m.participants || []).find((p) => p.isWinner);
    if (winnerP) b.wins[winnerP.model] = (b.wins[winnerP.model] || 0) + 1;
    byMap.set(m.mapId, b);
  }
  return [...byMap.values()]
    .map((b) => ({
      mapId: b.mapId,
      games: b.games,
      avgRounds: b.roundsCount > 0 ? round2(b.roundsSum / b.roundsCount) : null,
      roundsSampled: b.roundsCount,
      capturesPerGame: round2(b.captures / b.games),
      avgDurationSec: b.durCount > 0 ? round1(b.durSum / b.durCount) : null,
      winnerModels: Object.entries(b.wins)
        .sort((a, c) => c[1] - a[1])
        .map(([model, wins]) => ({ model, wins })),
    }))
    .sort((a, b) => b.games - a.games || a.mapId.localeCompare(b.mapId));
}

/** Total effective actions divided by whole rounds of a match. */
function actionsPerRound(m) {
  const es = m.eventStats || {};
  const rounds = es.rounds || 0;
  if (rounds <= 0) return null;
  const at = actionTotalsFromMatch(m);
  const actions = at.moves + at.attacks + at.deploys + at.heals + at.demolishes + at.captures;
  return actions / rounds;
}

function participantSummary(m) {
  return (m.participants || []).map((p) => ({
    displayName: p.displayName,
    model: p.model,
    rank: p.rank,
    isWinner: p.isWinner,
  }));
}

function findMax(matches, getter) {
  let best = null;
  let bestVal = -Infinity;
  for (const m of matches) {
    if (m.error || !m.completed) continue;
    const v = getter(m);
    if (v == null || !Number.isFinite(v)) continue;
    if (v > bestVal) {
      bestVal = v;
      best = m;
    }
  }
  return best ? { match: best, value: bestVal } : null;
}

function findMin(matches, getter, { positiveOnly = false } = {}) {
  let best = null;
  let bestVal = Infinity;
  for (const m of matches) {
    if (m.error || !m.completed) continue;
    const v = getter(m);
    if (v == null || !Number.isFinite(v)) continue;
    if (positiveOnly && v <= 0) continue;
    if (v < bestVal) {
      bestVal = v;
      best = m;
    }
  }
  return best ? { match: best, value: bestVal } : null;
}

export function buildExtremes(matches) {
  const out = {};
  const longR = findMax(matches, (m) => m.eventStats?.rounds || 0);
  if (longR) out.longestByRounds = extremeMatch(longR.match, { rounds: longR.value });

  const shortR = findMin(matches, (m) => m.eventStats?.rounds || 0, { positiveOnly: true });
  if (shortR) out.shortestByRounds = extremeMatch(shortR.match, { rounds: shortR.value });

  const longE = findMax(matches, (m) => m.eventCount || 0);
  if (longE) out.longestByEvents = extremeMatch(longE.match, { eventCount: longE.value });

  const mostAttacks = findMax(matches, (m) => m.eventStats?.attacks || 0);
  if (mostAttacks) out.mostAttacks = extremeMatch(mostAttacks.match, { value: mostAttacks.value, kind: 'attacks' });

  const mostMoves = findMax(matches, (m) => m.eventStats?.moves || 0);
  if (mostMoves) out.mostMoves = extremeMatch(mostMoves.match, { value: mostMoves.value, kind: 'moves' });

  const mostDeploys = findMax(matches, (m) => m.eventStats?.deploys || 0);
  if (mostDeploys) out.mostDeploys = extremeMatch(mostDeploys.match, { value: mostDeploys.value, kind: 'deploys' });

  const mostCaptures = findMax(matches, (m) => m.eventStats?.captures || 0);
  if (mostCaptures) out.mostCaptures = extremeMatch(mostCaptures.match, { value: mostCaptures.value, kind: 'captures' });

  const mostHeals = findMax(matches, (m) => m.eventStats?.heals || 0);
  if (mostHeals) out.mostHeals = extremeMatch(mostHeals.match, { value: mostHeals.value, kind: 'heals' });

  const bloodiest = findMax(matches, (m) => m.eventStats?.unitDeaths || 0);
  if (bloodiest) out.bloodiest = extremeMatch(bloodiest.match, { value: bloodiest.value, kind: 'unitDeaths' });

  // highest single-player HQ damage & biggest single-player score
  let bestHq = null;
  let bestHqVal = -Infinity;
  let bestScore = null;
  let bestScoreVal = -Infinity;
  for (const m of matches) {
    if (m.error || !m.completed || !m.participants) continue;
    for (const p of m.participants) {
      const hq = p.score?.headquartersDamage ?? null;
      if (hq != null && hq > bestHqVal) { bestHqVal = hq; bestHq = { match: m, model: p.model }; }
      const sc = p.score?.total ?? null;
      if (sc != null && sc > bestScoreVal) { bestScoreVal = sc; bestScore = { match: m, model: p.model }; }
    }
  }
  if (bestHq) out.highestHqDamage = { ...extremeMatch(bestHq.match, { value: bestHqVal, kind: 'hqDamage' }), model: bestHq.model };
  if (bestScore) out.biggestScore = { ...extremeMatch(bestScore.match, { value: bestScoreVal, kind: 'score' }), model: bestScore.model };

  const longDur = findMax(matches, durationSec);
  if (longDur) out.longestDuration = extremeMatch(longDur.match, { durationSec: round1(longDur.value) });
  const shortDur = findMin(matches, durationSec, { positiveOnly: true });
  if (shortDur) out.shortestDuration = extremeMatch(shortDur.match, { durationSec: round1(shortDur.value) });

  const busiest = findMax(matches, actionsPerRound);
  if (busiest) out.mostActionsPerRound = extremeMatch(busiest.match, { value: round2(busiest.value), kind: 'actionsPerRound' });

  // single-player biggest deploy spender
  let bestSpend = null;
  let bestSpendVal = -Infinity;
  for (const m of matches) {
    if (m.error || !m.completed || !m.participants) continue;
    for (const p of m.participants) {
      const cost = p.events?.deployCost || 0;
      if (cost > bestSpendVal) {
        bestSpendVal = cost;
        bestSpend = { match: m, model: p.model };
      }
    }
  }
  if (bestSpend) {
    out.biggestSpender = { ...extremeMatch(bestSpend.match, { value: bestSpendVal, kind: 'deployCost' }), model: bestSpend.model };
  }

  return out;
}

function extremeMatch(m, extra) {
  const winnerP = (m.participants || []).find((p) => p.isWinner);
  return {
    recordId: m.recordId,
    date: m.date,
    mapId: m.mapId,
    playerCount: m.playerCount,
    winner: winnerP ? winnerP.displayName : null,
    reason: m.reason,
    participants: participantSummary(m),
    ...extra,
  };
}

export function buildTimeline(matches) {
  const byDay = new Map();
  for (const m of matches) {
    if (m.error || !m.date) continue;
    const day = fmtDate(m.date);
    if (!byDay.has(day)) byDay.set(day, { date: day, matches: 0, totalActions: 0, roundsSum: 0, durSum: 0, durCount: 0 });
    const b = byDay.get(day);
    b.matches += 1;
    const at = actionTotalsFromMatch(m);
    b.totalActions += at.moves + at.attacks + at.deploys + at.heals + at.demolishes + at.captures;
    b.roundsSum += m.eventStats?.rounds || 0;
    const dur = durationSec(m);
    if (dur != null && dur > 0) {
      b.durSum += dur;
      b.durCount += 1;
    }
  }
  let cumulativeMatches = 0;
  let cumulativeActions = 0;
  return [...byDay.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((b) => {
      cumulativeMatches += b.matches;
      cumulativeActions += b.totalActions;
      return {
        date: b.date,
        matches: b.matches,
        totalActions: b.totalActions,
        cumulativeMatches,
        cumulativeActions,
        avgRounds: b.matches > 0 ? round2(b.roundsSum / b.matches) : 0,
        avgDurationSec: b.durCount > 0 ? round1(b.durSum / b.durCount) : null,
      };
    });
}

/** Per-calendar-month trend: pace, action volume and model pool breadth. */
export function buildMonthlyTrend(matches) {
  const byMonth = new Map();
  for (const m of matches) {
    if (m.error || !m.date) continue;
    const month = String(m.date).slice(0, 6); // YYYYMM
    if (!byMonth.has(month)) {
      byMonth.set(month, { month, matches: 0, totalActions: 0, roundsSum: 0, roundsCount: 0, durSum: 0, durCount: 0, models: new Set() });
    }
    const b = byMonth.get(month);
    b.matches += 1;
    const at = actionTotalsFromMatch(m);
    b.totalActions += at.moves + at.attacks + at.deploys + at.heals + at.demolishes + at.captures;
    const rounds = m.eventStats?.rounds || 0;
    if (rounds > 0) {
      b.roundsSum += rounds;
      b.roundsCount += 1;
    }
    const dur = durationSec(m);
    if (dur != null && dur > 0) {
      b.durSum += dur;
      b.durCount += 1;
    }
    for (const p of m.participants || []) b.models.add(p.model);
  }
  return [...byMonth.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((b) => ({
      month: `${b.month.slice(0, 4)}.${b.month.slice(4)}`,
      matches: b.matches,
      totalActions: b.totalActions,
      avgRounds: b.roundsCount > 0 ? round2(b.roundsSum / b.roundsCount) : null,
      avgDurationSec: b.durCount > 0 ? round1(b.durSum / b.durCount) : null,
      activeModels: b.models.size,
    }));
}

/** Per-model debut/latest activity window for a gantt-style lineup. */
export function buildModelDebut(matches) {
  const perModel = new Map();
  for (const m of matches) {
    if (m.error || !m.participants || !m.date) continue;
    for (const p of m.participants) {
      const b = perModel.get(p.model) || {
        model: p.model,
        debutDate: m.date,
        latestDate: m.date,
        games: 0,
        wins: 0,
        debutRecordId: m.recordId,
        latestRecordId: m.recordId,
      };
      b.games += 1;
      if (p.isWinner || p.rank === 1) b.wins += 1;
      if (m.date < b.debutDate) {
        b.debutDate = m.date;
        b.debutRecordId = m.recordId;
      }
      if (m.date > b.latestDate) {
        b.latestDate = m.date;
        b.latestRecordId = m.recordId;
      }
      perModel.set(p.model, b);
    }
  }
  return [...perModel.values()]
    .map((b) => ({ model: b.model, debutDate: fmtDate(b.debutDate), latestDate: fmtDate(b.latestDate), games: b.games, wins: b.wins, debutRecordId: b.debutRecordId, latestRecordId: b.latestRecordId }))
    .sort((a, b) => a.debutDate.localeCompare(b.debutDate) || a.model.localeCompare(b.model));
}

function buildSchemaTimeline(matches) {
  const seen = new Map();
  for (const m of matches) {
    if (m.error) continue;
    const sv = m.schemaVersion || 'unknown';
    if (!seen.has(sv)) seen.set(sv, { schemaVersion: sv, firstDate: m.date, games: 0 });
    const b = seen.get(sv);
    b.games += 1;
    if (m.date && m.date < b.firstDate) b.firstDate = m.date;
  }
  return [...seen.values()]
    .sort((a, b) => a.firstDate.localeCompare(b.firstDate))
    .map((s) => ({ ...s, firstDate: fmtDate(s.firstDate) }));
}

function buildFunFacts(overview, modelProfiles, unitStats, extremes, economy, eliminations, mapStage) {
  const facts = [];
  const ta = overview.totalActions;
  const totalActions = ta.moves + ta.attacks + ta.deploys + ta.heals + ta.demolishes + ta.captures;
  facts.push(
    `在 ${overview.matchCount} 局对局中，共打出 ${totalActions.toLocaleString()} 次操作：${ta.moves.toLocaleString()} 次移动、${ta.attacks.toLocaleString()} 次攻击、${ta.deploys.toLocaleString()} 次部署、${ta.captures.toLocaleString()} 次占领、${ta.heals.toLocaleString()} 次治疗。`,
  );
  facts.push(`战场上有 ${ta.unitDeaths.toLocaleString()} 个单位阵亡，平均每局阵亡 ${(overview.matchCount ? (ta.unitDeaths / overview.matchCount).toFixed(1) : 0)} 个。`);
  if (unitStats.length > 0) {
    const top = unitStats[0];
    facts.push(`最受欢迎的单位是「${top.unitType}」，共部署 ${top.deploys} 次，占全部部署的 ${(top.share * 100).toFixed(0)}%。`);
  }
  if (modelProfiles.length > 0) {
    const atk = [...modelProfiles].sort((a, b) => b.attacks - a.attacks)[0];
    const mob = [...modelProfiles].sort((a, b) => b.moves - a.moves)[0];
    if (atk) facts.push(`最暴躁的模型是「${atk.model}」，累计发起 ${atk.attacks} 次攻击。`);
    if (mob) facts.push(`最勤快的模型是「${mob.model}」，累计移动 ${mob.moves} 次。`);
  }
  if (extremes.longestByRounds) {
    facts.push(`最漫长的一局是 ${extremes.longestByRounds.recordId}，鏖战 ${extremes.longestByRounds.rounds} 整轮。`);
  }
  if (extremes.shortestByRounds) {
    facts.push(`最速决的是 ${extremes.shortestByRounds.recordId}，仅 ${extremes.shortestByRounds.rounds} 整轮便分出胜负。`);
  }
  if (extremes.bloodiest) {
    facts.push(`最血腥的一局是 ${extremes.bloodiest.recordId}，阵亡 ${extremes.bloodiest.value} 个单位。`);
  }
  if (extremes.highestHqDamage && extremes.highestHqDamage.value > 0) {
    facts.push(`单场最强拆迁：${extremes.highestHqDamage.model} 在 ${extremes.highestHqDamage.recordId} 中造成 ${extremes.highestHqDamage.value} 点 HQ 伤害。`);
  }
  if (economy.length > 0) {
    const spender = economy[0];
    facts.push(`最舍得花钱的模型是「${spender.model}」，累计在部署上花掉 ${spender.deployCost.toLocaleString()} 补给（共 ${spender.games} 场）。`);
  }
  const killer = eliminations.killerBoard?.[0];
  if (killer) {
    facts.push(`最无情的终结者是「${killer.model}」，亲手送走 ${killer.kills} 名对手，自己也被淘汰 ${killer.deaths} 次。`);
  }
  const rivalry = eliminations.rivalries?.[0];
  if (rivalry) {
    facts.push(`「${rivalry.a}」与「${rivalry.b}」互相淘汰 ${rivalry.total} 次（${rivalry.aKillsB} : ${rivalry.bKillsA}），是战场上最深的梁子。`);
  }
  if (mapStage.length > 0) {
    const top = mapStage[0];
    if (top.avgRounds != null) {
      facts.push(`最常登场的战场是「${top.mapId}」，出现 ${top.games} 次，平均每局鏖战 ${top.avgRounds} 整轮。`);
    } else {
      facts.push(`最常登场的战场是「${top.mapId}」，出现 ${top.games} 次。`);
    }
  }
  if (extremes.mostActionsPerRound) {
    facts.push(`节奏最密的一局是 ${extremes.mostActionsPerRound.recordId}，平均每轮 ${extremes.mostActionsPerRound.value} 次有效操作。`);
  }
  if (overview.avgDurationSec != null) {
    facts.push(`平均每局耗时约 ${fmtDuration(overview.avgDurationSec)}。`);
  }
  return facts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2), {
    out: join(PROJECT_DIR, 'public', 'data', 'fun-stats.json'),
    usage: 'node script/generateFunStats.mjs [--records dir] [--out file]',
  });
  const { matches, warnings } = collectMatches(opts);

  const valid = matches.filter((m) => !m.error);
  const overview = buildOverview(matches);
  const modelProfiles = buildModelProfiles(matches);
  const unitStats = buildUnitStats(matches);
  const economy = buildEconomy(matches);
  const eliminations = buildEliminations(matches);
  const mapStage = buildMapStage(matches);
  const extremes = buildExtremes(matches);
  const timeline = buildTimeline(matches);
  const monthlyTrend = buildMonthlyTrend(matches);
  const modelDebut = buildModelDebut(matches);
  const schemaTimeline = buildSchemaTimeline(matches);
  const funFacts = buildFunFacts(overview, modelProfiles, unitStats, extremes, economy, eliminations, mapStage);

  const payload = {
    generatedAt: new Date().toISOString(),
    source: {
      versions: opts.versions,
      replayCount: valid.length,
      parseErrors: matches.length - valid.length,
    },
    warnings,
    overview,
    modelProfiles,
    unitStats,
    economy,
    eliminations,
    mapStage,
    extremes,
    funFacts,
    timeline,
    monthlyTrend,
    modelDebut,
    schemaTimeline,
  };

  mkdirSync(dirname(opts.out), { recursive: true });
  writeFileSync(opts.out, JSON.stringify(payload, null, 2), 'utf8');

  console.log(
    `Wrote ${opts.out} — ${payload.source.replayCount} matches, ${modelProfiles.length} models`,
  );
  if (warnings.length) console.warn('Warnings:\n' + warnings.map((w) => `  - ${w}`).join('\n'));
  console.log('Fun facts:');
  for (const f of funFacts) console.log(`  - ${f}`);
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) main();
