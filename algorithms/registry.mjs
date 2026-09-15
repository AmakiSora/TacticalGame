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
};

/**
 * 算法展示元数据（displayName/description）。
 * 这是算法中文名与描述的**唯一来源**：线上 bot 清单（src/api/bots.ts）、
 * 竞技场排行榜与评估控制台（script/generateArenaLeaderboard.mjs、/api/arena/*）
 * 都从这里取，勿再另立清单（历史上双份同步出过前后端选项不一致的问题）。
 */
export const ALGORITHM_META = {
  greedy: { displayName: '贪心算法', description: '攻击 > 治疗 > 爆破 > 部署 > 移动' },
  random: { displayName: '随机算法', description: '从所有合法动作中随机选择' },
  mcts: { displayName: '蒙特卡洛树搜索', description: '蒙特卡洛树搜索：模拟推演选择最优动作' },
  threat: { displayName: '威胁感知算法', description: '威胁图统一效用评估：集火斩杀、避险走位' },
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
 * @returns {Array<{name: string, displayName: string, description: string}>}
 */
export function listAlgorithmInfo() {
  return listAlgorithms().map(name => ({
    name,
    displayName: ALGORITHM_META[name]?.displayName ?? name,
    description: ALGORITHM_META[name]?.description ?? '',
  }));
}

/**
 * 算法在竞技场评估记录（arena/matches.jsonl）与榜单注册表中的参与者 id。
 * 与 src/api/bots.ts 的 bot type（algo_greedy 等）保持一致。
 * @param {string} name - 算法名称
 * @returns {string}
 */
export function algorithmParticipantId(name) {
  return `algo_${name}`;
}

/**
 * 获取算法的元数据（不加载模块本身）
 * @param {string} name - 算法名称
 * @returns {{name: string, path: string, displayName: string, description: string} | null}
 */
export function getAlgorithmMeta(name) {
  const path = ALGORITHMS[name];
  if (!path) return null;
  return {
    name,
    path,
    displayName: ALGORITHM_META[name]?.displayName ?? name,
    description: ALGORITHM_META[name]?.description ?? '',
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
