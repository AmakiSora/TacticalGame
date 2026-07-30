# 普通棋盘动效 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为桌面和移动端普通观战/玩家棋盘提供一致的事件动效，同时保持既有规则状态、画风和交互不变。

**Architecture:** 新建一个无依赖、传统脚本可加载的 `window.BoardAnimation` 工厂，独立管理单位与总部的插值视图和短时 Canvas 特效队列。四个页面将规则事件写入既有状态后，通知动画层并继续使用页面自己的棋盘绘制函数与坐标换算；完整加载和回放跳转直接同步，不播放历史动画。

**Tech Stack:** 原生 JavaScript、Canvas 2D、`requestAnimationFrame`、Vitest、Node `vm`。

## Global Constraints

- 覆盖 `public/spectator.html`、`public/spectator-m.html`、`public/play.html`、`public/play-m.html`；不修改 `public/spectator2.html`。
- 不修改服务端事件协议、游戏规则、回放格式或现有鼠标/触摸交互。
- 沿用移动蓝、攻击红、治疗绿、部署金、拆除橙和阵营色占点的现有语义。
- 初次加载、手动刷新、切换对局和回放跳转必须直接定位；仅 SSE 事件和逐步回放播放动画。
- `prefers-reduced-motion: reduce` 必须保留颜色与状态反馈，并压缩动画到近乎瞬时。
- 不引入第三方库、图片资源或 DOM 覆盖层。

---

## File Structure

- `public/board-animation.js`: 共享的 Canvas 动画层。管理单位/总部视图、事件效果、缓动、效果上限和减弱动画偏好。
- `public/app.js`: 桌面观战页的回放、SSE 和绘制接入。
- `public/play.js`: 桌面玩家页的 SSE 和绘制接入。
- `public/spectator-m.js`: 移动观战页的回放、SSE 和绘制接入。
- `public/play-m.js`: 移动玩家页的 SSE 和绘制接入。
- 四个普通页面 HTML: 在各自主脚本之前加载共享动画脚本。
- `tests/public/board-animation.test.ts`: 在无浏览器环境中以 mock Canvas 验证动画层行为，并静态验证页面接入范围。

### Task 1: 建立共享动画层的失败测试

**Files:**
- Create: `tests/public/board-animation.test.ts`

**Interfaces:**
- Consumes: `public/board-animation.js` 将暴露的 `window.BoardAnimation.create(options)`。
- Produces: 对动画层 API 和四个普通页面脚本加载顺序的可执行契约。

- [ ] **Step 1: 写入共享层运行时契约测试**

```ts
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

function loadAnimation(reducedMotion = false) {
  const window = { matchMedia: () => ({ matches: reducedMotion }) };
  const context = vm.createContext({ window, performance: { now: () => 0 } });
  new vm.Script(readFileSync('public/board-animation.js', 'utf8')).runInContext(context);
  return (window as unknown as { BoardAnimation: any }).BoardAnimation;
}

function state() {
  return {
    units: new Map([['u1', { id: 'u1', q: 0, r: 0, hp: 100, maxHp: 100, alive: true }]]),
    headquarters: new Map(),
  };
}

describe('board animation layer', () => {
  it('interpolates movement and hit points, then draws attack feedback', () => {
    const animation = loadAnimation().create({
      hexToPixel: (q: number, r: number) => ({ x: q * 20, y: r * 20 }),
      ownerColor: () => '#66ccff',
    });
    const current = state();
    animation.syncState(current, { animate: false });
    current.units.get('u1')!.q = 2;
    current.units.get('u1')!.hp = 40;
    animation.syncState(current, { animate: true });
    animation.update(130);

    let unit: { x: number; hp: number } | undefined;
    animation.forEachUnit((entity: { hp: number }, view: { x: number }) => { unit = { x: view.x, hp: entity.hp }; });
    expect(unit!.x).toBeGreaterThan(0);
    expect(unit!.x).toBeLessThan(40);
    expect(unit!.hp).toBeLessThan(100);
    expect(unit!.hp).toBeGreaterThan(40);

    const calls: string[] = [];
    const ctx = { save() {}, restore() {}, beginPath() {}, moveTo() { calls.push('moveTo'); }, lineTo() { calls.push('lineTo'); }, arc() { calls.push('arc'); }, stroke() {} };
    animation.recordEvent({ type: 'attack', payload: { attackerId: 'u1', targetId: 'u1' } }, current);
    animation.drawEffects(ctx, 130);
    expect(calls).toContain('lineTo');
    expect(calls).toContain('arc');
  });

  it('settles immediately when reduced motion is requested', () => {
    const animation = loadAnimation(true).create({ hexToPixel: (q: number, r: number) => ({ x: q * 20, y: r * 20 }), ownerColor: () => '#66ccff' });
    const current = state();
    animation.syncState(current, { animate: false });
    current.units.get('u1')!.q = 2;
    animation.syncState(current, { animate: true });
    let x = 0;
    animation.forEachUnit((_entity: unknown, view: { x: number }) => { x = view.x; });
    expect(x).toBe(40);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/public/board-animation.test.ts`

