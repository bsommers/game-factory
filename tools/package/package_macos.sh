#!/bin/sh
# usage: tools/package_macos.sh [--no-build]
# Exports the macOS zip, tests it on the Mac (ad-hoc sign, short launch, log, screenshot), builds a .dmg there,
# pulls it to dist/. Env: MAC_HOST (default bill@bigmac.local; user@macbuild.local also was valid earlier).
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MAC_HOST="${MAC_HOST:-bill@bigmac.local}"
[ "${1:-}" = "--no-build" ] || "$ROOT/tools/build.sh" macos
ZIP="$ROOT/build/macos/KasekriegRatOps.zip"
[ -f "$ZIP" ] || { echo "missing $ZIP" >&2; exit 1; }
R='$HOME/build/ratops-scratch'
ssh -o BatchMode=yes "$MAC_HOST" "rm -rf $R && mkdir -p $R"
scp -q "$ZIP" "$MAC_HOST:build/ratops-scratch/"
ssh "$MAC_HOST" "sh -s" < "$ROOT/tools/mac/remote_test.sh"
mkdir -p "$ROOT/dist" "$ROOT/out/mac"
scp -q "$MAC_HOST:build/ratops-scratch/KasekriegRatOps-macos.dmg" "$ROOT/dist/"
scp -q "$MAC_HOST:build/ratops-scratch/run.log" "$ROOT/out/mac/run.log" || true
scp -q "$MAC_HOST:build/ratops-scratch/shot.png" "$ROOT/out/mac/shot.png" || true
ssh "$MAC_HOST" "rm -rf $R"
ls -la "$ROOT/dist/KasekriegRatOps-macos.dmg"
