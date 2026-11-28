# Building, packaging and installing a web game

Every game from `factory new <dir> "<Title>" --web` ships build, packaging and installer tooling. It is generic: names come from `package.json` (`name`, `version`, optional `game: {slug,title,appId,icon}` block) and the `<title>` in `index.html` (`tools/project-info.mjs`).

| Command | Result |
|---|---|
| `npm run build` | `dist/web/` (minified static site), `dist/<slug>.html` (one file, plays from `file://`), `dist/<slug>-<ver>-web.zip` (itch.io / static hosting). Needs `npx` for esbuild; without it you get an unbundled copy and no single file. |
| `npm run smoke:web` | loads `dist/<slug>.html` in headless Chrome and fails on any console error |
| `npm run package` | `dist/desktop/<slug>-<ver>-linux-x64.tar.gz` + `SHA256SUMS` (Neutralino: ~1 MB, OS webview) |
| `npm run package:all` | adds `win-x64.zip`, `mac-x64.zip`, `mac-arm64.zip` (cross-built; just the prebuilt binary plus `resources.neu`) |
| `npm run smoke:desktop` | unpacks the shipped Linux tarball, checks the embedded server, runs the window under Xvfb |
| `factory call package.standalone '{"project":"<dir>"}'` | same packaging through the registry, plus other shells (tauri, electron, wails); `package.shells` lists them |

Each archive carries a launcher and an installer:

| OS | Launch | Install | Uninstall |
|---|---|---|---|
| Linux | `./<slug>.sh` (`--browser` forces the browser) | `./install.sh [--prefix DIR]`: app dir, `<slug>` command, menu entry, icon under `~/.local` | `./install.sh --uninstall` |
| macOS | open `<Title>.app` (unsigned: right-click > Open) | `install.command` copies to `~/Applications` | delete the app |
| Windows | `<slug>.exe` (needs WebView2) | `install.ps1`: `%LOCALAPPDATA%\Programs\<slug>` + Start Menu shortcut | `install.ps1 -Uninstall` |

Status: On Linux, `npm run build`, `package`, `smoke:web`, `smoke:desktop` and `install.sh` are covered by `test/web-pkg.test.mjs` and manual runs. `npm run package:all` also **builds** the Windows and macOS archives (zip + launchers + installers), but those artifacts are **not executed or smoke-tested** on Windows or macOS in CI or factory tests — only produced and checksummed. Treat win/mac install scripts (`install.ps1`, `install.command`) as ship-as-built, verify-on-target-OS. Linux `smoke_windows.sh` against a win-devvm is optional. Signing and notarization are manual, secret-gated release steps. The first package downloads Neutralino once into `assets-cache/` (gitignored, SHA-256 pinned).

Refresh an existing game's tooling with `factory sync <dir>`. Use a custom icon by adding `assets/icon.png` (256x256 PNG); otherwise a flat tile coloured from the slug is generated.
