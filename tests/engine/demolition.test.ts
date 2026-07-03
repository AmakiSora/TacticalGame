import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/events/bus.js';
import { demolishTerrain } from '../../src/engine/demolition.js';
import { joinGame } from '../../src/engine/engine.js';
import { getTerrain } from '../../src/engine/validation.js';
import { createInitialGame } from '../../src/state/store.js';

function setup() {
  const game = createInitialGame('g1');
  const bus = new EventBus();
  joinGame(game, bus, 'B');
  game.units = game.units.filter(u => u.owner !== 'player_a');
  const heavy = {
    id: 'heavy-1',
    owner: 'player_a' as const,
    type: 'heavy' as const,
    q: -2,
    r: 0,
    hp: 150,
    maxHp: 150,
    attack: 38,
    defense: 13,
    moveRange: 2,
    attackRange: 1,
    cost: 92,
    alive: true,
    hasMoved: false,
    hasActed: false,
    actionSpent: false,
    canCapture: false,
  };
  game.units.push(heavy);
  game.map.terrainCells.push({ q: -1, r: 0, terrain: 'blocker' });
  const cell = game.cells.find(c => c.q === -1 && c.r === 0);
  if (cell) cell.terrain = 'blocker';
  return { game, bus, heavy };
}

describe('demolishable terrain', () => {
  it('lets a heavy turn an adjacent blocker into plain terrain', () => {
    const { game, bus, heavy } = setup();

    const result = demolishTerrain(game, bus, 'player_a', heavy.id, -1, 0);

    expect(result.ok).toBe(true);
    expect(getTerrain(game, -1, 0)).toBe('plain');
    expect(heavy.hasActed).toBe(true);
    expect(heavy.actionSpent).toBe(true);
    expect(game.turn.actionsUsed).toBe(1);
    expect(game.events.at(-1)).toMatchObject({
      type: 'demolish',
      payload: expect.objectContaining({
        unitId: heavy.id,
        owner: 'player_a',
        q: -1,
        r: 0,
        fromTerrain: 'blocker',
        toTerrain: 'plain',
        actionsUsed: 1,
        actionsRemaining: 4,
      }),
    });
  });

  it('rejects non-heavy units, non-adjacent targets and non-blocker terrain', () => {
    const { game, bus, heavy } = setup();
    heavy.type = 'infantry';
    expect(demolishTerrain(game, bus, 'player_a', heavy.id, -1, 0)).toMatchObject({
      ok: false,
      code: 'invalid_demolish',
    });

    heavy.type = 'heavy';
    expect(demolishTerrain(game, bus, 'player_a', heavy.id, 1, 0)).toMatchObject({
      ok: false,
      code: 'invalid_demolish',
    });

    expect(demolishTerrain(game, bus, 'player_a', heavy.id, -2, 1)).toMatchObject({
      ok: false,
      code: 'invalid_demolish',
    });
  });

  it('uses the action limit for a fresh heavy and allows an already activated heavy to demolish', () => {
    const { game, bus, heavy } = setup();
    const limit = game.config.balance.actionsPerTurn;
    game.turn.actionsUsed = limit;

    const blocked = demolishTerrain(game, bus, 'player_a', heavy.id, -1, 0);
    expect(blocked).toMatchObject({ ok: false, code: 'action_limit_reached' });
    expect(getTerrain(game, -1, 0)).toBe('blocker');

    heavy.actionSpent = true;
    const allowed = demolishTerrain(game, bus, 'player_a', heavy.id, -1, 0);
    expect(allowed.ok).toBe(true);
    expect(game.turn.actionsUsed).toBe(limit);
    expect(getTerrain(game, -1, 0)).toBe('plain');
  });
});
