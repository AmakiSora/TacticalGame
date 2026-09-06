// tests/api/rl-eval.test.ts
// 评估控制台 API：启动/监控/停止 round_robin 跑批与榜单重算。
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  parsePlannedBatches, parseProgressLine, parseSummaryLine, rlEvalRoutes,
} from '../../src/api/rlEval.js';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface FakeChild extends EventEmitter {
  stdout: PassThrough;
  stderr: PassThrough;
  pid: number;
  kill: () => boolean;
}

function makeFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.pid = 4242;
  child.kill = () => true;
  return child;
}

function fakeSpawner() {
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const children: FakeChild[] = [];
  const spawner = (cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    const child = makeFakeChild();
    children.push(child);
    return child;
  };
  return { spawner, calls, children };
}

describe('RL eval console API', () => {
  let app: FastifyInstance;
  let dir: string;
  let statsFile: string;
  let stateFile: string;
  let spawner: ReturnType<typeof fakeSpawner>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'rl-eval-'));
    statsFile = join(dir, 'matches.jsonl');
    stateFile = join(dir, 'state.json');
    spawner = fakeSpawner();
    app = Fastify();
    await app.register(rlEvalRoutes, {
      spawner: spawner.spawner,
      statsFile,
      stateFile,
      roundRobinScript: 'round_robin.py',
      leaderboardScript: 'gen.mjs',
      pythonPath: 'python-test',
    });
    writeFileSync(statsFile, '{"map":"random"}\n{"map":"random"}\n');
  });

  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports idle status with known maps and defaults', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/rl/eval/status' });
    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(data.status).toBe('idle');
    expect(data.knownMaps).toContain('random');
    expect(data.defaults.games).toBe(24);
    expect(data.gamesTotal).toBe(2);
  });

  it('rejects invalid maps, games and jobs on start', async () => {
    const badMap = await app.inject({ method: 'POST', url: '/api/rl/eval/start', payload: { maps: ['nope'] } });
    expect(badMap.statusCode).toBe(400);
    expect(badMap.json().code).toBe('invalid_maps');

    const badGames = await app.inject({ method: 'POST', url: '/api/rl/eval/start', payload: { maps: ['random'], games: 1 } });
    expect(badGames.statusCode).toBe(400);
    expect(badGames.json().code).toBe('invalid_games');

    const badJobs = await app.inject({ method: 'POST', url: '/api/rl/eval/start', payload: { maps: ['random'], jobs: 99 } });
    expect(badJobs.statusCode).toBe(400);
    expect(badJobs.json().code).toBe('invalid_jobs');
  });

  it('starts a run, tracks progress and auto-regenerates the leaderboard on finish', async () => {
    const start = await app.inject({ method: 'POST', url: '/api/rl/eval/start', payload: { maps: ['random'], games: 4 } });
    expect(start.statusCode).toBe(200);
    expect(start.json().status.status).toBe('running');

    const spawnCall = spawner.calls[0];
    expect(spawnCall.cmd).toBe('python-test');
    expect(spawnCall.args.join(' ')).toContain('round_robin.py');
    expect(spawnCall.args.join(' ')).toContain('--maps random');

    const child = spawner.children[0];
    child.stdout.write('任务：2 个对战批次，待跑 4 局\n');
    child.stdout.write('[1/2] OK  a.zip vs b.zip @ random（2 局 / 10s）| 剩余约 20s\n');
    await delay(20);

    const mid = (await app.inject({ method: 'GET', url: '/api/rl/eval/status' })).json();
    expect(mid.batchesTotal).toBe(2);
    expect(mid.batchesDone).toBe(1);
    expect(mid.outputTail.some((line: string) => line.includes('[1/2]'))).toBe(true);

    child.stdout.end();
    child.emit('exit', 0, null);
    await delay(20);

    const done = (await app.inject({ method: 'GET', url: '/api/rl/eval/status' })).json();
    expect(done.status).toBe('finished');
    expect(done.exitCode).toBe(0);
    // 正常结束后应自动重算榜单（node script/generateRlLeaderboard.mjs）。
    expect(spawner.calls.some(call => call.cmd === process.execPath && call.args.includes('gen.mjs'))).toBe(true);
  });

  it('rejects concurrent starts', async () => {
    await app.inject({ method: 'POST', url: '/api/rl/eval/start', payload: { maps: ['random'] } });
    const second = await app.inject({ method: 'POST', url: '/api/rl/eval/start', payload: { maps: ['random'] } });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('eval_already_running');
  });

  it('stops a running evaluation and reports stopped', async () => {
    await app.inject({ method: 'POST', url: '/api/rl/eval/start', payload: { maps: ['random'] } });
    const stop = await app.inject({ method: 'POST', url: '/api/rl/eval/stop' });
    expect(stop.statusCode).toBe(200);
    spawner.children[0].emit('exit', 1, 'SIGTERM');
    await delay(20);
    const status = (await app.inject({ method: 'GET', url: '/api/rl/eval/status' })).json();
    expect(status.status).toBe('stopped');
    expect(status.exitCode).toBe(1);

    const again = await app.inject({ method: 'POST', url: '/api/rl/eval/stop' });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('eval_not_running');
  });

  it('aims the SIGKILL escalation at the stopped child, not a later run', async () => {
    // SIGKILL 升级在非 Windows 分支，临时改写 platform 并把升级等待调短到 5ms。
    const prevPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const app2 = Fastify();
    await app2.register(rlEvalRoutes, { spawner: spawner.spawner, statsFile, stateFile, escalateMs: 5 });
    try {
      await app2.inject({ method: 'POST', url: '/api/rl/eval/start', payload: { maps: ['random'] } });
      const firstKills: Array<string | undefined> = [];
      const first = spawner.children[0];
      first.kill = (sig?: string) => { firstKills.push(sig); return true; };

      await app2.inject({ method: 'POST', url: '/api/rl/eval/stop' });
      expect(firstKills).toContain('SIGTERM');

      // 老进程退出后立刻开新一轮：升级定时器只能落到老进程上，不能误杀新跑批。
      first.emit('exit', 0, null);
      await app2.inject({ method: 'POST', url: '/api/rl/eval/start', payload: { maps: ['random'] } });
      const secondKills: Array<string | undefined> = [];
      spawner.children[1].kill = (sig?: string) => { secondKills.push(sig); return true; };

      await delay(30);
      expect(firstKills).toContain('SIGKILL');
      expect(secondKills).toEqual([]);
    } finally {
      await app2.close();
      Object.defineProperty(process, 'platform', { value: prevPlatform });
    }
  });

  it('marks a persisted running state as interrupted after restart', async () => {
    writeFileSync(stateFile, JSON.stringify({
      status: 'running',
      params: { maps: ['random'], models: null, games: 24, jobs: 1, salt: null, dryRun: false },
      pid: 1, startedAt: '2026-09-06T00:00:00.000Z', finishedAt: null, exitCode: null,
      baselineGames: 0, batchesDone: 0, batchesTotal: null, plannedGames: null,
      outputTail: [], notes: [],
    }));
    const app2 = Fastify();
    await app2.register(rlEvalRoutes, { spawner: spawner.spawner, statsFile, stateFile });
    const res = (await app2.inject({ method: 'GET', url: '/api/rl/eval/status' })).json();
    expect(res.status).toBe('interrupted');
    expect(res.notes.join()).toContain('服务器重启');
    await app2.close();
  });

  it('requires the control token when AUTO_CONTROL_TOKEN is configured', async () => {
    const prev = process.env.AUTO_CONTROL_TOKEN;
    process.env.AUTO_CONTROL_TOKEN = 'secret';
    try {
      const denied = await app.inject({ method: 'POST', url: '/api/rl/eval/start', payload: { maps: ['random'] } });
      expect(denied.statusCode).toBe(401);
      // 状态快照含命令行与本地路径，读接口同样受控。
      const statusDenied = await app.inject({ method: 'GET', url: '/api/rl/eval/status' });
      expect(statusDenied.statusCode).toBe(401);
      const allowed = await app.inject({
        method: 'POST', url: '/api/rl/eval/start', payload: { maps: ['random'] },
        headers: { 'x-control-token': 'secret' },
      });
      expect(allowed.statusCode).toBe(200);
      const statusAllowed = await app.inject({
        method: 'GET', url: '/api/rl/eval/status', headers: { 'x-control-token': 'secret' },
      });
      expect(statusAllowed.statusCode).toBe(200);
      // 上一步 start 已让跑批进入 running，读到真实状态才证明不是空的 200。
      expect(statusAllowed.json().status).toBe('running');
    } finally {
      if (prev === undefined) delete process.env.AUTO_CONTROL_TOKEN;
      else process.env.AUTO_CONTROL_TOKEN = prev;
    }
  });

  it('regenerates leaderboard data on demand', async () => {
    const pending = app.inject({ method: 'POST', url: '/api/rl/leaderboard/regenerate' });
    await delay(10);
    spawner.children[0].emit('exit', 0, null);
    const res = await pending;
    expect(res.statusCode).toBe(200);
    expect(spawner.calls[0].args.join(' ')).toContain('gen.mjs');
  });

  it('parses round_robin output lines in their real format', () => {
    expect(parsePlannedBatches('任务：12 个对战批次，待跑 48 局（已完成 24 局直接跳过）。'))
      .toEqual({ total: 12, games: 48 });
    const ok = parseProgressLine('[3/12] OK  a.zip vs b.zip @ default（2 局 / 10s，0.2 局/s）| 剩余约 1m30s');
    expect(ok).toMatchObject({ done: 3, total: 12, ok: true });
    expect(ok?.label).toBe('a.zip vs b.zip @ default（2 局 / 10s，0.2 局/s）| 剩余约 1m30s');
    expect(parseProgressLine('[4/12] FAIL a.zip vs c.zip @ forge（1 局 / 9s，0.1 局/s）')).toMatchObject({ ok: false });
    expect(parseSummaryLine('完成批次 12/12，新增 24 局，失败 0 批，总用时 5m30s（0.1 局/s）。'))
      .toEqual({ done: 12, total: 12, games: 24, failed: 0 });
  });

  it('recounts games when the stats file changes', async () => {
    const before = (await app.inject({ method: 'GET', url: '/api/rl/eval/status' })).json();
    expect(before.gamesTotal).toBe(2);
    writeFileSync(statsFile, '{"map":"random"}\n{"map":"random"}\n{"map":"random"}\n');
    const after = (await app.inject({ method: 'GET', url: '/api/rl/eval/status' })).json();
    expect(after.gamesTotal).toBe(3);
  });

  it('resets to failed state instead of a ghost running state when the process cannot start', async () => {
    const app2 = Fastify();
    await app2.register(rlEvalRoutes, { spawner: () => null, statsFile, stateFile });
    const res = await app2.inject({ method: 'POST', url: '/api/rl/eval/start', payload: { maps: ['random'] } });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toContain('无法启动');
    const status = (await app2.inject({ method: 'GET', url: '/api/rl/eval/status' })).json();
    expect(status.status).toBe('failed');
    expect(status.notes.join()).toContain('无法启动');
    await app2.close();
  });

  it('kills the run process tree and marks interrupted when the server closes', async () => {
    const app2 = Fastify();
    await app2.register(rlEvalRoutes, { spawner: spawner.spawner, statsFile, stateFile });
    await app2.inject({ method: 'POST', url: '/api/rl/eval/start', payload: { maps: ['random'] } });
    const child = spawner.children[0];
    let killed = false;
    child.kill = () => { killed = true; return true; };
    await app2.close();
    // Windows 走 taskkill 整树终止，其余平台直接 kill；两者必须有一个真的发生。
    expect(spawner.calls.some(call => call.cmd === 'taskkill') || killed).toBe(true);
    const saved = JSON.parse(readFileSync(stateFile, 'utf8'));
    expect(saved.status).toBe('interrupted');
    expect(saved.notes.join()).toContain('服务器关闭');
  });
});
