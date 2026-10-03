# Royale mode (大逃杀)

Use only when `game.config.mode === "royale"` (maps: `snowflake` 雪花 2/3/6 players, `narrow-road` 狭路相逢 2 players).  
If the game is `standard`, `annihilation`, or `simultaneous`, stop and read that mode file instead — do not apply this file.

Royale = **simultaneous resolution** (secret plans, full-commit settlement) × **annihilation rules**
(no headquarters, control-point spawns, artillery ring, army-wipe elimination). You must honor both
halves: the plan/commit loop governs *how* you act, the artillery ring and army-wipe rules govern
*what matters*.

## Hard bans

- **No headquarters at runtime.** `game.headquarters` is `{}`. Map JSON may still list
  `headquarters` / `spawnSlots[].headquarters` as **spawn metadata only** — never attack, defend,
  path-to, or score those as HQs. Never invent an HQ id for `fromId`/`targetId`.
- Elimination is **army wipe** (final living unit dies — to combat or artillery), not HQ destroy.
- **One action per unit per round**; attacks/heals aim at a **cell**, not a unit id
  (`single`/`line`/`arc` shapes from `config.units`; `attackLock` locks plan-time occupants).
- **Destination conflicts fail for everyone** (all claiming moves/deploys fail); your own queue
  cannot claim the same cell twice.
- **Never hardcode artillery phase rounds** (e.g. "rounds 1–5"). Always derive timing from this
  map's config + live `game.artillery`.

## The round loop

1. `wait-turn.mjs` exits 0 → your planning window is open. `GET /api/games/:id`, study the board.
   `turn.currentPlayerId` is always `null`; act when `phase === "active"` and you are not in
   `plan.committed`.
2. Queue actions (`/deploy`, `/move`, `/attack`, `/heal`, `/demolish`) — they do **not** execute.
   Each queued action costs 1 AP (queue length ≤ `config.balance.actionsPerTurn`); each unit acts
   at most once. Revoke with `/plan/revoke` / `/plan/clear` before committing.
3. **Deploy only from owned control points** (`fromId` = owned CP id) into an adjacent empty plain
   cell. Origin **or** target in artillery danger → plan-time rejection `invalid_deploy`.
4. `POST /api/games/:id/end-turn` = **commit and lock**. When the last living player commits, the
   server resolves all queues strictly simultaneously (`round_resolved` carries per-action outcomes).
5. Stuck players → host `POST /api/games/:id/host/force-resolve`. Once resolution begins, do not
   revoke; if it eliminates you or ends the game, stop and report.

## Artillery — read config, then live state

Do **not** memorize a fixed timetable. Each royale map carries its own schedule.

**1. Config** — `game.config.annihilation.artillery`:

| Field | Meaning |
|---|---|
| `startRound` | First shrink round (1-based `turn.roundNumber`) |
| `intervalRounds` | Rounds between further shrinks after the first |
| `damage` | HP removed from each living unit on a danger cell at round-boundary resolution |
| `minimumSafeRadius` | Smallest `safeRadius` after repeated shrinks (may be `0` = center point only) |

**2. Live state** — `game.artillery`:

| Field | Meaning |
|---|---|
| `safeRadius` | Current safe hex distance from board center `{q:0,r:0}` |
| `dangerCells` | Cells **already** outside `safeRadius` — artillery is active here |
| `warningCells` | Cells that become danger on the **next** shrink — **not** damaged yet |
| `nextShrinkRound` | Next shrink round number, or `null` at `minimumSafeRadius` |

**3. Semantics:**

- At each **round boundary** every living unit on a `dangerCells` cell takes `damage`
  (ignores defense). Walking into danger is legal but billed every round.
- `warningCells` is the evacuate-soon preview, especially when
  `nextShrinkRound === turn.roundNumber + 1`.
- **Illegal in danger**: deploy (origin/target), heal (support/target/aim cells), control-point
  repair. Combat and movement remain allowed.
- When `safeRadius` reaches `minimumSafeRadius`, `nextShrinkRound` turns `null` and the ring holds.

## Snowflake map (雪花) specifics

- Radius-9 snowflake: six radial corridors cut by blockers and water — movement is channelized, so
  narrow cells are natural kill zones. Spawn: **owned forward_base CP** (the map's ONLY CP kind:
  sole income + deploy pad, no deploy discount) + 2 heavy + 1 scout — ranger and support are
  deploy-only; composition is an economy decision.
- Control points: exactly six `forward_base` corner pads, **no supply and no repair points**.
  Losing your pad means no income beyond base and no reinforcements; supports are the only
  sustain on this map (no repair stations, and healing is banned inside danger).
- Roster (per-map numbers — always re-read `config.units`; heal range falls back to `attackRange`):
  | unit | HP | atk | def | move | range | shape / ability |
  |---|---:|---:|---:|---:|---:|---|
  | infantry | 90 | 31 | 7 | 3 | 2 | `line` 2 — 直线轰击前方两格；费用55 |
  | scout | 70 | 16 | 4 | 4 | 1 | `single` — 单格，快速机动；费用42 |
  | heavy | 140 | 40 | 9 | 2 | 1 | `arc` — 横扫周围三格扇形；费用100 |
  | ranger | 68 | 34 | 3 | 3 | 3 | `single` + **锁定**（未逃出射程必命中）；费用80 |
  | support | 76 | 10 | 5 | 3 | 2 | `healShape` `arc` — 区域治疗三格，治疗力20；费用68 |
