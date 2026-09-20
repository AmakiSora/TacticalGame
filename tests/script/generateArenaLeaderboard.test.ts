import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EXPIRED_MODELS,
  EXPIRED_VERSIONS,
  collectRegistry,
  loadMatches,
} from '../../script/generateArenaLeaderboard.mjs';
import { RETIRED_VERSIONS } from '../../script/modelStatus.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const VALID = 'hex_ppo_v2.2.0_20260827_default_modelmix_best.zip';
const RETIRED = 'hex_ppo_v2.1.8_20260827_default_modelmix_920000.zip';
const V1 = 'hex_ppo_v1.0.0_20260824_default_random_opponent_120000.zip';

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

describe('过期模型（expired）与作废（retired）的区别', () => {
  it('过期名单与 arena/model-status.json 一致，且与作废名单互不重叠', () => {
    const doc = JSON.parse(readFileSync(join(process.cwd(), 'arena', 'model-status.json'), 'utf8'));
    expect([...EXPIRED_VERSIONS].sort()).toEqual(doc.expired.map((e: { version: string }) => e.version).sort());
    expect(EXPIRED_MODELS).toHaveLength(doc.expired.length);
    for (const version of EXPIRED_VERSIONS) expect(RETIRED_VERSIONS.has(version)).toBe(false);
  });

  const sample = EXPIRED_MODELS[0];
  it.skipIf(!sample)('过期模型照常注册（作废模型被跳过，两者相反）', () => {
    const { registry, excluded } = collectRegistry(makeModelsDir([VALID, sample.file, RETIRED]), []);
    expect(registry.has(sample.file)).toBe(true);
    expect(registry.has(VALID)).toBe(true);
    expect(registry.has(RETIRED)).toBe(false);
    expect(excluded).toHaveLength(0);
  });

  it.skipIf(!sample)('loadMatches 保留过期模型对局并单独计数，不作废丢局', () => {
    const dir = makeModelsDir([VALID, sample.file]);
    const stats = join(dir, 'matches.jsonl');
    const line = (a: string, b: string, winner: string) =>
      JSON.stringify({ map: 'default', players: { player_a: a, player_b: b }, winner }) + '\n';
    writeFileSync(stats,
      line(VALID, sample.file, VALID) +
      line(sample.file, VALID, sample.file));

    const registry = collectRegistry(dir, []).registry;
    const { matches, warnings, retiredDropped, expiredKept } = loadMatches(stats, registry);
    expect(matches).toHaveLength(2);
    expect(retiredDropped).toBe(0);
    expect(expiredKept).toBe(2);
    expect(warnings).toHaveLength(0);
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
  const EXPIRED_ZIP = 'hex_ppo_v2.3.2_20260829_random_selfplay_800000.zip';

  it('main() 全链路出榜，status 三分支都走到（registry 组装仅 main 里有，曾因常量迁移漏 import 裸引用）', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'rl-lb-smoke-'));
    const statsFile = join(tempDir, 'matches.jsonl');
    const outFile = join(tempDir, 'lb.json');
    // 参与者用 rl/models/ 真实存在的 zip + 注册算法：v2.2.0 走 MODEL_STATUS_BY_VERSION
    // 查表分支（legacy）、v2.3.2 已过期（expired）、算法（builtin）。
    writeFileSync(statsFile,
      line(VALID, EXPIRED_ZIP, EXPIRED_ZIP) +
      line(VALID, 'algo_threat@v1', VALID));

    const result = spawnSync(
      process.execPath,
      ['script/generateArenaLeaderboard.mjs', '--stats-file', statsFile, '--out', outFile],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    );
    expect(result.status, result.stderr).toBe(0);
    const payload = JSON.parse(readFileSync(outFile, 'utf8'));
    expect(payload.registry[VALID].status).toBe('legacy');
    expect(payload.registry[EXPIRED_ZIP].status).toBe('expired');
    expect(payload.registry['algo_threat@v1'].status).toBe('builtin');
  });
});
