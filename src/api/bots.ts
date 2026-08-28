// src/api/bots.ts
//
// 强化学习 AI 玩家：房主在大厅中添加 AI 座位，开始对局时由服务器自动启动
// rl/run_model.py，让训练好的模型作为普通玩家参与 REST 对局。
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
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
// 旧版运行器：v2.0.0 模型（38 动作）使用其训练时期的编码快照 rl/env_v200.py。
const LEGACY_RUNNER_SCRIPT = join(PROJECT_ROOT, 'rl', 'run_model_v200.py');
// 最早的动态动作列表（512 动作）模型使用 v1 环境快照。
const V100_RUNNER_SCRIPT = join(PROJECT_ROOT, 'rl', 'run_model_v100.py');
const DEFAULT_BOT_NAME = '强化AI';
// v2.1.x / v2.2.x 的 54 动作模型（3922 维观测）专用快照运行器；
// v2.3 起观测扩为 5974 维，当前运行器只服务新模型。
const RUNNER_SCRIPT_V22 = join(PROJECT_ROOT, 'rl', 'run_model_v22.py');

/** 当前 rl/env.py 的动作空间大小（12 单位槽 × 4 意图 + 5 部署 + 结束回合）。 */
const CURRENT_ACTION_SPACE = 54;

/**
 * 动作空间 → 运行脚本。每次迭代环境后，旧模型仍需可玩：在这里登记新版本
 * 的动作空间与运行器，同时保留历史版本的映射（运行器内部用对应的 env
 * 快照做编码/合法动作）。未注册的动作空间不会被允许加入对局。
 * 54 动作存在两个观测语义世代（见 routeModel）：v2.1/v2.2 的 3922 维与
 * v2.3 随机地图的 5974 维，需按文件名版本分流到不同运行器。
 */
const RUNNERS_BY_ACTION_SPACE: ReadonlyMap<number, { runner: string; label: string }> = new Map([
  [38, { runner: LEGACY_RUNNER_SCRIPT, label: 'v2.0' }],
  [512, { runner: V100_RUNNER_SCRIPT, label: 'v1' }],
]);

