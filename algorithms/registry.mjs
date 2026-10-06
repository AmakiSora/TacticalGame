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
  'random-sim': './builtin/random-sim.mjs',
};

/**
 * 算法展示元数据（displayName/description/version/modes）。
 * 这是算法中文名、描述、**当前版本**与**支持模式**的唯一来源：线上 bot 清单
 * （src/api/bots.ts）、竞技场排行榜与评估控制台（script/generateArenaLeaderboard.mjs、
 * /api/arena/*）都从这里取，勿再另立清单（历史上双份同步出过前后端选项不一致的问题）。
 *
 * modes 声明算法可参与的对局模式（standard / simultaneous / royale / annihilation），
 * 全链路强制隔离、不同模式不能混用：大厅 bot 接口（src/api/bots.ts）、REST runner
 * （algorithms/runner.mjs）、进程内评估 decide 通道（rl/training/local-worker.ts）
 * 与竞技场跑批发现（rl/evaluation/round_robin.py）都按它校验/过滤。缺省视为
 * ['standard']。
 *
 * version 是算法的"当前版本"标注，进入竞技场参与者 id（algo_<name>@<version>）：
 * 算法实现被改进后升版时改这里（如 'v1' → 'v2'），此后新对局记在新版本 id 下，
 * 历史战绩仍归属旧版本 id。注意旧版本 id 必须继续在榜单注册表里可解析——若旧版
 * 实现不再保留，需像模型退役（RETIRED_VERSIONS）一样显式处理，否则其历史对局会
 * 因"未知参与者"被 loadMatches 过滤掉。
 */
export const ALGORITHM_META = {
  greedy: { displayName: '贪心算法', description: '攻击 > 治疗 > 爆破 > 部署 > 移动', version: 'v1', modes: ['standard'] },
  random: { displayName: '随机算法', description: '从所有合法动作中随机选择', version: 'v1', modes: ['standard'] },
  mcts: { displayName: '蒙特卡洛树搜索', description: '蒙特卡洛树搜索：模拟推演选择最优动作', version: 'v1', modes: ['standard'] },
  threat: { displayName: '威胁感知算法', description: '威胁图统一效用评估：集火斩杀、避险走位', version: 'v1', modes: ['standard'] },
  field: { displayName: '势场算法', description: '连续势场塑形：斥力井+引力井，风筝走位、分头抢点', version: 'v1', modes: ['standard'] },
  verdict: { displayName: '裁决线算法', description: '从终局倒推攻城排程与期限，全动作按裁决分计价', version: 'v1', modes: ['standard'] },
  'random-sim': { displayName: '同时随机算法', description: '同时回合：从所有合法计划动作中随机选择入队，随后提交', version: 'v1', modes: ['simultaneous'] },
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
 * @returns {Array<{name: string, displayName: string, description: string, version: string, modes: string[]}>}
 */
export function listAlgorithmInfo() {
  return listAlgorithms().map(name => ({
    name,
    displayName: ALGORITHM_META[name]?.displayName ?? name,
    description: ALGORITHM_META[name]?.description ?? '',
    version: algorithmVersion(name),
    modes: algorithmModes(name),
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
 * 算法声明支持的对局模式（未显式标注视为仅标准模式）。
 * @param {string} name - 算法名称
 * @returns {string[]}
 */
export function algorithmModes(name) {
  const modes = ALGORITHM_META[name]?.modes;
  return Array.isArray(modes) && modes.length ? modes : ['standard'];
}

/**
 * 算法是否支持指定对局模式（不同模式不能混用算法的判定口径）。
 * @param {string} name - 算法名称
 * @param {string} mode - 对局模式（standard / simultaneous / royale / annihilation）
 * @returns {boolean}
 */
export function algorithmSupportsMode(name, mode) {
  return algorithmModes(name).includes(mode);
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
 * @returns {{name: string, path: string, displayName: string, description: string, version: string, modes: string[]} | null}
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
    modes: algorithmModes(name),
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
