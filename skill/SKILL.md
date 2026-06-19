---
name: play-hex-api-game
description: Use when Codex needs to play, control, automate, or script a player in this repository's Hex V2 tactical control-point game through the REST API. Covers game creation/joining, token handling, legal pointy-top axial q/r actions, the per-turn action-point limit, turn loops, deployment, movement, combat, healing, and complete AI-vs-AI API play. Do not use old square-grid x/y, build, produce, sell, mining, or wall workflows.
---

# Play Hex API Game

Use this skill to operate the local Hex V2 game through HTTP. The objective is to play legal turns until the enemy headquarters is destroyed or the 20-round adjudication limit is reached.

## Start Points

- Start the server with `npm run dev`; the default base URL is `http://localhost:3100`.
- Run an AI player with `node skill/ai-player.mjs`.
- Create a new player A game: `node skill/ai-player.mjs --side a --name "AI A"`.
- Join an existing game as player B: `node skill/ai-player.mjs --side b --game <gameId> --name "AI B"`.
- Reconnect to an existing seat with `--game <gameId> --side a|b --token <token>`.

Never continue without a token. `POST /api/games` and `POST /api/games/:id/join` are the only endpoints that return player tokens.

## API

All state and action requests require `X-Player-Token: <token>`.

| Purpose | Method and path | Body |
|---|---|---|
| Create as player A | `POST /api/games` | `{ "mapId": "default", "name": "AI A" }` |
| Join as player B | `POST /api/games/:id/join` | `{ "name": "AI B" }` |
| Read state | `GET /api/games/:id` | none |
| Deploy | `POST /api/games/:id/deploy` | `{ "unitType": "infantry|scout|heavy|ranger|support", "fromId": "...", "q": 0, "r": 0 }` |
| Move | `POST /api/games/:id/move` | `{ "unitId": "...", "q": 0, "r": 0 }` |
| Attack | `POST /api/games/:id/attack` | `{ "attackerId": "...", "targetId": "..." }` |
| Heal | `POST /api/games/:id/heal` | `{ "supportId": "...", "targetId": "..." }` |
| End turn | `POST /api/games/:id/end-turn` | `{}` |
| Events | `GET /api/games/:id/events?after=<seq>` | none |

If `POST /join` returns `game_already_full`, report that error. Do not fetch state with a missing token.

## Rules To Remember

- Coordinates are pointy-top axial hex `{ q, r }`.
- Hex distance is `max(abs(dq), abs(dr), abs(ds))`, where `s = -q-r`.
- Movement uses pathfinding and cannot pass through water, blockers, units, or headquarters.
- Attack and healing only check hex distance; there is no line-of-sight blocking.
- Infantry and scout capture control points when standing on them at the end of their owner's turn.
- New current player receives base income plus owned control-point income after each turn switch.
- Deploy only from your headquarters or owned control points into adjacent empty plain cells.
- Destroying the enemy headquarters immediately wins.
- If no headquarters is destroyed after both players complete turn 20 (player B ends turn 20), the server adjudicates by score. A true draw is only possible when scores are exactly tied.
- Adjudication score is: enemy HQ damage × 4 + own HQ HP × 2 + owned control points × 120 + surviving army value × 2 + supplies × 1.

### Action Points (per-turn limit)

Each player has a limited number of **action points** per turn (`config.balance.actionsPerTurn`, currently **5**). Activating a unit costs one point; the limit caps how many different units a player can operate each turn and prevents a snowballing side from acting with a huge army.

- **One action point = activate one unit.** The first deploy/move/attack/heal that touches a unit this turn spends a point and marks that unit activated.
- A unit that is already activated can finish its remaining legal actions for **free** (e.g. move then attack, or move then heal) without spending more points.
- **Deploy** always spends a point (the new unit is freshly activated; it cannot also move the same turn).
- Once the budget is exhausted, only already-activated units may still act; end the turn after that.
- The server returns `429` with code `action_limit_reached` when you try to activate a new unit while out of points. Track `game.turn.actionsUsed` against `game.config.balance.actionsPerTurn` and stop attempting new-unit actions once `actionsUsed >= actionsPerTurn`.

### Economy

- Base income is `config.balance.baseIncome` (**10**); each owned control point adds `config.balance.controlPointIncome` (**15**) per turn.
- With a 5-action cap, income above ~85/turn cannot all be spent on deployment, so hoarding supplies has diminishing value — spend on high-impact units rather than stockpiling.

Do not use V1 concepts: `x/y`, Manhattan distance, buildings, miners, production queues, walls, `/build`, `/produce`, or `/sell`.

## Turn Heuristic

Use this order unless the user asks for a different style:

1. Attack the enemy headquarters if any unit can hit it.
2. Attack killable or low-HP enemies; prefer support, ranger, and capturing units. Avoid wasting many attacks on healthy heavy units when a point or HQ route is available.
3. Heal the most damaged friendly unit with support.
4. Deploy strategically before ordinary movement when supplies and an action point remain, especially if supplies ≥ 90, unit count is not ahead, you own at least 2 control points, or the game has reached turn 8.
5. Move infantry/scout toward neutral or enemy control points before turn 8. From turn 8 onward, or once you own 3+ points, move scout/ranger/infantry toward enemy HQ attack positions.
6. From turn 15 onward, prioritize adjudication score: damage HQ, capture/hold points, preserve valuable units, and spend excess supplies.
7. Once `actionsUsed >= actionsPerTurn`, stop trying to move/deploy fresh units; finish any free attacks from activated units, then end the turn.

Refresh state after every successful action. If an action fails, log the API error and continue to the next candidate; do not repeat the same failing action in a tight loop.
