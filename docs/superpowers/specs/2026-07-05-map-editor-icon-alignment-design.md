# Map Editor Icon Alignment Design

## Goal

Make the map editor's canvas icons and inspector tokens visually consistent with the spectator (`app.js`) and player (`play.js`) pages, so users see the same glyph vocabulary everywhere.

## Scope

- Update canvas drawing in `public/map-editor.js`.
- Add `.token-icon` CSS classes and markup in `public/map-editor.css` for the selection panel.
- Update static assertions in `tests/public/map-editor.test.ts`.

No changes to game logic, map format, REST API, spectator page, or player page.

## Design

### Canvas entities

All entity glyphs use the same shapes, sizes, and `#071016` fill/stroke as `app.js` / `play.js`.

- **Units:** circular owner-colored piece (radius `HEX_SIZE * 0.42`) with unit-type glyph drawn on top in `#071016`.
  - `infantry` — plus sign (crossed lines)
  - `scout` — upward triangle
  - `heavy` — solid square
  - `ranger` — diamond
  - `support` — plus-block (cross with thick arms)
- **Headquarters:** filled hex (owner color, alpha ~0.78, inset 5) with building glyph (rectangle base + triangle roof) in `#071016`. Remove the "A HQ" / "B HQ" text and the square background.
- **Control points:** stroked hex outline (gold `#d6b34a`, 2px, inset 6) with kind-specific glyph in `#071016`. Remove the circular token and text label.
  - `supply` — ring with dot center
  - `forward_base` — flag (vertical line + filled pennant)
  - `repair` — circle + wrench line

Two helper functions mirror the existing pages exactly: `drawUnitGlyph(type, x, y)` and `drawControlPointGlyph(kind, x, y)`.

### Selection panel

Add a `.token-icon` CSS class block to `map-editor.css` matching the shapes in `style.css` / `play.css`. The "选中对象" panel header shows a small token icon next to the selection title when a unit, HQ, or control point is selected.

### Tests

Update `tests/public/map-editor.test.ts` assertions:
- Replace checks for text labels ("INF", "HVY", "SUP", "A HQ") with checks for glyph-drawing function presence and hex-based HQ/control-point rendering.
- Assert `drawUnitGlyph` and `drawControlPointGlyph` are defined top-level functions.
- Assert HQ uses `pathHex` fill (not `fillRect`).
- Assert control points use `pathHex` stroke (not `arc` + `fillText`).

## Non-goals

- No refactor of `app.js` or `play.js`.
- No shared utility file — keep each public page self-contained (existing pattern).
- No HP bars or match-time UI elements in the editor.
