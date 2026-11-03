const SEATS = ['player_a', 'player_b', 'player_c'];
const RATING_SCALE = 400 / Math.LN10;

function permutations(values) {
  if (values.length <= 1) return [values.slice()];
  const result = [];
  for (let i = 0; i < values.length; i++) {
    const rest = values.slice(0, i).concat(values.slice(i + 1));
    for (const tail of permutations(rest)) result.push([values[i], ...tail]);
  }
  return result;
}

function plOrders(game, indexOf) {
  if (!Array.isArray(game?.rankGroups) || game.rankGroups.length < 2) return [];
  const seen = new Set();
  let orders = [[]];
  for (const group of game.rankGroups) {
    if (!Array.isArray(group) || group.length === 0) return [];
    const indices = [];
    for (const id of group) {
      const index = indexOf.get(id);
      if (index == null || seen.has(index)) return [];
      seen.add(index);
      indices.push(index);
    }
    const groupOrders = permutations(indices);
    orders = orders.flatMap(prefix => groupOrders.map(suffix => [...prefix, ...suffix]));
  }
  return orders;
}

function logSumExp(values) {
  let max = -Infinity;
  for (const value of values) if (value > max) max = value;
  if (!Number.isFinite(max)) return max;
  let sum = 0;
  for (const value of values) sum += Math.exp(value - max);
  return max + Math.log(sum);
}

function dot(a, b) {
  let value = 0;
  for (let i = 0; i < a.length; i++) value += a[i] * b[i];
  return value;
}

function center(values) {
  if (values.length === 0) return values;
  let mean = 0;
  for (const value of values) mean += value;
  mean /= values.length;
  for (let i = 0; i < values.length; i++) values[i] -= mean;
  return values;
}

function plEvaluation(beta, observations, prior) {
  const gradient = new Float64Array(beta.length);
  let loss = 0;
  for (const value of beta) loss += 0.5 * prior * value * value;
  for (let i = 0; i < beta.length; i++) gradient[i] = prior * beta[i];

  for (const orders of observations) {
    const logProbabilities = [];
    for (const order of orders) {
      let logProbability = 0;
      for (let position = 0; position < order.length; position++) {
        const remaining = order.slice(position);
        const terms = remaining.map(index => beta[index]);
        logProbability += beta[order[position]] - logSumExp(terms);
      }
      logProbabilities.push(logProbability);
    }
    const logZ = logSumExp(logProbabilities);
    loss -= logZ;
    for (let o = 0; o < orders.length; o++) {
      const order = orders[o];
      const weight = Math.exp(logProbabilities[o] - logZ);
      for (let position = 0; position < order.length; position++) {
        gradient[order[position]] -= weight;
        const remaining = order.slice(position);
        const normalizer = logSumExp(remaining.map(index => beta[index]));
        for (const index of remaining) {
          gradient[index] += weight * Math.exp(beta[index] - normalizer);
        }
      }
    }
  }
  return { loss, gradient };
}

export function solveTieAwarePL(games, ids, options = {}) {
  const n = ids.length;
  if (n === 0) return [];
  const prior = Number.isFinite(options.prior) && options.prior > 0 ? options.prior : 1;
  const maxIter = Number.isInteger(options.maxIter) && options.maxIter >= 0 ? options.maxIter : 200;
  const tol = Number.isFinite(options.tol) && options.tol > 0 ? options.tol : 1e-8;
  const indexOf = new Map(ids.map((id, index) => [id, index]));
  const observations = games.map(game => plOrders(game, indexOf)).filter(orders => orders.length > 0);
  let beta = new Float64Array(n);
  let evaluation = plEvaluation(beta, observations, prior);
  const history = [];

  for (let iter = 0; iter < maxIter; iter++) {
    let maxGradient = 0;
    for (const value of evaluation.gradient) maxGradient = Math.max(maxGradient, Math.abs(value));
    if (maxGradient < tol) break;

    const q = Float64Array.from(evaluation.gradient);
    const alphas = [];
    for (let i = 0; i < history.length; i++) {
      const alpha = history[i].rho * dot(history[i].s, q);
      alphas[i] = alpha;
      for (let j = 0; j < n; j++) q[j] -= alpha * history[i].y[j];
    }
    let scale = 1;
    if (history.length > 0) {
      const latest = history[0];
      scale = dot(latest.s, latest.y) / Math.max(dot(latest.y, latest.y), 1e-30);
    }
    const r = new Float64Array(n);
    for (let i = 0; i < n; i++) r[i] = scale * q[i];
    for (let i = history.length - 1; i >= 0; i--) {
      const correction = history[i].rho * dot(history[i].y, r);
      for (let j = 0; j < n; j++) {
        r[j] += history[i].s[j] * (alphas[i] - correction);
      }
    }
    const direction = new Float64Array(n);
    for (let i = 0; i < n; i++) direction[i] = -r[i];
    center(direction);
    let slope = dot(evaluation.gradient, direction);
    if (!(slope < 0)) {
      for (let i = 0; i < n; i++) direction[i] = -evaluation.gradient[i];
      center(direction);
      slope = dot(evaluation.gradient, direction);
    }
    if (!(slope < 0)) break;

    let step = 1;
    let next = null;
    let nextEvaluation = null;
    for (let attempt = 0; attempt < 40; attempt++) {
      const candidate = new Float64Array(n);
      for (let i = 0; i < n; i++) candidate[i] = beta[i] + step * direction[i];
      center(candidate);
      const candidateEvaluation = plEvaluation(candidate, observations, prior);
      if (Number.isFinite(candidateEvaluation.loss) &&
          candidateEvaluation.loss <= evaluation.loss + 1e-4 * step * slope) {
        next = candidate;
        nextEvaluation = candidateEvaluation;
        break;
      }
      step *= 0.5;
    }
    if (!next) break;

    const s = new Float64Array(n);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      s[i] = next[i] - beta[i];
      y[i] = nextEvaluation.gradient[i] - evaluation.gradient[i];
    }
    const ys = dot(y, s);
    if (ys > 1e-12) {
      history.unshift({ s, y, rho: 1 / ys });
      if (history.length > 8) history.pop();
    }
    beta = next;
    evaluation = nextEvaluation;
  }
  center(beta);
  return Array.from(beta);
}

