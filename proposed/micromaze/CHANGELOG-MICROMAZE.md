# MicroMaze factory proposals

| # | NEW/MODIFIES | Target path | Staged file |
|---|---|---|---|
| 1 | MODIFIES | tools/swarm-tracker/dashboard/server.mjs (TRACKER_ALLOW) + package.json tracker script | tools_swarm-tracker_dashboard_server.mjs.proposed, package.json_tracker-script.txt.proposed |
| 2 | NEW | tools/serve.mjs, validate-level.mjs, botplay.mjs, export-characters.mjs; MODIFIES tools/sheet.mjs | tools_*.proposed |
| 3 | NEW | scripts/verify.sh | scripts_verify.sh.proposed |
| 4 | NEW | src/core/scores.js, settings.js, src/ui/startmenu.js, test/sim/scores.test.mjs, #startmenu CSS | src_*, test_*, style.css_menu-blocks.css.proposed |
| 5 | NEW | assets/characters/{library.json,README.md}, docs/CHARACTERS.md | assets_characters_*, docs_CHARACTERS.md.proposed |
| 6 | NOTE | GitHub Pages recipe, learnings | README.md, LEARNINGS-MICROMAZE.md |

Files are verbatim, not generalized; MicroMaze-specific names (level ids in verify.sh, character names) need adapting on adoption.

- Added difficulty and store-size transforms (+tests), levelmenu, music-load test; refreshed startmenu (difficulty/size rows), settings, botplay (--diff/--size), verify.sh, scores.

## Promoted to templates/web-project
- `src/levels/difficulty.js`, `src/levels/size.js` (verbatim) + `test/levels/transforms.test.mjs` (synthetic level, no game assets).
- `test/system/modules-load.test.mjs`: generalizes micromaze's music-load test; imports every browser-safe module under `src/` so load-time throws fail the gate.
- `package.json` test script now includes `test/levels` and `test/system`.
- Priority 2: `src/core/{config,scores,settings}.js` (storage keys namespaced by `GAME_ID`, `__SLUG__` substituted at scaffold), `src/ui/startmenu.js` (levels/titles/controls/title/tagline passed as options, no MicroMaze strings), menu CSS appended to `style.css`, `test/core/{scores,settings}.test.mjs`.
- `bin/factory-scaffold.sh` now copies `src/core`, `src/levels`, `src/ui` into new web games (the earlier levels commit was in the template but never scaffolded) and substitutes `__SLUG__`/`__NAME__`.
- Known: 33 `test/lib/*` tests fail inside a scaffolded project (they import factory-root `test/helpers`); pre-existing, unrelated.
- Character library merge: `library.add` (pixbuf-web) imports MicroMaze's 17 px16 assets and validates. Adapter fix: nested art modules (`px16/chars`) produced the invalid tag `module:px16/chars`; now `module:px16-chars` (regression test in test/library/ops.test.mjs). Bespoke manifest/exporter marked reference-only in README.