Expected: FAIL，因为 `public/board-animation.js` 尚不存在。

- [ ] **Step 3: 提交失败测试**

```powershell
git add tests/public/board-animation.test.ts
git commit -m "test: define board animation behavior"
```

### Task 2: 实现共享 Canvas 动画层

**Files:**
- Create: `public/board-animation.js`
- Modify: `tests/public/board-animation.test.ts`

**Interfaces:**
- Consumes: `create({ hexToPixel, ownerColor })`，其中 `hexToPixel(q, r)` 返回 `{ x, y }`，`ownerColor(owner)` 返回 Canvas 色值。
- Produces: `window.BoardAnimation.create(options)` 返回含有 `reset()`, `syncState(state, { animate })`, `recordEvent(event, state)`, `update(now)`, `forEachUnit(callback)`, `forEachHeadquarters(callback)`, `drawEffects(ctx, now)` 的对象。

- [ ] **Step 1: 实现全局工厂和视图状态**

```js
(() => {
  const DEFAULT_DURATION = 260;
  const EFFECT_LIMIT = 24;

function create({ hexToPixel, ownerColor }) {
  const unitViews = new Map();
  const headquartersViews = new Map();
  let effects = [];
  const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    function syncState(state, { animate = true } = {}) {
      const immediate = !animate || reducedMotion();
      syncEntities(state.units, unitViews, immediate);
      syncEntities(state.headquarters, headquartersViews, immediate);
    }
    function recordEvent(event, state) {
      const p = event.payload || {};
      const source = entityPosition(p.attackerId || p.supportId || p.unitId);
      const target = entityPosition(p.targetId || p.headquartersId || p.unitId);
      if (event.type === 'attack' && source && target) addBeam(source, target, '#ff5c7a', 220);
      if (event.type === 'attack' && target) addRing(target, '#ff5c7a', 360, 1);
      if (event.type === 'move' && Number.isFinite(p.toQ) && Number.isFinite(p.toR)) addRing(hexToPixel(p.toQ, p.toR), '#6ea8ff', 400, 0.8);
      if ((event.type === 'heal' || event.type === 'control_point_repair') && target) addRing(target, '#3effc8', 450, 1);
      if (event.type === 'deploy' && Number.isFinite(p.q) && Number.isFinite(p.r)) addRing(hexToPixel(p.q, p.r), '#ffd23e', 500, 1.2);
      if (event.type === 'unit_death' && target) addBurst(target, '#ff8a5c', 500, 1);
      if (event.type === 'headquarters_destroyed' && target) { addBurst(target, '#ff5c7a', 700, 1.8); addRing(target, '#ff5c7a', 700, 2); }
      if (event.type === 'demolish' && Number.isFinite(p.q) && Number.isFinite(p.r)) addBurst(hexToPixel(p.q, p.r), '#ff9a3d', 550, 1.3);
    }
    function update(now) {
      for (const views of [unitViews, headquartersViews]) {
        for (const [id, view] of views) {
          view.x += (view.tx - view.x) * 0.2;
          view.y += (view.ty - view.y) * 0.2;
          view.alpha += (view.targetAlpha - view.alpha) * 0.16;
          view.scale += (view.targetScale - view.scale) * 0.2;
          view.hp += (view.targetHp - view.hp) * 0.2;
          if (Math.abs(view.tx - view.x) < 0.4) view.x = view.tx;
          if (Math.abs(view.ty - view.y) < 0.4) view.y = view.ty;
          if (Math.abs(view.targetHp - view.hp) < 0.5) view.hp = view.targetHp;
          if (view.targetAlpha === 0 && view.alpha < 0.02) views.delete(id);
        }
      }
      effects = effects.filter(effect => now - effect.start < effect.duration);
    }
    function drawEffects(ctx, now) {
      for (const effect of effects) drawEffect(ctx, effect, Math.max(0, now - effect.start) / effect.duration);
    }

    function syncEntities(entities, views, immediate) {
      const seen = new Set();
      for (const entity of entities.values()) {
        seen.add(entity.id);
        const view = views.get(entity.id);
        if (entity.alive === false) {
          if (view) view.targetAlpha = 0;
          continue;
        }
        const target = hexToPixel(entity.q, entity.r);
        if (!view) {
          views.set(entity.id, {
            entity: { ...entity }, x: target.x, y: target.y, tx: target.x, ty: target.y,
            alpha: immediate ? 1 : 0, targetAlpha: 1, scale: immediate ? 1 : 0.6, targetScale: 1,
            hp: entity.hp, targetHp: entity.hp,
          });
          continue;
        }
        view.entity = { ...entity }; view.tx = target.x; view.ty = target.y; view.targetAlpha = 1; view.targetScale = 1; view.targetHp = entity.hp;
        if (immediate) Object.assign(view, { x: target.x, y: target.y, alpha: 1, scale: 1, hp: entity.hp });
      }
      for (const [id, view] of views) if (!seen.has(id)) view.targetAlpha = 0;
    }

    function entityPosition(id) {
      const view = unitViews.get(id) || headquartersViews.get(id);
      return view ? { x: view.x, y: view.y } : null;
    }

    function addEffect(effect) {
      if (effects.length >= EFFECT_LIMIT) effects.shift();
      effects.push({ start: performance.now(), ...effect });
    }
    function addBeam(from, to, color, duration) { addEffect({ kind: 'beam', x: from.x, y: from.y, x2: to.x, y2: to.y, color, duration }); }
    function addRing(at, color, duration, size) { addEffect({ kind: 'ring', x: at.x, y: at.y, color, duration, size }); }
    function addBurst(at, color, duration, size) { addEffect({ kind: 'burst', x: at.x, y: at.y, color, duration, size }); }
    function drawEffect(ctx, effect, t) {
      if (t >= 1) return;
      const fade = 1 - t;
      ctx.save(); ctx.strokeStyle = effect.color; ctx.globalAlpha = fade; ctx.lineCap = 'round';
      if (effect.kind === 'beam') { ctx.lineWidth = 4 * fade + 1; ctx.beginPath(); ctx.moveTo(effect.x, effect.y); ctx.lineTo(effect.x2, effect.y2); ctx.stroke(); }
      if (effect.kind === 'ring') { ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(effect.x, effect.y, (6 + t * 26) * effect.size, 0, Math.PI * 2); ctx.stroke(); }
      if (effect.kind === 'burst') for (let i = 0; i < 8; i++) { const angle = Math.PI * i / 4; ctx.beginPath(); ctx.moveTo(effect.x + Math.cos(angle) * 3, effect.y + Math.sin(angle) * 3); ctx.lineTo(effect.x + Math.cos(angle) * (5 + t * 22) * effect.size, effect.y + Math.sin(angle) * (5 + t * 22) * effect.size); ctx.stroke(); }
      ctx.restore();
    }

    return { reset, syncState, recordEvent, update, forEachUnit, forEachHeadquarters, drawEffects };
  }

  window.BoardAnimation = { create };
})();
```

