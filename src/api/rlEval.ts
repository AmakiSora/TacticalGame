// src/api/rlEval.ts
//
// RL 评估控制台后端：让排行榜页面可以直接网页启动/监控/停止
// rl/evaluation/round_robin.py 跑批，结束后自动重算榜单数据。
// 跑批依赖 rl/.venv 的 Python 与本地 rl/models 模型，属于本地开发功能；
// Docker 容器内没有 Python 虚拟环境，启动接口会报错而不是留下坏进程。
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { authorizeControlRequest } from './controlAuth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');
const ROUND_ROBIN_SCRIPT = join(PROJECT_ROOT, 'rl', 'evaluation', 'round_robin.py');
const LEADERBOARD_SCRIPT = join(PROJECT_ROOT, 'script', 'generateRlLeaderboard.mjs');
const DEFAULT_STATS_FILE = join(PROJECT_ROOT, 'rl', 'leaderboard', 'matches.jsonl');
const DEFAULT_STATE_FILE = join(PROJECT_ROOT, 'runtime', 'rl-eval-state.json');

// 与 rl/evaluation/round_robin.py 的 DEFAULT_MAPS 保持一致。
export const KNOWN_MAPS = ['random', 'default', 'breach', 'danger-close', 'desert', 'dual-lanes', 'forge'] as const;

export type EvalRunStatus = 'idle' | 'running' | 'finished' | 'failed' | 'stopped' | 'interrupted';

export interface EvalRunParams {
  maps: string[];
  /** round_robin --models 的文件名子串过滤；null 表示全部可对战模型。 */
  models: string[] | null;
  games: number;
  jobs: number;
  salt: string | null;
  dryRun: boolean;
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

/** 每批完成行：`[3/12] OK a vs b @ map（2 局 / 10s，0.2 局/s）| 剩余约 1m30s`（OK 后实为两个空格，label 需 trim） */
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

export interface RlEvalDeps {
  /** 测试注入点：覆盖进程启动。 */
  spawner?: Spawner;
  statsFile?: string;
  stateFile?: string;
  roundRobinScript?: string;
  leaderboardScript?: string;
  pythonPath?: string;
  now?: () => Date;
  /** SIGTERM 后升级 SIGKILL 的等待毫秒数；默认 10s，测试可调短。 */
  escalateMs?: number;
}

const defaultSpawner: Spawner = (cmd, args, cwd) => {
  if (process.env.VITEST) return null;
  return spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: false });
};

const OUTPUT_TAIL_LIMIT = 120;

export class EvalRunner {
  private readonly spawner: Spawner;
  private readonly statsFile: string;
  private readonly stateFile: string;
  private readonly roundRobinScript: string;
  private readonly leaderboardScript: string;
  private readonly pythonPath: string;
  private readonly now: () => Date;
  private readonly escalateMs: number;

  private state: EvalRunState = freshState();
  private child: ChildProcess | null = null;
  private stopping = false;
  private disposing = false;
  private gamesCache: { mtimeMs: number; size: number; count: number } | null = null;

