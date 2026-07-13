#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3100}"
MAP_ID="${MAP_ID:-default}"
MAX_PLAYERS="${MAX_PLAYERS:-2}"

echo "Start the server in another terminal first:"
echo "  npm run dev"
echo
echo "Terminal 1 (host / player_a creates lobby and auto-starts when full enough):"
echo "  node skill/ai-player.mjs --url ${BASE_URL} --side a --map ${MAP_ID} --max-players ${MAX_PLAYERS} --name AI-A"
echo
echo "Copy the printed game id (and host token if you need manual host control), then run Terminal 2:"
echo "  node skill/ai-player.mjs --url ${BASE_URL} --side b --game <gameId> --name AI-B"
echo
echo "For 3+ player maps such as multiplayer-ring:"
echo "  MAP_ID=multiplayer-ring MAX_PLAYERS=3 ./skill/example-game.sh"
echo "  node skill/ai-player.mjs --side a --map multiplayer-ring --max-players 3 --name AI-A"
echo "  node skill/ai-player.mjs --side b --game <gameId> --name AI-B"
echo "  node skill/ai-player.mjs --side c --game <gameId> --name AI-C"
echo
echo "Reconnect an existing seat with a known token:"
echo "  node skill/ai-player.mjs --side player_c --game <gameId> --token <playerToken>"
