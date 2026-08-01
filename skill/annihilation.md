# Annihilation mode

Use only when `game.config.mode === "annihilation"`.  
If the game is `standard`, stop and read `standard.md` instead.

## Hard bans

- **No headquarters at runtime.** `game.headquarters` is `{}`. Map JSON may still list `headquarters` / `spawnSlots[].headquarters` as **spawn metadata only** — never attack, defend, path-to, or score those as HQs.
- **Never** invent an HQ id for `fromId` or `targetId`.
- **Never** follow standard "attack HQ / push HQ / HQ damage score" logic.
- Elimination is **army wipe** (final living unit dies), not HQ destroy.
- **Never hardcode artillery phase rounds** (e.g. "rounds 1–4" / "from round 5"). Always derive timing from this map's config + live `game.artillery`.

## Turn checklist

Every action on your turn, inspect:

- Your units **with** `config.units` + each instance's `moveRange` / `attackRange` / `canCapture` / `healPower` / cost (maps retune heavies, rangers, etc. — do not hardcode)
- Supplies, AP
- **Owned control points** (only legal deploy origins)
- Living **enemy units/armies** only — no HQ objects
- **Artillery config + live state** (see below) — required every action
- Live `adjudication`, but read **`weights` and breakdowns** first
  - Fields: `adjudication.scores.<id>.armyValue`, `.actionScore`, `.total`, plus zeroed HQ/CP/supply terms
  - `adjudication.weights.effectiveActions` (annihilation default **10** if unset)
  - When `enemyHqDamage` / `ownHqHp` / `controlPoint` / `supplies` are `0` (as on current `artillery-zone`): practical total ≈ `armyValue * weights.armyValue` + **`actionScore`**
  - Always re-read **this game's** weights; do not assume every annihilation map zeroes the same keys
- Legal targets: **unit-vs-unit only**

## Rules (annihilation only)

### Deploy

- **Only from owned control points** into adjacent empty plain cells.
- `fromId` = owned CP id always.
- Own zero CPs → you **cannot** deploy; fight/capture with existing units.
- Origin or target in artillery **danger** → deploy illegal.

### Artillery — read config, then live state

Do **not** memorize a fixed timetable. Each annihilation map carries its own schedule.

**1. Config** — `game.config.annihilation.artillery` (absent only if misconfigured; then stop and report):

| Field | Meaning |
|---|---|
| `startRound` | First shrink round (1-based `turn.roundNumber`) |
| `intervalRounds` | Rounds between further shrinks after the first |
| `damage` | HP removed from each living unit still on a danger cell at round-boundary resolution |
| `minimumSafeRadius` | Smallest `safeRadius` after repeated shrinks |

**2. Live state** — `game.artillery` (engine refreshes from config + current round):

| Field | Meaning |
|---|---|
| `safeRadius` | Current safe hex distance from board center `{q:0,r:0}` |
| `dangerCells` | Cells **already** outside `safeRadius` — artillery is active here |
| `warningCells` | Cells that will become danger on the **next** shrink — **not** damaged yet |
| `nextShrinkRound` | Next round number when `safeRadius` drops, or `null` if at `minimumSafeRadius` |

**3. Semantics (bind decisions to these, not to map names):**

- **Danger:** at each **round boundary**, every living unit whose position is in `dangerCells` takes `artillery.damage` (ignores unit defense). Units may still **walk into** danger voluntarily.
- **Warning:** preview of the next ring only. No passive damage while merely warned. Treat as evacuate-soon, especially if `nextShrinkRound === turn.roundNumber + 1` or you cannot leave in one activation after the shrink.
- **Illegal in danger** (origin and/or target as applicable): **deploy**, **heal**, **control-point repair**. Combat and movement remain allowed.
- Safe play: prefer endings outside `dangerCells`; leave `warningCells` before `nextShrinkRound` when you cannot afford the hit.

**4. Phase derivation** (replace any "round 4 / 5" habit):

```text
round          = turn.roundNumber
start          = config.annihilation.artillery.startRound
pre_shrink     = round < start
shrinking      = round >= start
next           = game.artillery.nextShrinkRound   # may be null
```

