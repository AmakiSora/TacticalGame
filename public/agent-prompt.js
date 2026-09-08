// 「添加 AI」弹框「对战提示词」页签的共享逻辑：
// 把统一引导词模板按 当前服务器地址/对局 ID/地图/玩家名/skill 安装情况 渲染成可复制的文本。
// 纯字符串模板 + 轻量 DOM 装配，参照 random-map-ui.js 的模式暴露 window.AgentPromptUI，
// 便于 node:vm 单测（tests/public/agent-prompt.test.ts）。
(function () {
  'use strict';

  // 【规则获取】分两种变体（skillInstalled 二选一），去掉接收方 agent 的分路判断：
  // - installed：对方已装 play-hex-api-game skill，走 manifest 校验（一致时省一次全文重读）；
  // - bare（默认）：直接 GET /api/skill 拉全文——即使对方其实装了 skill 也照样能玩，是安全默认。
  // 占位符：{serverUrl} {gameId} {players} {mapName} {mapId} {aiName}
  const SKILL_RULES = {
    installed: [
      '【规则获取】你本地已安装 play-hex-api-game skill：加载它，按其 Canonical fetch 一节',
      '用 GET {serverUrl}/api/skill/manifest 校验本地副本（哈希一致直接用本地副本，不一致才重新拉全文），',
      '之后只按校验通过的文本执行。',
    ].join('\n'),
    bare: [
      '【规则获取】你没有安装 play-hex-api-game skill：',
      '立即 GET {serverUrl}/api/skill 拉取全文，之后只按拉到的文本执行。',
    ].join('\n'),
  };

  const BODY_TEMPLATE = [
    '服务器地址：{serverUrl}',
    '{skillRule}',
    '【对局】我已开好一局 {players} 人{mapName}（{mapId}）游戏，gameid：{gameId}。我是房主，开局由我来点；',
    '你只调 /join 用名字「{aiName}」加入这一局，不要自己建房、也不要替我开始游戏。',
    '加入成功后不要停下来汇报，直接进入等待循环。',
    '【目标】尽全力打败我，赢下这局。',
    '【决策】禁止用 ai-player.mjs 之类的脚本代打；每个回合/规划窗口你自己读取状态、思考并逐个调用 API 行动。',
    '【轮询】这是整局对战，打完为止。凡不该你行动的时刻——等我点开始、等对手行动、每次 /end-turn 提交之后——',
    '都用 wait-turn.mjs 前台阻塞轮询。中途不要停下来等我确认，直到分出胜负；你被淘汰或游戏结束时报告战果再停止。',
  ].join('\n');

  function fillTemplate(template, values) {
    let text = template;
    for (const [key, value] of Object.entries(values || {})) {
      // split/join 逐字替换：名字里若含 $&、$` 等 replace 特殊模式字符也不会被吞掉。
      text = text.split(`{${key}}`).join(value == null ? '' : String(value));
    }
    return text;
  }

  function buildPrompt(values) {
    const rule = fillTemplate(SKILL_RULES[values?.skillInstalled ? 'installed' : 'bare'], values);
    return fillTemplate(BODY_TEMPLATE, { ...values, skillRule: rule });
  }

  // http 部署（非 https 且非 localhost）没有 navigator.clipboard，必须走 execCommand 降级。
  async function copyText(text) {
    if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch { /* 落到 execCommand 降级 */ }
    }
    if (typeof document === 'undefined') return false;
    const helper = document.createElement('textarea');
    helper.value = text;
    helper.setAttribute('readonly', '');
    helper.style.position = 'fixed';
    helper.style.opacity = '0';
    document.body.appendChild(helper);
    helper.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    helper.remove();
    return ok;
  }

  window.AgentPromptUI = { SKILL_RULES, BODY_TEMPLATE, buildPrompt, fillTemplate, copyText };
})();
