---
name: rust-bevy-fps
description: Build a Rust + Bevy 0.20 first-person game with a contract-first module layout and a parallel agent swarm (one Plugin per module), Solari RT with raster fallback. Use when: rust fps, bevy, bevy fps, bevy 0.20, rust 3d game, first person shooter rust.
---

# rust-bevy-fps

## When to use
A native 3D first-person game in Rust + Bevy 0.20 built by several agents at once. Born from Cheesemageddon (3 levels, boss, rescue, RT).

## Steps
1. Copy `templates/bevy-fps-project` to the game dir; replace `__NAME__` / `__SLUG__`. Set `CARGO_TARGET_DIR=/datanapps/cargo-target/<slug>` (never /tmp). Rust >= 1.95.
2. Write the contract first: `src/core.rs` holds states, `LevelId`, marker components, `Message` types, `LevelSpec`, `SpawnSet {Level, Entities, Post}`, HUD snapshot resources, `FreshStart`. Only the integrator edits it.
3. One `pub struct <X>Plugin;` per module (render, levels/*, entities/*, ui, audio, flow). Modules talk only through core.rs messages/resources. Level plugins early-return unless `*level == their LevelId`.
4. Edit `docs/swarm/SWARM.md` (task, model tier, `owns:` paths that never overlap), then `swarm plan` / `swarm next`. Agents report with `track.mjs <id> start|progress|done|failed`. Cap at 4 concurrent; cargo builds serialize on the target-dir lock, so split work by file, not by waiting.
5. Integrator wires `main.rs` + `flow.rs` after each wave; run `cargo check` then `cargo test` (pure-math tests for movement, AI, phase logic).
6. Verify visually with `tools/shot_bevy.sh` (skill headless-gpu-screenshots) for every level; fix, repeat.

## Gotchas
- Bevy 0.20 renames and traps are in `docs/LEARNINGS-CHEESEMAGEDDON.md` (WorldAssetRoot, Message API, B0001, asset_root(), Solari deferred).
- Pause must not rebuild the world: gate the SpawnSet chain with `FreshStart` and flip it in `SpawnSet::Post`.
- Teardown despawns everything tagged `LevelEntity` (plus Player/Enemy markers) with `try_despawn`.
- Do not give every agent opus: planning/research agents sonnet, mechanical haiku (skill choose-model-per-agent).

## Verification
`cargo check` clean, `cargo test` green, `--level N --shot out/n.png` produces a non-blank image per level, `--rt` either runs or logs the raster fallback warning.

Suggested model: sonnet (cost medium).
