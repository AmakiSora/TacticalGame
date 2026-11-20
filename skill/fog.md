# Fog mode (迷雾)

Use only when `game.config.mode === "fog"` (built-in maps: `fog-harbor` 雾港 2 players,
`fog-crossing` 雾渡 3 players).
If the game is `standard`, `annihilation`, `simultaneous` or `royale`, stop and read that mode
file instead — do not apply this file.

Fog = **simultaneous skeleton** (secret plans, commit, step-by-step simultaneous resolution) ×
**vision fog**. You have a headquarters, no artillery ring and no `komi`. The plan queue,
`end-turn` commit, `/plan/wait` + `/plan/revoke` + `/plan/reorder` + `/plan/clear`, the host's
`host/force-resolve` and the shared action rules all keep their simultaneous semantics.

**Secrecy is enforced by the server, not by the client.** The server only sends you your own units
plus enemies inside your vision, and it projects events and adjudication per viewer. Do not expect a
"full board with a dark overlay": a hidden enemy is not in your response at all, so never try to
reconstruct it from the API, and never assume the UI is hiding something the JSON still contains.

## Hard rules

- **Only enemy units are hidden.** Terrain, playable cells, headquarters (position and HP), control
  points (position, owner, kind) and player resources are public from the start.
- **Vision is faction-shared.** All your living units, your living headquarters and every control
  point you own pool their vision for you.
- **You always see your own units**, even if they are outside every vision source (e.g. after a
  deep push or a demolition).
- **Attacks still aim at a cell** (`/attack { attackerId, q, r }`), and attacking an unseen cell is
  legal: that is **blind fire**. There is no separate blind-fire endpoint and no "cannot target"
  rejection for an empty-looking cell.
- **No artillery, no `komi`, no army-wipe elimination.** Elimination is headquarters destruction
  (same HQ rules as simultaneous): HQ destroyed → eliminated; last living player wins; at
  `config.balance.maxTurns` the game closes on adjudication score.
- **Action points come from the map** (`config.balance.actionsPerTurn`; both launch maps use 6).
  Every queued action, including `wait`, costs 1 AP, and queue length ≤ that value.
- **Never hardcode vision radii.** Read the map override below; maps may retune per unit type.

## Vision

Vision sources for a player:

| Source | Radius |
|---|---:|
| Each living unit, by type — default | scout **4**, ranger **3**, infantry **2**, support **2**, heavy **1** |
| Each living headquarters you own | 1 |
| Each control point you own | 1 |

- A map may override any unit type in `fog.vision` (`game.config.fog.vision`), values 0–8
  integers. `0` means that unit type projects **no** vision; its own cell is still visible.
- `game_start.payload.config.fog` (the event payload) is the authoritative record of `vision` and
  `revealFromRound` for a fog game: it always carries the same value as the live `game.config.fog`.
  Use it when you need the parameters after the fact (replay, review, rules lookup); do not deduce
  radii from which cells happened to be visible.
- **Line of sight:** a `blocker` cell on the straight line between the source and the target blocks
  vision. The source cell and the target cell themselves do not block. `water` never blocks.
  Cells outside the map / not in `game.cells` block.
- Units, headquarters and control points do **not** block line of sight.
- Vision is **not mutual**: standing in your vision does not grant the enemy vision of you. Only
  the enemy's own sources decide what they see.

`GET /api/games/:id` exposes your computed vision as `fog.visibleCells` (sorted `"q,r"` strings);
use it to reason about coverage instead of re-implementing the line-of-sight math. `fog.enabled`
is `true` for fog games.

## What you receive

For a fog game the server projects the state per viewer (`X-Player-Token` → your view,
`X-Spectator-Token` → full view, no token → public safe view):

- `units` — your own units **plus enemies inside your vision**. A hidden enemy is absent: no id,
  type, HP or coordinates anywhere in the response.
- `fog.lastSeen` — your stale sightings (see below); this is memory, not live state.
- `events` — only events you are allowed to observe; hidden actions are omitted, partially
  observable ones are redacted, not filled with guesses.
- `adjudication` — your own breakdown is complete; opponents expose `{ playerId, total, rank,
  hidden: true }` only. Treat the hidden breakdown as unknown, not as zero.
- `headquarters`, `controlPoints`, `cells`, `map`, `config`, `turn`, `players` — public as usual.
- `plan.myQueue` — only yours; `plan.committed` is public (who locked in, never the contents).

