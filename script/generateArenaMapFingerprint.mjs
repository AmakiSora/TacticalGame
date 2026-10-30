/**
 * 地图静态平衡指纹：读 maps/*.json，输出 public/data/arena-map-fingerprint.json。
 *
 * 对局结果是「果」，地图几何才是「因」——本脚本算出每张图零对局成本就能拿到的
 * 静态指标，供与竞技场对局统计（先手胜率 / 平均回合 / 经济雪球速度）做相关性：
 *   - 出生信息：新版 spawnSlots/layouts 与旧版 headquarters/startingUnits 都支持，
 *     2 人局按引擎的 layouts["2"] 取出生位（缺省退回前两个槽位）；
 *   - 对称性：HQ / 出生点 / 控制点在镜像（q→-q）与中心（q→-q,r→-r）变换下是否闭合，
 *     缺失的元素不参与判定（例如无控制点的 mistpine 仍可判为对称）；
 *   - 距离图：HQ 间距、出生点→HQ、出生点→最近控制点、控制点→两 HQ 的步数差（bias）；
 *   - 控制点结构：数量、kind 分布（supply/forward_base/repair 经济权重不同）；
 *   - 地形：water/blocker 数量与占比（分母优先用 playableCells，异形地图才不会算错）；
 *   - 经济参数：adjudicationWeights / controlPointTypes / 回合与行动点上限。
 *
 * Usage:
 *   node script/generateArenaMapFingerprint.mjs
 *   node script/generateArenaMapFingerprint.mjs --out public/data/arena-map-fingerprint.json
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = dirname(SCRIPT_DIR);
const DEFAULT_MAPS_DIR = join(PROJECT_DIR, 'maps');
const DEFAULT_OUT = join(PROJECT_DIR, 'public', 'data', 'arena-map-fingerprint.json');

export function parseArgs(argv) {
  const opts = { mapsDir: DEFAULT_MAPS_DIR, out: DEFAULT_OUT };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') opts.out = resolve(argv[++i]);
    else if (argv[i] === '--maps-dir') opts.mapsDir = resolve(argv[++i]);
  }
  return opts;
}

/** 六角轴向坐标距离（cube distance 的 axial 形式）。 */
function hexDist(a, b) {
  const [q1, r1] = a;
  const [q2, r2] = b;
  return (Math.abs(q1 - q2) + Math.abs(q1 + r1 - q2 - r2) + Math.abs(r1 - r2)) / 2;
}

const round2 = n => Math.round(n * 100) / 100;

/** 对称变换：镜像（q→-q，r 不变）与中心（q→-q，r→-r）。 */
const TRANSFORMS = {
  mirror: ([q, r]) => [-q, r],
  central: ([q, r]) => [-q, -r],
};

/**
 * 集合对称性：a 方每个元素的对称点是否落在 b 方集合里。返回 { matched, unmatched }，
 * matched=true 表示 a 集合在变换下与 b 集合完全重合（元素数相等且逐点命中）。
 */
function setSymmetry(aPoints, bPoints, transform) {
  const bSet = new Set(bPoints.map(([q, r]) => `${q},${r}`));
  if (aPoints.length !== bPoints.length) return { matched: false, unmatched: aPoints.length };
  let unmatched = 0;
  for (const p of aPoints) {
    const t = transform(p);
    if (!bSet.has(`${t[0]},${t[1]}`)) unmatched += 1;
  }
  return { matched: unmatched === 0, unmatched };
}

/** 控制点集合的自对称：整个点集在变换下不变（每个点的对称点仍在点集内）。 */
function selfSymmetry(points, transform) {
  const set = new Set(points.map(([q, r]) => `${q},${r}`));
  let unmatched = 0;
  for (const p of points) {
    const t = transform(p);
    if (!set.has(`${t[0]},${t[1]}`)) unmatched += 1;
  }
  return { matched: unmatched === 0, unmatched };
}

/** 取坐标：允许 {q,r} 对象，非整数返回 null。 */
function pointOf(value) {
  return (value && Number.isInteger(value.q) && Number.isInteger(value.r)) ? [value.q, value.r] : null;
}

const SEATS = ['player_a', 'player_b'];

