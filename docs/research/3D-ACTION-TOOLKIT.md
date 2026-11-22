# 3D action-adventure toolkit: research and backlog

Goal: the machinery the factory needs to ship third-person 3D action-adventure games (melee combat, multi-phase bosses, procedural tentacle/hydra limbs, water and fire VFX). Written 2026-11-22.

## 0. Baseline: what exists

- Registry/surfaces (AGENTS.md): capabilities `{name, summary, inputSchema, outputSchema, handler}` in `factory-core/<area>/capabilities.mjs`, registered in `factory-core/index.mjs`; CLI, HTTP, MCP and import all follow. Skills in `skills/*.md` with `capabilities:` front matter; libs copied to `templates/web-project/src/lib/`; kits in `src/kits/`; spec vectors in `spec/v3/` (generated, 1e-9 tolerance).
- `collision3d.js` + `bvh.js`: primitives, rays, `sweepSphere/sweepCapsule`, kinematic capsule `createCharacter`/`moveAndSlide` (slopes, steps, snap), SAH BVH with `refit`. Deterministic Float64. This is the physics/query core; there is no rigid-body solver.
- `gltf-anim.js` + `anim.inspect|import|merge|sample` + skill `animated-models`: parse skins/clips, `AnimPlayer` (`setState` crossfade, CPU `skinned()`, GPU `jointMatrices()`), `blendPoses`, `guessStates`, clip merge (Meshy one-clip-per-file). No layers/masks, no state graph, no root motion, no IK, no retargeting, no morph targets.
- `mesh.js`/`mesh-io.js`: procedural meshes (capsule, lathe, torus, extrude), GLB writer. Useful for tentacle/arena geometry.
- `hazard-kit.js` (2D registry; patterns incl. `tauntingBoss`), `world-gen.js` (+ fairness validator), `autopilot-kit.js` (bot search), `fx-kit` (2D particles, shake, flash), `audio-kit`, `raytrace-kit`, library registry (`library.*`, `registry.*`), `styles.*`, `guide.*`, `swarm.*`, `test`, `shot`.
- Not present: any 3D camera rig, input mapping, combat, AI, boss framework, 3D VFX, save/inventory/dialogue, level/arena editor, navmesh.

## 1. Design principles for the new work

1. Pure, deterministic, zero-dependency cores in `templates/web-project/src/lib/*.js` (Node-safe, no `Math.random`, fixed dt 1/60, Y-up right-handed like `collision3d`). Renderer-agnostic: output transforms/matrices/events, never touch three.js. Adapters for three.js live in a separate `src/lib/three/` folder so the cores stay testable headless.
2. Data-driven: moves, bosses, dialogue and levels are JSON that has a JSON Schema; the schema is the capability input. This is what makes all four surfaces and agent swarms cheap.
3. Every core gets: spec doc + vectors under `spec/v3/`, test under `test/lib/`, one capability family (validate / simulate / author), and a skill. Headless "simulate" capabilities (e.g. `combat.simulate`, `boss.simulate`) are the QA gate, like `autopilot-kit` is for 2D.
4. Adopt OSS for what is hard and generic (rigid-body physics, navmesh generation, IK solvers, GPU particles); build the glue and data schemas ourselves. Optional deps are added to the generated web project only when a kit asks for them (`factory new --web --kit action3d`), never to factory-core.

## 2. Area-by-area

Licenses are from memory/upstream conventions unless noted; search tooling confirmed Rapier (Apache-2.0), three-pathfinding (MIT, via Snyk) and recast-navigation-js (MIT, via mirror). Verify each LICENSE file before vendoring.

