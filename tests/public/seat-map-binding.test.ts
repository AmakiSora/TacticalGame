import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * R2 行为级用例：把 `renderMapPreview` 从客户端源码里抽出来，用桩替换它依赖的绘图工具，
 * 验证「座位 → 出生位」按 `slot.id` 绑定（而不是按下标），并锁死「不传 overlay 时输出不变」。
 * 夹具用 artillery-zone 的真实形状：layouts['2'] = [slot_east, slot_west]，
 * 而 spawnSlots 顺序是 [slot_east, slot_northeast, slot_northwest, slot_west]（下标 0 / 3）。
 */
const CLIENTS = ['public/play.js', 'public/play-m.js'];

const STUBS = `
  const esc = value => String(value);
  const OWNER_COLOR = {};
  const previewHexCornersRaw = (q, r, size) => [
    { x: q * size, y: r * size },
    { x: q * size + size, y: r * size + size },
  ];
  const previewHexToRaw = (q, r, size) => ({ x: q * size, y: r * size });
  const CONTROL_POINT_NAMES = {};
  const UNIT_NAMES = {};
  const previewUnitStatAttrs = () => '';
`;

function extractFunction(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`源码里找不到 ${name}()`);
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  let index = braceStart;
  for (; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) {
        index += 1;
        break;
      }
    }
  }
  return source.slice(start, index);
}

type RenderPreview = (preview: unknown, seatView?: unknown) => string;

function harness(path: string): RenderPreview {
  const source = readFileSync(path, 'utf-8');
  const body = `${STUBS}
    ${extractFunction(source, 'renderMapPreview')}
    return renderMapPreview;`;
  return new Function(body)() as RenderPreview;
}

/** artillery-zone 的真实形状：4 个槽位里 layouts['2'] 只取 east 和 west（下标 0 / 3）。 */
function artilleryPreview() {
  return {
    cells: [{ q: 0, r: 0, terrain: 'plain' }],
    controlPoints: [],
    spawnSlots: [
      { id: 'slot_east', headquarters: { q: 1, r: 0 }, startingUnits: [] },
      { id: 'slot_northeast', headquarters: { q: 1, r: 1 }, startingUnits: [] },
      { id: 'slot_northwest', headquarters: { q: 0, r: 1 }, startingUnits: [] },
      { id: 'slot_west', headquarters: { q: -1, r: 1 }, startingUnits: [] },
    ],
    mode: 'standard',
    headquartersSpec: { hp: 100, defense: 10 },
    deployFromHq: true,
  };
}

