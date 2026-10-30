#!/usr/bin/env node
// stats-all 编排：回放解析只做一次，generateStats 把 matches 落临时文件，
// generateFunStats 直接复用；arena 两条链路保持独立。
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = dirname(SCRIPT_DIR);
const node = process.execPath;
const matchesFile = join(PROJECT_DIR, 'temp', 'stats-matches.json');
mkdirSync(dirname(matchesFile), { recursive: true });

const steps = [
  ['script/generateStats.mjs', '--dump-matches', matchesFile],
  ['script/generateFunStats.mjs', '--matches-file', matchesFile],
  ['script/generateArenaLeaderboard.mjs'],
  ['script/generateArenaStats.mjs'],
  ['script/generateArenaMapFingerprint.mjs'],
];

for (const [script, ...args] of steps) {
  const result = spawnSync(node, [join(PROJECT_DIR, script), ...args], {
    cwd: PROJECT_DIR,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
