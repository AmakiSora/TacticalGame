import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

function loadUI() {
  const context: Record<string, unknown> = { console, window: {} };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(readFileSync('public/agent-prompt.js', 'utf8'), context);
  return (context.window as { AgentPromptUI: any }).AgentPromptUI;
}

describe('agent prompt tab module', () => {
  const ui = loadUI();
  const base = {
    serverUrl: 'http://117.72.181.8:3123',
    gameId: 'abc-123',
    players: '2',
    mapName: '对峙之地',
    mapId: 'standoff',
    aiName: 'GLM5.2-ZC',
  };

  it('builds the bare-agent prompt by default with server/game/map/name substituted', () => {
    const text = ui.buildPrompt(base);
    expect(text).toContain('服务器地址：http://117.72.181.8:3123');
    expect(text).toContain('你没有安装 play-hex-api-game skill');
    expect(text).toContain('GET http://117.72.181.8:3123/api/skill 拉取全文');
    expect(text).toContain('gameid：abc-123');
    expect(text).toContain('2 人对峙之地（standoff）');
    expect(text).toContain('「GLM5.2-ZC」');
    expect(text).not.toContain('{');
    // skillInstalled 未传时与显式 false 一致：bare 是安全默认。
    expect(text).toBe(ui.buildPrompt({ ...base, skillInstalled: false }));
  });

  it('builds the installed-skill variant that skips the full-text fetch', () => {
    const text = ui.buildPrompt({ ...base, skillInstalled: true });
    expect(text).toContain('你本地已安装 play-hex-api-game skill');
    expect(text).toContain('GET http://117.72.181.8:3123/api/skill/manifest 校验本地副本');
    expect(text).toContain('不一致才重新拉全文');
    expect(text).not.toContain('/api/skill 拉取全文');
    expect(text).not.toContain('你没有安装');
  });

  it('substitutes names containing replacement-pattern characters literally', () => {
    const text = ui.buildPrompt({ ...base, aiName: '$&$`$1' });
    expect(text).toContain('「$&$`$1」');
  });

  it('keeps the anti-delegation and polling guardrails in both variants', () => {
    for (const text of [
      ui.buildPrompt({ ...base, skillInstalled: false }),
      ui.buildPrompt({ ...base, skillInstalled: true }),
    ]) {
      expect(text).toContain('ai-player.mjs');
      expect(text).toContain('wait-turn.mjs');
      expect(text).toContain('打完为止');
    }
  });

  it('is wired into the add-AI dialog on both desktop and mobile clients', () => {
    for (const file of ['public/play.html', 'public/play-m.html']) {
      const html = readFileSync(file, 'utf8');
      expect(html).toContain('agent-prompt.js?v=');
      expect(html).toContain('id="bot-panel-prompt"');
      expect(html).toContain('id="bot-prompt-name"');
      expect(html).toContain('id="bot-prompt-skill"');
      expect(html).toContain('id="btn-bot-prompt-copy"');
    }
    for (const file of ['public/play.js', 'public/play-m.js']) {
      const js = readFileSync(file, 'utf8');
      expect(js).toContain('AgentPromptUI.buildPrompt');
      expect(js).toContain('function switchBotTab');
      expect(js).toContain('skillInstalled: els.botPromptSkill.checked');
    }
  });
});
