#!/bin/sh
# usage: desktop/smoke_linux.sh [tarball]  Unpacks the SHIPPED linux tarball into a fresh temp dir and checks it:
#  1) browser mode: embedded server serves index.html + the bundle from resources.neu (xdg-open stubbed, no real browser)
#  2) window mode under Xvfb: process stays alive 6 s with the webview (needs webkit2gtk-4.1; reported SKIP if absent)
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
eval "$(node "$ROOT/tools/project-info.mjs" --sh)"
TB="${1:-$(ls -t "$ROOT"/dist/desktop/*linux-x64.tar.gz | head -1)}"
T="$(mktemp -d)"; PID=""; trap '[ -n "$PID" ] && kill "$PID" 2>/dev/null; rm -rf "$T"' EXIT
tar -xzf "$TB" -C "$T"
D="$(find "$T" -maxdepth 2 -name "$SLUG" -type f | head -1 | xargs dirname)"
[ -x "$D/$SLUG" ] && [ -f "$D/resources.neu" ] && [ -x "$D/$SLUG.sh" ] || { echo "SMOKE_DESKTOP FAIL: incomplete package"; exit 1; }
mkdir "$T/bin"; printf '#!/bin/sh\necho "$@" > "%s/opened"\n' "$T" > "$T/bin/xdg-open"; chmod +x "$T/bin/xdg-open"
PORT=$((20000 + $$ % 20000))
cd "$D"
PATH="$T/bin:$PATH" ./$SLUG.sh --browser --port="$PORT" --neu-dev-auto-reload=false >"$T/b.log" 2>&1 & PID=$!
for i in $(seq 40); do curl -sf "http://127.0.0.1:$PORT/" -o "$T/index.html" 2>/dev/null && break; sleep 0.25; done
grep -qF "$TITLE" "$T/index.html" || { echo "SMOKE_DESKTOP FAIL: index not served"; tail -5 "$T/b.log"; exit 1; }
JS="$(sed -n 's/.*src="\(app\.js\)".*/\1/p' "$T/index.html" | head -1)"
curl -sf "http://127.0.0.1:$PORT/${JS:-app.js}" -o "$T/app.js" || { echo "SMOKE_DESKTOP FAIL: app.js not served"; exit 1; }
curl -sf "http://127.0.0.1:$PORT/js/shell.js" | grep -q F11 || { echo "SMOKE_DESKTOP FAIL: shell.js"; exit 1; }
curl -sf "http://127.0.0.1:$PORT/icon.png" | head -c 4 | grep -q PNG || { echo "SMOKE_DESKTOP FAIL: icon"; exit 1; }
NLV="$(curl -sf "http://127.0.0.1:$PORT/__neutralino_globals.js" | grep -o 'NL_VERSION="[^"]*"\|NL_VERSION = *"[^"]*"' | head -1 || true)"
kill "$PID"; wait "$PID" 2>/dev/null || true; PID=""
echo "browser-mode OK app.js=$(wc -c <"$T/app.js")B ${NLV:-NL_VERSION=?}"
if ldconfig -p | grep -q libwebkit2gtk-4.1 && command -v xvfb-run >/dev/null; then
  xvfb-run -a env -u WAYLAND_DISPLAY GDK_BACKEND=x11 timeout 8 ./$SLUG.sh >"$T/w.log" 2>&1 & PID=$!
  sleep 6; if kill -0 "$PID" 2>/dev/null; then echo "window-mode OK (alive after 6s under Xvfb)"; else echo "SMOKE_DESKTOP FAIL: window mode exited early"; tail -5 "$T/w.log"; exit 1; fi
  wait "$PID" 2>/dev/null || true; PID=""
  grep -i 'error' "$T/w.log" | head -3 || true
else echo "window-mode SKIP (no webkit2gtk-4.1 / xvfb-run)"; fi
echo "SMOKE_DESKTOP OK $(basename "$TB")"
