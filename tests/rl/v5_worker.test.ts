import { describe, expect, it } from 'vitest';
import { handleCommand } from '../../rl/v5/engine-worker.js';

describe('v5 isolated engine', () => {
  it('enumerates legal payloads and keeps the parent snapshot immutable', async () => {
    const state = await handleCommand({ cmd: 'reset', mapId: 'default', combatSeed: 19 }) as any;
    const legal = await handleCommand({ cmd: 'legal', state }) as any[];
    expect(legal.length).toBeGreaterThan(1);
    const simulated = await handleCommand({ cmd: 'simulate', state, action: legal[0], seed: 77 }) as any;
    expect(simulated.turn.roundNumber).toBeGreaterThanOrEqual(1);
    expect(state.turn.roundNumber).toBe(1);
    expect(state.rngState).toBeUndefined();
  });
});
