import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf-8');
}

describe('adjudication score panels', () => {
  it('mounts score panels on spectator and play pages', () => {
    expect(read('public/spectator.html')).toContain('id="score-panel"');
    expect(read('public/play.html')).toContain('id="score-panel"');
  });

  it('shows the application version on spectator and play pages', () => {
    const spectator = read('public/spectator.html');
    const play = read('public/play.html');

    expect(spectator).toContain('<script src="/version.js"></script>');
    expect(play).toContain('<script src="/version.js"></script>');
    expect(spectator).toContain('<span class="version-badge"></span>');
    expect(play).toContain('<span class="version-badge"></span>');
    expect(spectator).not.toMatch(/version-badge">v\d+\.\d+\.\d+/);
    expect(play).not.toMatch(/version-badge">v\d+\.\d+\.\d+/);
  });

  it('computes and renders live scores in both front-end bundles', () => {
    for (const file of ['public/app.js', 'public/play.js']) {
      const source = read(file);
      expect(source).toContain('function computeAdjudicationScores');
      expect(source).toContain('function liveAdjudicationScores');
      expect(source).toContain('function renderScorePanel');
      expect(source).toContain('scorePanelEl.innerHTML');
      expect(source).toContain('state?.result?.scores');
      expect(source).toContain("isAnnihilationRules() ? 10 : 2");
      expect(source).toContain("label: '有效行动'");
    }
  });

  it('renders the adjudication score as a weighted formula on every client', () => {
    for (const file of ['public/app.js', 'public/play.js', 'public/play-m.js', 'public/spectator-m.js']) {
      const source = read(file);
      // 每个分项都要显式给出「数值 × 权重 = 分项」，权重为 0 的项不进榜。
      expect(source).toContain('function scoreTerms');
      expect(source).toContain('return terms.filter(term => term.weight > 0)');
      expect(source).toContain('<span class="st-weight">×${formatScore(term.weight)}</span>');
      expect(source).toContain('<span class="st-part">${formatScore(term.part)}</span>');
      expect(source).toContain('style="--share:${share}%"');
      expect(source).toContain('style="--tint:${scoreTint(owner)}"');
      expect(source).not.toMatch(/class="score-breakdown">\$\{esc\(scoreBreakdown/);
    }
    for (const file of ['public/style.css', 'public/play.css', 'public/play-m.css', 'public/spectator-m.css']) {
      const css = read(file);
      expect(css).toContain('.score-term');
      expect(css).toContain('.score-term-math .st-weight');
      expect(css).toContain('var(--share, 0%)');
      expect(css).toContain('.score-toggle');
    }
  });

  it('keeps the formula collapsed by default with the whole card as the hit target', () => {
    for (const file of ['public/app.js', 'public/play.js', 'public/play-m.js', 'public/spectator-m.js']) {
      const source = read(file);
      // 明细只在展开时生成，折叠态每人一行；开合状态存在 Map 里，SSE 重渲染不会把它冲掉。
      expect(source).toContain('open ? scoreBreakdown(score) : ');
      expect(source).toContain('const scoreRowOpen = new Map()');
      expect(source).toContain('function bindScoreToggles');
      expect(source).toContain('data-score-owner="${esc(owner)}"');
      expect(source).toContain('data-score-open="${open}"');
      expect(source).toContain('bindScoreToggles();');
      // 点整张卡片都开合，但卡内的改名按钮等控件必须留给各自逻辑，只有「公式」按钮本身例外。
      expect(source).toContain("event.target?.closest?.('[data-score-owner]')");
      expect(source).toContain("if (!event.target.closest('.score-toggle') && event.target.closest('button, a, input, select, textarea')) return;");
      expect(source).toContain('aria-expanded="${open}"');
    }
    for (const file of ['public/style.css', 'public/play.css', 'public/play-m.css', 'public/spectator-m.css']) {
      const css = read(file);
      expect(css).toContain('.score-term');
      expect(css).toContain('.score-term-math .st-weight');
      expect(css).toContain('var(--share, 0%)');
      expect(css).toContain('.score-toggle');
      // 整卡可点要有指针与底色反馈，且反馈不能覆盖玩家色左边框。
      expect(css.slice(css.indexOf('.score-row {'), css.indexOf('.score-row.player-a'))).toContain('cursor: pointer');
      expect(css).toMatch(/\.score-row:(hover|active)\s*\{\s*background: #131c26; \}/);
      expect(css).not.toMatch(/\.score-row:(hover|active)\s*\{[^}]*border/);
    }
    // 玩家页默认展开我方席位，观战页没有「我方」概念，默认展开第一名。
    for (const file of ['public/play.js', 'public/play-m.js']) {
      expect(read(file)).toContain('isScoreRowOpen(owner, owner === myPlayer)');
    }
    for (const file of ['public/app.js', 'public/spectator-m.js']) {
      expect(read(file)).toContain('isScoreRowOpen(owner, rank === 1)');
    }
    // 移动端抽屉是侧栏 HTML 副本，点击后必须整侧栏重渲染才会同步。
    for (const file of ['public/play-m.js', 'public/spectator-m.js']) {
      const source = read(file);
      const handler = source.slice(source.indexOf('function bindScoreToggles'), source.indexOf('function bindScoreToggles') + 900);
      expect(handler).toContain('renderSidebar();');
    }
  });

  it('play client prefers server adjudication and refreshes from GET /api/games/:id', () => {
    const source = read('public/play.js');
    expect(source).toContain('function refreshAdjudication');
    expect(source).toContain('state.adjudication = data.adjudication');
    expect(source).toContain('await refreshAdjudication()');
    expect(source).toContain('state?.adjudication?.scores');
    expect(source).toContain('function leadersFromGameOverPayload');
  });

  it('spectator client uses final result scores then local recompute only', () => {
    const source = read('public/app.js');
    expect(source).toContain('function liveAdjudicationScores');
    expect(source).toContain('state?.result?.scores');
    expect(source).not.toContain('state?.adjudication?.scores');
    expect(source).not.toContain('function refreshAdjudication');
  });

  it('renders adjudication scores as a leaderboard without a separate lead summary', () => {
    for (const file of ['public/app.js', 'public/play.js']) {
      const source = read(file);
      expect(source).toContain('<h3>分数排行榜</h3>');
      expect(source).toContain('score-rank');
      expect(source).not.toContain('score-leader');
      expect(source).not.toContain('领先');
    }
  });

  it('supports typed control point display and repair replay events', () => {
    for (const file of ['public/app.js', 'public/play.js']) {
      const source = read(file);
      expect(source).toContain('control_point_repair');
      expect(source).toContain('controlPointLabel');
      expect(source).toContain('controlPointStats');
    }
  });

  it('replays and labels comeback supply events on both front ends', () => {
    for (const file of ['public/app.js', 'public/play.js']) {
      const source = read(file);
      expect(source).toContain("case 'comeback_supply'");
      expect(source).toContain('追赶补给 +${p.amount}（落后${p.scoreGapPercent}%）');
    }
  });

  it('uses configured max turns in front-end adjudication labels', () => {
    for (const file of ['public/app.js', 'public/play.js', 'public/play-m.js', 'public/spectator-m.js']) {
      const source = read(file);
      expect(source).toContain('function maxTurnsLabel');
      expect(source).toContain('gameConfig?.balance?.maxTurns');
      // 无回合上限必须走显式分支，不能退化成「配置未加载」的兜底文案。
      expect(source).toContain('if (maxTurns === null) return');
      expect(source).not.toContain('15回合裁决');
    }
  });

  it('marks unlimited-round maps with an infinity marker on every client', () => {
    for (const file of ['public/app.js', 'public/play.js', 'public/play-m.js', 'public/spectator-m.js']) {
      expect(read(file)).toContain('${current}/∞');
    }
    for (const file of ['public/play.js', 'public/play-m.js']) {
      expect(read(file)).toContain("map.preview?.maxTurns === null ? '∞'");
    }
  });

  it('renders spectator scores and resources for every joined player', () => {
    const source = read('public/app.js');

    expect(source).toContain('const PLAYER_IDS = [');
    expect(source).toContain('function joinedPlayerIds()');
    expect(source).toContain('function ownerClass(owner)');
    expect(source).toContain('function ownerColor(owner)');
    expect(source).toContain('Object.fromEntries(players.map(owner => [owner, playerScore(owner)]))');
    expect(source).toContain('Object.entries(state.resources || {})');
    expect(source).toContain("state.players?.[owner]?.stats?.headquartersDamage");
    expect(source).not.toContain("const enemy = owner === 'player_a' ? 'player_b' : 'player_a';");
    expect(source).not.toContain('state.resources.player_a.supplies');
    expect(source).not.toContain('state.resources.player_b.supplies');
  });

  it('sends spectator rename requests to the host rename endpoint with the control token', () => {
    const source = read('public/app.js');
    const renameBody = source.slice(source.indexOf('async function renamePlayer'), source.indexOf('function downloadFile'));

    expect(renameBody).toContain("localStorage.getItem('autoControlToken')");
    expect(renameBody).toContain("headers['x-control-token'] = controlToken");
    expect(renameBody).toContain('/rename');
    expect(renameBody).toContain('playerId, name');
  });
});
