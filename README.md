# game-factory

Reusable tooling for building games with a swarm of AI coding agents: a task manifest and live dashboard, Godot test/screenshot/build scripts, asset fetching, procedural audio and Blender model generators, and notes on what went wrong so the next game goes faster.

Extracted from **KÄSEKRIEG: RAT OPS** (Godot 4.7 third-person shooter): https://github.com/bsommers/callofcheeseduty-ratops

## Layout
| Path | What |
|---|---|
| `bin/factory` | `factory new <dir> "<Title>"` scaffolds a game repo; `factory sync <dir>` refreshes its tooling |
| `swarm/` | Agent swarm tracker: `bin/swarm-plan.mjs` (manifest → per-agent prompts), `bin/track.mjs` (progress events), `dashboard/server.mjs` (live dashboard, serves `out/` and `dist/` images, follows symlinks), `PLAYBOOK.md`, `PROTOCOL.md`, templates |
| `tools/` | `godot.sh`, `install_godot.sh`, `run_tests.sh` (headless Godot tests), `shot.sh` (GPU screenshots in a private Xvfb, no desktop window), `build.sh` (export linux/windows/macos), `qa.sh`, `fetch_assets.mjs` (CC0 Poly Haven/ambientCG fetcher) |
| `templates/godot-project/` | Autoloads (events/settings/game/defs), test runner and screenshot harness, `project.godot` |
| `examples/ratops/` | Real specimens: SWARM.md manifest, procedural Blender character/prop builders, audio synth, level converter |
| `docs/LEARNINGS.md` | Mistakes and fixes from the first build |
| `docs/NEXT-GAME.md` | Plan for an outdoor/open-world follow-up |

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
