import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf-8');
}

const PAGES = ['public/play.html', 'public/play-m.html'];
const CLIENTS = ['public/play.js', 'public/play-m.js'];
const STYLES = ['public/play.css', 'public/play-m.css'];

describe('lobby create form room mode', () => {
  it('keeps editable inputs plus read-only display slots on both pages', () => {
    for (const path of PAGES) {
      const html = read(path);
      expect(html, `${path} 缺名称只读位`).toContain('id="create-name-static"');
      expect(html, `${path} 缺人数只读位`).toContain('id="create-max-players-static"');
      expect(html, `${path} 缺名称输入框`).toContain('id="create-name"');
      expect(html, `${path} 缺人数下拉`).toContain('id="max-players"');
    }
  });

  it('switches name / max players to read-only values in room mode', () => {
    for (const path of CLIENTS) {
      const source = read(path);
      expect(source, `${path} 缺表单只读同步`).toContain('function syncCreateFormStatic()');
      expect(source, `${path} 名称输入未隐藏`).toContain("els.createName?.classList.toggle('hidden', visible)");
      expect(source, `${path} 名称只读位未显示`).toContain("els.createNameStatic?.classList.toggle('hidden', !visible)");
      expect(source, `${path} 人数下拉未隐藏`).toContain("els.maxPlayers?.classList.toggle('hidden', visible)");
      expect(source, `${path} 人数只读位未显示`).toContain("els.createMaxPlayersStatic?.classList.toggle('hidden', !visible)");
      expect(source, `${path} 参战开关未禁用`).toContain('els.hostParticipate.disabled = inRoom');
      expect(source, `${path} 参战开关未跟随席位`).toContain('els.hostParticipate.checked = participating');
      expect(source, `${path} 只读人数未写回`).toContain('`${maxPlayers} 人`');
      // 返回设置时恢复输入框与默认不参战。
      expect(source, `${path} 返回设置未恢复参战开关`).toContain('els.hostParticipate.checked = false');
    }
  });

  it('makes the waiting-room player count editable for the host', () => {
    for (const path of CLIENTS) {
      const source = read(path);
      expect(source, `${path} 缺可点击人数`).toContain('class="lobby-count-edit" data-edit-max-players="1"');
      expect(source, `${path} 非房主也可点人数`).toContain('const canEditMax = canManage && editableCounts.length > 1;');
      expect(source, `${path} 缺人数修改入口`).toContain('function changeLobbyMaxPlayers()');
      expect(source, `${path} 未调用人数接口`).toContain('/host/max-players');
      expect(source, `${path} 人数请求未带房主凭证`).toContain("'X-Host-Token': hostToken");
      expect(source, `${path} 未接上人数点击`).toContain("e.target.closest?.('[data-edit-max-players]')");
    }
  });

  it('styles the read-only fields and clickable count on both pages', () => {
    for (const path of STYLES) {
      const css = read(path);
      expect(css, `${path} 缺只读值样式`).toContain('.field-static');
      expect(css, `${path} 缺只读开关样式`).toContain('.checkbox-field.is-room-static');
      expect(css, `${path} 缺可点击人数样式`).toContain('.lobby-count-edit');
    }
  });
});
