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
    { key: 'attacks', label: '攻击' },
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
    reportTitle: document.getElementById('report-title'),
    reportSummary: document.getElementById('report-summary'),
    generatedAt: document.getElementById('generated-at'),
    sourceCount: document.getElementById('source-count'),
    dateRange: document.getElementById('date-range'),
    loadStatus: document.getElementById('load-status'),
    btnReload: document.getElementById('btn-reload'),
    pulseGrid: document.getElementById('pulse-grid'),
    actionMix: document.getElementById('action-mix'),
    actionMixTotal: document.getElementById('action-mix-total'),
    actionLegend: document.getElementById('action-legend'),
    storyGrid: document.getElementById('story-grid'),
    insightList: document.getElementById('insight-list'),
    unitBars: document.getElementById('unit-bars'),
    modelSelect: document.getElementById('model-select'),
    modelIdentity: document.getElementById('model-identity'),
    modelBenchmarks: document.getElementById('model-benchmarks'),
    economyGrid: document.getElementById('economy-grid'),
    spenderList: document.getElementById('spender-list'),
    rivalryList: document.getElementById('rivalry-list'),
    growthChart: document.getElementById('growth-chart'),
    debutList: document.getElementById('debut-list'),
    monthlyGrid: document.getElementById('monthly-grid'),
    versionList: document.getElementById('version-list'),
    mapStage: document.getElementById('map-stage'),
    recordsList: document.getElementById('records-list'),
    recordTabs: [...document.querySelectorAll('[data-record-view]')],
  };

  let data = null;
  let recordView = 'battle';

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtNum(value, digits = 0) {
    if (value == null || !Number.isFinite(Number(value))) return '-';
    return Number(value).toLocaleString('zh-CN', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function fmtDate(value) {
    const source = String(value || '').replace(/-/g, '');
    if (source.length !== 8) return value || '-';
    return `${source.slice(0, 4)}.${source.slice(4, 6)}.${source.slice(6, 8)}`;
  }

  function pct(value, digits = 0) {
    return `${(Number(value || 0) * 100).toFixed(digits)}%`;
  }

  function totalActions(overview) {
    const totals = overview?.totalActions || {};
    return ACTIONS.reduce((sum, action) => sum + (totals[action.key] || 0), 0);
  }

  function setStatus(text) {
    el.loadStatus.textContent = text;
  }

  function renderLead(d) {
    const ov = d.overview || {};
    const totals = ov.totalActions || {};
    const actions = totalActions(ov);
    const moveShare = actions ? (totals.moves || 0) / actions : 0;
    const attackShare = actions ? (totals.attacks || 0) / actions : 0;
    el.reportTitle.textContent = moveShare >= attackShare
      ? `每两次操作里，就有一次在赶路。`
      : `这片战场，开火比赶路更频繁。`;
    el.reportSummary.textContent = `${fmtNum(ov.matchCount)} 局回放显示，移动与攻击占全部操作的 ${pct(moveShare + attackShare)}。战斗仍是核心，但夺点、治疗和拆除才是区分战术风格的关键。`;
    el.sourceCount.textContent = fmtNum(d.source?.replayCount ?? ov.matchCount);
    el.dateRange.textContent = `${fmtDate(ov.dateMin)} - ${fmtDate(ov.dateMax)}`;
    el.generatedAt.textContent = d.generatedAt ? `更新于 ${d.generatedAt.replace('T', ' ').slice(5, 16)}` : '更新时间未知';
  }

  function renderPulse(d) {
    const ov = d.overview || {};
    const totals = ov.totalActions || {};
    const actions = totalActions(ov);
    const completedRate = ov.matchCount ? ov.completedCount / ov.matchCount : 0;
    const roundSampleCount = (d.timeline || [])
      .filter((day) => Number(day.avgRounds) > 0)
      .reduce((sum, day) => sum + (day.matches || 0), 0);
    const recordedRoundAverage = roundSampleCount ? (totals.rounds || 0) / roundSampleCount : 0;
    const cards = [
      { label: '有效完赛', value: pct(completedRate), note: `${fmtNum(ov.completedCount)} / ${fmtNum(ov.matchCount)} 局形成结果` },
      { label: '每局操作', value: fmtNum(ov.matchCount ? actions / ov.matchCount : 0, 1), note: '移动、攻击、部署、占领等' },
      { label: '每轮操作', value: fmtNum(ov.avgActionsPerRound, 1), note: '整轮内的有效操作密度' },
      { label: '每局阵亡', value: fmtNum(ov.matchCount ? totals.unitDeaths / ov.matchCount : 0, 1), note: '衡量战场交换强度' },
      { label: '平均整轮', value: fmtNum(recordedRoundAverage, 1), note: `${fmtNum(roundSampleCount)} 局具备轮次记录` },
    ];
    el.pulseGrid.innerHTML = cards.map((card) => `
      <div class="pulse-item">
        <span class="pulse-label">${escapeHtml(card.label)}</span>
        <strong class="pulse-value">${escapeHtml(card.value)}</strong>
        <span class="pulse-note">${escapeHtml(card.note)}</span>
      </div>`).join('');

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

  function participantText(record) {
    const participants = record?.participants || [];
    if (!participants.length) return '参赛阵容未记录';
    return participants.map((p) => p.model || p.displayName).filter(Boolean).join(' / ');
  }

  function renderStories(d) {
    const ex = d.extremes || {};
    const stories = [
      {
        label: '最长拉锯', record: ex.longestByRounds,
        title: ex.longestByRounds?.winner ? `${ex.longestByRounds.winner} 熬到最后` : '战到最后一轮',
        metric: `${fmtNum(ex.longestByRounds?.rounds)} 整轮`,
        featured: true,
      },
      {
        label: '最高烈度', record: ex.bloodiest,
        title: '战场伤亡纪录', metric: `${fmtNum(ex.bloodiest?.value)} 个单位阵亡`,
      },
      {
        label: '总部破坏', record: ex.highestHqDamage,
        title: ex.highestHqDamage?.model || '拆迁专家', metric: `${fmtNum(ex.highestHqDamage?.value)} 点 HQ 伤害`,
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
        <span class="story-id">${escapeHtml(story.record.recordId)}</span>
      </article>`).join('') : '<div class="empty-block">暂无名场面数据</div>';
  }

  function weightedAverage(profiles, key) {
    const totalGames = profiles.reduce((sum, p) => sum + (p.games || 0), 0);
    if (!totalGames) return 0;
    return profiles.reduce((sum, p) => sum + ((p.perGame?.[key] || 0) * (p.games || 0)), 0) / totalGames;
  }

  function reliableLeader(profiles, key) {
    const eligible = profiles.filter((p) => (p.games || 0) >= 3);
    return [...eligible].sort((a, b) => (b.perGame?.[key] || 0) - (a.perGame?.[key] || 0))[0];
  }

  function renderInsights(d) {
    const ov = d.overview || {};
    const totals = ov.totalActions || {};
    const actions = totalActions(ov);
    const profiles = d.modelProfiles || [];
    const units = d.unitStats || [];
    const attackLeader = reliableLeader(profiles, 'attacks');
    const healLeader = reliableLeader(profiles, 'heals');
    const mobilityRatio = totals.attacks ? totals.moves / totals.attacks : 0;
    const topTwoUnits = (units[0]?.share || 0) + (units[1]?.share || 0);
    const insights = [
      `<strong>移动是第一大成本。</strong> 每次攻击对应 ${fmtNum(mobilityRatio, 1)} 次移动，走位消耗明显高于正面交火。`,
      `<strong>基础兵种统治部署。</strong> ${escapeHtml(UNIT_LABELS[units[0]?.unitType] || units[0]?.unitType || '前两类单位')}与${escapeHtml(UNIT_LABELS[units[1]?.unitType] || units[1]?.unitType || '次选单位')}合计占 ${pct(topTwoUnits)}，阵容重心非常集中。`,
      attackLeader ? `<strong>${escapeHtml(attackLeader.model)} 的交火最密。</strong> 在至少 3 场的样本中，每局平均攻击 ${fmtNum(attackLeader.perGame.attacks, 1)} 次。` : '<strong>攻击样本不足。</strong> 暂时无法形成可靠的模型对比。',
      healLeader ? `<strong>${escapeHtml(healLeader.model)} 最重视续航。</strong> 每局平均治疗 ${fmtNum(healLeader.perGame.heals, 1)} 次，但治疗仅占全部操作的 ${pct(actions ? totals.heals / actions : 0, 1)}。` : '<strong>治疗仍是稀有动作。</strong> 多数对局没有形成明显续航倾向。',
    ];
    el.insightList.innerHTML = insights.map((item) => `<li><span>${item}</span></li>`).join('');
  }

  function renderUnits(d) {
    const units = d.unitStats || [];
    el.unitBars.innerHTML = units.length ? units.map((unit) => `
      <div class="unit-row">
        <span class="unit-name">${escapeHtml(UNIT_LABELS[unit.unitType] || unit.unitType)}</span>
        <div class="unit-track"><div class="unit-fill" style="width:${Math.max(2, unit.share * 100)}%"></div></div>
        <span class="unit-value">${pct(unit.share)}</span>
      </div>`).join('') : '<div class="empty-block">暂无兵种数据</div>';
  }

  function renderEconomy(d) {
    const ov = d.overview || {};
    const totals = ov.totalActions || {};
    const economy = d.economy || [];
    const rivals = d.eliminations?.rivalries || [];
    const spenders = economy.slice(0, 5);
    const cards = [
      { label: '补给总收入', value: fmtNum(totals.income), note: '基础收入与据点收入之和' },
      { label: '部署总花费', value: fmtNum(totals.deployCost), note: '花在扩充军力上' },
      { label: '补给转化率', value: pct(ov.spendRate), note: '部署花费 / 总收入' },
      { label: '每局净余', value: fmtNum(ov.matchCount ? (totals.income - totals.deployCost) / ov.matchCount : 0, 1), note: '平均每局结余补给' },
    ];
    el.economyGrid.innerHTML = cards.map((card) => `
      <div class="economy-card">
        <span class="economy-label">${escapeHtml(card.label)}</span>
        <strong class="economy-value">${escapeHtml(card.value)}</strong>
        <span class="economy-note">${escapeHtml(card.note)}</span>
      </div>`).join('');

    el.spenderList.innerHTML = spenders.length ? spenders.map((s, i) => `
      <li class="spender-row">
        <span class="spender-rank">${String(i + 1).padStart(2, '0')}</span>
        <span class="spender-model">${escapeHtml(s.model)}</span>
        <span class="spender-bar"><i style="width:${Math.max(3, s.deployCost / (spenders[0].deployCost || 1) * 100)}%"></i></span>
        <span class="spender-value">${fmtNum(s.deployCost)}<small>${pct(s.spendRate)} 转化</small></span>
      </li>`).join('') : '<li class="empty-block">暂无经济数据</li>';

    el.rivalryList.innerHTML = rivals.length ? rivals.map((r) => `
      <li class="rivalry-row">
        <span class="rivalry-models">${escapeHtml(r.a)} <b>vs</b> ${escapeHtml(r.b)}</span>
        <span class="rivalry-score">${r.aKillsB} : ${r.bKillsA}</span>
        <span class="rivalry-total">互相淘汰 ${r.total} 次</span>
      </li>`).join('') : '<li class="rivalry-empty">还没有结下双向的梁子</li>';
  }

  function renderMapStage(d) {
    const stage = d.mapStage || [];
    const maxGames = stage[0]?.games || 1;
    el.mapStage.innerHTML = stage.length ? stage.map((s) => `
      <div class="map-row">
        <span class="map-name">${escapeHtml(s.mapId)}</span>
        <div class="map-track"><div class="map-fill" style="width:${Math.max(2, s.games / maxGames * 100)}%"></div></div>
        <span class="map-games">${fmtNum(s.games)} 局</span>
        <span class="map-pace">${s.avgRounds != null ? `${fmtNum(s.avgRounds, 1)} 轮/局` : '轮次记录不全'}</span>
        <span class="map-captures">${fmtNum(s.capturesPerGame, 1)} 占点/局</span>
      </div>`).join('') : '<div class="empty-block">暂无地图数据</div>';
  }

  function renderGrowth(timeline) {
    if (!timeline.length) {
      el.growthChart.innerHTML = '<div class="empty-block">暂无趋势数据</div>';
      return;
    }
    const W = 760;
    const H = 210;
    const PAD = { top: 16, right: 12, bottom: 24, left: 6 };
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const n = timeline.length;
    const maxMatches = Math.max(...timeline.map((t) => t.matches), 1);
    const total = timeline[n - 1].cumulativeMatches || 1;
    const x = (i) => PAD.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const yCum = (v) => PAD.top + innerH - (v / total) * innerH;
    const barW = Math.max(2, innerW / n * 0.6);
    const bars = timeline.map((t, i) => {
      const h = Math.max(1, (t.matches / maxMatches) * innerH);
      return `<rect x="${(x(i) - barW / 2).toFixed(1)}" y="${(PAD.top + innerH - h).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="rgba(120,214,173,0.26)"><title>${t.date} · ${t.matches} 局 / ${fmtNum(t.totalActions)} 次操作</title></rect>`;
    }).join('');
    const pts = timeline.map((t, i) => `${x(i).toFixed(1)},${yCum(t.cumulativeMatches).toFixed(1)}`).join(' ');
    const last = timeline[n - 1];
    const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => {
      const y = PAD.top + innerH * (1 - f);
      return `<line x1="${PAD.left}" y1="${y.toFixed(1)}" x2="${(W - PAD.right).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#232c30" stroke-width="1"/>`;
    }).join('');
    const labelIdx = [...new Set([0, Math.floor((n - 1) / 2), n - 1])];
    const labels = labelIdx.map((i) => {
      const t = timeline[i];
      return `<text x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="middle" fill="#65747a" font-size="10">${t.date.slice(5)}</text>`;
    }).join('');
    el.growthChart.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="对局增长曲线">
        ${grid}
        ${bars}
        <polygon points="${PAD.left},${PAD.top + innerH} ${pts} ${x(n - 1).toFixed(1)},${PAD.top + innerH}" fill="rgba(120,214,173,0.1)"/>
        <polyline points="${pts}" fill="none" stroke="#78d6ad" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        <circle cx="${x(n - 1).toFixed(1)}" cy="${yCum(last.cumulativeMatches).toFixed(1)}" r="3.5" fill="#78d6ad"/>
        ${labels}
      </svg>
      <div class="growth-summary">${fmtNum(timeline[0].date)} 至 ${fmtNum(last.date)}：累计 ${fmtNum(last.cumulativeMatches)} 局、${fmtNum(last.cumulativeActions)} 次操作。峰值日 ${fmtNum(maxMatches)} 局。</div>`;
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

  function modelVerdict(profile, averages) {
    const deltas = BENCHMARKS.map((item) => {
      const value = profile.perGame?.[item.key] || 0;
      const average = averages[item.key] || 0;
      return { ...item, delta: average ? value / average - 1 : 0 };
    }).sort((a, b) => b.delta - a.delta);
    const strongest = deltas[0];
    const weakest = [...deltas].sort((a, b) => a.delta - b.delta)[0];
    const strongText = strongest.delta > .08 ? `${strongest.label}比全场均值高 ${pct(strongest.delta)}` : '整体行动接近全场平均';
    const weakText = weakest.delta < -.08 ? `${weakest.label}则低 ${pct(Math.abs(weakest.delta))}` : '没有明显短板';
    return `${strongText}，${weakText}。这描述的是行为偏好，不代表胜负能力。`;
  }

  function renderModel(profile) {
    if (!data || !profile) return;
    const profiles = data.modelProfiles || [];
    const averages = Object.fromEntries(BENCHMARKS.map((item) => [item.key, weightedAverage(profiles, item.key)]));
    const tags = (profile.styleTags || []).length ? profile.styleTags : ['均衡型'];
    el.modelIdentity.innerHTML = `
      <div class="model-name">${escapeHtml(profile.model)}</div>
      <div class="model-sample">${fmtNum(profile.games)} 场样本 · ${fmtNum(profile.unitDeathsLost)} 个单位损失</div>
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
            <div class="benchmark-fill" style="width:${Math.min(100, value / max * 100)}%"></div>
            <span class="benchmark-average" style="left:${Math.min(99, average / max * 100)}%" title="均值 ${fmtNum(average, 1)}"></span>
          </div>
          <span class="benchmark-value">${fmtNum(value, 1)}<small>${delta >= 0 ? '+' : ''}${pct(delta)}</small></span>
        </div>`;
    }).join('');
  }

  function renderModelPicker(d) {
    const profiles = d.modelProfiles || [];
    el.modelSelect.innerHTML = profiles.map((profile) => `<option value="${escapeHtml(profile.model)}">${escapeHtml(profile.model)} · ${fmtNum(profile.games)} 场</option>`).join('');
    const initial = profiles.find((profile) => profile.games >= 5) || profiles[0];
    if (initial) {
      el.modelSelect.value = initial.model;
      renderModel(initial);
    }
  }

  const RECORD_GROUPS = {
    battle: [
      { key: 'longestByRounds', label: '最长对局', value: (r) => `${fmtNum(r.rounds)} 整轮` },
      { key: 'shortestByRounds', label: '最速对局', value: (r) => `${fmtNum(r.rounds)} 整轮` },
      { key: 'longestByEvents', label: '事件最多', value: (r) => `${fmtNum(r.eventCount)} 事件` },
      { key: 'bloodiest', label: '伤亡最多', value: (r) => `${fmtNum(r.value)} 阵亡` },
      { key: 'longestDuration', label: '现实耗时', value: (r) => `${fmtNum((r.durationSec || 0) / 3600, 1)} 小时` },
    ],
    action: [
      { key: 'mostAttacks', label: '攻击最多', value: (r) => `${fmtNum(r.value)} 次` },
      { key: 'mostMoves', label: '移动最多', value: (r) => `${fmtNum(r.value)} 次` },
      { key: 'mostDeploys', label: '部署最多', value: (r) => `${fmtNum(r.value)} 次` },
      { key: 'mostCaptures', label: '占领最多', value: (r) => `${fmtNum(r.value)} 次` },
      { key: 'mostHeals', label: '治疗最多', value: (r) => `${fmtNum(r.value)} 次` },
      { key: 'highestHqDamage', label: '总部伤害', value: (r) => `${fmtNum(r.value)} 点` },
      { key: 'biggestScore', label: '单局得分', value: (r) => fmtNum(r.value) },
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
          <span class="record-detail" title="${escapeHtml(detail)}">${escapeHtml(detail)}</span>
          <span class="record-value">${escapeHtml(definition.value(record))}</span>
        </div>`;
    }).filter(Boolean);
    el.recordsList.innerHTML = rows.length ? rows.join('') : '<div class="empty-block">暂无纪录</div>';
  }

  function renderAll(d) {
    data = d;
    renderLead(d);
    renderPulse(d);
    renderStories(d);
    renderInsights(d);
    renderUnits(d);
    renderEconomy(d);
    renderTrends(d);
    renderModelPicker(d);
    renderMapStage(d);
    renderRecords();
    setStatus('数据已加载');
  }

  async function loadData() {
    setStatus('正在加载数据');
    el.btnReload.disabled = true;
    try {
      const response = await fetch(`${DATA_URL}?t=${Date.now()}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      renderAll(await response.json());
    } catch (error) {
      setStatus('数据加载失败');
      el.reportTitle.textContent = '战报暂时无法读取';
      el.reportSummary.innerHTML = `请先运行 <code>npm run fun-stats</code> 生成数据。${escapeHtml(error.message)}`;
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
  document.addEventListener('DOMContentLoaded', loadData);
})();
