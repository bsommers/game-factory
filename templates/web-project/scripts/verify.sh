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
    # Enforced: a sim is present, so every level must meet the 80% bot clear bar (docs/BOTPLAY.md). Exit 1 = below bar, 2 = contract broken.
    echo "== botplay (>=80% bar per level) =="
    for f in "${levels[@]}"; do
      id="$(basename "$f" .json)"
      echo "-- $id"
      rc=0; out="$(node tools/botplay.mjs --level "$id" --seeds 1,2,3,4,5 2>&1)" || rc=$?
      printf '%s\n' "$out" | tail -3
      if [ "$rc" -ne 0 ]; then echo "VERIFY FAILED: botplay level $id exited $rc (1 = below the 80% clear bar, 2 = sim contract missing/broken)" >&2; exit "$rc"; fi
    done
  fi
fi
echo "VERIFY OK"
