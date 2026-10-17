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
      // 创建/加入成功后原地变房间卡，而不是在下方追加一截。
      expect(html, `${path} 创建结果缺房间样式`).toMatch(/id="create-result"[^>]*lobby-room/);
      expect(html, `${path} 加入结果缺房间样式`).toMatch(/id="join-result"[^>]*lobby-room/);
      expect(html, `${path} 缺加入房间状态位`).toContain('id="join-room-status"');
      // 房间卡保留返回设置 / 返回大厅的入口，不把「重新创建」能力锁死。
      expect(html, `${path} 缺重新创建入口`).toContain('id="btn-create-again"');
      expect(html, `${path} 缺返回大厅入口`).toContain('id="btn-join-again"');
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
        '.lobby-map-thumb',
        '.lobby-map-tag',
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
        'function renderMapDialogRandomFacts()',
        'function setCreateRoomVisible(',
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
});
