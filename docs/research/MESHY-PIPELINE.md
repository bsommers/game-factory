# Meshy to factory pipeline (research + design)

Status: proposal. Research date 2026-11-22. Sources: docs.meshy.ai (llms.txt, api/rigging, api/animation, api/pricing, api/changelog), meshy.ai export-formats tutorial, Meshy help-center licensing articles. Items marked (unverified) were not confirmed on a primary page; re-check before relying on them.

## 1. What Meshy produces today

**Formats** (model_urls; a key is absent if that format was not generated): GLB, FBX, OBJ(+MTL), USDZ via API; web app also STL, 3MF, BLEND, DXF. Only GLB, FBX (and BLEND/USDZ in principle) carry rig and animation. OBJ/STL/3MF/DXF are geometry only (OBJ has an MTL with relative texture paths).
**Textures/PBR:** albedo, roughness, metallic, normal; emission only on Meshy 6; no AO map. Baked at generation. GLB embeds them (metallicRoughness packed per glTF).
**Units/axis:** not documented for plain generations; a Resize option (real-world height) and Origin (bottom/center) exist. Rigging requires the character to face +Z (glTF-standard front) and accepts a `height_meters` rescale.
**Polycount:** rigging input max 380,000 triangles (quad = 2); remesh to <=300k tri / <=150k quad if over. Meshy has a Remesh endpoint with target polycount (exact range unverified).
**Rig conventions:** default `meshyrig` skeleton: 24 bones, **files in centimetres** (other templates or `include_fingers:true` are in metres). Finger bones use Mixamo names (LeftHandThumb1...). Biped templates: meshyrig, mixamo, ue5_mannequin, max_biped, unity_humanoid, maya_human_ik, blender_rigify_basic_human, cc5_hd_neutral_base, daz_genesis9. Quadruped rigging added 2026-11-18 (no template, no fingers). Humanoid/quadruped only; must be textured.
**Animation files:** rigging task returns rigged FBX+GLB plus `basic_animations` (walking, running: GLB, FBX, armature-only GLB). Each animation task returns one GLB/FBX; `action_ids` (1-10) returns **one merged file with one clip per action** (charged per action). Clip names follow `Armature|walking_man|baselayer`, identical across rigs. Text-to-Motion retarget clip is named `retarget_clip` (biped only). post_process: change_fps (24/25/30/60), fbx2usdz, extract_armature.
**Retention:** results expire (3 days for non-Enterprise). Download immediately.
**License:** Free = CC BY 4.0 (attribution needed for commercial use); Pro and above = private license, full commercial, no attribution. Models made on paid plan keep paid rights after downgrade; later ones are CC BY. Terms (2026-03-07): user owns output provided inputs do not infringe.

## 2. API
Base `https://api.meshy.ai/openapi/`; `Authorization: Bearer msy_...`. API access requires Pro or higher; pay in credits. Tasks: PENDING -> IN_PROGRESS -> SUCCEEDED/FAILED/CANCELED (IN_PROGRESS may return to PENDING; only FAILED is an error and is refunded). Poll GET, or SSE `/stream`.

| call | purpose |
|---|---|
| POST /v2/text-to-3d (mode preview then refine), GET /v2/text-to-3d/{id} | text to 3D |
| POST /v1/image-to-3d, GET | image to 3D |
| POST /v1/rigging {input_task_id or model_url(GLB), animation_type, height_meters, skeleton_template, include_fingers} | rig |
| POST /v1/animations {rig_task_id, action_id / action_ids / motion_task_id, post_process} | animate |
| GET /v1/animations/library | free preset catalogue (id, name, rig_type, preview_url) |
| remesh, convert, resize, retexture | exist; exact paths in https://docs.meshy.ai/openapi.yaml (not in llms.txt summary) |
| GET /v1/balance | credit balance |

