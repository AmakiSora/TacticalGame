// src/api/bots.ts
//
// 强化学习 AI 玩家：房主在大厅中添加 AI 座位，开始对局时由服务器自动启动
// rl/runners/run_model.py，让训练好的模型作为普通玩家参与 REST 对局。
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import type { GameState, PlayerId } from '../types.js';
import { isSimultaneousMode, MAX_PLAYER_NAME_LEN } from '../types.js';
import { globalStore, addLobbyPlayer } from '../state/store.js';
import { globalEventBus } from '../events/bus.js';
import { appendEvent } from '../engine/events.js';
import { authenticateHost } from './auth.js';
import { lobbySummary } from './games.js';
// 算法展示元数据唯一来源（类型声明见 algorithms/registry.d.mts）。
import { listAlgorithmInfo, algorithmParticipantId } from '../../algorithms/registry.mjs';
// 过期模型名单唯一来源（类型声明见 script/modelStatus.d.mts）。
import { loadModelStatus, versionOfModelFile } from '../../script/modelStatus.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');
const MODELS_DIR = join(PROJECT_ROOT, 'rl', 'models');
const RUNNER_SCRIPT = join(PROJECT_ROOT, 'rl', 'runners', 'run_model.py');
const ALGORITHM_RUNNER = join(PROJECT_ROOT, 'algorithms', 'runner.mjs');
// 旧版运行器：v2.0.0 模型（38 动作）使用其训练时期的编码快照 rl/envs/env_v200.py。
const LEGACY_RUNNER_SCRIPT = join(PROJECT_ROOT, 'rl', 'runners', 'run_model_v200.py');
// 最早的动态动作列表（512 动作）模型使用 v1 环境快照。
const V100_RUNNER_SCRIPT = join(PROJECT_ROOT, 'rl', 'runners', 'run_model_v100.py');
const DEFAULT_BOT_NAME = '强化AI';
// v2.1.x / v2.2.x 的 54 动作模型（3922 维观测）专用快照运行器；
// v2.3 起观测扩为 5974 维，v2.5 曾扩为 6024 维（对手动作历史，已回退），
// v2.6 起观测回到 5974 维。
const RUNNER_SCRIPT_V22 = join(PROJECT_ROOT, 'rl', 'runners', 'run_model_v22.py');
// v2.3.x / v2.4.x 的 54 动作模型（5974 维观测）专用快照运行器。
const RUNNER_SCRIPT_V24 = join(PROJECT_ROOT, 'rl', 'runners', 'run_model_v24.py');
// v2.5.x 的 54 动作模型（6024 维观测，对手动作历史）专用快照运行器。
const RUNNER_SCRIPT_V25 = join(PROJECT_ROOT, 'rl', 'runners', 'run_model_v25.py');
// v2.6.x 的 54 动作模型（5974 维观测）专用兼容运行器。
const RUNNER_SCRIPT_V26 = join(PROJECT_ROOT, 'rl', 'runners', 'run_model_v26.py');
// v2.7.x / v2.8.x 的 54 动作模型（6205 维观测）冻结快照运行器。
const RUNNER_SCRIPT_V27 = join(PROJECT_ROOT, 'rl', 'runners', 'run_model_v27.py');

/** 当前 rl/envs/env.py 的动作空间大小（v3.0：12 单位槽 × 12 分层候选 + 5 兵种 × 2 部署点 + 结束回合）。 */
const CURRENT_ACTION_SPACE = 155;
/** v2.1–v2.8 共用的 54 动作空间，按文件名版本分五代冻结运行器。 */
const V2_ACTION_SPACE = 54;

/**
 * 动作空间 → 运行脚本。每次迭代环境后，旧模型仍需可玩：在这里登记新版本
 * 的动作空间与运行器，同时保留历史版本的映射（运行器内部用对应的 env
 * 快照做编码/合法动作）。未注册的动作空间不会被允许加入对局。
 * 54 动作存在五个观测语义世代（见 routeModel）：v2.1/v2.2 的 3922 维、
 * v2.3/v2.4 随机地图的 5974 维、v2.5（+对手动作历史）的 6024 维、
 * v2.6（回退 5974 维）以及 v2.7/v2.8（6205 维），需按文件名版本分流。
 * 155 动作为 v3.0+ 当前环境。
 */
