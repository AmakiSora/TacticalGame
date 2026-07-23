#!/usr/bin/env node
/**
 * Scan records/V2 + records/V3 replay JSON (and companion review MD names),
 * write a frontend-consumable aggregate to public/data/stats.json.
 *
 * Usage:
 *   node script/generateStats.mjs
 *   node script/generateStats.mjs --out public/data/stats.json
 *   node script/generateStats.mjs --records records
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = dirname(SCRIPT_DIR);

const KNOWN_AGENTS = new Set(['PI', 'CX', 'CC', 'QW', 'OMP', 'WB', 'ZC', 'SCRIPT', 'QD', 'QW']);

/** Canonical model keys (lowercase). */
const MODEL_ALIASES = new Map([
  ['dsv4f', 'deepseekv4flash'],
  ['dsv4', 'deepseekv4flash'],
  ['deepseekv4f', 'deepseekv4flash'],
  ['step3.7f', 'step3.7flash'],
  ['step3.7flash', 'step3.7flash'],
  ['mimo2.5proa', 'mimo2.5pro'],
  ['mimo2.5prob', 'mimo2.5pro'],
  ['mimo2.5pro', 'mimo2.5pro'],
  ['minimaxm3', 'minimaxm3'],
  ['sensenova6.7fl', 'sensenova6.7fl'],
  ['longcat2.0', 'longcat2.0'],
  ['agnes2.0flash', 'agnes2.0flash'],
  ['qwen3.6v35b', 'qwen3.6v35b'],
  ['qwen3.7max', 'qwen3.7max'],
  ['qwen3.8max', 'qwen3.8max'],
  ['glm5.2', 'glm5.2'],
  ['glm5.1', 'glm5.1'],
  ['glm4.7', 'glm4.7'],
  ['gpt5.5', 'gpt5.5'],
  ['gpt5.6sol', 'gpt5.6sol'],
  ['hy3', 'hy3'],
  ['kimik3', 'kimik3'],
  ['grok4.5', 'grok4.5'],
  ['fable5', 'fable5'],
  ['doubaoseed2.1pro', 'doubaoseed2.1pro'],
  ['deepseekv4pro', 'deepseekv4pro'],
  ['deepseekv4flash', 'deepseekv4flash'],
]);

const REPLAY_JSON_RE = /^(tg_\d+)_(\d{8})\.json$/i;
const REVIEW_MD_RE =
  /^(tg_\d+)(?:-\d+)?_(win|lose|draw|terminated|deadlock|rank(\d+))_([A-Za-z0-9]+)@(.+)\.md$/i;

function parseArgs(argv) {
  const opts = {
    records: join(PROJECT_DIR, 'records'),
    out: join(PROJECT_DIR, 'public', 'data', 'stats.json'),
    versions: ['V2', 'V3'],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') opts.out = resolve(argv[++i]);
    else if (a === '--records') opts.records = resolve(argv[++i]);
    else if (a === '--help' || a === '-h') {
      console.log(`Usage: node script/generateStats.mjs [--records dir] [--out file]`);
      process.exit(0);
    }
  }
  return opts;
}

function lower(s) {
  return String(s || '').trim().toLowerCase();
}

function canonicalizeModel(raw) {
  let key = lower(raw).replace(/\s+/g, '');
  if (!key) return 'unknown';
  // Self-play seat tags only: ModelA / ModelB (not models that naturally end in b like v35b)
  if (/^(mimo2\.5pro|deepseekv4flash|step3\.7flash|longcat2\.0)[ab]$/i.test(key)) {
    key = key.slice(0, -1);
  }
  if (MODEL_ALIASES.has(key)) return MODEL_ALIASES.get(key);
  for (const [alias, canon] of MODEL_ALIASES) {
    if (key.replace(/[-_]/g, '') === alias.replace(/[-_]/g, '')) return canon;
  }
  return key;
}

function canonicalizeAgent(raw) {
  const a = String(raw || '').trim().toUpperCase();
  if (!a) return 'UNKNOWN';
  if (a === 'SCRIPT') return 'SCRIPT';
  return a;
}

/**
 * Parse free-form player display names into { model, agent, displayName }.
 * Patterns:
 *   "Hy3-WB", "deepseekv4flash-PI", "Qwen3.8Max-QD", "glm5.2-WB"
 *   "MiMo2.5pro", "sensenova6.7fl", "dsv4f-Script"
 *   "MiMo2.5proA" / "MiMo2.5proB"
 */