/**
 * 收敛出生信息。地图文件有两种写法：
 *   - 新版：spawnSlots + layouts。引擎按 `config.layouts[人数]` 分配出生位（见 src/api/games.ts），
 *     竞技场是 2 人局，所以取 layouts["2"]；缺 layouts 时退回前两个槽位（与 loader 的缺省归一一致）。
 *   - 旧版：headquarters + startingUnits（按 owner 归位）。
 * 否则 9/13 张图（standoff/snowflake/molten-throne 等全用 spawnSlots）的 HQ 会全部解析成 null。
 */
export function resolveSpawning(config) {
  const slots = Array.isArray(config?.spawnSlots) ? config.spawnSlots : [];
  if (slots.length) {
    const layout = Array.isArray(config?.layouts?.['2']) ? config.layouts['2'] : null;
    const ids = (layout && layout.length >= 2 ? layout : slots.map(slot => slot?.id)).slice(0, 2);
    const byId = new Map(slots.map(slot => [slot?.id, slot]));
    const picked = ids.map(slotId => byId.get(slotId) ?? null);
    return {
      source: 'spawnSlots',
      hq: picked.map(slot => pointOf(slot?.headquarters)),
      spawns: picked.map(slot => (Array.isArray(slot?.startingUnits) ? slot.startingUnits : [])
        .map(unit => pointOf(unit))
        .filter(Boolean)),
    };
  }
  return {
    source: 'legacy',
    hq: SEATS.map(seat => pointOf(config?.headquarters?.[seat])),
    spawns: SEATS.map(seat => (Array.isArray(config?.startingUnits) ? config.startingUnits : [])
      .filter(unit => unit?.owner === seat)
      .map(unit => pointOf(unit))
      .filter(Boolean)),
  };
}

export function fingerprintMap(id, config) {
  const { hq, spawns } = resolveSpawning(config);
  const cps = (config?.controlPoints ?? [])
    .filter(c => Number.isInteger(c.q) && Number.isInteger(c.r))
    .map(c => ({ id: c.id, name: c.name, kind: c.kind, q: c.q, r: c.r }));
  const terrain = config?.terrainCells ?? [];

  const hqDistance = hq[0] && hq[1] ? hexDist(hq[0], hq[1]) : null;

  // 出生点→HQ、出生点→最近控制点（有控制点时）。
  const spawnMetrics = SEATS.map((s, i) => {
    const toHq = spawns[i].length && hq[i]
      ? spawns[i].map(p => hexDist(p, hq[i])).reduce((a, b) => Math.min(a, b)) : null;
    const toCp = spawns[i].length && cps.length
      ? spawns[i].map(p => cps.map(c => hexDist(p, [c.q, c.r])).reduce((a, b) => Math.min(a, b)))
        .reduce((a, b) => Math.min(a, b)) : null;
    return { toHq, toNearestControlPoint: toCp };
  });

  // 控制点 → 两 HQ 的步数差：正 = 离 player_a 近（偏袒 A），负 = 偏袒 B。
  const controlPoints = cps.map(c => {
    const dA = hq[0] ? hexDist([c.q, c.r], hq[0]) : null;
    const dB = hq[1] ? hexDist([c.q, c.r], hq[1]) : null;
    return {
      id: c.id, kind: c.kind, q: c.q, r: c.r,
      distToA: dA, distToB: dB,
      bias: (dA != null && dB != null) ? dB - dA : null,
    };
  });
  const totalBias = controlPoints.reduce((s, c) => s + (c.bias ?? 0), 0);

  // 对称性：HQ / 出生点 / 控制点三种元素 × 两种变换。
  const symmetry = {};
  for (const [name, transform] of Object.entries(TRANSFORMS)) {
    const hqSym = hq[0] && hq[1]
      ? (transform(hq[0])[0] === hq[1][0] && transform(hq[0])[1] === hq[1][1])
      : null;
    const spawnSym = spawns[0].length && spawns[1].length
      ? setSymmetry(spawns[0], spawns[1], transform) : null;
    const cpSym = cps.length
      ? selfSymmetry(cps.map(c => [c.q, c.r]), transform) : null;
    // 缺失的元素（如 mistpine 无控制点、narrow-road 无初始单位）不参与判定，
    // 否则这些图会被永远判成「不对称」；全部缺失时无从判断，按 false 计。
    const checks = [hqSym, spawnSym?.matched ?? null, cpSym?.matched ?? null].filter(v => v !== null);
    symmetry[name] = {
      hqMatched: hqSym,
      spawnsMatched: spawnSym?.matched ?? null,
      controlPointsMatched: cpSym?.matched ?? null,
      spawnsUnmatched: spawnSym?.unmatched ?? null,
      controlPointsUnmatched: cpSym?.unmatched ?? null,
      fullySymmetric: checks.length > 0 && checks.every(Boolean),
    };
  }

  // 地形占比：分母优先用 playableCells（异形图的可玩格远少于半径格点总数），
  // 缺省用半径 r 的尖顶六边形格点总数 3r(r+1)+1。
  const radius = Number.isInteger(config?.radius) ? config.radius : null;
  const radiusCells = radius != null ? 3 * radius * (radius + 1) + 1 : null;
  const playableCellCount = Array.isArray(config?.playableCells) && config.playableCells.length
    ? config.playableCells.length : null;
  const totalCells = playableCellCount ?? radiusCells;
  const terrainCount = { water: 0, blocker: 0, other: 0 };
  for (const t of terrain) {
    const kind = t.terrain;
    terrainCount[kind] = (terrainCount[kind] ?? 0) + 1;
  }
  const terrainKinds = Object.entries(terrainCount)
    .filter(([, n]) => n > 0)
    .map(([kind, count]) => ({ kind, count, share: totalCells ? round2(count / totalCells) : null }));

  const balance = config?.balance ?? {};
  return {
    id,
    name: typeof config?.name === 'string' ? config.name : null,
    mode: typeof config?.mode === 'string' && config.mode ? config.mode : 'standard',
    grid: config?.grid ?? null,
    orientation: config?.orientation ?? null,
    radius,
    playableCellCount,
    hq: { player_a: hq[0], player_b: hq[1] },
    hqDistance,
    spawnMetrics: { player_a: spawnMetrics[0], player_b: spawnMetrics[1] },
    controlPointCount: controlPoints.length,
    controlPointKinds: controlPoints.reduce((o, c) => ({ ...o, [c.kind]: (o[c.kind] ?? 0) + 1 }), {}),
    controlPoints,
    totalControlPointBias: controlPoints.length ? totalBias : null,
    symmetry,
    terrain: terrainKinds,
    balance,
  };
}

