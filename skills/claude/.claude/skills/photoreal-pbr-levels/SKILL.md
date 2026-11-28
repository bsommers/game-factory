---
name: photoreal-pbr-levels
description: Skin 3D environments (desert, bunker, city) with CC0 Poly Haven PBR textures and HDRIs with per-level look presets, fog, bloom and optional ray tracing. Use when: photoreal, pbr, pbr textures, poly haven, hdri sky, fetch textures.
---

# photoreal-pbr-levels

## When to use
A 3D game needs believable environments without hand-authored art: procedural geometry (terrain, rooms, streets, props from primitives) skinned with tiling CC0 PBR sets.

## Steps
1. `node tools/fetch_textures.mjs [--config sets.json] [--res 1k|2k]` writes `assets/textures/<biome>/<name>_{color,normal,rough}.jpg`, `sky/<name>.hdr`, `MANIFEST.json` (slug, source, CC0) and `INDEX.md`. List several fallback slugs per set; slugs drift.
2. Load with `ImageLoaderSettings` sampler = repeat + anisotropic, set `uv_transform` scale per mesh so a metre of floor shows ~1 tile; normal maps are `nor_gl`. Roughness JPG goes in `perceptual_roughness` via a roughness texture or a tuned scalar.
3. One `LookPreset` per level (sun dir/colour/illuminance, ambient, fog colour+density, exposure EV100): desert ~28k lux warm, bunker ~600 lux green, city ~9k lux dusk. The render module applies it to every camera.
4. Level builder pattern: build in `SpawnSet::Level`, tag everything `LevelEntity`, add `Solid` AABBs, fill `LevelSpec` (spawns, extents). Unlit sky domes/suns need `NotShadowCaster` or they black out the level.
5. Screenshot every level (headless-gpu-screenshots) and tune exposure/fog until the image reads; compare raster vs `--rt`.

## Gotchas
- Poly Haven API worked headless; kenney/opengameart/poly.pizza returned 403 to scripts. Keep licences in MANIFEST.
- Textures add up (hundreds of MB at 2k): publish through the asset library with raised size caps (skill asset-library-extraction).
- Solari replaces shadow maps and ambient: set ambient brightness 0 and `shadow_maps_enabled=false` when RT is on.
- Dark interiors need ambient floor (120-300) in raster mode or SSAO crushes them to black.

## Verification
MANIFEST lists every set with `failed: []` (or you added slugs), each level screenshot has visible texture detail, no solid-colour floors, fog reads at distance.

Suggested model: sonnet (cost medium).
