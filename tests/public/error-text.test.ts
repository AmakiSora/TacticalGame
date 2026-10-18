import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

type ErrorText = { describe: (error: unknown, fallback?: string) => string };

// 浏览器里是 window.ErrorText，这里用 vm 造一个最小的 window 跑同一份源码。
function loadHelper(): ErrorText {
  const context: any = { window: {} };
  vm.createContext(context);
  vm.runInContext(read('public/error-text.js'), context);
  return context.window.ErrorText;
}

describe('client error text', () => {
  it('turns browser / network English into Chinese', () => {
    const { describe } = loadHelper();

    expect(describe(new Error('Failed to fetch'))).toBe('网络连接失败，请确认服务端是否在线');
    expect(describe(new TypeError('NetworkError when attempting to fetch resource.'))).toBe('网络连接失败，请确认服务端是否在线');
    expect(describe(new SyntaxError('Unexpected token < in JSON at position 0'))).toBe('服务端返回的数据无法解析');
    expect(describe('HTTP 401')).toBe('没有权限（HTTP 401）');
    expect(describe('HTTP 403')).toBe('没有权限（HTTP 403）');
    expect(describe('HTTP 404')).toBe('找不到请求的数据（HTTP 404）');
    expect(describe('HTTP 500')).toBe('服务端返回 HTTP 500');
    expect(describe('AbortError')).toBe('请求已取消');
  });

  it('keeps Chinese text and falls back only when there is nothing to show', () => {
    const { describe } = loadHelper();

    // 服务端文案已经是中文，原样透传，不再包装。
    expect(describe(new Error('对局已结束'))).toBe('对局已结束');
    expect(describe('random.seed 必须是数字或字符串')).toBe('random.seed 必须是数字或字符串');
    expect(describe('')).toBe('未知错误');
    expect(describe(null, '网络错误')).toBe('网络错误');
  });

  it('is wired into every client that used to print err.message', () => {
    const clients = [
      'public/stats.js',
      'public/entertainment.js',
      'public/arena.js',
      'public/arena-stats.js',
      'public/map-editor.js',
      'public/app.js',
      'public/spectator-m.js',
      'public/random-map-ui.js',
    ];
    for (const path of clients) {
      const source = read(path);
      expect(source, `${path} 未引入错误文案转换`).toContain("import './error-text.js';");
      expect(source, `${path} 未使用共享转换`).toContain('window.ErrorText.describe(');
    }
    // 任何客户端都不该再把 err.message 原样拼进界面文本。
    for (const name of readdirSync('public').filter(file => file.endsWith('.js'))) {
      const source = read(`public/${name}`);
      expect(source, `public/${name} 仍在直接显示 err.message`).not.toMatch(/\$\{(?:err|error)\.message\}/);
      expect(source, `public/${name} 仍在直接显示 err.message`).not.toMatch(/(?:err|error)\.message \|\|/);
    }
  });
});