### 2.1 Third-person camera, lock-on, camera shake
- Have: nothing 3D (fx-kit shake is 2D integer offset).
- OSS: three `OrbitControls` (MIT, wrong feel); `camera-controls` by yomotsu (MIT) smooth orbit/dolly/collision-ish; `@pmndrs/ecctrl` (MIT) R3F character+camera on Rapier; `three-mesh-bvh` (MIT) for fast camera-occlusion raycasts. Godot: `SpringArm3D` + Phantom Camera addon (MIT). Bevy: `bevy_third_person_camera` (MIT/Apache).
- Build: `camera3d.js` (pure): orbit rig (yaw/pitch, damped follow, spring arm sweeping a sphere with `sweepSphere` against the BVH world, shoulder offset, FOV kick), lock-on (target scoring by angle+distance+LoS ray, switch-target flick, soft re-center, camera framing player and target), `shake3d` (trauma model, Perlin-style seeded noise, additive rotation+translation, per-source decay), hit-stop and slow-mo time scale helper. Output: `{pos, target, fov}`.

### 2.2 Character controller
- Have: `createCharacter`/`moveAndSlide` (capsule, steps, snap). Caller owns gravity/jump.
- OSS: Rapier KinematicCharacterController (Apache-2.0), Jolt (`jolt-physics` WASM, MIT) CharacterVirtual, Godot `CharacterBody3D` (MIT), Bevy `bevy_tnua` (MIT/Apache). Our own is already comparable and deterministic; do not swap it.
- Build: `locomotion3d.js` on top: accel/decel curves, run/walk/sprint, coyote time and jump buffer, variable jump, ledge grab/mantle (sweep probes), swim/wade state driven by a water volume, slide on steep slopes, knockback/impulse channel, root-motion velocity input (see 2.3). State machine emits events (`land`, `jump`, `swimEnter`) for anim/audio/VFX.

### 2.3 Animation: state machine, blending, root motion, IK, retargeting
- Have: clip playback, one crossfade, clip merge, pose blend helper.
- OSS: three `AnimationMixer` (MIT; actions, weights, additive, masks via tracks); `three-ik` / THREE.IK (MIT) FABRIK/CCD; `Kalidokit`-style not relevant; `ik_solver`-like FABRIK is ~150 lines, build our own; Mixamo animations (free for use, not redistributable standalone; keep out of libraries as raw assets, record provenance); `three-vrm` (MIT) has retarget helpers; Godot `AnimationTree` (state machine, blend space, root motion; MIT) and `SkeletonModifier3D`/IK; Bevy `AnimationGraph` (MIT/Apache) plus `bevy_ik`/`bevy_mod_inverse_kinematics`. Rig-agnostic retarget by bone-name map plus rest-pose delta (Mixamo to Meshy) is the common recipe.
- Build (extend `gltf-anim.js`, new file `anim-graph.js`):
  - Graph: JSON `{params, states, transitions{cond, blend, exitTime, interrupt}, blendSpaces1D/2D, layers{mask, additive}}`; deterministic `update(dt, params) -> pose`.
  - Root motion: extract per-clip root delta (translation/yaw), strip from pose, feed `moveAndSlide`; per-move flag for "root-motion driven" attacks and dodges.
  - Events: animation notifies in clip metadata (`hit_on`, `hit_off`, `footstep`, `i_frames_start/end`, `vfx`) fired by time crossing; this is the link to combat.
  - IK: two-bone (foot placement, hand), FABRIK chain, look-at with clamps; foot IK by ray/sweep against the BVH.
  - Retarget: `anim.retarget` (bone map autodetect incl. Mixamo/Meshy/Blender names, rest-pose correction, scale).
  - Morph targets (currently unsupported) as P2.

### 2.4 Melee hitboxes / hurtboxes and combat
- Have: capsule/sphere/OBB overlap and sweeps, BVH queries.
- OSS: none worth it; Rapier sensor colliders or Jolt shapes would work but are heavy. Godot `Area3D`, Bevy sensor colliders as references.
- Build `combat3d.js`: hurtbox set per actor (capsules on joints, bound to `skinned()` joint positions or `jointMatrices`), hitbox shapes per move (swept per frame between previous and current joint pose to avoid tunnelling: use `capsule` swept over the weapon segment), one-hit-per-swing registry, hit resolution to `{damage, poise, knockback, hitstop, type, tags}`, damage formula table, resistances/weakness tags, block/parry windows, dodge i-frames, stagger/poise, combo graph (input buffer, cancel windows, branching on direction/charge), stamina, status effects (burn, wet, shock; ties to VFX), team/faction filter. Moves are JSON (`moves.json`) with frame data (startup/active/recovery) so `combat.simulate` can run duels headless and report DPS/TTK/frame advantage.

