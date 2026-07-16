# Mobile Website (Player + Spectator) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver near-app mobile UX for TacticalGame player and spectator pages via independent mobile shells (play-m / spectator-m) with board-first layout, pan/pinch gestures, drawers, and desktop auto-redirect without changing backend APIs.

**Architecture:** Copy-then-modify desktop public pages into parallel mobile files. Desktop play.html / spectator.html only gain viewport meta + narrow-viewport redirect. Mobile pages keep the same REST/SSE game logic and canvas drawing, but replace chrome with mobile shell (header/turn strip/board/bottom bar/drawers) and replace mouse hover-click with pointer-based pan/zoom/tap. No shared JS modules for v1.

**Tech Stack:** Vanilla HTML/CSS/JS + Canvas, Fastify static public/, Vitest string assertions on public files. No new frameworks or dependencies.

---

## Confirmed design decisions (do not revisit)

1. Near-app mobile UX (not mere reflow).
2. Scope: ONLY player + spectator mobile pages. Never touch control.html / map-editor.html.
3. Independent mobile pages (B): play-m.html/css/js and spectator-m.html/css/js.
4. Desktop auto-redirect to m pages when matchMedia max-width 820px, preserve query string. Optional manual link OK.
5. Layout: board-first + bottom bar + drawers (not 3-column stack, not full-screen tabs only).
6. Player shell: minimal header, turn strip, board (pan/pinch + optional +/-), selection summary strip expanding to drawer, bottom bar: 信息 / 取消 / 结束回合 / 更多.
7. Spectator shell: header (game picker summary + settings), turn strip, board, current-action summary, fixed replay transport+timeline under board, bottom bar: 对局 / 局势 / 事件.
8. Gestures: single-finger pan, pinch zoom, pointer tap (no hover dependency), movement threshold tap vs pan.
9. Landscape still uses mobile shell (do NOT restore desktop 3-column).
10. Lobby fully included in play-m (create/join/map picker touch-optimized).
11. Code reuse: copy-then-modify (not shared modules for v1).
12. Backend: DO NOT change any backend API. Frontend only. Prefer zero server.ts changes (optional logging of m URLs only if needed).
13. Stack: vanilla + Canvas, static serve of public/.

---

## 1. File list

### Create (copy from desktop, then customize)

| File | Source | Responsibility |
|------|--------|----------------|
| public/play-m.html | public/play.html | Mobile player shell markup: lobby + game chrome |
| public/play-m.css | public/play.css | Mobile player layout, drawers, bottom bar, board viewport |
| public/play-m.js | public/play.js | Same game/API logic; mobile chrome + gestures + pointer tap |
| public/spectator-m.html | public/spectator.html | Mobile spectator shell markup |
| public/spectator-m.css | public/style.css | Mobile spectator layout, drawers, replay bar, bottom bar |
| public/spectator-m.js | public/app.js | Same spectator/API logic; mobile chrome + gestures + pointer tap |
| tests/public/mobile-pages.test.ts | (new) | Static assertions for m pages + redirect hooks |

### Modify (minimal)

| File | Change |
|------|--------|
| public/play.html | Viewport meta + early redirect to play-m.html when narrow; optional manual mobile link |
| public/spectator.html | Viewport meta + early redirect to spectator-m.html when narrow; optional manual mobile link |
| tests/public/page-optimization.test.ts | Keep all existing desktop asserts untouched |
| src/server.ts | Prefer no change. Optional only: log m page URLs in startup banner |

### Do not modify

