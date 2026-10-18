// 把浏览器 / 网络层抛出的英文错误转成中文，供各页面显示用。
// 服务端自己的 error / message 已经是中文，这里原样返回；
// 只在拿不到中文时才兜底，避免界面里冒出 "Failed to fetch" / "Unexpected token ..." 这类提示。
(function () {
  'use strict';
  if (window.ErrorText) return;

  const NETWORK_ERROR = /failed to fetch|networkerror|network request failed|load failed|fetch failed|net::err|err_connection/i;
  const PARSE_ERROR = /unexpected token|is not valid json|unexpected end of json|json\.parse/i;

  /**
   * @param {unknown} error 抛出的错误对象或提示文本
   * @param {string} [fallback] 完全拿不到信息时的兜底文案
   */
  function describe(error, fallback = '未知错误') {
    const raw = typeof error === 'string' ? error : error?.message;
    const text = String(raw ?? '').trim();
    if (!text) return fallback;
    // 服务端与本地文案已经是中文，直接用。
    if (/[\u4e00-\u9fa5]/.test(text)) return text;

    const status = text.match(/^HTTP\s+(\d{3})$/i);
    if (status) {
      if (status[1] === '401' || status[1] === '403') return `没有权限（HTTP ${status[1]}）`;
      if (status[1] === '404') return '找不到请求的数据（HTTP 404）';
      return `服务端返回 HTTP ${status[1]}`;
    }
    if (NETWORK_ERROR.test(text)) return '网络连接失败，请确认服务端是否在线';
    if (PARSE_ERROR.test(text)) return '服务端返回的数据无法解析';
    if (/^abort/i.test(text)) return '请求已取消';
    // 其余（参数名、校验细节）保持原文，便于排查。
    return text;
  }

  window.ErrorText = { describe };
})();
