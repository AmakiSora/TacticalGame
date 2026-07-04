# Breach Thick Wall Design

## Goal

Update the `breach` map so the middle wall is longer and thicker, with only narrow edge routes around it, while preserving origin-reflection symmetry.

## Map Geometry

- Keep the map radius at `8`.
- Keep existing headquarters, starting units, control points, water cells, unit specs, and balance values unchanged.
- Replace the current thin cross-shaped blocker layout with a central thick wall.
- The wall is a three-column blocker band: every cell with `q` in `[-1, 0, 1]` and `r` from `-6` through `6` is `blocker`.
- Do not block the `r=-7` and `r=7` edge-adjacent lanes, so traffic can pass only near the top and bottom edges.
- The blocker set must be origin-reflection symmetric: every blocker at `(q, r)` has a matching blocker at `(-q, -r)`.

## Testing

- Add a focused loader test for `breach` that verifies the exact thick-wall blocker coordinates.
- Verify the edge lanes at `r=-7` and `r=7` remain open for `q=-1,0,1`.
- Verify every blocker and water cell in `breach` has an origin-reflected counterpart with the same terrain.