function parseDisplayName(displayName) {
  const raw = String(displayName || '').trim() || 'unknown';
  // Pattern: model-AGENT (agent is short uppercase-ish token at end)
  const dash = raw.match(/^(.*?)[-_]([A-Za-z]{1,8})$/);
  if (dash) {
    const maybeAgent = canonicalizeAgent(dash[2]);
    const maybeModel = canonicalizeModel(dash[1]);
    if (KNOWN_AGENTS.has(maybeAgent) || maybeAgent === 'SCRIPT' || dash[2].length <= 4) {
      // avoid splitting model names that end with common words unless agent known
      if (KNOWN_AGENTS.has(maybeAgent) || maybeAgent === 'SCRIPT') {
        return { displayName: raw, model: maybeModel, agent: maybeAgent };
      }
    }
  }
  return { displayName: raw, model: canonicalizeModel(raw), agent: 'UNKNOWN' };
}

function parseReviewFileName(fileName) {
  const m = fileName.match(REVIEW_MD_RE);
  if (!m) return null;
  const rankNum = m[3] ? Number(m[3]) : null;
  let result = m[2].toLowerCase();
  if (rankNum != null) result = 'rank';
  return {
    recordId: m[1].toLowerCase(),
    result,
    rank: rankNum,
    agent: canonicalizeAgent(m[4]),
    model: canonicalizeModel(m[5].replace(/\.md$/i, '')),
    fileName,
  };
}

