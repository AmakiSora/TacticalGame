// src/engine/engine.ts
import type {
  AdjudicationScore, EliminationReason, GameOverReason, GameRanking,
  GameState, PlayerId, PlayerRecord,
} from '../types.js';
import { PLAYER_IDS } from '../types.js';
import type { EventBus } from '../events/bus.js';
import type { Result } from './result.js';
import { appendEvent } from './events.js';
import { hexDistance } from './hex.js';
import { controlPointIncome, controlPointTypeSpec } from './controlPoints.js';
import { addLobbyPlayer, initializeLobbyGame } from '../state/store.js';

export function joinedPlayerIds(game: GameState): PlayerId[] {
  return PLAYER_IDS.filter(id => game.players[id]);
}

export function activePlayerIds(game: GameState): PlayerId[] {
  return game.turn.turnOrder.filter(id => game.players[id]?.status === 'active');
}

function syncLegacyTurnAliases(game: GameState): void {
  // 旧测试和旧回放工具可能直接写 turnNumber/currentOwner；引擎入口统一折回新字段。
  if (game.turn.currentOwner && game.turn.currentOwner !== game.turn.currentPlayerId) {
    game.turn.currentPlayerId = game.turn.currentOwner;
  }
  if (game.turn.turnNumber !== game.turn.roundNumber) {
    game.turn.roundNumber = game.turn.turnNumber;
  }
}

function mapPayload(game: GameState) {
  return {
    id: game.mapId, name: game.config.name, description: game.config.description,
    grid: game.map.grid, orientation: game.map.orientation, radius: game.map.radius,
    terrainCells: game.map.terrainCells.map(c => ({ ...c })),
    cells: game.cells.map(c => ({ ...c })),
  };
}

function fullReplayPayload(game: GameState) {
  return {
    mapId: game.mapId,
    map: mapPayload(game),
    players: structuredClone(game.players),
    turnOrder: [...game.turn.turnOrder],
    controlPoints: game.controlPoints.map(p => ({ ...p })),
    headquarters: structuredClone(game.headquarters),
    units: game.units.map(u => ({ ...u })),
    resources: structuredClone(game.resources),
    firstPlayer: game.turn.currentPlayerId,
    playerNames: { ...game.playerNames },
    config: {
      units: structuredClone(game.config.units),
      headquartersSpec: { ...game.config.headquartersSpec },
      balance: structuredClone(game.config.balance),
    },
  };
}

export function startGame(game: GameState, bus: EventBus, random: () => number = Math.random): Result {
  if (game.phase !== 'lobby') return { ok: false, code: 'game_already_started', message: 'game already started' };
  const count = joinedPlayerIds(game).length;
  if (count < 2) return { ok: false, code: 'lobby_not_ready', message: 'at least 2 players required' };
  if (!game.config.supportedPlayerCounts.includes(count)) {
    return { ok: false, code: 'unsupported_player_count', message: `map does not support ${count} players` };
  }
  initializeLobbyGame(game, random);
  appendEvent(game, bus, 'game_start', fullReplayPayload(game));
  return { ok: true };
}

// 保留旧双人测试和旧内部调用所需的加入即开局行为。
export function joinGame(game: GameState, bus: EventBus, playerName?: string): Result {
  if (game.players.player_b) return { ok: false, code: 'game_already_full', message: 'game already has 2 players' };
  const joined = addLobbyPlayer(game, playerName);
  if (!joined) return { ok: false, code: 'game_already_full', message: 'game already full' };
  for (const id of ['player_a', 'player_b'] as PlayerId[]) {
    const player = game.players[id]!;
    player.status = 'active';
    player.spawnSlotId = game.config.layouts['2'][id === 'player_a' ? 0 : 1];
    player.turnOrder = id === 'player_a' ? 0 : 1;
  }
  game.phase = 'active';
  game.turn.phase = 'active';
  game.turn.turnOrder = ['player_a', 'player_b'];
  game.turn.currentPlayerId = 'player_a';
  game.turn.currentOwner = 'player_a';
  appendEvent(game, bus, 'game_start', fullReplayPayload(game));
  return { ok: true };
}