const RUNNERS_BY_ACTION_SPACE: ReadonlyMap<number, { runner: string; label: string }> = new Map([
  [38, { runner: LEGACY_RUNNER_SCRIPT, label: 'v2.0' }],
  [512, { runner: V100_RUNNER_SCRIPT, label: 'v1' }],
]);

/** 解析文件名中的版本号；无版本号返回 null。 */
function parseModelVersion(file: string): { major: number; minor: number } | null {
  const match = file.match(/v(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]) };
}

function routeModel(actionSpace: number | null, file: string): { runner: string; label: string } | undefined {
  if (actionSpace === null) return undefined;
  if (actionSpace === CURRENT_ACTION_SPACE) return { runner: RUNNER_SCRIPT, label: 'v3.0' };
  if (actionSpace === V2_ACTION_SPACE) {
    const version = parseModelVersion(file);
    const minorAtLeast = (minor: number) =>
      version !== null && (version.major > 2 || (version.major === 2 && version.minor >= minor));
    if (minorAtLeast(7)) return { runner: RUNNER_SCRIPT_V27, label: 'v2.7' };
    if (minorAtLeast(6)) return { runner: RUNNER_SCRIPT_V26, label: 'v2.6' };
    if (minorAtLeast(5)) return { runner: RUNNER_SCRIPT_V25, label: 'v2.5' };
    if (minorAtLeast(3)) return { runner: RUNNER_SCRIPT_V24, label: 'v2.3' };
    return { runner: RUNNER_SCRIPT_V22, label: 'v2.2' };
  }
  return RUNNERS_BY_ACTION_SPACE.get(actionSpace);
}

const SUPPORTED_ACTION_SPACES = [CURRENT_ACTION_SPACE, V2_ACTION_SPACE, ...RUNNERS_BY_ACTION_SPACE.keys()];

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

/** 当前 rl/envs/env.py 的动作空间大小；run_model.py 启动后的版本守卫兜底校验。 */
const REQUIRED_ACTION_SPACE = CURRENT_ACTION_SPACE;

interface BotRecord {
  gameId: string;
  playerId: PlayerId;
  token: string;
  modelFile: string;
  /** 与该模型动作空间匹配的运行脚本；缺省时用当前版运行器。 */
  runnerScript?: string;
  child?: ChildProcess;
  baseUrl?: string;
  restarts?: number;
  failed?: boolean;
  restartTimer?: ReturnType<typeof setTimeout>;
  output?: string[];
}

interface AlgorithmBotRecord {
  gameId: string;
  playerId: PlayerId;
  token: string;
  algorithmName: string;
  child?: ChildProcess;
  baseUrl?: string;
  restarts?: number;
  failed?: boolean;
  restartTimer?: ReturnType<typeof setTimeout>;
  output?: string[];
}

interface BotDeps {
  // 测试注入点：默认在 VITEST 环境下不真正拉起 python 进程。
  spawner?: (cmd: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv) => ChildProcess | null;
}

const defaultSpawner: NonNullable<BotDeps['spawner']> = (cmd, args, cwd, env) => {
  if (process.env.VITEST) return null;
  return spawn(cmd, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: false,
    env: { ...process.env, ...env },
  });
};

// 测试可通过 deps.spawner 注入伪启动器；默认行为见 defaultSpawner。
let activeSpawner: NonNullable<BotDeps['spawner']> = defaultSpawner;

let modelsCache: RlModelInfo[] = [];
// 模型解析结果按 (file, mtimeMs, size) 缓存：目录扫描仍每次做，但 ZIP 解压/动作空间
// 探测只在文件变化时执行。过期名单是独立过滤条件，不参与缓存键。
const modelInfoCache = new Map<string, { mtimeMs: number; size: number; info: RlModelInfo }>();

/** 可用的算法 AI 配置。由 algorithms/registry.mjs 的展示元数据生成：
 * 注册表是唯一来源，勿在此另立清单（历史上双份清单出过前后端选项不一致）。 */
