# MicroMaze tooling proposals

Nothing here is live. Files are verbatim copies of MicroMaze files, named `path_with_underscores.ext.proposed` (`/` becomes `_`).
Copy each to its original path (inside a game repo, or the matching `templates/web-project/` path). Run from the factory root.

| Staged file | Purpose |
|---|---|
| tools_swarm-tracker_dashboard_server.mjs.proposed | swarm-tracker server; `TRACKER_ALLOW` env (comma prefixes, e.g. `192.168.1.`, `*`=any) opens the dashboard to the LAN |
| package.json_tracker-script.txt.proposed | the `npm run tracker` script line (binds 0.0.0.0, allows loopback + 192.168.1.) |
| tools_serve.mjs.proposed | dependency-free static server for `--web` games |
| tools_validate-level.mjs.proposed | validates a level JSON file |
| tools_botplay.mjs.proposed | headless bot plays levels over seeds, prints win summary |
| tools_sheet.mjs.proposed | renders art manifests to contact sheets |
| tools_export-characters.mjs.proposed | exports the character library to assets/characters |
| scripts_verify.sh.proposed | layered gate (imports, tests, level validation, botplay); per-level botplay is informational (`\|\| true` under `set -e`) |
| src_core_scores.js.proposed + test_sim_scores.test.mjs.proposed | top scores in localStorage, with test |
| src_core_settings.js.proposed | persisted options (volume etc.) |
| src_ui_startmenu.js.proposed + style.css_menu-blocks.css.proposed | start/pause menu: play/levels, controls, options, top scores; `#startmenu` CSS |
| assets_characters_library.json.proposed, assets_characters_README.md.proposed, docs_CHARACTERS.md.proposed | example asset-library layout for templates (library.json + README + docs) |
| src_levels_difficulty.js.proposed + test_levels_difficulty.test.mjs.proposed | easy/medium/hard/insane as a pure LevelDef transform (medium = identity), score multipliers |
| src_levels_size.js.proposed + test_levels_size.test.mjs.proposed | 1x/2x/3x store size as a pure transform: each tile becomes a k x k block (real extra cells), counts and ammo scale |
| src_ui_levelmenu.js.proposed | end-of-level card (retry / next level), keeps ?level/?diff/?size params |
| test_system_music-load.test.mjs.proposed | imports the music module so bad jingles fail in node, not as a blank browser canvas |

Compose order: `applyDifficulty(applySize(level, size), diff)`. Score keys: `level:diff[:2x|3x]`.

## GitHub Pages recipe
1. Fetch data with `new URL('./x.json', import.meta.url)`; never absolute `/src/...` paths (Pages serves under `/REPO/`).
2. `touch .nojekyll` at the repo root.
3. Enable Pages from `main:/`: `gh api -X POST repos/OWNER/REPO/pages -f 'source[branch]=main' -f 'source[path]=/'`.

See LEARNINGS-MICROMAZE.md and CHANGELOG-MICROMAZE.md.
