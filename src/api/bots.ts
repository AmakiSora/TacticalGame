// src/api/bots.ts
//
// 强化学习 AI 玩家：房主在大厅中添加 AI 座位，开始对局时由服务器自动启动
// rl/run_model.py，让训练好的模型作为普通玩家参与 REST 对局。
import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import type { GameState, PlayerId } from '../types.js';
import { globalStore, addLobbyPlayer, MAX_PLAYER_NAME_LEN } from '../state/store.js';
import { globalEventBus } from '../events/bus.js';
import { appendEvent } from '../engine/events.js';
import { authenticateHost } from './auth.js';
import { lobbySummary } from './games.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');
const MODELS_DIR = join(PROJECT_ROOT, 'rl', 'models');
const RUNNER_SCRIPT = join(PROJECT_ROOT, 'rl', 'run_model.py');
const DEFAULT_BOT_NAME = '强化AI';

export interface RlModelInfo {
  file: string;
  mtimeMs: number;
  /** 模型动作空间大小；无法解析时为 null（此时由 run_model.py 自行校验）。 */
  actionSpace: number | null;
}

/** 当前 rl/env.py 的动作空间大小，与 run_model.py 的版本守卫保持一致。 */
const REQUIRED_ACTION_SPACE = 54;

interface BotRecord {
  gameId: string;
  playerId: PlayerId;
  token: string;
  modelFile: string;
  child?: ChildProcess;
}

interface BotDeps {
  // 测试注入点：默认在 VITEST 环境下不真正拉起 python 进程。
  spawner?: (cmd: string, args: string[], cwd: string) => ChildProcess | null;
}

const defaultSpawner: NonNullable<BotDeps['spawner']> = (cmd, args, cwd) => {
  if (process.env.VITEST) return null;
  return spawn(cmd, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: false,
  });
};

// 测试可通过 deps.spawner 注入伪启动器；默认行为见 defaultSpawner。
let activeSpawner: NonNullable<BotDeps['spawner']> = defaultSpawner;

let modelsCache: RlModelInfo[] = [];

/**
 * 读取模型 zip 内的 Discrete 动作空间大小。
 * SB3 把元数据 JSON（含 action_space 的 base64 cloudpickle）作为第一个条目
 * 原样存放在 zip 起始处；pickle 中 numpy int64 标量以 BINBYTES(0x43) +
 * 长度 + 小端字节出现。解析失败时返回 null，交由 run_model.py 启动后的版本守卫兜底。
 */
function readActionSpace(modelPath: string): number | null {
  try {
    const handle = openSync(modelPath, 'r');
    try {
      const head = Buffer.alloc(256 * 1024);
      const bytesRead = readSync(handle, head, 0, head.length, 0);
      const text = head.toString('latin1');
      for (const match of text.matchAll(/[A-Za-z0-9+/=]{200,}/g)) {
        const decoded = Buffer.from(match[0], 'base64');
        for (let i = 0; i < decoded.length - 10; i++) {
          if (decoded[i] === 0x43 && decoded[i + 1] === 0x08) {
            const value = decoded.readInt32LE(i + 2);
            if (value > 0 && value < 100_000) return value;
          }
        }
      }
      return null;
    } finally {
      closeSync(handle);
    }
  } catch {
    return null;
  }
}

