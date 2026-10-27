import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * V6-8 页面压缩：jsdom 没有布局引擎，所以用 CSS 数值断言 + 反向断言（旧值必须消失）。
 * 目标：1440×900 下「地图卡 + 房间卡 + 座位列表」一屏可见（内容总高 ≤ 760px）。
 */
const DESKTOP = 'public/play.css';
const MOBILE = 'public/play-m.css';

function read(path: string): string {
  return readFileSync(path, 'utf-8');
}

/** 取某个选择器块的声明文本（第一个匹配块）。 */
function ruleOf(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`缺 ${selector} 规则`);
  const end = css.indexOf('}', start);
  return css.slice(start, end);
}

describe('lobby page is compact (V6-8)', () => {
  it('shrinks the map stage to 196px with 168px / 148px / 144px steps', () => {
    const css = read(DESKTOP);
    expect(ruleOf(css, '.lobby-map-stage')).toContain('height: 196px');
    expect(css).toContain('#create-form.room-active .lobby-map-stage { height: 196px; }');
    // 窄窗口再压一档。
    expect(css).toContain('@media (max-width: 1100px)');
    const narrow = css.slice(css.indexOf('@media (max-width: 1100px)'));
    expect(narrow.slice(0, narrow.indexOf('}')).concat(narrow.slice(0, 200))).toContain('.lobby-map-stage { height: 168px; }');
    // 单列 / 手机一档。
    const column = css.slice(css.indexOf('@media (max-width: 720px)'));
    expect(column.slice(0, 400)).toContain('.lobby-map-stage { height: 148px; }');
    // 矮屏（1280×800 那档）再压到 144px。
    const short = css.slice(css.indexOf('@media (max-height: 860px)'));
    expect(short, '矮屏档缺地图台高度').toContain('#create-form.room-active .lobby-map-stage { height: 144px; }');
    // 旧高度必须消失。
    expect(css).not.toContain('height: 310px');
    expect(css).not.toContain('height: 246px');
    expect(css).not.toContain('height: 212px');
  });

  it('tightens the thumbnail padding and the info panel width', () => {
    const css = read(DESKTOP);
    expect(ruleOf(css, '.lobby-map-thumb')).toContain('padding: 8px 0');
    expect(css).toContain('--lobby-map-panel: 176px');
    expect(css).not.toContain('--lobby-map-panel: 220px');
    // 宽屏才放宽到 200px。
    expect(css).toContain('@media (min-width: 1200px)');
  });

  it('keeps seat rows at 20px min-height with a 16px seat number', () => {
    const css = read(DESKTOP);
    const row = ruleOf(css, '.lobby-seat-row');
    expect(row).toContain('min-height: 20px');
    expect(row).toContain('padding: 2px 6px');
    const no = ruleOf(css, '.lobby-seat-no');
    expect(no).toContain('min-width: 16px');
    expect(no).toContain('height: 16px');
    // 实际行高由行内按钮决定：chips 写死 line-height 14px，实测整行 26→24px。
    expect(css).toContain('.lobby-rename, .lobby-kick, .lobby-seat-move, .lobby-seat-first, .lobby-seat-top {');
    expect(css).toMatch(/\.lobby-rename[^{]*\{[^}]*line-height: 14px/);
  });

  it('removes the save bar entirely', () => {
    for (const path of [DESKTOP, MOBILE]) {
      const css = read(path);
      expect(css, `${path} 还有底栏样式`).not.toContain('.lobby-seat-footer');
      expect(css, `${path} 还有保存按钮样式`).not.toContain('.lobby-seat-save');
    }
  });

  it('drops the old preview badge and other removed bits', () => {
    for (const path of [DESKTOP, MOBILE]) {
      const css = read(path);
      expect(css, `${path} 还有预览角标`).not.toContain('is-seat-preview');
      expect(css, `${path} 还有「预览」文案`).not.toContain("content: '预览'");
    }
  });

  it('tightens card spacing so the lobby fits one screen', () => {
    const css = read(DESKTOP);
    expect(ruleOf(css, '.lobby-result')).toContain('margin-top: 10px');
    expect(ruleOf(css, '.lobby-summary')).toContain('padding: 6px 8px');
    expect(css).toContain('.panel.room-active { margin: 16px auto; }');
    // 房间卡展开后的内边距（含矮屏档 9px）。
    expect(css).toContain('padding: 13px;');
    expect(css).toContain('padding: 9px;');
    // 「更多 ▾」与图标复制按钮。
    expect(css).toContain('.info-more-toggle');
    expect(css).toContain('.icon-copy');
  });

  it('compacts the mobile page too', () => {
    const css = read(MOBILE);
    expect(ruleOf(css, '.lobby-map-stage')).toContain('height: 212px');
    expect(css).toContain('body.player-m-shell .lobby-map-stage { height: 148px; }');
    expect(css).toContain('--lobby-map-panel: 176px');
    expect(css).not.toContain('height: 310px');
    expect(css).not.toContain('height: 246px');
    // 座位行两段式：每段 ≥30px 点击区，操作区跨整行。
    const row = ruleOf(css, '.lobby-seat-row');
    expect(row).toContain('display: grid');
    expect(css).toContain('min-height: 30px');
    expect(css).toMatch(/\.lobby-seat-ops \{[^}]*grid-column: 1 \/ -1;/);
    // 房间卡凭证折叠。
    expect(css).toContain('.info-more.hidden { display: none; }');
  });

  it('adds the sync dot, undo toast button and screen-reader helper', () => {
    for (const path of [DESKTOP, MOBILE]) {
      const css = read(path);
      expect(css, `${path} 缺同步点`).toContain('.lobby-seat-sync-dot');
      expect(css, `${path} 缺提交中样式`).toContain('.lobby-seat-row.is-pending');
      expect(css, `${path} 缺回滚红边`).toContain('.lobby-seat-row.is-reverted');
      expect(css, `${path} 缺撤销按钮`).toContain('.toast-action');
      expect(css, `${path} 缺读屏样式`).toContain('.sr-only');
      expect(css, `${path} 缺状态点动画`).toContain('@keyframes seat-sync-pulse');
    }
  });
});

/**
 * 首屏台账（V6-13）：QA 实测 1440×900 底部按钮被裁 ~20px，根因是旧台账只算了
 * 「地图台 + 房间卡 + 6 行座位」，漏掉页面头部与底部按钮行（外加 `.panel.room-active`
 * 这档边距其实一直没生效，白吃 16px）。这里按**真实页面**的实测块高逐段求和
 * （dev server + headless Chrome（CDP）读 getBoundingClientRect），头部与底行都进账，
 * 并要求 ≥12px 余量；6 人满房（房间卡展开、座位 6 行）是最坏情况。
 *
 * 复现：起 dev server → `POST /api/games`（standoff、6 人、房主参战）→ 再 join 5 人 →
 * 用 `chrome --headless=new --remote-debugging-port=9222` 打开 /play.html，
 * 先 `localStorage.setItem('tacticalGame.session', …)` 再刷新，读 `.lobby-room-actions` 的 bottom。
 */
const SCREEN = { desktop: 900, short: 800 };
const SAFETY_PX = 12;

/** 1440×900 默认档实测分段（从上到下，单位 px）。 */
const LEDGER_DESKTOP: Array<[string, number]> = [
  ['header', 74],
  ['panel margin-top（room-active 档）', 16],
  ['panel padding-top', 28],
  ['h2', 25],
  ['h2 margin-bottom', 18],
  ['tabs', 42],
  ['tabs margin-bottom', 20],
  ['create-form（名称行 58 + 地图标签 17 + 地图台 198 + 间距 20）', 293],
  ['房间卡 margin-top', 16],
  ['房间卡 padding-top + 上边框', 14],
  ['房间卡头', 48],
  ['房间卡头 margin-bottom', 8],
  ['Game ID 行', 25],
  ['Game ID 行 margin（与列表头 margin 合并后）', 8],
  ['座位列表（列表头 19 + 6 行 × 24 + 5 × gap 3 + 内边距）', 205],
  ['底部按钮行 margin-top', 8],
  ['底部按钮行（开始游戏 / 退出战斗）', 37],
];

/** 1280×800 矮屏档（@media (max-height: 860px)）实测分段。 */
const LEDGER_SHORT: Array<[string, number]> = [
  ['header', 74],
  ['panel margin-top（room-active 档）', 16],
  ['panel padding-top', 20],
  ['h2', 25],
  ['h2 margin-bottom', 10],
  ['tabs', 42],
  ['tabs margin-bottom', 12],
  ['create-form（名称行 58 + 地图标签 17 + 地图台 146 + 间距 20）', 241],
  ['房间卡 margin-top', 16],
  ['房间卡 padding-top + 上边框', 10],
  ['房间卡头', 48],
  ['房间卡头 margin-bottom', 6],
  ['Game ID 行', 25],
  ['Game ID 行 margin（合并后）', 6],
  ['座位列表（列表头 19 + 6 行 × 22 + 5 × gap 3 + 内边距）', 187],
  ['底部按钮行 margin-top', 8],
  ['底部按钮行', 37],
];

function sumLedger(rows: Array<[string, number]>): number {
  return rows.reduce((total, [, px]) => total + px, 0);
}

describe('lobby drops the redundant copy lines (V6-12)', () => {
  it('no longer renders the map / capacity line or the seat list header copy', () => {
    for (const path of ['public/play.js', 'public/play-m.js']) {
      const source = read(path);
      expect(source, `${path} 还有「地图 X · 支持 N 人」`).not.toContain('lobby-summary-meta');
      expect(source, `${path} 还有「· 支持 N 人」`).not.toContain('· 支持 ');
      expect(source, `${path} 还有列表头「座位已编排」`).not.toContain('座位已编排');
      expect(source, `${path} 还有「预览中（未保存）」`).not.toContain('预览中（未保存）');
      expect(source, `${path} 还有「未编排：拖动」`).not.toContain('未编排：拖动');
      expect(source, `${path} 还有同时回合说明行`).not.toContain('同时回合不分先后');
      // 0 人房的空态提示仍保留（「＋ 添加 AI」的唯一上下文）。
      expect(source, `${path} 空态提示被删了`).toContain('还没有玩家加入');
    }
  });

  it('drops the css of the removed lines but keeps the empty-state hint style', () => {
    for (const path of [DESKTOP, MOBILE]) {
      const css = read(path);
      expect(css, `${path} 还有 .lobby-summary-meta`).not.toContain('.lobby-summary-meta');
      expect(css, `${path} 还有 .lobby-seat-note`).not.toContain('.lobby-seat-note');
      expect(css, `${path} 空态提示样式被删了`).toContain('.lobby-seat-hint');
    }
  });

  it('fits 1440×900 with the header and the bottom action row counted in', () => {
    const total = sumLedger(LEDGER_DESKTOP);
    // 底行按钮的底边必须落在视口内，并且留 ≥12px 余量（不许恰好压线）。
    expect(total, `1440×900 底行底边 ${total}px`).toBeLessThanOrEqual(SCREEN.desktop - SAFETY_PX);
  });

  it('actually applies the room-active panel margin in both clients', () => {
    // `.panel.room-active` 之前是死样式：只有 #create-form 加了 class，面板一直停在大厅态，
    // 台账里的 16px 上移根本没发生。这条锁住「面板也加 class」。
    for (const path of ['public/play.js', 'public/play-m.js']) {
      const source = read(path);
      expect((source.match(/els\.joinPanel\?\.classList\.toggle\('room-active'/g) ?? []).length, `${path} 面板没加 room-active`)
        .toBeGreaterThanOrEqual(2);
    }
  });

  it('fits 1280×800 through the short-viewport tier', () => {
    expect(read(DESKTOP), '缺矮屏档').toContain('@media (max-height: 860px)');
    const total = sumLedger(LEDGER_SHORT);
    expect(total, `1280×800 底行底边 ${total}px`).toBeLessThanOrEqual(SCREEN.short - SAFETY_PX);
    // 短屏档比默认档确实更矮：省的正好是「删掉的两三行 + 再压一档」。
    expect(sumLedger(LEDGER_DESKTOP) - total).toBeGreaterThanOrEqual(80);
  });

  it('keeps the mobile page untouched by the desktop squeeze', () => {
    const css = read(MOBILE);
    // 390×844 那档观感已确认正常：本轮不压移动端，只锁住它的关键尺寸不再变。
    expect(css).toContain('body.player-m-shell .lobby-map-stage { height: 148px; }');
    expect(css).toContain('min-height: 30px');
    expect(css).not.toContain('@media (max-height: 860px)');
  });
});

describe('room card folds credentials by default', () => {
  it('wraps HOST / PLAYER tokens behind a 更多 toggle', () => {
    for (const path of ['public/play.html', 'public/play-m.html']) {
      const html = read(path);
      expect(html, `${path} 缺更多开关`).toContain('id="btn-created-more"');
      expect(html, `${path} 缺折叠容器`).toContain('id="created-more"');
      // 折叠容器默认 hidden，里面有 Host / Player 两行。
      const fold = html.slice(html.indexOf('id="created-more"'));
      expect(fold.slice(0, 600)).toContain('hidden');
      expect(fold.slice(0, 600)).toContain('created-host-token');
      expect(fold.slice(0, 600)).toContain('created-token');
      expect(html, `${path} 缺 aria-expanded`).toContain('aria-expanded="false"');
      // 复制按钮改成图标 + aria-label。
      expect(html).toContain('aria-label="复制 Game ID"');
      expect(html).toContain('class="icon-copy"');
    }
  });

  it('merges the room status and hint into one line', () => {
    for (const path of ['public/play.js', 'public/play-m.js']) {
      const source = read(path);
      expect(source, `${path} 缺折叠开关处理`).toContain('function toggleCreatedMore()');
      // 状态行里带上「把 Game ID 发给其他玩家」，提示行不再单独占一行（CSS 已隐藏）。
      expect(source, `${path} 状态与提示未合并`)
        .toContain('· 把 Game ID 发给其他玩家');
    }
  });
});
