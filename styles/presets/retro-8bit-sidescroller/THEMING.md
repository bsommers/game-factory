# Theming Retro 8-bit Side-scroller

NES/Atari-era flat-screen platformer: tiny native canvas, hard-locked palette, 1px outlines, pulse-wave chip audio. The PawFall reference style.

Apply a theme with `styles.apply` (theme.json mixin). Guidance for this style:

- Pick 8-16 colours as the palette; the sky, ground and foliage get one 4-step ramp each, the hero and villain two accent colours nobody else uses.
- Keep the outline colour one near-black from the palette; never pure black.
- Font: a 5x7 pixel face at scale 1-2 for HUD, scale 4-6 for the title.
- Music: pulse lead plus triangle bass, 120-150 bpm, major pentatonic for friendly, minor for villain screens.
- Title: logo over a gameplay screen with a blinking PRESS START.

Limits: no sub-pixel art; palette capped at 32.

Pitfalls: fractional scaling blurs pixels: keep integerOnly; colours added ad hoc break the palette lock; frame-rate dependent physics: use the fixed step; audio autoplay blocked before first input.
