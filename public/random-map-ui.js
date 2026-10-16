// public/random-map-ui.js
// 随机地图创建面板：桌面端与移动端共用。参数支持「随机区间 / 固定值 / 留空用服务端默认」三种填法。
(function () {
  'use strict';

  const RANDOM_MAP_ID = 'random';

  // 模式相关的参数适配：条目不带 modes 字段＝全模式适用。
  // 歼灭系（annihilation/royale）不建总部（src/state/store.ts 按 isAnnihilationMode 分支），
  // 故总部参数无意义；炮火（annihilation.artillery）只在歼灭系注入，故其余模式无此参数。
  const ARTILLERY_MODES = ['annihilation', 'royale'];
  const HEADQUARTERS_MODES = ['standard', 'simultaneous'];

  // min/max = 服务端硬边界（src/config/randomMap.ts 的 PARAM_BOUNDS，滑块量程），
  // defMin/defMax = 留空时服务端使用的默认区间（仅作提示与"默认态"回显）。
  // 两份数值由 tests/public/random-map-bounds.test.ts 对齐校验，避免前后端漂移。
  const PARAMS = [
    { key: 'radius', label: '地图半径', step: 1, min: 4, max: 12, defMin: 5, defMax: 10 },
    { key: 'waterDensity', label: '水域密度', step: 0.01, min: 0, max: 0.4, defMin: 0.01, defMax: 0.07 },
    { key: 'wallDensity', label: '阻挡密度', step: 0.01, min: 0, max: 0.4, defMin: 0.01, defMax: 0.05 },
    { key: 'controlPointCount', label: '据点数量', step: 1, min: 1, max: 9, defMin: 2, defMax: 6 },
    { key: 'maxTurns', label: '最大回合数', step: 1, min: 1, max: 99, defMin: 10, defMax: 30 },
    { key: 'actionsPerTurn', label: '每回合行动点', step: 1, min: 1, max: 20, defMin: 1, defMax: 8 },
    { key: 'unitStatVariation', label: '兵种数值浮动', step: 0.05, min: 0, max: 0.5, defMin: 0, defMax: 0.25 },
    { key: 'startingSupplies', label: '初始补给', step: 5, min: 0, max: 9999, defMin: 20, defMax: 220 },
    { key: 'baseIncome', label: '基础收入', step: 1, min: 0, max: 999, defMin: 6, defMax: 14 },
    { key: 'headquartersHp', label: '总部血量', step: 10, min: 1, max: 9999, defMin: 80, defMax: 240, modes: HEADQUARTERS_MODES },
    { key: 'headquartersDefense', label: '总部防御', step: 1, min: 0, max: 99, defMin: 3, defMax: 10, modes: HEADQUARTERS_MODES },
    { key: 'artilleryStartRound', label: '炮击开始回合', step: 1, min: 1, max: 10, defMin: 3, defMax: 8, modes: ARTILLERY_MODES },
    { key: 'artilleryIntervalRounds', label: '炮击间隔', step: 1, min: 1, max: 3, defMin: 1, defMax: 2, modes: ARTILLERY_MODES },
    { key: 'artilleryDamage', label: '炮击伤害', step: 1, min: 5, max: 30, defMin: 10, defMax: 25, modes: ARTILLERY_MODES },
    { key: 'artilleryMinimumSafeRadius', label: '安全区最小半径', step: 1, min: 0, max: 3, defMin: 0, defMax: 1, modes: ARTILLERY_MODES },
  ];

  // 模式取值与后端 GameMode 一一对应：每个模式只出现一次，不再保留「空值＝服务端默认标准」
  // 的第二条标准项——两个选项指向同一模式会让用户以为有什么区别。
  const GAME_MODES = [
    { value: 'standard', label: '标准' },
    { value: 'annihilation', label: '歼灭（炮火缩圈）' },
    { value: 'simultaneous', label: '同时回合' },
    { value: 'royale', label: '大逃杀（同时×缩圈）' },
  ];

  const MODE_HINTS = {
    standard: '标准：逐人轮流，摧毁总部或按裁决分收尾；无炮火参数。',
    annihilation: '歼灭：不建总部（无总部参数），出生即据点，炮火逐轮缩圈，打光即淘汰。',
    simultaneous: '同时回合：全员并行下达指令、统一结算；无炮火参数。',
    royale: '大逃杀：同时回合 + 歼灭缩圈（无总部参数），打光即淘汰。',
  };

  /** 模式下拉缺失（元素不存在）时回落到标准模式；正常路径下取值已是四个模式之一。 */
  function effectiveMode(value) {
    return value ? String(value) : 'standard';
  }

  /** 参数在给定模式下是否适用（无 modes 字段＝全模式适用）。 */
  function paramAppliesToMode(param, mode) {
    return !Array.isArray(param.modes) || param.modes.indexOf(mode) !== -1;
  }

  /** 某模式下应当显示并提交的参数键。 */
  function paramsForMode(mode) {
    const resolved = effectiveMode(mode);
    return PARAMS.filter(param => paramAppliesToMode(param, resolved)).map(param => param.key);
  }

  /** 与服务端 sanitizeParam 同口径：先钳到硬边界，整数参数再取整。 */
  function clampToBounds(value, param) {
    const clamped = Math.min(param.max, Math.max(param.min, value));
    return param.step >= 1 ? Math.round(clamped) : Number(clamped.toFixed(4));
  }

  function esc(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** 数字输入共用的量程/步长属性（量程＝服务端硬边界）。 */
  function boundsAttrs(param) {
    return `min="${param.min}" max="${param.max}" step="${param.step}"`;
  }

  function paramRowHtml(param) {
    const label = esc(param.label);
    const bounds = boundsAttrs(param);
    const hint = `可选 ${param.min}–${param.max}；留空＝服务端默认 ${param.defMin}–${param.defMax}`;
    return `<div class="rmo-param" data-key="${esc(param.key)}">
      <div class="rmo-param-head">
        <span class="rmo-param-label" title="${esc(hint)}">${label}</span>
        <select class="rmo-mode" aria-label="${label}取值方式">
          <option value="random" selected>随机</option>
          <option value="fixed">固定</option>
        </select>
        <span class="rmo-range-inputs">
          <input class="rmo-min" type="number" ${bounds} placeholder="${param.defMin}" aria-label="${label}最小值" />
          <span class="rmo-sep">–</span>
          <input class="rmo-max" type="number" ${bounds} placeholder="${param.defMax}" aria-label="${label}最大值" />
        </span>
        <span class="rmo-fixed-input hidden">
          <input class="rmo-value" type="number" ${bounds} placeholder="默认" aria-label="${label}固定值" />
        </span>
        <span class="rmo-bounds">范围 ${param.min}–${param.max}</span>
      </div>
    </div>`;
  }

  function panelHtml() {
    return `
      <div class="rmo-head">
        <span class="rmo-title">随机地图参数</span>
        <span class="rmo-hint">留空项由服务端在默认范围内随机</span>
      </div>
      <div class="rmo-row">
        <label class="field checkbox-field rmo-symmetric-field">
          <span title="2/3/4/6/8 人按 360/n 的最大六边形可用旋转对称（180°/120°/180°/60°/180°）；5/7 人无对称解，自动降级为非对称">对称公平</span>
          <span class="switch">
            <input id="rmo-symmetric" type="checkbox" checked />
            <span class="switch-slider"></span>
          </span>
        </label>
        <div class="field rmo-mode-field">
          <label for="rmo-game-mode">游戏模式</label>
          <select id="rmo-game-mode">
            ${GAME_MODES.map((mode, index) => `<option value="${mode.value}"${index === 0 ? ' selected' : ''}>${mode.label}</option>`).join('')}
          </select>
        </div>
        <div class="field rmo-seed-field">
          <label for="rmo-seed">种子（留空每次随机）</label>
          <input id="rmo-seed" maxlength="64" placeholder="相同种子生成相同地图" autocomplete="off" />
        </div>
      </div>
      <div class="rmo-mode-hint" id="rmo-mode-hint"></div>
      <div class="rmo-grid">
        ${PARAMS.map(paramRowHtml).join('')}
      </div>
      <div class="rmo-preview">
        <div class="rmo-preview-head">
          <span class="rmo-preview-title">地图预览</span>
          <button type="button" id="rmo-preview-refresh" class="rmo-preview-refresh" title="重新随机一张预览">&#10227; 换一张</button>
        </div>
        <div id="rmo-preview-canvas" class="rmo-preview-canvas">生成预览中…</div>
      </div>`;
  }

  function renderRandomMapCard(isSelected) {
    return `<button type="button" class="map-card map-card-random ${isSelected ? 'selected-map' : ''}" data-map-id="${RANDOM_MAP_ID}" role="radio" aria-checked="${isSelected}" aria-label="随机地图 (random)">
      <div class="map-preview empty" aria-hidden="true">?</div>
      <span class="map-card-copy">
        <span class="map-card-name"><span class="map-card-name-zh">随机地图</span><span class="map-card-name-en">random</span></span>
        <span class="map-card-meta">
          <span class="meta-tag" data-label="地形与出生点">⊘ 随机</span>
          <span class="meta-tag" data-label="玩家数">⚑ 2-8</span>
          <span class="meta-tag" data-label="回合/行动点">⏱ 随机</span>
          <span class="meta-tag" data-label="游戏模式">四种可选</span>
        </span>
      </span>
      <span class="map-card-tooltip" role="tooltip">
        <span class="tooltip-name">随机地图 <span class="tooltip-id">random</span></span>
        <span class="tooltip-desc">支持标准/歼灭/同时回合/大逃杀四种模式，随机生成地形、复活点、回合数、行动点与兵种数值；参数可固定、可用种子复现</span>
      </span>
    </button>`;
  }

  function parseNumber(input) {
    if (!input) return null;
    const raw = String(input.value).trim();
    if (raw === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }

  const RandomMapUI = {
    RANDOM_MAP_ID,
    PARAMS,
    GAME_MODES,
    renderRandomMapCard,
    paramsForMode,
    /**
     * 保留的兼容入口：滑块已移除，参数行只有数字输入，无需额外同步。
     * 外部调用无副作用（测试与旧调用方可能仍引用此名字）。
     */
    refreshSliders() {},

    previewRenderer: null,
    previewToken: 0,
    previewTimer: null,
    suppressAutoPreview: false,

    /** 注入页面的地图预览渲染函数（与静态地图卡片同一套 SVG 渲染）。 */
    setPreviewRenderer(renderer) {
      RandomMapUI.previewRenderer = renderer;
    },

    /** 将配置面板渲染进容器（各页面在 #random-map-options 容器上调用一次）。 */
    init(container) {
      if (!container) return;
      container.innerHTML = panelHtml();
      RandomMapUI.applyModeVisibility(container);
      document.getElementById('rmo-game-mode')?.addEventListener('change', () => {
        RandomMapUI.applyModeVisibility(container);
        RandomMapUI.schedulePreview();
      });
      container.querySelectorAll('.rmo-param').forEach(row => {
        const mode = row.querySelector('.rmo-mode');
        const rangeInputs = row.querySelector('.rmo-range-inputs');
        const fixedInput = row.querySelector('.rmo-fixed-input');
        mode?.addEventListener('change', () => {
          const fixed = mode.value === 'fixed';
          rangeInputs?.classList.toggle('hidden', fixed);
          fixedInput?.classList.toggle('hidden', !fixed);
          RandomMapUI.schedulePreview();
        });
      });
      container.querySelectorAll('input, select').forEach(input => {
        input.addEventListener('change', () => RandomMapUI.schedulePreview());
        if (input.tagName === 'INPUT' && input.type === 'number') {
          input.addEventListener('input', () => RandomMapUI.schedulePreview());
        }
      });
      document.getElementById('rmo-preview-refresh')?.addEventListener('click', () => {
        // 换一张：清掉种子重新抽一张，并把新种子回填保证预览即所得。
        const seed = document.getElementById('rmo-seed');
        if (seed) seed.value = '';
        RandomMapUI.refreshPreview();
      });
      // 人数影响出生位数量；面板外的下拉也要联动预览。
      document.getElementById('max-players')?.addEventListener('change', () => RandomMapUI.schedulePreview());
    },

    /**
     * 按当前游戏模式显隐参数行：标准 / 同时回合无炮火参数，歼灭 / 大逃杀无总部参数
     * （歼灭系不建总部）。同时更新模式说明，让「参数为什么少了」有解释。
     */
    applyModeVisibility(container) {
      const root = container || document.getElementById('random-map-options');
      if (!root) return;
      const mode = effectiveMode(document.getElementById('rmo-game-mode')?.value);
      root.querySelectorAll('.rmo-param').forEach(row => {
        const param = PARAMS.find(item => item.key === row.dataset.key);
        if (!param) return;
        row.classList.toggle('hidden', !paramAppliesToMode(param, mode));
      });
      const hint = document.getElementById('rmo-mode-hint');
      if (hint) hint.textContent = MODE_HINTS[mode] || '';
    },

    setSelected(mapId) {
      const panel = document.getElementById('random-map-options');
      if (panel) panel.classList.toggle('hidden', mapId !== RANDOM_MAP_ID);
      if (mapId === RANDOM_MAP_ID) RandomMapUI.refreshPreview();
    },

    isSelected() {
      const select = document.getElementById('map-select');
      return !!select && select.value === RANDOM_MAP_ID;
    },

    schedulePreview() {
      if (!RandomMapUI.isSelected() || RandomMapUI.suppressAutoPreview) return;
      clearTimeout(RandomMapUI.previewTimer);
      RandomMapUI.previewTimer = setTimeout(() => RandomMapUI.refreshPreview(), 500);
    },

    /** 按当前面板参数请求服务端生成预览；未填种子时回填服务端代抽的种子。 */
    async refreshPreview() {
      if (!RandomMapUI.isSelected()) return;
      const canvas = document.getElementById('rmo-preview-canvas');
      if (!canvas) return;
      const token = ++RandomMapUI.previewToken;
      const maxPlayers = Number(document.getElementById('max-players')?.value || 2);
      const options = RandomMapUI.collectRandomOptions();
      canvas.classList.remove('rmo-preview-error');
      canvas.innerHTML = '<span class="rmo-preview-loading">生成预览中…</span>';
      try {
        const res = await fetch('/api/maps/random/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ maxPlayers, random: options }),
        });
        const data = await res.json();
        if (token !== RandomMapUI.previewToken) return;
        if (!res.ok) throw new Error(data.error || 'preview failed');
        const seedInput = document.getElementById('rmo-seed');
        if (seedInput && !seedInput.value.trim() && data.seed) {
          RandomMapUI.suppressAutoPreview = true;
          seedInput.value = data.seed;
          RandomMapUI.suppressAutoPreview = false;
        }
        RandomMapUI.renderPreview(data.preview);
      } catch (err) {
        if (token !== RandomMapUI.previewToken) return;
        canvas.classList.add('rmo-preview-error');
        canvas.textContent = `预览失败：${err.message || '网络错误'}`;
      }
    },

    renderPreview(preview) {
      const canvas = document.getElementById('rmo-preview-canvas');
      if (!canvas || !RandomMapUI.previewRenderer) return;
      const rendered = RandomMapUI.previewRenderer(preview);
      canvas.innerHTML = rendered;
      // 同步更新地图选择器里随机卡片的小预览。
      const cardPreview = document.querySelector('.map-card-random .map-preview');
      if (cardPreview) {
        cardPreview.outerHTML = rendered;
      }
    },

    /** 读取面板输入，组装 POST /api/games 的 random 字段。 */
    collectRandomOptions() {
      const options = {};
      const symmetric = document.getElementById('rmo-symmetric');
      if (symmetric && !symmetric.checked) options.symmetric = false;
      const seed = document.getElementById('rmo-seed');
      const seedText = seed ? seed.value.trim() : '';
      if (seedText) options.seed = seedText;

      const gameMode = document.getElementById('rmo-game-mode');
      const modeValue = gameMode ? gameMode.value : '';
      const mode = effectiveMode(modeValue);
      if (modeValue) options.mode = modeValue;

      document.querySelectorAll('.rmo-param').forEach(row => {
        const key = row.dataset.key;
        if (!key) return;
        // 与当前模式无关的参数（如标准模式的炮火、歼灭模式的总部）不提交，
        // 避免服务端收到用不上的字段、也避免隐藏后仍被误带出去。
        const param = PARAMS.find(item => item.key === key);
        if (param && !paramAppliesToMode(param, mode)) return;
        // 与服务端 sanitizeParam 同口径地钳位：前端先钳，用户填的越界值不会「看着生效、
        // 实际被服务端悄悄改掉」，提交内容与服务端结果始终一致。
        const bound = value => (param ? clampToBounds(value, param) : value);
        const fill = row.querySelector('.rmo-mode')?.value || 'random';
        if (fill === 'fixed') {
          const value = parseNumber(row.querySelector('.rmo-value'));
          if (value !== null) options[key] = bound(value);
          return;
        }
        const min = parseNumber(row.querySelector('.rmo-min'));
        const max = parseNumber(row.querySelector('.rmo-max'));
        if (min === null && max === null) return;
        if (min !== null && max !== null) {
          // 始终保持区间形态：服务端 resolveParam 对标量"提前返回、不消耗随机数"，把
          // lo===hi 收成标量会让后续参数的随机数流整体错位（同种子出不同图）。
          options[key] = [bound(Math.min(min, max)), bound(Math.max(min, max))];
        } else {
          options[key] = min !== null ? min : max;
        }
      });
      return options;
    },
  };

  window.RandomMapUI = RandomMapUI;

  if (typeof document !== 'undefined' && document.getElementById) {
    const boot = () => RandomMapUI.init(document.getElementById('random-map-options'));
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})();