function superblockKey(game) {
  return `${game.schedule.manifestHash}|${game.schedule.superblockId}`;
}

export function completeSuperblocks(games) {
  const groups = new Map();
  for (const game of games) {
    if (!game?.schedule) continue;
    const key = superblockKey(game);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(game);
  }

  const complete = new Map();
  let quarantined = 0;
  for (const [key, block] of groups) {
    let valid = block.length === 6;
    const first = block[0];
    const lineup = new Set();
    const directions = new Map();
    const seatCounts = new Map();

    for (const game of block) {
      if (game.playerCount !== 3 || game.map !== first.map ||
          game.schedule.lineupId !== first.schedule.lineupId || game.seed !== first.seed) {
        valid = false;
      }
      const schedule = game.schedule;
      const direction = directions.get(schedule.direction) ?? new Set();
      direction.add(schedule.rotation);
      directions.set(schedule.direction, direction);

      const players = SEATS.map(seat => game.players?.[seat]);
      if (players.some(id => typeof id !== 'string' || !id) || new Set(players).size !== 3) {
        valid = false;
        continue;
      }
      const currentLineup = [...players].sort().join('|');
      lineup.add(currentLineup);
      for (let seat = 0; seat < SEATS.length; seat++) {
        const id = players[seat];
        if (!seatCounts.has(id)) seatCounts.set(id, [0, 0, 0]);
        seatCounts.get(id)[seat] += 1;
      }
    }

    if (lineup.size !== 1 || directions.size !== 2) valid = false;
    for (const direction of ['forward', 'reverse']) {
      const rotations = directions.get(direction);
      if (!rotations || rotations.size !== 3 || ![0, 1, 2].every(rotation => rotations.has(rotation))) {
        valid = false;
      }
    }
    if (directions.size === 2 && [...directions.values()].some(rotations => rotations.size !== 3)) valid = false;
    if (seatCounts.size !== 3 || [...seatCounts.values()].some(counts => counts.some(count => count !== 2))) {
      valid = false;
    }
    if (valid) complete.set(key, block);
    else quarantined += 1;
  }
  return { complete, quarantined };
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  const position = (sorted.length - 1) * q;
  const lo = Math.floor(position);
  const hi = Math.ceil(position);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (position - lo);
}

function wilsonLower(successes, trials) {
  if (trials <= 0) return null;
  const z = 1.96;
  const p = successes / trials;
  const z2 = z * z;
  const denominator = 1 + z2 / trials;
  const center = p + z2 / (2 * trials);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * trials)) / trials);
  return (center - margin) / denominator;
}

function newTally() {
  return {
    games: 0,
    uniqueWins: 0,
    topGroupCount: 0,
    rankSum: 0,
    placementSum: 0,
  };
}

function newModelStats() {
  return {
    ...newTally(),
    roundsSum: 0,
    roundsCount: 0,
    decisionSecSum: 0,
    decisionCount: 0,
    superblocks: new Set(),
    gamesByLineup: new Map(),
    perSeat: new Map(SEATS.map(seat => [seat, newTally()])),
    perMap: new Map(),
  };
}

