# Standalone packaging (`package.standalone`)

Capabilities (code: `factory-core/package/`, CLI: `node tools/package-standalone/cli.mjs`):

- `package.shells {project?}`: every shell, project kinds, availability probes on this machine, size/tradeoff notes.
- `package.standalone {project, shell?, platform?, version?, out?, dryRun?, network?}` returns `{artifacts:[{path,sha256,bytes}], plan}`.

Default shell by kind: web = neutralino, rust = rust, go = go, godot = godot, python = python. Platform is `<os>-<arch>` (`linux-x64`, `win-x64`, `mac-arm64`, ...), default the host. Output defaults to `<project>/dist/standalone`; generated shell projects go to `<out>/.build/<shell>/` and the project is never modified (web builds still write the project's own `dist/`).

| Shell | Kinds | Needs | Size |
|---|---|---|---|
| neutralino | web | node, project `tools/package-desktop.mjs` | ~1 MB (measured, see BUILD-WEB-DESKTOP.md) |
| tauri v2 | web | cargo, webkit2gtk-4.1 (Linux), host OS only | estimate only, not measured |
| electron | web | network, npx | estimate 85-110 MB, not measured |
| wails | web, go | go, wails CLI | not measured |
| rust / go | rust / go | cargo / go | not measured |
| godot | godot | `tools/build.sh` + export templates | not measured |
| python | python | PyInstaller (Nuitka plan offered) | not measured |

Rules: all commands are `execFile` arrays; `CARGO_TARGET_DIR` defaults to `/datanapps/cargo-target/<name>`; archives are `<name>-<ver>-<os>-<arch>.{tar.gz|zip}` with fixed mtimes plus `SHA256SUMS`. A missing toolchain yields `plan.status = "SKIP"` with `plan.skip` giving the reason, never a silent pass. Nothing is downloaded unless it is checksum-pinned (Neutralino, inside package-desktop.mjs); Electron needs explicit `network:true` because its checksum cannot be verified offline. Signing and notarization stay manual, secret-gated release steps.

Tauri: the generated `src-tauri/` (minimal `core:default` capability, placeholder icon) has not been compiled in this repo yet; do not quote Tauri sizes until measured.