function scoreOf(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const headquartersDamage =
    num(raw.headquartersDamage) ?? num(raw.enemyHqDamage) ?? 0;
  return {
    headquartersDamage,
    ownHqHp: num(raw.ownHqHp) ?? 0,
    controlPoints: num(raw.controlPoints) ?? 0,
    armyValue: num(raw.armyValue) ?? 0,
    supplies: num(raw.supplies) ?? 0,
    total: num(raw.total) ?? 0,
  };
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function emptyEventStats() {
  return {
    moves: 0,
    attacks: 0,
    deploys: 0,
    heals: 0,
    demolishes: 0,
    captures: 0,
    unitDeaths: 0,
    rounds: 0,
    turns: 0,
    deploysByType: {},
  };
}

function tallyEvent(stats, type, payload) {
  switch (type) {
    case 'move':
      stats.moves += 1;
      break;
    case 'attack':
      stats.attacks += 1;
      break;
    case 'deploy':
      stats.deploys += 1;
      if (payload?.unitType) {
        stats.deploysByType[payload.unitType] = (stats.deploysByType[payload.unitType] || 0) + 1;
      }
      break;
    case 'heal':
      stats.heals += 1;
      break;
    case 'demolish':
    case 'terrain_demolished':
      stats.demolishes += 1;
      break;
    case 'control_point_captured':
      stats.captures += 1;
      break;
    case 'unit_death':
      stats.unitDeaths += 1;
      break;
    case 'round_end':
      stats.rounds += 1;
      break;
    case 'turn_end':
      stats.turns += 1;
      break;
    default:
      break;
  }
}

function loadReplay(filePath) {
  const text = readFileSync(filePath, 'utf8');
  const data = JSON.parse(text);
  // legacy: pure event array
  if (Array.isArray(data)) {
    return {
      format: 'legacy-event-array',
      schemaVersion: '1.0.0',
      gameId: null,
      mapId: null,
      playerNames: null,
      exportedAt: null,
      finalResult: null,
      events: data,
    };
  }
  return data;
}

function extractMatch(filePath, version, fileName, reviewsByRecord) {
  const m = fileName.match(REPLAY_JSON_RE);
  if (!m) return null;
  const recordId = m[1].toLowerCase();
  const date = m[2];

  let data;
  try {
    data = loadReplay(filePath);
  } catch (err) {
    return {
      recordId,
      version,
      date,
      fileName,
      error: `parse_failed: ${err.message}`,
    };
  }

  const events = Array.isArray(data.events) ? data.events : [];
  const gameStart = events.find(e => e?.type === 'game_start');
  const gameOver = events.find(e => e?.type === 'game_over') ||
    [...events].reverse().find(e => e?.type === 'game_over');
  const gs = gameStart?.payload || {};
  const go = gameOver?.payload || {};

  const mapId =
    data.mapId ||
    gs.mapId ||
    gs.map?.id ||
    null;

  const playerNames = {
    ...(gs.playerNames || {}),
    ...(data.playerNames || {}),
  };

  // Discover seats from names, start payload, scores, rankings, turnOrder
  const seatSet = new Set([
    ...Object.keys(playerNames),
    ...Object.keys(gs.players || {}),
    ...Object.keys(gs.headquarters || {}),
    ...Object.keys(gs.resources || {}),
    ...(Array.isArray(gs.turnOrder) ? gs.turnOrder : []),
    ...Object.keys(data.finalResult?.scores || {}),
    ...Object.keys(go.scores || {}),
  ]);
  if (Array.isArray(go.rankings)) {
    for (const r of go.rankings) if (r?.playerId) seatSet.add(r.playerId);
  }
  // fallback classic duo
  if (seatSet.size === 0) {
    seatSet.add('player_a');
    seatSet.add('player_b');
  }

  const seats = [...seatSet].filter(s => /^player_[a-h]$/.test(s)).sort();

  // Resolve names if missing
  for (const seat of seats) {
    if (!playerNames[seat]) {
      const fromPlayers = gs.players?.[seat]?.name;
      if (fromPlayers) playerNames[seat] = fromPlayers;
    }
  }

  const finalResult = data.finalResult || null;
  const winner =
    finalResult?.winner ??
    go.winner ??
    null;
  let reason =
    finalResult?.reason ??
    go.reason ??
    null;
  // Infer legacy endings when payload only has winner.
  if (!reason && winner) {
    if (events.some(e => e?.type === 'headquarters_destroyed')) {
      reason = 'headquarters_destroyed';
    } else if (events.some(e => e?.type === 'player_eliminated')) {
      reason = 'last_player_standing';
    } else {
      reason = 'unknown';
    }
  }

  const scoresRaw = finalResult?.scores || go.scores || null;
  const rankingsRaw = Array.isArray(go.rankings) ? go.rankings : null;

  // Build per-seat rank/score/status
  const seatMeta = {};
  for (const seat of seats) {
    seatMeta[seat] = {
      playerId: seat,
      displayName: playerNames[seat] || seat,
      rank: null,
      status: null,
      score: scoresRaw ? scoreOf(scoresRaw[seat]) : null,
      isWinner: winner != null && seat === winner,
    };
  }

  if (rankingsRaw) {
    for (const r of rankingsRaw) {
      if (!r?.playerId || !seatMeta[r.playerId]) continue;
      seatMeta[r.playerId].rank = num(r.rank);
      seatMeta[r.playerId].status = r.status || null;
      if (r.score) seatMeta[r.playerId].score = scoreOf(r.score);
      if (num(r.rank) === 1) seatMeta[r.playerId].isWinner = true;
    }
  } else if (scoresRaw && seats.length > 0) {
    // rank by total desc; eliminated (ownHqHp 0 + not winner) still ranked
    const ordered = seats
      .map(id => ({ id, total: seatMeta[id].score?.total ?? -1 }))
      .sort((a, b) => b.total - a.total);
    ordered.forEach((row, i) => {
      seatMeta[row.id].rank = i + 1;
    });
    if (winner && seatMeta[winner]) {
      seatMeta[winner].rank = 1;
      // re-pack others after winner
      let next = 2;
      for (const row of ordered) {
        if (row.id === winner) continue;
        seatMeta[row.id].rank = next++;
      }
    }
  } else if (winner) {
    // only winner known (early V2)
    for (const seat of seats) {
      if (seat === winner) {
        seatMeta[seat].rank = 1;
        seatMeta[seat].status = 'active';
        seatMeta[seat].isWinner = true;
      } else {
        seatMeta[seat].rank = seats.length === 2 ? 2 : null;
        seatMeta[seat].status = 'unknown';
        seatMeta[seat].isWinner = false;
      }
    }
  }

  // Companion review MD → better agent/model, and terminated/deadlock flags
  const reviews = reviewsByRecord.get(recordId) || [];
  const reviewFlags = {
    terminated: reviews.some(r => r.result === 'terminated'),
    deadlock: reviews.some(r => r.result === 'deadlock'),
  };

  // identity: start from displayName, refine with MD when model matches
  const participants = seats.map(seat => {
    const meta = seatMeta[seat];
    let identity = parseDisplayName(meta.displayName);

    // try match review by rank first (multiplayer rank files)
    const byRank = reviews.find(
      r => r.rank != null && meta.rank != null && r.rank === meta.rank,
    );
    if (byRank) {
      identity = {
        displayName: meta.displayName,
        model: byRank.model || identity.model,
        agent: byRank.agent || identity.agent,
      };
    } else {
      // match by model key against displayName-derived model
      const byModel = reviews.filter(r => r.model === identity.model);
      if (byModel.length === 1) {
        identity = {
          displayName: meta.displayName,
          model: byModel[0].model,
          agent: byModel[0].agent || identity.agent,
        };
      } else if (identity.agent === 'UNKNOWN') {
        // match win/lose for 2p
        if (meta.isWinner) {
          const win = reviews.find(r => r.result === 'win');
          if (win) identity = { displayName: meta.displayName, model: win.model, agent: win.agent };
        } else if (meta.rank === 2 || (winner && seat !== winner)) {
          const lose = reviews.find(r => r.result === 'lose');
          if (lose) identity = { displayName: meta.displayName, model: lose.model, agent: lose.agent };
        }
      }
    }

    return {
      playerId: seat,
      displayName: meta.displayName,
      model: identity.model,
      agent: identity.agent,
      rank: meta.rank,
      status: meta.status,
      score: meta.score,
      isWinner: Boolean(meta.isWinner),
    };
  });

  // Event tallies (global + per seat when owner present)
  const eventStats = emptyEventStats();
  const perSeatEvents = Object.fromEntries(seats.map(s => [s, emptyEventStats()]));
  // unit owner index for attacks without owner field
  const unitOwner = new Map();
  // seed from game_start units
  const startUnits = gs.units;
  if (Array.isArray(startUnits)) {
    for (const u of startUnits) if (u?.id && u?.owner) unitOwner.set(u.id, u.owner);
  } else if (startUnits && typeof startUnits === 'object') {
    for (const u of Object.values(startUnits)) if (u?.id && u?.owner) unitOwner.set(u.id, u.owner);
  }

  let hqKills = 0;
  const eliminations = [];

  for (const ev of events) {
    const type = ev?.type;
    const payload = ev?.payload || {};
    tallyEvent(eventStats, type, payload);

    if (type === 'deploy' && payload.unitId && payload.owner) {
      unitOwner.set(payload.unitId, payload.owner);
      const seat = payload.owner;
      if (perSeatEvents[seat]) tallyEvent(perSeatEvents[seat], type, payload);
    } else if (type === 'move' || type === 'attack' || type === 'heal' || type === 'demolish' || type === 'terrain_demolished') {
      const owner =
        payload.owner ||
        unitOwner.get(payload.unitId) ||
        unitOwner.get(payload.attackerId) ||
        unitOwner.get(payload.supportId) ||
        null;
      if (owner && perSeatEvents[owner]) tallyEvent(perSeatEvents[owner], type, payload);
      else if (type !== 'attack') {
        /* global only already counted */
      }
      if (type === 'attack') {
        // still try count under attacker owner
        const atkOwner = unitOwner.get(payload.attackerId);
        if (atkOwner && perSeatEvents[atkOwner] && !payload.owner) {
          // already not counted per-seat above if owner missing — count now
          if (!payload.owner && !unitOwner.get(payload.unitId)) {
            tallyEvent(perSeatEvents[atkOwner], type, payload);
          }
        }
      }
    } else if (type === 'control_point_captured' && payload.owner && perSeatEvents[payload.owner]) {
      tallyEvent(perSeatEvents[payload.owner], type, payload);
    } else if (type === 'unit_death' && payload.owner && perSeatEvents[payload.owner]) {
      tallyEvent(perSeatEvents[payload.owner], type, payload);
    }

    if (type === 'headquarters_destroyed') hqKills += 1;
    if (type === 'player_eliminated') {
      eliminations.push({
        playerId: payload.playerId ?? null,
        eliminatedBy: payload.eliminatedBy ?? null,
        reason: payload.reason ?? null,
      });
    }
  }

  // attach per-seat event stats onto participants
  for (const p of participants) {
    p.events = perSeatEvents[p.playerId] || emptyEventStats();
  }

  const completed = Boolean(gameOver) || Boolean(winner);
  const playerCount = participants.length;
  const schemaVersion = data.schemaVersion || 'unknown';
  const exportedAt = data.exportedAt || null;
  const gameId = data.gameId || gs.gameId || null;

  // duration from first/last event timestamps if present
  const ts0 = events[0]?.timestamp ?? null;
  const ts1 = events[events.length - 1]?.timestamp ?? null;

  return {
    recordId,
    version,
    date,
    fileName,
    filePath: filePath.replace(/\\/g, '/'),
    gameId,
    mapId: mapId || 'unknown',
    schemaVersion,
    exportedAt,
    playerCount,
    playerNames,
    participants,
    winner,
    reason: reason || (completed ? 'unknown' : 'incomplete'),
    completed,
    eventCount: events.length,
    eventStats,
    eliminations,
    hqKills,
    reviewFlags,
    reviews: reviews.map(r => ({
      result: r.result,
      rank: r.rank,
      agent: r.agent,
      model: r.model,
      fileName: r.fileName,
    })),
    timestamps: { start: ts0, end: ts1 },
  };
}

function emptyModelBucket(model) {
  return {
    model,
    games: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    top3: 0,
    rankSum: 0,
    rankCount: 0,
    scoreSum: 0,
    scoreCount: 0,
    hqDamageSum: 0,
    hqDamageCount: 0,
    agents: {},
    maps: {},
    versions: {},
    vs: {}, // opponentModel -> { games, wins }
    recent: [], // last few recordIds
  };
}

function aggregate(matches) {
  const overview = {
    matchCount: 0,
    completedCount: 0,
    incompleteCount: 0,
    parseErrorCount: 0,
    playerCountDist: {},
    reasonDist: {},
    mapDist: {},
    versionDist: {},
    schemaDist: {},
    totalEvents: 0,
    avgRounds: 0,
    dateMin: null,
    dateMax: null,
  };

  const models = new Map();
  const agents = new Map();
  const maps = new Map();

  const validMatches = [];

  for (const match of matches) {
    if (match.error) {
      overview.parseErrorCount += 1;
      continue;
    }
    validMatches.push(match);
    overview.matchCount += 1;
    if (match.completed) overview.completedCount += 1;
    else overview.incompleteCount += 1;

    overview.playerCountDist[match.playerCount] =
      (overview.playerCountDist[match.playerCount] || 0) + 1;
    overview.reasonDist[match.reason] = (overview.reasonDist[match.reason] || 0) + 1;
    overview.mapDist[match.mapId] = (overview.mapDist[match.mapId] || 0) + 1;
    overview.versionDist[match.version] = (overview.versionDist[match.version] || 0) + 1;
    overview.schemaDist[match.schemaVersion] =
      (overview.schemaDist[match.schemaVersion] || 0) + 1;
    overview.totalEvents += match.eventCount || 0;

    if (match.date) {
      if (!overview.dateMin || match.date < overview.dateMin) overview.dateMin = match.date;
      if (!overview.dateMax || match.date > overview.dateMax) overview.dateMax = match.date;
    }

    if (!maps.has(match.mapId)) {
      maps.set(match.mapId, {
        mapId: match.mapId,
        games: 0,
        reasons: {},
        playerCounts: {},
        avgRoundsSum: 0,
      });
    }
    const mapBucket = maps.get(match.mapId);
    mapBucket.games += 1;
    mapBucket.reasons[match.reason] = (mapBucket.reasons[match.reason] || 0) + 1;
    mapBucket.playerCounts[match.playerCount] =
      (mapBucket.playerCounts[match.playerCount] || 0) + 1;
    mapBucket.avgRoundsSum += match.eventStats?.rounds || 0;

    // pairwise model matchups within this game
    const parts = match.participants || [];
    for (const p of parts) {
      if (!models.has(p.model)) models.set(p.model, emptyModelBucket(p.model));
      const b = models.get(p.model);
      b.games += 1;
      b.agents[p.agent] = (b.agents[p.agent] || 0) + 1;
      b.maps[match.mapId] = (b.maps[match.mapId] || 0) + 1;
      b.versions[match.version] = (b.versions[match.version] || 0) + 1;
      b.recent.push(match.recordId);
      if (b.recent.length > 8) b.recent.shift();

      const isDraw = match.reason === 'turn_limit_draw' || match.reviewFlags?.deadlock;
      if (isDraw) b.draws += 1;
      else if (p.isWinner || p.rank === 1) b.wins += 1;
      else if (p.rank != null || match.completed) b.losses += 1;

      if (p.rank != null && p.rank <= 3) b.top3 += 1;
      if (p.rank != null) {
        b.rankSum += p.rank;
        b.rankCount += 1;
      }
      if (p.score?.total != null) {
        b.scoreSum += p.score.total;
        b.scoreCount += 1;
      }
      if (p.score?.headquartersDamage != null) {
        b.hqDamageSum += p.score.headquartersDamage;
        b.hqDamageCount += 1;
      }

      // agent aggregate
      if (!agents.has(p.agent)) {
        agents.set(p.agent, { agent: p.agent, games: 0, wins: 0, models: {} });
      }
      const ag = agents.get(p.agent);
      ag.games += 1;
      if (p.isWinner || p.rank === 1) ag.wins += 1;
      ag.models[p.model] = (ag.models[p.model] || 0) + 1;

      // head-to-head: count vs every other participant
      for (const opp of parts) {
        if (opp.playerId === p.playerId) continue;
        if (!b.vs[opp.model]) b.vs[opp.model] = { games: 0, wins: 0 };
        b.vs[opp.model].games += 1;
        if ((p.isWinner || p.rank === 1) && !(opp.isWinner || opp.rank === 1)) {
          b.vs[opp.model].wins += 1;
        } else if (
          p.rank != null &&
          opp.rank != null &&
          p.rank < opp.rank
        ) {
          // ranked higher than this opponent
          b.vs[opp.model].wins += 1;
        }
      }
    }
  }

  const roundsTotal = validMatches.reduce((s, m) => s + (m.eventStats?.rounds || 0), 0);
  overview.avgRounds =
    validMatches.length > 0 ? round2(roundsTotal / validMatches.length) : 0;

  const modelLeaderboard = [...models.values()]
    .map(b => {
      const winRate = b.games > 0 ? b.wins / b.games : 0;
      const top3Rate = b.games > 0 ? b.top3 / b.games : 0;
      const avgRank = b.rankCount > 0 ? b.rankSum / b.rankCount : null;
      const avgScore = b.scoreCount > 0 ? b.scoreSum / b.scoreCount : null;
      const avgHqDamage = b.hqDamageCount > 0 ? b.hqDamageSum / b.hqDamageCount : null;
      // simple rating: winRate weighted by sample size (Wilson-ish light)
      const rating = wilsonLower(b.wins, b.games);
      return {
        model: b.model,
        games: b.games,
        wins: b.wins,
        losses: b.losses,
        draws: b.draws,
        top3: b.top3,
        winRate: round4(winRate),
        top3Rate: round4(top3Rate),
        avgRank: avgRank == null ? null : round2(avgRank),
        avgScore: avgScore == null ? null : round1(avgScore),
        avgHqDamage: avgHqDamage == null ? null : round1(avgHqDamage),
        rating: round4(rating),
        agents: b.agents,
        maps: b.maps,
        versions: b.versions,
        vs: b.vs,
        recent: b.recent,
      };
    })
    .sort((a, b) => {
      // primary: rating, then wins, then games
      if (b.rating !== a.rating) return b.rating - a.rating;
      if (b.wins !== a.wins) return b.wins - a.wins;
      return b.games - a.games;
    })
    .map((row, i) => ({ rank: i + 1, ...row }));

  const agentLeaderboard = [...agents.values()]
    .map(a => ({
      agent: a.agent,
      games: a.games,
      wins: a.wins,
      winRate: a.games > 0 ? round4(a.wins / a.games) : 0,
      models: a.models,
    }))
    .sort((a, b) => b.wins - a.wins || b.games - a.games);

  const mapStats = [...maps.values()]
    .map(m => ({
      mapId: m.mapId,
      games: m.games,
      reasons: m.reasons,
      playerCounts: m.playerCounts,
      avgRounds: m.games > 0 ? round2(m.avgRoundsSum / m.games) : 0,
    }))
    .sort((a, b) => b.games - a.games);

  // compact match list for UI table
  const matchSummaries = validMatches
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.recordId < b.recordId ? 1 : -1))
    .map(m => ({
      recordId: m.recordId,
      version: m.version,
      date: m.date,
      fileName: m.fileName,
      gameId: m.gameId,
      mapId: m.mapId,
      schemaVersion: m.schemaVersion,
      playerCount: m.playerCount,
      winner: m.winner,
      reason: m.reason,
      completed: m.completed,
      eventCount: m.eventCount,
      rounds: m.eventStats?.rounds ?? 0,
      participants: m.participants.map(p => ({
        playerId: p.playerId,
        displayName: p.displayName,
        model: p.model,
        agent: p.agent,
        rank: p.rank,
        isWinner: p.isWinner,
        status: p.status,
        scoreTotal: p.score?.total ?? null,
        headquartersDamage: p.score?.headquartersDamage ?? null,
      })),
      reviewFlags: m.reviewFlags,
    }));

  return {
    overview,
    modelLeaderboard,
    agentLeaderboard,
    mapStats,
    matches: matchSummaries,
  };
}

