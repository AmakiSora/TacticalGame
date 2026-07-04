# Demolishable Terrain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a heavy-unit demolish action that turns adjacent `blocker` terrain into `plain`, opening new paths during a match.

**Architecture:** Implement demolition as a focused engine action in `src/engine/demolition.ts`, exposed through a new authenticated REST endpoint and replayed through a new `demolish` event. The browser player and spectator clients update their local `cells` terrain from that event, so live play, SSE replay, imported replay, and exported replay stay consistent.

**Tech Stack:** Node.js, TypeScript, Fastify, Vitest, browser Canvas with plain JavaScript.

## Global Constraints

- Do not add a new unit type; only existing `heavy` units can demolish.
- Demolish targets must be adjacent hexes with terrain exactly `blocker`.
- Demolish consumes the unit action by setting `hasActed = true` and uses the existing `consumeAction` activation budget.
- A heavy that already moved may demolish in the same turn if it has not acted; a heavy that demolishes cannot attack or heal afterward.
- Demolish emits one replay event named `demolish` with enough payload for clients to update terrain without fetching full state.
- Keep old maps valid. Existing `blocker` terrain becomes destructible automatically; `water` remains permanent.
- Do not alter adjudication scoring, income, deployment costs, or control point rules.

---

## File Structure

- Modify `src/types.ts`: add `demolish` to `EventType` and `invalid_demolish` to `ApiErrorCode`.
- Create `src/engine/demolition.ts`: validate and execute the heavy demolish action.
- Modify `src/api/actions.ts`: register `POST /api/games/:id/demolish`.
- Add `tests/engine/demolition.test.ts`: engine-level TDD coverage for success and rule failures.
- Modify `tests/api/v2-api.test.ts`: endpoint coverage and event payload check.
- Modify `public/play.js`: apply `demolish` events, show a heavy-only demolish action, highlight adjacent blockers, call API.
- Modify `public/app.js`: apply `demolish` events in spectator/replay view and format event text.
- Modify `public/style.css` and `public/play.css`: add event colors if needed for `demolish`.
- Modify `README.md`: document the new action, event, and rule.
- Modify `RELEASE_NOTES.md`: add an unreleased or next-version entry describing destructible blockers.

## Task 1: Engine Demolish Rule

**Files:**
- Create: `src/engine/demolition.ts`
- Modify: `src/types.ts`
- Test: `tests/engine/demolition.test.ts`

**Interfaces:**
- Consumes: `consumeAction(game, unit): Result`, `actionsRemaining(game): number`, `hexDistance(a, b): number`, `getTerrain(game, q, r): TerrainType`, `getCellOccupant(game, q, r): Occupant | null`, `appendEvent(game, bus, type, payload)`.
- Produces: `demolishTerrain(game: GameState, bus: EventBus, owner: PlayerId, unitId: string, q: number, r: number): Result`.

- [ ] **Step 1: Write failing engine success test**

Add `tests/engine/demolition.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/events/bus.js';
import { demolishTerrain } from '../../src/engine/demolition.js';
import { joinGame } from '../../src/engine/engine.js';
import { getTerrain } from '../../src/engine/validation.js';
import { createInitialGame } from '../../src/state/store.js';

function setup() {
  const game = createInitialGame('g1');
  const bus = new EventBus();
  joinGame(game, bus, 'B');
  game.units = game.units.filter(u => u.owner !== 'player_a');
  const heavy = {
    id: 'heavy-1',
    owner: 'player_a' as const,
    type: 'heavy' as const,
    q: -2,
    r: 0,
    hp: 150,
    maxHp: 150,
    attack: 38,
    defense: 13,
    moveRange: 2,
    attackRange: 1,
    cost: 92,
    alive: true,
    hasMoved: false,
    hasActed: false,
    actionSpent: false,
    canCapture: false,
  };
  game.units.push(heavy);
  game.map.terrainCells.push({ q: -1, r: 0, terrain: 'blocker' });
  const cell = game.cells.find(c => c.q === -1 && c.r === 0);
  if (cell) cell.terrain = 'blocker';
  return { game, bus, heavy };
}

describe('demolishable terrain', () => {
  it('lets a heavy turn an adjacent blocker into plain terrain', () => {
    const { game, bus, heavy } = setup();

    const result = demolishTerrain(game, bus, 'player_a', heavy.id, -1, 0);

    expect(result.ok).toBe(true);
    expect(getTerrain(game, -1, 0)).toBe('plain');
    expect(heavy.hasActed).toBe(true);
    expect(heavy.actionSpent).toBe(true);
    expect(game.turn.actionsUsed).toBe(1);
    expect(game.events.at(-1)).toMatchObject({
      type: 'demolish',
      payload: expect.objectContaining({
        unitId: heavy.id,
        owner: 'player_a',
        q: -1,
        r: 0,
        fromTerrain: 'blocker',
        toTerrain: 'plain',
        actionsUsed: 1,
        actionsRemaining: 4,
      }),
    });
  });
});
```

