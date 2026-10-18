// 大厅 / 地图卡预览：鼠标悬停据点、总部（出生点）与初始单位（触屏轻点）时弹出数值详单。
// 预览是 SVG 且外层多处 overflow:hidden，所以卡片统一挂在 body 上用 fixed 定位，不会被裁；
// 内容全部来自 marker 上的 data-marker-* / data-stat-* 属性，源头是服务端 preview 里的
// units / controlPointTypes / headquartersSpec（本图配置），前端不另存一份数值。
(() => {
  // 详单行：键（对应 data-stat-<key>）→ 名称 + 图标。只渲染 marker 上真的带了的行。
  const STAT_ROWS = [
    ['attack', '攻击'],
    ['defense', '防御'],
    ['move', '移动'],
    ['range', '射程'],
    ['cost', '费用'],
    ['heal', '治疗'],
    ['income', '收入'],
    ['discount', '部署折扣'],
    ['repair', '维修'],
    ['units', '初始单位'],
    ['deploy', '部署'],
  ];
  const GAP = 10;
  const EDGE = 8;
  const TOUCH_HIDE_DELAY = 2600;

  // 与棋盘 / 详情卡同一套线宽与圆角，缩小到 11px 仍能认出形状：
  // 攻击=剑、防御=盾、移动=箭头、射程=准星、费用=菱形（同据点金币色）、治疗=十字、
  // 收入=金币、部署折扣=价签、维修=加号圆章、初始单位=人形、部署=旗。
  const ICONS = {
    hp: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 10.4C3.4 8.7 1.6 7.1 1.6 4.9A2.3 2.3 0 0 1 6 3.5a2.3 2.3 0 0 1 4.4 1.4c0 2.2-1.8 3.8-4.4 5.5Z"/></svg>',
    attack: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1 7.7 3.7v3.1H4.3V3.7Z" fill="currentColor" stroke="none"/><path d="M2.3 7.2h7.4"/><path d="M6 7.2v3.5"/></svg>',
    defense: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.4 10 2.8v3.2c0 2.3-1.7 3.9-4 4.6-2.3-.7-4-2.3-4-4.6V2.8Z"/></svg>',
    move: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1.6 6h8"/><path d="M6.9 3.3 9.6 6l-2.7 2.7"/></svg>',
    range: '<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="3.8"/><circle cx="6" cy="6" r=".9" fill="currentColor" stroke="none"/><path d="M6 1.1v1.6M6 9.3v1.6M1.1 6h1.6M9.3 6h1.6"/></svg>',
    cost: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.6 10.4 6 6 10.4 1.6 6Z"/></svg>',
    heal: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.9v8.2M1.9 6h8.2" stroke-width="1.6"/></svg>',
    income: '<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.2"/><circle cx="6" cy="6" r="1.2" fill="currentColor" stroke="none"/></svg>',
    discount: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6.5 1.7H2.1v4.4l5.3 5.3 4.4-4.4-5.3-5.3Z"/><circle cx="4.1" cy="3.9" r=".9" fill="currentColor" stroke="none"/></svg>',
    repair: '<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.1"/><path d="M6 3.8v4.4M3.8 6h4.4"/></svg>',
    units: '<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="4" r="1.9"/><path d="M3.1 10.3c0-1.6 1.3-2.9 2.9-2.9s2.9 1.3 2.9 2.9"/></svg>',
    deploy: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.7 10.5V1.7"/><path d="M2.7 2.1h6.1L7.5 4.3l1.3 2.2H2.7"/></svg>',
  };

  function esc(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function statValue(marker, key) {
    const raw = marker.getAttribute(`data-stat-${key}`);
    return raw === null || raw === '' ? null : raw;
  }

  let tip = null;
  let anchor = null;
  let touchTimer = 0;

  function ensureTip() {
    if (tip) return tip;
    tip = document.createElement('div');
    tip.className = 'preview-tip';
    tip.setAttribute('role', 'tooltip');
    tip.setAttribute('aria-hidden', 'true');
    tip.style.display = 'none';
    document.body.appendChild(tip);
    return tip;
  }

  function hpMarkup(marker) {
    const hp = Number(statValue(marker, 'hp'));
    if (!Number.isFinite(hp) || hp <= 0) return '';
    const maxHp = Number(statValue(marker, 'max-hp'));
    const max = Number.isFinite(maxHp) && maxHp > 0 ? maxHp : hp;
    const ratio = Math.max(0, Math.min(1, hp / max));
    const tone = ratio > 0.5 ? 'healthy' : ratio > 0.25 ? 'wounded' : 'critical';
    return `<div class="preview-tip-hp">
      <div class="preview-tip-hp-label"><span>${ICONS.hp}生命</span><strong>${hp} / ${max}</strong></div>
      <div class="preview-tip-hp-bar"><i class="${tone}" style="width:${(ratio * 100).toFixed(1)}%"></i></div>
    </div>`;
  }

  function statsMarkup(marker) {
    const cells = STAT_ROWS.map(([key, label]) => {
      const value = statValue(marker, key);
      if (value === null) return '';
      return `<span class="preview-tip-cell ${key}">${ICONS[key]}<i>${label}</i><b>${esc(value)}</b></span>`;
    }).join('');
    return cells ? `<div class="preview-tip-grid">${cells}</div>` : '';
  }

  // 单位按兵种配色（unit-scout…），据点 / 总部 / 出生点按 marker 类型配色（marker-control-point…）。
  function toneClassFor(kind, token) {
    if (kind === 'unit') return token ? `unit-${token}` : '';
    return kind ? `marker-${kind}` : '';
  }

  function render(marker) {
    const kind = marker.getAttribute('data-marker-kind') || '';
    const token = marker.getAttribute('data-marker-token') || '';
    const title = marker.getAttribute('data-marker-title') || '';
    const sub = marker.getAttribute('data-marker-sub') || '';
    const trait = marker.getAttribute('data-marker-trait') || '';
    const tone = toneClassFor(kind, token);
    const panel = ensureTip();
    panel.className = `preview-tip${tone ? ` ${tone}` : ''}`;
    panel.innerHTML = `<div class="preview-tip-head">
        <span class="preview-tip-token"><span class="token-icon ${esc(token)}"></span></span>
        <div class="preview-tip-title">
          <span class="preview-tip-name">${esc(title)}</span>
          ${sub ? `<span class="preview-tip-sub">${esc(sub)}</span>` : ''}
        </div>
      </div>
      ${hpMarkup(marker)}${statsMarkup(marker)}
      ${trait ? `<div class="preview-tip-traits">${esc(trait)}</div>` : ''}`;
    return panel;
  }

  function place(marker) {
    const panel = tip;
    if (!panel) return;
    const rect = marker.getBoundingClientRect();
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    // 默认浮在标记上方；顶上放不下就翻到下方，再统一夹进视口。
    let side = 'top';
    let top = rect.top - height - GAP;
    if (top < EDGE) {
      side = 'bottom';
      top = rect.bottom + GAP;
    }
    top = Math.max(EDGE, Math.min(top, window.innerHeight - height - EDGE));
    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(EDGE, Math.min(left, window.innerWidth - width - EDGE));
    panel.dataset.side = side;
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
  }

  function show(marker) {
    if (!marker || !marker.isConnected) return;
    clearTimeout(touchTimer);
    const panel = render(marker);
    anchor = marker;
    panel.style.display = 'block';
    place(marker);
    panel.classList.add('open');
  }

  function hide() {
    clearTimeout(touchTimer);
    anchor = null;
    if (!tip) return;
    tip.classList.remove('open');
    tip.style.display = 'none';
  }

  function markerFrom(target) {
    return target instanceof Element ? target.closest('[data-preview-marker]') : null;
  }

  function markerOf(event) {
    return markerFrom(event.target);
  }

  document.addEventListener('pointerover', event => {
    if (event.pointerType === 'touch') return;
    const marker = markerOf(event);
    if (!marker) return;
    if (marker === anchor) {
      place(marker);
      return;
    }
    show(marker);
  });

  document.addEventListener('pointerout', event => {
    if (event.pointerType === 'touch') return;
    const marker = markerOf(event);
    if (!marker) return;
    if (markerFrom(event.relatedTarget) !== marker) hide();
  });

  // 触屏没有 hover：轻点标记就地弹一次，2.6 秒后自动收起，点别处立即收起。
  document.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch') {
      if (!markerOf(event)) hide();
      return;
    }
    const marker = markerOf(event);
    if (!marker) {
      hide();
      return;
    }
    show(marker);
    touchTimer = setTimeout(hide, TOUCH_HIDE_DELAY);
  });

  // 滚动 / 缩放时跟着标记走；标记随预览重绘被替换、或滚出视口就直接收起。
  const follow = () => {
    if (!anchor) return;
    if (!anchor.isConnected) {
      hide();
      return;
    }
    const rect = anchor.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) {
      hide();
      return;
    }
    place(anchor);
  };
  window.addEventListener('scroll', follow, true);
  window.addEventListener('resize', follow);
  // 标记被预览重绘替换掉、或上面盖了弹层（地图库 / 确认框）时，鼠标一动就收起：
  // 用 elementFromPoint 看光标下还是不是同一个标记，比只听 pointerout 更可靠。
  document.addEventListener('pointermove', event => {
    if (!anchor) return;
    if (!anchor.isConnected) {
      hide();
      return;
    }
    if (markerFrom(document.elementFromPoint(event.clientX, event.clientY)) !== anchor) hide();
  }, { passive: true });
  // 点选地图后预览会整块重绘，旧标记被替换掉：点击结束时补一次 detached 检查。
  document.addEventListener('click', () => {
    if (anchor && !anchor.isConnected) hide();
  });

  window.PreviewTooltip = { hide };
})();
