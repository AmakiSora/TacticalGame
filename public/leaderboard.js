/* RL 模型排行榜 — reads /data/rl-leaderboard.json only. */
(() => {
  const DATA_URL = '/data/rl-leaderboard.json';

  const MAP_LABELS = { random: '随机图' };
  const STATUS_META = {
    recommended: { label: '当前推荐', cls: 'st-good' },
    legacy: { label: '历史', cls: 'st-muted' },
    retired: { label: '作废', cls: 'st-bad' },
  };

  const el = {
    generatedAt: document.getElementById('generated-at'),
    sourceCount: document.getElementById('source-count'),
    dateRange: document.getElementById('date-range'),
    loadStatus: document.getElementById('load-status'),
    btnReload: document.getElementById('btn-reload'),
    kpiGrid: document.getElementById('kpi-grid'),
    filterLeague: document.getElementById('filter-league'),
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
  let league = 'all';
  let selectedModel = null;
  let sort = { key: 'rating', dir: 'desc' };

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
    return raw?.maps?.[league] || null;
  }

  /** 每个模型行的展示视图：合并 registry 元数据 + 排名 + 扁平化排序字段。 */
  function buildRows(ld) {
    const ordered = ld.models.slice().sort((a, b) => (b.rating ?? -Infinity) - (a.rating ?? -Infinity));
    const rankById = new Map(ordered.map((m, i) => [m.id, m.games > 0 ? i + 1 : null]));
    return ld.models.map(m => {
      const meta = raw.registry[m.id] || {};
      return {
        ...m,
        rank: rankById.get(m.id),
        short: meta.short || m.id,
        version: meta.version || '',
        trainDate: meta.trainDate || '',
        trainMap: meta.trainMap || '',
        opponentType: meta.opponentType || '',
        steps: meta.steps,
        status: meta.status || 'legacy',
        statusNote: meta.statusNote || null,
        firstSeatRate: m.firstSeat?.winRate ?? null,
        secondSeatRate: m.secondSeat?.winRate ?? null,
      };
    });
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

  function statusCell(row) {
    const meta = STATUS_META[row.status] || STATUS_META.legacy;
    const note = row.statusNote ? ` title="${escapeAttr(row.statusNote)}"` : '';
    return `<span class="tag ${meta.cls}"${note}>${meta.label}</span>`;
  }

  function renderKpis(ld) {
    const modelCount = ld.models.filter(m => m.games > 0).length;
    const pairs = modelCount * (modelCount - 1) / 2;
    const mapCount = Object.keys(raw.source.mapDist || {}).length || 1;
    const target = pairs * mapCount * (raw.source.targetGamesPerPair || 24);
    const coverage = target > 0 ? Math.min(100, Math.round(ld.overview.games / target * 100)) : 0;
    const cards = [
      { label: '总局数', value: ld.overview.games, sub: `平局 ${ld.overview.draws}（${pct(ld.overview.drawRate)}）` },
      { label: '参评模型', value: modelCount, sub: `对局对数 ${ld.overview.pairCount}` },
      { label: '平局率', value: pct(ld.overview.drawRate), sub: '达到回合/动作上限' },
      { label: '平均回合', value: ld.overview.avgRounds ?? '—', sub: '单局 rounds 均值' },
      { label: '局数覆盖度', value: `${coverage}%`, sub: `${ld.overview.games} / 目标 ${target}` },
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
    body.innerHTML = sorted
      .map(r => {
        const selected = selectedModel === r.id ? 'selected' : '';
        return `<tr data-model="${escapeAttr(r.id)}" class="${selected}"${r.statusNote ? ` title="${escapeAttr(r.statusNote)}"` : ''}>
          <td class="num" data-label="排名">${r.rank ?? '—'}</td>
          <td class="model-name" data-label="模型" title="${escapeAttr(r.id)}">${escapeHtml(r.short)}</td>
          <td data-label="版本">${escapeHtml(r.version)}</td>
          <td class="num" data-label="评分">${ratingCell(r)}</td>
          <td class="num" data-label="胜-负-平">${wldCell(r)}</td>
          <td class="num" data-label="局数">${r.games || '—'}</td>
          <td class="num" data-label="胜率">${r.winRate == null ? '—' : `<span class="pill-rate">${pct(r.winRate)}</span>`}</td>
          <td class="num" data-label="Wilson 下界">${r.wilson == null ? '—' : pct(r.wilson)}</td>
          <td class="num" data-label="先手胜率">${pct(r.firstSeatRate)}<span class="rating-ci">(${r.firstSeat?.games ?? 0})</span></td>
          <td class="num" data-label="后手胜率">${pct(r.secondSeatRate)}<span class="rating-ci">(${r.secondSeat?.games ?? 0})</span></td>
          <td class="num" data-label="平均回合">${r.avgRounds ?? '—'}</td>
          <td data-label="状态">${statusCell(r)}</td>
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
    const rows = buildRows(ld).filter(m => m.games > 0);
    const cols = rows.slice();
    // 列头用纯版本号（v3.0.4 而非 v3.0.4@8.4M）：16 列矩阵的全名表头会把表格
    // 撑出横向滚动条；完整文件 id 保留在悬停提示里。版本号撞车时回退全名。
    const versionCount = new Map();
    for (const c of cols) {
      const v = c.short.split('@')[0];
      versionCount.set(v, (versionCount.get(v) || 0) + 1);
    }
    const headerLabel = c => {
      const v = c.short.split('@')[0];
      return versionCount.get(v) > 1 ? c.short : v;
    };
    el.h2hHead.innerHTML = '<th class="model-col">模型 \\ 对手</th>' +
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
    const rows = buildRows(ld);
    const row = rows.find(m => m.id === selectedModel);
    if (!row) {
      el.detailTitle.textContent = '点击评分榜模型行查看';
      el.detailBody.className = 'empty-block';
      el.detailBody.textContent = '未选择模型';
      return;
    }
    el.detailTitle.textContent = `${row.short}（${row.id}）`;
    el.detailBody.className = '';
    const stepText = row.steps == null ? 'best' : row.steps.toLocaleString();
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
    el.detailBody.innerHTML = `
      <div class="detail-meta">
        <span>版本 <strong>${escapeHtml(row.version)}</strong></span>
        <span>训练日期 <strong>${escapeHtml(row.trainDate)}</strong></span>
        <span>训练地图 <strong>${escapeHtml(mapLabel(row.trainMap))}</strong></span>
        <span>训练对手 <strong>${escapeHtml(row.opponentType)}</strong></span>
        <span>步数 <strong>${escapeHtml(stepText)}</strong></span>
        <span>状态 <strong class="tag ${statusMeta.cls}">${statusMeta.label}</strong>${row.statusNote ? ` · ${escapeHtml(row.statusNote)}` : ''}</span>
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

  function populateLeagueSelect() {
    const maps = Object.keys(raw.maps || {});
    el.filterLeague.innerHTML = maps
      .map(map => `<option value="${escapeAttr(map)}"${map === league ? ' selected' : ''}>${map === 'all' ? '全部地图' : escapeHtml(mapLabel(map))}</option>`)
      .join('');
  }

  function renderAll() {
    const ld = currentLeague();
    if (!ld) return;
    const rows = buildRows(ld);
    renderKpis(ld);
    renderTable(rows);
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
      setStatus(`加载失败：${err.message}`, 'err');
    }
  }

  el.btnReload.addEventListener('click', loadData);
  el.filterLeague.addEventListener('change', () => {
    league = el.filterLeague.value;
    if (!raw.maps[league]) league = 'all';
    selectedModel = null;
    renderAll();
  });
  el.modelTable.addEventListener('click', event => {
    const tr = event.target.closest('tr[data-model]');
    if (!tr) return;
    selectedModel = tr.dataset.model;
    renderTable(buildRows(currentLeague()));
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
      renderTable(buildRows(currentLeague()));
    });
  });

  loadData();

  /* ===== 页内页签：模型榜单（默认）/ 评估控制台（#console 直达） ===== */
  const tabButtons = document.querySelectorAll('.tab-bar .tab');
  const tabPanes = {
    board: document.getElementById('tab-board'),
    console: document.getElementById('tab-console'),
  };

  function switchTab(name, updateHash = true) {
    for (const btn of tabButtons) {
      const active = btn.dataset.tab === name;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    }
    for (const [paneName, pane] of Object.entries(tabPanes)) pane.hidden = paneName !== name;
    if (updateHash) {
      history.replaceState(null, '', name === 'console' ? '#console' : window.location.pathname + window.location.search);
    }
  }

  for (const btn of tabButtons) btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  if (window.location.hash === '#console') switchTab('console', false);

  /* ===== 评估控制台：网页启动/监控/停止 round_robin.py 跑批 ===== */
  const evalEl = {};
  for (const id of ['eval-status-pill', 'eval-maps', 'eval-models', 'eval-model-all', 'eval-model-none',
    'eval-model-count', 'eval-games', 'eval-jobs', 'eval-salt', 'eval-dry', 'eval-start', 'eval-stop',
    'eval-regen', 'eval-msg', 'eval-progress-wrap', 'eval-progress-fill', 'eval-progress-text', 'eval-output',
    'eval-tab-btn', 'eval-mini-strip', 'eval-mini-text', 'eval-mini-go']) {
    evalEl[id] = document.getElementById(id);
  }

  let evalStatus = null;
  let evalPrevRunning = false;
  let evalModels = [];
  // status 接口会返回 knownMaps；这里的列表只是首屏兜底，收到 status 后以服务端为准。
  const EVAL_FALLBACK_MAPS = ['random', 'default', 'breach', 'danger-close', 'desert', 'dual-lanes', 'forge'];
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

  function renderMapChips(maps, checked) {
    evalEl['eval-maps'].innerHTML = maps
      .map(map => `<label><input type="checkbox" value="${escapeAttr(map)}"${checked.includes(map) ? ' checked' : ''}/> ${escapeHtml(mapLabel(map))}</label>`)
      .join('');
  }

  // 服务端地图池变化时才重建 chips，保留用户已勾选项，避免 3s 轮询反复重绘。
  function syncMapChips(maps) {
    if (!Array.isArray(maps) || !maps.length) return;
    const sig = maps.join('\u0001');
    if (sig === renderedMapSig) return;
    renderedMapSig = sig;
    renderMapChips(maps, checkedMaps());
  }

  function checkedMaps() {
    return [...evalEl['eval-maps'].querySelectorAll('input:checked')].map(input => input.value);
  }

  function checkedModels() {
    return [...evalEl['eval-models'].querySelectorAll('input:checked')].map(input => input.value);
  }

  async function loadEvalModels() {
    try {
      const res = await fetch('/api/rl/models', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // round_robin 自身排除 v1.0.0（512 动作旧格式无法进程内互打），这里同步过滤。
      evalModels = data.models.filter(m => m.supported && !m.file.startsWith('hex_ppo_v1.'));
      evalEl['eval-models'].innerHTML = evalModels
        .map(m => `<label title="${escapeAttr(m.file)}"><input type="checkbox" value="${escapeAttr(m.file)}"/><span class="ver">${escapeHtml(m.label || '?')}</span> ${escapeHtml(m.file)}</label>`)
        .join('');
      evalEl['eval-model-count'].textContent = `共 ${evalModels.length} 个可对战模型`;
      evalEl['eval-models'].addEventListener('change', updateModelCount);
    } catch (err) {
      evalEl['eval-model-count'].textContent = `模型列表加载失败：${err.message}`;
    }
  }

  function updateModelCount() {
    const n = checkedModels().length;
    evalEl['eval-model-count'].textContent = n ? `已选 ${n} / ${evalModels.length} 个` : `共 ${evalModels.length} 个可对战模型（不选 = 全部）`;
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
    syncMapChips(st.knownMaps);
    const pill = EVAL_PILL[st.status] || { text: st.status, cls: '' };
    evalEl['eval-status-pill'].textContent = pill.text;
    evalEl['eval-status-pill'].classList.toggle('ok', pill.cls === 'ok');
    evalEl['eval-status-pill'].classList.toggle('err', pill.cls === 'err');
    evalEl['eval-start'].disabled = st.status === 'running';
    evalEl['eval-stop'].disabled = st.status !== 'running';

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
      const res = await fetch('/api/rl/eval/status', { cache: 'no-store', headers: controlHeaders() });
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
        : `状态获取失败：${err.message}`, 'err');
    }
  }

  evalEl['eval-start'].addEventListener('click', async () => {
    const maps = checkedMaps();
    if (!maps.length) {
      evalMsg('请至少选择一张地图', 'err');
      return;
    }
    const payload = {
      maps,
      models: checkedModels().length ? checkedModels() : null,
      games: Number(evalEl['eval-games'].value) || 24,
      jobs: Number(evalEl['eval-jobs'].value) || 1,
      salt: evalEl['eval-salt'].value.trim() || null,
      dryRun: evalEl['eval-dry'].checked,
    };
    evalEl['eval-start'].disabled = true;
    try {
      const res = await fetch('/api/rl/eval/start', {
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
      evalMsg(`启动失败：${err.message}`, 'err');
    } finally {
      evalEl['eval-start'].disabled = evalStatus?.status === 'running';
    }
  });

  evalEl['eval-stop'].addEventListener('click', async () => {
    if (!window.confirm('确定停止当前跑批？已完成的局数已写入 JSONL，同参数重跑可断点续跑。')) return;
    try {
      const res = await fetch('/api/rl/eval/stop', { method: 'POST', headers: controlHeaders() });
      const data = await res.json().catch(() => ({}));
      evalMsg(res.ok ? '停止指令已发送，等待进程退出…' : `停止失败：${data.error || res.status}`, res.ok ? undefined : 'err');
    } catch (err) {
      evalMsg(`停止失败：${err.message}`, 'err');
    }
  });

  evalEl['eval-regen'].addEventListener('click', async () => {
    evalEl['eval-regen'].disabled = true;
    evalMsg('正在重算榜单数据…');
    try {
      const res = await fetch('/api/rl/leaderboard/regenerate', { method: 'POST', headers: controlHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        evalMsg(`重算失败：${data.error || res.status}`, 'err');
      } else {
        evalMsg('榜单数据已重算');
        loadData();
      }
    } catch (err) {
      evalMsg(`重算失败：${err.message}`, 'err');
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
  renderedMapSig = EVAL_FALLBACK_MAPS.join('\u0001');
  loadEvalModels();
  evalEl['eval-mini-strip'].addEventListener('click', () => switchTab('console'));
  pollEvalStatus();
  setInterval(pollEvalStatus, 3000);
})();