export interface AlgorithmBotConfig {
  name: string;
  algorithm: string;
  description: string;
  /** 算法声明支持的对局模式（注册表 ALGORITHM_META.modes），跨模式混用一律拒绝。 */
  modes: string[];
}
export const ALGORITHM_BOTS: Record<string, AlgorithmBotConfig> = Object.fromEntries(
  listAlgorithmInfo().map(info => [algorithmParticipantId(info.name), {
    name: info.displayName,
    algorithm: info.name,
    description: info.description,
    modes: info.modes,
  }]),
);

/** 对局模式的中文名（bot 拒绝文案用）。 */
const MODE_LABELS: Record<string, string> = {
  standard: '标准',
  simultaneous: '同时回合',
  royale: '大逃杀',
  annihilation: '歼灭',
};
function modeLabel(mode: string): string {
  return MODE_LABELS[mode] ?? mode;
}

/** 大厅内出现同名玩家会让踢人/观战难以区分：名称被占用时自动追加序号。 */
function uniqueLobbyName(game: GameState, name: string): string {
  const taken = new Set(Object.values(game.playerNames));
  if (!taken.has(name)) return name;
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    const candidate = name.slice(0, MAX_PLAYER_NAME_LEN - suffix.length) + suffix;
    if (!taken.has(candidate)) return candidate;
  }
}

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

/** 读取 arena/model-status.json 的过期模型版本集合（语义见 script/modelStatus.mjs）。 */
function expiredVersionSet(): Set<string> {
  try {
    return new Set(loadModelStatus().entries.map(entry => entry.version));
  } catch (err) {
    // 口径（见 script/modelStatus.mjs 头注）：脚本与评估链路对坏名单 fail-fast，
    // 服务端是唯一允许降级的消费端——登记表坏了不阻断线上对局，退化为「无过期」
    // 但必须留下可见告警（代价仅是过期模型临时回到「添加 AI」列表）。
    console.warn(`[bots] 无法读取过期模型登记表：${(err as Error).message}；本次不排除任何过期模型。`);
    return new Set();
  }
}

/** 扫描 rl/models 目录下的 .zip 模型文件（新者优先）。目录不存在时返回空列表。 */
export function refreshRlModels(): RlModelInfo[] {
  const expired = expiredVersionSet();
  let files: string[];
  try {
    files = readdirSync(MODELS_DIR).filter(file => file.toLowerCase().endsWith('.zip'));
  } catch {
    // 目录缺失或不可读：视为没有可用模型。
    modelsCache = [];
    modelInfoCache.clear();
    return modelsCache;
  }

  const seen = new Set<string>();
  const next: RlModelInfo[] = [];
  for (const file of files) {
    const version = versionOfModelFile(file);
    if (version !== null && expired.has(version)) continue;
    const full = join(MODELS_DIR, file);
    let stat;
    try {
      stat = statSync(full);
      if (!stat.isFile()) continue;
    } catch {
      continue;
    }
    seen.add(file);
    const cached = modelInfoCache.get(file);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      next.push(cached.info);
      continue;
    }
    const actionSpace = readActionSpace(full);
    const route = routeModel(actionSpace, file);
    const info: RlModelInfo = {
      file,
      mtimeMs: stat.mtimeMs,
      actionSpace,
      runner: route?.runner ?? RUNNER_SCRIPT,
      label: route?.label ?? '',
      supported: route !== undefined,
    };
    modelInfoCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, info });
    next.push(info);
  }
  // 删除已不存在的模型缓存，避免目录清理后旧条目常驻。
  for (const file of modelInfoCache.keys()) {
    if (!seen.has(file)) modelInfoCache.delete(file);
  }
  next.sort((a, b) => b.mtimeMs - a.mtimeMs);
  modelsCache = next;
  return modelsCache;
}

function resolvePython(): string {
  if (process.env.RL_PYTHON) return process.env.RL_PYTHON;
  const venvPython = join(PROJECT_ROOT, 'rl', '.venv', 'Scripts', 'python.exe');
  if (existsSync(venvPython)) return venvPython;
  return 'python';
}

const botsByGame = new Map<string, BotRecord[]>();
const algorithmBotsByGame = new Map<string, AlgorithmBotRecord[]>();

