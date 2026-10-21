import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EventBus } from '../../src/events/bus.js';
import { startGame } from '../../src/engine/engine.js';
import { appendEvent } from '../../src/engine/events.js';
import { commitAndMaybeResolve } from '../../src/engine/simultaneous.js';
import { addLobbyPlayer, createLobby, GameStore } from '../../src/state/store.js';

let tempDir: string | null = null;

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe('simultaneous stats recovery', () => {
  it('keeps the final-round control hold after a turn-limit snapshot reload', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'tg-hold-'));
    const file = join(tempDir, 'games.json');
    const bus = new EventBus();
    const game = createLobby('control-hold-recovery', 'standoff', {
      maxPlayers: 2, participate: true, playerName: 'A',
    });
    expect(addLobbyPlayer(game, 'B')).not.toBeNull();
    // 地图配置在进程内共享，测试内改 maxTurns 必须克隆。
    game.config = structuredClone(game.config);
    game.config.balance.maxTurns = 1;
    expect(startGame(game, bus, () => 0).ok).toBe(true);
    const [holder, other] = game.turn.turnOrder;
    game.controlPoints[0]!.owner = holder!;
    // 让重建逻辑能从事件里知道这个据点的归属；正常对局由 capture 事件完成。
    appendEvent(game, bus, 'control_point_captured', {
      pointId: game.controlPoints[0]!.id, owner: holder,
    });

    expect(commitAndMaybeResolve(game, bus, holder!).ok).toBe(true);
    expect(commitAndMaybeResolve(game, bus, other!).ok).toBe(true);
    expect(game.phase).toBe('game_over');
    expect(['turn_limit_score', 'turn_limit_draw']).toContain(game.result!.reason);
    const before = game.players[holder!]!.stats;
    expect(before.controlHold).toBe(1);
    expect(before.controlHoldRounds).toBe(1);

    const store = new GameStore({ persistenceFile: file });
    store.save(game);
    const restored = new GameStore({ persistenceFile: file });
    restored.loadFromDisk();
    const after = restored.get('control-hold-recovery')!.players[holder!]!.stats;
    expect(after.controlHold).toBe(before.controlHold);
    expect(after.controlHoldRounds).toBe(before.controlHoldRounds);
  });
});
