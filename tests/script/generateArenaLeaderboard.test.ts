import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  collectRegistry,
  loadMatches,
  loadMapModes,
} from '../../script/generateArenaLeaderboard.mjs';
import { RETIRED_VERSIONS } from '../../script/modelStatus.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const VALID = 'hex_ppo_v2.2.0_20260827_120K.zip';
const RETIRED = 'hex_ppo_v2.1.8_20260827_920K.zip';
const V1 = 'hex_ppo_v1.0.0_20260824_120K.zip';

let tempDir: string | null = null;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

function makeModelsDir(files: string[]) {
  tempDir = mkdtempSync(join(tmpdir(), 'rl-lb-'));
  for (const f of files) writeFileSync(join(tempDir, f), 'zip');
  return tempDir;
}

describe('RETIRED_VERSIONS', () => {
  it('派生自 MODEL_STATUS_BY_VERSION 的 retired 条目', () => {
    expect([...RETIRED_VERSIONS].sort()).toEqual(['v2.1.1', 'v2.1.4', 'v2.1.5', 'v2.1.6', 'v2.1.8']);
  });
});

describe('collectRegistry 跳过作废模型', () => {
  it('作废版本不注册、也不进未参评区；v1.0.0 仍进未参评区', () => {
    const { registry, excluded } = collectRegistry(makeModelsDir([VALID, RETIRED, V1]), []);
    expect(registry.has(VALID)).toBe(true);
    expect(registry.has(RETIRED)).toBe(false);
    expect(excluded.map(x => x.id)).toEqual([V1]);
  });
});

describe('loadMatches 过滤作废模型对局', () => {
  it('作废模型参与的对局整局丢弃并计数，不计入未知模型警告', () => {
    const dir = makeModelsDir([VALID, V1]);
    const stats = join(dir, 'matches.jsonl');
    const line = (a: string, b: string, winner: string) =>
      JSON.stringify({ map: 'default', players: { player_a: a, player_b: b }, winner }) + '\n';
    writeFileSync(stats,
      line(VALID, RETIRED, VALID) +
      line(RETIRED, VALID, RETIRED) +
      line(VALID, V1, VALID));

    const registry = collectRegistry(dir, []).registry;
    const { matches, warnings, retiredDropped } = loadMatches(stats, registry);
    expect(matches).toHaveLength(1);
    expect(matches[0].playerA).toBe(VALID);
    expect(matches[0].playerB).toBe(V1);
    expect(retiredDropped).toBe(2);
    expect(warnings).toHaveLength(0);
  });
});

describe('按玩法模式归档对局', () => {
  it('loadMapModes 读取地图 mode，未知地图按 standard 兼容', () => {
    const modes = loadMapModes();
    expect(modes.get('default')).toBe('standard');
    expect(modes.get('standoff')).toBe('simultaneous');
    expect(modes.get('snowflake')).toBe('royale');
    expect(modes.get('random')).toBe('standard');
    expect(modes.get('unknown-map')).toBeUndefined();
  });

  it('loadMatches 给每条对局写入地图对应模式', () => {
    const dir = makeModelsDir([VALID]);
    const stats = join(dir, 'matches.jsonl');
    const line = (map: string, a: string, b: string, winner: string) =>
      JSON.stringify({ map, players: { player_a: a, player_b: b }, winner }) + '\n';
    writeFileSync(stats,
      line('default', VALID, 'algo_threat@v1', VALID) +
      line('standoff', 'algo_dest-prob@v1', 'algo_kriegspiel@v2', 'algo_dest-prob@v1'));
    const { registry } = collectRegistry(dir);
    const { matches } = loadMatches(stats, registry, loadMapModes());
    expect(matches.map(m => m.mode)).toEqual(['standard', 'simultaneous']);
  });

  it('主脚本把不同模式的参与者与评分池完全分开', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'rl-lb-modes-'));
    const statsFile = join(tempDir, 'matches.jsonl');
    const outFile = join(tempDir, 'lb.json');
    const modelsDir = join(tempDir, 'models');
    mkdirSync(modelsDir, { recursive: true });
    writeFileSync(join(modelsDir, VALID), 'zip');
    const line = (map: string, a: string, b: string, winner: string) =>
      JSON.stringify({ map, players: { player_a: a, player_b: b }, winner }) + '\n';
    writeFileSync(statsFile,
      line('default', VALID, 'algo_threat@v1', VALID) +
      line('standoff', 'algo_dest-prob@v1', 'algo_kriegspiel@v2', 'algo_dest-prob@v1'));

    const result = spawnSync(
      process.execPath,
      ['script/generateArenaLeaderboard.mjs', '--stats-file', statsFile, '--out', outFile,
        '--models-dir', modelsDir, '--bootstrap', '0', '--bootstrap-per-map', '0'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    );
    expect(result.status, result.stderr).toBe(0);
    const payload = JSON.parse(readFileSync(outFile, 'utf8'));
    expect(payload.maps).toBeUndefined();
    expect(payload.modes.map((m: { id: string }) => m.id)).toEqual(['standard', 'simultaneous']);

    const standard = payload.modes.find((m: { id: string }) => m.id === 'standard');
    const simultaneous = payload.modes.find((m: { id: string }) => m.id === 'simultaneous');
    expect(standard.maps.all.models.map((m: { id: string }) => m.id)).toContain(VALID);
    expect(standard.maps.all.models.map((m: { id: string }) => m.id)).toContain('algo_threat@v1');
    expect(standard.maps.all.models.map((m: { id: string }) => m.id)).not.toContain('algo_dest-prob@v1');
    expect(simultaneous.maps.all.models.map((m: { id: string }) => m.id)).toEqual(
      expect.arrayContaining(['algo_dest-prob@v1', 'algo_kriegspiel@v2', 'algo_matrix-eq@v2', 'algo_random-sim@v2']),
    );
    expect(simultaneous.maps.all.models.map((m: { id: string }) => m.id)).not.toContain(VALID);
    expect(simultaneous.games).toBe(1);
    expect(simultaneous.maps.all.models.find((m: { id: string }) => m.id === 'algo_dest-prob@v1').games).toBe(1);
  });
});

