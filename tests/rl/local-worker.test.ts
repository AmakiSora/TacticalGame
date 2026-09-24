import { describe, expect, it } from 'vitest';
import { handleCommand } from '../../rl/training/local-worker.js';

interface WorkerState {
  phase: string;
  mapId: string;
  config: {
    mode: string;
    radius: number;
    terrainCells: Array<{ q: number; r: number; terrain: string }>;
    spawnSlots: Array<{ id: string; headquarters: { q: number; r: number }; startingUnits: Array<{ type: string; q: number; r: number }> }>;
    balance: { maxTurns: number | null; actionsPerTurn: number };
    units: Record<string, unknown>;
  };
  units: Array<{ owner: string }>;
  headquarters: Record<string, { owner: string; q: number; r: number }>;
  rngState?: unknown;
}

interface DecideResult {
  action?: { type: string; payload: Record<string, unknown> };
  endTurn?: boolean;
}

async function reset(random?: unknown): Promise<WorkerState> {
  return await handleCommand({ cmd: 'reset', mapId: 'random', random }) as WorkerState;
}

function mapFingerprint(state: WorkerState): string {
  return JSON.stringify(state.config.terrainCells)
    + JSON.stringify(state.config.spawnSlots)
    + JSON.stringify(state.config.units);
}

describe('local engine worker random maps', () => {
  it('creates a playable standard game on a random map', async () => {
    const state = await reset({ seed: 'worker-a' });
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

  it('is deterministic for the same seed and differs across seeds', async () => {
    const first = await reset({ seed: 'worker-det' });
    const second = await reset({ seed: 'worker-det' });
    expect(mapFingerprint(second)).toBe(mapFingerprint(first));

    const other = await reset({ seed: 'worker-other' });
    expect(mapFingerprint(other)).not.toBe(mapFingerprint(first));
  });

  it('keeps symmetric maps mirror-invariant', async () => {
    const state = await reset({ seed: 'worker-mirror', symmetric: true });
    const terrain = new Set(state.config.terrainCells.map(cell => `${cell.q},${cell.r}`));
    for (const cell of state.config.terrainCells) {
      expect(terrain.has(`${-cell.q},${-cell.r}`)).toBe(true);
    }
    const [slotA, slotB] = state.config.spawnSlots;
    expect(slotB.headquarters).toEqual({ q: -slotA.headquarters.q, r: -slotA.headquarters.r });
  });

  it('honors fixed random parameters', async () => {
    const state = await reset({ seed: 'worker-fixed', maxTurns: 30, actionsPerTurn: 4, radius: 9 });
    expect(state.config.balance.maxTurns).toBe(30);
    expect(state.config.balance.actionsPerTurn).toBe(4);
    expect(state.config.radius).toBe(9);
  });

  it('rejects malformed random options', async () => {
    await expect(handleCommand({ cmd: 'reset', mapId: 'random', random: { maxTurns: 'many' } })).rejects.toThrow('maxTurns');
    await expect(handleCommand({ cmd: 'reset', mapId: 'random', random: 'not-an-object' })).rejects.toThrow();
  });

  it('still supports static maps', async () => {
    const state = await handleCommand({ cmd: 'reset', mapId: 'default' }) as WorkerState;
    expect(state.mapId).toBe('default');
    expect(state.config.mode).toBe('standard');
    expect(state.config.radius).toBe(8);
  });

  it('honors eventTail: default keeps events, 0 drops them, invalid rejected', async () => {
    const withEvents = await handleCommand({ cmd: 'reset', mapId: 'default' }) as WorkerState & { events: unknown[] };
    await handleCommand({ cmd: 'apply', owner: 'player_a', action: { type: 'end_turn' } });
    const afterTurn = await handleCommand({ cmd: 'state' }) as WorkerState & { events: unknown[] };
    expect(afterTurn.events.length).toBeGreaterThan(withEvents.events.length);

    await handleCommand({ cmd: 'reset', mapId: 'default', eventTail: 0 });
    const trimmed = await handleCommand({ cmd: 'apply', owner: 'player_a', action: { type: 'end_turn' } }) as WorkerState & { events: unknown[] };
    expect(trimmed.events).toEqual([]);
    expect(trimmed.units.length).toBeGreaterThan(0);

    await expect(handleCommand({ cmd: 'reset', mapId: 'default', eventTail: -1 })).rejects.toThrow('eventTail');
    await expect(handleCommand({ cmd: 'reset', mapId: 'default', eventTail: 'all' })).rejects.toThrow('eventTail');
  });

  it('strips rngState from snapshots to match the REST view', async () => {
    const state = await handleCommand({ cmd: 'reset', mapId: 'default' }) as WorkerState;
    expect(state.rngState).toBeUndefined();
  });
});

describe('local engine worker algorithm decide channel', () => {
  // 与线上 REST 适配器语义一致：decide 返回动作或 null（=结束回合）；
  // 动作合法性由 apply 把关——apply 对非法动作抛错，因此"整回合 decide 循环
  // 全部被接受"就是合法性回归。
  async function playTurnWithAlgorithm(algorithm: string, seat: string, cap = 100): Promise<number> {
    let acted = 0;
    for (let step = 0; step < cap; step++) {
      const result = await handleCommand({ cmd: 'decide', owner: seat, algorithm }) as DecideResult;
      if (result.endTurn) return acted;
      if (!result.action) throw new Error(`decide returned neither action nor endTurn: ${JSON.stringify(result)}`);
      // apply 非法动作会抛错，让用例失败。
      await handleCommand({ cmd: 'apply', owner: seat, action: { type: result.action.type, ...result.action.payload } });
      acted += 1;
    }
    throw new Error(`${algorithm} did not end its turn within ${cap} actions`);
  }

  for (const algorithm of ['threat', 'greedy', 'random', 'field', 'mcts']) {
    it(`${algorithm} plays a legal opening turn on a static map`, async () => {
      await handleCommand({ cmd: 'reset', mapId: 'default' });
      const acted = await playTurnWithAlgorithm(algorithm, 'player_a');
      expect(acted).toBeGreaterThanOrEqual(0);
      // 回合结束由调用方驱动 end_turn；这里补一手，验证座位状态机未被破坏。
      await handleCommand({ cmd: 'apply', owner: 'player_a', action: { type: 'end_turn' } });
      const state = await handleCommand({ cmd: 'state' }) as { turn?: { currentPlayerId?: string } };
      expect(state.turn?.currentPlayerId).toBe('player_b');
    });
  }

  it('ends the turn (null decide) when it is not the algorithm-side actor anymore', async () => {
    await handleCommand({ cmd: 'reset', mapId: 'default' });
    await playTurnWithAlgorithm('greedy', 'player_a');
    await handleCommand({ cmd: 'apply', owner: 'player_a', action: { type: 'end_turn' } });
    // player_b 开局无行动机会限制：decide 应仍能给出动作或主动结束。
    const result = await handleCommand({ cmd: 'decide', owner: 'player_b', algorithm: 'greedy' }) as DecideResult;
    expect(result.endTurn === true || typeof result.action?.type === 'string').toBe(true);
  });

  it('rejects unknown algorithms and missing arguments', async () => {
    await handleCommand({ cmd: 'reset', mapId: 'default' });
    await expect(handleCommand({ cmd: 'decide', owner: 'player_a', algorithm: 'nope' })).rejects.toThrow('Unknown algorithm');
    await expect(handleCommand({ cmd: 'decide', owner: 'player_a' })).rejects.toThrow('algorithm');
    await expect(handleCommand({ cmd: 'decide', owner: 'player_c', algorithm: 'greedy' })).rejects.toThrow('owner');
  });
});