Limits: Pro 20 req/s and 10 concurrent tasks; Studio 60 concurrent; 429 with Retry-After and X-RateLimit-* headers.
**Credits (API pricing page, figures conflict across cached copies):** preview/mesh-only 20 (meshy-6/7.1, image-to-3D) or 5 (lite/older); refine 10 (2K/4K) or 15 (8K); rigging 5; animation 3 per action; text-to-motion 10 (prime) / 3 (swift); remesh 5; convert/resize 1; retexture 10. Model lifecycle: meshy-5 retired 2026-10-10, meshy-7 retires 2026-12-31, so pin `ai_model` explicitly and surface retirements as errors.

## 3. Known import problems (from docs and general ecosystem; no Meshy-specific bug reports found)
- **cm vs m**: meshyrig GLB is cm-scaled, others metres. glTF says metres; three.js shows a 100x giant, or a bone-scaled armature (scale on the root node). Normalise by baking (apply scale to vertices, inverse bind matrices and translation channels), not by leaving a scale on a node.
- **Orientation**: front must be +Z for rigging; GLB is Y up. FBX exports are cm/Y-up with an `Armature` scale/rotation quirk in Blender (-90 X on armature) and Unreal wants cm and a re-targeted skeleton (use ue5_mannequin template).
- **Separate clips per file**: three.js and Godot need the same node names in each file; the separate files must contain armature plus a mesh (or at least the nodes). Merge (anim.merge) is the answer; `action_ids` also gives merged output at generation time.
- **Bone/clip names**: `Armature|walking_man|baselayer` pipe names are awkward in Godot (AnimationPlayer node paths, `|` is legal but ugly) and in code; rename to `walk`.
- **FBX in three.js** often distorts or skeleton mismatches; prefer GLB. USDZ playback varies.
- **Textures**: no AO; roughness/metal packed; large (up to 4K/8K) embedded PNG/JPG inflates GLB. KTX2/WebP recompression helps, but WebP needs EXT_texture_webp and is not read by gltf-anim.js (it ignores textures, fine, but check the renderer).
- **Polycount** is high (tens to hundreds of thousands) for characters meant for realtime: needs remesh/decimate and LODs.
- **Compression**: gltf-anim.js rejects Draco/meshopt/quantization, so any optimisation for the *anim.* path must keep meshes uncompressed, or the browser build must add decoders. Compress only the shipped variant if the renderer supports it (three.js has MeshoptDecoder/DRACOLoader).
- Free-tier download limits (unverified).

## 4. What already exists
| need | existing | gap |
|---|---|---|
| inspect skeleton, clips, guessed states, bounds, warnings | `anim.inspect` | no scale/units check, no facing/orientation check, no bone-name/humanoid mapping, no texture/PBR/size report, no budget limits |
| copy into project, manifest.json + models.js, same-rig grouping | `anim.import` | manifest has no provenance, license, source task ids, units, LODs, thumbnail, hashes; no normalisation |
| merge clips by node name, prefix/rename | `anim.merge` | no clip splitting, trimming, fps change, or retarget of mismatched bone names; no bind-pose compatibility check (bone names match but rest pose may differ) |
| pose sampling | `anim.sample` | used for verification only |
| runtime playing | `gltf-anim.js` (no compressed meshes, no morph targets, no external URIs) | no morph targets; no KHR_texture_transform etc. (render side) |
| glb read/write | `models.*` (meshes only, loses skins/anim) | nothing converts FBX/OBJ/USDZ to GLB (Meshy GLB suffices, so skip) |
| blender headless | `models.blender-check` | no animated import check |
Not present anywhere: gltf-transform/meshoptimizer dependency (none in node_modules at time of research), LOD generation, thumbnail render of a model, Meshy API client.

