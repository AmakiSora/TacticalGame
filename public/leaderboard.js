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
    el.h2hHead.innerHTML = '<th class="model-col">模型 \\ 对手</th>' +
      cols.map(c => `<th title="${escapeAttr(c.id)}">${escapeHtml(c.short)}</th>`).join('');
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
})();
