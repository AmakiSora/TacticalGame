import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf-8');
}

// 原生 confirm / alert / prompt 的样式由浏览器决定，和这套暗色界面不搭；
// 这些页面与客户端都改走统一的 UIDialog。
const DIALOG_PAGES = [
  'public/play.html',
  'public/play-m.html',
  'public/spectator.html',
  'public/spectator-m.html',
  'public/arena.html',
  'public/map-editor.html',
];
const DIALOG_CLIENTS = [
  'public/play.js',
  'public/play-m.js',
  'public/app.js',
  'public/spectator-m.js',
  'public/arena.js',
  'public/map-editor.js',
  'public/layout-editor.js',
];

describe('shared confirm dialog', () => {
  it('ships one reusable dialog module and stylesheet', () => {
    const source = read('public/ui-dialog.js');
    const css = read('public/ui-dialog.css');

    // 四种语义一套实现：confirm / alert / prompt / open（自定义内容），挂在 window 上供各页共用。
    expect(source).toContain('window.UIDialog = {');
    expect(source).toContain('confirm(options)');
    expect(source).toContain('alert(options)');
    expect(source).toContain('prompt(options)');
    expect(source).toContain('Promise');
    // open() 承载自定义内容表单：只接受调用方构建好的 Node，模块自己不拼内容 HTML。
    expect(source).toContain('open(options)');
    expect(source).toContain('options.content instanceof Node');
    expect(source).toContain("typeof options.onOpen === 'function'");
    // 下拉/多行输入里的回车是原生交互（选选项、换行），不能当成确认。
    expect(source).toContain("tag === 'SELECT' || tag === 'TEXTAREA'");
    // 文案一律走 textContent，不能把调用方传进来的字符串当 HTML。
    expect(source).not.toContain('innerHTML');
    // 键盘语义和原生对话框一致：Esc 取消、回车确认（输入法组词时不抢回车）。
    expect(source).toContain("event.key === 'Escape'");
    expect(source).toContain("event.key === 'Enter' && !event.isComposing");
    expect(source).toContain("settle('cancel')");
    expect(source).toContain("settle('confirm')");
    // 点遮罩等同取消；焦点锁在弹窗内，关闭后归位。
    expect(source).toContain('backdrop.addEventListener');
    expect(source).toContain("event.key === 'Tab'");
    // 打开时焦点落在面板上（不描确认键），Tab 后再进按钮。
    expect(source).toContain('panel.tabIndex = -1');
    expect(source).toContain('!items.includes(document.activeElement)');
    expect(source).toContain('previouslyFocused.focus({ preventScroll: true })');

    // 面板沿用地图库弹层的语言：深色面板 / 1px 描边 / 10px 圆角 / 同一档投影。
    expect(css).toContain('.ui-dialog {');
    expect(css).toContain('background: #141c26;');
    expect(css).toContain('border: 1px solid #2a3a4a;');
    expect(css).toContain('box-shadow: 0 12px 40px rgba(0, 0, 0, .45);');
    expect(css).toContain('.ui-dialog-backdrop');
    // 三档色调呼应 .btn / .btn.warning / .btn.danger 的配色。
    expect(css).toContain('.ui-dialog[data-tone="warning"]');
    expect(css).toContain('.ui-dialog[data-tone="danger"]');
    expect(css).toContain('.ui-dialog-btn[data-variant="primary"] { background: #1a4a7a');
    expect(css).toContain('.ui-dialog-btn[data-variant="danger"] { background: #5a1a1a');
    // 手机端按钮铺满并加高到可点区域。
    expect(css).toContain('body.player-m-shell .ui-dialog');
    expect(css).toContain('min-height: 44px;');
  });

  it('no longer calls the native browser dialogs anywhere', () => {
    const files = readdirSync('public').filter(name => name.endsWith('.js'));
    for (const name of files) {
      const source = read(`public/${name}`);
      expect(source, `public/${name} 仍在用原生 confirm`).not.toContain('window.confirm(');
      expect(source, `public/${name} 仍在用原生 alert`).not.toContain('window.alert(');
      expect(source, `public/${name} 仍在用原生 prompt`).not.toContain('window.prompt(');
    }
  });

  it('wires the dialog into every page that used to pop a native box', () => {
    for (const path of DIALOG_PAGES) {
      const html = read(path);
      expect(html, `${path} 缺弹窗样式`).toContain('<link rel="stylesheet" href="/ui-dialog.css" />');
    }
    for (const path of DIALOG_CLIENTS) {
      const source = read(path);
      expect(source, `${path} 未引入共享弹窗`).toContain("import './ui-dialog.js';");
      expect(source, `${path} 未接共享弹窗`).toContain('window.UIDialog.');
    }
  });

  it('uses the dialog for lobby switching, kicking and leaving a room', () => {
    for (const path of ['public/play.js', 'public/play-m.js']) {
      const source = read(path);
      // 切局确认要等弹窗结果，不能再按同步布尔值用。
      expect(source, `${path} 创建前未等待确认`).toContain("if (!(await confirmLobbySwitch('create'))) return;");
      expect(source, `${path} 加入前未等待确认`).toContain("if (!(await confirmLobbySwitch('join', gid))) return;");
      expect(source, `${path} 切局确认未接弹窗`).toContain('return window.UIDialog.confirm({');
      expect(source, `${path} 踢人未接弹窗`).toContain('const ok = await window.UIDialog.confirm({');
      expect(source, `${path} 退出对局未接弹窗`).toContain("title: '退出本局对局？'");
      expect(source, `${path} 返回设置未接弹窗`).toContain("title: '返回设置？'");
      // 有破坏性后果的动作走红色档，切房间走琥珀档。
      expect(source, `${path} 破坏性操作未用 danger 档`).toContain("tone: 'danger'");
      expect(source, `${path} 切房间未用 warning 档`).toContain("tone: 'warning'");
      // 确认键直接写动作，不再是一律「确定」。
      expect(source, `${path} 确认键未写动作`).toContain("confirmText: '退出对局'");
    }
  });

  it('uses the dialog for adjudication, deletion, renaming, runs and map editing', () => {
    for (const path of ['public/app.js', 'public/spectator-m.js']) {
      const source = read(path);
      expect(source, `${path} 强制裁决未接弹窗`).toContain("title: '确定强制裁决当前对局？'");
      expect(source, `${path} 删除对局未接弹窗`).toContain("title: '删除这局对局？'");
      expect(source, `${path} 改名未接输入弹窗`).toContain('window.UIDialog.prompt({');
      expect(source, `${path} 改名未等待输入`).toContain('const next = await window.UIDialog.prompt({');
    }

    const arena = read('public/arena.js');
    expect(arena).toContain("title: '停止当前跑批？'");
    expect(arena).toContain("tone: 'warning'");

    const editor = read('public/map-editor.js');
    expect(editor).toContain('title: `删除出生槽 ${removed}？`');
    expect(editor).toContain("title: '缩小地图半径？'");
    expect(editor).toContain("title: '新建地图？'");
    // 取消缩半径要恢复原来的下拉值，所以确认必须 await 后再改配置。
    expect(editor).toMatch(/if \(!ok\) \{\s*els\.mapRadius\.value = config\.radius;\s*return;\s*\}/);

    const layout = read('public/layout-editor.js');
    expect(layout).toContain('await window.UIDialog.alert({');
  });
});