## 5. Proposed capabilities
Follow the existing registry conventions (`{ok,data,error,next}`, paths relative to `project`, outputs inside project, no overwrite without `overwrite:true`). Put in `factory-core/meshy/capabilities.mjs`; reuse `factory-core/anim` internals (split/join GLB, mergeAnimGLB, parseAnimGLB). Pure-JS normalisation goes in the existing browser-safe lib `gltf-anim.js` (or a sibling `gltf-edit.js`) so it is testable offline; heavy optimisation shells out to optional `@gltf-transform/cli` / `meshoptimizer` (declared optional, `NOT_FOUND` with install hint when absent, like Blender).

### meshy.import  (core, offline)
Normalise + optimise + register one character (and its clip files).
```
{ project?, inputs:[path...],            // rigged GLB(s) and animation GLB(s); FBX rejected with hint to re-export GLB
  id?: string, out?: "assets/models",
  base?: path,                            // which input provides mesh+skeleton (default: the one with a skinned mesh and most joints)
  units?: "auto"|"m"|"cm",                // auto: detect from bounds and root scale (height 100-250 = cm)
  targetHeight?: number,                  // metres, default keep (after unit fix)
  facing?: "+Z"|"-Z"|"auto", up?: "Y",    // bake a rotation if needed
  bones?: { template?: "meshyrig"|"mixamo"|"none", rename?: {from:to}, strip?: ["mixamorig:"] },
  clips?: { prefix?, rename?: {}, keep?: [], drop?: [], fps?: 24|30|60, stateMap?: {walk:"Armature|walking_man|baselayer"} },
  optimize?: { textures?: {maxSize:1024|2048|4096, format:"webp"|"ktx2"|"png"|"jpeg"}, dedup?:true, prune?:true, quantize?:false, meshopt?:false, draco?:false },
  lods?: [{ name:"lod1", ratio:0.5 }, { name:"lod2", ratio:0.2 }],  // meshopt simplify, keep skin weights, error cap
  thumbnail?: { size?: 256 },
  provenance?: { source:"meshy", plan?:"free"|"pro"|"studio"|"enterprise", taskIds?:{generate?,rig?,anim?:[]}, prompt?, aiModel?, createdAt? },
  license?: { id?: "CC-BY-4.0"|"Meshy-Private"|string, attribution?: string },
  overwrite? }
```
Steps: parse -> detect/bake units (scale vertices, IBMs, translation channels; never leave node scale on the root) -> bake facing -> rename bones/clips -> merge via anim.merge internals -> optimise -> LODs -> thumbnail -> write `<id>.glb`, `<id>.lod1.glb`, `<id>.png` -> update manifest. Returns before/after bytes, triangles, joints, clips, applied transforms, warnings. A deterministic run (same input and options give byte-identical output) is a requirement (fixed JSON key order, no timestamps unless `createdAt` is passed).

