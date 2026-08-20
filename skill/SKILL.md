---
name: play-hex-api-game
description: Use when an agent is asked to play, operate, control, or make decisions in this repository's Hex tactical control-point game through the REST API. Covers standard HQ maps and annihilation maps such as artillery-zone.
---

# Play Hex API Game

Manual operation of the Hex multiplayer game (app version `3.2.12`). Reason from live state, call REST endpoints yourself, refresh, repeat.

Do **not** run `node skill/ai-player.mjs` (or the copy under this skill directory) to delegate turns. That script is for tests/demos only. `skill/wait-turn.mjs` is the only script you should run during a game, and only for waiting between turns.

## Mode routing (mandatory)

After the first successful `GET ${BASE_URL}/api/games/:id` in an active game:

1. Read `game.config.mode`.
2. **Immediately** load exactly one mode file with the `read` tool (paths relative to this skill directory):
   - `standard` → read [`standard.md`](standard.md)
   - `annihilation` → read [`annihilation.md`](annihilation.md)
3. Follow **only** that mode file for turn checklists, deploy origins, win conditions, scoring priorities, and the decision order.
4. If mode is missing or unknown, stop and report it. Do not guess HQ rules on annihilation maps.

Do not keep both mode files in working memory as equal authority. The inactive mode's HQ or army-wipe rules do not apply.

Re-read the mode file if you are about to deploy, attack a "base", or score near adjudication and are unsure.

## Remote Server Target

Before any API call, read the cloud server address from the user prompt and build `BASE_URL`:

- IP only → `http://<IP>:3123`
- Full `http://` / `https://` origin → use as given
- Strip trailing slash; all `/api/...` paths are relative to `BASE_URL`
- `GET ${BASE_URL}/readyz` must return `200` before create/join/resume
- No server in the prompt → ask. Never use `localhost`. Never start a local server.

Keep player/host tokens in headers only. Never put tokens in URLs or print them.

## Polling decision (mandatory)

Before playing, classify the user prompt **once** and follow it for the whole game. This decides whether you keep polling after every `/end-turn`:

- **Full-game / continuous intent** — e.g. 打完整局、一直玩、自动对局、打完为止、全程参与、赢下这局、play the whole game、play until it ends、keep playing → after **every** `/end-turn` you **must** keep waiting until `game_over` or your elimination. Never stop mid-game to wait for human input.
- **Single-turn intent** — e.g. 只打一回合、走一步看看、play one turn、this turn only → stop and report right after `/end-turn`.
- **Ambiguous** — default to full-game behavior and keep polling; not polling is the known failure mode. You may state this assumption in your report.

Use [`wait-turn.mjs`](wait-turn.mjs) for the wait; do not hand-roll GET loops:

```bash
node skill/wait-turn.mjs --url ${BASE_URL} --game <gameId> --player <yourSeat> --token <playerToken> [--interval-s 3] [--timeout-s 1800]
```

Run it in the **foreground as a blocking command** immediately after `/end-turn` (or whenever it is not your turn): wait for it to exit and read its exit code before doing anything else. **Never** send it to the background — no `&`, no `nohup`, no "run in background" mode, no detached shell. A backgrounded wait is a known failure mode: the agent loses track of the game and stops responding. If your harness imposes a foreground command timeout shorter than `--timeout-s`, lower `--timeout-s` to fit and rerun the script on exit code `4` instead of backgrounding it. The token stays in the header only. Interpret the exit code:

- `0` `my_turn` → refresh state, resume the turn loop
- `2` `game_over` → report the final result and stop
- `3` `eliminated` → report elimination and stop
- `4` `timeout` → tell the user nothing happened within the window; only under full-game intent, rerun the script

## Manual Turn Loop

1. `GET ${BASE_URL}/api/games/:id`
2. `winner` or `phase === "game_over"` → stop, report result
3. `phase === "lobby"` → host starts with `X-Host-Token` when ready; joiners wait for `active`
4. `players[you].status !== "active"` → stop, report elimination
5. Not your turn → run `wait-turn.mjs` in the foreground (see Polling decision); do not hand-roll GET loops, do not background the script, do not ask the human to announce the turn
6. Your turn → confirm mode file is loaded, run that mode's checklist, pick one legal action
7. Brief rationale, then the matching endpoint
8. Refresh state after every success and reason again
9. `/end-turn` only when no useful legal action remains
10. After `/end-turn`: follow the Polling decision — full-game intent means immediately running `wait-turn.mjs` again (foreground, blocking); single-turn intent means stopping with a report

Player actions need a player token (`POST /api/games` with `participate: true`, or `POST /join`). Host token is separate; `participate: false` hosts never get a player token.