Use the `syncEntities` helper above for both units and headquarters. Existing alive entities retain their display coordinates and receive new `tx`, `ty`, `targetHp`, and `targetAlpha`; new animated units begin at their target coordinate with alpha `0` and scale `0.6`; removed/dead views retain their last coordinate while fading to alpha `0`. `forEachUnit` and `forEachHeadquarters` must invoke their callbacks as `callback({ ...view.entity, hp: view.hp }, view)` for views whose alpha is greater than `0.01`.

- [ ] **Step 2: Implement each event effect with stable payload fallbacks**

```js
if (event.type === 'control_point_captured') {
  const point = state.controlPoints?.get(p.pointId);
  if (point && Number.isFinite(point.q) && Number.isFinite(point.r)) {
    addRing(hexToPixel(point.q, point.r), ownerColor(point.owner), 600, 1.5);
  }
}
if (event.type === 'control_point_neutralized') {
  const point = state.controlPoints?.get(p.pointId);
  if (point && Number.isFinite(point.q) && Number.isFinite(point.r)) {
    addRing(hexToPixel(point.q, point.r), '#d6b34a', 500, 1.2);
  }
}
```

Append those two blocks to `recordEvent` after the common event branches in Step 1. Guard every coordinate and entity lookup using `Number.isFinite` and null checks. The `addEffect` helper drops the oldest effect before insertion once the queue reaches `24`. For an attack where the target is absent, draw neither beam nor hit ring; state application must still proceed in the page caller.

