# Learnings from building RAT OPS with an agent swarm (Godot 4.7 + Blender)

Real mistakes and fixes from the first game built with this factory. Generic swarm rules are in `swarm/PLAYBOOK.md`.

## Orchestration
- **In-process subagents die with the orchestrator session.** After a crash/restart, check which agents are alive (process cwd, `.tracker/events/*.jsonl` timestamps) and respawn with the same one-line prompt; agents resume from `docs/swarm/progress/<id>.md`.
- **Cap at 4 concurrent agents.** Finished modules per usage window is the metric, not parallelism.
- **Model tiers:** opus for the product-defining pieces (character models, controller, AI, shaders); sonnet for UI, audio, props, integration, QA, build; haiku for mechanical edits.
- **Add manifest rows as you go.** Define the next agent in `SWARM.md`, regenerate the plan, then launch. Drop tasks that earlier agents already cover (an `anim-rig-clips` task was redundant because model agents shipped their own clips).
- **Integration is its own agent, staged.** Stage A wires what exists; stage B waits for the model/AI reports. Every module's "Requests" section becomes the integration checklist.
- **A QA bot agent that only reports bugs** (does not fix other modules' files) gives the polish wave a ranked list.

## Shell and tooling traps
- `pkill -f <pattern>` kills your own shell when your command line contains the pattern. Use `pgrep -f '[x]pattern'` with PIDs, or start/stop via pid files.
- **Symlinked output dirs break path checks.** When `out/` moves to a bigger disk (symlink), a dashboard that compares `realpath` against `ROOT/out` returns 403 and every image looks black. Compare against the resolved base dirs.
- Disk was 96% full: put `assets-cache/ out/ build/ dist/ godot-export-templates/` on another disk via symlinks from day one.
- **Never open windows on the user's desktop.** `tools/shot.sh` renders real GPU frames in a private Xvfb with `MESA_VK_WSI_DEBUG=sw` so rendering stays on the GPU (RADV) while presentation is a CPU copy.
- Cold `.godot/` breaks `class_name` lookups in headless tests: run `--import` first (done in `run_tests.sh`).

## Godot specifics
- Godot imports WAV as QOA on some setups: compute loop ends from `AudioStream.get_length() * mix_rate`, not `data.size()/2`.
- Texture imports default to **mipmaps off** → shimmering walls at distance. Turn them on for all albedo/normal imports.
- Model facing: Blender export faces -Z in Godot; player code that rotates by PI double-flips. Decide the facing convention in the architecture contract.
- Headshot multipliers: apply in exactly one place (weapon OR enemy), not both.
- Autoloads that own audio must not also be instanced as scenes (double playback). One owner.
- `Settings.get_value` logging errors on unknown keys: register defaults for every key UI writes.
- Dark levels: the level builder's light energies were far too low for Forward+ with tonemapping; own a data-driven look rig (WorldEnvironment per level) from day one.

## Assets and models
- Procedural Blender builders (`hero.py`, `rats.py`, `props.py`) get a coherent, rigged, budgeted result, but "photoreal characters" are limited without sculpted/scanned sources: plan for CC0 bases or a sculpting pass for hero shots.
- Material slot names are the contract between model authors and the shader library (`fur`, `skin`, `cheese`, ...).
- Keep per-model tri budgets and a shared humanoid armature so one set of clips retargets.
- CC0 sources that worked headless: Poly Haven API, ambientCG. kenney/opengameart/poly.pizza returned 403 to scripted fetches.

## Checks agents can't do
- Agents can't listen to audio or judge feel. They validate peaks/RMS/LUFS and spectrograms; a human must review sound and gameplay feel.

## Packaging and printing (from RAT OPS)
- Trim export packs (drop unused texture sets, compress) — 649→196 MB Linux; Windows/macOS packages ~190–220 MB.
- Windows VM: headless boot test only unless autologon is approved; installer's uninstall may leave the folder behind.
- Print export: re-import OBJs headless to check manifold + volume; thin rest-pose limbs (boss) fail wall thickness — export a clean rest pose.
- Don't rebuild a model while verify runs (files vanish briefly).

## Interactive Blender 5.0+ GUI & Print QA (from Operation Dumb Bunny)
- **macOS Seatbelt sandbox crashes Blender** (`blender.crash.txt` on Metal/WindowServer). Launch Blender once outside the sandbox with `tools/blender_ipc/live_bridge.py`, then let sandboxed agents drive it via atomic file IPC (`tools/blender_ipc/ipc_client.py`).
- **Blender 5.0 API breaks 3.x/4.x scripts:** use `bpy.ops.wm.obj_export` and `bpy.ops.wm.stl_export(..., global_scale=1000.0)` (meters → mm); `Principled BSDF` sockets are `'Specular IOR Level'`, `'Sheen Weight'`, `'Coat Weight'`; `mesh.use_auto_smooth` was removed (set `poly.use_smooth = True`).
- **Mirror + Bisect before Voxel Remesh:** running Mirror+Bisect *after* Voxel Remesh leaves non-manifold / open edges along `X=0`. Apply Mirror+Bisect *before* Voxel Remesh and strip tiny detached specks by keeping only the largest connected shell; verify with `tools/print/stl_verify.py`.
- **Keep turntable orbit off by default:** continuous `bpy.app.timers` camera orbiting fights the user's mouse when parked — enable orbit only on explicit request.
