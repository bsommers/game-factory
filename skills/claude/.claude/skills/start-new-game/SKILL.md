---
name: start-new-game
description: Scaffold a new zero-dependency web game (or Godot game) with tooling, kits, swarm tracker and a chosen style preset. Use when: new game, start a game, scaffold, bootstrap, create project, init project.
---

# Start a new game

## When to use
You have a game idea and no repo yet, or an empty repo that should get the factory tooling.

## Steps
1. Pick a style first (camera, render tech, palette policy, cost): `factory styles recommend "<idea>"` (capability `styles.recommend {idea, constraints}`).
2. Scaffold: `bin/factory new <dir> "<Title>" --web` (browser, zero deps) or without `--web` for Godot.
3. Apply the style: `styles.apply {project: <dir>, style: <id>}` writes `config/style.json`, `config/theme.json` and lists kits to install.
4. Write the contract before any agent runs: `ARCHITECTURE.md` plus a shared definitions file (`src/core/defs.js`: art rows, layout, palette, tuning).
5. `cd <dir> && npm test && npm start` (serves on port 4781).

## Commands
- `bin/factory new ~/src/fun/mygame "My Game" --web`
- `factory guide check ~/src/fun/mygame` shows what is still missing.

## Gotchas
- Never put build output in /tmp; use `out/` or /datanapps.
- Do not edit the kit copies in the game expecting changes to flow back to the factory.
- A `*/` inside a `/** */` comment ends it early; use `//` in doc blocks.

## Verification
`npm test` is green, `npm start` shows the template page, `guide.check` reports no errors.

Suggested model: haiku (cost low). Factory capabilities: styles.recommend, styles.apply, styles.show.
