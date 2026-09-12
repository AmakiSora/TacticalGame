import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectRegistry } from '../../script/generateRlLeaderboard.mjs';
import {
  aggregateGameplay,
  buildModelProfiles,
  loadMatchDetails,
  parseModelsNotes,
  stripMd,
} from '../../script/generateRlStats.mjs';

const A = 'hex_ppo_v2.2.0_20260827_default_modelmix_best.zip';
const B = 'hex_ppo_v2.7.0_20260901_random_selfplay_4000000.zip';
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
  tempDir = mkdtempSync(join(tmpdir(), 'rl-stats-'));
  for (const f of files) writeFileSync(join(tempDir, f), 'zip');
  return tempDir;
}

/** 两行有效对局（A 胜一局、平局一局）+ 三类应丢弃行。 */
function makeStatsFile(dir: string) {
  const derivedFull = {
    deploysByType: { infantry: 2 }, deployCost: 100,
    lossesByType: { infantry: 1 }, killsByType: { scout: 1 },
    damageDealt: 50, damageTaken: 30,
    incomeTotal: 100, incomeControlTotal: 40,
    captures: 2, steals: 1, firstCaptureRound: 3, comebackSupplies: 5,
  };
  const derivedLight = {
    deploysByType: { scout: 1 }, deployCost: 60,
    lossesByType: { scout: 1 }, killsByType: { infantry: 1 },
    damageDealt: 30, damageTaken: 50,
    incomeTotal: 80, incomeControlTotal: 20,
    captures: 1, steals: 0, firstCaptureRound: 4, comebackSupplies: 0,
  };
  const derivedDrawA = {
    deploysByType: { infantry: 1, heavy: 1 }, deployCost: 150,
    lossesByType: {}, killsByType: {},
    damageDealt: 0, damageTaken: 10,
    incomeTotal: 50, incomeControlTotal: 50,
    captures: 1, steals: 0, firstCaptureRound: 5, comebackSupplies: 0,
  };
  const derivedDrawB = {
    deploysByType: {}, deployCost: 0,
    lossesByType: { infantry: 1 }, killsByType: {},
    damageDealt: 10, damageTaken: 0,
    incomeTotal: 40, incomeControlTotal: 0,
    captures: 0, steals: 0, firstCaptureRound: null, comebackSupplies: 0,
  };
  const line = (obj: unknown) => JSON.stringify(obj) + '\n';
  const file = join(dir, 'matches.jsonl');
  writeFileSync(file,
    line({
      ts: '2026-09-01 10:00:00', map: 'default',
      players: { player_a: A, player_b: B }, winner: A, rounds: 12,
      endReason: 'last_player_standing',
      scores: { player_a: 100, player_b: 50 }, actions: { player_a: 30, player_b: 20 },
      derived: { player_a: derivedFull, player_b: derivedLight }, durationSec: 2,
    }) +
    line({
      ts: '2026-09-01 11:00:00', map: 'default',
      players: { player_a: B, player_b: A }, winner: 'draw', rounds: 30,
      endReason: 'turn_limit_draw',
      scores: { player_a: 60, player_b: 70 }, actions: { player_a: 10, player_b: 10 },
      derived: { player_a: derivedDrawA, player_b: derivedDrawB }, durationSec: 4,
    }) +
    line({ map: 'default', players: { player_a: A, player_b: RETIRED }, winner: A }) +
    line({ map: 'default', players: { player_a: A, player_b: A }, winner: A }) +
    line({ map: 'default', players: { player_a: A, player_b: V1 }, winner: A }));
  return file;
}

function loadFixture() {
  const dir = makeModelsDir([A, B, V1]);
  const statsFile = makeStatsFile(dir);
  const { registry } = collectRegistry(dir);
  const result = loadMatchDetails(statsFile, registry);
  return { dir, registry, ...result };
}

describe('loadMatchDetails 过滤与字段保留', () => {
  it('作废/同模型/旧格式对局分别计数丢弃，有效行保留 derived 与 scores', () => {
    const { matches, warnings, retiredDropped, formatDropped } = loadFixture();
    expect(matches).toHaveLength(2);
    expect(retiredDropped).toBe(1);
    expect(formatDropped).toBe(1);
    // 同模型对局只记 warning。
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('same model');
    const g = matches[0];
    expect(g.endReason).toBe('last_player_standing');
    expect(g.durationSec).toBe(2);
    expect(g.seatA.score).toBe(100);
    expect(g.seatA.derived.deploysByType).toEqual({ infantry: 2 });
    expect(g.seatB.derived.killsByType).toEqual({ infantry: 1 });
  });
});

