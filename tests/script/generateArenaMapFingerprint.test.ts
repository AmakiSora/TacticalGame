import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  fingerprintMap,
  main,
  resolveSpawning,
} from '../../script/generateArenaMapFingerprint.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let tempDir: string | null = null;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

function makeTempDir(prefix: string) {
  tempDir = mkdtempSync(join(tmpdir(), prefix));
  return tempDir;
}

/** 三槽位地图：layouts["2"] 取 slot_1/slot_3，故意不同于前两个槽位。 */
const layoutMap = {
  name: '布局图', radius: 5,
  spawnSlots: [
    { id: 'slot_1', headquarters: { q: 3, r: 0 }, startingUnits: [{ type: 'infantry', q: 2, r: 0 }] },
    { id: 'slot_2', headquarters: { q: 0, r: 3 }, startingUnits: [{ type: 'infantry', q: 0, r: 2 }] },
    { id: 'slot_3', headquarters: { q: -3, r: 0 }, startingUnits: [{ type: 'infantry', q: -2, r: 0 }] },
  ],
  layouts: { 2: ['slot_1', 'slot_3'] },
};

/** 中心对称的新版地图：HQ (±4,0)、两侧控制点、镜像对称的出生单位。 */
const symmetricMap = {
  name: '对称图', mode: 'simultaneous', radius: 5,
  terrainCells: [{ q: 0, r: 1, terrain: 'blocker' }],
  controlPoints: [
    { id: 'cp_e', name: '东', kind: 'supply', q: 2, r: 0 },
    { id: 'cp_w', name: '西', kind: 'supply', q: -2, r: 0 },
  ],
  spawnSlots: [
    { id: 'slot_e', headquarters: { q: 4, r: 0 }, startingUnits: [{ type: 'infantry', q: 3, r: 0 }] },
    { id: 'slot_w', headquarters: { q: -4, r: 0 }, startingUnits: [{ type: 'infantry', q: -3, r: 0 }] },
  ],
  layouts: { 2: ['slot_e', 'slot_w'] },
  balance: {},
};