/** 扫描 rl/models 目录下的 .zip 模型文件（新者优先）。目录不存在时返回空列表。 */
export function refreshRlModels(): RlModelInfo[] {
  modelsCache = [];
  try {
    modelsCache = readdirSync(MODELS_DIR)
      .filter(file => file.toLowerCase().endsWith('.zip'))
      .map(file => ({ file, mtimeMs: statSync(join(MODELS_DIR, file)).mtimeMs }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .map(info => ({ ...info, actionSpace: readActionSpace(join(MODELS_DIR, info.file)) }));
  } catch {
    // 目录缺失或不可读：视为没有可用模型。
  }
  return modelsCache;
}

function resolvePython(): string {
  if (process.env.RL_PYTHON) return process.env.RL_PYTHON;
  const venvPython = join(PROJECT_ROOT, 'rl', '.venv', 'Scripts', 'python.exe');
  if (existsSync(venvPython)) return venvPython;
  return 'python';
}

const botsByGame = new Map<string, BotRecord[]>();

function botsForGame(gameId: string): BotRecord[] {
  return botsByGame.get(gameId) ?? [];
}

/** 踢出玩家时同步清理注册表；非 AI 座位为空操作。 */
export function removeBotRecord(gameId: string, playerId: PlayerId): boolean {
  const records = botsByGame.get(gameId);
  if (!records) return false;
  const index = records.findIndex(record => record.playerId === playerId);
  if (index < 0) return false;
  records.splice(index, 1);
  if (!records.length) botsByGame.delete(gameId);
  return true;
}

/** 删除对局时清理并终止其全部 AI 子进程。 */
export function clearBotsForGame(gameId: string): void {
  for (const record of botsForGame(gameId)) record.child?.kill();
  botsByGame.delete(gameId);
}

function killAllBotProcesses(): void {
  for (const records of botsByGame.values()) {
    for (const record of records) record.child?.kill();
  }
  botsByGame.clear();
}

export function launchBotsForGame(baseUrl: string, logger: FastifyBaseLogger, game: GameState): void {
  const records = botsForGame(game.id);
  if (!records.length) return;
  const python = resolvePython();
  for (const record of records) {
    const args = [
      RUNNER_SCRIPT,
      '--url', baseUrl,
      '--game', record.gameId,
      '--token', record.token,
      '--side', record.playerId,
      '--model', join(MODELS_DIR, record.modelFile),
    ];
    logger.info({ gameId: game.id, bot: record.playerId, model: record.modelFile }, 'launching RL bot runner');
    let child: ChildProcess | null = null;
    try {
      child = activeSpawner(python, args, PROJECT_ROOT);
    } catch (err) {
      logger.error({ gameId: game.id, bot: record.playerId, err }, 'failed to spawn RL bot runner');
      continue;
    }
    if (!child) continue;
    record.child = child;
    // 不打印 argv：其中包含该座位的玩家 token。
    createInterface({ input: child.stdout! }).on('line', line =>
      logger.info({ gameId: game.id, bot: record.playerId }, line));
    createInterface({ input: child.stderr! }).on('line', line =>
      logger.warn({ gameId: game.id, bot: record.playerId }, line));
    child.on('error', err => {
      logger.error({ gameId: game.id, bot: record.playerId, err }, 'RL bot runner failed');
      record.child = undefined;
    });
    child.on('exit', code => {
      logger.warn({ gameId: game.id, bot: record.playerId, code }, 'RL bot runner exited');
      record.child = undefined;
    });
  }
}

export async function botsRoutes(app: FastifyInstance, deps: BotDeps = {}): Promise<void> {
  refreshRlModels();
  app.log.info({ dir: MODELS_DIR, count: modelsCache.length }, 'RL models indexed');

  if (deps.spawner) {
    // 测试用：覆盖默认的进程启动行为。
    activeSpawner = deps.spawner;
  }

  app.addHook('onClose', async () => killAllBotProcesses());

  app.get('/api/rl/models', async () => ({
    models: refreshRlModels(),
    python: resolvePython(),
    runner: RUNNER_SCRIPT,
    requiredActionSpace: REQUIRED_ACTION_SPACE,
  }));

  app.post<{ Params: { id: string }; Body: { name?: string; model?: string } }>(
    '/api/games/:id/bots', async (req, reply) => {
      const game = authenticateHost(req, reply);
      if (!game) return;
      if (game.phase !== 'lobby') {
        return reply.code(409).send({ error: 'game already started', code: 'game_already_started' });
      }
      if (game.maxPlayers !== 2 || game.config.mode === 'simultaneous') {
        return reply.code(400).send({
          error: '强化学习 AI 仅支持双人顺序对局',
          code: 'bot_not_supported',
        });
      }
      const model = req.body?.model?.trim();
      const known = refreshRlModels().find(info => info.file === model);
      if (!model || !known) {
        return reply.code(400).send({ error: `model "${model ?? ''}" not found`, code: 'model_not_found' });
      }
      if (known.actionSpace !== null && known.actionSpace !== REQUIRED_ACTION_SPACE) {
        return reply.code(400).send({
          error: `模型动作空间为 ${known.actionSpace}，当前环境需要 ${REQUIRED_ACTION_SPACE}；请使用当前 v2.1 模型。`,
          code: 'bot_not_supported',
        });
      }
      const name = req.body?.name?.trim().slice(0, MAX_PLAYER_NAME_LEN) || DEFAULT_BOT_NAME;
      const joined = addLobbyPlayer(game, name);
      if (!joined) return reply.code(409).send({ error: 'game already full', code: 'game_already_full' });
      appendEvent(game, globalEventBus, 'player_joined', { playerId: joined.id, name: game.players[joined.id]!.name });
      globalStore.persist(game);
      const records = botsByGame.get(game.id) ?? [];
      records.push({ gameId: game.id, playerId: joined.id, token: joined.token, modelFile: model });
      botsByGame.set(game.id, records);
      return {
        ok: true,
        bot: { id: joined.id, name, model },
        lobby: lobbySummary(game),
      };
    },
  );
}
