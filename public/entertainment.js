/* 娱乐数据页 — reads /data/fun-stats.json only. 视觉复用 stats.css 站点体系。 */
(() => {
  'use strict';

  const DATA_URL = '/data/fun-stats.json';
  const ACTIONS = [
    { key: 'moves', label: '移动', className: 'mix-moves' },
    { key: 'attacks', label: '攻击', className: 'mix-attacks' },
    { key: 'deploys', label: '部署', className: 'mix-deploys' },
    { key: 'captures', label: '占领', className: 'mix-captures' },
    { key: 'heals', label: '治疗', className: 'mix-heals' },
    { key: 'demolishes', label: '拆除', className: 'mix-demolishes' },
  ];
  const BENCHMARKS = [
    { key: 'damageDealt', label: '伤害' },
    { key: 'attacks', label: '攻击' },
    { key: 'kills', label: '击杀' },
    { key: 'moves', label: '移动' },
    { key: 'captures', label: '占领' },
    { key: 'deploys', label: '部署' },
    { key: 'heals', label: '治疗' },
    { key: 'demolishes', label: '拆除' },
  ];
  const UNIT_LABELS = {
    infantry: '步兵', scout: '侦察兵', ranger: '游骑兵', heavy: '重装兵', support: '支援兵',
  };

  const el = {
    generatedAt: document.getElementById('generated-at'),
    sourceCount: document.getElementById('source-count'),
    dateRange: document.getElementById('date-range'),
    loadStatus: document.getElementById('load-status'),
    btnReload: document.getElementById('btn-reload'),
    leadTitle: document.getElementById('lead-title'),
    leadSummary: document.getElementById('lead-summary'),
    leadChips: document.getElementById('lead-chips'),
    kpiGrid: document.getElementById('kpi-grid'),
    actionMix: document.getElementById('action-mix'),
    actionMixTotal: document.getElementById('action-mix-total'),
    actionLegend: document.getElementById('action-legend'),
    paceChart: document.getElementById('pace-chart'),
    paceNote: document.getElementById('pace-note'),
    momentumGrid: document.getElementById('momentum-grid'),
    combatTable: document.getElementById('combat-table'),
    unitBars: document.getElementById('unit-bars'),
    factList: document.getElementById('fact-list'),
    economyGrid: document.getElementById('economy-grid'),
    spenderList: document.getElementById('spender-list'),
    rivalryList: document.getElementById('rivalry-list'),
    storyGrid: document.getElementById('story-grid'),
    recordsList: document.getElementById('records-list'),
    recordTabs: [...document.querySelectorAll('[data-record-view]')],
    modelSelect: document.getElementById('model-select'),
    modelIdentity: document.getElementById('model-identity'),
    modelBenchmarks: document.getElementById('model-benchmarks'),
    growthChart: document.getElementById('growth-chart'),
    growthSummary: document.getElementById('growth-summary'),
    debutList: document.getElementById('debut-list'),
    monthlyGrid: document.getElementById('monthly-grid'),
    versionList: document.getElementById('version-list'),
    mapStage: document.getElementById('map-stage'),
  };

  /** @type {any} */
  let data = null;
  let recordView = 'battle';
  let combatSort = { key: 'avgDamage', dir: 'desc' };

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, '&#39;');
  }

  function fmtNum(value, digits = 0) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    return Number(value).toLocaleString('zh-CN', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function fmtDate(value) {
    const source = String(value || '').replace(/-/g, '');
    if (source.length !== 8) return value || '—';
    return `${source.slice(0, 4)}.${source.slice(4, 6)}.${source.slice(6, 8)}`;
  }

  function pct(value, digits = 0) {
    if (value == null || Number.isNaN(Number(value))) return '—';
    return `${(Number(value) * 100).toFixed(digits)}%`;
  }

  /** 秒数 → 中文时长：长局按小时计，短局按分秒计。 */
  function fmtDur(sec) {
    if (sec == null || !Number.isFinite(sec)) return '—';
    if (sec >= 5400) return `${(sec / 3600).toFixed(1)} 小时`;
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    if (m > 0) return `${m} 分 ${s} 秒`;
    return `${s} 秒`;
  }

  function totalActions(overview) {
    const totals = overview?.totalActions || {};
    return ACTIONS.reduce((sum, action) => sum + (totals[action.key] || 0), 0);
  }

  function unitLabel(type) {
    return UNIT_LABELS[type] || type;
  }

  function setStatus(text, kind) {
    el.loadStatus.textContent = text;
    el.loadStatus.classList.remove('ok', 'err');
    if (kind) el.loadStatus.classList.add(kind);
  }

  function renderMeta(d) {
    const ov = d.overview || {};
    el.generatedAt.textContent = d.generatedAt ? new Date(d.generatedAt).toLocaleString() : '—';
    el.sourceCount.textContent = fmtNum(d.source?.replayCount ?? ov.matchCount);
    el.dateRange.textContent = ov.dateMin && ov.dateMax
      ? `${fmtDate(ov.dateMin)} → ${fmtDate(ov.dateMax)}`
      : '—';
  }

  /** 节奏曲线里样本充足的伤害峰值回合（尾部样本 &lt; 10 的回合不参与）。 */
  function peakCombatRound(pace) {
    const rows = (pace?.byRound || []).filter((r) => r.matches >= 10);
    if (!rows.length) return null;
    return rows.reduce((best, r) => (r.damage > best.damage ? r : best), rows[0]);
  }

  function renderLead(d) {
    const ov = d.overview || {};
    const totals = ov.totalActions || {};
    const actions = totalActions(ov);
    const peak = peakCombatRound(d.pace);
    const fb = d.momentum?.firstBlood;
    if (peak) {
      el.leadTitle.textContent = `第 ${peak.round} 回合前后，是全线交火的高峰。`;
    } else {
      el.leadTitle.textContent = '战报出炉：这片战场的一切都记下来了。';
    }
    const parts = [
      `${fmtNum(ov.matchCount)} 局回放、${fmtNum(actions)} 次有效操作、${fmtNum(totals.damageDealt)} 点伤害。`,
      peak ? `伤害曲线从第 3 回合开始爬坡，第 ${peak.round} 回合场均 ${fmtNum(peak.damage)} 点伤害登顶，之后随对局收场自然回落。` : '',
      fb && fb.samples > 0 ? `拿到一血的一方赢下了 ${pct(fb.winRate)} 的对局——开局的优势确实会滚雪球。` : '',
    ];
    el.leadSummary.textContent = parts.filter(Boolean).join('');
    const chips = [
      { label: '总伤害', value: fmtNum(totals.damageDealt) },
      { label: '总击杀', value: fmtNum(totals.kills) },
      { label: '一血转化', value: fb?.winRate != null ? pct(fb.winRate) : null },
      { label: '平均耗时', value: ov.avgDurationSec != null ? fmtDur(ov.avgDurationSec) : null },
      { label: '平均回合', value: ov.avgRounds ?? null },
    ].filter((c) => c.value != null);
    el.leadChips.innerHTML = chips
      .map((c) => `<span class="lead-chip">${escapeHtml(c.label)} <b>${escapeHtml(c.value)}</b></span>`)
      .join('');
  }

  function renderPulse(d) {
    const ov = d.overview || {};
    const totals = ov.totalActions || {};
    const actions = totalActions(ov);
    const completedRate = ov.matchCount ? ov.completedCount / ov.matchCount : 0;
    const cards = [
      { label: '回放局数', value: fmtNum(ov.matchCount), sub: `完赛率 ${pct(completedRate)}` },
      { label: '有效操作', value: fmtNum(actions), sub: `场均 ${fmtNum(ov.matchCount ? actions / ov.matchCount : 0, 1)} 次` },
      { label: '平均回合', value: fmtNum(ov.avgRounds, 1), sub: `每回合 ${fmtNum(ov.avgActionsPerRound, 1)} 次操作` },
      { label: '平均耗时', value: ov.avgDurationSec != null ? fmtDur(ov.avgDurationSec) : '—', sub: '首末事件墙钟差' },
      { label: '总伤害', value: fmtNum(totals.damageDealt), sub: `场均 ${fmtNum(ov.matchCount ? totals.damageDealt / ov.matchCount : 0)} 点` },
      { label: '总击杀', value: fmtNum(totals.kills), sub: `阵亡 ${fmtNum(totals.unitDeaths)} 个单位` },
      { label: '治疗挽回', value: fmtNum(totals.healsHp), sub: `${fmtNum(totals.heals)} 次治疗` },
      { label: '攻击落空率', value: pct(ov.attackMissRate, 1), sub: `${fmtNum(totals.attackMisses)} 次落空 · 仅同时模式` },
    ];
    el.kpiGrid.innerHTML = cards
      .map((c) => `<article class="kpi-card">
        <div class="label">${escapeHtml(c.label)}</div>
        <div class="value">${escapeHtml(c.value)}</div>
        <div class="sub">${escapeHtml(c.sub || '')}</div>
      </article>`)
      .join('');
  }

  function renderMix(d) {
    const ov = d.overview || {};
    const totals = ov.totalActions || {};
    const actions = totalActions(ov);
    el.actionMixTotal.textContent = `${fmtNum(actions)} 次有效操作`;
    el.actionMix.innerHTML = ACTIONS.map((action) => {
      const value = totals[action.key] || 0;
      const share = actions ? value / actions : 0;
      return `<span class="mix-segment ${action.className}" style="width:${share * 100}%" title="${action.label} ${pct(share, 1)}"></span>`;
    }).join('');
    el.actionLegend.innerHTML = ACTIONS.map((action) => {
      const value = totals[action.key] || 0;
      const share = actions ? value / actions : 0;
      return `<span class="legend-item"><i class="${action.className}"></i>${action.label} <b>${pct(share, 1)}</b></span>`;
    }).join('');
  }

  /** 回合节奏 SVG：柱 = 场均操作数，线 = 场均伤害；柱透明度随样本量衰减。 */
  function renderPace(d) {
    const pace = d.pace || {};
    const rows = pace.byRound || [];
    if (!rows.length) {
      el.paceChart.innerHTML = '<div class="empty-block">暂无节奏数据</div>';
      el.paceNote.textContent = '';
      return;
    }
    const W = 860;
    const H = 250;
    const PAD = { top: 18, right: 14, bottom: 26, left: 40 };
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const n = rows.length;
    const maxActions = Math.max(...rows.map((r) => r.actions), 1);
    const maxDamage = Math.max(...rows.map((r) => r.damage), 1);
    const maxMatches = Math.max(...rows.map((r) => r.matches), 1);
    const x = (i) => PAD.left + (i / n) * innerW;
    const barW = Math.max(3, (innerW / n) * 0.62);
    const yA = (v) => PAD.top + innerH - (v / maxActions) * innerH;
    const yD = (v) => PAD.top + innerH - (v / maxDamage) * innerH;

    const grid = [0, 0.5, 1].map((f) => {
      const y = PAD.top + innerH * (1 - f);
      const v = Math.round(maxActions * f);
      return `<line x1="${PAD.left}" y1="${y.toFixed(1)}" x2="${(W - PAD.right).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#243442" stroke-width="1"/>
        <text x="${(PAD.left - 6).toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="end" fill="#5a7484" font-size="9">${v}</text>`;
    }).join('');

    const bars = rows.map((r, i) => {
      const h = Math.max(1.5, (r.actions / maxActions) * innerH);
      const opacity = 0.25 + 0.65 * (r.matches / maxMatches);
      return `<rect x="${(x(i) + (innerW / n - barW) / 2).toFixed(1)}" y="${(PAD.top + innerH - h).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="#3d6a8a" opacity="${opacity.toFixed(2)}"><title>第 ${r.round} 回合 · 场均操作 ${r.actions} · 伤害 ${fmtNum(r.damage)} · 击杀 ${r.kills} · 样本 ${r.matches} 局</title></rect>`;
    }).join('');

    const pts = rows.map((r, i) => `${(x(i) + innerW / n / 2).toFixed(1)},${yD(r.damage).toFixed(1)}`);
    const line = `<polyline points="${pts.join(' ')}" fill="none" stroke="#e07868" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    const dots = rows.map((r, i) =>
      `<circle cx="${(x(i) + innerW / n / 2).toFixed(1)}" cy="${yD(r.damage).toFixed(1)}" r="2" fill="#e07868"><title>第 ${r.round} 回合 · 场均伤害 ${fmtNum(r.damage)}</title></circle>`,
    ).join('');

    const labelEvery = Math.ceil(n / 12);
    const labels = rows.map((r, i) => {
      if (i % labelEvery !== 0 && i !== n - 1) return '';
      return `<text x="${(x(i) + innerW / n / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" fill="#5a7484" font-size="9">R${r.round}</text>`;
    }).join('');

    el.paceChart.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="回合节奏曲线">
        ${grid}${bars}${line}${dots}${labels}
      </svg>
      <div class="action-legend">
        <span class="legend-item"><i style="background:#3d6a8a"></i>场均操作（柱，左轴）</span>
        <span class="legend-item"><i style="background:#e07868"></i>场均伤害（线，归一化）</span>
        <span class="legend-item">柱越深 = 到达该回合的对局越多</span>
      </div>`;

    const attr = pace.attribution || {};
    el.paceNote.textContent = `节奏曲线基于 ${fmtNum(pace.sampled)} 局带回合锚点的回放（直读/锚定 ${pct(attr.directShare)} 事件，其余按回合边界顺推重建）；早期无锚点回放不进入样本。尾部回合样本变薄，柱体随之变浅。`;
  }

  function renderMomentum(d) {
    const m = d.momentum || {};
    const fb = m.firstBlood || {};
    const fc = m.firstCapture || {};
    const cb = m.comeback || {};
    const cards = [
      {
        cls: 'mo-accent-green',
        label: '一血转化率',
        value: fb.winRate != null ? pct(fb.winRate) : '—',
        small: fb.samples ? `${fb.wins}/${fb.samples} 局` : '',
        note: fb.avgRound != null ? `一血平均出现在第 ${fb.avgRound} 回合` : '尚无击杀样本',
        sub: fb.fastest
          ? `最快一血 <b>${fmtNum(fb.fastest.sec, 1)} 秒</b> · ${escapeHtml(fb.fastest.model)} @ ${escapeHtml(fb.fastest.recordId)}${fb.fastest.round ? `（第 ${fb.fastest.round} 回合）` : ''}`
          : '',
      },
      {
        cls: 'mo-accent-blue',
        label: '首点转化率',
        value: fc.winRate != null ? pct(fc.winRate) : '—',
        small: fc.samples ? `${fc.wins}/${fc.samples} 局` : '',
        note: fc.avgRound != null ? `首个占领平均出现在第 ${fc.avgRound} 回合` : '尚无占领样本',
        sub: '率先踩下控制点，经济与视野都先一步',
      },
      {
        cls: 'mo-accent-amber',
        label: '翻盘补给成效',
        value: cb.winRate != null ? pct(cb.winRate) : '—',
        small: cb.triggers ? `${cb.wins}/${cb.triggers} 次受援` : '',
        note: cb.triggers ? `落后方平均落后 ${fmtNum(cb.avgGap)} 分时触发` : '尚无翻盘补给触发',
        sub: cb.maxGap
          ? `最大分差 <b>${fmtNum(cb.maxGap.gap)}</b> · ${escapeHtml(cb.maxGap.model)} @ ${escapeHtml(cb.maxGap.recordId)} 最终${cb.maxGap.won ? '<b>翻盘成功</b>' : '未能翻盘'}`
          : '',
      },
    ];
    el.momentumGrid.innerHTML = cards.map((c) => `
      <div class="momentum-card ${c.cls}">
        <div class="mo-label">${escapeHtml(c.label)}</div>
        <div class="mo-value">${escapeHtml(c.value)}${c.small ? ` <small>${escapeHtml(c.small)}</small>` : ''}</div>
        <div class="mo-note">${escapeHtml(c.note)}</div>
        ${c.sub ? `<div class="mo-sub">${c.sub}</div>` : ''}
      </div>`).join('');
  }

  /** 战斗群像行数据（排序在前端做）。 */
  function combatRows() {
    const profiles = data?.modelProfiles || [];
    return profiles.map((p) => {
      const g = p.games || 1;
      const deaths = p.unitDeathsLost || 0;
      return {
        model: p.model,
        games: p.games,
        avgDamage: round1(p.damageDealt / g),
        avgTaken: round1(p.damageTaken / g),
        avgKills: round2(p.kills / g),
        avgDeaths: round2(deaths / g),
        kd: deaths > 0 ? round2(p.kills / deaths) : (p.kills > 0 ? p.kills : 0),
        avgHealsHp: round1(p.healsHp / g),
        missRate: p.attacks > 0 ? p.attackMisses / p.attacks : null,
        failedActions: p.failedActions || 0,
      };
    });
  }

  function round1(n) { return Math.round(n * 10) / 10; }
  function round2(n) { return Math.round(n * 100) / 100; }

  function renderCombatTable() {
    const rows = combatRows();
    const mul = combatSort.dir === 'asc' ? 1 : -1;
    const sorted = rows.slice().sort((a, b) => {
      const av = a[combatSort.key];
      const bv = b[combatSort.key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') return av.localeCompare(bv) * mul;
      return (av - bv) * mul;
    });
    const body = el.combatTable.querySelector('tbody');
    body.innerHTML = sorted.map((r) => {
      const low = r.games < 3 ? ' class="low-sample"' : '';
      const kdCls = r.kd > 1.2 ? 'kd-good' : (r.kd < 0.8 && (r.avgDeaths > 0.5 || r.avgKills > 0.5)) ? 'kd-bad' : '';
      return `<tr${low}>
        <td class="model-name" data-label="模型">${escapeHtml(r.model)}</td>
        <td class="num" data-label="场次">${r.games}</td>
        <td class="num" data-label="场均伤害">${fmtNum(r.avgDamage)}</td>
        <td class="num" data-label="场均承伤">${fmtNum(r.avgTaken)}</td>
        <td class="num" data-label="场均击杀">${fmtNum(r.avgKills, 2)}</td>
        <td class="num" data-label="场均阵亡">${fmtNum(r.avgDeaths, 2)}</td>
        <td class="num ${kdCls}" data-label="K/D">${r.kd != null ? fmtNum(r.kd, 2) : '—'}</td>
        <td class="num" data-label="场均治疗">${fmtNum(r.avgHealsHp)}</td>
        <td class="num" data-label="落空率">${r.missRate == null ? '—' : pct(r.missRate, 1)}</td>
        <td class="num" data-label="失误">${r.failedActions || '—'}</td>
      </tr>`;
    }).join('');
    el.combatTable.querySelectorAll('th[data-csort]').forEach((th) => {
      th.classList.toggle('sorted', th.dataset.csort === combatSort.key);
    });
  }

  function renderUnits(d) {
    const units = d.unitStats || [];
    if (!units.length) {
      el.unitBars.innerHTML = '<div class="empty-block">暂无兵种数据</div>';
      return;
    }
    const maxShare = Math.max(...units.flatMap((u) => [u.share, u.deathShare]), 0.01);
    el.unitBars.innerHTML = units.map((u) => {
      const dw = Math.max(2, (u.share / maxShare) * 100);
      const kw = u.deaths > 0 ? Math.max(2, (u.deathShare / maxShare) * 100) : 0;
      const delta = u.deathShare - u.share;
      const deltaText = Math.abs(delta) >= 0.02
        ? (delta > 0 ? `阵亡占比高 ${pct(Math.abs(delta))}` : `阵亡占比低 ${pct(Math.abs(delta))}`)
        : '部署与阵亡均衡';
      return `<div class="unit-row" title="${escapeAttr(`${unitLabel(u.unitType)}：部署 ${fmtNum(u.deploys)} 次 / 阵亡 ${fmtNum(u.deaths)} 次 · ${deltaText}`)}">
        <span class="unit-name">${escapeHtml(unitLabel(u.unitType))}</span>
        <div class="unit-tracks">
          <div class="unit-track"><div class="unit-fill f-deploy" style="width:${dw}%"></div></div>
          <div class="unit-track"><div class="unit-fill f-death" style="width:${kw}%"></div></div>
        </div>
        <span class="unit-vals"><b>${pct(u.share)}</b> / ${u.deaths > 0 ? pct(u.deathShare) : '—'}<br>${escapeHtml(deltaText)}</span>
      </div>`;
    }).join('');
  }

  function renderFacts(d) {
    const facts = (d.funFacts || []).slice(0, 8);
    el.factList.innerHTML = facts.length
      ? facts.map((f) => `<li><span>${escapeHtml(f)}</span></li>`).join('')
      : '<li><span>暂无速报</span></li>';
  }

  function renderEconomy(d) {
    const ov = d.overview || {};
    const totals = ov.totalActions || {};
    const economy = d.economy || [];
    const rivals = d.eliminations?.rivalries || [];
    const spenders = economy.slice(0, 5);
    const items = [
      { label: '补给总收入', value: fmtNum(totals.income), sub: '基础收入与据点收入之和' },
      { label: '部署总花费', value: fmtNum(totals.deployCost), sub: '花在扩充军力上' },
      { label: '补给转化率', value: pct(ov.spendRate), sub: '部署花费 / 总收入' },
      { label: '每局净余', value: fmtNum(ov.matchCount ? (totals.income - totals.deployCost) / ov.matchCount : 0, 1), sub: '平均每局结余补给' },
      { label: '翻盘补给', value: fmtNum(totals.comebackSupply), sub: '落后方额外补给总额' },
    ];
    el.economyGrid.innerHTML = items.map((it) => `
      <div class="econ-item">
        <div class="label">${escapeHtml(it.label)}</div>
        <div class="value">${escapeHtml(it.value)}</div>
        <div class="sub">${escapeHtml(it.sub)}</div>
      </div>`).join('');

    el.spenderList.innerHTML = spenders.length ? spenders.map((s, i) => `
      <li class="spender-row">
        <span class="spender-rank">${String(i + 1).padStart(2, '0')}</span>
        <span class="spender-model">${escapeHtml(s.model)}</span>
        <span class="spender-bar"><i style="width:${Math.max(3, (s.deployCost / (spenders[0].deployCost || 1)) * 100)}%"></i></span>
        <span class="spender-value">${fmtNum(s.deployCost)}<small>${pct(s.spendRate)} 转化</small></span>
      </li>`).join('') : '<li class="empty-block">暂无经济数据</li>';

    el.rivalryList.innerHTML = rivals.length ? rivals.slice(0, 6).map((r) => `
      <li class="rivalry-row">
        <span class="rivalry-models">${escapeHtml(r.a)} <b>vs</b> ${escapeHtml(r.b)}</span>
        <span class="rivalry-score">${r.aKillsB} : ${r.bKillsA}</span>
        <span class="rivalry-total">互相淘汰 ${r.total} 次</span>
      </li>`).join('') : '<li class="rivalry-empty">还没有结下双向的梁子</li>';
  }

  function participantText(record) {
    const participants = record?.participants || [];
    if (!participants.length) return '参赛阵容未记录';
    return participants.map((p) => p.model || p.displayName).filter(Boolean).join(' / ');
  }

  function renderStories(d) {
    const ex = d.extremes || {};
    const stories = [
      {
        label: '最长拉锯', record: ex.longestByRounds, featured: true,
        title: ex.longestByRounds?.winner ? `${ex.longestByRounds.winner} 熬到最后` : '战到最后一轮',
        metric: `${fmtNum(ex.longestByRounds?.rounds)} 整轮`,
      },
      {
        label: '闪电战', record: ex.fastestWinRounds,
        title: ex.fastestWinRounds?.winner ? `${ex.fastestWinRounds.winner} 速胜` : '迅雷不及掩耳',
        metric: `${fmtNum(ex.fastestWinRounds?.rounds)} 整轮定胜负`,
      },
      {
        label: '最高烈度', record: ex.bloodiest,
        title: '战场伤亡纪录', metric: `${fmtNum(ex.bloodiest?.value)} 个单位阵亡`,
      },
      {
        label: '最重一击', record: ex.biggestHit,
        title: ex.biggestHit?.model || '致命一击',
        metric: `${fmtNum(ex.biggestHit?.value)} 点单次伤害${ex.biggestHit?.killed ? ' · 一击致命' : ''}`,
      },
      {
        label: '火力全开', record: ex.mostDamage,
        title: '单场伤害纪录', metric: `${fmtNum(ex.mostDamage?.value)} 点总伤害`,
      },
      {
        label: '最烧钱', record: ex.biggestSpender,
        title: ex.biggestSpender?.model || '疯狂采买', metric: `${fmtNum(ex.biggestSpender?.value)} 补给部署`,
      },
    ].filter((story) => story.record);
    el.storyGrid.innerHTML = stories.length ? stories.map((story) => `
      <article class="story-card${story.featured ? ' featured' : ''}">
        <span class="story-label">${escapeHtml(story.label)}</span>
        <h3>${escapeHtml(story.title)}</h3>
        <div class="story-metric">${escapeHtml(story.metric)}</div>
        <p class="story-copy">${escapeHtml(story.record.mapId || '未知地图')} · ${escapeHtml(participantText(story.record))}</p>
        <span class="story-id">${escapeHtml(story.record.recordId)} · ${fmtDate(story.record.date)}</span>
      </article>`).join('') : '<div class="empty-block">暂无名场面数据</div>';
  }

  const RECORD_GROUPS = {
    battle: [
      { key: 'longestByRounds', label: '最长对局', value: (r) => `${fmtNum(r.rounds)} 整轮` },
      { key: 'fastestWinRounds', label: '最快胜利', value: (r) => `${fmtNum(r.rounds)} 整轮` },
      { key: 'longestByEvents', label: '事件最多', value: (r) => `${fmtNum(r.eventCount)} 事件` },
      { key: 'bloodiest', label: '伤亡最多', value: (r) => `${fmtNum(r.value)} 阵亡` },
      { key: 'mostDamage', label: '单场总伤害', value: (r) => `${fmtNum(r.value)} 点` },
      { key: 'longestDuration', label: '现实耗时最长', value: (r) => fmtDur(r.durationSec) },
      { key: 'quickestWin', label: '现实最快胜利', value: (r) => fmtDur(r.durationSec) },
      { key: 'mostActionsPerRound', label: '节奏最密', value: (r) => `${fmtNum(r.value, 1)} 操作/轮` },
    ],
    combat: [
      { key: 'biggestHit', label: '最重一击', value: (r) => `${fmtNum(r.value)} 点${r.killed ? ' · 致命' : ''}` },
      { key: 'singlePlayerKills', label: '单人击杀', value: (r) => `${fmtNum(r.value)} 杀` },
      { key: 'highestHqDamage', label: '总部伤害', value: (r) => `${fmtNum(r.value)} 点` },
      { key: 'biggestScore', label: '单局得分', value: (r) => fmtNum(r.value) },
    ],
    action: [
      { key: 'mostAttacks', label: '攻击最多', value: (r) => `${fmtNum(r.value)} 次` },
      { key: 'mostMoves', label: '移动最多', value: (r) => `${fmtNum(r.value)} 次` },
      { key: 'mostDeploys', label: '部署最多', value: (r) => `${fmtNum(r.value)} 次` },
      { key: 'mostCaptures', label: '占领最多', value: (r) => `${fmtNum(r.value)} 次` },
      { key: 'mostHeals', label: '治疗最多', value: (r) => `${fmtNum(r.value)} 次` },
      { key: 'biggestSpender', label: '单场豪购', value: (r) => `${fmtNum(r.value)} 补给` },
    ],
  };

  function renderRecords() {
    if (!data) return;
    const definitions = RECORD_GROUPS[recordView] || [];
    const rows = definitions.map((definition) => {
      const record = data.extremes?.[definition.key];
      if (!record) return '';
      const detail = [record.mapId, record.winner ? `胜者 ${record.winner}` : '', record.model || ''].filter(Boolean).join(' · ');
      return `
        <div class="record-row">
          <span class="record-kind">${escapeHtml(definition.label)}</span>
          <span class="record-match"><b>${escapeHtml(record.recordId)}</b> · ${fmtDate(record.date)}</span>
          <span class="record-detail" title="${escapeAttr(detail)}">${escapeHtml(detail)}</span>
          <span class="record-value">${escapeHtml(definition.value(record))}</span>
        </div>`;
    }).filter(Boolean);
    el.recordsList.innerHTML = rows.length ? rows.join('') : '<div class="empty-block">暂无纪录</div>';
  }

  function weightedAverage(profiles, key) {
    const totalGames = profiles.reduce((sum, p) => sum + (p.games || 0), 0);
    if (!totalGames) return 0;
    return profiles.reduce((sum, p) => sum + ((p.perGame?.[key] || 0) * (p.games || 0)), 0) / totalGames;
  }

  function modelVerdict(profile, averages) {
    const deltas = BENCHMARKS.map((item) => {
      const value = profile.perGame?.[item.key] || 0;
      const average = averages[item.key] || 0;
      return { ...item, delta: average ? value / average - 1 : 0 };
    }).sort((a, b) => b.delta - a.delta);
    const strongest = deltas[0];
    const weakest = [...deltas].sort((a, b) => a.delta - b.delta)[0];
    const strongText = strongest.delta > 0.08 ? `${strongest.label}比全场均值高 ${pct(strongest.delta)}` : '整体行动接近全场平均';
    const weakText = weakest.delta < -0.08 ? `${weakest.label}则低 ${pct(Math.abs(weakest.delta))}` : '没有明显短板';
    return `${strongText}，${weakText}。这描述的是行为偏好，不代表胜负能力。`;
  }

  function renderModel(profile) {
    if (!data || !profile) return;
    const profiles = data.modelProfiles || [];
    const averages = Object.fromEntries(BENCHMARKS.map((item) => [item.key, weightedAverage(profiles, item.key)]));
    const tags = (profile.styleTags || []).length ? profile.styleTags : ['均衡型'];
    el.modelIdentity.innerHTML = `
      <div class="model-name">${escapeHtml(profile.model)}</div>
      <div class="model-sample">${fmtNum(profile.games)} 场样本 · 击杀 ${fmtNum(profile.kills)} · 阵亡 ${fmtNum(profile.unitDeathsLost)} · 失误 ${fmtNum(profile.failedActions)}</div>
      <div class="model-tags">${tags.map((tag) => `<span class="model-tag">${escapeHtml(tag)}</span>`).join('')}</div>
      <p class="model-verdict">${escapeHtml(modelVerdict(profile, averages))}</p>
      ${profile.games < 5 ? '<span class="sample-warning">样本少于 5 场，结论仅供观察。</span>' : ''}`;

    el.modelBenchmarks.innerHTML = BENCHMARKS.map((item) => {
      const value = profile.perGame?.[item.key] || 0;
      const average = averages[item.key] || 0;
      const max = Math.max(value, average, 1) * 1.18;
      const delta = average ? value / average - 1 : 0;
      return `
        <div class="benchmark-row">
          <span class="benchmark-label">${item.label}</span>
          <div class="benchmark-track">
            <div class="benchmark-fill" style="width:${Math.min(100, (value / max) * 100)}%"></div>
            <span class="benchmark-average" style="left:${Math.min(99, (average / max) * 100)}%" title="均值 ${fmtNum(average, 1)}"></span>
          </div>
          <span class="benchmark-value">${fmtNum(value, 1)}<small>${delta >= 0 ? '+' : ''}${pct(delta)}</small></span>
        </div>`;
    }).join('');
  }

  function renderModelPicker(d) {
    const profiles = d.modelProfiles || [];
    el.modelSelect.innerHTML = profiles.map((profile) => `<option value="${escapeAttr(profile.model)}">${escapeHtml(profile.model)} · ${fmtNum(profile.games)} 场</option>`).join('');
    const initial = profiles.find((profile) => profile.games >= 5) || profiles[0];
    if (initial) {
      el.modelSelect.value = initial.model;
      renderModel(initial);
    }
  }

  function renderGrowth(timeline) {
    if (!timeline.length) {
      el.growthChart.innerHTML = '<div class="empty-block">暂无趋势数据</div>';
      el.growthSummary.textContent = '';
      return;
    }
    const W = 860;
    const H = 220;
    const PAD = { top: 16, right: 12, bottom: 24, left: 8 };
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const n = timeline.length;
    const maxMatches = Math.max(...timeline.map((t) => t.matches), 1);
    const total = timeline[n - 1].cumulativeMatches || 1;
    const x = (i) => PAD.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const yCum = (v) => PAD.top + innerH - (v / total) * innerH;
    const barW = Math.max(2, (innerW / n) * 0.6);
    const bars = timeline.map((t, i) => {
      const h = Math.max(1, (t.matches / maxMatches) * innerH);
      return `<rect x="${(x(i) - barW / 2).toFixed(1)}" y="${(PAD.top + innerH - h).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="rgba(61,155,122,.4)"><title>${t.date} · ${t.matches} 局 / ${fmtNum(t.totalActions)} 次操作</title></rect>`;
    }).join('');
    const pts = timeline.map((t, i) => `${x(i).toFixed(1)},${yCum(t.cumulativeMatches).toFixed(1)}`).join(' ');
    const last = timeline[n - 1];
    const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => {
      const y = PAD.top + innerH * (1 - f);
      return `<line x1="${PAD.left}" y1="${y.toFixed(1)}" x2="${(W - PAD.right).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#243442" stroke-width="1"/>`;
    }).join('');
    const labelIdx = [...new Set([0, Math.floor((n - 1) / 2), n - 1])];
    const labels = labelIdx.map((i) => {
      const t = timeline[i];
      return `<text x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="middle" fill="#5a7484" font-size="10">${t.date.slice(5)}</text>`;
    }).join('');
    el.growthChart.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="对局增长曲线">
        ${grid}
        ${bars}
        <polygon points="${PAD.left},${PAD.top + innerH} ${pts} ${x(n - 1).toFixed(1)},${PAD.top + innerH}" fill="rgba(61,155,122,.12)"/>
        <polyline points="${pts}" fill="none" stroke="#6dcc8a" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        <circle cx="${x(n - 1).toFixed(1)}" cy="${yCum(last.cumulativeMatches).toFixed(1)}" r="3.5" fill="#6dcc8a"/>
        ${labels}
      </svg>`;
    el.growthSummary.textContent = `${fmtDate(timeline[0].date)} 至 ${fmtDate(last.date)}：累计 ${fmtNum(last.cumulativeMatches)} 局、${fmtNum(last.cumulativeActions)} 次操作。峰值日 ${fmtNum(maxMatches)} 局。`;
  }

  function renderDebut(models) {
    if (!models.length) {
      el.debutList.innerHTML = '<div class="empty-block">暂无登场数据</div>';
      return;
    }
    const dNum = (s) => Number(String(s).replace(/-/g, ''));
    const min = dNum(models[0].debutDate);
    const max = Math.max(...models.map((m) => dNum(m.latestDate)), min + 1);
    const span = max - min || 1;
    const newest = models[models.length - 1];
    el.debutList.innerHTML = models.map((m) => {
      const left = ((dNum(m.debutDate) - min) / span) * 100;
      const width = Math.max(2, ((dNum(m.latestDate) - dNum(m.debutDate)) / span) * 100);
      const isNewest = m === newest;
      return `
      <div class="debut-row">
        <span class="debut-name">${escapeHtml(m.model)}${isNewest ? ' <em class="debut-new">新面孔</em>' : ''}</span>
        <div class="debut-track">
          <span class="debut-span" style="left:${left.toFixed(1)}%;width:${width.toFixed(1)}%" title="${m.debutDate} → ${m.latestDate}"></span>
        </div>
        <span class="debut-games">${fmtNum(m.games)} 场 · ${fmtNum(m.wins)} 胜</span>
      </div>`;
    }).join('');
  }

  function renderMonthly(months) {
    el.monthlyGrid.innerHTML = months.length ? months.map((m) => `
      <div class="month-card">
        <strong class="month-name">${escapeHtml(m.month)}</strong>
        <span class="month-matches">${fmtNum(m.matches)} 局</span>
        <span class="month-meta">${fmtNum(m.totalActions)} 操作 · ${m.avgRounds != null ? `${m.avgRounds} 轮/局` : '轮次缺失'} · ${fmtNum(m.activeModels)} 个模型活跃</span>
      </div>`).join('') : '<div class="empty-block">暂无月度数据</div>';
  }

  function renderVersions(versions) {
    el.versionList.innerHTML = versions.length ? versions.map((v) => `
      <span class="version-chip" title="首见于 ${fmtDate(v.firstDate)}">${escapeHtml(v.schemaVersion)}<small>×${fmtNum(v.games)}</small></span>`).join('') : '<div class="empty-block">暂无版本数据</div>';
  }

  function renderTrends(d) {
    renderGrowth(d.timeline || []);
    renderDebut(d.modelDebut || []);
    renderMonthly(d.monthlyTrend || []);
    renderVersions(d.schemaTimeline || []);
  }

  function renderMapStage(d) {
    const stage = d.mapStage || [];
    const maxGames = stage[0]?.games || 1;
    el.mapStage.innerHTML = stage.length ? stage.map((s) => {
      const winners = (s.winnerModels || []).slice(0, 3)
        .map((w) => `${w.model}×${w.wins}`)
        .join(' · ');
      return `<div class="map-row">
        <span class="map-name">${escapeHtml(s.mapId)}</span>
        <div class="map-track"><div class="map-fill" style="width:${Math.max(2, (s.games / maxGames) * 100)}%"></div></div>
        <span class="map-games">${fmtNum(s.games)} 局</span>
        <span class="map-pace">${s.avgRounds != null ? `${fmtNum(s.avgRounds, 1)} 轮/局` : '轮次不全'}</span>
        <span class="map-captures">${fmtNum(s.capturesPerGame, 1)} 占点/局</span>
        ${winners ? `<span class="map-winners">常胜：${escapeHtml(winners)}</span>` : ''}
      </div>`;
    }).join('') : '<div class="empty-block">暂无地图数据</div>';
  }

  function renderAll(d) {
    data = d;
    renderMeta(d);
    renderLead(d);
    renderPulse(d);
    renderMix(d);
    renderPace(d);
    renderMomentum(d);
    renderCombatTable();
    renderUnits(d);
    renderFacts(d);
    renderEconomy(d);
    renderStories(d);
    renderRecords();
    renderModelPicker(d);
    renderTrends(d);
    renderMapStage(d);
    setStatus('已加载', 'ok');
  }

  async function loadData() {
    setStatus('加载中…');
    el.btnReload.disabled = true;
    try {
      const response = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      renderAll(await response.json());
    } catch (error) {
      setStatus(`失败: ${error.message}`, 'err');
      el.leadTitle.textContent = '战报暂时无法读取';
      el.leadSummary.innerHTML = `请先运行 <code>npm run fun-stats</code> 生成数据。（${escapeHtml(error.message)}）`;
    } finally {
      el.btnReload.disabled = false;
    }
  }

  el.btnReload.addEventListener('click', loadData);
  el.modelSelect.addEventListener('change', () => {
    const profile = data?.modelProfiles?.find((item) => item.model === el.modelSelect.value);
    renderModel(profile);
  });
  el.recordTabs.forEach((button) => {
    button.addEventListener('click', () => {
      recordView = button.dataset.recordView;
      el.recordTabs.forEach((tab) => {
        const active = tab === button;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-pressed', String(active));
      });
      renderRecords();
    });
  });
  el.combatTable.querySelector('thead').addEventListener('click', (e) => {
    const th = e.target.closest('th[data-csort]');
    if (!th) return;
    const key = th.dataset.csort;
    if (combatSort.key === key) combatSort.dir = combatSort.dir === 'asc' ? 'desc' : 'asc';
    else combatSort = { key, dir: key === 'model' ? 'asc' : 'desc' };
    renderCombatTable();
  });

  loadData();
})();