- **Pre-shrink** (`round < startRound`): economy / board-control window. Send capturers to **safe** neutral income CPs (prefer `kind === "supply"` when present, else best safe income/deploy pad). Secure a deploy-capable owned CP before the ring bites.
- **From first shrink** (`round >= startRound`): prioritize leaving `dangerCells` / soon-`warningCells`, keep fighting inside current `safeRadius`, close on the nearest living enemy army. Do not farm rings that config will delete.
- **Between shrinks:** use `nextShrinkRound` and `warningCells` as the clock — not a hardcoded offset like "startRound − 1" alone (warning is computed when the next shrink is exactly one round away).
- Example only (current `artillery-zone`, **do not copy as universal law**): `startRound: 5`, `intervalRounds: 2`, `damage: 25`, `minimumSafeRadius: 2` ⇒ pre-shrink is rounds 1–4 on that map alone.

### Win / score

- Seat dies on **last unit death**; their CPs neutralise.
- Last survivor wins; else adjudication at max round using the shared formula in `SKILL.md`.
- When HQ/CP/supply weights are 0: **army value + actionScore are the real race**. Do **not** rush empty "point score", fake HQ damage, **hoard supplies**, or **burn the turn on empty moves** — those do not raise `actionScore`.
- Raise score by: surviving/high-HP valuable units, real attacks (damage merit), heals, deploys, demolish, captures that enable income/deploy, and denying enemy army value.
- CPs still matter for **income + deploy pads**, not for end-score farming when `controlPoint` weight is 0.

## Decision order

Unless the user asks for a different style:

1. **Attack** killable / low-HP living enemy units. Prefer seat-wiping finishers, then supports/rangers/capturers that cut enemy army value. **No HQ target.**
2. **Evacuate** friendlies on `dangerCells` or `warningCells` toward current `safeRadius` / center (unless this activation gets a guaranteed kill and the unit can still leave before the next damaging boundary).
3. **Heal** only if support and target are both outside `dangerCells`.
4. **Demolish** adjacent blocker with heavy only if it opens a safe supply/forward pad, a safer inward path, or a decisive unit-attack lane.
5. **Deploy** from a **safe owned CP** into a **safe** adjacent empty plain when supplies + AP remain.
   - Pre-shrink: infantry/scout to take or hold safe income pads
   - Fights incoming: heavy/ranger
   - Wounded cluster reachable safely: support
   - No owned CP → skip deploy
   - `fromId` = owned CP id only
6. **Pre-shrink** (`round < artillery.startRound`): move infantry/scouts to nearest **safe** neutral income CP (`supply` if typed), then secure a nearby deploy pad (`forward_base` / owned CP) that will remain usable as the ring contracts.
7. **From first shrink** (`round >= startRound`): advance on nearest living enemy army inside the safe zone; favorable trades; no outer-ring tourism. Re-check `warningCells` / `nextShrinkRound` every activation.
8. **Near adjudication:** re-read `adjudication.weights` and `scores.*.actionScore` / `armyValue`. If HQ/CP/supply weights are 0 → maximize army value and **actionScore** via real exchanges (damage/heal/deploy/capture/demolish); deny enemy army. Spend leftover supplies on safe deploys when AP allows. No capture-spam for phantom point score, no supply hoarding, no empty reposition loops, no searching for HQs.
9. **No useful action** → `/end-turn`.

Never stall for adjudication while a kill, a safe capture that enables deploy/income, a merit-scoring fight, or an inward escape is available.

## Pre-action checks

- Stats from **this** map's `config.units` / unit instance — not memory (range, move, cost, `canCapture`, `healPower`)
- Unit can move/act; target within **that unit's** `attackRange`; path within `moveRange`; destination in `game.cells`
- Capture only if `canCapture` (typically infantry/scout); heal only support → friendly unit outside danger; demolish only heavy → adjacent empty blocker
- Artillery: read `config.annihilation.artillery` + `game.artillery` this turn; do not deploy/heal in `dangerCells`; avoid ending on danger/warning without an escape plan tied to `nextShrinkRound`
- Deploy `fromId` is an **owned control point id** (never HQ); cost from `config.units[type]`
- Attack `targetId` is a **living enemy unit** (never HQ)
- AP allows new activation when needed
