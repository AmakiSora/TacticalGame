import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf-8');
}

const CLIENTS = ['public/play.js', 'public/play-m.js'];

describe('join room back to lobby', () => {
  it('leaves the room instead of only hiding the room card', () => {
    for (const path of CLIENTS) {
      const source = read(path);
      expect(source, `${path} 缺返回大厅处理`).toContain('async function leaveJoinedRoom()');
      expect(source, `${path} 返回大厅未释放席位`).toContain('/api/games/${encodeURIComponent(gameId)}/leave');
      expect(source, `${path} 退出请求未带玩家凭证`).toContain("'X-Player-Token': myToken");
      expect(source, `${path} 退出后未清会话`).toContain('clearSavedSession();');
      expect(source, `${path} 退出后未收起房间卡`).toContain('clearJoinRoomView();');
      expect(source, `${path} 返回大厅按钮未接到退出逻辑`).toContain("els.btnJoinAgain?.addEventListener('click', leaveJoinedRoom)");
      // 旧实现只隐藏卡片；存在该写法说明还会留下孤儿席位。
      expect(source, `${path} 仍只隐藏房间卡`).not.toContain('els.btnJoinAgain?.addEventListener(\'click\', () => {');
    }
  });

  it('keeps the room id so the player can rejoin after leaving', () => {
    for (const path of CLIENTS) {
      const source = read(path);
      // 退出只清会话，不清加入表单里的 Game ID 输入。
      expect(source, `${path} 退出时清掉了 Game ID 输入`).not.toContain("els.gameId.value = ''");
      expect(source, `${path} 退出后未刷新可用对局`).toContain('refreshAvailableGames();');
    }
  });
});
