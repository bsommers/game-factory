#!/bin/sh
# Download the Godot editor (MIT) into .tools/godot. usage: tools/install_godot.sh [version, default 4.7.2]
set -eu
V="${1:-4.7.2}"; ROOT="$(cd "$(dirname "$0")/.." && pwd)"; D="$ROOT/.tools/godot"
mkdir -p "$D"; cd "$D"
U="https://github.com/godotengine/godot/releases/download/$V-stable/Godot_v$V-stable_linux.x86_64.zip"
curl -fL -o g.zip "$U" && unzip -oq g.zip && rm g.zip && chmod +x Godot_v*_linux.x86_64
echo "installed: $(ls "$D"/Godot_v*_linux.x86_64)"
