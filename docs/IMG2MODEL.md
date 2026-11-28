# img2model: character sheet to rigged GLB

`img2model.silhouette`, `img2model.build`, `img2model.verify` (CLI, HTTP, MCP, import). Code: `factory-core/img2model/`, scripts `tools/img2model/*.py` (run with `blender -b --python`, Blender's bundled numpy; no PIL, scipy or pip installs).

```
bin/factory call img2model.silhouette '{"image":"sheet.jpg","outDir":"out"}'     # masks, split column, scale, debug PNGs
bin/factory call img2model.build '{"image":"sheet.jpg","outDir":"out","name":"hero","heightMeters":1.0,"triangleBudget":10000}'
bin/factory call img2model.verify '{"glb":"out/hero.glb"}'
bin/factory call meshy.rig-map '{"a":"out/hero.glb"}'                            # Godot BoneMap for the inferred rig
```

Input: one image, FRONT view on the left half, SIDE view (facing image-left) on the right half, flat background, both standing on the same ground line at the same scale. Outputs: `<name>.glb` (skinned, textured), `.blend`, `_skeleton.json` (glTF frame: Y up, faces +Z, Left = +X), `_texture.png`, debug overlays, `_view_{front,side,threeq,back}.png` and `_skeleton_{front,side}.png` renders.

## Algorithm
1. Segment: background = median of a border strip; foreground = colour distance above `threshold` (auto from border noise); closing (bridges hairline gaps in the outline), split at the widest empty column gap in the middle (`splitX` overrides), per half keep the largest component (small ones such as text labels, or anything wholly below the feet, are dropped), fill holes, opening (removes whiskers).
2. Normalise: each view is scaled so its height equals `heightMeters` (front X, side depth Y, shared height Z, feet at z=0). Front centred on its bbox; side registered on the median body-centre of the belly band.
3. Hull: per height slice, every front run x side run pair becomes a super-ellipse (exponent 2.4); runs much narrower than the widest are appendages and get round sections (hands/arms from the front, tail from the side). Occupancy is gaussian-blurred and meshed with naive surface nets, then decimated (Blender collapse) to `triangleBudget`.
4. Cape (optional, `separateCape`, default on): saturated cloth colour (HSV) found in both views is removed from the body silhouettes and rebuilt as a thin double-sided sheet behind the body; the collar rows are kept as body. Without a detected cape the cape is just part of the body.
5. Skeleton: slice-width analysis. Neck = width minimum between head peak and shoulders (fallback 0.72 H, reported in `notes`); legs from the two foot runs; arms from the widest points below the shoulders; spine from body-centre depth; tail chain by following the rightmost run of the side view up from its tip (resampled to `tailBones`) plus a root bridged into the pelvis. Hip height (0.30 H) and knee/elbow heights are fractions, not measured. Names: Mixamo/Meshy style (`Hips, Spine, Spine1, Spine2, Neck, Head, Left/RightShoulder|Arm|ForeArm|Hand|UpLeg|Leg|Foot|ToeBase`) plus `Tail1..N`, so `meshy.rig-map` resolves all required Godot humanoid roles.
6. Skin: Blender automatic heat weights; if any vertex is unweighted or a bone gets nothing, distance weights are used (`skinning` in the report). Limited to 4 influences and normalised.
7. Texture: planar projection of the source crops, written as per-face UVs into an atlas of the two crops (edge-bled so edges never sample the background). Front-facing faces sample the front view, side-facing the side view. No baking, so detail is as sharp as the source.
8. Checks in `build`: pose test (rotate LeftArm, LeftUpLeg, Tail3, Head; vertices must move). `verify` re-imports the GLB and checks tris, bounds, joints, skin attributes, every vertex weighted, sums to 1, at most 4 influences, texture, and the same pose test.

## Limits (honest)
- Hidden geometry is inferred: cross-sections are ellipses, so the model is blobby; no fingers, no cheek/ear depth; ears are thin because they are only as deep as the side view shows them.
- Texture seams where face groups switch between the two projections; patches of the wrong view appear on oblique faces. Back-facing faces have no data: lower back gets the cape colour (only if a cape was detected), the back of the head the side-view head colour, otherwise the front texture is mirrored through. The tail's rear faces share that rule (they look cape-coloured from behind).
- The cape is a plain sheet: no folds, a flat bottom edge, and the colour heuristic (HSV) needs a saturated cloak that differs from the fur; it can miss lit/shaded parts (the collar in the front view).
- Skeleton is silhouette-derived and symmetric; joint heights are heuristics. Poses with arms raised, crossed legs, or a tail overlapping the body will confuse it. Needs a clear gap or width change at the neck for detection, else a fallback.
- Both views must share scale and ground line; a height mismatch above 6 % is warned about in `img2model.silhouette`.
- Weights come from Blender heat or distance, with no manual painting: expect some candy-wrapper twist at shoulders.

## Versus Meshy image-to-3D
Meshy (see `meshy.*`) generates plausible hidden surfaces and PBR textures from one image with a learned model, and rigs with its own humanoid skeleton, but is a paid, networked, non-deterministic service and ignores your exact silhouettes. img2model is offline and deterministic, honours both silhouettes exactly (so proportions match the sheet, and a tail or cape in the side view is built), reuses the sheet pixels as the texture, and emits an editable `.blend`; but hidden sides are guessed geometrically, so it is blobbier and the back is flat. Use it for fast stand-ins, previews and rig tests; use Meshy (or sculpt over the `.blend`) for hero quality. The rigs share naming, so animations retargeted with `meshy.rig-map`/`anim.merge` work on both.

## How-to: add a back view (or more views)
The pipeline is view-agnostic at three places; a back view is the natural first addition.
1. Segment: in `common.segment` split into three spans (`splitX` becomes a list) and return `masks['back']`. A back view is the front mirrored, so register it with the same `cx` and height scale as the front (`Geo` takes one more mask).
2. Hull: in `hull.carve`, the front runs per slice could be intersected with the back runs (`front & back`); for asymmetric silhouettes treat them as two X-intervals and use the union of the front and back extents. Depth stays from the side view.
3. Texture: in `build.make_texture` add the back crop to the atlas and in `project_uvs` use it for faces with normal Y greater than 0.35 (replacing the colour patches and the mirror-through rule), keeping the neck/z rules.
4. Left and right side views: add a second side mask the same way; for the texture pick the side crop by the sign of the face normal X.
5. Add the new inputs to the `inputSchema` in `capabilities.mjs` (for example `backView: true`), extend `silhouette.py`'s report, and cover it in `test/img2model.test.mjs` with the synthetic sheet generator there.
