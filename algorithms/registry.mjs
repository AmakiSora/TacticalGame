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
 * 获取算法的元数据（不加载模块本身）
 * @param {string} name - 算法名称
 * @returns {{name: string, path: string} | null}
 */
export function getAlgorithmMeta(name) {
  const path = ALGORITHMS[name];
  if (!path) return null;
  return { name, path };
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
