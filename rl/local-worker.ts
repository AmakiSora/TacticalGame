import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { globalEventBus } from '../src/events/bus.js';
import { attackTarget, healTarget } from '../src/engine/combat.js';
import { demolishTerrain } from '../src/engine/demolition.js';
import { endTurn } from '../src/engine/engine.js';
import { deployUnit } from '../src/engine/deployment.js';
import { moveUnit } from '../src/engine/units.js';
import { buildAdjudicationSnapshot } from '../src/engine/engine.js';
import { createInitialGame } from '../src/state/store.js';
import { loadMaps } from '../src/config/loader.js';
import type { GameState, PlayerId, UnitType } from '../src/types.js';

let game: GameState | null = null;
loadMaps();

function snapshot(): unknown {
  if (!game) throw new Error('game is not initialized');
  const { tokens: _tokens, hostToken: _hostToken, events: _events, ...rest } = structuredClone(game);
  return { ...rest, events: [], adjudication: buildAdjudicationSnapshot(game) };
}

function owner(value: unknown): PlayerId {
  if (value === 'player_a' || value === 'player_b') return value;
  throw new Error('owner must be player_a or player_b');
}

function apply(command: Record<string, unknown>): unknown {
  if (!game) throw new Error('game is not initialized');
  const who = owner(command.owner);
  const action = command.action as Record<string, unknown>;
  const type = action.type;
  let result;
  if (type === 'move') {
    result = moveUnit(game, globalEventBus, who, String(action.unitId), Number(action.q), Number(action.r));
  } else if (type === 'attack') {
    result = attackTarget(game, globalEventBus, who, String(action.attackerId), String(action.targetId));
  } else if (type === 'heal') {
    result = healTarget(game, globalEventBus, who, String(action.supportId), String(action.targetId));
  } else if (type === 'deploy') {
    result = deployUnit(
      game,
      globalEventBus,
      who,
      String(action.unitType) as UnitType,
      String(action.fromId),
      Number(action.q),
      Number(action.r),
    );
  } else if (type === 'demolish') {
    result = demolishTerrain(game, globalEventBus, who, String(action.unitId), Number(action.q), Number(action.r));
  } else if (type === 'end_turn') {
    result = endTurn(game, globalEventBus, who);
  } else {
    throw new Error(`unknown action type: ${String(type)}`);
  }
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return snapshot();
}

function handle(command: Record<string, unknown>): unknown {
  if (command.cmd === 'reset') {
    game = createInitialGame(randomUUID(), 'default');
    return snapshot();
  }
  if (command.cmd === 'state') return snapshot();
  if (command.cmd === 'apply') return apply(command);
  throw new Error(`unknown command: ${String(command.cmd)}`);
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', line => {
  try {
    const command = JSON.parse(line) as Record<string, unknown>;
    process.stdout.write(`${JSON.stringify({ ok: true, state: handle(command) })}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(`${JSON.stringify({ ok: false, error: message })}\n`);
  }
});
