# Theming Pixel 2.5D Parallax

Pixel art with depth: many parallax planes, lane or depth-layer movement, scaled sprites and fog, all on Canvas2D.

Apply a theme with `styles.apply` (theme.json mixin). Guidance for this style:

- Assign each plane a ramp that shifts toward the sky colour with distance.
- Keep the playfield plane the highest contrast; fog tint equals the theme sky colour.
- Typography as 16-bit; HUD sits on a translucent bar.
- Music: layered pads with a slow arpeggio; add a stinger for each depth change.
- Title: parallax backdrop drifting behind the logo.

Limits: no true perspective; at most 8 full-width planes at 60 fps on low tier.

Pitfalls: too many full-screen planes kill low-end fill rate: pre-bake; sprite scaling breaks pixel grid: scale in integer steps only; depth sorting flicker on ties: add a stable tiebreak; foreground planes hide the player.
