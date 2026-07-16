---
name: play-hex-api-game
description: Use when an agent is asked to play, operate, control, or make decisions in this repository's Hex V2 tactical control-point game through the REST API.
---

# Play Hex API Game

This skill teaches manual operation of the Hex V2 multiplayer game (app version `3.1.0`). Think through each turn from the current state, choose legal actions, call the matching REST endpoint, then refresh state before deciding again.

Do not run `node skill/ai-player.mjs` to delegate the turn. That script may exist for tests or automated demos, but this skill is for agent reasoning and direct game operation.

## Remote Server Target

Before calling any API, read the cloud server address from the current user prompt and construct `BASE_URL`:

- If the user provides only an IP address, use `http://<IP>:3123`.
- If the user provides a complete `http://` or `https://` origin, use it as given.
- Remove any trailing slash, then treat every `/api/...` path below as relative to `BASE_URL`.
- Verify `GET ${BASE_URL}/readyz` returns `200` before creating, joining, or resuming a game.
- If the prompt does not contain a server address, ask for it. Never fall back to `localhost` and never start a local server.

Keep player and host tokens in their request headers. Never place them in URLs or print them. The direct HTTP deployment does not encrypt tokens, so use only the server and network access authorized by the user.

## Manual Turn Loop

1. Read the current game state before choosing each action: `GET ${BASE_URL}/api/games/:id`.
2. If `winner` exists or `phase === "game_over"`, stop and report the result.
3. If `phase === "lobby"`, wait for enough players, then the host must `POST /api/games/:id/start` with `X-Host-Token`. Joiners only wait until `phase === "active"`.
4. If you are eliminated (`players[yourId].status !== "active"`), stop acting and report elimination.
5. If it is not your turn (`turn.currentPlayerId` is not you), wait briefly and read state again. Do not ask the human to say "your turn".
6. If it is your turn, inspect units, resources, action points, control points, all living opponents' headquarters HP, and legal targets.
7. Explain the chosen legal action briefly, then call the matching REST endpoint.
8. Refresh state after every successful action and reason again.
9. End the turn only after available useful legal actions are exhausted.
10. After ending the turn, continue polling only when the user asked you to keep playing; otherwise report the turn result.

Never continue without a player token for player actions. `POST /api/games` returns `hostToken` and optionally a player token when `participate` is true; `POST /api/games/:id/join` returns the joined player token. Host identity is separate from player identity: a host may create with `participate: false` and never receive a player token.

For a transient network error or `502`/`503`, wait briefly, probe `${BASE_URL}/readyz`, then fetch the game again with the existing player token. Do not create a replacement game or join again. For `429 rate_limit`, back off before retrying; do not confuse it with `429 action_limit_reached`. If using SSE, reconnect from the last received sequence with `?after=<seq>` and do not add a token query parameter.

## Multiplayer Setup

Seats are `player_a` … `player_h` (2-8 players). The server assigns seats in join order; you cannot reserve a letter by request body.

Typical flow:

1. Host creates a lobby: `POST /api/games` with `{ "mapId", "maxPlayers", "participate", "playerName" }`.
2. Other agents join: `POST /api/games/:id/join` with `{ "name" }`.
3. Optional: inspect lobby without secrets via `GET /api/games/:id/lobby`.
4. Host starts when at least 2 players are present and the map supports that count: `POST /api/games/:id/start` with `X-Host-Token`.
5. Play until elimination leaves one survivor, or adjudication at the map max round.

Map support is not universal: most maps are 2-player only. Use `multiplayer-ring` for 2/3/6-player games (symmetric ring spawns), or any map whose `supportedPlayerCounts` includes the chosen size. Creating with an unsupported `maxPlayers` returns `unsupported_player_count`.

## API

Player action requests require `X-Player-Token: <token>`. Host management requests require `X-Host-Token: <hostToken>`.

| Purpose | Method and path | Auth | Body |
|---|---|---|---|
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
| Deploy | `POST /api/games/:id/deploy` | player | `{ "unitType": "infantry|scout|heavy|ranger|support", "fromId": "...", "q": 0, "r": 0 }` |
| Move | `POST /api/games/:id/move` | player | `{ "unitId": "...", "q": 0, "r": 0 }` |
| Attack | `POST /api/games/:id/attack` | player | `{ "attackerId": "...", "targetId": "..." }` |
| Heal | `POST /api/games/:id/heal` | player | `{ "supportId": "...", "targetId": "..." }` |
| Demolish terrain | `POST /api/games/:id/demolish` | player | `{ "unitId": "...", "q": 0, "r": 0 }` |
| End turn | `POST /api/games/:id/end-turn` | player | `{}` |
| Events | `GET /api/games/:id/events?after=<seq>` | none/SSE | none |

Create response shape: `{ gameId, hostToken, player: { id, token } | null, lobby }`.
Join response shape: `{ player: { id, token }, lobby }`.

If `POST /join` returns `game_already_full` or `game_already_started`, report that error. Do not fetch state with a missing token. If `POST /start` returns `lobby_not_ready`, wait for more joins. If it returns `unsupported_player_count`, the current lobby size is not allowed on that map.

## Rules To Remember

