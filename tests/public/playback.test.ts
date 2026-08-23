import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContext, Script } from 'node:vm';
import { describe, expect, it } from 'vitest';

function read(publicPath: string): string {
  return readFileSync(join(process.cwd(), 'public', publicPath), 'utf-8');
}

type FakeTimer = { id: number; delay: number; fn: () => void };

type PlaybackControls = {
  apply(event: { seq: number; type: string }): void;
  effect(event: { seq: number; type: string }): void;
  sync(animate: boolean): void;
  render(): void;
  refresh?(): void;
  lastSeq?(): number;
  onActiveChange?(active: boolean): void;
};

type PlaybackController = {
  enqueue(event: { seq: number; type: string }): boolean;
  isActive(): boolean;
  skip(): void;
  reset(): void;
};

function loadQueue() {
  const timers: FakeTimer[] = [];
  let timerSeq = 0;
  const scope: Record<string, unknown> = {
    window: {},
    performance: { now: () => 0 },
    setTimeout: (fn: () => void, delay: number) => {
      timerSeq += 1;
      const id = timerSeq;
      timers.push({ id, delay, fn });
      return id;
    },
    clearTimeout: (id: number) => {
      const index = timers.findIndex(timer => timer.id === id);
      if (index >= 0) timers.splice(index, 1);
    },
  };
  createContext(scope);
  new Script(read('playback.js')).runInContext(scope);
  const api = (scope.window as { PlaybackQueue: { create(controls: PlaybackControls): PlaybackController } }).PlaybackQueue;
  return {
    api,
    timers,
    fireNext() {
      const timer = timers.shift();
      if (!timer) throw new Error('no pending playback timer');
      timer.fn();
    },
    nextDelay(): number | null {
      return timers.length ? timers[0]!.delay : null;
    },
  };
}

function spyControls() {
  const calls = {
    apply: [] as string[],
    effect: [] as string[],
    syncs: [] as boolean[],
    renders: 0,
    refreshes: 0,
    activeChanges: [] as boolean[],
  };
  let lastAppliedSeq = 0;
  const controls: PlaybackControls = {
    apply(event) {
      calls.apply.push(event.type);
      lastAppliedSeq = event.seq;
    },
    effect(event) {
      calls.effect.push(event.type);
    },
    sync(animate) {
      calls.syncs.push(animate);
    },
    render() {
      calls.renders += 1;
    },
    refresh() {
      calls.refreshes += 1;
    },
    lastSeq() {
      return lastAppliedSeq;
    },
    onActiveChange(active) {
      calls.activeChanges.push(active);
    },
  };
  return { calls, controls };
}

const ev = (seq: number, type: string) => ({ seq, type, payload: {} });

function roundBurst() {
  return [
    ev(1, 'move'),
    ev(2, 'deploy'),
    ev(3, 'move'),
    ev(4, 'attack'),
    ev(5, 'heal'),
    ev(6, 'round_end'),
    ev(7, 'round_resolved'),
    ev(8, 'round_start'),
  ];
}

