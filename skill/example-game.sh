#!/bin/bash
# Example: Complete game session demonstrating the tactical game API
# Usage: bash example-game.sh [base_url]
# Requires: curl, jq
#
# KEY FACT: HQ cannot produce units. You MUST build barracks first.

BASE_URL="${1:-http://localhost:3000}"
GAME_ID=""
TOKEN_A=""
TOKEN_B=""

api() {
  local method=$1 path=$2 token=$3
  shift 3
  curl -s -X "$method" \
    -H "Content-Type: application/json" \
    -H "X-Player-Token: $token" \
    "$BASE_URL$path" "$@"
}

get_state() {
  local token=$1
  api GET "/api/games/$GAME_ID" "$token"
}

my_units() {
  local token=$1 player=$2
  get_state "$token" | jq -r ".units[] | select(.owner==\"$player\" and .alive)"
}

my_gold() {
  local token=$1 player=$2
  get_state "$token" | jq -r ".resources.${player}.gold"
}

echo "=== Creating game ==="
CREATE=$(api POST "/api/games" "")
GAME_ID=$(echo "$CREATE" | jq -r '.gameId')
TOKEN_A=$(echo "$CREATE" | jq -r '.playerAToken')
echo "Game: $GAME_ID"

echo "=== Player B joining ==="
JOIN=$(api POST "/api/games/$GAME_ID/join" "")
TOKEN_B=$(echo "$JOIN" | jq -r '.playerBToken')
echo "Both players joined."

# --- Turn 1: Player A ---
# Strategy: Move infantry toward mining point, build miner, build barracks
echo "=== Turn 1: Player A ==="
echo "Gold: $(my_gold "$TOKEN_A" "player_a")"

# Get starting infantry ID
INF_A=$(get_state "$TOKEN_A" | jq -r '.units[] | select(.owner=="player_a" and .alive) | .id' | head -1)

# Move infantry toward mining point (6,7) to extend build range
echo "A: Moving infantry toward mining point (6,7)..."
api POST "/api/games/$GAME_ID/move" "$TOKEN_A" \
  -d "{\"unitId\":\"$INF_A\",\"x\":5,\"y\":10}"

# Build miner at nearest mining point (6,13) — should be in range from HQ at (3,10)
echo "A: Building miner at (6,13)..."
api POST "/api/games/$GAME_ID/build" "$TOKEN_A" \
  -d '{"type":"miner","x":6,"y":13}'

# Build barracks near HQ (HQ cannot produce units!)
echo "A: Building barracks at (5,10)..."
api POST "/api/games/$GAME_ID/build" "$TOKEN_A" \
  -d '{"type":"barracks","x":5,"y":10}'

echo "A: Ending turn."
api POST "/api/games/$GAME_ID/end-turn" "$TOKEN_A"

# --- Turn 1: Player B ---
echo "=== Turn 1: Player B ==="
echo "Gold: $(my_gold "$TOKEN_B" "player_b")"

INF_B=$(get_state "$TOKEN_B" | jq -r '.units[] | select(.owner=="player_b" and .alive) | .id' | head -1)

echo "B: Moving infantry toward mining point (13,13)..."
api POST "/api/games/$GAME_ID/move" "$TOKEN_B" \
  -d "{\"unitId\":\"$INF_B\",\"x\":14,\"y\":10}"

echo "B: Building miner at (13,13)..."
api POST "/api/games/$GAME_ID/build" "$TOKEN_B" \
  -d '{"type":"miner","x":13,"y":13}'

echo "B: Building barracks at (14,10)..."
api POST "/api/games/$GAME_ID/build" "$TOKEN_B" \
  -d '{"type":"barracks","x":14,"y":10}'

echo "B: Ending turn."
api POST "/api/games/$GAME_ID/end-turn" "$TOKEN_B"

# --- Turn 2: Player A ---
echo "=== Turn 2: Player A ==="
echo "Gold: $(my_gold "$TOKEN_A" "player_a")"
# Income: ~20 (leftover) + 5 (base) + 15 (miner) = ~40

# Build second miner if possible
echo "A: Building miner at (6,7)..."
api POST "/api/games/$GAME_ID/build" "$TOKEN_A" \
  -d '{"type":"miner","x":6,"y":7}'

echo "A: Ending turn."
api POST "/api/games/$GAME_ID/end-turn" "$TOKEN_A"

# --- Turn 2: Player B ---
echo "=== Turn 2: Player B ==="
echo "Gold: $(my_gold "$TOKEN_B" "player_b")"

echo "B: Building miner at (13,7)..."
api POST "/api/games/$GAME_ID/build" "$TOKEN_B" \
  -d '{"type":"miner","x":13,"y":7}'

echo "B: Ending turn."
api POST "/api/games/$GAME_ID/end-turn" "$TOKEN_B"

# --- Turn 3: Player A ---
echo "=== Turn 3: Player A ==="
echo "Gold: $(my_gold "$TOKEN_A" "player_a")"
# Barracks should complete this turn — can now produce units!

BARRACKS_A=$(get_state "$TOKEN_A" | jq -r '.buildings[] | select(.owner=="player_a" and .type=="barracks" and .alive and (.isBuilding|not)) | .id' | head -1)
if [ -n "$BARRACKS_A" ]; then
  echo "A: Producing infantry from barracks..."
  api POST "/api/games/$GAME_ID/produce" "$TOKEN_A" \
    -d "{\"buildingId\":\"$BARRACKS_A\",\"unitType\":\"infantry\"}"
fi

echo "A: Ending turn."
api POST "/api/games/$GAME_ID/end-turn" "$TOKEN_A"

# --- Turn 3: Player B ---
echo "=== Turn 3: Player B ==="
BARRACKS_B=$(get_state "$TOKEN_B" | jq -r '.buildings[] | select(.owner=="player_b" and .type=="barracks" and .alive and (.isBuilding|not)) | .id' | head -1)
if [ -n "$BARRACKS_B" ]; then
  echo "B: Producing infantry from barracks..."
  api POST "/api/games/$GAME_ID/produce" "$TOKEN_B" \
    -d "{\"buildingId\":\"$BARRACKS_B\",\"unitType\":\"infantry\"}"
fi

echo "B: Ending turn."
api POST "/api/games/$GAME_ID/end-turn" "$TOKEN_B"

echo "=== Current state ==="
get_state "$TOKEN_A" | jq '{
  phase: .phase,
  turn: .turn,
  gold_a: .resources.player_a.gold,
  gold_b: .resources.player_b.gold,
  units: [.units[] | select(.alive) | {owner, type, x, y, hp}],
  buildings: [.buildings[] | select(.alive) | {owner, type, x, y, hp, isBuilding, production}]
}'
