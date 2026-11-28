# Generating and exporting 3D models

One dependency-free, deterministic mesh library (`templates/web-project/src/lib/mesh.js`, `mesh-io.js`, browser-safe, copied into every `--web` project) plus the `models.*` capabilities (CLI, HTTP, MCP, OpenAPI). The library mesh is **millimetres, Z up, counter-clockwise winding seen from outside**; units and axes convert at the file boundary.

## Formats
| format | ext | default units / up | colour | use it for |
|---|---|---|---|---|
| `stl` (binary) | .stl | mm, Z | none | 3D printing default; size = 84 + 50 x triangles bytes |
| `stl-ascii` | .stl | mm, Z | none | diffing / debugging (same file name as `stl`: pick one) |
| `3mf` | .3mf | mm, Z (unit attribute written and read) | base materials, per triangle | printing with units and colours (PrusaSlicer, Cura, Bambu). Real OPC zip, STORE method, fixed timestamps |
| `obj` (+`.mtl`) | .obj | mm, Z | Kd / d per material | Blender and DCC interchange; no unit information. Blender's importer defaults to -Z forward / Y up, so choose Y-up (`up:"Y"`) or set the axes on import |
| `glb` / `gltf` | .glb / .gltf+.bin | m, **Y up** (glTF spec) | PBR baseColor, vertex colours, uvs, normals | engines, web, AR, Blender (Blender converts Y-up on import) |
| `ply` | .ply | mm, Z | vertex rgb, face rgba | scans, vertex-colour data |

All seven are readable and writable. `up:"Y"` maps (x,y,z) to (x,z,-y); `units:"m"` scales by 0.001. glTF defaults to m + Y up, everything else to mm + Z up. 3MF reading honours the file's unit and handles components and build transforms; for deflated 3MFs from other tools the factory passes `node:zlib` (the browser-safe lib takes an optional `inflate`).

## Library
- Primitives: `box sphere icosphere cylinder cone capsule torus plane grid lathe extrude(polygon, depth, holes) heightmap`. Revolve shapes carry uvs with a duplicated seam; validation and 3MF compare vertices by position, `weld()` closes the index topology.
- Ops: `transform` (scale, then rotate in degrees, then translate; negative scale keeps outward winding) `merge mirror flipNormals recomputeNormals weld removeDegenerate bounds volume surfaceArea centerOnBed dropToZ scaleToHeight fitToBed addPlinth setMaterial orientShells`.
- `validate(mesh, {bed})` returns watertight / manifold (edge incidence incl. winding consistency), boundary and non-manifold edge counts, degenerate faces, shell count, signed volume (negative = inside-out), bounds. `estimateMinWall` is a ray-sampling estimate with a work budget, not a proof.
- No boolean ops (union/difference/subtract): out of scope. `addPlinth` places a slab under the model as a separate (touching, or `overlap` mm embedded) shell, which slicers union; the report shows 2 shells.

## Capabilities
| capability | does |
|---|---|
| `models.formats` | formats, conventions, primitives |
| `models.generate` | JSON recipe -> files in several formats |
| `models.convert` | any readable format -> any writable one |
| `models.inspect` | bounds, triangles, volume, manifold report, per-format sizes |
| `models.verify` | print-readiness gate (`TASK_FAILED` with a per-check list): manifold, positive volume, no degenerate faces, fits bed, optional min wall; multiple shells only warn unless `singleShell` |
| `models.print-prep` | weld, flip inside-out shells, scale to height / fit to bed, plinth, centre at z=0, write STL + 3MF |
| `models.blender-check` | import files headless in Blender; triangles, bounds, volume, manifold per file. `NOT_FOUND` when Blender is missing |

Recipe: `{name, parts:[{prim, args?, translate?, rotate?, scale?, mirror?, material?, parts?}]}`; a part with `parts` is a group. Limits: 5000 parts, nesting 8, segments <= 512, 3M triangles.

```bash
# CLI
bin/factory call models.generate '{"out":"dist/models","name":"fig","formats":["stl","3mf","glb"],"recipe":{"parts":[
  {"prim":"sphere","args":{"radius":10},"translate":[0,0,10],"material":"#ff0000"},
  {"prim":"cylinder","args":{"radius":4,"height":12},"translate":[0,0,26],"material":"#0000ff"}]}}'
bin/factory call models.print-prep '{"input":"dist/models/fig.glb","out":"dist/print","height":60,"plinth":{"height":2,"margin":3},"bed":{"x":220,"y":220,"z":250}}'
bin/factory call models.verify '{"input":"dist/print/fig_print.3mf","bed":{"x":220,"y":220,"z":250},"minWall":1.2}'
# HTTP (bin/factory serve --port 4790)
curl -s localhost:4790/api/models.inspect -H 'content-type: application/json' -d '{"input":"dist/print/fig_print.stl"}'
# MCP (bin/factory mcp): tools models_generate, models_convert, models_inspect, models_verify, models_print-prep, models_blender-check
# direct import: import { mesh, meshio } from './src/lib/index.js'
```
Paths are relative to `project` (default `.`); outputs must stay inside it. Existing files are not overwritten without `overwrite:true`.

## Blender
`tools/models/blender_roundtrip.py` (run by `models.blender-check`) imports each file with Blender's own importers and reports triangles, bounds, volume and manifold status (after merging doubles). Verified on Blender 5.3: obj, stl, ply, glb and gltf import natively with identical triangle counts and watertight meshes; glb/gltf bounds are in metres. Blender has no built-in 3MF importer, so 3MF is checked through a zip + XML fallback parser (flagged `nativeImport:false`). Blender is found via `blender` arg, `$BLENDER`, `PATH`, then `/snap/bin/blender`.

Tests: `node --test test/models.test.mjs templates/web-project/test/lib/mesh.test.mjs` (Blender cases skip when it is absent). See also `docs/PRINTING.md`.
