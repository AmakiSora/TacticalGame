// algorithms/registry.mjs
//
// 算法注册表：管理所有可用的算法

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * 已注册的算法映射表
 * key: 算法名称
 * value: 算法模块路径（相对于 algorithms/ 目录）
 */
export const ALGORITHMS = {
  greedy: './builtin/greedy.mjs',
  random: './builtin/random.mjs',
  mcts: './builtin/mcts.mjs',
  threat: './builtin/threat.mjs',
  field: './builtin/field.mjs',
  verdict: './builtin/verdict.mjs',
};

/**
 * 算法展示元数据（displayName/description/version）。
 * 这是算法中文名、描述与**当前版本**的唯一来源：线上 bot 清单（src/api/bots.ts）、
 * 竞技场排行榜与评估控制台（script/generateArenaLeaderboard.mjs、/api/arena/*）
 * 都从这里取，勿再另立清单（历史上双份同步出过前后端选项不一致的问题）。
 *
 * version 是算法的"当前版本"标注，进入竞技场参与者 id（algo_<name>@<version>）：
 * 算法实现被改进后升版时改这里（如 'v1' → 'v2'），此后新对局记在新版本 id 下，
 * 历史战绩仍归属旧版本 id。注意旧版本 id 必须继续在榜单注册表里可解析——若旧版
 * 实现不再保留，需像模型退役（RETIRED_VERSIONS）一样显式处理，否则其历史对局会
 * 因"未知参与者"被 loadMatches 过滤掉。
 */
export const ALGORITHM_META = {
  greedy: { displayName: '贪心算法', description: '攻击 > 治疗 > 爆破 > 部署 > 移动', version: 'v1' },
  random: { displayName: '随机算法', description: '从所有合法动作中随机选择', version: 'v1' },
  mcts: { displayName: '蒙特卡洛树搜索', description: '蒙特卡洛树搜索：模拟推演选择最优动作', version: 'v1' },
  threat: { displayName: '威胁感知算法', description: '威胁图统一效用评估：集火斩杀、避险走位', version: 'v1' },
  field: { displayName: '势场算法', description: '连续势场塑形：斥力井+引力井，风筝走位、分头抢点', version: 'v1' },
  verdict: { displayName: '裁决线算法', description: '从终局倒推攻城排程与期限，全动作按裁决分计价', version: 'v1' },
};

/**
 * 加载指定的算法模块
 * @param {string} name - 算法名称
 * @returns {Promise<object>} 算法模块的 default export
 * @throws {Error} 如果算法不存在
 */
export async function loadAlgorithm(name) {
  const relativePath = ALGORITHMS[name];
  if (!relativePath) {
    const available = Object.keys(ALGORITHMS).join(', ');
    throw new Error(
      `Unknown algorithm: "${name}". Available algorithms: ${available}`
    );
  }

  const fullPath = join(__dirname, relativePath);
  // Windows 需要 file:// URL
  const fileUrl = new URL(`file:///${fullPath.replace(/\\/g, '/')}`);
  const module = await import(fileUrl.href);

  if (!module.default) {
    throw new Error(
      `Algorithm module "${relativePath}" must export a default object`
    );
  }

  return module.default;
}

/**
 * 列出所有可用的算法
 * @returns {Array<string>} 算法名称数组
 */
export function listAlgorithms() {
  return Object.keys(ALGORITHMS);
}

/**
 * 列出算法及其展示元数据（未配置 meta 的算法回退为注册名）。
 * @returns {Array<{name: string, displayName: string, description: string, version: string}>}
 */
export function listAlgorithmInfo() {
  return listAlgorithms().map(name => ({
    name,
    displayName: ALGORITHM_META[name]?.displayName ?? name,
    description: ALGORITHM_META[name]?.description ?? '',
    version: algorithmVersion(name),
  }));
}

/**
 * 算法当前版本（未显式标注 meta 的算法视为 v1）。
 * @param {string} name - 算法名称
 * @returns {string}
 */
export function algorithmVersion(name) {
  return ALGORITHM_META[name]?.version ?? 'v1';
}

/**
 * 线上算法 bot 的 bot type（algo_greedy 等），永远指向当前实现，不带版本。
 * 与评估控制台的 `algo:<注册名>` 规格同属"当前版本"空间。
 * @param {string} name - 算法名称
 * @returns {string}
 */
export function algorithmParticipantId(name) {
  return `algo_${name}`;
}

/**
 * 算法在竞技场评估记录（arena/matches.jsonl）、榜单与统计中的参与者 id，
 * 带版本（algo_greedy@v1）：算法升版后历史对局仍归属旧版本 id，
 * 与模型"每个 zip 一个版本一个参与者"的口径对齐。
 * 由 rl/evaluation/round_robin.py 经 discover_algorithms 读取并写入对局记录。
 * @param {string} name - 算法名称
 * @returns {string}
 */
export function algorithmVersionedId(name) {
  return `algo_${name}@${algorithmVersion(name)}`;
}

/**
 * 获取算法的元数据（不加载模块本身）
 * @param {string} name - 算法名称
 * @returns {{name: string, path: string, displayName: string, description: string, version: string} | null}
 */
export function getAlgorithmMeta(name) {
  const path = ALGORITHMS[name];
  if (!path) return null;
  return {
    name,
    path,
    displayName: ALGORITHM_META[name]?.displayName ?? name,
    description: ALGORITHM_META[name]?.description ?? '',
    version: algorithmVersion(name),
  };
}

/**
 * 注册新算法（用于外部扩展）
 * @param {string} name - 算法名称
 * @param {string} path - 模块路径（相对于 algorithms/ 目录）
 */
export function registerAlgorithm(name, path) {
  if (ALGORITHMS[name]) {
    console.warn(`Algorithm "${name}" is already registered, overwriting...`);
  }
  ALGORITHMS[name] = path;
}
