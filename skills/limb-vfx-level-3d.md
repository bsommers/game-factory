---
name: limb-vfx-level-3d
description: Author 3D limb damage and dismemberment rules, VFX presets and level layouts: validate, simulate or sample, and bake level data.
triggers: [limb damage, dismemberment, vfx, 3d vfx, particle effects 3d, level layout, level bake, arena level, 3d level, hit effects]
needs: [Node 22+]
outputs: [src/limb/*.json, src/vfx/*.json, src/levels/*.json]
model: sonnet
cost: medium
capabilities: [limb3d.validate, limb3d.simulate, vfx3d.validate, vfx3d.sample, level3d.validate, level3d.bake, nav.bake]
---
# limb-vfx-level-3d

## When to use
Author 3D limb damage and dismemberment rules, VFX presets and level layouts: validate, simulate or sample, and bake level data.

## Steps
1. `limb3d.validate {config}` then `limb3d.simulate` for hit and sever outcomes.
2. `vfx3d.validate {config}` then `vfx3d.sample {config, t}` to inspect particles over time.
3. `level3d.validate {config}` then `level3d.bake` to produce level data; `nav.bake` for navigation.

## Gotchas
- Budgets (particles, limbs, colliders) are enforced; trim the config rather than raising limits.
- Level bakes are deterministic; commit the config, not stale output.

## Verification
validate calls ok; vfx3d.sample at two times differs; level3d.bake output passes level3d.validate.
