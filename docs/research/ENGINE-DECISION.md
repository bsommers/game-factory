# Engine decision: 3D action-adventure ("colbdysseus")

Date 2026-11-22. Scope: third-person melee/ranged combat, large boss fights, Meshy.ai GLB models with skeletal animation, driven headlessly by agents through the factory's CLI/HTTP/MCP/import surfaces.

Versions seen in web search (2026): Godot 4.7 stable (2026-06-18; 4.8 in dev; 4.7.2 patch unverified), Bevy 0.20 (2026-10-08; editor still not shipped), Unity 6 (Runtime Fee cancelled 2024-09, seat subscriptions only). UE 5.x EULA: royalty on gross revenue per the Royalty Addendum (historically 5% above USD 1M lifetime per product; verify current EULA). Not verified by search: exact UE/O3DE/PlayCanvas/Babylon versions; treat as "current".

## Recommendation

**Primary: Godot 4.x (4.7) with GDScript, wrapped by the factory.** The factory already has `templates/godot-project/`, `tools/build.sh` export, and GDScript as a first-class target. Godot is MIT, has a real `--headless` mode, scriptable CLI export, native glTF 2.0 import with skeletons/animations, AnimationTree, `BoneAttachment3D`, retargeting via `SkeletonProfileHumanoid` + BoneMap, and Jolt physics integration (built in since 4.4). Text scenes (`.tscn`/`.gd`) are diffable and agent-writable. No royalties, no per-seat cost, runs on Linux without a GPU for logic tests (headless + dummy renderer); screenshots need a software Vulkan (lavapipe) or GL (llvmpipe) which works on CPU-only machines.

**Secondary (web-first, cheapest integration): three.js + rapier (WASM) + a thin "action kit" in JS.** This matches the factory's JS-first core, ships to browser with zero export step, and gives deterministic headless testing (rapier is deterministic cross-platform; run logic in Node without rendering). Use it for prototypes, the web build of smaller games, and any game that must live in a browser. Boss-fight scale and animation tooling (state machines, IK, retargeting) are DIY, so it is a weaker fit for a large third-person action game than Godot.

**Optional "AAA-fidelity" path: Unreal Engine 5.** Choose only if photoreal visuals (Nanite/Lumen), MetaHuman-style characters, or console shipping become requirements. Drive it via `UnrealEditor-Cmd`, `RunUAT BuildCookRun`, Python editor scripting, Automation tests, and `-ExecCmds="HighResShot"`. Costs: ~100 GB install, source-available (not OSS), royalty above threshold, huge binary assets (use Git LFS or Perforce), poor Linux headless-GPU story (needs Vulkan; Linux editor works but heavy), no web export (Pixel Streaming only). Treat as a separate downstream project that consumes the same GLB/design docs, not a factory template.

