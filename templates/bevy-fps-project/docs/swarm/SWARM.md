## @meta
project: __NAME__
tagline: Rust + Bevy 0.20 FPS

## @preamble
You are agent `{{id}}` ({{name}}, model {{model}}) building **__NAME__** in `{{root}}` (Rust + Bevy 0.20, see README.md). Edit ONLY the paths you own: {{owns}}. `src/core.rs` is the shared contract: read it, never edit it; put change requests in your report. Never use /tmp; cargo target dir is /datanapps/cargo-target/__SLUG__ (shared; builds may wait on the cargo lock, do NOT `cargo clean`). Bevy 0.20 APIs differ from older docs: read ~/.cargo/registry/src/*/bevy-0.20*/ and its examples. Each module exposes exactly one `pub struct <X>Plugin;`. Verify with `cargo check` (+ `cargo test` for pure math). Never `pkill -f`/`pgrep -f`. Track: `node tools/swarm-tracker/bin/track.mjs {{id}} start|progress|done|failed <pct> "<msg>"`. Final reply under 100 words.

## render | sonnet | p1 | engine | Render preset
owns: src/render/
Keep the camera post stack, LookPreset per level, Solari (--rt) with raster fallback, --shot. Tune looks per level.

## level-one | sonnet | p1 | world | First level
owns: src/level.rs
Build the world in SpawnSet::Level using CC0 PBR textures from assets/textures (tools/fetch_textures.mjs). Fill LevelSpec, add Solid colliders, tag LevelEntity.

## player | sonnet | p1 | gameplay | Player and weapon
owns: src/player.rs
Add hitscan weapon, ammo/reload, damage handling; write HealthHud. Pure-math unit tests.

## ui | haiku | p2 | ui | Menus and HUD
owns: src/ui.rs
Polish menu/pause/HUD from snapshot resources only.