  constructor(deps: RlEvalDeps = {}) {
    this.spawner = deps.spawner ?? defaultSpawner;
    this.statsFile = deps.statsFile ?? DEFAULT_STATS_FILE;
    this.stateFile = deps.stateFile ?? DEFAULT_STATE_FILE;
    this.roundRobinScript = deps.roundRobinScript ?? ROUND_ROBIN_SCRIPT;
    this.leaderboardScript = deps.leaderboardScript ?? LEADERBOARD_SCRIPT;
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

  get isRunning(): boolean {
    return this.state.status === 'running' && this.child !== null;
  }

  start(params: EvalRunParams): void {
    if (this.isRunning) throw new Error('eval run already in progress');
    const args = [
      this.roundRobinScript,
      '--maps', params.maps.join(','),
      '--games', String(params.games),
      '--jobs', String(params.jobs),
    ];
    if (params.models?.length) args.push('--models', params.models.join(','));
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

  /** 重算榜单数据；返回退出码与输出尾，供前端提示成功/失败。 */
  regenLeaderboard(): Promise<{ ok: boolean; code: number | null; output: string[] }> {
    return new Promise(resolve => {
      const child = this.spawner(process.execPath, [this.leaderboardScript], PROJECT_ROOT);
      if (!child) {
        resolve({ ok: false, code: null, output: ['无法启动 node 进程重算榜单'] });
        return;
      }
      const output: string[] = [];
      createInterface({ input: child.stdout! }).on('line', line => output.push(line));
      createInterface({ input: child.stderr! }).on('line', line => output.push(`[stderr] ${line}`));
      const timeout = setTimeout(() => {
        child.kill();
        resolve({ ok: false, code: null, output: [...output.slice(-10), '[超时] 榜单重算超过 60s，已终止'] });
      }, 60_000);
      timeout.unref();
      child.on('error', err => {
        clearTimeout(timeout);
        resolve({ ok: false, code: null, output: [`[错误] ${err.message}`] });
      });
      child.on('exit', code => {
        clearTimeout(timeout);
        resolve({ ok: code === 0, code, output: output.slice(-10) });
      });
    });
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
      notes: this.state.notes,
      knownMaps: KNOWN_MAPS,
      defaults: { games: 24, jobs: 1, maps: ['random'] },
      statsFile: this.statsFile,
      python: this.pythonPath,
    };
  }

  /** 服务器关闭时：登记中断并终止进程树，避免留下无人管理的跑批。 */
  dispose(): void {
    if (!this.isRunning) return;
    this.disposing = true;
    // 必须先杀进程再改状态：stop() 以 status==='running' 为前提。
    this.stop();
    this.state.status = 'interrupted';
    this.pushNote('服务器关闭，跑批已终止；同参数重跑可断点续跑。');
    this.persist();
  }
}

export async function rlEvalRoutes(app: FastifyInstance, deps: RlEvalDeps = {}): Promise<void> {
  const runner = new EvalRunner(deps);
  runner.restoreFromDisk();
  app.addHook('onClose', async () => runner.dispose());

  // 状态快照含完整命令行、本地文件路径与输出尾，与写接口同样受控，
  // 不给未鉴权访问留下只读窥探口。
  app.get('/api/rl/eval/status', async (req, reply) => {
    if (!authorizeControlRequest(req, reply)) return;
    return runner.statusSnapshot();
  });

  app.post<{ Body: Partial<EvalRunParams> }>('/api/rl/eval/start', async (req, reply) => {
    if (!authorizeControlRequest(req, reply)) return;
    if (runner.isRunning) {
      return reply.code(409).send({ error: '已有跑批在进行中', code: 'eval_already_running' });
    }
    const body = req.body ?? {};
    const maps = Array.isArray(body.maps) ? body.maps.map(m => String(m).trim()).filter(Boolean) : [];
    if (!maps.length || maps.some(m => !(KNOWN_MAPS as readonly string[]).includes(m))) {
      return reply.code(400).send({
        error: `maps 必须是已知地图的非空子集（${KNOWN_MAPS.join(', ')}）`,
        code: 'invalid_maps',
      });
    }
    const games = body.games ?? 24;
    if (!Number.isInteger(games) || games < 2 || games > 500) {
      return reply.code(400).send({ error: 'games 必须是 2-500 的整数', code: 'invalid_games' });
    }
    const jobs = body.jobs ?? 1;
    if (!Number.isInteger(jobs) || jobs < 1 || jobs > 8) {
      return reply.code(400).send({ error: 'jobs 必须是 1-8 的整数', code: 'invalid_jobs' });
    }
    let models: string[] | null = null;
    if (Array.isArray(body.models) && body.models.length) {
      models = body.models.map(m => String(m).trim()).filter(Boolean);
      if (models.length > 32 || models.some(m => m.length > 200)) {
        return reply.code(400).send({ error: 'models 过滤项过多或过长', code: 'invalid_models' });
      }
    }
    const salt = body.salt ? String(body.salt).slice(0, 64) : null;
    const params: EvalRunParams = { maps, models, games, jobs, salt, dryRun: Boolean(body.dryRun) };
    try {
      runner.start(params);
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message, code: 'eval_start_failed' });
    }
    return { ok: true, status: runner.statusSnapshot() };
  });

  app.post('/api/rl/eval/stop', async (req, reply) => {
    if (!authorizeControlRequest(req, reply)) return;
    if (!runner.stop()) {
      return reply.code(409).send({ error: '当前没有进行中的跑批', code: 'eval_not_running' });
    }
    return { ok: true };
  });

  app.post('/api/rl/leaderboard/regenerate', async (req, reply) => {
    if (!authorizeControlRequest(req, reply)) return;
    const result = await runner.regenLeaderboard();
    if (!result.ok) {
      return reply.code(500).send({ error: '榜单重算失败', code: 'regenerate_failed', detail: result });
    }
    return { ok: true, output: result.output };
  });
}
