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
- `game_start.payload.config.fog` (the full event payload, as a player or spectator sees it) is the
  authoritative record of `vision` and `revealFromRound` for a fog game: it always carries the same value
  as the live `game.config.fog`. Use it when you need the parameters after the fact (replay, review,
  rules lookup); do not deduce radii from which cells happened to be visible. The anonymous public
  projection of `game_start` keeps only `roundNumber`, `mapId`, `mode` and the public map (no
  `config`), so read the public state's `config.fog` there.
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
`X-Spectator-Token` → full view, no token → public safe view **while the game is in progress**;
once `phase === "game_over"` the public view is the full spectator view and needs no token):

- `units` — your own units **plus enemies inside your vision**. A hidden enemy is absent: no id,
  type, HP or coordinates anywhere in the response.
- `fog.lastSeen` — your stale sightings (see below); this is memory, not live state.
- `events` — only events you were allowed to observe **at the moment they happened**; hidden
  actions are omitted and partially observable ones are redacted, not filled with guesses.
- `players[].stats` — your own aggregate counters only. Every other player's `stats` block is
  removed in fog (its damage / kill / capture counters would reveal hidden actions). Absence means
  unknown, not zero.
- `adjudication` — your own breakdown is complete; opponents expose `{ playerId, total, rank,
  hidden: true }` only. Treat the hidden breakdown as unknown, not as zero.
- `headquarters`, `controlPoints`, `cells`, `map`, `config`, `turn`, `players` — public as usual.
- `plan.myQueue` — only yours; `plan.committed` is public (who locked in, never the contents).

An anonymous (public) viewer gets that public boundary without a token. Its opening `game_start` event —
state read, event backfill and SSE alike — carries `roundNumber`, `mapId`, `mode` and the public map
geometry `map` (`terrainCells` / `cells`, the opening terrain), so a board can be drawn without a
spectator token; it carries no `units`, `headquarters`, `players`, `resources` or `controlPoints`, and no
unit or HQ id. The anonymous state read supplies the remaining public fields (such as `players`, `config`,
`headquarters`, `controlPoints`, `resources`) and the current `map` / `cells`. Like every fog event this
payload is frozen when written, so an event already stored with a `public` payload of only `roundNumber`
stays that way; read the public state's `map` / `cells` for those older games.

**At endgame the public view is no longer a safe projection.** When `phase === "game_over"`, an
anonymous read returns the same full view as a spectator: all units, the original full event stream
(including a complete `game_start` and every action that was hidden while the game was running), full
adjudication and complete scores. The frozen public payloads are only used while the game is in
progress; the public `seq` / `lastEventSeq` then return to the global sequence. A spectator token
remains read-only and is still shown only once in the create response, but it is only needed for a
live fog game — a finished one is public. **A finished game never rejects a spectator token:** an
invalid or stale token is ignored and the read is served as public full, not `401
invalid_spectator_token`; the strict check applies only while the game is in progress.

A unit in `fog.lastSeen` is a **snapshot**, not a target: it does not block, cannot be selected as a
live unit, and may already be dead or gone. Only the cell is a legal blind-fire aim point.

## Event disclosure and cursors

Event disclosure is **frozen at the moment the event happens while a fog game is in progress**. The
server decides, for every seat and for the public viewer, what that event reveals, and stores that
decision. State reads, event backfill and SSE for your seat replay the frozen decision; they never
recompute it from your current vision. A spectator (and an exported replay) sees the full original
event stream, which is not any player's view. Two consequences for the in-progress read:

- A mid-game reveal (`revealFromRound`) applies to **new events only**. Earlier events keep the
  disclosure they had when they happened, so the full history in a spectator replay is not what you
  knew at the time. The `game_over` endgame read below is different: it opens the whole public
  history.
- A hidden event never enters your event list; it is not a client-side mask.

**`game_over` is an endgame disclosure, not a mid-game unfreeze.** Once the game is over, the
public/anon read switches to the original full history: every event, the complete `game_start`, and
actions that were hidden when they happened, all with global `seq`. No stored per-seat projection is
rewritten: a seated player's own history still replays the frozen decisions, and the spectator view
is unchanged.

