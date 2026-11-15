#!/bin/sh
# Project-local Godot wrapper. Binary: $GODOT_BIN, else .tools/godot/Godot_v*_linux.x86_64 (see tools/install_godot.sh).
# usage: tools/godot.sh --path game ...
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="${GODOT_BIN:-$(ls "$ROOT"/.tools/godot/Godot_v*_linux.x86_64 2>/dev/null | head -1)}"
[ -x "$BIN" ] || { echo "godot.sh: no Godot binary; run tools/install_godot.sh or set GODOT_BIN" >&2; exit 1; }
exec "$BIN" "$@"