function captureControlPoints(game: GameState, bus: EventBus, owner: PlayerId): void {
  for (const point of game.controlPoints) {
    const capturer = game.units.find(unit =>
      unit.owner === owner && unit.alive && unit.canCapture && unit.q === point.q && unit.r === point.r);
    if (!capturer || point.owner === owner) continue;
    const previousOwner = point.owner;
    point.owner = owner;
    appendEvent(game, bus, 'control_point_captured', {
      pointId: point.id, name: point.name, owner, previousOwner,
      unitId: capturer.id, q: point.q, r: point.r,
    });
  }
}

function resetActions(game: GameState, owner: PlayerId): void {
  for (const unit of game.units) {
    if (unit.owner === owner && unit.alive) {
      unit.hasMoved = false;
      unit.hasActed = false;
      unit.actionSpent = false;
    }
  }
}

function collectIncome(game: GameState, bus: EventBus, owner: PlayerId): void {
  const resources = game.resources[owner];
  if (!resources || game.players[owner]?.status !== 'active') return;
  const base = game.config.balance.baseIncome;
  const ownedPoints = game.controlPoints.filter(point => point.owner === owner);
  const breakdown = ownedPoints.map(point => ({
    pointId: point.id, name: point.name, kind: point.kind,
    amount: controlPointIncome(game, point),
  }));
  const control = breakdown.reduce((sum, item) => sum + item.amount, 0);
  const amount = base + control;
  resources.supplies += amount;
  appendEvent(game, bus, 'income', {
    owner, base, control, controlPoints: ownedPoints.length, amount, breakdown,
  });
}

function repairFromControlPoints(game: GameState, bus: EventBus, owner: PlayerId): void {
  const repaired = new Set<string>();
  for (const point of game.controlPoints) {
    if (point.owner !== owner) continue;
    const repairAmount = controlPointTypeSpec(game, point)?.repairAmount ?? 0;
    if (repairAmount <= 0) continue;
    for (const unit of game.units) {
      if (unit.owner !== owner || !unit.alive || unit.hp >= unit.maxHp || repaired.has(unit.id)) continue;
      if (hexDistance(point, unit) > 1) continue;
      const amount = Math.min(repairAmount, unit.maxHp - unit.hp);
      if (amount <= 0) continue;
      unit.hp += amount;
      repaired.add(unit.id);
      appendEvent(game, bus, 'control_point_repair', {
        owner, pointId: point.id, pointName: point.name,
        unitId: unit.id, amount, unitHp: unit.hp,
      });
    }
  }
}

function armyValue(game: GameState, owner: PlayerId): number {
  return game.units
    .filter(unit => unit.owner === owner && unit.alive)
    .reduce((sum, unit) => sum + Math.round(unit.cost * (unit.hp / unit.maxHp)), 0);
}

function scorePlayer(game: GameState, owner: PlayerId): AdjudicationScore {
  const weights = game.config.balance.adjudicationWeights;
  const headquartersDamage = game.players[owner]?.stats.headquartersDamage ?? 0;
  const ownHqHp = game.headquarters[owner]?.hp ?? 0;
  const controlPoints = game.controlPoints.filter(point => point.owner === owner).length;
  const army = armyValue(game, owner);
  const supplies = game.resources[owner]?.supplies ?? 0;
  return {
    headquartersDamage, ownHqHp, controlPoints, armyValue: army, supplies,
    total:
      headquartersDamage * weights.enemyHqDamage +
      ownHqHp * weights.ownHqHp +
      controlPoints * weights.controlPoint +
      army * weights.armyValue +
      supplies * weights.supplies,
  };
}

export function buildAdjudicationScores(game: GameState): PlayerRecord<AdjudicationScore> {
  const scores: PlayerRecord<AdjudicationScore> = {};
  for (const id of joinedPlayerIds(game)) scores[id] = scorePlayer(game, id);
  return scores;
}