export function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  let maps = [];
  try {
    for (const file of readdirSync(opts.mapsDir)) {
      if (!/\.json$/i.test(file)) continue;
      const id = file.replace(/\.json$/i, '');
      try {
        maps.push(fingerprintMap(id, JSON.parse(readFileSync(join(opts.mapsDir, file), 'utf8'))));
      } catch {
        maps.push({ id, error: 'unreadable' });
      }
    }
  } catch {
    maps = [{ error: `cannot read ${opts.mapsDir}` }];
  }
  // random 图无静态文件：不写条目，只在 note 里说明其先手胜率来自竞技场统计。
  const payload = {
    generatedAt: new Date().toISOString(),
    note: 'random 图为每局一张对称随机地图，无静态文件；其先手胜率来自竞技场统计而非本文件。',
    maps: maps.sort((a, b) => (a.mode ?? '').localeCompare(b.mode ?? '') || (a.id ?? '').localeCompare(b.id ?? '')),
  };
  mkdirSync(dirname(opts.out), { recursive: true });
  writeFileSync(opts.out, JSON.stringify(payload, null, 2), 'utf8');
  const symmetric = maps.filter(m => m.symmetry?.mirror?.fullySymmetric || m.symmetry?.central?.fullySymmetric).length;
  console.log(`Wrote ${opts.out} — ${maps.length} maps（${symmetric} 张至少一种变换全对称）`);
  for (const m of maps) {
    if (m.error) { console.log(`  ${m.id ?? '?'}: ${m.error}`); continue; }
    const bias = m.totalControlPointBias;
    console.log(`  ${m.id}: mode=${m.mode} hqDist=${m.hqDistance} cps=${m.controlPointCount} `
      + `cpBias=${bias == null ? '—' : bias} `
      + `sym=${m.symmetry.mirror.fullySymmetric || m.symmetry.central.fullySymmetric ? '是' : '否'}`);
  }
}

// 与仓库其它生成脚本一致：用 pathToFileURL 比较，避免手拼 file:/// 在 POSIX（CI / VPS）
// 上得到 file:////… 而把入口判成「非主模块」导致静默不执行。
const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) main();