- Coordinates are pointy-top axial hex `{ q, r }`.
- Hex distance is `max(abs(dq), abs(dr), abs(ds))`, where `s = -q-r`.
- Movement uses pathfinding and cannot pass through water, blockers, units, or headquarters.
- Attack and healing only check hex distance; there is no line-of-sight blocking.
- Only heavy units can demolish terrain. A heavy can turn an adjacent blocker into plain terrain if the target hex is in bounds, unoccupied, and exactly distance 1.
- Infantry and scout capture control points when standing on them at the end of their owner's turn.
- New current player receives base income plus owned control-point income after each turn switch.
- Deploy only from your headquarters or owned control points into adjacent empty plain cells.
- Destroying a headquarters eliminates that player: their units are removed, their control points become neutral, and their resources freeze. The match continues.
- Only the last surviving player immediately wins (`last_player_standing`).
- Turns rotate through `turn.turnOrder` among living players; whole-round completion is tracked by `turn.roundNumber`.
- If the configured max round is reached, only surviving players can win by adjudication score. A true draw is recorded when surviving leaders are exactly tied.
- Adjudication score uses `config.balance.adjudicationWeights` for enemy HQ damage, own HQ HP, owned control points, surviving army value, and supplies. In multiplayer, enemy HQ damage is cumulative against all opponents.

### Action Points

Each player has `config.balance.actionsPerTurn` action points per turn. Always read the current map value.

- One action point activates one unit.
- The first deploy, move, attack, heal, or demolish that touches a unit this turn spends one point.
- An already activated unit can finish remaining legal actions for free, such as move then attack.
- Demolish sets the heavy as acted, emits a `demolish` event, and uses the same action point limit rules as other unit activations.
- Deploy always spends one point; the new unit cannot move that same turn.
- Once `game.turn.actionsUsed >= game.config.balance.actionsPerTurn`, stop trying to activate fresh units.
- A `429 action_limit_reached` response means the action point budget is exhausted for new activations.
- A `403 player_eliminated` response means your seat is out; stop acting.

### Economy

- Base income is `config.balance.baseIncome`.
- Each owned control point adds `config.balance.controlPointIncome`.
- Typed control points may replace the flat income rule on maps that define `controlPoints[].kind` and `config.balance.controlPointTypes`.
- Maps may define `config.balance.comebackSupply` with `startRound`, `scoreGapPercent`, and `amountPerRound`. The mechanism is disabled when this object is absent.
- After each non-final whole round at or after `startRound`, compare every living player against the highest adjudication score from one shared pre-grant snapshot. A player qualifies when `(leaderScore - playerScore) / leaderScore * 100 >= scoreGapPercent`.
- Every qualifying living player receives `amountPerRound`; leaders, tied leaders, and eliminated players receive nothing. The configured final round goes directly to adjudication without a grant.
- A `comeback_supply` event reports `owner`, `amount`, `leaderScore`, `playerScore`, `scoreGap`, and `scoreGapPercent`. Refresh state after this event because supplies have already been added before the next player's ordinary income.
- Typed control points: `supply` is the economy route, `forward_base` can discount deployments from that point, and `repair` can restore nearby friendly units when that owner receives the turn.
- Do not treat typed control points as extra adjudication score. Adjudication still counts owned control points by number using the configured control-point weight.
- Hoarded supplies cannot all become units immediately when the action cap is tight. Spend on high-impact deployments when action points and deploy hexes are available.

Do not use V1 concepts: `x/y`, Manhattan distance, buildings, miners, production queues, walls, `/build`, `/produce`, or `/sell`.

## Decision Heuristic

Use this order unless the user asks for a different style:

1. Attack the weakest nearby enemy headquarters if any unit can hit it. Prefer the nearest low-HP living HQ among all opponents.
2. Attack killable or low-HP enemies; prefer support, ranger, and capturing units. Ignore eliminated players' ghosts — only living enemies matter.
3. Heal the most damaged friendly unit with support.
4. Demolish an adjacent blocker with a heavy when it opens a route to control points, deployment space, attack lanes, or an enemy headquarters.
5. Deploy strategically before ordinary movement when supplies and an action point remain, especially if supplies are high, unit count is not ahead of the strongest living rival, you own at least 2 control points, or the game is late.
   If comeback supplies restore deployment capacity, use them to rebuild a viable force or contest income-producing points; do not assume the grant repeats if the score gap falls below the configured percentage.
6. Move infantry and scouts toward neutral or enemy control points early. On typed maps, favor `supply` early for income, `forward_base` when planning sustained pressure, and `repair` when wounded units can hold nearby.
7. In the late game, move scouts, rangers, and infantry toward the best enemy headquarters attack positions.
8. Near adjudication, prioritize headquarters damage, captured points, valuable unit survival, and spending excess supplies. Only living rivals remain valid targets, but headquarters damage already dealt to eliminated rivals still counts toward the cumulative score.
9. When no useful legal action remains, call `/end-turn`.

Before every action, confirm the unit has the required movement/action availability, the target is in range, the destination is valid, and action points allow the activation.

## Multiplayer Threat Notes

- There can be multiple living opponents. Never hardcode a single rival as `player_b`.
- Capturing a contested point denies income to whoever previously owned it, not just "the enemy".
- Eliminating a weak neighbor can free resources and neutralize their points, but may also empower another rival who was fighting them.
- Host skip/eliminate endpoints are operator tools, not normal play actions. Use them only when the user asks for host control.