describe('playback queue scheduling', () => {
  it('applies the shift group in one beat, then combat one by one, then the boundary group', () => {
    const { api, timers, fireNext, nextDelay } = loadQueue();
    const { calls, controls } = spyControls();
    const playback = api.create(controls);

    for (const event of roundBurst()) expect(playback.enqueue(event)).toBe(true);
    // 首批延迟一个宏任务：整批入队后移动组齐拍应用。
    expect(timers).toHaveLength(1);
    expect(nextDelay()).toBe(0);
    fireNext();

    expect(calls.apply).toEqual(['move', 'deploy', 'move']);
    expect(calls.effect).toEqual(['move', 'deploy', 'move']);
    expect(calls.syncs).toEqual([true]);
    expect(playback.isActive()).toBe(true);
    expect(calls.activeChanges).toEqual([true]);
    expect(nextDelay()).toBe(600);

    fireNext();
    expect(calls.apply).toEqual(['move', 'deploy', 'move', 'attack']);
    expect(nextDelay()).toBe(480);

    fireNext();
    expect(calls.apply.slice(-1)).toEqual(['heal']);
    expect(nextDelay()).toBe(340);

    // 回合边界事件同拍应用并结束回放。
    fireNext();
    expect(calls.apply.slice(-3)).toEqual(['round_end', 'round_resolved', 'round_start']);
    expect(timers).toHaveLength(0);
    expect(playback.isActive()).toBe(false);
    expect(calls.activeChanges).toEqual([true, false]);
    expect(calls.refreshes).toBe(1);
  });

  it('paces captures and deaths per event', () => {
    const { api, fireNext, nextDelay } = loadQueue();
    const { calls, controls } = spyControls();
    const playback = api.create(controls);
    for (const event of [
      ev(1, 'attack'),
      ev(2, 'unit_death'),
      ev(3, 'headquarters_destroyed'),
      ev(4, 'control_point_captured'),
      ev(5, 'control_point_captured'),
      ev(6, 'round_start'),
    ]) playback.enqueue(event);

    fireNext();
    expect(calls.apply).toEqual(['attack']);
    expect(nextDelay()).toBe(480);
    fireNext();
    expect(calls.apply.slice(-1)).toEqual(['unit_death']);
    expect(nextDelay()).toBe(420);
    fireNext();
    expect(calls.apply.slice(-1)).toEqual(['headquarters_destroyed']);
    expect(nextDelay()).toBe(520);
    fireNext();
    expect(calls.apply.slice(-1)).toEqual(['control_point_captured']);
    expect(nextDelay()).toBe(260);
    fireNext();
    expect(calls.apply.slice(-1)).toEqual(['control_point_captured']);
    expect(nextDelay()).toBe(260);
    fireNext();
    expect(calls.apply.slice(-1)).toEqual(['round_start']);
    expect(playback.isActive()).toBe(false);
  });

  it('skip applies remaining events silently without firing effects', () => {
    const { api, fireNext, timers } = loadQueue();
    const { calls, controls } = spyControls();
    const playback = api.create(controls);
    for (const event of roundBurst()) playback.enqueue(event);
    fireNext();
    expect(calls.apply).toEqual(['move', 'deploy', 'move']);

    playback.skip();
    expect(calls.apply).toEqual(['move', 'deploy', 'move', 'attack', 'heal', 'round_end', 'round_resolved', 'round_start']);
    // 跳过部分不播特效，视图直接吸附终态。
    expect(calls.effect).toEqual(['move', 'deploy', 'move']);
    expect(calls.syncs[calls.syncs.length - 1]).toBe(false);
    expect(timers).toHaveLength(0);
    expect(playback.isActive()).toBe(false);
    expect(calls.activeChanges).toEqual([true, false]);
    expect(calls.refreshes).toBe(1);
  });

  it('drops duplicate or stale events by seq', () => {
    const { api, fireNext } = loadQueue();
    const { calls, controls } = spyControls();
    const playback = api.create(controls);

    expect(playback.enqueue(ev(5, 'move'))).toBe(true);
    expect(playback.enqueue(ev(5, 'move'))).toBe(false);
    fireNext();
    expect(calls.apply).toEqual(['move']);
    // 已应用序号（lastSeq 回调）之后的事件直接丢弃。
    expect(playback.enqueue(ev(5, 'attack'))).toBe(false);
    expect(playback.enqueue(ev(4, 'heal'))).toBe(false);
    expect(playback.enqueue(ev(6, 'attack'))).toBe(true);
    fireNext();
    expect(calls.apply).toEqual(['move', 'attack']);
  });

  it('reset clears pending playback and accepts fresh events afterwards', () => {
    const { api, timers, fireNext } = loadQueue();
    const { calls, controls } = spyControls();
    const playback = api.create(controls);
    for (const event of roundBurst()) playback.enqueue(event);
    playback.reset();
    expect(timers).toHaveLength(0);
    expect(playback.isActive()).toBe(false);
    expect(calls.apply).toEqual([]);

    expect(playback.enqueue(ev(10, 'attack'))).toBe(true);
    fireNext();
    expect(calls.apply).toEqual(['attack']);
    expect(playback.isActive()).toBe(false);
    expect(calls.refreshes).toBe(1);
  });

  it('drains a single event without extra pacing (sequential mode feel)', () => {
    const { api, fireNext, nextDelay } = loadQueue();
    const { calls, controls } = spyControls();
    const playback = api.create(controls);
    playback.enqueue(ev(1, 'attack'));
    fireNext();
    expect(calls.apply).toEqual(['attack']);
    expect(calls.effect).toEqual(['attack']);
    expect(nextDelay()).toBe(null);
    expect(playback.isActive()).toBe(false);
  });
});

describe('player page playback wiring', () => {
  const playerClients = ['play.js', 'play-m.js'];

  for (const file of playerClients) {
    it(`wires the playback queue into ${file}`, () => {
      const source = read(file);
      expect(source).toContain('window.PlaybackQueue.create');
      expect(source).toContain('playback.enqueue(JSON.parse(e.data))');
      expect(source).toContain('playback.reset();');
      expect(source).toContain("els.btnSkipReplay?.addEventListener('click', () => playback.skip());");

      const canActNowBlock = source.slice(source.indexOf('function canActNow()'), source.indexOf('function unitHasPlannedAction'));
      expect(canActNowBlock).toContain('playback.isActive()');

      const sseBlock = source.slice(source.indexOf('function subscribeSse'), source.indexOf('function subscribeLobbyStart'));
      expect(sseBlock).toContain('new EventSource(`/api/games/${gameId}/events?after=${lastSeq}`)');
      expect(sseBlock).toContain('playback.enqueue');
    });
  }

  const pages: Array<[string, string]> = [['play.html', '/play.js'], ['play-m.html', '/play-m.js']];
  for (const [page, mainScript] of pages) {
    it(`loads playback.js before ${mainScript} and ships the skip button in ${page}`, () => {
      const html = read(page);
      expect(html).toContain('id="btn-skip-replay"');
      expect(html).toContain('/playback.js');
      expect(html.indexOf('/board-animation.js')).toBeLessThan(html.indexOf('/playback.js'));
      expect(html.indexOf('/playback.js')).toBeLessThan(html.indexOf(mainScript));
    });
  }
});
