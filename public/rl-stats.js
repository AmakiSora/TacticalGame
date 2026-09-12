/* RL 玩法统计 + 模型档案 — reads /data/rl-stats.json only. */
(() => {
  const DATA_URL = '/data/rl-stats.json';

  const MAP_LABELS = { random: '随机图' };
  const UNIT_NAMES = { infantry: '步兵', scout: '侦察兵', heavy: '重装', ranger: '远程兵', support: '支援兵' };
  const END_REASON_LABELS = {
    last_player_standing: '歼灭获胜',
    turn_limit_score: '打满回合·比分胜负',
    turn_limit_draw: '打满回合·平局',
    unknown: '未知',
  };
  const STATUS_META = {
    recommended: { label: '当前推荐', cls: 'st-good' },
    legacy: { label: '历史', cls: 'st-muted' },
    retired: { label: '作废', cls: 'st-bad' },
  };

  const el = {};
  for (const id of ['rls-generated-at', 'rls-source-count', 'rls-date-range', 'rls-load-status', 'rls-btn-reload',
    'rls-kpi-grid', 'rls-endreasons', 'rls-economy', 'rls-rounds-dist', 'rls-duration-dist',
    'rls-units-table', 'rls-model-table', 'rls-map-table',
    'rls-models-status', 'rls-model-cards', 'rls-deprecated']) {
    el[id] = document.getElementById(id);
  }

  /** @type {any} */
  let raw = null;
  let modelSort = { key: 'winRate', dir: 'desc' };

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

  function mapLabel(map) {
    return MAP_LABELS[map] || map;
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
    const shortById = new Map((raw.models || []).map(m => [m.id, m.short]));
    const rows = gp.perModel.map(m => ({ ...m, short: shortById.get(m.id) || m.id }));
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
        <td data-label="主力兵种" class="muted">${escapeHtml(topDeploys || '—')}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="13" class="muted">无数据</td></tr>';
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
      <td class="num" data-label="歼灭率">${pct(m.annihilationRate)}</td>
      <td class="num" data-label="平局率">${pct(m.drawRate)}</td>
      <td data-label="最常见结局">${escapeHtml(endReasonLabel(m.topEndReason))}</td>
    </tr>`).join('') || '<tr><td colspan="7" class="muted">无数据</td></tr>';
  }

  function fmtSteps(steps) {
    if (steps == null) return 'best';
    return steps >= 1_000_000 ? `${(steps / 1_000_000).toFixed(1)}M 步` : `${Math.round(steps / 1000)}K 步`;
  }

  function renderModelCards(models) {
    if (!models.length) {
      el['rls-model-cards'].innerHTML = '<div class="empty-block">无模型档案</div>';
      return;
    }
    el['rls-model-cards'].innerHTML = models.map(m => {
      const statusMeta = STATUS_META[m.status] || STATUS_META.legacy;
      const ratingText = m.rating != null ? `${m.rating}` : '未参评';
      const ratingTitle = m.rating != null && m.ratingLo != null ? `95% CI ${m.ratingLo}–${m.ratingHi}` : '';
      const metaBits = [
        m.games ? `<span>对局 <b>${fmtNum(m.games)}</b></span>` : '',
        m.winRate != null ? `<span>胜率 <b>${pct(m.winRate)}</b></span>` : '',
        `<span>训练日期 <b>${escapeHtml(m.trainDate)}</b></span>`,
        `<span>训练地图 <b>${escapeHtml(mapLabel(m.trainMap))}</b></span>`,
        `<span>训练对手 <b>${escapeHtml(m.opponentType)}</b></span>`,
        `<span>交付步数 <b>${fmtSteps(m.steps)}</b></span>`,
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
    const gp = raw.gameplay;
    renderKpis(gp);
    renderBars(el['rls-endreasons'], gp.endReasons.map(e => ({ label: endReasonLabel(e.reason), count: e.count, pct: e.pct })));
    renderEconomy(gp.economy);
    renderBars(el['rls-rounds-dist'], gp.roundsDist.map(b => ({ label: b.bucket, count: b.count, pct: b.pct })));
    renderBars(el['rls-duration-dist'], gp.durationDist.map(b => ({ label: b.bucket, count: b.count, pct: b.pct })));
    renderUnits(gp.units);
    renderModelTable(gp);
    renderMapTable(gp);
    renderModelCards(raw.models || []);
    renderDeprecated(raw.deprecated || []);
  }

  async function loadData() {
    setStatus('加载中…');
    try {
      const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      raw = await res.json();
      el['rls-generated-at'].textContent = raw.generatedAt ? new Date(raw.generatedAt).toLocaleString() : '—';
      el['rls-source-count'].textContent = raw.source?.matchCount ?? 0;
      el['rls-date-range'].textContent = raw.source?.dateMin
        ? `${raw.source.dateMin} → ${raw.source.dateMax ?? ''}`
        : '—';
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
      setStatus(`加载失败：${err.message}`, 'err');
    }
  }

  el['rls-btn-reload'].addEventListener('click', loadData);
  el['rls-model-table'].querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (modelSort.key === key) {
        modelSort.dir = modelSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        modelSort = { key, dir: key === 'short' ? 'asc' : 'desc' };
      }
      if (raw) renderModelTable(raw.gameplay);
    });
  });

  loadData();
})();
