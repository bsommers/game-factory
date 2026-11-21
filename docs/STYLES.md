# Styles

A **style preset** is a declarative bundle (`styles/presets/<id>/style.json`, validated by `styles/style.schema.json`) that selects tooling and conventions for a kind of game: camera, render tech, resolution and scaling, palette policy, art/character/audio kits, fx defaults, physics and world-gen, input, performance budget, swarm shape and model tiers, verification checklist, pitfalls and example games. A **theme** (`styles/themes/<id>.theme.json`, `styles/theme.schema.json`) is a mixin applied on top of a style: palette, typography, UI skin, audio mood and title layout. Each preset folder has a short `THEMING.md`.

## Comparison

`*` marks the reference game for that style. Cost is the relative build cost (1 cheapest, 5 most expensive); "Min device" is the weakest hardware class that hits the target FPS.

| Preset | Camera | Render tech | Native res | Palette | Audio | Min device | Cost | Agents | Games |
|---|---|---|---|---|---|---|---|---|---|
| `ascii-terminal` | text-grid | terminal-text | 80x24 | locked (16) | terminal-bell | low | 1/5 | 3-6 | KÄSEKRIEG |
| `cartoon-vector` | side-scroller | canvas2d-vector | 1280x720 | free (4096) | procedural-webaudio | mid | 3/5 | 8-14 | KÄSEKRIEG |
| `cel-shaded-toon-3d` | third-person-3d | webgl2-custom | 1280x720 | ramps (64) | procedural-webaudio | mid | 5/5 | 10-16 | PawFall |
| `isometric-tactics` | isometric | canvas2d-pixel | 480x270 | ramps (96) | fm | low | 3/5 | 9-15 | KÄSEKRIEG* |
| `lowpoly-3d` | third-person-3d | webgl2-custom | 1280x720 | ramps (96) | procedural-webaudio | mid | 4/5 | 9-15 | catxzzon |
| `pixel-2.5d-parallax` | parallax-2.5d | canvas2d-pixel | 480x270 | ramps (128) | fm | low | 3/5 | 10-16 | PawFall |
| `raycaster-fps` | first-person | raycaster-canvas | 320x200 | ramps (64) | chip-pulse | low | 3/5 | 8-14 | duum* |
| `raytraced-3d` | first-person | shader-raymarch | 960x540 | free (4096) | procedural-webaudio | high | 5/5 | 5-9 | duum |
| `retro-16bit` | side-scroller | canvas2d-pixel | 384x216 | ramps (256) | fm | low | 3/5 | 10-18 | KÄSEKRIEG, PawFall |
| `retro-8bit-sidescroller` | side-scroller | canvas2d-pixel | 320x180 | locked (32) | chip-pulse | low | 2/5 | 8-14 | PawFall*, catxzzon |
| `top-down-arcade` | top-down | canvas2d-pixel | 320x240 | locked (48) | chip-pulse | low | 2/5 | 8-13 | catxzzon* |

3D presets (`cel-shaded-toon-3d`, `lowpoly-3d`, `raytraced-3d`) use a small own WebGL2 renderer, or a vendored (never CDN) copy of three.js, and each names a performance fallback tier (render-scale ladder; `raytraced-3d` ends in a switch to `lowpoly-3d`). Nothing needs an install step. Their limits are stated in each preset's `tech.limits`.

## Capabilities

Registered in the core registry format by `factory-core/styles/capabilities.mjs` (`capabilities` array, or `registerStyles(registry)` for an array, Map, or an object with `register(cap)`). Every handler returns `{ ok, data, error, next }`; `inputSchema` is JSON Schema.

| Capability | Input | Result |
|---|---|---|
| `styles.list` | `{camera?, dimension?, tag?}` | all presets (summary) and themes |
| `styles.show` | `{id, themes?}` | full preset, THEMING.md, compatible themes |
| `styles.recommend` | `{idea, constraints?: {platform, team, budget, device, dimension, camera, avoid[]}, limit?}` | ranked presets with score, reasons, warnings, pros/cons, excluded list |
| `styles.apply` | `{project, style, theme?, yes?, dryRun?}` | files written, files unchanged, install list (kits, libs, skills, missingKits), library tags |
| `styles.validate` | `{id?, theme?, file?, style?}` | schema and semantic problems per style/theme or file |

Core library: `factory-core/styles/index.mjs` (`loadPresets`, `listStyles`, `showStyle`, `recommend`, `applyStyle`, `validatePreset`, `validateTheme`, `validateAll`) and a zero-dependency JSON-Schema subset validator `schema.mjs`.

### Recommendation scoring (deterministic)
Whole-word keyword matches add the preset's weight (`recommend.keywords`); `recommend.anti` words subtract. Constraints: `platform` excludes presets that do not target it; `device` below the preset's `minDevice` is -8; `budget: low` costs (cost-2)*2; `team <= 2` with cost >= 4 is -2; `dimension` +3 or -6; `camera` +4 or -2. Ties break by lower cost, then id. With no keyword hit the default `retro-8bit-sidescroller` is returned with `fallback: true`.

### Apply rules
`styles.apply` writes `config/style.json`, `config/theme.json` (if a theme is given) and merges a `style` key into `factory.config.json` (other keys are kept). Identical files are left alone, so repeat runs are no-ops. A differing existing file gives `CONFLICT` (nothing is written) unless `yes: true`. `dryRun: true` reports without writing. Themes are validated against the style first (`INVALID_THEME`).

## Theme validation
`validateTheme(theme, {style?})`: schema; every role maps to a named colour; text/background contrast >= 4.5 and danger/background >= 3; `compatibleStyles` names real presets; for a given style, the theme is compatible, fits the style's `maxColors` (terminal: at most 16). Examples: `jungle` (PawFall), `space`, `cheese-ratops` (KÄSEKRIEG).

## Asset-library tag convention (for factory-library)
Tag asset descriptors with the style id they were made for: `style:<preset-id>` (for example `style:retro-8bit-sidescroller`). An asset usable in several styles lists several tags. Style-neutral assets (audio recipes, code libs) use `style:*`. A theme tag is `theme:<theme-id>`. `styles.apply` returns `libraryTags: ["style:<id>"]`, so a library search is `tag = style:<id>` plus `style:*`. Presets also carry free-form `tags` (`pixel`, `3d`, `retro`...) for browsing.

## Adding a preset
Copy a preset folder, change `id` (must equal the folder name), fill every required section, write `THEMING.md`, then `node --test test/styles/`. 3D presets must give `performance.fallbackTier` and `renderScaleTiers`. Add golden recommendation cases in `test/styles/recommend.test.mjs`.

## Tests
`node --test test/styles/` covers schema validation of all presets and themes, 14 golden recommendation cases, scoring rules, apply idempotence and non-destructiveness, and the capability registry shape.
