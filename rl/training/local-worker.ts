import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { globalEventBus } from '../../src/events/bus.js';
// 算法模块为 ESM .mjs，无类型声明（与 tests/algorithms 的引用方式一致）。
// @ts-expect-error untyped .mjs module
import { loadAlgorithm } from '../../algorithms/registry.mjs';
// @ts-expect-error untyped .mjs module
import * as algorithmUtils from '../../algorithms/lib/game-utils.mjs';
// @ts-expect-error untyped .mjs module
import { validateAlgorithm } from '../../algorithms/lib/interfaces.mjs';
import { attackTarget, healTarget } from '../../src/engine/combat.js';
import { demolishTerrain } from '../../src/engine/demolition.js';
import { endTurn } from '../../src/engine/engine.js';
import { deployUnit } from '../../src/engine/deployment.js';
import { moveUnit } from '../../src/engine/units.js';
import { buildAdjudicationSnapshot } from '../../src/engine/engine.js';
import { createInitialGame, createInitialGameWithConfig } from '../../src/state/store.js';
import { loadMaps } from '../../src/config/loader.js';
import { generateRandomMapConfig, sanitizeRandomOptions } from '../../src/config/randomMap.js';
import type { GameState, PlayerId, UnitType } from '../../src/types.js';

let game: GameState | null = null;
loadMaps();

/** 快照携带最近的事件尾部：v2.5 观测编码对手上一回合动作需要事件日志，
 * 编码只读最近一个回合，80 条足够覆盖且限制消息体积。
 * v2.8 起 reset 可用 eventTail 覆盖（训练环境不读事件，传 0 省掉序列化）。 */
const DEFAULT_SNAPSHOT_EVENT_TAIL = 80;
let snapshotEventTail = DEFAULT_SNAPSHOT_EVENT_TAIL;

function snapshot(): unknown {
  if (!game) throw new Error('game is not initialized');
  // 只克隆一次：事件先切尾再随整体克隆，避免此前对全量事件日志的二次 structuredClone。
  // rngState 与线上 REST 序列化（sanitizeGameForResponse）保持一致一并剥离。
  const { tokens: _tokens, hostToken: _hostToken, rngState: _rngState, events, ...rest } = game;
  return structuredClone({
    ...rest,
    events: snapshotEventTail > 0 ? events.slice(-snapshotEventTail) : [],
    adjudication: buildAdjudicationSnapshot(game),
  });
}

function parseEventTail(value: unknown): number {
  if (value === undefined) return DEFAULT_SNAPSHOT_EVENT_TAIL;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error('eventTail must be a non-negative integer');
  }
  return value;
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
export async function handleCommand(command: Record<string, unknown>): Promise<unknown> {
  if (command.cmd === 'reset') {
    snapshotEventTail = parseEventTail(command.eventTail);
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
  if (command.cmd === 'decide') return decideAlgorithmAction(command);
  throw new Error(`unknown command: ${String(command.cmd)}`);
}

// decide 通道：让内置算法 AI（algorithms/builtin/*.mjs）作为进程内评估对局的座位。
// 与 REST runner 的差别：这里每次 decide 只返回一个动作交给调用方（evaluate_cross）
// 应用并回传新快照，由 Python 侧驱动回合循环；playTurn 型接口依赖 HTTP 客户端，
// 进程内不支持。
const algorithmCache = new Map<string, { decide: (game: unknown, utils: unknown) => Promise<unknown> }>();

async function loadDecideAlgorithm(name: string) {
  const cached = algorithmCache.get(name);
  if (cached) return cached;
  const module = await loadAlgorithm(name);
  validateAlgorithm(module);
  if (typeof module.playTurn === 'function') {
    throw new Error(`algorithm "${name}" implements playTurn(); the in-process decide channel requires decide()`);
  }
  const entry = { decide: module.decide as (game: unknown, utils: unknown) => Promise<unknown> };
  algorithmCache.set(name, entry);
  return entry;
}

async function decideAlgorithmAction(command: Record<string, unknown>): Promise<unknown> {
  if (!game) throw new Error('game is not initialized');
  // standard 模式全情报，快照视角与座位无关；此处仅校验 owner 合法。
  owner(command.owner);
  const name = typeof command.algorithm === 'string' ? command.algorithm : '';
  if (!name) throw new Error('decide requires an algorithm name');
  const algorithm = await loadDecideAlgorithm(name);
  const view = snapshot();
  const action = await algorithm.decide(view, algorithmUtils);
  // decide 返回 null 即结束回合（与 algorithms/lib/interfaces.mjs 的适配器语义一致）。
  if (!action) return { endTurn: true };
  const { type, payload } = action as { type?: unknown; payload?: unknown };
  if (typeof type !== 'string' || !type) {
    throw new Error(`algorithm "${name}" returned an action without a valid type`);
  }
  return { action: { type, payload: typeof payload === 'object' && payload ? payload : {} } };
}

// 仅当作为主进程运行时才监听 stdin（vitest 直接导入 handleCommand 不启动循环）。
const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  // decide 是异步的：handle 串行 await 后才写响应，且调用方（Python）本就
  // 一问一答阻塞收线，响应顺序天然与请求顺序一致。
  let chain: Promise<void> = Promise.resolve();
  input.on('line', line => {
    chain = chain.then(async () => {
      try {
        const command = JSON.parse(line) as Record<string, unknown>;
        process.stdout.write(`${JSON.stringify({ ok: true, state: await handleCommand(command) })}\n`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stdout.write(`${JSON.stringify({ ok: false, error: message })}\n`);
      }
    });
  });
}
