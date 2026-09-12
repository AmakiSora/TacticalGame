/**
 * 娱乐数据聚合 —— 扫描 records/V2 + records/V3 回放（复用 generateStats.mjs 的
 * 解析层），产出前端只读的 public/data/fun-stats.json。
 *
 * 3.4.9 大改版，在原有画像/经济/纪录之上新增三条挖掘线：
 *   - combat：伤害/击杀/承伤/治疗量/攻击落空/失误，按模型与全局双粒度
 *   - pace：按回合的节奏曲线（存量回放经 lib/roundAttribution.mjs 重建回合归属）
 *   - momentum：一血/首点转化率、翻盘补给（comeback_supply）效果
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
  isDrawMatch,
  num,
  MAX_DURATION_SEC,
} from './generateStats.mjs';
import { attributeRounds } from './lib/roundAttribution.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = dirname(SCRIPT_DIR);

// 共享层常量/工具转发导出，保持旧调用方（测试）导入路径不变
export { MAX_DURATION_SEC, durationSec } from './generateStats.mjs';

/** 动作构成口径：六种显性操作。 */
const ACTION_KEYS = ['moves', 'attacks', 'deploys', 'heals', 'demolishes', 'captures'];

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
    damageDealt: 0,
    damageTaken: 0,
    damageToHq: 0,
    kills: 0,
    attackMisses: 0,
    healsHp: 0,
    failedActions: 0,
  };
}

function actionTotalsFromMatch(m) {
  const es = m.eventStats || {};
  const out = {};
  for (const k of Object.keys(emptyActionTotals())) out[k] = es[k] || 0;
  return out;
}

/** 一场比赛中某个事件座位的参赛记录（含模型与胜负）。 */
function seatParticipant(m, seat) {
  return (m.participants || []).find((p) => p.playerId === seat) || null;
}

/** 攻击事件的出手方座位：V3 直读 owner，V2 经单位归属索引反查 attackerId。 */
function attackerSeat(m, payload) {
  return payload?.owner || m.unitOwner?.get(payload?.attackerId) || null;
}

/** 攻击是否完成击杀（单位目标且受击后 HP 归零）。 */
function isKillShot(payload) {
  return payload?.hit !== false && payload?.targetKind === 'unit' && num(payload?.targetHp) === 0;
}

/** 攻击实际伤害（miss 计 0）。 */
function attackDamage(payload) {
  if (payload?.hit === false) return 0;
  return num(payload?.actualDamage) ?? num(payload?.damage) ?? 0;
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
    const at = actionTotalsFromMatch(m);
    if (rounds > 0) {
      roundActionsSum += ACTION_KEYS.reduce((s, k) => s + at[k], 0);
      roundCountSum += rounds;
    }
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
  const ta = overview.totalActions;
  overview.attackMissRate = ta.attacks > 0 ? round4(ta.attackMisses / ta.attacks) : 0;
  return overview;
}

