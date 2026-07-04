# Visual Entity Markers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace abbreviation-only board and selection markers with compact visual markers for units, headquarters, and control points.

**Architecture:** The public spectator and player pages each own their canvas drawing code, so the helpers will be added to both bundles using the same function names and marker vocabulary. CSS token classes will be duplicated in `style.css` and `play.css` to match the existing public-file structure.

**Tech Stack:** Plain JavaScript canvas, CSS, Vitest static file assertions.

## Global Constraints

- No new runtime dependencies.
- No image assets; use canvas drawing and CSS only.
- Preserve existing colors and information hierarchy.
- Keep markers readable at the current `HEX_SIZE = 28`.
- Apply the same visual system to spectator and player pages.

---

## File Structure

- Modify `public/app.js`: add canvas glyph helpers, marker functions, visual token HTML helper; replace `fillText` calls in `drawBoard()` and `sel-token` text in `renderEntityCard()` / `renderControlPointCard()`.
- Modify `public/play.js`: mirror the same helpers and replacements as `app.js`.
- Modify `public/style.css`: add `.visual-token`, `.token-icon`, `.token-label`, and per-type icon classes for spectator.
- Modify `public/play.css`: add the same CSS classes for player.
- Modify `tests/public/page-optimization.test.ts`: add regression test for all new functions and CSS classes.

## Glyph Design Reference

All canvas glyphs are drawn inside a ~12px box centered on `(x, y)`. Colors: glyphs use `#071016` (dark fill) and `#071016` with lineWidth 1.5 (dark stroke) matching the current abbreviation text color.

| Entity | Glyph | Description |
|--------|-------|-------------|
| infantry | crosshair (×) | Two perpendicular lines forming a cross |
| scout | triangle ▲ | Upward-pointing filled triangle |
| heavy | filled square ■ | Solid filled rectangle |
| ranger | diamond ◆ | 45° rotated filled square |
| support | plus + | Medical-style cross |
| headquarters | building | Rectangle body + triangle roof |
| supply CP | concentric circles | Stroked outer circle + filled inner dot |
| forward_base CP | flag | Vertical pole + triangular flag |
| repair CP | wrench | Circle + diagonal handle line |

---

## Task 1: Add Regression Test

**Files:**
- Modify: `tests/public/page-optimization.test.ts`

**Interfaces:**
- Consumes: public file source text.
- Produces: assertions requiring all new function names and CSS classes.

- [ ] **Step 1: Write the failing test**

Append to the `describe` block in `tests/public/page-optimization.test.ts`:

```ts
  it('renders visual entity markers instead of abbreviation-only board labels', () => {
    const spectator = read('public/app.js');
    const player = read('public/play.js');
    const spectatorCss = read('public/style.css');
    const playerCss = read('public/play.css');

    for (const source of [spectator, player]) {
      expect(source).toContain('function drawUnitGlyph');
      expect(source).toContain('function drawControlPointGlyph');
      expect(source).toContain('function drawUnitMarker');
      expect(source).toContain('function drawHeadquartersMarker');
      expect(source).toContain('function drawControlPointMarker');
      expect(source).toContain('function entityTokenMarkup');
      expect(source).toContain('function entityShortName');
      expect(source).toContain('function entityTokenClass');
    }

    for (const css of [spectatorCss, playerCss]) {
      expect(css).toContain('.visual-token');
      expect(css).toContain('.token-icon');
      expect(css).toContain('.token-label');
      expect(css).toContain('.token-icon.infantry');
      expect(css).toContain('.token-icon.scout');
      expect(css).toContain('.token-icon.heavy');
      expect(css).toContain('.token-icon.ranger');
      expect(css).toContain('.token-icon.support');
      expect(css).toContain('.token-icon.headquarters');
      expect(css).toContain('.token-icon.supply');
      expect(css).toContain('.token-icon.forward_base');
      expect(css).toContain('.token-icon.repair');
    }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/public/page-optimization.test.ts`

Expected: FAIL because none of the new functions or CSS classes exist.

---

## Task 2: Implement Canvas Glyph Helpers

**Files:**
- Modify: `public/app.js`
- Modify: `public/play.js`