- [ ] **Step 3: Complete the Canvas mock and assertions**

Add no-op Canvas members used by the implementation to the test mock, including `closePath`, `fill`, `fillRect`, `translate`, `scale`, `globalAlpha`, `strokeStyle`, `fillStyle`, `lineWidth`, `lineCap`, `shadowColor`, and `shadowBlur`. Keep the assertions on interpolated movement, interpolated HP, attack line, attack ring, and reduced-motion direct positioning exactly as written in Step 1.

- [ ] **Step 4: 运行共享层测试确认通过**

Run: `npm test -- tests/public/board-animation.test.ts`

Expected: PASS，两个测试均通过。

- [ ] **Step 5: 提交共享层实现**

```powershell
git add public/board-animation.js tests/public/board-animation.test.ts
git commit -m "feat: add shared board animation layer"
```

### Task 3: 接入桌面观战回放与实时观战

**Files:**
- Modify: `public/spectator.html`
- Modify: `public/app.js`
- Modify: `tests/public/board-animation.test.ts`

**Interfaces:**
- Consumes: `window.BoardAnimation.create({ hexToPixel, ownerColor })` and its methods from `public/board-animation.js`.
- Produces: 桌面观战页在逐步回放和实时 SSE 中播放动效，重建历史状态时不播放动效。

- [ ] **Step 1: 先添加桌面观战静态接入测试**

```ts
it('loads and uses the shared animation layer on desktop spectator replay', () => {
  const html = readFileSync('public/spectator.html', 'utf8');
  const source = readFileSync('public/app.js', 'utf8');
  expect(html).toMatch(/board-animation\.js[\s\S]*app\.js/);
  expect(source).toContain('window.BoardAnimation.create');
  expect(source).toContain('boardAnimation.recordEvent');
  expect(source).toContain('boardAnimation.syncState');
  expect(source).toContain('boardAnimation.forEachUnit');
  expect(source).toContain('boardAnimation.forEachHeadquarters');
  expect(source).toContain('boardAnimation.drawEffects');
});
```

- [ ] **Step 2: 运行新增断言确认失败**

