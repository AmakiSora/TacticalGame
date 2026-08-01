import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function navigationOf(html: string): string {
  return html.match(/<nav class="page-nav"[\s\S]*?<\/nav>/)?.[0] ?? '';
}

describe('desktop page navigation', () => {
  it('connects the player, spectator and stats pages without redirecting spectator to spectator2', () => {
    const playNav = navigationOf(read('public/play.html'));
    const spectatorNav = navigationOf(read('public/spectator.html'));

    expect(playNav).toContain('href="/spectator.html"');
    expect(playNav).toContain('href="/stats.html"');
    expect(playNav).not.toContain('href="/spectator2.html"');
    expect(spectatorNav).toContain('href="/play.html"');
    expect(spectatorNav).toContain('href="/stats.html"');
  });

  it('keeps every desktop page entry available from stats', () => {
    const statsNav = navigationOf(read('public/stats.html'));

    for (const href of [
      '/play.html',
      '/spectator.html',
      '/spectator2.html',
      '/map-editor.html',
      '/stats.html',
    ]) {
      expect(statsNav).toContain(`href="${href}"`);
    }
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

  it('keeps the spectator toolbar flat instead of nesting button frames', () => {
    const css = read('public/style.css');

    expect(css).toMatch(/\.toolbar-group\s*{[^}]*background:\s*transparent;[^}]*border:\s*0;/s);
    expect(css).toContain('.file-tools::before');
    expect(css).toContain('.settings-tools::before');
  });
});
