---
name: play-tactical-game
description: Use when the user asks the AI to play, control, or automate a player in the tactical war game. Handles hex V2 game creation, joining, strategy, and continuous play via the REST API.
---

# Play Tactical Game — Hex V2

## Overview

The game is a pointy-top hex, axial-coordinate (`q/r`) tactical control game. Two players fight to destroy the enemy Headquarters. Control points provide supplies and forward deployment.

## Loop

1. Create or join a game.
2. Poll `GET /api/games/:id` with `X-Player-Token`.
3. If it is your turn, deploy units, move/attack/heal with all useful units, then end turn.
4. Continue until `winner` is not `null`.

## API

All player actions require `X-Player-Token`.

| Action | Endpoint | Body |
|---|---|---|
| Deploy | `POST /api/games/:id/deploy` | `{ "unitType": "infantry|scout|heavy|ranger|support", "fromId": "...", "q": 0, "r": 0 }` |
| Move | `POST /api/games/:id/move` | `{ "unitId": "...", "q": 0, "r": 0 }` |
| Attack | `POST /api/games/:id/attack` | `{ "attackerId": "...", "targetId": "..." }` |
| Heal | `POST /api/games/:id/heal` | `{ "supportId": "...", "targetId": "..." }` |
| End turn | `POST /api/games/:id/end-turn` | `{}` |

## Rules

- Coordinates are axial hex coordinates: `{ q, r }`.
- Distance is `max(abs(dq), abs(dr), abs(ds))`, where `s = -q-r`.
- Movement uses pathfinding. Water, blockers, units, and headquarters block movement.
- Attack and healing use hex distance only; there is no line-of-sight blocking.
- Infantry and scout can capture control points by standing on them when their owner ends the turn.
- New turn income is base income plus controlled control point income.
- Units deploy from your HQ or owned control points into an adjacent empty plain hex.
- Destroying the enemy HQ wins immediately.

## Strategy

Priority order:

1. Attack enemy HQ if a unit can damage it.
2. Kill low-HP enemy units, especially support and ranger.
3. Capture neutral or enemy control points with infantry/scout.
4. Deploy infantry/scout early, heavy/ranger midgame, support when multiple units are damaged.
5. Move combat units toward enemy HQ.
6. Heal damaged friendly units with support.

Use `node skill/ai-player.mjs --url http://localhost:3000 --side a` to create a game, or `--game <id> --side b` to join one.
