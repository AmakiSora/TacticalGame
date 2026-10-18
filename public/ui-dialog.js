// 统一确认框：替代原生 confirm / alert / prompt。
// 原生对话框的样式由浏览器决定，和这套暗色界面不搭；这里用同一套面板重画，
// 交互保持原生语义：确认返回 true、取消 / Esc / 点遮罩返回 false，prompt 取消返回 null。
// 页面通过 import './ui-dialog.js' 引入（样式在 ui-dialog.css），调用 window.UIDialog.*。
(function () {
  'use strict';
  if (window.UIDialog) return;

  const TONES = ['primary', 'warning', 'danger'];
  const EXIT_MS = 180;
  // 同时打开的框按层叠顺序排队：只让最上面的一层响应键盘。
  const stack = [];
  let seq = 0;
  let openCount = 0;

  function normalizeOptions(options) {
    if (typeof options === 'string') return { message: options };
    return options && typeof options === 'object' ? options : {};
  }

  function createButton(label, variant) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ui-dialog-btn';
    if (variant) button.dataset.variant = variant;
    button.textContent = label;
    return button;
  }

  function focusables(root) {
    const nodes = root.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])');
    return Array.from(nodes).filter(node => node.getClientRects().length > 0);
  }

  function openDialog(kind, rawOptions) {
    const options = normalizeOptions(rawOptions);
    const isPrompt = kind === 'prompt';
    const tone = TONES.includes(options.tone) ? options.tone : 'primary';
    const title = options.title === undefined ? (kind === 'alert' ? '提示' : '确认') : String(options.title);
    const message = options.message === undefined ? '' : String(options.message);
    const confirmText = options.confirmText || (kind === 'alert' ? '知道了' : '确定');
    const cancelText = options.cancelText || '取消';

    return new Promise(resolve => {
      const backdrop = document.createElement('div');
      backdrop.className = 'ui-dialog-backdrop';

      const panel = document.createElement('div');
      panel.className = 'ui-dialog';
      panel.tabIndex = -1;
      panel.dataset.tone = tone;
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');

      const titleId = `ui-dialog-title-${++seq}`;
      const titleEl = document.createElement('h3');
      titleEl.className = 'ui-dialog-title';
      titleEl.id = titleId;
      titleEl.textContent = title;
      if (title) panel.setAttribute('aria-labelledby', titleId);
      else panel.setAttribute('aria-label', options.ariaLabel || '提示');

      const body = document.createElement('div');
      body.className = 'ui-dialog-body';

      const messageEl = document.createElement('p');
      messageEl.className = 'ui-dialog-message';
      messageEl.textContent = message;
      body.appendChild(messageEl);

      let input = null;
      if (isPrompt) {
        input = document.createElement('input');
        input.className = 'ui-dialog-input';
        input.type = 'text';
        input.autocomplete = 'off';
        input.value = options.value == null ? '' : String(options.value);
        if (options.placeholder) input.placeholder = String(options.placeholder);
        if (Number.isFinite(options.maxLength)) input.maxLength = options.maxLength;
        if (!message) input.setAttribute('aria-label', options.inputLabel || title || '输入');
        body.appendChild(input);
      }

      const actions = document.createElement('div');
      actions.className = 'ui-dialog-actions';
      const cancelBtn = kind === 'alert' ? null : createButton(cancelText, '');
      if (cancelBtn) actions.appendChild(cancelBtn);
      const confirmBtn = createButton(confirmText, tone);
      actions.appendChild(confirmBtn);

      panel.appendChild(titleEl);
      panel.appendChild(body);
      panel.appendChild(actions);

      const previouslyFocused = document.activeElement;
      const instance = { panel };
      let settled = false;
      let exitTimer = null;

      function cleanup() {
        document.removeEventListener('keydown', onKeyDown, true);
        panel.remove();
        backdrop.remove();
        const index = stack.indexOf(instance);
        if (index !== -1) stack.splice(index, 1);
        openCount = Math.max(0, openCount - 1);
        if (openCount === 0) document.body.classList.remove('ui-dialog-open');
        // 关掉最后一层时把焦点还给原位置，键盘操作不会丢。
        if (openCount === 0 && previouslyFocused && typeof previouslyFocused.focus === 'function' && previouslyFocused.isConnected) {
          try {
            previouslyFocused.focus({ preventScroll: true });
          } catch {
            previouslyFocused.focus();
          }
        }
      }

      function settle(action) {
        if (settled) return;
        settled = true;
        clearTimeout(exitTimer);
        panel.classList.remove('open');
        backdrop.classList.remove('open');
        // 先回结果，动画结束后再摘除节点，调用方可以立刻继续跳转。
        exitTimer = setTimeout(cleanup, EXIT_MS);
        if (kind === 'confirm') resolve(action === 'confirm');
        else if (isPrompt) resolve(action === 'confirm' ? input.value : null);
        else resolve();
      }

      function onKeyDown(event) {
        if (stack[stack.length - 1] !== instance) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          settle('cancel');
          return;
        }
        if (event.key === 'Enter' && !event.isComposing) {
          // 焦点在取消按钮上时交给按钮自己处理，避免回车反而确认。
          if (document.activeElement === cancelBtn) return;
          event.preventDefault();
          event.stopPropagation();
          settle('confirm');
          return;
        }
        if (event.key === 'Tab') {
          const items = focusables(panel);
          if (!items.length) return;
          const first = items[0];
          const last = items[items.length - 1];
          // 焦点还在面板上时（刚打开），Tab / Shift+Tab 分别落到首尾按钮，不跑出弹窗。
          if (!items.includes(document.activeElement)) {
            event.preventDefault();
            (event.shiftKey ? last : first).focus();
            return;
          }
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      }

      stack.push(instance);
      openCount += 1;
      if (openCount === 1) document.body.classList.add('ui-dialog-open');

      const layer = (openCount - 1) * 4;
      backdrop.style.zIndex = String(1000 + layer);
      panel.style.zIndex = String(1010 + layer);
      document.body.appendChild(backdrop);
      document.body.appendChild(panel);
      document.addEventListener('keydown', onKeyDown, true);

      confirmBtn.addEventListener('click', () => settle('confirm'));
      if (cancelBtn) cancelBtn.addEventListener('click', () => settle('cancel'));
      backdrop.addEventListener('click', () => {
        if (options.backdropClose === false) return;
        settle('cancel');
      });

      requestAnimationFrame(() => {
        backdrop.classList.add('open');
        panel.classList.add('open');
        const target = isPrompt ? input : panel;
        try {
          target.focus({ preventScroll: true });
        } catch {
          target.focus();
        }
        if (isPrompt) input.select();
      });
    });
  }

  window.UIDialog = {
    confirm(options) {
      return openDialog('confirm', options);
    },
    alert(options) {
      return openDialog('alert', options);
    },
    prompt(options) {
      return openDialog('prompt', options);
    },
    isOpen() {
      return openCount > 0;
    },
  };
})();
