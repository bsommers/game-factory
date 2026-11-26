# MicroMaze factory proposals

| # | NEW/MODIFIES | Target path | Staged file |
|---|---|---|---|
| 1 | MODIFIES | tools/swarm-tracker/dashboard/server.mjs (TRACKER_ALLOW) + package.json tracker script | tools_swarm-tracker_dashboard_server.mjs.proposed, package.json_tracker-script.txt.proposed |
| 2 | NEW | tools/serve.mjs, validate-level.mjs, botplay.mjs, export-characters.mjs; MODIFIES tools/sheet.mjs | tools_*.proposed |
| 3 | NEW | scripts/verify.sh | scripts_verify.sh.proposed |
| 4 | NEW | src/core/scores.js, settings.js, src/ui/startmenu.js, test/sim/scores.test.mjs, #startmenu CSS | src_*, test_*, style.css_startmenu-block.css.proposed |
| 5 | NEW | assets/characters/{library.json,README.md}, docs/CHARACTERS.md | assets_characters_*, docs_CHARACTERS.md.proposed |
| 6 | NOTE | GitHub Pages recipe, learnings | README.md, LEARNINGS-MICROMAZE.md |

Files are verbatim, not generalized; MicroMaze-specific names (level ids in verify.sh, character names) need adapting on adoption.

- Added difficulty and store-size transforms (+tests), levelmenu, music-load test; refreshed startmenu (difficulty/size rows), settings, botplay (--diff/--size), verify.sh, scores.
