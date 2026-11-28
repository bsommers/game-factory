# Theming Ghibli Painterly

Soft hand-painted Canvas2D vector look (original; inspired by the warmth of hand-painted animation, copies nothing). Recommended tooling: `painter-kit` (primitives), soft particles (petals, fireflies, bubbles), gentle music, NO CRT, smooth scaling (`imageSmoothingEnabled = true`, CSS `image-rendering: auto`).

- Palette: free, but keep one plum ink (`#3b2f3a`) used at 20-35% alpha for outlines; build shade with `darken`, light with `lighten`/`washFill` bloom. Day/dusk/night = three sky gradients plus a warm or cool multiply overlay.
- Shapes: organic (`blob`, `leaf`, `cloud`, `roundRect`), never sharp rectangles; gradient shading via `lin`/`radial`; `softShadow` under everything that stands on the ground.
- Texture: `paperGrain(ctx,w,h,seed)` baked ONCE onto backdrops, `washFill` for darker pooled edges.
- Motion: `sway(t, phase)` for grass and foliage, slow cloud drift, all as a pure function of game time so screenshots are deterministic.
- Resolution: draw sprites at 4x logical size, cache each frame to an offscreen surface (`makeSurface`).
- Music: sine/triangle piano, strings, flute-like lead, waltz or 6/8, 84-110 bpm. SFX: soft bells, brushed noise, rounded envelopes.
- Fonts: a rounded humanist face, cream text on plum with a soft shadow.

Pitfalls: grain every frame, black hairline outlines, pixelated scaling, `Math.random` in art, uncached gradients in hot loops.
