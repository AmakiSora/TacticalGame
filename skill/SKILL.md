---
name: play-hex-api-game
description: Use when an agent is asked to play, operate, control, or make decisions in this repository's Hex V2 tactical control-point game through the REST API.
---

# Play Hex API Game

This skill teaches manual operation of the Hex V2 game. Think through each turn from the current state, choose legal actions, call the matching REST endpoint, then refresh state before deciding again.

Do not run `node skill/ai-player.mjs` to delegate the turn. That script may exist for tests or automated demos, but this skill is for agent reasoning and direct game operation.

## Manual Turn Loop

1. Read the current game state before choosing each action: `GET /api/games/:id`.
2. If `winner` exists or `phase === "game_over"`, stop and report the result.
3. If the game is not in `active`, wait briefly and read state again.
4. If it is not your turn, wait briefly and read state again. Do not ask the human to say "your turn".
5. If it is your turn, inspect units, resources, action points, control points, headquarters HP, and legal targets.
6. Explain the chosen legal action briefly, then call the matching REST endpoint.
7. Refresh state after every successful action and reason again.
8. End the turn only after available useful legal actions are exhausted.
9. After ending the turn, continue polling only when the user asked you to keep playing; otherwise report the turn result.

Never continue without a player token for player actions. `POST /api/games` returns `hostToken` and optionally a player token; `POST /api/games/:id/join` returns the joined player token.

## API

All state and action requests require `X-Player-Token: <token>`.

| Purpose | Method and path | Body |
|---|---|---|
| Create lobby | `POST /api/games` | `{ "mapId": "default", "maxPlayers": 2, "participate": true, "playerName": "Agent A" }` |
| Join lobby | `POST /api/games/:id/join` | `{ "name": "Agent B" }` |
| Start game | `POST /api/games/:id/start` | host token header |
| Read state | `GET /api/games/:id` | none |
| Deploy | `POST /api/games/:id/deploy` | `{ "unitType": "infantry|scout|heavy|ranger|support", "fromId": "...", "q": 0, "r": 0 }` |
| Move | `POST /api/games/:id/move` | `{ "unitId": "...", "q": 0, "r": 0 }` |
| Attack | `POST /api/games/:id/attack` | `{ "attackerId": "...", "targetId": "..." }` |
| Heal | `POST /api/games/:id/heal` | `{ "supportId": "...", "targetId": "..." }` |
| Demolish terrain | `POST /api/games/:id/demolish` | `{ "unitId": "...", "q": 0, "r": 0 }` |
| End turn | `POST /api/games/:id/end-turn` | `{}` |
| Events | `GET /api/games/:id/events?after=<seq>` | none |

If `POST /join` returns `game_already_full`, report that error. Do not fetch state with a missing token.

## Rules To Remember

- Coordinates are pointy-top axial hex `{ q, r }`.
- Hex distance is `max(abs(dq), abs(dr), abs(ds))`, where `s = -q-r`.
- Movement uses pathfinding and cannot pass through water, blockers, units, or headquarters.
- Attack and healing only check hex distance; there is no line-of-sight blocking.
- Only heavy units can demolish terrain. A heavy can turn an adjacent blocker into plain terrain if the target hex is in bounds, unoccupied, and exactly distance 1.
- Infantry and scout capture control points when standing on them at the end of their owner's turn.
- New current player receives base income plus owned control-point income after each turn switch.
- Deploy only from your headquarters or owned control points into adjacent empty plain cells.
- Destroying a headquarters eliminates that player; only the last surviving player immediately wins.
- If the configured max round is reached, only surviving players can win by adjudication score. A true draw is recorded when surviving leaders are exactly tied.
- Adjudication score is: enemy HQ damage x 4 + own HQ HP x 2 + owned control points x 120 + surviving army value x 2 + supplies x 1.

### Action Points

Each player has `config.balance.actionsPerTurn` action points per turn, currently 5.

- One action point activates one unit.
- The first deploy, move, attack, heal, or demolish that touches a unit this turn spends one point.
- An already activated unit can finish remaining legal actions for free, such as move then attack.
- Demolish sets the heavy as acted, emits a `demolish` event, and uses the same action point limit rules as other unit activations.
- Deploy always spends one point; the new unit cannot move that same turn.
- Once `game.turn.actionsUsed >= game.config.balance.actionsPerTurn`, stop trying to activate fresh units.
- A `429 action_limit_reached` response means the action point budget is exhausted for new activations.

### Economy

- Base income is `config.balance.baseIncome`.
- Each owned control point adds `config.balance.controlPointIncome`.
- Typed control points may replace the flat income rule on maps that define `controlPoints[].kind` and `config.balance.controlPointTypes`.
- For typed control points: `supply` is the economy route, `forward_base` can discount deployments from that point, and `repair` can restore nearby friendly units when that owner receives the turn.
- Do not treat typed control points as extra adjudication score. Adjudication still counts owned control points by number using the configured control-point weight.
- With a 5-action cap, hoarded supplies cannot all become units immediately. Spend on high-impact deployments when action points and deploy hexes are available.

Do not use V1 concepts: `x/y`, Manhattan distance, buildings, miners, production queues, walls, `/build`, `/produce`, or `/sell`.

## Decision Heuristic

Use this order unless the user asks for a different style:

1. Attack the enemy headquarters if any unit can hit it.
2. Attack killable or low-HP enemies; prefer support, ranger, and capturing units.
3. Heal the most damaged friendly unit with support.
4. Demolish an adjacent blocker with a heavy when it opens a route to control points, deployment space, attack lanes, or the enemy headquarters.
5. Deploy strategically before ordinary movement when supplies and an action point remain, especially if supplies are high, unit count is not ahead, you own at least 2 control points, or the game is late.
6. Move infantry and scouts toward neutral or enemy control points early. On typed maps, favor `supply` early for income, `forward_base` when planning sustained pressure, and `repair` when wounded units can hold nearby.
7. In the late game, move scouts, rangers, and infantry toward enemy headquarters attack positions.
8. Near adjudication, prioritize headquarters damage, captured points, valuable unit survival, and spending excess supplies.
9. When no useful legal action remains, call `/end-turn`.

Before every action, confirm the unit has the required movement/action availability, the target is in range, the destination is valid, and action points allow the activation.
