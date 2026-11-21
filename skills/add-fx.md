---
name: add-fx
description: Add juicy feedback with fx-kit: particles, screen shake, flash, score popups, day-night sky, parallax and foreground silhouettes.
triggers: [fx, effects, particles, juice, shake, screen shake, flash, popup, parallax, sky, day night, silhouette, polish, feedback, juicy, explosion, splash, confetti]
needs: [src/kits/fx-kit]
outputs: [render hooks, fx tests]
model: sonnet
cost: low
capabilities: []
kits: [fx-kit]
---
# FX and juice

## Steps
1. `createParticles({seed, max})`; `burst('splash'|'dust'|'sparkle'|'confetti'|'poof', x, y)` at event time; `update(dt)`; `draw(ctx)`.
2. `createShake()` (`kick`, integer `offset()`), `createFlash()`, `createPopups()` for score text.
3. Sky: `skyRamp(DAY_NIGHT_STOPS, t01)`, `drawSkyBands`; backgrounds: `parallaxOffsets(layers, camX, tileW)`; `makeSilhouetteStrip('trees'|'hills'|'grass', w, h)`.
4. Trigger fx from sim events, never from render state.

## Gotchas
- Parallax layers tile only when `W*factor*120` is a multiple of the tile width.
- Use integer shake offsets so pixel art stays crisp.
- Stamp HUD event times on the next draw, with the clock the HUD uses.

## Verification
Same seed gives the same particles (determinism test); render a frame to PNG and look at it.
