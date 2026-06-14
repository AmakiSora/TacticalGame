---
name: play-hex-api-game
description: Use when Codex needs to play, control, automate, or script a player in this repository's Hex V2 tactical control-point game through the REST API. Covers game creation/joining, token handling, legal pointy-top axial q/r actions, turn loops, deployment, movement, combat, healing, and complete AI-vs-AI API play. Do not use old square-grid x/y, build, produce, sell, mining, or wall workflows.
---

# Play Hex API Game

Use this skill to operate the local Hex V2 game through HTTP. The objective is to play legal turns until the enemy headquarters is destroyed or the configured turn/action limit is reached.

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

Do not use V1 concepts: `x/y`, Manhattan distance, buildings, miners, production queues, walls, `/build`, `/produce`, or `/sell`.

## Turn Heuristic

Use this order unless the user asks for a different style:

1. Attack the enemy headquarters if any unit can hit it.
2. Attack killable or low-HP enemies; prefer support, ranger, and capturing units.
3. Heal the most damaged friendly unit with support.
4. Move infantry/scout toward neutral or enemy control points.
5. Move combat units toward the enemy headquarters, preferring cells that maintain or improve attack options.
6. Deploy when supplies allow: scouts/infantry early for capture, ranger/heavy for pressure, support when multiple friendly units are damaged.
7. End the turn after no useful legal action remains.

Refresh state after every successful action. If an action fails, log the API error and continue to the next candidate; do not repeat the same failing action in a tight loop.
