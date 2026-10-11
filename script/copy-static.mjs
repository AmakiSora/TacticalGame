#!/usr/bin/env node
/**
 * 构建后补拷纯静态资源到 dist-public。
 *
 * Vite 配置 publicDir: false（root 本身是源码目录，不能整目录拷贝），
 * 但 public/icons/、public/data/ 是不经构建的静态资源，生产的
 * dist-public 同样需要按原路径提供。此脚本在 vite build 之后运行
 * （npm run build:frontend 已串联），保持三种运行模式的 URL 一致：
 *   - dev 后端直接托管 public/
 *   - vite dev 由 root 内文件直接命中
 *   - 生产托管 dist-public/
 */
import { cp, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'public');
const DEST = path.join(ROOT, 'dist-public');

const STATIC_DIRS = ['icons', 'data'];

for (const dir of STATIC_DIRS) {
  const from = path.join(SRC, dir);
  try {
    await access(from);
  } catch {
    console.warn(`跳过不存在的静态目录：${dir}`);
    continue;
  }
  await cp(from, path.join(DEST, dir), { recursive: true });
  console.log(`已拷贝 public/${dir} -> dist-public/${dir}`);
}