Transient `502`/`503`: back off, hit `/readyz`, re-fetch with the **existing** token. Do not create/join again. `429 rate_limit` ≠ `429 action_limit_reached`. SSE: reconnect with `?after=<seq>`, no token query param.

## Multiplayer Setup

Seats: `player_a` … `player_h` (2–8). Server assigns seats in join order.

1. `GET /api/maps` — pick a map whose `preview.supportedPlayerCounts` includes lobby size
2. `POST /api/games` — `{ mapId, maxPlayers, participate, playerName }`
3. `POST /api/games/:id/join` — `{ name }`
4. Optional: `GET /api/games/:id/lobby`
5. `POST /api/games/:id/start` with `X-Host-Token` when ≥2 players and the map supports that count
6. Play until last survivor or max-round adjudication

Most maps are 2-player only. `multiplayer-ring` and annihilation `artillery-zone` support 2/3/6; `four-corners` is exactly 4. Unsupported `maxPlayers` → `unsupported_player_count`.

## API

Player actions: `X-Player-Token`. Host: `X-Host-Token`.

| Purpose | Method and path | Auth | Body |
|---|---|---|---|
| List maps | `GET /api/maps` | none | none |
| Create lobby | `POST /api/games` | none | `{ "mapId": "default", "maxPlayers": 2, "participate": true, "playerName": "Agent A" }` |
| Lobby summary | `GET /api/games/:id/lobby` | none | none |
| Join lobby | `POST /api/games/:id/join` | none | `{ "name": "Agent B" }` |
| Leave lobby | `POST /api/games/:id/leave` | player | none |
| Kick lobby player | `DELETE /api/games/:id/players/:playerId` | host | none |
| Start game | `POST /api/games/:id/start` | host | none |
| Host skip turn | `POST /api/games/:id/host/skip-turn` | host | none |
| Host eliminate | `POST /api/games/:id/host/eliminate` | host | `{ "playerId": "player_c" }` |
| Rename self | `PATCH /api/games/:id/player` | player | `{ "name": "New Name" }` |
| Read state | `GET /api/games/:id` | player | none |
| Deploy | `POST /api/games/:id/deploy` | player | `{ "unitType": "infantry\|scout\|heavy\|ranger\|support", "fromId": "...", "q": 0, "r": 0 }` |
| Move | `POST /api/games/:id/move` | player | `{ "unitId": "...", "q": 0, "r": 0 }` |
| Attack | `POST /api/games/:id/attack` | player | `{ "attackerId": "...", "targetId": "..." }` |
| Heal | `POST /api/games/:id/heal` | player | `{ "supportId": "...", "targetId": "..." }` |
| Demolish terrain | `POST /api/games/:id/demolish` | player | `{ "unitId": "...", "q": 0, "r": 0 }` |
| End turn | `POST /api/games/:id/end-turn` | player | `{}` |
| Events | `GET /api/games/:id/events?after=<seq>` | none/SSE | none |

Create: `{ gameId, hostToken, player: { id, token } \| null, lobby }`.  
Join: `{ player: { id, token }, lobby }`.

`game_already_full` / `game_already_started` → report; do not fetch state without a token. `lobby_not_ready` → wait. `unsupported_player_count` → wrong lobby size for map.

## Shared rules

Mode-specific deploy origins, elimination, artillery, and scoring live in the mode files. Shared basics:

- Axial pointy-top `{ q, r }`. Distance: `max(|dq|, |dr|, |ds|)` with `s = -q-r`.
- `game.cells` is the playable set. Do not treat `map.radius` as a walkable disk.
- Move/deploy/demolish targets must exist in `game.cells`.
- Pathfinding blocked by water, blockers, units, and HQs **when HQs exist**.
- Attack/heal: range only, no LOS.
- Income on turn gain: base + owned CP income (typed CPs may override via `controlPointTypes`).

### Units — read stats every game (mandatory)

Unit numbers are **per map**. Never reuse memorized move/attack/cost values from another map or from this skill.

**Before planning move, attack, heal, deploy, capture, or demolish:**

1. Read `game.config.units` for every type you might use (`infantry` / `scout` / `heavy` / `ranger` / `support` — a map may omit or retune any of them).
2. For each living unit instance, prefer the **instance fields** on `game.units[]` (they are copied from config at spawn): `type`, `hp`, `maxHp`, `attack`, `defense`, `moveRange`, `attackRange`, `cost`, `canCapture`, optional `healPower`, plus turn flags `hasMoved` / `hasActed` / `actionSpent`.
3. Compute legality from **those** values + hex distance + `game.cells` (and mode rules). Example pitfall: `heavy.moveRange` is often not the slowest body on the board — read it; do not assume "heavies crawl".