function botsForGame(gameId: string): BotRecord[] {
  return botsByGame.get(gameId) ?? [];
}

function algorithmBotsForGame(gameId: string): AlgorithmBotRecord[] {
  return algorithmBotsByGame.get(gameId) ?? [];
}

/** 踢出玩家时同步清理注册表；非 AI 座位为空操作。 */
export function removeBotRecord(gameId: string, playerId: PlayerId): boolean {
  const records = botsByGame.get(gameId);
  if (records) {
    const index = records.findIndex(record => record.playerId === playerId);
    if (index >= 0) {
      records.splice(index, 1);
      if (!records.length) botsByGame.delete(gameId);
      return true;
    }
  }

  const algoRecords = algorithmBotsByGame.get(gameId);
  if (algoRecords) {
    const index = algoRecords.findIndex(record => record.playerId === playerId);
    if (index >= 0) {
      algoRecords.splice(index, 1);
      if (!algoRecords.length) algorithmBotsByGame.delete(gameId);
      return true;
    }
  }

  return false;
}

/** 删除对局时清理并终止其全部 AI 子进程。 */
export function clearBotsForGame(gameId: string): void {
  for (const record of botsForGame(gameId)) {
    if (record.restartTimer) clearTimeout(record.restartTimer);
    record.child?.kill();
  }
  botsByGame.delete(gameId);
  for (const record of algorithmBotsForGame(gameId)) {
    if (record.restartTimer) clearTimeout(record.restartTimer);
    record.child?.kill();
  }
  algorithmBotsByGame.delete(gameId);
}

function killAllBotProcesses(): void {
  for (const records of botsByGame.values()) {
    for (const record of records) {
      if (record.restartTimer) clearTimeout(record.restartTimer);
      record.child?.kill();
    }
  }
  botsByGame.clear();
  for (const records of algorithmBotsByGame.values()) {
    for (const record of records) {
      if (record.restartTimer) clearTimeout(record.restartTimer);
      record.child?.kill();
    }
  }
  algorithmBotsByGame.clear();
}

function appendOutput(record: BotRecord | AlgorithmBotRecord, line: string): void {
  record.output = [...(record.output ?? []), line].slice(-50);
}

function rlStillRegistered(gameId: string, record: BotRecord): boolean {
  return botsByGame.get(gameId)?.includes(record) ?? false;
}

function algorithmStillRegistered(gameId: string, record: AlgorithmBotRecord): boolean {
  return algorithmBotsByGame.get(gameId)?.includes(record) ?? false;
}

function notifyBotFailed(game: GameState, record: BotRecord | AlgorithmBotRecord, reason: string): void {
  appendEvent(game, globalEventBus, 'bot_failed', {
    playerId: record.playerId,
    bot: 'modelFile' in record ? 'rl' : 'algorithm',
    reason,
    restarts: record.restarts ?? 0,
  });
}

function scheduleRestart(
  game: GameState,
  record: BotRecord | AlgorithmBotRecord,
  logger: FastifyBaseLogger,
  launch: () => void,
  stillRegistered: () => boolean,
): void {
  if (record.failed || !stillRegistered()) return;
  const restarts = (record.restarts ?? 0) + 1;
  record.restarts = restarts;
  if (restarts > 3) {
    record.failed = true;
    logger.error({ gameId: game.id, bot: record.playerId, restarts }, 'bot restart limit reached');
    notifyBotFailed(game, record, 'restart_limit');
    return;
  }
  const delayMs = Math.min(8_000, 500 * 2 ** (restarts - 1));
  logger.warn({ gameId: game.id, bot: record.playerId, restarts, delayMs }, 'bot scheduled for restart');
  record.restartTimer = setTimeout(() => {
    record.restartTimer = undefined;
    if (stillRegistered()) launch();
  }, delayMs);
  record.restartTimer.unref?.();
}