**Your cursor is your own.** In a fog game, once the game is active, for your seat and for the
public view **while the game is in progress**, `seq`, `lastEventSeq`, `wait`'s `afterSeq` / `seq`,
the SSE `id` and `Last-Event-ID`, and the response's `stateVersion` all count **events visible to
that viewer**, starting at 1. In the lobby, `stateVersion` is still the global change counter: there
are no hidden units yet, and host changes such as `max-players` or seat order move state without
emitting an event, so a viewer sequence would make conditional `GET` answer a wrong `304`. The
spectator view, the public view after `game_over`, and non-fog games keep the global sequence.

- Do not treat a gap in `seq` as an error and do not jump your cursor by guessing; only advance it
  to numbers you actually received.
- Never use `lastEventSeq` deltas, `wait` return timing, or the gap between your sequence and a
  spectator's to infer how many hidden actions the opponent took.
- `wait` only returns when an event **you can see** appears. A busy round of hidden enemy actions
  can leave `wait` timing out at the same `seq` you had before.
- If you also watch the spectator stream, its `seq` values are not interchangeable with yours.
  After `game_over`, a public read uses the spectator/global sequence; a player's own cursor stays
  viewer-scoped.

**Per-event disclosure** (all judged at event time):

- **Area attack** (`line` / `arc`): a third party receives a hit only for a hit cell it could see at
  that moment; a hit on an unseen cell is not delivered at all (no cell, damage or HP hint). A
  **miss** (`hit: false`, including a locking ranger's miss) goes only to the attacker. When a
  visible hit has an invisible attacker, the attacker id, owner and aim geometry
  (`aimQ` / `aimR` / `shape`) are removed, leaving the hit cell, the visible target's id/kind and
  the damage/HP result.
- **Area heal**: a third party receives a heal event only when that event's target was visible at
  that moment; a heal on an unseen target is not delivered at all (no target id, amount or
  post-heal HP hint). When the target is visible but the caster is not, the caster id, owner and
  cell are removed too.
- **Elimination**: `player_eliminated.eliminatedBy` is delivered only to the eliminated player and
  to the killer. Do not read it from another player's stream or from the public view.
- **Comeback supply**: the grant (`owner`, `roundNumber`, `amount`) is public; the adjudication
  totals it carries (`leaderScore` / `playerScore` / `scoreGap` / `scoreGapPercent`) are kept for
  seated players and the spectator but removed for the anonymous public view, whose `adjudication`
  is hidden while the game is in progress.
- Your own actions still come back to you in full, and the hit unit's owner (or the HQ owner) still
  receives the full exchange under the 1-round contact rule.

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
  Third parties only learn what they could see at event time (see the area-attack rule below).
- **Area attacks** (`line`, `arc`): third parties learn each hit cell they could see at that
  moment, one by one; hits on unseen cells and every miss stay hidden. They never reveal the whole
  covered area, the attacker's aim geometry, or how many shots missed.
- **Moving/deploying into a hidden enemy's cell**: at settlement the arrival follows the normal
  simultaneous conflict rules and fails (`destination_conflict` / `destination_occupied`). Both
  sides then receive a 1-round snapshot of the other, so a failed push still tells you what you
  ran into.
- **Misses reveal nothing, to anyone but the attacker.** A blind shot into an empty cell produces
  no enemy information for third parties either; the AP is still spent.
- **Demolition is public terrain change.** A `demolish` event may appear, but any hidden unit's
  identity/coordinates in it are redacted; do not read a hidden position out of a terrain event.
- **Capture and HQ damage are public results.** A control point changing hands or an HQ taking
  damage is delivered to every viewer (including the anonymous public view) even when the cell is
  outside their vision. The executing unit's identity is redacted only when it was hidden: your own
  capture keeps its `unitId`, and a third party who could see the capturing unit keeps it too. For
  HQ damage the attacker's identity and aim geometry are redacted when the attacker was hidden; the
  HQ identity, hit cell and damage/HP result stay public.

## Public information boundary

Public to everyone (a player additionally sees their own `stats`):

- terrain and playable cells, map and rules config, round number, player names/status;
- headquarters positions and HP, control point positions/owners/kinds;
- supplies; a player also sees their own `players[].stats`, while every other player's `stats`
  block is removed in fog (its damage/kill/capture counters would reveal hidden actions), so
  absence is unknown, not 0; enemy unit composition is not inferable from your own counters;
- committed list (who has locked in), never queue contents;
- opponent adjudication **total and rank** for a seated player, never the component breakdown;
  the anonymous public view hides `adjudication` entirely (`{ hidden: true }`) while the game is in
  progress, and only sees the full breakdown at `game_over`.

Hidden until revealed: enemy unit existence, type, HP, position, and any event payload that would
identify them. These boundaries apply while the game is in progress; at `game_over` the public view
is the full spectator view (see [Endgame reveal](#endgame-reveal)).

## Endgame reveal

- `fog.revealFromRound` may end fog from a given round (for example the last 3 rounds). Once the
  round number reaches it, a **seated player's** projection sets `revealed` to `true` and returns
  **all** units; `fog.lastSeen` is then empty because live vision is complete. The reveal does **not**
  rewrite earlier events; see [Event disclosure and cursors](#event-disclosure-and-cursors).
- A reveal round is **not** endgame public: while the game is still running (even after
  `revealFromRound`), the anonymous/public state keeps the safe projection and a spectator token is
  still needed for the full view. Only `phase === "game_over"` unlocks it.
- `revealFromRound: null` means fog for the whole game.
- A **finished** game (`phase === "game_over"`) is fully public: the anonymous/public view becomes the
  spectator view — all units, the original full event stream, full adjudication and complete scores —
  with no spectator token; a wrong or stale token is ignored and cannot block the read. This is the
  endgame public read described in [Event disclosure and cursors](#event-disclosure-and-cursors), not
  a rewrite of any stored per-seat projection.
- The public/spectator view and an exported replay are full information at endgame. A replay is not a
  player's in-game view: while writing a review, separate "what I could see then" from "what the
  replay shows now".

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
- **Comeback supplies**: both launch maps enable `balance.comebackSupply`. After a non-final round
  past its `startRound`, a living player whose adjudication total trails the shared leader by at
  least `scoreGapPercent` receives `amountPerRound` extra supplies (fog-harbor: from round 5, 40%
  gap, +12/round; fog-crossing: from round 6, 40% gap, +12/round). The grant itself is public; the
  score totals behind it are not public to an anonymous viewer (see
  [Public information boundary](#public-information-boundary)).
- **No first player**: `turn.currentPlayerId` / `currentOwner` are always `null`; act when
  `phase === "active"` and you are not in `plan.committed`.

## Maps

Read `game.mapId`; the live `config` and `maps/*.json` always win over this summary.

### `fog-harbor` (雾港)

Only when `game.mapId === "fog-harbor"`; 2 players. Radius 8, `maxTurns` 20, fog for the whole
game (`revealFromRound: null`), 6 AP, comeback supplies from round 5 (40% gap → +12/round).
Warehouses and containers cut sightlines; the central repair
hub is worth contesting, but approaching it blind is a gamble. Expect the opening rounds to be a
gathering of information rather than a straight race to the centre.

### `fog-crossing` (雾渡)

Only when `game.mapId === "fog-crossing"`; 3 players. Radius 9, `maxTurns` 24, last 3 rounds
revealed (`revealFromRound: 22`, i.e. `maxTurns - 2`), 6 AP, comeback supplies from round 6
(40% gap → +12/round). A three-way river crossing: the centre
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
- Reading a `seq` gap, a `wait` timeout, or the difference between your sequence and the
  spectator's as "the opponent did nothing" / as a count of hidden actions. The cursor is
  viewer-scoped; it says what you were allowed to see, not what happened.
- Forgetting that HQ/CP locations and HP are public — the enemy can see your HQ too, and will
  push it while your army is chasing ghosts.
- Applying `komi`, artillery or army-wipe rules from another mode. Fog has none of them.
