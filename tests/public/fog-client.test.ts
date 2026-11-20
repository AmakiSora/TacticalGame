import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');
const PLAYER_PAGES = ['public/play.js', 'public/play-m.js'];
const SPECTATOR_PAGES = ['public/app.js', 'public/spectator-m.js'];

function slice(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  expect(from, `缺少 ${start}`).toBeGreaterThan(-1);
  expect(to, `${start} 之后缺少 ${end}`).toBeGreaterThan(from);
  return source.slice(from, to);
}

function loadRulesSheet(): { buildHtml: (config: any) => string } {
  const context: any = { window: {} };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(read('public/rules-sheet.js'), context);
  return context.window.RulesSheet;
}

/** 在最小沙箱里执行客户端的 scoreBreakdown：隐藏分项必须提前返回，不能触碰 scoreTerms。 */
function loadScoreBreakdown(file: string): (score: any) => string {
  const fnSource = slice(read(file), 'function scoreBreakdown(score) {', 'function scoreRank(');
  const context: any = {
    scoreTerms: () => { throw new Error('hidden score must not be expanded'); },
    formatScore: (value: number) => String(value),
    esc: (value: string) => String(value),
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(`${fnSource}\nglobalThis.__breakdown = scoreBreakdown;`, context);
  return context.__breakdown;
}

describe('fog player pages', () => {
  it('loads the shared fog helpers and treats fog as a simultaneous mode', () => {
    for (const page of PLAYER_PAGES) {
      const source = read(page);

      expect(source, page).toContain("import './fog.js';");
      // 浏览器里走 FogView；无 DOM 的 VM 沙箱回落到同口径字面量。
      expect(source, page).toContain('window.FogView.isSimultaneousMode(mode)');
      expect(source, page).toContain('window.FogView.isAnnihilationMode(mode)');
      expect(source, page).toContain("return mode === 'simultaneous' || mode === 'royale' || mode === 'fog';");
      expect(source, page).toContain("return mode === 'annihilation' || mode === 'royale';");
      // 入口谓词自带字面量（测试会单独切出执行），同样涵盖迷雾。
      expect(source, page).toMatch(/function isSimultaneous\(\) \{\r?\n  const mode = gameConfig\?\.mode;\r?\n  return mode === 'simultaneous' \|\| mode === 'royale' \|\| mode === 'fog';/);
      expect(source, page).toMatch(/function isSimultaneousLobby\(lobby\) \{\r?\n(?:.*\r?\n)?  const mode = lobby\?\.mode;\r?\n  return mode === 'simultaneous' \|\| mode === 'royale' \|\| mode === 'fog';/);
      // 模式标签可直接显示「迷雾」，而炮火/歼灭分支不因迷雾打开。
      expect(source, page).toContain("mode === 'fog' ? '迷雾'");
      expect(source, page).not.toContain("mode === 'fog' || mode === 'annihilation'");
    }
  });

  it('takes units and fog projection from the authoritative GET response', () => {
    for (const page of PLAYER_PAGES) {
      const source = read(page);

      expect(source, page).toContain('fog: null');
      expect(source, page).toContain("Object.prototype.hasOwnProperty.call(data, 'fog')");
      expect(source, page).toContain('window.FogView.normalizeProjection(data.fog)');
      expect(source, page).toContain('mergeFogUnits(data.units)');

      const merge = slice(source, 'function mergeFogUnits(units) {', 'function cellAt(');
      // 投影是权威集合：旧单位中被隐藏的条目要消失，只保留已阵亡记录。
      expect(merge, page).toContain('const next = new Map();');
      expect(merge, page).toContain('state.units = next;');
      expect(merge, page).toContain('unit.alive === false');
      expect(merge, page).not.toContain('ghost');
    }
  });

  it('darkens only server-hidden cells and never computes vision itself', () => {
    for (const page of PLAYER_PAGES) {
      const source = read(page);
      const layer = slice(source, 'function drawFogLayer() {', 'function drawFogGhosts()');

      expect(layer, page).toContain('if (!fogEnabled() || state.fog.revealed) return;');
      expect(layer, page).toContain('window.FogView.cellHidden(state.fog, cell.q, cell.r)');
      expect(layer, page).toContain("'rgba(3, 7, 11, .64)'");
      // 地形仍可辨认：暗层是半透明填充，不是整块遮罩。
      expect(layer, page).not.toContain('globalCompositeOperation');
      expect(layer, page).not.toContain('vision');
    }
  });

  it('draws ghosts at 40% alpha with a dashed ring and question badge, outside selection', () => {
    for (const page of PLAYER_PAGES) {
      const source = read(page);
      const ghosts = slice(source, 'function drawFogGhosts() {', 'function ');

      expect(ghosts, page).toContain('ctx.globalAlpha = .4;');
      expect(ghosts, page).toContain('ctx.setLineDash([4, 3]);');
      expect(ghosts, page).toContain("fillText('?'");
      expect(ghosts, page).toContain('drawUnitGlyph(ghost.type');
      // 残影只来自 lastSeen，不进 state.units，因此 entityAt 永远选不中它。
      expect(source, page).toContain('window.FogView.ghostsFor(state.fog, state.units)');
      const entityAt = slice(source, 'function entityAt(', 'function occupied(');
      expect(entityAt, page).not.toContain('ghost');
      expect(entityAt, page).not.toContain('FogView');
    }
  });

  it('marks attacks on cells without a visible unit as blind fire', () => {
    for (const page of PLAYER_PAGES) {
      const source = read(page);

      expect(source, page).toContain('window.FogView.blindFireHint(state.fog, hasVisibleTarget)');
      expect(source, page).toContain("tone: 'blind'");
      expect(source, page).toContain("' | 盲射'");
      // 命中预测只遍历可见单位；残影不参与候选。
      const preview = slice(source, 'function aimPreview(', 'function drawChipAt(');
      expect(preview, page).toContain('entityAt(cell.q, cell.r)');
      expect(preview, page).not.toContain('ghostAt');
      expect(preview, page).toContain('hasVisibleTarget');
      // 迷雾不影响治疗：只有攻击才补盲射角标。
      expect(preview, page).toContain('if (!isHeal && fogEnabled())');
    }
  });

  it('shows ghost and hidden-cell notes on hover without making ghosts entities', () => {
    for (const page of PLAYER_PAGES) {
      const source = read(page);

      expect(source, page).toContain('残影 ${UNIT_NAMES[ghost.type] || \'单位\'} ${ghost.hp}/${ghost.maxHp}（第${ghost.seenRound}轮）');
      expect(source, page).toContain("' | 视野外'");
      expect(source, page).toContain('window.FogView.ghostAt(state.fog, state.units');
    }
  });

  it('passes the player token on the SSE URL because EventSource cannot set headers', () => {
    for (const page of PLAYER_PAGES) {
      const source = read(page);

      expect(source, page).toContain('const authQuery = myToken ?');
      expect(source, page).toContain('${authQuery}');
      expect(source, page).toContain('?after=${lastSeq}');
    }
  });
});

describe('fog score privacy', () => {
  it('renders hidden opponent breakdowns as masked copy instead of zero terms', () => {
    for (const page of [...PLAYER_PAGES, ...SPECTATOR_PAGES]) {
      const source = read(page);
      expect(source, page).toContain("if (score?.hidden) return '<div class=\"score-breakdown score-breakdown-masked\">对手分项不可见（迷雾）</div>';");

      const breakdown = loadScoreBreakdown(page);
      const html = breakdown({ hidden: true, total: 292.2 });
      expect(html, page).toContain('对手分项不可见（迷雾）');
      expect(html, page).not.toContain('敌方总部伤害');
      expect(html, page).not.toContain('×');
    }
  });

  it('styles the masked breakdown on every score panel stylesheet', () => {
    for (const file of ['public/style.css', 'public/play.css', 'public/play-m.css', 'public/spectator-m.css']) {
      expect(read(file), file).toContain('.score-breakdown.score-breakdown-masked');
    }
  });
});

describe('fog spectator pages', () => {
  it('discovers fog games anonymously, then retries with X-Spectator-Token', () => {
    for (const page of SPECTATOR_PAGES) {
      const source = read(page);
      const meta = slice(source, 'async function fetchSpectatorMeta(', 'function setFogLock(');

      expect(source, page).toContain('let spectatorToken = readSpectatorToken();');
      expect(source, page).toContain("new URLSearchParams(window.location.search).get('spectatorToken')");
      expect(source, page).toContain('function isSimultaneousReplay() {');
      expect(source, page).toContain("return mode === 'simultaneous' || mode === 'royale' || mode === 'fog';");
      expect(meta, page).toContain('publicData.config?.mode === \'fog\' || publicData.fog?.enabled === true');
      // 非迷雾局不受陈旧令牌影响。
      expect(meta, page).toContain('if (!fogGame) return { data: publicData, fogGame: false };');
      expect(meta, page).toContain("headers: { 'X-Spectator-Token': spectatorToken }");
      expect(meta, page).toContain('authed.status === 401');
    }
  });

  it('shows a token-required lock instead of rebuilding the board from projected events', () => {
    for (const page of SPECTATOR_PAGES) {
      const source = read(page);
      const locked = slice(source, 'function showFogLocked(', 'async function loadGameState(');
      const load = slice(source, 'async function loadGameState(', 'function subscribeSse(');

      expect(source, page).toContain("'迷雾模式对局需要观战令牌。'");
      expect(source, page).toContain("'观战令牌无效，无法查看迷雾对局。'");
      // 锁定页只消费公开字段（地图/总部/据点/轮次），并清空事件，绝不用半量事件重放。
      expect(locked, page).toContain('state.map = cloneMapPayload(data?.map || {})');
      expect(locked, page).toContain('data?.headquarters');
      expect(locked, page).toContain('allEvents = [];');
      expect(locked, page).not.toContain('/events');
      // loadGameState 在请求事件流之前就分流到锁定页。
      expect(load, page).toContain('if (meta.fogGame && meta.locked) {');
      expect(load.indexOf('meta.fogGame && meta.locked')).toBeLessThan(load.indexOf('/events'));
    }
  });

  it('never fabricates adjudication scores on the locked public view', () => {
    for (const page of SPECTATOR_PAGES) {
      const source = read(page);

      expect(source, page).toContain('let fogLockedView = false;');
      // 隐藏裁决时不再回落到本地补算，分项全 0 的"算式"不得出现在公开页。
      const live = slice(source, 'function liveAdjudicationScores(', 'function liveAdjudicationRankings(');
      expect(live, page).toContain('if (fogLockedView) return null;');
      expect(source, page).toContain('迷雾对局需观战令牌查看裁决');

      const locked = slice(source, 'function showFogLocked(', 'async function loadGameState(');
      expect(locked, page).toContain('fogLockedView = true;');
      expect(locked.indexOf('fogLockedView = true;')).toBeLessThan(locked.indexOf('renderSidebar()'));

      const clear = slice(source, 'function clearFogLock(', 'function showFogLocked(');
      expect(clear, page).toContain('fogLockedView = false;');

      // 导入回放自带事件，不再沿用锁定页的遮罩/裁决屏蔽（遮罩也要真的收起）。
      const imported = slice(source, 'function loadImportedReplay(', 'function importJson(');
      expect(imported, page).toContain('clearFogLock();');
      expect(imported, page).toContain('liveFogGame = false;');
      expect(imported, page).not.toContain('setFogLock(');
    }
  });

  it('hides the desktop fog lock once a valid token is loaded', () => {
    // 桌面端没有全局 .hidden 规则，.fog-lock 自己声明了 display:flex，必须显式收起。
    const css = read('public/style.css');
    expect(css).toMatch(/\.fog-lock\.hidden\s*\{\s*display:\s*none;?\s*\}/);
    expect(read('public/spectator-m.css')).toContain('body.spectator-m-shell .hidden');
  });

  it('uses query tokens for SSE and resets fog state when switching games', () => {
    for (const page of SPECTATOR_PAGES) {
      const source = read(page);

      expect(source, page).toContain('const authQuery = liveFogGame && spectatorToken ?');
      expect(source, page).toContain('spectatorToken=${encodeURIComponent(spectatorToken)}');
      expect(slice(source, 'function resetLoadedGame(', 'function ')).toContain('liveFogGame = false;');
      expect(source, page).toContain('clearFogLock();');
    }
  });

  it('offers a spectator token field on desktop and mobile settings', () => {
    expect(read('public/spectator.html')).toContain('id="settings-spectator-token"');
    expect(read('public/spectator.html')).toContain('id="btn-save-spectator-token"');
    expect(read('public/spectator-m.html')).toContain('id="settings-spectator-token"');
    expect(read('public/spectator-m.html')).toContain('id="btn-save-spectator-token"');
    expect(read('public/spectator.html')).toContain('id="fog-lock"');
    expect(read('public/spectator-m.html')).toContain('id="fog-lock"');
    expect(read('public/style.css')).toContain('.fog-lock');
    expect(read('public/spectator-m.css')).toContain('.fog-lock');
    for (const page of SPECTATOR_PAGES) {
      expect(read(page), page).toContain('function saveSpectatorTokenFromSettings()');
    }
  });
});

describe('fog presentation', () => {
  it('labels fog on home, stats and arena-stats without adding it to arena eval modes', () => {
    expect(read('public/index.html')).toContain('mode-badge mode-fog');
    expect(read('public/index.html')).toContain('同时回合 × 视野迷雾');
    expect(read('public/index.css')).toContain('.mode-fog {');
    expect(read('public/stats.js')).toContain("fog: '迷雾'");
    expect(read('public/arena-stats.js')).toContain("fog: '迷雾'");
    // 竞技场评估控制台不提供迷雾模式（服务端本期不把 fog 局纳入榜单/RL）。
    expect(read('public/arena.js')).not.toContain("'fog'");
    expect(read('public/arena.js')).not.toContain('迷雾');
  });

  it('renders fog rules and event copy from the server config only', () => {
    const RulesSheet = loadRulesSheet();
    const fogHarbor = JSON.parse(read('maps/fog-harbor.json'));
    const html = RulesSheet.buildHtml(fogHarbor);

    expect(html).toContain('迷雾（同时 × 视野迷雾）');
    expect(html).toContain('全程迷雾，终局公开');
    expect(html).toContain('侦察兵 4 · 远程兵 3 · 步兵 2 · 支援兵 2 · 重装 1');
    expect(html).toContain('阻挡地形挡视线，水域不挡');
    expect(html).toContain('本模式无炮火、无先手贴目');
    expect(html).toContain('揭雾');
    expect(html).not.toContain('炮火规则');

    // 同时回合的覆盖形状列对迷雾同样生效。
    expect(html).toContain('直线 2 格');
    const source = read('public/rules-sheet.js');
    expect(source).toContain("mode === 'simultaneous' || mode === 'royale' || mode === 'fog'");
  });
});
