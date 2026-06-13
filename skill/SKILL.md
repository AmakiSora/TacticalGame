---
name: play-tactical-game
description: Use when the user asks the AI to play, control, or automate a player in the tactical war game. Handles game creation, joining, strategy, and continuous play via the REST API.
---

# Play Tactical Game — Continuous Play

## Overview

Turn-based tactical war game on a 20x20 grid. Two players build bases, produce units, and try to destroy each other's headquarters. All interaction is via REST API with token auth.

**Win condition:** Destroy the enemy Headquarters (200 HP, 0 DEF).

**IMPORTANT:** This skill is designed for **continuous play** — you play an entire game from start to finish, looping turn after turn until there is a winner. Do NOT stop after one turn.

## Continuous Game Loop

When asked to play, follow this high-level loop:

```
1. Create or join a game
2. LOOP:
   a. Get game state
   b. If game_over → report winner, STOP
   c. If not your turn → wait for opponent (use Wait Script below)
   d. Execute your turn (all phases below)
   e. End turn
   f. goto (a)
```

You MUST keep playing until the game ends. Never stop mid-game.

### Wait Script — Poll Until Your Turn

Use this bash script to wait for the opponent to finish their turn. Run it after ending your turn or at the start of the game when waiting for the first turn.

```bash
while true; do
  result=$(curl -s -H "X-Player-Token: <token>" http://localhost:3000/api/games/<gameId>)
  
  winner=$(echo "$result" | python -c "import json,sys;d=json.load(sys.stdin);print(d['winner'])")
  if [ "$winner" != "None" ]; then
    echo "=== GAME OVER! Winner: $winner ==="
    echo "$result" > /tmp/game_state.json
    break
  fi
  
  owner=$(echo "$result" | python -c "import json,sys;d=json.load(sys.stdin);print(d['turn']['currentOwner'])")
  turn=$(echo "$result" | python -c "import json,sys;d=json.load(sys.stdin);print(d['turn']['turnNumber'])")
  
  if [ "$owner" = "<my_player_id>" ]; then
    echo "=== MY TURN! Turn $turn ==="
    echo "$result" > /tmp/game_state.json
    break
  fi
  
  sleep 2
done
```

**Usage:**
- Replace `<token>` with your player token
- Replace `<gameId>` with the game ID
- Replace `<my_player_id>` with `"player_a"` or `"player_b"` depending on which player you are
- The script saves the game state to `/tmp/game_state.json` when it becomes your turn
- It prints a message when the game is over
- Polls every 2 seconds — adjust if needed

**One-liner version** (compact, for quick inline use):
```bash
while true; do r=$(curl -s -H "X-Player-Token: <token>" http://localhost:3000/api/games/<gameId>); w=$(echo "$r"|python -c "import json,sys;d=json.load(sys.stdin);print(d['winner'])"); [ "$w" != "None" ] && echo "=== GAME OVER! Winner: $w ===" && echo "$r" > /tmp/game_state.json && break; o=$(echo "$r"|python -c "import json,sys;d=json.load(sys.stdin);print(d['turn']['currentOwner'])"); t=$(echo "$r"|python -c "import json,sys;d=json.load(sys.stdin);print(d['turn']['turnNumber'])"); [ "$o" = "<my_player_id>" ] && echo "=== MY TURN! Turn $t ===" && echo "$r" > /tmp/game_state.json && break; sleep 2; done
```

**IMPORTANT:** When running this script, always set a reasonable `--timeout` (e.g., 300 seconds for 5 minutes) so the AI doesn't get stuck forever if the opponent disconnects.

### After the Wait Script Returns

Once the script breaks out with "MY TURN", read `/tmp/game_state.json` to analyze the state and execute your turn phases. Do NOT re-fetch the game state — use the saved file.

## Setup

```
# Create game
curl -s -X POST http://localhost:3000/api/games
# Returns: { "gameId": "...", "playerAToken": "..." }

# Join game
curl -s -X POST http://localhost:3000/api/games/:id/join
# Returns: { "playerBToken": "..." }
```

Store the token. All subsequent requests use header `X-Player-Token: <token>`.

