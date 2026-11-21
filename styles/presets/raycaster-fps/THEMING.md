# Theming Raycaster FPS

Wolfenstein-style first-person view by 2D grid raycasting on Canvas2D or a software buffer: textured walls, billboard sprites, no GPU needed. The duum style.

Apply a theme with `styles.apply` (theme.json mixin). Guidance for this style:

- Pick wall palettes in groups of 3 textures that share a ramp; the floor and ceiling use flat ramp colours.
- HUD: bottom status bar with a face portrait; pixel font scale 2.
- Music: aggressive pulse riffs with noise drums at 130-170 bpm.
- Title: a still hero shot with the logo and a menu of 3 items.
- Light level varies per sector: shift ramps rather than adding colours.

Limits: no rooms over rooms, no sloped floors; about 320x200 at 60 fps on a low-end laptop; sprite count under 200.

Pitfalls: fisheye from using Euclidean distance: use perpendicular distance; sprite sort and clipping bugs; pointer lock requires a user gesture; fractional DDA steps cause wall gaps at corners.
