/**
 * AI 竞技场模型状态登记表（arena/model-status.json）的读写。
 *
 * 「过期」（expired）是介于「在役」与「作废」（retired）之间的第三态：
 *   - 模型 zip 仍留在 rl/models/（**不**物理归档，这是与作废的第一点区别）；
 *   - 历史对局继续进 Bradley-Terry 评分池，所以它的分数是「跟着池子一起漂移」，
 *     而不是冻结在过期那一刻（与作废的第二点区别：作废的对局整局丢弃）；
 *   - 不再参与新一轮评估：round_robin 自动发现、评估控制台勾选列表都排除它；
 *   - 前端默认隐藏，只提供「显示已过期模型」开关。
 * 过期原因只有一条：**名次已经沉底，继续陪跑只是拉长新模型的评估时长**。
 *
 * 本文件是模型状态名单的唯一事实来源：过期名单读 arena/model-status.json；作废名单
 * MODEL_STATUS_BY_VERSION / RETIRED_VERSIONS 与两态互斥断言 assertExpiredRetiredDisjoint
 * 也住在本文件（见文末）。JS 脚本 / 服务端 TS / Python 编排器都读这一份，任何地方都
 * 不要另外写死版本名单；同一版本不得同时登记过期与作废（--expire 与
 * generateArenaLeaderboard 启动断言双重拦截）。人读的说明在 rl/docs/MODELS_NOTES.md。
 *
 * 错误处理口径（三个消费端、两种立场，勿再发散）：
 *   - JS 脚本（榜单/统计/expireArenaModels）与 Python 评估（round_robin.py）：
 *     解析失败一律抛错中止——带着一份坏名单跑评估比不跑更贵（过期模型会悄悄回到对手池）；
 *   - 服务端 src/api/bots.ts：唯一允许降级的消费端——登记表坏了不阻断线上对局，
 *     退化为「无过期」并打可见告警（代价仅是过期模型临时回到「添加 AI」列表）。
 *   文件**缺失**在所有消费端都按「无过期」处理（新环境/纯算法环境的正常状态）。
 *   Python 侧的镜像实现由 tests/rl/test_model_status_contract.py 钉死与 JS 行为一致。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const PROJECT_DIR = dirname(SCRIPT_DIR);
export const DEFAULT_STATUS_FILE = join(PROJECT_DIR, 'arena', 'model-status.json');

/** 交付模型文件名里的版本段；与 rl/evaluation/round_robin.py 的 MODEL_RE 同源口径。 */
export const MODEL_VERSION_RE = /^hex_ppo_(v\d+\.\d+\.\d+)_/;

/** `hex_ppo_v3.0.3_20260908_...zip` → `v3.0.3`；不符合交付命名规范返回 null。 */
export function versionOfModelFile(fileName) {
  const match = MODEL_VERSION_RE.exec(String(fileName ?? ''));
  return match ? match[1] : null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 解析登记表文本。结构非法直接抛错——这是手工维护的名单，静默降级会让过期模型
 * 悄悄重新回到评估池，比启动失败更糟（各消费端如何处置这个错，见文件头注的口径）。
 * 字符串字段（version/file/expiredAt/reason）不做 String() 归一：非字符串一律拒绝，
 * 与 Python 侧 round_robin.py 的 isinstance 口径一致（契约测试钉死）。
 */
export function parseModelStatus(text, source = 'model-status.json') {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`${source}: 不是合法 JSON（${err.message}）`);
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.expired)) {
    throw new Error(`${source}: 缺少顶层 expired 数组`);
  }
  const seen = new Set();
  const entries = raw.expired.map((item, idx) => {
    const at = `${source} expired[${idx}]`;
    if (!item || typeof item !== 'object') throw new Error(`${at}: 必须是对象`);
    // 字段一律要求 JSON 字符串，不做 String() 归一——归一会把数字/数组悄悄变成
    // 「看似合法」的内容，且与 Python 侧 isinstance 口径分叉（契约测试钉死）。
    const version = item.version;
    if (typeof version !== 'string') throw new Error(`${at}: version 需是字符串，实际 ${JSON.stringify(version)}`);
    if (!/^v\d+\.\d+\.\d+$/.test(version)) throw new Error(`${at}: version 需形如 v3.0.3，实际 ${JSON.stringify(version)}`);
    const file = item.file;
    if (typeof file !== 'string') throw new Error(`${at}: file 需是字符串，实际 ${JSON.stringify(file)}`);
    if (!file.endsWith('.zip')) throw new Error(`${at}: file 需是 .zip 文件名，实际 ${JSON.stringify(file)}`);
    if (versionOfModelFile(file) !== version) throw new Error(`${at}: file 的版本段与 version 不一致（${file} vs ${version}）`);
    if (seen.has(version)) throw new Error(`${at}: 版本 ${version} 重复登记`);
    seen.add(version);
    if (typeof item.expiredAt !== 'string' || !DATE_RE.test(item.expiredAt)) throw new Error(`${at}: expiredAt 需是形如 2026-09-19 的日期字符串，实际 ${JSON.stringify(item.expiredAt)}`);
    if (typeof item.reason !== 'string' || !item.reason.trim()) throw new Error(`${at}: reason 需是非空字符串，实际 ${JSON.stringify(item.reason)}`);
    const reason = item.reason.trim();
    return {
      version,
      file,
      expiredAt: String(item.expiredAt),
      reason,
      evidence: String(item.evidence ?? '').trim() || null,
    };
  });
  return { entries, note: typeof raw.note === 'string' ? raw.note : null };
}