describe('aggregateGameplay 聚合', () => {
  it('总览/结局/直方图/兵种/经济/每模型/分地图各段数值正确', () => {
    const { matches } = loadFixture();
    const gp = aggregateGameplay(matches);

    expect(gp.overview.games).toBe(2);
    expect(gp.overview.draws).toBe(1);
    expect(gp.overview.annihilationRate).toBe(0.5);
    expect(gp.overview.avgRounds).toBe(21);
    expect(gp.overview.avgDurationSec).toBe(3);
    expect(gp.overview.avgActions).toBe(35);

    expect(gp.endReasons).toEqual([
      { reason: 'last_player_standing', count: 1, pct: 0.5 },
      { reason: 'turn_limit_draw', count: 1, pct: 0.5 },
    ]);

    const bucketOf = (label: string) => gp.roundsDist.find((b: { bucket: string }) => b.bucket === label);
    expect(bucketOf('10–14').count).toBe(1);
    expect(bucketOf('30（打满）').count).toBe(1);
    // 桶为左闭右开：durationSec=2 落 '2–3s' 而非 '1–2s'，4 落 '3–5s'。
    expect(gp.durationDist.find((b: { bucket: string }) => b.bucket === '1–2s').count).toBe(0);
    expect(gp.durationDist.find((b: { bucket: string }) => b.bucket === '2–3s').count).toBe(1);
    expect(gp.durationDist.find((b: { bucket: string }) => b.bucket === '3–5s').count).toBe(1);

    // 全局兵种只留部署与阵亡（kills 全局恒等于 losses，由脚本注释说明）。
    const infantry = gp.units.find((u: { type: string }) => u.type === 'infantry');
    expect(infantry).toMatchObject({ deploys: 3, losses: 2, deployShare: 0.6 });
    expect(infantry).not.toHaveProperty('kills');
    expect(gp.units.map((u: { type: string }) => u.type)).toEqual(['infantry', 'heavy', 'scout']);

    // 经济：4 个座位均有 derived。
    expect(gp.economy.seatCount).toBe(4);
    expect(gp.economy.avgIncomeTotal).toBe(68); // (100+80+50+40)/4 = 67.5 → 68
    expect(gp.economy.controlShare).toBe(0.4074); // 110/270
    expect(gp.economy.avgFirstCaptureRound).toBe(4); // (3+4+5)/3，null 不计
    expect(gp.economy.comebackRate).toBe(0.25);

    const mA = gp.perModel.find((m: { id: string }) => m.id === A);
    expect(mA).toMatchObject({
      games: 2, wins: 1, draws: 1, winRate: 0.5,
      avgScore: 85, // (100+70)/2
      avgDamageDealt: 30, // (50+10)/2
      avgKills: 0.5, // (1+0)/2
      avgCaptures: 1, // (2+0)/2
      avgFirstCaptureRound: 3, // 第二局 firstCaptureRound 为 null 不计
    });
    expect(mA.topDeploys[0]).toEqual({ type: 'infantry', count: 2 });
    const mB = gp.perModel.find((m: { id: string }) => m.id === B);
    expect(mB).toMatchObject({ games: 2, wins: 0, losses: 1, draws: 1, avgScore: 55 });

    expect(gp.perMap).toHaveLength(1);
    expect(gp.perMap[0]).toMatchObject({
      map: 'default', games: 2, drawRate: 0.5, annihilationRate: 0.5,
      avgRounds: 21, avgDurationSec: 3, topEndReason: 'last_player_standing',
    });
  });

  it('空对局列表产出空态而不除零', () => {
    const gp = aggregateGameplay([]);
    expect(gp.overview.games).toBe(0);
    expect(gp.overview.drawRate).toBeNull();
    expect(gp.economy.seatCount).toBe(0);
    expect(gp.units).toEqual([]);
    expect(gp.perModel).toEqual([]);
  });
});

const NOTES_MD = `# RL 模型说明（导航页）

## 模型状态总表

| 模型文件 | 档案 | 状态 | 说明 |
|---|---|---|---|
| \`rl/models/${A}\` | [v2.2.0](models/v2.2.0.md) | 历史 | 座位随机化；对 v2.0.0 **16:0** |
| \`${B}\` | [v2.7.0](models/v2.7.0.md) | **当前推荐** | 6205 维可观测性修复 |
| \`hex_ppo_v3.0.4_20260909_random_selfplay_8440000.zip\` | RELEASE_NOTES 2026-09-09 v3.0.4 验收条目 | 验收未过线 | 无链接档案列，走 stripMd 回退 |
| \`hex_ppo_v3.0.1_20260904_distilled.zip\` | [v3.0.1](models/v3.0.1.md) | 中间产物 | 不符合交付文件名格式，应静默跳过 |

### 已作废模型（归档留底，勿部署、勿纳入评估）

| 模型文件（已归档） | 档案 | 作废原因 |
|---|---|---|
| \`rl/models/deprecated/${RETIRED}\` | [v2.1.8](models/deprecated/v2.1.8.md) | 环境损坏，自评 100% 为**虚假数据** |
`;

