import { readFileSync } from 'node:fs';
import { createContext, Script } from 'node:vm';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

const PLAYER_CLIENTS = ['public/play.js', 'public/play-m.js'];

// 瞄准预演（aimPreview）与悬停射程提示（hoverRangeHint）是玩家页的纯函数式胶水：
// 切出真实源码，注入受控的 state / gameConfig / 交互态后断言预演数值与门控条件。
function loadFn(file: string, name: string): string {
  const source = read(file);
  const start = source.indexOf(`function ${name}(`);
  expect(start, `${file} 应包含 ${name}`).toBeGreaterThan(-1);
  const end = source.indexOf('\n}', start);
  expect(end, `${file} 中 ${name} 缺少收尾括号`).toBeGreaterThan(start);
  return source.slice(start, end + 2);
}

type AimEntry = { q: number; r: number; tone: string; kill: boolean; text: string };

function runAimPreview(
  file: string,
  opts: {
    simultaneous: boolean;
    interactionMode: string;
    selectedUnitId?: string;
    hoverCell?: { q: number; r: number };
    rangeHighlights?: Array<{ q: number; r: number }>;
    units: Array<Record<string, unknown>>;
    headquarters?: Array<Record<string, unknown>>;
    aimCells?: Array<{ q: number; r: number }> | null;
    myPlayer?: string;
    balance?: Record<string, unknown>;
  },
): { cells: Array<{ q: number; r: number }>; entries: AimEntry[] } | null {
  const units = new Map(opts.units.map(u => [String(u.id), u]));
  const headquarters = new Map((opts.headquarters ?? []).map(h => [String(h.id), h]));
  const allEntities = [...units.values(), ...headquarters.values()];
  const context = createContext({
    state: { units, headquarters },
    hoverCell: opts.hoverCell ?? null,
    interactionMode: opts.interactionMode,
    selectedUnitId: opts.selectedUnitId ?? null,
    rangeHighlights: opts.rangeHighlights ?? [],
    myPlayer: opts.myPlayer ?? 'player_a',
    gameConfig: { balance: opts.balance ?? { damageVarianceRange: 3, minimumDamage: 1, healVarianceRange: 6 } },
    isSimultaneous: () => opts.simultaneous,
    shapeAimFor: (_unit: unknown, _kind: string, q: number, r: number) => {
      if (opts.aimCells === null) return null;
      if (opts.aimCells) return { cells: opts.aimCells };
      return { cells: [{ q, r }] };
    },
    entityAt: (q: number, r: number) =>
      allEntities.find(e => (e as { q: number; r: number }).q === q && (e as { q: number; r: number }).r === r) ?? null,
  });
  return new Script(`(${loadFn(file, 'aimPreview')})()`).runInContext(context);
}

