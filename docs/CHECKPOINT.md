# Checkpoint (multilang work)

Branch `multilang` (tag `pre-multilang` = previous state; `main` untouched). Plan: `docs/PLAN-MULTILANG.md`.

Done (uncommitted until push): languages axis (`factory-core/languages`), standalone packaging (`factory-core/package`), generated clients (`clients/`, regenerate with `bin/factory call clients.generate '{}'`), spec + vectors (`spec/`), Rust/Go/Python templates (all 188 v1 vectors pass), collision3d + bvh (`spec/v3`), ray tracing (`tools/render`, `raytrace-kit`, `factory-core/rendering`). All registered in `factory-core/index.mjs`. Full suite: 143 pass at last run.

Open: 2D collision/physics agent (aff6ff5719e8f5dba) still working (`collision2d.js` only so far; needs `physics2d.js`, tests, `spec/v2`). Then: run `node --test test/`, regenerate clients, commit, push `multilang`.
Gaps: guide.route/plan not language-aware; project.run dispatch for Cargo/Go/Python untested; GPU kit code unrun; Tauri/Wails/Electron builds only stub-tested.
