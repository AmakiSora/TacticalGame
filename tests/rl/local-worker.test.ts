import { describe, expect, it } from 'vitest';
import { handleCommand } from '../../rl/local-worker.js';

interface WorkerState {
  phase: string;
  mapId: string;
  config: {
    mode: string;
    radius: number;
    terrainCells: Array<{ q: number; r: number; terrain: string }>;
    spawnSlots: Array<{ id: string; headquarters: { q: number; r: number }; startingUnits: Array<{ type: string; q: number; r: number }> }>;
    balance: { maxTurns: number; actionsPerTurn: number };
    units: Record<string, unknown>;
  };
  units: Array<{ owner: string }>;
  headquarters: Record<string, { owner: string; q: number; r: number }>;
}

function reset(random?: unknown): WorkerState {
  return handleCommand({ cmd: 'reset', mapId: 'random', random }) as WorkerState;
}

function mapFingerprint(state: WorkerState): string {
  return JSON.stringify(state.config.terrainCells)
    + JSON.stringify(state.config.spawnSlots)
    + JSON.stringify(state.config.units);
}

describe('local engine worker random maps', () => {
  it('creates a playable standard game on a random map', () => {
    const state = reset({ seed: 'worker-a' });
    expect(state.phase).toBe('active');
    expect(state.mapId).toBe('random');
    expect(state.config.mode).toBe('standard');
    expect(state.config.spawnSlots).toHaveLength(2);
    expect(Object.values(state.headquarters)).toHaveLength(2);
    expect(state.units.length).toBeGreaterThan(0);
    for (const slot of state.config.spawnSlots) {
      expect(slot.startingUnits.length).toBeGreaterThan(0);
    }
  });

  it('is deterministic for the same seed and differs across seeds', () => {
    const first = reset({ seed: 'worker-det' });
    const second = reset({ seed: 'worker-det' });
    expect(mapFingerprint(second)).toBe(mapFingerprint(first));

    const other = reset({ seed: 'worker-other' });
    expect(mapFingerprint(other)).not.toBe(mapFingerprint(first));
  });

  it('keeps symmetric maps mirror-invariant', () => {
    const state = reset({ seed: 'worker-mirror', symmetric: true });
    const terrain = new Set(state.config.terrainCells.map(cell => `${cell.q},${cell.r}`));
    for (const cell of state.config.terrainCells) {
      expect(terrain.has(`${-cell.q},${-cell.r}`)).toBe(true);
    }
    const [slotA, slotB] = state.config.spawnSlots;
    expect(slotB.headquarters).toEqual({ q: -slotA.headquarters.q, r: -slotA.headquarters.r });
  });

  it('honors fixed random parameters', () => {
    const state = reset({ seed: 'worker-fixed', maxTurns: 30, actionsPerTurn: 4, radius: 9 });
    expect(state.config.balance.maxTurns).toBe(30);
    expect(state.config.balance.actionsPerTurn).toBe(4);
    expect(state.config.radius).toBe(9);
  });

  it('rejects malformed random options', () => {
    expect(() => reset({ maxTurns: 'many' })).toThrow('maxTurns');
    expect(() => reset('not-an-object')).toThrow();
  });

  it('still supports static maps', () => {
    const state = handleCommand({ cmd: 'reset', mapId: 'default' }) as WorkerState;
    expect(state.mapId).toBe('default');
    expect(state.config.mode).toBe('standard');
    expect(state.config.radius).toBe(8);
  });

  it('honors eventTail: default keeps events, 0 drops them, invalid rejected', () => {
    const withEvents = handleCommand({ cmd: 'reset', mapId: 'default' }) as WorkerState & { events: unknown[] };
    handleCommand({ cmd: 'apply', owner: 'player_a', action: { type: 'end_turn' } });
    const afterTurn = handleCommand({ cmd: 'state' }) as WorkerState & { events: unknown[] };
    expect(afterTurn.events.length).toBeGreaterThan(withEvents.events.length);

    handleCommand({ cmd: 'reset', mapId: 'default', eventTail: 0 });
    const trimmed = handleCommand({ cmd: 'apply', owner: 'player_a', action: { type: 'end_turn' } }) as WorkerState & { events: unknown[] };
    expect(trimmed.events).toEqual([]);
    expect(trimmed.units.length).toBeGreaterThan(0);

    expect(() => handleCommand({ cmd: 'reset', mapId: 'default', eventTail: -1 })).toThrow('eventTail');
    expect(() => handleCommand({ cmd: 'reset', mapId: 'default', eventTail: 'all' })).toThrow('eventTail');
  });
});
