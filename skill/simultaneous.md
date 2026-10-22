# Simultaneous mode (同时回合)

Use only when `game.config.mode === "simultaneous"`. Current built-in simultaneous maps:
`standoff` 对峙之地 (2/3/6 players) and `molten-throne` 熔池王座 (2 players); the actual
roster, player count, layout and balance always come from `game.config`.
If the game is `standard`, `annihilation` or `royale`, stop and read that mode file instead — do not apply this file.

**Map-specific values are not interchangeable.** The rules below are mode-wide. The
`## Map specifics` section is gated by `game.mapId`: read only the subsection for your
map, and never apply one map's unit table or economy to another. All numbers there are
snapshots — re-read `config.units` and `config.balance` before acting.

Core loop difference: there is **no turn order**. Every round all players secretly queue
actions in a **planning phase**; once every living player commits (or the host forces),
the server resolves the queues **in action-point steps**: everyone's 1st queued action
settles at once, then everyone's 2nd, and so on. `turn.currentPlayerId` is always `null`;
your signal to act is: `phase === "active"` and `plan.committed` does not include you
(same condition `wait-turn.mjs` exit 0 uses).

## The round loop

1. `wait-turn.mjs` exits 0 → your planning window is open. `GET /api/games/:id`, study the board.
2. Queue actions one by one (they do **not** execute): `/deploy`, `/move`, `/attack`, `/heal`, `/demolish`, `/plan/wait`.
   - **Queue position is the action point.** The 1st entry settles at step 1, the 2nd at step 2, and so on. A unit may appear in several steps (move at step 1, attack at step 2, …); only one action per player per step.
   - Every response returns `{ ok, queued, queue }` — `queue` is your current plan (only you can see it).
   - `POST /api/games/:id/plan/wait` (empty body) appends a **wait** entry: it costs 1 AP and does nothing, so you can delay a key action to a later step.
   - Deploy origins follow the standard rule: your HQ **or** an owned CP, into an adjacent
     plain cell. A map may set `balance.deployFromHq: false` — the HQ is then **not** legal as
     `fromId` (plan-time rejection `invalid_deploy`), only owned CPs are. Per-kind deploy bans
     (`balance.controlPointTypes.<kind>.canDeploy: false`) apply the same way — owned CPs of such
     kinds are not legal `fromId`. Whether the target cell is currently occupied is only checked at
     settlement (it may be vacated earlier in the round).
   - Made a mistake? `POST /api/games/:id/plan/revoke` with `{ "actionId": ... }` removes one queued action;
     `POST /api/games/:id/plan/clear` empties the whole plan. Free until you commit. Revoking shifts later
     steps up.
3. `POST /api/games/:id/end-turn` = **commit and lock**. Response `{ committed: true, resolved, roundNumber }`.
   - After committing: further queueing returns `403 not_your_turn`; committing again returns `409 already_committed`.
   - When the **last** living player commits, `resolved: true` and the server resolves the round immediately.
4. Re-fetch state and read the new events (or `/events`). `round_resolved` summarizes every
   player's outcomes per action (`executed` / `failed` / `missed` / `fizzled`). Each result
   carries `actionId` and, for unit-bound actions, `unitId`; `failed`/`fizzled` also include a
   `detail` object (`unitType`, `fromQ/fromR`, target `q/r`, deploy `fromId`), while `missed`
   includes `detail.attackerId`. Then the next planning window opens (`round_start`); run
   `wait-turn.mjs` again per your polling decision.
5. Stuck because someone stopped submitting? Ask the host to `POST /api/games/:id/host/force-resolve`
   (resolves now; uncommitted players participate with whatever they had queued at that moment,
   possibly nothing).
   Immediately re-read the new state and `round_resolved`/`round_start` events. Once resolution
   begins, do not try to revoke or clear that round's plan. If resolution causes an elimination or
   `game_over`, stop acting and report the result.

## Hard rules (differ from sequential modes)

- **Queue position = action point**: entry 1 settles at step 1, entry 2 at step 2, and so on.
  Every living player's step-k action settles at the same time; nobody starts step k+1 until
  step k is fully resolved. Each queued action (including `wait`) costs 1 AP; queue length ≤
  `config.balance.actionsPerTurn` (`standoff`: **5**, `molten-throne`: **4**; always use the live value).
  In simultaneous mode `turn.currentPlayerId` and `turn.currentOwner` are always `null`; do not use
  `turn.actionsUsed` — use `plan.myQueue.length`.
