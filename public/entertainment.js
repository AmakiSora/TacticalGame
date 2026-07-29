(() => {
  'use strict';

  const DATA_URL = '/data/fun-stats.json';

  const el = {
    generatedAt: document.getElementById('generated-at'),
    sourceCount: document.getElementById('source-count'),
    dateRange: document.getElementById('date-range'),
    loadStatus: document.getElementById('load-status'),
    btnReload: document.getElementById('btn-reload'),
    kpiGrid: document.getElementById('kpi-grid'),
    funFacts: document.getElementById('fun-facts'),
    modelProfiles: document.getElementById('model-profiles'),
    unitBars: document.getElementById('unit-bars'),
    extremesList: document.getElementById('extremes-list'),
    timeline: document.getElementById('timeline'),
    schemaTimeline: document.getElementById('schema-timeline'),
  };

  let DATA = null;

  // ── helpers ────────────────────────────────────────────────
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function fmtNum(n) {
    if (n == null || !Number.isFinite(n)) return '—';
    return Number(n).toLocaleString('en-US');
  }
  function pct(n) {
    if (n == null || !Number.isFinite(n)) return '—';
    return `${Math.round(n * 1000) / 10}%`;
  }
  function fmtDate(yyyymmdd) {
    const s = String(yyyymmdd || '');
    if (s.length !== 8) return s;
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  function fmtDuration(sec) {
    if (sec == null || !Number.isFinite(sec)) return '—';
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    if (m > 60) {
      const h = Math.floor(m / 60);
      const mm = m % 60;
      return `${h}小时${mm}分`;
    }
    if (m > 0) return `${m}分${s}秒`;
    return `${s}秒`;
  }
  function setStatus(text, cls) {
    el.loadStatus.textContent = text;
    el.loadStatus.classList.remove('ok', 'err');
    if (cls) el.loadStatus.classList.add(cls);
  }

  // ── renderers ─────────────────────────────────────────────
  function renderMeta(d) {
    el.generatedAt.textContent = d.generatedAt ? d.generatedAt.replace('T', ' ').slice(0, 19) : '—';
    el.sourceCount.textContent = fmtNum(d.source?.replayCount);
    const ov = d.overview || {};
    if (ov.dateMin && ov.dateMax) {
      el.dateRange.textContent = `${fmtDate(ov.dateMin)} ~ ${fmtDate(ov.dateMax)}`;
    } else {
      el.dateRange.textContent = '—';
    }
  }

  function renderKpis(d) {
    const ov = d.overview || {};
    const ta = ov.totalActions || {};
    const totalActions = (ta.moves || 0) + (ta.attacks || 0) + (ta.deploys || 0) +
      (ta.heals || 0) + (ta.demolishes || 0) + (ta.captures || 0);
    const cards = [
      { label: '对局总数', value: fmtNum(ov.matchCount), sub: `${fmtNum(ov.completedCount)} 已完成` },
      { label: '操作总数', value: fmtNum(totalActions), sub: `${fmtNum(ov.totalEvents)} 事件` },
      { label: '总阵亡', value: fmtNum(ta.unitDeaths), sub: `平均每局 ${(ov.matchCount ? (ta.unitDeaths / ov.matchCount).toFixed(1) : 0)}` },
      { label: '总攻击', value: fmtNum(ta.attacks), sub: `总移动 ${fmtNum(ta.moves)}` },
      { label: '总占领', value: fmtNum(ta.captures), sub: `总治疗 ${fmtNum(ta.heals)}` },
      { label: '平均整轮', value: ov.avgRounds ?? '—', sub: `总 ${fmtNum(ta.rounds)} 轮` },
      { label: '平均时长', value: fmtDuration(ov.avgDurationSec), sub: `总 ${ov.totalDurationSec ? (ov.totalDurationSec / 3600).toFixed(1) + ' h' : '—'}` },
    ];
    el.kpiGrid.innerHTML = cards.map((c) => `
      <div class="kpi-card">
        <div class="label">${escapeHtml(c.label)}</div>
        <div class="value">${escapeHtml(c.value)}</div>
        <div class="sub">${escapeHtml(c.sub)}</div>
      </div>`).join('');
  }

  function renderFunFacts(d) {
    const facts = d.funFacts || [];
    if (!facts.length) {
      el.funFacts.innerHTML = '<div class="empty-block">无趣味事实</div>';
      return;
    }
    const icons = ['★', '◆', '▲', '●', '✦', '◉', '⬢', '♦'];
    el.funFacts.innerHTML = facts.map((f, i) => `
      <div class="fact-card">
        <div class="fact-icon">${icons[i % icons.length]}</div>
        <div>${escapeHtml(f)}</div>
      </div>`).join('');
  }

  const PROFILE_DIMS = [
    { key: 'attacks', label: '攻击', cls: 'alt1' },
    { key: 'moves', label: '移动', cls: 'alt2' },
    { key: 'captures', label: '占领', cls: 'alt3' },
    { key: 'deploys', label: '部署', cls: 'alt4' },
    { key: 'heals', label: '治疗', cls: 'alt5' },
    { key: 'demolishes', label: '拆迁', cls: 'alt6' },
  ];

  function renderProfiles(d) {
    const profiles = d.modelProfiles || [];
    if (!profiles.length) {
      el.modelProfiles.innerHTML = '<div class="empty-block">无模型数据</div>';
      return;
    }
    // global max per-game per-dim for bar scaling
    const maxes = {};
    for (const dim of PROFILE_DIMS) {
      maxes[dim.key] = Math.max(1, ...profiles.map((p) => p.perGame?.[dim.key] || 0));
    }
    el.modelProfiles.innerHTML = profiles.map((p) => {
      const bars = PROFILE_DIMS.map((dim) => {
        const v = p.perGame?.[dim.key] || 0;
        const w = Math.max(2, Math.round((v / maxes[dim.key]) * 100));
        return `
          <div class="profile-bar">
            <span class="pl">${dim.label}</span>
            <div class="bar-track"><div class="bar-fill ${dim.cls}" style="width:${w}%"></div></div>
            <span class="pc">${v.toFixed(1)}</span>
          </div>`;
      }).join('');
      const tags = (p.styleTags || []).map((t) =>
        `<span class="style-tag">${escapeHtml(t)}</span>`).join('');
      return `
        <div class="profile-row">
          <div class="profile-head">
            <span class="pname">${escapeHtml(p.model)}</span>
            <span class="pgames">${fmtNum(p.games)} 场 · 阵亡 ${fmtNum(p.unitDeathsLost)}</span>
            <span class="style-tags">${tags}</span>
          </div>
          <div class="profile-bars">${bars}</div>
        </div>`;
    }).join('');
  }

  function renderUnitBars(d) {
    const units = d.unitStats || [];
    if (!units.length) {
      el.unitBars.innerHTML = '<div class="empty-block">无单位数据</div>';
      return;
    }
    const maxDeploys = Math.max(1, ...units.map((u) => u.deploys));
    el.unitBars.innerHTML = units.map((u) => {
      const w = Math.max(2, Math.round((u.deploys / maxDeploys) * 100));
      const top = Object.entries(u.byModel || {}).slice(0, 3)
        .map(([m, n]) => `${escapeHtml(m)} ${fmtNum(n)}`).join(' · ');
      return `
        <div class="bar-row">
          <span class="name" title="${escapeHtml(top)}">${escapeHtml(u.unitType)}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${w}%"></div></div>
          <span class="count">${fmtNum(u.deploys)} · ${pct(u.share)}</span>
        </div>`;
    }).join('');
  }

  const EXTREME_DEFS = [
    { key: 'longestByRounds', label: '最长对局', fmt: (e) => `${e.rounds} 整轮` },
    { key: 'shortestByRounds', label: '最速对局', fmt: (e) => `${e.rounds} 整轮` },
    { key: 'longestByEvents', label: '事件最多', fmt: (e) => `${fmtNum(e.eventCount)} 事件` },
    { key: 'mostAttacks', label: '攻击最多', fmt: (e) => `${fmtNum(e.value)} 次` },
    { key: 'mostMoves', label: '移动最多', fmt: (e) => `${fmtNum(e.value)} 次` },
    { key: 'mostDeploys', label: '部署最多', fmt: (e) => `${fmtNum(e.value)} 次` },
    { key: 'mostCaptures', label: '占领最多', fmt: (e) => `${fmtNum(e.value)} 次` },
    { key: 'mostHeals', label: '治疗最多', fmt: (e) => `${fmtNum(e.value)} 次` },
    { key: 'bloodiest', label: '最血腥', fmt: (e) => `阵亡 ${fmtNum(e.value)}` },
    { key: 'highestHqDamage', label: '最强拆迁', fmt: (e) => `${e.model} ${fmtNum(e.value)} 伤` },
    { key: 'biggestScore', label: '最高得分', fmt: (e) => `${e.model} ${fmtNum(e.value)}` },
    { key: 'longestDuration', label: '耗时最长', fmt: (e) => fmtDuration(e.durationSec) },
    { key: 'shortestDuration', label: '耗时最短', fmt: (e) => fmtDuration(e.durationSec) },
  ];

  function renderExtremes(d) {
    const ex = d.extremes || {};
    const rows = EXTREME_DEFS
      .map((def) => {
        const e = ex[def.key];
        if (!e) return null;
        const winner = e.winner ? `胜者 ${escapeHtml(e.winner)}` : '';
        const map = e.mapId ? ` · ${escapeHtml(e.mapId)}` : '';
        return `
          <div class="extreme-row">
            <span class="ek">${escapeHtml(def.label)}</span>
            <span class="ev">
              <a class="elink" href="/stats.html">${escapeHtml(e.recordId)}</a>
              · <span class="num">${escapeHtml(def.fmt(e))}</span>
              ${winner ? ` · ${winner}` : ''}${map}
            </span>
          </div>`;
      })
      .filter(Boolean);
    el.extremesList.innerHTML = rows.length
      ? rows.join('')
      : '<div class="empty-block">无极限记录</div>';
  }

  function renderTimeline(d) {
    const tl = d.timeline || [];
    if (!tl.length) {
      el.timeline.innerHTML = '<div class="empty-block">无时间线数据</div>';
      return;
    }
    const maxMatches = Math.max(1, ...tl.map((t) => t.matches));
    el.timeline.innerHTML = tl.map((t) => {
      const h = Math.max(2, Math.round((t.matches / maxMatches) * 100));
      const dur = t.avgDurationSec != null ? `时长 ${fmtDuration(t.avgDurationSec)}` : '';
      return `
        <div class="tl-col">
          <div class="tl-bar" style="height:${h}%"></div>
          <span class="tl-label">${escapeHtml(t.date.slice(5))}</span>
          <div class="tl-tip">${escapeHtml(t.date)} · ${t.matches} 局 · 平均 ${t.avgRounds} 轮 ${dur}</div>
        </div>`;
    }).join('');
  }

  function renderSchema(d) {
    const sc = d.schemaTimeline || [];
    if (!sc.length) {
      el.schemaTimeline.innerHTML = '<div class="empty-block">无版本数据</div>';
      return;
    }
    el.schemaTimeline.innerHTML = sc.map((s) => `
      <span class="schema-chip">
        <span class="sv">${escapeHtml(s.schemaVersion)}</span>
        <span class="sd">${escapeHtml(s.firstDate)}</span>
        <span class="sg">${fmtNum(s.games)} 局</span>
      </span>`).join('');
  }

  function renderAll(d) {
    DATA = d;
    renderMeta(d);
    renderKpis(d);
    renderFunFacts(d);
    renderProfiles(d);
    renderUnitBars(d);
    renderExtremes(d);
    renderTimeline(d);
    renderSchema(d);
    setStatus('已加载', 'ok');
  }

  // ── load ──────────────────────────────────────────────────
  async function loadData() {
    setStatus('加载中…');
    try {
      const res = await fetch(`${DATA_URL}?t=${Date.now()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      renderAll(d);
    } catch (err) {
      setStatus('加载失败', 'err');
      el.kpiGrid.innerHTML = '';
      el.funFacts.innerHTML = `<div class="empty-block">加载失败：${escapeHtml(err.message)}。请先运行 <code>npm run fun-stats</code></div>`;
    }
  }

  el.btnReload.addEventListener('click', loadData);

  document.addEventListener('DOMContentLoaded', loadData);
})();
