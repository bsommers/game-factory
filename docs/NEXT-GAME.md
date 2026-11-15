# Next game in the franchise: outdoor / open world

Direction (from the owner): an outdoor or open-world follow-up. Same cat-vs-rats cheese-war universe, "cute but edgy".

## What the factory needs that RAT OPS did not
| Need | Plan |
|---|---|
| Large terrain | Godot heightmap terrain (Terrain3D addon is MIT, or custom clipmap mesh) with splat-map PBR layers from `fetch_assets.mjs`; `tools/blender/` replaced by a `terrain-gen` agent (noise + erosion in Python/numpy, export heightmaps/splatmaps). |
| Streaming | Chunked world (e.g. 128 m tiles) loaded around the player on a worker thread; HLOD/impostors beyond ~300 m. Agent: `world-streaming`. |
| Vegetation and props at scale | MultiMesh scatter driven by splatmaps/biome masks, wind shader, LODs; agent: `scatter-vegetation`. |
| Sky and weather | Day/night cycle, volumetric clouds/fog, rain/snow, wet-surface blend (shaders already have wet blends). Extend `look-dev` into a `sky-weather` data-driven rig. |
| Traversal | Vehicles/mounts (cheese-wagon? mouse-bike), climbing, gliding, fast travel. |
| Mission structure | Replace level JSON with a quest/POI graph: outposts to liberate, convoys, boss lairs; reuse enemy AI, add patrols/factions/alert propagation. |
| Navigation | Navmesh baked per streamed chunk (Godot navmesh chunks) or waypoint graph for long range. |
| Performance | Target 60 fps: occlusion, GPU instancing, shadow cascades tuned for long view distance; perf agent with frame-time budget per biome. |
| Audio | Reuse `gen_audio.py` voice/music generator; add ambience per biome and wind/water. |

## Suggested waves (4 agents at a time)
1. contract: ARCHITECTURE.md (world scale, chunking, biome list, coordinate conventions, facing -Z), shared defs, `world-core` (project, chunk manager, shot tooling).
2. terrain-gen, scatter-vegetation, sky-weather, reuse hero/rats models (pull in as assets; add new faction + vehicle models).
3. player (reuse controller; add sprint/climb/vehicle), enemy-ai (patrol/faction), mission system, UI (map/minimap, quest log).
4. integration, look-dev, QA bot (traverse A→B, no stuck points), perf.
5. builds + installers + site (`tools/build.sh`), print-models for iconic set pieces.

## Reuse list from RAT OPS
Hero + rat rigs and clips, fur/cheese/skin shaders, UI theme and menus, audio generator/manager, player controller, enemy AI, QA bot, build/export pipeline, 3D-print exporter.
