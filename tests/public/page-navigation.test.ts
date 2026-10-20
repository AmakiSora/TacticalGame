import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function navigationOf(html: string): string {
  return html.match(/<nav class="page-nav"[\s\S]*?<\/nav>/)?.[0] ?? '';
}

const DESKTOP_PAGES = [
  'public/index.html',
  'public/play.html',
  'public/spectator.html',
  'public/map-editor.html',
  'public/stats.html',
  'public/arena.html',
  'public/entertainment.html',
];

// 顶栏导航的唯一标准顺序，所有桌面页必须一致（新增页面时同步这里）。
const NAV_ENTRIES = [
  '/',
  '/play.html',
  '/spectator.html',
  '/map-editor.html',
  '/stats.html',
  '/arena.html',
  '/entertainment.html',
];

function navLinksOf(html: string): string[] {
  return [...navigationOf(html).matchAll(/<a href="([^"]+)"/g)].map((match) => match[1]);
}

describe('desktop page navigation', () => {
  it('lists the same page entries in the same order on every desktop page', () => {
    for (const path of DESKTOP_PAGES) {
      expect(navLinksOf(read(path)), path).toEqual(NAV_ENTRIES);
    }
  });

  it('links every desktop page back to the homepage, which marks itself active', () => {
    for (const path of DESKTOP_PAGES) {
      expect(navigationOf(read(path))).toContain('href="/"');
    }
    expect(navigationOf(read('public/index.html'))).toContain('href="/" class="active"');
  });

  it('uses the same navigation states on all three pages', () => {
    const pages = [
      ['public/play.html', '/play.html'],
      ['public/spectator.html', '/spectator.html'],
      ['public/stats.html', '/stats.html'],
    ];

    for (const [path, currentHref] of pages) {
      const nav = navigationOf(read(path));
      expect(nav).toContain(`href="${currentHref}" class="active"`);
      expect(nav).not.toContain('style=');
    }
  });

  it('keeps the nav a top-level header child instead of nesting it in a tools row', () => {
    for (const path of DESKTOP_PAGES) {
      const header = read(path).match(/<header>[\s\S]*?<\/header>/)?.[0] ?? '';

      expect(header, path).toContain('<nav class="page-nav"');
      // 导航若被塞回工具行，右侧按钮就会把它推离页面正中。
      expect(header, path).not.toMatch(/class="header-actions"|class="header-right"|id="editor-meta"/);
      expect(header, path).toMatch(/<div class="brand-block">[\s\S]*<nav class="page-nav"/);
    }
  });

  it('pins the nav to the middle column of every desktop header', () => {
    const stylesheets = [
      'public/style.css',
      'public/play.css',
      'public/index.css',
      'public/stats.css',
    ];

    for (const path of stylesheets) {
      const css = read(path);

      expect(css, path).toMatch(/header\s*{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*1fr auto 1fr;/s);
      expect(css, path).toMatch(/\.page-nav\s*{[^}]*justify-self:\s*center;/s);
    }
  });

  it('keeps the spectator toolbar flat instead of nesting button frames', () => {
    const css = read('public/style.css');

    expect(css).toMatch(/\.toolbar-group\s*{[^}]*background:\s*transparent;[^}]*border:\s*0;/s);
    expect(css).toContain('.file-tools::before');
    expect(css).toContain('.settings-tools::before');
  });
});
