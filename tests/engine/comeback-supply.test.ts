import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/events/bus.js';
import { endTurn, eliminatePlayer, startGame } from '../../src/engine/engine.js';
import { addLobbyPlayer, createLobby } from '../../src/state/store.js';
import type { GameState, PlayerId } from '../../src/types.js';

function createGame(): { game: GameState; bus: EventBus; order: PlayerId[] } {
  const bus = new EventBus();
  const game = createLobby('comeback-test', 'multiplayer-ring', {
    maxPlayers: 3,
    participate: true,
    playerName: 'A',
  });
  expect(addLobbyPlayer(game, 'B')).not.toBeNull();
  expect(addLobbyPlayer(game, 'C')).not.toBeNull();
  expect(startGame(game, bus, () => 0).ok).toBe(true);

  // 每个测试必须隔离地图配置，避免修改全局加载器缓存中的对象。
  game.config = structuredClone(game.config);
  game.config.balance.baseIncome = 0;
  game.config.balance.adjudicationWeights = {
    enemyHqDamage: 0,
    ownHqHp: 0,
    controlPoint: 0,
    armyValue: 0,
    supplies: 1,
  };
  game.config.balance.comebackSupply = {
    startRound: 3,
    scoreGapPercent: 40,
    amountPerRound: 20,
  };
  game.controlPoints.forEach(point => { point.owner = null; });
  game.events = [];
  return { game, bus, order: [...game.turn.turnOrder] };
}

function setRound(game: GameState, round: number): void {
  game.turn.roundNumber = round;
  game.turn.turnNumber = round;
}

function setSupplies(game: GameState, values: Partial<Record<PlayerId, number>>): void {
  for (const [owner, supplies] of Object.entries(values)) {
    game.resources[owner as PlayerId]!.supplies = supplies!;
  }
}

function finishRound(game: GameState, bus: EventBus): void {
  const turns = game.turn.turnOrder.filter(id => game.players[id]?.status === 'active').length;
  for (let i = 0; i < turns; i++) {
    expect(endTurn(game, bus, game.turn.currentPlayerId!).ok).toBe(true);
  }
}

describe('百分比分差追赶补给', () => {
  it('从配置轮次开始在40%边界发放，并保持事件顺序', () => {
    const { game, bus, order: [leader, weak, peer] } = createGame();
    setSupplies(game, { [leader]: 1000, [weak]: 600, [peer]: 1000 });

    setRound(game, 2);
    finishRound(game, bus);
    expect(game.events.some(event => event.type === 'comeback_supply')).toBe(false);

    finishRound(game, bus);
    const event = game.events.find(item => item.type === 'comeback_supply')!;
    expect(event.payload).toMatchObject({
      owner: weak,
      roundNumber: 3,
      amount: 20,
      leaderScore: 1000,
      playerScore: 600,
      scoreGap: 400,
      scoreGapPercent: 40,
    });
    expect(game.resources[weak]!.supplies).toBe(620);

    const index = game.events.indexOf(event);
    expect(game.events.slice(index - 1, index + 3).map(item => item.type)).toEqual([
      'round_end', 'comeback_supply', 'income', 'turn_end',
    ]);
  });

  it('不在39.9%时发放', () => {
    const { game, bus, order: [leader, weak, peer] } = createGame();
    setRound(game, 3);
    setSupplies(game, { [leader]: 1000, [weak]: 601, [peer]: 1000 });

    finishRound(game, bus);

    expect(game.events.some(event => event.type === 'comeback_supply')).toBe(false);
    expect(game.resources[weak]!.supplies).toBe(601);
  });

  it('使用同一快照向所有达标弱方发放', () => {
    const { game, bus, order: [leader, weakA, weakB] } = createGame();
    setRound(game, 3);
    setSupplies(game, { [leader]: 1000, [weakA]: 600, [weakB]: 500 });

    finishRound(game, bus);

    const events = game.events.filter(event => event.type === 'comeback_supply');
    expect(events.map(event => event.payload.owner)).toEqual([weakA, weakB]);
    expect(events.every(event => event.payload.leaderScore === 1000)).toBe(true);
    expect(game.resources[leader]!.supplies).toBe(1000);
    expect(game.resources[weakA]!.supplies).toBe(620);
    expect(game.resources[weakB]!.supplies).toBe(520);
  });

  it('不向已淘汰玩家发放', () => {
    const { game, bus, order: [leader, weak, eliminated] } = createGame();
    expect(eliminatePlayer(game, bus, eliminated, 'host_eliminated', leader).ok).toBe(true);
    game.events = [];
    setRound(game, 3);
    setSupplies(game, { [leader]: 1000, [weak]: 600, [eliminated]: 0 });

    finishRound(game, bus);

    const events = game.events.filter(event => event.type === 'comeback_supply');
    expect(events.map(event => event.payload.owner)).toEqual([weak]);
    expect(events.some(event => event.payload.owner === eliminated)).toBe(false);
  });

  it('最高分为零时安全跳过', () => {
    const { game, bus } = createGame();
    setRound(game, 3);
    game.config.balance.adjudicationWeights.supplies = 0;

    finishRound(game, bus);

    expect(game.events.some(event => event.type === 'comeback_supply')).toBe(false);
  });

  it('终局轮和未启用地图不发放', () => {
    const finalGame = createGame();
    setRound(finalGame.game, 3);
    finalGame.game.config.balance.maxTurns = 3;
    setSupplies(finalGame.game, {
      [finalGame.order[0]]: 1000,
      [finalGame.order[1]]: 500,
      [finalGame.order[2]]: 1000,
    });
    finishRound(finalGame.game, finalGame.bus);
    expect(finalGame.game.phase).toBe('game_over');
    expect(finalGame.game.events.some(event => event.type === 'comeback_supply')).toBe(false);

    const disabled = createGame();
    delete disabled.game.config.balance.comebackSupply;
    setRound(disabled.game, 3);
    setSupplies(disabled.game, {
      [disabled.order[0]]: 1000,
      [disabled.order[1]]: 500,
      [disabled.order[2]]: 1000,
    });
    finishRound(disabled.game, disabled.bus);
    expect(disabled.game.events.some(event => event.type === 'comeback_supply')).toBe(false);
  });
});
