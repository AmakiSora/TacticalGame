// 局内规则速查：弹层内容完全由当前对局内嵌配置（game_start 事件的 config）驱动，
// 因此进行中对局与历史回放各自显示当时生效的数值，永远不会过时。
// 玩家页（play.js / play-m.js）与观战页（app.js / spectator-m.js）共用。
(() => {
  const MODE_LABELS = { standard: '标准（逐人轮流）', annihilation: '歼灭（炮火收缩）', simultaneous: '同时回合（秘密计划）', royale: '大逃杀（同时 × 缩圈）' };
  const UNIT_NAMES = { infantry: '步兵', scout: '侦察兵', heavy: '重装', ranger: '远程兵', support: '支援兵' };
  const CP_KIND_NAMES = { supply: '补给站', forward_base: '前线基地', repair: '维修站' };
  const SHAPE_NAMES = { single: '单格', line: '直线', arc: '扇形三格' };
  const WEIGHT_LABELS = [
    ['enemyHqDamage', '敌方总部伤害'],
    ['ownHqHp', '己方总部血量'],
    ['controlPoint', '占领据点'],
    ['armyValue', '存活兵力'],
    ['supplies', '囤积补给'],
    ['effectiveActions', '有效行动'],
    ['actionPoints', '行动点'],
  ];

  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function shapeLabel(shape, range) {
    if (!shape) return `单格（射程 ${range}）`;
    if (shape.type === 'line') return `直线 ${shape.length ?? 2} 格`;
    if (shape.type === 'arc') return '扇形 3 格';
    return `单格（射程 ${range}）`;
  }

  function unitSpecial(spec) {
    const tags = [];
    if (spec?.canCapture) tags.push('可占点');
    if (spec?.attackLock) tags.push('锁定目标');
    return tags.join(' · ');
  }

  function unitRow(type, spec, config) {
    const mode = config?.mode;
    const simultaneous = mode === 'simultaneous' || mode === 'royale';
    const attackCol = simultaneous ? shapeLabel(spec?.attackShape, spec?.attackRange) : `单格（射程 ${spec?.attackRange ?? '—'}）`;
    const healCol = spec?.healPower != null
      ? `+${spec.healPower}${simultaneous ? ` · ${shapeLabel(spec?.healShape, spec?.healRange ?? spec?.attackRange)}` : ''}`
      : '—';
    return `<tr>
      <td>${esc(UNIT_NAMES[type] || type)}</td>
      <td>${esc(spec?.hp ?? '—')}</td>
      <td>${esc(spec?.attack ?? '—')}</td>
      <td>${esc(spec?.defense ?? '—')}</td>
      <td>${esc(spec?.moveRange ?? '—')}</td>
      <td>${esc(attackCol)}</td>
      <td>${esc(healCol)}</td>
      <td>${esc(spec?.cost ?? '—')}</td>
      <td>${esc(unitSpecial(spec) || '—')}</td>
    </tr>`;
  }

  function balanceChips(config) {
    const balance = config?.balance || {};
    const maxTurns = balance.maxTurns === null ? '∞' : balance.maxTurns ?? '—';
    const hqSpec = config?.headquartersSpec;
    const chips = [
      ['行动点/回合', balance.actionsPerTurn ?? '—'],
      ['回合上限', maxTurns],
      ['起始补给', balance.startingSupplies ?? '—'],
      ['基础收入', balance.baseIncome ?? '—'],
      ['伤害浮动', `±${balance.damageVarianceRange ?? 0}`],
      ['最低伤害', balance.minimumDamage ?? '—'],
      ['治疗浮动', `+0~${balance.healVarianceRange ?? 0}`],
    ];
    if (config?.mode !== 'annihilation' && config?.mode !== 'royale' && hqSpec) {
      chips.push(['总部', `${hqSpec.hp} 血 / 防 ${hqSpec.defense}`]);
    }
    if (balance.deployFromHq === false) chips.push(['部署', '总部不可部署']);
    return chips.map(([label, value]) => `<span class="rs-chip" data-label="${esc(label)}"><b>${esc(value)}</b>${esc(label)}</span>`).join('');
  }

  function controlPointRows(config) {
    const types = config?.balance?.controlPointTypes || {};
    const rows = Object.entries(types).map(([kind, spec]) => `<tr>
      <td>${esc(CP_KIND_NAMES[kind] || kind)}</td>
      <td>+${esc(spec?.income ?? 0)}</td>
      <td>${spec?.deployDiscount ? `-${esc(spec.deployDiscount)}` : '—'}</td>
      <td>${spec?.repairAmount ? `+${esc(spec.repairAmount)}` : '—'}</td>
      <td>${spec?.canDeploy === false ? '不可部署' : '可部署'}</td>
    </tr>`).join('');
    return rows || '<tr><td colspan="5" class="rs-empty">本图无类型化据点</td></tr>';
  }

  function modeSection(config) {
    const mode = config?.mode;
    if ((mode === 'annihilation' || mode === 'royale') && config?.annihilation?.artillery) {
      const a = config.annihilation.artillery;
      return `<div class="rs-note">炮火规则：第 ${esc(a.startRound)} 轮起每 ${esc(a.intervalRounds)} 轮收缩一圈，危险区每轮 ${esc(a.damage)} 点无视防御伤害，最终安全半径 ${esc(a.minimumSafeRadius)}；危险区内禁止部署、治疗与据点维修。${mode === 'royale' ? '大逃杀无总部，兵力打光即淘汰。' : ''}</div>`;
    }
    if (mode === 'simultaneous' || mode === 'royale') {
      return '<div class="rs-note">同时回合：指令入队不执行、可撤销；全员确认后服务器严格同时结算。攻击/治疗改为瞄准格子/方向，按覆盖形状结算；每单位每回合仅一个动作；跨玩家移动/部署指向同一格时全部失败。</div>';
    }
    return '<div class="rs-note">逐人轮流：轮到你的回合时操作；首次操作一个单位消耗 1 行动点，同单位本回合后续动作免费；步兵/侦察兵站上据点并结束回合即占领。摧毁所有敌方总部获胜。</div>';
  }

  function adjudicationRows(config) {
    const weights = config?.balance?.adjudicationWeights || {};
    const rows = WEIGHT_LABELS
      .map(([key, label]) => ({ label, weight: Number(weights[key]) || 0 }))
      .filter(row => row.weight > 0)
      .map(row => `<span class="rs-chip"><b>×${esc(row.weight)}</b>${esc(row.label)}</span>`);
    return rows.length ? rows.join('') : '<span class="rs-empty">本图未配置裁决权重</span>';
  }

  function buildHtml(config) {
    if (!config) return '<div class="rs-empty">进入对局后可查看本局生效的规则与数值</div>';
    const mode = config.mode || 'standard';
    const unitRows = Object.entries(config.units || {}).map(([type, spec]) => unitRow(type, spec, config)).join('');
    return `<div class="rs-block">
      <div class="rs-mode-row"><span class="rs-mode-badge">${esc(MODE_LABELS[mode] || mode)}</span></div>
      ${modeSection(config)}
    </div>
    <div class="rs-block"><h4>兵种数值（本图配置）</h4>
      <div class="rs-table-wrap"><table class="rs-table">
        <thead><tr><th>兵种</th><th>生命</th><th>攻击</th><th>防御</th><th>移动</th><th>攻击覆盖</th><th>治疗</th><th>费用</th><th>特性</th></tr></thead>
        <tbody>${unitRows}</tbody>
      </table></div>
    </div>
    <div class="rs-block"><h4>平衡参数</h4><div class="rs-chips">${balanceChips(config)}</div></div>
    <div class="rs-block"><h4>据点类型</h4>
      <div class="rs-table-wrap"><table class="rs-table">
        <thead><tr><th>类型</th><th>收入</th><th>部署折扣</th><th>维修</th><th>部署入口</th></tr></thead>
        <tbody>${controlPointRows(config)}</tbody>
      </table></div>
    </div>
    <div class="rs-block"><h4>裁决权重</h4><div class="rs-chips">${adjudicationRows(config)}</div></div>`;
  }

  // 挂载一个弹层：triggerEl 按钮开关，getConfig 返回当前对局配置（可为 null）。
  // 返回 { open, close, refresh }；同一页面可安全调用多次。
  function attach({ triggerEl, getConfig }) {
    if (!triggerEl) return { open() {}, close() {}, refresh() {} };
    const backdrop = document.createElement('div');
    backdrop.className = 'rs-backdrop';
    backdrop.style.display = 'none';
    const panel = document.createElement('div');
    panel.className = 'rs-panel';
    panel.style.display = 'none';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', '本局规则速查');
    panel.innerHTML = `<div class="rs-head">
      <h3>本局规则速查</h3>
      <button type="button" class="rs-close" aria-label="关闭">✕</button>
    </div>
    <div class="rs-body"></div>`;
    document.body.appendChild(backdrop);
    document.body.appendChild(panel);
    const body = panel.querySelector('.rs-body');

    function refresh() {
      body.innerHTML = buildHtml(getConfig?.() ?? null);
    }
    function isOpen() { return panel.style.display !== 'none'; }
    function open() {
      refresh();
      backdrop.style.display = '';
      panel.style.display = '';
    }
    function close() {
      backdrop.style.display = 'none';
      panel.style.display = 'none';
    }
    triggerEl.addEventListener('click', () => {
      if (isOpen()) close();
      else open();
    });
    backdrop.addEventListener('click', close);
    panel.querySelector('.rs-close').addEventListener('click', close);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && isOpen()) {
        e.stopPropagation();
        close();
      }
    });
    return { open, close, refresh };
  }

  window.RulesSheet = { attach, buildHtml };
})();
