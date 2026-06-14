#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3100}"
MAP_ID="${MAP_ID:-default}"

echo "Start the server in another terminal first:"
echo "  npm run dev"
echo
echo "Terminal 1:"
echo "  node skill/ai-player.mjs --url ${BASE_URL} --side a --map ${MAP_ID} --name AI-A"
echo
echo "Copy the printed game id, then run Terminal 2:"
echo "  node skill/ai-player.mjs --url ${BASE_URL} --side b --game <gameId> --name AI-B"
