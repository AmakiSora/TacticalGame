// npm script 入口：定位 rl/.venv 的 pytest 解释器并透传参数（npm run test:rl -- -k xxx）。
// cmd 无法执行正斜杠相对路径命令，所以不能把 rl/.venv/Scripts/python.exe
// 直接写进 package.json；由 node 自己解析路径，cmd / PowerShell / Git Bash 均可用。
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const win = process.platform === 'win32';
const python = join(root, 'rl', '.venv', win ? 'Scripts' : 'bin', win ? 'python.exe' : 'python');

if (!existsSync(python)) {
  console.error(`未找到 RL 虚拟环境解释器：${python}`);
  console.error('先创建：python -m venv rl/.venv && rl/.venv/Scripts/python.exe -m pip install -r rl/requirements.txt');
  process.exit(1);
}

const result = spawnSync(python, ['-m', 'pytest', 'tests/rl', '-q', ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: root,
});
process.exit(result.status ?? 1);
