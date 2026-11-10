// tests/algorithms/bastion.test.ts
// 堡垒算法（royale）测试：模式/阶段/席位/淘汰/已提交/行动点守卫，真实引擎整轮
// 循环里所有动作均被接受，以及单次决策耗时上限（< 100ms）。
import { beforeAll, describe, expect, it } from 'vitest';
import { sanitizeGameForResponse } from '../../src/api/auth.js';
import { EventBus } from '../../src/events/bus.js';
import { startGame } from '../../src/engine/engine.js';
import { invalidateGameIndex } from '../../src/engine/gameIndex.js';
import { hexDistance, hexKey, hexNeighbors, hexRange, isValidHex } from '../../src/engine/hex.js';
import {
  queueAttackAction, queueDemolishAction, queueDeployAction,
  queueHealAction, queueMoveAction,
} from '../../src/engine/planning.js';
import { commitAndMaybeResolve } from '../../src/engine/simultaneous.js';
import { addLobbyPlayer, createLobby } from '../../src/state/store.js';
import type { AdjudicationSnapshot, GameState, PendingAction, PlayerId, PlayerRecord } from '../../src/types.js';

const OWNER: PlayerId = 'player_a';
const ENEMY: PlayerId = 'player_b';
const utils = Object.freeze({ hexDistance, hexKey, hexNeighbors, hexRange, isValidHex });

type Action =
  | { type: 'deploy'; payload: { q: number; r: number; unitType: string; fromId: string } }
  | { type: 'move' | 'demolish'; payload: { q: number; r: number; unitId: string } }
  | { type: 'attack'; payload: { q: number; r: number; attackerId: string } }
  | { type: 'heal'; payload: { q: number; r: number; supportId: string } };

type PublicGame = Omit<GameState, 'tokens' | 'hostToken' | 'rngState' | 'idempotency' | 'plan'> & {
  lastEventSeq: number;
  adjudication: AdjudicationSnapshot;
  plan: {
    queues?: PlayerRecord<PendingAction[]>;
    myQueue?: PendingAction[];
    committed: PlayerId[];
  } | null;
};

interface Algorithm {
  name: string;
  decide(game: PublicGame, utilities: typeof utils, context: { owner?: PlayerId }): Promise<Action | null>;
}
let bastion: Algorithm;

beforeAll(async () => {
  const moduleUrl = new URL('../../algorithms/builtin/bastion.mjs', import.meta.url).href;
  const loaded: { default: Algorithm } = await import(moduleUrl);
  bastion = loaded.default;
});

function publicView(game: GameState, owner = OWNER): PublicGame {
  invalidateGameIndex(game);
  const view = sanitizeGameForResponse(game, owner) as PublicGame;
  expect(view).not.toHaveProperty('rngState');
  expect(view).not.toHaveProperty('tokens');
  expect(view).not.toHaveProperty('hostToken');
  return view;
}

async function decide(game: GameState, owner = OWNER): Promise<Action | null> {
  const action = await bastion.decide(publicView(game, owner), utils, Object.freeze({ owner }));
  expect(action === null || (typeof action === 'object' && typeof action.type === 'string')).toBe(true);
  return action;
}

function enqueue(game: GameState, owner: PlayerId, action: Action): PendingAction {
  invalidateGameIndex(game);
  const result = (() => {
    switch (action.type) {
      case 'deploy': {
        const { unitType, fromId, q, r } = action.payload;
        return queueDeployAction(game, owner, unitType, fromId, q, r);
      }
      case 'move': {
        const { unitId, q, r } = action.payload;
        return queueMoveAction(game, owner, unitId, q, r);
      }
      case 'attack': {
        const { attackerId, q, r } = action.payload;
        return queueAttackAction(game, owner, attackerId, q, r);
      }
      case 'heal': {
        const { supportId, q, r } = action.payload;
        return queueHealAction(game, owner, supportId, q, r);
      }
      case 'demolish': {
        const { unitId, q, r } = action.payload;
        return queueDemolishAction(game, owner, unitId, q, r);
      }
      default: throw new Error(`Unexpected action: ${JSON.stringify(action)}`);
    }
  })();
  expect(result, JSON.stringify({ round: game.turn.roundNumber, owner, action })).toMatchObject({ ok: true });
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  if (!result.data) throw new Error('Successful enqueue did not return a pending action');
  return result.data;
}

function newGame(mapId = 'snowflake', playerCount = 2): GameState {
  const game = createLobby('bastion-rules-test', mapId, {
    maxPlayers: playerCount, participate: true, playerName: 'Seat A',
  });
  for (let index = 1; index < playerCount; index++) {
    expect(addLobbyPlayer(game, `Seat ${index + 1}`)).not.toBeNull();
  }
  expect(startGame(game, new EventBus(), () => 0.25)).toMatchObject({ ok: true });
  game.units.forEach((unit, index) => { unit.id = `unit-${index}`; });
  invalidateGameIndex(game);
  return game;
}