**Interfaces:**
- Consumes: existing `HEX_SIZE`, `pathHex`, `hexToPixel`, `OWNER_COLOR`, entity objects.
- Produces: `drawUnitGlyph(type, x, y)`, `drawControlPointGlyph(kind, x, y)`.

Both files get identical implementations.

- [ ] **Step 1: Add `drawUnitGlyph` to `public/app.js`**

Insert after `drawHpBar` (after line 298):

```js
function drawUnitGlyph(type, x, y) {
  ctx.save();
  ctx.fillStyle = '#071016';
  ctx.strokeStyle = '#071016';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  switch (type) {
    case 'infantry': {
      // crosshair: vertical + horizontal lines
      ctx.moveTo(x, y - 5); ctx.lineTo(x, y + 5);
      ctx.moveTo(x - 5, y); ctx.lineTo(x + 5, y);
      ctx.stroke();
      break;
    }
    case 'scout': {
      // upward triangle
      ctx.moveTo(x, y - 6);
      ctx.lineTo(x - 5, y + 4);
      ctx.lineTo(x + 5, y + 4);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'heavy': {
      // filled square
      ctx.fillRect(x - 5, y - 5, 10, 10);
      break;
    }
    case 'ranger': {
      // diamond
      ctx.moveTo(x, y - 6);
      ctx.lineTo(x + 4, y);
      ctx.lineTo(x, y + 6);
      ctx.lineTo(x - 4, y);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'support': {
      // medical plus
      ctx.moveTo(x - 2, y - 5); ctx.lineTo(x + 2, y - 5);
      ctx.lineTo(x + 2, y - 2); ctx.lineTo(x + 5, y - 2);
      ctx.lineTo(x + 5, y + 2); ctx.lineTo(x + 2, y + 2);
      ctx.lineTo(x + 2, y + 5); ctx.lineTo(x - 2, y + 5);
      ctx.lineTo(x - 2, y + 2); ctx.lineTo(x - 5, y + 2);
      ctx.lineTo(x - 5, y - 2); ctx.lineTo(x - 2, y - 2);
      ctx.closePath();
      ctx.fill();
      break;
    }
    default:
      break;
  }
  ctx.restore();
}
```

- [ ] **Step 2: Add `drawControlPointGlyph` to `public/app.js`**

Insert after `drawUnitGlyph`:

```js
function drawControlPointGlyph(kind, x, y) {
  ctx.save();
  ctx.fillStyle = '#071016';
  ctx.strokeStyle = '#071016';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  switch (kind) {
    case 'supply': {
      // concentric circles: outer stroke, inner filled dot
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'forward_base': {
      // flag: pole + triangular flag
      ctx.moveTo(x - 3, y + 6);
      ctx.lineTo(x - 3, y - 6);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 3, y - 6);
      ctx.lineTo(x + 6, y - 2);
      ctx.lineTo(x - 3, y + 2);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'repair': {
      // wrench: circle + diagonal handle
      ctx.arc(x, y - 1, 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + 3, y + 3);
      ctx.lineTo(x + 6, y + 6);
      ctx.stroke();
      break;
    }
    default:
      break;
  }
  ctx.restore();
}
```

- [ ] **Step 3: Copy both functions into `public/play.js`**

Insert `drawUnitGlyph` and `drawControlPointGlyph` into `public/play.js` after `drawHpBar` (after line 346), identical to the `app.js` versions.

- [ ] **Step 4: Run focused test**

Run: `npx vitest run tests/public/page-optimization.test.ts`

Expected: the glyph function assertions PASS; marker/CSS assertions still FAIL.

---

## Task 3: Replace Board Abbreviation Drawing

**Files:**
- Modify: `public/app.js`
- Modify: `public/play.js`

**Interfaces:**
- Consumes: `drawUnitGlyph`, `drawControlPointGlyph`.
- Produces: `drawUnitMarker(unit)`, `drawHeadquartersMarker(hq)`, `drawControlPointMarker(cp)` that fully replace the old `fillText` calls.

- [ ] **Step 1: Add marker functions to `public/app.js`**

Insert after `drawControlPointGlyph`:

