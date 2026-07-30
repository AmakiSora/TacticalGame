import { existsSync, readFileSync } from 'node:fs';
import { createContext, Script } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/server.js';

type Entity = {
  id: string;
  owner?: string;
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
  reset(): void;
  syncState(state: BoardState, options: { animate: boolean }): void;
  recordEvent(event: { type: string; payload?: Record<string, unknown> }, state: BoardState): void;
  update(now: number): void;
  forEachUnit(callback: (entity: Entity, view: AnimationView) => void): void;
  forEachHeadquarters(callback: (entity: Entity, view: AnimationView) => void): void;
  drawEffects(context: RecordingContext, now: number): void;
};

type BoardAnimationApi = {
  create(options: {
    hexToPixel(q: number, r: number): { x: number; y: number };
    ownerColor(owner: string | null | undefined): string;
  }): BoardAnimationController;
};

class RecordingContext {
  calls: Array<{ name: string; args: number[] }> = [];
  strokeStyles: string[] = [];
  fillStyles: string[] = [];
  globalAlpha = 1;
  lineWidth = 1;
  lineCap = 'butt';
  shadowColor = '';
  shadowBlur = 0;

  set strokeStyle(value: string) { this.strokeStyles.push(value); }
  set fillStyle(value: string) { this.fillStyles.push(value); }
  save() {}
  restore() {}
  beginPath() {}
  stroke() {}
  fill() { this.calls.push({ name: 'fill', args: [] }); }
  moveTo(...args: number[]) { this.calls.push({ name: 'moveTo', args }); }
  lineTo(...args: number[]) { this.calls.push({ name: 'lineTo', args }); }
  arc(...args: number[]) { this.calls.push({ name: 'arc', args }); }
}

function loadAnimation(reducedMotion = false) {
  if (!existsSync('public/board-animation.js')) return null;
  let currentTime = 0;
  const animationWindow = {
    matchMedia: () => ({ matches: reducedMotion }),
  } as { matchMedia: () => { matches: boolean }; BoardAnimation?: BoardAnimationApi };
  const context = createContext({
    window: animationWindow,
    performance: { now: () => currentTime },
  });
  new Script(readFileSync('public/board-animation.js', 'utf8')).runInContext(context);
  return {
    api: animationWindow.BoardAnimation,
    setTime(value: number) { currentTime = value; },
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
  it('serves the shared dependency before desktop spectator code', async () => {
    const app = await buildServer();
    try {
      const page = await app.inject({ method: 'GET', url: '/spectator.html' });
      const shared = await app.inject({ method: 'GET', url: '/board-animation.js' });
      expect(page.statusCode).toBe(200);
      expect(shared.statusCode).toBe(200);
      const sharedIndex = page.body.indexOf('/board-animation.js');
      const appIndex = page.body.indexOf('/app.js');
      expect(sharedIndex).toBeGreaterThan(-1);
      expect(sharedIndex).toBeLessThan(appIndex);
    } finally {
      await app.close();
    }
  });

  it('serves the shared dependency before desktop player code', async () => {
    const app = await buildServer();
    try {
      const page = await app.inject({ method: 'GET', url: '/play.html' });
      expect(page.statusCode).toBe(200);
      const sharedIndex = page.body.indexOf('/board-animation.js');
      const playerIndex = page.body.indexOf('/play.js');
      expect(sharedIndex).toBeGreaterThan(-1);
      expect(sharedIndex).toBeLessThan(playerIndex);
    } finally {
      await app.close();
    }
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
});
