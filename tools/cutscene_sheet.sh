#!/bin/sh
# usage: tools/cutscene_sheet.sh <summon_id|all> [encounter] [outdir]   Captures 4 frames of a summon cinematic on the
# real GPU (private Xvfb) via the battle shot harness and tiles them into <outdir>/summon_<id>.jpg (needs ImageMagick).
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ID="${1:?summon id or all}"; ENC="${2:-barn_mixed}"; OUT="${3:-$ROOT/out/show}"
mkdir -p "$OUT"; OUT="$(cd "$OUT" && pwd)"
[ "$ID" = all ] && LIST="jesse tripper samantha spooky" || LIST="$ID"
for s in $LIST; do
  "$ROOT/game/scripts/battle_view/shot.sh" --out="$OUT/sum_$s" --mode=summon --summon="$s" --encounter="$ENC" --times=1.0,2.2,3.4,4.8 >/dev/null 2>&1 || true
  montage "$OUT"/sum_${s}_[0-3].png -tile 2x2 -geometry 960x540+4+4 -background black "$OUT/summon_$s.jpg"
  echo "$OUT/summon_$s.jpg"
done
