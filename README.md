# game-factory

Reusable tooling for building games with a swarm of AI coding agents: a task manifest and live dashboard, Godot test/screenshot/build scripts, asset fetching, procedural audio and Blender model generators, and notes on what went wrong so the next game goes faster.

Extracted from **KÄSEKRIEG: RAT OPS** (Godot 4.7 third-person shooter): https://github.com/bsommers/callofcheeseduty-ratops

## Layout
| Path | What |
|---|---|
| `bin/factory` | CLI over the capability registry (`factory help`, `factory capabilities --json`, `--json` and stable exit codes everywhere); `factory new <dir> "<Title>" [--web]` scaffolds a game repo (`--web` = zero-dep browser game with the tracker; Godot otherwise); `factory sync <dir>` refreshes its tooling |
| `factory-core/` | Capability registry (styles, library/registry, guide, project, kits, swarm, docs): `{name, summary, inputSchema, outputSchema, handler}` returning `{ok,data,error,next}` |
| `api/`, `mcp/` | `factory serve --port N` (127.0.0.1 REST + OpenAPI + SSE) and `factory mcp` (stdio MCP tools + resources) generated from the registry; see `docs/SURFACES.md`, `AGENTS.md` |
| `swarm/` | Agent swarm tracker: `bin/swarm-plan.mjs` (manifest → per-agent prompts), `bin/track.mjs` (progress events), `dashboard/server.mjs` (live dashboard, serves `out/` and `dist/` images, follows symlinks), `PLAYBOOK.md`, `PROTOCOL.md`, templates |
| `tools/` | `godot.sh`, `install_godot.sh`, `run_tests.sh` (headless Godot tests), `shot.sh` (GPU screenshots in a private Xvfb, no desktop window), `build.sh` (export linux/windows/macos), `qa.sh`, `fetch_assets.mjs` (CC0 Poly Haven/ambientCG fetcher), `blender_ipc/` (interactive Blender 5.0+ live GUI IPC bridge + sandbox-safe client), `print/stl_verify.py` (binary STL watertightness, 2-manifold & bilateral symmetry QA) |
| `templates/godot-project/` | Autoloads (events/settings/game/defs), test runner and screenshot harness, `project.godot` |
| `examples/ratops/` | Real specimens: SWARM.md manifest, procedural Blender character/prop builders, audio synth, level converter |
| `docs/LEARNINGS.md` | Mistakes and fixes from the first build |
| `docs/LEARNINGS-PAWFALL.md` | Mistakes and fixes from the PawFall web-game swarm |
| `docs/NEXT-GAME.md` | Plan for an outdoor/open-world follow-up |

## Web-game extras (`factory new <dir> "<Title>" --web`)
| Tool | What |
|---|---|
| `tools/serve.mjs`, `tools/shot.mjs` | zero-dep static server; headless-Chrome screenshots/frames/key-driving via CDP |
| `tools/sheet.mjs <artModule>` | validates a PixBuf art module against `defs.artManifest()` and renders a contact-sheet PNG |
| `tools/check-imports.mjs [src]` | integration lint: every relative import resolves and every named import is really exported (catches contract drift between parallel agents) |
| `tools/contact_sheet.sh`, `tools/smoke_web.sh` | labelled contact sheet of screenshots (ImageMagick); smoke test of the shipped single-file build |
| `tools/swarm-tracker/bin/swarm-next.mjs` | scheduler: shows running/done, enforces concurrency + model-tier caps (`--cap 5 --fable 1 --opus 2`), prints the next spawn prompts |
| `templates/web-project/src/kits/` | content kits copied by `--web`: art-kit, character-kit, audio-kit, fx-kit, docs-kit (see `docs/KITS.md`) |
| `templates/web-project/src/lib/` | gameplay engines copied by `--web`: platformer-physics, hazard-kit, world-gen (+ fairness validator), autopilot-kit; tests in `test/lib/` (see its README.md) |

## Quick start
```sh
bin/factory new ~/src/fun/my-game "My Game"
cd ~/src/fun/my-game && tools/install_godot.sh && tools/run_tests.sh
# write ARCHITECTURE.md, edit docs/swarm/SWARM.md, then:
TRACKER_ROOT=$PWD node tools/swarm-tracker/bin/swarm-plan.mjs
TRACKER_ROOT=$PWD TRACKER_PORT=4790 node tools/swarm-tracker/dashboard/server.mjs   # http://127.0.0.1:4790/
```
Requires Node 18+, Godot 4.x (downloaded by `install_godot.sh`), Xvfb + a Vulkan GPU for `shot.sh`, Blender for model builders, Python 3 + numpy for audio.

## License
MIT. Textures/assets fetched by `fetch_assets.mjs` keep their own CC0 licenses.