function buildRankings(game: GameState, scores: PlayerRecord<AdjudicationScore>): GameRanking[] {
  const sorted = joinedPlayerIds(game).sort((a, b) => {
    const activeDelta = Number(game.players[b]?.status === 'active') - Number(game.players[a]?.status === 'active');
    if (activeDelta !== 0) return activeDelta;
    return (scores[b]?.total ?? 0) - (scores[a]?.total ?? 0);
  });
  return sorted.map((playerId, index) => ({
    playerId, rank: index + 1, status: game.players[playerId]!.status, score: scores[playerId]!,
  }));
}

export function endGame(game: GameState, bus: EventBus, winner: PlayerId | null, reason: GameOverReason): void {
  const scores = buildAdjudicationScores(game);
  const rankings = buildRankings(game, scores);
  game.phase = 'game_over';
  game.turn.phase = 'game_over';
  game.winner = winner;
  game.result = { winner, reason, scores, rankings };
  appendEvent(game, bus, 'game_over', { winner, reason, scores, rankings });
}

function nextActiveInOrder(game: GameState, owner: PlayerId, allowed?: Set<PlayerId>): PlayerId | null {
  const order = game.turn.turnOrder;
  const currentIndex = Math.max(0, order.indexOf(owner));
  for (let offset = 1; offset <= order.length; offset++) {
    const candidate = order[(currentIndex + offset) % order.length];
    if (game.players[candidate]?.status !== 'active') continue;
    if (allowed && !allowed.has(candidate)) continue;
    return candidate;
  }
  return null;
}

function adjudicateAtTurnLimit(game: GameState, bus: EventBus): boolean {
  if (game.turn.roundNumber < game.config.balance.maxTurns) return false;
  const scores = buildAdjudicationScores(game);
  const active = activePlayerIds(game);
  const top = Math.max(...active.map(id => scores[id]?.total ?? 0));
  const leaders = active.filter(id => (scores[id]?.total ?? 0) === top);
  endGame(game, bus, leaders.length === 1 ? leaders[0] : null, leaders.length === 1 ? 'turn_limit_score' : 'turn_limit_draw');
  return true;
}

function grantComebackSupplies(game: GameState, bus: EventBus): void {
  const config = game.config.balance.comebackSupply;
  if (!config || game.turn.roundNumber < config.startRound) return;

  const active = activePlayerIds(game);
  const scores = buildAdjudicationScores(game);
  const leaderScore = Math.max(...active.map(id => scores[id]?.total ?? 0));
  if (leaderScore <= 0) return;

  // 所有玩家必须使用发放前的同一份分数快照判断，避免事件顺序改变资格。
  const recipients = active.map(owner => {
    const playerScore = scores[owner]?.total ?? 0;
    const scoreGap = leaderScore - playerScore;
    return { owner, playerScore, scoreGap };
  }).filter(({ scoreGap }) =>
    scoreGap > 0 && scoreGap * 100 >= leaderScore * config.scoreGapPercent);

  for (const { owner, playerScore, scoreGap } of recipients) {
    const resources = game.resources[owner];
    if (!resources) continue;
    resources.supplies += config.amountPerRound;
    appendEvent(game, bus, 'comeback_supply', {
      owner,
      roundNumber: game.turn.roundNumber,
      amount: config.amountPerRound,
      leaderScore,
      playerScore,
      scoreGap,
      scoreGapPercent: Math.round((scoreGap / leaderScore) * 1000) / 10,
    });
  }
}