- **A unit may act in several steps**: e.g. move at step 1 and attack at step 2, or move → attack →
  move across three steps. Each step still holds at most one action per player, and a unit can
  only have one action in a given step. Deployed units have no unit id to reference during planning,
  so they cannot be given further actions in the round they appear.
- **Failure cascade**: if a unit's earlier action hard-fails (move blocked/occupied, invalid target,
  unit gone, …), every later queued action of that unit in this round is **void** and still costs its
  AP (`action_failed`, reason `previous_action_failed`). Missed attacks and heals with nobody to heal
  are not hard failures and do not void later steps.
- **Attacks aim at a cell/direction, not a unit**: `POST /attack { "attackerId": "...", "q": 3, "r": 0 }`.
  Plan-time range/shape is checked from the attacker's **projected** position (after its earlier queued
  moves), so move-then-attack works. What you may click depends on the unit's configured `attackShape`
  in `config.units` (see the subsection for your `game.mapId`; units with no `attackShape` default to
  `single` = any cell within `attackRange`):
  - `single` — one cell within `attackRange`. At settlement the shot hits whatever **enemy**
    unit or enemy HQ occupies that cell after this step's moves/deploys settle: an enemy that was there
    at plan time and moves away → **miss**; an empty cell an enemy moves into → **hit**
    (prediction fire); friendly/own entity or still-empty cell → no effect. No friendly fire.
  - `line` (infantry) — the clicked cell must lie on one of the 6 straight rays from the
    attacker; the shot covers the first `length` cells (`standoff` infantry: 2; use this map's
    configured `length`) along that ray.
    **Every enemy in the covered cells takes a full independent damage roll** — dodging a line
    means clearing the whole ray, not sidestepping one hex.
  - `arc` (heavy) — click an adjacent cell to pick a direction; the shot covers that cell and
    its two adjacent neighbours (3 cells around the attacker). Sweeps clumped enemies.
  - `attackLock` (ranger) — if an **enemy unit** stands on the clicked cell at plan time, the
    shot **locks onto it**: at settlement it hits that unit wherever it ended up, as long as it
    did not escape the attacker's `attackRange` bubble; escaping the bubble is the only dodge
    (`missed`, reason `target_escaped`). Locked shots on movers are the anti-kite tool.
  - Attack events carry `shape` (`single/line/arc`), `locked: true` for lock shots, and the step number.
- **Arrival rules within one step**: all moves/deploys of that step are declared together.
  Two or more arrivals on the same cell all fail (`destination_conflict`). An arrival fails if the
  destination is still a blocker (`destination_blocked`) or is occupied by a headquarters / a unit
  that is not moving out this step (`destination_occupied`). Because the step resolves **departures
  first**, a unit may enter a cell vacated in the same step; swaps and chains are allowed. If a
  vacating move fails, arrivals that depended on that cell fail too. Failed attempts are NOT
  refunded (AP spent, no supplies deducted for failed deploys). Every failed, missed, or fizzled
  queued action still consumes its step/AP.
- **Movement range uses terrain-only path search at plan time**: water/blocker cells block the
  path; units and headquarters do **not** block it. The destination may be occupied when you queue
  it — settlement decides whether it was vacated in time. You cannot queue a destination beyond
  `moveRange` or one that needs to cross water/blockers (unless your own earlier demolish cleared it).
- **Demolish changes terrain from the next step on**: a blocker cleared at step k is walkable at step k+1.
- **Heals are area effects aimed at a cell/direction**: `POST /heal { "supportId": "...", "q": 1, "r": 0 }`
  (NOT `targetId` — that is the sequential-mode body). The coverage shape comes from
  `healShape` in `config.units` (`standoff` support: `arc`; `molten-throne` support has no
  `healShape`, so `single`; default is `single`). Plan-time only checks shape/range from the support's
  projected position. At settlement every **wounded** friendly on the final covered cells receives its
  own heal roll; if targets moved off the coverage the heal fizzles (`out_of_range`), if everyone left
  is at full HP the reason is `already_healthy`, and healing in an artillery danger zone fizzles with
  reason `artillery_zone`.
- **Damage and heals settle as simultaneous net HP within each step**: target HP = HP + heals − all
  incoming damage; survives if > 0. Two units attacking each other's cells can kill each other in the
  same step; an attacker that dies in the step still fires its own shot.
- **Deterministic step phases**: queue-list order is execution priority by step, and within a step the
  server resolves fixed sub-phases in the opening `turnOrder` when a tie needs an order, so replays are
  deterministic. Each step: cascade check → deployments and movements (arrival solver) → demolish →
  attacks and net healing → deaths/elimination. After the last step: control-point capture → round
  adjudication → comeback supplies → next-round income and repair. `round_resolved` carries a `steps`
  count and each outcome carries its `step`.
