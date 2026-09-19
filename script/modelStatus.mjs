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
 * 本文件是过期名单的唯一事实来源，JS 脚本 / 服务端 TS / Python 编排器都读这一份，
 * 任何地方都不要另外写死版本名单（作废名单仍是 generateArenaLeaderboard 的
 * MODEL_STATUS_BY_VERSION，两者互不覆盖）。人读的说明在 rl/docs/MODELS_NOTES.md。
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
 * 悄悄重新回到评估池，比启动失败更糟。
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
    const version = String(item.version ?? '');
    const file = String(item.file ?? '');
    if (!/^v\d+\.\d+\.\d+$/.test(version)) throw new Error(`${at}: version 需形如 v3.0.3，实际 ${JSON.stringify(item.version)}`);
    if (!file.endsWith('.zip')) throw new Error(`${at}: file 需是 .zip 文件名，实际 ${JSON.stringify(item.file)}`);
    if (versionOfModelFile(file) !== version) throw new Error(`${at}: file 的版本段与 version 不一致（${file} vs ${version}）`);
    if (seen.has(version)) throw new Error(`${at}: 版本 ${version} 重复登记`);
    seen.add(version);
    if (!DATE_RE.test(String(item.expiredAt ?? ''))) throw new Error(`${at}: expiredAt 需形如 2026-09-19`);
    const reason = String(item.reason ?? '').trim();
    if (!reason) throw new Error(`${at}: reason 不能为空`);
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
