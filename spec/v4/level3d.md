# level3d spec (v4)

Reference: `templates/web-project/src/lib/level3d.js`. Schema: `spec/v4/schemas/level3d.schema.json`. Examples: `spec/v4/examples/level3d/{arena-towers,river-arena,tutorial-yard}.json`. Capabilities: `level3d.validate`, `level3d.bake`, `nav.bake`. Godot: `templates/godot-action3d/scripts/level/level_loader.gd` reads the same JSON.

Y-up, metres, degrees. `yaw` rotates about +Y with the Godot convention (x' = cos*x + sin*z, z' = -sin*x + cos*z). Pure and deterministic: no Date/Math.random, vertices rounded to 1e-6 then float32, so the bake hash is identical on every machine.

## Format
`{version:1, id, name?, bounds{min,max}, locomotion?, nav?, pieces[], spawns[], triggers?[], hazards?[], checkpoints?[], arena?}`; every id is unique within its list.

- `bounds`: the nav grid covers the XZ extent; Y range limits floor sampling.
- `locomotion`: `{radius, height, stepHeight, slopeLimitDeg}` (defaults 0.4, 1.8, 0.35, 50) or a locomotion3d config (`body{}` is read). A `locomotion` option on the capability overrides it. Slope/step limits come from here so nav agrees with the character controller.
- `pieces`: `box {pos(center), size, yaw?}`; `ramp {pos(centre of its bounding box), size [w,h,l], yaw?}` rises toward local +Z (low edge at -Z); `heightmap {pos(corner), cellSize, heights[rows along z][cols along x]}` (top surface only); `glb {asset, pos, yaw?, proxy{size,offset?}}` (a glb is visual; collision and nav use the proxy box). `collide:false` makes a piece visual-only.
- `spawns`: `{id, kind: player|enemy|boss|pickup|npc|prop, pos (feet), yaw?, config? (ai3d), boss? (boss3d id), item?, flying?, allowUnreachable?}`. At least one `player`.
- `triggers`: volume `{shape: box|sphere|cylinder, pos, size|radius(+height)}` + `{event, once?, activates?: [hazard|spawn ids]}`.
- `hazards`: volume + `{kind: flood|vortex|debris|gas|lava|spikes|void|water, dps?, ref? (boss3d hazard id or vfx id), startActive?}`. The first four match boss3d hazard types.
- `checkpoints`: `{id, pos, radius, respawn? (spawn id)}`.
- `arena`: `{shape: circle {center[x,z], radius} | box {min[x,z], max[x,z]}, boss? (spawn id), seed?, closed? (default true), gates?: [{pos, radius}], hazards?: [ids]}`.
- `nav`: `{cellSize (0.5), groundTolerance (0.5), links?: [{from,to}] (extra two-way edges, e.g. a ladder or a designed jump), blockers?: [{min,max}] (remove nodes, no collision)}`.

## Bake
1. Pieces -> triangle soup (outward CCW) -> `bvh.buildTriangles` -> `bvh.serialize` (`.collision.bvh`, spec/v3/bvh.md).
2. Nav: per cell centre, every up-facing triangle (normal.y >= cos(slopeLimit)) under it gives a floor (layers, so bridges and decks work). A node is kept when a body box (radius, stepHeight..height) overlaps no non-walkable triangle (walls, ceilings). Neighbour nodes (8-way, no corner cutting) connect when `|dy| <= stepHeight` or `|dy|/dist <= tan(slopeLimit)`; drops over stepHeight are one-way impossible, so edges are symmetric. Output `.nav.json` (`kind:'level-nav'`: nodes {i,j,y}, edges) and `navFromJSON` returns an ai3d NavProvider: `findPath(from,to)` (3D A*, string-pulled), `isClear`, `walkable`, plus `flood`, `nearest`.
3. `hash` covers soup, BVH bytes, nav and body; it is the determinism check.

## Validation (`level3d.validate`)
Structure and references (duplicate ids, bad shapes, unknown `activates`/`respawn`/`arena.boss`/`arena.hazards`, optional `refs{ai,boss,hazards,assets}` lists and `checkAssets`), then on the baked level: every spawn/checkpoint stands on ground within `groundTolerance` and on a walkable node (not over a void, not floating, not inside a wall); every non-player spawn and checkpoint is reachable from a player spawn by flood fill (unreachable ones are errors unless `allowUnreachable`; unreachable triggers warn); the arena is closed: a flood from the boss/seed must not reach a node outside the arena shape, except through listed `gates` (the flood stops at a gate). Limitations: floors are sampled at cell centres, so features thinner than the cell may be missed; `flying` spawns skip ground checks.
