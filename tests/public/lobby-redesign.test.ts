import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf-8');
}

const PAGES = ['public/play.html', 'public/play-m.html'];
const STYLES = ['public/play.css', 'public/play-m.css'];
const CLIENTS = ['public/play.js', 'public/play-m.js'];

describe('lobby map dialog and room state', () => {
  it('keeps the compact map summary and the map dialog on both player pages', () => {
    for (const path of PAGES) {
      const html = read(path);
      // 首屏只保留摘要卡；地图库与随机参数在新弹层里。
      expect(html, `${path} 缺已选地图摘要`).toContain('id="lobby-map-summary"');
      expect(html, `${path} 缺更换地图按钮`).toContain('id="btn-change-map"');
      expect(html, `${path} 缺地图库弹层`).toContain('id="map-dialog"');
      expect(html, `${path} 缺地图库遮罩`).toContain('id="map-dialog-backdrop"');
      expect(html, `${path} 缺地图页签`).toContain('data-map-tab="builtin"');
      expect(html, `${path} 缺随机参数页签`).toContain('data-map-tab="random"');
      // 旧结构（地图卡片 + 随机参数）必须保留在弹层里，既有采集链路不变。
      expect(html, `${path} 缺地图卡片容器`).toContain('id="map-picker" class="map-picker"');
      expect(html, `${path} 缺随机参数容器`).toContain('id="random-map-options"');
      expect(html, `${path} 缺隐藏 select 兼容层`).toContain('id="map-select" hidden');
      // 摘要卡是「地图预览 + 左下角图例 + 右侧简略信息」，不是只有一个小缩略图。
      expect(html, `${path} 缺地图预览台`).toContain('class="lobby-map-stage"');
      expect(html, `${path} 缺图例容器`).toContain('id="lobby-map-legend"');
      expect(html, `${path} 图例不在预览台内`).toMatch(/lobby-map-stage[\s\S]*id="lobby-map-thumb"[\s\S]*id="lobby-map-legend"[\s\S]*lobby-map-copy/);
      // 数值行是纯文字，排在简介下方（不再是一排带符号的标签）。
      expect(html, `${path} 缺数值文字行`).toContain('id="lobby-map-meta"');
      expect(html, `${path} 数值行不在简介下方`).toMatch(/id="lobby-map-desc"[\s\S]*id="lobby-map-meta"[\s\S]*id="btn-change-map"/);
      // 英文 id 单独占第二行，不跟中文名挤在一行。
      expect(html, `${path} 英文 id 未单独成行`).toMatch(/id="lobby-map-name"[^<]*<\/span>\s*<\/div>\s*<div id="lobby-map-id"/);
      // 简介挂在名称块里：鼠标移到名称（含英文名）上才展开。
      expect(html, `${path} 简介未挂在名称块上`).toMatch(/class="lobby-map-title"[\s\S]*id="lobby-map-name"[\s\S]*id="lobby-map-desc"/);
      // 名称与数值表包在同一个信息块里，共用一条中轴。
      expect(html, `${path} 缺名称 + 数值表的信息块`).toMatch(/class="lobby-map-info"[\s\S]*class="lobby-map-title"[\s\S]*id="lobby-map-meta"/);
      // 创建/加入成功后原地变房间卡，而不是在下方追加一截。
      expect(html, `${path} 创建结果缺房间样式`).toMatch(/id="create-result"[^>]*lobby-room/);
      expect(html, `${path} 加入结果缺房间样式`).toMatch(/id="join-result"[^>]*lobby-room/);
      expect(html, `${path} 缺加入房间状态位`).toContain('id="join-room-status"');
      // 房间卡保留返回设置 / 返回大厅的入口，不把「重新创建」能力锁死。
      expect(html, `${path} 缺重新创建入口`).toContain('id="btn-create-again"');
      expect(html, `${path} 缺返回大厅入口`).toContain('id="btn-join-again"');
      // 加入别人房间后同样要看到地图：预览卡插在加入表单与房间卡之间。
      expect(html, `${path} 缺加入房间的地图预览`).toContain('id="join-map-summary"');
      expect(html, `${path} 加入地图预览位置不对`).toMatch(/id="join-form"[\s\S]*id="join-map-summary"[\s\S]*id="join-result"/);
    }
  });

  it('wraps create and join forms so the room view can replace them', () => {
    for (const path of PAGES) {
      const html = read(path);
      expect(html, `${path} 缺 create-form`).toContain('id="create-form"');
      expect(html, `${path} 缺 join-form`).toContain('id="join-form"');
      // 创建按钮必须和表单一起隐藏，不能留在房间卡上方。
      expect(html, `${path} 创建按钮不在表单容器内`).toMatch(/id="create-form"[\s\S]*id="btn-create"[\s\S]*id="create-result"/);
      // 加入页的可用对局列表属于表单区，加入成功后随表单一起隐藏。
      expect(html, `${path} 可用对局列表不在 join-form 内`).toMatch(/id="join-form"[\s\S]*id="available-games"[\s\S]*id="join-result"/);
    }
  });

  it('styles the dialog, summary and room state on desktop and mobile', () => {
    for (const path of STYLES) {
      const css = read(path);
      for (const marker of [
        '.lobby-map-summary',
        '.lobby-map-stage',
        '.lobby-map-thumb',
        '.lobby-map-legend',
        '.lobby-map-swatch-hex',
        '.lobby-map-swatch-unit',
        '.lobby-map-meta',
        '.lobby-map-info',
        '.lobby-map-title',
        '.lobby-map-stat-key',
        '.lobby-map-stat-label',
        '.lobby-map-id',
        '.lobby-map-change',
        '.lobby-room',
        '.lobby-room-actions',
        '.map-dialog',
        '.map-dialog-tabs',
        '.map-dialog-random-layout',
        '.map-dialog-preview',
        '.rmo-fact',
        'body.map-dialog-open',
      ]) {
        expect(css, `${path} 缺 ${marker} 样式`).toContain(marker);
      }
      // 排版契约：图例竖排在预览左下角，信息写在右上角、整块右对齐，地图居中且给信息留出宽度。
      const rule = (selector: string) => css.match(new RegExp(`${selector} \\{[^}]*\\}`))?.[0] || '';
      expect(rule('\\.lobby-map-legend'), `${path} 图例未竖排`).toContain('flex-direction: column');
      expect(rule('\\.lobby-map-legend'), `${path} 图例未贴预览左下角`).toContain('position: absolute');
      // 图例与右上角信息都不带框，直接压在预览上。
      expect(rule('\\.lobby-map-legend'), `${path} 图例仍带边框/底色`).not.toContain('border:');
      expect(rule('\\.lobby-map-legend'), `${path} 图例仍带底色`).not.toContain('background:');
      expect(rule('\\.lobby-map-copy'), `${path} 信息未嵌在预览右上角`).toContain('position: absolute');
      expect(rule('\\.lobby-map-copy'), `${path} 信息未贴右`).toContain('align-items: flex-end');
      // 数值表是整块 grid（两列由容器统一），行与行不会参差；名称块与它同宽共轴。
      expect(rule('\\.lobby-map-meta'), `${path} 数值表未共用列宽`)
        .toContain('grid-template-columns: auto auto');
      expect(rule('\\.lobby-map-info'), `${path} 名称与数值表未共轴`).toContain('width: fit-content');
      expect(rule('\\.lobby-map-title'), `${path} 名称未居中到数值表中轴`).toContain('text-align: center');
      // 简介默认收起，悬停名称才展开。
      expect(css, `${path} 简介未默认收起`).toContain('visibility: hidden');
      expect(css, `${path} 简介未在悬停名称时展开`).toContain('.lobby-map-title:hover .lobby-map-desc');
      expect(rule('\\.lobby-map-thumb \\.map-preview'), `${path} 预览未给信息留位`)
        .toContain('calc(100% - 2 * (var(--lobby-map-panel) + 20px))');
      // 创建成功后不换页：地图收小、更换地图退场、房间卡在下方带过渡展开。
      expect(css, `${path} 房态未收小地图`).toContain('#create-form.room-active .lobby-map-stage');
      expect(css, `${path} 房态未隐藏更换地图`).toContain('#create-form.room-active .lobby-map-change');
      expect(css, `${path} 房间卡展开缺过渡`).toContain('#create-result.lobby-room');
      expect(css, `${path} 房间卡展开态缺样式`).toContain('#create-result.lobby-room.room-open');
      expect(css, `${path} 加入房间的地图预览缺入场动画`).toContain('#join-map-summary:not(.hidden)');
      expect(css, `${path} 加入房间卡未接入展开动画`).toContain('#join-result.lobby-room.room-open');
    }
  });

  it('wires the dialog, summary and room switcher in both clients', () => {
    for (const path of CLIENTS) {
      const source = read(path);
      for (const marker of [
        'function openMapDialog()',
        'function closeMapDialog()',
        'function applyMapDialog()',
        'function choosePendingMap(',
        'function renderLobbyMapSummary()',
        'function renderLobbyMapStage(',
        'function lobbyMapLegendMarkup(',
        'function lobbyMapStatRows(',
        'function randomMapStatRows(',
        'function lobbyMapStatsMarkup(',
        'function renderJoinMapCard(',
        'function hydrateRandomJoinMapCard(',
        'renderJoinMapCard(data.lobby);',
        'els.lobbyMapLegend',
        'els.lobbyMapMeta',
        'function renderMapDialogRandomFacts()',
        'function setCreateRoomVisible(',
        'function animateRoomCard(',
        'room-active',
        'room-open',
        'function setJoinRoomVisible(',
        'function showJoinError(',
        'pendingMapId',
        'mapDialogTab',
        'scheduleMapDialogPreview',
        'els.btnCreateAgain',
        'els.btnJoinAgain',
      ]) {
        expect(source, `${path} 缺 ${marker}`).toContain(marker);
      }
      // 图例只列这张图上真实出现的地形，不能把水域/障碍这些无关图例都挂上去。
      expect(source, `${path} 图例未按地形过滤`).toContain('if (terrains.has(key))');
      // 初始单位按兵种分开列，但不再标数量。
      expect(source, `${path} 初始单位未按兵种拆分`).toContain('lobby-map-swatch-unit ${type}');
      expect(source, `${path} 初始单位不应再标数量`).not.toContain('×${units.get(type)}');
      // 弹层里改随机参数后，大厅摘要的预览和图例要跟着刷新。
      expect(source, `${path} 随机预览未回写大厅`).toContain("if (els.mapSelect?.value === 'random') renderLobbyMapSummary();");
      // 弹层里切页签不改变已应用的地图；只有「使用这张地图」才 selectMap。
      expect(source, `${path} 页签切换不应直接 selectMap`).not.toContain("showMapDialogTab(tab.dataset.mapTab));\n  selectMap");
      // 创建/加入成功走原地房间态。
      expect(source, `${path} 创建成功未切房间态`).toContain('setCreateRoomVisible(true)');
    }
  });

  it('shares random previews with the dialog and the lobby summary', () => {
    const ui = read('public/random-map-ui.js');
    expect(ui).toContain('lastPreview: null');
    expect(ui).toContain('lastSeed:');
    expect(ui).toContain('onPreview: null');
    expect(ui).toContain('async refreshPreview(force = false)');
    expect(ui).toContain('if (!force && !RandomMapUI.isSelected()) return;');
    expect(ui).toContain("document.querySelectorAll('[data-random-preview]')");
    expect(ui).toContain("document.querySelectorAll('[data-random-map-preview]')");
    // 弹层内的面板显隐由页签负责，避免 setSelected 把随机面板重新藏起来。
    expect(ui).toContain("panel.closest('.map-dialog')");
  });

  it('renders a finished room as ended and restores the room map', () => {
    for (const path of PAGES) {
      const html = read(path);
      expect(html, `${path} 缺房间标题位`).toContain('id="create-room-title"');
      expect(html, `${path} 缺房主状态徽标位`).toContain('id="create-room-badge"');
      expect(html, `${path} 缺回放入口`).toContain('id="btn-view-replay"');
      expect(html, `${path} 缺加入者回放入口`).toContain('id="btn-view-replay-join"');
    }
    for (const path of CLIENTS) {
      const source = read(path);
      // 阶段文案必须区分 game_over；否则已结束的房间会显示「等待开局」并保留开始按钮。
      expect(source, `${path} 缺阶段文案`).toContain('function lobbyPhaseLabel(');
      expect(source, `${path} game_over 未标已结束`).toContain("if (lobby?.phase === 'game_over') return '已结束';");
      expect(source, `${path} 缺胜者/回合摘要`).toContain('function lobbyResultMarkup(');
      expect(source, `${path} 缺胜者名解析`).toContain('function lobbyWinnerName(');
      expect(source, `${path} 已结束仍在显示开始按钮`).toContain("els.btnStartGame.classList.toggle('hidden', !openForPlayers)");
      expect(source, `${path} 已结束未收起加入战斗`).toContain("els.btnHostParticipate.classList.toggle('hidden', !openForPlayers)");
      expect(source, `${path} 缺回放入口绑定`).toContain("els.btnViewReplay.classList.toggle('hidden', !ended || !gameId)");
      // 恢复房间时地图摘要要跟着房间地图走，不能停留在 /api/maps 的第一张。
      expect(source, `${path} 缺房间地图同步`).toContain('function applyRoomMapSelection(');
      expect(source, `${path} 缺房间地图判定`).toContain('function isRoomMapView(');
      expect(source, `${path} 加载地图未优先用房间地图`).toContain('els.mapSelect.value = restoredMap || maps[0]?.id');
      expect(source, `${path} 恢复房间未同步地图`).toMatch(/setCreateRoomVisible\(true\);[\s\S]{0,200}applyRoomMapSelection\(\);/);
      // 已结束的房间不再轮询开局。
      expect(source, `${path} 恢复已结束房间仍在轮询`).toContain("if (lobby.phase === 'lobby') startLobbyPolling();");
    }
    const replayPath = { 'public/play.js': '/spectator.html?gameId=', 'public/play-m.js': '/spectator-m.html?gameId=' } as Record<string, string>;
    for (const [path, href] of Object.entries(replayPath)) {
      expect(read(path), `${path} 回放地址不对`).toContain(href);
    }
    for (const path of STYLES) {
      expect(read(path), `${path} 缺终局摘要样式`).toContain('.lobby-summary-result');
    }
  });

  it('keeps create and join sessions mutually exclusive', () => {
    for (const path of CLIENTS) {
      const source = read(path);
      // 切换到另一局前必须确认；成功后清掉另一页签的旧凭证 / 摘要，避免两套房间混显。
      expect(source, `${path} 缺切局确认`).toContain('function confirmLobbySwitch(');
      expect(source, `${path} 缺创建房间清理`).toContain('function clearCreateRoomView(');
      expect(source, `${path} 缺加入房间清理`).toContain('function clearJoinRoomView(');
      expect(source, `${path} 创建前未确认切局`).toContain("confirmLobbySwitch('create')");
      expect(source, `${path} 加入前未确认切局`).toContain("confirmLobbySwitch('join', gid)");
      expect(source, `${path} 创建成功后未清理加入房间`).toContain('clearJoinRoomView();');
      expect(source, `${path} 加入成功后未清理创建房间`).toContain('clearCreateRoomView();');
      // 轮询只刷新当前身份对应的房间摘要；两份同时刷新会让创建页签显示别人的成员与地图。
      expect(source, `${path} 房主轮询应只刷新创建摘要`).toContain('if (hostToken) renderLobbySummary(data, els.lobbySummary, true);');
      expect(source, `${path} 加入者轮询应只刷新加入摘要`).toContain('else if (myToken) renderLobbySummary(data, els.joinLobbySummary);');
      expect(source, `${path} 清会话应清干净两套房间视图`).toMatch(/clearCreateRoomView\(\);\s+clearJoinRoomView\(\);/);
    }
  });
});
