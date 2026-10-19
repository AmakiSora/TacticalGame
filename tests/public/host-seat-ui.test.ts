import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf-8');
}

const PAGES = ['public/play.html', 'public/play-m.html'];
const CLIENTS = ['public/play.js', 'public/play-m.js'];

describe('host lobby seat', () => {
  it('defaults to a non-participating host on both player pages', () => {
    for (const path of PAGES) {
      const html = read(path);
      const checkbox = html.match(/<input id="host-participate"[^>]*>/)?.[0] ?? '';
      expect(checkbox, `${path} 缺房主参战开关`).not.toBe('');
      expect(checkbox, `${path} 房主参战不应默认勾选`).not.toContain('checked');
      expect(html, `${path} 未说明房主默认不参战`).toContain('房主默认不参战');
    }
  });

  it('puts the join/leave battle toggle in the created room card', () => {
    for (const path of PAGES) {
      const html = read(path);
      expect(html, `${path} 缺房主席位切换按钮`).toContain('id="btn-host-participate"');
      expect(html, `${path} 缺房主参战状态位`).toContain('id="create-room-status"');
      expect(html, `${path} 缺可复制的 player token 标记`).toContain('id="created-token-copy"');
      // 按钮属于房间卡动作区：开始游戏 / 连接进入游戏 / 加入战斗 并排。
      expect(html, `${path} 房主席位按钮不在房间卡动作区`).toMatch(
        /id="btn-start-game"[\s\S]*id="btn-connect-create"[\s\S]*id="btn-host-participate"/,
      );
      expect(html, `${path} 房主席位按钮应在房间卡内`).toMatch(
        /id="create-result"[\s\S]*id="btn-host-participate"[\s\S]*id="tab-join"/,
      );
    }
  });

  it('wires seat state and the join/leave requests in both clients', () => {
    for (const path of CLIENTS) {
      const source = read(path);
      expect(source, `${path} 缺席位状态同步`).toContain('function syncHostSeatUi()');
      expect(source, `${path} 缺席位切换入口`).toContain('function toggleHostSeat()');
      expect(source, `${path} 未接上切换按钮`).toContain("els.btnHostParticipate?.addEventListener('click', toggleHostSeat)");
      expect(source, `${path} 未用大厅接口加入战斗`).toContain("`/api/games/${encodeURIComponent(gameId)}/join`");
      expect(source, `${path} 未用玩家凭证退出战斗`).toContain("`/api/games/${encodeURIComponent(gameId)}/leave`");
      expect(source, `${path} 退出战斗未带玩家凭证`).toContain("headers: { 'X-Player-Token': myToken }");
      expect(source, `${path} 未显示参战状态`).toContain('房主未参战');
      expect(source, `${path} 缺加入战斗文案`).toContain('加入战斗');
      expect(source, `${path} 缺退出战斗文案`).toContain('退出战斗');
      // 创建请求仍然以开关为准：默认未勾选时提交 participate: false。
      expect(source, `${path} 创建请求忽略参战开关`).toContain('participate: els.hostParticipate?.checked !== false');
    }
  });

  it('sends hosts without a seat to the spectator view once the game starts', () => {
    expect(read('public/play.js'), '桌面端未参战房主应转观战').toContain(
      '`/spectator.html?gameId=${encodeURIComponent(gameId)}`',
    );
    expect(read('public/play-m.js'), '手机端未参战房主应转观战').toContain(
      '`/spectator-m.html?gameId=${encodeURIComponent(gameId)}`',
    );
    for (const path of CLIENTS) {
      expect(read(path), `${path} 观战跳转未以缺少 player token 为条件`).toContain('未参战（房主默认旁观）或只有观战会话');
    }
  });
});
