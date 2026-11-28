#!/bin/sh
# usage: tools/smoke_web.sh [dist/<single-file>.html]   Smoke-test the SHIPPED single-file build (not src/): loads it via file:// in
# headless Chrome with tools/shot.mjs --strict (fails on any console error/uncaught exception), checks the frame is not blank.
# Born from cheesefantasy's smoke_linux.sh: test the package, not the build dir.
# Autostart convention (docs/BOTPLAY.md): the page loads with ?autostart=1&seed=1, skips the menu and publishes window.__game = {t, outcome, snapshot()}.
# After the wait this script asserts window.__game exists and t > 0, i.e. the sim really ran inside the single-file build (a page that
# loads clean but cannot load its levels, e.g. via fetch(new URL(..., import.meta.url)), fails here). SMOKE_REQUIRE_GAME=0 skips that check.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
F="${1:-$(ls -t "$ROOT"/dist/*.html | head -1)}"
OUT="$ROOT/out/shots/smoke_web.png"; mkdir -p "$(dirname "$OUT")"
PROBE='(()=>{const g=window.__game;return g?JSON.stringify({t:g.t,outcome:g.outcome??null}):null})()'
RES="$(node "$ROOT/tools/shot.mjs" --url "file://$F?autostart=1&seed=1" --out "$OUT" --wait 2500 --strict --eval "$PROBE")" || { printf '%s\n' "$RES" >&2; echo "SMOKE_WEB FAIL (page error)"; exit 1; }
[ -s "$OUT" ] || { echo "SMOKE_WEB FAIL (no screenshot)"; exit 1; }
if [ "${SMOKE_REQUIRE_GAME:-1}" != "0" ]; then
  printf '%s' "$RES" | node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const v = JSON.parse(s).eval;
      if (!v) { console.error("SMOKE_WEB FAIL: window.__game missing after ?autostart=1 (see docs/BOTPLAY.md)"); process.exit(1); }
      const g = JSON.parse(v);
      if (!(g.t > 0)) { console.error("SMOKE_WEB FAIL: window.__game.t did not advance (t=" + g.t + ")"); process.exit(1); }
      console.log("SMOKE_WEB sim advanced t=" + Number(g.t).toFixed(2) + " outcome=" + JSON.stringify(g.outcome));
    });' || exit 1
fi
echo "SMOKE_WEB OK $(basename "$F") $(wc -c <"$OUT") bytes"