A unit in `fog.lastSeen` is a **snapshot**, not a target: it does not block, cannot be selected as a
live unit, and may already be dead or gone. Only the cell is a legal blind-fire aim point.

## Sightings (残影)

- A sighting is kept for **one full planning round**: seen during round R settlement → still
  returned during round R+1 planning → dropped from R+2 planning onward.
- It records the last confirmed position, unit type, `hp` and `maxHp` at the time it was seen
  (`seenRound`). It does not follow later movement and does not update HP.
- A sighting expires only by that rule. A dead unit or an eliminated player does **not** clear
  other players' sightings of its units early; an eliminated player's own memory is discarded
  because they no longer receive a view. Treat a sighting as stale even if its owner is gone.
- The server maintains `lastSeen` for you; never write or infer it client-side.

## Contact, blind fire and reveals

- **Attack**: the attacker learns the full snapshot of every enemy actually hit, even if it was
  hidden at plan time. Each hit enemy learns the attacker's snapshot for 1 full planning round.
  Third parties learn nothing from the exchange unless they had vision themselves.
- **Area attacks** (`line`, `arc`) reveal only the enemies actually hit, one by one; they never
  reveal the whole covered area.
- **Moving/deploying into a hidden enemy's cell**: at settlement the arrival follows the normal
  simultaneous conflict rules and fails (`destination_conflict` / `destination_occupied`). Both
  sides then receive a 1-round snapshot of the other, so a failed push still tells you what you
  ran into.
- **Misses reveal nothing.** A blind shot into an empty cell produces no enemy information; the AP
  is still spent.
- **Demolition is public terrain change.** A `demolish` event may appear, but any hidden unit's
  identity/coordinates in it are redacted; do not read a hidden position out of a terrain event.
- **Capture and HQ damage are public results.** A control point changing hands or an HQ taking
  damage is observable; the executing unit's identity may be redacted when it was hidden.

## Public information boundary

Public to everyone:

- terrain and playable cells, map and rules config, round number, player names/status;
- headquarters positions and HP, control point positions/owners/kinds;
- supplies and public stats (`players[].stats`) are public; enemy unit composition is not
  inferable from them;
- committed list (who has locked in), never queue contents;
- opponent adjudication **total and rank**, never the component breakdown.

Hidden until revealed: enemy unit existence, type, HP, position, and any event payload that would
identify them.

## Endgame reveal

- `fog.revealFromRound` may end fog from a given round (for example the last 3 rounds). Once the
  round number reaches it, or `phase === "game_over"`, the server sets the projection's `revealed`
  to `true` and returns **all** units; `fog.lastSeen` is then empty because live vision is complete.
- `revealFromRound: null` means fog for the whole game.
- The final result panel/replay is full information. A replay is not a player view: while writing a
  review, separate "what I could see then" from "what the replay shows now".

## The round loop

Same as simultaneous, plus a fog read step:

1. `wait-turn.mjs` exits 0 → planning window open. `GET /api/games/:id`; confirm
   `phase === "active"` and that `plan.committed` does not contain you.
2. Read `units`, `fog.visibleCells`, `fog.lastSeen`, public HQ/CP state, supplies and AP.
3. Queue actions (they do **not** execute): `/deploy`, `/move`, `/attack`, `/heal`, `/demolish`,
   `/plan/wait`. Entry N settles with every player's entry N. A unit may act in several steps;
   an earlier hard failure voids that unit's later queued actions (`previous_action_failed`) but
   still spends their AP.
4. Revise with `/plan/revoke` / `/plan/clear` / `/plan/reorder` before committing; then
   `POST /end-turn` locks the plan. The last living player's commit resolves the round.
5. Read `round_resolved` and the new events. Separate `executed` / `failed` / `missed` /
   `fizzled`, and update your belief map: live sighting, stale sighting, or unknown.
6. If the host forces resolution, uncommitted players participate with whatever was queued at
   that moment. Once resolution begins, do not try to revoke.

## Simultaneous rules that still apply

Fog changes what you know, not how the round resolves. In particular:

- **Deploy**: your HQ or an owned control point, into an adjacent plain cell. A map may set
  `balance.deployFromHq: false` (HQ not a legal origin) or ban a CP kind with
  `controlPointTypes.<kind>.canDeploy: false`. The deployed unit cannot move that round but may
  attack or heal from its deploy cell.