describe('bastion guards', () => {
  it('returns null outside royale mode', async () => {
    const game = newGame();
    game.config = structuredClone(game.config);
    game.config.mode = 'simultaneous';
    invalidateGameIndex(game);
    expect(await decide(game)).toBeNull();
  });

  it('returns null when the game is not active', async () => {
    const game = newGame();
    game.phase = 'game_over';
    expect(await decide(game)).toBeNull();
  });

  it('returns null without an explicit owner', async () => {
    const game = newGame();
    expect(await bastion.decide(publicView(game), utils, Object.freeze({}))).toBeNull();
  });

  it('returns null when this seat is eliminated', async () => {
    const game = newGame();
    game.players[OWNER] = { ...game.players[OWNER]!, status: 'eliminated' };
    invalidateGameIndex(game);
    expect(await decide(game)).toBeNull();
  });

  it('returns null when the plan is already committed', async () => {
    const game = newGame();
    game.plan = { queues: {}, committed: [OWNER] };
    expect(await decide(game)).toBeNull();
  });

  it('returns null once the action-point budget is exhausted', async () => {
    const game = newGame();
    const perTurn = game.config.balance.actionsPerTurn;
    game.plan = { queues: { [OWNER]: new Array(perTurn).fill({ id: 'x', type: 'wait' }) }, committed: [] };
    expect(await decide(game)).toBeNull();
  });

  it('reads the own queue from myQueue when queues[owner] is absent', async () => {
    const game = newGame();
    const perTurn = game.config.balance.actionsPerTurn;
    const full = new Array(perTurn).fill({ id: 'x', type: 'wait' });
    const view = { ...publicView(game), plan: { queues: {}, committed: [], myQueue: full } };
    expect(await bastion.decide(view as PublicGame, utils, Object.freeze({ owner: OWNER }))).toBeNull();
  });

  it('reads the own queue from queues[owner] when myQueue is absent', async () => {
    const game = newGame();
    const perTurn = game.config.balance.actionsPerTurn;
    const full = new Array(perTurn).fill({ id: 'x', type: 'wait' });
    const view = { ...publicView(game), plan: { queues: { [OWNER]: full }, committed: [] } };
    expect(await bastion.decide(view as PublicGame, utils, Object.freeze({ owner: OWNER }))).toBeNull();
  });
});

describe('bastion legality in the real engine', () => {
  it('plays full rounds on snowflake with every action accepted', async () => {
    const game = newGame('snowflake');
    let guard = 0;
    while (game.phase === 'active' && guard++ < 8) {
      for (const seat of game.turn.turnOrder) {
        if (game.phase !== 'active') break;
        if (game.players[seat]?.status !== 'active') continue;
        if ((game.plan?.committed ?? []).includes(seat)) continue;
        const rejected = new Set<string>();
        let rejections = 0;
        let count = 0;
        while (count < 100 && rejections < 20) {
          const action = await decide(game, seat);
          if (!action) break;
          const key = JSON.stringify({ type: action.type, payload: action.payload ?? {} });
          if (rejected.has(key)) { rejections++; continue; }
          enqueue(game, seat, action);
          count++;
        }
        commitAndMaybeResolve(game, new EventBus(), seat);
      }
    }
    expect(guard).toBeGreaterThan(1);
  });

  it('plays full rounds on narrow-road with every action accepted', async () => {
    const game = newGame('narrow-road');
    let guard = 0;
    while (game.phase === 'active' && guard++ < 8) {
      for (const seat of game.turn.turnOrder) {
        if (game.phase !== 'active') break;
        if (game.players[seat]?.status !== 'active') continue;
        if ((game.plan?.committed ?? []).includes(seat)) continue;
        let count = 0;
        while (count < 100) {
          const action = await decide(game, seat);
          if (!action) break;
          enqueue(game, seat, action);
          count++;
        }
        commitAndMaybeResolve(game, new EventBus(), seat);
      }
    }
    expect(guard).toBeGreaterThan(1);
  });
});

describe('bastion decision time', () => {
  it('keeps every single decision well under 100ms', async () => {
    const game = newGame('snowflake');
    let max = 0;
    for (let step = 0; step < 8; step++) {
      const action = await decide(game);
      if (!action) break;
      const start = performance.now();
      bastion.decide(publicView(game), utils, Object.freeze({ owner: OWNER }));
      max = Math.max(max, performance.now() - start);
      enqueue(game, OWNER, action);
    }
    expect(max).toBeLessThan(100);
  });
});



