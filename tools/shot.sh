#!/bin/sh
# Render ONE real GPU frame of a scene or level to PNG without a window on the user's desktop.
# usage: tools/shot.sh <scene.tscn|level-id> <out.png> [--cam x,y,z,yaw,pitch] [--size WxH] [--frames N] [--fov deg] [--user-arg --k=v]...
# Method: private Xvfb server (own display number, never :0), Godot Forward+ on Vulkan (RADV, real GPU);
# the X11 window lives only inside Xvfb. Xvfb has no DRI3, so RADV reports no present queue; MESA_VK_WSI_DEBUG=sw
# makes Mesa present through a CPU copy (XPutImage) while ALL rendering stays on the GPU. GPU picked by
# SHOT_GPU (Vulkan device index, default 0 = RX 7900 XTX on this machine); without it Godot falls back to llvmpipe. Frame is read back from the viewport (tests/shot.tscn) after N frames.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[ $# -ge 2 ] || { echo "usage: $0 <scene.tscn|level-id> <out.png> [--cam x,y,z,yaw,pitch] [--size WxH] [--frames N] [--fov deg]" >&2; exit 2; }
TARGET="$1"; OUT="$2"; shift 2
UARGS=""; CAM=""; SIZE="1920x1080"; FRAMES="90"; FOV="70"
while [ $# -gt 0 ]; do
  case "$1" in
    --cam) CAM="$2"; shift 2;;
    --size) SIZE="$2"; shift 2;;
    --frames) FRAMES="$2"; shift 2;;
    --fov) FOV="$2"; shift 2;;
    --user-arg) UARGS="$UARGS $2"; shift 2;;
    *) echo "unknown option $1" >&2; exit 2;;
  esac
done
case "$OUT" in /*) ;; *) OUT="$(pwd)/$OUT";; esac
mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"
W="${SIZE%x*}"; H="${SIZE#*x}"

# Private X server; -displayfd picks a free display number.
FIFO="$(mktemp -u)"; mkfifo "$FIFO"
Xvfb -displayfd 3 -screen 0 "${W}x${H}x24" -nolisten tcp -noreset 3>"$FIFO" >/dev/null 2>&1 &
XPID=$!
trap 'kill $XPID 2>/dev/null || true; rm -f "$FIFO"' EXIT INT TERM
read -r DNUM <"$FIFO"
[ -n "$DNUM" ] || { echo "shot.sh: Xvfb failed to start" >&2; exit 1; }

set -- --path "$ROOT/game" --display-driver x11 --rendering-driver vulkan --resolution "${W}x${H}" \
  --position 0,0 --gpu-index "${SHOT_GPU:-0}" ${SHOT_GODOT_ARGS:-} res://tests/shot.tscn -- --target="$TARGET" --out="$OUT" --frames="$FRAMES" --fov="$FOV"
[ -n "$CAM" ] && set -- "$@" --cam="$CAM"
for u in $UARGS; do set -- "$@" "$u"; done
LOG="$(mktemp)"
status=0
env -u WAYLAND_DISPLAY MESA_VK_WSI_DEBUG=sw DISPLAY=":$DNUM" XDG_SESSION_TYPE=x11 timeout 180 "$ROOT/tools/godot.sh" "$@" >"$LOG" 2>&1 || status=$?
grep -E 'SHOT_|ERROR|Vulkan' "$LOG" | head -20
if grep -q llvmpipe "$LOG"; then echo "shot.sh: WARNING rendered on llvmpipe (software), not the GPU" >&2; fi
rm -f "$LOG"
[ $status -eq 0 ] && [ -s "$OUT" ] || { echo "shot.sh: failed (status $status)" >&2; exit 1; }
