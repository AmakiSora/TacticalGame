import './version.js';
import './ui-dialog.js';
import './error-text.js';

/* AI 竞技场排行榜 — reads /data/arena-leaderboard.json only. */
(() => {
  const DATA_URL = '/data/arena-leaderboard.json';

  const MAP_LABELS = {
    random: '随机图', default: '六角前线', breach: '破障行动', 'danger-close': '危险距离',
    'dual-lanes': '双线抉择', 'artillery-zone': '炮火禁区', standoff: '对峙之地',
    'molten-throne': '熔池王座', snowflake: '雪花', 'narrow-road': '狭路相逢',
  };
  const STATUS_META = {
    recommended: { label: '当前推荐', cls: 'st-good' },
    legacy: { label: '历史', cls: 'st-muted' },
    retired: { label: '作废', cls: 'st-bad' },
    builtin: { label: '内置算法', cls: 'st-algo' },
  };
  const KIND_BADGE = {
    model: { label: '模型', cls: 'st-model' },
    algorithm: { label: '算法', cls: 'st-algo' },
  };

  const el = {
    generatedAt: document.getElementById('generated-at'),
    sourceCount: document.getElementById('source-count'),
    dateRange: document.getElementById('date-range'),
    loadStatus: document.getElementById('load-status'),
    btnReload: document.getElementById('btn-reload'),
    kpiGrid: document.getElementById('kpi-grid'),
    modeBar: document.getElementById('mode-bar'),
    boardModeHint: document.getElementById('board-mode-hint'),
    filterLeague: document.getElementById('filter-league'),
    filterKind: document.getElementById('filter-kind'),
    modelTable: document.getElementById('model-table'),
    h2hHead: document.getElementById('h2h-head'),
    h2hBody: document.getElementById('h2h-body'),
    detailTitle: document.getElementById('detail-title'),
    detailBody: document.getElementById('detail-body'),
    methodBody: document.getElementById('method-body'),
    excludedBody: document.getElementById('excluded-body'),
  };

  /** @type {any} */
  let raw = null;
  let mode = null;
  let league = 'all';
  let kindFilter = 'all';
  let selectedModel = null;
  let sort = { key: 'rating', dir: 'desc' };

  function modes() {
    return Array.isArray(raw?.modes) ? raw.modes : [];
  }

  function currentMode() {
    return modes().find(m => m.id === mode) || modes()[0] || null;
  }

  function setStatus(text, kind) {
    el.loadStatus.textContent = text;
    el.loadStatus.classList.remove('ok', 'err');
    if (kind) el.loadStatus.classList.add(kind);
  }

  function pct(n) {
    if (n == null || Number.isNaN(n)) return '—';
    return `${(n * 100).toFixed(1)}%`;
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

  function mapLabel(map) {
    return MAP_LABELS[map] || map;
  }

  function currentLeague() {
    return currentMode()?.maps?.[league] || null;
  }

  /** 每个参与者行的展示视图：合并 registry 元数据 + 排名 + 扁平化排序字段。 */
  function buildRows(ld) {
    const ordered = ld.models.slice().sort((a, b) => (b.rating ?? -Infinity) - (a.rating ?? -Infinity));
    const rankById = new Map(ordered.map((m, i) => [m.id, m.games > 0 ? i + 1 : null]));
    return ld.models.map(m => {
      const meta = raw.registry[m.id] || {};
      return {
        ...m,
        rank: rankById.get(m.id),
        kind: meta.kind || 'model',
        short: meta.short || m.id,
        algorithm: meta.algorithm || '',
        description: meta.description || '',
        version: meta.version || '',
        trainDate: meta.trainDate || '',
        trainMap: meta.trainMap || '',
        opponentType: meta.opponentType || '',
        steps: meta.steps,
        deliveredSteps: meta.deliveredSteps ?? null,
        status: meta.status || 'legacy',
        statusNote: meta.statusNote || null,
        firstSeatRate: m.firstSeat?.winRate ?? null,
        secondSeatRate: m.secondSeat?.winRate ?? null,
      };
    });
  }

  /** 当前类型筛选下的行（评分表与对位矩阵共用；排名仍是全池排名）。 */
  function viewRows(ld) {
    const rows = buildRows(ld);
    return kindFilter === 'all' ? rows : rows.filter(r => r.kind === kindFilter);
  }

  function kindBadge(kind) {
    const b = KIND_BADGE[kind];
    return b ? `<span class="tag ${b.cls}">${b.label}</span> ` : '';
  }

  function sortRows(rows, s) {
    const mul = s.dir === 'asc' ? 1 : -1;
    return rows.slice().sort((a, b) => {
      const av = a[s.key];
      const bv = b[s.key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv) * mul;
      return (av - bv) * mul;
    });
  }

  function ratingCell(row) {
    if (row.rating == null) return '—';
    const lo = row.rating - row.ratingLo;
    const hi = row.ratingHi - row.rating;
    const ci = Math.round(Math.max(lo, hi));
    return `${row.rating}<span class="rating-ci">±${ci}</span>`;
  }

  function wldCell(row) {
    if (row.games === 0) return '—';
    return `<span class="win">${row.wins}</span>-<span class="loss">${row.losses}</span>-${row.draws}`;
  }

  function renderKpis(ld) {
    const rows = buildRows(ld);
    const rated = rows.filter(m => m.games > 0);
    const modelCount = rated.filter(m => m.kind === 'model').length;
    const algoCount = rated.filter(m => m.kind === 'algorithm').length;
    const pairs = rated.length * (rated.length - 1) / 2;
    const current = currentMode();
    const mapCount = Object.keys(current?.maps || {}).filter(key => key !== 'all').length;
    const target = pairs * mapCount * (raw.source.targetGamesPerPair || 24);
    const coverage = target > 0 ? Math.min(100, Math.round(ld.overview.games / target * 100)) : 0;
    const cards = [
      { label: '当前模式', value: current?.label ?? '—', sub: '不同模式独立评分，不跨模式比较' },
      { label: '总局数', value: ld.overview.games, sub: `平局 ${ld.overview.draws}（${pct(ld.overview.drawRate)}）` },
      {
        label: '参评者',
        value: rated.length,
        sub: `RL 模型 ${modelCount} · 算法 ${algoCount} · 对局对数 ${ld.overview.pairCount}`,
      },
      { label: '平局率', value: pct(ld.overview.drawRate), sub: '达到回合/动作上限' },
      { label: '平均回合', value: ld.overview.avgRounds ?? '—', sub: '单局 rounds 均值' },
      { label: '局数覆盖度', value: target > 0 ? `${coverage}%` : '—', sub: target > 0 ? `${ld.overview.games} / 目标 ${target}` : '该模式暂无地图池' },
      {
        label: '当前地图池',
        value: league === 'all' ? '全部' : mapLabel(league),
        sub: league === 'all' ? `${mapCount} 张图池化` : `${ld.overview.games} 局`,
      },
    ];
    el.kpiGrid.innerHTML = cards
      .map(c => `<article class="kpi-card"><div class="label">${c.label}</div><div class="value">${c.value}</div><div class="sub">${c.sub || ''}</div></article>`)
      .join('');
  }

  function renderTable(rows) {
    const sorted = sortRows(rows, sort);
    const body = el.modelTable.querySelector('tbody');
    if (!currentLeague()?.overview?.games) {
      body.innerHTML = '<tr><td colspan="12" class="muted" style="text-align:center;padding:24px">该模式暂无对局数据（可在评估控制台选择该模式启动跑批）</td></tr>';
      return;
    }
    body.innerHTML = sorted
      .map(r => {
        const selected = selectedModel === r.id ? 'selected' : '';
        return `<tr data-model="${escapeAttr(r.id)}" class="${selected}"${r.statusNote ? ` title="${escapeAttr(r.statusNote)}"` : ''}>
          <td class="num" data-label="排名">${r.rank ?? '—'}</td>
          <td class="model-name" data-label="参与者" title="${escapeAttr(r.id)}">${kindBadge(r.kind)}${escapeHtml(r.short)}</td>
          <td data-label="版本">${escapeHtml(r.version) || '—'}</td>
          <td class="num" data-label="评分">${ratingCell(r)}</td>
          <td class="num" data-label="胜-负-平">${wldCell(r)}</td>
          <td class="num" data-label="局数">${r.games || '—'}</td>
          <td class="num" data-label="胜率">${r.winRate == null ? '—' : `<span class="pill-rate">${pct(r.winRate)}</span>`}</td>
          <td class="num" data-label="Wilson 下界">${r.wilson == null ? '—' : pct(r.wilson)}</td>
          <td class="num" data-label="先手胜率">${pct(r.firstSeatRate)}<span class="rating-ci">(${r.firstSeat?.games ?? 0})</span></td>
          <td class="num" data-label="后手胜率">${pct(r.secondSeatRate)}<span class="rating-ci">(${r.secondSeat?.games ?? 0})</span></td>
          <td class="num" data-label="平均回合">${r.avgRounds ?? '—'}</td>
          <td class="num" data-label="平均决策耗时">${r.avgDecisionMs != null ? `${r.avgDecisionMs}ms` : '—'}</td>
        </tr>`;
      })
      .join('');
    el.modelTable.querySelectorAll('th[data-sort]').forEach(th => {
      th.classList.toggle('sorted', th.dataset.sort === sort.key);
    });
  }

  /** 胜率 → 红灰绿背景（0.5 为灰，偏离越远颜色越深）。 */
  function heatColor(wr) {
    if (wr == null) return '';
    const t = Math.min(1, Math.abs(wr - 0.5) * 2);
    if (wr >= 0.5) {
      const g = Math.round(120 + 60 * t);
      return `background: rgba(${Math.round(60 - 40 * t)},${g},${Math.round(70 - 20 * t)},${0.25 + 0.45 * t})`;
    }
    return `background: rgba(${Math.round(120 + 80 * t)},${Math.round(70 - 30 * t)},${Math.round(70 - 30 * t)},${0.25 + 0.45 * t})`;
  }

  function renderMatrix(ld) {
    if (!ld.overview?.games) {
      el.h2hHead.innerHTML = '<th class="model-col">参与者 \\ 对手</th>';
      el.h2hBody.innerHTML = '<tr><td class="muted" style="text-align:center;padding:24px">该模式暂无对局数据（可在评估控制台选择该模式启动跑批）</td></tr>';
      return;
    }
    const rows = viewRows(ld).filter(m => m.games > 0);
    const cols = rows.slice();
    // 列头用短名（v3.0.4 而非 v3.0.4@8.4M；算法取中文名）：宽矩阵的全名表头会把表格
    // 撑出横向滚动条；完整文件 id 保留在悬停提示里。短名撞车时回退全名。
    const nameCount = new Map();
    for (const c of cols) {
      const v = c.kind === 'model' ? c.short.split('@')[0] : c.short;
      nameCount.set(v, (nameCount.get(v) || 0) + 1);
    }
    const headerLabel = c => {
      const v = c.kind === 'model' ? c.short.split('@')[0] : c.short;
      return nameCount.get(v) > 1 ? c.short : v;
    };
    el.h2hHead.innerHTML = '<th class="model-col">参与者 \\ 对手</th>' +
      cols.map(c => `<th title="${escapeAttr(c.id)}">${escapeHtml(headerLabel(c))}</th>`).join('');
    el.h2hBody.innerHTML = rows
      .map(r => {
        const cells = cols.map(c => {
          if (c.id === r.id) return '<td class="self">·</td>';
          const v = r.vs[c.id];
          if (!v || v.games === 0) return '<td class="self">—</td>';
          const wr = v.winRate;
          const tip = `${r.short} ${v.wins}W/${v.games - v.wins - v.draws}L/${v.draws}D vs ${c.short}（${v.games} 局）`;
          return `<td style="${heatColor(wr)}" title="${escapeAttr(tip)}">${(wr * 100).toFixed(0)}</td>`;
        }).join('');
        return `<tr><td class="model-col" title="${escapeAttr(r.id)}"><strong>${escapeHtml(r.short)}</strong></td>${cells}</tr>`;
      })
      .join('');
  }

  function renderDetail(ld) {
    const rows = viewRows(ld);
    const row = rows.find(m => m.id === selectedModel);
    if (!row) {
      el.detailTitle.textContent = '点击评分榜行查看';
      el.detailBody.className = 'empty-block';
      el.detailBody.textContent = '未选择参与者';
      return;
    }
    el.detailTitle.textContent = `${row.short}（${row.id}）`;
    el.detailBody.className = '';
    const stepText = row.steps == null
      ? 'best'
      : row.deliveredSteps != null && row.deliveredSteps !== row.steps
        ? `${row.deliveredSteps.toLocaleString()}（交付 best；文件名 ${row.steps.toLocaleString()} 为训练目标）`
        : row.steps.toLocaleString();
    const vsEntries = Object.entries(row.vs).sort((a, b) => b[1].games - a[1].games);
    const vsRows = vsEntries.map(([opp, v]) => {
      const oppShort = raw.registry[opp]?.short || opp;
      return `<tr>
        <td data-label="对手" title="${escapeAttr(opp)}">${escapeHtml(oppShort)}</td>
        <td class="num" data-label="局数">${v.games}</td>
        <td class="num win" data-label="胜">${v.wins}</td>
        <td class="num" data-label="平">${v.draws}</td>
        <td class="num" data-label="负">${v.games - v.wins - v.draws}</td>
        <td class="num" data-label="胜率">${v.winRate == null ? '—' : pct(v.winRate)}</td>
      </tr>`;
    }).join('');
    const mapEntries = Object.entries(row.perMap).sort((a, b) => b[1].games - a[1].games);
    const mapRows = mapEntries.map(([map, v]) => `<tr>
        <td data-label="地图">${escapeHtml(mapLabel(map))}</td>
        <td class="num" data-label="局数">${v.games}</td>
        <td class="num win" data-label="胜">${v.wins}</td>
        <td class="num" data-label="平">${v.draws}</td>
        <td class="num" data-label="胜率">${v.winRate == null ? '—' : pct(v.winRate)}</td>
      </tr>`).join('');
    const statusMeta = STATUS_META[row.status] || STATUS_META.legacy;
    const metaHtml = row.kind === 'algorithm'
      ? `
        <span>类型 <strong>内置规则算法</strong></span>
        <span>注册名 <strong>${escapeHtml(row.algorithm || row.id.replace(/^algo_/, '').replace(/@.*$/, ''))}</strong></span>
        <span>版本 <strong>${escapeHtml(row.version || '—')}</strong></span>
        <span>状态 <strong class="tag ${statusMeta.cls}">${statusMeta.label}</strong></span>
        <span style="flex-basis:100%">策略 <strong>${escapeHtml(row.description || '—')}</strong></span>`
      : `
        <span>版本 <strong>${escapeHtml(row.version)}</strong></span>
        <span>训练日期 <strong>${escapeHtml(row.trainDate)}</strong></span>
        <span>训练地图 <strong>${escapeHtml(mapLabel(row.trainMap))}</strong></span>
        <span>训练对手 <strong>${escapeHtml(row.opponentType)}</strong></span>
        <span>步数 <strong>${escapeHtml(stepText)}</strong></span>
        <span>状态 <strong class="tag ${statusMeta.cls}">${statusMeta.label}</strong>${row.statusNote ? ` · ${escapeHtml(row.statusNote)}` : ''}</span>`;
    el.detailBody.innerHTML = `
      <div class="detail-meta">${metaHtml}
      </div>
      <div class="detail-cols">
        <div>
          <h3 style="margin: 6px 0;">对各对手战绩</h3>
          <div class="table-wrap">
            <table class="data-table compact">
              <thead><tr><th>对手</th><th class="num">局数</th><th class="num">胜</th><th class="num">平</th><th class="num">负</th><th class="num">胜率</th></tr></thead>
              <tbody>${vsRows || '<tr><td colspan="6" class="muted">无对局</td></tr>'}</tbody>
            </table>
          </div>
        </div>
        <div>
          <h3 style="margin: 6px 0;">分地图战绩</h3>
          <div class="table-wrap">
            <table class="data-table compact">
              <thead><tr><th>地图</th><th class="num">局数</th><th class="num">胜</th><th class="num">平</th><th class="num">胜率</th></tr></thead>
              <tbody>${mapRows || '<tr><td colspan="5" class="muted">无对局</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      </div>`;
  }

  function renderMethod() {
    const m = raw.ratingMethod || {};
    const s = raw.source || {};
    const lines = [
      `<div><strong>评分模型</strong>：${escapeHtml(m.model || '—')}</div>`,
      `<div><strong>模式隔离</strong>：不同玩法模式使用独立评分池，榜单只在当前模式内比较；模式之间不共享评分。</div>`,
      `<div><strong>先验</strong>：${escapeHtml(m.prior || '—')}</div>`,
      `<div><strong>Elo 映射</strong>：${escapeHtml(m.scale || '—')}</div>`,
      `<div><strong>置信区间</strong>：${escapeHtml(m.ci || '—')}</div>`,
      `<div><strong>对战协议</strong>：确定性策略，每两局共享同一随机图种子并交换座位（配对换座），消除先手与地图偏差。</div>`,
      `<div><strong>数据范围</strong>：${s.matchCount ?? 0} 局 · ${s.dateMin ?? '—'} → ${s.dateMax ?? '—'} · 每对目标 ${s.targetGamesPerPair ?? '—'} 局/图。</div>`,
    ];
    el.methodBody.className = '';
    el.methodBody.innerHTML = lines.map(l => `<p style="margin:6px 0">${l}</p>`).join('');
  }

  function renderExcluded() {
    const list = raw.excluded || [];
    if (!list.length) {
      el.excludedBody.className = 'empty-block';
      el.excludedBody.textContent = '无';
      return;
    }
    el.excludedBody.className = '';
    el.excludedBody.innerHTML = `<div class="table-wrap"><table class="data-table compact">
      <thead><tr><th>模型</th><th>版本</th><th>原因</th></tr></thead>
      <tbody>${list.map(x => `<tr>
        <td class="model-name" title="${escapeAttr(x.id)}">${escapeHtml(raw.registry[x.id]?.short || x.id)}</td>
        <td>${escapeHtml(x.version)}</td>
        <td class="muted">${escapeHtml(x.reason)}</td>
      </tr>`).join('')}</tbody></table></div>`;
  }

  function populateModeBar() {
    el.modeBar.innerHTML = modes().map(item => {
      const active = item.id === mode;
      return `<button type="button" class="mode-tab${active ? ' active' : ''}" data-mode="${escapeAttr(item.id)}" role="tab" aria-selected="${active}">
        <span>${escapeHtml(item.label)}</span><span class="mode-count">${item.maps?.all?.overview?.games ?? 0}</span>
      </button>`;
    }).join('');
    const current = currentMode();
    el.boardModeHint.textContent = current
      ? `${current.label} · Bradley-Terry MLE · 平局记 0.5 · 排名列固定为模式内排名`
      : 'Bradley-Terry MLE · 平局记 0.5 · 各模式独立评分';
  }

  function populateLeagueSelect() {
    const current = currentMode();
    const maps = Object.keys(current?.maps || {}).filter(key => key !== 'all');
    if (league !== 'all' && !maps.includes(league)) league = 'all';
    el.filterLeague.innerHTML = ['all', ...maps]
      .map(map => `<option value="${escapeAttr(map)}"${map === league ? ' selected' : ''}>${map === 'all' ? '全部地图' : escapeHtml(mapLabel(map))}</option>`)
      .join('');
  }

  function renderAll() {
    const ld = currentLeague();
    if (!ld) return;
    renderKpis(ld);
    renderTable(viewRows(ld));
    renderMatrix(ld);
    renderDetail(ld);
  }

  async function loadData() {
    setStatus('加载中…');
    try {
      const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      raw = await res.json();
      el.generatedAt.textContent = raw.generatedAt ? new Date(raw.generatedAt).toLocaleString() : '—';
      el.sourceCount.textContent = raw.source?.matchCount ?? 0;
      el.dateRange.textContent = raw.source?.dateMin
        ? `${raw.source.dateMin} → ${raw.source.dateMax ?? ''}`
        : '—';
      if (!mode || !modes().some(item => item.id === mode)) {
        mode = modes().find(item => item.maps?.all?.overview?.games > 0)?.id || modes()[0]?.id || null;
      }
      league = 'all';
      selectedModel = null;
      populateModeBar();
      populateLeagueSelect();
      renderAll();
      renderMethod();
      renderExcluded();
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

  el.btnReload.addEventListener('click', loadData);
  el.modeBar.addEventListener('click', event => {
    const button = event.target.closest('.mode-tab[data-mode]');
    if (!button || button.dataset.mode === mode) return;
    mode = button.dataset.mode;
    league = 'all';
    selectedModel = null;
    populateModeBar();
    populateLeagueSelect();
    renderAll();
  });
  el.filterLeague.addEventListener('change', () => {
    league = el.filterLeague.value;
    if (!currentMode()?.maps?.[league]) league = 'all';
    selectedModel = null;
    renderAll();
  });
  el.filterKind.addEventListener('change', () => {
    kindFilter = el.filterKind.value;
    selectedModel = null;
    renderAll();
  });
  el.modelTable.addEventListener('click', event => {
    const tr = event.target.closest('tr[data-model]');
    if (!tr) return;
    selectedModel = tr.dataset.model;
    renderTable(viewRows(currentLeague()));
    renderDetail(currentLeague());
  });
  el.modelTable.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (sort.key === key) {
        sort.dir = sort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        sort = { key, dir: key === 'short' || key === 'version' ? 'asc' : 'desc' };
      }
      renderTable(viewRows(currentLeague()));
    });
  });

  loadData();

  /* ===== 页内页签：模型榜单（默认）/ 玩法统计 / 模型档案 / 评估控制台（#stats、#models、#console 直达） ===== */
  const tabButtons = document.querySelectorAll('.tab-bar .tab');
  const tabPanes = {
    board: document.getElementById('tab-board'),
    stats: document.getElementById('tab-stats'),
    models: document.getElementById('tab-models'),
    console: document.getElementById('tab-console'),
  };

  function switchTab(name, updateHash = true) {
    if (!tabPanes[name]) name = 'board';
    for (const btn of tabButtons) {
      const active = btn.dataset.tab === name;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    }
    for (const [paneName, pane] of Object.entries(tabPanes)) pane.hidden = paneName !== name;
    if (updateHash) {
      history.replaceState(null, '', name === 'board' ? window.location.pathname + window.location.search : `#${name}`);
    }
  }

  for (const btn of tabButtons) btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  {
    const initialTab = window.location.hash.slice(1);
    if (initialTab && tabPanes[initialTab]) switchTab(initialTab, false);
  }

  /* ===== 评估控制台：网页启动 round_robin.py 跑批（模型 × 算法混合循环赛） ===== */
  const evalEl = {};
  for (const id of ['eval-status-pill', 'eval-modes', 'eval-mode-hint', 'eval-maps', 'eval-algos', 'eval-models', 'eval-model-all', 'eval-model-none',
    'eval-model-count', 'eval-games', 'eval-jobs', 'eval-salt', 'eval-dry', 'eval-start', 'eval-stop',
    'eval-regen', 'eval-clear', 'eval-msg', 'eval-progress-wrap', 'eval-progress-fill', 'eval-progress-text', 'eval-output',
    'eval-tab-btn', 'eval-mini-strip', 'eval-mini-text', 'eval-mini-go']) {
    evalEl[id] = document.getElementById(id);
  }

  let evalStatus = null;
  let evalPrevRunning = false;
  let evalModels = [];
  let evalAlgos = [];
  let evalModeCatalog = [];
  let evalMode = 'standard';
  let renderedParticipantsMode = null;
  // status 接口会返回 modeCatalog；这里的列表只是首屏兜底，收到 status 后以服务端为准。
  const EVAL_FALLBACK_MAPS = ['random', 'default', 'breach', 'danger-close', 'dual-lanes'];
  let renderedMapSig = '';

  const EVAL_PILL = {
    idle: { text: '空闲', cls: '' },
    running: { text: '运行中', cls: 'ok' },
    finished: { text: '已完成', cls: 'ok' },
    failed: { text: '失败', cls: 'err' },
    stopped: { text: '已停止', cls: '' },
    interrupted: { text: '已中断', cls: 'err' },
  };

  function controlHeaders() {
    const token = localStorage.getItem('autoControlToken') || '';
    return token ? { 'x-control-token': token } : {};
  }

  function evalMsg(text, kind) {
    evalEl['eval-msg'].textContent = text || '';
    evalEl['eval-msg'].classList.toggle('eval-msg-err', kind === 'err');
  }

  /* ===== 清空旧局：弹窗里按模式/地图/参与者筛选，试跑预览命中数后归档清空 ===== */
  const EVAL_FALLBACK_MODES = [
    ['standard', '标准模式'], ['annihilation', '歼灭模式'],
    ['simultaneous', '同时回合'], ['royale', '大逃杀'],
  ];

  function describeClearScope(filter) {
    const parts = [];
    if (filter.mode) parts.push(`模式=${evalModeCatalog.find(item => item.id === filter.mode)?.label || filter.mode}`);
    if (filter.map) parts.push(`地图=${mapLabel(filter.map)}`);
    if (filter.participant) parts.push(`参与者=${filter.participant}`);
    return parts.length ? parts.join(' 且 ') : '全部对局';
  }

  function currentEvalMode() {
    return evalModeCatalog.find(item => item.id === evalMode) || evalModeCatalog[0] || null;
  }

  function currentEvalMaps() {
    return currentEvalMode()?.maps?.map(item => item.id) || EVAL_FALLBACK_MAPS;
  }

  function evalAlgosForMode() {
    return evalAlgos.filter(a => (Array.isArray(a.modes) ? a.modes : ['standard']).includes(evalMode));
  }

  function evalModelsForMode() {
    return evalModels.filter(m => (Array.isArray(m.modes) ? m.modes : ['standard']).includes(evalMode));
  }

  function updateEvalStartState() {
    const current = currentEvalMode();
    const unsupported = Boolean(current && !current.supported);
    evalEl['eval-start'].disabled = evalStatus?.status === 'running' || unsupported;
    evalEl['eval-start'].title = unsupported ? (current.reason || '该模式暂不支持跑批') : '';
  }

  function renderEvalModeBar() {
    evalEl['eval-modes'].innerHTML = evalModeCatalog.map(item => {
      const active = item.id === currentEvalMode()?.id;
      const label = item.supported ? item.label : `${item.label}（暂不支持）`;
      return `<button type="button" class="mode-tab${active ? ' active' : ''}${item.supported ? '' : ' unsupported'}" data-eval-mode="${escapeAttr(item.id)}" role="tab" aria-selected="${active}">${escapeHtml(label)}</button>`;
    }).join('');
    const current = currentEvalMode();
    evalEl['eval-mode-hint'].textContent = current
      ? current.supported
        ? `${current.maps?.length ?? 0} 张地图 · 该模式独立榜单与评分`
          + (current.id === 'simultaneous' ? ' · 仅内置算法（RL 模型暂只支持标准模式）' : '')
        : (current.reason || '该模式暂不支持跑批')
      : '';
    updateEvalStartState();
  }

  function renderMapChips(maps, checked) {
    evalEl['eval-maps'].innerHTML = maps
      .map(map => `<label><input type="checkbox" value="${escapeAttr(map)}"${checked.includes(map) ? ' checked' : ''}/> ${escapeHtml(mapLabel(map))}</label>`)
      .join('');
  }

  // 服务端地图池或当前模式变化时才重建 chips，保留用户已勾选项，避免 3s 轮询反复重绘。
  function syncMapChips(maps) {
    if (!Array.isArray(maps) || !maps.length) return;
    const sig = `${evalMode}\u0001${maps.join('\u0001')}`;
    if (sig === renderedMapSig) return;
    renderedMapSig = sig;
    const checked = checkedMaps().filter(map => maps.includes(map));
    renderMapChips(maps, checked.length ? checked : maps);
  }

  function checkedMaps() {
    return [...evalEl['eval-maps'].querySelectorAll('input:checked')].map(input => input.value);
  }

  function checkedParticipants() {
    const algos = [...evalEl['eval-algos'].querySelectorAll('input:checked')].map(input => input.value);
    const models = [...evalEl['eval-models'].querySelectorAll('input:checked')].map(input => input.value);
    return { algos, models };
  }

  function renderEvalParticipants() {
    // 算法默认全选：取消勾选即显式排除（不勾选任何参与者 = 全部模型 + 全部算法）。
    evalEl['eval-algos'].innerHTML = evalAlgosForMode()
      .map(a => `<label title="${escapeAttr(a.description)}"><input type="checkbox" value="algo:${escapeAttr(a.algorithm)}" checked/><span class="tag st-algo">算法</span> ${escapeHtml(a.name)}（${escapeHtml(a.algorithm)}）</label>`)
      .join('');
    const modeModels = evalModelsForMode();
    evalEl['eval-models'].innerHTML = modeModels.length
      ? modeModels
        .map(m => `<label title="${escapeAttr(m.file)}"><input type="checkbox" value="${escapeAttr(m.file)}"/><span class="ver">${escapeHtml(m.label || '?')}</span> ${escapeHtml(m.file)}</label>`)
        .join('')
      : '<span class="eval-hint">当前模式暂无 RL 模型（现有模型仅覆盖标准模式）</span>';
    renderedParticipantsMode = evalMode;
    updateModelCount();
  }

  async function loadEvalParticipants() {
    try {
      const res = await fetch('/api/arena/participants', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // round_robin 自身排除 v1.0.0（512 动作旧格式无法进程内互打），这里同步过滤。
      evalModels = (data.models || []).filter(m => m.supported && !m.file.startsWith('hex_ppo_v1.'));
      evalAlgos = data.algorithms || [];
      renderEvalParticipants();
    } catch (err) {
      evalEl['eval-model-count'].textContent = `参与者列表加载失败：${window.ErrorText.describe(err)}`;
    }
  }

  function updateModelCount() {
    const { algos, models } = checkedParticipants();
    const modeAlgos = evalAlgosForMode();
    const modeModels = evalModelsForMode();
    const total = modeModels.length + modeAlgos.length;
    const selected = algos.length + models.length;
    const modeLabel = currentEvalMode()?.label || evalMode;
    evalEl['eval-model-count'].textContent = selected
      ? `已选 ${selected} / ${total} 个（模型 ${models.length} / ${modeModels.length}，算法 ${algos.length} / ${modeAlgos.length}，${modeLabel}）`
      : `共 ${modeModels.length} 个可对战模型 + ${modeAlgos.length} 个算法（${modeLabel}；不选 = 全部参评）`;
  }

  function formatDuration(iso) {
    const start = new Date(iso).getTime();
    if (Number.isNaN(start)) return '';
    let secs = Math.max(0, Math.floor((Date.now() - start) / 1000));
    const h = Math.floor(secs / 3600);
    secs %= 3600;
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return h ? `${h}h${String(m).padStart(2, '0')}m` : m ? `${m}m${String(s).padStart(2, '0')}s` : `${s}s`;
  }

  function renderEvalStatus(st) {
    evalStatus = st;
    if (Array.isArray(st.modeCatalog) && st.modeCatalog.length) {
      evalModeCatalog = st.modeCatalog;
      if (!evalModeCatalog.some(item => item.id === evalMode)) evalMode = evalModeCatalog[0].id;
      renderEvalModeBar();
    }
    syncMapChips(currentEvalMaps());
    if (renderedParticipantsMode !== evalMode) renderEvalParticipants();
    const pill = EVAL_PILL[st.status] || { text: st.status, cls: '' };
    evalEl['eval-status-pill'].textContent = pill.text;
    evalEl['eval-status-pill'].classList.toggle('ok', pill.cls === 'ok');
    evalEl['eval-status-pill'].classList.toggle('err', pill.cls === 'err');
    updateEvalStartState();
    evalEl['eval-stop'].disabled = st.status !== 'running';
    evalEl['eval-clear'].disabled = st.status === 'running';

    const running = st.status === 'running';
    const hasHistory = Boolean(st.params);
    evalEl['eval-progress-wrap'].hidden = !running;
    evalEl['eval-output'].hidden = !running && !hasHistory;

    if (running) {
      const pctValue = st.batchesTotal ? Math.min(100, Math.round(st.batchesDone / st.batchesTotal * 100)) : 0;
      evalEl['eval-progress-fill'].style.width = `${pctValue}%`;
      const bits = [];
      if (st.batchesTotal) bits.push(`${st.batchesDone}/${st.batchesTotal} 批（${pctValue}%）`);
      if (st.plannedGames) bits.push(`新增 ${st.gamesNew}/${st.plannedGames} 局`);
      else bits.push(`新增 ${st.gamesNew} 局`);
      if (st.startedAt) bits.push(`已运行 ${formatDuration(st.startedAt)}`);
      evalEl['eval-progress-text'].textContent = bits.join(' · ');
    }

    // 页签指示灯 + 榜单页签顶部的迷你状态条（运行中才出现，点击跳控制台）。
    evalEl['eval-tab-btn'].classList.toggle('has-run', running);
    evalEl['eval-mini-strip'].hidden = !running;
    if (running) {
      const bits = [];
      if (st.batchesTotal) bits.push(`${st.batchesDone}/${st.batchesTotal} 批`);
      bits.push(`新增 ${st.gamesNew} 局`);
      if (st.startedAt) bits.push(formatDuration(st.startedAt));
      evalEl['eval-mini-text'].textContent = `评估跑批运行中 · ${bits.join(' · ')}`;
    }

    const tail = (st.outputTail || []).slice(-14).join('\n');
    evalEl['eval-output'].textContent = tail || '（暂无输出）';

    if (evalPrevRunning && !running) {
      // 跑批结束：服务端已自动重算榜单，稍等一下再刷新页面数据。
      evalMsg(`跑批${EVAL_PILL[st.status]?.text || st.status}，正在刷新榜单…`);
      setTimeout(loadData, 2500);
    }
    evalPrevRunning = running;
  }

  async function pollEvalStatus() {
    try {
      // 状态接口与写接口同样受控：带控制令牌（本机无令牌配置时不需要）。
      const res = await fetch('/api/arena/eval/status', { cache: 'no-store', headers: controlHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      renderEvalStatus(await res.json());
    } catch (err) {
      const unauthorized = err.message === 'HTTP 401';
      evalEl['eval-status-pill'].textContent = unauthorized ? '无权限' : '离线';
      evalEl['eval-status-pill'].classList.remove('ok');
      evalEl['eval-status-pill'].classList.add('err');
      // 断连时不能保留上一次成功轮询的"运行中"画面；恢复轮询后若仍在跑会自动重新出现。
      evalEl['eval-tab-btn'].classList.remove('has-run');
      evalEl['eval-mini-strip'].hidden = true;
      evalMsg(unauthorized
        ? '状态获取被拒绝：已配置 AUTO_CONTROL_TOKEN 或非本机访问，请在对局/观战页设置中保存控制令牌'
        : `状态获取失败：${window.ErrorText.describe(err)}`, 'err');
    }
  }

  evalEl['eval-modes'].addEventListener('click', event => {
    const button = event.target.closest('.mode-tab[data-eval-mode]');
    if (!button || button.dataset.evalMode === evalMode) return;
    evalMode = button.dataset.evalMode;
    renderedMapSig = '';
    renderEvalModeBar();
    syncMapChips(currentEvalMaps());
    renderEvalParticipants();
    const current = currentEvalMode();
    evalMsg(current && !current.supported ? (current.reason || '该模式暂不支持跑批') : '', current && !current.supported ? 'err' : undefined);
  });
  evalEl['eval-algos'].addEventListener('change', updateModelCount);
  evalEl['eval-models'].addEventListener('change', updateModelCount);

  evalEl['eval-start'].addEventListener('click', async () => {
    const current = currentEvalMode();
    if (current && !current.supported) {
      evalMsg(current.reason || '该模式暂不支持跑批', 'err');
      return;
    }
    const maps = checkedMaps();
    if (!maps.length) {
      evalMsg('请至少选择一张地图', 'err');
      return;
    }
    const { algos, models } = checkedParticipants();
    const payload = {
      maps,
      participants: algos.length || models.length ? [...models, ...algos] : null,
      games: Number(evalEl['eval-games'].value) || 24,
      jobs: Number(evalEl['eval-jobs'].value) || 1,
      salt: evalEl['eval-salt'].value.trim() || null,
      dryRun: evalEl['eval-dry'].checked,
    };
    evalEl['eval-start'].disabled = true;
    try {
      const res = await fetch('/api/arena/eval/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...controlHeaders() },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        evalMsg(`启动失败：${data.error || res.status}`, 'err');
      } else {
        evalMsg(payload.dryRun ? '试跑已启动（只打印任务计划）' : '跑批已启动');
        renderEvalStatus(data.status);
      }
    } catch (err) {
      evalMsg(`启动失败：${window.ErrorText.describe(err)}`, 'err');
    } finally {
      evalEl['eval-start'].disabled = evalStatus?.status === 'running';
    }
  });

  evalEl['eval-stop'].addEventListener('click', async () => {
    const ok = await window.UIDialog.confirm({
      title: '停止当前跑批？',
      message: '已完成的局数已写入 JSONL，同参数重跑可断点续跑。',
      confirmText: '停止跑批',
      tone: 'warning',
    });
    if (!ok) return;
    try {
      const res = await fetch('/api/arena/eval/stop', { method: 'POST', headers: controlHeaders() });
      const data = await res.json().catch(() => ({}));
      evalMsg(res.ok ? '停止指令已发送，等待进程退出…' : `停止失败：${data.error || res.status}`, res.ok ? undefined : 'err');
    } catch (err) {
      evalMsg(`停止失败：${window.ErrorText.describe(err)}`, 'err');
    }
  });

  evalEl['eval-clear'].addEventListener('click', async () => {
    if (evalStatus?.status === 'running') {
      evalMsg('跑批进行中，请先停止再清空旧局', 'err');
      return;
    }
    // 弹窗表单：每次打开重建，模式 → 地图联动，改动即试跑预览命中局数。
    const form = document.createElement('div');
    form.className = 'eval-clear-form';
    form.innerHTML = `
      <label>模式
        <select data-clear="mode"></select>
      </label>
      <label>地图
        <select data-clear="map"></select>
      </label>
      <label>参与者（精确匹配任一座位）
        <select data-clear="participant"></select>
      </label>
      <p class="eval-clear-preview" data-clear="preview">正在统计命中局数…</p>`;
    const modeSel = form.querySelector('[data-clear="mode"]');
    const mapSel = form.querySelector('[data-clear="map"]');
    const partSel = form.querySelector('[data-clear="participant"]');
    const previewEl = form.querySelector('[data-clear="preview"]');

    const modes = evalModeCatalog.length
      ? evalModeCatalog.map(item => [item.id, item.label + (item.supported ? '' : '（暂不支持）')])
      : EVAL_FALLBACK_MODES;
    modeSel.innerHTML = '<option value="">全部</option>' +
      modes.map(([id, label]) => `<option value="${escapeAttr(id)}">${escapeHtml(label)}</option>`).join('');
    const participantOptions = [
      ...evalModels.map(m => [m.file, `${m.label || ''} ${m.file}`.trim()]),
      ...evalAlgos.map(a => [a.id, `${a.name}（${a.id}）`]),
    ];
    partSel.innerHTML = '<option value="">全部</option>' +
      participantOptions.map(([id, label]) => `<option value="${escapeAttr(id)}" title="${escapeAttr(id)}">${escapeHtml(label)}</option>`).join('');

    function renderMapOptions() {
      const previous = mapSel.value;
      const maps = modeSel.value
        ? (evalModeCatalog.find(item => item.id === modeSel.value)?.maps || [])
        : (evalModeCatalog.length
          ? evalModeCatalog.flatMap(item => item.maps)
          : EVAL_FALLBACK_MAPS.map(id => ({ id })));
      const ids = [...new Set(maps.map(item => item.id))];
      mapSel.innerHTML = '<option value="">全部</option>' +
        ids.map(id => `<option value="${escapeAttr(id)}">${escapeHtml(mapLabel(id))}</option>`).join('');
      mapSel.value = ids.includes(previous) ? previous : '';
    }
    renderMapOptions();

    function readFilter() {
      return {
        mode: modeSel.value || null,
        map: mapSel.value || null,
        participant: partSel.value || null,
      };
    }

    let previewSeq = 0;
    async function refreshPreview() {
      const seq = ++previewSeq;
      previewEl.classList.remove('err');
      previewEl.textContent = '正在统计命中局数…';
      try {
        const res = await fetch('/api/arena/eval/clear-matches', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...controlHeaders() },
          body: JSON.stringify({ ...readFilter(), dryRun: true }),
        });
        const data = await res.json().catch(() => ({}));
        if (seq !== previewSeq) return;
        if (!res.ok) {
          previewEl.textContent = `统计失败：${data.error || res.status}`;
          previewEl.classList.add('err');
          return;
        }
        previewEl.textContent = `将删除 ${data.removed} / 共 ${data.total} 局（matches.jsonl 已提交的历史可在 git 找回）。`;
      } catch (err) {
        if (seq !== previewSeq) return;
        previewEl.textContent = `统计失败：${window.ErrorText.describe(err)}`;
        previewEl.classList.add('err');
      }
    }
    modeSel.addEventListener('change', () => { renderMapOptions(); refreshPreview(); });
    mapSel.addEventListener('change', refreshPreview);
    partSel.addEventListener('change', refreshPreview);
    refreshPreview();

    const ok = await window.UIDialog.open({
      title: '清空旧局并重新累积？',
      tone: 'danger',
      confirmText: '确认删除',
      content: form,
    });
    if (!ok) return;
    const filter = readFilter();
    evalEl['eval-clear'].disabled = true;
    try {
      const res = await fetch('/api/arena/eval/clear-matches', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...controlHeaders() },
        body: JSON.stringify(filter),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        evalMsg(`清空失败：${data.error || res.status}`, 'err');
      } else if (data.removed > 0) {
        evalMsg(`已删除 ${data.removed} / 共 ${data.total} 局（${describeClearScope(filter)}），现在可重新跑批累积计时数据`);
      } else {
        evalMsg('没有命中范围可清空的旧对局');
      }
      pollEvalStatus();
    } catch (err) {
      evalMsg(`清空失败：${window.ErrorText.describe(err)}`, 'err');
    } finally {
      evalEl['eval-clear'].disabled = evalStatus?.status === 'running';
    }
  });

  evalEl['eval-regen'].addEventListener('click', async () => {
    evalEl['eval-regen'].disabled = true;
    evalMsg('正在重算榜单数据…');
    try {
      const res = await fetch('/api/arena/leaderboard/regenerate', { method: 'POST', headers: controlHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        evalMsg(`重算失败：${data.error || res.status}`, 'err');
      } else {
        evalMsg('榜单数据已重算');
        loadData();
      }
    } catch (err) {
      evalMsg(`重算失败：${window.ErrorText.describe(err)}`, 'err');
    } finally {
      evalEl['eval-regen'].disabled = false;
    }
  });

  evalEl['eval-model-all'].addEventListener('click', () => {
    evalEl['eval-models'].querySelectorAll('input').forEach(input => { input.checked = true; });
    updateModelCount();
  });
  evalEl['eval-model-none'].addEventListener('click', () => {
    evalEl['eval-models'].querySelectorAll('input').forEach(input => { input.checked = false; });
    updateModelCount();
  });

  renderMapChips(EVAL_FALLBACK_MAPS, ['random']);
  renderedMapSig = `${evalMode}\u0001${EVAL_FALLBACK_MAPS.join('\u0001')}`;
  loadEvalParticipants();
  evalEl['eval-mini-strip'].addEventListener('click', () => switchTab('console'));
  pollEvalStatus();
  setInterval(pollEvalStatus, 3000);
})();
