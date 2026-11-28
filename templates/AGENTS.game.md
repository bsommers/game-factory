# AGENTS.md - __NAME__

Game scaffolded by game-factory (`__FACTORY__`). Drive the factory through its CLI: `__FACTORY__/bin/factory <cmd> --json`.
Every call returns `{ok, data, error, next}`; read `next` for follow-ups. Exit codes: 0 ok, 1 failed, 2 bad input, 3 not found, 4 exists/conflict.

## Start here
- `__FACTORY__/bin/factory guide check --project . --json` - what this project is missing, in order.
- `__FACTORY__/bin/factory guide route "<goal>" --json` - ranked skills, capabilities, kits, styles.
- `__FACTORY__/bin/factory capabilities --json` - everything available; `help <cmd>` for flags.
- Read `docs/LEARNINGS.md` and `docs/KITS.md` before building.

## Reuse before you write
Check what exists before writing a new system: `docs/KITS.md` (art, character, audio, fx, docs, raytrace kits and `src/lib`), then `__FACTORY__/bin/factory guide route "<goal>" --json` (ranked kits, assets, skills). Kits are opt-in per game: if the one you need is not in `src/kits/`, copy it from `__FACTORY__/templates/web-project/src/kits/<name>-kit` (character-kit and fx-kit need art-kit) with its `test/kits/` suite rather than reimplementing it. Fresh scaffolds: `factory new <dir> "<Title>" --web --with kits=art,audio`.

## Loop
1. Pick a style: `styles recommend` then `styles apply`.
2. Write `ARCHITECTURE.md` (the contract: modules, hooks, defs).
   Then edit `docs/swarm/SWARM.md`; file ownership must be disjoint. <!-- swarm -->
3. `npm test`, `node tools/check-imports.mjs`, `npm start` (port 4781), `node tools/shot.mjs` for screenshots.
4. Ship: `npm run build` (single file + zip), `npm run package` (desktop archive with installer), `npm run smoke:web`, `npm run smoke:desktop`. See `__FACTORY__/docs/BUILD-WEB.md`.
5. Never weaken a gate to get green. Commits are the orchestrator's job.
- Swarm: `npm run plan`, `npm run tracker` (port 4780). Agents report with `swarm track <agent> start|progress|done|failed`. Rules: `docs/PLAYBOOK.md`. <!-- swarm -->

## Models
Haiku for searches and mechanical edits; Sonnet for integration, debugging, review, planning; Opus only for architecture or security. Keep subagent replies short.