function launchRlRecord(baseUrl: string, logger: FastifyBaseLogger, game: GameState, record: BotRecord): void {
  if (record.restartTimer) {
    clearTimeout(record.restartTimer);
    record.restartTimer = undefined;
  }
  const python = resolvePython();
  const runnerScript = record.runnerScript ?? RUNNER_SCRIPT;
  const args = [
    runnerScript,
    '--url', baseUrl,
    '--game', record.gameId,
    '--side', record.playerId,
    '--model', join(MODELS_DIR, record.modelFile),
  ];
  logger.info({ gameId: game.id, bot: record.playerId, model: record.modelFile }, 'launching RL bot runner');
  let child: ChildProcess | null = null;
  try {
    child = activeSpawner(python, args, PROJECT_ROOT, { TACTICAL_GAME_BOT_TOKEN: record.token });
  } catch (err) {
    logger.error({ gameId: game.id, bot: record.playerId, err }, 'failed to spawn RL bot runner');
    scheduleRestart(game, record, logger, () => launchRlRecord(baseUrl, logger, game, record),
      () => rlStillRegistered(game.id, record));
    return;
  }
  if (!child) return;
  record.child = child;
  // 不打印 argv：token 通过环境变量传递，不进入命令行。
  if (child.stdout) createInterface({ input: child.stdout }).on('line', line => {
    appendOutput(record, line);
    logger.info({ gameId: game.id, bot: record.playerId }, line);
  });
  if (child.stderr) createInterface({ input: child.stderr }).on('line', line => {
    appendOutput(record, line);
    logger.warn({ gameId: game.id, bot: record.playerId }, line);
  });
  child.on('error', err => {
    logger.error({ gameId: game.id, bot: record.playerId, err }, 'RL bot runner failed');
    record.child = undefined;
  });
  child.on('exit', code => {
    logger.warn({ gameId: game.id, bot: record.playerId, code }, 'RL bot runner exited');
    record.child = undefined;
    scheduleRestart(game, record, logger, () => launchRlRecord(baseUrl, logger, game, record),
      () => rlStillRegistered(game.id, record));
  });
}

function launchAlgorithmRecord(baseUrl: string, logger: FastifyBaseLogger, game: GameState, record: AlgorithmBotRecord): void {
  if (record.restartTimer) {
    clearTimeout(record.restartTimer);
    record.restartTimer = undefined;
  }
  const args = [
    ALGORITHM_RUNNER,
    '--algorithm', record.algorithmName,
    '--url', baseUrl,
    '--game', record.gameId,
    '--side', record.playerId,
    '--quiet',
  ];
  logger.info({ gameId: game.id, bot: record.playerId, algorithm: record.algorithmName }, 'launching algorithm bot');
  let child: ChildProcess | null = null;
  try {
    child = activeSpawner('node', args, PROJECT_ROOT, { TACTICAL_GAME_BOT_TOKEN: record.token });
  } catch (err) {
    logger.error({ gameId: game.id, bot: record.playerId, err }, 'failed to spawn algorithm bot');
    scheduleRestart(game, record, logger, () => launchAlgorithmRecord(baseUrl, logger, game, record),
      () => algorithmStillRegistered(game.id, record));
    return;
  }
  if (!child) return;
  record.child = child;
  if (child.stdout) createInterface({ input: child.stdout }).on('line', line => {
    appendOutput(record, line);
    logger.info({ gameId: game.id, bot: record.playerId }, line);
  });
  if (child.stderr) createInterface({ input: child.stderr }).on('line', line => {
    appendOutput(record, line);
    logger.warn({ gameId: game.id, bot: record.playerId }, line);
  });
  child.on('error', err => {
    logger.error({ gameId: game.id, bot: record.playerId, err }, 'algorithm bot runner failed');
    record.child = undefined;
  });
  child.on('exit', code => {
    logger.warn({ gameId: game.id, bot: record.playerId, code }, 'algorithm bot runner exited');
    record.child = undefined;
    scheduleRestart(game, record, logger, () => launchAlgorithmRecord(baseUrl, logger, game, record),
      () => algorithmStillRegistered(game.id, record));
  });
}

