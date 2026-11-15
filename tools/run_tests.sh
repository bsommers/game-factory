#!/bin/sh
# Run all headless logic tests (game/tests/test_*.gd). Optional arg: substring filter on file/method name.
# Exit status is non-zero when any test fails or a script error is printed.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$(mktemp)"
# Refresh the global class cache + imports first (class_name lookups fail on a cold .godot/).
timeout 300 "$ROOT/tools/godot.sh" --headless --path "$ROOT/game" --import >/dev/null 2>&1 || true
timeout 300 "$ROOT/tools/godot.sh" --headless --path "$ROOT/game" --script res://tests/run_all.gd -- "$@" >"$LOG" 2>&1
status=$?
grep -E '^(PASS|FAIL|RESULT|     - )|SCRIPT ERROR|Parse Error|ERROR:' "$LOG"
if [ $status -eq 0 ] && grep -qE 'SCRIPT ERROR|Parse Error' "$LOG"; then status=1; echo "run_tests.sh: script errors printed" >&2; fi
rm -f "$LOG"
exit $status
