#!/bin/sh
# Copy __TITLE__.app to ~/Applications (unsigned: right-click > Open the first time). Remove: delete the .app.
set -eu
SRC="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$HOME/Applications"
rm -rf "$HOME/Applications/__TITLE__.app"
cp -R "$SRC/__TITLE__.app" "$HOME/Applications/"
xattr -dr com.apple.quarantine "$HOME/Applications/__TITLE__.app" 2>/dev/null || true
echo "installed to ~/Applications/__TITLE__.app"