- Economy (generous by design): `startingSupplies 500`, `baseIncome 20`, forward_base income 20
  (no deploy discount), `actionsPerTurn 8`. Rounds 1–5 (`round < startRound`) are the build-up
  window — flood units and defend your pad; healing rolls add `healVarianceRange 10` variance.
- Artillery schedule (this map only — re-derive on any other royale map): `startRound 6`,
  `intervalRounds 1`, `damage 25`, `minimumSafeRadius 1`. Round 5 shows the warning ring; from
  round 6 the safe radius shrinks **one ring per round** (round R safe radius ≈ 14 − R); from
  round 13 it floors at 1 — and the center hex itself is impassable, so the final contested
  ground is the **six cells of the inner ring** (the snowflake's heart). `maxTurns: null` — no
  round adjudication; the match ends by elimination (combat wipe, artillery wipe) or the host's
  `/force-adjudicate`.
- Scoring: HQ/CP/supply weights are 0 — **army value + actionScore are the real race**
  (`effectiveActions 10`; simultaneous hits award 1 merit per 10 HP). Read `adjudication.weights`
  of the live game instead of trusting this summary.

## Narrow-road map (狭路相逢) specifics

- 2-player radius-8 duel: two open funnels at `q = ±8` joined by an 11-cell **single-cell-wide road**
  — the road is a one-at-a-time choke; whoever stands in the mouth is the gatekeeper. Blockers flank
  the road: heavy demolition opens side lanes, so the "wall" is never fully safe.
- Spawn: **owned `forward_base` CP** at each base (`cp_west` / `cp_east`, one ring inside the base
  marker) — the map's only CPs and your only deploy pads, capturable by the enemy. **Zero starting
  units**: queue a deploy during the round-1 planning phase or the wipe check eliminates you
  (`army_destroyed`) the moment round 1 resolves — there is no HQ to keep you alive.
- Cheap roster (`infantry 5 / scout 4 / support 7 / ranger 9 / heavy 10`; HP 9/5/8/3/15 — always
  re-read `config.units`): `startingSupplies 20`, `baseIncome 5`, CP income 0, `actionsPerTurn 5`.
  Expect roughly a unit per turn from income alone.
- Artillery (this map only — re-derive on any other royale map): `startRound 5`, `intervalRounds 1`,
  `damage 5`, `minimumSafeRadius 1` — one ring per round from round 5, flooring at radius 1 from
  round 11. The pads sit at distance 7: from round 7 no safe cell borders them, so the deployment
  window is effectively rounds 1–6 — build your army early, then fight.
- Scoring: `armyValue 1 + supplies 1 + effectiveActions 15` (HQ weights are dead — royale has no
  HQ). Real actions (attacks, heals, deploys, captures) dwarf everything else; do not burn turns on
  empty moves.

## Planning checklist

Before queuing each action:

- Read unit **instance** stats from this map's `config.units`, not memory.
- Count queue vs `actionsPerTurn`; one action per unit; no duplicate destinations in your queue.
- Attack cells must match the unit's shape (ray cell for `line`, adjacent for `arc`, in-range for
  `single`); rangers: click a cell an enemy occupies **now** to lock.
- Artillery: check `game.artillery` every round. Never deploy/heal in danger; do not end your plan
  on a `warningCells` cell you cannot evacuate before `nextShrinkRound`.
- As the ring closes, terrain funnels everyone inward — expect contested `destination_conflict`
  cells on choke hexes and the center.

## Decision order

Unless the user asks for a different style:

1. Read the previous `round_resolved`: misses reveal enemy aim habits; `destination_conflict`
   cells reveal contested routes inward.
2. **Lethal shots first**: ranger locks on killable enemies; infantry lines along retreat lanes;
   heavy arcs on clumps. Seat-wiping finishers are gold — army-wipe elimination is instant.
3. **Evacuate** friendlies on `dangerCells`/`warningCells` toward the current safe radius (unless
   this activation gets a guaranteed kill and the unit can still leave before the next boundary).
4. **Heal** only if support and aim cells are both outside danger. There are no repair
   points on snowflake — supports are your only sustain, keep them alive and out of the ring.
5. **Deploy** from a safe owned CP into a safe adjacent cell: pre-shrink → capturers/economy;
   fights incoming → heavy/ranger; wounded cluster → support. No owned CP → skip.
6. **Pre-shrink** (`round < artillery.startRound`): hold your forward_base pad (sole income +
   deploy pad — there are no other CPs) and flood units while income is untouched by the ring.
7. **From first shrink** (`round >= startRound`): move inward ahead of the ring, fight inside the
   safe zone, deny the corridor lanes leading to the heart. Near `minimumSafeRadius`, position for
   the final fight on the six inner-ring cells (the impassable center hex cannot be occupied).
8. **No useful action** → `/end-turn` (commit). Do not hold the table hostage.

## Pre-commit sanity pass

- Queue length ≤ AP budget; every action is a different unit (or deploy); no duplicate destinations.
- Every attack/heal cell matches its shape; supports' arc covers wounded allies' likely cells.
- Nobody you need is parked on a danger/warning cell without an escape plan tied to `nextShrinkRound`.
- You are not stacking your whole army on cells enemies can predictably shell as the ring funnels.
