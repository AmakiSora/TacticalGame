// tests/public/replay-merit-mirror.test.ts
// 直接执行 app.js / spectator-m.js 的【真实】功绩镜像（recordActionMerit 经 applyEvent 驱动），
// 用 records/ 全量归档校验：旧口径回放的中途分数必须能复现文件里存档的 actionScore。
//
// 为什么不复用 replay-scoring-era.test.ts：那份测试在测试文件里【重写】了一套功绩逻辑，
// 只能证明「模型自洽」，发现不了真实前端与历史服务器的口径分叉——2026-10 就是这样漏掉了
// 「同时模式的治疗桶」：服务器 actionMeritForEvent 只把【攻击】改成 10HP 一档、治疗恒 20HP，
// 而前端把细桶也套给了治疗，导致 13 个旧回放席位的中途 actionScore 被高估。
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createContext, Script } from 'node:vm';
import { describe, expect, it } from 'vitest';

const CLIENTS = ['public/app.js', 'public/spectator-m.js'];

// computeLayout 只影响棋盘绘制、与评分无关，且两端各自依赖不同的 DOM 辅助，
// 因此用 no-op 桩替代，避免把整套渲染依赖拖进 VM。其余全部取真实源码。
const FN_NAMES = [
  'esc', 'playerLabel', 'defaultPlayerNames', 'isAnnihilationRules', 'joinedPlayerIds',
  'createEmptyState', 'cloneMapPayload',
  'setCellTerrain', 'recordActionPoint', 'ensureStats', 'scoringEraFromVersion',
  'scoringEraFromScores', 'replayScoringEra', 'usesLegacyAdjudication', 'recordActionMerit',
  'applyEvent', 'compareSemver', 'normalizeVersion', 'playerScore',
  'computeAdjudicationScores', 'liveAdjudicationScores',
];

type Score = { actionScore?: number; killValue?: number };
type Api = {
  createEmptyState(): Record<string, unknown>;
  applyEvent(s: Record<string, unknown>, ev: { type: string; payload?: Record<string, unknown> }): void;
  playerScore(owner: string): (Score & { total?: number }) | null;
  scoringEraFromVersion(version: string): 'current' | 'merit' | 'base';
  scoringEraFromScores(events: unknown[]): 'current' | 'merit' | 'base';
  setMeta(era: string, version: string | null): void;
  setState(s: Record<string, unknown>): void;
};

// 从单个前端产物里切出真实函数，注入最小 DOM 桩后在 VM 中执行。
function buildApi(source: string): Api {
  const domStart = source.indexOf('\nconst canvas =');
  if (domStart < 0) throw new Error('找不到 DOM 常量块边界');
  const sliceA = source.slice(0, domStart);
  const fns = FN_NAMES.map(name => {
    const start = source.indexOf(`function ${name}(`);
    if (start < 0) throw new Error(`缺少函数 ${name}`);
    const end = source.indexOf('\n}', start);
    return source.slice(start, end + 2);
  });
  const stubs = `
    var window = { APP_VERSION: '3.6.0' };
    var document = { getElementById: function(){ return null; }, querySelector: function(){ return null; }, querySelectorAll: function(){ return []; } };
    var canvas = { width: 0, height: 0 };
    var ctx = {};
    var requestAnimationFrame = function(){ return 0; };
    var cancelAnimationFrame = function(){};
    var getComputedStyle = function(){ return {}; };
    var localStorage = { getItem: function(){ return null; }, setItem: function(){}, removeItem: function(){} };
    function computeLayout(){}
  `;
  const exports = `
    globalThis.__api = {
      createEmptyState: createEmptyState,
      applyEvent: applyEvent,
      playerScore: playerScore,
      scoringEraFromVersion: scoringEraFromVersion,
      scoringEraFromScores: scoringEraFromScores,
      setMeta: function (era, ver) { importedReplayMeta = { scoringEra: era, schemaVersion: ver }; },
      setState: function (s) { state = s; },
    };`;
  const code = stubs + '\n' + sliceA + '\n' + fns.join('\n') + '\n' + exports;
  const context = createContext({ console });
  new Script(code).runInContext(context);
  return (context as Record<string, unknown>).__api as Api;
}