/** 读取登记表；文件不存在按「无过期模型」处理（新环境/纯算法环境的正常状态）。 */
export function loadModelStatus(file = DEFAULT_STATUS_FILE) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { entries: [], note: null, file };
    throw new Error(`${file}: 读取失败（${err.message}）`);
  }
  return { ...parseModelStatus(text, file), file };
}

/** 过期名单按版本索引，供各脚本给 registry 打 status。 */
export function expiredByVersion(file = DEFAULT_STATUS_FILE) {
  return new Map(loadModelStatus(file).entries.map(e => [e.version, e]));
}

/** 判断一个模型文件名（或纯版本号）是否已过期。 */
export function isExpiredModel(nameOrVersion, entries = loadModelStatus().entries) {
  const version = String(nameOrVersion ?? '').startsWith('v')
    ? String(nameOrVersion)
    : versionOfModelFile(nameOrVersion);
  return version !== null && entries.some(e => e.version === version);
}

/**
 * 作废（retired）名单：镜像 rl/docs/MODELS_NOTES.md「模型状态总表」，两处需人工同步维护。
 * 作废模型不进排行榜：注册表跳过（也不进「未参评」区），历史对局不计分，只按计数留痕。
 */
export const MODEL_STATUS_BY_VERSION = {
  'v3.0.3': 'recommended',
  'v2.1.1': 'retired',
  'v2.1.4': 'retired',
  'v2.1.5': 'retired',
  'v2.1.6': 'retired',
  'v2.1.8': 'retired',
};

export const RETIRED_VERSIONS = new Set(
  Object.entries(MODEL_STATUS_BY_VERSION)
    .filter(([, status]) => status === 'retired')
    .map(([version]) => version),
);

/**
 * 过期与作废互斥：同一版本出现在两份名单时，status 三元会偏向 expired（照常参评），
 * 而 loadMatches 又会按 retired 把它的对局整局丢弃——两种语义互相抵消，必须拒绝。
 * 源头拦截在 expireArenaModels 的 --expire；generateArenaLeaderboard 启动时调用本断言
 * 兜底手工编辑过的登记表。断言只在榜单脚本启动时执行、不放进本模块加载期——
 * --restore 要能处理双登记的登记表，不能在 import 期就把它锁死。
 */
export function assertExpiredRetiredDisjoint(expiredVersions, retiredVersions) {
  const clash = [...expiredVersions].filter(version => retiredVersions.has(version));
  if (clash.length) {
    throw new Error(`arena/model-status.json：版本 ${clash.join(', ')} 同时登记为过期与作废（互斥，先 --restore 撤销其一）`);
  }
}