- [ ] **Step 2: Run success test to verify RED**

Run: `npx vitest run tests/engine/demolition.test.ts`

Expected: FAIL because `src/engine/demolition.ts` does not exist or `demolishTerrain` is not exported.

- [ ] **Step 3: Add event and error types**

Modify `src/types.ts`:

```ts
export type EventType =
  | 'game_start'
  | 'move'
  | 'attack'
  | 'heal'
  | 'unit_death'
  | 'deploy'
  | 'demolish'
  | 'control_point_captured'
  | 'control_point_repair'
  | 'income'
  | 'reset_actions'
  | 'turn_end'
  | 'headquarters_destroyed'
  | 'game_over'
  | 'name_rename';
```

Add to `ApiErrorCode`:

```ts
  | 'invalid_demolish'
```

- [ ] **Step 4: Implement minimal engine action**

Create `src/engine/demolition.ts`:

```ts
import type { GameState, PlayerId } from '../types.js';
import type { EventBus } from '../events/bus.js';
import type { Result } from './result.js';
import { appendEvent } from './events.js';
import { hexDistance } from './hex.js';
import { actionsRemaining, consumeAction, getCellOccupant, getTerrain } from './validation.js';

function setTerrain(game: GameState, q: number, r: number, terrain: 'plain'): void {
  const cell = game.cells.find(c => c.q === q && c.r === r);
  if (cell) cell.terrain = terrain;

  const override = game.map.terrainCells.find(c => c.q === q && c.r === r);
  if (override) {
    override.terrain = terrain;
  } else {
    game.map.terrainCells.push({ q, r, terrain });
  }
}

export function demolishTerrain(
  game: GameState,
  bus: EventBus,
  owner: PlayerId,
  unitId: string,
  q: number,
  r: number,
): Result {
  const unit = game.units.find(u => u.id === unitId && u.owner === owner && u.alive);
  if (!unit) return { ok: false, code: 'unit_not_found', message: 'unit not found' };
  if (unit.type !== 'heavy') return { ok: false, code: 'invalid_demolish', message: 'only heavy units can demolish terrain' };
  if (unit.hasActed) return { ok: false, code: 'invalid_demolish', message: 'already acted this turn' };
  if (hexDistance(unit, { q, r }) !== 1) return { ok: false, code: 'invalid_demolish', message: 'target must be adjacent' };
  if (getTerrain(game, q, r) !== 'blocker') return { ok: false, code: 'invalid_demolish', message: 'target terrain is not blocker' };
  if (getCellOccupant(game, q, r) !== null) return { ok: false, code: 'invalid_demolish', message: 'target cell is occupied' };

  const spent = consumeAction(game, unit);
  if (!spent.ok) return spent;

  setTerrain(game, q, r, 'plain');
  unit.hasActed = true;
  appendEvent(game, bus, 'demolish', {
    unitId,
    owner,
    q,
    r,
    fromTerrain: 'blocker',
    toTerrain: 'plain',
    actionsUsed: game.turn.actionsUsed,
    actionsRemaining: actionsRemaining(game),
  });
  return { ok: true };
}
```

- [ ] **Step 5: Run engine success test to verify GREEN**

Run: `npx vitest run tests/engine/demolition.test.ts`

Expected: PASS.

- [ ] **Step 6: Add failing validation tests**

Append to `tests/engine/demolition.test.ts` inside the same `describe`:

```ts
  it('rejects non-heavy units, non-adjacent targets and non-blocker terrain', () => {
    const { game, bus, heavy } = setup();
    heavy.type = 'infantry';
    expect(demolishTerrain(game, bus, 'player_a', heavy.id, -1, 0)).toMatchObject({
      ok: false,
      code: 'invalid_demolish',
    });

    heavy.type = 'heavy';
    expect(demolishTerrain(game, bus, 'player_a', heavy.id, 1, 0)).toMatchObject({
      ok: false,
      code: 'invalid_demolish',
    });

    expect(demolishTerrain(game, bus, 'player_a', heavy.id, -2, 1)).toMatchObject({
      ok: false,
      code: 'invalid_demolish',
    });
  });

  it('uses the action limit for a fresh heavy and allows an already activated heavy to demolish', () => {
    const { game, bus, heavy } = setup();
    const limit = game.config.balance.actionsPerTurn;
    game.turn.actionsUsed = limit;

    const blocked = demolishTerrain(game, bus, 'player_a', heavy.id, -1, 0);
    expect(blocked).toMatchObject({ ok: false, code: 'action_limit_reached' });
    expect(getTerrain(game, -1, 0)).toBe('blocker');

    heavy.actionSpent = true;
    const allowed = demolishTerrain(game, bus, 'player_a', heavy.id, -1, 0);
    expect(allowed.ok).toBe(true);
    expect(game.turn.actionsUsed).toBe(limit);
    expect(getTerrain(game, -1, 0)).toBe('plain');
  });
```

