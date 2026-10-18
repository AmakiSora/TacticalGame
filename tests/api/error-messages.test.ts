import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name).replace(/\\/g, '/');
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

// 地图文件校验是给地图作者看的诊断（启动日志 / 测试输出），不走界面，保留英文。
const ENGLISH_DIAGNOSTICS = new Set(['src/config/loader.ts']);

describe('player-facing api messages', () => {
  it('are written in Chinese instead of the bare English diagnostics', () => {
    const offenders: string[] = [];
    for (const file of walk('src')) {
      if (ENGLISH_DIAGNOSTICS.has(file)) continue;
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/\b(?:message|error):\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g)) {
        const literal = match[2];
        if (!/[A-Za-z]/.test(literal)) continue;       // 纯中文 / 纯符号
        if (/[\u4e00-\u9fa5]/.test(literal)) continue; // 已含中文
        offenders.push(`${file}: ${JSON.stringify(literal)}`);
      }
    }
    expect(offenders, `仍有英文提示：\n${offenders.join('\n')}`).toEqual([]);
  });

  it('keeps the codes English and the messages Chinese', () => {
    const engine = readFileSync('src/engine/engine.ts', 'utf8');
    expect(engine).toContain("code: 'lobby_not_ready', message: '至少需要 2 名玩家'");
    expect(engine).toContain("code: 'game_already_full', message: '房间已满'");

    const auth = readFileSync('src/api/auth.ts', 'utf8');
    expect(auth).toContain("code: 'game_not_found' }");
    expect(auth).toContain('找不到该对局');

    const actions = readFileSync('src/api/actions.ts', 'utf8');
    expect(actions).toContain("code: 'not_your_turn' }");
    expect(actions).toContain('还没轮到你');
  });
});