function rankDetails(game) {
  const details = new Map();
  let offset = 0;
  for (const group of game.rankGroups) {
    const rank = offset + (group.length + 1) / 2;
    for (const id of group) {
      details.set(id, { rank, placement: (game.playerCount - rank) / (game.playerCount - 1) });
    }
    offset += group.length;
  }
  return details;
}

function addResult(tally, id, details, uniqueWinner) {
  const result = details.get(id);
  tally.games += 1;
  if (uniqueWinner === id) tally.uniqueWins += 1;
  if (gameTopGroupHas(details, id)) tally.topGroupCount += 1;
  tally.rankSum += result.rank;
  tally.placementSum += result.placement;
}

function gameTopGroupHas(details, id) {
  return details.get(id)?.top === true;
}

function tallyOutput(tally) {
  return {
    games: tally.games,
    uniqueWins: tally.uniqueWins,
    topGroupCount: tally.topGroupCount,
    uniqueWinRate: tally.games > 0 ? round4(tally.uniqueWins / tally.games) : null,
    topGroupRate: tally.games > 0 ? round4(tally.topGroupCount / tally.games) : null,
    averageRank: tally.games > 0 ? round4(tally.rankSum / tally.games) : null,
    placementScore: tally.games > 0 ? round4(tally.placementSum / tally.games) : null,
  };
}

function solveRatings(games, ids, prior, maxIter, tol) {
  const beta = solveTieAwarePL(games, ids, { prior, maxIter, tol });
  return beta.map(value => 1500 + RATING_SCALE * value);
}