export function launchBotsForGame(baseUrl: string, logger: FastifyBaseLogger, game: GameState): void {
  for (const record of botsForGame(game.id)) {
    record.baseUrl = baseUrl;
    launchRlRecord(baseUrl, logger, game, record);
  }
  for (const record of algorithmBotsForGame(game.id)) {
    record.baseUrl = baseUrl;
    launchAlgorithmRecord(baseUrl, logger, game, record);
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

  app.get('/api/rl/models', async (req, reply) => {
    const models = refreshRlModels();
    const body = {
      models,
      python: resolvePython(),
      runner: RUNNER_SCRIPT,
      requiredActionSpace: REQUIRED_ACTION_SPACE,
      supportedActionSpaces: SUPPORTED_ACTION_SPACES,
    };
    // 模型列表只在文件/动作空间变化时改变；304 让大厅和评估控制台的轮询不再
    // 每次都传输整张模型表。
    const etag = `"rl-models-${createHash('sha256').update(JSON.stringify(models)).digest('hex').slice(0, 16)}"`;
    reply.header('ETag', etag);
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();
    return body;
  });

  app.get('/api/algorithms', async () => ({
    algorithms: Object.entries(ALGORITHM_BOTS).map(([key, config]) => ({
      id: key,
      name: config.name,
      algorithm: config.algorithm,
      description: config.description,
      modes: config.modes,
    })),
  }));

  app.post<{ Params: { id: string }; Body: { name?: string; model?: string } }>(
    '/api/games/:id/bots', async (req, reply) => {
      const game = authenticateHost(req, reply);
      if (!game) return;
      if (game.phase !== 'lobby') {
        return reply.code(409).send({ error: '对局已经开始', code: 'game_already_started' });
      }
      if (game.maxPlayers !== 2 || isSimultaneousMode(game.config.mode)) {
        return reply.code(400).send({
          error: '强化学习 AI 仅支持双人顺序对局',
          code: 'bot_not_supported',
        });
      }
      const model = req.body?.model?.trim();
      const known = refreshRlModels().find(info => info.file === model);
      if (!model || !known) {
        return reply.code(400).send({ error: `找不到模型「${model ?? ''}」`, code: 'model_not_found' });
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
      const name = uniqueLobbyName(game, req.body?.name?.trim().slice(0, MAX_PLAYER_NAME_LEN) || DEFAULT_BOT_NAME);
      const joined = addLobbyPlayer(game, name);
      if (!joined) return reply.code(409).send({ error: '房间已满', code: 'game_already_full' });
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

  app.post<{ Params: { id: string }; Body: { botType?: string; name?: string } }>(
    '/api/games/:id/bots/algorithm', async (req, reply) => {
      const game = authenticateHost(req, reply);
      if (!game) return;
      if (game.phase !== 'lobby') {
        return reply.code(409).send({ error: '对局已经开始', code: 'game_already_started' });
      }
      const botType = req.body?.botType?.trim();
      const config = botType ? ALGORITHM_BOTS[botType] : undefined;
      if (!botType || !config) {
        return reply.code(400).send({
          error: `未知的算法类型「${botType ?? ''}」`,
          code: 'bot_not_found',
        });
      }
      // 算法按注册表声明的 modes 与对局模式匹配，不同模式不能混用。
      if (!config.modes.includes(game.config.mode)) {
        return reply.code(400).send({
          error: `算法「${config.name}」仅支持${config.modes.map(modeLabel).join('、')}模式，` +
            `当前对局为${modeLabel(game.config.mode)}模式`,
          code: 'bot_not_supported',
        });
      }
      const name = uniqueLobbyName(game, req.body?.name?.trim().slice(0, MAX_PLAYER_NAME_LEN) || config.name);
      const joined = addLobbyPlayer(game, name);
      if (!joined) return reply.code(409).send({ error: '房间已满', code: 'game_already_full' });
      appendEvent(game, globalEventBus, 'player_joined', { playerId: joined.id, name: game.players[joined.id]!.name });
      globalStore.persist(game);
      const records = algorithmBotsByGame.get(game.id) ?? [];
      records.push({
        gameId: game.id,
        playerId: joined.id,
        token: joined.token,
        algorithmName: config.algorithm,
      });
      algorithmBotsByGame.set(game.id, records);
      return {
        ok: true,
        bot: { id: joined.id, name, algorithm: config.algorithm },
        lobby: lobbySummary(game),
      };
    },
  );
}