**Role rules (capabilities, not numbers):**

| Action | Who | Constraint |
|---|---|---|
| Capture CP | Only units with `canCapture === true` | Almost always **infantry** and **scout** only. Stand on the CP at **end of your turn**. Heavy/ranger/support do not capture even if they sit on the point. |
| Ranged attack | Any unit using its own `attackRange` | **Ranger** is the usual long-range DPS (`attackRange` often 3) — confirm on this map. Melee lines are typically range 1. No LOS checks. |
| Heal | **Only** `type === "support"` | `POST /heal` with `supportId` + `targetId`. Target must be a **living friendly unit** (not enemy, not self-as-enemy, not HQ). Both support and target must be within the support's `attackRange`. Annihilation: neither may be in artillery danger. |
| Demolish | **Only** `type === "heavy"` | Target hex: in `game.cells`, terrain **blocker**, **unoccupied**, **exactly distance 1**, turns into plain. |

Deploy cost comes from `config.units[type].cost` minus any `forward_base` (or typed) deploy discount on the origin CP. Instance `cost` is what army-value scoring uses.
- Last survivor wins immediately (`last_player_standing`). Else adjudication at `maxTurns`.
- Trust live `adjudication` on `GET /api/games/:id`. Always read **weights** and per-player breakdown fields before prioritizing score levers.
- No V1 concepts: `x/y`, Manhattan, buildings, miners, queues, walls, `/build`, `/produce`, `/sell`.

### Adjudication score (authoritative formula)

Server total for a living player is:

```text
total =
  headquartersDamage * weights.enemyHqDamage +
  ownHqHp            * weights.ownHqHp +
  controlPoints      * weights.controlPoint +
  armyValue          * weights.armyValue +
  supplies           * weights.supplies +
  actionScore
```

Where:

- Breakdown fields live on `adjudication.scores.<playerId>`: `headquartersDamage`, `ownHqHp`, `controlPoints`, `armyValue`, `supplies`, `actionScore`, `total`.
- `armyValue` = sum over living units of `round(cost * hp / maxHp)`.
- `actionScore` = `players.<id>.stats.actionMerit * effectiveActions`.
- `effectiveActions` comes from `adjudication.weights.effectiveActions` (API snapshot always exposes it). Resolution order in engine: map `balance.adjudicationWeights.effectiveActions`, else legacy `actionPoints`, else mode default (**standard 2**, **annihilation 10**).
- **Action merit** (not the same as action points spent): pure moves score **0**. Productive events add merit:
  - deploy `+1`, demolish `+1`, control-point capture `+2`
  - attack: `ceil(actualDamage / 20)`
  - heal: `ceil(amount / 20)`
- `actionScore` is **added as-is** (already multiplied by `effectiveActions`); do not multiply it by another weight key.
- Eliminated players keep the frozen `adjudicationScore` snapshot from elimination time.
- **Near max round:** read which weights are non-zero. Empty moves and hoarding supplies do **not** raise `actionScore`. Convert supplies into units/fights when AP allows; take real damage/heals/deploys/captures/demolish instead of idling.

### Action points

Read `config.balance.actionsPerTurn` per map.

- First deploy/move/attack/heal/demolish on a unit costs 1 AP; further legal actions on that unit are free that turn.
- Deploy always costs 1 AP; new unit cannot move the same turn.
- `actionsUsed >= actionsPerTurn` → no new activations (`429 action_limit_reached`).
- `403 player_eliminated` → stop acting.

### Economy (shared mechanics)

- `baseIncome`, per-CP income / typed `supply` · `forward_base` · `repair`.
- Optional `comebackSupply`: after non-final rounds past `startRound`, living players far enough behind the shared leader snapshot get `amountPerRound`.
- CPs may still matter for **income and deploy** even when `weights.controlPoint === 0`.
- Spend supplies when AP and legal deploy hexes exist; hoarding does not auto-convert under a tight AP cap.

## Decision entry

1. Load the mode file for `config.mode` (see Mode routing).
2. Run that file's checklist every action.
3. Follow that file's numbered decision order unless the user asked for another style.
4. Before every call: re-check **this unit's** instance stats / `config.units`, availability flags, range, cell exists, mode-legal origin/target (including artillery safety when required), capture/heal/demolish role rules, AP budget.

## Multiplayer notes

- Multiple living rivals; never hardcode `player_b`.
- Taking a CP denies its previous owner income (and, in annihilation, a deploy pad).
- Eliminating a weak neighbor can feed a stronger third party.
- Host skip/eliminate only when the user requests operator control.
