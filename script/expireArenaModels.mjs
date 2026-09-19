/**
 * AI 竞技场「模型过期」流程工具。
 *
 * 过期（expired）≠ 作废（retired）：
 *   - 过期：zip 仍留在 rl/models/，历史对局仍留在评分池里照常计分（分数随池子漂移，
 *     不是冻结值），只是不再参与新一轮评估、前端默认隐藏 —— 相当于「退役归档」；
 *   - 作废：zip 移入 rl/models/deprecated/，历史对局整局丢弃，任何区域都不展示。
 * 过期原因只有一条：名次已经沉底，继续陪练只会拉长新模型的评估时长。
 *
 * 过期条件（`--analyze` 的判定口径）：
 *   对每张地图独立评分排名，一个模型算「全图倒数」需同时满足
 *     1) 在**每一张**图上都排在池子后半段（rank > 池子人数 / 2）；
 *     2) 没有任何一张图挤进该图前 25%（即没有「某一两张图特别优秀」的偏科亮点）。
 *   多条候选取「各图平均名次」最差的 N 个。
 *
 * 用法：
 *   # 1) 看逐图名次与候选（只读，不写任何文件）
 *   node script/expireArenaModels.mjs --analyze
 *   node script/expireArenaModels.mjs --analyze --count 3
 *
 *   # 2) 登记过期（写入 arena/model-status.json）
 *   node script/expireArenaModels.mjs --expire v2.3.2,v2.6.0,v2.5.0 --reason "全图沉底，无突出图"
 *
 *   # 3) 重算 + 回填文档
 *   npm run arena-leaderboard && npm run arena-stats
 *   #  rl/docs/MODELS_NOTES.md：总表行状态标注「已过期」，并在「已过期模型」小节加行
 *   #  RELEASE_NOTES.md 顶部追加条目
 *
 *   node script/expireArenaModels.mjs --list             # 当前过期清单
 *   node script/expireArenaModels.mjs --restore v2.5.0   # 取消过期（回滚）
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PROJECT_DIR, DEFAULT_STATUS_FILE, loadModelStatus, versionOfModelFile } from './modelStatus.mjs';

export const DEFAULT_LEADERBOARD_FILE = join(PROJECT_DIR, 'public', 'data', 'arena-leaderboard.json');
export const DEFAULT_MODELS_DIR = join(PROJECT_DIR, 'rl', 'models');

/** 判「后半段」与「某张图特别优秀」的两个分位口径，改这里就改整条流程的判定标准。 */
export const BOTTOM_FRACTION = 0.5;
export const STANDOUT_FRACTION = 0.25;

export function parseArgs(argv) {
  const opts = {
    mode: null,
    leaderboardFile: DEFAULT_LEADERBOARD_FILE,
    statusFile: DEFAULT_STATUS_FILE,
    modelsDir: DEFAULT_MODELS_DIR,
    count: 3,
    versions: null,
    reason: null,
    evidence: null,
    date: null,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--analyze') opts.mode = 'analyze';
    else if (a === '--list') opts.mode = 'list';
    else if (a === '--expire') { opts.mode = 'expire'; opts.versions = String(argv[++i] ?? ''); }
    else if (a === '--restore') { opts.mode = 'restore'; opts.versions = String(argv[++i] ?? ''); }
    else if (a === '--leaderboard') opts.leaderboardFile = resolve(argv[++i]);
    else if (a === '--status-file') opts.statusFile = resolve(argv[++i]);
    else if (a === '--models-dir') opts.modelsDir = resolve(argv[++i]);
    else if (a === '--count') opts.count = Number(argv[++i]);
    else if (a === '--reason') opts.reason = String(argv[++i] ?? '');
    else if (a === '--evidence') opts.evidence = String(argv[++i] ?? '');
    else if (a === '--date') opts.date = String(argv[++i] ?? '');
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node script/expireArenaModels.mjs <--analyze [--count N] | --expire v1,v2 --reason "..." | --restore v1 | --list>');
      console.log('       [--leaderboard f] [--status-file f] [--models-dir d] [--evidence text] [--date YYYY-MM-DD] [--dry-run]');
      process.exit(0);
    } else {
      throw new Error(`未知参数：${a}（--help 查看用法）`);
    }
  }
  if (!opts.mode) opts.mode = 'analyze';
  return opts;
}

