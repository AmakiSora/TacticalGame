# Breach Thick Wall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `breach` map's center wall longer and thicker while leaving only edge routes and preserving origin-reflection symmetry.

**Architecture:** This is a data-only map geometry change backed by config-loader tests. The runtime already consumes `maps/breach.json` through `src/config/loader.ts`, so no engine or API changes are needed.

**Tech Stack:** TypeScript, Vitest, JSON map configuration.

## Global Constraints

- Keep `breach` radius, headquarters, starting units, control points, water cells, unit specs, and balance values unchanged.
- Wall blockers must be exactly all cells with `q` in `[-1, 0, 1]` and `r` from `-6` through `6`.
- Cells with `q` in `[-1, 0, 1]` and `r` equal to `-7` or `7` must not be blockers or water.
- All `breach` terrain cells must remain origin-reflection symmetric.

---

### Task 1: Breach Geometry Test And Map Data

**Files:**
- Modify: `tests/config/loader.test.ts`
- Modify: `maps/breach.json`

**Interfaces:**
- Consumes: `getMapConfig('breach')` from `src/config/loader.ts`.
- Produces: A `breach` terrain layout whose blocker and edge-route invariants are covered by tests.

- [ ] **Step 1: Write the failing test**

Add helpers and a test to `tests/config/loader.test.ts`:

```ts
function originReflection(pos: { q: number; r: number }) {
  return { q: -pos.q, r: -pos.r };
}

function terrainAt(map: { terrainCells: { q: number; r: number; terrain: string }[] }, q: number, r: number) {
  return map.terrainCells.find(cell => cell.q === q && cell.r === r)?.terrain ?? 'plain';
}
```

```ts
it('keeps breach blocked through the center with only edge lanes open', () => {
  resetConfig();
  loadMaps();

  const breach = getMapConfig('breach');
  const blockers = breach.terrainCells
    .filter(cell => cell.terrain === 'blocker')
    .map(cell => `${cell.q},${cell.r}`)
    .sort();
  const expectedBlockers = [-1, 0, 1]
    .flatMap(q => Array.from({ length: 13 }, (_, index) => `${q},${index - 6}`))
    .sort();

  expect(blockers).toEqual(expectedBlockers);
  for (const q of [-1, 0, 1]) {
    expect(terrainAt(breach, q, -7)).toBe('plain');
    expect(terrainAt(breach, q, 7)).toBe('plain');
  }
  for (const cell of breach.terrainCells) {
    const mirror = originReflection(cell);
    const counterpart = breach.terrainCells.find(candidate => candidate.q === mirror.q && candidate.r === mirror.r);
    expect(counterpart, `terrain (${cell.q},${cell.r}) should reflect to (${mirror.q},${mirror.r})`).toBeTruthy();
    expect(counterpart!.terrain).toBe(cell.terrain);
  }
  resetConfig();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/config/loader.test.ts`

Expected: FAIL because the current `breach` blocker list is the old thin cross and does not equal the thick wall.

- [ ] **Step 3: Update map data**

In `maps/breach.json`, replace the blocker terrain cells with the exact three-column band:

```json
{ "q": -1, "r": -6, "terrain": "blocker" },
{ "q": -1, "r": -5, "terrain": "blocker" },
{ "q": -1, "r": -4, "terrain": "blocker" },
{ "q": -1, "r": -3, "terrain": "blocker" },
{ "q": -1, "r": -2, "terrain": "blocker" },
{ "q": -1, "r": -1, "terrain": "blocker" },
{ "q": -1, "r": 0, "terrain": "blocker" },
{ "q": -1, "r": 1, "terrain": "blocker" },
{ "q": -1, "r": 2, "terrain": "blocker" },
{ "q": -1, "r": 3, "terrain": "blocker" },
{ "q": -1, "r": 4, "terrain": "blocker" },
{ "q": -1, "r": 5, "terrain": "blocker" },
{ "q": -1, "r": 6, "terrain": "blocker" },
{ "q": 0, "r": -6, "terrain": "blocker" },
{ "q": 0, "r": -5, "terrain": "blocker" },
{ "q": 0, "r": -4, "terrain": "blocker" },
{ "q": 0, "r": -3, "terrain": "blocker" },
{ "q": 0, "r": -2, "terrain": "blocker" },
{ "q": 0, "r": -1, "terrain": "blocker" },
{ "q": 0, "r": 0, "terrain": "blocker" },
{ "q": 0, "r": 1, "terrain": "blocker" },
{ "q": 0, "r": 2, "terrain": "blocker" },
{ "q": 0, "r": 3, "terrain": "blocker" },
{ "q": 0, "r": 4, "terrain": "blocker" },
{ "q": 0, "r": 5, "terrain": "blocker" },
{ "q": 0, "r": 6, "terrain": "blocker" },
{ "q": 1, "r": -6, "terrain": "blocker" },
{ "q": 1, "r": -5, "terrain": "blocker" },
{ "q": 1, "r": -4, "terrain": "blocker" },
{ "q": 1, "r": -3, "terrain": "blocker" },
{ "q": 1, "r": -2, "terrain": "blocker" },
{ "q": 1, "r": -1, "terrain": "blocker" },
{ "q": 1, "r": 0, "terrain": "blocker" },
{ "q": 1, "r": 1, "terrain": "blocker" },
{ "q": 1, "r": 2, "terrain": "blocker" },
{ "q": 1, "r": 3, "terrain": "blocker" },
{ "q": 1, "r": 4, "terrain": "blocker" },
{ "q": 1, "r": 5, "terrain": "blocker" },
{ "q": 1, "r": 6, "terrain": "blocker" }
```

- [ ] **Step 4: Run focused test**

Run: `npm test -- tests/config/loader.test.ts`

Expected: PASS for all tests in `tests/config/loader.test.ts`.

- [ ] **Step 5: Run full verification**

Run: `npm test`

Expected: PASS for the full Vitest suite.