describe('attack preview on player clients', () => {
  const attacker = { id: 'a1', owner: 'player_a', type: 'infantry', q: 0, r: 0, attack: 31, defense: 7, alive: true };
  const enemy = { id: 'e1', owner: 'player_b', type: 'heavy', q: 1, r: 0, hp: 50, maxHp: 140, defense: 7, alive: true };

  it('predicts the damage range mirroring the engine formula', () => {
    for (const file of PLAYER_CLIENTS) {
      const preview = runAimPreview(file, {
        simultaneous: false,
        interactionMode: 'attack_mode',
        selectedUnitId: 'a1',
        hoverCell: { q: 1, r: 0 },
        rangeHighlights: [{ q: 1, r: 0 }],
        units: [attacker, enemy],
      });
      // max(1, 31-7±3) = 21~27。
      expect(preview?.entries).toEqual([{ q: 1, r: 0, tone: 'attack', kill: false, text: '-21~27' }]);
    }
  });

  it('marks lethal attacks and clamps to current HP', () => {
    for (const file of PLAYER_CLIENTS) {
      const preview = runAimPreview(file, {
        simultaneous: false,
        interactionMode: 'attack_mode',
        selectedUnitId: 'a1',
        hoverCell: { q: 1, r: 0 },
        rangeHighlights: [{ q: 1, r: 0 }],
        units: [attacker, { ...enemy, hp: 20 }],
      });
      expect(preview?.entries[0]?.kill).toBe(true);
      expect(preview?.entries[0]?.text).toBe('-20 致死');
    }
  });

  it('previews heal amounts for friendly injured units', () => {
    for (const file of PLAYER_CLIENTS) {
      const support = { id: 's1', owner: 'player_a', type: 'support', q: 0, r: 0, healPower: 20, alive: true };
      const wounded = { id: 'w1', owner: 'player_a', type: 'scout', q: 1, r: 0, hp: 30, maxHp: 60, alive: true };
      const preview = runAimPreview(file, {
        simultaneous: false,
        interactionMode: 'heal_mode',
        selectedUnitId: 's1',
        hoverCell: { q: 1, r: 0 },
        rangeHighlights: [{ q: 1, r: 0 }],
        units: [support, wounded],
      });
      // healPower 20 + 0~6 浮动。
      expect(preview?.entries).toEqual([{ q: 1, r: 0, tone: 'heal', kill: false, text: '+20~26' }]);
    }
  });

  it('expands shape coverage in simultaneous mode and skips friendly cells', () => {
    for (const file of PLAYER_CLIENTS) {
      const cells = [{ q: 1, r: 0 }, { q: 2, r: 0 }];
      const ownScout = { id: 'f1', owner: 'player_a', type: 'scout', q: 2, r: 0, hp: 60, maxHp: 60, alive: true };
      const preview = runAimPreview(file, {
        simultaneous: true,
        interactionMode: 'attack_mode',
        selectedUnitId: 'a1',
        hoverCell: { q: 2, r: 0 },
        rangeHighlights: [{ q: 1, r: 0 }, { q: 2, r: 0 }],
        units: [attacker, enemy, ownScout],
        aimCells: cells,
      });
      // 覆盖两格：敌方重装有一条预演，友军格子友军免伤不显示。
      expect(preview?.cells).toEqual(cells);
      expect(preview?.entries).toHaveLength(1);
      expect(preview?.entries[0]?.text).toBe('-21~27');
    }
  });

  it('returns null when not aiming or hovering outside the highlighted cells', () => {
    for (const file of PLAYER_CLIENTS) {
      expect(runAimPreview(file, {
        simultaneous: false, interactionMode: 'idle', selectedUnitId: 'a1',
        hoverCell: { q: 1, r: 0 }, rangeHighlights: [{ q: 1, r: 0 }], units: [attacker, enemy],
      })).toBeNull();
      expect(runAimPreview(file, {
        simultaneous: false, interactionMode: 'attack_mode', selectedUnitId: 'a1',
        hoverCell: { q: 0, r: 1 }, rangeHighlights: [{ q: 1, r: 0 }], units: [attacker, enemy],
      })).toBeNull();
      // 顺序模式空覆盖不提示。
      expect(runAimPreview(file, {
        simultaneous: false, interactionMode: 'attack_mode', selectedUnitId: 'a1',
        hoverCell: { q: 1, r: 0 }, rangeHighlights: [{ q: 1, r: 0 }], units: [attacker],
      })).toBeNull();
    }
  });

  it('gates hover range hints to idle browsing (not while aiming or replaying)', () => {
    for (const file of PLAYER_CLIENTS) {
      const unit = { id: 'a1', owner: 'player_a', type: 'infantry', q: 0, r: 0, alive: true };
      const mkContext = (overrides: Record<string, unknown>) => createContext({
        state: { cells: [{ q: 0, r: 0 }], units: new Map([['a1', unit]]) },
        hoverCell: { q: 0, r: 0 },
        interactionMode: 'idle',
        rangeHighlights: [],
        playback: { isActive: () => false },
        gameConfig: {},
        window: { BoardInspect: { rangeHintFor: () => ({ kind: 'attack', cells: [{ q: 1, r: 0 }] }) } },
        ...overrides,
      });
      const src = loadFn(file, 'hoverRangeHint');
      const hint = new Script(`(${src})()`).runInContext(mkContext({}));
      expect(hint?.unit?.id).toBe('a1');
      // 瞄准模式 / 射程高亮中 / 结算回放中都不显示悬停提示。
      expect(new Script(`(${src})()`).runInContext(mkContext({ interactionMode: 'attack_mode' }))).toBeNull();
      expect(new Script(`(${src})()`).runInContext(mkContext({ rangeHighlights: [{ q: 1, r: 0 }] }))).toBeNull();
      expect(new Script(`(${src})()`).runInContext(mkContext({ playback: { isActive: () => true } }))).toBeNull();
      expect(new Script(`(${src})()`).runInContext(mkContext({ hoverCell: null }))).toBeNull();
    }
  });
});
