# Theming Raytraced 3D

Ray-marched or path-traced scenes in a WebGL2 fragment shader: signed-distance primitives, soft shadows and global-illumination look, with an automatic performance fallback ladder.

Apply a theme with `styles.apply` (theme.json mixin). Guidance for this style:

- Theme means light: choose a key light colour, a sky gradient and 3-5 material albedos; emissive accents give the glow.
- Keep the UI in plain 2D canvas over the shader, high contrast.
- Music: slow drones and bell tones, 60-90 bpm.
- Title: a hero scene rendered live at tier 1 with a camera dolly.
- Tone-map with a filmic curve to keep brights from clipping.

Limits: about 100-150 march steps; a handful of SDF primitives and 1-2 bounces; WebGL2 required, EXT_color_buffer_float optional.

Pitfalls: GPU watchdog resets on long shader loops: cap march steps; integrated GPUs miss 60 fps at full res: enforce the ladder; no headless GPU: shots need a real browser; precision artefacts far from the origin.
