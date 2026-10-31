// src/api/arenaEval.ts
//
// AI 竞技场评估控制台后端：让排行榜页面可以直接网页启动/监控/停止
// rl/evaluation/round_robin.py 跑批（RL 模型 × 内置算法混合循环赛），
// 结束后自动重算榜单数据。
// 跑批依赖 rl/.venv 的 Python 与本地 rl/models 模型，属于本地开发功能；镜像按设计只带
// 服务端本体（见 Dockerfile 的 script/ COPY 清单），缺跑批链路时写接口返回 501。
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { authorizeControlRequest } from './controlAuth.js';
import { ALGORITHM_BOTS, refreshRlModels } from './bots.js';
import { algorithmParticipantId } from '../../algorithms/registry.mjs';
import { RANDOM_MAP_MODES } from '../config/randomMap.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');
const ROUND_ROBIN_SCRIPT = join(PROJECT_ROOT, 'rl', 'evaluation', 'round_robin.py');
const LEADERBOARD_SCRIPT = join(PROJECT_ROOT, 'script', 'generateArenaLeaderboard.mjs');
const ARENA_STATS_SCRIPT = join(PROJECT_ROOT, 'script', 'generateArenaStats.mjs');
const DEFAULT_STATS_FILE = join(PROJECT_ROOT, 'arena', 'matches.jsonl');
const DEFAULT_STATE_FILE = join(PROJECT_ROOT, 'runtime', 'arena-eval-state.json');

/**
 * 评估链路三件套：跑批脚本 + 跑批结束后要 spawn 的榜单/统计脚本。
 * 镜像只带服务端本体，缺件时相关写接口返回 501 说明「本部署不带这套工具」，
 * 而不是让 spawn ENOENT 冒成一个读不懂的 500。
 */
const EVAL_TOOLCHAIN = [ROUND_ROBIN_SCRIPT, LEADERBOARD_SCRIPT, ARENA_STATS_SCRIPT];

// 评估链路已接入全部四种模式：跑批脚本缺省地图池（STANDARD_EVAL_MAPS）与
// round_robin.py 的 DEFAULT_MAPS 保持一致；四种模式各有自己的静态地图与虚拟随机图
// （`random` / `random-annihilation` / `random-simultaneous` / `random-royale`，见
// `RANDOM_MAP_MODES`），且只纳入注册表声明该模式的算法（RL 模型目前只覆盖标准模式）。
// 四种模式的算法条目：歼灭 random-annihilation / shrinkroll / vortex / crucible / sovereign，
// 大逃杀 random-royale / echelon / apex / ark，各模式均 ≥ 2 个可组批；「少于 2 个参评
// 算法」的启动请求仍会被拦下。
export const STANDARD_EVAL_MAPS = ['random', 'default', 'breach', 'danger-close', 'dual-lanes'] as const;
export const SIMULTANEOUS_EVAL_MAPS = ['standoff', 'molten-throne', 'mistpine'] as const;

export const EVAL_MODES = [
  { id: 'standard', label: '标准模式', supported: true },
  { id: 'annihilation', label: '歼灭模式', supported: true },
  { id: 'simultaneous', label: '同时回合', supported: true },
  { id: 'royale', label: '大逃杀', supported: true },
] as const;

export interface EvalMapInfo {
  id: string;
  label: string;
  mode: string;
}

/** 同一模式内的展示顺序：虚拟随机图排在最前，其余既有顺序在前，未列出的新地图按 id 追加在后。 */
const MAP_DISPLAY_ORDER = [
  'random', 'random-annihilation', 'random-simultaneous', 'random-royale',
  'default', 'breach', 'danger-close', 'dual-lanes',
  'artillery-zone', 'trench-run',
  'standoff', 'molten-throne', 'mistpine',
  'snowflake', 'narrow-road',
  'multiplayer-ring', 'whirlpool',
];

/**
 * 虚拟随机图的显示名。与 `public/map-labels.js` 的内置标签保持一致——榜单/玩法统计
 * 直接按地图 id 显示中文名，两处文案不能分叉。
 */
const RANDOM_MAP_LABELS: Record<string, string> = {
  random: '随机图',
  'random-annihilation': '随机图（歼灭）',
  'random-simultaneous': '随机图（同时回合）',
  'random-royale': '随机图（大逃杀）',
};

/** 四种模式各自的虚拟随机图条目（id ↔ 模式的权威映射在 `RANDOM_MAP_MODES`）。 */
function virtualRandomMaps(): EvalMapInfo[] {
  return Object.entries(RANDOM_MAP_MODES).map(([mode, id]) => ({
    id,
    label: RANDOM_MAP_LABELS[id] ?? id,
    mode,
  }));
}

/**
 * 控制台展示用地图目录：直接读 maps/*.json，显示名取地图自身的 name、模式取
 * mode 字段（缺省 standard），另加四种模式的虚拟「随机图」。地图文件是唯一事实源——
 * 新增或下线地图时控制台自动跟随，不再靠手改清单（歼灭图 trench-run 就曾因此漏列）。
 */
export function readEvalMaps(mapsDir = join(PROJECT_ROOT, 'maps')): EvalMapInfo[] {
  const maps: EvalMapInfo[] = virtualRandomMaps();
  try {
    for (const file of readdirSync(mapsDir)) {
      if (!/\.json$/i.test(file)) continue;
      const id = file.replace(/\.json$/i, '');
      let config: Record<string, unknown> | null = null;
      try {
        config = JSON.parse(readFileSync(join(mapsDir, file), 'utf8')) as Record<string, unknown>;
      } catch {
        config = null;
      }
      const name = typeof config?.name === 'string' ? config.name.trim() : '';
      const mode = typeof config?.mode === 'string' && config.mode ? config.mode : 'standard';
      maps.push({ id, label: name || id, mode });
    }
  } catch {
    // 地图目录不可读时只剩四种虚拟随机图兜底；与 readMapModes 同向（少列，不误判）。
  }
  const modeRank = (mode: string) => {
    const index = EVAL_MODES.findIndex(item => item.id === mode);
    return index < 0 ? EVAL_MODES.length : index;
  };
  const orderRank = (id: string) => {
    const index = MAP_DISPLAY_ORDER.indexOf(id);
    return index < 0 ? MAP_DISPLAY_ORDER.length : index;
  };
  return maps.sort((a, b) =>
    modeRank(a.mode) - modeRank(b.mode)
    || orderRank(a.id) - orderRank(b.id)
    || a.id.localeCompare(b.id));
}