Run: `npm test -- tests/public/board-animation.test.ts`

Expected: FAIL，桌面观战页尚未加载或调用共享动画层。

- [ ] **Step 3: 在页面加载共享脚本并创建动画实例**

In `public/spectator.html`, place `<script src="/board-animation.js?v=3.2.1"></script>` immediately before the existing `app.js` script. In `app.js`, create the layer after `canvas`, `ctx`, and `hexToPixel` are available:

```js
const boardAnimation = window.BoardAnimation.create({ hexToPixel, ownerColor });
```

Use a `renderLoop(now)` that calls `boardAnimation.update(now)`, `drawBoard(now)`, and schedules the next frame. Start it exactly once during page initialization.

- [ ] **Step 4: Route replay, SSE and state rebuild through the animation lifecycle**

```js
function rebuildToStep(step) {
  boardAnimation.reset();
  // rebuild `state` by applying historical events
  boardAnimation.syncState(state, { animate: false });
  drawBoard();
}

function stepForward() {
  const event = allEvents[currentStep + 1];
  applyEvent(state, event);
  currentStep++;
  boardAnimation.recordEvent(event, state);
  boardAnimation.syncState(state, { animate: true });
  renderSidebar();
  renderDetail();
  updateControls();
}
```

Use the same `recordEvent` then animated `syncState` sequence in the SSE message handler. In `loadGameState`, `resetLoadedGame`, and any empty-state path call `boardAnimation.reset()` and non-animated `syncState` once a state exists.

- [ ] **Step 5: Render animated entity views without changing marker style**

Change `drawUnitMarker` and `drawHeadquartersMarker` to accept optional `{ x, y, alpha, scale }` view values rather than always deriving positions internally. Keep all existing Canvas glyph paths, colors, health bars, and spent-action marker code. In `drawBoard(now)`, replace direct unit/HQ map loops:

```js
boardAnimation.forEachHeadquarters((hq, view) => drawHeadquartersMarker(hq, view));
boardAnimation.forEachUnit((unit, view) => drawUnitMarker(unit, view));
boardAnimation.drawEffects(ctx, now);
```

Do not animate control point marker positions; their owner change is conveyed by the immediate owner color plus queued capture/neutralization pulse.

- [ ] **Step 6: 运行测试确认通过**

Run: `npm test -- tests/public/board-animation.test.ts`

Expected: PASS，动画层测试和桌面观战接入断言均通过。

- [ ] **Step 7: 提交桌面观战接入**

```powershell
git add public/spectator.html public/app.js tests/public/board-animation.test.ts
git commit -m "feat: animate desktop spectator board events"
```

### Task 4: 接入桌面玩家页实时事件

**Files:**
- Modify: `public/play.html`
- Modify: `public/play.js`
- Modify: `tests/public/board-animation.test.ts`

**Interfaces:**
- Consumes: Task 2 的共享层和 Task 3 确认过的 marker view 参数约定。
- Produces: 桌面玩家页在 SSE 行动事件后播放动效，首次进入和手动刷新保持直接定位。

- [ ] **Step 1: 添加桌面玩家接入断言**

```ts
it('loads and uses the shared animation layer on the desktop player board', () => {
  const html = readFileSync('public/play.html', 'utf8');
  const source = readFileSync('public/play.js', 'utf8');
  expect(html).toMatch(/board-animation\.js[\s\S]*play\.js/);
  for (const hook of ['recordEvent', 'syncState', 'forEachUnit', 'forEachHeadquarters', 'drawEffects']) {
    expect(source).toContain(`boardAnimation.${hook}`);
  }
  expect(source).toContain('subscribeSse');
  expect(source).toContain('loadFullState');
});
```

- [ ] **Step 2: 运行新增断言确认失败**

Run: `npm test -- tests/public/board-animation.test.ts`

Expected: FAIL，因为玩家页尚未接入共享层。

- [ ] **Step 3: 接入共享脚本、绘制循环和动画 marker**

