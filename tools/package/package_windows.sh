#!/bin/sh
# usage: tools/package_windows.sh [--no-build]  -> dist/KasekriegRatOps-windows-x64-setup.zip (+ .sha256)
# No NSIS available: zip containing exe + install.cmd/install.ps1/uninstall.ps1 (Start Menu shortcut, Apps&Features entry).
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[ "${1:-}" = "--no-build" ] || "$ROOT/tools/build.sh" windows >/dev/null
S="$ROOT/build/windows-stage/KasekriegRatOps-setup"; rm -rf "$ROOT/build/windows-stage"; mkdir -p "$S" "$ROOT/dist"
ln "$ROOT/build/windows/KasekriegRatOps.exe" "$S/" 2>/dev/null || cp "$ROOT/build/windows/KasekriegRatOps.exe" "$S/"
cp "$ROOT"/tools/win/install.cmd "$ROOT"/tools/win/install.ps1 "$ROOT"/tools/win/uninstall.ps1 "$S/"
OUT="$ROOT/dist/KasekriegRatOps-windows-x64-setup.zip"; rm -f "$OUT"
(cd "$ROOT/build/windows-stage" && 7z a -tzip -mx=1 -mmt=on "$OUT" KasekriegRatOps-setup >/dev/null)
(cd "$ROOT/dist" && sha256sum "$(basename "$OUT")" > "$(basename "$OUT").sha256")
ls -la "$OUT"