/** 控制台地图目录（四种模式各自成池），进程启动时按 maps/ 目录生成一次。 */
export const EVAL_MAPS = readEvalMaps();

// 可跑批的地图（四种模式全部接入，故即完整目录）；保留导出名兼容既有调用方。
export const KNOWN_MAPS = EVAL_MAPS.map(map => map.id);

/** 控制台的模式目录：每个模式只带自己的地图，供前端切换与地图/算法联动过滤。 */
export function buildEvalModeCatalog() {
  return EVAL_MODES.map(mode => ({
    ...mode,
    maps: EVAL_MAPS.filter(map => map.mode === mode.id),
    // supported 恒为 true；字段保留给前端"暂不支持"分支的未来扩展。
    reason: mode.supported ? null : '该模式暂不支持跑批',
  }));
}

/**
 * maps/*.json 的 mode 字段（缺省/损坏按 standard）加四种虚拟随机图（`RANDOM_MAP_MODES`），
 * 与 generateArenaLeaderboard.loadMapModes 同规则；「清空旧局」按模式过滤时用它把
 * 对局记录的 map 字段归到模式。目录不可读时只剩虚拟随机图兜底。
 */
export function readMapModes(mapsDir = join(PROJECT_ROOT, 'maps')): Map<string, string> {
  const modes = new Map<string, string>(
    Object.entries(RANDOM_MAP_MODES).map(([mode, id]) => [id, mode]));
  try {
    for (const file of readdirSync(mapsDir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const config = JSON.parse(readFileSync(join(mapsDir, file), 'utf8'));
        modes.set(file.replace(/\.json$/i, ''), typeof config?.mode === 'string' && config.mode ? config.mode : 'standard');
      } catch {
        modes.set(file.replace(/\.json$/i, ''), 'standard');
      }
    }
  } catch {
    // 地图目录不可读时仅虚拟随机图可用；模式过滤会匹配不到未知地图，属安全方向（少删）。
  }
  return modes;
}

/** 「清空旧局」的范围过滤：各维度取交集，留空 = 该维度不限制。 */
export interface ClearFilter {
  mode?: string | null;
  map?: string | null;
  /** 参与者 id（模型 zip 文件名或 algo_<name>@<version>），精确匹配任一座位。 */
  participant?: string | null;
}

/** 清空旧局任务日志里的范围描述（用原始 id，控制台另有带中文名的版本）。 */
function describeClearFilter(filter: ClearFilter): string {
  const parts: string[] = [];
  if (filter.mode) parts.push(`模式=${filter.mode}`);
  if (filter.map) parts.push(`地图=${filter.map}`);
  if (filter.participant) parts.push(`参与者=${filter.participant}`);
  return parts.length ? parts.join(' 且 ') : '全部对局';
}

export type EvalRunStatus = 'idle' | 'running' | 'finished' | 'failed' | 'stopped' | 'interrupted';

/**
 * 控制台的「维护任务」：跑批之外的写操作（重算榜单、清空旧局）也走同一条状态通道，
 * 前端用同一个进度条 + 日志区展示。跑批本身仍由 `EvalRunState` 表示（它有批次进度）。
 */
export type AuxTaskKind = 'regen' | 'clear';
export type AuxTaskStatus = 'running' | 'finished' | 'failed';
export interface AuxTaskState {
  kind: AuxTaskKind;
  /** 面向界面的任务名：重算榜单 / 清空旧局。 */
  label: string;
  status: AuxTaskStatus;
  /** 已完成步骤数与总步骤数（进度条的分子/分母，不是百分比）。 */
  step: number;
  steps: number;
  /** 当前步骤说明，直接显示在进度条下方。 */
  stepLabel: string;
  startedAt: string;
  finishedAt: string | null;
  /** 最近输出行（子脚本 stdout/stderr 原样），供控制台日志区滚动展示。 */
  outputTail: string[];
  /** 任务结果摘要：clear → { removed, total }；regen → { scripts }。 */
  detail: Record<string, unknown> | null;
  error: string | null;
}

const AUX_LABELS: Record<AuxTaskKind, string> = { regen: '重算榜单', clear: '清空旧局' };
const AUX_OUTPUT_LIMIT = 200;

/** 让出事件循环：清空旧局是同步文件操作，分步 yield 才能让状态接口报出中间进度。 */
const yieldTick = () => new Promise<void>(resolve => setImmediate(resolve));

export interface EvalRunParams {
  /** 本批对局模式（由地图池推断，同一批不允许混模式）；缺省按 standard 兼容旧调用。 */
  mode?: string;
  maps: string[];
  /**
   * 参评者过滤：null = 全部可对战模型 + 全部注册算法（round_robin 缺省行为）。
   * 列表项两种写法：`algo:<注册名>` 精确纳入算法；其余按模型文件名子串过滤。
   * 指定列表时未列出的算法不参与。
   */
  participants: string[] | null;
  games: number;
  jobs: number;
  salt: string | null;
  dryRun: boolean;
}