Load `board-animation.js` before `play.js`; instantiate `boardAnimation` after the Canvas and coordinate functions are defined. Preserve range highlights, hover cells, control points, and selection overlays in `drawBoard(now)`, then render headquarters/units using `forEachHeadquarters` and `forEachUnit`, and finally call `drawEffects(ctx, now)`. Keep marker glyph paths and action-spent dots unchanged while applying the view alpha and scale with `ctx.save()`, `ctx.globalAlpha`, `ctx.translate()`, and `ctx.scale()`.

```js
function drawAnimatedEntities(now) {
  boardAnimation.forEachHeadquarters((hq, view) => drawHeadquartersMarker(hq, view));
  boardAnimation.forEachUnit((unit, view) => drawUnitMarker(unit, view));
  boardAnimation.drawEffects(ctx, now);
}

function renderFrame(now) {
  boardAnimation.update(now);
  drawBoard(now);
  requestAnimationFrame(renderFrame);
}
requestAnimationFrame(renderFrame);
```

Replace the existing HQ and unit loops near the end of `drawBoard(now)` with `drawAnimatedEntities(now)`. Inside each marker function, use `view.x`, `view.y`, `view.alpha`, and `view.scale` when provided; otherwise use the existing `hexToPixel` result. Restore the Canvas context before drawing the HP bar so the bar width remains in page pixels.

- [ ] **Step 4: Distinguish live event animation from complete state synchronization**

```js
sse.onmessage = async event => {
  const gameEvent = JSON.parse(event.data);
  applyEvent(state, gameEvent);
  boardAnimation.recordEvent(gameEvent, state);
  boardAnimation.syncState(state, { animate: true });
  renderSidebar();
};

async function loadFullState() {
  const { ok, data } = await API.get(`/api/games/${gameId}/events`);
  if (!ok) return false;
  state = createEmptyState();
  for (const event of data.events) applyEvent(state, event);
  boardAnimation.reset();
  boardAnimation.syncState(state, { animate: false });
  return true;
}
```

After successful local action requests, do not synthesize a second animation. The authoritative SSE event remains the only animation trigger.

- [ ] **Step 5: 运行桌面玩家测试确认通过**

Run: `npm test -- tests/public/board-animation.test.ts`

Expected: PASS，桌面玩家接入断言与共享层行为均通过。

- [ ] **Step 6: 提交桌面玩家接入**

```powershell
git add public/play.html public/play.js tests/public/board-animation.test.ts
git commit -m "feat: animate desktop player board events"
```

### Task 5: 接入两个移动端棋盘并完成回归验证

**Files:**
- Modify: `public/spectator-m.html`
- Modify: `public/spectator-m.js`
- Modify: `public/play-m.html`
- Modify: `public/play-m.js`
- Modify: `tests/public/board-animation.test.ts`

**Interfaces:**
- Consumes: 共享层 API、桌面页面的 marker view 参数和实时/回放生命周期。
- Produces: 移动观战页和移动玩家页播放与桌面一致的 Canvas 动效，并保持当前平移、双指缩放和点按命中逻辑。

- [ ] **Step 1: 添加移动端范围与排除项断言**

```ts
it('loads the animation layer on every normal mobile page and leaves spectator2 isolated', () => {
  for (const [htmlFile, scriptFile] of [
    ['public/play-m.html', 'public/play-m.js'],
    ['public/spectator-m.html', 'public/spectator-m.js'],
  ]) {
    const html = readFileSync(htmlFile, 'utf8');
    const source = readFileSync(scriptFile, 'utf8');
    expect(html).toMatch(/board-animation\.js[\s\S]*\.js\?v=/);
    for (const hook of ['recordEvent', 'syncState', 'forEachUnit', 'forEachHeadquarters', 'drawEffects']) {
      expect(source).toContain(`boardAnimation.${hook}`);
    }
  }
  expect(readFileSync('public/spectator2.html', 'utf8')).not.toContain('/board-animation.js');
});
```