describe('collectRegistry 内置算法混池注册', () => {
  it('缺省注册全部算法为 algo_<name>@<版本>，与模型同池且带展示元数据', () => {
    const { registry } = collectRegistry(makeModelsDir([VALID]));
    const threat = registry.get('algo_threat@v1');
    expect(threat).toMatchObject({
      kind: 'algorithm', name: 'threat', displayName: '威胁感知算法', version: 'v1',
    });
    expect(registry.get('algo_greedy@v1')).toBeTruthy();
    expect(registry.get(VALID).kind).toBe('model');
  });

  it('loadMatches 接受带版本 id 的模型×算法/算法×算法对局并按参与者校验', () => {
    const dir = makeModelsDir([VALID]);
    const stats = join(dir, 'matches.jsonl');
    const { registry } = collectRegistry(dir);
    const line = (a: string, b: string, winner: string) =>
      JSON.stringify({ map: 'default', players: { player_a: a, player_b: b }, winner }) + '\n';
    writeFileSync(stats,
      line('algo_threat@v1', 'algo_greedy@v1', 'algo_threat@v1') +
      line(VALID, 'algo_threat@v1', 'algo_threat@v1'));
    const { matches, warnings } = loadMatches(stats, registry);
    expect(matches).toHaveLength(2);
    expect(warnings).toHaveLength(0);
    expect(matches[1].winner).toBe('algo_threat@v1');
  });

  it('不带版本的旧式算法 id（algo_<name>）不在注册表中', () => {
    const { registry } = collectRegistry(makeModelsDir([VALID]));
    expect(registry.has('algo_threat')).toBe(false);
  });
});

describe('端到端冒烟：spawn 真脚本覆盖 main() 独有路径', () => {
  const line = (a: string, b: string, winner: string) =>
    JSON.stringify({ map: 'default', players: { player_a: a, player_b: b }, winner }) + '\n';
  const EXTRA_ZIP = 'hex_ppo_v2.3.2_20260829_340K.zip';

  it('main() 全链路出榜，模型/算法两类状态都走到（registry 组装仅 main 里有，曾因常量迁移漏 import 裸引用）', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'rl-lb-smoke-'));
    const statsFile = join(tempDir, 'matches.jsonl');
    const outFile = join(tempDir, 'lb.json');
    // 参与者用注册算法 + 自建模型 zip：v2.2.0 / v2.3.2 走默认 legacy、
    // 算法走 builtin；两条分支都在 main() 的 registry 组装里。
    writeFileSync(statsFile,
      line(VALID, EXTRA_ZIP, EXTRA_ZIP) +
      line(VALID, 'algo_threat@v1', VALID));

    // --models-dir 指向自建临时目录：真 rl/models 是 gitignored 的本机产物，CI 检出上没有。
    const modelsDir = join(tempDir, 'models');
    mkdirSync(modelsDir, { recursive: true });
    writeFileSync(join(modelsDir, VALID), 'zip');
    writeFileSync(join(modelsDir, EXTRA_ZIP), 'zip');

    const result = spawnSync(
      process.execPath,
      ['script/generateArenaLeaderboard.mjs', '--stats-file', statsFile, '--out', outFile,
        '--models-dir', modelsDir],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    );
    expect(result.status, result.stderr).toBe(0);
    const payload = JSON.parse(readFileSync(outFile, 'utf8'));
    expect(payload.registry[VALID].status).toBe('legacy');
    expect(payload.registry[EXTRA_ZIP].status).toBe('legacy');
    expect(payload.registry['algo_threat@v1'].status).toBe('builtin');
  });
});