/** 把 participants 过滤列表翻译成 round_robin 的 --models / --algorithms 参数。 */
export function buildParticipantArgs(params: EvalRunParams): string[] {
  if (!params.participants) return [];
  const modelFilters: string[] = [];
  const algoNames: string[] = [];
  for (const item of params.participants) {
    if (item.startsWith('algo:')) algoNames.push(item.slice('algo:'.length));
    else modelFilters.push(item);
  }
  const args: string[] = [];
  if (modelFilters.length) {
    args.push('--models', modelFilters.join(','));
  } else if ((params.mode ?? 'standard') === 'standard') {
    // 标准模式下「不传 --models」的语义是「全部模型」：只勾算法时必须显式传 none，
    // 否则 19 个模型会被一起拉进跑批（whirlpool 这种只跑算法对算法的图尤其要避免）。
    args.push('--models', 'none');
  }
  args.push('--algorithms', algoNames.length ? algoNames.join(',') : 'none');
  return args;
}

interface EvalRunState {
  status: EvalRunStatus;
  params: EvalRunParams | null;
  pid: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  /** 启动时 matches.jsonl 已有局数，status 里用差值报"本次新增"。 */
  baselineGames: number;
  batchesDone: number;
  batchesTotal: number | null;
  plannedGames: number | null;
  outputTail: string[];
  notes: string[];
}

function freshState(): EvalRunState {
  return {
    status: 'idle', params: null, pid: null, startedAt: null, finishedAt: null,
    exitCode: null, baselineGames: 0, batchesDone: 0, batchesTotal: null,
    plannedGames: null, outputTail: [], notes: [],
  };
}

/** round_robin 计划行：`任务：12 个对战批次，待跑 48 局（已完成 0 局直接跳过）。` */
export function parsePlannedBatches(line: string): { total: number; games: number } | null {
  const match = line.match(/任务：(\d+) 个对战批次，待跑 (\d+) 局/);
  return match ? { total: Number(match[1]), games: Number(match[2]) } : null;
}

/** 每批完成行：`[3/12] OK a vs b @ map（2 局 / 1m30s，0.2 局/s 或 25s/局）| 剩余约 5m00s`
 * （OK 后实为两个空格，label 需 trim。round_robin 另透传 `  [label] 第 n/N 局完成（…）`
 * 形式的逐局进度行：只进 outputTail 供展示，不参与解析）。 */
export function parseProgressLine(line: string): { done: number; total: number; ok: boolean; label: string } | null {
  const match = line.match(/^\[(\d+)\/(\d+)\] (OK|FAIL) (.+)$/);
  if (!match) return null;
  return { done: Number(match[1]), total: Number(match[2]), ok: match[3] === 'OK', label: match[4].trim() };
}

/** 总结行：`完成批次 12/12，新增 24 局，失败 0 批，总用时 5m30s（0.1 局/s）。` */
export function parseSummaryLine(line: string): { done: number; total: number; games: number; failed: number } | null {
  const match = line.match(/完成批次 (\d+)\/(\d+)，新增 (\d+) 局，失败 (\d+) 批/);
  if (!match) return null;
  return { done: Number(match[1]), total: Number(match[2]), games: Number(match[3]), failed: Number(match[4]) };
}

/** 统计累积 JSONL 的非空行数；文件缺失或不可读按 0 处理。 */
export function countJsonlGames(file: string): number {
  try {
    let count = 0;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (line.trim()) count += 1;
    }
    return count;
  } catch {
    return 0;
  }
}

function resolvePythonPath(): string {
  if (process.env.RL_PYTHON) return process.env.RL_PYTHON;
  const venvPython = join(PROJECT_ROOT, 'rl', '.venv', 'Scripts', 'python.exe');
  if (existsSync(venvPython)) return venvPython;
  return 'python';
}

type Spawner = (cmd: string, args: string[], cwd: string) => ChildProcess | null;

export interface ArenaEvalDeps {
  /** 测试注入点：覆盖进程启动。 */
  spawner?: Spawner;
  statsFile?: string;
  stateFile?: string;
  roundRobinScript?: string;
  leaderboardScript?: string;
  statsScript?: string;
  pythonPath?: string;
  /** 评估链路是否随本进程携带；默认按 EVAL_TOOLCHAIN 是否齐备判定，测试可注入。 */
  evalToolchainAvailable?: boolean;
  now?: () => Date;
  /** SIGTERM 后升级 SIGKILL 的等待毫秒数；默认 10s，测试可调短。 */
  escalateMs?: number;
}

const defaultSpawner: Spawner = (cmd, args, cwd) => {
  if (process.env.VITEST) return null;
  return spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: false });
};

const OUTPUT_TAIL_LIMIT = 120;

/**
 * 并发任务数上限。每个任务是一个独立的 evaluate_cross.py（外加它自己 spawn 的 node 引擎
 * 与 torch 模型推理），不是线程；16 是产品层保护上限，实际可达并发受物理核数与内存约束
 * （round_robin.py 的 `--jobs` 本身不设上限，建议 ≤ 物理核数-2）。
 */
export const MAX_EVAL_JOBS = 16;

export class EvalRunner {
  private readonly spawner: Spawner;
  private readonly statsFile: string;
  private readonly stateFile: string;
  private readonly roundRobinScript: string;
  private readonly leaderboardScript: string;
  private readonly statsScript: string;
  private readonly pythonPath: string;
  private readonly now: () => Date;
  private readonly escalateMs: number;

  private state: EvalRunState = freshState();
  private child: ChildProcess | null = null;
  private stopping = false;
  private disposing = false;
  private gamesCache: { mtimeMs: number; size: number; count: number } | null = null;
  /** 维护任务（重算榜单 / 清空旧局）的最近一次状态；只留内存，重启后自然清空。 */
  private aux: AuxTaskState | null = null;
  /** 维护任务当前子进程（重算脚本），服务器关闭时一并终止。 */
  private auxChild: ChildProcess | null = null;
  /** 同一时刻只跑一个重算；重复点按钮的请求加入同一个 Promise，不重复 spawn。 */
  private regenPromise: Promise<{ ok: boolean; code: number | null; output: string[] }> | null = null;