export function buildMultiplayerLeague(games, ids, options = {}) {
  const {
    bootstrapN = 0,
    rngFactory,
    prior = 1,
    maxIter = 200,
    tol = 1e-8,
  } = options;
  const blocks = completeSuperblocks(games);
  const indexOf = new Map(ids.map((id, index) => [id, index]));
  const validGames = [...blocks.complete.values()].flat().filter(game =>
    SEATS.every(seat => indexOf.has(game.players[seat])));
  const perModel = new Map(ids.map(id => [id, newModelStats()]));
  const encounterMatrix = new Map(ids.map(id => [id, new Map(ids.map(other => [other, 0]))]));
  const seatPlacement = new Map(SEATS.map(seat => [seat, { games: 0, sum: 0 }]));
  let draws = 0;
  let uniqueWins = 0;
  let roundsSum = 0;
  let roundsCount = 0;

  for (const game of validGames) {
    const details = rankDetails(game);
    for (const group of game.rankGroups) {
      const top = group === game.rankGroups[0];
      for (const id of group) details.get(id).top = top;
    }
    const uniqueWinner = game.rankGroups.length > 1 && game.rankGroups[0].length === 1
      ? game.rankGroups[0][0]
      : null;
    if (game.rankGroups.length === 1 && game.rankGroups[0].length === 3) draws += 1;
    if (uniqueWinner != null) uniqueWins += 1;
    if (Number.isFinite(game.rounds)) {
      roundsSum += game.rounds;
      roundsCount += 1;
    }

    const participants = SEATS.map(seat => game.players[seat]);
    for (let i = 0; i < participants.length; i++) {
      for (let j = i + 1; j < participants.length; j++) {
        encounterMatrix.get(participants[i]).set(participants[j],
          encounterMatrix.get(participants[i]).get(participants[j]) + 1);
        encounterMatrix.get(participants[j]).set(participants[i],
          encounterMatrix.get(participants[j]).get(participants[i]) + 1);
      }
    }

    for (const seat of SEATS) {
      const id = game.players[seat];
      const stats = perModel.get(id);
      addResult(stats, id, details, uniqueWinner);
      addResult(stats.perSeat.get(seat), id, details, uniqueWinner);
      if (!stats.perMap.has(game.map)) stats.perMap.set(game.map, newTally());
      addResult(stats.perMap.get(game.map), id, details, uniqueWinner);
      stats.superblocks.add(superblockKey(game));
      const lineupId = game.schedule.lineupId;
      stats.gamesByLineup.set(lineupId, (stats.gamesByLineup.get(lineupId) ?? 0) + 1);
      if (Number.isFinite(game.rounds)) {
        stats.roundsSum += game.rounds;
        stats.roundsCount += 1;
      }
      const seconds = game.decisionSec?.[seat];
      const count = game.decisionCount?.[seat];
      if (Number.isFinite(seconds) && Number.isFinite(count) && count > 0) {
        stats.decisionSecSum += seconds;
        stats.decisionCount += count;
      }
      const placement = seatPlacement.get(seat);
      placement.games += 1;
      placement.sum += details.get(id).placement;
    }
  }

  const rawRatings = solveRatings(validGames, ids, prior, maxIter, tol);
  const bootstrap = ids.map(() => []);
  if (bootstrapN > 0 && blocks.complete.size > 0) {
    if (typeof rngFactory !== 'function') throw new TypeError('rngFactory is required when bootstrapN > 0');
    const rng = rngFactory();
    const strata = new Map();
    for (const block of blocks.complete.values()) {
      if (!block.every(game => SEATS.every(seat => indexOf.has(game.players[seat])))) continue;
      const first = block[0];
      const key = `${first.map}|${first.schedule.lineupId}`;
      if (!strata.has(key)) strata.set(key, []);
      strata.get(key).push(block);
    }
    const strataList = [...strata.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value);
    for (let b = 0; b < bootstrapN; b++) {
      const sample = [];
      for (const stratum of strataList) {
        for (let i = 0; i < stratum.length; i++) {
          sample.push(...stratum[Math.floor(rng() * stratum.length)]);
        }
      }
      const ratings = solveRatings(sample, ids, prior, maxIter, tol);
      for (let i = 0; i < ids.length; i++) bootstrap[i].push(ratings[i]);
    }
    for (const samples of bootstrap) samples.sort((a, b) => a - b);
  }

  const lineupIds = [...new Set(validGames.map(game => game.schedule.lineupId))].sort();
  const leaveOneLineupOut = Object.fromEntries(ids.map(id => [id, null]));
  const maxShifts = new Float64Array(ids.length);
  const hasShift = ids.map(() => false);
  for (const lineupId of lineupIds) {
    const remaining = validGames.filter(game => game.schedule.lineupId !== lineupId);
    const ratings = solveRatings(remaining, ids, prior, maxIter, tol);
    for (let i = 0; i < ids.length; i++) {
      const stats = perModel.get(ids[i]);
      const remainingGames = stats.games - (stats.gamesByLineup.get(lineupId) ?? 0);
      if (remainingGames <= 0) continue;
      maxShifts[i] = Math.max(maxShifts[i], Math.abs(ratings[i] - rawRatings[i]));
      hasShift[i] = true;
    }
  }
  for (let i = 0; i < ids.length; i++) {
    if (hasShift[i]) leaveOneLineupOut[ids[i]] = Math.round(maxShifts[i]);
  }

  const models = ids.map((id, index) => {
    const stats = perModel.get(id);
    const samples = bootstrap[index];
    const rawRatingLo = stats.games > 0 && samples.length > 0 ? quantile(samples, 0.025) : null;
    const rawRatingHi = stats.games > 0 && samples.length > 0 ? quantile(samples, 0.975) : null;
    const ratingLo = rawRatingLo == null ? null : Math.round(rawRatingLo);
    const ratingHi = rawRatingHi == null ? null : Math.round(rawRatingHi);
    return {
      id,
      rating: stats.games > 0 ? Math.round(rawRatings[index]) : null,
      ratingLo,
      ratingHi,
      ...tallyOutput(stats),
      wilson: stats.games > 0 ? round4(wilsonLower(stats.placementSum, stats.games)) : null,
      avgRounds: stats.roundsCount > 0 ? round2(stats.roundsSum / stats.roundsCount) : null,
      avgDecisionMs: stats.decisionCount > 0 ? round2(stats.decisionSecSum / stats.decisionCount * 1000) : null,
      perSeat: Object.fromEntries(SEATS.map(seat => [seat, tallyOutput(stats.perSeat.get(seat))])),
      perMap: Object.fromEntries([...stats.perMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([map, tally]) => [map, tallyOutput(tally)])),
      provisional: stats.superblocks.size < 20 || (rawRatingLo != null && rawRatingHi - rawRatingLo > 200),
    };
  });

  return {
    overview: {
      games: validGames.length,
      superblockCount: blocks.complete.size,
      quarantinedSuperblocks: blocks.quarantined,
      draws,
      drawRate: validGames.length > 0 ? round4(draws / validGames.length) : null,
      avgRounds: roundsCount > 0 ? round2(roundsSum / roundsCount) : null,
      uniqueWinRate: validGames.length > 0 ? round4(uniqueWins / validGames.length) : null,
    },
    models,
    audit: {
      encounterMatrix: Object.fromEntries(ids.map(id => [id, Object.fromEntries(encounterMatrix.get(id))])),
      seatPlacementScore: Object.fromEntries(SEATS.map(seat => {
        const tally = seatPlacement.get(seat);
        return [seat, tally.games > 0 ? round4(tally.sum / tally.games) : null];
      })),
      leaveOneLineupOut,
    },
  };
}