### 2.5 Enemy AI
- Have: `autopilot-kit` (2D bot), `hazard-kit` patterns.
- OSS: `yuka` (MIT; steering, FSM, goal-driven, perception, navmesh, graph); `three-pathfinding` (MIT; navmesh A* on a mesh); `recast-navigation-js` (MIT; Recast/Detour in WASM, tiled navmesh, crowd, obstacles; best choice for runtime), `bitecs` (MPL-2.0; fast ECS, only if scale demands), `miniplex` (MIT) lighter ECS; behavior-tree libs (`behaviortree` MIT, small; or write ours). Godot `NavigationServer3D` + LimboAI addon (MIT; BT/HSM); Bevy `oxidized_navigation`, `big-brain` utility AI (MIT/Apache).
- Build `ai3d.js`: BT (selector/sequence/parallel/decorators, blackboard, seeded RNG, serialisable JSON trees), HSM, utility-AI scorer, perception (cone + LoS ray + hearing), steering (seek, arrive, avoid via sweeps), attack-slot ticket system (so only N enemies attack at once), aggro/leash, group tactics (surround, flank). Navmesh: factory-side `nav.bake` capability that bakes a navmesh from a triangle soup using recast-navigation-js at build time and writes a serialised `.navmesh` file; runtime uses Detour query wasm (optional dep) with a pure JS fallback (grid/waypoint A* in `nav-lite.js`) for tests and agents.

### 2.6 Multi-phase boss framework
- Have: `hazard-kit.tauntingBoss` (2D only).
- Build `boss3d.js` (data-driven, depends on combat/ai/camera):
  - Schema `boss.json`: `{id, hp, parts[{id, hurtbox, hpShare, weakPoint?, breakable?, armor}], phases[{enterAt: hp%|event, attacks[{id, weight, cooldown, telegraph{time, vfx, sfx, decal}, move, conditions}], arena{hazards, spawns}, vulnerability, music, camera}], enrage, transitions{cutscene, invuln, heal}}`.
  - Runtime: phase machine with hysteresis, attack picker with anti-repeat and difficulty (seeded), telegraph system (ground decals/AoE shapes drawn from the same shape used for the hitbox, so what you see is what hurts), weak-point exposure windows, stagger/stun bars, part-break, add spawning, arena hazard scheduler (pillars, lava, flooding level), phase-transition scripting (camera, slow-mo, dialogue).
  - Fairness validator (like `world-gen.validateWorld`): every attack has telegraph >= reaction floor (e.g. 0.35 s), a safe zone exists, dodge window fits i-frames, no unavoidable overlapping AoE; `boss.simulate` runs a scripted dodging bot N seeds and reports win rate, time per phase, damage taken.
  - Reference boss: multi-headed hydra (below) as the worked example.

### 2.7 Procedural tentacles / hydra limbs / whirlpool
- Have: `mesh.js` capsule/lathe/torus; none of the dynamics.
- OSS: three `TubeGeometry` (MIT) for rebuild-per-frame sweeps; `three-ik` (MIT) FABRIK; Verlet rope sims are ~100 lines (build). Godot `SkeletonIK3D`/`SpringBoneSimulator3D`, Bevy `bevy_rapier` joints (Apache-2.0) for physics-based ropes. Jolt/Rapier ropes are overkill and non-deterministic across platforms.
- Build `limb3d.js` (pure, deterministic): chain of N segments with per-segment radius profile; solvers: FABRIK toward target, secondary motion via Verlet/spring (follow-through, whip), sinusoidal wave "idle" driver, constraint pass against capsule colliders (arena, player, floor), attack drivers (slam, sweep, grab, spit arc), neck+head variants (hydra) with independent head state machines sharing one body HP pool or per-head HP (regrow rule). Outputs joint transforms; adapter builds a skinned or tube mesh (`limb-mesh.js`: lathe-profile sweep with rings, UVs, normals; also writes GLB via `mesh-io` so it can be previewed in `shot`). Hurtboxes = per-segment capsules. Suction cups/spikes as instance transforms.
- Whirlpool/vortex: `fluid-lite.js`: analytic vortex field (Rankine/Lamb-Oseen: tangential v = Gamma/(2 pi r) * (1 - exp(-r^2/rc^2)) plus radial inflow and downdraft), forces on actors (drag toward centre, swim-skill counter-force), floating debris as particles, optional 2D height-field wave sim (shallow-water or Gerstner) for the surface. Do not attempt SPH/Navier-Stokes. Rendered by the water shader (2.9).