  constructor(deps: ArenaEvalDeps = {}) {
    this.spawner = deps.spawner ?? defaultSpawner;
    this.statsFile = deps.statsFile ?? DEFAULT_STATS_FILE;
    this.stateFile = deps.stateFile ?? DEFAULT_STATE_FILE;
    this.roundRobinScript = deps.roundRobinScript ?? ROUND_ROBIN_SCRIPT;
    this.leaderboardScript = deps.leaderboardScript ?? LEADERBOARD_SCRIPT;
    this.statsScript = deps.statsScript ?? ARENA_STATS_SCRIPT;
    this.pythonPath = deps.pythonPath ?? resolvePythonPath();
    this.now = deps.now ?? (() => new Date());
    this.escalateMs = deps.escalateMs ?? 10_000;
  }

  /** 服务器重启后恢复磁盘状态：上次还在跑的标记为 interrupted，其余原样展示。 */
  restoreFromDisk(): void {
    try {
      const saved = JSON.parse(readFileSync(this.stateFile, 'utf8')) as EvalRunState;
      if (saved && typeof saved === 'object' && saved.status) {
        this.state = { ...freshState(), ...saved, outputTail: saved.outputTail ?? [], notes: saved.notes ?? [] };
        if (this.state.status === 'running') {
          this.state.status = 'interrupted';
          this.state.finishedAt = this.now().toISOString();
          this.pushNote('服务器重启，原跑批进程已脱离监控；同参数重跑可断点续跑（固定 --salt 才会跳过已有局数）。');
          this.persist();
        }
      }
    } catch {
      // 没有历史状态文件是常态，忽略。
    }
  }

  private pushNote(note: string): void {
    this.state.notes.push(note);
    if (this.state.notes.length > 10) this.state.notes.shift();
  }

  private pushOutput(line: string): void {
    this.state.outputTail.push(line);
    if (this.state.outputTail.length > OUTPUT_TAIL_LIMIT) this.state.outputTail.shift();
  }

  /** 维护任务是否有子进程在跑（路由用它拒绝并发写操作）。 */
  get isAuxRunning(): boolean {
    return this.aux?.status === 'running';
  }

  /** 维护任务快照：输出尾只回最近 40 行，避免状态响应随日志无限增长。 */
  auxTaskSnapshot(): AuxTaskState | null {
    return this.aux ? { ...this.aux, outputTail: this.aux.outputTail.slice(-40) } : null;
  }

  private beginAux(kind: AuxTaskKind, steps: number, stepLabel: string): AuxTaskState {
    this.aux = {
      kind,
      label: AUX_LABELS[kind],
      status: 'running',
      step: 0,
      steps,
      stepLabel,
      startedAt: this.now().toISOString(),
      finishedAt: null,
      outputTail: [],
      detail: null,
      error: null,
    };
    return this.aux;
  }

  private auxLog(line: string): void {
    if (!this.aux || !line) return;
    this.aux.outputTail.push(line);
    if (this.aux.outputTail.length > AUX_OUTPUT_LIMIT) this.aux.outputTail.shift();
  }

  private auxStep(step: number, stepLabel: string): void {
    if (!this.aux) return;
    this.aux.step = Math.max(0, Math.min(step, this.aux.steps));
    this.aux.stepLabel = stepLabel;
  }

