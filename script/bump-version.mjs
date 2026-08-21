#!/usr/bin/env node
/**
 * 统一版本号变更脚本。
 *
 * 应用版本号分散在 package.json、package-lock.json、public/version.js、README.md、
 * skill/SKILL.md、测试断言等多处，手工逐个修改容易漏改导致 CI 失败（参见
 * tests/public/import-export.test.ts 与 tests/skill/ai-player.test.ts 的版本一致性断言）。
 * 以后所有版本变更一律通过本脚本完成。
 *
 * 用法：
 *   node script/bump-version.mjs <version>   提升所有版本引用到 <version>（如 3.2.14）
 *   node script/bump-version.mjs             以 package.json 当前版本为准，同步其余所有位置（--sync 等价）
 *   node script/bump-version.mjs --check     只校验所有位置是否一致，不写文件；不一致时退出码为 1
 *
 * 也可以经 npm 调用：npm run check-version / npm run sync-version；
 * `npm version <x>` 会自动通过 version 生命周期钩子触发同步。
 */

import { existsSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEMVER = String.raw`\d+\.\d+\.\d+`;
const SEMVER_RE = new RegExp(`^${SEMVER}$`);

/** 每个位置提供 read（解析当前版本）与 write（替换为目标版本）。 */
const TARGETS = [
  {
    label: 'package.json',
    file: 'package.json',
    read: text => JSON.parse(text).version,
    write: (text, version) => {
      const pkg = JSON.parse(text);
      pkg.version = version;
      return `${JSON.stringify(pkg, null, 2)}\n`;
    },
  },
  {
    label: 'package-lock.json',
    file: 'package-lock.json',
    read: text => JSON.parse(text).version,
    write: (text, version) => {
      const lock = JSON.parse(text);
      lock.version = version;
      lock.packages[''].version = version;
      return `${JSON.stringify(lock, null, 2)}\n`;
    },
  },
  {
    label: 'public/version.js',
    file: 'public/version.js',
    read: text => firstCapture(text, new RegExp(String.raw`window\.APP_VERSION = '(${SEMVER})'`)),
    write: (text, version) =>
      replaceVersion(text, new RegExp(String.raw`(window\.APP_VERSION = ')${SEMVER}(')`), version),
  },
  {
    label: 'README.md',
    file: 'README.md',
    read: text => firstCapture(text, new RegExp(String.raw`当前版本：\`(${SEMVER})\``)),
    write: (text, version) =>
      replaceVersion(text, new RegExp(String.raw`(当前版本：\`)${SEMVER}(\`)`), version),
  },
  {
    label: 'skill/SKILL.md',
    file: 'skill/SKILL.md',
    read: text => firstCapture(text, new RegExp(String.raw`app version \`(${SEMVER})\``)),
    write: (text, version) =>
      replaceVersion(text, new RegExp(String.raw`(app version \`)${SEMVER}(\`)`), version),
  },
  {
    label: '.qoder/skills/play-hex-api-game/SKILL.md（skill 的 IDE 拷贝）',
    file: '.qoder/skills/play-hex-api-game/SKILL.md',
    optional: true,
    read: text => firstCapture(text, new RegExp(String.raw`app version \`(${SEMVER})\``)),
    write: (text, version) =>
      replaceVersion(text, new RegExp(String.raw`(app version \`)${SEMVER}(\`)`), version),
  },
  {
    label: 'tests/public/import-export.test.ts',
    file: 'tests/public/import-export.test.ts',
    read: text => firstCapture(text, new RegExp(String.raw`const expectedAppVersion = '(${SEMVER})'`)),
    write: (text, version) =>
      replaceVersion(text, new RegExp(String.raw`(const expectedAppVersion = ')${SEMVER}(')`), version),
  },
];

function firstCapture(text, re) {
  const match = text.match(re);
  return match ? match[1] : null;
}

function replaceVersion(text, re, version) {
  if (!re.test(text)) throw new Error(`替换目标未匹配到：${re}`);
  return text.replace(re, `$1${version}$2`);
}

function resolveFile(rel) {
  return path.join(ROOT, ...rel.split('/'));
}

/** 读取每个位置的当前版本；不存在且 optional 的位置跳过。 */
async function collectVersions() {
  const found = [];
  for (const target of TARGETS) {
    const abs = resolveFile(target.file);
    if (!existsSync(abs)) {
      if (target.optional) continue;
      throw new Error(`必需文件缺失：${target.file}`);
    }
    const text = await readFile(abs, 'utf8');
    found.push({ target, abs, text, version: target.read(text) });
  }
  return found;
}

/** public/*.html 中脚本缓存参数只提升与旧应用版本一致的那些（如 app.js?v=3.2.13），
 *  board-animation.js?v=3.2.6 这类独立维护的参数保持不动。 */
async function bumpHtmlCacheBust(oldVersion, newVersion) {
  const publicDir = path.join(ROOT, 'public');
  const changed = [];
  const files = (await readdir(publicDir)).filter(name => name.endsWith('.html'));
  const paramRe = new RegExp(String.raw`(\?v=)${oldVersion.replaceAll('.', String.raw`\.`)}(?=["'])`, 'g');
  for (const name of files) {
    const abs = path.join(publicDir, name);
    const text = await readFile(abs, 'utf8');
    if (!paramRe.test(text)) continue;
    paramRe.lastIndex = 0;
    const updated = text.replace(paramRe, `$1${newVersion}`);
    await writeFile(abs, updated, 'utf8');
    changed.push(`public/${name}`);
  }
  return changed;
}

/** 提升版本时若 RELEASE_NOTES.md 还没有新版本小节，在最新小节之前插入占位。 */
async function ensureReleaseNotesSection(version) {
  const abs = resolveFile('RELEASE_NOTES.md');
  const text = await readFile(abs, 'utf8');
  if (new RegExp(String.raw`^## ${version.replaceAll('.', String.raw`\.`)}\s*$`, 'm').test(text)) {
    return false;
  }
  const idx = text.search(/^## /m);
  if (idx === -1) throw new Error('RELEASE_NOTES.md 中找不到已有的版本小节');
  const updated = `${text.slice(0, idx)}## ${version}\n\n- TODO 补充本版本改动\n\n${text.slice(idx)}`;
  await writeFile(abs, updated, 'utf8');
  return true;
}

function printReport(title, entries, baseline) {
  console.log(title);
  for (const { target, version } of entries) {
    const ok = version === baseline;
    console.log(`  ${ok ? 'OK  ' : 'DRIFT'} ${target.label}: ${version ?? '(无法解析)'}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] === '--check' ? 'check' : args[0] === '--sync' || args.length === 0 ? 'sync' : 'bump';

  const entries = await collectVersions();
  const packageEntry = entries.find(e => e.target.file === 'package.json');
  if (!packageEntry?.version) throw new Error('package.json 中读取不到 version');
  const baseline = packageEntry.version;

  if (mode === 'check') {
    printReport(`版本一致性检查（基准：package.json ${baseline}）`, entries, baseline);
    const drifted = entries.filter(e => e.version !== baseline);
    if (drifted.length > 0) {
      console.error(`\n发现 ${drifted.length} 处版本不一致，请运行：node script/bump-version.mjs（同步）或 node script/bump-version.mjs <version>（提升）。`);
      process.exit(1);
    }
    console.log('\n所有版本引用一致。');
    return;
  }

  const targetVersion = mode === 'bump' ? args[0] : baseline;
  if (!SEMVER_RE.test(targetVersion)) {
    throw new Error(`无效的版本号：${targetVersion}（应为 x.y.z）`);
  }
  if (mode === 'bump' && targetVersion === baseline) {
    throw new Error(`目标版本 ${targetVersion} 与当前版本相同，无需提升`);
  }

  let changed = 0;
  for (const entry of entries) {
    if (entry.version === targetVersion) continue;
    await writeFile(entry.abs, entry.target.write(entry.text, targetVersion), 'utf8');
    console.log(`已更新 ${entry.target.file}: ${entry.version ?? '?'} -> ${targetVersion}`);
    changed += 1;
  }

  if (mode === 'bump') {
    const htmlFiles = await bumpHtmlCacheBust(baseline, targetVersion);
    for (const file of htmlFiles) {
      console.log(`已提升 ${file} 的脚本缓存参数 ?v=${baseline} -> ?v=${targetVersion}`);
    }
    if (await ensureReleaseNotesSection(targetVersion)) {
      console.log(`已在 RELEASE_NOTES.md 插入 ${targetVersion} 占位小节，请补充改动说明`);
    }
  }

  if (changed === 0) {
    console.log(`所有版本引用均已是 ${targetVersion}，无需修改。`);
  } else {
    console.log(`\n完成：共更新 ${changed} 个文件到 ${targetVersion}。请记得提交前跑一遍 npm test。`);
  }
}

main().catch(error => {
  console.error(`bump-version 失败：${error.message}`);
  process.exit(1);
});