function advanceTurn(game: GameState, bus: EventBus, previousOwner: PlayerId): void {
  const active = activePlayerIds(game);
  if (active.length <= 1) {
    endGame(game, bus, active[0] ?? null, 'last_player_standing');
    return;
  }

  const acted = new Set(game.turn.actedThisRound.filter(id => game.players[id]?.status === 'active'));
  const remaining = new Set(active.filter(id => !acted.has(id)));
  let next: PlayerId | null;
  if (remaining.size > 0) {
    next = nextActiveInOrder(game, previousOwner, remaining);
  } else {
    appendEvent(game, bus, 'round_end', { roundNumber: game.turn.roundNumber });
    if (adjudicateAtTurnLimit(game, bus)) return;
    grantComebackSupplies(game, bus);
    game.turn.roundNumber += 1;
    game.turn.turnNumber = game.turn.roundNumber;
    game.turn.actedThisRound = [];
    next = nextActiveInOrder(game, previousOwner);
  }
  if (!next) return;
  game.turn.currentPlayerId = next;
  game.turn.currentOwner = next;
  game.turn.actionsUsed = 0;
  collectIncome(game, bus, next);
  repairFromControlPoints(game, bus, next);
  appendEvent(game, bus, 'turn_end', {
    previousOwner, nextOwner: next, previousPlayerId: previousOwner,
    nextPlayerId: next, roundNumber: game.turn.roundNumber,
    turnNumber: game.turn.roundNumber,
  });
}

export function eliminatePlayer(
  game: GameState,
  bus: EventBus,
  playerId: PlayerId,
  reason: EliminationReason,
  eliminatedBy: PlayerId | null,
): Result {
  const player = game.players[playerId];
  if (!player || player.status !== 'active') {
    return { ok: false, code: 'player_eliminated', message: 'player is not active' };
  }
  if (activePlayerIds(game).length <= 1) {
    return { ok: false, code: 'invalid_move', message: 'cannot eliminate the last active player' };
  }
  player.status = 'eliminated';
  player.eliminatedAt = Date.now();
  player.eliminatedBy = eliminatedBy;
  if (eliminatedBy && game.players[eliminatedBy]) game.players[eliminatedBy]!.stats.playersEliminated += 1;

  const removedUnitIds = game.units.filter(unit => unit.owner === playerId).map(unit => unit.id);
  game.units = game.units.filter(unit => unit.owner !== playerId);
  const neutralizedPointIds: string[] = [];
  for (const point of game.controlPoints) {
    if (point.owner !== playerId) continue;
    point.owner = null;
    neutralizedPointIds.push(point.id);
    appendEvent(game, bus, 'control_point_neutralized', { pointId: point.id, previousOwner: playerId });
  }
  const hq = game.headquarters[playerId];
  if (hq) { hq.alive = false; hq.hp = 0; }
  appendEvent(game, bus, 'player_eliminated', {
    playerId, reason, eliminatedBy, removedUnitIds, neutralizedPointIds,
  });

  const active = activePlayerIds(game);
  if (active.length === 1) {
    endGame(game, bus, active[0], 'last_player_standing');
  } else if (game.turn.currentPlayerId === playerId) {
    if (!game.turn.actedThisRound.includes(playerId)) game.turn.actedThisRound.push(playerId);
    advanceTurn(game, bus, playerId);
  }
  return { ok: true };
}

export function endTurn(game: GameState, bus: EventBus, owner: PlayerId): Result {
  syncLegacyTurnAliases(game);
  if (game.phase === 'game_over') return { ok: false, code: 'game_over', message: 'game has ended' };
  if (game.phase !== 'active') return { ok: false, code: 'game_not_started', message: 'game not in play' };
  if (game.players[owner]?.status !== 'active') return { ok: false, code: 'player_eliminated', message: 'player eliminated' };
  if (game.turn.currentPlayerId !== owner) return { ok: false, code: 'not_your_turn', message: 'not your turn' };

  captureControlPoints(game, bus, owner);
  resetActions(game, owner);
  appendEvent(game, bus, 'reset_actions', { owner, actionsUsed: 0 });
  if (!game.turn.actedThisRound.includes(owner)) game.turn.actedThisRound.push(owner);
  advanceTurn(game, bus, owner);
  return { ok: true };
}

export function skipTurn(game: GameState, bus: EventBus): Result {
  syncLegacyTurnAliases(game);
  const owner = game.turn.currentPlayerId;
  if (!owner) return { ok: false, code: 'game_not_started', message: 'game not in play' };
  appendEvent(game, bus, 'turn_skipped', { playerId: owner, roundNumber: game.turn.roundNumber });
  return endTurn(game, bus, owner);
}