- [ ] **Step 7: Run validation tests**

Run: `npx vitest run tests/engine/demolition.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit task**

```bash
git add src/types.ts src/engine/demolition.ts tests/engine/demolition.test.ts
git commit -m "feat: add heavy terrain demolition rule"
```

## Task 2: REST API Endpoint

**Files:**
- Modify: `src/api/actions.ts`
- Test: `tests/api/v2-api.test.ts`

**Interfaces:**
- Consumes: `demolishTerrain(game, globalEventBus, player, unitId, q, r): Result`.
- Produces: `POST /api/games/:id/demolish` with body `{ unitId: string; q: number; r: number }`.

- [ ] **Step 1: Write failing API test**

Append to `tests/api/v2-api.test.ts`:

```ts
  it('demolishes adjacent blocker terrain through the action API', async () => {
    const app = await startTestServer();
    const { gameId, tokenA } = await createGameAndJoin(app);
    const stateRes = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}`,
      headers: { 'X-Player-Token': tokenA },
    });
    const state = stateRes.json() as any;
    const heavy = state.units.find((u: any) => u.owner === 'player_a');

    const res = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/demolish`,
      headers: { 'X-Player-Token': tokenA },
      payload: { unitId: heavy.id, q: -6, r: 0 },
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });
```

Use this first RED test only to prove the endpoint is absent. It expects `400` because the route does not exist in the current server. Replace it in Step 3 with the real behavior test after adding a deterministic blocker setup through the store if the current helper cannot position a heavy next to a blocker.

- [ ] **Step 2: Run API test to verify RED**

Run: `npx vitest run tests/api/v2-api.test.ts -t demolishes`

Expected: FAIL or 404/400 because `/demolish` is not registered and the real behavior is not implemented.

- [ ] **Step 3: Register the route**

Modify `src/api/actions.ts`:

```ts
import { demolishTerrain } from '../engine/demolition.js';
```

Add body type:

```ts
interface DemolishBody { unitId: string; q: number; r: number }
```

Add route before `end-turn`:

```ts
  app.post<{ Params: { id: string }; Body: DemolishBody }>('/api/games/:id/demolish', async (req, reply) => {
    const { unitId, q, r } = req.body || {};
    if (!unitId || typeof q !== 'number' || typeof r !== 'number') {
      return badRequest(reply, 'unitId, q, r required');
    }
    return actionHandler(req, reply, ({ game, player }) =>
      demolishTerrain(game, globalEventBus, player, unitId, q, r));
  });