## Get Game State

```
curl -s -H "X-Player-Token: <token>" http://localhost:3000/api/games/:id
```

Returns JSON with: `buildings[]`, `units[]`, `resources`, `turn`, `phase`, `miningPoints[]`, `winner`, `config`.

Key fields:
- `turn.currentOwner` — whose turn it is
- `turn.turnNumber` — current turn number
- `phase` — `"waiting_for_player"` | `"waiting_command"` | `"executing"` | `"game_over"`
- `resources.<player>.gold` — available gold
- `units[]` — all units with `alive`, `hasMoved`, `hasAttacked`, position, stats
- `buildings[]` — all buildings with `alive`, `isBuilding`, `production`, `buildProgress`
- `config.canProduce` — which building types can produce which unit types
- `config.units` — unit specs (hp, attack, defense, moveRange, attackRange, cost, productionTime)
- `config.buildings` — building specs (hp, cost, buildTime)
- `config.economy` — startingGold, minerIncome, baseIncome
- `config.map` — width, height, buildRange, headquartersPositions, miningPoints
- `winner` — `"player_a"` | `"player_b"` | null

## API Actions

All POST, all require `X-Player-Token` header, all under `/api/games/:id`.

| Action | Endpoint | Body | Notes |
|--------|----------|------|-------|
| Build | `/build` | `{type, x, y}` | type: `"barracks"` `"miner"` `"bunker"` `"wall"` |
| Sell | `/sell` | `{buildingId}` | Refunds 80% of build cost. HQ cannot be sold. Building must not be under construction. |
| Produce | `/produce` | `{buildingId, unitType}` | unitType: `"infantry"` `"sniper"` `"tank"` `"medic"` |
| Move | `/move` | `{unitId, x, y}` | Manhattan distance, must be unoccupied |
| Attack | `/attack` | `{attackerId, targetId}` | Target within attack range |
| Heal | `/heal` | `{medicId, targetId}` | Adjacent friendly unit only |
| End Turn | `/end-turn` | `{}` | Triggers build/production ticks, income |

## Game Constants (Default Map)

### Units

| Type | HP | ATK | DEF | Move | Range | Cost | Prod Time |
|------|-----|-----|-----|------|-------|------|-----------|
| Infantry | 100 | 20 | 8 | 3 | 1 | 40 | 1 turn |
| Sniper | 60 | 35 | 3 | 2 | 4 | 60 | 2 turns |
| Tank | 150 | 25 | 15 | 2 | 1 | 80 | 3 turns |
| Medic | 70 | 5 | 5 | 3 | 1 | 50 | 1 turn |

### Buildings

| Type | HP | Cost | Build Time | Produces | Sell Refund |
|------|-----|------|------------|----------|-------------|
| Headquarters | 200 | — | — | **NOTHING** (cannot produce units) | **CANNOT SELL** |
| Barracks | 100 | 50 | 2 turns | Infantry, Sniper, Tank, Medic | 40 (80%) |
| Miner | 60 | 30 | 1 turn | Nothing (generates 15 gold/turn) | 24 (80%) |
| Bunker | 120 | 70 | 2 turns | Nothing (attacks: 24 ATK × 2/turn, range 2) | 56 (80%) |
| **Wall** | **50** | **20** | **1 turn** | **Nothing (DEF 5, build range 4)** | **16 (80%)** |

**Wall:** Walls are pure obstacles with 5 DEF. They cannot attack or produce. Build range is 4 (Manhattan) vs 2 for other buildings. Used to block chokepoints, protect miners, or funnel enemies into bunker fire. Walls can be attacked and destroyed.

**CRITICAL:** The Headquarters CANNOT produce units. You MUST build Barracks first. This is the most common mistake — the config field `canProduce.headquarters` is an empty array.

**Sell rules:** HQ cannot be sold. Buildings under construction cannot be sold. Refund is 80% of build cost (rounded down). Selling a building removes it from the map and immediately adds the refund to your gold.

### Map

