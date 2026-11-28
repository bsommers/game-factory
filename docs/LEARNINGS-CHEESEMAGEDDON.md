# Learnings from building Cheesemageddon (Rust + Bevy 0.20 FPS, agent swarm)

First native Rust/Bevy 3D game built with the factory: photoreal post-apocalyptic FPS (3 levels, boss, Solari ray tracing with raster fallback). Starter: `templates/bevy-fps-project`; skills `rust-bevy-fps`, `headless-gpu-screenshots`, `photoreal-pbr-levels`, `asset-library-extraction`, `nvidia-windows-portability`. Generic rules: `docs/LEARNINGS.md`, `swarm/PLAYBOOK.md`.

## Bevy 0.20 API (older docs and model memory are wrong; read `~/.cargo/registry/src/*/bevy-0.20.x/` and its examples)
- `SceneRoot` is now `WorldAssetRoot(asset_server.load("models/x.glb#Scene0"))`.
- `DirectionalLight { shadow_maps_enabled: .. }` (was `shadows_enabled`).
- Events between systems are **Messages**: `#[derive(Message)]`, `app.add_message::<T>()` once, `MessageWriter<T>` / `MessageReader<T>`, `writer.write(..)`. `AppExit` is written the same way.
- `RenderCreation::Automatic(Box<WgpuSettings>)` (boxed). Solari needs `wgpu.features |= SolariPlugins::required_wgpu_features()` before device creation.
- `TextFont { font_size: FontSize::Px(..) }` (not a bare f32); `run_if(a.or(b))` is not available on `in_state(..)` conditions, use a closure with `matches!`.
- Observers: `On<Add<Camera3d>>` with `add_observer`; `Single<&mut CursorOptions>` for cursor grab; `children![..]` macro for UI.

## ECS traps
- **B0001** (conflicting queries in one system) shows up when `Added<T>`/`With` filters overlap `&mut` access on the same component. Fix: drop the `Added<>` filter and track `(suns.count, cams.count)` in a `Local<(usize, usize)>`; re-apply only when the count changes or the resource changed (`apply_look` in the template).
- Enable the bevy **`debug`** cargo feature: system-param errors then name the systems and queries instead of an opaque panic.
- Pause must not rebuild the level: `Playing -> Paused -> Playing` re-runs `OnEnter(Playing)`. Own a `FreshStart` resource, gate the `SpawnSet` chain with `run_if(FreshStart)`, flip it in `SpawnSet::Post`, set it true on teardown. Advancing a level uses an identity `next.set(Playing)` to re-run OnEnter.
- Contract-first modules: `core.rs` (states, `LevelSpec`, `SpawnSet`, messages) edited only by the integrator; one `Plugin` per module; levels early-return unless `*level == LevelId::X`; everything a level spawns carries `LevelEntity` so teardown is one query.
- Register each Message once (two plugins calling `add_message::<T>()` is harmless but hides ownership).
- Unlit meshes (sky dome, sun disc) must get `NotShadowCaster` or the enclosing dome blocks the sun and the level is dark.

## Rendering
- **Solari (`bevy_solari`) forces the deferred renderer for the whole app.** Add `SolariPlugins` only when `--rt` is passed; otherwise raster (SSAO + TAA + bloom + volumetric fog + AgX) stays on the cheaper forward path. With RT on: ambient brightness 0, shadow maps off.
- RT needs GPU ray-query + acceleration-structure features (RTX 20+, RDNA2+). Detect via `RenderDevice::features()`; if absent warn and fall back, never panic. Flags: `--rt`, `--no-rt`, F1 toggle.
- Exposure is per-level EV100 (desert 12.5, bunker 8, city 11). Interiors need an ambient floor in raster mode.

## Runtime and environment
- **Asset paths resolve relative to the executable dir**, not the cwd; with a shared `CARGO_TARGET_DIR` nothing loads. Set `AssetPlugin { file_path: asset_root(), .. }`: cwd `assets/` if present, else `concat!(env!("CARGO_MANIFEST_DIR"), "/assets")`; env `BEVY_ASSET_ROOT` overrides.
- **Rust >= 1.95 required** by Bevy 0.20 (`rust-toolchain.toml` stable, edition 2024). First build is several minutes; use `[profile.dev.package."*"] opt-level = 3`.
- Cargo builds serialize on the target-dir lock, so many agents building at once just queue. Never `cargo clean` in a shared target dir.
- **`pkill -f` / `pgrep -f` with a pattern that appears in your own command line kills your own shell** (exit 144). Kill by PID, or use the `[x]pattern` trick. Hit again with the tracker restart script.
- **`/tmp` is a RAM-backed tmpfs** (stray cargo targets and venvs once filled it to 72 GB). Temp and build output go on `/datanapps` (`CARGO_TARGET_DIR=/datanapps/cargo-target/<game>`, `CLAUDE_CODE_TMPDIR=/datanapps/claude-tmp`).

## Headless GPU screenshots: DeviceLost in Xvfb
- Symptom: the game crashed with wgpu `DeviceLost` when run inside a private Xvfb for `--shot`.
- Resolution so far: force winit onto X11 (`env -u WAYLAND_DISPLAY XDG_SESSION_TYPE=x11`), `WGPU_BACKEND=vulkan`, `MESA_VK_WSI_DEBUG=sw` (GPU renders, CPU presents). With that, `tools/shot.sh` produced screenshots of all three levels. This is in `tools/shot_bevy.sh`.
- Honest status: the Cheesemageddon gpu-debug agent was still working when this was written (its checkpoint listed it as pending), so extra causes may exist (RT features under Xvfb, driver-specific). Treat X11 forcing as the known-good fix and check the game's `docs/CHECKPOINT.md` for newer notes. Software Vulkan (lavapipe) cannot run Solari.

## Swarm and cost
- Per-task model routing paid off: sonnet for planning/research and all gameplay modules, haiku for mechanical work (texture fetcher, lint), opus nearly never. A hook enforcing cheap models for planning subagents (override token in the prompt) kept this honest.
- Agents must not edit `core.rs`; they list needed contract changes in their report, the integrator applies them between waves.
- Track token and dollar cost per agent: `swarm/bin/tokens.mjs` feeds the dashboard panel and header totals (committed in the factory as 9e6b01b). Start it with the tracker server; copy the updated `swarm/` into sibling games to get the panel.
- Procedural assets are a good first pass: Blender-built rigged glb (`tools/build_fatniss.py`: Idle/Run/Shoot), numpy-synth audio (`tools/gen_audio.py`), Poly Haven CC0 textures (`tools/fetch_textures.mjs`). Agents cannot judge feel or sound; a human reviews.
- Meshy glb rigs arrive in odd units (cm-ish) and orientation: normalise from computed bounds after load, and look up animation clips by name/index from the glb json.