Manifest v2 entry (extends anim.import's v1; keep v1 readers working): `{id,file,bytes,sha256,clips[],states,joints,triangles,rig,units:"m",height,lods:[{file,triangles,bytes}],thumbnail,provenance:{...},license:{id,attribution,commercialOk,requiresAttribution}}`. `commercialOk/requiresAttribution` derive from plan: free -> CC-BY-4.0, attribution required. `package.*` should then collect required attributions into a CREDITS file (gap: check whether package already does this for assets).

### meshy.split
Split a multi-clip GLB into per-clip GLBs (for streaming, or for Godot AnimationLibrary), or trim clips.
```
{ project?, input, out:"dir", clips?:[names], trim?:{clip:{start,end}}, fps?, armatureOnly?: boolean, overwrite? }
```
### meshy.verify  (gate; TASK_FAILED with per-check list, never weakened)
```
{ project?, input, budget?:{ maxTriangles?:30000, maxBytes?:5e6, maxJoints?:64, maxTexture?:2048, maxMaterials?:4 },
  expect?:{ units:"m", heightRange?:[0.3,3], facing?:"+Z", clips?:["idle","walk"], template?:"meshyrig", sameRigAs?:path },
  sample?: boolean, blender?: boolean }
```
Checks: valid GLB; skinned and every joint reachable; joints in a single skin <= limit; weights normalised, <=4 influences/vertex; no node scale on skeleton root; height within range (catches cm); facing (+Z by front-of-body heuristic: toe/head joints) ; all clip channels target existing bones; clip count, durations, loop (first frame ~ last frame for locomotion); `anim.sample` bounds stable (no explosion: posed bounds within k x bind bounds); rig compatibility (same bone names AND rest-pose within tolerance) for files meant to merge; texture sizes/PBR present; no Draco/meshopt unless allowed; licence present and attribution recorded; optional Blender headless import with animation.
### meshy.rig-map
Report or apply bone-name mapping between meshyrig, mixamo, unity humanoid, ue5 mannequin, Godot humanoid profile, to retarget clips across templates.
```
{ project?, input, from?:"auto", to:"mixamo"|"ue5_mannequin"|"unity_humanoid"|"godot", out?, overwrite? }
```
### meshy.thumbnail / meshy.lods
Thin wrappers over the import steps for already-imported models: `{project?, id|input, size?}` and `{project?, id|input, levels:[{ratio,name}]}`. Rendering may use the existing `shot` path (headless browser) with a small viewer page, or Blender; pick whichever already works in `tools/render`.

### meshy.generate  (online, optional; separate from import so offline users never touch it)
```
{ project?, mode:"text"|"image", prompt?, imageUrl?|imagePath?, aiModel:"meshy-6", targetPolycount?, topology?:"triangle"|"quad",
  rig?:{ type:"biped"|"quadruped", heightMeters?, template?, fingers? },
  actions?:[ids] | { names:[...] }, fps?, out:"dir", maxCredits:number, dryRun?:boolean, keyEnv?:"MESHY_API_KEY", wait?: boolean, pollSeconds? }
```
Flow: preview -> (refine) -> rig -> animation (`action_ids`, one merged file) -> download all result URLs to `out` immediately (3-day expiry) -> hand to `meshy.import`. Safeguards: key read only from the env var (name configurable, value never logged, never written to manifest, redacted from errors, no CLI flag for the key); `maxCredits` required, with a cost estimate from the pricing table up front and `dryRun` to print it; GET /v1/balance preflight; a task-id journal in `<out>/.meshy-tasks.json` so a crashed run resumes instead of paying twice; backoff on 429 honouring Retry-After; only FAILED counts as failure (PENDING after IN_PROGRESS is normal); downloads only from the https hosts the API returned, size-capped; network off in tests (inject fetch; use recorded fixtures).
Companion read-only capabilities: `meshy.library {rigType?, query?}` (cached animation catalogue, GET /v1/animations/library, free) and `meshy.balance`. Guide routing: register skill `meshy-characters` (triggers: meshy, text to 3d, image to 3d, auto rig, character) with capabilities [meshy.import, meshy.verify, meshy.generate, anim.*]; update `skills/animated-models.md` to point at it.

## 6. Implementation order
1. `meshy.verify` + units/facing detection on top of `anim.inspect` (cheap, immediately useful; fixtures: small synthetic rigged GLB in cm, one rotated, one with unnormalised weights).
2. Normalisation in pure JS (unit bake, bone/clip rename, manifest v2 + provenance + license). Extend `anim.import` rather than fork it.
3. Optional gltf-transform/meshoptimizer step (texture resize/webp/ktx2, dedup, prune, simplify LODs) behind `optimize`; document that compressed output needs renderer decoders and that `gltf-anim.js` still requires uncompressed meshes for CPU skinning.
4. `meshy.split`, `meshy.rig-map`, thumbnails.
5. `meshy.generate` last, with recorded-fixture tests only; no live API in CI.
Open questions for the user: Meshy plan (affects licence and API access); target engines (Godot/three.js/Unreal) which decide the bone template; poly budgets per game; whether FBX input is wanted (would need FBX2glTF or Blender, otherwise insist on GLB).
