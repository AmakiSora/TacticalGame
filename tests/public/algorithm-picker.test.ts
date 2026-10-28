import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

const PLAYER_CLIENTS = ['public/play.js', 'public/play-m.js'];

const ALGORITHMS = [
  { id: 'algo_greedy', algorithm: 'greedy', name: '贪心算法', modes: ['standard'] },
  { id: 'algo_random', algorithm: 'random', name: '随机算法', modes: ['standard'] },
  { id: 'algo_random-annihilation', algorithm: 'random-annihilation', name: '歼灭随机算法', modes: ['annihilation'] },
  { id: 'algo_random-royale', algorithm: 'random-royale', name: '大逃杀随机算法', modes: ['royale'] },
  { id: 'algo_apex', algorithm: 'apex', name: '绝境算法', modes: ['royale'] },
  { id: 'algo_mcts', algorithm: 'mcts', name: '蒙特卡洛树搜索', modes: ['standard'] },
  { id: 'algo_threat', algorithm: 'threat', name: '威胁感知算法', modes: ['standard'] },
  { id: 'algo_field', algorithm: 'field', name: '势场算法', modes: ['standard'] },
  { id: 'algo_verdict', algorithm: 'verdict', name: '裁决线算法', modes: ['standard'] },
  { id: 'algo_random-sim', algorithm: 'random-sim', name: '同时随机算法', modes: ['simultaneous'] },
];

interface Rendered {
  html: string;
  values: string[];
}

// 页面脚本是依赖 DOM 的全局脚本，无法整体加载；切出真实的 ensureAlgorithmTypes
// 函数源码，注入受控全局后执行，断言算法下拉按对局模式过滤的实际行为。
async function renderAlgorithmOptions(
  file: string,
  state: { gameConfig: { mode: string } | null; botLobbyMode: string },
): Promise<Rendered> {
  const source = read(file);
  const start = source.indexOf('async function ensureAlgorithmTypes()');
  expect(start, `${file} 应包含 ensureAlgorithmTypes`).toBeGreaterThan(-1);
  // CRLF/LF 均按「行首 }」定位函数收尾，end+2 把换行与闭括号一并纳入切片。
  const end = source.indexOf('\n}', start);
  expect(end, `${file} 中 ensureAlgorithmTypes 缺少收尾括号`).toBeGreaterThan(start);
  const fnSource = source.slice(start, end + 2);
  const context: Record<string, unknown> = {
    console,
    gameConfig: state.gameConfig,
    botLobbyMode: state.botLobbyMode,
    algorithmTypesCache: ALGORITHMS.map(entry => ({ ...entry })),
    fetch: async () => {
      throw new Error('unexpected fetch: 缓存已预置，不应再请求清单');
    },
    esc: (value: string) => value,
    resetAlgorithmName: () => {},
    els: { algorithmType: { innerHTML: '' } },
  };
  context.globalThis = context;
  vm.createContext(context);
  await vm.runInContext(`(${fnSource})()`, context);
  const html = (context.els as { algorithmType: { innerHTML: string } }).algorithmType.innerHTML;
  const values = [...html.matchAll(/<option value="([^"]*)"/g)].map(match => match[1]).filter(Boolean);
  return { html, values };
}

describe('add-AI dialog algorithm list', () => {
  it('filters the algorithm dropdown by the lobby mode before the game starts', async () => {
    for (const file of PLAYER_CLIENTS) {
      // gameConfig 只在开局后的 game_start 事件赋值，而添加 AI 弹窗仅存在于大厅阶段，
      // 须回退到大厅快照 mode：同时回合大厅只列 random-sim。
      expect(await renderAlgorithmOptions(file, { gameConfig: null, botLobbyMode: 'simultaneous' }))
        .toMatchObject({ values: ['algo_random-sim'] });
      // 各模式只显示可用算法，不列会被服务端拒绝的其他模式算法。
      expect((await renderAlgorithmOptions(file, { gameConfig: null, botLobbyMode: 'annihilation' })).values)
        .toEqual(['algo_random-annihilation']);
      const royaleLobby = await renderAlgorithmOptions(file, { gameConfig: null, botLobbyMode: 'royale' });
      expect(royaleLobby.values).toEqual(['algo_random-royale', 'algo_apex']);
      expect(royaleLobby.html).not.toContain('当前模式无可用算法');
    }
  });

  it('falls back to the standard algorithm list only without any lobby snapshot', async () => {
    for (const file of PLAYER_CLIENTS) {
      const rendered = await renderAlgorithmOptions(file, { gameConfig: null, botLobbyMode: '' });
      expect(rendered.values).toEqual(['algo_greedy', 'algo_random', 'algo_mcts', 'algo_threat', 'algo_field', 'algo_verdict']);
    }
  });

  it('prefers the started game mode over the lobby snapshot', async () => {
    for (const file of PLAYER_CLIENTS) {
      const standard = await renderAlgorithmOptions(file, { gameConfig: { mode: 'standard' }, botLobbyMode: 'simultaneous' });
      expect(standard.values).toEqual(['algo_greedy', 'algo_random', 'algo_mcts', 'algo_threat', 'algo_field', 'algo_verdict']);
      const simultaneous = await renderAlgorithmOptions(file, { gameConfig: { mode: 'simultaneous' }, botLobbyMode: '' });
      expect(simultaneous.values).toEqual(['algo_random-sim']);
      const royale = await renderAlgorithmOptions(file, { gameConfig: { mode: 'royale' }, botLobbyMode: '' });
      expect(royale.values).toEqual(['algo_random-royale', 'algo_apex']);
      const annihilation = await renderAlgorithmOptions(file, { gameConfig: { mode: 'annihilation' }, botLobbyMode: '' });
      expect(annihilation.values).toEqual(['algo_random-annihilation']);
    }
  });

  it('snapshots the lobby mode alongside map and maxPlayers in renderLobbySummary', () => {
    for (const file of PLAYER_CLIENTS) {
      const source = read(file);
      expect(source).toContain("let botLobbyMode = '';");
      expect(source).toContain('if (lobby.mode) botLobbyMode = lobby.mode;');
    }
  });
});