/** 文件名中的版本号是否 ≥ v2.3（v2.3 随机地图观测世代）。 */
function isV23OrLaterModel(file: string): boolean {
  const match = file.match(/v(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 2 || (major === 2 && minor >= 3);
}

function routeModel(actionSpace: number | null, file: string): { runner: string; label: string } | undefined {
  if (actionSpace === null) return undefined;
  if (actionSpace === CURRENT_ACTION_SPACE) {
    return isV23OrLaterModel(file)
      ? { runner: RUNNER_SCRIPT, label: 'v2.3' }
      : { runner: RUNNER_SCRIPT_V22, label: 'v2.2' };
  }
  return RUNNERS_BY_ACTION_SPACE.get(actionSpace);
}

const SUPPORTED_ACTION_SPACES = [CURRENT_ACTION_SPACE, ...RUNNERS_BY_ACTION_SPACE.keys()];

export interface RlModelInfo {
  file: string;
  mtimeMs: number;
  /** 模型动作空间大小；无法解析时为 null，模型会被标记为不可运行。 */
  actionSpace: number | null;
  /** 与该模型兼容的运行脚本绝对路径；不可运行模型仅用于诊断。 */
  runner: string;
  /** 面向前端的版本标签，如 "v2.1"、"v2.0" 或空串。 */
  label: string;
  /** 只有能确定动作空间且已有快照运行器时才可启动。 */
  supported: boolean;
}

/** 当前 rl/env.py 的动作空间大小；run_model.py 启动后的版本守卫兜底校验。 */
const REQUIRED_ACTION_SPACE = CURRENT_ACTION_SPACE;

interface BotRecord {
  gameId: string;
  playerId: PlayerId;
  token: string;
  modelFile: string;
  /** 与该模型动作空间匹配的运行脚本；缺省时用当前版运行器。 */
  runnerScript?: string;
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

/** Extract one ordinary ZIP entry without adding a runtime dependency. */
function readZipEntry(zip: Buffer, wantedName: string): Buffer | null {
  try {
    // Walk the central directory. SB3 archives use ordinary ZIP32 entries;
    // this also works when the data entry is deflated or not the first entry.
    for (let offset = 0; offset + 46 <= zip.length; offset++) {
      if (zip.readUInt32LE(offset) !== 0x02014b50) continue;
      const compression = zip.readUInt16LE(offset + 10);
      const compressedSize = zip.readUInt32LE(offset + 20);
      const nameLength = zip.readUInt16LE(offset + 28);
      const extraLength = zip.readUInt16LE(offset + 30);
      const commentLength = zip.readUInt16LE(offset + 32);
      const localOffset = zip.readUInt32LE(offset + 42);
      const name = zip.toString('utf8', offset + 46, offset + 46 + nameLength);
      offset += 46 + nameLength + extraLength + commentLength - 1;
      if (name !== wantedName || localOffset + 30 > zip.length) continue;
      if (zip.readUInt32LE(localOffset) !== 0x04034b50) return null;
      const localNameLength = zip.readUInt16LE(localOffset + 26);
      const localExtraLength = zip.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const end = start + compressedSize;
      if (end > zip.length) return null;
      const payload = zip.subarray(start, end);
      if (compression === 0) return payload;
      if (compression === 8) return inflateRawSync(payload);
      return null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Read SB3's Discrete action-space size from the model metadata.
 * The cloudpickle payload is embedded as base64 in the ``data`` JSON entry;
 * the pickle stores the numpy integer as BINBYTES(8) followed by little-endian
 * bytes. Returning null means the archive is not safely identifiable.
 */
function readActionSpace(modelPath: string): number | null {
  try {
    const data = readZipEntry(readFileSync(modelPath), 'data');
    if (!data) return null;
    const text = data.toString('utf8');
    for (const match of text.matchAll(/[A-Za-z0-9+/=]{200,}/g)) {
      const decoded = Buffer.from(match[0], 'base64');
      for (let i = 0; i + 6 <= decoded.length; i++) {
        if (decoded[i] !== 0x43 || decoded[i + 1] !== 0x08) continue;
        const value = decoded.readInt32LE(i + 2);
        if (value > 0 && value < 100_000) return value;
      }
    }
    return null;
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
      .map(info => {
        const actionSpace = readActionSpace(join(MODELS_DIR, info.file));
        const route = routeModel(actionSpace, info.file);
        return {
          ...info,
          actionSpace,
          runner: route?.runner ?? RUNNER_SCRIPT,
          label: route?.label ?? '',
          supported: route !== undefined,
        };
      });
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
    const runnerScript = record.runnerScript ?? RUNNER_SCRIPT;
    const args = [
      runnerScript,
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
    supportedActionSpaces: SUPPORTED_ACTION_SPACES,
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
      // 未能可靠识别动作空间的模型也拒绝加入：否则它会在开局后才由
      // 当前运行器的版本守卫抛错，留下一个无人控制的 AI 座位。
      if (!known.supported) {
        return reply.code(400).send({
          error: known.actionSpace === null
            ? '无法识别模型动作空间；请重新导出模型或使用已支持的模型版本。'
            : `模型动作空间为 ${known.actionSpace}，没有对应的运行器；请使用已支持的模型版本。`,
          code: 'bot_not_supported',
        });
      }
      const name = req.body?.name?.trim().slice(0, MAX_PLAYER_NAME_LEN) || DEFAULT_BOT_NAME;
      const joined = addLobbyPlayer(game, name);
      if (!joined) return reply.code(409).send({ error: 'game already full', code: 'game_already_full' });
      appendEvent(game, globalEventBus, 'player_joined', { playerId: joined.id, name: game.players[joined.id]!.name });
      globalStore.persist(game);
      const records = botsByGame.get(game.id) ?? [];
      records.push({ gameId: game.id, playerId: joined.id, token: joined.token, modelFile: model, runnerScript: known.runner });
      botsByGame.set(game.id, records);
      return {
        ok: true,
        bot: { id: joined.id, name, model },
        lobby: lobbySummary(game),
      };
    },
  );
}
