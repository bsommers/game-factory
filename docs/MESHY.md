# Meshy intake (offline core)

Capabilities in `factory-core/meshy/` (CLI/HTTP/MCP/import, like all capabilities). Offline only: no Meshy API client yet. Library code is `factory-core/meshy/lib.mjs` on top of `templates/web-project/src/lib/gltf-anim.js` (also exported as `gltfAnim` from `src/lib/index.js`).

| capability | what it does |
|---|---|
| `meshy.import {input, id?, out?, units?, height?, clips?, provenance?, overwrite?}` | Copy/normalise a GLB into `assets/models/`. Units: auto-detected from bind height (30-1000 = cm, baked to metres into vertices, bones, inverse bind matrices and translation tracks; a node scale is never left behind, and a file that already has one is refused, not guessed). Facing is checked and reported, not baked. Clip names: `Armature|walking_man|baselayer` -> `walking_man`; `clips.rename/prefix/keep/drop/case`. Writes `manifest.json` + `models.js` (anim.import compatible, extra fields) with `sha256`, `units`, `height`, `facing`, `provenance {source, plan, visibility, jobId, sourceFile, sourceSha256}` and `license`. `plan`, `visibility`, `jobId` stay `"unknown"` unless supplied; the licence derives from plan (free: CC-BY-4.0, attribution; pro/studio/enterprise: commercial, none; unknown: unknown). A file needing no change is copied byte-for-byte; output is deterministic. |
| `meshy.verify {input, budget?, expect?}` | Checks (pass/warn/fail/info): uncompressed, skin, joints, weights, bind height (cm catch), bounds/origin, facing, clips, missing idle, clip names, per-clip root drift/travel, scale tracks, pose stability, root scale, size budget (default limits warn, explicit `budget` fails), textures. `pass` is false when any check fails. |
| `meshy.split {input, out, ranges[{name,start,end}], clip?, unit?, fps?, keepOriginal?, only?}` | Slice a merged clip into new clips (boundary keys interpolated, CUBICSPLINE becomes LINEAR); unused data is compacted. |
| `meshy.rig-map {a, b?, out?}` | Compare skeletons by exact name, humanoid role (Rigify, Mixamo, UE/Unity, meshyrig) and hierarchy position; lists bones only in one rig (for example `Bone_0NN` extras) and the rest-pose delta. Emits a Godot `SkeletonProfileHumanoid` map `{profile, bones:{GodotBone: skeletonBone}, missingRequired, unmappedBones}`. |

## Real fixture results (Meshy rigify_basic_human exports, 2026-11-21)
- Parkway Pete: 58 joints (fingers, no index finger), 1.7 m, faces +Z, 3 clips (Running, Walking, Boxing_Practice), 45 MB (3x 4096 textures), no idle.
- SuperColby: 45 joints, 19 `Bone_0NN` extras (no fingers), 1.7 m, faces +Z, 5 clips, 28 MB, no idle.
- Both are already metres (the cm quirk is `meshyrig` only). Rigify naming: `spine` is the hips; the chain `spine.001..005` maps to Spine, Chest, UpperChest, Neck, Head (decided by which bone parents the shoulders).

## Limits
Facing is reported only; rotation baking is not implemented. `meshy.rig-map` suggests, it does not retarget clips. Sparse/quantized accessors cannot be rescaled (UNSUPPORTED).