/** Wilson score lower bound (z≈1.96) for ranking with small samples. */
function wilsonLower(wins, n) {
  if (n <= 0) return 0;
  const z = 1.96;
  const p = wins / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return (centre - margin) / denom;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}
function round2(n) {
  return Math.round(n * 100) / 100;
}
function round4(n) {
  return Math.round(n * 10000) / 10000;
}

function collectReviews(versionDir) {
  const byRecord = new Map();
  let files;
  try {
    files = readdirSync(versionDir);
  } catch {
    return byRecord;
  }
  for (const f of files) {
    if (!f.endsWith('.md')) continue;
    const parsed = parseReviewFileName(f);
    if (!parsed) continue;
    if (!byRecord.has(parsed.recordId)) byRecord.set(parsed.recordId, []);
    byRecord.get(parsed.recordId).push(parsed);
  }
  return byRecord;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const matches = [];
  const warnings = [];

  for (const version of opts.versions) {
    const dir = join(opts.records, version);
    let files;
    try {
      files = readdirSync(dir);
    } catch (err) {
      warnings.push(`skip ${version}: ${err.message}`);
      continue;
    }
    const reviews = collectReviews(dir);
    for (const f of files) {
      if (!REPLAY_JSON_RE.test(f)) continue;
      const full = join(dir, f);
      try {
        const st = statSync(full);
        if (!st.isFile()) continue;
      } catch {
        continue;
      }
      const match = extractMatch(full, version, f, reviews);
      if (match) matches.push(match);
    }
  }

  matches.sort((a, b) => {
    const da = a.date || '';
    const db = b.date || '';
    if (da !== db) return da.localeCompare(db);
    return (a.recordId || '').localeCompare(b.recordId || '');
  });

  const agg = aggregate(matches);

  const payload = {
    generatedAt: new Date().toISOString(),
    source: {
      recordsDir: opts.records.replace(/\\/g, '/'),
      versions: opts.versions,
      replayCount: matches.filter(m => !m.error).length,
      parseErrors: matches.filter(m => m.error).length,
    },
    warnings,
    overview: agg.overview,
    modelLeaderboard: agg.modelLeaderboard,
    agentLeaderboard: agg.agentLeaderboard,
    mapStats: agg.mapStats,
    matches: agg.matches,
  };

  mkdirSync(dirname(opts.out), { recursive: true });
  writeFileSync(opts.out, JSON.stringify(payload, null, 2), 'utf8');

  console.log(
    `Wrote ${opts.out} — ${payload.source.replayCount} matches, ${payload.modelLeaderboard.length} models`,
  );
  if (warnings.length) console.warn('Warnings:\n' + warnings.map(w => `  - ${w}`).join('\n'));
  if (payload.source.parseErrors) {
    console.warn(`Parse errors: ${payload.source.parseErrors}`);
    for (const m of matches.filter(x => x.error)) {
      console.warn(`  ${m.fileName}: ${m.error}`);
    }
  }

  // print top 10 models for quick sanity check
  console.log('Top models:');
  for (const row of payload.modelLeaderboard.slice(0, 10)) {
    console.log(
      `  #${row.rank} ${row.model}  ${row.wins}W/${row.games}G  wr=${(row.winRate * 100).toFixed(1)}%  rating=${row.rating.toFixed(3)}  avgRank=${row.avgRank ?? '-'}`,
    );
  }
}

main();