- **Attack/heal shapes**: attacks and heals aim at a cell; the shape comes from `config.units`
  (`attackShape` / `healShape`, `single` by default; `attackLock` for locking rangers). Plan-time
  range/shape is checked from the unit's projected position after its earlier queued moves.
- **Attack limit**: a unit may queue at most `config.balance.attacksPerUnit` attacks per round
  (default 1); further attacks are rejected with `attack_limit_reached`.
- **Arrival in one step**: two or more moves/deploys onto the same cell all fail
  (`destination_conflict`); a cell vacated in the same step can be entered; a destination that
  stays occupied fails (`destination_occupied`). Movement range is a terrain-only path search at
  plan time — `blocker`/`water` block the route, units do not. Queued moves never unlock a path or
  change this search: an order queued earlier in the round does not open a route for a later one,
  and fog sightings are not units — they never block either.
- **Failure cascade**: an earlier hard failure voids that unit's later queued actions but still
  spends their AP (`previous_action_failed`); a missed attack does not void later steps.
- **Income, repair and capture**: round 1 has no income; from round 2 every living player receives
  income and repair-CP healing at the round boundary. Capture resolves at the end of the round.
- **No first player**: `turn.currentPlayerId` / `currentOwner` are always `null`; act when
  `phase === "active"` and you are not in `plan.committed`.

## Maps

Read `game.mapId`; the live `config` and `maps/*.json` always win over this summary.

### `fog-harbor` (雾港)

Only when `game.mapId === "fog-harbor"`; 2 players. Radius 8, `maxTurns` 20, fog for the whole
game (`revealFromRound: null`), 6 AP. Warehouses and containers cut sightlines; the central repair
hub is worth contesting, but approaching it blind is a gamble. Expect the opening rounds to be a
gathering of information rather than a straight race to the centre.

### `fog-crossing` (雾渡)

Only when `game.mapId === "fog-crossing"`; 3 players. Radius 9, `maxTurns` 24, last 3 rounds
revealed (`revealFromRound: 22`, i.e. `maxTurns - 2`), 6 AP. A three-way river crossing: the centre
is a meeting point, not a safe one, and a brawl there can hand the game to the third player. Use
the reveal window to convert a hidden lead into a decisive fight, and expect the others to do the
same.

## Decision order (run every planning window)

1. **Re-establish the picture.** Refresh state; list your live units, visible enemies, stale
   sightings and unknown regions. Never plan as if the last snapshot were current.
2. **Price information first.** If you have no contact, spend the cheapest activation that expands
   vision toward the objective or your likely attacker approach — usually a scout or ranger on a
   flank, not the whole army.
3. **Protect the sources.** Scouts and rangers are your eyes and are usually fragile. Do not push
   them into a blind choke without a follow-up; a dead scout costs you the next rounds' picture,
   not just its cost.
4. **Choose the fight you can see.** Prefer attacks on confirmed, wounded or exposed units. A
   confirmed kill is worth more than a speculative shot.
5. **Blind fire only at priced cells.** Fire at a `lastSeen` cell, a choke the enemy must cross, or
   an objective approach — not at random empty hexes. Account for the AP cost of a miss; area
   shapes (`line`/`arc`) are usually better blind-fire tools than single shots because they cover
   several plausible cells.
6. **Respect public objectives.** HQ positions/HP and control points are public: defend your own
   HQ approach, and use CP income/deploy rights even when the enemy is unseen.
7. **Queue for the worst case.** The enemy moves simultaneously; aim at where they will be, not
   only where they are. Keep a reserve activation for a reaction you cannot see yet.
8. **Commit and re-read.** After `end-turn`, wait for the round, then update the belief map before
   planning the next window.

## Common mistakes

- Treating `fog.lastSeen` as a live enemy and planning a kill that is already gone.
- Assuming the board in the response is the whole board; it is only what you are allowed to see.
- Pushing a lone scout to the centre "for vision" and losing both the unit and the next picture.
- Firing blind at empty hexes every round: misses reveal nothing and burn the AP you need to
  defend.
- Forgetting that HQ/CP locations and HP are public — the enemy can see your HQ too, and will
  push it while your army is chasing ghosts.
- Applying `komi`, artillery or army-wipe rules from another mode. Fog has none of them.