- Grid: **20x20** (not 30x30)
- Player A HQ: (3, 10) — left side
- Player B HQ: (16, 10) — right side
- Mining points: (6,7), (6,13), (13,7), (13,13)
- Build range: Manhattan distance 2 from any friendly unit/building
- Starting gold: 100
- Base income: 5 gold/turn (always)
- Miner income: 15 gold/turn per completed miner

### Combat

```
damage = max(1, attacker.attack - target.defense + random(-3, 3))
```

- One attack per unit per turn
- Buildings have 0 defense
- Healing: 25 + random(0, 10) HP, medic must be adjacent (range 1), one heal per turn

## Turn Execution (Per Turn)

Run this checklist every turn, in priority order:

### Phase 1: Economy — Build Miners

```
IF gold >= 30 AND unclaimed mining points exist within build range:
  BUILD miner on nearest unclaimed mining point
```

Miners cost 30, take 1 turn to build, and generate 15 gold/turn. Payback in 2 turns.

Priority: mining points closest to your HQ (safer) first, then contested ones.

### Phase 2: Production — Build Barracks First, Then Units

```
IF no completed barracks AND gold >= 50:
  BUILD barracks (prefer position closer to enemy HQ for forward production)
IF has completed barracks with empty production slot:
  PRODUCE based on army composition needs
```

**Unit production priority:** Infantry > Tank > Sniper > Medic
- Infantry: cheap (40), fast (1 turn), good movement (3). Bread and butter.
- Tank: expensive (80, 3 turns) but 150 HP + 15 DEF. Main damage soak.
- Sniper: range 4 for safe poke, fragile (60 HP). Good behind tanks.
- Medic: only when you have 3+ damaged units. Healing = medic's attack action.

### Phase 3: Position Units for Economy

If unclaimed mining points exist and no friendly unit/building is within build range (Manhattan 2):
- Move one idle unit toward the nearest unclaimed mining point
- This enables miner construction next turn

### Phase 4: Combat

For each unit that can act (`hasMoved=false` or `hasAttacked=false`):

```
IF enemy HQ in attack range AND hasAttacked=false:
  ATTACK HQ (always prioritize winning)
ELSE IF enemy in attack range AND hasAttacked=false:
  ATTACK target: lowest HP first (focus fire for kills)
ELSE IF hasMoved=false:
  MOVE toward enemy HQ
  THEN IF enemy now in range after move:
    ATTACK
```

**Target priority:** HQ > low-HP units > **blocking walls** > full-HP units > production buildings > miners.

**Focus fire:** Concentrate attacks on one target to kill it rather than spreading damage.

**Move then attack:** A unit can move AND attack in the same turn (different flags). Always try to move toward enemies and attack in the same turn.

**Wall breaking:** If no enemy unit/HQ is in range, consider attacking nearby enemy walls if destroying them would open a shorter path to the enemy HQ or key targets.

### Phase 4b: Wall Building (optional, when gold allows)

```
IF gold >= 20 AND (defensive need OR offensive funnel):
  BUILD wall at tactical chokepoint
```

**When to build walls:**
- **Defensive:** Protect a miner that's under threat — build wall between miner and enemy units
- **Chokepoint:** Block a narrow passage between permanent walls or water to force enemies to detour or waste attacks breaking it
- **Funnel:** Build walls to guide enemies into your bunker's attack range
- **Forward block:** Build walls near enemy HQ to restrict their unit movement

**When NOT to build walls:**
- Early game (first 3 turns) — gold is better spent on miners and barracks
- When gold is below 50 — keep a reserve for unit production
- In open areas where enemies can easily walk around

**Wall build range is 4 (Manhattan)** — farther than normal buildings (range 2). Exploit this to build walls in contested areas without exposing units.

### Phase 5: Medic Heals

For each medic that hasn't acted:
```
IF adjacent injured friendly unit:
  HEAL lowest HP unit
```
Healing counts as the medic's attack action (sets hasAttacked=true).

### Phase 6: End Turn

```
POST /end-turn
```

Always end turn after exhausting all actions. Never leave units idle if they can move toward objectives.

## Strategy Phases

### Early Game (Turns 1-4)

Since HQ cannot produce units, your first priority is building a Barracks.