- **Income is symmetric**: round 1 has NO income; from round 2 on, every living player receives
  income + repair-CP healing at the round boundary, all at once.
- **Capture**: at the end of resolution, any of your `canCapture` units standing on a CP you do
  not own flips it (same as sequential end-of-turn capture, but for everyone at once).
- **Visibility**: full board is public, but other players' queues are hidden. `GET /api/games/:id`
  shows `plan.myQueue` (yours), `plan.committed` (who locked in — public), never their contents.
  Do NOT try to infer enemy plans from the API; reason from the board.

## Map specifics

Read `game.mapId` first. Only the matching subsection applies. Numbers below are
snapshots — always re-read `config.units`, `config.balance`, and `config.controlPoints`.

### `standoff` (对峙之地)

Only when `game.mapId === "standoff"`; supports 2/3/6 players.

- Radius-5 hexagon (~91 cells), six-fold symmetric. `layouts`: 2 players opposite corners,
  3 alternating, 6 all. Spawn: HQ + 2 infantry + 1 scout — **heavy, ranger and support are
  deploy-only** on this map; your composition is an economy decision.
- Control points: center `cp_center` (`repair`) + one `supply` point per corner axis
  (`cp_1`..`cp_6`). The center is the flashpoint for prediction-fire brawls.
- Roster (per-map numbers — always re-read `config.units`; healing uses `healRange` when configured and otherwise falls back to `attackRange`):
  | unit | HP | atk | def | move | range | shape / ability |
  |---|---:|---:|---:|---:|---:|---|
  | infantry | 90 | 31 | 7 | 2 | 2 | `line` 2 — 直线轰击前方两格；费用55 |
  | scout | 60 | 16 | 4 | 3 | 1 | `single` — 单格，快速占点；费用42 |
  | heavy | 140 | 40 | 9 | 2 | 1 | `arc` — 横扫周围三格扇形；费用100 |
  | ranger | 68 | 38 | 3 | 2 | 3 | `single` + **锁定**（未逃出射程必命中）；费用80 |
  | support | 76 | 10 | 5 | 2 | 2 | `healShape` `arc` — 区域治疗三格，治疗力20；费用68 |
  HQ: HP 200, defense 6.
- Balance: `startingSupplies 120`, `baseIncome 8`, supply control-point income 8 (repair center income 6), `actionsPerTurn 5`,
  `maxTurns 15`, comeback supplies from round 4 (40% gap → +12/round). Adjudication weights
  favor CPs (60, mostly time-averaged hold) and HQ damage (5), with army at 0.35, supplies 0,
  and kills at 0.15 per killed-unit cost (last hit).
  Move ranges are short by design (most units 2, scouts 3): escaping a `line`/`arc` footprint or a
  ranger's lock bubble costs the mover's whole action, so pure kiting cannot win.
- Win conditions (standard HQ rules): destroy an enemy HQ to eliminate them; last player
  standing wins; at round 15 adjudicate by score. No artillery, no army-wipe elimination.
  On an unlimited map (`config.balance.maxTurns === null`) `round_resolved.gameOver` stays
  `false` every round — only elimination or the host's `/force-adjudicate` ends the game.

**Do not apply this roster or economy to any other simultaneous map.**

### `molten-throne` (熔池王座)

Only when `game.mapId === "molten-throne"`; 2-player layout only (no 3/6-player support).

- Radius-6 hexagon (127 cells), 180° rotational symmetry, so neither seat has a spawn advantage.
  The center is a `water` pool; the north-west and south-east corners are sealed by
  `blocker`/`water`. All fighting is pushed through the middle.
- Control points: 24 total — 16 `supply` (income 1, `canDeploy: false`), 4 `repair`
  (income 1, repair 5, `canDeploy: false`) and 4 `forward_base` (income 4, deploy discount 9,
  deploy allowed).
- Deployment: `deployFromHq: false` and supply/repair points are banned as origins —
  **only owned forward bases can deploy**, so their ownership is your reinforcement route.
- Spawn: HQ 100 HP / defense 3; 5 scouts + 1 support. Heavy and ranger are deployment options,
  not starting units.