Not recommended: Unity (closed, seat-based, Mono/C# toolchain, Linux editor headless is workable but licensing and Library/ cache bloat make it a poor agent target), Bevy (excellent determinism and OSS, but no editor, API churn every ~4 months, slow compile loop, thin animation-blending/retargeting; revisit at 1.0), Babylon.js and PlayCanvas (good web engines; PlayCanvas editor is cloud/closed, Babylon duplicates three.js with no gain for this factory), O3DE (Apache-2, heavy, small community, complex build, little agent tooling).

## Tradeoffs

Scores 1 (poor) to 5 (excellent), for this factory and this game.

| Criterion | Godot 4.7 | UE5 | Unity 6 | Bevy 0.20 | three.js+rapier | Babylon | PlayCanvas | O3DE |
|---|---|---|---|---|---|---|---|---|
| Headless build/test/screenshot by agents | 4 (`--headless`, CLI export, `--write-movie`) | 3 (UAT/Cmd, heavy) | 3 | 4 (cargo; screenshots need GPU/software) | 5 (Node + puppeteer/headless chromium) | 4 | 2 (cloud editor) | 2 |
| GLB/Meshy import + skeletal anim | 5 native | 4 (glTF importer plugin; skeleton retarget IK Rig) | 3 (glTFast pkg) | 4 (animation graph basic) | 4 (GLTFLoader, AnimationMixer) | 4 | 4 | 3 |
| Retargeting / anim state machine | 4 (BoneMap, AnimationTree) | 5 | 5 | 2 | 2 (DIY) | 3 | 3 | 3 |
| License / OSS | 5 MIT | 2 source-available + royalty | 2 closed | 5 MIT/Apache | 5 MIT | 5 Apache | 3 engine MIT, editor SaaS | 5 Apache/MIT |
| Git friendliness (binary size) | 4 (text scenes, small) | 1 (.uasset binary, GBs) | 3 (YAML scenes, Library ignored) | 5 | 5 | 5 | 3 | 3 |
| Web export | 3 (WASM, heavy ~35 MB, threads/COOP issues) | 1 | 3 | 3 (WASM/WebGPU) | 5 | 5 | 5 | 1 |
| Determinism / testability | 3 (Jolt deterministic-ish; fixed-step) | 2 | 2 | 5 (ECS, fixed step) | 4-5 (rapier deterministic) | 3 | 3 | 3 |
| Fit with JS-first factory/4 surfaces | 3 (GDScript target already exists) | 1 | 1 | 2 | 5 | 4 | 3 | 1 |
| Boss-fight / action-game scale | 4 | 5 | 5 | 3 | 3 | 3 | 3 | 4 |
| Linux, no GPU assumption | 4 | 2 | 3 | 4 | 5 | 5 | 4 | 2 |

## Meshy.ai asset notes (all engines)

- Meshy exports GLB with a humanoid rig and preset animations (walk/run/attack) as separate GLBs or clips. Keep one canonical rig per character; import clips onto the same skeleton name set. In Godot, map to `SkeletonProfileHumanoid` via BoneMap and share animations through an AnimationLibrary; in three.js retarget with `SkeletonUtils.retargetClip`.
- Existing factory work (`anim.*` capabilities, `gltf-anim` lib, animated .glb skill, commit e5398b1) already inspects/validates GLB animation; it is engine-neutral and should be the gate before any import.
- Git: keep GLBs under Git LFS or the factory `library publish` store; commit only manifest + hash, not regenerated Meshy outputs. Budget: <5 MB per character GLB with Draco/meshopt, textures KTX2.

## Integration path into the factory

1. **No new engine.** Add a `templates/godot-action3d/` template (third-person controller, lock-on camera, hitbox/hurtbox, state-machine combat, boss phase script, AnimationTree wired to a clip-name contract). Register through existing `project.new` (extend input with `kit: "action3d"`), per AGENTS.md "Adding a capability".
2. **Capabilities** (each in `factory-core/<area>/capabilities.mjs`, auto-exposed on all 4 surfaces): `assets.import-glb` (validate with `anim.*`, write BoneMap + AnimationLibrary), `godot.test` (GUT/gdUnit4 headless, JSON out), `godot.shot` (`--rendering-driver opengl3` + llvmpipe, or `--write-movie` frames), `godot.export` (wrap `tools/build.sh`, web + linux), `combat.simulate` (headless deterministic replay of a scripted fight; pass/fail on boss HP/phase transitions).
3. **Determinism gate**: fixed 60 Hz physics, seeded RNG, input-recording replays checked into `test/replays/`; CI compares end-state hashes.
4. **JS mirror (secondary)**: a `web-project` action kit (rapier + three AnimationMixer) built from the same combat data JSON (frame data, hitboxes, boss phases) so design data is engine-neutral and a web demo/prototype can validate fight tuning in Node before Godot work.
5. **UE5 escape hatch**: only emit a design spec + GLB bundle (`package.handoff`), no factory template, until a fidelity requirement forces it.
6. **Decision checkpoints**: re-evaluate if (a) Godot web build exceeds size/perf budgets for the target, (b) Bevy ships its editor/1.0, or (c) fidelity needs exceed Godot's renderer.

## Risks

- GDScript is a second language for factory agents (already supported; mitigated by typed GDScript and the existing godot template + docs/LANGUAGES.md).
- Godot web export needs cross-origin isolation headers for threads; use single-threaded export for the simple hosting case.
- Retargeting quality for Meshy rigs varies; add a per-character BoneMap fixture test.
- Facts above from web search are coarse (version numbers, royalty terms); verify EULA/versions before committing budget.

Sources: godotengine.org/releases, phoronix.com/news/godot-4.7-released, bevy.org/news/bevy-0-20, unity.com/blog/unity-is-canceling-the-runtime-fee, unrealengine.com/eula.