  private finishAux(status: 'finished' | 'failed', detail: Record<string, unknown> | null, error: string | null = null): void {
    if (!this.aux) return;
    this.aux.status = status;
    this.aux.finishedAt = this.now().toISOString();
    this.aux.detail = detail;
    this.aux.error = error;
    if (status === 'finished') this.aux.step = this.aux.steps;
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.stateFile), { recursive: true });
      writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2));
    } catch {
      // 状态持久化失败不阻断跑批本身。
    }
  }

  /** 局数统计按 mtime+size 缓存：status 是公开接口、页面每 3s 轮询，不能每次全量读 JSONL。 */
  private countGames(): number {
    try {
      const stat = statSync(this.statsFile);
      const cached = this.gamesCache;
      if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.count;
      const count = countJsonlGames(this.statsFile);
      this.gamesCache = { mtimeMs: stat.mtimeMs, size: stat.size, count };
      return count;
    } catch {
      this.gamesCache = null;
      return 0;
    }
  }

  /**
   * 清空累积对局：按（模式 ∧ 地图 ∧ 参与者）命中的行直接删除，其余行原样保留
   * （matches.jsonl 在 git 里，已提交的历史对局仍可从 git 恢复）。round_robin 的
   * 补跑计划按「(地图, 参与者对) 已累积局数」算差额且与盐无关——旧局把目标局数
   * 占满后新批次会提示「无需补跑」，清空（全部或定向）即可让带决策计时的新对局
   * 重新累积。dryRun 只统计不动文件。
   */
  clearMatches(filter: ClearFilter = {}, dryRun = false): { removed: number; total: number } {
    if (this.isRunning) throw new Error('eval run already in progress');
    const { removed, staying, total } = this.partitionMatches(filter);
    if (dryRun || !removed.length) {
      return { removed: removed.length, total };
    }
    // 先写临时文件再原子改名，避免写一半时被读侧（status 局数统计/重算脚本）看到残缺。
    const tmpFile = `${this.statsFile}.tmp`;
    writeFileSync(tmpFile, staying.join('\n'), 'utf8');
    renameSync(tmpFile, this.statsFile);
    this.gamesCache = null;
    this.pushNote(`已删除 ${removed.length}/${total} 局旧对局；新跑批将从零累积（带决策计时）。`);
    this.persist();
    return { removed: removed.length, total };
  }

  /** 按（模式 ∧ 地图 ∧ 参与者）把 JSONL 行分成 [待删除, 保留] 两组；解析失败的行一律保留。 */
  private partitionMatches(filter: ClearFilter): { removed: string[]; staying: string[]; total: number } {
    const removed: string[] = [];
    const staying: string[] = [];
    let total = 0;
    if (!existsSync(this.statsFile)) return { removed, staying, total };
    const mapModes = filter.mode ? readMapModes() : null;
    for (const line of readFileSync(this.statsFile, 'utf8').split('\n')) {
      if (!line.trim()) { staying.push(line); continue; }
      let record: any;
      try {
        record = JSON.parse(line);
      } catch {
        staying.push(line);
        continue;
      }
      total += 1;
      const players = record?.players;
      const mapId = typeof record?.map === 'string' ? record.map : 'unknown';
      const hitMode = !filter.mode || mapModes!.get(mapId) === filter.mode;
      const hitMap = !filter.map || mapId === filter.map;
      const hitParticipant = !filter.participant || (
        players && typeof players === 'object'
        && (players.player_a === filter.participant || players.player_b === filter.participant));
      (hitMode && hitMap && hitParticipant ? removed : staying).push(line);
    }
    return { removed, staying, total };
  }

  get isRunning(): boolean {
    return this.state.status === 'running' && this.child !== null;
  }

  start(params: EvalRunParams): void {
    if (this.isRunning) throw new Error('eval run already in progress');
    const args = [
      this.roundRobinScript,
      '--mode', params.mode ?? 'standard',
      '--maps', params.maps.join(','),
      '--games', String(params.games),
      '--jobs', String(params.jobs),
    ];
    if (params.participants?.length) args.push(...buildParticipantArgs(params));
    if (params.salt) args.push('--salt', params.salt);
    if (params.dryRun) args.push('--dry-run');

    this.state = {
      ...freshState(),
      status: 'running',
      params,
      startedAt: this.now().toISOString(),
      baselineGames: this.countGames(),
      notes: this.state.notes,
    };
    this.stopping = false;
    this.pushOutput(`$ ${this.pythonPath} ${args.join(' ')}`);

    const child = this.spawner(this.pythonPath, args, PROJECT_ROOT);
    if (!child) {
      // 启动失败也要落盘收尾，否则状态停在 running，页面会一直显示"运行中"。
      this.pushNote(`无法启动 Python 进程（${this.pythonPath}），请确认 rl/.venv 已安装。`);
      this.finishRun('failed', null);
      throw new Error(`无法启动 Python 进程（${this.pythonPath}）；请确认 rl/.venv 已安装。`);
    }
    this.child = child;
    this.state.pid = child.pid ?? null;
    this.persist();

    createInterface({ input: child.stdout! }).on('line', line => this.onOutput(line));
    createInterface({ input: child.stderr! }).on('line', line => this.onOutput(`[stderr] ${line}`));
    child.on('error', err => {
      this.pushOutput(`[错误] ${err.message}`);
      this.finishRun('failed', null);
    });
    child.on('exit', (code, signal) => {
      this.pushOutput(signal ? `[进程退出] signal=${signal}` : `[进程退出] code=${code}`);
      const finalStatus: EvalRunStatus = this.disposing ? 'interrupted'
        : this.stopping ? 'stopped'
        : code === 0 ? 'finished' : 'failed';
      if (!this.disposing && !this.stopping) {
        this.pushNote(finalStatus === 'finished' ? '跑批正常结束。' : '跑批异常退出，详见输出；可原样重跑断点续跑。');
      }
      this.finishRun(finalStatus, code);
      if (this.disposing || this.stopping) return;
      if (!params.dryRun && (finalStatus === 'finished' || finalStatus === 'failed')) {
        // 重算有结果后再记 note，成功/失败文案才准确。
        void this.regenLeaderboard().then(result => {
          this.pushNote(result.ok ? '已自动重算榜单数据。' : '榜单重算失败，可在页面点「重算榜单」重试。');
          this.persist();
        });
      }
    });
  }

  private onOutput(line: string): void {
    if (!line.trim()) return;
    this.pushOutput(line);
    const planned = parsePlannedBatches(line);
    if (planned) {
      this.state.batchesTotal = planned.total;
      this.state.plannedGames = planned.games;
      this.persist();
      return;
    }
    const progress = parseProgressLine(line);
    if (progress) {
      this.state.batchesDone = progress.done;
      this.state.batchesTotal = progress.total;
      this.persist();
      return;
    }
    if (parseSummaryLine(line)) this.persist();
  }

  private finishRun(status: EvalRunStatus, exitCode: number | null): void {
    this.child = null;
    this.state.status = status;
    this.state.exitCode = exitCode;
    this.state.finishedAt = this.now().toISOString();
    this.persist();
  }

  /** 停止当前跑批：Windows 用 taskkill 杀整棵进程树（evaluate_cross + tsx worker 都是子进程）。 */
  stop(): boolean {
    if (!this.isRunning || !this.child) return false;
    this.stopping = true;
    // 定时器和回调异步触发时 this.child 可能已指向新一轮跑批，必须先捕获本次要停的进程。
    const child = this.child;
    if (process.platform === 'win32' && child.pid) {
      // round_robin 下面挂着 evaluate_cross 子进程与 npx tsx 引擎进程，必须整树终止。
      const taskkill = this.spawner('taskkill', ['/PID', String(child.pid), '/T', '/F'], PROJECT_ROOT);
      if (taskkill) {
        taskkill.on('error', () => child.kill());
      } else {
        child.kill();
      }
    } else {
      child.kill('SIGTERM');
      const escalate = setTimeout(() => child.kill('SIGKILL'), this.escalateMs);
      escalate.unref();
    }
    return true;
  }

  /**
   * 依次重算榜单与玩法统计数据（先榜单后统计：统计脚本会合并榜单评分）。
   * 同时只跑一份：重复调用返回同一个 Promise，不重复 spawn；进度与日志写进维护任务状态。
   */
  regenLeaderboard(): Promise<{ ok: boolean; code: number | null; output: string[] }> {
    if (this.regenPromise) return this.regenPromise;
    const promise = this.runRegenTask();
    this.regenPromise = promise;
    void promise.finally(() => { this.regenPromise = null; }).catch(() => { /* 只为清理引用，失败已落在任务状态里 */ });
    return promise;
  }

  private async runRegenTask(): Promise<{ ok: boolean; code: number | null; output: string[] }> {
    const output: string[] = [];
    this.beginAux('regen', 2, '生成榜单数据（generateArenaLeaderboard）');
    this.auxLog('$ npm run arena-leaderboard（script/generateArenaLeaderboard.mjs）');
    const scripts: Array<{ script: string; label: string }> = [
      { script: this.leaderboardScript, label: '榜单' },
      { script: this.statsScript, label: '玩法统计' },
    ];
    for (const [index, item] of scripts.entries()) {
      this.auxStep(index, `生成${item.label}数据（${basename(item.script)}）`);
      this.auxLog(`$ node ${item.script}`);
      const result = await this.runRegenScript(item.script, output, line => this.auxLog(line));
      if (!result.ok) {
        this.auxLog(`${item.label}脚本失败（退出码 ${result.code ?? '未知'}）`);
        this.finishAux('failed', { script: item.script }, `${item.label}脚本失败（退出码 ${result.code ?? '未知'}）`);
        return { ok: false, code: result.code, output: output.slice(-10) };
      }
      this.auxStep(index + 1, `${item.label}数据已生成`);
      this.auxLog(`${item.label}数据已生成`);
    }
    this.finishAux('finished', { scripts: scripts.length });
    return { ok: true, code: 0, output: output.slice(-10) };
  }

  private runRegenScript(
    script: string,
    output: string[],
    onLine?: (line: string) => void,
  ): Promise<{ ok: boolean; code: number | null }> {
    return new Promise(resolve => {
      const child = this.spawner(process.execPath, [script], PROJECT_ROOT);
      if (!child) {
        const message = '无法启动 node 进程重算数据';
        output.push(message);
        onLine?.(message);
        resolve({ ok: false, code: null });
        return;
      }
      this.auxChild = child;
      const done = (result: { ok: boolean; code: number | null }) => {
        if (this.auxChild === child) this.auxChild = null;
        resolve(result);
      };
      createInterface({ input: child.stdout! }).on('line', line => { output.push(line); onLine?.(line); });
      createInterface({ input: child.stderr! }).on('line', line => {
        const text = `[stderr] ${line}`;
        output.push(text);
        onLine?.(text);
      });
      const timeout = setTimeout(() => {
        child.kill();
        const text = '[超时] 数据重算超过 60s，已终止';
        output.push(text);
        onLine?.(text);
        done({ ok: false, code: null });
      }, 60_000);
      timeout.unref();
      child.on('error', err => {
        clearTimeout(timeout);
        const text = `[错误] ${err.message}`;
        output.push(text);
        onLine?.(text);
        done({ ok: false, code: null });
      });
      child.on('exit', code => {
        clearTimeout(timeout);
        done({ ok: code === 0, code });
      });
    });
  }

  /**
   * 清空旧局的后台任务版：分「扫描 → 重写 → 刷新」三步 yield，每次写进度与日志。
   * 文件操作本身是同步的（38k 行约几十毫秒），分步是为了让控制台能看到进度条与日志。
   * 失败只落到任务状态里，不向调用方抛错（请求早已返回）。
   */
  async clearMatchesTracked(filter: ClearFilter): Promise<{ removed: number; total: number }> {
    this.beginAux('clear', 3, '扫描 matches.jsonl');
    this.auxLog(`筛选范围：${describeClearFilter(filter)}`);
    try {
      await yieldTick();
      const { removed, staying, total } = this.partitionMatches(filter);
      this.auxStep(1, `扫描 ${total} 局，命中 ${removed.length} 局`);
      this.auxLog(`扫描 ${this.statsFile}：共 ${total} 局，命中 ${removed.length} 局`);
      await yieldTick();
      if (removed.length) {
        // 先写临时文件再原子改名，避免写一半时被读侧（状态局数统计/重算脚本）看到残缺。
        const tmpFile = `${this.statsFile}.tmp`;
        writeFileSync(tmpFile, staying.join('\n'), 'utf8');
        renameSync(tmpFile, this.statsFile);
        this.gamesCache = null;
        this.auxStep(2, `已重写 matches.jsonl，删除 ${removed.length} 局`);
        this.auxLog(`已删除 ${removed.length}/${total} 局，保留 ${total - removed.length} 局`);
        this.pushNote(`已删除 ${removed.length}/${total} 局旧对局；新跑批将从零累积（带决策计时）。`);
        this.persist();
      } else {
        this.auxStep(2, '没有命中的对局，文件未改动');
        this.auxLog('没有命中的对局，文件未改动');
      }
      await yieldTick();
      this.auxStep(3, '完成');
      this.finishAux('finished', { removed: removed.length, total });
      return { removed: removed.length, total };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.auxLog(`[错误] ${message}`);
      this.finishAux('failed', null, `清空旧局失败：${message}`);
      throw err;
    }
  }

  statusSnapshot(): Record<string, unknown> {
    const gamesTotal = this.countGames();
    return {
      status: this.state.status,
      params: this.state.params,
      pid: this.state.pid,
      startedAt: this.state.startedAt,
      finishedAt: this.state.finishedAt,
      exitCode: this.state.exitCode,
      batchesDone: this.state.batchesDone,
      batchesTotal: this.state.batchesTotal,
      plannedGames: this.state.plannedGames,
      baselineGames: this.state.baselineGames,
      gamesTotal,
      gamesNew: this.state.params ? Math.max(0, gamesTotal - this.state.baselineGames) : 0,
      outputTail: this.state.outputTail.slice(-30),
      auxTask: this.auxTaskSnapshot(),
      notes: this.state.notes,
      knownMaps: KNOWN_MAPS,
      modeCatalog: buildEvalModeCatalog(),
      defaults: { games: 24, jobs: 1, maps: ['random'] },
      statsFile: this.statsFile,
      python: this.pythonPath,
    };
  }

  /** 服务器关闭时：登记中断并终止进程树，避免留下无人管理的跑批。 */
  dispose(): void {
    // 维护任务（榜单/统计脚本）是短命进程，但关闭时也不该留孤儿。
    if (this.auxChild) {
      try { this.auxChild.kill(); } catch { /* 进程可能已退出 */ }
      this.auxChild = null;
    }
    if (!this.isRunning) return;
    this.disposing = true;
    // 必须先杀进程再改状态：stop() 以 status==='running' 为前提。
    this.stop();
    this.state.status = 'interrupted';
    this.pushNote('服务器关闭，跑批已终止；同参数重跑可断点续跑。');
    this.persist();
  }
}

