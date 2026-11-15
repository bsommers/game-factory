#!/bin/sh
# usage: tools/build.sh linux|windows|macos|all [--debug]
# Config in tools/build.conf (sourced): PRODUCT=MyGame  LINUX_OUT=...  WINDOWS_OUT=...  MACOS_OUT=...
# Presets must be named "Linux x86_64", "Windows x86_64", "macOS universal" in game/export_presets.cfg.
# build/ may be a symlink to a big disk. Export templates: ~/.local/share/godot/export_templates/<ver>.stable
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PRODUCT=game; LINUX_OUT=; WINDOWS_OUT=; MACOS_OUT=
[ -f "$ROOT/tools/build.conf" ] && . "$ROOT/tools/build.conf"
LINUX_OUT="${LINUX_OUT:-linux/$PRODUCT.x86_64}"; WINDOWS_OUT="${WINDOWS_OUT:-windows/$PRODUCT.exe}"; MACOS_OUT="${MACOS_OUT:-macos/$PRODUCT.zip}"
MODE=--export-release; [ "${2:-}" = "--debug" ] && MODE=--export-debug
build_one() {
  case "$1" in
    linux)   P="Linux x86_64";    OUT="$LINUX_OUT";;
    windows) P="Windows x86_64";  OUT="$WINDOWS_OUT";;
    macos)   P="macOS universal"; OUT="$MACOS_OUT";;
    *) echo "unknown platform $1" >&2; exit 2;;
  esac
  mkdir -p "$ROOT/build/$(dirname "$OUT")"; rm -f "$ROOT/build/$(dirname "$OUT")"/*
  echo "== exporting $P"
  "$ROOT/tools/godot.sh" --headless --path "$ROOT/game" --import >/dev/null 2>&1 || true
  "$ROOT/tools/godot.sh" --headless --path "$ROOT/game" "$MODE" "$P" "$ROOT/build/$OUT" 2>&1 | tail -15
  [ -f "$ROOT/build/$OUT" ] || { echo "export FAILED: $OUT missing" >&2; exit 1; }
  ls -la "$ROOT/build/$(dirname "$OUT")"
}
case "${1:-}" in
  linux|windows|macos) build_one "$1";;
  all) build_one linux; build_one windows; build_one macos;;
  *) echo "usage: $0 linux|windows|macos|all [--debug]" >&2; exit 2;;
esac
