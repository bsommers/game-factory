# Theming Isometric Tactics

Grid-based turn-based strategy in 2:1 isometric projection: height levels, depth sorting, line of sight, and an AI that plans on the grid.

Apply a theme with `styles.apply` (theme.json mixin). Guidance for this style:

- Terrain faces use top/left/right lightness offsets from one ramp per material; units get a team colour on a dedicated accent ramp.
- UI: bordered panels, a 5x7 face for numbers, a larger face for headings.
- Music: slow FM strings, with a pulse for combat turns, 80-110 bpm.
- Title: isometric diorama rotating slowly.
- Highlights: movement range blue, attack range red, both with a 1px bright rim.

Limits: maps up to about 40x40 tiles at 60 fps; no free camera rotation (4 fixed views at most).

Pitfalls: painter order errors with tall sprites: sort by tile then height; pointer to tile conversion off by half tile; AI runtime blowups on large maps: budget per turn; hidden information leaks through the UI.