- Roster (snapshot — re-read `config.units`; this map configures **no** `attackShape`,
  `healShape` or `attackLock`, so every attack and heal uses the default `single` shape;
  support healing falls back to `attackRange` = 1):
  | unit | HP | atk | def | move | range | shape / ability |
  |---|---:|---:|---:|---:|---:|---|
  | infantry | 90 | 28 | 7 | 3 | 1 | `single` — 单格；费用42 |
  | scout | 58 | 25 | 4 | 5 | 1 | `single` — 单格，快速占点；费用35 |
  | heavy | 140 | 36 | 12 | 2 | 1 | `single` — 单格；费用88 |
  | ranger | 68 | 40 | 3 | 2 | 3 | `single` — 单格远程；费用72（本图无锁定） |
  | support | 78 | 10 | 5 | 3 | 1 | `single` — 单格治疗，治疗力20；费用56 |
  HQ: HP 100, defense 3.
- Balance: `startingSupplies 30`, `baseIncome 5`, `actionsPerTurn 4`, `maxTurns 20`,
  `damageVarianceRange 5`, `healVarianceRange 10`, comeback supplies from round 4
  (15% gap → +12/round). Adjudication weights: `enemyHqDamage 7`, `ownHqHp 2`,
  `controlPoint 75`, `armyValue 2`, `supplies 0`, `killValue 0.5` per killed-unit cost.
  CPs dominate the score, so map control is the primary route to an adjudication win.
- Win conditions (standard HQ rules): destroy an enemy HQ to eliminate them; last player
  standing wins; at round 20 adjudicate by score. No artillery, no army-wipe elimination.

## Planning checklist

Before queuing each action:

- Read unit **instance** stats from this map's config (`config.units`), not memory — and do not
  reuse another map's roster.
- Count your queue vs `actionsPerTurn`; each action (including `wait`) = 1 AP, failed or not.
- Remember the queue is a timeline: entry N settles with everyone else's entry N. Put setup moves
  before the attacks/heals that depend on them; use `wait` to delay when you need a later step.
- A unit may appear several times, but if its earlier action hard-fails the rest of that unit's
  entries are void (and still cost AP). Keep contingency moves on other units.
- Attack ranges/coverage are measured from the attacker's **projected** hex after its earlier
  queued moves; check the unit's `attackShape` before picking a cell.
- Lock every shot you can: rangers clicking a cell an enemy occupies NOW cannot be dodged
  inside the range bubble. Infantry lines cover the enemy's straight escape lanes; heavy arcs
  punish clumps around CPs and choke cells. (On maps without these shapes, all shots are
  `single` — check the map subsection.)
- Keep supports adjacent to the line: arc heals only cover the 3 cells around the aim
  direction, and targets must still be on them at settlement. On maps with the default
  `single` heal shape, aim directly at the wounded unit's cell.
- Commit early when your plan is set; the round only resolves when everyone has.

## Decision order

Unless the user asks for a different style:

1. Read the previous `round_resolved` results: your misses reveal enemy movement patterns;
   `action_failed destination_conflict` / `destination_occupied` cells reveal contested destinations.
2. **Lethal shots first**: ranger **locks** on killable enemies (undodgeable inside the
   bubble); infantry lines along the enemy's likely retreat lane; heavy arcs on clumped
   killables. On maps without lock/line/arc, concentrate `single` shots on the best target.
   HQ cells never move — always guaranteed hits when in range/coverage.
3. **HQ pressure**: line/arc/single fire onto enemy HQ hexes (HQs never move).
4. **Zone denial**: sweep contested CP cells / choke cells where enemy capturers must stand —
   area shapes make standing there costly even if they dodge one hex.
5. **Heal** the unit most likely to be focused (net-HP can save it through the volley).
6. **Deploy** to hold or contest (new unit doubles as a body-block; it cannot be referenced again
   this round).
7. **Move** capturers onto CPs; vacate cells for your own later steps; move threatened units off
   cells enemies will predictably shell; remember enemies see YOUR board too — avoid the obvious hex.
8. **Demolish** when a blocker removal opens a lane for a later step (the terrain lands next step).
9. Commit (`/end-turn`) when the queue is set — do not hold the table hostage.

## Pre-commit sanity pass

- Queue length ≤ AP budget; remember one action per player per step.
- Check the step order: setup moves (or `wait`) must come before the actions that depend on them.
- Every attack cell matches that attacker's shape (ray cell for `line`, adjacent for `arc`,
  in-range for `single`) from its **projected** position; heals aim at cells whose arc still
  covers wounded allies after their likely move.
- Occupied destination cells are allowed, but they fail unless vacated earlier in the round; do
  not rely on an enemy moving out at the same step unless you are deliberately swapping.
- You are not stacking your whole army into cells enemies can predictably shell.
