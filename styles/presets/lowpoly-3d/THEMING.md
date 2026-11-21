# Theming Low-poly 3D

Flat-shaded faceted 3D with vertex colours: minimal WebGL2 renderer, procedural meshes, fog, and a few hundred polygons per object.

Apply a theme with `styles.apply` (theme.json mixin). Guidance for this style:

- Choose 6-8 base hues and derive 4-step ramps; faces get a ramp step from lighting plus a small per-face jitter.
- Fog colour equals the sky horizon colour.
- UI: minimal, thin white outlines, no panels.
- Music: slow ambient pads with sparse notes, 70-100 bpm.
- Title: a slow orbit shot over generated terrain.

Limits: 300k triangles; one directional light plus ambient; no real-time shadows beyond blob shadows.

Pitfalls: chunk seams in terrain: share edge vertices; z-fighting at long draw distance: tune near/far; per-object draw calls: batch static geometry; headless CI has no GPU.
