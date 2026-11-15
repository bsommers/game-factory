#!/bin/sh
# usage: tools/package_linux.sh [--no-build]
# Packages build/linux/ into dist/: .tar.gz, .deb, and a self-extracting per-user installer .sh
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VER="${VERSION:-0.1.0}"
N=kasekrieg-ratops
B="$ROOT/build/linux"; D="$ROOT/dist"; W="$(mktemp -d "$ROOT/build/pkg.XXXXXX")"
trap 'rm -rf "$W"' EXIT
[ "${1:-}" = "--no-build" ] || "$ROOT/tools/build.sh" linux >/dev/null
[ -x "$B/$N.x86_64" ] && [ -f "$B/$N.pck" ] || { echo "missing build in $B" >&2; exit 1; }
mkdir -p "$D"; find "$D" -maxdepth 1 -type f \( -name "${N}-*" -o -name "${N}_*" \) -delete
ICON="$ROOT/game/assets/models/hero_emblem.png"

# game dir layout: binary + pck + icon + launcher
G="$W/$N"; mkdir -p "$G"
cp "$B/$N.x86_64" "$B/$N.pck" "$G/"; cp "$ICON" "$G/$N.png"
cat > "$G/$N.sh" <<'EOS'
#!/bin/sh
cd "$(dirname "$(readlink -f "$0")")" && exec ./kasekrieg-ratops.x86_64 "$@"
EOS
chmod +x "$G/$N.sh"
tar -C "$W" -czf "$D/${N}-${VER}-linux-x86_64.tar.gz" "$N"

desktop() { cat <<EOD
[Desktop Entry]
Type=Application
Name=KÄSEKRIEG: RAT OPS
Comment=Third-person cheese-war shooter
Exec=$1
Icon=$2
Terminal=false
Categories=Game;ActionGame;
EOD
}

# .deb
P="$W/deb"; mkdir -p "$P/DEBIAN" "$P/opt/$N" "$P/usr/bin" "$P/usr/share/applications" "$P/usr/share/icons/hicolor/256x256/apps"
cp "$G"/* "$P/opt/$N/"
ln -s "/opt/$N/$N.sh" "$P/usr/bin/$N"
cp "$ICON" "$P/usr/share/icons/hicolor/256x256/apps/$N.png"
desktop "/opt/$N/$N.sh" "$N" > "$P/usr/share/applications/$N.desktop"
cat > "$P/DEBIAN/control" <<EOC
Package: $N
Version: $VER
Section: games
Priority: optional
Architecture: amd64
Maintainer: Kaesekrieg <noreply@example.invalid>
Depends: libc6, libx11-6, libxcursor1, libxi6, libxinerama1, libxrandr2, libgl1, libvulkan1
Description: KÄSEKRIEG: RAT OPS
 Third-person photoreal cheese-war shooter (Godot 4.7).
EOC
fakeroot dpkg-deb -Zgzip -z6 --build "$P" "$D/${N}_${VER}_amd64.deb" >/dev/null

# self-extracting per-user installer
S="$D/${N}-${VER}-linux-x86_64-install.sh"
cat > "$S" <<'EOS'
#!/bin/sh
# KÄSEKRIEG: RAT OPS per-user installer. Usage: sh installer.sh [--uninstall]
set -e
DEST="$HOME/.local/share/kasekrieg-ratops"; BIN="$HOME/.local/bin/kasekrieg-ratops"
APP="$HOME/.local/share/applications/kasekrieg-ratops.desktop"
if [ "${1:-}" = "--uninstall" ]; then rm -rf "$DEST"; rm -f "$BIN" "$APP"; echo "uninstalled"; exit 0; fi
mkdir -p "$DEST" "$HOME/.local/bin" "$HOME/.local/share/applications"
LINE=$(awk '/^__PAYLOAD_BELOW__$/ {print NR + 1; exit 0}' "$0")
tail -n +"$LINE" "$0" | tar -xzf - -C "$DEST" --strip-components=1
ln -sf "$DEST/kasekrieg-ratops.sh" "$BIN"
printf '[Desktop Entry]\nType=Application\nName=KÄSEKRIEG: RAT OPS\nExec=%s/kasekrieg-ratops.sh\nIcon=%s/kasekrieg-ratops.png\nTerminal=false\nCategories=Game;ActionGame;\n' "$DEST" "$DEST" > "$APP"
echo "Installed to $DEST. Run: kasekrieg-ratops"
exit 0
__PAYLOAD_BELOW__
EOS
cat "$D/${N}-${VER}-linux-x86_64.tar.gz" >> "$S"; chmod +x "$S"
ls -la "$D"
