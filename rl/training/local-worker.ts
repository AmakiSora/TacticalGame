import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { globalEventBus } from '../../src/events/bus.js';
// 算法模块为 ESM .mjs，无类型声明（与 tests/algorithms 的引用方式一致）。
// @ts-expect-error untyped .mjs module
import { loadAlgorithm, ALGORITHM_META } from '../../algorithms/registry.mjs';
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
import { commitAndMaybeResolve } from '../../src/engine/simultaneous.js';
import {
  queueAttackAction, queueDeployAction, queueDemolishAction, queueHealAction,
  queueMoveAction, queueWaitAction,
} from '../../src/engine/planning.js';
import { createInitialGame, createInitialGameWithConfig } from '../../src/state/store.js';
import { loadMaps } from '../../src/config/loader.js';
import { generateRandomMapConfig, sanitizeRandomOptions } from '../../src/config/randomMap.js';
import { isSimultaneousMode } from '../../src/types.js';
import type { GameState, PlayerId, UnitType } from '../../src/types.js';

let game: GameState | null = null;
loadMaps();

/** 快照携带最近的事件尾部：v2.5 观测编码对手上一回合动作需要事件日志，
 * 编码只读最近一个回合，80 条足够覆盖且限制消息体积。
 * v2.8 起 reset 可用 eventTail 覆盖（训练环境不读事件，传 0 省掉序列化）。 */
const DEFAULT_SNAPSHOT_EVENT_TAIL = 80;
let snapshotEventTail = DEFAULT_SNAPSHOT_EVENT_TAIL;

function snapshot(viewer?: PlayerId): unknown {
  if (!game) throw new Error('game is not initialized');
  // 只克隆一次：事件先切尾再随整体克隆，避免此前对全量事件日志的二次 structuredClone。
  // rngState 与线上 REST 序列化（sanitizeGameForResponse）保持一致一并剥离。
  const { tokens: _tokens, hostToken: _hostToken, rngState: _rngState, events, ...rest } = game;
  const body = structuredClone({
    ...rest,
    events: snapshotEventTail > 0 ? events.slice(-snapshotEventTail) : [],
    adjudication: buildAdjudicationSnapshot(game),
  }) as Record<string, unknown>;
  // 同时模式：计划队列是秘密，与 src/api/auth.ts 的 sanitizeGameForResponse 同口径——
  // 传 viewer 只暴露该座位自己的队列（myQueue），committed 名单保持公开；不传 viewer
  // 一律视为无特权，queues 全部剥掉（apply/state/reset 的调用方只读 committed，
  // 不依赖队列内容）。
  if (isSimultaneousMode(game.config.mode) && body.plan && typeof body.plan === 'object') {
    const plan = body.plan as { queues?: unknown; committed?: unknown };
    const myQueue = viewer && game.plan?.queues[viewer] ? game.plan.queues[viewer] : [];
    const queues: Record<string, unknown> = {};
    if (viewer && myQueue.length > 0) queues[viewer] = structuredClone(myQueue);
    body.plan = { ...plan, queues, myQueue: structuredClone(myQueue) };
  }
  return body;
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

/** 同时模式：动作只入队，不立即执行；end_turn 表示提交本回合计划。 */
function applyPlannedAction(who: PlayerId, type: unknown, action: Record<string, unknown>) {
  if (!game) throw new Error('game is not initialized');
  if (type === 'move') {
    return queueMoveAction(game, who, String(action.unitId), Number(action.q), Number(action.r));
  }
  if (type === 'attack') {
    return queueAttackAction(game, who, String(action.attackerId), Number(action.q), Number(action.r));
  }
  if (type === 'heal') {
    return queueHealAction(game, who, String(action.supportId), Number(action.q), Number(action.r));
  }
  if (type === 'deploy') {
    return queueDeployAction(
      game,
      who,
      String(action.unitType) as UnitType,
      String(action.fromId),
      Number(action.q),
      Number(action.r),
    );
  }
  if (type === 'demolish') {
    return queueDemolishAction(game, who, String(action.unitId), Number(action.q), Number(action.r));
  }
  if (type === 'wait') {
    return queueWaitAction(game, who);
  }
  if (type === 'end_turn') {
    return commitAndMaybeResolve(game, globalEventBus, who);
  }
  throw new Error(`unknown action type: ${String(type)}`);
}

function apply(command: Record<string, unknown>): unknown {
  if (!game) throw new Error('game is not initialized');
  const who = owner(command.owner);
  const action = command.action as Record<string, unknown>;
  const type = action.type;
  let result;
  if (isSimultaneousMode(game.config.mode)) {
    result = applyPlannedAction(who, type, action);
  } else if (type === 'move') {
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
    // apply 通道支持两类语义：standard 逐动作立即执行；simultaneous 动作入队、
    // end_turn 提交并触发统一结算。歼灭/大逃杀跑批尚未接入（炮火缩圈与淘汰流程）。
    if (game.config.mode !== 'standard' && game.config.mode !== 'simultaneous') {
      throw new Error(
        `map "${mapId}" uses ${game.config.mode} mode; local baseline supports standard and simultaneous modes only`,
      );
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
const algorithmCache = new Map<string, {
  decide: (game: unknown, utils: unknown, ctx?: { owner: PlayerId }) => Promise<unknown>;
}>();

async function loadDecideAlgorithm(name: string) {
  const cached = algorithmCache.get(name);
  if (cached) return cached;
  const module = await loadAlgorithm(name);
  validateAlgorithm(module);
  if (typeof module.playTurn === 'function') {
    throw new Error(`algorithm "${name}" implements playTurn(); the in-process decide channel requires decide()`);
  }
  const entry = {
    decide: module.decide as (game: unknown, utils: unknown, ctx?: { owner: PlayerId }) => Promise<unknown>,
  };
  algorithmCache.set(name, entry);
  return entry;
}

async function decideAlgorithmAction(command: Record<string, unknown>): Promise<unknown> {
  if (!game) throw new Error('game is not initialized');
  const who = owner(command.owner);
  const name = typeof command.algorithm === 'string' ? command.algorithm : '';
  if (!name) throw new Error('decide requires an algorithm name');
  // 不同模式不能混用算法：注册表 ALGORITHM_META.modes 是唯一口径（缺省仅 standard）。
  // reset 接受 standard 与 simultaneous 两类地图，因此这里同时挡住两个方向的混用。
  const declared = ALGORITHM_META[name]?.modes;
  const modes = Array.isArray(declared) && declared.length ? declared : ['standard'];
  if (!modes.includes(game.config.mode)) {
    throw new Error(
      `algorithm "${name}" supports mode(s) [${modes.join(', ')}]; current game mode is "${game.config.mode}"`,
    );
  }
  const algorithm = await loadDecideAlgorithm(name);
  // 同时模式没有 currentPlayerId，算法只能从 ctx.owner 得知自己的座位；
  // 快照也按座位做计划保密（只暴露 myQueue）。
  const view = snapshot(who);
  const action = await algorithm.decide(view, algorithmUtils, { owner: who });
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
