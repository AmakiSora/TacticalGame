import { readFileSync } from 'node:fs';
import { createContext, Script } from 'node:vm';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

const PLAYER_CLIENTS = ['public/play.js', 'public/play-m.js'];
const PLAYER_PAGES = ['public/play.html', 'public/play-m.html'];
const PLAYER_STYLES = ['public/play.css', 'public/play-m.css'];

// 操作提示里的行动点上限必须随对局配置走：地图支持 1/4/5/7/8 点（随机地图还可变），
// 写死「5」会与规则速查弹层里的实时数值自相矛盾。切出真实 renderActionHint 受控执行。

describe('action point hint stays in sync with the live config', () => {
  it('no longer hardcodes the action point count in the player pages', () => {
    for (const file of PLAYER_PAGES) {
      const html = read(file);
      expect(html, file).not.toContain('每回合最多 5 点');
      expect(html, file).toContain('data-hint-ap');
    }
  });

  it('binds the hint to actionsPerTurn() on both player clients', () => {
    for (const file of PLAYER_CLIENTS) {
      const source = read(file);
      expect(source).toContain('function renderActionHint()');
      expect(source).toContain("document.querySelectorAll('#action-hints [data-hint-ap]')");
      // renderSidebar 是每次状态刷新都会走到的渲染入口，提示需在此更新。
      const sidebarStart = source.indexOf('function renderSidebar()');
      expect(sidebarStart, file).toBeGreaterThan(-1);
      const sidebarHead = source.slice(sidebarStart, sidebarStart + 120);
      expect(sidebarHead, file).toContain('renderActionHint();');
    }
  });

  it('styles the live value in both player stylesheets', () => {
    for (const file of PLAYER_STYLES) {
      expect(read(file), file).toContain('.hint-ap {');
    }
  });

  it('writes the current config value into every hint placeholder', () => {
    for (const file of PLAYER_CLIENTS) {
      const source = read(file);
      const start = source.indexOf('function renderActionHint()');
      expect(start, `${file} 应包含 renderActionHint`).toBeGreaterThan(-1);
      const end = source.indexOf('\n}', start);
      const fnSource = source.slice(start, end + 2);
      const written: string[] = [];
      const context = createContext({
        actionsPerTurn: () => 7,
        document: { querySelectorAll: () => [{ set textContent(v: string) { written.push(v); } }] },
      });
      new Script(`(${fnSource})()`).runInContext(context);
      expect(written, file).toEqual(['7']);
    }
  });

  it('falls back to a dash before a config is available', () => {
    for (const file of PLAYER_CLIENTS) {
      const source = read(file);
      const start = source.indexOf('function renderActionHint()');
      const end = source.indexOf('\n}', start);
      const fnSource = source.slice(start, end + 2);
      const written: string[] = [];
      const context = createContext({
        actionsPerTurn: () => 0,
        document: { querySelectorAll: () => [{ set textContent(v: string) { written.push(v); } }] },
      });
      new Script(`(${fnSource})()`).runInContext(context);
      expect(written, file).toEqual(['—']);
    }
  });
});
