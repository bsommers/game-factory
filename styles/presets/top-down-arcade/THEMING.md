# Theming Top-down Arcade

Overhead 2D action: twin-stick or 4-way movement, tile maps, waves of enemies, pixel art with chunky feedback.

Apply a theme with `styles.apply` (theme.json mixin). Guidance for this style:

- Floor tiles use the darkest ramp so entities and bullets pop; give player projectiles a colour no enemy uses.
- HUD along the top or bottom in a 5x7 face.
- Music: driving pulse bass and fast arps, 140-170 bpm.
- Hit feedback: 2-frame white flash plus a 4-8px shake.
- Title: attract mode showing a bot playing.

Limits: around 500 active entities at 60 fps on low tier.

Pitfalls: bullet-hell entity counts: pool and cap; diagonal speed boost: normalise movement; tile collision tunnelling at high speed: sub-step; aim input differs between mouse and pad.