- public/control.html, control.css, control.js
- public/map-editor.html, map-editor.css, map-editor.js
- Any src/api/*, src/engine/*, src/state/*
- Backend REST/SSE contracts

---

## 2. Architecture notes (read before coding)

### Desktop pain points this plan fixes

1. No viewport meta on any page -> mobile browsers scale incorrectly.
2. Player click uses hoverCell from mousemove (public/play.js ~949-999). Touch never gets reliable mousemove before click -> broken selection/actions.
3. Cancel is right-click / Esc - no primary cancel affordance on touch.
4. 3-column desktop grid collapses via media queries into a vertical stack, not a board-first app shell.
5. Canvas sets intrinsic canvas.width/height from computeLayout; CSS max-width:100%; height:auto scales display. eventToCanvasPoint / canvasCssMetrics already map CSS->canvas for mouse - pan/zoom must compose with this path.

### Gesture / transform model (canonical)

Introduce a board camera in each mobile JS file. Canvas bitmap resolution remains map-native (layout.width x layout.height from computeLayout). The camera only changes display transform and how pointer coords map into canvas space.

State (both play-m.js and spectator-m.js):

```js
const boardCam = {
  scale: 1,       // CSS scale relative to fit baseline
  tx: 0,          // pan X in CSS px of board viewport
  ty: 0,
  minScale: 0.75,
  maxScale: 3,
};
```

DOM structure (mobile board):

```html
<div class="board-viewport" id="board-viewport">
  <div class="board-stage" id="board-stage">
    <canvas id="board" width="840" height="840"></canvas>
    <div id="cell-info" class="cell-info"></div>
    <div id="map-popup" class="map-popup hidden"></div> <!-- player only -->
  </div>
  <div class="zoom-controls">
    <button type="button" id="btn-zoom-in" aria-label="zoom in">+</button>
    <button type="button" id="btn-zoom-out" aria-label="zoom out">-</button>
  </div>
</div>
```

CSS:

- .board-viewport: flex:1; min-height:0; overflow:hidden; position:relative; touch-action:none;
- .board-stage: transform-origin: 0 0; will-change: transform;
- #board: display:block; height:auto; width set in JS (do not rely on max-width:100% alone once transforms are active)

Apply transform:

```js
function applyBoardTransform() {
  const stage = document.getElementById("board-stage");
  stage.style.transform =
    "translate(" + boardCam.tx + "px, " + boardCam.ty + "px) scale(" + boardCam.scale + ")";
}
```

Coordinate pipeline (compose with eventToCanvasPoint):

1. Start from clientX/clientY.
2. Subtract board-viewport getBoundingClientRect() origin.
3. Undo camera:
   - localX = (clientX - vpLeft - boardCam.tx) / boardCam.scale
   - localY = (clientY - vpTop - boardCam.ty) / boardCam.scale
4. localX/localY are CSS pixels of the unscaled stage/canvas box.
5. Map CSS -> canvas bitmap with untransformed sizes (offsetWidth / offsetHeight), never transformed getBoundingClientRect() alone:

```js
function eventToCanvasPoint(e) {
  const vp = document.getElementById("board-viewport").getBoundingClientRect();
  const localX = (e.clientX - vp.left - boardCam.tx) / boardCam.scale;
  const localY = (e.clientY - vp.top - boardCam.ty) / boardCam.scale;
  const cssW = Math.max(1, els.canvas.offsetWidth);
  const cssH = Math.max(1, els.canvas.offsetHeight);
  return {
    x: localX * (els.canvas.width / cssW),
    y: localY * (els.canvas.height / cssH),
  };
}
```

Player popup placement inverse (keep #map-popup inside #board-stage):

```js
function canvasToCssPoint(p) {
  const cssW = Math.max(1, els.canvas.offsetWidth);
  const cssH = Math.max(1, els.canvas.offsetHeight);
  return {
    x: p.x * (cssW / els.canvas.width),
    y: p.y * (cssH / els.canvas.height),
  };
}
```

Style popup buttons with min-height: 44px.

Fit baseline after computeLayout / enterGame / resize:

```js
function fitBoardToViewport() {
  const vp = document.getElementById("board-viewport");
  const displayW = Math.max(1, Math.min(vp.clientWidth, els.canvas.width));
  els.canvas.style.width = displayW + "px";
  els.canvas.style.height = "auto";
  boardCam.scale = 1;
  boardCam.tx = 0;
  boardCam.ty = 0;
  applyBoardTransform();
}
```

Call after first layout when game UI is visible, and on debounced resize / visualViewport (100ms). Pinch updates boardCam.scale around midpoint; +/- multiplies by 1.2 with center-stable tx/ty.

Pointer gesture state machine:

```js
const TAP_SLOP_PX = 10;
const pointers = new Map(); // pointerId -> {x,y}
let gestureMode = "none"; // none | pan | pinch
let suppressTap = false;
```

- pointerdown on #board-viewport: setPointerCapture; 1 pointer => potential pan/tap; 2 pointers => pinch (store dist, mid, start scale/tx/ty).
- pointermove: 1 pointer pans after movement > TAP_SLOP; 2 pointers scale from distance ratio keeping midpoint stable.
- pointerup/pointercancel: if single pointer ended and !suppressTap => tap: set hoverCell from camera-aware eventToCanvasPoint + pixelToHex, then run the desktop click action body.
- Use touch-action: none on viewport.
- Do not depend on mousemove for activation. Optional mouse hover for desktop browsers visiting m pages is fine, but tap must set hoverCell itself.

Player cancel on mobile: bottom bar #btn-cancel calls deselect(); keep Esc if keyboard present; do not depend on right-click.

### Preserving game logic while changing chrome

Hard rule: keep logic core, rewire DOM only.

| Domain | Keep as-is | May rewire DOM |
|--------|------------|----------------|
| API | API.post/get, apiAction, tokens, headers | - |
| State | state, applyEvent, loadFullState, maps | - |
| SSE | subscribeSse, EventSource URLs | status badge el |
| Hex math | HEX_SIZE, computeLayout, pixelToHex, drawing | camera wrappers only |
| Actions | move/attack/heal/deploy/demolish/end-turn bodies | selection UI presentation |
| Replay | rebuildToStep, timeline, playback | control placement |
| Markers | drawUnitMarker, entityTokenMarkup, score cards | container elements |

Chrome rewiring pattern:

1. Keep element ids used by logic (board, selection-detail, events, btn-end-turn, timeline buttons, etc.).
2. Move those nodes into the new shell HTML.
3. Sidebars become always-visible strips + drawers filled by the same innerHTML helpers.
4. Player: split sidebar render into turn strip / selection strip / info drawer / more drawer.
5. Spectator: turn strip + action summary + drawers 对局 / 局势 / 事件; replay stays fixed under board.

Host-without-token still redirects to spectator, but only play-m.js should target mobile spectator:

```js
window.location.href = "/spectator-m.html?gameId=" + encodeURIComponent(gameId);
```

Desktop play.js continues to use spectator.html.

### Redirect snippet (desktop pages)

In head of play.html / spectator.html after charset:

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<script>
(function () {
  try {
    if (!window.matchMedia("(max-width: 820px)").matches) return;
    var path = location.pathname || "";
    var target = null;
    if (/play\.html$/i.test(path)) target = "/play-m.html";
    else if (/spectator\.html$/i.test(path)) target = "/spectator-m.html";
    if (target) location.replace(target + location.search + location.hash);
  } catch (e) {}
})();
</script>
```

Also add viewport meta to m pages. Optional desktop header link that navigates to m page preserving query.

No reverse redirect on m pages for wide screens in v1. Landscape still uses mobile shell.

---

## 3. Ordered implementation tasks

### Task 0: Baseline copy + test harness

Files:
- Create: public/play-m.html, public/play-m.css, public/play-m.js
- Create: public/spectator-m.html, public/spectator-m.css, public/spectator-m.js
- Create: tests/public/mobile-pages.test.ts

- [ ] Step 1: Copy desktop files to mobile names

```bash
cp public/play.html public/play-m.html
cp public/play.css public/play-m.css
cp public/play.js public/play-m.js
cp public/spectator.html public/spectator-m.html
cp public/style.css public/spectator-m.css
cp public/app.js public/spectator-m.js
```

- [ ] Step 2: Point m HTML at m assets

In public/play-m.html:
- title -> TacticalGame player mobile
- href="/play-m.css"
- src="/play-m.js?v=3.0.3" (keep version.js)
- body class -> player-shell player-shell-m

In public/spectator-m.html:
- title -> TacticalGame spectator mobile
- href="/spectator-m.css"
- src="/spectator-m.js?v=3.0.3"
- body class -> spectator-shell spectator-shell-m

- [ ] Step 3: Write failing static tests in tests/public/mobile-pages.test.ts

Assert:
- all 6 m files exist and length > 100
- m HTML has viewport meta and links m css/js
- desktop play.html/spectator.html contain viewport + max-width: 820px + location.replace + play-m.html / spectator-m.html
- play-m shell has board-viewport, bottom-bar, btn-cancel, turn-strip, selection-strip, data-drawer=info
- play-m.css has .board-viewport, .bottom-bar, touch-action: none
- play-m.js has boardCam, eventToCanvasPoint, pointerdown, TAP_SLOP, spectator-m.html, attackRangeCells, /api/games/, end-turn
- spectator-m shell has board-viewport, replay-controls, bottom-bar, data-drawer games/situation/events
- spectator-m.js has boardCam, pointerdown, rebuildToStep, /api/games/

Use the same readFileSync + vitest style as tests/public/page-optimization.test.ts.

- [ ] Step 4: Run tests expecting FAIL on missing hooks

```bash
npx vitest run tests/public/mobile-pages.test.ts
```

- [ ] Step 5: Commit baseline copies + tests

```bash
git add public/play-m.* public/spectator-m.* tests/public/mobile-pages.test.ts
git commit -m "chore: scaffold mobile page copies and tests"
```

### Task 1: Viewport meta + desktop auto-redirect

Files:
- Modify: public/play.html, public/spectator.html
- Modify: public/play-m.html, public/spectator-m.html (viewport meta)

- [ ] Step 1: Add viewport + redirect to both desktop HTML files (snippet in Architecture notes)
- [ ] Step 2: Optional desktop mobile-entry link preserving query
- [ ] Step 3: Re-run mobile tests for redirect asserts
- [ ] Step 4: Commit

### Task 2: Player mobile HTML shell

Files:
- Modify: public/play-m.html

- [ ] Step 1: Rebuild body for mobile shell while preserving logic ids

Player wireframe:

```
header (brand + conn-status)
lobby #join-panel (full width, touch tabs/cards)
main#game-ui.game-ui-m.hidden
  #turn-strip (turn-badge, actions-display, resources-display)
  #board-viewport > #board-stage > canvas#board + cell-info + map-popup
  zoom-controls +/-
  #selection-strip button wrapping #selection-detail
  #bottom-bar: info / cancel / end-turn / more
  drawers: info (score-panel, action-hints), more (btn-refresh, event-log)
toast
scripts version.js + play-m.js
```

Preserve ids: board, selection-detail, events, btn-end-turn, btn-refresh, score-panel, lobby fields, map-popup, turn-badge, actions-display, resources-display, conn-status, toast.

- [ ] Step 2: Commit HTML shell

### Task 3: Player mobile CSS shell

Files:
- Modify: public/play-m.css

- [ ] Step 1: Replace desktop 3-column layout with app shell

Key requirements:
- body.player-shell-m: flex column, min/max-height 100dvh, overflow hidden in game mode
- #join-panel: flex 1, overflow auto, full width, 16px inputs
- .game-ui-m: flex column, no grid-template-columns, padding 0
- .turn-strip / .selection-strip / .bottom-bar flex 0 0 auto
- .board-viewport flex 1, min-height 0, overflow hidden, touch-action none
- .board-stage absolute + transform-origin 0 0
- zoom-controls 44px buttons
- bottom-bar 4-col grid, min-height 48px buttons, safe-area-inset-bottom
- drawers fixed bottom sheet max-height min(80dvh,640px), backdrop
- map-popup-btn min-height 44px
- landscape still this shell (do not restore 3-col)
- neutralize desktop @media 1180/720 reorder rules

- [ ] Step 2: Commit CSS

### Task 4: Player mobile JS chrome + drawers (logic preserved)

Files:
- Modify: public/play-m.js

- [ ] Step 1: Change host/no-token redirects from spectator.html to spectator-m.html (two sites near startHostedGame and enterGame)
- [ ] Step 2: Add openDrawer/closeDrawer for info/more + backdrop + selection-strip opens info
- [ ] Step 3: Wire #btn-cancel -> deselect() + closeDrawer()
- [ ] Step 4: Ensure els map still resolves moved nodes by id
- [ ] Step 5: After enterGame and computeLayout, call fitBoardToViewport()
- [ ] Step 6: Commit chrome wiring

### Task 5: Player mobile JS pan / pinch / tap gestures

Files:
- Modify: public/play-m.js

- [ ] Step 1: Add boardCam + applyBoardTransform + fitBoardToViewport
- [ ] Step 2: Replace eventToCanvasPoint and canvasToCssPoint with camera-aware versions from Architecture notes
- [ ] Step 3: Extract old canvas click body into async onBoardActivate()
- [ ] Step 4: Attach pointerdown/move/up/cancel on #board-viewport with TAP_SLOP_PX=10, pan, pinch midpoint-stable zoom, tap sets hoverCell then onBoardActivate
- [ ] Step 5: Remove activation dependency on mousemove/hoverCell race
- [ ] Step 6: Wire zoom buttons; optional mouse hover when no active pointer
- [ ] Step 7: On pan/pinch only CSS transform - do not redraw board every move
- [ ] Step 8: Commit gestures

### Task 3: Player mobile CSS shell

Files:
- Modify: public/play-m.css

- [ ] Step 1: Replace desktop 3-column layout with app shell

Key requirements:
- body.player-shell-m: flex column, min/max-height 100dvh, overflow hidden in game mode
- #join-panel: flex 1, overflow auto, full width, 16px inputs
- .game-ui-m: flex column, no grid-template-columns, padding 0
- .turn-strip / .selection-strip / .bottom-bar flex 0 0 auto
- .board-viewport flex 1, min-height 0, overflow hidden, touch-action none
- .board-stage absolute + transform-origin 0 0
- zoom-controls 44px buttons
- bottom-bar 4-col grid, min-height 48px buttons, safe-area-inset-bottom
- drawers fixed bottom sheet max-height min(80dvh,640px), backdrop
- map-popup-btn min-height 44px
- landscape still this shell (do not restore 3-col)
- neutralize desktop @media 1180/720 reorder rules

- [ ] Step 2: Commit CSS

### Task 4: Player mobile JS chrome + drawers (logic preserved)

Files:
- Modify: public/play-m.js

- [ ] Step 1: Change host/no-token redirects from spectator.html to spectator-m.html (two sites near startHostedGame and enterGame)
- [ ] Step 2: Add openDrawer/closeDrawer for info/more + backdrop + selection-strip opens info
- [ ] Step 3: Wire #btn-cancel -> deselect() + closeDrawer()
- [ ] Step 4: Ensure els map still resolves moved nodes by id
- [ ] Step 5: After enterGame and computeLayout, call fitBoardToViewport()
- [ ] Step 6: Commit chrome wiring

### Task 5: Player mobile JS pan / pinch / tap gestures

Files:
- Modify: public/play-m.js

- [ ] Step 1: Add boardCam + applyBoardTransform + fitBoardToViewport
- [ ] Step 2: Replace eventToCanvasPoint and canvasToCssPoint with camera-aware versions from Architecture notes
- [ ] Step 3: Extract old canvas click body into async onBoardActivate()
- [ ] Step 4: Attach pointerdown/move/up/cancel on #board-viewport with TAP_SLOP_PX=10, pan, pinch midpoint-stable zoom, tap sets hoverCell then onBoardActivate
- [ ] Step 5: Remove activation dependency on mousemove/hoverCell race
- [ ] Step 6: Wire zoom buttons; optional mouse hover when no active pointer
- [ ] Step 7: On pan/pinch only CSS transform - do not redraw board every move
- [ ] Step 8: Commit gestures

### Task 6: Spectator mobile HTML + CSS shell

Files:
- Modify: public/spectator-m.html, public/spectator-m.css

- [ ] Step 1: HTML shell

Spectator wireframe:

```
header-m: brand, game-picker-button/label/menu, hidden game-select, btn-settings, settings-popover, status
main.spectator-main-m
  #turn-strip > #turn-info
  #board-viewport > stage > canvas + cell-info; zoom +/-
  #action-summary > #detail-content
  #replay-controls (transport + timeline) fixed under board
  #bottom-bar: games / situation / events
drawers:
  games: refresh-list, delete-game, export/import, import-file
  situation: resources, score-panel, selection-detail
  events: ul#events
scripts version.js + spectator-m.js
```

Preserve all existing control ids used by app.js.

- [ ] Step 2: CSS app shell same patterns as player; replay bar flex 0; bottom bar 3 cols; drawers; touch-action none; safe-area; no desktop grid restore in landscape
- [ ] Step 3: Commit

### Task 7: Spectator mobile JS chrome + gestures

Files:
- Modify: public/spectator-m.js

- [ ] Step 1: Drawer wiring for games/situation/events
- [ ] Step 2: Same boardCam + pointer gesture model as player
- [ ] Step 3: Tap sets hoverCell and calls renderSelectionInfo(entity, cp); no hover dependency
- [ ] Step 4: Keep URLSearchParams gameId bootstrap at file bottom
- [ ] Step 5: fitBoardToViewport after loadGameState / layout changes
- [ ] Step 6: Commit

### Task 8: Lobby touch polish (play-m only)

Files:
- Modify: public/play-m.css, maybe public/play-m.html / play-m.js

- [ ] Step 1: Map cards single column, large hit areas, full-width CTAs
- [ ] Step 2: Inputs font-size 16px to avoid iOS zoom; copy buttons min 44px
- [ ] Step 3: Lobby allows body scroll; game-ui locks body overflow hidden
- [ ] Step 4: Commit

### Task 9: Tests green + desktop regression

Files:
- Modify: tests/public/mobile-pages.test.ts as needed
- Verify: tests/public/page-optimization.test.ts still passes

- [ ] Step 1: npx vitest run tests/public/page-optimization.test.ts tests/public/mobile-pages.test.ts
- [ ] Step 2: npm test full suite
- [ ] Step 3: Commit any test fixes

### Task 10: Manual browser verification (~390px)

Not automated. Chrome DevTools iPhone 12/13 390x844 + landscape + desktop wide.

Player checklist:
1. /play.html at 390px auto-redirects to /play-m.html (query preserved)
2. Lobby create/join/map cards/copy work with large targets
3. Enter game: board-first, turn strip, fixed bottom bar
4. Pinch zoom, pan, +/- work
5. Tap own unit -> popup actions; tap move hex succeeds
6. Cancel clears selection; end-turn works; drawers open/close
7. No hover required
8. Landscape still mobile shell
9. Host-only path redirects to spectator-m.html?gameId=...

Spectator checklist:
1. /spectator.html -> /spectator-m.html; ?gameId= selects game
2. Board pan/pinch; tap updates selection
3. Replay transport always visible; play/pause/step/timeline work
4. Drawers games/situation/events work
5. Settings + SSE live updates work

Desktop regression:
1. >820px no redirect; 3-column intact
2. Desktop click/hover still works

- [ ] Step 1: Manual verify and fix hit-test bugs (common: transformed getBoundingClientRect)
- [ ] Step 2: Final polish commit if needed

### Task 6: Spectator mobile HTML + CSS shell

Files:
- Modify: public/spectator-m.html, public/spectator-m.css

- [ ] Step 1: HTML shell

Spectator wireframe:

```
header-m: brand, game-picker-button/label/menu, hidden game-select, btn-settings, settings-popover, status
main.spectator-main-m
  #turn-strip > #turn-info
  #board-viewport > stage > canvas + cell-info; zoom +/-
  #action-summary > #detail-content
  #replay-controls (transport + timeline) fixed under board
  #bottom-bar: games / situation / events
drawers:
  games: refresh-list, delete-game, export/import, import-file
  situation: resources, score-panel, selection-detail
  events: ul#events
scripts version.js + spectator-m.js
```

Preserve all existing control ids used by app.js.

- [ ] Step 2: CSS app shell same patterns as player; replay bar flex 0; bottom bar 3 cols; drawers; touch-action none; safe-area; no desktop grid restore in landscape
- [ ] Step 3: Commit

### Task 7: Spectator mobile JS chrome + gestures

Files:
- Modify: public/spectator-m.js

- [ ] Step 1: Drawer wiring for games/situation/events
- [ ] Step 2: Same boardCam + pointer gesture model as player
- [ ] Step 3: Tap sets hoverCell and calls renderSelectionInfo(entity, cp); no hover dependency
- [ ] Step 4: Keep URLSearchParams gameId bootstrap at file bottom
- [ ] Step 5: fitBoardToViewport after loadGameState / layout changes
- [ ] Step 6: Commit

### Task 8: Lobby touch polish (play-m only)

Files:
- Modify: public/play-m.css, maybe public/play-m.html / play-m.js

- [ ] Step 1: Map cards single column, large hit areas, full-width CTAs
- [ ] Step 2: Inputs font-size 16px to avoid iOS zoom; copy buttons min 44px
- [ ] Step 3: Lobby allows body scroll; game-ui locks body overflow hidden
- [ ] Step 4: Commit

### Task 9: Tests green + desktop regression

Files:
- Modify: tests/public/mobile-pages.test.ts as needed
- Verify: tests/public/page-optimization.test.ts still passes

- [ ] Step 1: npx vitest run tests/public/page-optimization.test.ts tests/public/mobile-pages.test.ts
- [ ] Step 2: npm test full suite
- [ ] Step 3: Commit any test fixes

### Task 10: Manual browser verification (~390px)

Not automated. Chrome DevTools iPhone 12/13 390x844 + landscape + desktop wide.

Player checklist:
1. /play.html at 390px auto-redirects to /play-m.html (query preserved)
2. Lobby create/join/map cards/copy work with large targets
3. Enter game: board-first, turn strip, fixed bottom bar
4. Pinch zoom, pan, +/- work
5. Tap own unit -> popup actions; tap move hex succeeds
6. Cancel clears selection; end-turn works; drawers open/close
7. No hover required
8. Landscape still mobile shell
9. Host-only path redirects to spectator-m.html?gameId=...

Spectator checklist:
1. /spectator.html -> /spectator-m.html; ?gameId= selects game
2. Board pan/pinch; tap updates selection
3. Replay transport always visible; play/pause/step/timeline work
4. Drawers games/situation/events work
5. Settings + SSE live updates work

Desktop regression:
1. >820px no redirect; 3-column intact
2. Desktop click/hover still works

- [ ] Step 1: Manual verify and fix hit-test bugs (common: transformed getBoundingClientRect)
- [ ] Step 2: Final polish commit if needed

---

## 4. Test plan

### Automated (Vitest string asserts)

| Suite | Purpose |
|-------|---------|
| tests/public/mobile-pages.test.ts | m files exist; viewport; asset links; shell ids; gesture symbols (boardCam, pointerdown, TAP_SLOP); core API strings preserved; desktop redirect snippet |
| tests/public/page-optimization.test.ts | Unchanged desktop shell/regression asserts still pass |
| Full npm test | No accidental backend/engine breakage |

### Manual (~390px + landscape + desktop wide)

See Task 10 checklists.

### What not to test in v1

- Shared module extraction
- PWA/service worker
- control/map-editor mobile
- Automated visual screenshot CI
- Multi-touch fidelity beyond DevTools for desktop browsers

---

## 5. Out of scope

1. control.html / map-editor.html mobile adaptation
2. Backend API / SSE protocol / game rules changes
3. Shared packages or bundlers for deduplicating play.js/app.js
4. PWA install, offline cache, push notifications
5. Restoring desktop 3-column layout in landscape on phones
6. Reverse auto-redirect from m -> desktop on wide screens
7. Redesigning game balance or hex rules
8. iOS Safari private API quirks beyond viewport-fit + 16px inputs + safe-area
9. Changing HEX_SIZE or server-side map rendering
10. New npm dependencies / frameworks

---

## 6. Risks and mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Copy-then-modify drift vs desktop | Bugs fixed only on one side | v1 accepted; document dual-fix; keep logic function names identical for grepping |
| Hit-testing wrong under CSS transform | Taps select wrong hex | Inverse camera + offsetWidth pipeline; never use transformed getBoundingClientRect alone for canvas scale; manual verify |
| hoverCell + click race on touch | Actions no-op | Pointer tap sets hoverCell then activates in same handler |
| iOS input focus zooms page | Lobby UX jank | font-size 16px on inputs; viewport meta |
| Pinch conflicts with browser navigation gestures | Accidental back/refresh | touch-action:none on board-viewport only; drawers keep default scrolling |
| 100vh mobile browser chrome | Bottom bar obscured | Use 100dvh + env(safe-area-inset-bottom) |
| Popup off-screen after pan | Cannot choose move/attack | Clamp popup into stage/viewport; large buttons |
| Desktop tests brittle if play.html redirect strings confuse old asserts | CI red | Keep desktop shell classes; put new asserts in mobile-pages.test.ts |
| Large JS files (~1.2-1.3k lines) hard to edit | Agent mistakes | Extract only gesture/drawer helpers as functions inside same file; do not split modules in v1 |
| Host redirect still points to desktop spectator | Breaks mobile flow | Explicitly change only play-m.js redirects to spectator-m.html |
| Performance: redraw every pointermove hover | Jank | On pan/pinch only applyBoardTransform (CSS); spectator selection on tap only |
| Accidental backend edits | Scope creep | Code review gate: no src/ changes except optional log lines |

---

## 7. Implementation order (quick reference)

1. Scaffold copies + mobile tests (Task 0)
2. Viewport + redirect on desktop (Task 1)
3. Player HTML shell (Task 2)
4. Player CSS shell (Task 3)
5. Player drawers/chrome JS (Task 4)
6. Player gestures (Task 5)
7. Spectator HTML/CSS shell (Task 6)
8. Spectator JS drawers + gestures (Task 7)
9. Lobby polish (Task 8)
10. Tests green (Task 9)
11. Manual device checks (Task 10)

---

## Critical Files for Implementation

- C:/cosmos/github/game/public/play-m.js — player logic + camera + gestures + drawers
- C:/cosmos/github/game/public/play-m.html and play-m.css — player shell
- C:/cosmos/github/game/public/spectator-m.js — spectator logic + camera + gestures
- C:/cosmos/github/game/public/spectator-m.html and spectator-m.css — spectator shell
- C:/cosmos/github/game/public/play.html and spectator.html — viewport + redirect only
- C:/cosmos/github/game/tests/public/mobile-pages.test.ts — static regression net

Desktop references (read-only patterns to copy):

- C:/cosmos/github/game/public/play.js (eventToCanvasPoint, click/hover, actions)
- C:/cosmos/github/game/public/app.js (replay, picker, selection)
- C:/cosmos/github/game/tests/public/page-optimization.test.ts (assert style)

---

## Self-review (spec coverage)

| Requirement | Task |
|-------------|------|
| Near-app mobile UX | Tasks 2-7 shells + gestures |
| Only player + spectator | Out of scope list; no control/editor files |
| Independent m pages | Task 0 copies |
| Auto-redirect <=820px + query | Task 1 |
| Board-first + bottom bar + drawers | Tasks 2-3, 6 |
| Player chrome elements | Task 2 |
| Spectator chrome + replay under board | Task 6 |
| Pan/pinch/tap + threshold | Tasks 5, 7 + architecture section |
| Landscape stays mobile | CSS notes Tasks 3, 6 |
| Lobby in play-m | Tasks 2, 8 |
| Copy-then-modify | Task 0 |
| No backend API changes | Out of scope + risks |
| Tests parallel | Tasks 0, 9 |
| Gesture compose with eventToCanvasPoint | Architecture Gesture / transform model |
| Preserve game logic | Architecture Preserving game logic |

No TBD placeholders remain for implementation decisions required in v1.