/** 逐图评分排名：返回 { maps, rankByMap: Map<map, Map<id, {rank, n, rating}>> }。 */
export function rankPerMap(leaderboard) {
  const maps = Object.keys(leaderboard.maps ?? {}).filter(map => map !== 'all').sort();
  const rankByMap = new Map();
  for (const map of maps) {
    // 只统计真正打过局的参与者（未参评的 games=0 不应参与名次计算）。
    const rows = (leaderboard.maps[map].models ?? [])
      .filter(m => m.games > 0)
      .sort((a, b) => (b.rating ?? -Infinity) - (a.rating ?? -Infinity));
    rankByMap.set(map, new Map(rows.map((r, i) => [r.id, { rank: i + 1, n: rows.length, rating: r.rating }])));
  }
  return { maps, rankByMap };
}

/**
 * 过期候选判定：每一张图都在后半段、且没有任何一张图进前 25%。
 * 返回 { candidates, skipped }；skipped 记录被淘汰的模型与原因（含「有突出图」的偏科模型）。
 */
export function findCandidates(leaderboard, options = {}) {
  const bottomFraction = options.bottomFraction ?? BOTTOM_FRACTION;
  const standoutFraction = options.standoutFraction ?? STANDOUT_FRACTION;
  const exclude = options.exclude ?? new Set();
  const { maps, rankByMap } = rankPerMap(leaderboard);

  const allRows = new Map((leaderboard.maps?.all?.models ?? []).map(m => [m.id, m]));
  const registry = leaderboard.registry ?? {};
  const candidates = [];
  const skipped = [];
  const rows = [];

  for (const [id, meta] of Object.entries(registry)) {
    if (meta.kind !== 'model' || exclude.has(id)) continue;
    const games = allRows.get(id)?.games ?? 0;
    if (games === 0) continue;
    const ranks = maps.map(map => ({ map, ...(rankByMap.get(map).get(id) ?? { rank: null, n: 0 }) }));
    if (ranks.some(r => r.rank == null)) {
      skipped.push({ id, version: meta.version, reason: '有地图没有它的对局，无法判定全图名次' });
      continue;
    }
    const entry = {
      id,
      version: meta.version,
      short: meta.short ?? meta.version,
      rating: allRows.get(id)?.rating ?? null,
      games,
      ranks: Object.fromEntries(ranks.map(r => [r.map, { rank: r.rank, n: r.n, rating: r.rating }])),
      /** 各图名次归一化后的均值（1 = 垫底），越大越差。 */
      meanPos: ranks.reduce((s, r) => s + r.rank / r.n, 0) / ranks.length,
    };
    rows.push(entry);

    const standouts = ranks.filter(r => r.rank <= Math.max(1, Math.ceil(r.n * standoutFraction)));
    if (standouts.length) {
      skipped.push({
        id, version: meta.version,
        reason: `有突出图（${standouts.map(r => `${r.map} ${r.rank}/${r.n}`).join('、')}），不属于「全图倒数」`,
      });
      continue;
    }
    const notBottom = ranks.filter(r => r.rank <= r.n * bottomFraction);
    if (notBottom.length) {
      skipped.push({
        id, version: meta.version,
        reason: `并非每张图都在后半段（${notBottom.map(r => `${r.map} ${r.rank}/${r.n}`).join('、')}）`,
      });
      continue;
    }
    candidates.push(entry);
  }
  candidates.sort((a, b) => b.meanPos - a.meanPos || (a.rating ?? 0) - (b.rating ?? 0));
  rows.sort((a, b) => b.meanPos - a.meanPos || (a.rating ?? 0) - (b.rating ?? 0));
  const candidateIds = new Set(candidates.map(c => c.id));
  for (const row of rows) row.candidate = candidateIds.has(row.id);
  return {
    candidates, skipped, maps, rows,
    ratedParticipants: (leaderboard.maps?.all?.models ?? []).filter(m => m.games > 0).length,
  };
}

