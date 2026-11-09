import { existsSync, readFileSync } from 'node:fs';
import { createContext, Script } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/server.js';

type Entity = {
  id: string;
  owner?: string;
  type?: string;
  q: number;
  r: number;
  hp: number;
  maxHp: number;
  alive: boolean;
};

type AnimationView = {
  x: number;
  y: number;
  alpha: number;
  scale: number;
};

type BoardState = {
  units: Map<string, Entity>;
  headquarters: Map<string, Entity>;
  controlPoints: Map<string, { id: string; owner: string | null; q: number; r: number }>;
};

type BoardAnimationController = {
  requestRender(): void;
  reset(): void;
  syncState(state: BoardState, options: { animate: boolean }): void;
  recordEvent(event: { type: string; seq?: number; payload?: Record<string, unknown> }, state: BoardState): void;
  update(now: number): void;
  forEachUnit(callback: (entity: Entity, view: AnimationView) => void): void;
  forEachHeadquarters(callback: (entity: Entity, view: AnimationView) => void): void;
  drawEffects(context: RecordingContext, now: number): void;
  isActive(): boolean;
  _debugEffects(): string[];
};

type BoardAnimationApi = {
  createTerrainLayer(): {
    draw(target: { canvas: { width: number; height: number }; drawImage: (...args: unknown[]) => void },
      cells: unknown[], revision: number | undefined, layout: object, paint: (context: RecordingContext) => void): void;
  };
  create(options: {
    hexToPixel(q: number, r: number): { x: number; y: number };
    ownerColor(owner: string | null | undefined): string;
    unitSpec?(type: string | undefined): Record<string, unknown> | undefined;
    render?(now: number): void;
  }): BoardAnimationController;
};

class RecordingContext {
  calls: Array<{ name: string; args: unknown[] }> = [];
  strokeStyles: string[] = [];
  fillStyles: string[] = [];
  texts: string[] = [];
  globalAlpha = 1;
  lineWidth = 1;
  lineCap = 'butt';
  shadowColor = '';
  shadowBlur = 0;
  font = '';
  textAlign = 'start';

  set strokeStyle(value: string) { this.strokeStyles.push(value); }
  set fillStyle(value: string) { this.fillStyles.push(value); }
  save() {}
  restore() {}
  translate(...args: number[]) { this.calls.push({ name: 'translate', args }); }
  rotate(...args: number[]) { this.calls.push({ name: 'rotate', args }); }
  createLinearGradient() { return { addColorStop() {} }; }
  beginPath() {}
  closePath() {}
  stroke() {}
  fill() { this.calls.push({ name: 'fill', args: [] }); }
  moveTo(...args: number[]) { this.calls.push({ name: 'moveTo', args }); }
  lineTo(...args: number[]) { this.calls.push({ name: 'lineTo', args }); }
  arc(...args: number[]) { this.calls.push({ name: 'arc', args }); }
  strokeText(text: string, ...args: number[]) { this.texts.push(text); this.calls.push({ name: 'strokeText', args }); }
  fillText(text: string, ...args: number[]) { this.texts.push(text); this.calls.push({ name: 'fillText', args }); }
}

