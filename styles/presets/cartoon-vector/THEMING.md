# Theming Cartoon Vector

Smooth-edged 2D cartoon art drawn with Canvas2D paths: thick strokes, flat fills, squash and stretch, skeletal rigs.

Apply a theme with `styles.apply` (theme.json mixin). Guidance for this style:

- Pick a 12-colour set: 4 neutrals, 4 brand hues, 4 accent/alerts; strokes use the darkest neutral.
- Round line joins, 4px strokes at 720p, scale with resolution.
- Fonts: a rounded vector face loaded as a local file; ship the licence.
- Music: playful marimba and plucks, swing 8ths, 100-130 bpm.
- Title: bouncing logo letters with a squash on key press.

Limits: several thousand animated paths per frame is the ceiling; no GPU shaders.

Pitfalls: redrawing every path every frame: cache static art; hairline strokes at high DPR; Path2D allocation per frame creates GC stutter; inconsistent stroke widths across assets.