export async function arenaEvalRoutes(app: FastifyInstance, deps: ArenaEvalDeps = {}): Promise<void> {
  const runner = new EvalRunner(deps);
  const toolchainAvailable = deps.evalToolchainAvailable ?? EVAL_TOOLCHAIN.every(p => existsSync(p));
  const evalUnavailable = {
    error: '本部署未携带评估跑批链路（round_robin.py 与榜单/统计脚本），评估控制台仅在本地仓库可用',
    code: 'arena_eval_unavailable',
  } as const;
  runner.restoreFromDisk();
  app.addHook('onClose', async () => runner.dispose());

  // 参评者清单（模型 + 内置算法）：评估控制台按模式过滤的完整数据源，与
  // /api/rl/models、/api/algorithms 同源。这里不按标准模式预过滤，让前端能按
  // 当前模式展示对应的算法；真正启动时仍由 start 接口做模式兼容校验。
  app.get('/api/arena/participants', async () => ({
    // 现有 RL 训练环境只覆盖标准模式；模型支持模式写在响应里，前端按模式过滤。
    models: refreshRlModels().map(model => ({ ...model, modes: ['standard'] })),
    algorithms: Object.entries(ALGORITHM_BOTS).map(([id, config]) => ({
      id,
      name: config.name,
      algorithm: config.algorithm,
      description: config.description,
      modes: config.modes,
    })),
  }));

  // 状态快照含完整命令行、本地文件路径与输出尾，与写接口同样受控，
  // 不给未鉴权访问留下只读窥探口。
  app.get('/api/arena/eval/status', async (req, reply) => {
    if (!authorizeControlRequest(req, reply)) return;
    return runner.statusSnapshot();
  });

  app.post<{ Body: Partial<EvalRunParams> }>('/api/arena/eval/start', async (req, reply) => {
    if (!authorizeControlRequest(req, reply)) return;
    if (!toolchainAvailable) return reply.code(501).send(evalUnavailable);
    if (runner.isRunning) {
      return reply.code(409).send({ error: '已有跑批在进行中', code: 'eval_already_running' });
    }
    const body = req.body ?? {};
    const maps = Array.isArray(body.maps) ? body.maps.map(m => String(m).trim()).filter(Boolean) : [];
    const mapInfos = maps.map(id => EVAL_MAPS.find(map => map.id === id));
    if (!maps.length || mapInfos.some(info => !info)) {
      return reply.code(400).send({
        error: `maps 必须是已知地图的非空子集（${EVAL_MAPS.map(map => map.id).join(', ')}）`,
        code: 'invalid_maps',
      });
    }
    const selectedModes = new Set(mapInfos.map(info => info!.mode));
    if (selectedModes.size > 1) {
      return reply.code(400).send({
        error: '同一批只能跑同一模式的地图，不能混合：'
          + mapInfos.map(info => `「${info!.label}」`).join('、'),
        code: 'mixed_modes',
      });
    }
    const mode = [...selectedModes][0]!;
    const modeInfo = EVAL_MODES.find(item => item.id === mode);
    if (!modeInfo?.supported) {
      // 当前四种模式均已接入；保留分支给未来新增但未接跑批的模式。
      return reply.code(400).send({
        error: (modeInfo?.label ?? mode) + '尚不支持评估跑批。',
        code: 'mode_not_supported',
      });
    }
    const games = body.games ?? 24;
    if (!Number.isInteger(games) || games < 2 || games > 500) {
      return reply.code(400).send({ error: 'games 必须是 2-500 的整数', code: 'invalid_games' });
    }
    const jobs = body.jobs ?? 1;
    if (!Number.isInteger(jobs) || jobs < 1 || jobs > MAX_EVAL_JOBS) {
      return reply.code(400).send({ error: `jobs 必须是 1-${MAX_EVAL_JOBS} 的整数`, code: 'invalid_jobs' });
    }
    let participants: string[] | null = null;
    if (Array.isArray(body.participants) && body.participants.length) {
      participants = body.participants.map(m => String(m).trim()).filter(Boolean);
      if (participants.length > 32 || participants.some(m => m.length > 200)) {
        return reply.code(400).send({ error: 'participants 过滤项过多或过长', code: 'invalid_participants' });
      }
      const unknownAlgo = participants
        .filter(m => m.startsWith('algo:'))
        .filter(m => !(algorithmParticipantId(m.slice('algo:'.length)) in ALGORITHM_BOTS));
      if (unknownAlgo.length) {
        return reply.code(400).send({
          error: `未注册的算法参与者：${unknownAlgo.join(', ')}`,
          code: 'invalid_participants',
        });
      }
      const modelFilters = participants.filter(m => !m.startsWith('algo:'));
      if (mode !== 'standard' && modelFilters.length) {
        return reply.code(400).send({
          error: 'RL 模型目前仅支持标准模式，不能参评「' + modeInfo.label + '」：'
            + modelFilters.join(', ') + '；请只选择该模式声明的内置算法。',
          code: 'mode_not_supported',
        });
      }
      const unsupportedAlgo = participants
        .filter(m => m.startsWith('algo:'))
        .filter(m => {
          const config = ALGORITHM_BOTS[algorithmParticipantId(m.slice('algo:'.length))];
          return config && !config.modes.includes(mode);
        });
      if (unsupportedAlgo.length) {
        return reply.code(400).send({
          error: unsupportedAlgo.join(', ') + ` 不支持${modeInfo.label}；请只选择注册表声明该模式的算法。`,
          code: 'mode_not_supported',
        });
      }
    }
    // 非标准模式没有 RL 模型可参评，至少需要两个该模式算法才能组成对阵批次；
    // 歼灭（random-annihilation + shrinkroll + vortex）3 个、大逃杀（random-royale + apex）2 个。
    if (mode !== 'standard') {
      const modeAlgoCount = Object.values(ALGORITHM_BOTS)
        .filter(config => config.modes.includes(mode)).length;
      const selectedAlgoCount = participants
        ? participants.filter(m => m.startsWith('algo:')).length
        : modeAlgoCount;
      if (selectedAlgoCount < 2) {
        return reply.code(400).send({
          error: `${modeInfo.label}至少需要选择 2 个参评算法（该模式暂无 RL 模型；当前该模式注册算法 ${modeAlgoCount} 个）。`,
          code: 'invalid_participants',
        });
      }
    }
    const salt = body.salt ? String(body.salt).slice(0, 64) : null;
    const params: EvalRunParams = { mode, maps, participants, games, jobs, salt, dryRun: Boolean(body.dryRun) };
    try {
      runner.start(params);
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message, code: 'eval_start_failed' });
    }
    return { ok: true, status: runner.statusSnapshot() };
  });

  app.post('/api/arena/eval/stop', async (req, reply) => {
    if (!authorizeControlRequest(req, reply)) return;
    if (!runner.stop()) {
      return reply.code(409).send({ error: '当前没有进行中的跑批', code: 'eval_not_running' });
    }
    return { ok: true };
  });

  // 清空旧局（直接删除命中行，matches.jsonl 已提交历史可在 git 找回；dryRun 只预览
  // 数量）：跑批中拒绝，避免重写 matches.jsonl 与 evaluate_cross 的追加写竞争。
  // 真删改走后台维护任务：先返回任务快照，进度与日志由 /status 轮询驱动（dryRun 仍同步返数）。
  app.post('/api/arena/eval/clear-matches', async (req, reply) => {
    if (!authorizeControlRequest(req, reply)) return;
    if (!toolchainAvailable) return reply.code(501).send(evalUnavailable);
    if (runner.isRunning) {
      return reply.code(409).send({ error: '跑批进行中，请先停止再清空旧局', code: 'eval_already_running' });
    }
    const body = (req.body ?? {}) as Partial<ClearFilter> & { dryRun?: boolean };
    const filter: ClearFilter = {
      mode: body.mode ? String(body.mode) : null,
      map: body.map ? String(body.map) : null,
      participant: body.participant ? String(body.participant).slice(0, 200) : null,
    };
    const mapModes = readMapModes();
    if (filter.mode && ![...mapModes.values()].includes(filter.mode)) {
      return reply.code(400).send({ error: `未知模式：${filter.mode}`, code: 'invalid_filter' });
    }
    if (filter.map && !mapModes.has(filter.map)) {
      return reply.code(400).send({ error: `未知地图：${filter.map}`, code: 'invalid_filter' });
    }
    if (filter.mode && filter.map && mapModes.get(filter.map!) !== filter.mode) {
      return reply.code(400).send({ error: `地图 ${filter.map} 不属于模式 ${filter.mode}`, code: 'invalid_filter' });
    }
    if (body.dryRun) {
      try {
        return { ok: true, ...runner.clearMatches(filter, true), dryRun: true };
      } catch (err) {
        return reply.code(500).send({ error: `清空旧局失败：${(err as Error).message}`, code: 'clear_failed' });
      }
    }
    if (runner.isAuxRunning) {
      return reply.code(409).send({
        error: '已有维护任务在进行中（重算榜单或清空旧局），请等它结束',
        code: 'aux_task_running',
        auxTask: runner.auxTaskSnapshot(),
      });
    }
    void runner.clearMatchesTracked(filter).catch(() => {
      // 失败已写进维护任务状态（用于控制台日志），这里只吞掉 Promise 拒绝。
    });
    return { ok: true, auxTask: runner.auxTaskSnapshot() };
  });

  // 重算榜单同样是后台维护任务：立即返回任务快照，前端轮询 /status 看进度与日志；
  // 结束后由前端刷新排行榜数据。重复点击不会重复 spawn（EvalRunner 内部合并 Promise）。
  app.post('/api/arena/leaderboard/regenerate', async (req, reply) => {
    if (!authorizeControlRequest(req, reply)) return;
    if (!toolchainAvailable) return reply.code(501).send(evalUnavailable);
    if (runner.isAuxRunning) {
      return reply.code(409).send({
        error: '已有维护任务在进行中（重算榜单或清空旧局），请等它结束',
        code: 'aux_task_running',
        auxTask: runner.auxTaskSnapshot(),
      });
    }
    void runner.regenLeaderboard().catch(() => {
      // runRegenTask 内部已把失败写进维护任务状态，这里只避免未处理的 Promise 拒绝。
    });
    return { ok: true, auxTask: runner.auxTaskSnapshot() };
  });
}
