# macOS build (unsigned, universal)

    tools/package_macos.sh [--no-build]    # export zip -> test on the Mac over ssh -> dist/KasekriegRatOps-macos.dmg

Host: `MAC_HOST` (default `bill@bigmac.local`; `user@macbuild.local` did not resolve on 2026-11-14). Scratch: `~/build/ratops-scratch` on the Mac (removed afterwards).
`tools/mac/remote_test.sh` runs on the Mac: unzip, `xattr -cr`, `codesign --force --deep -s -`, launch `--rendering-driver metal --quit-after 600 --verbose`, screenshot attempt, `hdiutil create ... -format UDZO`.

Outputs: `build/macos/KasekriegRatOps.zip` (~208 MB), `dist/KasekriegRatOps-macos.dmg` (~221 MB; PCK is not embedded), log in `out/mac/run.log`.

## Opening an unsigned app (Gatekeeper)
Not notarised. Users either: run `xattr -dr com.apple.quarantine "KÄSEKRIEG- RAT OPS.app"` then open; or right-click > Open > Open;
or on macOS 15+ try to open once, then System Settings > Privacy & Security > "Open Anyway". Copy the app out of the dmg first.
Distribution without warnings needs an Apple Developer ID plus `codesign/identity` and `notarization/*` in the preset.

## Known
- `codesign --verify --deep --strict` reports "a sealed resource is missing or invalid" (non-ASCII app name / 650 MB PCK in Resources); the app still launches. Not investigated further.
- `screencapture` over ssh fails ("could not create image from display"); needs a GUI-session grant, so no screenshot.
