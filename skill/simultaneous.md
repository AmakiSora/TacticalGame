# Simultaneous mode (同时回合)

Use only when `game.config.mode === "simultaneous"` (map: `standoff` 对峙之地, 2/3/6 players).  
If the game is `standard` or `annihilation`, stop and read that mode file instead — do not apply this file.

Core loop difference: there is **no turn order**. Every round all players secretly queue
actions in a **planning phase**; once every living player commits (or the host forces),
the server resolves **all queues strictly simultaneously**. `turn.currentPlayerId` is
always `null`; your signal to act is: `phase === "active"` and `plan.committed` does not
include you (same condition `wait-turn.mjs` exit 0 uses).

## The round loop

1. `wait-turn.mjs` exits 0 → your planning window is open. `GET /api/games/:id`, study the board.
2. Queue actions one by one (they do **not** execute): `/deploy`, `/move`, `/attack`, `/heal`, `/demolish`.
   - Every response returns `{ ok, queued, queue }` — `queue` is your current plan (only you can see it).
   - Made a mistake? `POST /api/games/:id/plan/revoke` with `{ "actionId": ... }` removes one queued action;
     `POST /api/games/:id/plan/clear` empties the whole plan. Free until you commit.
3. `POST /api/games/:id/end-turn` = **commit and lock**. Response `{ committed: true, resolved, roundNumber }`.
   - After committing: further queueing returns `403 not_your_turn`; committing again returns `409 already_committed`.
   - When the **last** living player commits, `resolved: true` and the server resolves the round immediately.
4. Re-fetch state and read the new events (or `/events`). `round_resolved` summarizes every
   player's outcomes per action (`executed` / `failed` / `missed` / `fizzled`). Then the next
   planning window opens (`round_start`); run `wait-turn.mjs` again per your polling decision.
5. Stuck because someone stopped submitting? Ask the host to `POST /api/games/:id/host/force-resolve`
   (resolves now; uncommitted players participate with whatever they had queued at that moment,
   possibly nothing).
   Immediately re-read the new state and `round_resolved`/`round_start` events. Once resolution
   begins, do not try to revoke or clear that round's plan. If resolution causes an elimination or
   `game_over`, stop acting and report the result.

## Hard rules (differ from sequential modes)

- **One action per unit per round** — a unit may queue exactly ONE of: move, attack, heal
  (support), demolish (heavy). No move-then-attack combos. Queueing a second action for the
  same unit is rejected (`invalid_*`, "unit already has a planned action this round").
- **Attacks target a CELL, not a unit**: `POST /attack { "attackerId": "...", "q": 3, "r": 0 }`
  — any cell within the attacker's `attackRange`. At resolution the shot hits whatever
  **enemy** unit or enemy HQ occupies that cell after all moves/deploys settle:
  - Enemy there at plan time that moves away → **miss** (wasted action).
  - Empty cell an enemy moves into → **hit** (prediction fire).
  - Friendly/own entity or still-empty cell → no effect. No friendly fire.
- **Destination conflicts fail for everyone**: if two or more moves/deploys from ANY players
  claim the same cell, **all of them fail** (`action_failed`, reason `destination_conflict`).
  Failed attempts are NOT refunded (AP spent, no supplies deducted for failed deploys).
  Every failed, missed, or fizzled queued action still consumes its queue slot/AP. Failed deploys
  do not deduct supplies; failed moves, attacks, heals, and demolishes are not refunded. Common
  resolution reasons include `destination_conflict`, `unit_gone`, `out_of_range`,
  `already_healthy`, `invalid_target`, and `target_gone`.
  Your own queue cannot claim the same cell twice (rejected at queue time with `cell_occupied`).
- **Movement paths use the plan-time board**: every unit (including enemies that might move)
  blocks pathing, and the destination must be empty at plan time. No swap/chase-through tricks.
- **Demolish changes terrain only after movement**: the newly cleared cell is not walkable this round.
- **Heals re-check range at resolution** against the target's final position: a target that
  moved out of the support's range makes the heal fizzle (`action_failed`, reason `out_of_range`).
- **Damage and heals settle as simultaneous net HP**: target HP = HP + heals − all incoming
  damage; survives if > 0. Two units attacking each other's cells can kill each other in the
  same round; an attacker that dies still fires its own shot.
