# Building and packaging CATXZZON

Zero runtime dependencies stay true for the game itself. Build-time tools: Node 22+, `npx` (fetches `esbuild@0.25` on demand, nothing installed globally), `zip`/`unzip`/`tar`. Packaging downloads one pinned Neutralinojs release zip into `assets-cache/` (gitignored) and checks its SHA-256.

## Commands

| Command | Result |
|---|---|
| `node tools/build-web.mjs` | `dist/web/` (index.html + `app.js` + `style.css`, minified) and `dist/catxzzon.html` (everything inlined, plays from `file://`). Prints sizes and gzip. If esbuild is unavailable it warns and copies `src/` unbundled (no single file then). |
| `node tools/package-desktop.mjs [--platform linux\|win\|mac\|all] [--version X] [--skip-web] [--out dir]` | `dist/desktop/catxzzon-<ver>-<os>-<arch>.{tar.gz,zip}` + `SHA256SUMS` |
| `tools/smoke_web.sh $PWD/dist/catxzzon.html` | loads the single file via `file://` in headless Chrome, fails on any console error (pass an absolute path) |
| `desktop/smoke_linux.sh [tarball]` | unpacks the shipped tarball in a temp dir; checks the embedded server serves the game from `resources.neu`, then runs the native window under Xvfb |
| `desktop/smoke_windows.sh [zip]` | same idea on the Windows VM (`~/src/infra/win-devvm`); prints `SKIP` if the VM is unreachable |
| `node --test test/pkg-build.test.mjs` | unit/integration tests for the above |

Notes: the game loads modules with `import(variable)` (`src/main.js`, `src/render/renderer.js`), which no bundler can follow. `build-web.mjs` stages a copy of `src/` in which every such call first consults a map of all modules (bundled statically), keyed by path relative to `src/`. Template-literal imports (`registry.js`) are handled by esbuild itself.

## Desktop design

- Neutralinojs 6.10.0: a ~3 MB prebuilt native binary that uses the OS webview. We never run `neu`; `resources.neu` (an asar archive holding the web build, `neutralino.config.json`, the pinned client lib 6.7.0, the F11/close shim `desktop/shell.js` and a 256 px icon rendered from the cat art with the PNG encoder in `tools/sheet.mjs`) is written by `makeAsar()`.
- Window: 960x540, resizable (min 480x270), title CATXZZON, icon, **F11** toggles fullscreen, closing the window exits the process. Native API allow-list is minimal (`app.exit`, fullscreen calls, events).
- Browser fallback (embedded static server + default browser) is Neutralino's `--mode=browser`: Linux `./catxzzon.sh --browser` (the launcher also falls back automatically when webkit2gtk-4.1 is missing), Windows `catxzzon-browser.cmd`, macOS `catxzzon-browser.command`.
- Archives are reproducible-ish (fixed mtimes, sorted tar, no owner). macOS gets a `CATXZZON.app` bundle; binaries are unsigned (Gatekeeper: right-click, Open). Windows needs the Edge WebView2 runtime (preinstalled on Windows 11 and current Windows 10); Linux needs `libwebkit2gtk-4.1-0` + GTK3.

## Size comparison (approximate)

| | Download | Unpacked | Engine |
|---|---|---|---|
| This project, Neutralinojs (measured) | linux 1.1 MB, win 1.2 MB, mac 1.0 MB | ~3 MB binary + 0.1 MB resources | OS webview |
| Tauri (typical) | 3-8 MB | 5-15 MB | OS webview, Rust |
| Electron (typical, v3x+) | 85-110 MB | 250-300 MB | bundled Chromium + Node |
| Single-file `catxzzon.html` (measured) | see `build-web.mjs` output (about 80 KB gzip at time of writing) | same | your browser |

Tradeoffs: Neutralino is tiny and needs no runtime install on Windows 11/macOS, but it depends on the system webview (Linux users must have webkit2gtk; rendering differs slightly between WebKit and Chromium; audio/canvas performance is whatever the OS webview offers). Electron gives one consistent Chromium and a rich Node API at roughly 50-100x the size; this game needs neither. The single HTML file is the zero-install fallback.

## Release

Pushing a tag `v*` runs `.github/workflows/release.yml` (first-party actions only): tests, web build, `smoke_web.sh`, desktop packaging, `smoke_linux.sh`, then `gh release create` with the single-file HTML, all archives and `SHA256SUMS`. Windows exe smoke is done locally with `desktop/smoke_windows.sh` before tagging; hosted runners do not run it.