- [ ] **Step 2: 运行新增移动端断言确认失败**

Run: `npm test -- tests/public/board-animation.test.ts`

Expected: FAIL，因为两个移动端页面还未加载或调用动画层。

- [ ] **Step 3: 接入移动观战回放与 SSE**

Load the shared script before `spectator-m.js`. Mirror the desktop spectator lifecycle: `rebuildToStep()` resets then directly syncs; `stepForward()` and live SSE record the new event then perform an animated sync. Change only the Canvas marker invocation to use animation views. Preserve `fitBoardToViewport`, `setBoardTransform`, pointer gesture state, hit testing, drawer behavior, and `syncMobileChrome` unchanged.

```js
function stepForward() {
  const event = allEvents[currentStep + 1];
  applyEvent(state, event);
  currentStep++;
  boardAnimation.recordEvent(event, state);
  boardAnimation.syncState(state, { animate: true });
  drawBoard();
  renderSidebar();
  renderDetail();
  updateControls();
}

function rebuildToStep(step) {
  boardAnimation.reset();
  state = createEmptyState();
  for (let i = 0; i <= step && i < allEvents.length; i++) applyEvent(state, allEvents[i]);
  boardAnimation.syncState(state, { animate: false });
  drawBoard();
}

function renderFrame(now) {
  boardAnimation.update(now);
  drawBoard(now);
  requestAnimationFrame(renderFrame);
}
requestAnimationFrame(renderFrame);
```

- [ ] **Step 4: 接入移动玩家 SSE 和刷新路径**

Load the shared script before `play-m.js`. Mirror the desktop player lifecycle: full-state load/reset synchronizes without animation; SSE records then animates exactly once; range and selection redraw continue unchanged. Adapt `drawUnitMarker` and `drawHeadquartersMarker` to the shared view parameter while retaining their original glyph shapes and health bar layout.

```js
sse.onmessage = event => {
  const gameEvent = JSON.parse(event.data);
  applyEvent(state, gameEvent);
  boardAnimation.recordEvent(gameEvent, state);
  boardAnimation.syncState(state, { animate: true });
  drawBoard();
  renderSidebar();
};

async function loadFullState() {
  const { ok, data } = await API.get(`/api/games/${gameId}/events`);
  if (!ok) return false;
  state = createEmptyState();
  for (const event of data.events) applyEvent(state, event);
  boardAnimation.reset();
  boardAnimation.syncState(state, { animate: false });
  drawBoard();
  return true;
}
```

- [ ] **Step 5: 运行聚焦的页面与动画测试**

Run: `npm test -- tests/public/board-animation.test.ts tests/public/mobile-pages.test.ts tests/public/page-optimization.test.ts`

Expected: PASS，所有动画接入和现有移动/桌面页面检查通过。

- [ ] **Step 6: Build, run the complete suite, and perform browser verification**

Run: `npm run build; npm test`

Expected: TypeScript build succeeds and all Vitest tests pass.

Run: `npm run dev`

Expected: server reports a local URL. Use a browser to load each of `/spectator.html`, `/play.html`, `/spectator-m.html`, and `/play-m.html`; use a replay or live game containing a move and attack. Verify unit paths, attack beam/end ring, no duplicate playback on refresh or seek, and alignment after mobile pan/pinch. In browser developer tools emulate `prefers-reduced-motion: reduce` and confirm events settle without prolonged motion.

- [ ] **Step 7: 提交移动端接入与测试**

```powershell
git add public/spectator-m.html public/spectator-m.js public/play-m.html public/play-m.js tests/public/board-animation.test.ts
git commit -m "feat: animate mobile tactical boards"
```

- [ ] **Step 8: Verify the final worktree before handoff**

Run: `git status --short; git log -5 --oneline`

Expected: 只显示用户已有的 `RELEASE_NOTES.md` 修改或由用户新建的未跟踪内容；动画实现与测试已经由上述提交记录覆盖。
