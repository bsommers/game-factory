# Checkpoint (multilang work)

Branch `multilang` (tag `pre-multilang` = previous state; `main` untouched). Plan: `docs/PLAN-MULTILANG.md`. Pushed to `origin/multilang` at `35795b4` (code) plus this checkpoint commit.

## Done (committed and pushed)
- Languages axis (`factory-core/languages`), standalone packaging (`factory-core/package`), generated clients (`clients/`; regenerate with `bin/factory call clients.generate '{}'`).
- Spec + vectors: v1 engines (`spec/vectors`), v2 collision2d/physics2d (`spec/v2`, docs written), v3 collision3d/bvh (`spec/v3`). Drift for v1, v2, v3 is tested in `test/spec.test.mjs`.
- Rust/Go/Python templates: all 188 v1 vectors pass.
- 2D/3D collision, physics2d, BVH, ray tracing (`tools/render`, `raytrace-kit`, `factory-core/rendering`).
- `guide.route` / `guide.plan` accept a `language` input (`factory-core/guide/language.mjs`, `test/guide-language.test.mjs`). The agent that wrote it never sent a final report; the changes were not reviewed by hand, only by tests.
- v2/v3 engines (collision2d, physics2d, collision3d, bvh) ported to Rust, Go and Python; all vector cases pass in fresh scaffolds (Rust/Go/Python each 50/39/51/24). `spec/v3/gen-vectors.mjs` was fixed (inputs rounded before building; `rnd` passes integers through) so the bvh vectors are self-contained.
- `project.run` dispatch tests for Rust/Go/Python (`test/project-dispatch.test.mjs`).

Full suite: `node --test test/` = 154 pass, 0 fail.

## Caveats
- The Go `build` dispatch step is skipped (as a diagnostic) only when the link fails on a missing X11/GL lib. This machine lacks `libxxf86vm-dev` and friends, so the Go template build is NOT verified here. Installing the X11 dev libs removes the skip.
- 3D character controller (`createCharacter`/`moveAndSlide`) is ported only in Python; Rust/Go skip it, and no vectors cover it anywhere. Go `SweepCapsule`/`CapsuleContacts` are ported but untested; physics `snapshot`/`restore` not ported in Go.
- Python keeps a v3 int-vs-float tolerance that may no longer be needed (unchecked).
- Concurrent cargo builds sharing one `CARGO_TARGET_DIR` overwrite each other's test binaries; use separate target dirs for parallel agents.

## Open
- Add vectors + ports for the 3D character controller; drop the Python v3 tolerance if unneeded.
- GPU kit code is unrun.
- Tauri/Wails/Electron builds are only stub-tested.
- Review the guide language-awareness changes by hand.
- Regenerate clients (`clients.generate`) after any capability schema change; the drift test fails otherwise.
