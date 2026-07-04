# Visual Entity Markers Design

## Goal

Make units, headquarters, and control point buildings visually distinguishable on the board and in the selection panel without changing game rules, API payloads, or map data.

## Scope

- Update the spectator board in `public/app.js`.
- Update the player board in `public/play.js`.
- Update selection token styling in `public/style.css` and `public/play.css`.
- Add static regression coverage under `tests/public`.

## Design

Board entities keep the existing owner colors, HP bars, hover behavior, and hit testing. The label-only markers are replaced with compact silhouettes:

- Units remain circular owner-colored pieces, but each unit type gets a small dark glyph: infantry, scout, heavy, ranger, and support.
- Headquarters remain filled hex/building cells and get a building glyph instead of only `HQ`.
- Control points keep their hex outline and ownership color, and get kind-specific glyphs for supply, forward base, and repair.

Selection cards keep the same layout and stats. Their square token changes from a plain abbreviation to a two-line visual token: a CSS icon shape plus a short Chinese label. Full Chinese names remain in the card title.

## Constraints

- No new runtime dependencies.
- No image assets; use canvas drawing and CSS only.
- Preserve existing colors and information hierarchy.
- Keep markers readable at the current `HEX_SIZE = 28`.
- Apply the same visual system to spectator and player pages.

## Testing

Add a Vitest static test that verifies both public bundles contain the marker drawing helpers and both CSS files contain the visual token classes. Run the focused public test and the full test suite.