function loadAnimation(reducedMotion = false) {
  if (!existsSync('public/board-animation.js')) return null;
  let currentTime = 0;
  const animationWindow = {
    matchMedia: () => ({ matches: reducedMotion }),
  } as { matchMedia: () => { matches: boolean }; BoardAnimation?: BoardAnimationApi };
  let frameId = 0;
  const frames = new Map<number, (now: number) => void>();
  const listeners: Array<() => void> = [];
  const document = {
    createElement() { return { width: 0, height: 0, getContext: () => new RecordingContext() }; },
    hidden: false,
    addEventListener(type: string, listener: () => void) { if (type === 'visibilitychange') listeners.push(listener); },
  };
  const context = createContext({
    window: animationWindow, document,
    performance: { now: () => currentTime },
    requestAnimationFrame(callback: (now: number) => void) { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame(id: number) { frames.delete(id); },
  });
  new Script(readFileSync('public/board-animation.js', 'utf8')).runInContext(context);
  return {
    api: animationWindow.BoardAnimation,
    context,
    setTime(value: number) { currentTime = value; },
    pendingFrames: () => frames.size,
    frame(now: number) {
      currentTime = now;
      const callbacks = [...frames];
      frames.clear();
      for (const [, callback] of callbacks) callback(now);
    },
    setHidden(hidden: boolean) { document.hidden = hidden; listeners.forEach(listener => listener()); },
  };
}

function createState(): BoardState {
  return {
    units: new Map([
      ['unit-1', { id: 'unit-1', owner: 'player_a', q: 0, r: 0, hp: 100, maxHp: 100, alive: true }],
    ]),
    headquarters: new Map([
      ['hq-1', { id: 'hq-1', owner: 'player_b', q: 3, r: 0, hp: 200, maxHp: 200, alive: true }],
    ]),
    controlPoints: new Map([
      ['point-1', { id: 'point-1', owner: 'player_a', q: 1, r: 1 }],
    ]),
  };
}

function createController(loaded: NonNullable<ReturnType<typeof loadAnimation>>) {
  expect(loaded.api).toBeDefined();
  return loaded.api!.create({
    hexToPixel: (q, r) => ({ x: q * 20, y: r * 20 }),
    ownerColor: owner => owner === 'player_a' ? '#66ccff' : '#ff9966',
  });
}

describe('shared board animation layer', () => {
  /** 页面以 ESM module 入口加载客户端，board-animation 由入口静态 import 引入。 */
  async function expectEntryImportsShared(
    app: Awaited<ReturnType<typeof buildServer>>,
    pageUrl: string,
    entryUrl: string,
  ): Promise<void> {
    const page = await app.inject({ method: 'GET', url: pageUrl });
    const entry = await app.inject({ method: 'GET', url: entryUrl });
    expect(page.statusCode).toBe(200);
    expect(entry.statusCode).toBe(200);
    const importIndex = entry.body.indexOf("import './board-animation.js'");
    const bodyIndex = entry.body.indexOf('const HEX_SIZE');
    expect(importIndex).toBeGreaterThan(-1);
    expect(importIndex).toBeLessThan(bodyIndex);
  }

  it('is imported by desktop spectator code', async () => {
    const app = await buildServer();
    try {
      await expectEntryImportsShared(app, '/spectator.html', '/app.js');
    } finally {
      await app.close();
    }
  });

  it('is imported by desktop player code', async () => {
    const app = await buildServer();
    try {
      await expectEntryImportsShared(app, '/play.html', '/play.js');
    } finally {
      await app.close();
    }
  });

  it('is imported by both mobile board clients', async () => {
    const app = await buildServer();
    try {
      await expectEntryImportsShared(app, '/spectator-m.html', '/spectator-m.js');
      await expectEntryImportsShared(app, '/play-m.html', '/play-m.js');
    } finally {
      await app.close();
    }
  });

  it('reuses terrain pixels until cells, terrain, layout or backing dimensions change', () => {
    const layer = loadAnimation()!.api!.createTerrainLayer();
    const target = { canvas: { width: 400, height: 300 }, drawImage() {} };
    let paints = 0;
    const paint = () => { paints++; };
    let cells = [{ q: 0, r: 0, terrain: 'mountain' }];
    let layout = {};
    layer.draw(target, cells, undefined, layout, paint);
    layer.draw(target, cells, undefined, layout, paint);
    expect(paints).toBe(1);
    layer.draw(target, cells, 1, layout, paint);
    expect(paints).toBe(2);
    layout = {};
    layer.draw(target, cells, 1, layout, paint);
    cells = [...cells];
    layer.draw(target, cells, 1, layout, paint);
    target.canvas.width++;
    layer.draw(target, cells, 1, layout, paint);
    target.canvas.height++;
    layer.draw(target, cells, 1, layout, paint);
    expect(paints).toBe(6);
  });

  it.each(['app.js', 'spectator-m.js', 'play.js', 'play-m.js'])('%s invalidates terrain only for an actual terrain change', file => {
    const source = readFileSync(`public/${file}`, 'utf8');
    const start = source.indexOf('function setCellTerrain(');
    const state = { cells: [{ q: 1, r: 2, terrain: 'mountain' }], terrainRevision: 0 };
    const context = createContext({ state });
    new Script(`${source.slice(start, source.indexOf('\n}', start) + 2)}
      setCellTerrain(state, 1, 2, 'mountain');
      setCellTerrain(state, 9, 9, 'plain');
    `).runInContext(context);
    expect(state.terrainRevision).toBe(0);
    new Script("setCellTerrain(state, 1, 2, 'plain');").runInContext(context);
    expect(state.terrainRevision).toBe(1);
    expect(state.cells[0].terrain).toBe('plain');
  });

  it('interpolates movement and hit points instead of snapping to the next state', () => {
    const loaded = loadAnimation();
    expect(loaded).not.toBeNull();
    if (!loaded) return;
    const animation = createController(loaded);
    const state = createState();
    animation.syncState(state, { animate: false });

    const unit = state.units.get('unit-1')!;
    unit.q = 2;
    unit.hp = 40;
    animation.syncState(state, { animate: true });
    animation.update(130);

    let rendered: { x: number; hp: number } | null = null;
    animation.forEachUnit((entity, view) => { rendered = { x: view.x, hp: entity.hp }; });
    expect(rendered).not.toBeNull();
    expect(rendered!.x).toBeGreaterThan(0);
    expect(rendered!.x).toBeLessThan(40);
    expect(rendered!.hp).toBeGreaterThan(40);
    expect(rendered!.hp).toBeLessThan(100);
  });

  it('reports activity only while a view or effect still needs animation frames', () => {
    const loaded = loadAnimation();
    expect(loaded).not.toBeNull();
    if (!loaded) return;
    const animation = createController(loaded);
    const state = createState();
    animation.syncState(state, { animate: false });
    expect(animation.isActive()).toBe(false);

    state.units.get('unit-1')!.q = 2;
    animation.syncState(state, { animate: true });
    expect(animation.isActive()).toBe(true);
    for (let frame = 0; frame < 80; frame++) animation.update(frame * 16);
    expect(animation.isActive()).toBe(false);

    animation.recordEvent({ type: 'move', payload: { toQ: 2, toR: 0 } }, state);
    expect(animation.isActive()).toBe(true);
    animation.update(1000);
    expect(animation.isActive()).toBe(false);
  });

  for (const file of ['app.js', 'spectator-m.js', 'play.js', 'play-m.js']) {
    it(`clears ${file}'s actual canvas when reset leaves an empty board`, () => {
      const source = readFileSync(new URL(`../../public/${file}`, import.meta.url), 'utf8');
      const start = source.indexOf('function drawBoard(');
      const canvas = { width: 400, height: 300 };
      let clears = 0;
      const context = createContext({
        canvas, els: { canvas }, state: { cells: [] }, performance: { now: () => 0 },
        ctx: { clearRect() { clears++; }, fillRect() {} },
      });
      new Script(`${source.slice(start, source.indexOf('\n}', start) + 2)}\ndrawBoard();`).runInContext(context);
      expect(clears).toBe(1);
    });

    it(`drives ${file}'s actual animation binding only on demand and draws the terminal frame`, () => {
      const loaded = loadAnimation()!;
      const source = readFileSync(new URL(`../../public/${file}`, import.meta.url), 'utf8');
      const start = source.indexOf('const boardAnimation =');
      const binding = source.slice(start, source.indexOf('\n});', start) + 4);
      const drawn: Array<{ x: number; hp: number; effects: string[] }> = [];
      let animation: BoardAnimationController;
      Object.assign(loaded.context, {
        hexToPixel: (q: number, r: number) => ({ x: q * 20, y: r * 20 }),
        ownerColor: () => '#fff', OWNER_COLOR: {}, gameConfig: {},
        drawBoard() {
          let x = -1, hp = -1;
          animation.forEachUnit((unit, view) => { x = view.x; hp = unit.hp; });
          drawn.push({ x, hp, effects: animation._debugEffects() });
        },
      });
      animation = new Script(`${binding}\nboardAnimation`).runInContext(loaded.context) as BoardAnimationController;
      expect(loaded.pendingFrames()).toBe(0);
      const state = createState();
      animation.syncState(state, { animate: false });
      loaded.frame(0);
      expect(loaded.pendingFrames()).toBe(0);
      const idleCount = drawn.length;
      loaded.frame(16);
      expect(drawn).toHaveLength(idleCount);

      state.units.get('unit-1')!.q = 2;
      state.units.get('unit-1')!.hp = 40;
      animation.syncState(state, { animate: true });
      animation.requestRender();
      expect(loaded.pendingFrames()).toBe(1);
      loaded.frame(32);
      expect(drawn.at(-1)!.x).toBeGreaterThan(0);
      expect(drawn.at(-1)!.x).toBeLessThan(40);
      for (let now = 48; now <= 1600 && loaded.pendingFrames(); now += 16) loaded.frame(now);
      expect(loaded.pendingFrames()).toBe(0);
      expect(drawn.at(-1)).toEqual({ x: 40, hp: 40, effects: [] });

      loaded.setTime(1600);
      animation.recordEvent({ type: 'move', payload: { toQ: 2, toR: 0 } }, state);
      expect(loaded.pendingFrames()).toBe(1);
      loaded.frame(1700);
      expect(drawn.at(-1)!.effects).toEqual(['ring']);
      loaded.frame(2200);
      expect(drawn.at(-1)!.effects).toEqual([]);
      expect(loaded.pendingFrames()).toBe(0);
      // 入口不能另留一条永久 RAF 链；上面的绘制均由真实共享控制器调度。
      expect(source).not.toContain('requestAnimationFrame(renderLoop)');
    });
  }

  it('wakes for delayed heal aggregation alone, then clears its last effect frame', () => {
    const loaded = loadAnimation()!;
    const drawn: string[][] = [];
    const animation = loaded.api!.create({
      hexToPixel: (q, r) => ({ x: q * 20, y: r * 20 }), ownerColor: () => '#fff',
      render: () => { drawn.push(animation._debugEffects()); },
    });
    const state = createState();
    animation.syncState(state, { animate: false });
    loaded.frame(0);
    expect(loaded.pendingFrames()).toBe(0);
    for (const targetId of ['unit-1', 'hq-1']) {
      animation.recordEvent({ type: 'heal', payload: { supportId: 'unit-1', targetId, amount: 12, roundNumber: 1 } }, state);
    }
    expect(loaded.pendingFrames()).toBe(1);
    loaded.frame(32);
    expect(drawn.at(-1)).toEqual([]);
    expect(loaded.pendingFrames()).toBe(1);
    loaded.frame(64);
    expect(drawn.at(-1)!.filter(kind => kind === 'healWave')).toHaveLength(1);
    expect(drawn.at(-1)!.filter(kind => kind === 'damageText')).toHaveLength(2);
    loaded.frame(900);
    expect(drawn.at(-1)).toEqual([]);
    expect(loaded.pendingFrames()).toBe(0);
  });

  it('cancels hidden frames, wakes on return, and drops old heals/effects on replay reset', () => {
    const loaded = loadAnimation()!;
    let draws = 0;
    const animation = loaded.api!.create({
      hexToPixel: (q, r) => ({ x: q * 20, y: r * 20 }), ownerColor: () => '#fff',
      render: () => { draws++; },
    });
    const state = createState();
    animation.syncState(state, { animate: false });
    loaded.frame(0);
    animation.recordEvent({ type: 'move', payload: { toQ: 2, toR: 0 } }, state);
    loaded.setHidden(true);
    expect(loaded.pendingFrames()).toBe(0);
    state.units.get('unit-1')!.q = 5;
    animation.syncState(state, { animate: true });
    loaded.frame(16);
    expect(draws).toBe(1);
    loaded.setHidden(false);
    expect(loaded.pendingFrames()).toBe(1);
    loaded.frame(32);
    expect(draws).toBe(2);
    animation.recordEvent({ type: 'heal', payload: { supportId: 'unit-1', targetId: 'unit-1', amount: 12 } }, state);
    // 回放跳转/重置使用的真实接口序列：reset + immediate sync。
    animation.reset();
    state.units.get('unit-1')!.q = 1;
    animation.syncState(state, { animate: false });
    expect(loaded.pendingFrames()).toBe(1);
    loaded.frame(100);
    expect(animation._debugEffects()).toEqual([]);
    expect(loaded.pendingFrames()).toBe(0);
    let x = -1;
    animation.forEachUnit((_entity, view) => { x = view.x; });
    expect(x).toBe(20);
    animation.reset();
    loaded.frame(116);
    expect(loaded.pendingFrames()).toBe(0);
    loaded.setHidden(true);
    loaded.setHidden(false);
    expect(loaded.pendingFrames()).toBe(0);
  });

  it('draws attack, healing, capture, deployment, movement, and destruction feedback', () => {
    const loaded = loadAnimation();
    expect(loaded).not.toBeNull();
    if (!loaded) return;
    const animation = createController(loaded);
    const state = createState();
    animation.syncState(state, { animate: false });

    const events = [
      { type: 'attack', payload: { attackerId: 'unit-1', targetId: 'hq-1' } },
      { type: 'heal', payload: { supportId: 'unit-1', targetId: 'unit-1' } },
      { type: 'control_point_captured', payload: { pointId: 'point-1' } },
      { type: 'deploy', payload: { unitId: 'unit-2', q: 2, r: 1 } },
      { type: 'move', payload: { unitId: 'unit-1', toQ: 2, toR: 0 } },
      { type: 'unit_death', payload: { unitId: 'unit-1' } },
      { type: 'headquarters_destroyed', payload: { headquartersId: 'hq-1' } },
      { type: 'demolish', payload: { q: 1, r: 2 } },
    ];
    for (const event of events) animation.recordEvent(event, state);

    const context = new RecordingContext();
    loaded.setTime(100);
    animation.drawEffects(context, 100);

    expect(context.calls.some(call => call.name === 'lineTo')).toBe(true);
    expect(context.calls.filter(call => call.name === 'arc').length).toBeGreaterThanOrEqual(5);
    expect(context.calls.some(call => call.name === 'fill')).toBe(true);
    expect(context.strokeStyles).toEqual(expect.arrayContaining([
      '#ff5c7a',
      '#3effc8',
      '#66ccff',
      '#ffd23e',
      '#6ea8ff',
      '#ff8a5c',
      '#ff9a3d',
    ]));
  });

  it('keeps removed entities long enough to fade, then releases their views', () => {
    const loaded = loadAnimation();
    expect(loaded).not.toBeNull();
    if (!loaded) return;
    const animation = createController(loaded);
    const state = createState();
    animation.syncState(state, { animate: false });

    state.units.get('unit-1')!.alive = false;
    state.headquarters.delete('hq-1');
    animation.syncState(state, { animate: true });
    animation.update(16);

    let units = 0;
    let headquarters = 0;
    animation.forEachUnit(() => { units++; });
    animation.forEachHeadquarters(() => { headquarters++; });
    expect(units).toBe(1);
    expect(headquarters).toBe(1);

    for (let frame = 0; frame < 80; frame++) animation.update(32 + frame * 16);
    units = 0;
    headquarters = 0;
    animation.forEachUnit(() => { units++; });
    animation.forEachHeadquarters(() => { headquarters++; });
    expect(units).toBe(0);
    expect(headquarters).toBe(0);
  });

  it('settles immediately while retaining one-frame feedback for reduced motion', () => {
    const loaded = loadAnimation(true);
    expect(loaded).not.toBeNull();
    if (!loaded) return;
    const animation = createController(loaded);
    const state = createState();
    animation.syncState(state, { animate: false });
    state.units.get('unit-1')!.q = 2;
    animation.syncState(state, { animate: true });

    let x = 0;
    animation.forEachUnit((_entity, view) => { x = view.x; });
    expect(x).toBe(40);

    animation.recordEvent({ type: 'move', payload: { toQ: 2, toR: 0 } }, state);
    const initialContext = new RecordingContext();
    animation.drawEffects(initialContext, 0);
    expect(initialContext.calls.some(call => call.name === 'arc')).toBe(true);

    animation.update(2);
    const settledContext = new RecordingContext();
    animation.drawEffects(settledContext, 2);
    expect(settledContext.calls).toHaveLength(0);
  });

  it('plays a single pierce for a multi-target line attack and per-target hit feedback', () => {
    const loaded = loadAnimation();
    expect(loaded).not.toBeNull();
    if (!loaded) return;
    const animation = loaded.api!.create({
      hexToPixel: (q, r) => ({ x: q * 20, y: r * 20 }),
      ownerColor: () => '#66ccff',
      unitSpec: type => type === 'infantry'
        ? { attackShape: { type: 'line', length: 2 } }
        : undefined,
    });
    const state = createState();
    state.units.get('unit-1')!.type = 'infantry';
    state.units.set('unit-2', { id: 'unit-2', owner: 'player_b', q: 1, r: 0, hp: 80, maxHp: 100, alive: true });
    state.units.set('unit-3', { id: 'unit-3', owner: 'player_b', q: 2, r: 0, hp: 80, maxHp: 100, alive: true });
    animation.syncState(state, { animate: false });

    // 同一次 line 攻击的两个命中事件（同 attackerId + roundNumber）。
    animation.recordEvent({
      type: 'attack', seq: 11,
      payload: {
        attackerId: 'unit-1', q: 1, r: 0, aimQ: 2, aimR: 0, hit: true,
        shape: 'line', targetId: 'unit-2', actualDamage: 30, roundNumber: 3,
      },
    }, state);
    animation.recordEvent({
      type: 'attack', seq: 12,
      payload: {
        attackerId: 'unit-1', q: 2, r: 0, aimQ: 2, aimR: 0, hit: true,
        shape: 'line', targetId: 'unit-3', actualDamage: 25, roundNumber: 3,
      },
    }, state);

    const kinds = animation._debugEffects();
    expect(kinds.filter(kind => kind === 'pierce')).toHaveLength(1);
    expect(kinds.filter(kind => kind === 'hitFlash')).toHaveLength(2);
    expect(kinds.filter(kind => kind === 'damageText')).toHaveLength(2);

    const context = new RecordingContext();
    loaded.setTime(100);
    animation.drawEffects(context, 100);
    expect(context.strokeStyles).toContain('#ffb347');
    expect(context.texts).toEqual(expect.arrayContaining(['-30', '-25']));
  });

  it('plays the arc slash on an empty-cell miss without hit feedback', () => {
    const loaded = loadAnimation();
    expect(loaded).not.toBeNull();
    if (!loaded) return;
    const animation = loaded.api!.create({
      hexToPixel: (q, r) => ({ x: q * 20, y: r * 20 }),
      ownerColor: () => '#66ccff',
      unitSpec: type => type === 'heavy' ? { attackShape: { type: 'arc' } } : undefined,
    });
    const state = createState();
    state.units.get('unit-1')!.type = 'heavy';
    animation.syncState(state, { animate: false });

    animation.recordEvent({
      type: 'attack', seq: 21,
      payload: {
        attackerId: 'unit-1', q: 1, r: 0, hit: false, shape: 'arc',
        targetId: null, damage: 0, actualDamage: 0, roundNumber: 4,
      },
    }, state);

    const kinds = animation._debugEffects();
    expect(kinds.filter(kind => kind === 'slash')).toHaveLength(1);
    expect(kinds).not.toContain('hitFlash');
    expect(kinds).not.toContain('damageText');

    const context = new RecordingContext();
    loaded.setTime(100);
    animation.drawEffects(context, 100);
    expect(context.strokeStyles).toContain('#ff7a45');
    expect(context.texts).toHaveLength(0);
  });

  it('maps legacy single-cell attacks to the per-type themed effect', () => {
    const loaded = loadAnimation();
    expect(loaded).not.toBeNull();
    if (!loaded) return;
    const animation = createController(loaded);
    const state = createState();
    state.units.get('unit-1')!.type = 'heavy';
    animation.syncState(state, { animate: false });

    // 旧模式 payload：无 shape/q/r，只有 targetId。
    animation.recordEvent({
      type: 'attack', seq: 31,
      payload: { attackerId: 'unit-1', targetId: 'hq-1', actualDamage: 18 },
    }, state);

    const kinds = animation._debugEffects();
    expect(kinds.filter(kind => kind === 'slash')).toHaveLength(1);
    expect(kinds).toContain('hitFlash');
    expect(kinds).toContain('damageText');

    const context = new RecordingContext();
    loaded.setTime(100);
    animation.drawEffects(context, 100);
    expect(context.strokeStyles).toContain('#ff7a45');
    expect(context.texts).toContain('-18');
  });

  it('shows damage floaters for artillery damage events', () => {
    const loaded = loadAnimation();
    expect(loaded).not.toBeNull();
    if (!loaded) return;
    const animation = createController(loaded);
    const state = createState();
    animation.syncState(state, { animate: false });

    // 单位被炮火击中：存活实体取插值视图位置。
    animation.recordEvent({
      type: 'artillery_damage', seq: 41,
      payload: { unitId: 'unit-1', owner: 'player_a', damage: 25, unitHp: 75, q: 0, r: 0, roundNumber: 5 },
    }, state);
    expect(animation._debugEffects()).toContain('hitFlash');
    expect(animation._debugEffects()).toContain('damageText');
    let context = new RecordingContext();
    loaded.setTime(100);
    animation.drawEffects(context, 100);
    expect(context.texts).toContain('-25');

    // 实体已被移除（被炮火消灭后先弹 unit_death 清理视图）时回退事件坐标，飘字仍不丢失。
    const animation2 = createController(loaded);
    animation2.recordEvent({
      type: 'artillery_damage', seq: 42,
      payload: { unitId: 'ghost-unit', owner: 'player_b', damage: 30, unitHp: 0, q: 5, r: -2, roundNumber: 5 },
    }, state);
    expect(animation2._debugEffects()).toContain('damageText');
    context = new RecordingContext();
    loaded.setTime(200);
    animation2.drawEffects(context, 200);
    expect(context.texts).toContain('-30');
  });

  it('shows heal floaters for control-point repair events', () => {
    const loaded = loadAnimation();
    expect(loaded).not.toBeNull();
    if (!loaded) return;
    const animation = createController(loaded);
    const state = createState();
    animation.syncState(state, { animate: false });

    animation.recordEvent({
      type: 'control_point_repair', seq: 51,
      payload: { pointId: 'point-1', pointName: '维修站 1', unitId: 'unit-1', amount: 12, unitHp: 100, owner: 'player_a' },
    }, state);
    expect(animation._debugEffects()).toContain('ring');
    expect(animation._debugEffects()).toContain('damageText');
    const context = new RecordingContext();
    loaded.setTime(100);
    animation.drawEffects(context, 100);
    expect(context.texts).toContain('+12');
  });
});
