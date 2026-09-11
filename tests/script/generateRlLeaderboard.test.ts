import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  collectRegistry,
  loadMatches,
  RETIRED_VERSIONS,
} from '../../script/generateRlLeaderboard.mjs';

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
    const { registry, excluded } = collectRegistry(makeModelsDir([VALID, RETIRED, V1]));
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

    const registry = collectRegistry(dir).registry;
    const { matches, warnings, retiredDropped } = loadMatches(stats, registry);
    expect(matches).toHaveLength(1);
    expect(matches[0].playerA).toBe(VALID);
    expect(matches[0].playerB).toBe(V1);
    expect(retiredDropped).toBe(2);
    expect(warnings).toHaveLength(0);
  });
});
