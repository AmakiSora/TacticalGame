import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf-8');
}

const count = (source: string, re: RegExp) => (source.match(re) || []).length;

describe('event log ordering', () => {
  it('lists the newest replay step first on spectator desktop and mobile', () => {
    for (const file of ['public/app.js', 'public/spectator-m.js']) {
      const source = read(file);
      const reversed = count(source, /for \(let i = allEvents\.length - 1; i >= 0; i--\) \{/g);
      const lists = count(source, /(?:eventsEl|drawerEvents)\.appendChild\(li\)/g);
      // 每一处事件流列表都走倒序循环；时间轴刻度与回合边界仍按正序取索引
      expect(lists).toBeGreaterThan(0);
      expect(reversed).toBe(lists);
      // 倒序后 i 仍是原始步序，点击跳步与当前步高亮按它取
      expect(source).toMatch(/if \(i === currentStep\) li\.classList\.add\('active'\)/);
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
});
