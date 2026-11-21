# Theming Retro 16-bit

SNES/Genesis-era 2D: larger native canvas, per-sprite ramps, dithering, parallax layers, FM or sample-flavoured audio.

Apply a theme with `styles.apply` (theme.json mixin). Guidance for this style:

- Build each theme as a master ramp of 6 steps per hue, with shadows hue-shifted toward blue/purple and highlights toward yellow.
- Use dithering only on large gradients (sky, fog), never on characters.
- Typography: 8x8 or 8x12 bitmap face with a 1px drop shadow.
- Music: FM lead, bass and pad; 90-140 bpm; give every biome its own key.
- Title: full-width illustrated backdrop with a bevelled logo.

Limits: no real hardware mode-7; sprite budget about 200 on screen.

Pitfalls: 256 colours tempts ramp sprawl: enforce per-sprite limit; parallax seams at wrap points; FM patches that clip: normalise offline; larger sprites multiply art cost.
