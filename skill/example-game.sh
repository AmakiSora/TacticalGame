#!/bin/bash
# Example: short Hex V2 API session
# Usage: bash skill/example-game.sh [base_url]
# Requires: curl, jq

set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
GAME_ID=""
TOKEN_A=""
TOKEN_B=""

api() {
  local method=$1 path=$2 token=${3:-}
  shift 3 || true
  local args=(-s -X "$method" -H "Content-Type: application/json")
  if [ -n "$token" ]; then args+=(-H "X-Player-Token: $token"); fi
  curl "${args[@]}" "$BASE_URL$path" "$@"
}

state() {
  api GET "/api/games/$GAME_ID" "$1"
}

echo "=== Create and join ==="
CREATE=$(api POST "/api/games" "" -d '{"name":"Alpha"}')
GAME_ID=$(echo "$CREATE" | jq -r '.gameId')
TOKEN_A=$(echo "$CREATE" | jq -r '.playerAToken')
JOIN=$(api POST "/api/games/$GAME_ID/join" "" -d '{"name":"Bravo"}')
TOKEN_B=$(echo "$JOIN" | jq -r '.playerBToken')
echo "Game: $GAME_ID"

SCOUT_A=$(state "$TOKEN_A" | jq -r '.units[] | select(.owner=="player_a" and .type=="scout") | .id')
HQ_A=$(state "$TOKEN_A" | jq -r '.headquarters.player_a.id')

echo "=== Player A: deploy and move scout toward west control point ==="
api POST "/api/games/$GAME_ID/deploy" "$TOKEN_A" \
  -d "{\"unitType\":\"infantry\",\"fromId\":\"$HQ_A\",\"q\":-8,\"r\":1}" | jq .
api POST "/api/games/$GAME_ID/move" "$TOKEN_A" \
  -d "{\"unitId\":\"$SCOUT_A\",\"q\":-4,\"r\":0}" | jq .
api POST "/api/games/$GAME_ID/end-turn" "$TOKEN_A" -d '{}' | jq .

SCOUT_B=$(state "$TOKEN_B" | jq -r '.units[] | select(.owner=="player_b" and .type=="scout") | .id')
HQ_B=$(state "$TOKEN_B" | jq -r '.headquarters.player_b.id')

echo "=== Player B: deploy and move scout toward east control point ==="
api POST "/api/games/$GAME_ID/deploy" "$TOKEN_B" \
  -d "{\"unitType\":\"infantry\",\"fromId\":\"$HQ_B\",\"q\":8,\"r\":-1}" | jq .
api POST "/api/games/$GAME_ID/move" "$TOKEN_B" \
  -d "{\"unitId\":\"$SCOUT_B\",\"q\":4,\"r\":0}" | jq .
api POST "/api/games/$GAME_ID/end-turn" "$TOKEN_B" -d '{}' | jq .

echo "=== Current V2 state ==="
state "$TOKEN_A" | jq '{
  phase,
  turn,
  supplies: .resources,
  controlPoints,
  units: [.units[] | select(.alive) | {owner,type,q,r,hp}],
  headquarters
}'