describe('map spawn markers ↔ seats (R2)', () => {
  for (const path of CLIENTS) {
    it(`keeps the marker output untouched when no overlay is given (${path})`, () => {
      const render = harness(path);
      const preview = artilleryPreview();
      const plain = render(preview);
      // 默认参数与显式 null 必须一致：renderMapPreview 被 6 处复用，不传 overlay 时不能变样。
      expect(render(preview, null)).toBe(plain);
      expect(plain).not.toContain('seat-mark');
      expect(plain).not.toContain('data-slot-id');
      expect(plain).not.toContain('is-unused');
      // 空插值不能留下多余空白行（否则 6 处预览断言集体漂移）。
      expect(plain).toContain('></rect>\n    </g>');
    });

    it(`binds seat numbers by slot id, not by spawn array index (${path})`, () => {
      const render = harness(path);
      const marks = new Map([
        ['slot_east', { seat: 1, name: 'A', color: '#ff0000', preview: false }],
        ['slot_west', { seat: 2, name: 'B', color: '#00ff00', preview: false }],
      ]);
      const html = render(artilleryPreview(), { slots: ['slot_east', 'slot_west'], marks });

      // 1 号座位落在 spawnSlots 第 0 个槽位上，2 号座位落在第 3 个（下标 0 / 3，不是 0 / 1）。
      expect(html.indexOf('>1</text>')).toBeGreaterThan(-1);
      expect(html.indexOf('data-slot-id="slot_east"')).toBeGreaterThan(-1);
      expect(html.indexOf('data-slot-id="slot_west"')).toBeGreaterThan(-1);
      expect(html.indexOf('>1</text>')).toBeLessThan(html.indexOf('data-slot-id="slot_west"'));
      expect(html.indexOf('data-slot-id="slot_west"')).toBeLessThan(html.indexOf('>2</text>'));
      // 本局候选之外的出生位要标成未使用，不能和"没人坐的座位"混为一谈。
      expect(html).toContain('is-unused');
      expect(html.match(/is-unused/g)?.length).toBe(2);
    });

    it(`gives every spawn marker the hover hook while a seat view is active (${path})`, () => {
      const render = harness(path);
      const marks = new Map([
        ['slot_east', { seat: 1, name: 'A', color: '#ff0000', preview: false }],
        ['slot_west', { seat: 2, name: 'B', color: '#00ff00', preview: false }],
      ]);
      const html = render(artilleryPreview(), { slots: ['slot_east', 'slot_west'], marks });
      // 4 个出生位都挂 data-slot-id：已分配的两个供座位行互亮，未使用的两个也要有稳定钩子，
      // 否则「悬停未使用出生位」在两条验收里表现不一致（降透明有、钩子没有）。
      expect(html.match(/data-slot-id="slot_/g)?.length).toBe(4);
      expect(html).toContain('data-slot-id="slot_northeast"');
      expect(html).toContain('data-slot-id="slot_northwest"');
      expect(html.match(/is-unused/g)?.length).toBe(2);
    });

    it(`keeps the hook on annihilation spawn markers and headquarters (${path})`, () => {
      const render = harness(path);
      const marks = new Map([['slot_east', { seat: 1, name: 'A', color: '#ff0000', preview: false }]]);
      // 歼灭模式画的是 spawn 标记，标准模式画的是 headquarters 标记：两条路径都要带钩子。
      const annihilation = render({ ...artilleryPreview(), mode: 'annihilation' }, { slots: ['slot_east'], marks });
      const standard = render(artilleryPreview(), { slots: ['slot_east'], marks });
      expect(annihilation).toContain('data-marker-kind="spawn"');
      expect(annihilation.match(/data-slot-id="slot_/g)?.length).toBe(4);
      expect(standard).toContain('data-marker-kind="headquarters"');
      expect(standard.match(/data-slot-id="slot_/g)?.length).toBe(4);
    });

    it(`marks draft overlays as preview (${path})`, () => {
      const render = harness(path);
      const marks = new Map([
        ['slot_east', { seat: 1, name: 'A', color: '#ff0000', preview: true }],
      ]);
      const draft = render(artilleryPreview(), { slots: ['slot_east'], marks });
      const saved = render(artilleryPreview(), {
        slots: ['slot_east'],
        marks: new Map([['slot_east', { seat: 1, name: 'A', color: '#ff0000', preview: false }]]),
      });
      expect(draft).toContain('is-preview');
      expect(saved).not.toContain('is-preview');
    });
  }
});

/**
 * S1：直接跑 `lobbySeatView()` 本身（而不是喂一个已建好的 Map），
 * 抓「内部改成按下标 / 按加入顺序」这类错误。夹具换成 snowflake 3 人：
 * layouts['3'] = [slot_east, slot_northwest, slot_southwest]，而 spawnSlots 顺序是
 * [east, northeast, northwest, west, southwest, southeast]（对应下标 0 / 2 / 4）。
 */
const SNOWFLAKE_LAYOUTS: Record<string, string[]> = {
  '3': ['slot_east', 'slot_northwest', 'slot_southwest'],
};

interface SeatMark {
  seat: number;
  name: string;
  color: string;
  preview: boolean;
  first: boolean;
}

interface SeatViewHarness {
  setLobby(lobby: unknown): void;
  setDraft(rows: Array<{ id: string; name: string }> | null, first?: number): void;
  lobbySeatView(dimUnused?: boolean): { slots: string[]; marks: Map<string, SeatMark> } | null;
  render(): string;
}

function seatViewHarness(path: string, preview: unknown): SeatViewHarness {
  const source = readFileSync(path, 'utf-8');
  const body = `${STUBS}
    let latestLobby = null;
    let seatDraft = null;
    let seatDraftFirst = 0;
    ${extractFunction(source, 'isSimultaneousLobby')}
    ${extractFunction(source, 'seatViewOf')}
    ${extractFunction(source, 'currentFirstSeat')}
    ${extractFunction(source, 'lobbyPlayerNames')}
    ${extractFunction(source, 'lobbySeatView')}
    ${extractFunction(source, 'renderMapPreview')}
    return {
      setLobby(lobby) { latestLobby = lobby; },
      setDraft(rows, first = 0) {
        seatDraft = rows;
        seatDraftFirst = first;
      },
      lobbySeatView,
      render() { return renderMapPreview(preview, lobbySeatView()); },
    };
  `;
  return new Function('preview', body)(preview) as SeatViewHarness;
}

/** snowflake 真实形状：6 个出生位，layouts['3'] 只取 east / northwest / southwest（下标 0 / 2 / 4）。 */
function snowflakePreview() {
  return {
    cells: [{ q: 0, r: 0, terrain: 'plain' }],
    controlPoints: [],
    spawnSlots: [
      { id: 'slot_east', headquarters: { q: 1, r: 0 }, startingUnits: [] },
      { id: 'slot_northeast', headquarters: { q: 1, r: 1 }, startingUnits: [] },
      { id: 'slot_northwest', headquarters: { q: 0, r: 1 }, startingUnits: [] },
      { id: 'slot_west', headquarters: { q: -1, r: 1 }, startingUnits: [] },
      { id: 'slot_southwest', headquarters: { q: -1, r: 0 }, startingUnits: [] },
      { id: 'slot_southeast', headquarters: { q: 0, r: -1 }, startingUnits: [] },
    ],
    // 歼灭：不建总部，出生位改用「出生点」圆点（与同时回合的图形一致，便于复用同一夹具）。
    mode: 'annihilation',
    headquartersSpec: { hp: 100, defense: 10 },
    deployFromHq: true,
  };
}

/** 3 人 snowflake 大厅：seats 顺序即服务端编排顺序，名字故意留旧值以验证 S5 的现取。 */
function snowflakeLobby(order: string[], firstSeat = 0, mode = 'annihilation') {
  const names: Record<string, string> = { player_a: 'A', player_b: 'B', player_c: 'C' };
  const stale: Record<string, string> = { player_a: '旧A', player_b: '旧B', player_c: '旧C' };
  return {
    phase: 'lobby',
    mapId: 'snowflake',
    mode,
    seatMode: 'manual',
    seatVersion: 5,
    firstSeat,
    layoutSlots: [...SNOWFLAKE_LAYOUTS['3']!],
    players: Object.keys(names).map(id => ({ id, name: names[id] })),
    seats: order.map((id, index) => ({
      seat: index + 1,
      playerId: id,
      name: stale[id],
      spawnSlotId: SNOWFLAKE_LAYOUTS['3']![index] ?? null,
    })),
  };
}

describe('lobbySeatView maps seats by slot id (S1)', () => {
  for (const path of CLIENTS) {
    it(`maps 3 seats onto snowflake's skipped slot ids (${path})`, () => {
      const ui = seatViewHarness(path, snowflakePreview());
      ui.setLobby(snowflakeLobby(['player_a', 'player_b', 'player_c']));
      const view = ui.lobbySeatView()!;
      // 座位下标 0/1/2 → layoutSlots[0/1/2] = east / northwest / southwest；
      // 若内部改成按 spawnSlots 下标，2 号座会落到 northeast 上。
      expect([...view.marks.keys()]).toEqual(['slot_east', 'slot_northwest', 'slot_southwest']);
      expect(view.marks.get('slot_northwest')!.seat).toBe(2);
      expect(view.marks.get('slot_southwest')!.seat).toBe(3);
      // S5：标记上的名字来自 lobby.players，不是 seats 里的旧快照。
      expect(view.marks.get('slot_east')!.name).toBe('A');

      const html = ui.render();
      // 6 个出生位都挂钩子；其中 3 个不在 layouts['3'] 里，要降透明。
      expect(html.match(/data-slot-id="slot_/g)?.length).toBe(6);
      expect(html.match(/is-unused/g)?.length).toBe(3);
      const afterNorthwest = html.slice(html.indexOf('data-slot-id="slot_northwest"'));
      expect(afterNorthwest.indexOf('>2</text>')).toBeGreaterThan(-1);
      expect(afterNorthwest.indexOf('>2</text>')).toBeLessThan(afterNorthwest.indexOf('data-slot-id="slot_west"'));
    });

    it(`puts the first-seat badge on the saved first seat (${path})`, () => {
      const ui = seatViewHarness(path, snowflakePreview());
      // 先手下标 1 → 2 号座（northwest），角标只出现一次。
      ui.setLobby(snowflakeLobby(['player_c', 'player_a', 'player_b'], 1));
      const view = ui.lobbySeatView()!;
      expect([...view.marks.values()].filter(mark => mark.first)).toHaveLength(1);
      expect(view.marks.get('slot_northwest')!.first).toBe(true);
      expect(view.marks.get('slot_east')!.first).toBe(false);

      const html = ui.render();
      expect(html.match(/seat-first-badge/g)?.length).toBe(1);
      const afterNorthwest = html.slice(html.indexOf('data-slot-id="slot_northwest"'));
      expect(afterNorthwest.indexOf('seat-first-badge')).toBeGreaterThan(-1);
      expect(afterNorthwest.indexOf('seat-first-badge')).toBeLessThan(afterNorthwest.indexOf('data-slot-id="slot_west"'));
    });

    it(`moves the first-seat badge with the person during a draft drag (${path})`, () => {
      const ui = seatViewHarness(path, snowflakePreview());
      ui.setLobby(snowflakeLobby(['player_a', 'player_b', 'player_c'], 0));
      // 房主把 A 从 1 号座拖到 3 号座：moveSeatRow 会把先手下标一起挪到 2，先手人不变。
      ui.setDraft([
        { id: 'player_b', name: 'B' },
        { id: 'player_c', name: 'C' },
        { id: 'player_a', name: 'A' },
      ], 2);
      const view = ui.lobbySeatView()!;
      expect(view.marks.get('slot_east')!.seat).toBe(1);
      expect(view.marks.get('slot_east')!.first).toBe(false);
      expect(view.marks.get('slot_southwest')!.first).toBe(true);
      // 草稿态按**草稿顺序**铺标记：忽略草稿、按 lobby.seats 顺序铺时这里会是 A/B/C。
      expect(view.marks.get('slot_east')!.name).toBe('B');
      expect(view.marks.get('slot_northwest')!.name).toBe('C');
      expect(view.marks.get('slot_southwest')!.name).toBe('A');
      // 草稿态：三个标记都要标 preview。
      expect([...view.marks.values()].every(mark => mark.preview)).toBe(true);

      const html = ui.render();
      expect(html.match(/seat-first-badge/g)?.length).toBe(1);
      expect(html.match(/is-preview/g)?.length).toBeGreaterThan(0);
    });

    it(`gives no ownership when nothing is arranged (${path})`, () => {
      const ui = seatViewHarness(path, snowflakePreview());
      const lobby = { ...snowflakeLobby(['player_a', 'player_b', 'player_c']), seatMode: 'random' };
      ui.setLobby(lobby);
      const view = ui.lobbySeatView()!;
      // random 且无草稿：不伪造归属，也不画先手角标。
      expect(view.marks.size).toBe(0);
      const html = ui.render();
      expect(html).not.toContain('seat-mark');
      expect(html).not.toContain('seat-first-badge');
    });

    it(`puts no seat markers on the map of an empty room (${path})`, () => {
      const ui = seatViewHarness(path, snowflakePreview());
      // 0 人房：服务端 layoutSlots 是 []（layouts 里没有 '0'），整张视图为空。
      ui.setLobby({ ...snowflakeLobby([]), layoutSlots: [], seats: [], players: [] });
      expect(ui.lobbySeatView()).toBe(null);

      // 即便硬塞一组 layoutSlots，0 张座位也不产出任何标记 —— 地图上不能出现空座位圈。
      ui.setLobby({ ...snowflakeLobby([]), seats: [], players: [] });
      expect(ui.lobbySeatView()!.marks.size).toBe(0);
      const html = ui.render();
      expect(html).not.toContain('seat-mark');
      expect(html).not.toContain('seat-first-badge');
    });

    it(`never puts a first-seat badge on simultaneous / royale maps (${path})`, () => {
      const ui = seatViewHarness(path, snowflakePreview());
      for (const mode of ['simultaneous', 'royale']) {
        // 同时回合 / 大逃杀没有先手：地图上不挂任何角标，也不输出 data-seat-first。
        ui.setLobby(snowflakeLobby(['player_a', 'player_b', 'player_c'], 1, mode));
        const view = ui.lobbySeatView()!;
        expect([...view.marks.values()].every(mark => mark.first === false), mode).toBe(true);
        const html = ui.render();
        expect(html, mode).not.toContain('seat-first-badge');
        expect(html, mode).not.toContain('data-seat-first');
        // 座位号 → 出生位的映射本身不受影响。
        expect(view.marks.get('slot_northwest')!.seat).toBe(2);
      }
    });

    it(`keeps the first-seat badge wired into both clients and styles (${path})`, () => {
      const source = readFileSync(path, 'utf-8');
      expect(source, `${path} 缺先手角标`).toContain('class="seat-first-badge"');
      expect(source, `${path} 标记未带先手标记`).toContain('first: !simultaneous && index === firstSeat');
      // 先手口径统一走 currentFirstSeat()，地图与座位列表不能各算一套。
      expect(source, `${path} 先手口径未统一`).toContain('function currentFirstSeat(lobby)');
      expect(source, `${path} 座位列表未用统一口径`).toContain('const firstSeat = currentFirstSeat(lobby);');
      // S5：行内名字按 playerId 从 lobby.players 现取。
      expect(source, `${path} 行内名字未现取`).toContain('const liveNames = lobbyPlayerNames(lobby);');
      expect(source, `${path} 座位行仍用草稿里的旧名`).toContain('${esc(nameOf(player))}');
    });
  }

  for (const stylePath of ['public/play.css', 'public/play-m.css']) {
    it(`styles the first-seat badge (${stylePath})`, () => {
      const css = readFileSync(stylePath, 'utf-8');
      expect(css, `${stylePath} 缺先手角标样式`).toContain('.seat-first-badge {');
    });
  }
});