```js
function drawUnitMarker(u) {
  if (!u.alive) return;
  const p = hexToPixel(u.q, u.r);
  ctx.fillStyle = OWNER_COLOR[u.owner];
  ctx.beginPath();
  ctx.arc(p.x, p.y, HEX_SIZE * 0.42, 0, Math.PI * 2);
  ctx.fill();
  drawUnitGlyph(u.type, p.x, p.y);
  drawHpBar(p.x, p.y - 21, 34, u.hp, u.maxHp);
  if (u.hasMoved || u.hasActed) {
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath();
    ctx.arc(p.x + 12, p.y + 12, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawHeadquartersMarker(hq) {
  const p = hexToPixel(hq.q, hq.r);
  pathHex(hq.q, hq.r, 5);
  ctx.fillStyle = hq.alive ? OWNER_COLOR[hq.owner] : '#555';
  ctx.globalAlpha = hq.alive ? 0.78 : 0.3;
  ctx.fill();
  ctx.globalAlpha = 1;
  // building glyph: rectangle body + triangle roof
  ctx.save();
  ctx.fillStyle = '#071016';
  ctx.beginPath();
  ctx.fillRect(p.x - 6, p.y - 2, 12, 8);
  ctx.beginPath();
  ctx.moveTo(p.x, p.y - 8);
  ctx.lineTo(p.x - 7, p.y - 2);
  ctx.lineTo(p.x + 7, p.y - 2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  drawHpBar(p.x, p.y - 25, 42, hq.hp, hq.maxHp);
}

function drawControlPointMarker(cp) {
  const p = hexToPixel(cp.q, cp.r);
  pathHex(cp.q, cp.r, 8);
  ctx.fillStyle = cp.owner ? OWNER_COLOR[cp.owner] : '#d6b34a';
  ctx.globalAlpha = 0.32;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = cp.owner ? OWNER_COLOR[cp.owner] : '#d6b34a';
  ctx.lineWidth = 2;
  ctx.stroke();
  if (cp.kind) {
    drawControlPointGlyph(cp.kind, p.x, p.y);
  }
}
```

- [ ] **Step 2: Replace `drawBoard` unit loop in `public/app.js`**

Replace the unit drawing block (lines 351-369) — the `for (const u of state.units.values())` block:

```js
  for (const u of state.units.values()) {
    drawUnitMarker(u);
  }
```

- [ ] **Step 3: Replace `drawBoard` HQ loop in `public/app.js`**

Replace the HQ drawing block (lines 337-349) — the `for (const hq of state.headquarters.values())` block:

```js
  for (const hq of state.headquarters.values()) {
    drawHeadquartersMarker(hq);
  }
```

- [ ] **Step 4: Replace `drawBoard` CP loop in `public/app.js`**

Replace the CP drawing block (lines 321-335) — the `for (const cp of state.controlPoints.values())` block:

```js
  for (const cp of state.controlPoints.values()) {
    drawControlPointMarker(cp);
  }
```

- [ ] **Step 5: Mirror all changes into `public/play.js`**

Apply the exact same changes from Steps 1-4 to `public/play.js`:

1. Insert `drawUnitMarker`, `drawHeadquartersMarker`, `drawControlPointMarker` after `drawControlPointGlyph`.
2. Replace the unit loop (lines 448-453) with `for (const u of state.units.values()) { drawUnitMarker(u); }`.
3. Replace the HQ loop (lines 444-447) with `for (const hq of state.headquarters.values()) { drawHeadquartersMarker(hq); }`.
4. Replace the CP loop (lines 438-443) with `for (const cp of state.controlPoints.values()) { drawControlPointMarker(cp); }`.

- [ ] **Step 6: Run focused test**

Run: `npx vitest run tests/public/page-optimization.test.ts`

Expected: all marker function assertions PASS; only CSS and `entityTokenMarkup` assertions still FAIL.

---

## Task 4: Replace Selection Token Markup

**Files:**
- Modify: `public/app.js`
- Modify: `public/play.js`

**Interfaces:**
- Consumes: entity objects.
- Produces: `entityShortName(type)`, `entityTokenClass(type)`, `entityTokenMarkup(type, ownerClass, title)` replacing plain `.sel-token` text.

