---
name: export-3d-models
description: Generate, convert, inspect and print-check 3D models (STL, OBJ+MTL, 3MF, GLB/glTF, PLY) for 3D printing, Blender and game engines.
triggers: [3d print, 3d printing, print, stl, obj, 3mf, glb, gltf, ply, blender, mesh, model, export model, convert model, manifold, watertight, slicer, figurine, miniature, diorama, mesh export]
needs: [Node 22+, optional Blender for import checks]
outputs: [model files (.stl .obj .mtl .3mf .glb .gltf .ply), print-readiness report]
model: haiku
cost: low
capabilities: [models.formats, models.generate, models.convert, models.inspect, models.verify, models.print-prep, models.blender-check]
---
# Export 3D models

## When to use
You need geometry as files: printable STL/3MF, Blender-ready OBJ/GLB, or engine assets, from a recipe of primitives or from an existing mesh.

## Steps
1. See formats, units and axes: `models.formats {}` (print files are mm, Z up; glTF is metres, Y up).
2. Generate from a JSON recipe: `models.generate {recipe, out, formats: ["stl","obj","glb","3mf"]}`; or convert an existing file: `models.convert {input, out, format}`.
3. Check: `models.inspect {input}` (bounds, triangles, volume, manifold) and `models.verify {input, bed: {x,y,z}}` (print readiness).
4. Prepare for printing: `models.print-prep {input, out, ...}` (drop to bed, scale or fit, optional plinth).
5. Confirm Blender opens it: `models.blender-check {files: [...]}` (3MF has no native Blender importer; the check uses a fallback parser).

## Notes
Library source: `src/lib/mesh.js`, `src/lib/mesh-io.js` (also usable in-game). See `docs/MODELS.md` and `docs/PRINTING.md`.

## Gotchas
- Units and axes differ per format: STL/OBJ/3MF/PLY are written in millimetres, Z up; GLB/glTF default to metres, Y up (override with `units`/`up`).
- Blender's OBJ importer defaults to Y-up, so a Z-up OBJ looks rotated unless imported with up = Y.
- `models.generate` does not auto-weld primitives (uv seams stay); validation and 3MF weld by position. There are no boolean ops: parts are merged shells, so overlapping parts show as extra shells in `models.verify` (a warning).
- `minWall` is a sampled estimate, not a proof; check thin features in the slicer.

## Verification
`models.verify {input, bed}` must report `printReady: true` (watertight, positive volume, no degenerate faces; single shell is a warning). `models.blender-check` should report the same triangle count, bounds and manifold result for every format.
