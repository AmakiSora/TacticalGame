// public/random-map-ui.js
// 随机地图创建面板：桌面端与移动端共用。参数支持「随机区间 / 固定值 / 留空用服务端默认」三种填法。
(function () {
  'use strict';

  const RANDOM_MAP_ID = 'random';

  const PARAMS = [
    { key: 'radius', label: '地图半径', step: 1, defMin: 6, defMax: 10 },
    { key: 'terrainDensity', label: '地形障碍密度', step: 0.01, defMin: 0.02, defMax: 0.12 },
    { key: 'controlPointCount', label: '据点数量', step: 1, defMin: 3, defMax: 5 },
    { key: 'maxTurns', label: '最大回合数', step: 1, defMin: 10, defMax: 25 },
    { key: 'actionsPerTurn', label: '每回合行动点', step: 1, defMin: 3, defMax: 8 },
    { key: 'unitStatVariation', label: '兵种数值浮动', step: 0.05, defMin: 0, defMax: 0.25 },
    { key: 'startingSupplies', label: '初始补给', step: 5, defMin: 60, defMax: 120 },
    { key: 'baseIncome', label: '基础收入', step: 1, defMin: 8, defMax: 14 },
    { key: 'controlPointIncome', label: '据点收入', step: 1, defMin: 8, defMax: 16 },
    { key: 'headquartersHp', label: '总部血量', step: 10, defMin: 120, defMax: 240 },
    { key: 'headquartersDefense', label: '总部防御', step: 1, defMin: 3, defMax: 10 },
  ];

  function esc(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function paramRowHtml(param) {
    return `<div class="rmo-param" data-key="${esc(param.key)}">
      <span class="rmo-param-label" title="留空使用服务端默认范围">${esc(param.label)}</span>
      <select class="rmo-mode" aria-label="${esc(param.label)}模式">
        <option value="random" selected>随机</option>
        <option value="fixed">固定</option>
      </select>
      <span class="rmo-range-inputs">
        <input class="rmo-min" type="number" step="${param.step}" placeholder="${param.defMin}" aria-label="${esc(param.label)}最小值" />
        <span class="rmo-sep">–</span>
        <input class="rmo-max" type="number" step="${param.step}" placeholder="${param.defMax}" aria-label="${esc(param.label)}最大值" />
      </span>
      <span class="rmo-fixed-input hidden">
        <input class="rmo-value" type="number" step="${param.step}" placeholder="默认" aria-label="${esc(param.label)}固定值" />
      </span>
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
          <span>对称公平</span>
          <span class="switch">
            <input id="rmo-symmetric" type="checkbox" checked />
            <span class="switch-slider"></span>
          </span>
        </label>
        <div class="field rmo-seed-field">
          <label for="rmo-seed">种子（留空每次随机）</label>
          <input id="rmo-seed" maxlength="64" placeholder="相同种子生成相同地图" autocomplete="off" />
        </div>
      </div>
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
          <span class="meta-tag" data-label="游戏模式">标准</span>
        </span>
      </span>
      <span class="map-card-tooltip" role="tooltip">
        <span class="tooltip-name">随机地图 <span class="tooltip-id">random</span></span>
        <span class="tooltip-desc">服务端随机生成地形、复活点、回合数、行动点与兵种数值；参数可固定、可用种子复现</span>
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
    renderRandomMapCard,

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

      document.querySelectorAll('.rmo-param').forEach(row => {
        const key = row.dataset.key;
        if (!key) return;
        const mode = row.querySelector('.rmo-mode')?.value || 'random';
        if (mode === 'fixed') {
          const value = parseNumber(row.querySelector('.rmo-value'));
          if (value !== null) options[key] = value;
          return;
        }
        const min = parseNumber(row.querySelector('.rmo-min'));
        const max = parseNumber(row.querySelector('.rmo-max'));
        if (min === null && max === null) return;
        if (min !== null && max !== null) {
          options[key] = [Math.min(min, max), Math.max(min, max)];
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