describe('地图静态指纹：出生信息收敛（新旧两种地图写法）', () => {
  it('新版 spawnSlots 按 layouts["2"] 取 2 人槽位，而不是前两个槽位', () => {
    const spawning = resolveSpawning(layoutMap);
    expect(spawning.source).toBe('spawnSlots');
    expect(spawning.hq).toEqual([[3, 0], [-3, 0]]);
    expect(spawning.spawns).toEqual([[[2, 0]], [[-2, 0]]]);
  });

  it('新版地图缺 layouts 时退回前两个槽位（与 loader 缺省一致）', () => {
    const spawning = resolveSpawning({ ...layoutMap, layouts: undefined });
    expect(spawning.hq).toEqual([[3, 0], [0, 3]]);
  });

  it('旧版 headquarters/startingUnits 按 owner 归位', () => {
    const spawning = resolveSpawning({
      headquarters: { player_a: { q: -2, r: 0 }, player_b: { q: 2, r: 0 } },
      startingUnits: [
        { type: 'infantry', owner: 'player_a', q: -1, r: 0 },
        { type: 'scout', owner: 'player_b', q: 1, r: 0 },
        { type: 'infantry', owner: 'player_a', q: -2, r: 0 },
      ],
    });
    expect(spawning.source).toBe('legacy');
    expect(spawning.hq).toEqual([[-2, 0], [2, 0]]);
    expect(spawning.spawns).toEqual([[[-1, 0], [-2, 0]], [[1, 0]]]);
  });

  it('HQ 间距、出生点距离与对称性都能从新版字段算出', () => {
    const m = fingerprintMap('symmetric', symmetricMap);
    expect(m.hqDistance).toBe(8);
    expect(m.spawnMetrics.player_a).toEqual({ toHq: 1, toNearestControlPoint: 1 });
    expect(m.spawnMetrics.player_b).toEqual({ toHq: 1, toNearestControlPoint: 1 });
    expect(m.symmetry.mirror.fullySymmetric).toBe(true);
    expect(m.symmetry.central.fullySymmetric).toBe(true);
  });

  it('缺失元素不参与对称判定：无控制点、无初始单位的图仍可判对称', () => {
    const m = fingerprintMap('bare', {
      radius: 5,
      controlPoints: [],
      spawnSlots: [
        { id: 'a', headquarters: { q: 4, r: 0 }, startingUnits: [] },
        { id: 'b', headquarters: { q: -4, r: 0 }, startingUnits: [] },
      ],
      layouts: { 2: ['a', 'b'] },
    });
    expect(m.symmetry.mirror).toMatchObject({
      hqMatched: true, spawnsMatched: null, controlPointsMatched: null, fullySymmetric: true,
    });
    expect(m.symmetry.central.fullySymmetric).toBe(true);
  });

  it('真不对称的图仍判不对称（避免判定恒为 true）', () => {
    const m = fingerprintMap('lopsided', {
      radius: 5,
      spawnSlots: [
        { id: 'a', headquarters: { q: 1, r: 0 }, startingUnits: [] },
        { id: 'b', headquarters: { q: -2, r: 0 }, startingUnits: [] },
      ],
      layouts: { 2: ['a', 'b'] },
      controlPoints: [{ id: 'cp', kind: 'supply', q: 3, r: 0 }],
    });
    expect(m.symmetry.mirror.fullySymmetric).toBe(false);
    expect(m.symmetry.central.fullySymmetric).toBe(false);
  });

  it('地形占比优先用 playableCells 作分母', () => {
    const playableCells = Array.from({ length: 10 }, (_, i) => ({ q: i, r: 0 }));
    const m = fingerprintMap('narrow', {
      radius: 5, playableCells,
      terrainCells: [
        { q: 0, r: 0, terrain: 'blocker' },
        { q: 1, r: 0, terrain: 'blocker' },
        { q: 2, r: 0, terrain: 'water' },
        { q: 3, r: 0, terrain: 'water' },
        { q: 4, r: 0, terrain: 'water' },
      ],
    });
    expect(m.playableCellCount).toBe(10);
    expect(m.terrain).toContainEqual({ kind: 'water', count: 3, share: 0.3 });
    expect(m.terrain).toContainEqual({ kind: 'blocker', count: 2, share: 0.2 });
  });
});

describe('地图静态指纹：入口与产物', () => {
  it('main() 读取地图目录，坏文件降级为 error 条目，非 JSON 忽略', () => {
    const dir = makeTempDir('arena-fingerprint-');
    const mapsDir = join(dir, 'maps');
    mkdirSync(mapsDir, { recursive: true });
    writeFileSync(join(mapsDir, 'symmetric.json'), JSON.stringify(symmetricMap));
    writeFileSync(join(mapsDir, 'broken.json'), '{ not json');
    writeFileSync(join(mapsDir, 'notes.txt'), 'ignore me');
    const out = join(dir, 'out.json');
    main(['--maps-dir', mapsDir, '--out', out]);
    const payload = JSON.parse(readFileSync(out, 'utf8'));
    expect(typeof payload.generatedAt).toBe('string');
    expect(payload.note).toContain('random');
    expect(payload.maps.map((m: { id: string }) => m.id)).toEqual(['broken', 'symmetric']);
    expect(payload.maps[0]).toMatchObject({ id: 'broken', error: 'unreadable' });
    expect(payload.maps[1].hqDistance).toBe(8);
  });

  it('脚本入口可独立执行（isMain 用 pathToFileURL，POSIX 上不会静默空转）', () => {
    const dir = makeTempDir('arena-fingerprint-cli-');
    const mapsDir = join(dir, 'maps');
    mkdirSync(mapsDir, { recursive: true });
    writeFileSync(join(mapsDir, 'symmetric.json'), JSON.stringify(symmetricMap));
    const out = join(dir, 'out.json');
    const result = spawnSync(
      process.execPath,
      ['script/generateArenaMapFingerprint.mjs', '--maps-dir', mapsDir, '--out', out],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('1 maps');
    const payload = JSON.parse(readFileSync(out, 'utf8'));
    expect(payload.maps).toHaveLength(1);
    expect(payload.maps[0].symmetry.central.fullySymmetric).toBe(true);
  });
});
