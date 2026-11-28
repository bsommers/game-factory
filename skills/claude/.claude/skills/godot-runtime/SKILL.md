---
name: godot-runtime
description: Run, test, screenshot and export a Godot 4 project headlessly; detect the engine, import-check assets, run GUT/parity tests and build export templates. Use when: godot, godot 4, gdscript, headless godot, godot export, export preset.
---

# godot-runtime

## When to use
Run, test, screenshot and export a Godot 4 project headlessly; detect the engine, import-check assets, run GUT/parity tests and build export templates.

## Steps
1. `godot.detect {}`: finds the binary and version; stop here if missing and report it.
2. `godot.import-check {project}`: headless import; fix every reported asset error before anything else.
3. `godot.test {project}`: run the project tests; `parity.run` compares the Godot sim against the JS reference sim for the same seed.
4. `nav.bake` bakes navigation data from level3d output when AI needs it.
5. `godot.shot {project}` for a screenshot to eyeball, then `godot.export-templates` and `godot.export {project, preset}` for a build.

## Gotchas
- Never run the editor GUI; everything is headless.
- Export needs templates and an export_presets.cfg (templates/godot-action3d has one).
- Do not weaken parity tolerances to go green; fix the divergence.

## Verification
`godot.import-check` and `godot.test` return ok; `parity.run` reports zero divergences; `node --test test/godot-export.test.mjs` passes.

Suggested model: sonnet (cost medium). Factory capabilities: godot.detect, godot.import-check, godot.test, godot.shot, godot.export, godot.export-templates, parity.run, nav.bake.