- [ ] **Step 1: Add name/class helpers to `public/app.js`**

Insert after the existing `UNIT_LABELS` constant (after line 14):

```js
const UNIT_SHORT_NAMES = { infantry: '步', scout: '侦', heavy: '重', ranger: '远', support: '支', headquarters: '部' };
const CONTROL_POINT_SHORT_NAMES = { supply: '给', forward_base: '前', repair: '修' };
function entityShortName(type) {
  return UNIT_SHORT_NAMES[type] || CONTROL_POINT_SHORT_NAMES[type] || '?';
}
function entityTokenClass(type) {
  return type || '';
}
```

- [ ] **Step 2: Add `entityTokenMarkup` to `public/app.js`**

Insert after `entityTokenClass`:

```js
function entityTokenMarkup(type, ownerClass, title) {
  const cls = entityTokenClass(type);
  const label = entityShortName(type);
  return `<div class="visual-token ${ownerClass}">
    <span class="token-icon ${cls}" title="${esc(title)}"></span>
    <span class="token-label">${esc(label)}</span>
  </div>`;
}
```

- [ ] **Step 3: Replace token in `renderEntityCard` in `public/app.js`**

Replace the `.sel-token` line (currently line 422):

```js
      <div class="sel-token ${ownerClass}">${esc(UNIT_LABELS[type] || '?')}</div>
```

With:

```js
      ${entityTokenMarkup(type, ownerClass, title)}
```

- [ ] **Step 4: Replace token in `renderControlPointCard` in `public/app.js`**

Replace the `.sel-token` line (currently line 442):

```js
      <div class="sel-token cp">CP</div>
```

With:

```js
      ${entityTokenMarkup(cp.kind || 'supply', ownerClass, cp.name)}
```

- [ ] **Step 5: Mirror all changes into `public/play.js`**

1. Insert `UNIT_SHORT_NAMES`, `CONTROL_POINT_SHORT_NAMES`, `entityShortName`, `entityTokenClass`, `entityTokenMarkup` after the existing constants (after line 9).
2. Replace `.sel-token` in `renderEntityCard` (line 394) with `entityTokenMarkup(type, ownerClass, title)`.
3. Replace `.sel-token` in `renderControlPointCard` (line 413) with `entityTokenMarkup(cp.kind || 'supply', ownerClass, cp.name)`.

- [ ] **Step 6: Run focused test**

Run: `npx vitest run tests/public/page-optimization.test.ts`

Expected: all assertions PASS except CSS ones.

---

## Task 5: Style Visual Tokens

**Files:**
- Modify: `public/style.css`
- Modify: `public/play.css`

**Interfaces:**
- Consumes: `.visual-token`, `.token-icon`, `.token-label` markup.
- Produces: compact two-line visual tokens replacing text-only `.sel-token`.

- [ ] **Step 1: Add visual token CSS to `public/style.css`**

Insert after the `.sel-token.cp` rule (after line 171):

