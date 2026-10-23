import { beforeAll, describe, expect, it } from 'vitest';
import { loadMaps } from '../../src/config/loader.js';
import { addLobbyPlayer, createLobby } from '../../src/state/store.js';
import { startGame } from '../../src/engine/engine.js';
import { globalEventBus } from '../../src/events/bus.js';
import {
  queueAttackAction, queueDemolishAction, queueDeployAction, queueHealAction, queueMoveAction,
  queueWaitAction,
} from '../../src/engine/planning.js';
// @ts-expect-error 算法模块为 ESM .mjs，无类型声明
import prism from '../../algorithms/builtin/prism.mjs';
// @ts-expect-error 工具库为 ESM .mjs，无类型声明
import * as utils from '../../algorithms/lib/game-utils.mjs';

function makeGame(id: string) {
  const game = createLobby(id, 'standoff', { maxPlayers: 2, participate: true, playerName: 'A' });
  addLobbyPlayer(game, 'B');
  const started = startGame(game, globalEventBus, () => 0.5);
  if (!started.ok) throw new Error(started.message);
  return game;
}

function view(game: any, owner: string) {
  return {
    ...game,
    players: Object.fromEntries(Object.entries(game.players).map(([id, player]: [string, any]) => [id, {
      status: player.status,
      stats: player.stats,
    }])),
    plan: {
      queues: {},
      committed: [...(game.plan?.committed ?? [])],
      myQueue: [...(game.plan?.queues?.[owner] ?? [])],
    },
  };
}

function enqueue(game: any, owner: string, action: any) {
  const p = action.payload || {};
  switch (action.type) {
    case 'attack': return queueAttackAction(game, owner as never, p.attackerId, p.q, p.r);
    case 'heal': return queueHealAction(game, owner as never, p.supportId, p.q, p.r);
    case 'move': return queueMoveAction(game, owner as never, p.unitId, p.q, p.r);
    case 'deploy': return queueDeployAction(game, owner as never, p.unitType, p.fromId, p.q, p.r);
    case 'demolish': return queueDemolishAction(game, owner as never, p.unitId, p.q, p.r);
    case 'wait': return queueWaitAction(game, owner as never);
    default: throw new Error(action.type);
  }
}

describe('prism 决策接口', () => {
  beforeAll(() => loadMaps());

  it('缺少座位、已提交或行动点已满时不决策', async () => {
    const game = makeGame('prism-guards');
    expect(await prism.decide(view(game, 'player_a'), utils)).toBeNull();
    expect(await prism.decide({
      ...view(game, 'player_a'),
      plan: { queues: {}, committed: ['player_a'], myQueue: [] },
    }, utils, { owner: 'player_a' })).toBeNull();
    for (let index = 0; index < game.config.balance.actionsPerTurn; index++) {
      expect(queueWaitAction(game, 'player_a').ok).toBe(true);
    }
    expect(await prism.decide(view(game, 'player_a'), utils, { owner: 'player_a' })).toBeNull();
  });

  it('同一队列复用计划，动作入队后按计划索引继续', async () => {
    const game = makeGame('prism-cache');
    const first = await prism.decide(view(game, 'player_a'), utils, { owner: 'player_a' });
    expect(first).not.toBeNull();
    expect(await prism.decide(view(game, 'player_a'), utils, { owner: 'player_a' })).toEqual(first);
    expect(enqueue(game, 'player_a', first).ok).toBe(true);

    const second = await prism.decide(view(game, 'player_a'), utils, { owner: 'player_a' });
    expect(second).not.toBeNull();
    expect(enqueue(game, 'player_a', second).ok).toBe(true);
    expect(game.plan?.queues.player_a).toHaveLength(2);
  }, 30000);
});
