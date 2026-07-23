/* Static stats dashboard — reads /data/stats.json only. */
(() => {
  const DATA_URL = '/data/stats.json';

  const el = {
    generatedAt: document.getElementById('generated-at'),
    sourceCount: document.getElementById('source-count'),
    dateRange: document.getElementById('date-range'),
    loadStatus: document.getElementById('load-status'),
    btnReload: document.getElementById('btn-reload'),
    kpiGrid: document.getElementById('kpi-grid'),
    filterVersion: document.getElementById('filter-version'),
    filterMap: document.getElementById('filter-map'),
    filterPlayers: document.getElementById('filter-players'),
    filterModel: document.getElementById('filter-model'),
    filterSearch: document.getElementById('filter-search'),
    btnReset: document.getElementById('btn-reset-filters'),
    modelTable: document.getElementById('model-table'),
    agentTable: document.getElementById('agent-table'),
    matchupTitle: document.getElementById('matchup-title'),
    matchupBody: document.getElementById('matchup-body'),
    mapBars: document.getElementById('map-bars'),
    reasonBars: document.getElementById('reason-bars'),
    matchTable: document.getElementById('match-table'),
    matchCountLabel: document.getElementById('match-count-label'),
  };

  /** @type {any} */
  let raw = null;
  /** @type {any[]} */
  let filteredMatches = [];
  let selectedModel = null;
  let modelSort = { key: 'rating', dir: 'desc' };
  let matchSort = { key: 'date', dir: 'desc' };

  const REASON_LABELS = {
    last_player_standing: '最后生还',
    turn_limit_score: '轮数裁决',
    turn_limit_draw: '轮数平局',
    headquarters_destroyed: '摧毁总部',
    incomplete: '未完赛',
    unknown: '未知',
  };

  function pct(n) {
    if (n == null || Number.isNaN(n)) return '—';
    return `${(n * 100).toFixed(1)}%`;
  }

  function fmtNum(n, digits = 1) {
    if (n == null || Number.isNaN(n)) return '—';
    return Number(n).toFixed(digits).replace(/\.0$/, '');
  }

  function fmtDate(yyyymmdd) {
    if (!yyyymmdd || String(yyyymmdd).length !== 8) return yyyymmdd || '—';
    const s = String(yyyymmdd);
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }

  function setStatus(text, kind) {
    el.loadStatus.textContent = text;
    el.loadStatus.classList.remove('ok', 'err');
    if (kind) el.loadStatus.classList.add(kind);
  }

  function wilsonLower(wins, n) {
    if (n <= 0) return 0;
    const z = 1.96;
    const p = wins / n;
    const z2 = z * z;
    const denom = 1 + z2 / n;
    const centre = p + z2 / (2 * n);
    const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
    return (centre - margin) / denom;
  }

  function getFilters() {
    return {
      version: el.filterVersion.value,
      map: el.filterMap.value,
      players: el.filterPlayers.value,
      model: el.filterModel.value,
      search: el.filterSearch.value.trim().toLowerCase(),
    };
  }

  function matchPasses(m, f) {
    if (f.version && m.version !== f.version) return false;
    if (f.map && m.mapId !== f.map) return false;
    if (f.players && String(m.playerCount) !== f.players) return false;
    if (f.model) {
      const hit = (m.participants || []).some(p => p.model === f.model);
      if (!hit) return false;
    }
    if (f.search) {
      const hay = [
        m.recordId,
        m.gameId,
        m.mapId,
        m.reason,
        m.fileName,
        ...(m.participants || []).flatMap(p => [p.model, p.agent, p.displayName, p.playerId]),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(f.search)) return false;
    }
    return true;
  }

  function recomputeFromMatches(matches) {
    const models = new Map();
    const agents = new Map();
    const mapDist = {};
    const reasonDist = {};
    let completed = 0;
    let roundsSum = 0;

    function emptyModel(model) {
      return {
        model,
        games: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        top3: 0,
        rankSum: 0,
        rankCount: 0,
        scoreSum: 0,
        scoreCount: 0,
        hqDamageSum: 0,
        hqDamageCount: 0,
        agents: {},
        vs: {},
        recent: [],
      };
    }

    for (const m of matches) {
      mapDist[m.mapId] = (mapDist[m.mapId] || 0) + 1;
      reasonDist[m.reason] = (reasonDist[m.reason] || 0) + 1;
      if (m.completed) completed += 1;
      roundsSum += m.rounds || 0;

      const parts = m.participants || [];
      for (const p of parts) {
        if (!models.has(p.model)) models.set(p.model, emptyModel(p.model));
        const b = models.get(p.model);
        b.games += 1;
        b.agents[p.agent] = (b.agents[p.agent] || 0) + 1;
        b.recent.push(m.recordId);
        if (b.recent.length > 8) b.recent.shift();

        const isDraw = m.reason === 'turn_limit_draw' || m.reviewFlags?.deadlock;
        if (isDraw) b.draws += 1;
        else if (p.isWinner || p.rank === 1) b.wins += 1;
        else if (p.rank != null || m.completed) b.losses += 1;

        if (p.rank != null && p.rank <= 3) b.top3 += 1;
        if (p.rank != null) {
          b.rankSum += p.rank;
          b.rankCount += 1;
        }
        if (p.scoreTotal != null) {
          b.scoreSum += p.scoreTotal;
          b.scoreCount += 1;
        }
        if (p.headquartersDamage != null) {
          b.hqDamageSum += p.headquartersDamage;
          b.hqDamageCount += 1;
        }

        if (!agents.has(p.agent)) {
          agents.set(p.agent, { agent: p.agent, games: 0, wins: 0, models: {} });
        }
        const ag = agents.get(p.agent);
        ag.games += 1;
        if (p.isWinner || p.rank === 1) ag.wins += 1;
        ag.models[p.model] = (ag.models[p.model] || 0) + 1;

        for (const opp of parts) {
          if (opp.playerId === p.playerId) continue;
          if (!b.vs[opp.model]) b.vs[opp.model] = { games: 0, wins: 0 };
          b.vs[opp.model].games += 1;
          if ((p.isWinner || p.rank === 1) && !(opp.isWinner || opp.rank === 1)) {
            b.vs[opp.model].wins += 1;
          } else if (p.rank != null && opp.rank != null && p.rank < opp.rank) {
            b.vs[opp.model].wins += 1;
          }
        }
      }
    }

    const modelLeaderboard = [...models.values()]
      .map(b => {
        const winRate = b.games > 0 ? b.wins / b.games : 0;
        const top3Rate = b.games > 0 ? b.top3 / b.games : 0;
        const avgRank = b.rankCount > 0 ? b.rankSum / b.rankCount : null;
        const avgScore = b.scoreCount > 0 ? b.scoreSum / b.scoreCount : null;
        const avgHqDamage = b.hqDamageCount > 0 ? b.hqDamageSum / b.hqDamageCount : null;
        return {
          model: b.model,
          games: b.games,
          wins: b.wins,
          losses: b.losses,
          draws: b.draws,
          top3: b.top3,
          winRate,
          top3Rate,
          avgRank,
          avgScore,
          avgHqDamage,
          rating: wilsonLower(b.wins, b.games),
          agents: b.agents,
          vs: b.vs,
          recent: b.recent,
        };
      })
      .sort((a, b) => b.rating - a.rating || b.wins - a.wins || b.games - a.games)
      .map((row, i) => ({ rank: i + 1, ...row }));

    const agentLeaderboard = [...agents.values()]
      .map(a => ({
        agent: a.agent,
        games: a.games,
        wins: a.wins,
        winRate: a.games > 0 ? a.wins / a.games : 0,
        models: a.models,
      }))
      .sort((a, b) => b.wins - a.wins || b.games - a.games);

    return {
      overview: {
        matchCount: matches.length,
        completedCount: completed,
        incompleteCount: matches.length - completed,
        mapDist,
        reasonDist,
        avgRounds: matches.length ? roundsSum / matches.length : 0,
        modelCount: modelLeaderboard.length,
      },
      modelLeaderboard,
      agentLeaderboard,
    };
  }

  function topAgents(agentMap, limit = 3) {
    return Object.entries(agentMap || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([k, v]) => `${k}×${v}`)
      .join(' ');
  }

  function sortRows(rows, sort) {
    const { key, dir } = sort;
    const mul = dir === 'asc' ? 1 : -1;
    return rows.slice().sort((a, b) => {
      let av = a[key];
      let bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string' && typeof bv === 'string') {
        return av.localeCompare(bv) * mul;
      }
      return (av - bv) * mul;
    });
  }

  function renderKpis(overview, sourceOverview) {
    const cards = [
      { label: '筛选局数', value: overview.matchCount, sub: `全量 ${sourceOverview?.matchCount ?? '—'}` },
      { label: '完赛', value: overview.completedCount, sub: `未完赛 ${overview.incompleteCount}` },
      { label: '模型数', value: overview.modelCount, sub: '当前筛选' },
      { label: '平均整轮', value: fmtNum(overview.avgRounds, 2), sub: 'round_end 计数' },
      {
        label: '全量事件',
        value: sourceOverview?.totalEvents ?? '—',
        sub: `V2 ${sourceOverview?.versionDist?.V2 ?? 0} / V3 ${sourceOverview?.versionDist?.V3 ?? 0}`,
      },
      {
        label: '日期跨度',
        value: sourceOverview?.dateMin ? `${fmtDate(sourceOverview.dateMin).slice(5)}` : '—',
        sub: sourceOverview?.dateMax ? `→ ${fmtDate(sourceOverview.dateMax)}` : '',
      },
    ];
    el.kpiGrid.innerHTML = cards
      .map(
        c => `<article class="kpi-card">
        <div class="label">${c.label}</div>
        <div class="value">${c.value}</div>
        <div class="sub">${c.sub || ''}</div>
      </article>`,
      )
      .join('');
  }

  function renderBars(container, dist) {
    const entries = Object.entries(dist || {}).sort((a, b) => b[1] - a[1]);
    if (!entries.length) {
      container.innerHTML = `<div class="empty-block">无数据</div>`;
      return;
    }
    const max = Math.max(...entries.map(e => e[1]), 1);
    container.innerHTML = entries
      .map(([name, count]) => {
        const label = REASON_LABELS[name] || name;
        const w = Math.round((count / max) * 100);
        return `<div class="bar-row">
          <div class="name" title="${name}">${label}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${w}%"></div></div>
          <div class="count">${count}</div>
        </div>`;
      })
      .join('');
  }

  function renderModelTable(rows) {
    const sorted = sortRows(rows, modelSort).map((row, i) =>
      modelSort.key === 'rating' && modelSort.dir === 'desc' ? row : { ...row, rank: i + 1 },
    );
    // keep original rank from rating sort when default; otherwise show position in current sort
    const body = el.modelTable.querySelector('tbody');
    body.innerHTML = sorted
      .map(r => {
        const selected = selectedModel === r.model ? 'selected' : '';
        return `<tr data-model="${escapeAttr(r.model)}" class="${selected}">
          <td class="num">${r.rank}</td>
          <td class="model-name">${escapeHtml(r.model)}</td>
          <td class="num">${r.games}</td>
          <td class="num win">${r.wins}</td>
          <td class="num loss">${r.losses}</td>
          <td class="num">${r.draws}</td>
          <td class="num"><span class="pill-rate">${pct(r.winRate)}</span></td>
          <td class="num">${pct(r.top3Rate)}</td>
          <td class="num">${r.avgRank == null ? '—' : fmtNum(r.avgRank, 2)}</td>
          <td class="num">${r.avgScore == null ? '—' : fmtNum(r.avgScore, 0)}</td>
          <td class="num">${r.avgHqDamage == null ? '—' : fmtNum(r.avgHqDamage, 0)}</td>
          <td class="num">${fmtNum(r.rating, 3)}</td>
          <td class="muted">${escapeHtml(topAgents(r.agents))}</td>
        </tr>`;
      })
      .join('');

    el.modelTable.querySelectorAll('th[data-sort]').forEach(th => {
      th.classList.toggle('sorted', th.dataset.sort === modelSort.key);
    });
  }

  function renderAgentTable(rows) {
    const body = el.agentTable.querySelector('tbody');
    body.innerHTML = rows
      .map(a => {
        const models = Object.entries(a.models || {})
          .sort((x, y) => y[1] - x[1])
          .slice(0, 4)
          .map(([m, c]) => `<span class="tag">${escapeHtml(m)}×${c}</span>`)
          .join('');
        return `<tr>
          <td><strong>${escapeHtml(a.agent)}</strong></td>
          <td class="num">${a.games}</td>
          <td class="num win">${a.wins}</td>
          <td class="num">${pct(a.winRate)}</td>
          <td>${models}</td>
        </tr>`;
      })
      .join('');
  }

  function renderMatchup(model, leaderboard) {
    if (!model) {
      el.matchupTitle.textContent = '选择模型查看';
      el.matchupBody.className = 'empty-block';
      el.matchupBody.textContent = '点击上方模型行';
      return;
    }
    const row = leaderboard.find(r => r.model === model);
    if (!row) {
      el.matchupTitle.textContent = model;
      el.matchupBody.className = 'empty-block';
      el.matchupBody.textContent = '当前筛选下无该模型';
      return;
    }
    el.matchupTitle.textContent = `${model} · 近期 ${row.recent?.join(', ') || '—'}`;
    const vs = Object.entries(row.vs || {})
      .map(([opp, s]) => ({
        opp,
        games: s.games,
        wins: s.wins,
        wr: s.games > 0 ? s.wins / s.games : 0,
      }))
      .sort((a, b) => b.games - a.games || b.wr - a.wr);

    if (!vs.length) {
      el.matchupBody.className = 'empty-block';
      el.matchupBody.textContent = '无对位数据';
      return;
    }

    el.matchupBody.className = 'table-wrap';
    el.matchupBody.innerHTML = `<table class="matchup-table">
      <thead><tr><th>对手模型</th><th class="num">交手</th><th class="num">占优</th><th class="num">占优率</th></tr></thead>
      <tbody>
        ${vs
          .map(
            v => `<tr>
            <td>${escapeHtml(v.opp)}</td>
            <td class="num">${v.games}</td>
            <td class="num">${v.wins}</td>
            <td class="num">${pct(v.wr)}</td>
          </tr>`,
          )
          .join('')}
      </tbody>
    </table>
    <p class="hint" style="padding:8px 4px 0">「占优」= 自己获胜，或多人局中名次高于该对手。</p>`;
  }

  function renderMatches(matches) {
    const sorted = sortRows(matches, matchSort);
    el.matchCountLabel.textContent = `${sorted.length} 局`;
    const body = el.matchTable.querySelector('tbody');
    body.innerHTML = sorted
      .map(m => {
        const chips = (m.participants || [])
          .slice()
          .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
          .map(p => {
            const cls = p.isWinner || p.rank === 1 ? 'chip winner' : 'chip';
            const rk = p.rank != null ? `#${p.rank}` : '';
            return `<span class="${cls}" title="${escapeAttr(p.displayName)}"><span class="rk">${rk}</span>${escapeHtml(p.model)}<span class="rk">${escapeHtml(p.agent)}</span></span>`;
          })
          .join('');
        const winnerPart = (m.participants || []).find(p => p.isWinner || p.rank === 1);
        const winnerLabel = winnerPart
          ? `${winnerPart.model} (${winnerPart.agent})`
          : m.winner || '—';
        return `<tr>
          <td><strong>${escapeHtml(m.recordId)}</strong></td>
          <td>${fmtDate(m.date)}</td>
          <td>${escapeHtml(m.version)}</td>
          <td>${escapeHtml(m.mapId)}</td>
          <td class="num">${m.playerCount}</td>
          <td><div class="participant-chips">${chips}</div></td>
          <td class="win">${escapeHtml(winnerLabel)}</td>
          <td>${escapeHtml(REASON_LABELS[m.reason] || m.reason || '—')}</td>
          <td class="num">${m.rounds ?? '—'}</td>
          <td class="muted">${escapeHtml(m.schemaVersion || '—')}</td>
        </tr>`;
      })
      .join('');

    el.matchTable.querySelectorAll('th[data-msort]').forEach(th => {
      th.classList.toggle('sorted', th.dataset.msort === matchSort.key);
    });
  }

  function fillFilterOptions(allMatches) {
    const maps = [...new Set(allMatches.map(m => m.mapId).filter(Boolean))].sort();
    const players = [...new Set(allMatches.map(m => m.playerCount).filter(Boolean))].sort(
      (a, b) => a - b,
    );
    const models = [
      ...new Set(allMatches.flatMap(m => (m.participants || []).map(p => p.model))),
    ].sort();

    const keep = (select, items, allLabel = '全部') => {
      const cur = select.value;
      select.innerHTML =
        `<option value="">${allLabel}</option>` +
        items.map(v => `<option value="${escapeAttr(String(v))}">${escapeHtml(String(v))}</option>`).join('');
      if ([...select.options].some(o => o.value === cur)) select.value = cur;
    };

    keep(el.filterMap, maps);
    keep(el.filterPlayers, players);
    keep(el.filterModel, models);
  }

  function applyAndRender() {
    if (!raw) return;
    const f = getFilters();
    filteredMatches = (raw.matches || []).filter(m => matchPasses(m, f));
    const agg = recomputeFromMatches(filteredMatches);
    renderKpis(agg.overview, raw.overview);
    renderModelTable(agg.modelLeaderboard);
    renderAgentTable(agg.agentLeaderboard);
    renderBars(el.mapBars, agg.overview.mapDist);
    renderBars(el.reasonBars, agg.overview.reasonDist);
    renderMatchup(selectedModel, agg.modelLeaderboard);
    renderMatches(filteredMatches);
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

  async function loadData() {
    setStatus('加载中…');
    try {
      const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      raw = await res.json();
      el.generatedAt.textContent = raw.generatedAt
        ? new Date(raw.generatedAt).toLocaleString()
        : '—';
      el.sourceCount.textContent = String(raw.source?.replayCount ?? raw.matches?.length ?? 0);
      el.dateRange.textContent =
        raw.overview?.dateMin && raw.overview?.dateMax
          ? `${fmtDate(raw.overview.dateMin)} → ${fmtDate(raw.overview.dateMax)}`
          : '—';
      fillFilterOptions(raw.matches || []);
      setStatus('已加载', 'ok');
      applyAndRender();
    } catch (err) {
      console.error(err);
      setStatus(`失败: ${err.message}`, 'err');
      el.kpiGrid.innerHTML = '';
      el.matchupBody.className = 'empty-block';
      el.matchupBody.textContent =
        '无法读取 /data/stats.json。请先运行 npm run stats 生成数据。';
    }
  }

  // events
  el.btnReload.addEventListener('click', () => loadData());
  el.btnReset.addEventListener('click', () => {
    el.filterVersion.value = '';
    el.filterMap.value = '';
    el.filterPlayers.value = '';
    el.filterModel.value = '';
    el.filterSearch.value = '';
    selectedModel = null;
    applyAndRender();
  });
  for (const node of [
    el.filterVersion,
    el.filterMap,
    el.filterPlayers,
    el.filterModel,
    el.filterSearch,
  ]) {
    node.addEventListener('input', () => applyAndRender());
    node.addEventListener('change', () => applyAndRender());
  }

  el.modelTable.querySelector('thead').addEventListener('click', e => {
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    const key = th.dataset.sort;
    if (modelSort.key === key) modelSort.dir = modelSort.dir === 'asc' ? 'desc' : 'asc';
    else {
      modelSort.key = key;
      modelSort.dir = key === 'model' ? 'asc' : 'desc';
    }
    applyAndRender();
  });

  el.modelTable.querySelector('tbody').addEventListener('click', e => {
    const tr = e.target.closest('tr[data-model]');
    if (!tr) return;
    const model = tr.dataset.model;
    selectedModel = selectedModel === model ? null : model;
    applyAndRender();
  });

  el.matchTable.querySelector('thead').addEventListener('click', e => {
    const th = e.target.closest('th[data-msort]');
    if (!th) return;
    const key = th.dataset.msort;
    if (matchSort.key === key) matchSort.dir = matchSort.dir === 'asc' ? 'desc' : 'asc';
    else {
      matchSort.key = key;
      matchSort.dir = key === 'recordId' || key === 'mapId' || key === 'reason' ? 'asc' : 'desc';
    }
    applyAndRender();
  });

  loadData();
})();
