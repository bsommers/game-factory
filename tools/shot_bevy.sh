#!/bin/sh
# usage: tools/shot_bevy.sh <level-arg> out.png  -- headless GPU screenshot of a Bevy game in a private Xvfb (never the desktop).
# Needs the game to support `--level <x> --shot <png>` (see templates/bevy-fps-project). Env: GAME_BIN (binary path), SHOT_SIZE (default 1600x900).
# Key lessons: unset WAYLAND_DISPLAY so winit uses X11 (a Wayland surface hits DeviceLost under Xvfb); MESA_VK_WSI_DEBUG=sw
# keeps rendering on the GPU while presentation is a CPU copy; never use `pkill -f` to clean up (kill by PID).
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; LVL="$1"; OUT="$2"
: "${GAME_BIN:=$(ls "${CARGO_TARGET_DIR:-/datanapps/cargo-target/$(basename "$ROOT")}"/debug/"$(basename "$ROOT")" 2>/dev/null || true)}"
[ -x "$GAME_BIN" ] || { echo "set GAME_BIN to the built binary" >&2; exit 2; }
FIFO="$(mktemp -u -p "${TMPDIR:-/datanapps/claude-tmp}")"; mkfifo "$FIFO"
Xvfb -displayfd 3 -screen 0 "${SHOT_SIZE:-1600x900}x24" -nolisten tcp 3>"$FIFO" >/dev/null 2>&1 & XPID=$!
trap 'kill $XPID 2>/dev/null||true; rm -f "$FIFO"' EXIT
read -r D <"$FIFO"
cd "$ROOT"
env -u WAYLAND_DISPLAY BEVY_ASSET_ROOT="$ROOT" XDG_SESSION_TYPE=x11 DISPLAY=":$D" WGPU_BACKEND="${WGPU_BACKEND:-vulkan}" MESA_VK_WSI_DEBUG=sw \
  timeout 120 "$GAME_BIN" --level "$LVL" --shot "$OUT" "${@:3}"