describe('parseModelsNotes 表格解析', () => {
  it('主表按 basename 建档并剥掉 markdown；作废表在标题后切换', () => {
    const { profiles, deprecated, warnings } = parseModelsNotes(NOTES_MD);
    expect(warnings).toEqual([]);

    const pa = profiles.get(A);
    expect(pa).toBeDefined();
    expect(pa.docRef).toBe('models/v2.2.0.md');
    expect(pa.docStatus).toBe('历史');
    expect(pa.notes).toBe('座位随机化；对 v2.0.0 16:0');

    expect(profiles.get(B)?.docStatus).toBe('当前推荐');
    // 无链接档案列回退到 stripMd 纯文本。
    const p304 = profiles.get('hex_ppo_v3.0.4_20260909_random_selfplay_8440000.zip');
    expect(p304?.docRef).toBe('RELEASE_NOTES 2026-09-09 v3.0.4 验收条目');
    expect(p304?.docStatus).toBe('验收未过线');
    // distilled 中间产物不符合交付文件名格式：不建档、不告警。
    expect(profiles.size).toBe(3);

    expect(deprecated).toHaveLength(1);
    expect(deprecated[0]).toMatchObject({
      file: RETIRED,
      version: 'v2.1.8',
      docRef: 'models/deprecated/v2.1.8.md',
      reason: '环境损坏，自评 100% 为虚假数据',
    });
  });

  it('列数不足的行记 warning 但不中断', () => {
    const md = `| 模型文件 | 档案 | 状态 | 说明 |\n|---|---|---|---|\n| \`${A}\` | 只有两列 |\n`;
    const { profiles, warnings } = parseModelsNotes(md);
    expect(profiles.size).toBe(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(A);
  });

  it('主表重复文件名行记 warning 并采用最后一次', () => {
    const md = `| 模型文件 | 档案 | 状态 | 说明 |\n|---|---|---|---|\n` +
      `| \`${A}\` | [a](models/a.md) | s1 | n1 |\n| \`${A}\` | [a](models/a.md) | s2 | n2 |\n`;
    const { profiles, warnings } = parseModelsNotes(md);
    expect(profiles.get(A)?.docStatus).toBe('s2');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('出现多次');
  });
});

describe('stripMd', () => {
  it('链接留文字、粗体与反引号去标记', () => {
    expect(stripMd('见 [v2.7.0](models/v2.7.0.md) **重点** `code`')).toBe('见 v2.7.0 重点 code');
  });
});

describe('buildModelProfiles 档案组装', () => {
  it('合并榜单评分与 notes，评分降序、未参评排后', () => {
    const dir = makeModelsDir([A, B, V1]);
    const { registry } = collectRegistry(dir);
    const { profiles: notesProfiles } = parseModelsNotes(NOTES_MD);
    const leaderboardJson = {
      maps: {
        all: {
          models: [
            { id: B, rating: 1600, ratingLo: 1580, ratingHi: 1620, winRate: 0.6, games: 10 },
            { id: A, rating: 1500, ratingLo: 1480, ratingHi: 1520, winRate: 0.5, games: 8 },
          ],
        },
      },
    };
    const models = buildModelProfiles({ registry, modelsDir: dir, leaderboardJson, notesProfiles });

    expect(models.map(m => m.id)).toEqual([B, A, V1]); // 评分降序，无评分（v1.0.0）排最后
    const pb = models[0];
    expect(pb).toMatchObject({
      short: 'v2.7.0@4M', version: 'v2.7.0', rating: 1600, winRate: 0.6, games: 10,
      status: 'legacy', rated: true, docStatus: '当前推荐',
    });
    const pa = models[1];
    expect(pa.status).toBe('legacy'); // 不在 MODEL_STATUS_BY_VERSION 的默认历史
    expect(pa.notes).toContain('座位随机化');
    const pv1 = models[2];
    expect(pv1.rated).toBe(false);
    expect(pv1.rating).toBeNull();
    expect(pv1.notes).toBeNull(); // 文档未收录时留空
  });

  it('v3.0.3 映射为 recommended（与 MODELS_NOTES.md 同步）', () => {
    const champ = 'hex_ppo_v3.0.3_20260908_random_selfplay_5000000.zip';
    const dir = makeModelsDir([champ]);
    const { registry } = collectRegistry(dir);
    const models = buildModelProfiles({ registry, modelsDir: dir, leaderboardJson: null, notesProfiles: new Map() });
    expect(models[0].status).toBe('recommended');
  });

  it('榜单文件缺失时评分留空、档案仍完整', () => {
    const dir = makeModelsDir([A]);
    const { registry } = collectRegistry(dir);
    const models = buildModelProfiles({ registry, modelsDir: dir, leaderboardJson: null, notesProfiles: new Map() });
    expect(models).toHaveLength(1);
    expect(models[0].rating).toBeNull();
    expect(models[0].games).toBe(0);
    expect(models[0].short).toBe('v2.2.0');
  });
});
