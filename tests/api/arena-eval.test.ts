// tests/api/arena-eval.test.ts
// 竞技场评估控制台 API：启动/监控/停止 round_robin 跑批（模型 × 算法）与榜单重算。
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  parsePlannedBatches, parseProgressLine, parseSummaryLine, arenaEvalRoutes, buildParticipantArgs, readEvalMaps,
} from '../../src/api/arenaEval.js';

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

/** 等维护任务（重算榜单/清空旧局）跑完：轮询 /status 直到任务不再是 running。 */
async function waitForAuxTask(app: FastifyInstance, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = (await app.inject({ method: 'GET', url: '/api/arena/eval/status' })).json();
    if (status.auxTask && status.auxTask.status !== 'running') return { status, task: status.auxTask };
    await delay(10);
  }
  throw new Error('维护任务在超时内没有结束');
}

describe('AI 竞技场评估控制台 API', () => {
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
    await app.register(arenaEvalRoutes, {
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
    const res = await app.inject({ method: 'GET', url: '/api/arena/eval/status' });
    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(data.status).toBe('idle');
    expect(data.knownMaps).toContain('random');
    expect(data.knownMaps).toContain('mistpine');
    expect(data.defaults.games).toBe(24);
    expect(data.gamesTotal).toBe(2);
    // 维护任务（重算榜单/清空旧局）默认没有：前端据此隐藏任务进度面板。
    expect(data.auxTask).toBeNull();
    const modeIds = data.modeCatalog.map((mode: { id: string }) => mode.id);
    expect(modeIds).toEqual(['standard', 'annihilation', 'simultaneous', 'royale']);
    expect(data.modeCatalog.find((mode: { id: string }) => mode.id === 'standard').supported).toBe(true);
    expect(data.modeCatalog.find((mode: { id: string }) => mode.id === 'simultaneous')).toMatchObject({
      supported: true,
      maps: expect.arrayContaining([
        expect.objectContaining({ id: 'random-simultaneous', label: '随机图（同时回合）' }),
        expect.objectContaining({ id: 'standoff' }),
        expect.objectContaining({ id: 'molten-throne' }),
        expect.objectContaining({ id: 'mistpine', label: '雾杉疏林' }),
      ]),
    });
    // 四种模式全部接入跑批：歼灭与大逃杀各自带地图池，且随机图排在各自模式最前。
    expect(data.modeCatalog.find((mode: { id: string }) => mode.id === 'annihilation')).toMatchObject({
      supported: true,
      maps: [
        expect.objectContaining({ id: 'random-annihilation', label: '随机图（歼灭）' }),
        expect.objectContaining({ id: 'artillery-zone' }),
        expect.objectContaining({ id: 'trench-run' }),
      ],
    });
    expect(data.modeCatalog.find((mode: { id: string }) => mode.id === 'royale')).toMatchObject({
      supported: true,
      maps: expect.arrayContaining([
        expect.objectContaining({ id: 'random-royale', label: '随机图（大逃杀）' }),
        expect.objectContaining({ id: 'snowflake' }),
        expect.objectContaining({ id: 'narrow-road' }),
      ]),
    });
  });

  // 回归护栏：控制台地图目录必须覆盖 maps/ 下每张图（含新加的图），显示名与模式取自地图文件。
  // 曾因手写清单漏掉歼灭图 trench-run，控制台只显示一张歼灭图。
  it('lists every map file in the console catalog with its own mode and name', () => {
    const catalog = readEvalMaps();
    expect(catalog[0]).toMatchObject({ id: 'random', label: '随机图', mode: 'standard' });
    const files = readdirSync('maps').filter(file => file.endsWith('.json'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const id = file.replace(/\.json$/i, '');
      const config = JSON.parse(readFileSync(join('maps', file), 'utf8'));
      const entry = catalog.find(map => map.id === id);
      expect(entry, `${id} 未进入控制台地图目录`).toBeDefined();
      expect(entry!.label).toBe(config.name ?? id);
      expect(entry!.mode).toBe(config.mode ?? 'standard');
    }
  });

  // 一张随机图只能属于一种规则：四种模式各一个虚拟条目，谁也不许只落在标准模式。
  it('offers one virtual random map per mode', () => {
    const catalog = readEvalMaps();
    const virtual = catalog.filter(map => map.id.startsWith('random'));
    expect(virtual.map(map => [map.id, map.mode, map.label])).toEqual([
      ['random', 'standard', '随机图'],
      ['random-annihilation', 'annihilation', '随机图（歼灭）'],
      ['random-simultaneous', 'simultaneous', '随机图（同时回合）'],
      ['random-royale', 'royale', '随机图（大逃杀）'],
    ]);
  });

  // 浏览器端另有一份内置标签（GET /api/maps 只列静态地图）：文案漂移会让榜单/玩法
  // 统计的地图筛选露出英文 id，所以直接对目录里的 id+label 做文本对齐检查。
  it('keeps the browser label table in sync with the console catalog', () => {
    const source = readFileSync('public/map-labels.js', 'utf8');
    const virtual = readEvalMaps().filter(map => map.id.startsWith('random'));
    expect(virtual).toHaveLength(4);
    for (const map of virtual) {
      expect(source, `${map.id} 缺少内置标签`).toContain(`['${map.id}', '${map.label}']`);
    }
  });

  it('rejects invalid maps, games and jobs on start', async () => {
    const badMap = await app.inject({ method: 'POST', url: '/api/arena/eval/start', payload: { maps: ['nope'] } });
    expect(badMap.statusCode).toBe(400);
    expect(badMap.json().code).toBe('invalid_maps');

    const badGames = await app.inject({ method: 'POST', url: '/api/arena/eval/start', payload: { maps: ['random'], games: 1 } });
    expect(badGames.statusCode).toBe(400);
    expect(badGames.json().code).toBe('invalid_games');

    const badJobs = await app.inject({ method: 'POST', url: '/api/arena/eval/start', payload: { maps: ['random'], jobs: 99 } });
    expect(badJobs.statusCode).toBe(400);
    expect(badJobs.json().code).toBe('invalid_jobs');

    const annihilationSingleAlgo = await app.inject({
      method: 'POST', url: '/api/arena/eval/start',
      payload: { maps: ['artillery-zone'], participants: ['algo:random-annihilation'] },
    });
    expect(annihilationSingleAlgo.statusCode).toBe(400);
    expect(annihilationSingleAlgo.json().code).toBe('invalid_participants');
    expect(annihilationSingleAlgo.json().error).toContain('至少需要选择 2 个');
    expect(annihilationSingleAlgo.json().error).toContain('注册算法 5 个');

    const royaleSingleAlgo = await app.inject({
      method: 'POST', url: '/api/arena/eval/start',
      payload: { maps: ['snowflake'], participants: ['algo:random-royale'] },
    });
    expect(royaleSingleAlgo.statusCode).toBe(400);
    expect(royaleSingleAlgo.json().code).toBe('invalid_participants');

    const mixedModes = await app.inject({
      method: 'POST', url: '/api/arena/eval/start', payload: { maps: ['random', 'standoff'] },
    });
    expect(mixedModes.statusCode).toBe(400);
    expect(mixedModes.json().code).toBe('mixed_modes');
  });

  it('accepts the full 16-way concurrency and forwards it to round_robin', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/arena/eval/start', payload: { maps: ['random'], jobs: 16 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status.params).toMatchObject({ jobs: 16 });
    expect(spawner.calls[0].args.join(' ')).toContain('--jobs 16');
  });

  it('rejects concurrency above 16 and reports the current bound', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/arena/eval/start', payload: { maps: ['random'], jobs: 17 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('invalid_jobs');
    expect(res.json().error).toContain('1-16');
  });

  it('starts an annihilation run with the full registered participant pool', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/arena/eval/start', payload: { maps: ['artillery-zone'], games: 4 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status.params).toMatchObject({ mode: 'annihilation', maps: ['artillery-zone'] });
    const args = spawner.calls[0].args.join(' ');
    expect(args).toContain('--mode annihilation');
    expect(args).toContain('--maps artillery-zone');
    // 不传 participants = 无过滤（round_robin 默认取全部该模式算法），故两者都不出现
    expect(args).not.toContain('--algorithms');
    expect(args).not.toContain('--models');
  });

  it('starts an annihilation run on the annihilation random map', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/arena/eval/start',
      payload: { maps: ['random-annihilation'], games: 4 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status.params).toMatchObject({ mode: 'annihilation', maps: ['random-annihilation'] });
    const args = spawner.calls[0].args.join(' ');
    expect(args).toContain('--mode annihilation');
    expect(args).toContain('--maps random-annihilation');
  });

  // 随机图 id 自带模式：两种模式的随机图不能混在一批，否则 round_robin 会拒绝启动。
  it('rejects mixing two modes of random maps', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/arena/eval/start',
      payload: { maps: ['random-annihilation', 'random-royale'] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('mixed_modes');
  });

  it('starts royale evaluation with apex and its mode-specific baseline', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/arena/eval/start',
      payload: { maps: ['snowflake', 'narrow-road'], participants: ['algo:random-royale', 'algo:apex'], games: 4 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status.params).toMatchObject({ mode: 'royale', participants: ['algo:random-royale', 'algo:apex'] });
    const args = spawner.calls[0].args.join(' ');
    expect(args).toContain('--mode royale');
    expect(args).toContain('--algorithms random-royale,apex');
    expect(args).not.toContain('--models');
  });

  it('starts a simultaneous-mode run with the mode-specific map and algorithm pool', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/arena/eval/start',
      payload: { maps: ['standoff'], participants: ['algo:random-sim', 'algo:dest-prob'], games: 4 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status.params).toMatchObject({
      mode: 'simultaneous',
      maps: ['standoff'],
      participants: ['algo:random-sim', 'algo:dest-prob'],
    });
    const args = spawner.calls[0].args.join(' ');
    expect(args).toContain('--mode simultaneous');
    expect(args).toContain('--maps standoff');
    expect(args).toContain('--algorithms random-sim,dest-prob');
    expect(args).not.toContain('--models');
  });

  it('accepts the mistpine map in the simultaneous evaluation pool', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/arena/eval/start',
      payload: { maps: ['mistpine'], participants: ['algo:random-sim', 'algo:dest-prob'], games: 4 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status.params).toMatchObject({ mode: 'simultaneous', maps: ['mistpine'] });
    expect(spawner.calls[0].args.join(' ')).toContain('--maps mistpine');
  });

  it('rejects models and standard-only algorithms in a simultaneous pool', async () => {
    const model = await app.inject({
      method: 'POST', url: '/api/arena/eval/start',
      payload: { maps: ['standoff'], participants: ['v3.0.4'] },
    });
    expect(model.statusCode).toBe(400);
    expect(model.json().code).toBe('mode_not_supported');
    expect(model.json().error).toContain('RL 模型目前仅支持标准模式');

    const standardAlgo = await app.inject({
      method: 'POST', url: '/api/arena/eval/start',
      payload: { maps: ['standoff'], participants: ['algo:threat'] },
    });
    expect(standardAlgo.statusCode).toBe(400);
    expect(standardAlgo.json().code).toBe('mode_not_supported');
    expect(standardAlgo.json().error).toContain('不支持同时回合');

    const singleAlgo = await app.inject({
      method: 'POST', url: '/api/arena/eval/start',
      payload: { maps: ['standoff'], participants: ['algo:dest-prob'] },
    });
    expect(singleAlgo.statusCode).toBe(400);
    expect(singleAlgo.json().code).toBe('invalid_participants');
    expect(singleAlgo.json().error).toContain('至少需要选择 2 个');
  });

  it('rejects a simultaneous-only algorithm in the standard evaluation pool', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/arena/eval/start',
      payload: { maps: ['default'], participants: ['algo:dest-prob'] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('mode_not_supported');
  });

  it('translates participants into round_robin filters', async () => {
    // 混合：模型子串 + 算法名各归各的参数。
    const mixed = await app.inject({
      method: 'POST', url: '/api/arena/eval/start',
      payload: { maps: ['default'], participants: ['v3.0', 'algo:threat', 'algo:greedy'] },
    });
    expect(mixed.statusCode).toBe(200);
    const args = spawner.calls[0].args.join(' ');
    expect(args).toContain('--mode standard');
    expect(args).toContain('--models v3.0');
    expect(args).toContain('--algorithms threat,greedy');
  });

  it('excludes algorithms when participants are model-only', async () => {
    const modelsOnly = await app.inject({
      method: 'POST', url: '/api/arena/eval/start',
      payload: { maps: ['default'], participants: ['v3.0.4'] },
    });
    expect(modelsOnly.statusCode).toBe(200);
    const args = spawner.calls[0].args.join(' ');
    expect(args).toContain('--algorithms none');
    expect(args).toContain('--models v3.0.4');
  });

  it('omits both filters when participants are unspecified (全部模型+全部算法)', async () => {
    const all = await app.inject({ method: 'POST', url: '/api/arena/eval/start', payload: { maps: ['default'] } });
    expect(all.statusCode).toBe(200);
    const args = spawner.calls[0].args.join(' ');
    expect(args).not.toContain('--models');
    expect(args).not.toContain('--algorithms');
  });

  it('rejects unknown algorithm participants', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/arena/eval/start',
      payload: { maps: ['default'], participants: ['algo:nope'] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('invalid_participants');
    expect(res.json().error).toContain('algo:nope');
  });

  it('buildParticipantArgs handles the null (all) case', () => {
    expect(buildParticipantArgs({ mode: 'standard', maps: ['random'], participants: null, games: 24, jobs: 1, salt: null, dryRun: false })).toEqual([]);
  });

  it('buildParticipantArgs sends an explicit none when only algorithms are picked', () => {
    // 标准模式不传 --models = 全部模型；只勾算法时必须显式 none，否则模型会被一起拉进跑批。
    expect(buildParticipantArgs({
      mode: 'standard', maps: ['whirlpool'], participants: ['algo:greedy', 'algo:random'],
      games: 24, jobs: 1, salt: null, dryRun: false,
    })).toEqual(['--models', 'none', '--algorithms', 'greedy,random']);
    // 非标准模式本来就不允许模型，仍不传 --models（round_robin 见到就报错）。
    expect(buildParticipantArgs({
      mode: 'royale', maps: ['snowflake'], participants: ['algo:random-royale', 'algo:apex'],
      games: 24, jobs: 1, salt: null, dryRun: false,
    })).toEqual(['--algorithms', 'random-royale,apex']);
  });

  it('serves the merged participant catalog', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/arena/participants' });
    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(Array.isArray(data.models)).toBe(true);
    const ids = data.algorithms.map((a: { id: string }) => a.id);
    expect(ids).toContain('algo_threat');
    expect(ids).toContain('algo_greedy');
    // 参评清单返回全部算法及 modes，由控制台按模式过滤；启动接口仍拒绝跨模式混用。
    expect(ids).toContain('algo_dest-prob');
    expect(ids).toContain('algo_random-sim');
    const threat = data.algorithms.find((a: { id: string }) => a.id === 'algo_threat');
    expect(threat.name).toBe('威胁感知算法');
    expect(threat.description).toContain('威胁图');
    expect(threat.modes).toEqual(['standard']);
    const destProb = data.algorithms.find((a: { id: string }) => a.id === 'algo_dest-prob');
    expect(destProb.modes).toEqual(['simultaneous']);
    expect(data.models.every((m: { modes: string[] }) => m.modes.includes('standard'))).toBe(true);
  });

  it('starts a run, tracks progress and auto-regenerates the leaderboard on finish', async () => {
    const start = await app.inject({ method: 'POST', url: '/api/arena/eval/start', payload: { maps: ['random'], games: 4 } });
    expect(start.statusCode).toBe(200);
    expect(start.json().status.status).toBe('running');

    const spawnCall = spawner.calls[0];
    expect(spawnCall.cmd).toBe('python-test');
    expect(spawnCall.args.join(' ')).toContain('round_robin.py');
    expect(spawnCall.args.join(' ')).toContain('--mode standard');
    expect(spawnCall.args.join(' ')).toContain('--maps random');

    const child = spawner.children[0];
    child.stdout.write('任务：2 个对战批次，待跑 4 局\n');
    child.stdout.write('[1/2] OK  a.zip vs b.zip @ random（2 局 / 10s）| 剩余约 20s\n');
    await delay(20);

    const mid = (await app.inject({ method: 'GET', url: '/api/arena/eval/status' })).json();
    expect(mid.batchesTotal).toBe(2);
    expect(mid.batchesDone).toBe(1);
    expect(mid.outputTail.some((line: string) => line.includes('[1/2]'))).toBe(true);

    child.stdout.end();
    child.emit('exit', 0, null);
    await delay(20);

    // 正常结束后自动依次重算榜单与玩法统计（两个脚本串行 spawn），让它们都退出。
    spawner.children[1]?.emit('exit', 0, null);
    await delay(20);
    spawner.children[2]?.emit('exit', 0, null);
    await delay(20);

    const done = (await app.inject({ method: 'GET', url: '/api/arena/eval/status' })).json();
    expect(done.status).toBe('finished');
    expect(done.exitCode).toBe(0);
    // 正常结束后应自动重算榜单（node script/generateArenaLeaderboard.mjs）。
    expect(spawner.calls.some(call => call.cmd === process.execPath && call.args.includes('gen.mjs'))).toBe(true);
    expect(spawner.calls.some(call => call.cmd === process.execPath && call.args.some(a => String(a).includes('generateArenaStats.mjs')))).toBe(true);
  });

  it('rejects concurrent starts', async () => {
    await app.inject({ method: 'POST', url: '/api/arena/eval/start', payload: { maps: ['random'] } });
    const second = await app.inject({ method: 'POST', url: '/api/arena/eval/start', payload: { maps: ['random'] } });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('eval_already_running');
  });

  it('stops a running evaluation and reports stopped', async () => {
    await app.inject({ method: 'POST', url: '/api/arena/eval/start', payload: { maps: ['random'] } });
    const stop = await app.inject({ method: 'POST', url: '/api/arena/eval/stop' });
    expect(stop.statusCode).toBe(200);
    spawner.children[0].emit('exit', 1, 'SIGTERM');
    await delay(20);
    const status = (await app.inject({ method: 'GET', url: '/api/arena/eval/status' })).json();
    expect(status.status).toBe('stopped');
    expect(status.exitCode).toBe(1);

    const again = await app.inject({ method: 'POST', url: '/api/arena/eval/stop' });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('eval_not_running');
  });

  it('clears the accumulated matches file so a fresh batch can accumulate', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/arena/eval/clear-matches' });
    expect(res.statusCode).toBe(200);
    // 真删是后台维护任务：接口先回任务快照，进度与日志随后由 /status 轮询。
    const started = res.json();
    expect(started.ok).toBe(true);
    expect(started.auxTask).toMatchObject({ kind: 'clear', label: '清空旧局', status: 'running', steps: 3 });

    const { status, task } = await waitForAuxTask(app);
    expect(task).toMatchObject({ kind: 'clear', status: 'finished', detail: { removed: 2, total: 2 } });
    expect(task.outputTail.join('\n')).toContain('命中 2 局');
    // 全部行命中时重写为空文件（保留文件本身，局数归零）。
    expect(readFileSync(statsFile, 'utf8').trim()).toBe('');
    expect(status.gamesTotal).toBe(0);
    expect(status.notes.join()).toContain('已删除 2/2 局');
  });

  it('dry run only reports hit counts without touching the file', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/arena/eval/clear-matches',
      payload: { mode: 'standard', dryRun: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, removed: 2, total: 2 });
    expect(readFileSync(statsFile, 'utf8')).toContain('{"map":"random"}');
  });

  it('clears only matches hit by mode/map/participant filters and keeps the rest', async () => {
    writeFileSync(statsFile, [
      { map: 'default', players: { player_a: 'algo_greedy@v1', player_b: 'algo_threat@v1' }, winner: 'algo_threat@v1' },
      { map: 'standoff', players: { player_a: 'algo_random-sim@v2', player_b: 'algo_threat@v1' }, winner: 'algo_random-sim@v2' },
      { map: 'standoff', players: { player_a: 'algo_greedy@v1', player_b: 'algo_kriegspiel@v2' }, winner: 'draw' },
      { map: 'random', players: { player_a: 'algo_greedy@v1', player_b: 'algo_threat@v1' }, winner: 'algo_greedy@v1' },
    ].map(line => JSON.stringify(line)).join('\n') + '\n');

    // 模式过滤：standoff 属 simultaneous（读真实 maps/*.json 的 mode 字段）。
    await app.inject({ method: 'POST', url: '/api/arena/eval/clear-matches', payload: { mode: 'simultaneous' } });
    expect((await waitForAuxTask(app)).task.detail).toMatchObject({ removed: 2, total: 4 });
    const leftMaps = readFileSync(statsFile, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l).map);
    expect(leftMaps).toEqual(['default', 'random']);

    // 参与者过滤：精确匹配任一座位（剩余两行都含 algo_greedy@v1，全部命中）。
    await app.inject({ method: 'POST', url: '/api/arena/eval/clear-matches', payload: { participant: 'algo_greedy@v1' } });
    expect((await waitForAuxTask(app)).task.detail).toMatchObject({ removed: 2 });
    expect(readFileSync(statsFile, 'utf8').split('\n').filter(l => l.trim())).toHaveLength(0);

    // 地图过滤。
    writeFileSync(statsFile, [
      { map: 'default', players: { player_a: 'a', player_b: 'b' } },
      { map: 'breach', players: { player_a: 'a', player_b: 'b' } },
    ].map(line => JSON.stringify(line)).join('\n') + '\n');
    await app.inject({ method: 'POST', url: '/api/arena/eval/clear-matches', payload: { map: 'default' } });
    expect((await waitForAuxTask(app)).task.detail).toMatchObject({ removed: 1 });
    expect(readFileSync(statsFile, 'utf8')).toContain('breach');
    expect(readFileSync(statsFile, 'utf8')).not.toContain('"default"');
  });

  it('matches every algorithm version when the participant filter omits the version', async () => {
    writeFileSync(statsFile, [
      { map: 'random', players: { player_a: 'algo_random@v1', player_b: 'algo_greedy@v1' } },
      { map: 'random', players: { player_a: 'algo_random@v2', player_b: 'algo_greedy@v2' } },
      { map: 'random', players: { player_a: 'algo_random-sim@v2', player_b: 'algo_greedy@v1' } },
      { map: 'random', players: { player_a: 'algo_random-heavy@v1', player_b: 'algo_greedy@v1' } },
      { map: 'random', players: { player_a: 'hex_ppo_v3.0.4_20260909_8.4M.zip', player_b: 'algo_greedy@v1' } },
    ].map(line => JSON.stringify(line)).join('\n') + '\n');

    const dryRun = async (participant: string) => (await app.inject({
      method: 'POST', url: '/api/arena/eval/clear-matches',
      payload: { participant, dryRun: true },
    })).json();

    // 控制台算法下拉给的是不带版本的 algo_<name>：按算法名匹配全部版本，
    // 但不能跨到同前缀的其他算法（algo_random-sim / algo_random-heavy）。
    expect(await dryRun('algo_random')).toMatchObject({ ok: true, removed: 2, total: 5 });
    // 带版本的过滤项仍按记录里的 id 精确匹配。
    expect(await dryRun('algo_random@v2')).toMatchObject({ ok: true, removed: 1, total: 5 });
    // 模型参与者继续按 zip 文件名精确匹配。
    expect(await dryRun('hex_ppo_v3.0.4_20260909_8.4M.zip')).toMatchObject({ ok: true, removed: 1, total: 5 });
  });

  it('clears matches on virtual random maps by mode and map id', async () => {
    writeFileSync(statsFile, [
      { map: 'random', players: { player_a: 'algo_greedy@v1', player_b: 'algo_threat@v1' } },
      { map: 'random-annihilation', players: { player_a: 'algo_shrinkroll@v1', player_b: 'algo_vortex@v1' } },
      { map: 'random-royale', players: { player_a: 'algo_echelon@v1', player_b: 'algo_apex@v1' } },
    ].map(line => JSON.stringify(line)).join('\n') + '\n');

    // 虚拟 id 自带模式：按歼灭过滤只命中 random-annihilation，标准 random 不受牵连。
    const byMode = await app.inject({
      method: 'POST', url: '/api/arena/eval/clear-matches', payload: { mode: 'annihilation', dryRun: true },
    });
    expect(byMode.json()).toMatchObject({ ok: true, removed: 1, total: 3 });

    const byMap = await app.inject({
      method: 'POST', url: '/api/arena/eval/clear-matches', payload: { map: 'random-royale' },
    });
    expect(byMap.statusCode).toBe(200);
    expect((await waitForAuxTask(app)).task.detail).toMatchObject({ removed: 1 });
    const left = readFileSync(statsFile, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l).map);
    expect(left).toEqual(['random', 'random-annihilation']);

    const mismatch = await app.inject({
      method: 'POST', url: '/api/arena/eval/clear-matches', payload: { mode: 'standard', map: 'random-annihilation' },
    });
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json().code).toBe('invalid_filter');
  });

  it('clear-matches validates filter values and combinations', async () => {
    const badMap = await app.inject({ method: 'POST', url: '/api/arena/eval/clear-matches', payload: { map: 'nope' } });
    expect(badMap.statusCode).toBe(400);
    expect(badMap.json().code).toBe('invalid_filter');

    const badMode = await app.inject({ method: 'POST', url: '/api/arena/eval/clear-matches', payload: { mode: 'nope' } });
    expect(badMode.statusCode).toBe(400);

    const mismatch = await app.inject({ method: 'POST', url: '/api/arena/eval/clear-matches', payload: { mode: 'standard', map: 'standoff' } });
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json().code).toBe('invalid_filter');
  });

  it('reports zero removed without touching the file when nothing matches', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/arena/eval/clear-matches', payload: { participant: 'nobody@v1' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().auxTask).toMatchObject({ kind: 'clear', status: 'running' });
    expect((await waitForAuxTask(app)).task.detail).toMatchObject({ removed: 0, total: 2 });
    expect(readFileSync(statsFile, 'utf8').split('\n').filter(l => l.trim())).toHaveLength(2);
  });

  it('clear-matches is a no-op when the stats file does not exist', async () => {
    rmSync(statsFile, { force: true });
    const res = await app.inject({ method: 'POST', url: '/api/arena/eval/clear-matches' });
    expect(res.statusCode).toBe(200);
    expect((await waitForAuxTask(app)).task.detail).toMatchObject({ removed: 0, total: 0 });
  });

  it('rejects clear-matches while a run is in progress', async () => {
    await app.inject({ method: 'POST', url: '/api/arena/eval/start', payload: { maps: ['random'] } });
    const res = await app.inject({ method: 'POST', url: '/api/arena/eval/clear-matches' });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('eval_already_running');
  });

  it('aims the SIGKILL escalation at the stopped child, not a later run', async () => {
    // SIGKILL 升级在非 Windows 分支，临时改写 platform 并把升级等待调短到 5ms。
    const prevPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const app2 = Fastify();
    await app2.register(arenaEvalRoutes, { spawner: spawner.spawner, statsFile, stateFile, escalateMs: 5 });
    try {
      await app2.inject({ method: 'POST', url: '/api/arena/eval/start', payload: { maps: ['random'] } });
      const firstKills: Array<string | undefined> = [];
      const first = spawner.children[0];
      first.kill = (sig?: string) => { firstKills.push(sig); return true; };

      await app2.inject({ method: 'POST', url: '/api/arena/eval/stop' });
      expect(firstKills).toContain('SIGTERM');

      // 老进程退出后立刻开新一轮：升级定时器只能落到老进程上，不能误杀新跑批。
      first.emit('exit', 0, null);
      await app2.inject({ method: 'POST', url: '/api/arena/eval/start', payload: { maps: ['random'] } });
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
      params: { maps: ['random'], participants: null, games: 24, jobs: 1, salt: null, dryRun: false },
      pid: 1, startedAt: '2026-09-06T00:00:00.000Z', finishedAt: null, exitCode: null,
      baselineGames: 0, batchesDone: 0, batchesTotal: null, plannedGames: null,
      outputTail: [], notes: [],
    }));
    const app2 = Fastify();
    await app2.register(arenaEvalRoutes, { spawner: spawner.spawner, statsFile, stateFile });
    const res = (await app2.inject({ method: 'GET', url: '/api/arena/eval/status' })).json();
    expect(res.status).toBe('interrupted');
    expect(res.notes.join()).toContain('服务器重启');
    await app2.close();
  });

  it('requires the control token when AUTO_CONTROL_TOKEN is configured', async () => {
    const prev = process.env.AUTO_CONTROL_TOKEN;
    process.env.AUTO_CONTROL_TOKEN = 'secret';
    try {
      const denied = await app.inject({ method: 'POST', url: '/api/arena/eval/start', payload: { maps: ['random'] } });
      expect(denied.statusCode).toBe(401);
      // 状态快照含命令行与本地路径，读接口同样受控。
      const statusDenied = await app.inject({ method: 'GET', url: '/api/arena/eval/status' });
      expect(statusDenied.statusCode).toBe(401);
      const allowed = await app.inject({
        method: 'POST', url: '/api/arena/eval/start', payload: { maps: ['random'] },
        headers: { 'x-control-token': 'secret' },
      });
      expect(allowed.statusCode).toBe(200);
      const statusAllowed = await app.inject({
        method: 'GET', url: '/api/arena/eval/status', headers: { 'x-control-token': 'secret' },
      });
      expect(statusAllowed.statusCode).toBe(200);
      // 上一步 start 已让跑批进入 running，读到真实状态才证明不是空的 200。
      expect(statusAllowed.json().status).toBe('running');
    } finally {
      if (prev === undefined) delete process.env.AUTO_CONTROL_TOKEN;
      else process.env.AUTO_CONTROL_TOKEN = prev;
    }
  });

  it('regenerates leaderboard data on demand and streams progress', async () => {
    const start = await app.inject({ method: 'POST', url: '/api/arena/leaderboard/regenerate' });
    expect(start.statusCode).toBe(200);
    expect(start.json().auxTask).toMatchObject({ kind: 'regen', label: '重算榜单', status: 'running', step: 0, steps: 2 });
    expect(spawner.calls[0].args.join(' ')).toContain('gen.mjs');

    // 进度条按脚本推进：第一个脚本退出后进入第二步（统计）。
    spawner.children[0].emit('exit', 0, null);
    await delay(20);
    const mid = (await app.inject({ method: 'GET', url: '/api/arena/eval/status' })).json();
    expect(mid.auxTask).toMatchObject({ status: 'running', step: 1, steps: 2 });
    expect(spawner.calls[1].args.join(' ')).toContain('generateArenaStats.mjs');

    spawner.children[1].emit('exit', 0, null);
    const { task } = await waitForAuxTask(app);
    expect(task).toMatchObject({ kind: 'regen', status: 'finished', step: 2, steps: 2 });
    expect(task.outputTail.join('\n')).toContain('$ node gen.mjs');
    expect(task.outputTail.join('\n')).toContain('榜单数据已生成');
    expect(task.outputTail.join('\n')).toContain('玩法统计数据已生成');
  });

  it('reports a failed regeneration in the maintenance task log', async () => {
    const start = await app.inject({ method: 'POST', url: '/api/arena/leaderboard/regenerate' });
    expect(start.statusCode).toBe(200);
    spawner.children[0].emit('exit', 1, null);
    const { task } = await waitForAuxTask(app);
    expect(task.status).toBe('failed');
    expect(task.error).toContain('榜单');
    // 第一步失败后不再跑统计脚本。
    expect(spawner.calls).toHaveLength(1);
  });

  it('rejects a second maintenance task while one is running', async () => {
    await app.inject({ method: 'POST', url: '/api/arena/leaderboard/regenerate' });
    const regen = await app.inject({ method: 'POST', url: '/api/arena/leaderboard/regenerate' });
    expect(regen.statusCode).toBe(409);
    expect(regen.json().code).toBe('aux_task_running');
    expect(regen.json().auxTask).toMatchObject({ kind: 'regen', status: 'running' });

    const clear = await app.inject({ method: 'POST', url: '/api/arena/eval/clear-matches' });
    expect(clear.statusCode).toBe(409);
    expect(clear.json().code).toBe('aux_task_running');
    // 放掉挂起的重算脚本，避免影响 afterEach 关闭。
    spawner.children[0].emit('exit', 1, null);
    await waitForAuxTask(app);
  });

  it('rejects eval writes with 501 when the batch toolchain is not shipped', async () => {
    // 镜像按设计只带服务端本体（见 Dockerfile 的 script/ COPY 清单），
    // 此时写接口要给出读得懂的 501，而不是 spawn ENOENT 冒成 500。
    const app2 = Fastify();
    await app2.register(arenaEvalRoutes, {
      spawner: () => null, statsFile, stateFile, evalToolchainAvailable: false,
    });
    const start = await app2.inject({ method: 'POST', url: '/api/arena/eval/start', payload: { maps: ['random'] } });
    expect(start.statusCode).toBe(501);
    expect(start.json().code).toBe('arena_eval_unavailable');
    const regen = await app2.inject({ method: 'POST', url: '/api/arena/leaderboard/regenerate' });
    expect(regen.statusCode).toBe(501);
    // 参评者清单不依赖跑批链路，容器里仍要能列模型与算法。
    expect((await app2.inject({ method: 'GET', url: '/api/arena/participants' })).statusCode).toBe(200);
    await app2.close();
  });

  it('parses round_robin output lines in their real format', () => {
    expect(parsePlannedBatches('任务：12 个对战批次，待跑 48 局（已完成 24 局直接跳过）。'))
      .toEqual({ total: 12, games: 48 });
    const ok = parseProgressLine('[3/12] OK  a.zip vs b.zip @ default（2 局 / 10s，0.2 局/s）| 剩余约 1m30s');
    expect(ok).toMatchObject({ done: 3, total: 12, ok: true });
    expect(ok?.label).toBe('a.zip vs b.zip @ default（2 局 / 10s，0.2 局/s）| 剩余约 1m30s');
    expect(parseProgressLine('[4/12] FAIL a.zip vs c.zip @ danger-close（1 局 / 9s，0.1 局/s）')).toMatchObject({ ok: false });
    expect(parseSummaryLine('完成批次 12/12，新增 24 局，失败 0 批，总用时 5m30s（0.1 局/s）。'))
      .toEqual({ done: 12, total: 12, games: 24, failed: 0 });
  });

  it('recounts games when the stats file changes', async () => {
    const before = (await app.inject({ method: 'GET', url: '/api/arena/eval/status' })).json();
    expect(before.gamesTotal).toBe(2);
    writeFileSync(statsFile, '{"map":"random"}\n{"map":"random"}\n{"map":"random"}\n');
    const after = (await app.inject({ method: 'GET', url: '/api/arena/eval/status' })).json();
    expect(after.gamesTotal).toBe(3);
  });

  it('resets to failed state instead of a ghost running state when the process cannot start', async () => {
    const app2 = Fastify();
    await app2.register(arenaEvalRoutes, { spawner: () => null, statsFile, stateFile });
    const res = await app2.inject({ method: 'POST', url: '/api/arena/eval/start', payload: { maps: ['random'] } });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toContain('无法启动');
    const status = (await app2.inject({ method: 'GET', url: '/api/arena/eval/status' })).json();
    expect(status.status).toBe('failed');
    expect(status.notes.join()).toContain('无法启动');
    await app2.close();
  });

  it('kills the run process tree and marks interrupted when the server closes', async () => {
    const app2 = Fastify();
    await app2.register(arenaEvalRoutes, { spawner: spawner.spawner, statsFile, stateFile });
    await app2.inject({ method: 'POST', url: '/api/arena/eval/start', payload: { maps: ['random'] } });
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