const FILES = ['records/V2', 'records/V3']
  .filter(dir => existsSync(dir))
  .flatMap(dir => readdirSync(dir).filter(name => name.endsWith('.json')).map(name => `${dir}/${name}`));

type Loaded = { file: string; era: string; archived: Record<string, Score> | null; events: unknown[]; version: string | null };

function load(file: string): Loaded | null {
  let raw: { schemaVersion?: unknown; events?: unknown };
  try { raw = JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
  const events = Array.isArray(raw) ? (raw as unknown[]) : raw.events;
  if (!Array.isArray(events) || !events.length) return null;
  const version = !Array.isArray(raw) && typeof raw.schemaVersion === 'string' && /^\d+\.\d+\.\d+$/.test(raw.schemaVersion)
    ? raw.schemaVersion : null;
  const over = [...events].reverse().find((ev: { type?: string }) => ev?.type === 'game_over') as
    { payload?: { scores?: Record<string, Score> } } | undefined;
  return { file, era: '', archived: over?.payload?.scores ?? null, events, version };
}

const ARCHIVES = FILES.map(load).filter((a): a is Loaded => !!a && !!a.archived);

function audit(api: Api): { problems: string[]; meritSeats: number; baseSeats: number; currentSeats: number } {
  const problems: string[] = [];
  let meritSeats = 0, baseSeats = 0, currentSeats = 0;
  for (const archive of ARCHIVES) {
    const era = archive.version ? api.scoringEraFromVersion(archive.version) : api.scoringEraFromScores(archive.events);
    api.setMeta(era, archive.version);
    const s = api.createEmptyState();
    for (const ev of archive.events) api.applyEvent(s, ev as { type: string; payload?: Record<string, unknown> });
    api.setState(s);
    for (const [owner, sc] of Object.entries(archive.archived!)) {
      if (!sc || typeof sc !== 'object') continue;
      const mine = api.playerScore(owner);
      if (!mine) { problems.push(`${archive.file} ${owner}: playerScore 返回 null`); continue; }
      if (era === 'merit') {
        meritSeats++;
        if (typeof sc.actionScore === 'number' && mine.actionScore !== sc.actionScore) {
          problems.push(`${archive.file} ${owner}: 真函数 actionScore=${mine.actionScore} ≠ 存档 ${sc.actionScore}`);
        }
      } else if (era === 'base') {
        baseSeats++;
        if ('actionScore' in sc) problems.push(`${archive.file} ${owner}: 早期口径却出现 actionScore`);
      } else {
        currentSeats++;
      }
    }
  }
  return { problems, meritSeats, baseSeats, currentSeats };
}

describe('replay merit mirror runs the real front-end functions', () => {
  it('loads the whole V2/V3 archive corpus with scores', () => {
    expect(ARCHIVES.length).toBeGreaterThan(100);
  });

  for (const file of CLIENTS) {
    it(`${file}: reproduces every archived actionScore across the corpus`, () => {
      const api = buildApi(readFileSync(file, 'utf8'));
      const { problems, meritSeats } = audit(api);
      expect(meritSeats, '功绩口径席位太少，校验可能形同虚设').toBeGreaterThan(300);
      expect(problems).toEqual([]);
    });
  }

  it('never lets the fine attack bucket leak into healing merit', () => {
    // 锚点：tg_0162（3.5.5 同时回合，治疗事件最多）player_a 的存档 actionScore 为 456。
    // 治疗若误用 10HP 细桶会得到 510——正是修复前的实际表现。
    const api = buildApi(readFileSync('public/app.js', 'utf8'));
    const anchor = ARCHIVES.find(a => a.file.endsWith('tg_0162_20260924.json'));
    expect(anchor, '缺少锚点归档 tg_0162').toBeTruthy();
    api.setMeta(api.scoringEraFromVersion(anchor!.version!), anchor!.version);
    const s = api.createEmptyState();
    for (const ev of anchor!.events) api.applyEvent(s, ev as { type: string; payload?: Record<string, unknown> });
    api.setState(s);
    expect(api.playerScore('player_a')?.actionScore).toBe(456);
  });
});