- **Action points**: every queued action costs 1 AP. Use `plan.myQueue.length` and
  `config.balance.actionsPerTurn` to count remaining AP; do not use `turn.actionsUsed`.
  In simultaneous mode `turn.currentPlayerId` and `turn.currentOwner` are always `null`
  (`turn.currentPlayerId/currentOwner` 始终为 `null`).
  Queue length ≤ `config.balance.actionsPerTurn` (standoff: **5**). Deployed units cannot act in
  the round they appear (deploy is their activation).

- **Deterministic settlement phases**: queue-list order is not execution priority
  (队列列表顺序不代表执行优先级). All players'
  inputs are locked first, then the server resolves fixed phases in the opening `turnOrder` when a
  same-phase tie needs an order, so replays are deterministic. The phases are:
  deployment declarations/generation → movement → demolish → attacks and net healing →
  deaths/elimination → control-point capture → round adjudication → comeback supplies → next-round
  income and repair. Event order may therefore differ from each player's queue order. Simultaneous
  means simultaneous input, not random or phase-less settlement.
- **Income is symmetric**: round 1 has NO income; from round 2 on, every living player receives
  income + repair-CP healing at the round boundary, all at once.
- **Capture**: at the end of resolution, any of your `canCapture` units standing on a CP you do
  not own flips it (same as sequential end-of-turn capture, but for everyone at once).
- **Visibility**: full board is public, but other players' queues are hidden. `GET /api/games/:id`
  shows `plan.myQueue` (yours), `plan.committed` (who locked in — public), never their contents.
  Do NOT try to infer enemy plans from the API; reason from the board.

## Standoff map (对峙之地) specifics

- Radius-5 hexagon (~91 cells), six-fold symmetric. `layouts`: 2 players opposite corners,
  3 alternating, 6 all. Spawn: HQ + 2 infantry + 1 scout + 1 heavy.
- Control points: center `cp_center` + one per corner axis (`cp_1`..`cp_6`), untyped
  (flat income). The center is the flashpoint for prediction-fire brawls.
- Balance: `startingSupplies 150`, `baseIncome 15`, `controlPointIncome 10`, `actionsPerTurn 5`,
  `maxTurns 18`, comeback supplies from round 4 (40% gap → +20/round). Adjudication weights
  favor CPs (60) and HQ damage (5); actionScore default 2/merit point.
- Win conditions (standard HQ rules): destroy an enemy HQ to eliminate them; last player
  standing wins; at round 18 adjudicate by score. No artillery, no army-wipe elimination.

## Planning checklist

Before queuing each action:

- Read unit **instance** stats from this map's config (`config.units`), not memory.
- Count your queue vs `actionsPerTurn`; each action = 1 AP, failed or not.
- One action per unit — pick each unit's single best contribution.
- Do not queue two of your own moves/deploys onto the same destination cell.
- Attack ranges are measured from the attacker's **current** hex (it will not move this round).
- For attacks, choose cells where an enemy **will be** (their shortest path, CP contest,
  your HQ's approach lanes) or cheap insurance on cells they occupy now.
- Keep supports behind the lines: heals must survive the target's own movement choices.
- Commit early when your plan is set; the round only resolves when everyone has.

## Decision order

Unless the user asks for a different style:

1. Read the previous `round_resolved` results: your misses reveal enemy movement patterns;
   `action_failed destination_conflict` cells reveal contested destinations.
2. **Lethal prediction shots first**: any enemy unit (or HQ) you can kill with a cell attack
   this round — it cannot be dodged if the target has no reason to move.
3. **HQ pressure**: cell-attack enemy HQ hexes (HQs never move — guaranteed hits if in range).
4. **Zone denial**: attack contested CP cells / choke cells where enemy capturers must stand.
5. **Heal** the unit most likely to be focused (net-HP can save it through the volley).
6. **Deploy** to hold or contest (new unit doubles as a body-block this round).
7. **Move** capturers onto CPs; move threatened units off cells enemies will predictably shell;
   remember enemies see YOUR board too — avoid the obvious hex.
8. **Demolish** when a blocker removal opens future lanes (effect lands after this round's moves).
9. Commit (`/end-turn`) when the queue is set — do not hold the table hostage.

## Pre-commit sanity pass

- Queue length ≤ AP budget; every queued action is for a different unit (or deploy).
- No duplicate destinations within your own queue.
- Every attack cell is inside that attacker's range; heals are inside range even after the
  target's likely move.
- You are not stacking your whole army into cells enemies can predictably shell.
