# Godot (3D action path)

Pinned install (task A0, 2026-11-22):
- Version: **4.7.2-stable** (`4.7.2.stable.official.ed1daf0bf`), standard (non-mono) editor, Linux x86_64.
- Path: `/datanapps/tools/godot/4.7.2-stable/Godot_v4.7.2-stable_linux.x86_64` (not on PATH; export templates not installed yet).
- Source: https://github.com/godotengine/godot/releases/tag/4.7.2-stable; zip verified against the release's `SHA512-SUMS.txt` (`sha512sum -c`: OK).

Install elsewhere: download `Godot_v<ver>_linux.x86_64.zip` and `SHA512-SUMS.txt` from the release, `grep linux.x86_64.zip SHA512-SUMS.txt | grep -v mono | sha512sum -c -`, unzip under `/datanapps/tools/godot/<ver>/`. `godot.detect` finds it via `GODOT_BIN`, PATH, `$GODOT_TOOLS`, `/datanapps/tools/godot/*`, `~/.local/share/godot`.

## Capabilities
| name | what |
|---|---|
| `godot.detect` | locate binary, version, xvfb/display availability |
| `godot.test` | `--headless --script res://tests/run_all.gd`; parses `PASS/FAIL` + `RESULT n passed, m failed`; `TASK_FAILED` on any failure |
| `godot.shot` | render a scene to PNG (real renderer, not `--headless`) |
| `godot.import-check` | headless-import a `.glb`, report skeletons, bones, animations, meshes |

CLI: `bin/factory godot test --project <dir> --json` (same on HTTP `POST /api/godot.test`, MCP `godot_test`).

## Screenshots on Linux
`--headless` uses the dummy renderer and cannot render. `godot.shot` runs `xvfb-run -a godot --rendering-driver opengl3 ...` when no `DISPLAY` is set, which uses Mesa llvmpipe (software GL) and needs no GPU. Requires `xvfb` (`apt install xvfb`). Verified here: OpenGL 4.5 Mesa llvmpipe. Scenes using Forward+ features still render under the Compatibility driver but look simpler (no SDFGI/SSAO).

## Template
`templates/godot-action3d/`: project.godot (Jolt, 60 Hz, WASD+jump), `scenes/{main,player,camera_rig}.tscn`, `scripts/`, `assets/README.md`, `tests/run_all.gd` (runner) + `test_*.gd` (extend `res://tests/test_base.gd`; no class_name so no editor import needed). Replace `__NAME__` in project.godot when copying.

## Export (`godot.export-templates`, `godot.export`)
- `godot.export-templates` reports whether templates for the installed version exist (`~/.local/share/godot/export_templates/4.7.2.stable`; override root with `GODOT_TEMPLATES_DIR`). Report-only by default. `install:true` downloads the official `Godot_v4.7.2-stable_export_templates.tpz` (~1.2 GB) from the GitHub release and unpacks it; `fromFile:<.tpz>` unpacks a local archive instead (no network; used by tests). The download itself is never exercised by tests. Keep the big files off `/` and `/tmp` (symlink the directory to `/datanapps`). The archive's `version.txt` must match.
- `godot.export {project, preset}` runs `--headless --export-release <preset>`; returns `NOT_FOUND` with next steps when templates are missing. `templates/godot-action3d/export_presets.cfg` ships presets `Linux x86_64` (embedded PCK, to `build/linux/game.x86_64`) and `Web` (single-thread, no extensions; `build/web/index.html`); tests/ and *.md are excluded.
- Status (2026-11-22): templates 4.7.2.stable were present on this machine; a real Linux export of the template succeeded (`test/godot-export.test.mjs`) and the binary boots headless. The test skips (not fails) when templates are absent. The Web preset also exported manually via the CLI (not in the suite).