```

- [ ] **Step 4: Replace API test with deterministic behavior**

If `tests/api/v2-api.test.ts` can access `globalStore`, use this final test:

```ts
  it('demolishes adjacent blocker terrain through the action API', async () => {
    const app = await startTestServer();
    const { gameId, tokenA } = await createGameAndJoin(app);
    const { globalStore } = await import('../../src/state/store.js');
    const game = globalStore.get(gameId)!;
    game.units = game.units.filter(u => u.owner !== 'player_a');
    game.units.push({
      id: 'api-heavy',
      owner: 'player_a',
      type: 'heavy',
      q: -2,
      r: 0,
      hp: 150,
      maxHp: 150,
      attack: 38,
      defense: 13,
      moveRange: 2,
      attackRange: 1,
      cost: 92,
      alive: true,
      hasMoved: false,
      hasActed: false,
      actionSpent: false,
      canCapture: false,
    });
    game.map.terrainCells.push({ q: -1, r: 0, terrain: 'blocker' });
    const cell = game.cells.find(c => c.q === -1 && c.r === 0)!;
    cell.terrain = 'blocker';

    const res = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/demolish`,
      headers: { 'X-Player-Token': tokenA },
      payload: { unitId: 'api-heavy', q: -1, r: 0 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(game.cells.find(c => c.q === -1 && c.r === 0)!.terrain).toBe('plain');
    expect(game.events.at(-1)).toMatchObject({
      type: 'demolish',
      payload: expect.objectContaining({ unitId: 'api-heavy', q: -1, r: 0 }),
    });
    await app.close();
  });
```

- [ ] **Step 5: Run API test**

Run: `npx vitest run tests/api/v2-api.test.ts -t demolishes`

Expected: PASS.

- [ ] **Step 6: Commit task**

```bash
git add src/api/actions.ts tests/api/v2-api.test.ts
git commit -m "feat: expose terrain demolition API"
```

## Task 3: Player UI Support

**Files:**
- Modify: `public/play.js`
- Modify: `public/play.css`
- Test: `tests/public/control-page.test.ts` or add `tests/public/demolish-ui.test.ts` if existing public tests load source text rather than browser DOM.

**Interfaces:**
- Consumes: `demolish` event payload `{ unitId, owner, q, r, fromTerrain, toTerrain, actionsUsed, actionsRemaining }`.
- Produces: player UI can choose `爆破` for eligible heavy units and POST `/api/games/:id/demolish`.

- [ ] **Step 1: Write failing source-level UI test**

Create `tests/public/demolish-ui.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('demolish player UI wiring', () => {
  const source = readFileSync('public/play.js', 'utf-8');

  it('handles demolish replay events and exposes a heavy-only demolish action', () => {
    expect(source).toContain("case 'demolish'");
    expect(source).toContain("action: 'demolish'");
    expect(source).toContain('/demolish');
    expect(source).toContain("'爆破'");
  });
});
```

- [ ] **Step 2: Run UI test to verify RED**

Run: `npx vitest run tests/public/demolish-ui.test.ts`

Expected: FAIL because `public/play.js` does not contain demolish handling.

- [ ] **Step 3: Add terrain helpers and event replay**

Modify `public/play.js`:

```js
function setCellTerrain(q, r, terrain) {
  const cell = cellAt(q, r);
  if (cell) cell.terrain = terrain;
}
function demolishableCells(unit) {
  if (unit.type !== 'heavy' || unit.hasActed) return [];
  return hexNeighbors(unit).filter(p => cellAt(p.q, p.r)?.terrain === 'blocker' && !occupied(p.q, p.r));
}
```

Add to `applyEvent` switch:

```js
    case 'demolish': {
      setCellTerrain(p.q, p.r, p.toTerrain || 'plain');
      const u = s.units.get(p.unitId);
      if (u) { u.hasActed = true; u.actionSpent = true; }
      if (typeof p.actionsUsed === 'number') s.turn.actionsUsed = p.actionsUsed;
      break;
    }
```

- [ ] **Step 4: Add heavy popup action and click handling**

Modify `selectUnit(unit)`:

```js
  if (!unit.hasActed) items.push({ label: unit.type === 'support' ? '治疗' : '攻击', action: unit.type === 'support' ? 'heal' : 'attack' });
  if (unit.type === 'heavy' && !unit.hasActed && demolishableCells(unit).length > 0) items.push({ label: '爆破', action: 'demolish' });
```

Inside popup callback:

```js
    if (action === 'demolish') {
      interactionMode = 'demolish_mode';
      rangeHighlights = demolishableCells(unit).map(p => ({ ...p, type: 'demolish' }));
    }
```

Add click handling before deploy handling:

```js
  if (interactionMode === 'demolish_mode' && rangeHighlights.some(h => h.q === hoverCell.q && h.r === hoverCell.r)) {
    if (await apiAction(`/api/games/${gameId}/demolish`, { unitId: selectedUnitId, q: hoverCell.q, r: hoverCell.r })) afterAction('爆破成功');
    return;
  }
```

Update highlight color in `drawBoard()`:

```js
    ctx.fillStyle = h.type === 'move' ? 'rgba(60,200,120,.20)' : h.type === 'attack' ? 'rgba(255,80,80,.28)' : h.type === 'attack-radius' ? 'rgba(255,80,80,.08)' : h.type === 'deploy' ? 'rgba(240,210,90,.24)' : h.type === 'demolish' ? 'rgba(255,170,70,.28)' : 'rgba(80,220,180,.20)';
```

Update `formatEventShort`:

```js
    case 'demolish': return `${playerName(p.owner)} 爆破 (${p.q}, ${p.r})`;
```

- [ ] **Step 5: Run UI source test**

Run: `npx vitest run tests/public/demolish-ui.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit task**

```bash
git add public/play.js public/play.css tests/public/demolish-ui.test.ts
git commit -m "feat: add player demolish controls"
```

## Task 4: Spectator and Replay Support

**Files:**
- Modify: `public/app.js`
- Modify: `public/style.css`
- Test: `tests/public/score-panel.test.ts` or add `tests/public/demolish-replay.test.ts`

**Interfaces:**
- Consumes: `demolish` event payload from live SSE, imported JSON, and event arrays.
- Produces: spectator board terrain changes while replay stepping forward or rebuilding to a later step.

- [ ] **Step 1: Write failing replay test**

Create `tests/public/demolish-replay.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('demolish spectator replay wiring', () => {
  const source = readFileSync('public/app.js', 'utf-8');

  it('applies demolish events when replaying terrain changes', () => {
    expect(source).toContain("case 'demolish'");
    expect(source).toContain("toTerrain");
    expect(source).toContain('爆破');
  });
});
```

- [ ] **Step 2: Run replay test to verify RED**

Run: `npx vitest run tests/public/demolish-replay.test.ts`

Expected: FAIL because `public/app.js` does not handle `demolish`.

- [ ] **Step 3: Add replay event handling**

Modify `public/app.js`:

```js
function setCellTerrain(q, r, terrain) {
  const cell = state.cells.find(c => c.q === q && c.r === r);
  if (cell) cell.terrain = terrain;
}
```

Add to `applyEvent`:

```js
    case 'demolish': {
      setCellTerrain(p.q, p.r, p.toTerrain || 'plain');
      const u = s.units.get(p.unitId);
      if (u) { u.hasActed = true; u.actionSpent = true; }
      if (typeof p.actionsUsed === 'number') s.turn.actionsUsed = p.actionsUsed;
      break;
    }
```

Add to `formatEventShort`:

```js
    case 'demolish': return `爆破 (${p.q},${p.r})`;
```

- [ ] **Step 4: Add event color styling**

Modify `public/style.css`:

```css
.marker-demolish { background: #d98532; }
#events li[data-type="demolish"] { border-left-color: #d98532; color: #e8b47c; }
#detail-content .ev-type.demolish { background: #5a3518; color: #ffc27a; }
```

Modify `public/play.css` if event list styling is separate:

```css
#events li.type-demolish { border-left-color: #d98532; color: #e8b47c; }
```

- [ ] **Step 5: Run replay test**

Run: `npx vitest run tests/public/demolish-replay.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit task**

```bash
git add public/app.js public/style.css public/play.css tests/public/demolish-replay.test.ts
git commit -m "feat: replay demolished terrain"
```

## Task 5: Documentation and Full Verification

**Files:**
- Modify: `README.md`
- Modify: `RELEASE_NOTES.md`

**Interfaces:**
- Consumes: final behavior from Tasks 1-4.
- Produces: public-facing rule/API/event documentation.

- [ ] **Step 1: Update README rules**

Add to the core rules section:

```md
- 重装单位可花费本回合行动爆破相邻 `blocker` 地形，将其永久变为 `plain`。爆破遵循行动点上限；已移动但未行动的重装可继续爆破，爆破后不能攻击。
```

- [ ] **Step 2: Update README API table**

Add to action table:

```md
| `POST` | `/api/games/:id/demolish` | `{ unitId, q, r }` |
```

- [ ] **Step 3: Update README event list**

Add `demolish` to the event list and add payload note:

```md
`demolish` 事件包含爆破单位、坐标、原地形、目标地形和行动点信息，回放端用它同步地形变化。
```

- [ ] **Step 4: Update release notes**

Add entry:

```md
## Next

- 新增重装单位爆破玩法：重装可将相邻阻挡地形变为平地，打开新的推进路线；操作、事件流和回放均支持该地形变化。
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
npx vitest run tests/engine/demolition.test.ts tests/api/v2-api.test.ts tests/public/demolish-ui.test.ts tests/public/demolish-replay.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run full verification**

Run:

```bash
npm run build
npm test
```

Expected: both commands PASS with no TypeScript errors and no failing Vitest suites.

- [ ] **Step 7: Commit documentation**

```bash
git add README.md RELEASE_NOTES.md
git commit -m "docs: document terrain demolition"
```

## Self-Review

- Spec coverage: engine rule, API endpoint, event replay, player UI, spectator UI, docs, and verification are all covered by separate tasks.
- Placeholder scan: the plan has no deferred behavior or unspecified edge cases; every rule failure returns a concrete result code.
- Type consistency: the action is named `demolishTerrain` in engine code, the REST route is `/demolish`, and the replay event type is `demolish` across tests, clients, and documentation.