/**
 * Per-model behavior + combat profile.
 *   - aggregate raw action counts across that model's participations
 *   - combat: damageDealt / damageTaken / kills / deaths / healsHp / misses / failed
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
      const b = models.get(p.model) || {
        model: p.model,
        games: 0,
        ...emptyActionTotals(),
        unitDeathsLost: 0,
        deploysByType: {},
      };
      b.games += 1;
      const ev = p.events || {};
      for (const k of ['moves', 'attacks', 'deploys', 'heals', 'demolishes', 'captures',
        'damageDealt', 'damageTaken', 'damageToHq', 'kills', 'attackMisses', 'healsHp',
        'failedActions', 'comebackSupply']) {
        b[k] += ev[k] || 0;
      }
      b.unitDeaths += ev.unitDeaths || 0;
      b.unitDeathsLost += ev.unitDeaths || 0;
      const dbt = ev.deploysByType || {};
      for (const [ut, n] of Object.entries(dbt)) {
        b.deploysByType[ut] = (b.deploysByType[ut] || 0) + n;
      }
      for (const k of Object.keys(globalSum)) globalSum[k] += ev[k] || 0;
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
      damageDealt: round2(b.damageDealt / b.games),
      kills: round2(b.kills / b.games),
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
      damageDealt: b.damageDealt,
      damageTaken: b.damageTaken,
      damageToHq: b.damageToHq,
      kills: b.kills,
      attackMisses: b.attackMisses,
      healsHp: b.healsHp,
      failedActions: b.failedActions,
      comebackSupply: b.comebackSupply,
      perGame,
      deploysByType: b.deploysByType,
      styleTags,
    };
  });
  profiles.sort((a, b) => b.games - a.games || a.model.localeCompare(b.model));
  return profiles;
}

/** 兵种：部署占比 + 阵亡占比（含只以预置守军身份出现、零部署的兵种）。 */
export function buildUnitStats(matches) {
  const deploys = {};
  const deaths = {};
  const byModel = {};
  for (const m of matches) {
    if (m.error) continue;
    for (const [ut, n] of Object.entries(m.eventStats?.deathsByType || {})) {
      deaths[ut] = (deaths[ut] || 0) + n;
    }
    for (const p of m.participants || []) {
      const dbt = p.events?.deploysByType || {};
      for (const [ut, n] of Object.entries(dbt)) {
        deploys[ut] = (deploys[ut] || 0) + n;
        if (!byModel[ut]) byModel[ut] = {};
        byModel[ut][p.model] = (byModel[ut][p.model] || 0) + n;
      }
    }
  }
  const totalDeploys = Object.values(deploys).reduce((s, n) => s + n, 0);
  const totalDeaths = Object.values(deaths).reduce((s, n) => s + n, 0);
  const types = new Set([...Object.keys(deploys), ...Object.keys(deaths)]);
  return [...types]
    .map((unitType) => ({
      unitType,
      deploys: deploys[unitType] || 0,
      share: totalDeploys > 0 ? round4((deploys[unitType] || 0) / totalDeploys) : 0,
      deaths: deaths[unitType] || 0,
      deathShare: totalDeaths > 0 ? round4((deaths[unitType] || 0) / totalDeaths) : 0,
      byModel: Object.fromEntries(
        Object.entries(byModel[unitType] || {}).sort((a, b) => b[1] - a[1]),
      ),
    }))
    .sort((a, b) => b.deploys - a.deploys || b.deaths - a.deaths || a.unitType.localeCompare(b.unitType));
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

/**
 * 势头学：一血 / 首点的胜率转化，以及翻盘补给（comeback_supply）效果。
 * 转化率只在分出胜负的完赛局上计算（平局与未完赛不计入样本）。
 */
export function buildMomentum(matches) {
  const firstBlood = { samples: 0, wins: 0, roundSum: 0, fastest: null };
  const firstCapture = { samples: 0, wins: 0, roundSum: 0 };
  const comeback = { triggers: 0, wins: 0, gapSum: 0, maxGap: null };
  const comebackByModel = new Map();

  for (const m of matches) {
    if (m.error || !m.completed || isDrawMatch(m)) continue;
    if (!Array.isArray(m.events) || !m.events.length) continue;
    const attributed = attributeRounds(m.events);
    // attributed 与 events 等长同序，按下标取回合归属（不依赖 seq 存在）。

    // 一血：全场第一次攻击击杀
    const killIdx = m.events.findIndex((e) => e?.type === 'attack' && isKillShot(e.payload));
    if (killIdx >= 0) {
      const killEvent = m.events[killIdx];
      const seat = attackerSeat(m, killEvent.payload);
      const p = seat ? seatParticipant(m, seat) : null;
      if (p) {
        firstBlood.samples += 1;
        if (p.isWinner || p.rank === 1) firstBlood.wins += 1;
        firstBlood.roundSum += attributed[killIdx]?.round || 0;
        const t0 = m.timestamps?.start;
        if (typeof killEvent.timestamp === 'number' && typeof t0 === 'number') {
          const sec = (killEvent.timestamp - t0) / 1000;
          if (sec >= 0 && sec < MAX_DURATION_SEC && (!firstBlood.fastest || sec < firstBlood.fastest.sec)) {
            firstBlood.fastest = {
              sec: round1(sec),
              recordId: m.recordId,
              model: p.model,
              round: attributed[killIdx]?.round ?? null,
            };
          }
        }
      }
    }

    // 首点：全场第一次控制点占领
    const capIdx = m.events.findIndex((e) => e?.type === 'control_point_captured' && e.payload?.owner);
    if (capIdx >= 0) {
      const capEvent = m.events[capIdx];
      const p = seatParticipant(m, capEvent.payload.owner);
      if (p) {
        firstCapture.samples += 1;
        if (p.isWinner || p.rank === 1) firstCapture.wins += 1;
        firstCapture.roundSum += attributed[capIdx]?.round || 0;
      }
    }

    // 翻盘补给：按（对局 × 座位）计一次触发
    const receivers = new Map(); // seat -> { maxGap }
    for (const e of m.events) {
      if (e?.type !== 'comeback_supply' || !e.payload?.owner) continue;
      const cur = receivers.get(e.payload.owner) || { maxGap: 0 };
      cur.maxGap = Math.max(cur.maxGap, num(e.payload?.scoreGap) ?? 0);
      receivers.set(e.payload.owner, cur);
    }
    for (const [seat, info] of receivers) {
      const p = seatParticipant(m, seat);
      if (!p) continue;
      const won = Boolean(p.isWinner || p.rank === 1);
      comeback.triggers += 1;
      if (won) comeback.wins += 1;
      comeback.gapSum += info.maxGap;
      const mb = comebackByModel.get(p.model) || { model: p.model, triggers: 0, wins: 0 };
      mb.triggers += 1;
      if (won) mb.wins += 1;
      comebackByModel.set(p.model, mb);
      if (info.maxGap > 0 && (!comeback.maxGap || info.maxGap > comeback.maxGap.gap)) {
        comeback.maxGap = { gap: round1(info.maxGap), recordId: m.recordId, model: p.model, won };
      }
    }
  }

  return {
    firstBlood: {
      samples: firstBlood.samples,
      wins: firstBlood.wins,
      winRate: firstBlood.samples > 0 ? round4(firstBlood.wins / firstBlood.samples) : null,
      avgRound: firstBlood.samples > 0 ? round2(firstBlood.roundSum / firstBlood.samples) : null,
      fastest: firstBlood.fastest,
    },
    firstCapture: {
      samples: firstCapture.samples,
      wins: firstCapture.wins,
      winRate: firstCapture.samples > 0 ? round4(firstCapture.wins / firstCapture.samples) : null,
      avgRound: firstCapture.samples > 0 ? round2(firstCapture.roundSum / firstCapture.samples) : null,
    },
    comeback: {
      triggers: comeback.triggers,
      wins: comeback.wins,
      winRate: comeback.triggers > 0 ? round4(comeback.wins / comeback.triggers) : null,
      avgGap: comeback.triggers > 0 ? round1(comeback.gapSum / comeback.triggers) : null,
      maxGap: comeback.maxGap,
      byModel: [...comebackByModel.values()].sort((a, b) => b.triggers - a.triggers || a.model.localeCompare(b.model)),
    },
  };
}

/**
 * 回合节奏曲线：把每个事件归属到回合（存量回放由 roundAttribution 重建），
 * 再按「到达该回合的对局」取场均。matches 字段即分母，尾部回合样本自然变薄。
 * attribution 记录归属来源分布，供页面标注数据可信度。
 */
export function buildPace(matches) {
  const perRound = new Map();
  const sources = { payload: 0, anchor: 0, carry: 0, none: 0 };
  let sampled = 0;

  for (const m of matches) {
    if (m.error || !Array.isArray(m.events) || !m.events.length) continue;
    const attributed = attributeRounds(m.events);
    // 无任何锚点/显式回合号的回放（早期 V2 schema 2.0.0 无 round_end）会把整局
    // 事件堆进 R1，污染曲线分母——整局剔除出节奏样本，其余统计不受影响。
    const directHits = attributed.filter((e) => e.source === 'payload' || e.source === 'anchor').length;
    if (directHits === 0) continue;
    const mine = new Map();
    let maxRound = 0;
    for (const e of attributed) {
      if (e.round == null) continue;
      sources[e.source] = (sources[e.source] || 0) + 1;
      if (e.round > maxRound) maxRound = e.round;
      let b = mine.get(e.round);
      if (!b) {
        b = { moves: 0, attacks: 0, deploys: 0, heals: 0, demolishes: 0, captures: 0, damage: 0, kills: 0, deaths: 0 };
        mine.set(e.round, b);
      }
      const p = e.payload || {};
      switch (e.type) {
        case 'move': b.moves += 1; break;
        case 'attack':
          if (p.hit === false) break;
          b.attacks += 1;
          b.damage += attackDamage(p);
          if (isKillShot(p)) b.kills += 1;
          break;
        case 'deploy': b.deploys += 1; break;
        case 'heal': b.heals += 1; break;
        case 'demolish':
        case 'terrain_demolished': b.demolishes += 1; break;
        case 'control_point_captured': b.captures += 1; break;
        case 'unit_death': b.deaths += 1; break;
        default: break;
      }
    }
    if (!maxRound) continue;
    sampled += 1;
    for (let r = 1; r <= maxRound; r++) {
      let g = perRound.get(r);
      if (!g) {
        g = { round: r, matches: 0, moves: 0, attacks: 0, deploys: 0, heals: 0, demolishes: 0, captures: 0, damage: 0, kills: 0, deaths: 0 };
        perRound.set(r, g);
      }
      g.matches += 1;
      const b = mine.get(r);
      if (!b) continue;
      for (const k of ['moves', 'attacks', 'deploys', 'heals', 'demolishes', 'captures', 'damage', 'kills', 'deaths']) {
        g[k] += b[k];
      }
    }
  }

  const byRound = [...perRound.values()]
    .sort((a, b) => a.round - b.round)
    .map((g) => {
      const actions = g.moves + g.attacks + g.deploys + g.heals + g.demolishes + g.captures;
      return {
        round: g.round,
        matches: g.matches,
        actions: round2(actions / g.matches),
        attacks: round2(g.attacks / g.matches),
        damage: round2(g.damage / g.matches),
        kills: round2(g.kills / g.matches),
        captures: round2(g.captures / g.matches),
        deploys: round2(g.deploys / g.matches),
        deaths: round2(g.deaths / g.matches),
      };
    });

  const totalEvents = Object.values(sources).reduce((s, n) => s + n, 0);
  const direct = (sources.payload || 0) + (sources.anchor || 0);
  return {
    sampled,
    byRound,
    attribution: {
      events: totalEvents,
      sources,
      directShare: totalEvents > 0 ? round4(direct / totalEvents) : 0,
    },
  };
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
  const actions = ACTION_KEYS.reduce((s, k) => s + at[k], 0);
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

/** 分出胜负的完赛局（排除平局与未完赛）。 */
function isDecisive(m) {
  return m.completed && !isDrawMatch(m) && (m.participants || []).some((p) => p.isWinner || p.rank === 1);
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

  const mostDamage = findMax(matches, (m) => m.eventStats?.damageDealt || 0);
  if (mostDamage) out.mostDamage = extremeMatch(mostDamage.match, { value: mostDamage.value, kind: 'damage' });

  // 最快分胜负：整轮最少 / 墙钟最短（仅决出赢家的局）
  const decisive = matches.filter((m) => !m.error && isDecisive(m));
  const fastR = findMin(decisive, (m) => m.eventStats?.rounds || 0, { positiveOnly: true });
  if (fastR) out.fastestWinRounds = extremeMatch(fastR.match, { rounds: fastR.value });
  const quickD = findMin(decisive, durationSec, { positiveOnly: true });
  if (quickD) out.quickestWin = extremeMatch(quickD.match, { durationSec: round1(quickD.value) });

  // highest single-player HQ damage & biggest single-player score
  let bestHq = null;
  let bestHqVal = -Infinity;
  let bestScore = null;
  let bestScoreVal = -Infinity;
  let bestKills = null;
  let bestKillsVal = -Infinity;
  let bestSpend = null;
  let bestSpendVal = -Infinity;
  for (const m of matches) {
    if (m.error || !m.completed || !m.participants) continue;
    for (const p of m.participants) {
      const hq = p.score?.headquartersDamage ?? null;
      if (hq != null && hq > bestHqVal) { bestHqVal = hq; bestHq = { match: m, model: p.model }; }
      const sc = p.score?.total ?? null;
      if (sc != null && sc > bestScoreVal) { bestScoreVal = sc; bestScore = { match: m, model: p.model }; }
      const kills = p.events?.kills || 0;
      if (kills > bestKillsVal) { bestKillsVal = kills; bestKills = { match: m, model: p.model }; }
      const cost = p.events?.deployCost || 0;
      if (cost > bestSpendVal) { bestSpendVal = cost; bestSpend = { match: m, model: p.model }; }
    }
  }
  if (bestHq) out.highestHqDamage = { ...extremeMatch(bestHq.match, { value: bestHqVal, kind: 'hqDamage' }), model: bestHq.model };
  if (bestScore) out.biggestScore = { ...extremeMatch(bestScore.match, { value: bestScoreVal, kind: 'score' }), model: bestScore.model };
  if (bestKills) out.singlePlayerKills = { ...extremeMatch(bestKills.match, { value: bestKillsVal, kind: 'kills' }), model: bestKills.model };
  if (bestSpend) out.biggestSpender = { ...extremeMatch(bestSpend.match, { value: bestSpendVal, kind: 'deployCost' }), model: bestSpend.model };

  const longDur = findMax(matches, durationSec);
  if (longDur) out.longestDuration = extremeMatch(longDur.match, { durationSec: round1(longDur.value) });
  const shortDur = findMin(matches, durationSec, { positiveOnly: true });
  if (shortDur) out.shortestDuration = extremeMatch(shortDur.match, { durationSec: round1(shortDur.value) });

  const busiest = findMax(matches, actionsPerRound);
  if (busiest) out.mostActionsPerRound = extremeMatch(busiest.match, { value: round2(busiest.value), kind: 'actionsPerRound' });

  // 最重一击：单次攻击造成的最大实际伤害
  let hit = null;
  for (const m of matches) {
    if (m.error || !m.completed || !Array.isArray(m.events)) continue;
    for (const e of m.events) {
      if (e?.type !== 'attack' || e.payload?.hit === false) continue;
      const v = num(e.payload?.actualDamage) ?? num(e.payload?.damage);
      if (v == null || v <= 0) continue;
      if (!hit || v > hit.value) {
        const seat = attackerSeat(m, e.payload);
        hit = {
          value: v,
          match: m,
          model: seat ? seatParticipant(m, seat)?.model ?? null : null,
          targetKind: e.payload?.targetKind || null,
          killed: isKillShot(e.payload),
        };
      }
    }
  }
  if (hit) {
    out.biggestHit = {
      ...extremeMatch(hit.match, { value: hit.value, kind: 'hit' }),
      model: hit.model,
      targetKind: hit.targetKind,
      killed: hit.killed,
    };
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
    b.totalActions += ACTION_KEYS.reduce((s, k) => s + at[k], 0);
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
    b.totalActions += ACTION_KEYS.reduce((s, k) => s + at[k], 0);
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

function buildFunFacts(overview, modelProfiles, unitStats, extremes, economy, eliminations, mapStage, momentum) {
  const facts = [];
  const ta = overview.totalActions;
  const totalActions = ACTION_KEYS.reduce((s, k) => s + ta[k], 0);
  facts.push(
    `在 ${overview.matchCount} 局对局中，共打出 ${totalActions.toLocaleString()} 次操作：${ta.moves.toLocaleString()} 次移动、${ta.attacks.toLocaleString()} 次攻击、${ta.deploys.toLocaleString()} 次部署、${ta.captures.toLocaleString()} 次占领、${ta.heals.toLocaleString()} 次治疗。`,
  );
  facts.push(`战场上共倾泻 ${ta.damageDealt.toLocaleString()} 点伤害、击杀 ${ta.kills.toLocaleString()} 个单位（阵亡 ${ta.unitDeaths.toLocaleString()}），治疗挽回 ${ta.healsHp.toLocaleString()} 点生命。`);
  if (ta.attackMisses > 0) {
    facts.push(`同时回合模式下共有 ${ta.attackMisses.toLocaleString()} 次攻击落空（落空率 ${(overview.attackMissRate * 100).toFixed(1)}%）——预判走位是有代价的。`);
  }
  if (unitStats.length > 0) {
    const top = unitStats[0];
    facts.push(`最受欢迎的单位是「${top.unitType}」，共部署 ${top.deploys} 次，占全部部署的 ${(top.share * 100).toFixed(0)}%。`);
    const fragile = [...unitStats].filter((u) => u.deaths > 0).sort((a, b) => b.deathShare - a.deathShare)[0];
    if (fragile) facts.push(`阵亡榜上「${fragile.unitType}」占比最高（${(fragile.deathShare * 100).toFixed(0)}%，共 ${fragile.deaths} 次）。`);
  }
  const reliable = modelProfiles.filter((p) => p.games >= 3);
  if (reliable.length > 0) {
    const fire = [...reliable].sort((a, b) => b.perGame.damageDealt - a.perGame.damageDealt)[0];
    facts.push(`火力王是「${fire.model}」，场均输出 ${fire.perGame.damageDealt} 点伤害（至少 3 场样本）。`);
    const atk = [...modelProfiles].sort((a, b) => b.attacks - a.attacks)[0];
    const mob = [...modelProfiles].sort((a, b) => b.moves - a.moves)[0];
    if (atk) facts.push(`最暴躁的模型是「${atk.model}」，累计发起 ${atk.attacks} 次攻击。`);
    if (mob) facts.push(`最勤快的模型是「${mob.model}」，累计移动 ${mob.moves} 次。`);
  }
  if (momentum?.firstBlood?.samples > 0) {
    const fb = momentum.firstBlood;
    facts.push(`拿到一血的一方赢下了 ${(fb.winRate * 100).toFixed(0)}% 的对局（${fb.wins}/${fb.samples}），一血平均出现在第 ${fb.avgRound} 回合。`);
  }
  if (momentum?.firstCapture?.samples > 0) {
    const fc = momentum.firstCapture;
    facts.push(`首个控制点的得主赢下了 ${(fc.winRate * 100).toFixed(0)}% 的对局（${fc.wins}/${fc.samples}）。`);
  }
  if (momentum?.comeback?.maxGap) {
    const cg = momentum.comeback;
    facts.push(`翻盘补给共触发 ${cg.triggers} 次，受援方胜率 ${(cg.winRate * 100).toFixed(0)}%；最大分差 ${cg.maxGap.gap} 出现在 ${cg.maxGap.recordId}（${cg.maxGap.model} 最终${cg.maxGap.won ? '翻盘成功' : '未能翻盘'}）。`);
  }
  if (extremes.biggestHit) {
    facts.push(`最重一击：${extremes.biggestHit.model || '某位选手'} 在 ${extremes.biggestHit.recordId} 打出 ${extremes.biggestHit.value} 点伤害${extremes.biggestHit.killed ? '，一击致命' : ''}。`);
  }
  if (extremes.fastestWinRounds) {
    facts.push(`最快分胜负的是 ${extremes.fastestWinRounds.recordId}，仅 ${extremes.fastestWinRounds.rounds} 整轮便锁定赢家。`);
  }
  if (extremes.longestByRounds) {
    facts.push(`最漫长的一局是 ${extremes.longestByRounds.recordId}，鏖战 ${extremes.longestByRounds.rounds} 整轮。`);
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
  const momentum = buildMomentum(matches);
  const pace = buildPace(matches);
  const mapStage = buildMapStage(matches);
  const extremes = buildExtremes(matches);
  const timeline = buildTimeline(matches);
  const monthlyTrend = buildMonthlyTrend(matches);
  const modelDebut = buildModelDebut(matches);
  const schemaTimeline = buildSchemaTimeline(matches);
  const funFacts = buildFunFacts(overview, modelProfiles, unitStats, extremes, economy, eliminations, mapStage, momentum);

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
    momentum,
    pace,
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
