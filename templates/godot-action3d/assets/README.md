# assets/

Drop Meshy/Blender `.glb` models in `assets/models/` (validate first with `bin/factory anim inspect <file>`).
Godot imports them on first open; verify with `bin/factory godot import-check --project . --glb assets/models/hero.glb`.
Keep one canonical humanoid rig per character; share clips through an AnimationLibrary.
Do not commit regenerated binaries; commit the manifest and hashes (see docs/PLAN-3D-ACTION.md).
