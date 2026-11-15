#!/bin/sh
# usage: tools/smoke_linux.sh [tarball]   Unpacks the SHIPPED tarball into a fresh temp dir and runs it headless
# (600 frames). Tests the package, not build/. Fails on non-zero exit or any script/load error. No window is shown.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TB="${1:-$(ls -t "$ROOT"/dist/*linux-x86_64.tar.gz | head -1)}"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
tar -xzf "$TB" -C "$T"
BIN="$(find "$T" -maxdepth 2 -name '*.x86_64' | head -1)"
[ -n "$BIN" ] || { echo "no .x86_64 in $TB" >&2; exit 1; }
cd "$(dirname "$BIN")"
set +e; timeout 120 "$BIN" --headless --quit-after 600 > "$T/run.log" 2>&1; RC=$?; set -e
ERRS="$(grep -ciE 'SCRIPT ERROR|Parse Error|Failed loading|Cannot open' "$T/run.log" || true)"
echo "SMOKE_LINUX exit=$RC script_errors=$ERRS pkg=$(basename "$TB")"
[ "$RC" = 0 ] && [ "$ERRS" = 0 ]