### 2.8 Level / arena tooling
- Have: `world-gen` (2D), BVH, `mesh.js`, `models.*`.
- OSS: Blender (GPL tool, output is yours) plus glTF with custom properties (extras) for spawn/trigger markers; `Trenchbroom`/`func_godot` (GPL tool; map output fine); Godot editor and Bevy have scene formats but we are web; `three-gpu-pathtracer` (MIT) for baked previews; `meshoptimizer` (MIT) and `gltf-transform` (MIT) for optimising assets; Tiled (GPL tool, 2D). Recast (zlib) for navmesh.
- Build: `level3d.js` + `level.*` capabilities. Format `level.json` (grid-snapped arena modules, spawn points, triggers, hazards, water volumes, lights, cameras, navmesh ref). `level.new --kind arena|dungeon|hub`, `level.validate` (reachability with the character controller's step/jump limits via sweeps, no stuck spots, soft-lock checks, nav coverage), `level.bake` (merge to one collision soup + BVH serialise + navmesh bake), `level.shot` (top-down and angled screenshots via `shot`). `arena-gen`: seeded circular/ring arenas with pillars and hazard zones for boss rooms; kit pieces generated from `mesh.js` primitives so a no-art game still works. glTF import of Blender levels reads `extras` for entities.

### 2.9 VFX (water, fire) and shaders
- OSS: three.js `Water`/`Water2` examples (MIT); `three.quarks` (MIT) particle system with GPU/CPU emitters and trails; `three-nebula` (MIT); `three-custom-shader-material` (MIT); `@react-three/postprocessing` / `postprocessing` (Zlib/MIT) bloom, SSAO, outline; `three-stdlib` (MIT). Godot GPUParticles3D + visual shader (MIT), Bevy `bevy_hanabi` (MIT/Apache). Lightweight stylised fire: noise-scrolled billboards + additive; stylised water: Gerstner vertex displacement + depth-fade foam + fresnel, which we can write in ~150 lines GLSL and unit-test the wave function on CPU (buoyancy needs the same function).
- Build `vfx3d` kit: shared wave function `waveHeight(x, z, t)` (CPU+GLSL parity vector test), `water-surface.js` (adapter, flow map, shore foam, whirlpool vortex uniform), `fire-fx.js` (flame billboards, embers, heat distortion, light flicker with seeded noise), `hit-vfx` presets (slash trail ribbon from weapon segment history, impact sparks, shockwave ring, ground decal projector for telegraphs), screen effects (vignette on damage, underwater tint, radial blur on dash). Deterministic emitters seeded like fx-kit; presets table so `vfx.describe`/`vfx.preview` can be capabilities.

### 2.10 Save, inventory, dialogue, quests
- OSS: `ink` (inkjs, MIT) narrative scripting; `Yarn Spinner` (MIT) JS runtime; `Twine`/`twison`; localforage (Apache-2.0) / plain IndexedDB for saves; Godot `Dialogic` (MIT) and `Dialogue Manager` (MIT); Bevy `bevy_yarnspinner` (MIT/Apache).
- Build (pure and small): `save3d.js` (versioned schema + migrations, slot manager, checksum, deterministic JSON, autosave on checkpoint, works on IndexedDB/localStorage/Node fs via adapters); `inventory.js` (items table, stacks, equipment slots, stat modifiers, loot tables with seeded RNG); `dialogue.js` (own tiny JSON node graph with conditions/effects, plus an `inkjs` adapter); `quest.js` (flags/objectives state machine). Capabilities: `save.validate`, `inventory.validate`, `dialogue.validate` (dead ends, missing vars, unreachable nodes), `dialogue.lint`.

### 2.11 Physics (rigid bodies, ragdoll, props)
- OSS: Rapier JS (Apache-2.0; deterministic only on same build, `@dimforge/rapier3d-deterministic` exists), Jolt WASM (MIT), cannon-es (MIT, unmaintained-ish), Ammo (zlib, heavy). Godot Jolt integration (MIT), Bevy Avian/rapier.
- Recommendation: keep our kinematic core for gameplay (determinism, headless bots); offer `physics-rapier` adapter kit for props, ragdoll on death, debris, and buoyant crates only, flagged non-deterministic and excluded from vectors.

## 3. Prioritised backlog

Sizes: S <= 1 day of agent work, M = 2-4 days, L = 1+ week or a multi-agent swarm. Names follow existing convention (`area.verb` capabilities, `*-kit` for packaged kits, `skills/<name>.md`).

### P0: minimum to build a playable third-person melee game with one boss
| # | Item | Size | Names |
|---|---|---|---|
| 1 | Camera rig + lock-on + 3D shake/hitstop (pure) | M | lib `camera3d.js`; `camera3d.simulate`, `camera3d.validate`; skill `third-person-camera` |
| 2 | Animation graph: state machine, blend spaces, layers/masks, events, root motion | L | lib `anim-graph.js`; `anim.graph.validate`, `anim.graph.simulate`, `anim.events`; extend skill `animated-models` |
| 3 | Locomotion layer on `moveAndSlide` (jump buffer, coyote, mantle, swim, knockback) | M | lib `locomotion3d.js`; `locomotion.simulate` |
| 4 | Combat core: hurtboxes on joints, swept hitboxes, frame-data moves, combos, dodge/i-frames, stamina/poise, damage | L | lib `combat3d.js`; `combat.validate`, `combat.simulate`, `moves.lint`; skill `melee-combat` |
| 5 | Enemy AI: BT + HSM + perception + attack tickets (+ nav-lite A*) | M | lib `ai3d.js`, `nav-lite.js`; `ai.validate`, `ai.simulate`; skill `enemy-ai` |
| 6 | Boss framework: phases, telegraphs, weak points, arena hazards, fairness validator, headless sim | L | lib `boss3d.js`; `boss.validate`, `boss.simulate`, `boss.new`; skill `boss-fight` |
| 7 | Action3D kit scaffold and starter: `factory new --web --kit action3d` with three.js adapter, input map (kbd/gamepad), fixed-step loop, debug draw of hit/hurt boxes | M | `action3d-kit`; `kits.list` entry; `docs/KITS.md` section |
| 8 | Update guide.route, AGENTS.md, LEARNINGS for 3D action; swarm template (disjoint owns: camera, anim, combat, ai, boss, vfx, level) | S | `guide.plan` presets |

### P1: makes bosses and worlds feel good
| # | Item | Size | Names |
|---|---|---|---|
| 9 | Procedural limbs: FABRIK + Verlet secondary motion, tube/skinned mesh builder, hydra heads | L | lib `limb3d.js`, `limb-mesh.js`; `limb.simulate`, `limb.mesh`; skill `procedural-limbs` |
| 10 | Water: shared wave function with CPU/GLSL parity, water surface adapter, buoyancy, foam | M | `vfx3d-kit` (`water-surface.js`); `vfx.preview` |
| 11 | Whirlpool/vortex field and debris sim, pull/escape mechanic | M | lib `fluid-lite.js`; `vortex.simulate` |
| 12 | Fire/impact/slash-trail/telegraph-decal VFX presets (adopt `three.quarks` optional) | M | `vfx3d-kit` presets; `vfx.describe` |
| 13 | Level format + validate + bake (collision soup, BVH, glTF extras entities) | L | lib `level3d.js`; `level.new`, `level.validate`, `level.bake`, `level.shot` |
| 14 | Navmesh bake via recast-navigation-js + runtime adapter | M | `nav.bake`, `nav.query`; optional dep |
| 15 | IK: two-bone, FABRIK chain, look-at, foot placement | M | lib `ik.js`; `ik.simulate` |
| 16 | Retarget (Mixamo/Meshy/Blender bone maps, rest-pose fix) | M | `anim.retarget`; extend `anim.inspect` rig report |
| 17 | Save + inventory + dialogue + quest cores with validators | M | libs `save3d.js`, `inventory.js`, `dialogue.js`, `quest.js`; `save.validate`, `dialogue.validate` |
| 18 | Bot for 3D: scripted dodger/attacker used by `boss.simulate` and `qa-with-bot` | M | `autopilot3d` in `autopilot-kit` |

### P2: polish and scale
| # | Item | Size | Names |
|---|---|---|---|
| 19 | Rapier/Jolt adapter kit for props, ragdoll, debris (non-deterministic, flagged) | M | `physics-rapier-kit` |
| 20 | Morph target support in `gltf-anim` (facial, damage states) | M | extend `gltf-anim.js`, `anim.inspect` |
| 21 | Arena generator (seeded ring/pillar/lava rooms from `mesh.js`) and kit pieces library | M | `level.arena`; library `type: level` assets |
| 22 | ECS option (miniplex or bitecs) when entity counts exceed ~500 | S | doc + example only |
| 23 | Ink/Yarn adapter for dialogue | S | `dialogue.import` |
| 24 | Post-processing presets (outline, bloom, underwater) and quality tiers | S | `vfx3d-kit` |
| 25 | Asset optimisation pipeline (gltf-transform/meshopt; note: `gltf-anim` rejects meshopt, so keep it export-only) | S | `models.optimize` |
| 26 | Godot/Bevy export shims: emit moves.json/boss.json/level.json loaders as reference for porting | L | `export.godot`, `export.bevy` (stretch) |
| 27 | Spec vectors for every new pure lib (camera, anim-graph, combat, limb, vortex) | M | `spec/v3/*.md`, `gen-vectors.mjs` |

## 4. Suggested build order and swarm split (disjoint owns)
Wave 1 (parallel): camera3d, anim-graph (+root motion/events), combat3d. Wave 2: locomotion3d, ai3d/nav-lite, action3d-kit scaffold with debug draw. Wave 3: boss3d, vfx3d water/fire, level3d. Wave 4: limb3d/hydra, fluid-lite/whirlpool, IK/retarget, save/inventory/dialogue. Capstone: a reference "hydra in a whirlpool arena" game that exercises every kit and becomes `docs/LEARNINGS-<game>.md`. Anything touching `gltf-anim.js` is owned by exactly one agent per wave (anim-graph) to avoid conflicts.

## 5. Risks
- Animation notifies and root motion depend on clip metadata that Meshy/Mixamo exports lack: need a sidecar `anim-meta.json` authored by agents (`anim.events` capability) rather than by hand in Blender.
- Float determinism between Node and browser for solver-heavy code (limbs, vortex): keep Float64, avoid `Math.sin` in vector-tested paths or use tolerance as `collision3d` does.
- Optional WASM deps (recast, Rapier, Jolt) complicate offline/Windows builds and the standalone packaging (`package.standalone`); vendor the wasm and pin versions, keep pure-JS fallbacks.
- Licenses to verify before vendoring: bitecs is MPL-2.0 (file-level copyleft), Mixamo assets are not redistributable as raw assets, GPL editors (Blender, Tiled, TrenchBroom) are fine as tools but not as bundled code.

## Sources
- three.js manual, libraries and plugins: https://threejs.org/manual/en/libraries-and-plugins.html and physics: https://threejs.org/manual/en/physics
- three-pathfinding: https://github.com/donmccurdy/three-pathfinding (MIT per Snyk advisor)
- recast-navigation-js: https://www.npmjs.com/package/recast-navigation
- Rapier JS bindings (Apache-2.0), react-three-rapier: https://github.com/pmndrs/react-three-rapier
- Yuka: https://mugen87.github.io/yuka
