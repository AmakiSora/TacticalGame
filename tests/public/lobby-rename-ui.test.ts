import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf-8');
}

const PAGES = ['public/play.html', 'public/play-m.html'];
const CLIENTS = ['public/play.js', 'public/play-m.js'];
const STYLES = ['public/play.css', 'public/play-m.css'];

describe('lobby self rename', () => {
  it('keeps rename out of the token row', () => {
    for (const path of [...PAGES, ...CLIENTS]) {
      const source = read(path);
      expect(source, `${path} 仍把改名按钮塞在 token 行`).not.toContain('btn-rename-self');
    }
  });

  it('renders the rename action beside the player own name in the lobby summary', () => {
    for (const path of CLIENTS) {
      const source = read(path);
      expect(source, `${path} 缺自己名字旁的改名按钮`).toContain('class="lobby-rename" data-rename-self="1"');
      expect(source, `${path} 改名按钮未按自己的席位渲染`).toContain('const isSelf = player.id === myPlayer;');
      expect(source, `${path} 未接上成员列表改名点击`).toContain("e.target.closest?.('[data-rename-self]')");
      // 别人的成员标签仍只有房主可见的踢人按钮。
      expect(source, `${path} 缺房主踢人入口`).toContain('data-kick-player');
      expect(source, `${path} 人员列表出现代改名按钮`).not.toContain('data-rename-player');
    }
  });

  it('renames self through the player token and refreshes the lobby', () => {
    for (const path of CLIENTS) {
      const source = read(path);
      expect(source, `${path} 缺自助改名入口`).toContain('function renameSelf()');
      expect(source, `${path} 缺改名弹窗`).toContain('function promptLobbyName(');
      expect(source, `${path} 改名未走 /player 接口`).toContain('`/api/games/${encodeURIComponent(gameId)}/player`');
      expect(source, `${path} 改名未带玩家凭证`).toContain("'X-Player-Token': myToken");
      expect(source, `${path} 改名未使用统一输入弹窗`).toContain('window.UIDialog.prompt');
      expect(source, `${path} 改名未限制长度`).toContain('maxLength: 50');
      // 改名后本地名称输入同步，之后重新加入 / 创建沿用新名字。
      expect(source, `${path} 改名后未同步创建名称`).toContain('els.createName.value = name');
      expect(source, `${path} 改名后未同步加入名称`).toContain('els.joinName.value = name');
    }
  });

  it('styles the rename action for both player pages', () => {
    for (const path of STYLES) {
      const css = read(path);
      expect(css, `${path} 缺改名按钮样式`).toContain('.lobby-rename');
      expect(css, `${path} 改名按钮与踢出按钮同形制`).toMatch(/\.lobby-rename \{[^}]*font-size/);
    }
  });

  it('does not give the host a way to rename other lobby members', () => {
    for (const path of CLIENTS) {
      const source = read(path);
      // 大厅成员列表只保留房主踢人；代改名接口与入口都不存在。
      expect(source, `${path} 仍可代成员改名`).not.toContain('host/rename');
      expect(source, `${path} 仍走控制端改名接口`).not.toContain('/rename');
      expect(source, `${path} 仍保留代改名函数`).not.toContain('function renameLobbyMember(');
    }
    // 服务端也不提供房主代改名路由。
    const gamesApi = read('src/api/games.ts');
    expect(gamesApi).not.toContain('/host/rename');
  });
});
