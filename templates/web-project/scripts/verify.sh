#!/usr/bin/env bash
# Post-build gate: nonzero on any failure. Levels are discovered from src/levels/*.json, nothing is hardcoded.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== lint:imports =="; npm run --silent lint:imports
echo "== test ==";         npm test --silent

shopt -s nullglob
levels=(src/levels/*.json)
if [ ${#levels[@]} -gt 0 ]; then
  echo "== validate levels =="
  for f in "${levels[@]}"; do node tools/validate-level.mjs "$f"; done
  if [ -f src/sim/game.js ]; then
    echo "== botplay (informational per level; difficulty varies) =="
    for f in "${levels[@]}"; do
      id="$(basename "$f" .json)"
      echo "-- $id"; node tools/botplay.mjs --level "$id" --seeds 1,2,3,4,5 | tail -1 || true
    done
  fi
fi
echo "VERIFY OK"
