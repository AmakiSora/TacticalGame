#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-${TACTICAL_GAME_URL:-}}"
MAP_ID="${MAP_ID:-default}"
MAX_PLAYERS="${MAX_PLAYERS:-2}"

if [[ -z "${BASE_URL}" ]]; then
  echo "Set BASE_URL or TACTICAL_GAME_URL to the cloud server base URL." >&2
  exit 1
fi

echo "Terminal 1 (host / player_a creates lobby and auto-starts when full enough):"
echo "  node skill/ai-player.mjs --url ${BASE_URL} --side a --map ${MAP_ID} --max-players ${MAX_PLAYERS} --name AI-A"
echo
echo "Copy the printed game id (and host token if you need manual host control), then run Terminal 2:"
echo "  node skill/ai-player.mjs --url ${BASE_URL} --side b --game <gameId> --name AI-B"
echo
echo "For 3+ player maps such as multiplayer-ring:"
echo "  BASE_URL=${BASE_URL} MAP_ID=multiplayer-ring MAX_PLAYERS=3 ./skill/example-game.sh"
echo "  node skill/ai-player.mjs --url ${BASE_URL} --side a --map multiplayer-ring --max-players 3 --name AI-A"
echo "  node skill/ai-player.mjs --url ${BASE_URL} --side b --game <gameId> --name AI-B"
echo "  node skill/ai-player.mjs --url ${BASE_URL} --side c --game <gameId> --name AI-C"
echo
echo "Reconnect an existing seat with a known token:"
echo "  node skill/ai-player.mjs --url ${BASE_URL} --side player_c --game <gameId> --token <playerToken>"
