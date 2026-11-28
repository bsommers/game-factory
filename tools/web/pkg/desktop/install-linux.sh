#!/bin/sh
# Install __TITLE__ for the current user (no root): app dir, `__SLUG__` command, menu entry, icon.
#   ./install.sh [--prefix DIR] [--uninstall]      default prefix: ~/.local
set -eu
SRC="$(dirname "$(readlink -f "$0")")"
PREFIX="${HOME}/.local"; UNINSTALL=0
while [ $# -gt 0 ]; do case "$1" in
  --prefix) PREFIX="$2"; shift 2 ;; --uninstall) UNINSTALL=1; shift ;;
  -h|--help) sed -n '2,3p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;; *) echo "unknown option $1" >&2; exit 2 ;; esac; done
APP="$PREFIX/share/__SLUG__"; BIN="$PREFIX/bin/__SLUG__"
DESK="$PREFIX/share/applications/__SLUG__.desktop"; ICON="$PREFIX/share/icons/hicolor/256x256/apps/__SLUG__.png"
if [ "$UNINSTALL" = 1 ]; then rm -rf "$APP" "$BIN" "$DESK" "$ICON"; echo "removed __TITLE__ from $PREFIX"; exit 0; fi
[ -f "$SRC/resources.neu" ] || { echo "run install.sh from the unpacked __SLUG__ folder" >&2; exit 1; }
rm -rf "$APP"; mkdir -p "$APP" "$PREFIX/bin" "$(dirname "$DESK")" "$(dirname "$ICON")"
cp "$SRC/__SLUG__" "$SRC/resources.neu" "$SRC/__SLUG__.sh" "$APP/"
[ -f "$SRC/icon.png" ] && cp "$SRC/icon.png" "$ICON"
ln -sf "$APP/__SLUG__.sh" "$BIN"
cat > "$DESK" <<DESKTOP
[Desktop Entry]
Type=Application
Name=__TITLE__
Exec=$APP/__SLUG__.sh
Icon=__SLUG__
Categories=Game;
Terminal=false
DESKTOP
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$PREFIX/share/applications" >/dev/null 2>&1 || true
echo "installed __TITLE__ -> $APP (run: __SLUG__)"
case ":$PATH:" in *":$PREFIX/bin:"*) ;; *) echo "note: add $PREFIX/bin to PATH to use the '__SLUG__' command" ;; esac
