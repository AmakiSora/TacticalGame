import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf-8');
}

describe('layout editor', () => {
  it('offers layout editing entry in settings on player and spectator pages', () => {
    for (const file of ['public/play.html', 'public/spectator.html']) {
      const html = read(file);
      expect(html).toContain('id="btn-edit-layout"');
      expect(html).toContain('改变布局');
      expect(html).toContain('/layout-editor.js');
      expect(html).toContain('/layout-editor.css');
    }
  });

  it('does not enable layout editing on mobile pages', () => {
    for (const file of ['public/play-m.html', 'public/spectator-m.html']) {
      const html = read(file);
      expect(html).not.toContain('/layout-editor.js');
      expect(html).not.toContain('/layout-editor.css');
      expect(html).not.toContain('btn-edit-layout');
    }
  });

  it('persists custom layouts only in localStorage with drag-drop and board resize', () => {
    const source = read('public/layout-editor.js');
    expect(source).toContain('localStorage.setItem(cfg.storageKey');
    expect(source).toContain('localStorage.getItem(cfg.storageKey');
    expect(source).toContain('tgLayout.play.v1');
    expect(source).toContain('tgLayout.spectator.v1');
    expect(source).toContain('dragover');
    expect(source).toContain('tg-board-resizer');
    expect(source).toContain('tg-zone-bottom');
    expect(source).toContain('tg-zone-left');
  });

  it('removes per-card scrollbars in favor of a single page scrollbar', () => {
    for (const css of ['public/play.css', 'public/style.css']) {
      const source = read(css);
      const sidebarBlock = source.split('#sidebar {')[1]?.split('}')[0] ?? '';
      expect(sidebarBlock).not.toContain('overflow-y');
      expect(sidebarBlock).not.toContain('max-height');
      const eventsRule = source.split('#events {')[1]?.split('}')[0] ?? '';
      expect(eventsRule).not.toContain('overflow-y');
    }
  });

  it('exposes grid columns through --tg-grid for zone placement', () => {
    expect(read('public/play.css')).toContain('var(--tg-grid');
    expect(read('public/style.css')).toContain('var(--tg-grid');
  });

  it('keeps card frame styles when cards are moved out of the sidebar', () => {
    for (const css of ['public/play.css', 'public/style.css']) {
      expect(read(css)).toContain('.tg-zone section');
      expect(read(css)).toContain('.tg-zone h3');
    }
  });
});