1. **Turn 1:** Move infantry toward nearest mining point to extend build range. Build miner (30 gold) if in range. Build barracks (50 gold) if in range of a good forward position. Gold remaining: 20.
2. **Turn 2:** Income: 20 + 5 + 15 = 40. Build second miner if possible. Wait for barracks to complete (2 turns).
3. **Turn 3:** Income: ~60. Barracks completes this turn. Produce infantry (40). Build more miners if safe.
4. **Turn 4:** Income: ~75. Produce from barracks + build more infrastructure.

**Key insight:** You have no units to produce until barracks completes on turn 3. Use the first 2 turns to establish economy (miners) and position your starting infantry.

### Mid Game (Turns 5-10)

1. Produce infantry every turn from barracks (cheap, fast)
2. Build second barracks near front line if gold allows (100+ gold)
3. Start producing tanks when you have 3+ infantry
4. Position units to threaten enemy mining points
5. Build miners on contested mining points for map control

### Late Game (Turns 10+)

1. Push toward enemy HQ with massed units
2. Focus fire on HQ (200 HP / 0 DEF = ~17-23 damage per hit)
3. Protect snipers (range 4) behind tank/infantry line
4. Use medic to keep tanks alive during push
5. Need ~10 attacks on HQ to win

## Common Patterns

### Selling Buildings

Sell (`/sell`) refunds 80% of a building's cost. Use cases:

- **Sell miners** on contested mining points you can no longer defend — recover 24 gold instead of losing the building for nothing
- **Sell forward barracks** that are about to be overrun — recover 40 gold to reinvest in units
- **Sell miners in late game** when gold is abundant and you need the map space or the miner is isolated

**When NOT to sell:** Never sell early-game infrastructure for short-term gold. Miners pay for themselves in 2 turns; selling one for 24 gold when it generates 15/turn is usually wrong unless it's about to die.

### Miner Rush
Turn 1: Build miner (30) + build barracks (50) = 80 spent. Prioritize economy. Good when opponent is passive.

### Infantry Spam
Produce infantry every turn from barracks. Cheap (40), fast production (1 turn), decent movement (3). Good for early map control and extending build range.

### Tank Push
Produce tanks once barracks is running. 150 HP + 15 DEF makes them very hard to kill. Support with medics. Expensive (80 each, 3 turns) but dominant in combat.

### Sniper Line
Build 2-3 snipers behind a tank wall. Range 4 lets them attack without retaliation. Counters infantry-heavy opponents.

## Error Handling

| Error Code | Meaning | Fix |
|-----------|---------|-----|
| `not_your_turn` | It's the opponent's turn | Wait and poll (use Wait Script) |
| `insufficient_gold` | Not enough gold | Skip action or choose cheaper option |
| `cell_occupied` | Target cell has a unit/building | Pick different coordinates |
| `out_of_build_range` | No friendly entity within 2 cells | Move a unit closer first |
| `not_mining_point` | Miner must be on a mining point | Check mining point coordinates |
| `already moved/attacked` | Unit already acted | Use a different unit |
| `building_not_ready` | Building under construction | Wait for build to complete |
| `cannot_produce` | Building can't produce that unit type | Check `config.canProduce` |
| `headquarters cannot be sold` | Tried to sell HQ | HQ is permanent, cannot be sold |
| `building is still under construction` | Tried to sell unfinished building | Wait for build to complete first |

## Implementation Notes

- Manhattan distance: `|x1-x2| + |y1-y2|` — no diagonal movement
- Grid coordinates: 0-indexed, 0-19 for both x and y
- Units spawn adjacent to their building — keep cells free near production buildings
- A unit can move AND attack in the same turn (different flags)
- Healing counts as the medic's attack action
- Gold is deducted immediately on build/produce, not at end of turn
- Under-construction buildings still count for build range
- The `config` field in game state response has all specs — prefer reading it over hardcoding values
- **Always use the Wait Script** (above) to poll for your turn — never manually "wait and retry"
- When polling for your turn, check `winner` first (game_over check) to avoid infinite loops
- Production items show `turnsRemaining` — 0 or null means the slot is free
