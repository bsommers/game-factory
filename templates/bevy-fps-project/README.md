# __NAME__

Rust + Bevy 0.20 first-person starter distilled from Cheesemageddon. Needs Rust >= 1.95.

```
export CARGO_TARGET_DIR=/datanapps/cargo-target/__SLUG__   # never /tmp
cargo run --release                       # raster (SSAO/TAA/bloom/fog)
cargo run --release -- --rt               # Solari ray tracing (RTX 20+/RDNA2+); falls back to raster if unsupported
cargo run --release -- --level 2 --shot out/l2.png    # skip menu, screenshot, exit
tools/shot_bevy.sh 1 out/l1.png           # same, in a private Xvfb (no desktop window)
```

## Layout (one Plugin per module, `core.rs` is the only shared contract)
| File | Owner | Notes |
|---|---|---|
| `src/core.rs` | integrator only | states, markers, messages, `LevelSpec`, `SpawnSet`, `FreshStart` |
| `src/flow.rs` | integrator | state/level lifecycle, teardown, `--level` |
| `src/render/` | render agent | look preset, Solari/raster stack, `--shot` |
| `src/level.rs` | level agent(s) | builds world in `SpawnSet::Level`, tags `LevelEntity` |
| `src/player.rs` | gameplay agent | controller (add weapon here or in its own module) |
| `src/ui.rs` | ui agent | menu/pause/HUD from snapshot resources |

See `docs/swarm/SWARM.md` for the agent manifest and skills `rust-bevy-fps`, `headless-gpu-screenshots`, `photoreal-pbr-levels` in the game-factory.
