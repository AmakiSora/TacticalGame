import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf-8');
}

const CLIENTS = ['public/play.js', 'public/play-m.js'];
const PAGES = ['public/play.html', 'public/play-m.html'];
const STYLES = ['public/play.css', 'public/play-m.css'];

describe('lobby available games list', () => {
  it('shows the same map preview as the map library on the left of every row', () => {
    for (const path of CLIENTS) {
      const source = read(path);
      expect(source, `${path} 缺缩略图容器`).toContain('class="available-game-thumb"');
      expect(source, `${path} 缩略图未复用地图库预览`).toContain('? renderMapPreview(map.preview)');
      // 列表缩略图与地图库用同一份渲染：据点 / 出生位 / 初始单位与悬停详单都保留。
      expect(source, `${path} 列表用了另一套精简渲染`).not.toContain('renderMapPreview(map.preview, { compact: true })');
      expect(source, `${path} 缺地图标记`).toContain('data-preview-marker');
      expect(source, `${path} 随机地图缺占位块`).toContain('available-game-thumb-empty');
    }
  });

  it('labels the map with the Chinese name first and mapId second', () => {
    for (const path of CLIENTS) {
      const source = read(path);
      expect(source, `${path} 缺中文地图名`).toContain('class="available-game-mapname"');
      expect(source, `${path} 缺英文辅名`).toContain('class="available-game-mapalias"');
      expect(source, `${path} 名称未取服务端 mapName`).toContain('game.mapName ||');
      expect(source, `${path} 未回退本地地图表`).toContain('availableMaps.find(item => item.id === mapId)');
      expect(source, `${path} 随机地图缺默认名`).toContain("'随机战场'");
      expect(source, `${path} 中文名与 id 相同时未去重`).toContain('const mapAlias = map.name === map.id');
      expect(source, `${path} 未知地图仍写随机地图`).toContain("map.id === 'random' ? '随机地图' : '暂无预览'");
    }
  });

  it('shows only the host name and never the whole player list', () => {
    for (const path of CLIENTS) {
      const source = read(path);
      expect(source, `${path} 缺房主名`).toContain('class="available-game-host"');
      expect(source, `${path} 未取服务端 hostName`).toContain("String(game.hostName || '').trim()");
      expect(source, `${path} 缺房主标签`).toContain('class="available-game-host-label"');
      expect(source, `${path} 缺房主名字`).toContain('class="available-game-host-name"');
      expect(source, `${path} 缺无名字兜底`).toContain('<span class="available-game-host-label">房主</span>');
      expect(source, `${path} 仍在列全部玩家`).not.toContain('available-game-players');
      expect(source, `${path} 仍在拼玩家列表`).not.toContain("names.join('、')");
    }
  });

  it('keeps mode / seats / host in the left text block with room number + age', () => {
    for (const path of CLIENTS) {
      const source = read(path);
      expect(source, `${path} 缺信息行`).toContain('class="available-game-meta"');
      expect(source, `${path} 模式徽标不在信息行`).toMatch(/available-game-meta[\s\S]*available-game-mode/);
      expect(source, `${path} 人数不在信息行`).toMatch(/available-game-meta[\s\S]*available-game-seats/);
      expect(source, `${path} 缺房间号行`).toContain('class="available-game-foot"');
      expect(source, `${path} 房间号未带标签`).toContain('房间号 ${esc(id)}');
      expect(source, `${path} 缺创建时间`).toContain('class="available-game-age"');
      expect(source, `${path} 缺选择动作`).toContain('class="available-game-action"');
      expect(source, `${path} 选中态文案未区分`).toContain('class="available-game-action-label"');
      expect(source, `${path} 点击后动作文案未更新`).toContain("label.textContent = selected ? '已选' : '选择';");
    }
  });

  it('paginates four rooms per page on both clients', () => {
    for (const path of CLIENTS) {
      expect(read(path), `${path} 每页不是 4 个`).toContain('const AVAILABLE_GAMES_PAGE_SIZE = 4;');
    }
  });

  it('renames game ID to room number and puts it on the same row as the name', () => {
    for (const path of PAGES) {
      const html = read(path);
      expect(html, `${path} 仍写游戏 ID`).not.toContain('游戏 ID');
      expect(html, `${path} 缺房间号`).toContain('<label>房间号</label>');
      expect(html, `${path} 缺同一行容器`).toContain('class="join-fields-row"');
      // 你的名称在左、房间号在右。
      expect(html, `${path} 名称与房间号顺序不对`)
        .toMatch(/join-fields-row[\s\S]*id="join-name"[\s\S]*<label>房间号<\/label>[\s\S]*id="game-id"/);
      expect(html, `${path} 房间号占位文案未改`).toContain('placeholder="粘贴房间号…"');
    }
    for (const path of STYLES) {
      expect(read(path), `${path} 缺同一行样式`).toContain('.join-fields-row {');
    }
  });

  it('uses the same Chinese map names in the map filter', () => {
    for (const path of CLIENTS) {
      const source = read(path);
      expect(source, `${path} 地图筛选未按中文名排序`).toContain("localeCompare(b.name, 'zh-Hans-CN')");
      expect(source, `${path} 地图筛选未带中文名`).toContain("item.name === item.id ? '' :");
    }
  });

  it('repaints the list once the async map table arrives', () => {
    for (const path of CLIENTS) {
      const source = read(path);
      expect(source, `${path} 地图表到位后未补画列表`).toContain('if (availableGamesData.length) renderAvailableGames(availableGamesData);');
    }
  });

  it('styles the card with aligned rows and a truncating host name', () => {
    for (const path of STYLES) {
      const css = read(path);
      expect(css, `${path} 缺缩略图样式`).toContain('.available-game-thumb {');
      expect(css, `${path} 缺缩略图内部预览样式`).toContain('.available-game-thumb .map-preview {');
      expect(css, `${path} 缺中文名样式`).toContain('.available-game-mapname {');
      expect(css, `${path} 缺英文辅名样式`).toContain('.available-game-mapalias {');
      expect(css, `${path} 缺信息行样式`).toContain('.available-game-meta {');
      expect(css, `${path} 缺房主名样式`).toContain('.available-game-host {');
      expect(css, `${path} 缺房间号行样式`).toContain('.available-game-foot {');
      expect(css, `${path} 缺选择动作样式`).toContain('.available-game-action {');
      expect(css, `${path} 仍在用旧玩家列表样式`).not.toContain('.available-game-players');
      expect(css, `${path} 卡片仍是两列旧布局`).toContain('grid-template-columns: auto minmax(0, 1fr) auto;');
      // 房主标签固定、名字可截断、时间不参与拉伸，长名字不会把行尾推歪。
      expect(css.match(/\.available-game-host-name \{[^}]*\}/)?.[0] || '', `${path} 房主名未截断`).toContain('text-overflow: ellipsis');
      expect(css.match(/\.available-game-host-label \{[^}]*\}/)?.[0] || '', `${path} 房主标签不固定`).toContain('flex: none');
      expect(css.match(/\.available-game-age \{[^}]*\}/)?.[0] || '', `${path} 时间未固定`).toContain('flex: none');
    }
  });
});
