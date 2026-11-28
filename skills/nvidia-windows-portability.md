---
name: nvidia-windows-portability
description: Make a Rust/Bevy (wgpu) game run on NVIDIA, AMD and Windows 11 without Linux-only assumptions, with ray tracing as an opt-in that degrades to raster.
triggers: [nvidia, windows 11, windows build, dx12, vulkan, portability, hybrid laptop, rtx, amd gpu, platforms, cross platform gpu]
needs: [rustup stable 1.95+, MSVC build tools on Windows]
outputs: [docs/PLATFORMS.md]
model: sonnet
cost: low
capabilities: []
---
# nvidia-windows-portability

## When to use
The dev box is Linux/AMD but the player has an NVIDIA laptop with Windows 11.

## Steps
1. Do not force a wgpu backend in code. `WGPU_BACKEND=vulkan` is only for headless Linux screenshots (kept in `tools/shot_bevy.sh`). On Windows wgpu picks DX12 or Vulkan.
2. Default look is plain raster PBR (SSAO, TAA, bloom, fog): any GPU. Ray tracing is opt-in (`--rt`, F1 toggle) and needs wgpu ray-query + acceleration-structure features (RTX 20+, RDNA2+, recent drivers). If missing, log a warning and stay raster, never panic (`detect_rt` in the template).
3. Never hard-code adapter names/indices: use `WGPU_ADAPTER_NAME` / `WGPU_POWER_PREF=high` for the dGPU on hybrid laptops.
4. No Linux-only deps (audio via Bevy/rodio, gamepad via gilrs). `asset_root()` finds `assets/` in cwd or next to Cargo.toml so the exe works from anywhere.
5. Write `docs/PLATFORMS.md` plus a laptop test checklist: `cargo run --release -- --level 1`, each level, then `--rt`; report the AdapterInfo log line, fps and any `ERROR bevy_render`. Windows VM smoke test: `tools/smoke_windows.sh`.

## Gotchas
- `rustup default stable` and Rust >= 1.95 on Windows too.
- Try `--rt` with `WGPU_BACKEND=vulkan` first on NVIDIA/Windows, then dx12.
- Not yet tested on real NVIDIA/Windows hardware when this skill was written; treat the checklist as pending.

## Verification
Checklist run on the target laptop reports adapter name, raster fps, and either RT ON or the logged fallback.
