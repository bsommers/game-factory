# Plan: 3D action-adventure machinery (proposed, awaiting user sign-off)

Synthesis of `docs/research/{ENGINE-DECISION,3D-ACTION-TOOLKIT,MESHY-PIPELINE,ASSET-LIBRARY}.md`. First consumer: `~/src/fun/colbdysseus` (its design lives in that repo's `spec/`). Research claims are agent-reported; items marked "verify" must be checked before building on them.

## Decisions (pending user confirmation)
1. **Runtime: Godot 4.x (GDScript)** primary; three.js + rapier as the web/prototype path; Unreal only as a downstream handoff (spec + GLB bundle). Godot 4.7.2-stable is installed at /datanapps/tools/godot (see docs/GODOT.md).
2. **Gameplay is data-first.** Combat moves, boss phases, camera rigs and levels are JSON (schema-validated). A deterministic JS reference sim (built on `collision3d`) runs them headlessly for fairness/regression gates; the Godot runtime loads the same JSON. This reuses the factory's existing "spec + vectors, many runtimes" pattern.
3. **Assets: public text-only `game-assets` catalogue repo + private per-game repos.** Binaries are sha256-addressed GitHub Release assets, no Git LFS. Public publish is license-gated (`LICENSE_BLOCKED`). Nothing goes public until licenses are recorded (see Gates).
4. **Meshy intake** is a pipeline (`meshy.*`), normalising units (meshyrig is cm), facing, clip names and recording plan/visibility provenance.

## Waves (each wave = parallel agents with disjoint `owns`, Sonnet unless noted)
**Wave 0: foundations**
- A0 Godot: install/pin, `godot.test|shot|export` capabilities, `templates/godot-action3d/` skeleton.
- A1 Library v2: `licenseInfo`/`provenance` schema, `library.license-set|audit`, raised per-library size limits, publish gate.
- A2 Meshy core: `meshy.import|verify|split|rig-map` on top of `anim.*`; export `gltf-anim` from lib index.

**Wave 1: gameplay core (JS ref + JSON schemas)**: `camera3d`, `anim-graph` (root motion, events), `locomotion3d`, `combat3d` (frame data, i-frames), `ai3d`, `boss3d` (phases, telegraphs, weak points, fairness validator, headless sim). One agent each; Godot mirrors follow in wave 2.

**Wave 2: Godot runtime + boss tech**: Godot implementations of wave-1 JSON; `limb3d` (hydra necks/tentacles), water/whirlpool/fire VFX, `level3d` validate+bake, `nav.bake`.

**Wave 3: content + delivery**: `library.blobs.pack|publish|fetch`, `library.attribution`, `library.ip-review`, `meshy.generate` (env-var key, `maxCredits`, `dryRun`), swarm presets, skills + guide routing for "3D action game", docs, tests for every capability on all four surfaces.

Colbdysseus-specific work (characters, levels, bosses, asset intake) is tracked in `~/src/fun/colbdysseus/spec/` and starts after wave 0.

## Gates (never weakened)
- `node --test test/` green; every new capability has schema, test, and all four surfaces.
- No public repo creation or push until: user confirms Meshy plan tier/visibility per model, license recorded per asset, `library.license-audit` clean, user has read Meshy's ToS.
- Fairness validator and replay determinism must pass for each boss before it ships.

## Open items to verify
Godot/Bevy/Unreal versions and Unreal royalty terms; Meshy remesh polycount, free-tier download limits, credit prices; GitHub Release limits (2 GiB/file, 1000 assets/release); licenses for bitecs (MPL-2.0), yuka, three.quarks, Mixamo redistribution; why the digesters are gold.
