---
name: choose-style
description: Pick and apply a game style preset (pixel 8-bit, 16-bit, raycaster, low-poly 3D, isometric, ASCII, vector) with theme and palette policy. Use when: style, preset, theme, 3d, 2d, pixel.
---

# Choose a style

## Steps
1. `styles.recommend {idea, constraints: {platform, team, budget, device}}` ranks presets with reasons and trade-offs.
2. `styles.show {id, themes: true}` for the full preset and compatible themes.
3. `styles.apply {project, style, theme?, dryRun: true}` then without dryRun; `yes` overwrites differing files.
4. Tag every asset you later publish `style:<id>`.

## Gotchas
- 3D presets need a performance fallback tier and render-scale tiers; CDN scripts are never allowed.
- Locked palettes need maxColors; art must pass the palette lock.

## Verification
`styles.validate {}` ok; `config/style.json` exists in the project.

Suggested model: haiku (cost low). Factory capabilities: styles.list, styles.show, styles.recommend, styles.apply, styles.validate.
