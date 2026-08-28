import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { globalEventBus } from '../src/events/bus.js';
import { attackTarget, healTarget } from '../src/engine/combat.js';
import { demolishTerrain } from '../src/engine/demolition.js';
import { endTurn } from '../src/engine/engine.js';
import { deployUnit } from '../src/engine/deployment.js';
import { moveUnit } from '../src/engine/units.js';
import { buildAdjudicationSnapshot } from '../src/engine/engine.js';
import { createInitialGame, createInitialGameWithConfig } from '../src/state/store.js';
import { loadMaps } from '../src/config/loader.js';
import { generateRandomMapConfig, sanitizeRandomOptions } from '../src/config/randomMap.js';
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

/** 导出供测试直接调用；作为主进程运行时由下方 stdin 循环驱动。 */
export function handleCommand(command: Record<string, unknown>): unknown {
  if (command.cmd === 'reset') {
    const mapId = typeof command.mapId === 'string' ? command.mapId : 'default';
    if (mapId === 'random') {
      // 本地训练用随机地图：与 REST 创建走同一套生成与校验逻辑，固定双人。
      const options = sanitizeRandomOptions(command.random);
      const config = generateRandomMapConfig(options, 2);
      game = createInitialGameWithConfig(randomUUID(), config, 'random');
    } else {
      game = createInitialGame(randomUUID(), mapId);
    }
    if (game.config.mode !== 'standard') {
      throw new Error(`map "${mapId}" uses ${game.config.mode} mode; local baseline supports standard mode only`);
    }
    return snapshot();
  }
  if (command.cmd === 'state') return snapshot();
  if (command.cmd === 'apply') return apply(command);
  throw new Error(`unknown command: ${String(command.cmd)}`);
}

// 仅当作为主进程运行时才监听 stdin（vitest 直接导入 handleCommand 不启动循环）。
const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on('line', line => {
    try {
      const command = JSON.parse(line) as Record<string, unknown>;
      process.stdout.write(`${JSON.stringify({ ok: true, state: handleCommand(command) })}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stdout.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    }
  });
}
