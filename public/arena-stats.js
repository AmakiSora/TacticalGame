import './version.js';
import './error-text.js';
import { loadMapLabels, mapLabel } from './map-labels.js';
import { barChart, hbarMidline, stackedHBar, radarChart, heatmap, scatter, CHART_COLORS } from './arena-charts.js';

/* 竞技场玩法统计 + 参与者档案 — reads /data/arena-stats.json + arena-leaderboard.json + arena-map-fingerprint.json. */
(() => {
  const DATA_URL = '/data/arena-stats.json';
  const LEADERBOARD_URL = '/data/arena-leaderboard.json';
  const FINGERPRINT_URL = '/data/arena-map-fingerprint.json';

  const MODE_LABELS = { standard: '标准模式', annihilation: '歼灭模式', simultaneous: '同时回合', royale: '大逃杀' };
  const UNIT_NAMES = { infantry: '步兵', scout: '侦察兵', heavy: '重装', ranger: '远程兵', support: '支援兵' };
  const END_REASON_LABELS = {
    last_player_standing: '歼灭获胜',
    turn_limit_score: '打满回合·比分胜负',
    turn_limit_draw: '打满回合·平局',
    mutual_annihilation: '同归于尽',
    unknown: '未知',
  };
  // 裁决 7 分项（相对归一化雷达图轴）：key → 中文名。
  const SB_AXES = [
    ['headquartersDamage', '推HQ伤害'],
    ['ownHqHp', '保HQ血量'],
    ['controlPoints', '控点'],
    ['controlHold', '控点持有'],
    ['armyValue', '军队价值'],
    ['supplies', '补给'],
    ['killValue', '击杀价值'],
  ];
  // 动作类型固定配色（未列出的类型轮询取色）。
  const ACTION_COLORS = {
    attack: '#f0a0a0', move: '#9ad3e8', deploy: '#e8c890', heal: '#8ddda4',
    capture: '#3f9b6c', end_turn: '#66788a', demolish: '#c98bd8', bombard: '#e8a06c',
  };
  const ACTION_NAMES = {
    attack: '攻击', move: '移动', deploy: '部署', heal: '治疗', capture: '占领',
    end_turn: '结束回合', demolish: '爆破', bombard: '炮击',
  };
  const STATUS_META = {
    recommended: { label: '当前推荐', cls: 'st-good' },
    legacy: { label: '历史', cls: 'st-muted' },
    retired: { label: '作废', cls: 'st-bad' },
    builtin: { label: '内置算法', cls: 'st-algo' },
  };

  const el = {};
  for (const id of ['rls-generated-at', 'rls-source-count', 'rls-date-range', 'rls-load-status', 'rls-btn-reload',
    'rls-mode-bar', 'rls-kpi-grid', 'rls-endreasons', 'rls-economy', 'rls-rounds-dist', 'rls-duration-dist',
    'rls-decision-dist', 'rls-action-mix', 'rls-firstseat', 'rls-radar', 'rls-radar-pick',
    'rls-heatmap', 'rls-seat-scatter', 'rls-fingerprint-table',
    'rls-units-table', 'rls-model-table', 'rls-map-table',
    'rls-models-status', 'rls-model-cards', 'rls-deprecated']) {
    el[id] = document.getElementById(id);
  }

  /** @type {any} */
  let raw = null;
  /** @type {any} 评分数据（leaderboard），供热力图 / 座位散点 / 雷达图默认排序。 */
  let lb = null;
  /** @type {any} 地图静态指纹。 */
  let fp = null;
  let mode = null;
  let modelSort = { key: 'winRate', dir: 'desc' };
  /** 雷达图选中模型 id 集合（点击 chips 切换，最多 RADAR_MAX 个）。 */
  let radarPick = new Set();
  /** 用户是否动过雷达选择：动过之后即使清空也不再自动补默认选中。 */
  let radarTouched = false;
  const RADAR_MAX = 4;

  function modes() {
    if (Array.isArray(raw?.modes) && raw.modes.length) return raw.modes;
    // 旧版 arena-stats.json 没有 modes：退回全量 gameplay，页面仍可用。
    return raw?.gameplay ? [{ id: 'all', label: '全部模式', games: raw.source?.matchCount ?? 0, gameplay: raw.gameplay }] : [];
  }

  function currentMode() {
    return modes().find(item => item.id === mode) || modes()[0] || null;
  }

  function currentGameplay() {
    return currentMode()?.gameplay || { overview: {}, endReasons: [], economy: {}, roundsDist: [], durationDist: [], units: [], perModel: [], perMap: [] };
  }

  function renderModeBar() {
    el['rls-mode-bar'].innerHTML = modes().map(item => {
      const active = item.id === currentMode()?.id;
      return `<button type="button" class="mode-tab${active ? ' active' : ''}" data-mode="${escapeAttr(item.id)}" role="tab" aria-selected="${active}">
        <span>${escapeHtml(item.label)}</span><span class="mode-count">${item.games ?? item.gameplay?.overview?.games ?? 0}</span>
      </button>`;
    }).join('');
  }

  function setStatus(text, kind) {
    el['rls-load-status'].textContent = text;
    el['rls-load-status'].classList.remove('ok', 'err');
    if (kind) el['rls-load-status'].classList.add(kind);
    // 模型档案页签有自己的状态灯，同步文案。
    el['rls-models-status'].textContent = text;
    el['rls-models-status'].classList.remove('ok', 'err');
    if (kind) el['rls-models-status'].classList.add(kind);
  }

  function pct(n) {
    if (n == null || Number.isNaN(n)) return '—';
    return `${(n * 100).toFixed(1)}%`;
  }

  function fmtNum(n) {
    return n == null ? '—' : Number(n).toLocaleString();
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, '&#39;');
  }

  function modeLabelById(id) {
    return modes().find(item => item.id === id)?.label || MODE_LABELS[id] || id;
  }

  function unitLabel(type) {
    return UNIT_NAMES[type] || type;
  }

  function endReasonLabel(reason) {
    return END_REASON_LABELS[reason] || reason;
  }

  /** bar-list 渲染（label + 条形 + 计数），与 stats.js 的条形图同款。 */
  function renderBars(container, rows) {
    if (!rows.length) {
      container.className = 'empty-block';
      container.textContent = '无数据';
      return;
    }
    const max = Math.max(...rows.map(r => r.count), 1);
    container.className = 'bar-list';
    container.innerHTML = rows.map(r => {
      const w = Math.max(2, Math.round(r.count / max * 100));
      return `<div class="bar-row">
        <div class="name" title="${escapeAttr(r.label)}">${escapeHtml(r.label)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${w}%"></div></div>
        <div class="count">${fmtNum(r.count)}（${pct(r.pct)}）</div>
      </div>`;
    }).join('');
  }

  function renderKpis(gp) {
    const o = gp.overview;
    const cards = [
      { label: '统计对局', value: fmtNum(o.games), sub: `平局 ${pct(o.drawRate)}` },
      { label: '平均回合', value: o.avgRounds ?? '—', sub: '30 回合上限' },
      { label: '平均耗时', value: o.avgDurationSec != null ? `${o.avgDurationSec}s` : '—', sub: '进程内模拟墙钟' },
      { label: '平均行动数', value: fmtNum(o.avgActions), sub: '单局双方合计' },
      { label: '歼灭率', value: pct(o.annihilationRate), sub: 'last_player_standing' },
      { label: '翻盘补给触发率', value: pct(gp.economy.comebackRate), sub: '按模型×局计' },
    ];
    el['rls-kpi-grid'].innerHTML = cards
      .map(c => `<article class="kpi-card"><div class="label">${c.label}</div><div class="value">${c.value}</div><div class="sub">${c.sub || ''}</div></article>`)
      .join('');
  }

  function renderEconomy(eco) {
    const items = [
      { label: '场均总收入', value: fmtNum(eco.avgIncomeTotal), sub: `控制点收入占 ${pct(eco.controlShare)}` },
      { label: '场均部署花费', value: fmtNum(eco.avgDeployCost) },
      { label: '场均占领', value: eco.avgCaptures ?? '—', sub: `偷点 ${eco.avgSteals ?? '—'}` },
      { label: '平均首占回合', value: eco.avgFirstCaptureRound ?? '—', sub: '首次占领控制点' },
    ];
    el['rls-economy'].className = '';
    el['rls-economy'].innerHTML = `<div class="econ-grid">${items
      .map(it => `<div class="econ-item"><div class="label">${it.label}</div><div class="value">${it.value}</div><div class="sub">${it.sub || ''}</div></div>`)
      .join('')}</div>`;
  }

  function renderUnits(units) {
    const body = el['rls-units-table'].querySelector('tbody');
    body.innerHTML = units.map(u => `<tr>
      <td data-label="兵种">${escapeHtml(unitLabel(u.type))}</td>
      <td class="num" data-label="部署数">${fmtNum(u.deploys)}</td>
      <td class="num" data-label="部署占比">${pct(u.deployShare)}</td>
      <td class="num" data-label="阵亡数">${fmtNum(u.losses)}</td>
      <td class="num" data-label="阵亡占比">${pct(u.lossShare)}</td>
    </tr>`).join('') || '<tr><td colspan="5" class="muted">无数据</td></tr>';
  }

  function sortedModels(rows) {
    const mul = modelSort.dir === 'asc' ? 1 : -1;
    return rows.slice().sort((a, b) => {
      const av = a[modelSort.key];
      const bv = b[modelSort.key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv) * mul;
      return (av - bv) * mul;
    });
  }

  function renderModelTable(gp) {
    const profileById = new Map((raw.models || []).map(m => [m.id, m]));
    const rows = gp.perModel.map(m => ({ ...m, short: profileById.get(m.id)?.short || m.id }));
    const body = el['rls-model-table'].querySelector('tbody');
    body.innerHTML = sortedModels(rows).map(m => {
      const topDeploys = (m.topDeploys || []).map(t => `${unitLabel(t.type)} ${fmtNum(t.count)}`).join(' / ');
      return `<tr>
        <td class="model-name" data-label="模型" title="${escapeAttr(m.id)}">${escapeHtml(m.short)}</td>
        <td class="num" data-label="局数">${fmtNum(m.games)}</td>
        <td class="num" data-label="胜率">${m.winRate == null ? '—' : `<span class="pill-rate">${pct(m.winRate)}</span>`}</td>
        <td class="num" data-label="场均得分">${fmtNum(m.avgScore)}</td>
        <td class="num" data-label="场均伤害">${fmtNum(m.avgDamageDealt)}</td>
        <td class="num" data-label="场均承受">${fmtNum(m.avgDamageTaken)}</td>
        <td class="num" data-label="场均击杀">${m.avgKills ?? '—'}</td>
        <td class="num" data-label="场均损失">${m.avgLosses ?? '—'}</td>
        <td class="num" data-label="场均占领">${m.avgCaptures ?? '—'}</td>
        <td class="num" data-label="场均偷点">${m.avgSteals ?? '—'}</td>
        <td class="num" data-label="场均收入">${fmtNum(m.avgIncome)}</td>
        <td class="num" data-label="首占回合">${m.avgFirstCaptureRound ?? '—'}</td>
        <td class="num" data-label="平均决策耗时">${m.avgDecisionMs != null ? `${m.avgDecisionMs}ms` : '—'}</td>
        <td data-label="主力兵种" class="muted">${escapeHtml(topDeploys || '—')}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="14" class="muted">无数据</td></tr>';
    el['rls-model-table'].querySelectorAll('th[data-sort]').forEach(th => {
      th.classList.toggle('sorted', th.dataset.sort === modelSort.key);
    });
  }

  function renderMapTable(gp) {
    const body = el['rls-map-table'].querySelector('tbody');
    body.innerHTML = gp.perMap.map(m => `<tr>
      <td data-label="地图">${escapeHtml(mapLabel(m.map))}</td>
      <td class="num" data-label="局数">${fmtNum(m.games)}</td>
      <td class="num" data-label="平均回合">${m.avgRounds ?? '—'}</td>
      <td class="num" data-label="平均耗时">${m.avgDurationSec != null ? `${m.avgDurationSec}s` : '—'}</td>
      <td class="num" data-label="先手胜率">${m.firstSeatWinRate != null ? pct(m.firstSeatWinRate) : '—'}</td>
      <td class="num" data-label="控制点易手">${m.avgControlPointFlips ?? '—'}</td>
      <td class="num" data-label="歼灭率">${pct(m.annihilationRate)}</td>
      <td class="num" data-label="平局率">${pct(m.drawRate)}</td>
      <td data-label="最常见结局">${escapeHtml(endReasonLabel(m.topEndReason))}</td>
    </tr>`).join('') || '<tr><td colspan="9" class="muted">无数据</td></tr>';
  }

  // ---- 2026-10-30 新增：多数据源 + SVG 图表 ----

  function leaderboardMode() {
    const modes = Array.isArray(lb?.modes) ? lb.modes : [];
    return modes.find(item => item.id === mode) || modes[0] || null;
  }
  function lbModels() {
    return leaderboardMode()?.maps?.all?.models || [];
  }
  function shortOf(id) {
    return lb?.registry?.[id]?.short || raw?.models?.find(m => m.id === id)?.short || id;
  }

  /** 雷达图候选：当前模式 perModel 里带裁决 7 分项的（重跑后才有）。 */
  function radarCandidates() {
    return currentGameplay().perModel.filter(m => m.scoreBreakdown);
  }

  /** 候选排序（局数降序、同局数按 id）——默认选中与固定配色都按它，保证顺序稳定。 */
  function radarOrderedCandidates() {
    return radarCandidates().slice()
      .sort((a, b) => (b.games ?? 0) - (a.games ?? 0) || a.id.localeCompare(b.id));
  }

  /** 按候选顺序固定配色：来回勾选不会让同一模型换色（否则对比容易误读）。 */
  function radarColorMap() {
    return new Map(radarOrderedCandidates()
      .map((m, i) => [m.id, CHART_COLORS[i % CHART_COLORS.length]]));
  }

  function renderRadarPick(note) {
    const candidates = radarCandidates();
    if (!candidates.length) {
      el['rls-radar-pick'].innerHTML = '<span class="hint">暂无打法数据——重跑竞技场（采集裁决 7 分项）后展示。</span>';
      return;
    }
    // 仅在首次渲染（或切模式/重载后的首次）补默认选中；用户主动清空后保持空选。
    if (!radarTouched && !radarPick.size) {
      radarPick = new Set(radarOrderedCandidates().slice(0, 3).map(m => m.id));
    }
    const validIds = new Set(candidates.map(m => m.id));
    radarPick = new Set([...radarPick].filter(id => validIds.has(id)));
    const chips = candidates.map(m => {
      const on = radarPick.has(m.id);
      return `<button type="button" class="chip${on ? ' on' : ''}" data-id="${escapeAttr(m.id)}" `
        + `aria-pressed="${on}">${escapeHtml(shortOf(m.id))}</button>`;
    }).join('');
    const hint = note ? `<span class="hint">${escapeHtml(note)}</span>` : '';
    el['rls-radar-pick'].innerHTML = chips + hint;
  }

  function renderRadar() {
    const candidates = radarCandidates();
    if (!candidates.length) {
      el['rls-radar'].className = 'chart-block empty-block';
      el['rls-radar'].textContent = '重跑竞技场后展示裁决 7 分项风格指纹';
      return;
    }
    const selected = candidates.filter(m => radarPick.has(m.id));
    if (!selected.length) {
      el['rls-radar'].className = 'chart-block empty-block';
      el['rls-radar'].textContent = '请选择至少一个模型';
      return;
    }
    // 相对归一化：量纲不同，每个维度除以该维度所有候选模型的最大值。
    const maxByKey = {};
    for (const [key] of SB_AXES) {
      let mx = 0;
      for (const m of candidates) mx = Math.max(mx, m.scoreBreakdown[key] ?? 0);
      maxByKey[key] = mx || 1;
    }
    const colorOf = radarColorMap();
    const series = selected.map((m, i) => ({
      name: shortOf(m.id),
      color: colorOf.get(m.id) ?? CHART_COLORS[i % CHART_COLORS.length],
      data: Object.fromEntries(SB_AXES.map(([key]) => [key, (m.scoreBreakdown[key] ?? 0) / maxByKey[key]])),
    }));
    el['rls-radar'].className = 'chart-block radar-grid';
    const legend = series.map(s => `<span class="legend-item"><i style="background:${s.color}"></i>${escapeHtml(s.name)}</span>`).join('');
    el['rls-radar'].innerHTML = `<div class="radar-wrap">${radarChart({ axes: SB_AXES.map(([key, label]) => ({ key, label })), series })}</div><div class="chart-legend">${legend}</div>`;
  }

  function renderFirstSeat() {
    const rows = currentGameplay().perMap.map(m => ({ label: mapLabel(m.map), value: m.firstSeatWinRate }))
      .filter(r => r.value != null);
    if (!rows.length) {
      el['rls-firstseat'].className = 'chart-block empty-block';
      el['rls-firstseat'].textContent = '无先手胜率数据';
      return;
    }
    const values = rows.map(r => r.value);
    const lo = Math.min(0.5, ...values) - 0.05, hi = Math.max(0.5, ...values) + 0.05;
    el['rls-firstseat'].className = 'chart-block';
    el['rls-firstseat'].innerHTML = hbarMidline({ rows, midline: 0.5, min: lo, max: hi, format: v => `${(v * 100).toFixed(1)}%` });
  }

  function renderDecisionDist() {
    const dist = currentGameplay().decisionMsDist || [];
    if (!dist.some(b => b.count > 0)) {
      el['rls-decision-dist'].className = 'chart-block empty-block';
      el['rls-decision-dist'].textContent = '本模式暂无决策计时（旧数据未采集，重跑后展示）';
      return;
    }
    el['rls-decision-dist'].className = 'chart-block';
    el['rls-decision-dist'].innerHTML = barChart({
      labels: dist.map(b => b.bucket), values: dist.map(b => b.count),
      pcts: dist.map(b => b.pct != null ? `${(b.pct * 100).toFixed(1)}%` : null),
      format: v => v.toLocaleString(), color: '#9ad3e8',
    });
  }

  function renderActionMix() {
    const gp = currentGameplay();
    const overviewMix = gp.overview.actionMix;
    const modelRows = gp.perModel.filter(m => m.actionMix).slice(0, 10);
    if (!overviewMix && !modelRows.length) {
      el['rls-action-mix'].className = 'chart-block empty-block';
      el['rls-action-mix'].textContent = '重跑竞技场后展示动作类型分布';
      return;
    }
    const typeTotal = {};
    const collect = mix => { if (mix?.byType) for (const [t, v] of Object.entries(mix.byType)) typeTotal[t] = (typeTotal[t] ?? 0) + v; };
    collect(overviewMix);
    modelRows.forEach(m => collect(m.actionMix));
    const types = Object.keys(typeTotal).sort((a, b) => typeTotal[b] - typeTotal[a]);
    const colorOf = {};
    types.forEach((t, i) => { colorOf[t] = ACTION_COLORS[t] || CHART_COLORS[i % CHART_COLORS.length]; });
    const segs = mix => types.map(t => ({ value: mix?.byType?.[t] ?? 0, color: colorOf[t], label: ACTION_NAMES[t] || t }));
    const rows = [];
    if (overviewMix) rows.push({ label: '全局', segments: segs(overviewMix) });
    modelRows.forEach(m => rows.push({ label: shortOf(m.id), segments: segs(m.actionMix) }));
    const legend = types.map(t => ({ label: ACTION_NAMES[t] || t, color: colorOf[t] }));
    el['rls-action-mix'].className = 'chart-block';
    el['rls-action-mix'].innerHTML = stackedHBar({ rows, legend });
  }

  function renderHeatmap() {
    const lm = leaderboardMode();
    const models = (lm?.maps?.all?.models || []).filter(m => m.games > 0)
      .sort((a, b) => (b.rating ?? -Infinity) - (a.rating ?? -Infinity)).slice(0, 12);
    const maps = Object.keys(lm?.maps || {}).filter(k => k !== 'all').sort();
    if (!models.length || !maps.length) {
      el['rls-heatmap'].className = 'chart-block empty-block';
      el['rls-heatmap'].textContent = '无评分数据';
      return;
    }
    const rows = models.map(m => ({ id: m.id, label: shortOf(m.id) }));
    const cols = maps.map(mp => ({ id: mp, label: mapLabel(mp) }));
    const get = (row, col) => {
      const cell = models.find(x => x.id === row.id)?.perMap?.[col.id];
      return cell?.winRate != null ? cell.winRate : null;
    };
    // 自适应色阶：聚焦实际胜率区间，拉开中段模型的色差。
    const vals = [];
    rows.forEach(r => cols.forEach(c => { const v = get(r, c); if (v != null) vals.push(v); }));
    let vMin = Math.min(...vals), vMax = Math.max(...vals);
    if (vMax - vMin < 1e-6) vMax = vMin + 1;
    el['rls-heatmap'].className = 'chart-block heatmap-block';
    el['rls-heatmap'].innerHTML = heatmap({ rows, cols, get, min: vMin, max: vMax, format: v => `${(v * 100).toFixed(0)}` });
  }

  function renderSeatScatter() {
    const models = lbModels().filter(m => m.firstSeat?.winRate != null && m.secondSeat?.winRate != null);
    if (!models.length) {
      el['rls-seat-scatter'].className = 'chart-block empty-block';
      el['rls-seat-scatter'].textContent = '无座位胜率数据';
      return;
    }
    const points = models.map(m => {
      const swing = m.firstSeat.winRate - m.secondSeat.winRate;
      return {
        x: m.firstSeat.winRate, y: swing,
        label: shortOf(m.id),
        showLabel: Math.abs(swing) > 0.04,
        color: (lb?.registry?.[m.id]?.kind === 'algorithm') ? '#9ad3e8' : CHART_COLORS[0],
      };
    });
    el['rls-seat-scatter'].className = 'chart-block';
    el['rls-seat-scatter'].innerHTML = scatter({
      points, xLabel: '先手胜率', yLabel: '先手 − 后手胜率差',
      yref: 0, formatX: v => `${(v * 100).toFixed(0)}%`, formatY: v => `${(v * 100).toFixed(0)}pt`,
    });
  }

  function renderFingerprint() {
    const maps = (fp?.maps || []).filter(m => m.mode === mode);
    const body = el['rls-fingerprint-table'].querySelector('tbody');
    if (!maps.length) {
      body.innerHTML = '<tr><td colspan="8" class="muted">无指纹数据</td></tr>';
      return;
    }
    body.innerHTML = maps.map(m => {
      const sym = m.symmetry;
      const symText = (sym?.mirror?.fullySymmetric || sym?.central?.fullySymmetric) ? '对称' : '不对称';
      const terrain = (m.terrain || []).map(t => `${t.kind}×${t.count}`).join(' / ') || '—';
      return `<tr>
        <td data-label="地图">${escapeHtml(mapLabel(m.id))}</td>
        <td data-label="模式">${escapeHtml(MODE_LABELS[m.mode] || m.mode)}</td>
        <td class="num" data-label="半径">${m.radius ?? '—'}</td>
        <td class="num" data-label="HQ 间距">${m.hqDistance ?? '—'}</td>
        <td class="num" data-label="控制点">${m.controlPointCount ?? '—'}</td>
        <td class="num" data-label="控制点偏置">${m.totalControlPointBias ?? '—'}</td>
        <td data-label="对称性">${symText}</td>
        <td data-label="地形">${escapeHtml(terrain)}</td>
      </tr>`;
    }).join('');
  }

  function fmtSteps(steps) {
    if (steps == null) return 'best';
    return steps >= 1_000_000 ? `${(steps / 1_000_000).toFixed(1)}M 步` : `${Math.round(steps / 1000)}K 步`;
  }

  function renderModelCards(allModels) {
    const models = allModels;
    if (!models.length) {
      el['rls-model-cards'].innerHTML = '<div class="empty-block">无模型档案</div>';
      return;
    }
    el['rls-model-cards'].innerHTML = models.map(m => {
      const statusMeta = STATUS_META[m.status] || STATUS_META.legacy;
      const ratingText = m.rating != null ? `${m.rating}` : '未参评';
      const ratingTitle = m.rating != null && m.ratingLo != null
        ? `95% CI ${m.ratingLo}–${m.ratingHi}${m.ratingModeLabel ? ` · ${m.ratingModeLabel}` : ''}`
        : '';
      const metaBits = m.kind === 'algorithm' ? [
        m.games ? `<span>对局 <b>${fmtNum(m.games)}</b></span>` : '',
        m.winRate != null ? `<span>胜率 <b>${pct(m.winRate)}</b></span>` : '',
        m.ratingModeLabel ? `<span>评分模式 <b>${escapeHtml(m.ratingModeLabel)}</b></span>` : '',
        Array.isArray(m.modes) && m.modes.length ? `<span>支持模式 <b>${escapeHtml(m.modes.map(modeLabelById).join(' / '))}</b></span>` : '',
        `<span>注册名 <b>${escapeHtml(m.algorithm || '')}</b></span>`,
        `<span>版本 <b>${escapeHtml(m.version || '')}</b></span>`,
        m.docRef ? `<span>文档 <b>${escapeHtml(m.docRef)}</b></span>` : '',
      ].filter(Boolean).join('') : [
        m.games ? `<span>对局 <b>${fmtNum(m.games)}</b></span>` : '',
        m.winRate != null ? `<span>胜率 <b>${pct(m.winRate)}</b></span>` : '',
        m.ratingModeLabel ? `<span>评分模式 <b>${escapeHtml(m.ratingModeLabel)}</b></span>` : '',
        Array.isArray(m.modes) && m.modes.length ? `<span>支持模式 <b>${escapeHtml(m.modes.map(modeLabelById).join(' / '))}</b></span>` : '',
        `<span>训练日期 <b>${escapeHtml(m.trainDate)}</b></span>`,
        `<span>训练地图 <b>${escapeHtml(mapLabel(m.trainMap))}</b></span>`,
        `<span>训练对手 <b>${escapeHtml(m.opponentType)}</b></span>`,
        `<span>交付步数 <b>${fmtSteps(m.deliveredSteps ?? m.steps)}</b></span>`,
        m.sizeMB != null ? `<span>文件 <b>${m.sizeMB} MB</b></span>` : '',
        m.docRef ? `<span>档案 <b>${escapeHtml(m.docRef)}</b></span>` : '',
      ].filter(Boolean).join('');
      const noteParts = [];
      if (m.docStatus) noteParts.push(m.docStatus);
      if (m.statusNote) noteParts.push(`评估协议限制：${m.statusNote}`);
      if (m.notes) noteParts.push(m.notes);
      const notesHtml = noteParts.length
        ? `<div class="card-notes">${escapeHtml(noteParts.join('\n'))}</div>`
        : '<div class="card-notes empty">暂无档案说明（MODELS_NOTES.md 未收录该文件）。</div>';
      return `<article class="model-card">
        <div class="card-head">
          <strong>${escapeHtml(m.short)}</strong>
          <span class="tag ${statusMeta.cls}">${statusMeta.label}</span>
          <span class="card-rating" title="${escapeAttr(ratingTitle)}">${ratingText}</span>
        </div>
        <div class="card-meta">${metaBits}</div>
        ${notesHtml}
        <div class="card-file">${escapeHtml(m.id)}</div>
      </article>`;
    }).join('');
  }

  function renderDeprecated(list) {
    if (!list.length) {
      el['rls-deprecated'].className = 'empty-block';
      el['rls-deprecated'].textContent = '无';
      return;
    }
    el['rls-deprecated'].className = '';
    el['rls-deprecated'].innerHTML = `<div class="table-wrap"><table class="data-table compact">
      <thead><tr><th>模型文件</th><th>版本</th><th>作废原因</th></tr></thead>
      <tbody>${list.map(x => `<tr>
        <td class="model-name" title="${escapeAttr(x.file)}">${escapeHtml(x.file)}</td>
        <td>${escapeHtml(x.version)}</td>
        <td class="muted">${escapeHtml(x.reason)}</td>
      </tr>`).join('')}</tbody></table></div>`;
  }

  function renderAll() {
    const gp = currentGameplay();
    renderKpis(gp);
    renderBars(el['rls-endreasons'], gp.endReasons.map(e => ({ label: endReasonLabel(e.reason), count: e.count, pct: e.pct })));
    renderEconomy(gp.economy);
    // 回合 / 耗时分布升级为 SVG 柱状图。
    el['rls-rounds-dist'].className = 'chart-block';
    el['rls-rounds-dist'].innerHTML = barChart({
      labels: gp.roundsDist.map(b => b.bucket), values: gp.roundsDist.map(b => b.count),
      pcts: gp.roundsDist.map(b => b.pct != null ? `${(b.pct * 100).toFixed(1)}%` : null),
      format: v => v.toLocaleString(),
    });
    el['rls-duration-dist'].className = 'chart-block';
    el['rls-duration-dist'].innerHTML = barChart({
      labels: gp.durationDist.map(b => b.bucket), values: gp.durationDist.map(b => b.count),
      pcts: gp.durationDist.map(b => b.pct != null ? `${(b.pct * 100).toFixed(1)}%` : null),
      format: v => v.toLocaleString(), color: '#e8c890',
    });
    renderDecisionDist();
    renderActionMix();
    renderFirstSeat();
    renderRadarPick();
    renderRadar();
    renderUnits(gp.units);
    renderModelTable(gp);
    renderHeatmap();
    renderSeatScatter();
    renderMapTable(gp);
    renderFingerprint();
    renderModelCards(raw.models || []);
    renderDeprecated(raw.deprecated || []);
  }

  async function loadData() {
    setStatus('加载中…');
    // 地图中文名先就位，再渲染（否则新地图会先以英文 mapId 出现）。
    await loadMapLabels();
    try {
      const [statsRes, lbRes, fpRes] = await Promise.all([
        fetch(`${DATA_URL}?t=${Date.now()}`, { cache: 'no-store' }),
        // 评分与指纹是增强数据源：各自兜住网络异常，任一缺失只让对应面板降级，
        // 不能让整页连玩法统计一起失败（stats.json 才是主数据源）。
        fetch(`${LEADERBOARD_URL}?t=${Date.now()}`, { cache: 'no-store' }).catch(() => null),
        fetch(`${FINGERPRINT_URL}?t=${Date.now()}`, { cache: 'no-store' }).catch(() => null),
      ]);
      if (!statsRes.ok) throw new Error(`HTTP ${statsRes.status}`);
      raw = await statsRes.json();
      lb = lbRes?.ok ? await lbRes.json().catch(() => null) : null;
      fp = fpRes?.ok ? await fpRes.json().catch(() => null) : null;
      el['rls-generated-at'].textContent = raw.generatedAt ? new Date(raw.generatedAt).toLocaleString() : '—';
      el['rls-source-count'].textContent = raw.source?.matchCount ?? 0;
      el['rls-date-range'].textContent = raw.source?.dateMin
        ? `${raw.source.dateMin} → ${raw.source.dateMax ?? ''}`
        : '—';
      if (!mode || !modes().some(item => item.id === mode)) mode = modes()[0]?.id || null;
      radarPick = new Set();
      radarTouched = false;
      renderModeBar();
      renderAll();
      const warnings = raw.warnings || [];
      if (!raw.source?.matchCount) {
        setStatus('暂无对局数据', 'err');
      } else if (warnings.length) {
        setStatus(`已加载（${warnings.length} 条警告）`, 'err');
      } else {
        setStatus('已加载', 'ok');
      }
    } catch (err) {
      setStatus(`加载失败：${window.ErrorText.describe(err)}`, 'err');
    }
  }

  el['rls-btn-reload'].addEventListener('click', loadData);
  el['rls-mode-bar'].addEventListener('click', event => {
    const button = event.target.closest('.mode-tab[data-mode]');
    if (!button || button.dataset.mode === mode) return;
    mode = button.dataset.mode;
    radarPick = new Set();
    radarTouched = false;
    renderModeBar();
    renderAll();
  });
  el['rls-radar-pick'].addEventListener('click', event => {
    const btn = event.target.closest('.chip[data-id]');
    if (!btn) return;
    const id = btn.dataset.id;
    radarTouched = true;
    if (radarPick.has(id)) {
      // 再点一次取消；允许清空（清空后显示「请选择至少一个模型」，不再自动回填）。
      radarPick.delete(id);
    } else if (radarPick.size < RADAR_MAX) {
      radarPick.add(id);
    } else {
      renderRadarPick(`最多同时对比 ${RADAR_MAX} 个模型，请先取消一个`);
      return;
    }
    renderRadarPick();
    renderRadar();
  });
  el['rls-model-table'].querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (modelSort.key === key) {
        modelSort.dir = modelSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        modelSort = { key, dir: key === 'short' ? 'asc' : 'desc' };
      }
      if (raw) renderModelTable(currentGameplay());
    });
  });

  loadData();
})();
