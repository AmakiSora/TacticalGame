// 布局编辑器：玩家页 / 观战页共用
// 通过右上角「设置 → 改变布局」进入编辑模式，卡片可在 左侧 / 右侧 / 底部 区域间拖放，
// 并可拖动地图框右下角手柄调整地图框整体大小。布局仅保存在浏览器 localStorage。
(() => {
  'use strict';

  const MIN_BOARD_WIDTH = 360;

  const PAGES = {
    play: {
      storageKey: 'tgLayout.play.v1',
      container: '#game-ui',
      board: '.board-panel',
      sidebar: '#sidebar',
      boardDefaultCol: 'minmax(420px, auto)',
      leftCol: 'minmax(200px, 240px)',
      rightCol: 'minmax(330px, 380px)',
      cards: [
        { id: 'selection-panel', selector: '#selection-panel', defaultZone: 'left' },
        { id: 'turn-resources', selector: '#turn-resources', defaultZone: 'right' },
        { id: 'score-panel', selector: '#score-panel', defaultZone: 'right' },
        { id: 'action-hints', selector: '#action-hints', defaultZone: 'right' },
        { id: 'plan-panel', selector: '#plan-panel', defaultZone: 'right' },
        { id: 'quick-actions', selector: '#quick-actions', defaultZone: 'right' },
        { id: 'event-log', selector: '#event-log', defaultZone: 'right' },
      ],
    },
    spectator: {
      storageKey: 'tgLayout.spectator.v1',
      container: 'main.spectator-main',
      board: '#board-wrap',
      sidebar: '#sidebar',
      boardDefaultCol: 'minmax(420px, auto)',
      leftCol: 'minmax(190px, 220px)',
      rightCol: 'minmax(300px, 340px)',
      cards: [
        { id: 'selection-panel', selector: '#selection-panel', defaultZone: 'left' },
        { id: 'resources', selector: '#resources', defaultZone: 'right' },
        { id: 'score-panel', selector: '#score-panel', defaultZone: 'right' },
        { id: 'turn-info', selector: '#turn-info', defaultZone: 'right' },
        { id: 'event-detail', selector: '#event-detail', defaultZone: 'right' },
        { id: 'event-log', selector: '#event-log', defaultZone: 'right' },
      ],
    },
  };

  function detectConfig() {
    if (document.body.classList.contains('player-shell')) return PAGES.play;
    if (document.body.classList.contains('spectator-shell')) return PAGES.spectator;
    return null;
  }

  const cfg = detectConfig();
  if (!cfg) return;
  const container = document.querySelector(cfg.container);
  const boardEl = document.querySelector(cfg.board);
  const rightZone = document.querySelector(cfg.sidebar);
  if (!container || !boardEl || !rightZone) return;

  // ── 构建分区 ──
  const leftZone = document.createElement('div');
  leftZone.className = 'tg-zone tg-zone-left';
  container.insertBefore(leftZone, boardEl);
  const bottomZone = document.createElement('div');
  bottomZone.className = 'tg-zone tg-zone-bottom';
  container.appendChild(bottomZone);
  rightZone.classList.add('tg-zone', 'tg-zone-right');
  const zoneEls = { left: leftZone, right: rightZone, bottom: bottomZone };

  const cardEls = {};
  for (const card of cfg.cards) {
    const el = document.querySelector(card.selector);
    if (!el) continue;
    el.classList.add('tg-card');
    el.dataset.tgCard = card.id;
    cardEls[card.id] = el;
  }
  boardEl.classList.add('tg-board');

  let state = null;      // 已持久化的布局
  let working = null;    // 编辑中的布局
  let editing = false;
  let dragCard = null;

  const placeholder = document.createElement('div');
  placeholder.className = 'tg-drop-placeholder';

  // ── 状态 ──
  function defaultState() {
    const zones = { left: [], right: [], bottom: [] };
    for (const card of cfg.cards) {
      if (cardEls[card.id]) zones[card.defaultZone].push(card.id);
    }
    return { zones, boardWidth: null };
  }

  function clampBoardWidth(w) {
    const max = Math.max(720, Math.floor(document.documentElement.clientWidth) - 80);
    return Math.round(Math.min(Math.max(w, MIN_BOARD_WIDTH), max));
  }

  function loadState() {
    const def = defaultState();
    try {
      const raw = localStorage.getItem(cfg.storageKey);
      if (!raw) return def;
      const saved = JSON.parse(raw);
      const known = new Set(cfg.cards.map(c => c.id));
      const placed = new Set();
      const zones = { left: [], right: [], bottom: [] };
      for (const z of ['left', 'right', 'bottom']) {
        const list = Array.isArray(saved?.zones?.[z]) ? saved.zones[z] : [];
        for (const id of list) {
          if (known.has(id) && !placed.has(id) && cardEls[id]) {
            zones[z].push(id);
            placed.add(id);
          }
        }
      }
      for (const card of cfg.cards) {
        if (cardEls[card.id] && !placed.has(card.id)) zones[card.defaultZone].push(card.id);
      }
      const boardWidth = Number.isFinite(saved?.boardWidth) ? clampBoardWidth(saved.boardWidth) : null;
      return { zones, boardWidth };
    } catch {
      return def;
    }
  }

  function saveState(s) {
    try { localStorage.setItem(cfg.storageKey, JSON.stringify(s)); } catch { /* 忽略存储失败 */ }
  }

  // ── 应用布局 ──
  function zoneCards(zone) {
    return [...zone.querySelectorAll(':scope > .tg-card')];
  }

  function applyBoardWidth(w) {
    if (w) {
      boardEl.style.width = `${w}px`;
      boardEl.classList.add('tg-board-resized');
    } else {
      boardEl.style.width = '';
      boardEl.classList.remove('tg-board-resized');
    }
  }

  function applyState(s) {
    for (const name of ['left', 'right', 'bottom']) {
      for (const id of s.zones[name]) {
        const el = cardEls[id];
        if (el) zoneEls[name].appendChild(el);
      }
    }
    applyBoardWidth(s.boardWidth);
    updateGrid(s);
  }

  function updateGrid(s) {
    const hasLeft = zoneCards(leftZone).length > 0;
    const hasRight = zoneCards(rightZone).length > 0;
    const hasBottom = zoneCards(bottomZone).length > 0;
    const showLeft = hasLeft || editing;
    const showRight = hasRight || editing;
    const showBottom = hasBottom || editing;

    const cols = [];
    if (showLeft) cols.push(cfg.leftCol);
    cols.push(s.boardWidth ? `${s.boardWidth}px` : cfg.boardDefaultCol);
    if (showRight) cols.push(cfg.rightCol);
    container.style.setProperty('--tg-grid', cols.join(' '));

    const boardCol = showLeft ? '2' : '1';
    boardEl.style.gridRow = '1';
    boardEl.style.gridColumn = boardCol;

    leftZone.style.display = showLeft ? '' : 'none';
    leftZone.style.gridColumn = '1';
    leftZone.style.gridRow = '1';
    leftZone.classList.toggle('tg-empty', !hasLeft);

    rightZone.style.display = showRight ? '' : 'none';
    rightZone.style.gridColumn = String(cols.length);
    rightZone.style.gridRow = '1';
    rightZone.classList.toggle('tg-empty', !hasRight);

    bottomZone.style.display = showBottom ? '' : 'none';
    bottomZone.style.gridColumn = boardCol;
    bottomZone.style.gridRow = '2';
    bottomZone.classList.toggle('tg-empty', !hasBottom);
  }

  function readZonesFromDom() {
    const zones = { left: [], right: [], bottom: [] };
    for (const [name, el] of Object.entries(zoneEls)) {
      zones[name] = zoneCards(el).map(c => c.dataset.tgCard);
    }
    return zones;
  }

  // ── 编辑工具栏 ──
  const toolbar = document.createElement('div');
  toolbar.id = 'tg-edit-toolbar';
  toolbar.style.display = 'none';
  toolbar.innerHTML = `
    <span class="tg-hint">布局编辑：拖动卡片到 左侧 / 右侧 / 底部 区域，拖动地图框右下角手柄调整地图框大小（双击手柄重置）</span>
    <button type="button" class="tg-primary" data-act="done">完成</button>
    <button type="button" data-act="reset">重置为默认</button>
    <button type="button" data-act="cancel">取消</button>`;
  document.body.appendChild(toolbar);
  toolbar.addEventListener('click', e => {
    const act = e.target?.dataset?.act;
    if (act === 'done') finishEdit();
    else if (act === 'reset') {
      working = defaultState();
      applyState(working);
    } else if (act === 'cancel') cancelEdit();
  });

  // ── 进入 / 退出编辑模式 ──
  function enterEdit() {
    if (editing) return;
    editing = true;
    working = JSON.parse(JSON.stringify(state));
    document.body.classList.add('tg-editing');
    for (const el of Object.values(cardEls)) el.draggable = true;
    toolbar.style.display = '';
    updateGrid(working);
  }

  function exitEdit() {
    editing = false;
    document.body.classList.remove('tg-editing');
    for (const el of Object.values(cardEls)) el.draggable = false;
    toolbar.style.display = 'none';
    placeholder.remove();
    removeZoneHighlights();
    if (dragCard) dragCard.classList.remove('tg-dragging');
    dragCard = null;
    updateGrid(state);
  }

  function finishEdit() {
    working.zones = readZonesFromDom();
    state = working;
    saveState(state);
    exitEdit();
  }

  function cancelEdit() {
    applyState(state);
    exitEdit();
  }

  document.addEventListener('keydown', e => {
    if (editing && e.key === 'Escape') cancelEdit();
  });

  // ── 卡片拖放 ──
  container.addEventListener('dragstart', e => {
    if (!editing) return;
    const card = e.target?.closest?.('.tg-card');
    if (!card || !card.dataset.tgCard) return;
    dragCard = card;
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', card.dataset.tgCard); } catch { /* 兼容旧浏览器 */ }
    placeholder.style.height = `${card.offsetHeight}px`;
    setTimeout(() => card.classList.add('tg-dragging'), 0);
  });

  container.addEventListener('dragend', () => {
    if (dragCard) dragCard.classList.remove('tg-dragging');
    dragCard = null;
    placeholder.remove();
    removeZoneHighlights();
  });

  function insertIndex(zone, x, y) {
    const cards = zoneCards(zone).filter(c => c !== dragCard);
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect();
      // 指针在卡片中点上方，或与卡片同行且在水平中点左侧 → 插到该卡片之前
      if (y < r.top + r.height / 2 || (y <= r.bottom && x < r.left + r.width / 2)) return i;
    }
    return cards.length;
  }

  function removeZoneHighlights() {
    for (const zone of Object.values(zoneEls)) zone.classList.remove('tg-over');
  }

  for (const zone of Object.values(zoneEls)) {
    zone.addEventListener('dragover', e => {
      if (!editing || !dragCard) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      removeZoneHighlights();
      zone.classList.add('tg-over');
      const idx = insertIndex(zone, e.clientX, e.clientY);
      const cards = zoneCards(zone).filter(c => c !== dragCard);
      zone.insertBefore(placeholder, cards[idx] || null);
    });
    zone.addEventListener('drop', e => {
      if (!editing || !dragCard) return;
      e.preventDefault();
      zone.insertBefore(dragCard, placeholder);
      placeholder.remove();
      dragCard.classList.remove('tg-dragging');
      dragCard = null;
      removeZoneHighlights();
      working.zones = readZonesFromDom();
      updateGrid(working);
    });
  }

  // ── 地图框整体大小调整 ──
  const resizer = document.createElement('div');
  resizer.className = 'tg-board-resizer';
  resizer.title = '拖动调整地图框大小，双击重置';
  boardEl.appendChild(resizer);

  let resizeStart = null;
  resizer.addEventListener('pointerdown', e => {
    if (!editing) return;
    e.preventDefault();
    e.stopPropagation();
    resizeStart = { x: e.clientX, w: boardEl.getBoundingClientRect().width };
    try { resizer.setPointerCapture(e.pointerId); } catch { /* 忽略 */ }
  });
  resizer.addEventListener('pointermove', e => {
    if (!resizeStart) return;
    const w = clampBoardWidth(resizeStart.w + (e.clientX - resizeStart.x));
    boardEl.style.width = `${w}px`;
    boardEl.classList.add('tg-board-resized');
    // 同步更新网格列宽，否则 max-width:100% 会按旧列宽钳制，导致缩小后无法再拉大
    working.boardWidth = w;
    updateGrid(working);
  });
  resizer.addEventListener('pointerup', () => {
    if (!resizeStart) return;
    resizeStart = null;
    updateGrid(working);
  });
  resizer.addEventListener('dblclick', () => {
    if (!editing) return;
    working.boardWidth = null;
    applyBoardWidth(null);
    updateGrid(working);
  });

  // ── 设置入口 ──
  const btnEditLayout = document.getElementById('btn-edit-layout');
  const settingsPopover = document.getElementById('settings-popover');
  btnEditLayout?.addEventListener('click', e => {
    e.stopPropagation();
    settingsPopover?.classList.remove('open');
    if (container.offsetParent === null) {
      window.alert('请先进入游戏后再调整布局');
      return;
    }
    enterEdit();
  });

  state = loadState();
  applyState(state);
})();