/** 按版本在 rl/models 下找交付 zip。同名多文件时取排序第一个并告警。 */
export function resolveModelFile(modelsDir, version) {
  let files = [];
  try {
    files = readdirSync(modelsDir).filter(f => f.endsWith('.zip') && versionOfModelFile(f) === version).sort();
  } catch {
    throw new Error(`无法读取模型目录 ${modelsDir}`);
  }
  if (!files.length) throw new Error(`rl/models/ 下没有 ${version} 的交付 zip`);
  if (files.length > 1) console.warn(`警告：${version} 在 rl/models/ 下有 ${files.length} 个 zip，取 ${files[0]}`);
  return files[0];
}

function readStatusFile(file) {
  if (!existsSync(file)) return { note: null, expired: [] };
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  return { note: typeof raw.note === 'string' ? raw.note : null, expired: Array.isArray(raw.expired) ? raw.expired : [] };
}

function writeStatusFile(file, note, entries) {
  const sorted = [...entries].sort((a, b) => a.version.localeCompare(b.version));
  const payload = {
    ...(note ? { note } : {}),
    expired: sorted.map(e => ({
      version: e.version,
      file: e.file,
      expiredAt: e.expiredAt,
      reason: e.reason,
      evidence: e.evidence ?? null,
    })),
  };
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function todayStamp(date) {
  if (date) return date;
  const now = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

const POST_STEPS = [
  'npm run arena-leaderboard && npm run arena-stats   # 重算榜单与玩法统计',
  'rl/docs/MODELS_NOTES.md：总表对应行的状态列标注「已过期」，并在「已过期模型」小节加一行（版本 / 档案 / 过期日期 / 原因）',
  'RELEASE_NOTES.md：顶部追加条目（本文件表头规定每次改动都要追加）',
];

function printAnalyze(opts, result) {
  const { candidates, skipped, maps, rows, ratedParticipants } = result;
  console.log(`数据源：${opts.leaderboardFile}`);
  console.log(`判定口径：每张图都在后半段（rank > n/2）且没有任何一张图进前 25% → 「全图倒数」\n`);

  console.log(`=== 逐图名次（RL 模型参与者，rank/该图池内人数；★ = 过期候选） ===`);
  const nameWidth = Math.max(14, ...rows.map(r => r.short.length + 2), ...[...candidates].map(c => c.short.length + 2));
  console.log(['模型'.padEnd(nameWidth), '全局评分'.padStart(8), ...maps.map(m => m.slice(0, 12).padStart(13))].join(''));
  for (const row of rows) {
    const mark = row.candidate ? '★ ' : '  ';
    console.log([
      (mark + row.short).padEnd(nameWidth),
      String(row.rating ?? '—').padStart(8),
      ...maps.map(m => `${row.ranks[m].rank}/${row.ranks[m].n}`.padStart(13)),
    ].join(''));
  }
  console.log('');

  console.log(`=== 候选（全图后半段且无任何突出图）：${candidates.length} 个 ===`);
  if (!candidates.length) console.log('  无');
  candidates.forEach((c, i) => {
    console.log(`  ${i + 1}. ${c.short.padEnd(14)} 全局评分 ${String(c.rating).padStart(4)}  ` +
      `平均名次位置 ${c.meanPos.toFixed(3)}  逐图 ${maps.map(m => `${c.ranks[m].rank}/${c.ranks[m].n}`).join(' ')}`);
  });

  const take = candidates.slice(0, opts.count);
  console.log('');
  console.log(`=== 建议过期：候选里最差的 ${take.length} 个 ===`);
  if (!take.length) {
    console.log('  （候选不足，榜单不需要缩减）');
  } else {
    for (const c of take) console.log(`  - ${c.version.padEnd(8)} ${c.id}`);
    console.log(`  过期后榜单可见参与者：${ratedParticipants} → ${ratedParticipants - take.length} 个`);
    console.log('');
    console.log('下一步命令：');
    console.log(`  node script/expireArenaModels.mjs --expire ${take.map(c => c.version).join(',')} --reason "<填过期原因>"`);
  }

  const standout = skipped.filter(s => s.reason.startsWith('有突出图'));
  if (standout.length) {
    console.log('');
    console.log(`=== 被排除：某张图特别优秀（不算过期）${standout.length} 个 ===`);
    for (const s of standout) console.log(`  - ${s.version}：${s.reason}`);
  }
  const otherSkipped = skipped.filter(s => !s.reason.startsWith('有突出图'));
  if (otherSkipped.length) {
    console.log('');
    console.log(`=== 被排除：并非全图都在后半段 ${otherSkipped.length} 个 ===`);
    for (const s of otherSkipped) console.log(`  - ${s.version}：${s.reason}`);
  }
}

function printList(opts) {
  const { entries, note } = loadModelStatus(opts.statusFile);
  console.log(`登记表：${opts.statusFile}`);
  if (note) console.log(`说明：${note}\n`);
  if (!entries.length) {
    console.log('当前没有过期模型。');
    return;
  }
  console.log(`当前过期 ${entries.length} 个（照常参评、前端默认隐藏、不再进新一轮评估）：`);
  for (const e of entries) {
    console.log(`  - ${e.version.padEnd(8)} ${e.expiredAt}  ${e.file}`);
    console.log(`      ${e.reason}`);
  }
}

function applyExpire(opts) {
  const versions = String(opts.versions ?? '').split(',').map(v => v.trim()).filter(Boolean);
  if (!versions.length) throw new Error('--expire 需要逗号分隔的版本号，如 --expire v2.3.2,v2.6.0');
  if (!opts.reason) throw new Error('--expire 需要 --reason "<过期原因>"（要写进登记表与档案卡）');
  const { note, expired } = readStatusFile(opts.statusFile);
  const byVersion = new Map(expired.map(e => [e.version, e]));
  const stamp = todayStamp(opts.date);
  for (const version of versions) {
    if (!/^v\d+\.\d+\.\d+$/.test(version)) throw new Error(`版本号格式不对：${version}`);
    if (byVersion.has(version)) throw new Error(`${version} 已在过期名单里（要重新登记先 --restore ${version}）`);
    const file = resolveModelFile(opts.modelsDir, version);
    byVersion.set(version, {
      version, file, expiredAt: stamp, reason: opts.reason, evidence: opts.evidence ?? null,
    });
    console.log(`+ ${version}  ${file}  (${stamp})`);
  }
  if (opts.dryRun) {
    console.log('\n--dry-run：未写入登记表。');
  } else {
    writeStatusFile(opts.statusFile, note, [...byVersion.values()]);
    console.log(`\n已写入 ${opts.statusFile}`);
  }
  console.log('\n后续 checklist：');
  POST_STEPS.forEach((step, i) => console.log(`  ${i + 1}. ${step}`));
}

function applyRestore(opts) {
  const versions = String(opts.versions ?? '').split(',').map(v => v.trim()).filter(Boolean);
  if (!versions.length) throw new Error('--restore 需要逗号分隔的版本号');
  const { note, expired } = readStatusFile(opts.statusFile);
  const kept = expired.filter(e => !versions.includes(e.version));
  const removed = expired.filter(e => versions.includes(e.version));
  if (!removed.length) {
    console.log(`没有任何版本被移除（当前名单：${expired.map(e => e.version).join(', ') || '空'}）`);
    return;
  }
  for (const e of removed) console.log(`- ${e.version}  ${e.file}`);
  if (opts.dryRun) {
    console.log('\n--dry-run：未写入登记表。');
  } else {
    writeStatusFile(opts.statusFile, note, kept);
    console.log(`\n已写入 ${opts.statusFile}`);
  }
  console.log('\n后续 checklist：');
  POST_STEPS.forEach((step, i) => console.log(`  ${i + 1}. ${step}`));
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.mode === 'list') return printList(opts);
  if (opts.mode === 'expire') return applyExpire(opts);
  if (opts.mode === 'restore') return applyRestore(opts);

  if (!existsSync(opts.leaderboardFile)) {
    throw new Error(`找不到榜单数据 ${opts.leaderboardFile}，先跑 npm run arena-leaderboard`);
  }
  const leaderboard = JSON.parse(readFileSync(opts.leaderboardFile, 'utf8'));
  const already = new Set(
    loadModelStatus(opts.statusFile).entries
      .map(e => Object.entries(leaderboard.registry ?? {}).find(([, m]) => m.version === e.version)?.[0])
      .filter(Boolean),
  );
  const result = findCandidates(leaderboard, { exclude: already });
  printAnalyze(opts, result);
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  try {
    main();
  } catch (err) {
    console.error(`错误：${err.message}`);
    process.exit(1);
  }
}