```css
/* visual entity tokens */
.visual-token {
  width: 42px;
  height: 42px;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  flex-shrink: 0;
  background: #1a2a3a;
  border: 1px solid #34546a;
  color: #cfe8f6;
}
.visual-token.player-a { background: rgba(80,170,220,.18); border-color: rgba(102,204,255,.55); color: #9de3ff; }
.visual-token.player-b { background: rgba(230,130,80,.18); border-color: rgba(255,153,102,.55); color: #ffc29e; }
.visual-token.neutral { background: rgba(214,179,74,.18); border-color: rgba(214,179,74,.6); color: #f0d77c; }
.token-icon {
  width: 14px;
  height: 14px;
  display: block;
  flex-shrink: 0;
}
/* infantry: crosshair */
.token-icon.infantry {
  background: radial-gradient(circle, currentColor 2.5px, transparent 2.5px);
  position: relative;
}
.token-icon.infantry::before, .token-icon.infantry::after {
  content: ''; position: absolute; background: currentColor;
}
.token-icon.infantry::before { left: 50%; top: 0; bottom: 0; width: 2px; transform: translateX(-50%); }
.token-icon.infantry::after { top: 50%; left: 0; right: 0; height: 2px; transform: translateY(-50%); }
/* scout: triangle up */
.token-icon.scout {
  width: 0; height: 0; background: none;
  border-left: 7px solid transparent;
  border-right: 7px solid transparent;
  border-bottom: 12px solid currentColor;
}
/* heavy: filled square */
.token-icon.heavy { background: currentColor; border-radius: 2px; }
/* ranger: diamond */
.token-icon.ranger {
  background: currentColor; border-radius: 2px;
  transform: rotate(45deg); width: 10px; height: 10px; margin: 2px;
}
/* support: medical plus */
.token-icon.support {
  background:
    linear-gradient(to right, transparent 5px, currentColor 5px, currentColor 7px, transparent 7px),
    linear-gradient(to bottom, transparent 3px, currentColor 3px, currentColor 5px, transparent 5px);
}
/* headquarters: building */
.token-icon.headquarters {
  background: currentColor;
  clip-path: polygon(0% 30%, 50% 0%, 100% 30%, 100% 100%, 0% 100%);
}
/* supply: concentric circles */
.token-icon.supply {
  background: radial-gradient(circle, currentColor 3px, transparent 3px);
  border: 2px solid currentColor; border-radius: 50%; width: 12px; height: 12px;
}
/* forward_base: flag */
.token-icon.forward_base {
  background: linear-gradient(to right, currentColor 2px, transparent 2px),
              linear-gradient(to bottom, transparent 2px, currentColor 2px, currentColor 7px, transparent 7px);
}
/* repair: wrench (circle + line) */
.token-icon.repair {
  background: radial-gradient(circle at 40% 40%, transparent 3px, currentColor 3px, currentColor 4px, transparent 4px);
  position: relative;
}
.token-icon.repair::after {
  content: ''; position: absolute;
  bottom: 0; right: 0;
  width: 2px; height: 7px;
  background: currentColor;
  transform: rotate(-45deg);
  transform-origin: top left;
}
.token-label {
  font: 700 9px -apple-system, "Microsoft YaHei", sans-serif;
  line-height: 1;
  text-transform: none;
}
```

- [ ] **Step 2: Copy visual token CSS to `public/play.css`**

Insert the identical CSS block (from Step 1) into `public/play.css` after the `.sel-token.cp` rule (after line 417).

- [ ] **Step 3: Run focused test**

Run: `npx vitest run tests/public/page-optimization.test.ts`

Expected: ALL assertions PASS.

---

## Task 6: Verify

**Files:**
- No additional file changes.

**Interfaces:**
- Consumes: complete working tree changes.
- Produces: verified visual marker system.

- [ ] **Step 1: Run full test suite**

Run: `npm test`

Expected: PASS — all Vitest suites green, including the new regression test.

- [ ] **Step 2: Build TypeScript**

Run: `npm run build`

Expected: PASS — no TypeScript compilation errors.

- [ ] **Step 3: Manual visual check**

Start the server (`npm start` or equivalent) and verify:
- Board units show colored circles with distinct glyphs (×, ▲, ■, ◆, +) instead of INF/SCT/HVY/RNG/SUP text.
- Headquarters show building glyph instead of "HQ" text.
- Control points show kind-specific glyphs (concentric circles, flag, wrench) instead of SUP/FWD/REP text.
- Selection cards show two-line visual tokens (CSS icon + short Chinese label) instead of plain abbreviation text.
- Spectator page renders the same visual system as the player page.
- HP bars, ownership colors, hover highlights, and hit testing all work as before.

- [ ] **Step 4: Commit changes**

```bash
git add public/app.js public/play.js public/style.css public/play.css tests/public/page-optimization.test.ts
git commit -m "feat: replace abbreviation markers with visual entity glyphs"
```

## Self-Review

- Spec coverage: board unit markers, HQ markers, CP markers, selection tokens, CSS styling, regression test, and verification are all covered.
- No deferred behavior: every entity type has a concrete glyph design; no "TBD" or "design later" placeholders.
- Both bundles updated: `app.js` and `play.js` get identical helpers; `style.css` and `play.css` get identical CSS.
- Constraints met: no new dependencies, no image assets, preserves existing colors/layout, readable at HEX_SIZE=28.
