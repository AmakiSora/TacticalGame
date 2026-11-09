import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf-8');
}

describe('event log ordering', () => {
  it('lists the newest replay step first on spectator desktop and mobile', () => {
    for (const file of ['public/app.js', 'public/spectator-m.js']) {
      const source = read(file);
      expect(source).toContain('fragment.prepend(li)');
      expect(source).toContain('container.prepend(fragment)');
      expect(source).toContain('li.dataset.step = i');
      expect(source).toContain('rows[currentStep]');
      expect(source).not.toContain('drawerEvents.innerHTML');
    }
  });

  it('prepends live events at the top of the player log on desktop and mobile', () => {
    for (const file of ['public/play.js', 'public/play-m.js']) {
      const source = read(file);
      expect(source).toContain('state.eventLog.slice(-60).reverse()');
      expect(source).toContain('els.events.scrollTop = 0;');
      expect(source).not.toMatch(/els\.events\.scrollTop = els\.events\.scrollHeight/);
    }
  });

  it('titles the replay detail card 当前事件 and keeps it inside the page scrollbar', () => {
    for (const file of ['public/spectator.html', 'public/spectator-m.html']) {
      expect(read(file)).toContain('<h3>当前事件</h3>');
    }
    expect(read('public/spectator.html')).not.toContain('当前操作');
    const detailRule = read('public/style.css').split('#detail-content {')[1].split('}')[0];
    // 卡片自身不再开滚动区（整页单滚动条约定），限高只留给展开后的原始数据
    expect(detailRule).not.toContain('max-height');
    expect(detailRule).not.toContain('overflow');
    expect(read('public/style.css')).toMatch(/\.ev-payload \{[\s\S]*?max-height: 200px;[\s\S]*?overflow: auto/);
    // 摘要与类型标签同文时不再重复排一遍
    expect(read('public/app.js')).toContain('summary === label');
  });
});
